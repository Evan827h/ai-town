import { MoralValue, MoralProfile } from '../registries';

export const MORAL_VALUES: MoralValue[] = [
  { id: 'honesty', name: 'Honesty', description: 'Value truthfulness and transparency' },
  { id: 'loyalty', name: 'Loyalty', description: 'Stand by those you care about' },
  { id: 'fairness', name: 'Fairness', description: 'Treat others equitably' },
  { id: 'care', name: 'Care', description: 'Protect others from harm' },
  { id: 'authority', name: 'Authority', description: 'Respect hierarchy and rules' },
  { id: 'liberty', name: 'Liberty', description: 'Value personal freedom and autonomy' },
  { id: 'tradition', name: 'Tradition', description: 'Respect established customs' },
];

/**
 * Per-character moral profiles.
 * Keys must match character names in data/characters.ts.
 *
 * Weight interpretation:
 *   0.0 = doesn't care about this value at all
 *   0.5 = moderate importance
 *   1.0 = defines this character's identity
 *
 * Alex: moderate, loyal, balanced — will feel conflict but rarely vetoes
 * Maya: high-honesty, liberty-loving skeptic — will veto deceptive actions freely
 */
export const MORAL_PROFILES: Record<string, MoralProfile> = {
  Alex: {
    weights: {
      honesty: 0.6,
      loyalty: 0.7,
      fairness: 0.5,
      care: 0.6,
      authority: 0.4,
      liberty: 0.5,
      tradition: 0.3,
    },
    hardVetoThreshold: 0.85,
    conflictThreshold: 0.40,
  },
  Maya: {
    weights: {
      honesty: 0.9,
      loyalty: 0.4,
      fairness: 0.7,
      care: 0.5,
      authority: 0.2,
      liberty: 0.8,
      tradition: 0.2,
    },
    hardVetoThreshold: 0.80,
    conflictThreshold: 0.35,
  },
};

/** Fallback profile for characters without a defined profile */
export const DEFAULT_MORAL_PROFILE: MoralProfile = {
  weights: {
    honesty: 0.5,
    loyalty: 0.5,
    fairness: 0.5,
    care: 0.5,
    authority: 0.3,
    liberty: 0.5,
    tradition: 0.3,
  },
  hardVetoThreshold: 0.90,
  conflictThreshold: 0.50,
};
