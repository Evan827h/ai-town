import {
  applyOpinionDeltas,
  decayOpinions,
  getOpinionContext,
  initializeOpinions,
} from './opinions';
import {
  CHARACTER_OPINIONS,
  DEFAULT_OPINIONS,
  OPINION_TOPICS,
  OPINION_MIN,
  OPINION_MAX,
  OPINION_NEUTRAL,
  OPINION_DECAY_RATE_PER_GAME_HOUR,
  OUTCOME_OPINION_DELTAS,
} from './data/opinions';
import { AgentOpinion, OpinionDelta } from './registries';

// ─── Helpers ─────────────────────────────────────────────────

function makeOpinion(topicId: string, value: number, lastUpdated = 0): AgentOpinion {
  return { topicId, value, lastUpdated };
}

function makeOpinions(values: Record<string, number>, lastUpdated = 0): AgentOpinion[] {
  return Object.entries(values).map(([topicId, value]) => makeOpinion(topicId, value, lastUpdated));
}

// ─── applyOpinionDeltas ─────────────────────────────────────

describe('applyOpinionDeltas', () => {
  test('applies positive delta', () => {
    const opinions = [makeOpinion('socializing', 5)];
    const deltas: OpinionDelta[] = [{ topicId: 'socializing', delta: 0.3 }];
    const result = applyOpinionDeltas(opinions, deltas, 100);
    expect(result[0].value).toBeCloseTo(5.3);
    expect(result[0].lastUpdated).toBe(100);
  });

  test('applies negative delta', () => {
    const opinions = [makeOpinion('socializing', 5)];
    const deltas: OpinionDelta[] = [{ topicId: 'socializing', delta: -0.5 }];
    const result = applyOpinionDeltas(opinions, deltas, 100);
    expect(result[0].value).toBeCloseTo(4.5);
  });

  test('clamps to max (10)', () => {
    const opinions = [makeOpinion('food', 9.8)];
    const deltas: OpinionDelta[] = [{ topicId: 'food', delta: 0.5 }];
    const result = applyOpinionDeltas(opinions, deltas, 100);
    expect(result[0].value).toBe(OPINION_MAX);
  });

  test('clamps to min (0)', () => {
    const opinions = [makeOpinion('work', 0.2)];
    const deltas: OpinionDelta[] = [{ topicId: 'work', delta: -0.5 }];
    const result = applyOpinionDeltas(opinions, deltas, 100);
    expect(result[0].value).toBe(OPINION_MIN);
  });

  test('empty deltas passes through unchanged', () => {
    const opinions = [makeOpinion('food', 7), makeOpinion('work', 3)];
    const result = applyOpinionDeltas(opinions, [], 100);
    expect(result[0].value).toBe(7);
    expect(result[1].value).toBe(3);
    // lastUpdated should NOT change when no deltas affect the opinion
    expect(result[0].lastUpdated).toBe(0);
  });

  test('unknown topic in delta is ignored', () => {
    const opinions = [makeOpinion('food', 7)];
    const deltas: OpinionDelta[] = [{ topicId: 'nonexistent', delta: 1.0 }];
    const result = applyOpinionDeltas(opinions, deltas, 100);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(7);
  });

  test('multiple deltas for same topic stack', () => {
    const opinions = [makeOpinion('socializing', 5)];
    const deltas: OpinionDelta[] = [
      { topicId: 'socializing', delta: 0.2 },
      { topicId: 'socializing', delta: 0.3 },
    ];
    const result = applyOpinionDeltas(opinions, deltas, 100);
    expect(result[0].value).toBeCloseTo(5.5);
  });

  test('integration with OUTCOME_OPINION_DELTAS', () => {
    const opinions = makeOpinions({ socializing: 5, work: 5 });
    const deltas = OUTCOME_OPINION_DELTAS['helpful']; // socializing +0.2, work +0.2
    const result = applyOpinionDeltas(opinions, deltas, 100);
    const social = result.find((o) => o.topicId === 'socializing')!;
    const work = result.find((o) => o.topicId === 'work')!;
    expect(social.value).toBeCloseTo(5.2);
    expect(work.value).toBeCloseTo(5.2);
  });
});

// ─── decayOpinions ──────────────────────────────────────────

describe('decayOpinions', () => {
  test('above neutral decays toward neutral', () => {
    const opinions = [makeOpinion('food', 8, 0)];
    const elapsed = 60; // 1 game-hour
    const result = decayOpinions(opinions, elapsed, 60);
    expect(result[0].value).toBeLessThan(8);
    expect(result[0].value).toBeGreaterThan(OPINION_NEUTRAL);
  });

  test('below neutral drifts up toward neutral', () => {
    const opinions = [makeOpinion('work', 2, 0)];
    const elapsed = 60; // 1 game-hour
    const result = decayOpinions(opinions, elapsed, 60);
    expect(result[0].value).toBeGreaterThan(2);
    expect(result[0].value).toBeLessThan(OPINION_NEUTRAL);
  });

  test('at neutral stays unchanged', () => {
    const opinions = [makeOpinion('rest', OPINION_NEUTRAL, 0)];
    const result = decayOpinions(opinions, 60, 60);
    expect(result[0].value).toBe(OPINION_NEUTRAL);
  });

  test('does not overshoot neutral', () => {
    // Value very close to neutral — decay should not cross it
    const opinions = [makeOpinion('food', 5.01, 0)];
    const elapsed = 600; // 10 game-hours — more than enough to overshoot
    const result = decayOpinions(opinions, elapsed, 600);
    expect(result[0].value).toBe(OPINION_NEUTRAL);
  });

  test('zero elapsed time leaves unchanged', () => {
    const opinions = [makeOpinion('food', 8, 0)];
    const result = decayOpinions(opinions, 0, 0);
    expect(result[0].value).toBe(8);
  });

  test('updates lastUpdated timestamp', () => {
    const opinions = [makeOpinion('food', 8, 0)];
    const result = decayOpinions(opinions, 60, 500);
    expect(result[0].lastUpdated).toBe(500);
  });
});

// ─── getOpinionContext ──────────────────────────────────────

describe('getOpinionContext', () => {
  test('all-neutral returns empty array', () => {
    const opinions = makeOpinions({ food: 5, socializing: 5, work: 5 });
    expect(getOpinionContext(opinions)).toEqual([]);
  });

  test('strong positive is included', () => {
    const opinions = [makeOpinion('food', 9)];
    const lines = getOpinionContext(opinions);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('very positively');
    expect(lines[0]).toContain('Food');
  });

  test('negative opinion is included', () => {
    const opinions = [makeOpinion('work', 3)];
    const lines = getOpinionContext(opinions);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('negatively');
    expect(lines[0]).toContain('Work');
  });

  test('near-neutral (4.5–6) is skipped', () => {
    const opinions = [makeOpinion('food', 5.5), makeOpinion('work', 4.5)];
    expect(getOpinionContext(opinions)).toEqual([]);
  });

  test('numeric value appears in output', () => {
    const opinions = [makeOpinion('food', 7)];
    const lines = getOpinionContext(opinions);
    expect(lines[0]).toContain('7');
  });

  test('label mapping: 9-10 = very positively', () => {
    expect(getOpinionContext([makeOpinion('food', 10)])[0]).toContain('very positively');
  });

  test('label mapping: 7-8 = positively', () => {
    expect(getOpinionContext([makeOpinion('food', 7)])[0]).toContain('positively');
    expect(getOpinionContext([makeOpinion('food', 7)])[0]).not.toContain('very');
  });

  test('label mapping: 3-4 = negatively', () => {
    expect(getOpinionContext([makeOpinion('work', 3)])[0]).toContain('negatively');
    expect(getOpinionContext([makeOpinion('work', 3)])[0]).not.toContain('very');
  });

  test('label mapping: 0-2 = very negatively', () => {
    expect(getOpinionContext([makeOpinion('work', 1)])[0]).toContain('very negatively');
  });
});

// ─── initializeOpinions ─────────────────────────────────────

describe('initializeOpinions', () => {
  test('Alex defaults', () => {
    const opinions = initializeOpinions(CHARACTER_OPINIONS['Alex'], 100);
    const food = opinions.find((o) => o.topicId === 'food')!;
    expect(food.value).toBe(7);
    expect(food.lastUpdated).toBe(100);
    expect(opinions).toHaveLength(OPINION_TOPICS.length);
  });

  test('Maya defaults', () => {
    const opinions = initializeOpinions(CHARACTER_OPINIONS['Maya'], 100);
    const work = opinions.find((o) => o.topicId === 'work')!;
    expect(work.value).toBe(3);
    const socializing = opinions.find((o) => o.topicId === 'socializing')!;
    expect(socializing.value).toBe(8);
  });

  test('fallback all-neutral', () => {
    const opinions = initializeOpinions(DEFAULT_OPINIONS, 100);
    for (const op of opinions) {
      expect(op.value).toBe(OPINION_NEUTRAL);
    }
    expect(opinions).toHaveLength(OPINION_TOPICS.length);
  });
});
