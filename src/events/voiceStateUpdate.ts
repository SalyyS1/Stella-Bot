import { Events, VoiceState } from 'discord.js';
import { handleVoiceStateUpdate } from '../systems/tempvoice/tempvoice-service';
import { logVoiceActivity } from '../systems/logs/voice-log';
import { trackVoiceActivity } from '../systems/stats/voice-activity-manager';

// Event này bắn RẤT dày (mỗi lần ai đó mute/unmute mic cũng bắn). Mọi thứ nặng phải nằm
// sau các cổng lọc rẻ trong từng handler — cả ba đều return sớm khi không liên quan.
//
// Một event, ba việc: gộp vào đây thay vì tạo ba file cho cùng một event, để thứ tự chạy
// nhìn thấy được ở một chỗ.
export default {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState: VoiceState, newState: VoiceState) {
        await handleVoiceStateUpdate(oldState, newState);
        // Log và đếm giờ chạy sau: việc dọn/tạo phòng là thứ người dùng đang chờ.
        await logVoiceActivity(oldState, newState).catch(error => console.error('[voice-log] lỗi:', error));
        await trackVoiceActivity(oldState, newState).catch(error => console.error('[voice-activity] lỗi:', error));
    }
};
