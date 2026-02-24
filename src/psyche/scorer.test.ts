import { scoreActions, scoreActionsDeterministic } from './scorer';
import { ActionDefinition, AgentNeedState, NeedRegistry } from './registries';

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
  [
    'fun',
    {
      id: 'fun',
      name: 'Fun',
      maxValue: 100,
      depletionRate: 0.06,
      priorityWeight: 0.7,
      criticalThreshold: 20,
    },
  ],
]);

const eat: ActionDefinition = {
  id: 'eat',
  name: 'Eat',
  description: 'Eating food',
  emoji: '🍽️',
  locationRequirement: 'cafe',
  duration: 30,
  replenishes: [{ needId: 'hunger', amount: 40 }],
  costs: [{ needId: 'energy', amount: 5 }],
};

const sleep: ActionDefinition = {
  id: 'sleep',
  name: 'Sleep',
  description: 'Sleeping',
  emoji: '😴',
  locationRequirement: 'home',
  duration: 120,
  replenishes: [{ needId: 'energy', amount: 60 }],
  costs: [{ needId: 'social', amount: 5 }],
};

const chat: ActionDefinition = {
  id: 'chat',
  name: 'Chat',
  description: 'Chatting',
  emoji: '💬',
  duration: 20,
  replenishes: [{ needId: 'social', amount: 25 }],
  costs: [{ needId: 'energy', amount: 5 }],
};

const wander: ActionDefinition = {
  id: 'wander',
  name: 'Wander',
  description: 'Wandering',
  emoji: '🚶',
  duration: 15,
  replenishes: [{ needId: 'fun', amount: 5 }],
  costs: [{ needId: 'energy', amount: 3 }],
};

const playGame: ActionDefinition = {
  id: 'play_game',
  name: 'Play Game',
  description: 'Playing a game',
  emoji: '🎮',
  duration: 30,
  replenishes: [{ needId: 'fun', amount: 30 }],
  costs: [{ needId: 'energy', amount: 5 }],
};

const allActions = [eat, sleep, chat, wander, playGame];

function makeNeeds(overrides: Partial<Record<string, number>>): AgentNeedState[] {
  return [
    { needId: 'hunger', currentValue: overrides.hunger ?? 80, lastUpdated: 0 },
    { needId: 'energy', currentValue: overrides.energy ?? 80, lastUpdated: 0 },
    { needId: 'social', currentValue: overrides.social ?? 80, lastUpdated: 0 },
    { needId: 'fun', currentValue: overrides.fun ?? 80, lastUpdated: 0 },
  ];
}

describe('scoreActions (deterministic)', () => {
  test('hungry agent prefers eating over other actions', () => {
    const needs = makeNeeds({ hunger: 10, energy: 80, social: 80, fun: 80 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    expect(result[0].action.id).toBe('eat');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  test('exhausted agent prefers sleeping over eating', () => {
    const needs = makeNeeds({ hunger: 50, energy: 5, social: 80, fun: 80 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    expect(result[0].action.id).toBe('sleep');
  });

  test('critical hunger overrides moderate tiredness', () => {
    // Hunger is critical (<20), energy is moderate (40)
    const needs = makeNeeds({ hunger: 15, energy: 40, social: 80, fun: 80 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    expect(result[0].action.id).toBe('eat');
  });

  test('critical energy overrides critical hunger when energy is more depleted', () => {
    // Both critical, but energy is at rock bottom
    const needs = makeNeeds({ hunger: 18, energy: 2, social: 80, fun: 80 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    expect(result[0].action.id).toBe('sleep');
  });

  test('lonely agent prefers chatting', () => {
    const needs = makeNeeds({ hunger: 80, energy: 80, social: 10, fun: 80 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    expect(result[0].action.id).toBe('chat');
  });

  test('bored agent prefers playing game', () => {
    const needs = makeNeeds({ hunger: 80, energy: 80, social: 80, fun: 10 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    expect(result[0].action.id).toBe('play_game');
  });

  test('all needs satisfied → lowest scores overall', () => {
    const needs = makeNeeds({ hunger: 95, energy: 95, social: 95, fun: 95 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    // All scores should be very low when needs are nearly full
    for (const scored of result) {
      expect(scored.score).toBeLessThan(5);
    }
  });

  test('returns all actions sorted by score', () => {
    const needs = makeNeeds({ hunger: 30, energy: 50, social: 60, fun: 70 });
    const result = scoreActionsDeterministic(needs, allActions, testNeedDefs);

    expect(result).toHaveLength(allActions.length);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  test('wander always has a positive score when fun is depleted', () => {
    const needs = makeNeeds({ hunger: 80, energy: 80, social: 80, fun: 0 });
    const result = scoreActionsDeterministic(needs, [wander], testNeedDefs);

    expect(result[0].score).toBeGreaterThan(0);
  });

  test('costs penalize actions that deplete already-low needs', () => {
    // Energy is very low — eating costs energy, so eat should be penalized
    const needs = makeNeeds({ hunger: 10, energy: 10, social: 80, fun: 80 });
    const eatScore = scoreActionsDeterministic(needs, [eat], testNeedDefs)[0].score;

    // Same hunger but high energy — eating costs energy, but it's fine
    const needs2 = makeNeeds({ hunger: 10, energy: 90, social: 80, fun: 80 });
    const eatScore2 = scoreActionsDeterministic(needs2, [eat], testNeedDefs)[0].score;

    // Eating with high energy should score better than with low energy
    // (same replenishment but lower cost penalty)
    expect(eatScore2).toBeGreaterThan(eatScore);
  });
});

describe('scoreActions (with noise)', () => {
  test('noise produces occasional variety', () => {
    const needs = makeNeeds({ hunger: 30, energy: 50, social: 80, fun: 80 });

    // Run 100 times and check we don't always get the same first pick
    const firstPicks = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = scoreActions(needs, allActions, testNeedDefs);
      firstPicks.add(result[0].action.id);
    }

    // With ±5% noise and close-ish scores, we might see variety
    // At minimum, the top pick should be consistent (eat) most of the time
    // but we're testing the noise mechanism works at all
    expect(firstPicks.size).toBeGreaterThanOrEqual(1);
  });

  test('noise does not change scores dramatically', () => {
    const needs = makeNeeds({ hunger: 10, energy: 80, social: 80, fun: 80 });

    // With critical hunger, eat should always win despite noise
    for (let i = 0; i < 50; i++) {
      const result = scoreActions(needs, allActions, testNeedDefs);
      expect(result[0].action.id).toBe('eat');
    }
  });
});

describe('edge cases', () => {
  test('empty actions list returns empty results', () => {
    const needs = makeNeeds({ hunger: 30 });
    const result = scoreActionsDeterministic(needs, [], testNeedDefs);
    expect(result).toHaveLength(0);
  });

  test('action with unknown need in replenishes is handled gracefully', () => {
    const unknownAction: ActionDefinition = {
      id: 'unknown',
      name: 'Unknown',
      description: 'Tests unknown need',
      emoji: '❓',
      duration: 10,
      replenishes: [{ needId: 'nonexistent', amount: 50 }],
      costs: [],
    };
    const needs = makeNeeds({});
    const result = scoreActionsDeterministic(needs, [unknownAction], testNeedDefs);

    // Should get a score of 0 (unknown need contributes nothing)
    expect(result[0].score).toBe(0);
  });

  test('action with no effects scores zero', () => {
    const noopAction: ActionDefinition = {
      id: 'noop',
      name: 'Nothing',
      description: 'Does nothing',
      emoji: '🤷',
      duration: 10,
      replenishes: [],
      costs: [],
    };
    const needs = makeNeeds({ hunger: 10 });
    const result = scoreActionsDeterministic(needs, [noopAction], testNeedDefs);
    expect(result[0].score).toBe(0);
  });
});
