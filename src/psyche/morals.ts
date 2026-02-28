import { ScoredAction, MoralProfile } from './registries';

export interface MoralConflict {
  actionId: string;
  /** Combined penalty that exceeded the conflict threshold */
  penalty: number;
  /** Which moral value IDs were violated */
  values: string[];
}

export interface MoralFilterResult {
  /** Surviving actions with adjusted scores, sorted descending */
  actions: ScoredAction[];
  /** Actions that passed but triggered internal conflict */
  conflicts: MoralConflict[];
}

/**
 * Apply the agent's moral profile to a ranked list of scored actions.
 *
 * For each action:
 *   - For each moralCost: effectiveSeverity = severity × profile.weights[moralValueId]
 *   - If effectiveSeverity >= hardVetoThreshold → action removed (hard veto)
 *   - Otherwise: accumulate totalPenalty, apply as score × (1 - totalPenalty)
 *   - If totalPenalty > conflictThreshold → record as internal conflict
 *
 * Pure function — no side effects. Caller handles logging/persistence.
 */
export function applyMoralFilter(
  scored: ScoredAction[],
  profile: MoralProfile,
): MoralFilterResult {
  const conflicts: MoralConflict[] = [];
  const filtered: ScoredAction[] = [];

  for (const sa of scored) {
    const moralCosts = sa.action.moralCosts ?? [];

    if (moralCosts.length === 0) {
      filtered.push(sa);
      continue;
    }

    let totalPenalty = 0;
    let vetoed = false;
    const violatedValues: string[] = [];

    for (const cost of moralCosts) {
      const weight = profile.weights[cost.moralValueId] ?? 0;
      const effectiveSeverity = cost.severity * weight;

      if (effectiveSeverity >= profile.hardVetoThreshold) {
        vetoed = true;
        break;
      }

      totalPenalty += effectiveSeverity;
      if (effectiveSeverity > 0.1) {
        violatedValues.push(cost.moralValueId);
      }
    }

    if (vetoed) continue;

    const adjustedScore = sa.score * (1 - totalPenalty);

    if (totalPenalty > profile.conflictThreshold) {
      conflicts.push({
        actionId: sa.action.id,
        penalty: Math.round(totalPenalty * 1000) / 1000,
        values: violatedValues,
      });
    }

    filtered.push({ ...sa, score: adjustedScore });
  }

  filtered.sort((a, b) => b.score - a.score);

  return { actions: filtered, conflicts };
}
