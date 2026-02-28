import {
  initializeRelationship,
  updateRelationship,
  decayFrequency,
  applyRelationshipModifiers,
  conversationPreferenceScore,
  parseConversationOutcome,
} from './relationships';
import { RelationshipEdge, SocialDisposition, ScoredAction, ActionDefinition } from './registries';
import { OUTCOME_DELTAS } from './data/relationships';

// ─── Test Helpers ────────────────────────────────────────────

const alexDisposition: SocialDisposition = { defaultTrust: 15, defaultAffinity: 5, defaultRespect: 0 };
const mayaDisposition: SocialDisposition = { defaultTrust: -5, defaultAffinity: 10, defaultRespect: 5 };

function makeEdge(overrides: Partial<RelationshipEdge> = {}): RelationshipEdge {
  return {
    fromAgentId: 'agent1',
    toAgentId: 'agent2',
    trust: 0,
    affinity: 0,
    respect: 0,
    frequency: 50,
    familiarity: 20,
    lastInteraction: 0,
    ...overrides,
  };
}

function makeSocialAction(id: string, score: number, socialWeights: ActionDefinition['socialWeights']): ScoredAction {
  return {
    action: {
      id,
      name: id,
      description: id,
      emoji: '',
      duration: 20,
      replenishes: [],
      costs: [],
      socialWeights,
    },
    score,
  };
}

function makeNonSocialAction(id: string, score: number): ScoredAction {
  return {
    action: {
      id,
      name: id,
      description: id,
      emoji: '',
      duration: 20,
      replenishes: [],
      costs: [],
    },
    score,
  };
}

// ─── initializeRelationship ──────────────────────────────────

describe('initializeRelationship', () => {
  test('uses disposition defaults for trust/affinity/respect', () => {
    const edge = initializeRelationship(alexDisposition, 'alex', 'maya', 100);

    expect(edge.trust).toBe(15);
    expect(edge.affinity).toBe(5);
    expect(edge.respect).toBe(0);
  });

  test('starts frequency and familiarity at 0', () => {
    const edge = initializeRelationship(alexDisposition, 'alex', 'maya', 100);

    expect(edge.frequency).toBe(0);
    expect(edge.familiarity).toBe(0);
  });

  test('sets agent IDs and lastInteraction', () => {
    const edge = initializeRelationship(mayaDisposition, 'maya', 'alex', 42);

    expect(edge.fromAgentId).toBe('maya');
    expect(edge.toAgentId).toBe('alex');
    expect(edge.lastInteraction).toBe(42);
  });

  test('clamps extreme disposition values', () => {
    const extreme: SocialDisposition = { defaultTrust: 200, defaultAffinity: -300, defaultRespect: 150 };
    const edge = initializeRelationship(extreme, 'a', 'b', 0);

    expect(edge.trust).toBe(100);
    expect(edge.affinity).toBe(-100);
    expect(edge.respect).toBe(100);
  });
});

// ─── updateRelationship ──────────────────────────────────────

describe('updateRelationship', () => {
  test('applies positive_social deltas correctly', () => {
    const edge = makeEdge({ trust: 10, affinity: 20, frequency: 30, familiarity: 10 });
    const updated = updateRelationship(edge, 'positive_social', 100);
    const d = OUTCOME_DELTAS.positive_social;

    expect(updated.trust).toBe(10 + d.trust);
    expect(updated.affinity).toBe(20 + d.affinity);
    expect(updated.frequency).toBe(30 + d.frequency);
    expect(updated.familiarity).toBe(10 + d.familiarity);
    expect(updated.lastInteraction).toBe(100);
  });

  test('applies betrayal deltas correctly', () => {
    const edge = makeEdge({ trust: 50, affinity: 30, respect: 40 });
    const updated = updateRelationship(edge, 'betrayal', 200);
    const d = OUTCOME_DELTAS.betrayal;

    expect(updated.trust).toBe(50 + d.trust);
    expect(updated.affinity).toBe(30 + d.affinity);
    expect(updated.respect).toBe(40 + d.respect);
  });

  test('clamps trust to -100..100', () => {
    const highTrust = makeEdge({ trust: 95 });
    const boosted = updateRelationship(highTrust, 'helpful', 0);
    expect(boosted.trust).toBeLessThanOrEqual(100);

    const lowTrust = makeEdge({ trust: -90 });
    const tanked = updateRelationship(lowTrust, 'betrayal', 0);
    expect(tanked.trust).toBeGreaterThanOrEqual(-100);
  });

  test('clamps affinity to -100..100', () => {
    const high = makeEdge({ affinity: 98 });
    const updated = updateRelationship(high, 'impressive', 0);
    expect(updated.affinity).toBeLessThanOrEqual(100);
  });

  test('clamps frequency to 0..100', () => {
    const high = makeEdge({ frequency: 95 });
    const updated = updateRelationship(high, 'positive_social', 0);
    expect(updated.frequency).toBeLessThanOrEqual(100);
  });

  test('familiarity never decreases', () => {
    const edge = makeEdge({ familiarity: 50 });
    for (const outcome of Object.keys(OUTCOME_DELTAS) as (keyof typeof OUTCOME_DELTAS)[]) {
      const updated = updateRelationship(edge, outcome, 0);
      expect(updated.familiarity).toBeGreaterThanOrEqual(edge.familiarity);
    }
  });

  test('neutral outcome changes only frequency and familiarity', () => {
    const edge = makeEdge({ trust: 30, affinity: 40, respect: 20, frequency: 10, familiarity: 5 });
    const updated = updateRelationship(edge, 'neutral', 50);

    expect(updated.trust).toBe(30);
    expect(updated.affinity).toBe(40);
    expect(updated.respect).toBe(20);
    expect(updated.frequency).toBe(10 + OUTCOME_DELTAS.neutral.frequency);
    expect(updated.familiarity).toBe(5 + OUTCOME_DELTAS.neutral.familiarity);
  });
});

// ─── decayFrequency ──────────────────────────────────────────

describe('decayFrequency', () => {
  test('reduces frequency based on elapsed time', () => {
    const edge = makeEdge({ frequency: 50 });
    const decayed = decayFrequency(edge, 120);
    expect(decayed.frequency).toBe(49);
  });

  test('does not go below 0', () => {
    const edge = makeEdge({ frequency: 1 });
    const decayed = decayFrequency(edge, 6000);
    expect(decayed.frequency).toBe(0);
  });

  test('zero elapsed time means no change', () => {
    const edge = makeEdge({ frequency: 75 });
    const decayed = decayFrequency(edge, 0);
    expect(decayed.frequency).toBe(75);
  });

  test('does not affect other dimensions', () => {
    const edge = makeEdge({ trust: 30, affinity: 40, frequency: 50 });
    const decayed = decayFrequency(edge, 120);
    expect(decayed.trust).toBe(30);
    expect(decayed.affinity).toBe(40);
  });
});

// ─── applyRelationshipModifiers ──────────────────────────────

describe('applyRelationshipModifiers', () => {
  test('boosts social actions when relationship is positive', () => {
    const actions = [makeSocialAction('chat', 100, { affinity: 0.5, trust: 0.5 })];
    const edges = [makeEdge({ affinity: 80, trust: 60 })];
    const modified = applyRelationshipModifiers(actions, edges, ['agent2']);
    expect(modified[0].score).toBeGreaterThan(100);
  });

  test('reduces social actions when relationship is negative', () => {
    const actions = [makeSocialAction('chat', 100, { affinity: 0.5, trust: 0.5 })];
    const edges = [makeEdge({ affinity: -80, trust: -60 })];
    const modified = applyRelationshipModifiers(actions, edges, ['agent2']);
    expect(modified[0].score).toBeLessThan(100);
  });

  test('does not modify non-social actions', () => {
    const actions = [makeNonSocialAction('sleep', 100)];
    const edges = [makeEdge({ affinity: 100, trust: 100 })];
    const modified = applyRelationshipModifiers(actions, edges, ['agent2']);
    expect(modified[0].score).toBe(100);
  });

  test('returns unchanged when no nearby agents', () => {
    const actions = [makeSocialAction('chat', 100, { affinity: 1.0 })];
    const edges = [makeEdge({ affinity: 100 })];
    const modified = applyRelationshipModifiers(actions, edges, []);
    expect(modified[0].score).toBe(100);
  });

  test('returns unchanged when no relationships', () => {
    const actions = [makeSocialAction('chat', 100, { affinity: 1.0 })];
    const modified = applyRelationshipModifiers(actions, [], ['agent2']);
    expect(modified[0].score).toBe(100);
  });

  test('per-dimension weights produce expected relative scores', () => {
    const edges = [makeEdge({ affinity: 80, trust: 20 })];
    const affinityWeighted = makeSocialAction('a', 100, { affinity: 1.0 });
    const trustWeighted = makeSocialAction('b', 100, { trust: 1.0 });
    const [modA] = applyRelationshipModifiers([affinityWeighted], edges, ['agent2']);
    const [modB] = applyRelationshipModifiers([trustWeighted], edges, ['agent2']);
    expect(modA.score).toBeGreaterThan(modB.score);
  });

  test('averages across multiple nearby agents', () => {
    const actions = [makeSocialAction('chat', 100, { affinity: 1.0 })];
    const edges = [
      makeEdge({ toAgentId: 'a2', affinity: 100 }),
      makeEdge({ toAgentId: 'a3', affinity: -100 }),
    ];
    const modified = applyRelationshipModifiers(actions, edges, ['a2', 'a3']);
    expect(modified[0].score).toBeCloseTo(100, 0);
  });
});

// ─── conversationPreferenceScore ─────────────────────────────

describe('conversationPreferenceScore', () => {
  test('higher affinity produces higher score', () => {
    const friend = makeEdge({ affinity: 80, frequency: 50 });
    const stranger = makeEdge({ affinity: 0, frequency: 50 });
    expect(conversationPreferenceScore(friend, 0)).toBeGreaterThan(
      conversationPreferenceScore(stranger, 0),
    );
  });

  test('higher frequency produces higher score', () => {
    const frequent = makeEdge({ affinity: 30, frequency: 80 });
    const infrequent = makeEdge({ affinity: 30, frequency: 10 });
    expect(conversationPreferenceScore(frequent, 0)).toBeGreaterThan(
      conversationPreferenceScore(infrequent, 0),
    );
  });

  test('returns value in 0..1 range', () => {
    const best = makeEdge({ affinity: 100, frequency: 100 });
    const worst = makeEdge({ affinity: -100, frequency: 0 });
    const bestScore = conversationPreferenceScore(best, 0);
    const worstScore = conversationPreferenceScore(worst, 0);
    expect(bestScore).toBeGreaterThanOrEqual(0);
    expect(bestScore).toBeLessThanOrEqual(1);
    expect(worstScore).toBeGreaterThanOrEqual(0);
    expect(worstScore).toBeLessThanOrEqual(1);
  });

  test('frequency decays with elapsed time', () => {
    const edge = makeEdge({ affinity: 30, frequency: 80 });
    const recent = conversationPreferenceScore(edge, 0);
    const stale = conversationPreferenceScore(edge, 600);
    expect(recent).toBeGreaterThan(stale);
  });
});

// ─── parseConversationOutcome ───────────────────────────────

describe('parseConversationOutcome', () => {
  test('extracts valid outcome and strips label from text', () => {
    const input = 'We had a great chat about gardening.\nOUTCOME: positive_social';
    const result = parseConversationOutcome(input);
    expect(result.outcome).toBe('positive_social');
    expect(result.cleanText).toBe('We had a great chat about gardening.');
    expect(result.cleanText).not.toContain('OUTCOME');
  });

  test('parses all valid outcome types', () => {
    const outcomes = ['positive_social', 'negative_social', 'helpful', 'betrayal', 'impressive', 'neutral'];
    for (const outcome of outcomes) {
      const result = parseConversationOutcome(`Summary text.\nOUTCOME: ${outcome}`);
      expect(result.outcome).toBe(outcome);
    }
  });

  test('falls back to positive_social when no OUTCOME line present', () => {
    const input = 'We talked about the weather. I enjoyed it.';
    const result = parseConversationOutcome(input);
    expect(result.outcome).toBe('positive_social');
    expect(result.cleanText).toBe(input);
  });

  test('falls back to positive_social for invalid outcome value', () => {
    const input = 'Summary.\nOUTCOME: hostile_takeover';
    const result = parseConversationOutcome(input);
    expect(result.outcome).toBe('positive_social');
    expect(result.cleanText).toBe(input.trim());
  });

  test('handles case-insensitive OUTCOME label', () => {
    const input = 'We argued.\noutcome: negative_social';
    const result = parseConversationOutcome(input);
    expect(result.outcome).toBe('negative_social');
    expect(result.cleanText).toBe('We argued.');
  });

  test('handles trailing whitespace after outcome', () => {
    const input = 'Good chat.\nOUTCOME: helpful   ';
    const result = parseConversationOutcome(input);
    expect(result.outcome).toBe('helpful');
    expect(result.cleanText).toBe('Good chat.');
  });

  test('handles empty input', () => {
    const result = parseConversationOutcome('');
    expect(result.outcome).toBe('positive_social');
    expect(result.cleanText).toBe('');
  });
});
