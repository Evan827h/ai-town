import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { conversationId, playerId } from './aiTown/ids';

export const listMessages = query({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', args.conversationId))
      .collect();
    const out = [];
    for (const message of messages) {
      const playerDescription = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', message.author))
        .first();
      if (!playerDescription) {
        throw new Error(`Invalid author ID: ${message.author}`);
      }
      out.push({ ...message, authorName: playerDescription.name });
    }
    return out;
  },
});

export const latestConversationMessages = query({
  args: {
    worldId: v.id('worlds'),
    conversationIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const result: Record<string, { author: string; authorName: string; text: string; timestamp: number }> = {};
    for (const convId of args.conversationIds) {
      const messages = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', convId))
        .order('desc')
        .first();
      if (messages) {
        const playerDescription = await ctx.db
          .query('playerDescriptions')
          .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', messages.author))
          .first();
        result[convId] = {
          author: messages.author,
          authorName: playerDescription?.name ?? 'Unknown',
          text: messages.text,
          timestamp: messages._creationTime,
        };
      }
    }
    return result;
  },
});

export const writeMessage = mutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    playerId,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      messageUuid: args.messageUuid,
      text: args.text,
      worldId: args.worldId,
    });
    await insertInput(ctx, args.worldId, 'finishSendingMessage', {
      conversationId: args.conversationId,
      playerId: args.playerId,
      timestamp: Date.now(),
    });
  },
});
