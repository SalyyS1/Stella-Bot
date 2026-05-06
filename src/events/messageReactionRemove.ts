import { Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handleVoteRemove } from '../systems/voteManager';

export default {
    name: Events.MessageReactionRemove,
    once: false,
    async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, client: any) {
        await handleVoteRemove(reaction, user, client);
    }
};
