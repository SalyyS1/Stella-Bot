import { Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handleVoteAdd } from '../systems/voteManager';
import { handleStarReaction } from '../systems/utility/starboard-manager';

// discord.js emits (reaction, user, details) for this event, and the event loader
// appends the Client as the LAST argument. The details parameter must be declared
// so `client` binds to the real Client — omitting it silently binds `client` to
// { type, burst }, which breaks every client.channels call downstream.
export default {
    name: Events.MessageReactionAdd,
    once: false,
    async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, _details: unknown, client: any) {
        await handleVoteAdd(reaction, user, client);
        // Starboard tự lọc đúng emoji của nó và bỏ qua mọi reaction khác.
        await handleStarReaction(reaction, client).catch(error => console.error('[starboard] add lỗi:', error));
    }
};
