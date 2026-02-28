/**
 * Emotional Contagion Registry — anchors, character profiles, outcome deltas, constants.
 *
 * Russell's circumplex model: valence (-1..1) × arousal (-1..1).
 * Emotions transfer between nearby agents, decay toward per-character baselines,
 * and inject into LLM conversation prompts.
 */

import { EmotionAnchor, EmotionalProfile, InteractionOutcome } from '../registries';

// ─── Constants ───────────────────────────────────────────────

export const EMOTION_MIN = -1;
export const EMOTION_MAX = 1;
export const VALENCE_HALF_LIFE = 120; // game-minutes
export const AROUSAL_HALF_LIFE = 60; // game-minutes
export const CONTAGION_MAX_DISTANCE = 10; // tiles
export const CONTAGION_SCALE = 0.1;
/** Distance from origin below which emotion is omitted from prompts */
export const NEUTRAL_THRESHOLD = 0.15;
/** Contagion weight when no relationship exists */
export const DEFAULT_STRANGER_CLOSENESS = 0.2;

// ─── Emotion Anchors (circumplex label mapping) ──────────────

export const EMOTION_ANCHORS: EmotionAnchor[] = [
  { label: 'excited', valence: 0.8, arousal: 0.7 },
  { label: 'happy', valence: 0.7, arousal: 0.3 },
  { label: 'content', valence: 0.5, arousal: -0.3 },
  { label: 'calm', valence: 0.3, arousal: -0.6 },
  { label: 'bored', valence: -0.2, arousal: -0.6 },
  { label: 'sad', valence: -0.6, arousal: -0.4 },
  { label: 'stressed', valence: -0.5, arousal: 0.5 },
  { label: 'angry', valence: -0.7, arousal: 0.7 },
  { label: 'afraid', valence: -0.6, arousal: 0.8 },
  { label: 'neutral', valence: 0.0, arousal: 0.0 },
];

// ─── Character Emotional Profiles ────────────────────────────

export const CHARACTER_EMOTIONS: Record<string, EmotionalProfile> = {
  Alex: {
    baseline: { valence: 0.15, arousal: 0.05 },
    receptivity: 0.7,
    charisma: 0.5,
  },
  Maya: {
    baseline: { valence: 0.0, arousal: -0.05 },
    receptivity: 0.3,
    charisma: 0.6,
  },
};

export const DEFAULT_EMOTIONAL_PROFILE: EmotionalProfile = {
  baseline: { valence: 0.0, arousal: 0.0 },
  receptivity: 0.5,
  charisma: 0.4,
};

// ─── Conversation Outcome → Emotion Deltas ───────────────────

export const OUTCOME_EMOTION_DELTAS: Record<InteractionOutcome, { valence: number; arousal: number }> = {
  positive_social: { valence: 0.2, arousal: 0.1 },
  negative_social: { valence: -0.3, arousal: 0.2 },
  helpful: { valence: 0.15, arousal: 0.05 },
  betrayal: { valence: -0.5, arousal: 0.4 },
  impressive: { valence: 0.3, arousal: 0.2 },
  neutral: { valence: 0, arousal: 0 },
};
