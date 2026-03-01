/**
 * Opinion Tracking Registry — topics, character defaults, and outcome-delta mappings.
 *
 * Opinions are numeric 0–10 attitudes per abstract topic (not per-person — that's relationships).
 * They inject personality context into LLM conversation prompts.
 */

import { OpinionTopic, AgentOpinion, OpinionDelta, InteractionOutcome, TopicId } from '../registries';

// ─── Constants ───────────────────────────────────────────────

export const OPINION_MIN = 0;
export const OPINION_MAX = 10;
export const OPINION_NEUTRAL = 5;

/** Drift toward neutral per game-hour (~1 point per 50 game-hours) */
export const OPINION_DECAY_RATE_PER_GAME_HOUR = 0.02;

// ─── Topic Registry ──────────────────────────────────────────

export const OPINION_TOPICS: OpinionTopic[] = [
  { id: 'food', name: 'Food', description: 'Cooking, eating, culinary exploration' },
  { id: 'socializing', name: 'Socializing', description: 'Spending time with others, conversation' },
  { id: 'nature', name: 'Nature', description: 'Outdoors, parks, fresh air, natural beauty' },
  { id: 'work', name: 'Work', description: 'Productivity, tasks, professional effort' },
  { id: 'rest', name: 'Rest', description: 'Relaxation, sleep, downtime, recovery' },
];

export const TOPIC_IDS: TopicId[] = OPINION_TOPICS.map((t) => t.id);

// ─── Character Defaults ──────────────────────────────────────

/** Per-character starting opinions — keyed by character name (like MORAL_PROFILES) */
export const CHARACTER_OPINIONS: Record<string, Record<TopicId, number>> = {
  Alex: {
    food: 7,
    socializing: 6,
    nature: 7,
    work: 5,
    rest: 5,
  },
  Maya: {
    food: 5,
    socializing: 8,
    nature: 7,
    work: 3,
    rest: 5,
  },
};

/** Fallback — all neutral */
export const DEFAULT_OPINIONS: Record<TopicId, number> = Object.fromEntries(
  TOPIC_IDS.map((id) => [id, OPINION_NEUTRAL]),
) as Record<TopicId, number>;

// ─── Outcome → Opinion Deltas ────────────────────────────────

/**
 * Maps interaction outcomes to opinion changes.
 * Currently only affects 'socializing' and 'work' topics.
 * food, nature, rest are modified by future action-based opinion updates (Phase 4).
 */
export const OUTCOME_OPINION_DELTAS: Record<InteractionOutcome, OpinionDelta[]> = {
  positive_social: [{ topicId: 'socializing', delta: 0.3 }],
  negative_social: [{ topicId: 'socializing', delta: -0.5 }],
  helpful: [
    { topicId: 'socializing', delta: 0.2 },
    { topicId: 'work', delta: 0.2 },
  ],
  betrayal: [{ topicId: 'socializing', delta: -0.8 }],
  impressive: [{ topicId: 'socializing', delta: 0.4 }],
  neutral: [],
};
