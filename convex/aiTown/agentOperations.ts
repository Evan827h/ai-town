import { v } from 'convex/values';
import { ActionCtx, internalAction } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { serializedAgent } from './agent';
import { CONVERSATION_COOLDOWN } from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';

// Psyche imports (pure functions, no browser deps)
import { scoreActions } from '../../src/psyche/scorer';
import { depleteNeeds, applyActionEffects, initializeNeeds } from '../../src/psyche/needs';
import { needRegistry } from '../../src/psyche/data/needs';
import { getActionsForLocation, getAllActions } from '../../src/psyche/data/actions';
import { getLocationAtPosition, getLocationDestination } from '../../src/psyche/data/locations';
import { ActionEffect, AgentNeedState, AgentOpinion, EmotionalState, NeedId, RelationshipEdge, TopicId } from '../../src/psyche/registries';
import {
  applyRelationshipModifiers,
  initializeRelationship,
  updateRelationship,
} from '../../src/psyche/relationships';
import { CHARACTER_DISPOSITIONS, DEFAULT_DISPOSITION } from '../../src/psyche/data/relationships';
import { applyMoralFilter, MoralConflict } from '../../src/psyche/morals';
import { MORAL_PROFILES, DEFAULT_MORAL_PROFILE } from '../../src/psyche/data/morals';
import { applyOpinionDeltas } from '../../src/psyche/opinions';
import { CHARACTER_OPINIONS, DEFAULT_OPINIONS, OUTCOME_OPINION_DELTAS } from '../../src/psyche/data/opinions';
import {
  decayEmotion,
  transferEmotion,
  applyEmotionDelta,
  relationshipToCloseness,
  initializeEmotion,
} from '../../src/psyche/emotions';
import {
  CHARACTER_EMOTIONS,
  DEFAULT_EMOTIONAL_PROFILE,
  CONTAGION_MAX_DISTANCE,
  OUTCOME_EMOTION_DELTAS,
} from '../../src/psyche/data/emotions';
import { actionRegistry } from '../../src/psyche/data/actions';

/** Need effects applied when a conversation ends */
const CONVERSATION_NEED_REPLENISHES: ActionEffect[] = [
  { needId: 'social', amount: 20 },
  { needId: 'fun', amount: 8 },
];
const CONVERSATION_NEED_COSTS: ActionEffect[] = [
  { needId: 'energy', amount: 3 },
];

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
    const result = await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    );

    // rememberConversation returns null if conversation wasn't archived yet.
    // When null, skip all psyche updates — we have no LLM-determined outcome,
    // and defaulting would create phantom positive reinforcement.
    if (result) {
      const { outcome, messageCount } = result;

      // ─── Update relationship after conversation ────────────
      const participants = await ctx.runQuery(internal.psyche.functions.getConversationParticipants, {
        worldId: args.worldId,
        playerId: args.playerId,
        conversationId: args.conversationId,
      });

      if (participants) {
        const { otherPlayerId, myName, otherName } = participants;
        const now = Date.now();

        // Fetch existing edges (may be null for first meeting)
        const myEdge = await ctx.runQuery(internal.psyche.functions.getRelationship, {
          worldId: args.worldId,
          fromAgentId: args.playerId,
          toAgentId: otherPlayerId,
        });

        if (myEdge) {
          // Existing relationship — update with LLM-determined outcome
          const asEdge: RelationshipEdge = {
            fromAgentId: myEdge.fromAgentId,
            toAgentId: myEdge.toAgentId,
            trust: myEdge.trust,
            affinity: myEdge.affinity,
            respect: myEdge.respect,
            frequency: myEdge.frequency,
            familiarity: myEdge.familiarity,
            lastInteraction: myEdge.lastInteraction,
          };
          const updated = updateRelationship(asEdge, outcome, now);
          await ctx.runMutation(internal.psyche.functions.upsertRelationship, {
            worldId: args.worldId,
            fromAgentId: args.playerId,
            toAgentId: otherPlayerId,
            trust: updated.trust,
            affinity: updated.affinity,
            respect: updated.respect,
            frequency: updated.frequency,
            familiarity: updated.familiarity,
            lastInteraction: updated.lastInteraction,
          });
        } else {
          // First meeting — initialize from dispositions then apply outcome
          const myDisp = CHARACTER_DISPOSITIONS[myName] ?? DEFAULT_DISPOSITION;
          const freshEdge = initializeRelationship(myDisp, args.playerId, otherPlayerId, now);
          const updated = updateRelationship(freshEdge, outcome, now);
          await ctx.runMutation(internal.psyche.functions.upsertRelationship, {
            worldId: args.worldId,
            fromAgentId: args.playerId,
            toAgentId: otherPlayerId,
            trust: updated.trust,
            affinity: updated.affinity,
            respect: updated.respect,
            frequency: updated.frequency,
            familiarity: updated.familiarity,
            lastInteraction: updated.lastInteraction,
          });
        }

        console.log(
          `[Psyche] ${myName} (${args.playerId}): updated relationship with ${otherName} (${otherPlayerId}) — ${outcome} (LLM-determined, ${messageCount} messages)`,
        );

        // ─── Apply conversation need effects ────────────────
        const needDocs = await ctx.runQuery(internal.psyche.functions.getAgentNeedsInternal, {
          worldId: args.worldId,
          agentId: args.agentId,
        });

        if (needDocs.length > 0) {
          const agentNeeds: AgentNeedState[] = needDocs.map(
            (d: { needId: string; currentValue: number; lastUpdated: number }) => ({
              needId: d.needId as NeedId,
              currentValue: d.currentValue,
              lastUpdated: d.lastUpdated,
            }),
          );

          const updatedNeeds = applyActionEffects(
            agentNeeds,
            CONVERSATION_NEED_REPLENISHES,
            CONVERSATION_NEED_COSTS,
            needRegistry,
            now,
          );

          await ctx.runMutation(internal.psyche.functions.updateAgentNeeds, {
            worldId: args.worldId,
            agentId: args.agentId,
            needs: updatedNeeds.map((n) => ({
              needId: n.needId,
              currentValue: n.currentValue,
              lastUpdated: n.lastUpdated,
            })),
          });

          console.log(
            `[Psyche] ${myName} (${args.playerId}): conversation needs updated — social +20, fun +8, energy -3`,
          );
        }

        // ─── Update opinions after conversation ────────────────
        const opinionDeltas = OUTCOME_OPINION_DELTAS[outcome];
        if (opinionDeltas.length > 0) {
          const opinionDocs = await ctx.runQuery(internal.psyche.functions.getAgentOpinionsInternal, {
            worldId: args.worldId,
            agentId: args.playerId,
          });

          let opinions: AgentOpinion[];
          if (opinionDocs.length > 0) {
            opinions = opinionDocs.map(
              (d: { topicId: string; value: number; lastUpdated: number }) => ({
                topicId: d.topicId as TopicId,
                value: d.value,
                lastUpdated: d.lastUpdated,
              }),
            );
          } else {
            // Lazy-initialize from character defaults
            const defaults = CHARACTER_OPINIONS[myName] ?? DEFAULT_OPINIONS;
            opinions = Object.entries(defaults).map(([topicId, value]) => ({
              topicId: topicId as TopicId,
              value,
              lastUpdated: now,
            }));
            await ctx.runMutation(internal.psyche.functions.initializeAgentOpinions, {
              worldId: args.worldId,
              agentId: args.playerId,
              opinions: opinions.map((o) => ({
                topicId: o.topicId,
                value: o.value,
                lastUpdated: o.lastUpdated,
              })),
            });
          }

          const updatedOpinions = applyOpinionDeltas(opinions, opinionDeltas, now);
          await ctx.runMutation(internal.psyche.functions.updateAgentOpinions, {
            worldId: args.worldId,
            agentId: args.playerId,
            opinions: updatedOpinions.map((o) => ({
              topicId: o.topicId,
              value: o.value,
              lastUpdated: o.lastUpdated,
            })),
          });

          const deltaStr = opinionDeltas
            .map((d) => `${d.topicId} ${d.delta > 0 ? '+' : ''}${d.delta}`)
            .join(', ');
          console.log(
            `[Psyche] ${myName}: opinions updated — ${outcome} → ${deltaStr}`,
          );
        }

        // ─── Update emotion after conversation ────────────────
        const emotionDelta = OUTCOME_EMOTION_DELTAS[outcome];
        if (emotionDelta.valence !== 0 || emotionDelta.arousal !== 0) {
          const convEmotionProfile = CHARACTER_EMOTIONS[myName] ?? DEFAULT_EMOTIONAL_PROFILE;

          let convEmotionDoc = await ctx.runQuery(internal.psyche.functions.getAgentEmotionInternal, {
            worldId: args.worldId,
            agentId: args.playerId,
          });

          let convEmotion: EmotionalState;
          if (convEmotionDoc) {
            convEmotion = {
              valence: convEmotionDoc.valence,
              arousal: convEmotionDoc.arousal,
              lastUpdated: convEmotionDoc.lastUpdated,
            };
          } else {
            // Lazy-initialize from character baseline
            convEmotion = initializeEmotion(convEmotionProfile, now);
            await ctx.runMutation(internal.psyche.functions.initializeAgentEmotion, {
              worldId: args.worldId,
              agentId: args.playerId,
              valence: convEmotion.valence,
              arousal: convEmotion.arousal,
              lastUpdated: convEmotion.lastUpdated,
            });
          }

          const updatedEmotion = applyEmotionDelta(convEmotion, emotionDelta, now);
          await ctx.runMutation(internal.psyche.functions.updateAgentEmotion, {
            worldId: args.worldId,
            agentId: args.playerId,
            valence: updatedEmotion.valence,
            arousal: updatedEmotion.arousal,
            lastUpdated: updatedEmotion.lastUpdated,
          });

          console.log(
            `[Psyche] ${myName}: emotion after conversation — ${outcome} → valence ${emotionDelta.valence >= 0 ? '+' : ''}${emotionDelta.valence}, arousal ${emotionDelta.arousal >= 0 ? '+' : ''}${emotionDelta.arousal}`,
          );
        }
      }
    } else {
      console.debug(`[Psyche] Conversation ${args.conversationId} not archived yet — skipping psyche updates`);
    }

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
    let text: string;

    if (args.type === 'leave') {
      // ─── Pre-leave scoring: decide next action BEFORE generating goodbye ───
      let nextPlan: string | undefined;

      // Fetch the player's position for location-based scoring
      const promptData = await ctx.runQuery(internal.agent.conversation.queryPromptData, {
        worldId: args.worldId,
        playerId: args.playerId,
        otherPlayerId: args.otherPlayerId,
        conversationId: args.conversationId,
      });

      // Fetch current needs and deplete for elapsed time
      const needDocs = await ctx.runQuery(internal.psyche.functions.getAgentNeedsInternal, {
        worldId: args.worldId,
        agentId: args.agentId,
      });

      if (needDocs.length > 0) {
        const now = Date.now();
        let agentNeeds: AgentNeedState[] = needDocs.map(
          (d: { needId: string; currentValue: number; lastUpdated: number }) => ({
            needId: d.needId as NeedId,
            currentValue: d.currentValue,
            lastUpdated: d.lastUpdated,
          }),
        );

        // Deplete for elapsed time
        const lastUpdated = Math.min(...agentNeeds.map((n) => n.lastUpdated));
        const elapsedMs = Math.max(0, now - lastUpdated);
        const elapsedGameMinutes = realMsToGameMinutes(elapsedMs);
        if (elapsedGameMinutes > 0) {
          agentNeeds = depleteNeeds(agentNeeds, elapsedGameMinutes, needRegistry, now);
        }

        // Preview conversation effects (don't persist — just for scoring)
        const predictedNeeds = applyActionEffects(
          agentNeeds,
          CONVERSATION_NEED_REPLENISHES,
          CONVERSATION_NEED_COSTS,
          needRegistry,
          now,
        );

        // Score with predicted post-conversation needs
        const result = await scoreNextAction(
          ctx,
          args.worldId,
          args.agentId,
          args.playerId,
          promptData.player.position,
          [], // no nearby player info available here — relationship modifiers will be approximate
          predictedNeeds,
        );

        if (result && result.scored.length > 0) {
          const bestAction = result.scored[0];
          nextPlan = `${bestAction.action.name} ${bestAction.action.emoji}`;

          // Store as intent so agentDoSomething follows through
          const criticalNeedsNow = predictedNeeds
            .filter((n) => {
              const def = needRegistry.get(n.needId);
              return def && n.currentValue < def.criticalThreshold;
            })
            .map((n) => n.needId);

          await ctx.runMutation(internal.psyche.functions.setAgentIntent, {
            worldId: args.worldId,
            agentId: args.agentId,
            actionId: bestAction.action.id,
            actionName: bestAction.action.name,
            actionDescription: bestAction.action.description,
            actionEmoji: bestAction.action.emoji,
            actionDuration: bestAction.action.duration,
            replenishes: bestAction.action.replenishes,
            costs: bestAction.action.costs,
            targetLocation: bestAction.action.locationRequirement ?? result.location,
            criticalNeedsAtDecision: criticalNeedsNow,
          });

          console.log(
            `[Psyche] Agent ${args.agentId}: pre-leave scored next action "${bestAction.action.name}" (score: ${bestAction.score.toFixed(1)})`,
          );
        }
      }

      text = await leaveConversationMessage(
        ctx,
        args.worldId,
        args.conversationId as GameId<'conversations'>,
        args.playerId as GameId<'players'>,
        args.otherPlayerId as GameId<'players'>,
        nextPlan,
      );
    } else if (args.type === 'start' || args.type === 'continue') {
      // Start or continue — unchanged
      const completionFn = args.type === 'start' ? startConversationMessage : continueConversationMessage;
      text = await completionFn(
        ctx,
        args.worldId,
        args.conversationId as GameId<'conversations'>,
        args.playerId as GameId<'players'>,
        args.otherPlayerId as GameId<'players'>,
      );
    } else {
      const _exhaustive: never = args.type;
      throw new Error(`Unexpected message type: ${args.type}`);
    }

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

/**
 * Run the psyche scorer to determine the best next action.
 * Used by both agentDoSomething (normal decisions) and agentGenerateMessage (pre-leave scoring).
 *
 * @param predictedNeeds - If provided, use these instead of fetching/depleting from DB.
 *                         Used for pre-leave scoring where we predict post-conversation needs.
 * @returns The top scored action and the needs used for scoring, or null if no actions available.
 */
async function scoreNextAction(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: string,
  playerId: string,
  playerPosition: { x: number; y: number },
  nearbyPlayerIds: string[],
  predictedNeeds?: AgentNeedState[],
): Promise<{ scored: ReturnType<typeof scoreActions>; needs: AgentNeedState[]; location: string; conflicts: MoralConflict[] } | null> {
  let agentNeeds: AgentNeedState[];

  if (predictedNeeds) {
    agentNeeds = predictedNeeds;
  } else {
    const needDocs = await ctx.runQuery(internal.psyche.functions.getAgentNeedsInternal, {
      worldId,
      agentId,
    });
    if (needDocs.length === 0) return null;

    agentNeeds = needDocs.map(
      (d: { needId: string; currentValue: number; lastUpdated: number }) => ({
        needId: d.needId as NeedId,
        currentValue: d.currentValue,
        lastUpdated: d.lastUpdated,
      }),
    );

    // Deplete needs for elapsed time
    const now = Date.now();
    const lastUpdated = Math.min(...agentNeeds.map((n) => n.lastUpdated));
    const elapsedMs = Math.max(0, now - lastUpdated);
    const elapsedGameMinutes = realMsToGameMinutes(elapsedMs);
    if (elapsedGameMinutes > 0) {
      agentNeeds = depleteNeeds(agentNeeds, elapsedGameMinutes, needRegistry, now);
    }
  }

  const location = getLocationAtPosition(playerPosition);

  const allAvailableActions = getAllActions();

  const baseScored = scoreActions(agentNeeds, allAvailableActions, needRegistry);

  // Apply relationship modifiers
  const relDocs = await ctx.runQuery(internal.psyche.functions.getRelationshipsForAgent, {
    worldId,
    agentId: playerId, // relationships keyed by player ID
  });
  const relationships: RelationshipEdge[] = relDocs.map((d: any) => ({
    fromAgentId: d.fromAgentId,
    toAgentId: d.toAgentId,
    trust: d.trust,
    affinity: d.affinity,
    respect: d.respect,
    frequency: d.frequency,
    familiarity: d.familiarity,
    lastInteraction: d.lastInteraction,
  }));
  const relScored = applyRelationshipModifiers(baseScored, relationships, nearbyPlayerIds);

  // Look up the character's name to select their moral profile
  const characterName = await ctx.runQuery(internal.psyche.functions.getPlayerName, {
    worldId,
    playerId,
  });
  const moralProfile = MORAL_PROFILES[characterName ?? ''] ?? DEFAULT_MORAL_PROFILE;
  const { actions: scored, conflicts } = applyMoralFilter(relScored, moralProfile);

  if (conflicts.length > 0) {
    console.log(
      `[Psyche] Agent ${agentId}: moral conflict — ${conflicts.map((c) => `${c.actionId} (${c.values.join(', ')})`).join('; ')}`,
    );
  }

  if (scored.length === 0) return null;

  return { scored, needs: agentNeeds, location, conflicts };
}

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
    let needDocs = await ctx.runQuery(internal.psyche.functions.getAgentNeedsInternal, {
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
      needDocs = await ctx.runQuery(internal.psyche.functions.getAgentNeedsInternal, {
        worldId: args.worldId,
        agentId: agent.id,
      });
    }

    // Convert DB docs to AgentNeedState
    let agentNeeds: AgentNeedState[] = needDocs.map(
      (d: { needId: string; currentValue: number; lastUpdated: number }) => ({
        needId: d.needId as NeedId,
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

    // Step 2.5: Emotional decay + contagion
    // Fetch character name → emotional profile
    const emotionCharName = await ctx.runQuery(internal.psyche.functions.getPlayerName, {
      worldId: args.worldId,
      playerId: player.id,
    });
    const emotionProfile = CHARACTER_EMOTIONS[emotionCharName ?? ''] ?? DEFAULT_EMOTIONAL_PROFILE;

    // Fetch or lazy-init emotional state
    let emotionDoc = await ctx.runQuery(internal.psyche.functions.getAgentEmotionInternal, {
      worldId: args.worldId,
      agentId: player.id,
    });

    let emotionState: EmotionalState;
    if (emotionDoc) {
      emotionState = {
        valence: emotionDoc.valence,
        arousal: emotionDoc.arousal,
        lastUpdated: emotionDoc.lastUpdated,
      };
    } else {
      emotionState = initializeEmotion(emotionProfile, now);
      await ctx.runMutation(internal.psyche.functions.initializeAgentEmotion, {
        worldId: args.worldId,
        agentId: player.id,
        valence: emotionState.valence,
        arousal: emotionState.arousal,
        lastUpdated: emotionState.lastUpdated,
      });
    }

    // Decay toward baseline
    const preDecay = { v: emotionState.valence, a: emotionState.arousal };
    if (elapsedGameMinutes > 0) {
      emotionState = decayEmotion(emotionState, elapsedGameMinutes, emotionProfile.baseline);
    }

    // Contagion: absorb emotions from nearby agents
    let totalDValence = 0;
    let totalDArousal = 0;

    for (const otherPlayer of args.otherFreePlayers) {
      const dx = player.position.x - otherPlayer.position.x;
      const dy = player.position.y - otherPlayer.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > CONTAGION_MAX_DISTANCE) continue;

      // Fetch the other agent's emotional state (skip if not initialized)
      const otherEmotionDoc = await ctx.runQuery(internal.psyche.functions.getAgentEmotionInternal, {
        worldId: args.worldId,
        agentId: otherPlayer.id,
      });
      if (!otherEmotionDoc) continue;

      const otherEmotion: EmotionalState = {
        valence: otherEmotionDoc.valence,
        arousal: otherEmotionDoc.arousal,
        lastUpdated: otherEmotionDoc.lastUpdated,
      };

      // Get relationship for closeness
      const relDoc = await ctx.runQuery(internal.psyche.functions.getRelationship, {
        worldId: args.worldId,
        fromAgentId: player.id,
        toAgentId: otherPlayer.id,
      });
      const closeness = relationshipToCloseness(
        relDoc
          ? {
              fromAgentId: relDoc.fromAgentId,
              toAgentId: relDoc.toAgentId,
              trust: relDoc.trust,
              affinity: relDoc.affinity,
              respect: relDoc.respect,
              frequency: relDoc.frequency,
              familiarity: relDoc.familiarity,
              lastInteraction: relDoc.lastInteraction,
            }
          : null,
      );

      // Look up the sender's charisma
      const otherCharName = await ctx.runQuery(internal.psyche.functions.getPlayerName, {
        worldId: args.worldId,
        playerId: otherPlayer.id,
      });
      const senderProfile = CHARACTER_EMOTIONS[otherCharName ?? ''] ?? DEFAULT_EMOTIONAL_PROFILE;

      // Composite: receiver's receptivity, sender's charisma
      const compositeProfile = {
        baseline: emotionProfile.baseline,
        receptivity: emotionProfile.receptivity,
        charisma: senderProfile.charisma,
      };

      const delta = transferEmotion(otherEmotion, emotionState, distance, closeness, compositeProfile);
      totalDValence += delta.dValence;
      totalDArousal += delta.dArousal;
    }

    // Apply contagion deltas
    if (totalDValence !== 0 || totalDArousal !== 0) {
      emotionState = applyEmotionDelta(emotionState, { valence: totalDValence, arousal: totalDArousal }, now);
    }

    // Persist decayed + contagioned emotion
    await ctx.runMutation(internal.psyche.functions.updateAgentEmotion, {
      worldId: args.worldId,
      agentId: player.id,
      valence: emotionState.valence,
      arousal: emotionState.arousal,
      lastUpdated: emotionState.lastUpdated,
    });

    if (preDecay.v !== emotionState.valence || preDecay.a !== emotionState.arousal) {
      const contagionStr = totalDValence !== 0 || totalDArousal !== 0
        ? `, contagion: v${totalDValence >= 0 ? '+' : ''}${totalDValence.toFixed(3)}/a${totalDArousal >= 0 ? '+' : ''}${totalDArousal.toFixed(3)}`
        : '';
      console.log(
        `[Psyche] ${emotionCharName ?? agent.id}: emotion ${preDecay.v.toFixed(2)}/${preDecay.a.toFixed(2)} → ${emotionState.valence.toFixed(2)}/${emotionState.arousal.toFixed(2)}${contagionStr}`,
      );
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
          pendingIntent.replenishes.map((r: { needId: string; amount: number }) => ({ ...r, needId: r.needId as NeedId })),
          pendingIntent.costs.map((c: { needId: string; amount: number }) => ({ ...c, needId: c.needId as NeedId })),
          needRegistry,
          now,
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

        // Apply action emotional effects (look up from registry)
        const intentAction = actionRegistry.get(pendingIntent.actionId);
        if (intentAction?.emotionalEffects) {
          emotionState = applyEmotionDelta(emotionState, intentAction.emotionalEffects, now);
          await ctx.runMutation(internal.psyche.functions.updateAgentEmotion, {
            worldId: args.worldId,
            agentId: player.id,
            valence: emotionState.valence,
            arousal: emotionState.arousal,
            lastUpdated: emotionState.lastUpdated,
          });
        }

        await ctx.runMutation(internal.psyche.functions.clearAgentIntent, {
          worldId: args.worldId,
          agentId: agent.id,
        });

        // Log as an intent execution (reuse the decision log format)
        await logPsycheDecision(
          ctx,
          args.worldId,
          agent.id,
          now,
          [
            {
              action: {
                id: pendingIntent.actionId,
                name: pendingIntent.actionName,
                emoji: pendingIntent.actionEmoji,
              },
              score: 0,
            },
          ],
          updatedNeeds,
          location,
        );

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
              actionId: pendingIntent.actionId,
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

    // Step 4: Score all actions (delegated to helper)
    const result = await scoreNextAction(
      ctx,
      args.worldId,
      agent.id,
      player.id,
      player.position,
      args.otherFreePlayers.map((p) => p.id),
      agentNeeds, // pass already-depleted needs
    );

    if (!result) {
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

    const { scored } = result;
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

        await logPsycheDecision(ctx, args.worldId, agent.id, now, scored, agentNeeds, location, result.conflicts);

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
      now,
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

    // Apply action emotional effects
    if (bestAction.action.emotionalEffects) {
      emotionState = applyEmotionDelta(emotionState, bestAction.action.emotionalEffects, now);
      await ctx.runMutation(internal.psyche.functions.updateAgentEmotion, {
        worldId: args.worldId,
        agentId: player.id,
        valence: emotionState.valence,
        arousal: emotionState.arousal,
        lastUpdated: emotionState.lastUpdated,
      });
    }

    await logPsycheDecision(ctx, args.worldId, agent.id, now, scored, updatedNeeds, location, result.conflicts);

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
          actionId: bestAction.action.id,
        },
      },
    });
  },
});

/** Log a psyche decision for the debug panel */
async function logPsycheDecision(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentIdValue: string,
  timestamp: number,
  scored: { action: { id: string; name: string; emoji: string }; score: number }[],
  needs: AgentNeedState[],
  location: string,
  conflicts?: MoralConflict[],
) {
  const best = scored[0];
  const alternatives = scored.slice(1, 6).map((s) => ({
    actionId: s.action.id,
    actionName: s.action.name,
    actionEmoji: s.action.emoji,
    score: Math.round(s.score * 100) / 100,
  }));

  const CRITICAL_MULTIPLIER = 3;
  const needsSnapshot = needs.map((n) => {
    const def = needRegistry.get(n.needId);
    const maxValue = def?.maxValue ?? 100;
    const isCritical = def ? n.currentValue < def.criticalThreshold : false;
    let urgency = def ? ((maxValue - n.currentValue) / maxValue) * def.priorityWeight : 0;
    if (isCritical) urgency *= CRITICAL_MULTIPLIER;
    return {
      needId: n.needId,
      currentValue: Math.round(n.currentValue * 100) / 100,
      maxValue,
      isCritical,
      urgencyScore: Math.round(urgency * 100) / 100,
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
    conflicts: conflicts?.map((c) => ({
      actionId: c.actionId,
      penalty: c.penalty,
      values: c.values,
    })),
  });
}

function wanderDestination(worldMap: WorldMap) {
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}
