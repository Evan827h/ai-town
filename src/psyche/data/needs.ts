import { NeedDefinition, NeedRegistry } from '../registries';

/**
 * v1 Needs Registry — 5 core needs based on Maslow's hierarchy.
 *
 * Tuning notes:
 * - Social depletes fastest (0.07) — drives most social interaction
 * - Energy and fun deplete moderately (0.05) — steady mid-priority cycles
 * - Hunger and comfort deplete slowest (0.04) — background needs
 * - Priority weights control urgency when low (hunger 1.2x scores highest)
 * - Critical thresholds trigger emergency behavior (3x urgency)
 */

const needDefinitions: NeedDefinition[] = [
  {
    id: 'hunger',
    name: 'Hunger',
    maxValue: 100,
    depletionRate: 0.04, // ~41.7 game-hours to empty from full (100 / 0.04 / 60)
    priorityWeight: 1.2,
    criticalThreshold: 20,
  },
  {
    id: 'energy',
    name: 'Energy',
    maxValue: 100,
    depletionRate: 0.05, // ~33.3 game-hours to empty from full
    // Low weight means energy barely scores until critical — agents don't sleep preemptively.
    // High criticalThreshold (35) gives the 3× multiplier enough range to win when truly needed.
    priorityWeight: 0.2,
    criticalThreshold: 35,
  },
  {
    id: 'social',
    name: 'Social',
    maxValue: 100,
    depletionRate: 0.07, // ~23.8 game-hours to empty from full
    priorityWeight: 0.8,
    criticalThreshold: 25,
  },
  {
    id: 'comfort',
    name: 'Comfort',
    maxValue: 100,
    depletionRate: 0.04, // ~41.7 game-hours to empty from full
    priorityWeight: 0.6,
    criticalThreshold: 15,
  },
  {
    id: 'fun',
    name: 'Fun',
    maxValue: 100,
    depletionRate: 0.05, // ~33.3 game-hours to empty from full
    priorityWeight: 0.7,
    criticalThreshold: 20,
  },
];

export const needRegistry: NeedRegistry = new Map(needDefinitions.map((n) => [n.id, n]));
