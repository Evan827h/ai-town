import { InteractionOutcome, SocialDisposition } from '../registries';

/**
 * Relationship data registry — outcome deltas, character dispositions, constants.
 *
 * Each interaction outcome maps to deterministic dimension changes.
 * Future: parse LLM conversation summaries into these outcome types.
 * For now, all conversations default to 'positive_social'.
 */

// ─── Outcome Deltas ──────────────────────────────────────────

/** How each interaction outcome changes relationship dimensions */
export const OUTCOME_DELTAS: Record<
  InteractionOutcome,
  { trust: number; affinity: number; respect: number; frequency: number; familiarity: number }
> = {
  positive_social: { trust: 3, affinity: 5, respect: 1, frequency: 15, familiarity: 3 },
  negative_social: { trust: -5, affinity: -8, respect: -2, frequency: 10, familiarity: 2 },
  helpful: { trust: 8, affinity: 3, respect: 5, frequency: 15, familiarity: 4 },
  betrayal: { trust: -25, affinity: -5, respect: -10, frequency: 10, familiarity: 5 },
  impressive: { trust: 2, affinity: 5, respect: 10, frequency: 10, familiarity: 3 },
  neutral: { trust: 0, affinity: 0, respect: 0, frequency: 8, familiarity: 1 },
};

// ─── Character Social Dispositions ───────────────────────────

/** Default attitudes each character has toward strangers */
export const CHARACTER_DISPOSITIONS: Record<string, SocialDisposition> = {
  Alex: { defaultTrust: 15, defaultAffinity: 5, defaultRespect: 0 },
  Maya: { defaultTrust: -5, defaultAffinity: 10, defaultRespect: 5 },
};

/** Fallback disposition for characters not in the registry */
export const DEFAULT_DISPOSITION: SocialDisposition = {
  defaultTrust: 0,
  defaultAffinity: 0,
  defaultRespect: 0,
};

// ─── Tuning Constants ────────────────────────────────────────

/** Frequency decay per game-hour (frequency drops by this much per hour of no interaction) */
export const FREQUENCY_DECAY_PER_GAME_HOUR = 0.5;

/**
 * How much relationship scores can modify social action scores.
 * Higher = relationships dominate action choice more.
 * At 0.15: a maximally positive relationship adds ~15% to social action scores.
 */
export const SOCIAL_MODIFIER_SCALE = 0.15;

/**
 * Weights for conversation candidate scoring.
 * Distance vs relationship preference blend.
 */
export const DISTANCE_WEIGHT = 0.6;
export const RELATIONSHIP_WEIGHT = 0.4;
