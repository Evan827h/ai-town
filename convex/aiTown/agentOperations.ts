import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent } from './agent';
import { CONVERSATION_COOLDOWN } from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';

// Psyche imports (pure functions, no browser deps)
import { scoreActions } from '../../src/psyche/scorer';
import { depleteNeeds, applyActionEffects, initializeNeeds } from '../../src/psyche/needs';
import { needRegistry } from '../../src/psyche/data/needs';
import { getActionsForLocation } from '../../src/psyche/data/actions';
import { getLocationAtPosition, getLocationDestination } from '../../src/psyche/data/locations';
import { AgentNeedState } from '../../src/psyche/registries';

/**
 * How many game-minutes pass per real second.
 * At 1.0: eating (30 game-min) takes 30 real seconds, hunger empties in ~11 real minutes.
 * Increase for faster simulation, decrease for slower.
 */
const GAME_TIME_SCALE = 1.0;

/** Convert real milliseconds elapsed to game-minutes */
function realMsToGameMinutes(ms: number): number {
  return (ms / 1000) * GAME_TIME_SCALE;
}

/** Convert game-minutes to real milliseconds (for activity duration) */
function gameMinutesToRealMs(gameMinutes: number): number {
  return (gameMinutes / GAME_TIME_SCALE) * 1000;
}

export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    );
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishRememberConversation',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
    });
  },
});

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),
    type: v.union(v.literal('start'), v.literal('continue'), v.literal('leave')),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    let completionFn;
    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;
      case 'continue':
        completionFn = continueConversationMessage;
        break;
      case 'leave':
        completionFn = leaveConversationMessage;
        break;
      default:
        assertNever(args.type);
    }
    const text = await completionFn(
      ctx,
      args.worldId,
      args.conversationId as GameId<'conversations'>,
      args.playerId as GameId<'players'>,
      args.otherPlayerId as GameId<'players'>,
    );

    await ctx.runMutation(internal.aiTown.agent.agentSendMessage, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      agentId: args.agentId,
      playerId: args.playerId,
      text,
      messageUuid: args.messageUuid,
      leaveConversation: args.type === 'leave',
      operationId: args.operationId,
    });
  },
});

export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { player, agent } = args;
    const map = new WorldMap(args.map);
    const now = Date.now();

    // If currently pathfinding, check for conversation opportunities
    if (player.pathfinding) {
      const justLeftConversation =
        agent.lastConversation && now < agent.lastConversation + CONVERSATION_COOLDOWN;
      const recentlyAttemptedInvite =
        agent.lastInviteAttempt && now < agent.lastInviteAttempt + CONVERSATION_COOLDOWN;

      const invitee =
        justLeftConversation || recentlyAttemptedInvite
          ? undefined
          : await ctx.runQuery(internal.aiTown.agent.findConversationCandidate, {
              now,
              worldId: args.worldId,
              player: args.player,
              otherFreePlayers: args.otherFreePlayers,
            });

      await sleep(Math.random() * 1000);
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'finishDoSomething',
        args: {
          operationId: args.operationId,
          agentId: args.agent.id,
          invitee,
        },
      });
      return;
    }

    // ─── Psyche-driven decision making ─────────────────────────
    //
    // 1. Fetch or initialize needs
    // 2. Deplete needs for elapsed time
    // 3. Check for stored travel intent (commitment mechanism)
    // 4. If no intent: score actions and pick the best
    // 5. Execute: walk to location or start activity
    // 6. Apply action effects and log decision

    // Step 1: Fetch needs (lazy initialization if first time)
    let needDocs = await ctx.runQuery(internal.psyche.functions.getAgentNeeds, {
      worldId: args.worldId,
      agentId: agent.id,
    });

    if (needDocs.length === 0) {
      // First time — initialize all needs at max value
      const initialNeeds = initializeNeeds(needRegistry, now);
      await ctx.runMutation(internal.psyche.functions.initializeAgentNeeds, {
        worldId: args.worldId,
        agentId: agent.id,
        needs: initialNeeds.map((n) => ({
          needId: n.needId,
          currentValue: n.currentValue,
          lastUpdated: n.lastUpdated,
        })),
      });
      needDocs = await ctx.runQuery(internal.psyche.functions.getAgentNeeds, {
        worldId: args.worldId,
        agentId: agent.id,
      });
    }

    // Convert DB docs to AgentNeedState
    let agentNeeds: AgentNeedState[] = needDocs.map(
      (d: { needId: string; currentValue: number; lastUpdated: number }) => ({
        needId: d.needId,
        currentValue: d.currentValue,
        lastUpdated: d.lastUpdated,
      }),
    );

    // Step 2: Deplete needs for elapsed time
    const lastUpdated = Math.min(...agentNeeds.map((n) => n.lastUpdated));
    const elapsedMs = Math.max(0, now - lastUpdated);
    const elapsedGameMinutes = realMsToGameMinutes(elapsedMs);

    if (elapsedGameMinutes > 0) {
      agentNeeds = depleteNeeds(agentNeeds, elapsedGameMinutes, needRegistry, now);
    }

    const location = getLocationAtPosition(player.position);

    // Step 3: Check for stored travel intent (commitment mechanism)
    // When the agent committed to traveling for an action, execute it upon arrival
    // unless a NEW critical need appeared during travel.
    const pendingIntent = await ctx.runQuery(internal.psyche.functions.getAgentIntent, {
      worldId: args.worldId,
      agentId: agent.id,
    });

    if (pendingIntent) {
      const atTargetLocation = pendingIntent.targetLocation === location;

      // Check if a new need became critical that wasn't critical at decision time
      const newCriticalNeed = agentNeeds.some((n) => {
        const def = needRegistry.get(n.needId);
        if (!def) return false;
        const isCriticalNow = n.currentValue < def.criticalThreshold;
        const wasCriticalBefore = pendingIntent.criticalNeedsAtDecision.includes(n.needId);
        return isCriticalNow && !wasCriticalBefore;
      });

      if (atTargetLocation && !newCriticalNeed) {
        // Agent arrived at the intended location — execute the stored action
        console.log(
          `[Psyche] Agent ${agent.id}: arrived at ${location}, executing committed action "${pendingIntent.actionName}"`,
        );

        const updatedNeeds = applyActionEffects(
          agentNeeds,
          pendingIntent.replenishes,
          pendingIntent.costs,
          needRegistry,
        );

        await ctx.runMutation(internal.psyche.functions.updateAgentNeeds, {
          worldId: args.worldId,
          agentId: agent.id,
          needs: updatedNeeds.map((n) => ({
            needId: n.needId,
            currentValue: n.currentValue,
            lastUpdated: n.lastUpdated,
          })),
        });

        await ctx.runMutation(internal.psyche.functions.clearAgentIntent, {
          worldId: args.worldId,
          agentId: agent.id,
        });

        // Log as an intent execution (reuse the decision log format)
        await logPsycheDecision(ctx, args.worldId, agent.id, now,
          [{ action: { id: pendingIntent.actionId, name: pendingIntent.actionName, emoji: pendingIntent.actionEmoji }, score: 0 }],
          updatedNeeds, location);

        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            activity: {
              description: pendingIntent.actionDescription,
              emoji: pendingIntent.actionEmoji,
              until: now + gameMinutesToRealMs(pendingIntent.actionDuration),
            },
          },
        });
        return;
      }

      if (newCriticalNeed) {
        // A new need became critical during travel — override the commitment
        console.log(
          `[Psyche] Agent ${agent.id}: overriding travel intent "${pendingIntent.actionName}" — new critical need detected`,
        );
      } else {
        // Not at target location yet (shouldn't happen often — agent just finished pathfinding)
        console.log(
          `[Psyche] Agent ${agent.id}: intent for "${pendingIntent.actionName}" at ${pendingIntent.targetLocation} but at ${location} — re-evaluating`,
        );
      }

      // Clear the stale intent and fall through to scorer
      await ctx.runMutation(internal.psyche.functions.clearAgentIntent, {
        worldId: args.worldId,
        agentId: agent.id,
      });
    }

    // Step 4: Score all actions (including those at other locations)
    const allActions = getActionsForLocation('*');
    const cafeActions = getActionsForLocation('cafe');
    const homeActions = getActionsForLocation('home');
    const parkActions = getActionsForLocation('park');

    const actionSet = new Map(
      [...cafeActions, ...homeActions, ...parkActions, ...allActions].map((a) => [a.id, a]),
    );
    const allAvailableActions = [...actionSet.values()];

    const scored = scoreActions(agentNeeds, allAvailableActions, needRegistry);

    if (scored.length === 0) {
      await sleep(Math.random() * 1000);
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'finishDoSomething',
        args: {
          operationId: args.operationId,
          agentId: agent.id,
          destination: wanderDestination(map),
        },
      });
      return;
    }

    const bestAction = scored[0];
    const actionLocation = bestAction.action.locationRequirement;

    // Step 5: Execute the action
    const needsAtLocation = !actionLocation || actionLocation === location;

    if (!needsAtLocation) {
      // Agent needs to walk to a different location first
      const destination = getLocationDestination(actionLocation);
      if (destination) {
        console.log(
          `[Psyche] Agent ${agent.id}: walking to ${actionLocation} for "${bestAction.action.name}" (score: ${bestAction.score.toFixed(1)})`,
        );

        // Record which needs are currently critical (for override detection during travel)
        const criticalNeedsNow = agentNeeds
          .filter((n) => {
            const def = needRegistry.get(n.needId);
            return def && n.currentValue < def.criticalThreshold;
          })
          .map((n) => n.needId);

        // Store the travel intent — agent commits to this action
        await ctx.runMutation(internal.psyche.functions.setAgentIntent, {
          worldId: args.worldId,
          agentId: agent.id,
          actionId: bestAction.action.id,
          actionName: bestAction.action.name,
          actionDescription: bestAction.action.description,
          actionEmoji: bestAction.action.emoji,
          actionDuration: bestAction.action.duration,
          replenishes: bestAction.action.replenishes,
          costs: bestAction.action.costs,
          targetLocation: actionLocation,
          criticalNeedsAtDecision: criticalNeedsNow,
        });

        // Deplete needs (time update) but don't apply action effects yet
        await ctx.runMutation(internal.psyche.functions.updateAgentNeeds, {
          worldId: args.worldId,
          agentId: agent.id,
          needs: agentNeeds.map((n) => ({
            needId: n.needId,
            currentValue: n.currentValue,
            lastUpdated: n.lastUpdated,
          })),
        });

        await logPsycheDecision(ctx, args.worldId, agent.id, now, scored, agentNeeds, location);

        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination,
          },
        });
        return;
      }
    }

    // Agent is at the right location — perform the action
    console.log(
      `[Psyche] Agent ${agent.id}: performing "${bestAction.action.name}" at ${location} (score: ${bestAction.score.toFixed(1)})`,
    );

    // Step 6: Apply action effects and update needs
    const updatedNeeds = applyActionEffects(
      agentNeeds,
      bestAction.action.replenishes,
      bestAction.action.costs,
      needRegistry,
    );

    await ctx.runMutation(internal.psyche.functions.updateAgentNeeds, {
      worldId: args.worldId,
      agentId: agent.id,
      needs: updatedNeeds.map((n) => ({
        needId: n.needId,
        currentValue: n.currentValue,
        lastUpdated: n.lastUpdated,
      })),
    });

    await logPsycheDecision(ctx, args.worldId, agent.id, now, scored, updatedNeeds, location);

    // Start the activity
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishDoSomething',
      args: {
        operationId: args.operationId,
        agentId: agent.id,
        activity: {
          description: bestAction.action.description,
          emoji: bestAction.action.emoji,
          until: now + gameMinutesToRealMs(bestAction.action.duration),
        },
      },
    });
  },
});

/** Log a psyche decision for the debug panel */
async function logPsycheDecision(
  ctx: any,
  worldId: any,
  agentIdValue: string,
  timestamp: number,
  scored: { action: { id: string; name: string; emoji: string }; score: number }[],
  needs: AgentNeedState[],
  location: string,
) {
  const best = scored[0];
  const alternatives = scored.slice(1, 6).map((s) => ({
    actionId: s.action.id,
    actionName: s.action.name,
    actionEmoji: s.action.emoji,
    score: Math.round(s.score * 100) / 100,
  }));

  const needsSnapshot = needs.map((n) => {
    const def = needRegistry.get(n.needId);
    return {
      needId: n.needId,
      currentValue: Math.round(n.currentValue * 100) / 100,
      maxValue: def?.maxValue ?? 100,
      isCritical: def ? n.currentValue < def.criticalThreshold : false,
    };
  });

  await ctx.runMutation(internal.psyche.functions.logDecision, {
    worldId,
    agentId: agentIdValue,
    timestamp,
    chosenActionId: best.action.id,
    chosenActionName: best.action.name,
    chosenActionEmoji: best.action.emoji,
    chosenScore: Math.round(best.score * 100) / 100,
    alternatives,
    needsSnapshot,
    location,
  });
}

function wanderDestination(worldMap: WorldMap) {
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}
