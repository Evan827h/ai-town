import { Desire, DesireTag, ScoredAction } from './registries';
import {
  DESIRE_TIEBREAKER_WEIGHT,
  DESIRE_DECAY_RATE_PER_GAME_DAY,
  DESIRE_PRUNE_THRESHOLD,
  DESIRE_MERGE_SIMILARITY_THRESHOLD,
  MAX_WANTS,
  MAX_FEARS,
} from './data/desires';

/**
 * Jaccard similarity between two tag sets: |A∩B| / |A∪B|.
 * Returns 0 if either set is empty.
 */
export function calculateTagOverlap(tagsA: DesireTag[], tagsB: DesireTag[]): number {
  if (tagsA.length === 0 || tagsB.length === 0) return 0;
  const setA = new Set(tagsA);
  const setB = new Set(tagsB);
  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Adjust action scores based on matching desire tags.
 *
 * Wants boost matching actions; fears penalize them.
 * For each action, find the strongest matching want and fear (by intensity × overlap).
 * Apply: score *= (1 + wantMatch * weight) * (1 - fearMatch * weight)
 *
 * Returns a new sorted array (immutable).
 */
export function applyDesireModifiers(
  scored: ScoredAction[],
  desires: Desire[],
  weight: number = DESIRE_TIEBREAKER_WEIGHT,
): ScoredAction[] {
  if (desires.length === 0) {
    return scored.map((s) => ({ ...s }));
  }

  const wants = desires.filter((d) => d.type === 'want');
  const fears = desires.filter((d) => d.type === 'fear');

  const result = scored.map((s) => {
    const actionTags = s.action.desireTags;
    if (!actionTags || actionTags.length === 0) return { ...s };

    // Find strongest want match
    let bestWantMatch = 0;
    for (const want of wants) {
      const overlap = calculateTagOverlap(actionTags, want.tags);
      const match = want.intensity * overlap;
      if (match > bestWantMatch) bestWantMatch = match;
    }

    // Find strongest fear match
    let bestFearMatch = 0;
    for (const fear of fears) {
      const overlap = calculateTagOverlap(actionTags, fear.tags);
      const match = fear.intensity * overlap;
      if (match > bestFearMatch) bestFearMatch = match;
    }

    let newScore = s.score;
    if (bestWantMatch > 0) newScore *= 1 + bestWantMatch * weight;
    if (bestFearMatch > 0) newScore *= 1 - bestFearMatch * weight;

    return { ...s, score: newScore };
  });

  // Re-sort highest first
  result.sort((a, b) => b.score - a.score);
  return result;
}

/**
 * Reduce desire intensity over time.
 * Rate: DESIRE_DECAY_RATE_PER_GAME_DAY per 1440 game-minutes.
 * Clamps to 0.
 */
export function decayDesires(desires: Desire[], elapsedGameMinutes: number): Desire[] {
  const gameDays = elapsedGameMinutes / (24 * 60);
  const decayAmount = DESIRE_DECAY_RATE_PER_GAME_DAY * gameDays;
  return desires.map((d) => ({
    ...d,
    intensity: Math.max(0, d.intensity - decayAmount),
  }));
}

/**
 * Remove desires below the prune threshold.
 */
export function pruneDesires(desires: Desire[]): Desire[] {
  return desires.filter((d) => d.intensity >= DESIRE_PRUNE_THRESHOLD);
}

/**
 * Merge a new desire into the existing list.
 *
 * - If an existing desire of the same type has ≥50% tag overlap (Jaccard):
 *   reinforce it (average intensity, union tags, combine sourceMemoryIds).
 * - Otherwise: add as new; evict weakest of same type if at max capacity.
 *
 * Returns a new array.
 */
export function mergeDesire(existing: Desire[], newDesire: Desire): Desire[] {
  const result = existing.map((d) => ({ ...d }));

  // Find best merge candidate (same type, highest tag overlap)
  let bestIdx = -1;
  let bestOverlap = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i].type !== newDesire.type) continue;
    const overlap = calculateTagOverlap(result[i].tags, newDesire.tags);
    if (overlap >= DESIRE_MERGE_SIMILARITY_THRESHOLD && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    // Merge: average intensity, union tags, combine memory IDs
    const target = result[bestIdx];
    target.intensity = (target.intensity + newDesire.intensity) / 2;
    const tagSet = new Set([...target.tags, ...newDesire.tags]);
    target.tags = [...tagSet] as DesireTag[];
    const memSet = new Set([...target.sourceMemoryIds, ...newDesire.sourceMemoryIds]);
    target.sourceMemoryIds = [...memSet];
  } else {
    // Add as new
    result.push({ ...newDesire });

    // Evict weakest of same type if at capacity
    const maxForType = newDesire.type === 'want' ? MAX_WANTS : MAX_FEARS;
    const sameType = result.filter((d) => d.type === newDesire.type);
    if (sameType.length > maxForType) {
      // Find weakest of same type
      let weakestIdx = -1;
      let weakestIntensity = Infinity;
      for (let i = 0; i < result.length; i++) {
        if (result[i].type === newDesire.type && result[i].intensity < weakestIntensity) {
          weakestIntensity = result[i].intensity;
          weakestIdx = i;
        }
      }
      if (weakestIdx >= 0) {
        result.splice(weakestIdx, 1);
      }
    }
  }

  return result;
}

/**
 * Convert desires to prompt lines for LLM context injection.
 *
 * Format: "You want to: <description> (<intensity label>)"
 *         "You worry about: <description> (<intensity label>)"
 *
 * Intensity labels: 0.7+ = strong, 0.4-0.7 = moderate, <0.4 = slight
 */
export function getDesireContext(desires: Desire[]): string[] {
  if (desires.length === 0) return [];

  const lines: string[] = [];

  const wants = desires.filter((d) => d.type === 'want');
  const fears = desires.filter((d) => d.type === 'fear');

  for (const want of wants) {
    const label = intensityLabel(want.intensity);
    lines.push(`You want to: ${want.description} (${label})`);
  }

  for (const fear of fears) {
    const label = intensityLabel(fear.intensity);
    lines.push(`You worry about: ${fear.description} (${label})`);
  }

  return lines;
}

function intensityLabel(intensity: number): string {
  if (intensity >= 0.7) return 'strong';
  if (intensity >= 0.4) return 'moderate';
  return 'slight';
}
