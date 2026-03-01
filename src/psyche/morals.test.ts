import { applyMoralFilter } from './morals';
import { MORAL_PROFILES, DEFAULT_MORAL_PROFILE } from './data/morals';
import { MoralTag, MoralValueId, ScoredAction } from './registries';

// Helper to build a minimal ScoredAction
function makeAction(
  id: string,
  score: number,
  moralCosts: MoralTag[] = [],
): ScoredAction {
  return {
    score,
    action: {
      id,
      name: id,
      description: '',
      emoji: '❓',
      duration: 10,
      replenishes: [],
      costs: [],
      moralCosts,
    },
  };
}

describe('applyMoralFilter', () => {
  describe('passthrough — no moral costs', () => {
    test('returns actions unchanged when none have moralCosts', () => {
      const actions = [makeAction('eat', 80), makeAction('sleep', 60)];
      const { actions: filtered, conflicts } = applyMoralFilter(actions, MORAL_PROFILES['Alex']);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].score).toBe(80);
      expect(conflicts).toHaveLength(0);
    });

    test('returns empty array unchanged', () => {
      const { actions: filtered } = applyMoralFilter([], MORAL_PROFILES['Alex']);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('soft penalty', () => {
    test('reduces score proportionally to penalty', () => {
      // Alex honesty weight = 0.6, severity = 0.5 → effectiveSeverity = 0.3
      // score × (1 - 0.3) = 100 × 0.7 = 70
      const actions = [makeAction('gossip', 100, [{ moralValueId: 'honesty', severity: 0.5 }])];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Alex']);
      expect(filtered[0].score).toBeCloseTo(70, 1);
    });

    test('multiple moral costs stack additively', () => {
      // Alex: honesty 0.6×0.4=0.24, fairness 0.5×0.3=0.15 → total 0.39
      // score × (1 - 0.39) = 100 × 0.61 = 61
      const actions = [
        makeAction('bad_deed', 100, [
          { moralValueId: 'honesty', severity: 0.4 },
          { moralValueId: 'fairness', severity: 0.3 },
        ]),
      ];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Alex']);
      expect(filtered[0].score).toBeCloseTo(61, 1);
    });

    test('unknown moral value treated as zero weight (no effect)', () => {
      const actions = [makeAction('weird_act', 100, [{ moralValueId: 'nonexistent_value' as MoralValueId, severity: 0.9 }])];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Alex']);
      expect(filtered[0].score).toBe(100);
    });
  });

  describe('hard veto', () => {
    test('removes action when effectiveSeverity meets hardVetoThreshold', () => {
      // Maya honesty weight = 0.9, severity = 0.9 → 0.81 >= Maya's 0.80 threshold → vetoed
      const actions = [
        makeAction('blatant_lie', 200, [{ moralValueId: 'honesty', severity: 0.9 }]),
        makeAction('truth', 50),
      ];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Maya']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].action.id).toBe('truth');
    });

    test('does not veto when effectiveSeverity is below threshold', () => {
      // Alex honesty weight = 0.6, severity = 0.9 → 0.54 < Alex's 0.85 threshold → not vetoed
      const actions = [makeAction('mild_lie', 100, [{ moralValueId: 'honesty', severity: 0.9 }])];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Alex']);
      expect(filtered).toHaveLength(1);
    });

    test('vetoes on first cost that meets threshold, ignores remaining', () => {
      // Maya: honesty 0.95 × 0.9 = 0.855 >= 0.80 → veto immediately
      const actions = [
        makeAction('terrible_act', 100, [
          { moralValueId: 'honesty', severity: 0.95 },
          { moralValueId: 'loyalty', severity: 0.1 },
        ]),
      ];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Maya']);
      expect(filtered).toHaveLength(0);
    });

    test('non-vetoed actions remain when only some are vetoed', () => {
      // Maya: honesty 0.95 × 0.9 = 0.855 >= 0.80 → lie vetoed
      // Maya: fairness 1.0 × 0.7 = 0.70 < 0.80 → cheat not vetoed
      const actions = [
        makeAction('lie', 100, [{ moralValueId: 'honesty', severity: 0.95 }]),
        makeAction('cheat', 80, [{ moralValueId: 'fairness', severity: 1.0 }]),
      ];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Maya']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].action.id).toBe('cheat');
    });
  });

  describe('conflict detection', () => {
    test('flags conflict when totalPenalty exceeds conflictThreshold', () => {
      // Maya conflict threshold = 0.35
      // honesty weight 0.9 × severity 0.5 = 0.45 > 0.35 → conflict
      const actions = [makeAction('gossip', 100, [{ moralValueId: 'honesty', severity: 0.5 }])];
      const { conflicts } = applyMoralFilter(actions, MORAL_PROFILES['Maya']);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].actionId).toBe('gossip');
      expect(conflicts[0].values).toContain('honesty');
    });

    test('does not flag conflict when penalty is below threshold', () => {
      // Alex conflict threshold = 0.40
      // honesty weight 0.6 × severity 0.3 = 0.18 < 0.40 → no conflict
      const actions = [makeAction('small_fib', 100, [{ moralValueId: 'honesty', severity: 0.3 }])];
      const { conflicts } = applyMoralFilter(actions, MORAL_PROFILES['Alex']);
      expect(conflicts).toHaveLength(0);
    });

    test('vetoed actions are not included in conflicts', () => {
      // Maya: severity 0.95 × 0.9 = 0.855 → vetoed, should not appear in conflicts
      const actions = [makeAction('blatant_lie', 100, [{ moralValueId: 'honesty', severity: 0.95 }])];
      const { actions: filtered, conflicts } = applyMoralFilter(actions, MORAL_PROFILES['Maya']);
      expect(filtered).toHaveLength(0);
      expect(conflicts).toHaveLength(0);
    });

    test('conflict record includes penalty value and violated values list', () => {
      const actions = [makeAction('gossip', 100, [{ moralValueId: 'honesty', severity: 0.5 }])];
      const { conflicts } = applyMoralFilter(actions, MORAL_PROFILES['Maya']);
      expect(conflicts[0].penalty).toBeCloseTo(0.45, 2);
      expect(conflicts[0].values).toEqual(['honesty']);
    });

    test('conflict values includes all contributing costs even if each is small', () => {
      // strictProfile has a very low conflictThreshold (0.05) so that the sum of two small
      // effectiveSeverities triggers a conflict even though each individual value is well
      // below the old 0.1 cutoff that was previously used to gate violatedValues.
      //
      // honesty:  0.5 × 0.07 = 0.035
      // loyalty:  0.5 × 0.05 = 0.025
      // total:    0.06  > conflictThreshold 0.05  → conflict
      // both effectiveSeverities (0.035, 0.025) are below the old 0.1 threshold,
      // so with the old code `values` would be [] — the bug.
      const strictProfile = {
        weights: {
          honesty: 0.5,
          loyalty: 0.5,
          fairness: 0,
          care: 0,
          authority: 0,
          liberty: 0,
          tradition: 0,
        } as Record<MoralValueId, number>,
        hardVetoThreshold: 0.9,
        conflictThreshold: 0.05,
      };
      const actions = [
        makeAction('act', 100, [
          { moralValueId: 'honesty', severity: 0.07 },
          { moralValueId: 'loyalty', severity: 0.05 },
        ]),
      ];
      const { conflicts } = applyMoralFilter(actions, strictProfile);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].values).toContain('honesty');
      expect(conflicts[0].values).toContain('loyalty');
    });
  });

  describe('penalty clamping', () => {
    test('clamps totalPenalty so adjusted score never goes negative', () => {
      // Profile where both honesty and loyalty have weight 0.7
      // Two moral costs each with severity 0.8
      // effectiveSeverity = 0.8 × 0.7 = 0.56 each (below hardVeto 0.85)
      // totalPenalty = 0.56 + 0.56 = 1.12 (exceeds 1.0)
      // Without clamp: score × (1 - 1.12) = 100 × -0.12 = -12 (negative!)
      // With clamp: score × max(0, 1 - 1.12) = 100 × 0 = 0
      const heavyMoralProfile = {
        weights: {
          honesty: 0.7,
          loyalty: 0.7,
          fairness: 0,
          care: 0,
          authority: 0,
          liberty: 0,
          tradition: 0,
        } as Record<MoralValueId, number>,
        hardVetoThreshold: 0.85,
        conflictThreshold: 0.40,
      };
      const actions = [
        makeAction('double_bad', 100, [
          { moralValueId: 'honesty', severity: 0.8 },
          { moralValueId: 'loyalty', severity: 0.8 },
        ]),
      ];
      const { actions: filtered } = applyMoralFilter(actions, heavyMoralProfile);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].score).toBe(0);
      expect(filtered[0].score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('output ordering', () => {
    test('returns actions sorted by adjusted score descending', () => {
      // Alex honesty weight 0.6, gossip severity 0.6 → effectiveSeverity 0.36, score 100×0.64=64
      // eat: 80, no penalty
      // wander: 40, no penalty
      const actions = [
        makeAction('gossip', 100, [{ moralValueId: 'honesty', severity: 0.6 }]),
        makeAction('eat', 80),
        makeAction('wander', 40),
      ];
      const { actions: filtered } = applyMoralFilter(actions, MORAL_PROFILES['Alex']);
      expect(filtered[0].action.id).toBe('eat');    // 80
      expect(filtered[1].action.id).toBe('gossip'); // 64
      expect(filtered[2].action.id).toBe('wander'); // 40
    });
  });

  describe('default profile', () => {
    test('default profile has high veto threshold (permissive)', () => {
      // DEFAULT_MORAL_PROFILE hardVetoThreshold = 0.90
      // severity 0.9 × default honesty 0.5 = 0.45 < 0.90 → not vetoed
      const actions = [makeAction('lie', 100, [{ moralValueId: 'honesty', severity: 0.9 }])];
      const { actions: filtered } = applyMoralFilter(actions, DEFAULT_MORAL_PROFILE);
      expect(filtered).toHaveLength(1);
    });
  });
});
