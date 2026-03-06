/**
 * Action Menu Pre-filter & Serialization
 *
 * Pure functions for the "LLM Proposes" half of the pipeline.
 * preFilterActions() narrows the full action registry by location + critical needs.
 * serializeActionsForPrompt() formats actions compactly for LLM consumption.
 * getGameTimeOfDay() derives time-of-day from the game clock.
 */

import { ActionDefinition, AgentNeedState, NeedId } from './registries';
import type { NeedRegistry } from './registries';

/**
 * Pre-filter actions by location relevance and critical needs.
 *
 * Rules:
 * 1. Universal actions (no locationRequirement) → always included
 * 2. Current-location actions → always included
 * 3. Other-location actions → included ONLY if they replenish a need
 *    currently below its criticalThreshold
 */
export function preFilterActions(
  allActions: ActionDefinition[],
  agentLocation: string,
  agentNeeds: AgentNeedState[],
  needRegistry: NeedRegistry,
): ActionDefinition[] {
  // Build set of critical need IDs for fast lookup
  const criticalNeedIds = new Set<NeedId>();
  for (const need of agentNeeds) {
    const def = needRegistry.get(need.needId);
    if (def && need.currentValue < def.criticalThreshold) {
      criticalNeedIds.add(need.needId);
    }
  }

  return allActions.filter((action) => {
    // Rule 1: universal actions (no location requirement)
    if (!action.locationRequirement) return true;

    // Rule 2: current-location actions
    if (action.locationRequirement === agentLocation) return true;

    // Rule 3: other-location actions only if they replenish a critical need
    if (criticalNeedIds.size > 0) {
      return action.replenishes.some((effect) => criticalNeedIds.has(effect.needId));
    }

    return false;
  });
}

/**
 * Serialize actions into a compact one-line-per-action format for LLM prompts.
 *
 * Format: [action_id] Display Name — need1 +amt, need2 -amt (location, duration)
 */
export function serializeActionsForPrompt(actions: ActionDefinition[]): string {
  return actions
    .map((a) => {
      // Build effects summary
      const effects: string[] = [];
      for (const r of a.replenishes) {
        effects.push(`${r.needId} +${r.amount}`);
      }
      for (const c of a.costs) {
        effects.push(`${c.needId} -${Math.abs(c.amount)}`);
      }
      const effectStr = effects.length > 0 ? effects.join(', ') : 'no direct effects';
      const loc = a.locationRequirement ?? 'anywhere';
      return `[${a.id}] ${a.name} — ${effectStr} (${loc}, ${a.duration}min)`;
    })
    .join('\n');
}

/**
 * Map game-minutes-since-midnight to a time-of-day label.
 *
 * Buckets:
 *   morning:   360–719   (6:00 AM – 11:59 AM)
 *   afternoon: 720–1079  (12:00 PM – 5:59 PM)
 *   evening:   1080–1319 (6:00 PM – 9:59 PM)
 *   night:     1320–359  (10:00 PM – 5:59 AM)
 */
export function getGameTimeOfDay(gameMinutesSinceMidnight: number): string {
  // Normalize to 0–1439 range
  const m = ((gameMinutesSinceMidnight % 1440) + 1440) % 1440;
  if (m >= 360 && m < 720) return 'morning';
  if (m >= 720 && m < 1080) return 'afternoon';
  if (m >= 1080 && m < 1320) return 'evening';
  return 'night';
}

/**
 * Describes an action injected by the safety hatch because the LLM's curated
 * menu didn't adequately address a critical need.
 */
export interface NeedOverride {
  needId: NeedId;
  injectedActionId: string;
  actionName: string;
  reason: string;
}

/**
 * Safety hatch: inject high-payoff replenishers the LLM excluded for critical needs.
 *
 * For each critical need, compares the best replenisher in the curated set
 * against the best available in the full pre-filtered set. If the curated best
 * is less than half the available best, injects the better action.
 *
 * This ensures agents don't get stuck in critical-need loops when the LLM
 * makes personality-consistent but physically unsustainable choices.
 */
export function injectCriticalNeedActions(
  curatedActions: ActionDefinition[],
  preFilteredActions: ActionDefinition[],
  agentNeeds: AgentNeedState[],
  needRegistry: NeedRegistry,
): { actions: ActionDefinition[]; overrides: NeedOverride[] } {
  const curatedIds = new Set(curatedActions.map((a) => a.id));
  const overrides: NeedOverride[] = [];
  const result = [...curatedActions];

  for (const need of agentNeeds) {
    const def = needRegistry.get(need.needId);
    if (!def || need.currentValue >= def.criticalThreshold) continue;

    // Best replenishment for this need in curated set
    const bestCurated = Math.max(
      0,
      ...curatedActions.flatMap((a) =>
        a.replenishes.filter((e) => e.needId === need.needId).map((e) => e.amount),
      ),
    );

    // Best replenishment for this need in full pre-filtered set
    let bestAction: ActionDefinition | null = null;
    let bestAvailable = 0;
    for (const action of preFilteredActions) {
      if (curatedIds.has(action.id)) continue;
      for (const effect of action.replenishes) {
        if (effect.needId === need.needId && effect.amount > bestAvailable) {
          bestAvailable = effect.amount;
          bestAction = action;
        }
      }
    }

    // Inject if curated best is less than half the available best
    if (bestAction && bestCurated < bestAvailable * 0.5) {
      result.push(bestAction);
      curatedIds.add(bestAction.id);
      overrides.push({
        needId: need.needId,
        injectedActionId: bestAction.id,
        actionName: bestAction.name,
        reason: `${need.needId} critically low (${Math.round(need.currentValue)}/${def.maxValue})`,
      });
    }
  }

  return { actions: result, overrides };
}

/**
 * Derive game-minutes-since-midnight from wall-clock time and game time scale.
 *
 * With GAME_TIME_SCALE = 1.0, 1 real second = 1 game minute.
 * A full game day (1440 game-minutes) takes 24 real minutes.
 */
export function getGameMinutesSinceMidnight(
  wallClockMs: number,
  gameTimeScale: number,
): number {
  const totalGameMinutes = (wallClockMs / 1000) * gameTimeScale;
  return ((totalGameMinutes % 1440) + 1440) % 1440;
}
