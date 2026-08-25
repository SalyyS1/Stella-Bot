import { Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { handleVoteRemove } from '../systems/voteManager';
import { handleStarReaction } from '../systems/utility/starboard-manager';

// See messageReactionAdd: the details argument sits between user and the
// loader-appended Client, so it must be declared for `client` to bind correctly.
export default {
    name: Events.MessageReactionRemove,
    once: false,
    async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, _details: unknown, client: any) {
        await handleVoteRemove(reaction, user, client);
        // Rút sao xuống dưới ngưỡng thì bài phải rời bảng — cùng một hàm lo cả hai chiều.
        await handleStarReaction(reaction, client).catch(error => console.error('[starboard] remove lỗi:', error));
    }
};
