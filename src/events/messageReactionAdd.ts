import { Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handleVoteAdd } from '../systems/voteManager';

// discord.js emits (reaction, user, details) for this event, and the event loader
// appends the Client as the LAST argument. The details parameter must be declared
// so `client` binds to the real Client — omitting it silently binds `client` to
// { type, burst }, which breaks every client.channels call downstream.
export default {
    name: Events.MessageReactionAdd,
    once: false,
    async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, _details: unknown, client: any) {
        await handleVoteAdd(reaction, user, client);
    }
};
