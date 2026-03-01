import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Psyche tables use two ID types:
 * - agentNeeds, psycheDecisionLog, agentIntents: keyed by agent.id (GameId<'agents'>)
 * - agentRelationships, agentOpinions, agentEmotions: keyed by player.id (GameId<'players'>)
 *
 * This split exists because needs/intents are agent-loop concerns (tied to the agent entity),
 * while relationships/opinions/emotions are identity concerns (tied to the player persona).
 * Each agent has exactly one player; the mapping is 1:1.
 *
 * Timestamps (lastUpdated, lastInteraction) store wall-clock time via Date.now(),
 * converted to game-minutes on read via realMsToGameMinutes().
 */
export const psycheTables = {
  // Live need state for each agent
  agentNeeds: defineTable({
    worldId: v.id('worlds'),
    agentId: v.string(), // GameId<'agents'>
    needId: v.string(),
    currentValue: v.float64(),
    lastUpdated: v.float64(), // game-time timestamp
  })
    .index('by_agent', ['worldId', 'agentId'])
    .index('by_agent_need', ['worldId', 'agentId', 'needId']),

  // Decision log for debug panel — stores scorer output each time agent decides
  psycheDecisionLog: defineTable({
    worldId: v.id('worlds'),
    agentId: v.string(),
    timestamp: v.float64(),
    // The action that was chosen
    chosenActionId: v.string(),
    chosenActionName: v.string(),
    chosenActionEmoji: v.string(),
    chosenScore: v.float64(),
    // Top 5 alternatives with scores for comparison
    alternatives: v.array(
      v.object({
        actionId: v.string(),
        actionName: v.string(),
        actionEmoji: v.string(),
        score: v.float64(),
      }),
    ),
    // Snapshot of need values at decision time
    needsSnapshot: v.array(
      v.object({
        needId: v.string(),
        currentValue: v.float64(),
        maxValue: v.float64(),
        isCritical: v.boolean(),
        urgencyScore: v.optional(v.float64()),
      }),
    ),
    // Which location the agent was at
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
  }).index('by_agent', ['worldId', 'agentId']),

  // Travel commitment — stores the intended action when agent walks to a location.
  // Prevents flip-flopping: agent commits to an action through travel + execution.
  agentIntents: defineTable({
    worldId: v.id('worlds'),
    agentId: v.string(),
    actionId: v.string(),
    actionName: v.string(),
    actionDescription: v.string(),
    actionEmoji: v.string(),
    actionDuration: v.float64(), // game-minutes
    replenishes: v.array(
      v.object({
        needId: v.string(),
        amount: v.float64(),
      }),
    ),
    costs: v.array(
      v.object({
        needId: v.string(),
        amount: v.float64(),
      }),
    ),
    targetLocation: v.string(),
    // Snapshot of which needs were critical at decision time.
    // Used to detect new critical needs during travel (override trigger).
    criticalNeedsAtDecision: v.array(v.string()),
  }).index('by_agent', ['worldId', 'agentId']),

  // Per-agent opinion values on abstract topics (0–10)
  agentOpinions: defineTable({
    worldId: v.id('worlds'),
    agentId: v.string(),
    topicId: v.string(),
    value: v.float64(),
    lastUpdated: v.float64(),
  })
    .index('by_agent', ['worldId', 'agentId'])
    .index('by_agent_topic', ['worldId', 'agentId', 'topicId']),

  // Per-agent emotional state (circumplex: valence + arousal)
  agentEmotions: defineTable({
    worldId: v.id('worlds'),
    agentId: v.string(),
    valence: v.float64(), // -1..1
    arousal: v.float64(), // -1..1
    lastUpdated: v.float64(), // game-time timestamp
  }).index('by_agent', ['worldId', 'agentId']),

  // Directed relationship edges between agents
  agentRelationships: defineTable({
    worldId: v.id('worlds'),
    fromAgentId: v.string(), // observer
    toAgentId: v.string(), // target
    trust: v.float64(), // -100..100
    affinity: v.float64(), // -100..100
    respect: v.float64(), // -100..100
    frequency: v.float64(), // 0..100, decays
    familiarity: v.float64(), // 0..100, only grows
    lastInteraction: v.float64(), // game-time timestamp
  })
    .index('by_agent', ['worldId', 'fromAgentId'])
    .index('by_pair', ['worldId', 'fromAgentId', 'toAgentId']),
};
