import { depleteNeeds, applyActionEffects, initializeNeeds } from './needs';
import { AgentNeedState, NeedRegistry } from './registries';

// Minimal test registry
const testNeedDefs: NeedRegistry = new Map([
  [
    'hunger',
    {
      id: 'hunger',
      name: 'Hunger',
      maxValue: 100,
      depletionRate: 0.15,
      priorityWeight: 1.2,
      criticalThreshold: 20,
    },
  ],
  [
    'energy',
    {
      id: 'energy',
      name: 'Energy',
      maxValue: 100,
      depletionRate: 0.10,
      priorityWeight: 1.0,
      criticalThreshold: 15,
    },
  ],
  [
    'social',
    {
      id: 'social',
      name: 'Social',
      maxValue: 100,
      depletionRate: 0.08,
      priorityWeight: 0.8,
      criticalThreshold: 25,
    },
  ],
]);

function makeNeeds(overrides: Partial<Record<string, number>> = {}): AgentNeedState[] {
  return [
    { needId: 'hunger', currentValue: overrides.hunger ?? 80, lastUpdated: 0 },
    { needId: 'energy', currentValue: overrides.energy ?? 80, lastUpdated: 0 },
    { needId: 'social', currentValue: overrides.social ?? 80, lastUpdated: 0 },
  ];
}

describe('depleteNeeds', () => {
  test('depletes proportionally to elapsed time', () => {
    const needs = makeNeeds({ hunger: 100, energy: 100 });
    const result = depleteNeeds(needs, 60, testNeedDefs, 60); // 1 game-hour

    const hunger = result.find((n) => n.needId === 'hunger')!;
    const energy = result.find((n) => n.needId === 'energy')!;

    // hunger: 100 - 0.15 * 60 = 91
    expect(hunger.currentValue).toBeCloseTo(91, 5);
    // energy: 100 - 0.10 * 60 = 94
    expect(energy.currentValue).toBeCloseTo(94, 5);
  });

  test('does not go below zero', () => {
    const needs = makeNeeds({ hunger: 5 });
    const result = depleteNeeds(needs, 1000, testNeedDefs, 1000); // huge time

    const hunger = result.find((n) => n.needId === 'hunger')!;
    expect(hunger.currentValue).toBe(0);
  });

  test('updates lastUpdated timestamp', () => {
    const needs = makeNeeds();
    const result = depleteNeeds(needs, 10, testNeedDefs, 42);

    for (const need of result) {
      expect(need.lastUpdated).toBe(42);
    }
  });

  test('handles zero elapsed time (no change)', () => {
    const needs = makeNeeds({ hunger: 50 });
    const result = depleteNeeds(needs, 0, testNeedDefs, 0);

    const hunger = result.find((n) => n.needId === 'hunger')!;
    expect(hunger.currentValue).toBe(50);
  });

  test('ignores needs not in registry', () => {
    const needs: AgentNeedState[] = [
      { needId: 'unknown_need', currentValue: 50, lastUpdated: 0 },
    ];
    const result = depleteNeeds(needs, 60, testNeedDefs, 60);
    expect(result[0].currentValue).toBe(50); // unchanged
  });

  test('depletion is linear over multiple intervals', () => {
    const needs1 = makeNeeds({ hunger: 100 });
    // Deplete in one 120-minute chunk
    const singleStep = depleteNeeds(needs1, 120, testNeedDefs, 120);

    // Deplete in two 60-minute chunks
    const needs2 = makeNeeds({ hunger: 100 });
    const step1 = depleteNeeds(needs2, 60, testNeedDefs, 60);
    const step2 = depleteNeeds(step1, 60, testNeedDefs, 120);

    const singleHunger = singleStep.find((n) => n.needId === 'hunger')!;
    const multiHunger = step2.find((n) => n.needId === 'hunger')!;

    expect(singleHunger.currentValue).toBeCloseTo(multiHunger.currentValue, 5);
  });
});

describe('applyActionEffects', () => {
  test('applies replenishment correctly', () => {
    const needs = makeNeeds({ hunger: 30 });
    const result = applyActionEffects(
      needs,
      [{ needId: 'hunger', amount: 40 }],
      [],
      testNeedDefs,
      0,
    );

    const hunger = result.find((n) => n.needId === 'hunger')!;
    expect(hunger.currentValue).toBe(70);
  });

  test('applies costs correctly', () => {
    const needs = makeNeeds({ energy: 50 });
    const result = applyActionEffects(
      needs,
      [],
      [{ needId: 'energy', amount: 10 }],
      testNeedDefs,
      0,
    );

    const energy = result.find((n) => n.needId === 'energy')!;
    expect(energy.currentValue).toBe(40);
  });

  test('clamps to maxValue', () => {
    const needs = makeNeeds({ hunger: 90 });
    const result = applyActionEffects(
      needs,
      [{ needId: 'hunger', amount: 40 }],
      [],
      testNeedDefs,
      0,
    );

    const hunger = result.find((n) => n.needId === 'hunger')!;
    expect(hunger.currentValue).toBe(100);
  });

  test('clamps to zero', () => {
    const needs = makeNeeds({ energy: 5 });
    const result = applyActionEffects(
      needs,
      [],
      [{ needId: 'energy', amount: 20 }],
      testNeedDefs,
      0,
    );

    const energy = result.find((n) => n.needId === 'energy')!;
    expect(energy.currentValue).toBe(0);
  });

  test('handles simultaneous replenish and cost on same need', () => {
    const needs = makeNeeds({ hunger: 50 });
    const result = applyActionEffects(
      needs,
      [{ needId: 'hunger', amount: 20 }],
      [{ needId: 'hunger', amount: 5 }],
      testNeedDefs,
      0,
    );

    const hunger = result.find((n) => n.needId === 'hunger')!;
    expect(hunger.currentValue).toBe(65); // 50 + 20 - 5
  });
});

describe('initializeNeeds', () => {
  test('creates needs at max value', () => {
    const needs = initializeNeeds(testNeedDefs, 0);

    expect(needs).toHaveLength(3);
    for (const need of needs) {
      const def = testNeedDefs.get(need.needId)!;
      expect(need.currentValue).toBe(def.maxValue);
      expect(need.lastUpdated).toBe(0);
    }
  });
});
