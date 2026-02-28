import { v } from 'convex/values';
import { query, internalMutation, internalQuery } from '../_generated/server';

// ─── Queries (for frontend debug panel) ────────────────────────

/** Get all need states for an agent (public — for debug UI) */
export const getAgentNeeds = query({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentNeeds')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .collect();
  },
});

/** Get all need states for an agent (internal — for agent loop) */
export const getAgentNeedsInternal = internalQuery({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentNeeds')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .collect();
  },
});

/** Get recent decision log entries for an agent (last 10) */
export const getDecisionLog = query({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('psycheDecisionLog')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .order('desc')
      .take(10);
  },
});

// ─── Mutations (called by agent system) ────────────────────────

/** Initialize needs for a new agent — all at max value */
export const initializeAgentNeeds = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
    needs: v.array(
      v.object({
        needId: v.string(),
        currentValue: v.float64(),
        lastUpdated: v.float64(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const need of args.needs) {
      await ctx.db.insert('agentNeeds', {
        worldId: args.worldId,
        agentId: args.agentId,
        needId: need.needId,
        currentValue: need.currentValue,
        lastUpdated: need.lastUpdated,
      });
    }
  },
});

/** Update need values after depletion or action effects */
export const updateAgentNeeds = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
    needs: v.array(
      v.object({
        needId: v.string(),
        currentValue: v.float64(),
        lastUpdated: v.float64(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const need of args.needs) {
      const existing = await ctx.db
        .query('agentNeeds')
        .withIndex('by_agent_need', (q) =>
          q.eq('worldId', args.worldId).eq('agentId', args.agentId).eq('needId', need.needId),
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          currentValue: need.currentValue,
          lastUpdated: need.lastUpdated,
        });
      } else {
        await ctx.db.insert('agentNeeds', {
          worldId: args.worldId,
          agentId: args.agentId,
          needId: need.needId,
          currentValue: need.currentValue,
          lastUpdated: need.lastUpdated,
        });
      }
    }
  },
});

// ─── Intent functions (travel commitment) ────────────────────

/** Get the agent's current travel intent (if any) */
export const getAgentIntent = internalQuery({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentIntents')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .unique();
  },
});

/** Store a travel intent — agent commits to performing an action upon arrival */
export const setAgentIntent = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
    actionId: v.string(),
    actionName: v.string(),
    actionDescription: v.string(),
    actionEmoji: v.string(),
    actionDuration: v.float64(),
    replenishes: v.array(v.object({ needId: v.string(), amount: v.float64() })),
    costs: v.array(v.object({ needId: v.string(), amount: v.float64() })),
    targetLocation: v.string(),
    criticalNeedsAtDecision: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Clear any existing intent first
    const existing = await ctx.db
      .query('agentIntents')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert('agentIntents', args);
  },
});

/** Clear the agent's travel intent (after execution or override) */
export const clearAgentIntent = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentIntents')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ─── Relationship functions ──────────────────────────────────

/** Get all relationships for an agent (internal — used by agent loop) */
export const getRelationshipsForAgent = internalQuery({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentRelationships')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('fromAgentId', args.agentId))
      .collect();
  },
});

/** Get a specific relationship edge (internal) */
export const getRelationship = internalQuery({
  args: {
    worldId: v.id('worlds'),
    fromAgentId: v.string(),
    toAgentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentRelationships')
      .withIndex('by_pair', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('fromAgentId', args.fromAgentId)
          .eq('toAgentId', args.toAgentId),
      )
      .unique();
  },
});

/** Insert or update a relationship edge */
export const upsertRelationship = internalMutation({
  args: {
    worldId: v.id('worlds'),
    fromAgentId: v.string(),
    toAgentId: v.string(),
    trust: v.float64(),
    affinity: v.float64(),
    respect: v.float64(),
    frequency: v.float64(),
    familiarity: v.float64(),
    lastInteraction: v.float64(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentRelationships')
      .withIndex('by_pair', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('fromAgentId', args.fromAgentId)
          .eq('toAgentId', args.toAgentId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        trust: args.trust,
        affinity: args.affinity,
        respect: args.respect,
        frequency: args.frequency,
        familiarity: args.familiarity,
        lastInteraction: args.lastInteraction,
      });
    } else {
      await ctx.db.insert('agentRelationships', args);
    }
  },
});

/** Initialize both directions of a relationship pair */
export const initializeRelationshipPair = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agent1Id: v.string(),
    agent2Id: v.string(),
    edge1: v.object({
      trust: v.float64(),
      affinity: v.float64(),
      respect: v.float64(),
      frequency: v.float64(),
      familiarity: v.float64(),
      lastInteraction: v.float64(),
    }),
    edge2: v.object({
      trust: v.float64(),
      affinity: v.float64(),
      respect: v.float64(),
      frequency: v.float64(),
      familiarity: v.float64(),
      lastInteraction: v.float64(),
    }),
  },
  handler: async (ctx, args) => {
    const existing1 = await ctx.db
      .query('agentRelationships')
      .withIndex('by_pair', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('fromAgentId', args.agent1Id)
          .eq('toAgentId', args.agent2Id),
      )
      .unique();
    if (!existing1) {
      await ctx.db.insert('agentRelationships', {
        worldId: args.worldId,
        fromAgentId: args.agent1Id,
        toAgentId: args.agent2Id,
        ...args.edge1,
      });
    }

    const existing2 = await ctx.db
      .query('agentRelationships')
      .withIndex('by_pair', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('fromAgentId', args.agent2Id)
          .eq('toAgentId', args.agent1Id),
      )
      .unique();
    if (!existing2) {
      await ctx.db.insert('agentRelationships', {
        worldId: args.worldId,
        fromAgentId: args.agent2Id,
        toAgentId: args.agent1Id,
        ...args.edge2,
      });
    }
  },
});

/** Get all relationships for an agent (public — for debug UI) */
export const getAgentRelationships = query({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentRelationships')
      .withIndex('by_agent', (q) => q.eq('worldId', args.worldId).eq('fromAgentId', args.agentId))
      .collect();
  },
});

/** Look up a player's character name by player ID (for moral profile selection) */
export const getPlayerName = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const desc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId).eq('playerId', args.playerId),
      )
      .first();
    return desc?.name ?? null;
  },
});

/** Find the other participant in a conversation and both player names (for relationship init) */
export const getConversationParticipants = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const participation = await ctx.db
      .query('participatedTogether')
      .withIndex('conversation', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('conversationId', args.conversationId),
      )
      .first();

    if (!participation) return null;

    const otherPlayerId = participation.player2;

    const myDesc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    const otherDesc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', otherPlayerId))
      .first();

    return {
      otherPlayerId,
      myName: myDesc?.name ?? 'Unknown',
      otherName: otherDesc?.name ?? 'Unknown',
    };
  },
});

/** Log a psyche decision for the debug panel */
export const logDecision = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agentId: v.string(),
    timestamp: v.float64(),
    chosenActionId: v.string(),
    chosenActionName: v.string(),
    chosenActionEmoji: v.string(),
    chosenScore: v.float64(),
    alternatives: v.array(
      v.object({
        actionId: v.string(),
        actionName: v.string(),
        actionEmoji: v.string(),
        score: v.float64(),
      }),
    ),
    needsSnapshot: v.array(
      v.object({
        needId: v.string(),
        currentValue: v.float64(),
        maxValue: v.float64(),
        isCritical: v.boolean(),
        urgencyScore: v.float64(),
      }),
    ),
    location: v.string(),
    conflicts: v.optional(
      v.array(
        v.object({
          actionId: v.string(),
          penalty: v.number(),
          values: v.array(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('psycheDecisionLog', {
      worldId: args.worldId,
      agentId: args.agentId,
      timestamp: args.timestamp,
      chosenActionId: args.chosenActionId,
      chosenActionName: args.chosenActionName,
      chosenActionEmoji: args.chosenActionEmoji,
      chosenScore: args.chosenScore,
      alternatives: args.alternatives,
      needsSnapshot: args.needsSnapshot,
      location: args.location,
      conflicts: args.conflicts,
    });
  },
});
