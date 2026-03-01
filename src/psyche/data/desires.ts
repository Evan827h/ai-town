import { DesireTag } from '../registries';

/**
 * Desire system constants.
 *
 * Wants and fears are emergent — they arise from the reflection pipeline,
 * not from preset data. This file defines the bounds and tuning knobs.
 */

/** Maximum active wants per agent */
export const MAX_WANTS = 5;

/** Maximum active fears per agent */
export const MAX_FEARS = 5;

/** Intensity lost per full game-day (24 × 60 = 1440 game-minutes) */
export const DESIRE_DECAY_RATE_PER_GAME_DAY = 0.05;

/** Desires below this intensity are pruned */
export const DESIRE_PRUNE_THRESHOLD = 0.1;

/** Tag overlap ratio (Jaccard) above which two desires are considered similar and merged */
export const DESIRE_MERGE_SIMILARITY_THRESHOLD = 0.5;

/** Score adjustment factor — ±15% at full intensity with perfect tag match */
export const DESIRE_TIEBREAKER_WEIGHT = 0.15;

/**
 * Complete tag vocabulary. LLM extraction prompts reference this list,
 * and actions declare their tags from the same set.
 */
export const ALL_DESIRE_TAGS: readonly DesireTag[] = [
  'social', 'friendship', 'respect', 'solitude',
  'rest', 'food', 'fun', 'nature',
  'creativity', 'productivity', 'safety', 'exploration',
] as const;
