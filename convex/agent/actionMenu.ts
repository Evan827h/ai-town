/**
 * LLM Action Menu Generation
 *
 * Generates a contextually curated subset of actions for an agent to consider.
 * The LLM sees the agent's personality, current needs, recent memories,
 * and pre-filtered action list, then selects 3-5 relevant actions.
 *
 * This is the "LLM Proposes" half — psyche scoring still makes the final decision.
 * Never throws — always falls back to the full pre-filtered set on error.
 */

import { ActionCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { chatCompletion } from '../util/llm';
import { searchMemories } from './memory';
import { GameId } from '../aiTown/ids';
import * as embeddingsCache from './embeddingsCache';
import { ActionDefinition, AgentNeedState, NeedId } from '../../src/psyche/registries';
import { serializeActionsForPrompt } from '../../src/psyche/actionPrompt';
import { needRegistry } from '../../src/psyche/data/needs';

export interface ActionMenuResult {
  actionIds: string[];
  rationale: string;
}

interface ActionMenuOptions {
  characterName: string;
  personality: string;
  location: string;
  timeOfDay: string;
  needs: AgentNeedState[];
  actions: ActionDefinition[];
  worldId: Id<'worlds'>;
  playerId: string;
}

const NUM_MEMORIES_FOR_MENU = 8;

/**
 * Generate a curated action menu via LLM.
 * Returns 3-5 action IDs the agent would realistically consider.
 * On any failure, returns the full pre-filtered action set.
 */
export async function generateActionMenu(
  ctx: ActionCtx,
  options: ActionMenuOptions,
): Promise<ActionMenuResult> {
  const validActionIds = new Set(options.actions.map((a) => a.id));

  try {
    // Fetch relevant memories for context
    const memoryLines = await fetchMemoryContext(ctx, options);

    // Build the prompt
    const prompt = buildActionMenuPrompt(options, memoryLines);

    // Call LLM
    const { content } = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 150,
    });

    // Parse response
    const actionIds = parseActionMenuResponse(content, validActionIds);

    if (actionIds.length === 0) {
      console.warn('[ActionMenu] LLM returned no valid action IDs, using full set');
      return { actionIds: [...validActionIds], rationale: 'fallback: no valid IDs' };
    }

    return { actionIds, rationale: 'llm-curated' };
  } catch (e) {
    console.warn('[ActionMenu] Generation failed, using full pre-filtered set:', e);
    return { actionIds: [...validActionIds], rationale: 'fallback: error' };
  }
}

async function fetchMemoryContext(
  ctx: ActionCtx,
  options: ActionMenuOptions,
): Promise<string[]> {
  try {
    const searchQuery = `${options.characterName} at ${options.location}, ${options.timeOfDay}, deciding what to do`;
    const embedding = await embeddingsCache.fetch(ctx, searchQuery);
    const memories = await searchMemories(
      ctx,
      options.playerId as GameId<'players'>,
      embedding,
      NUM_MEMORIES_FOR_MENU,
    );

    return memories.map((m) => {
      const ageMs = Date.now() - m._creationTime;
      const ageLabel = formatTimeAgo(ageMs);
      return `- "${m.description}" (${ageLabel})`;
    });
  } catch (e) {
    console.warn('[ActionMenu] Memory retrieval failed:', e);
    return [];
  }
}

function formatTimeAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildActionMenuPrompt(
  options: ActionMenuOptions,
  memoryLines: string[],
): string {
  const { characterName, personality, location, timeOfDay, needs, actions } = options;

  // Build needs summary
  const needsSummary = needs
    .map((n) => {
      const def = needRegistry.get(n.needId);
      const max = def?.maxValue ?? 100;
      const critical = def && n.currentValue < def.criticalThreshold;
      return `  ${n.needId}: ${Math.round(n.currentValue)}/${max}${critical ? ' (CRITICAL)' : ''}`;
    })
    .join('\n');

  // Build available actions
  const actionsStr = serializeActionsForPrompt(actions);

  // Build memories section
  const memoriesStr =
    memoryLines.length > 0
      ? `Recent memories:\n${memoryLines.join('\n')}`
      : 'No recent memories.';

  return `You are ${characterName}. ${personality}

Current state:
  Location: ${location}
  Time: ${timeOfDay}
${needsSummary}

${memoriesStr}

Available actions:
${actionsStr}

Select 3-5 actions ${characterName} would realistically consider right now given their personality, needs, and memories.
Return ONLY a JSON array of action IDs, nothing else.
Example: ["eat_at_cafe", "chat_with_nearby", "wander"]`;
}

/**
 * Parse the LLM response into validated action IDs.
 * Strips markdown fences, parses JSON, filters against valid IDs.
 */
function parseActionMenuResponse(content: string, validIds: Set<string>): string[] {
  // Strip markdown fences if present
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    console.warn('[ActionMenu] Response is not an array:', parsed);
    return [];
  }

  const validated = parsed.filter((id): id is string => typeof id === 'string' && validIds.has(id));

  if (validated.length < parsed.length) {
    const invalid = parsed.filter((id: unknown) => typeof id !== 'string' || !validIds.has(id));
    console.warn('[ActionMenu] Filtered out invalid action IDs:', invalid);
  }

  return validated;
}
