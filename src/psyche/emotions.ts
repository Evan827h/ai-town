/**
 * Emotional Contagion — pure functions for agent emotions.
 *
 * Russell's circumplex model: valence (-1..1) × arousal (-1..1).
 * Emotions decay exponentially toward per-character baselines,
 * transfer between nearby agents via proximity-based contagion,
 * and inject into LLM conversation prompts.
 */

import { EmotionalState, EmotionalProfile, RelationshipEdge } from './registries';
import {
  EMOTION_ANCHORS,
  EMOTION_MIN,
  EMOTION_MAX,
  VALENCE_HALF_LIFE,
  AROUSAL_HALF_LIFE,
  CONTAGION_MAX_DISTANCE,
  CONTAGION_SCALE,
  NEUTRAL_THRESHOLD,
  DEFAULT_STRANGER_CLOSENESS,
} from './data/emotions';

/**
 * Exponential decay toward per-character baseline.
 * Formula: current = baseline + (current - baseline) × 2^(-elapsed / halfLife)
 * Separate half-lives for valence (120 game-min) and arousal (60 game-min).
 */
export function decayEmotion(
  state: EmotionalState,
  elapsedGameMinutes: number,
  baseline: { valence: number; arousal: number },
): EmotionalState {
  if (elapsedGameMinutes <= 0) return state;

  const valenceDecay = Math.pow(2, -elapsedGameMinutes / VALENCE_HALF_LIFE);
  const arousalDecay = Math.pow(2, -elapsedGameMinutes / AROUSAL_HALF_LIFE);

  return {
    valence: baseline.valence + (state.valence - baseline.valence) * valenceDecay,
    arousal: baseline.arousal + (state.arousal - baseline.arousal) * arousalDecay,
    lastUpdated: state.lastUpdated + elapsedGameMinutes,
  };
}

/**
 * Apply an additive emotional delta (from actions or conversations).
 * Clamps result to [-1, +1].
 */
export function applyEmotionDelta(
  state: EmotionalState,
  delta: { valence: number; arousal: number },
  gameTime: number,
): EmotionalState {
  return {
    valence: clamp(state.valence + delta.valence),
    arousal: clamp(state.arousal + delta.arousal),
    lastUpdated: gameTime,
  };
}

/**
 * Compute contagion transfer delta from sender to receiver.
 * Returns { dValence, dArousal } — the delta the receiver should absorb.
 *
 * Transfer formula:
 *   delta = (sender - receiver) × proximityWeight × closeness × receptivity × charisma × CONTAGION_SCALE
 *
 * @param profile - The receiver's emotional profile (receptivity + sender's charisma)
 */
export function transferEmotion(
  sender: EmotionalState,
  receiver: EmotionalState,
  distance: number,
  closeness: number,
  profile: EmotionalProfile,
): { dValence: number; dArousal: number } {
  if (distance > CONTAGION_MAX_DISTANCE) {
    return { dValence: 0, dArousal: 0 };
  }

  const proximityWeight = 1 - distance / CONTAGION_MAX_DISTANCE;
  const transferStrength =
    proximityWeight * closeness * profile.receptivity * profile.charisma * CONTAGION_SCALE;

  return {
    dValence: (sender.valence - receiver.valence) * transferStrength,
    dArousal: (sender.arousal - receiver.arousal) * transferStrength,
  };
}

/**
 * Nearest-anchor Euclidean lookup — maps a 2D emotion state to a label + intensity.
 * Intensity = distance from origin (0,0).
 */
export function getEmotionLabel(state: EmotionalState): { label: string; intensity: number } {
  const intensity = Math.sqrt(state.valence * state.valence + state.arousal * state.arousal);

  let bestLabel = 'neutral';
  let bestDist = Infinity;

  for (const anchor of EMOTION_ANCHORS) {
    const dv = state.valence - anchor.valence;
    const da = state.arousal - anchor.arousal;
    const dist = Math.sqrt(dv * dv + da * da);
    if (dist < bestDist) {
      bestDist = dist;
      bestLabel = anchor.label;
    }
  }

  return { label: bestLabel, intensity };
}

/**
 * Convert an emotional state to a prompt-friendly line for LLM context injection.
 *
 * Intensity descriptors:
 *   - Below NEUTRAL_THRESHOLD (0.15): returns '' (near-neutral, omit from prompt)
 *   - 0.15–0.4: "slightly"
 *   - 0.4–0.7: no prefix
 *   - >0.7: "very"
 */
export function getEmotionContext(state: EmotionalState): string {
  const { label, intensity } = getEmotionLabel(state);

  if (intensity < NEUTRAL_THRESHOLD) return '';

  let prefix = '';
  if (intensity > 0.7) {
    prefix = 'very ';
  } else if (intensity < 0.4) {
    prefix = 'slightly ';
  }

  return `You're currently feeling ${prefix}${label}.`;
}

/**
 * Create an EmotionalState from a character profile's baseline.
 */
export function initializeEmotion(
  profile: EmotionalProfile,
  gameTime: number,
): EmotionalState {
  return {
    valence: profile.baseline.valence,
    arousal: profile.baseline.arousal,
    lastUpdated: gameTime,
  };
}

/**
 * Convert a RelationshipEdge to a 0..1 closeness scalar for contagion.
 *
 * closeness = (normalize(trust) + normalize(affinity) + normalize(familiarity)) / 3
 *
 * Trust/affinity: [-100, 100] → [0, 1]
 * Familiarity: [0, 100] → [0, 1]
 * Null edge (stranger): returns DEFAULT_STRANGER_CLOSENESS.
 */
export function relationshipToCloseness(edge: RelationshipEdge | null): number {
  if (!edge) return DEFAULT_STRANGER_CLOSENESS;

  const normTrust = (edge.trust + 100) / 200;
  const normAffinity = (edge.affinity + 100) / 200;
  const normFamiliarity = edge.familiarity / 100;

  return (normTrust + normAffinity + normFamiliarity) / 3;
}

// ─── Internal helpers ────────────────────────────────────────

function clamp(value: number): number {
  return Math.max(EMOTION_MIN, Math.min(EMOTION_MAX, value));
}
