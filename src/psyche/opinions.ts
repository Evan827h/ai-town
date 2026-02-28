/**
 * Opinion Tracking — pure functions for managing agent opinions.
 *
 * Opinions are 0–10 numeric attitudes on abstract topics. They don't affect
 * action scoring (that's Phase 4). They inject personality context into
 * LLM conversation prompts.
 */

import { AgentOpinion, OpinionDelta } from './registries';
import {
  OPINION_MIN,
  OPINION_MAX,
  OPINION_NEUTRAL,
  OPINION_DECAY_RATE_PER_GAME_HOUR,
  OPINION_TOPICS,
  TOPIC_IDS,
} from './data/opinions';

/**
 * Apply opinion deltas after a conversation. Clamps to [0, 10].
 * Only opinions matching a delta's topicId are updated; unknown topics are ignored.
 */
export function applyOpinionDeltas(
  opinions: AgentOpinion[],
  deltas: OpinionDelta[],
  gameTime: number,
): AgentOpinion[] {
  // Build a map of total deltas per topic
  const deltaMap = new Map<string, number>();
  for (const d of deltas) {
    deltaMap.set(d.topicId, (deltaMap.get(d.topicId) ?? 0) + d.delta);
  }

  return opinions.map((op) => {
    const totalDelta = deltaMap.get(op.topicId);
    if (totalDelta === undefined) return op;

    const newValue = Math.max(OPINION_MIN, Math.min(OPINION_MAX, op.value + totalDelta));
    return { ...op, value: newValue, lastUpdated: gameTime };
  });
}

/**
 * Decay opinions toward neutral (5.0) over time.
 * Rate: OPINION_DECAY_RATE_PER_GAME_HOUR per game-hour elapsed.
 */
export function decayOpinions(
  opinions: AgentOpinion[],
  elapsedGameMinutes: number,
  gameTime: number,
): AgentOpinion[] {
  if (elapsedGameMinutes <= 0) return opinions;

  const elapsedHours = elapsedGameMinutes / 60;
  const maxDrift = OPINION_DECAY_RATE_PER_GAME_HOUR * elapsedHours;

  return opinions.map((op) => {
    const diff = op.value - OPINION_NEUTRAL;
    if (diff === 0) return { ...op, lastUpdated: gameTime };

    // Drift toward neutral, but don't overshoot
    const drift = Math.sign(diff) * Math.min(Math.abs(diff), maxDrift);
    return { ...op, value: op.value - drift, lastUpdated: gameTime };
  });
}

/**
 * Convert opinions to prompt-friendly lines for LLM context injection.
 * Near-neutral opinions (4.5–6) are omitted to reduce noise.
 */
export function getOpinionContext(opinions: AgentOpinion[]): string[] {
  const lines: string[] = [];

  for (const op of opinions) {
    const label = getAttitudeLabel(op.value);
    if (!label) continue; // near-neutral — skip

    const topic = OPINION_TOPICS.find((t) => t.id === op.topicId);
    const topicName = topic?.name ?? op.topicId;
    const rounded = Math.round(op.value);

    lines.push(`You feel ${label} about ${topicName} (${rounded}/10).`);
  }

  return lines;
}

/**
 * Initialize opinions from a character defaults map.
 * Creates one AgentOpinion per registered topic.
 */
export function initializeOpinions(
  defaults: Record<string, number>,
  gameTime: number,
): AgentOpinion[] {
  return TOPIC_IDS.map((topicId) => ({
    topicId,
    value: defaults[topicId] ?? OPINION_NEUTRAL,
    lastUpdated: gameTime,
  }));
}

// ─── Internal helpers ────────────────────────────────────────

function getAttitudeLabel(value: number): string | null {
  if (value >= 9) return 'very positively';
  if (value >= 7) return 'positively';
  if (value <= 2) return 'very negatively';
  if (value <= 4) return 'negatively';
  // 4.5–6 range: near-neutral, omit
  return null;
}
