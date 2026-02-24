import { v } from 'convex/values';
import { query, internalMutation, internalQuery } from '../_generated/server';

// ─── Queries (for frontend debug panel) ────────────────────────

/** Get all need states for an agent */
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
      }),
    ),
    location: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('psycheDecisionLog', args);
  },
});
