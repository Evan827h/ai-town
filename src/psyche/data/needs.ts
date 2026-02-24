import { NeedDefinition, NeedRegistry } from '../registries';

/**
 * v1 Needs Registry — 5 core needs based on Maslow's hierarchy.
 *
 * Tuning notes:
 * - Hunger depletes fastest (1.2 weight) — drives most agent movement
 * - Energy depletes moderately — creates sleep cycles
 * - Social depletes slowly — occasional conversations
 * - Comfort and fun are secondary — add variety to behavior
 * - Critical thresholds trigger emergency behavior (3x urgency)
 */

const needDefinitions: NeedDefinition[] = [
  {
    id: 'hunger',
    name: 'Hunger',
    maxValue: 100,
    depletionRate: 0.15,   // ~11 game-hours to empty from full
    priorityWeight: 1.2,
    criticalThreshold: 20,
  },
  {
    id: 'energy',
    name: 'Energy',
    maxValue: 100,
    depletionRate: 0.10,   // ~16.7 game-hours to empty from full
    priorityWeight: 1.0,
    criticalThreshold: 15,
  },
  {
    id: 'social',
    name: 'Social',
    maxValue: 100,
    depletionRate: 0.08,   // ~20.8 game-hours to empty from full
    priorityWeight: 0.8,
    criticalThreshold: 25,
  },
  {
    id: 'comfort',
    name: 'Comfort',
    maxValue: 100,
    depletionRate: 0.05,   // ~33.3 game-hours to empty from full
    priorityWeight: 0.6,
    criticalThreshold: 15,
  },
  {
    id: 'fun',
    name: 'Fun',
    maxValue: 100,
    depletionRate: 0.06,   // ~27.8 game-hours to empty from full
    priorityWeight: 0.7,
    criticalThreshold: 20,
  },
];

export const needRegistry: NeedRegistry = new Map(
  needDefinitions.map((n) => [n.id, n]),
);
