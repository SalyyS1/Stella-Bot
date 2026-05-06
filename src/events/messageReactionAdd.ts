import { Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handleVoteAdd } from '../systems/voteManager';

export default {
    name: Events.MessageReactionAdd,
    once: false,
    async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, client: any) {
        await handleVoteAdd(reaction, user, client);
    }
};
