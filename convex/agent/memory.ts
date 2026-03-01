import { v } from 'convex/values';
import { ActionCtx, DatabaseReader, internalMutation, internalQuery, query } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { LLMMessage, chatCompletion, fetchEmbedding } from '../util/llm';
import { asyncMap } from '../util/asyncMap';
import { GameId, agentId, conversationId, playerId } from '../aiTown/ids';
import { REFLECTION_IMPORTANCE_THRESHOLD } from '../constants';
import { SerializedPlayer } from '../aiTown/player';
import { memoryFields } from './schema';
import { parseConversationOutcome } from '../../src/psyche/relationships';
import { InteractionOutcome, Desire, DesireTag, DesireExtraction, TopicId } from '../../src/psyche/registries';
import { mergeDesire, pruneDesires } from '../../src/psyche/desires';
import { applyOpinionDeltas } from '../../src/psyche/opinions';
import { ALL_DESIRE_TAGS } from '../../src/psyche/data/desires';
import { OPINION_TOPICS } from '../../src/psyche/data/opinions';

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000; // In ms
// We fetch 10x the number of memories by relevance, to have more candidates
// for sorting by relevance + recency + importance.
const MEMORY_OVERFETCH = 10;
const selfInternal = internal.agent.memory;

export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];
export type MemoryOfType<T extends MemoryType> = Omit<Memory, 'data'> & {
  data: Extract<Memory['data'], { type: T }>;
};

export const getAgentMemories = query({
  args: {
    worldId: v.id('worlds'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .order('desc')
      .take(50);
    return memories;
  },
});

export async function rememberConversation(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  conversationId: GameId<'conversations'>,
) {
  const data = await ctx.runQuery(selfInternal.loadConversation, {
    worldId,
    playerId,
    conversationId,
  });
  if (!data) {
    console.debug(`Conversation ${conversationId} not yet archived, skipping memory creation`);
    return;
  }
  const { player, otherPlayer } = data;
  const messages = await ctx.runQuery(selfInternal.loadMessages, { worldId, conversationId });
  if (!messages.length) {
    return;
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `You are ${player.name}, and you just finished a conversation with ${otherPlayer.name}. Summarize the conversation from ${player.name}'s perspective, using first-person pronouns like "I," and add if you liked or disliked this interaction.

RULES:
- Only include things that were actually said in the conversation below. Do not add details, plans, or promises that were not explicitly stated.
- Do not speculate about future plans unless they were concretely discussed.
- Keep the summary factual and brief (2-3 sentences).

After your summary, on a new line, write exactly one of these labels to classify the interaction:
OUTCOME: positive_social
OUTCOME: negative_social
OUTCOME: helpful
OUTCOME: betrayal
OUTCOME: impressive
OUTCOME: neutral`,
    },
  ];
  const authors = new Set<GameId<'players'>>();
  for (const message of messages) {
    const author = message.author === player.id ? player : otherPlayer;
    authors.add(author.id as GameId<'players'>);
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }
  llmMessages.push({ role: 'user', content: 'Summary:' });
  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 500,
  });
  // Parse OUTCOME: label from LLM output and strip it from the memory text
  const { cleanText, outcome } = parseConversationOutcome(content);
  const description = `Conversation with ${otherPlayer.name} at ${new Date(
    data.conversation._creationTime,
  ).toLocaleString()}: ${cleanText}`;
  const { importance, emotionalWeight } = await calculateImportance(description);
  const { embedding } = await fetchEmbedding(description);
  authors.delete(player.id as GameId<'players'>);
  await ctx.runMutation(selfInternal.insertMemory, {
    agentId,
    playerId: player.id,
    description,
    importance,
    emotionalWeight,
    lastAccess: messages[messages.length - 1]._creationTime,
    data: {
      type: 'conversation',
      conversationId,
      playerIds: [...authors],
    },
    embedding,
  });
  await reflectOnMemories(ctx, worldId, playerId);
  return { description, outcome, messageCount: messages.length };
}

export const loadConversation = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const conversation = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', args.conversationId))
      .first();
    if (!conversation) {
      return null;
    }
    const otherParticipator = await ctx.db
      .query('participatedTogether')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('conversationId', args.conversationId),
      )
      .first();
    if (!otherParticipator) {
      throw new Error(
        `Couldn't find other participant in conversation ${args.conversationId} with player ${args.playerId}`,
      );
    }
    const otherPlayerId = otherParticipator.player2;
    let otherPlayer: SerializedPlayer | Doc<'archivedPlayers'> | null =
      world.players.find((p) => p.id === otherPlayerId) ?? null;
    if (!otherPlayer) {
      otherPlayer = await ctx.db
        .query('archivedPlayers')
        .withIndex('worldId', (q) => q.eq('worldId', world._id).eq('id', otherPlayerId))
        .first();
    }
    if (!otherPlayer) {
      throw new Error(`Conversation ${args.conversationId} other player not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${otherPlayerId} not found`);
    }
    return {
      player: { ...player, name: playerDescription.name },
      conversation,
      otherPlayer: { ...otherPlayer, name: otherPlayerDescription.name },
    };
  },
});

export async function searchMemories(
  ctx: ActionCtx,
  playerId: GameId<'players'>,
  searchEmbedding: number[],
  n: number = 3,
) {
  const candidates = await ctx.vectorSearch('memoryEmbeddings', 'embedding', {
    vector: searchEmbedding,
    filter: (q) => q.eq('playerId', playerId),
    limit: n * MEMORY_OVERFETCH,
  });
  const rankedMemories = await ctx.runMutation(selfInternal.rankAndTouchMemories, {
    candidates,
    n,
  });
  return rankedMemories.map(({ memory }) => memory);
}

function makeRange(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [min, max] as const;
}

function normalize(value: number, range: readonly [number, number]) {
  const [min, max] = range;
  return (value - min) / (max - min);
}

export const rankAndTouchMemories = internalMutation({
  args: {
    candidates: v.array(v.object({ _id: v.id('memoryEmbeddings'), _score: v.number() })),
    n: v.number(),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    const relatedMemories = await asyncMap(args.candidates, async ({ _id }) => {
      const memory = await ctx.db
        .query('memories')
        .withIndex('embeddingId', (q) => q.eq('embeddingId', _id))
        .first();
      if (!memory) throw new Error(`Memory for embedding ${_id} not found`);
      return memory;
    });

    // TODO: fetch <count> recent memories and <count> important memories
    // so we don't miss them in case they were a little less relevant.
    const recencyScore = relatedMemories.map((memory) => {
      const hoursSinceAccess = (ts - memory.lastAccess) / 1000 / 60 / 60;
      return 0.99 ** Math.floor(hoursSinceAccess);
    });
    const relevanceRange = makeRange(args.candidates.map((c) => c._score));
    const importanceRange = makeRange(relatedMemories.map((m) => m.importance));
    const recencyRange = makeRange(recencyScore);
    const emotionalRange = makeRange(relatedMemories.map((m) => m.emotionalWeight ?? 0.5));
    const memoryScores = relatedMemories.map((memory, idx) => ({
      memory,
      overallScore:
        normalize(args.candidates[idx]._score, relevanceRange) +
        normalize(memory.importance, importanceRange) +
        normalize(recencyScore[idx], recencyRange) +
        normalize(memory.emotionalWeight ?? 0.5, emotionalRange),
    }));
    memoryScores.sort((a, b) => b.overallScore - a.overallScore);
    const accessed = memoryScores.slice(0, args.n);
    await asyncMap(accessed, async ({ memory }) => {
      if (memory.lastAccess < ts - MEMORY_ACCESS_THROTTLE) {
        await ctx.db.patch(memory._id, { lastAccess: ts });
      }
    });
    return accessed;
  },
});

export const loadMessages = internalQuery({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args): Promise<Doc<'messages'>[]> => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    return messages;
  },
});

async function calculateImportance(
  description: string,
): Promise<{ importance: number; emotionalWeight: number }> {
  const { content } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: `Rate this memory on two scales. Respond with two numbers separated by a comma, nothing else.
Scale 1 (Importance): 0 = purely mundane (brushing teeth) to 9 = extremely poignant (a break up)
Scale 2 (Emotional intensity): 0.0 = no emotion to 1.0 = overwhelming emotion
Memory: ${description}
Example response: "5, 0.7"`,
      },
    ],
    temperature: 0.0,
    max_tokens: 10,
  });
  const parts = content.split(',').map((s: string) => s.trim());
  let importance = parseFloat(parts[0]);
  let emotionalWeight = parseFloat(parts[1] ?? '0.5');
  if (isNaN(importance)) {
    importance = +(content.match(/\d+/)?.[0] ?? NaN);
  }
  if (isNaN(importance)) {
    console.debug('Could not parse memory importance from: ', content);
    importance = 5;
  }
  if (isNaN(emotionalWeight)) {
    emotionalWeight = 0.5;
  }
  return {
    importance: Math.min(9, Math.max(0, importance)),
    emotionalWeight: Math.min(1, Math.max(0, emotionalWeight)),
  };
}

const { embeddingId: _embeddingId, ...memoryFieldsWithoutEmbeddingId } = memoryFields;

export const insertMemory = internalMutation({
  args: {
    agentId,
    embedding: v.array(v.float64()),
    ...memoryFieldsWithoutEmbeddingId,
  },
  handler: async (ctx, { agentId: _, embedding, ...memory }): Promise<void> => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: memory.playerId,
      embedding,
    });
    await ctx.db.insert('memories', {
      ...memory,
      embeddingId,
    });
  },
});

export const insertReflectionMemories = internalMutation({
  args: {
    worldId: v.id('worlds'),
    playerId,
    reflections: v.array(
      v.object({
        description: v.string(),
        relatedMemoryIds: v.array(v.id('memories')),
        importance: v.number(),
        emotionalWeight: v.optional(v.float64()),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, { playerId, reflections }) => {
    const lastAccess = Date.now();
    for (const { embedding, relatedMemoryIds, ...rest } of reflections) {
      const embeddingId = await ctx.db.insert('memoryEmbeddings', {
        playerId,
        embedding,
      });
      await ctx.db.insert('memories', {
        playerId,
        embeddingId,
        lastAccess,
        ...rest,
        data: {
          type: 'reflection',
          relatedMemoryIds,
        },
      });
    }
  },
});

async function reflectOnMemories(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
) {
  const { memories, lastReflectionTs, name } = await ctx.runQuery(
    internal.agent.memory.getReflectionMemories,
    {
      worldId,
      playerId,
      numberOfItems: 100,
    },
  );

  const recentMemories = memories.filter((m) => m._creationTime > (lastReflectionTs ?? 0));
  const sumOfImportanceScore = recentMemories.reduce((acc, curr) => acc + curr.importance, 0);
  const shouldReflect = sumOfImportanceScore > REFLECTION_IMPORTANCE_THRESHOLD;

  if (!shouldReflect) {
    console.debug(
      `Reflection progress for ${name}: ${sumOfImportanceScore}/${REFLECTION_IMPORTANCE_THRESHOLD} ` +
        `(${recentMemories.length} memories since last reflection)`,
    );
    return false;
  }
  console.debug('sum of importance score = ', sumOfImportanceScore);
  console.debug('Reflecting...');
  const prompt = ['[no prose]', '[Output only JSON]', `You are ${name}, statements about you:`];
  memories.forEach((m, idx) => {
    prompt.push(`Statement ${idx}: ${m.description}`);
  });
  prompt.push('What 3 high-level insights can you infer from the above statements?');
  prompt.push(
    'Return in JSON format, where the key is a list of input statements that contributed to your insights and value is your insight. Make the response parseable by Typescript JSON.parse() function. DO NOT escape characters or include "\n" or white space in response.',
  );
  prompt.push(
    'Example: [{insight: "...", statementIds: [1,2]}, {insight: "...", statementIds: [1]}, ...]',
  );

  const { content: reflection } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: prompt.join('\n'),
      },
    ],
  });

  try {
    const insights = JSON.parse(reflection) as { insight: string; statementIds: number[] }[];
    const memoriesToSave = await asyncMap(insights, async (item) => {
      const relatedMemoryIds = item.statementIds.map((idx: number) => memories[idx]._id);
      const { importance, emotionalWeight } = await calculateImportance(item.insight);
      const { embedding } = await fetchEmbedding(item.insight);
      console.debug('adding reflection memory...', item.insight);
      return {
        description: item.insight,
        embedding,
        importance,
        emotionalWeight,
        relatedMemoryIds,
      };
    });

    await ctx.runMutation(selfInternal.insertReflectionMemories, {
      worldId,
      playerId,
      reflections: memoriesToSave,
    });

    // ─── Psyche extraction from reflections ─────────────────
    try {
      const validTags = ALL_DESIRE_TAGS.join(', ');
      const validTopics = OPINION_TOPICS.map((t) => t.id).join(', ');
      const extractionPrompt = `Given these reflection insights from ${name}, extract structured psyche updates.

Insights:
${memoriesToSave.map((m, i) => `${i + 1}. ${m.description}`).join('\n')}

Return ONLY valid JSON with this structure:
{
  "wants": [{"description": "short goal description", "intensity": 0.1-1.0, "tags": ["social","friendship",...]}],
  "fears": [{"description": "short anxiety description", "intensity": 0.1-1.0, "tags": ["social","safety",...]}],
  "opinionDeltas": [{"topicId": "food|socializing|nature|work|rest", "delta": -2 to 2}]
}

Valid tags: ${validTags}.
Valid topics: ${validTopics}.
Only include wants/fears that are clearly implied. Empty arrays are fine.`;

      const { content: extractionRaw } = await chatCompletion({
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.0,
        max_tokens: 500,
      });
      const extraction = JSON.parse(extractionRaw) as DesireExtraction;

      // Validate and persist desires
      const validTagSet = new Set<string>(ALL_DESIRE_TAGS);
      const validTopicSet = new Set<string>(OPINION_TOPICS.map((t) => t.id));
      const now = Date.now();

      // Load existing desires
      const existingDesireDocs = await ctx.runQuery(
        internal.psyche.functions.getAgentDesiresInternal,
        { worldId, agentId: playerId },
      );
      let desires: Desire[] = existingDesireDocs.map((d: any) => ({
        id: d._id,
        type: d.type as 'want' | 'fear',
        description: d.description,
        intensity: d.intensity,
        tags: d.tags as DesireTag[],
        createdAt: d.createdAt,
        sourceMemoryIds: d.sourceMemoryIds,
      }));

      // Merge extracted wants
      let wantCount = 0;
      for (const want of extraction.wants ?? []) {
        const validatedTags = (want.tags ?? []).filter((t) => validTagSet.has(t)) as DesireTag[];
        if (validatedTags.length === 0 || !want.description) continue;
        const intensity = Math.max(0.1, Math.min(1.0, want.intensity ?? 0.5));
        desires = mergeDesire(desires, {
          id: `want-${now}-${wantCount++}`,
          type: 'want',
          description: want.description,
          intensity,
          tags: validatedTags,
          createdAt: now,
          sourceMemoryIds: memoriesToSave.map((_, i) => `reflection-${i}`),
        });
      }

      // Merge extracted fears
      let fearCount = 0;
      for (const fear of extraction.fears ?? []) {
        const validatedTags = (fear.tags ?? []).filter((t) => validTagSet.has(t)) as DesireTag[];
        if (validatedTags.length === 0 || !fear.description) continue;
        const intensity = Math.max(0.1, Math.min(1.0, fear.intensity ?? 0.5));
        desires = mergeDesire(desires, {
          id: `fear-${now}-${fearCount++}`,
          type: 'fear',
          description: fear.description,
          intensity,
          tags: validatedTags,
          createdAt: now,
          sourceMemoryIds: memoriesToSave.map((_, i) => `reflection-${i}`),
        });
      }

      // Persist desires
      desires = pruneDesires(desires);
      await ctx.runMutation(internal.psyche.functions.bulkUpdateDesires, {
        worldId,
        agentId: playerId,
        desires: desires.map((d) => ({
          type: d.type,
          description: d.description,
          intensity: d.intensity,
          tags: d.tags,
          createdAt: d.createdAt,
          sourceMemoryIds: d.sourceMemoryIds,
        })),
      });

      // Apply opinion deltas if any
      const opinionDeltas = (extraction.opinionDeltas ?? []).filter(
        (d) => validTopicSet.has(d.topicId) && typeof d.delta === 'number',
      );
      if (opinionDeltas.length > 0) {
        const existingOpinionDocs = await ctx.runQuery(
          internal.psyche.functions.getAgentOpinionsInternal,
          { worldId, agentId: playerId },
        );
        if (existingOpinionDocs.length > 0) {
          const opinions = existingOpinionDocs.map((o: any) => ({
            topicId: o.topicId as TopicId,
            value: o.value as number,
            lastUpdated: o.lastUpdated as number,
          }));
          const updatedOpinions = applyOpinionDeltas(
            opinions,
            opinionDeltas.map((d) => ({ topicId: d.topicId as TopicId, delta: d.delta })),
            now,
          );
          await ctx.runMutation(internal.psyche.functions.updateAgentOpinions, {
            worldId,
            agentId: playerId,
            opinions: updatedOpinions.map((o) => ({
              topicId: o.topicId,
              value: o.value,
              lastUpdated: o.lastUpdated,
            })),
          });
        }
      }

      console.debug(
        `[Psyche] ${name}: reflection extraction — ${wantCount} want(s), ${fearCount} fear(s), ${opinionDeltas.length} opinion delta(s)`,
      );
    } catch (extractionError) {
      console.debug('[Psyche] Reflection extraction failed, skipping:', extractionError);
    }
  } catch (e) {
    console.error('error saving or parsing reflection', e);
    console.debug('reflection', reflection);
    return false;
  }
  return true;
}
export const getReflectionMemories = internalQuery({
  args: { worldId: v.id('worlds'), playerId, numberOfItems: v.number() },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', player.id))
      .order('desc')
      .take(args.numberOfItems);

    const lastReflection = await ctx.db
      .query('memories')
      .withIndex('playerId_type', (q) =>
        q.eq('playerId', args.playerId).eq('data.type', 'reflection'),
      )
      .order('desc')
      .first();

    return {
      name: playerDescription.name,
      memories,
      lastReflectionTs: lastReflection?._creationTime,
    };
  },
});

export async function latestMemoryOfType<T extends MemoryType>(
  db: DatabaseReader,
  playerId: GameId<'players'>,
  type: T,
) {
  const entry = await db
    .query('memories')
    .withIndex('playerId_type', (q) => q.eq('playerId', playerId).eq('data.type', type))
    .order('desc')
    .first();
  if (!entry) return null;
  return entry as MemoryOfType<T>;
}
