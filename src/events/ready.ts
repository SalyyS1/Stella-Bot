import { Events, Client } from 'discord.js';
import { startMaintenanceScheduler } from '../systems/maintenanceManager';
import { ensureRecentVoteReactions } from '../systems/voteBackfillManager';
import { startGiveawayScheduler } from '../systems/giveawayManager';
import { initLavalink } from '../systems/music';
import { ensureSkillRoles } from '../systems/skillRoleManager';
import { startReportScheduler } from '../systems/reportManager';
import { reconcilePendingCrossPosts } from '../systems/facebookCrossPostManager';
import { sweepPendingDigitalOrders } from '../systems/shop-manager';
import { ensureVerifiedRole } from '../systems/freelancerManager';
import { seedWikis } from '../systems/wikiManager';
import { startTriviaScheduler } from '../systems/trivia-scheduler';
import { startShowcaseScheduler } from '../systems/showcaseManager';
import { startWeeklyRewardScheduler } from '../systems/weekly-reward-manager';
import { startBirthdayScheduler } from '../systems/birthday-manager';
import { startReminderScheduler } from '../systems/reminder/reminder-scheduler';
import { registerFonts } from '../systems/report/newspaper/newspaper-fonts';
import { syncInviteCache } from '../systems/invite/invite-cache';
import { runInviteBackfillOnce } from '../systems/invite/invite-backfill';
import { startInviteVerificationScheduler } from '../systems/invite/invite-verification';
import { startMessageMirrorPruneScheduler } from '../systems/logs/message-mirror';
import { startImageCacheSweeper } from '../systems/logs/message-image-cache';
import { runPermissionPreflight } from '../systems/moderation/permission-preflight';
import { reconcileTempVoiceChannels } from '../systems/tempvoice/tempvoice-service';
import { startTempRoleScheduler } from '../systems/roles/temp-role-manager';
import { startModDigestScheduler } from '../systems/moderation/mod-digest';
import { startStatsScheduler } from '../systems/stats/stats-channel-manager';
import { applyApplicationEmojiOverrides } from '../systems/app-emoji-registry';
import { startYoutubeAlertScheduler } from '../systems/youtube/youtube-alert-manager';
import { startRequestStaleScheduler } from '../systems/request/request-stale-scheduler';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);
        // Emoji của app thay cho emoji server, NGAY trước mọi thứ khác gửi tin: một tin
        // nhắn gửi trước lúc ghi đè sẽ mang markup cũ. Fail mềm và im lặng có chủ ý —
        // thiếu bước này thì bot vẫn dùng emoji server như hôm nay.
        try {
            const applied = await applyApplicationEmojiOverrides(client);
            if (applied > 0) console.log(`[emoji] dùng ${applied} emoji của app thay emoji server.`);
        } catch (error) {
            console.error('[emoji] không đọc được emoji của app:', error);
        }
        // Font tờ báo nhật báo — đăng ký NGAY khi bot lên, trước khi tick đầu tiên
        // của scheduler (21h) có thể cần render. Fail mềm: thiếu font chỉ mất ảnh.
        try {
            registerFonts();
        } catch (error) {
            console.error('[ready] newspaper font registration failed:', error);
        }
        initLavalink(client);
        startMaintenanceScheduler(client);
        startGiveawayScheduler(client);
        startReportScheduler(client);
        startTriviaScheduler(client);
        startWeeklyRewardScheduler(client);
        startBirthdayScheduler(client);
        // Lời nhắc do member đặt qua `!s`. Nhịp riêng (30s) chứ không ghép vào
        // scheduler nào có sẵn: nhịp của nhật báo là 15 phút, mà một lời nhắc hẹn
        // "3h chiều" ping lúc 15:14 thì người dùng thấy sai ngay.
        startReminderScheduler(client);
        // Retries showcase->better-showcase publishing every minute. Live vote
        // events are the fast path; this is the net that catches posts parked by a
        // transient forum/API failure instead of leaving them until a restart.
        startShowcaseScheduler(client);
        // Log kiểm duyệt: dọn bản sao tin nhắn quá hạn và dọn bytes ảnh hết TTL.
        // Cả hai chỉ chạm dữ liệu của chính mình nên không cần chờ guild sẵn sàng.
        startMessageMirrorPruneScheduler();
        startImageCacheSweeper();
        // Single-guild bot: create/persist skill roles for request routing on the
        // primary guild. Lazy — safe to re-run; reuses existing roles by id/name.
        const guild = client.guilds.cache.first();
        if (guild) {
            await ensureSkillRoles(guild).catch(error => console.error('Skill-role bootstrap failed:', error));
            await ensureVerifiedRole(guild).catch(error => console.error('Verified-role bootstrap failed:', error));
            // Thiếu quyền ở đây không gây lỗi, chỉ làm log/lượt mời sai im lặng —
            // nên phải báo ngay lúc bot lên thay vì để phát hiện qua dữ liệu sai.
            await runPermissionPreflight(guild).catch(error => console.error('Permission preflight failed:', error));
            // Ảnh chụp invite phải có TRƯỚC lượt join đầu tiên sau khi bot lên, nếu
            // không thì lượt đó không diff ra được ai mời.
            await syncInviteCache(guild).catch(error => console.error('Invite cache sync failed:', error));
            // Quét số lượt mời quá khứ đúng một lần rồi đóng băng (xem invite-backfill.ts).
            await runInviteBackfillOnce(guild).catch(error => console.error('Invite backfill failed:', error));
            // Hẹn giờ xoá phòng voice tạm nằm trong RAM, nên bot chết giữa lúc có phòng
            // rỗng sẽ để lại kênh đó sống mãi. Sau vài lần restart là server đầy kênh rác.
            await reconcileTempVoiceChannels(guild).catch(error => console.error('Temp voice reconcile failed:', error));
        }
        startInviteVerificationScheduler(client);
        // Role tạm: quét ngay một lượt rồi mỗi phút. Role đáng ra hết hạn lúc bot đang tắt
        // phải được gỡ ngay khi bot lên, không phải một phút sau.
        startTempRoleScheduler(client);
        // Bản tin kiểm duyệt tuần, tự đăng Chủ nhật sau 20h giờ Saigon. Nhịp một giờ là
        // đủ; claimWork lo phần không đăng trùng khi bot restart.
        startModDigestScheduler(client);
        // Kênh thống kê: nhịp 15 phút. KHÔNG hạ xuống — Discord chỉ cho đổi tên một kênh
        // 2 lần mỗi 10 phút, và vượt trần thì request bị treo trong hàng đợi rate-limit
        // kéo theo mọi request khác của bot (xem stats-channel-manager.ts).
        startStatsScheduler(client);
        // Báo video YouTube mới: nhịp 10 phút, lượt đầu sau 1 phút. Không có kênh nào được
        // theo dõi thì tick là một truy vấn rỗng.
        startYoutubeAlertScheduler(client);
        // Dọn đơn bị bỏ quên: nhắc đơn OPEN quá 7 ngày, tự đóng ở ngày 14, nhắc khách đánh
        // giá đơn DONE. Nhịp một giờ; tick rỗng chỉ là hai truy vấn.
        startRequestStaleScheduler(client);
        await ensureRecentVoteReactions(client).catch(error => console.error('Vote self-heal failed:', error));
        // Seed the plugin-wiki catalog (create-if-absent; never overwrites admin edits).
        await seedWikis().catch(error => console.error('Wiki seed failed:', error));
        // Recover any FB cross-post stuck mid-publish across a restart (flags for
        // manual review — never blind re-posts, to avoid duplicate Page posts).
        await reconcilePendingCrossPosts(client).catch(error => console.error('FB cross-post reconcile failed:', error));
        // Đơn hàng số kẹt PENDING: bot chết giữa lúc trừ xu và lúc gửi link để lại
        // người mua mất xu mà chưa nhận gì. Không dọn thì mất vĩnh viễn và không ai biết.
        await sweepPendingDigitalOrders()
            .then(n => { if (n) console.error(`[shop] đã hoàn xu ${n} đơn hàng số kẹt PENDING`); })
            .catch(error => console.error('Pending digital-order sweep failed:', error));
    },
};
