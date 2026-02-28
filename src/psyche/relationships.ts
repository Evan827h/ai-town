/**
 * Relationship Graph — pure functions for social edge management.
 *
 * These functions are deterministic and side-effect free.
 * They operate on RelationshipEdge data and return new values.
 * No database, no browser deps — safe for both Convex backend and unit tests.
 */

import {
  RelationshipEdge,
  SocialDisposition,
  InteractionOutcome,
  ScoredAction,
  SocialWeights,
} from './registries';
import { OUTCOME_DELTAS, FREQUENCY_DECAY_PER_GAME_HOUR, SOCIAL_MODIFIER_SCALE } from './data/relationships';

// ─── Clamping Helpers ────────────────────────────────────────

/** Clamp bipolar dimensions: trust, affinity, respect (-100..100) */
function clampBipolar(value: number): number {
  return Math.max(-100, Math.min(100, value));
}

/** Clamp unipolar dimensions: frequency, familiarity (0..100) */
function clampUnipolar(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// ─── Core Functions ──────────────────────────────────────────

/**
 * Create a new relationship edge using the observer's disposition as defaults.
 * Called when two agents meet for the first time.
 */
export function initializeRelationship(
  fromDisposition: SocialDisposition,
  fromAgentId: string,
  toAgentId: string,
  gameTime: number,
): RelationshipEdge {
  return {
    fromAgentId,
    toAgentId,
    trust: clampBipolar(fromDisposition.defaultTrust),
    affinity: clampBipolar(fromDisposition.defaultAffinity),
    respect: clampBipolar(fromDisposition.defaultRespect),
    frequency: 0,
    familiarity: 0,
    lastInteraction: gameTime,
  };
}

/**
 * Update a relationship edge after an interaction.
 * Applies deterministic deltas from the outcome registry.
 * Familiarity never decreases — it only grows.
 */
export function updateRelationship(
  edge: RelationshipEdge,
  outcome: InteractionOutcome,
  gameTime: number,
): RelationshipEdge {
  const deltas = OUTCOME_DELTAS[outcome];

  return {
    ...edge,
    trust: clampBipolar(edge.trust + deltas.trust),
    affinity: clampBipolar(edge.affinity + deltas.affinity),
    respect: clampBipolar(edge.respect + deltas.respect),
    frequency: clampUnipolar(edge.frequency + deltas.frequency),
    // Familiarity only grows — take the max of current and current + delta
    familiarity: clampUnipolar(edge.familiarity + Math.max(0, deltas.familiarity)),
    lastInteraction: gameTime,
  };
}

/**
 * Decay frequency based on elapsed game time since last interaction.
 * Frequency drops by FREQUENCY_DECAY_PER_GAME_HOUR per game-hour.
 * Used for on-the-fly computation during reads (no mutation needed).
 */
export function decayFrequency(
  edge: RelationshipEdge,
  elapsedGameMinutes: number,
): RelationshipEdge {
  const decayAmount = (elapsedGameMinutes / 60) * FREQUENCY_DECAY_PER_GAME_HOUR;
  return {
    ...edge,
    frequency: clampUnipolar(edge.frequency - decayAmount),
  };
}

/**
 * Compute a weighted composite relationship score for an action.
 * Uses the action's socialWeights to blend relationship dimensions.
 * Returns a value roughly in -100..100 range.
 */
function compositeRelationshipScore(
  edge: RelationshipEdge,
  weights: SocialWeights,
): number {
  let score = 0;
  let totalWeight = 0;

  if (weights.trust) {
    score += edge.trust * weights.trust;
    totalWeight += weights.trust;
  }
  if (weights.affinity) {
    score += edge.affinity * weights.affinity;
    totalWeight += weights.affinity;
  }
  if (weights.respect) {
    score += edge.respect * weights.respect;
    totalWeight += weights.respect;
  }
  if (weights.frequency) {
    score += edge.frequency * weights.frequency;
    totalWeight += weights.frequency;
  }
  if (weights.familiarity) {
    score += edge.familiarity * weights.familiarity;
    totalWeight += weights.familiarity;
  }

  // Normalize by total weight so scale is consistent regardless of how many dims are used
  return totalWeight > 0 ? score / totalWeight : 0;
}

/**
 * Post-process scored actions by applying relationship modifiers to social actions.
 *
 * For each action with socialWeights:
 * 1. Compute weighted composite score across all nearby agents' relationships
 * 2. Scale by SOCIAL_MODIFIER_SCALE to get a percentage modifier
 * 3. Apply as a multiplier to the action's existing score
 *
 * Non-social actions (no socialWeights) pass through unchanged.
 * If no nearby agents or no relationships, all actions pass through unchanged.
 */
export function applyRelationshipModifiers(
  scoredActions: ScoredAction[],
  relationships: RelationshipEdge[],
  nearbyAgentIds: string[],
): ScoredAction[] {
  if (nearbyAgentIds.length === 0 || relationships.length === 0) {
    return scoredActions;
  }

  // Build lookup: toAgentId → edge
  const relMap = new Map(relationships.map((r) => [r.toAgentId, r]));

  // Get relationships with nearby agents only
  const nearbyEdges = nearbyAgentIds
    .map((id) => relMap.get(id))
    .filter((e): e is RelationshipEdge => e !== undefined);

  if (nearbyEdges.length === 0) {
    return scoredActions;
  }

  return scoredActions.map((sa) => {
    if (!sa.action.socialWeights) {
      return sa; // Non-social action, no modification
    }

    // Average composite score across all nearby agents with relationships
    const avgComposite =
      nearbyEdges.reduce((sum, edge) => sum + compositeRelationshipScore(edge, sa.action.socialWeights!), 0) /
      nearbyEdges.length;

    // Convert to a multiplier: -100..100 → 0.85..1.15 (at SOCIAL_MODIFIER_SCALE = 0.15)
    const modifier = 1 + (avgComposite / 100) * SOCIAL_MODIFIER_SCALE;

    return { action: sa.action, score: sa.score * modifier };
  });
}

/**
 * Score a relationship edge for conversation partner preference.
 * Blends affinity with frequency (with decay applied).
 * Higher = more preferred partner.
 *
 * Returns a normalized 0..1 score.
 */
// ─── Conversation Outcome Parsing ───────────────────────────

/** Valid outcomes the LLM can classify a conversation as */
const VALID_OUTCOMES: Set<InteractionOutcome> = new Set([
  'positive_social',
  'negative_social',
  'helpful',
  'betrayal',
  'impressive',
  'neutral',
]);

/**
 * Parse an OUTCOME: label from LLM conversation summary output.
 * Returns the cleaned text (label stripped) and the parsed outcome.
 * Falls back to 'positive_social' if no valid outcome is found.
 */
export function parseConversationOutcome(llmOutput: string): {
  cleanText: string;
  outcome: InteractionOutcome;
} {
  const pattern = /\n?\s*OUTCOME:\s*(\S+)\s*$/i;
  const match = llmOutput.match(pattern);

  if (match) {
    const candidate = match[1].toLowerCase() as InteractionOutcome;
    if (VALID_OUTCOMES.has(candidate)) {
      return {
        cleanText: llmOutput.replace(pattern, '').trim(),
        outcome: candidate,
      };
    }
  }

  return {
    cleanText: llmOutput.trim(),
    outcome: 'positive_social',
  };
}

export function conversationPreferenceScore(
  edge: RelationshipEdge,
  elapsedGameMinutes: number,
): number {
  // Apply frequency decay on-the-fly (read-only, no mutation)
  const decayed = decayFrequency(edge, elapsedGameMinutes);

  // Blend: affinity (how much they like them) + frequency (how recently they interacted)
  // Affinity is -100..100, normalize to 0..1
  const affinityNorm = (decayed.affinity + 100) / 200;
  // Frequency is 0..100, normalize to 0..1
  const frequencyNorm = decayed.frequency / 100;

  // Weight affinity more than frequency (60/40)
  return affinityNorm * 0.6 + frequencyNorm * 0.4;
}
