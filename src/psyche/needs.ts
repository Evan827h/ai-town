import { AgentNeedState, NeedId, NeedRegistry } from './registries';

export interface NeedEffect {
  needId: NeedId;
  amount: number;
  duration?: number;
}

/**
 * Deplete all agent needs based on elapsed game time.
 *
 * Pure function — no side effects, no database access.
 * Framerate-independent: uses elapsed game-minutes, not tick count.
 *
 * @param needs - Current agent need states
 * @param elapsedGameMinutes - Time elapsed since last update (game-minutes)
 * @param needDefs - The need definitions registry
 * @param currentGameTime - Current game timestamp for lastUpdated
 * @returns Updated need states with depleted values
 */
export function depleteNeeds(
  needs: AgentNeedState[],
  elapsedGameMinutes: number,
  needDefs: NeedRegistry,
  currentGameTime: number,
): AgentNeedState[] {
  return needs.map((need) => {
    const def = needDefs.get(need.needId);
    if (!def) return need;

    const depleted = need.currentValue - def.depletionRate * elapsedGameMinutes;
    return {
      ...need,
      currentValue: Math.max(0, depleted),
      lastUpdated: currentGameTime,
    };
  });
}

/**
 * Apply an action's effects to agent needs.
 * Replenishes and costs are both applied, clamped to [0, maxValue].
 *
 * @param needs - Current agent need states
 * @param replenishes - Effects that increase need values
 * @param costs - Effects that decrease need values
 * @param needDefs - The need definitions registry
 * @returns Updated need states with effects applied
 */
export function applyActionEffects(
  needs: AgentNeedState[],
  replenishes: NeedEffect[],
  costs: NeedEffect[],
  needDefs: NeedRegistry,
  gameTime: number,
): AgentNeedState[] {
  // Build a delta map from all effects
  const deltas = new Map<NeedId, number>();
  for (const r of replenishes) {
    deltas.set(r.needId, (deltas.get(r.needId) ?? 0) + r.amount);
  }
  for (const c of costs) {
    deltas.set(c.needId, (deltas.get(c.needId) ?? 0) - c.amount);
  }

  return needs.map((need) => {
    const delta = deltas.get(need.needId);
    if (delta === undefined) return need;

    const def = needDefs.get(need.needId);
    const maxValue = def?.maxValue ?? 100;
    return {
      ...need,
      currentValue: Math.max(0, Math.min(maxValue, need.currentValue + delta)),
      lastUpdated: gameTime,
    };
  });
}

/**
 * Initialize needs for a new agent — all at max value.
 */
export function initializeNeeds(needDefs: NeedRegistry, gameTime: number): AgentNeedState[] {
  return [...needDefs.values()].map((def) => ({
    needId: def.id,
    currentValue: def.maxValue,
    lastUpdated: gameTime,
  }));
}
