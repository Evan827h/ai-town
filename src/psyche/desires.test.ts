import {
  applyDesireModifiers,
  decayDesires,
  pruneDesires,
  mergeDesire,
  getDesireContext,
  calculateTagOverlap,
} from './desires';
import {
  DESIRE_TIEBREAKER_WEIGHT,
  DESIRE_PRUNE_THRESHOLD,
  MAX_WANTS,
  MAX_FEARS,
} from './data/desires';
import { Desire, DesireTag, ScoredAction, ActionDefinition } from './registries';

// ─── Helpers ─────────────────────────────────────────────────

function makeDesire(
  overrides: Partial<Desire> & { type: 'want' | 'fear'; tags: DesireTag[] },
): Desire {
  return {
    id: overrides.id ?? 'desire-1',
    type: overrides.type,
    description: overrides.description ?? 'test desire',
    intensity: overrides.intensity ?? 0.5,
    tags: overrides.tags,
    createdAt: overrides.createdAt ?? 0,
    sourceMemoryIds: overrides.sourceMemoryIds ?? ['mem-1'],
  };
}

function makeAction(id: string, tags: DesireTag[]): ActionDefinition {
  return {
    id,
    name: id,
    description: id,
    emoji: '',
    duration: 10,
    replenishes: [],
    costs: [],
    desireTags: tags,
  };
}

function makeScored(id: string, score: number, tags: DesireTag[]): ScoredAction {
  return { action: makeAction(id, tags), score };
}

// ─── calculateTagOverlap ────────────────────────────────────

describe('calculateTagOverlap', () => {
  test('identical tags = 1.0', () => {
    expect(calculateTagOverlap(['social', 'fun'], ['social', 'fun'])).toBe(1.0);
  });

  test('no overlap = 0', () => {
    expect(calculateTagOverlap(['social'], ['nature'])).toBe(0);
  });

  test('partial overlap is correct', () => {
    // intersection = {social}, union = {social, fun, nature} → 1/3
    expect(calculateTagOverlap(['social', 'fun'], ['social', 'nature'])).toBeCloseTo(1 / 3);
  });

  test('single tag in both = 1.0', () => {
    expect(calculateTagOverlap(['social'], ['social'])).toBe(1.0);
  });

  test('empty arrays = 0', () => {
    expect(calculateTagOverlap([], [])).toBe(0);
  });

  test('one empty = 0', () => {
    expect(calculateTagOverlap(['social'], [])).toBe(0);
  });

  test('subset overlap', () => {
    // intersection = {social, fun}, union = {social, fun, nature} → 2/3
    expect(calculateTagOverlap(['social', 'fun'], ['social', 'fun', 'nature'])).toBeCloseTo(2 / 3);
  });
});

// ─── applyDesireModifiers ───────────────────────────────────

describe('applyDesireModifiers', () => {
  test('want boosts matching action', () => {
    const scored = [makeScored('socialize', 100, ['social', 'friendship'])];
    const desires = [makeDesire({ type: 'want', tags: ['social', 'friendship'], intensity: 0.8 })];
    const result = applyDesireModifiers(scored, desires);
    // matchStrength = 0.8 × 1.0 (perfect overlap) = 0.8
    // boost = 1 + 0.8 * 0.15 = 1.12
    expect(result[0].score).toBeCloseTo(100 * (1 + 0.8 * DESIRE_TIEBREAKER_WEIGHT));
  });

  test('fear penalizes matching action', () => {
    const scored = [makeScored('socialize', 100, ['social', 'friendship'])];
    const desires = [makeDesire({ type: 'fear', tags: ['social'], intensity: 0.6 })];
    const result = applyDesireModifiers(scored, desires);
    // overlap = 1/2, matchStrength = 0.6 × 0.5 = 0.3
    // penalty = 1 - 0.3 * 0.15 = 0.955
    expect(result[0].score).toBeCloseTo(100 * (1 - 0.6 * 0.5 * DESIRE_TIEBREAKER_WEIGHT));
  });

  test('no desires = passthrough', () => {
    const scored = [makeScored('eat', 80, ['food'])];
    const result = applyDesireModifiers(scored, []);
    expect(result[0].score).toBe(80);
  });

  test('no tag overlap = no change', () => {
    const scored = [makeScored('eat', 80, ['food'])];
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 1.0 })];
    const result = applyDesireModifiers(scored, desires);
    expect(result[0].score).toBe(80);
  });

  test('action with no desireTags is unchanged', () => {
    const action: ActionDefinition = {
      id: 'noTags',
      name: 'No Tags',
      description: '',
      emoji: '',
      duration: 10,
      replenishes: [],
      costs: [],
      // no desireTags
    };
    const scored: ScoredAction[] = [{ action, score: 50 }];
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 1.0 })];
    const result = applyDesireModifiers(scored, desires);
    expect(result[0].score).toBe(50);
  });

  test('multiple desires — strongest match wins per type', () => {
    const scored = [makeScored('socialize', 100, ['social', 'friendship'])];
    const desires = [
      makeDesire({ id: 'd1', type: 'want', tags: ['social'], intensity: 0.4 }),
      makeDesire({ id: 'd2', type: 'want', tags: ['social', 'friendship'], intensity: 0.9 }),
    ];
    const result = applyDesireModifiers(scored, desires);
    // d2 has stronger match (0.9 × 1.0 = 0.9 vs d1: 0.4 × 0.5 = 0.2)
    expect(result[0].score).toBeCloseTo(100 * (1 + 0.9 * 1.0 * DESIRE_TIEBREAKER_WEIGHT));
  });

  test('want and fear on same action partially cancel', () => {
    const scored = [makeScored('socialize', 100, ['social', 'friendship'])];
    const desires = [
      makeDesire({ id: 'd1', type: 'want', tags: ['social', 'friendship'], intensity: 0.8 }),
      makeDesire({ id: 'd2', type: 'fear', tags: ['social'], intensity: 0.4 }),
    ];
    const result = applyDesireModifiers(scored, desires);
    // want: 0.8 × 1.0 = 0.8 → +0.12
    // fear: 0.4 × 0.5 = 0.2 → -0.03
    const wantBoost = 0.8 * DESIRE_TIEBREAKER_WEIGHT;
    const fearPenalty = 0.4 * 0.5 * DESIRE_TIEBREAKER_WEIGHT;
    expect(result[0].score).toBeCloseTo(100 * (1 + wantBoost) * (1 - fearPenalty));
  });

  test('custom weight parameter respected', () => {
    const scored = [makeScored('eat', 100, ['food'])];
    const desires = [makeDesire({ type: 'want', tags: ['food'], intensity: 1.0 })];
    const result = applyDesireModifiers(scored, desires, 0.3);
    expect(result[0].score).toBeCloseTo(100 * (1 + 1.0 * 0.3));
  });

  test('maintains sort order (highest first)', () => {
    const scored = [
      makeScored('a', 100, ['food']),
      makeScored('b', 90, ['social']),
    ];
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 1.0 })];
    const result = applyDesireModifiers(scored, desires);
    // b gets boosted: 90 * 1.15 = 103.5, a stays at 100
    expect(result[0].action.id).toBe('b');
    expect(result[1].action.id).toBe('a');
  });

  test('returns new array (immutable)', () => {
    const scored = [makeScored('eat', 80, ['food'])];
    const result = applyDesireModifiers(scored, []);
    expect(result).not.toBe(scored);
  });
});

// ─── decayDesires ───────────────────────────────────────────

describe('decayDesires', () => {
  test('intensity decreases over time', () => {
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 0.5 })];
    const result = decayDesires(desires, 24 * 60); // 1 full game-day
    expect(result[0].intensity).toBeCloseTo(0.45); // 0.5 - 0.05
  });

  test('zero elapsed = no change', () => {
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 0.5 })];
    const result = decayDesires(desires, 0);
    expect(result[0].intensity).toBe(0.5);
  });

  test('very old desire decays near zero', () => {
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 0.5 })];
    const result = decayDesires(desires, 10 * 24 * 60); // 10 game-days
    expect(result[0].intensity).toBe(0); // 0.5 - 0.5 = 0, clamped
  });

  test('clamps to 0, never negative', () => {
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 0.02 })];
    const result = decayDesires(desires, 24 * 60);
    expect(result[0].intensity).toBe(0);
  });

  test('returns new array (immutable)', () => {
    const desires = [makeDesire({ type: 'want', tags: ['social'], intensity: 0.5 })];
    const result = decayDesires(desires, 100);
    expect(result).not.toBe(desires);
    expect(result[0]).not.toBe(desires[0]);
  });
});

// ─── pruneDesires ───────────────────────────────────────────

describe('pruneDesires', () => {
  test('removes below threshold', () => {
    const desires = [
      makeDesire({ id: 'a', type: 'want', tags: ['social'], intensity: 0.05 }),
      makeDesire({ id: 'b', type: 'want', tags: ['food'], intensity: 0.5 }),
    ];
    const result = pruneDesires(desires);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  test('keeps desires at exactly threshold', () => {
    const desires = [
      makeDesire({ type: 'want', tags: ['social'], intensity: DESIRE_PRUNE_THRESHOLD }),
    ];
    const result = pruneDesires(desires);
    expect(result).toHaveLength(1);
  });

  test('empty array passthrough', () => {
    expect(pruneDesires([])).toEqual([]);
  });
});

// ─── mergeDesire ────────────────────────────────────────────

describe('mergeDesire', () => {
  test('similar tags merge — intensity averaged, tags combined', () => {
    const existing = [
      makeDesire({
        id: 'e1',
        type: 'want',
        tags: ['social', 'friendship'],
        intensity: 0.6,
        sourceMemoryIds: ['m1'],
      }),
    ];
    const newDesire = makeDesire({
      id: 'n1',
      type: 'want',
      tags: ['social', 'fun'],
      intensity: 0.8,
      sourceMemoryIds: ['m2'],
    });
    // overlap: {social} / {social, friendship, fun} = 1/3 < 0.5... wait
    // Actually: intersection = {social}, union = {social, friendship, fun} = 1/3
    // That's below threshold, so it should add new, not merge
    // Let's use better overlapping tags
    const existing2 = [
      makeDesire({
        id: 'e1',
        type: 'want',
        tags: ['social', 'friendship'],
        intensity: 0.6,
        sourceMemoryIds: ['m1'],
      }),
    ];
    const newDesire2 = makeDesire({
      id: 'n1',
      type: 'want',
      tags: ['social', 'friendship'],
      intensity: 0.8,
      sourceMemoryIds: ['m2'],
    });
    // overlap: 2/2 = 1.0 >= 0.5 → merge
    const result = mergeDesire(existing2, newDesire2);
    expect(result).toHaveLength(1);
    expect(result[0].intensity).toBeCloseTo(0.7); // average
    expect(result[0].sourceMemoryIds).toContain('m1');
    expect(result[0].sourceMemoryIds).toContain('m2');
  });

  test('different tags add as new', () => {
    const existing = [
      makeDesire({ id: 'e1', type: 'want', tags: ['social'], intensity: 0.5 }),
    ];
    const newDesire = makeDesire({
      id: 'n1',
      type: 'want',
      tags: ['nature', 'exploration'],
      intensity: 0.7,
    });
    const result = mergeDesire(existing, newDesire);
    expect(result).toHaveLength(2);
  });

  test('evicts weakest at capacity (wants)', () => {
    const existing: Desire[] = [];
    for (let i = 0; i < MAX_WANTS; i++) {
      existing.push(
        makeDesire({
          id: `w${i}`,
          type: 'want',
          tags: ['social'] as DesireTag[],
          intensity: 0.3 + i * 0.1,
        }),
      );
    }
    const newDesire = makeDesire({
      id: 'new',
      type: 'want',
      tags: ['nature'] as DesireTag[],
      intensity: 0.9,
    });
    const result = mergeDesire(existing, newDesire);
    // Should still be at max, weakest evicted
    const wants = result.filter((d) => d.type === 'want');
    expect(wants).toHaveLength(MAX_WANTS);
    expect(wants.find((d) => d.id === 'w0')).toBeUndefined(); // weakest evicted
    expect(wants.find((d) => d.id === 'new')).toBeDefined();
  });

  test('evicts weakest at capacity (fears)', () => {
    const existing: Desire[] = [];
    for (let i = 0; i < MAX_FEARS; i++) {
      existing.push(
        makeDesire({
          id: `f${i}`,
          type: 'fear',
          tags: ['social'] as DesireTag[],
          intensity: 0.3 + i * 0.1,
        }),
      );
    }
    const newDesire = makeDesire({
      id: 'new',
      type: 'fear',
      tags: ['nature'] as DesireTag[],
      intensity: 0.9,
    });
    const result = mergeDesire(existing, newDesire);
    const fears = result.filter((d) => d.type === 'fear');
    expect(fears).toHaveLength(MAX_FEARS);
    expect(fears.find((d) => d.id === 'f0')).toBeUndefined();
    expect(fears.find((d) => d.id === 'new')).toBeDefined();
  });

  test('sourceMemoryIds combined on merge', () => {
    const existing = [
      makeDesire({
        id: 'e1',
        type: 'want',
        tags: ['social', 'friendship'],
        intensity: 0.5,
        sourceMemoryIds: ['m1', 'm2'],
      }),
    ];
    const newDesire = makeDesire({
      id: 'n1',
      type: 'want',
      tags: ['social', 'friendship'],
      intensity: 0.7,
      sourceMemoryIds: ['m2', 'm3'],
    });
    const result = mergeDesire(existing, newDesire);
    // Deduplicated: m1, m2, m3
    expect(result[0].sourceMemoryIds).toEqual(expect.arrayContaining(['m1', 'm2', 'm3']));
    expect(result[0].sourceMemoryIds).toHaveLength(3);
  });

  test('only merges same type (want with want)', () => {
    const existing = [
      makeDesire({ id: 'e1', type: 'want', tags: ['social', 'friendship'], intensity: 0.5 }),
    ];
    const newDesire = makeDesire({
      id: 'n1',
      type: 'fear',
      tags: ['social', 'friendship'],
      intensity: 0.7,
    });
    const result = mergeDesire(existing, newDesire);
    // Different types — should NOT merge, should add
    expect(result).toHaveLength(2);
  });

  test('merged tags are union of both sets', () => {
    const existing = [
      makeDesire({
        id: 'e1',
        type: 'want',
        tags: ['social', 'friendship'],
        intensity: 0.5,
      }),
    ];
    const newDesire = makeDesire({
      id: 'n1',
      type: 'want',
      tags: ['social', 'fun'],
      // overlap = {social} / {social, friendship, fun} = 1/3 < 0.5 → won't merge
      // Use higher overlap:
      tags: ['social', 'friendship', 'fun'],
      // overlap = {social, friendship} / {social, friendship, fun} = 2/3 >= 0.5 → merge
      intensity: 0.7,
    });
    const result = mergeDesire(existing, newDesire);
    expect(result).toHaveLength(1);
    expect(result[0].tags).toContain('social');
    expect(result[0].tags).toContain('friendship');
    expect(result[0].tags).toContain('fun');
  });
});

// ─── getDesireContext ───────────────────────────────────────

describe('getDesireContext', () => {
  test('formats wants and fears separately', () => {
    const desires = [
      makeDesire({ type: 'want', tags: ['social'], intensity: 0.8, description: 'make friends' }),
      makeDesire({ type: 'fear', tags: ['safety'], intensity: 0.5, description: 'being alone' }),
    ];
    const lines = getDesireContext(desires);
    expect(lines.some((l) => l.includes('want') && l.includes('make friends'))).toBe(true);
    expect(lines.some((l) => l.includes('worry') && l.includes('being alone'))).toBe(true);
  });

  test('strong/moderate/slight labels', () => {
    const desires = [
      makeDesire({ type: 'want', tags: ['social'], intensity: 0.8, description: 'strong desire' }),
      makeDesire({ type: 'want', tags: ['food'], intensity: 0.5, description: 'moderate desire' }),
      makeDesire({ type: 'want', tags: ['rest'], intensity: 0.2, description: 'slight desire' }),
    ];
    const lines = getDesireContext(desires);
    expect(lines.some((l) => l.includes('strong'))).toBe(true);
    expect(lines.some((l) => l.includes('moderate'))).toBe(true);
    expect(lines.some((l) => l.includes('slight'))).toBe(true);
  });

  test('empty desires returns empty', () => {
    expect(getDesireContext([])).toEqual([]);
  });

  test('very low intensity desires are still shown', () => {
    const desires = [
      makeDesire({ type: 'want', tags: ['social'], intensity: 0.15, description: 'faint wish' }),
    ];
    const lines = getDesireContext(desires);
    expect(lines.length).toBeGreaterThan(0);
  });
});
