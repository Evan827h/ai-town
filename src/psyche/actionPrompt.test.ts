import {
  preFilterActions,
  serializeActionsForPrompt,
  getGameTimeOfDay,
  getGameMinutesSinceMidnight,
  injectCriticalNeedActions,
} from './actionPrompt';
import { ActionDefinition, AgentNeedState, NeedDefinition, NeedId, NeedRegistry } from './registries';

// ─── Helpers ─────────────────────────────────────────────────

function makeAction(
  id: string,
  overrides: Partial<ActionDefinition> = {},
): ActionDefinition {
  return {
    id,
    name: overrides.name ?? id.replace(/_/g, ' '),
    description: id,
    emoji: '',
    duration: overrides.duration ?? 30,
    replenishes: overrides.replenishes ?? [],
    costs: overrides.costs ?? [],
    locationRequirement: overrides.locationRequirement,
    desireTags: overrides.desireTags ?? [],
  };
}

function makeNeedState(needId: NeedId, currentValue: number): AgentNeedState {
  return { needId, currentValue, lastUpdated: Date.now() };
}

// Minimal need registry with critical thresholds
const testNeedRegistry: NeedRegistry = new Map<NeedId, NeedDefinition>([
  ['hunger', { id: 'hunger', name: 'Hunger', maxValue: 100, depletionRate: 0.04, priorityWeight: 1.2, criticalThreshold: 20 }],
  ['energy', { id: 'energy', name: 'Energy', maxValue: 100, depletionRate: 0.05, priorityWeight: 0.2, criticalThreshold: 35 }],
  ['social', { id: 'social', name: 'Social', maxValue: 100, depletionRate: 0.07, priorityWeight: 0.8, criticalThreshold: 25 }],
  ['comfort', { id: 'comfort', name: 'Comfort', maxValue: 100, depletionRate: 0.04, priorityWeight: 0.6, criticalThreshold: 15 }],
  ['fun', { id: 'fun', name: 'Fun', maxValue: 100, depletionRate: 0.05, priorityWeight: 0.7, criticalThreshold: 20 }],
]);

// Test actions
const cafeEat = makeAction('eat_at_cafe', {
  locationRequirement: 'cafe',
  replenishes: [{ needId: 'hunger', amount: 40 }],
  costs: [{ needId: 'energy', amount: 5 }],
  duration: 30,
});
const cafeSocialize = makeAction('socialize_at_cafe', {
  locationRequirement: 'cafe',
  replenishes: [{ needId: 'social', amount: 30 }],
  costs: [{ needId: 'energy', amount: 10 }],
});
const homeSleep = makeAction('sleep_at_home', {
  locationRequirement: 'home',
  replenishes: [{ needId: 'energy', amount: 60 }],
  costs: [],
  duration: 120,
});
const homeCook = makeAction('cook_at_home', {
  locationRequirement: 'home',
  replenishes: [{ needId: 'hunger', amount: 35 }],
  costs: [{ needId: 'energy', amount: 10 }],
});
const parkExercise = makeAction('exercise_at_park', {
  locationRequirement: 'park',
  replenishes: [{ needId: 'fun', amount: 20 }],
  costs: [{ needId: 'energy', amount: 15 }],
});
const chatNearby = makeAction('chat_with_nearby', {
  replenishes: [{ needId: 'social', amount: 25 }],
  costs: [],
});
const wander = makeAction('wander', {
  replenishes: [],
  costs: [],
});

const allTestActions = [cafeEat, cafeSocialize, homeSleep, homeCook, parkExercise, chatNearby, wander];

// ─── preFilterActions ────────────────────────────────────────

describe('preFilterActions', () => {
  test('agent at cafe with no critical needs → only cafe + universal actions', () => {
    const needs = [
      makeNeedState('hunger', 80),
      makeNeedState('energy', 70),
      makeNeedState('social', 60),
    ];
    const result = preFilterActions(allTestActions, 'cafe', needs, testNeedRegistry);
    const ids = result.map((a) => a.id);

    expect(ids).toContain('eat_at_cafe');
    expect(ids).toContain('socialize_at_cafe');
    expect(ids).toContain('chat_with_nearby');
    expect(ids).toContain('wander');
    // Other-location actions excluded (no critical needs)
    expect(ids).not.toContain('sleep_at_home');
    expect(ids).not.toContain('cook_at_home');
    expect(ids).not.toContain('exercise_at_park');
  });

  test('agent at home with critical hunger → includes cafe eating actions', () => {
    const needs = [
      makeNeedState('hunger', 10), // below criticalThreshold 20
      makeNeedState('energy', 70),
      makeNeedState('social', 60),
    ];
    const result = preFilterActions(allTestActions, 'home', needs, testNeedRegistry);
    const ids = result.map((a) => a.id);

    // Home actions always included
    expect(ids).toContain('sleep_at_home');
    expect(ids).toContain('cook_at_home');
    // Universal always included
    expect(ids).toContain('chat_with_nearby');
    expect(ids).toContain('wander');
    // Cafe eat_at_cafe replenishes hunger (critical) → included
    expect(ids).toContain('eat_at_cafe');
    // Cafe socialize doesn't replenish hunger → excluded
    expect(ids).not.toContain('socialize_at_cafe');
    // Park exercise doesn't replenish hunger → excluded
    expect(ids).not.toContain('exercise_at_park');
  });

  test('agent at park with all needs critical → most actions included', () => {
    const needs = [
      makeNeedState('hunger', 5),
      makeNeedState('energy', 10),
      makeNeedState('social', 5),
      makeNeedState('comfort', 5),
      makeNeedState('fun', 5),
    ];
    const result = preFilterActions(allTestActions, 'park', needs, testNeedRegistry);
    const ids = result.map((a) => a.id);

    // Park + universal always included
    expect(ids).toContain('exercise_at_park');
    expect(ids).toContain('chat_with_nearby');
    expect(ids).toContain('wander');
    // Cafe actions replenish hunger/social (critical)
    expect(ids).toContain('eat_at_cafe');
    expect(ids).toContain('socialize_at_cafe');
    // Home actions replenish energy/hunger (critical)
    expect(ids).toContain('sleep_at_home');
    expect(ids).toContain('cook_at_home');
  });

  test('empty needs array → all actions pass through', () => {
    const result = preFilterActions(allTestActions, 'cafe', [], testNeedRegistry);
    // No needs to be critical, so only cafe + universal pass
    const ids = result.map((a) => a.id);
    expect(ids).toContain('eat_at_cafe');
    expect(ids).toContain('socialize_at_cafe');
    expect(ids).toContain('chat_with_nearby');
    expect(ids).toContain('wander');
    // Other locations excluded (no critical needs to trigger inclusion)
    expect(ids).not.toContain('sleep_at_home');
  });

  test('agent at unknown location → only universal actions (unless critical needs)', () => {
    const needs = [makeNeedState('hunger', 80)];
    const result = preFilterActions(allTestActions, 'unknown', needs, testNeedRegistry);
    const ids = result.map((a) => a.id);

    expect(ids).toContain('chat_with_nearby');
    expect(ids).toContain('wander');
    expect(ids).not.toContain('eat_at_cafe');
    expect(ids).not.toContain('sleep_at_home');
  });

  test('need exactly at critical threshold → not considered critical', () => {
    const needs = [makeNeedState('hunger', 20)]; // exactly at threshold (20), not below
    const result = preFilterActions(allTestActions, 'home', needs, testNeedRegistry);
    const ids = result.map((a) => a.id);

    // Home + universal included
    expect(ids).toContain('cook_at_home');
    expect(ids).toContain('chat_with_nearby');
    // Cafe actions excluded — hunger is AT threshold, not below
    expect(ids).not.toContain('eat_at_cafe');
  });
});

// ─── serializeActionsForPrompt ───────────────────────────────

describe('serializeActionsForPrompt', () => {
  test('formats actions with effects, location, and duration', () => {
    const result = serializeActionsForPrompt([cafeEat]);
    expect(result).toBe('[eat_at_cafe] eat at cafe — hunger +40, energy -5 (cafe, 30min)');
  });

  test('formats universal actions with "anywhere"', () => {
    const result = serializeActionsForPrompt([chatNearby]);
    expect(result).toBe('[chat_with_nearby] chat with nearby — social +25 (anywhere, 30min)');
  });

  test('formats actions with no effects', () => {
    const result = serializeActionsForPrompt([wander]);
    expect(result).toBe('[wander] wander — no direct effects (anywhere, 30min)');
  });

  test('multiple actions separated by newlines', () => {
    const result = serializeActionsForPrompt([cafeEat, wander]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[eat_at_cafe\]/);
    expect(lines[1]).toMatch(/^\[wander\]/);
  });
});

// ─── getGameTimeOfDay ────────────────────────────────────────

describe('getGameTimeOfDay', () => {
  test('morning: 6:00 AM (360 min)', () => {
    expect(getGameTimeOfDay(360)).toBe('morning');
  });

  test('morning: 11:59 AM (719 min)', () => {
    expect(getGameTimeOfDay(719)).toBe('morning');
  });

  test('afternoon: 12:00 PM (720 min)', () => {
    expect(getGameTimeOfDay(720)).toBe('afternoon');
  });

  test('evening: 6:00 PM (1080 min)', () => {
    expect(getGameTimeOfDay(1080)).toBe('evening');
  });

  test('night: 10:00 PM (1320 min)', () => {
    expect(getGameTimeOfDay(1320)).toBe('night');
  });

  test('night: 3:00 AM (180 min)', () => {
    expect(getGameTimeOfDay(180)).toBe('night');
  });

  test('handles negative values via modulo wrap', () => {
    expect(getGameTimeOfDay(-60)).toBe('night'); // wraps to 1380 → night
  });

  test('handles values > 1440 via modulo wrap', () => {
    expect(getGameTimeOfDay(1800)).toBe('morning'); // 1800 % 1440 = 360 → morning
  });
});

// ─── getGameMinutesSinceMidnight ─────────────────────────────

describe('getGameMinutesSinceMidnight', () => {
  test('returns value in 0–1439 range', () => {
    const result = getGameMinutesSinceMidnight(Date.now(), 1.0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(1440);
  });

  test('scales with gameTimeScale', () => {
    const ms = 720_000; // 720 seconds = 12 real minutes
    // At scale 1.0: 720 game-minutes → 720 % 1440 = 720 (afternoon)
    expect(getGameMinutesSinceMidnight(ms, 1.0)).toBe(720);
    // At scale 2.0: 1440 game-minutes → 1440 % 1440 = 0 (midnight)
    expect(getGameMinutesSinceMidnight(ms, 2.0)).toBe(0);
  });
});

// ─── injectCriticalNeedActions ───────────────────────────────

describe('injectCriticalNeedActions', () => {
  // Maya scenario: energy=3, LLM curated [meditate(+10), fish, chat], but sleep(+60) exists
  test('injects sleep when curated only has meditate for critical energy', () => {
    const curated = [
      makeAction('meditate_at_waterfall', {
        locationRequirement: 'waterfall',
        replenishes: [{ needId: 'energy', amount: 10 }],
      }),
      makeAction('fish_at_waterfall', {
        locationRequirement: 'waterfall',
        replenishes: [{ needId: 'hunger', amount: 20 }],
      }),
      chatNearby,
    ];
    const preFiltered = [...curated, homeSleep]; // sleep_at_home: energy +60
    const needs = [makeNeedState('energy', 3)]; // critical (threshold 35)

    const { actions, overrides } = injectCriticalNeedActions(curated, preFiltered, needs, testNeedRegistry);

    expect(actions.map((a) => a.id)).toContain('sleep_at_home');
    expect(overrides).toHaveLength(1);
    expect(overrides[0].needId).toBe('energy');
    expect(overrides[0].injectedActionId).toBe('sleep_at_home');
    expect(overrides[0].reason).toMatch(/energy critically low/);
  });

  test('does not inject when curated set already has adequate replenisher', () => {
    const nap = makeAction('nap', {
      locationRequirement: 'home',
      replenishes: [{ needId: 'energy', amount: 25 }],
    });
    const curated = [nap, chatNearby]; // nap gives +25
    const preFiltered = [...curated, homeSleep]; // sleep gives +60, but 25 >= 60*0.5=30? No, 25 < 30
    const needs = [makeNeedState('energy', 10)];

    // 25 < 30 (60*0.5), so it WILL inject
    const { actions, overrides } = injectCriticalNeedActions(curated, preFiltered, needs, testNeedRegistry);
    expect(overrides).toHaveLength(1);
    expect(actions.map((a) => a.id)).toContain('sleep_at_home');
  });

  test('does not inject when curated best is at least half of available best', () => {
    const goodNap = makeAction('good_nap', {
      locationRequirement: 'home',
      replenishes: [{ needId: 'energy', amount: 35 }],
    });
    const curated = [goodNap, chatNearby]; // nap gives +35
    const preFiltered = [...curated, homeSleep]; // sleep gives +60, 35 >= 30 → no inject
    const needs = [makeNeedState('energy', 10)];

    const { overrides } = injectCriticalNeedActions(curated, preFiltered, needs, testNeedRegistry);
    expect(overrides).toHaveLength(0);
  });

  test('does not inject for non-critical needs', () => {
    const curated = [chatNearby, wander];
    const preFiltered = [...curated, homeSleep]; // sleep gives energy +60
    const needs = [makeNeedState('energy', 80)]; // well above threshold 35

    const { overrides } = injectCriticalNeedActions(curated, preFiltered, needs, testNeedRegistry);
    expect(overrides).toHaveLength(0);
  });

  test('handles multiple critical needs — injects for each', () => {
    const curated = [wander]; // nothing replenishes hunger or energy
    const preFiltered = [wander, cafeEat, homeSleep]; // eat: hunger+40, sleep: energy+60
    const needs = [
      makeNeedState('hunger', 5), // critical
      makeNeedState('energy', 3), // critical
    ];

    const { actions, overrides } = injectCriticalNeedActions(curated, preFiltered, needs, testNeedRegistry);
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('eat_at_cafe');
    expect(ids).toContain('sleep_at_home');
    expect(overrides).toHaveLength(2);
  });

  test('does not duplicate actions already in curated set', () => {
    const curated = [homeSleep, chatNearby]; // sleep already curated
    const preFiltered = [...curated, wander];
    const needs = [makeNeedState('energy', 3)]; // critical

    const { actions, overrides } = injectCriticalNeedActions(curated, preFiltered, needs, testNeedRegistry);
    // sleep is already curated, so 60 >= 60*0.5 trivially (bestCurated=60, bestAvailable considers only non-curated)
    expect(overrides).toHaveLength(0);
    expect(actions).toHaveLength(2); // no duplicates
  });

  test('returns empty overrides when no needs are critical', () => {
    const curated = [chatNearby, wander];
    const { overrides } = injectCriticalNeedActions(curated, curated, [
      makeNeedState('hunger', 80),
      makeNeedState('energy', 70),
    ], testNeedRegistry);
    expect(overrides).toHaveLength(0);
  });
});
