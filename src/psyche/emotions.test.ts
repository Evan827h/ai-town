import {
  decayEmotion,
  applyEmotionDelta,
  transferEmotion,
  getEmotionLabel,
  getEmotionContext,
  initializeEmotion,
  relationshipToCloseness,
} from './emotions';
import {
  EMOTION_ANCHORS,
  CHARACTER_EMOTIONS,
  DEFAULT_EMOTIONAL_PROFILE,
  EMOTION_MIN,
  EMOTION_MAX,
  VALENCE_HALF_LIFE,
  AROUSAL_HALF_LIFE,
  CONTAGION_MAX_DISTANCE,
  CONTAGION_SCALE,
  NEUTRAL_THRESHOLD,
  DEFAULT_STRANGER_CLOSENESS,
} from './data/emotions';
import { EmotionalState, EmotionalProfile, RelationshipEdge } from './registries';

// ─── Helpers ─────────────────────────────────────────────────

function makeState(valence: number, arousal: number, lastUpdated = 0): EmotionalState {
  return { valence, arousal, lastUpdated };
}

function makeEdge(
  trust: number,
  affinity: number,
  familiarity: number,
  overrides?: Partial<RelationshipEdge>,
): RelationshipEdge {
  return {
    fromAgentId: 'a',
    toAgentId: 'b',
    trust,
    affinity,
    respect: 0,
    frequency: 0,
    familiarity,
    lastInteraction: 0,
    ...overrides,
  };
}

// ─── decayEmotion ────────────────────────────────────────────

describe('decayEmotion', () => {
  const baseline = { valence: 0, arousal: 0 };

  test('positive valence decays toward baseline', () => {
    const state = makeState(0.8, 0, 0);
    const result = decayEmotion(state, VALENCE_HALF_LIFE, baseline);
    // After one half-life, should be halfway to baseline
    expect(result.valence).toBeCloseTo(0.4, 1);
  });

  test('negative valence decays toward baseline', () => {
    const state = makeState(-0.6, 0, 0);
    const result = decayEmotion(state, VALENCE_HALF_LIFE, baseline);
    expect(result.valence).toBeCloseTo(-0.3, 1);
  });

  test('arousal decays faster than valence (60 vs 120 half-life)', () => {
    const state = makeState(0.8, 0.8, 0);
    // After 60 game-minutes: arousal at half-life, valence at half of half-life
    const result = decayEmotion(state, 60, baseline);
    // Arousal: 0.8 * 2^(-60/60) = 0.4
    expect(result.arousal).toBeCloseTo(0.4, 1);
    // Valence: 0.8 * 2^(-60/120) = 0.8 * 0.707 ≈ 0.566
    expect(result.valence).toBeCloseTo(0.566, 1);
    expect(Math.abs(result.arousal)).toBeLessThan(Math.abs(result.valence));
  });

  test('at baseline stays unchanged', () => {
    const state = makeState(0.15, 0.05, 0);
    const result = decayEmotion(state, 100, { valence: 0.15, arousal: 0.05 });
    expect(result.valence).toBeCloseTo(0.15);
    expect(result.arousal).toBeCloseTo(0.05);
  });

  test('zero elapsed leaves state unchanged', () => {
    const state = makeState(0.8, -0.5, 0);
    const result = decayEmotion(state, 0, baseline);
    expect(result.valence).toBe(0.8);
    expect(result.arousal).toBe(-0.5);
  });

  test('does not overshoot baseline', () => {
    const state = makeState(0.01, -0.01, 0);
    const result = decayEmotion(state, 10000, baseline);
    // After massive elapsed time, should converge to baseline, not overshoot
    expect(result.valence).toBeCloseTo(0, 5);
    expect(result.arousal).toBeCloseTo(0, 5);
  });

  test('updates lastUpdated', () => {
    const state = makeState(0.5, 0.5, 100);
    const result = decayEmotion(state, 60, baseline);
    // lastUpdated should advance by elapsed time
    expect(result.lastUpdated).toBe(160);
  });
});

// ─── applyEmotionDelta ──────────────────────────────────────

describe('applyEmotionDelta', () => {
  test('positive valence delta', () => {
    const state = makeState(0.3, 0, 0);
    const result = applyEmotionDelta(state, { valence: 0.2, arousal: 0 }, 100);
    expect(result.valence).toBeCloseTo(0.5);
    expect(result.arousal).toBe(0);
  });

  test('negative arousal delta', () => {
    const state = makeState(0, 0.5, 0);
    const result = applyEmotionDelta(state, { valence: 0, arousal: -0.3 }, 100);
    expect(result.arousal).toBeCloseTo(0.2);
  });

  test('clamping to max (+1)', () => {
    const state = makeState(0.9, 0.8, 0);
    const result = applyEmotionDelta(state, { valence: 0.5, arousal: 0.5 }, 100);
    expect(result.valence).toBe(EMOTION_MAX);
    expect(result.arousal).toBe(EMOTION_MAX);
  });

  test('clamping to min (-1)', () => {
    const state = makeState(-0.8, -0.9, 0);
    const result = applyEmotionDelta(state, { valence: -0.5, arousal: -0.5 }, 100);
    expect(result.valence).toBe(EMOTION_MIN);
    expect(result.arousal).toBe(EMOTION_MIN);
  });

  test('zero delta passthrough', () => {
    const state = makeState(0.5, -0.3, 0);
    const result = applyEmotionDelta(state, { valence: 0, arousal: 0 }, 100);
    expect(result.valence).toBe(0.5);
    expect(result.arousal).toBe(-0.3);
  });

  test('updates lastUpdated', () => {
    const state = makeState(0, 0, 50);
    const result = applyEmotionDelta(state, { valence: 0.1, arousal: 0.1 }, 200);
    expect(result.lastUpdated).toBe(200);
  });
});

// ─── transferEmotion ─────────────────────────────────────────

describe('transferEmotion', () => {
  const defaultProfile: EmotionalProfile = {
    baseline: { valence: 0, arousal: 0 },
    receptivity: 0.5,
    charisma: 0.5,
  };

  test('returns zeros when distance > max', () => {
    const sender = makeState(0.8, 0.5, 0);
    const receiver = makeState(0, 0, 0);
    const result = transferEmotion(sender, receiver, CONTAGION_MAX_DISTANCE + 1, 0.5, defaultProfile);
    expect(result.dValence).toBe(0);
    expect(result.dArousal).toBe(0);
  });

  test('closer distance = stronger transfer', () => {
    const sender = makeState(0.8, 0, 0);
    const receiver = makeState(0, 0, 0);
    const close = transferEmotion(sender, receiver, 2, 0.5, defaultProfile);
    const far = transferEmotion(sender, receiver, 8, 0.5, defaultProfile);
    expect(Math.abs(close.dValence)).toBeGreaterThan(Math.abs(far.dValence));
  });

  test('higher closeness = stronger transfer', () => {
    const sender = makeState(0.8, 0, 0);
    const receiver = makeState(0, 0, 0);
    const highClose = transferEmotion(sender, receiver, 5, 0.8, defaultProfile);
    const lowClose = transferEmotion(sender, receiver, 5, 0.2, defaultProfile);
    expect(Math.abs(highClose.dValence)).toBeGreaterThan(Math.abs(lowClose.dValence));
  });

  test('higher receptivity = stronger transfer', () => {
    const sender = makeState(0.8, 0, 0);
    const receiver = makeState(0, 0, 0);
    const highRecep: EmotionalProfile = { ...defaultProfile, receptivity: 0.9 };
    const lowRecep: EmotionalProfile = { ...defaultProfile, receptivity: 0.1 };
    const high = transferEmotion(sender, receiver, 5, 0.5, highRecep);
    const low = transferEmotion(sender, receiver, 5, 0.5, lowRecep);
    expect(Math.abs(high.dValence)).toBeGreaterThan(Math.abs(low.dValence));
  });

  test('higher charisma = stronger transfer', () => {
    const sender = makeState(0.8, 0, 0);
    const receiver = makeState(0, 0, 0);
    const highChar: EmotionalProfile = { ...defaultProfile, charisma: 0.9 };
    const lowChar: EmotionalProfile = { ...defaultProfile, charisma: 0.1 };
    const high = transferEmotion(sender, receiver, 5, 0.5, highChar);
    const low = transferEmotion(sender, receiver, 5, 0.5, lowChar);
    expect(Math.abs(high.dValence)).toBeGreaterThan(Math.abs(low.dValence));
  });

  test('pulls receiver toward sender (direction correct)', () => {
    const sender = makeState(0.8, -0.5, 0);
    const receiver = makeState(-0.2, 0.3, 0);
    const result = transferEmotion(sender, receiver, 3, 0.5, defaultProfile);
    // Sender valence > receiver → dValence should be positive
    expect(result.dValence).toBeGreaterThan(0);
    // Sender arousal < receiver → dArousal should be negative
    expect(result.dArousal).toBeLessThan(0);
  });

  test('already-equal states produce zero delta', () => {
    const state = makeState(0.5, -0.3, 0);
    const result = transferEmotion(state, makeState(0.5, -0.3, 0), 3, 0.5, defaultProfile);
    expect(result.dValence).toBe(0);
    expect(result.dArousal).toBe(0);
  });
});

// ─── getEmotionLabel ─────────────────────────────────────────

describe('getEmotionLabel', () => {
  test('positive valence high arousal → "excited"', () => {
    const result = getEmotionLabel(makeState(0.7, 0.6, 0));
    expect(result.label).toBe('excited');
  });

  test('negative valence high arousal → "angry" or "afraid"', () => {
    const result = getEmotionLabel(makeState(-0.7, 0.7, 0));
    expect(['angry', 'afraid']).toContain(result.label);
  });

  test('near-origin → "neutral"', () => {
    const result = getEmotionLabel(makeState(0.05, -0.03, 0));
    expect(result.label).toBe('neutral');
  });
});

// ─── getEmotionContext ───────────────────────────────────────

describe('getEmotionContext', () => {
  test('near-neutral returns empty string', () => {
    const result = getEmotionContext(makeState(0.05, 0.05, 0));
    expect(result).toBe('');
  });

  test('strong positive returns "very" prefix', () => {
    const result = getEmotionContext(makeState(0.8, 0.7, 0));
    expect(result).toContain('very');
    expect(result).toContain('excited');
  });

  test('moderate emotion returns label without "very" or "slightly"', () => {
    const state = makeState(0.5, -0.3, 0); // content region, distance ~0.58
    const result = getEmotionContext(state);
    expect(result).not.toBe('');
    expect(result).not.toContain('very');
    expect(result).not.toContain('slightly');
  });

  test('slight emotion returns "slightly" prefix', () => {
    // Slight happy: small positive valence, small positive arousal — distance ~0.2-0.3
    const state = makeState(0.2, 0.1, 0);
    const result = getEmotionContext(state);
    expect(result).toContain('slightly');
  });

  test('contains the emotion label word', () => {
    const result = getEmotionContext(makeState(-0.6, -0.4, 0));
    expect(result).toContain('sad');
  });
});

// ─── initializeEmotion ───────────────────────────────────────

describe('initializeEmotion', () => {
  test('Alex profile produces correct baseline', () => {
    const profile = CHARACTER_EMOTIONS['Alex'];
    const result = initializeEmotion(profile, 1000);
    expect(result.valence).toBe(0.15);
    expect(result.arousal).toBe(0.05);
    expect(result.lastUpdated).toBe(1000);
  });

  test('default profile produces (0, 0)', () => {
    const result = initializeEmotion(DEFAULT_EMOTIONAL_PROFILE, 500);
    expect(result.valence).toBe(0);
    expect(result.arousal).toBe(0);
    expect(result.lastUpdated).toBe(500);
  });
});

// ─── relationshipToCloseness ─────────────────────────────────

describe('relationshipToCloseness', () => {
  test('all-zero relationship → 0.333 (trust/affinity at midpoint, familiarity at 0)', () => {
    const edge = makeEdge(0, 0, 0);
    const result = relationshipToCloseness(edge);
    // trust: 0 maps to 0.5, affinity: 0 maps to 0.5, familiarity: 0 maps to 0.0
    // (0.5 + 0.5 + 0.0) / 3 = 0.333
    expect(result).toBeCloseTo(0.333, 2);
  });

  test('maxed-out relationship → high closeness', () => {
    const edge = makeEdge(100, 100, 100);
    const result = relationshipToCloseness(edge);
    // trust: 100 → 1.0, affinity: 100 → 1.0, familiarity: 100 → 1.0
    expect(result).toBeCloseTo(1.0);
  });

  test('null edge → DEFAULT_STRANGER_CLOSENESS', () => {
    const result = relationshipToCloseness(null);
    expect(result).toBe(DEFAULT_STRANGER_CLOSENESS);
  });
});
