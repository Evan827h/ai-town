import { ActionDefinition, AgentNeedState, NeedRegistry, ScoredAction } from './registries';

/** Multiplier applied when a need is below its critical threshold */
const CRITICAL_MULTIPLIER = 3;

/** Maximum noise percentage (±) added to prevent robotic repetition */
const NOISE_PERCENT = 0.05;

/** Weight applied to cost penalties relative to replenishment value */
const COST_PENALTY_WEIGHT = 0.5;

/**
 * Internal scoring engine shared by both public entry points.
 *
 * @param agentNeeds - The agent's current need states
 * @param availableActions - Actions available at the agent's location
 * @param needDefs - The need definitions registry
 * @param applyNoise - If true, add ±5% noise to prevent robotic repetition
 * @returns Actions sorted by score (best first), with scores
 */
function scoreActionsInternal(
  agentNeeds: AgentNeedState[],
  availableActions: ActionDefinition[],
  needDefs: NeedRegistry,
  applyNoise: boolean,
): ScoredAction[] {
  // Build a lookup for quick need access
  const needMap = new Map(agentNeeds.map((n) => [n.needId, n]));

  const scored: ScoredAction[] = [];

  for (const action of availableActions) {
    let score = 0;

    // Score replenishment value
    for (const effect of action.replenishes) {
      const needState = needMap.get(effect.needId);
      const needDef = needDefs.get(effect.needId);
      if (!needState || !needDef || needDef.maxValue <= 0) continue;

      let urgency =
        ((needDef.maxValue - needState.currentValue) / needDef.maxValue) * needDef.priorityWeight;

      // Critical needs get a big urgency boost
      if (needState.currentValue < needDef.criticalThreshold) {
        urgency *= CRITICAL_MULTIPLIER;
      }

      score += urgency * effect.amount;
    }

    // Subtract cost penalties — depleting an already-low need is worse
    for (const effect of action.costs) {
      const needState = needMap.get(effect.needId);
      const needDef = needDefs.get(effect.needId);
      if (!needState || !needDef || needDef.maxValue <= 0) continue;

      const fullness = needState.currentValue / needDef.maxValue;
      // Lower fullness = higher penalty for depleting further
      score -= (1 - fullness) * Math.abs(effect.amount) * COST_PENALTY_WEIGHT;
    }

    // Optionally add noise to prevent robotic repetition
    if (applyNoise) {
      const noise = 1 + (Math.random() * 2 - 1) * NOISE_PERCENT;
      score *= noise;
    }

    scored.push({ action, score });
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Score and rank available actions based on the agent's current needs.
 *
 * Pure function — deterministic except for the small noise factor.
 * This is the core "psyche disposes" logic: it doesn't know what actions
 * mean, it just scores them generically based on need urgency and effects.
 *
 * Algorithm:
 * 1. For each action, calculate replenishment value weighted by need urgency
 * 2. Subtract cost penalties (weighted by how depleted the need is)
 * 3. Apply ±5% noise to prevent robotic repetition
 * 4. Filter out actions with unmet requirements
 * 5. Return sorted descending by score
 *
 * @param agentNeeds - The agent's current need states
 * @param availableActions - Actions available at the agent's location
 * @param needDefs - The need definitions registry
 * @returns Actions sorted by score (best first), with scores
 */
export function scoreActions(
  agentNeeds: AgentNeedState[],
  availableActions: ActionDefinition[],
  needDefs: NeedRegistry,
): ScoredAction[] {
  return scoreActionsInternal(agentNeeds, availableActions, needDefs, true);
}

/**
 * Score actions with a fixed seed for testing (no randomness).
 * Same as scoreActions but with noise = 0.
 */
export function scoreActionsDeterministic(
  agentNeeds: AgentNeedState[],
  availableActions: ActionDefinition[],
  needDefs: NeedRegistry,
): ScoredAction[] {
  return scoreActionsInternal(agentNeeds, availableActions, needDefs, false);
}
