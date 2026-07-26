export const config = {
    roles: {
        trusted: "1385258274131279956",
        // Level Roles (Bot sẽ tự tạo nếu chưa có, bạn sửa ID sau khi tạo xong)
        levelRoles: {
            littleStar: "", // Lv.1-9 — Bot tự tạo
            star: "",       // Lv.10-35 — Bot tự tạo
            bigStar: "",    // Lv.36-68 — Bot tự tạo
            stella: ""      // Lv.69-100 — Bot tự tạo
        }
    },
    // Verified Freelancer role. Bot tự tạo khi ready, ID lưu ở ManagedChannel
    // (key "verifiedrole"). Cấp qua mod duyệt (không auto khi đăng portfolio).
    verifiedFreelancer: { roleName: "✅ Verified Freelancer", color: "#57f287" as any },
    // Kỹ năng để định tuyến request tới đúng freelancer. Bot tự tạo role khi ready,
    // ID được lưu vào bảng ManagedChannel (key "skillrole:<key>"), không hardcode ở đây.
    skills: [
        { key: "design", label: "Design / Art", roleName: "🎨 Designer", color: "#e91e63" as any },
        { key: "dev", label: "Development / Plugin", roleName: "💻 Developer", color: "#3498db" as any },
        { key: "video", label: "Video / Motion", roleName: "🎬 Video Editor", color: "#e67e22" as any },
        { key: "writing", label: "Writing / Content", roleName: "✍️ Writer", color: "#1abc9c" as any },
        { key: "other", label: "Khác", roleName: "🌐 Other Skills", color: "#95a5a6" as any }
    ] as const,
    channels: {
        requestFree: "1490702155898687528",
        requestPaid: "1490685483892867163",
        portfolio: "1490687181105397760",
        share: "1401215533243957388",
        showcase: "1401215370978922506",
        betterShowcase: "1501602532760359116",
        serverAds: "1167099333527752825",
        welcome: "1401183261430120529",
        levelUp: "943895860595544075",
        rules: "1214607328775639072",
        chat: "943893730123980881",
        botLog: "1214596264617050173",
        rate: "1512109752895930460",
        // Kênh đăng digest định kỳ (mặc định dùng kênh chat; đổi sang kênh highlight riêng nếu muốn).
        digest: "943893730123980881",
    },
    // Digest định kỳ: gom request đang mở + showcase mới, đăng 1 embed. Bỏ qua khi rỗng.
    digest: {
        // "weekly" (khuyến nghị cho server 50-300) hoặc "daily".
        cadence: "weekly" as "weekly" | "daily",
        maxItems: 10
    },
    ui: {
        emojis: {
            success: "<a:success:1490702727209287751>",
            error: "<:cun_error:1490702729738190869>",
            bump: "<a:68523animatedarrowgreen:1490702734901641388>",
            close: "<a:nitro_unlock:1490702738424729772>",
            appeal: "<:11838warning:1490702743067824168>",
            delete: "<:f_:1490702747073384571>",
            keep: "<:pro:1490702750516908163>",
            star: "<:8819shinystar3:1490702756082618479>",
            emptyStar: "<:9213star18:1490702759803097272>",
            customer: "<:customer:1490702764488265958>",
            budget: "<a:monedas:1490702767495315477>",
            service: "<a:8144bluecrystalmoon:1490702771710722209>",
            contribution: "<a:8144bluecrystalmoon:1490702771710722209>",
            expert: "<a:nitro_unlock:1490702738424729772>",
            note: "<a:Notebook:1490702775539994906>",
            contact: "<a:CatToken:1490702781903016126>",
            portfolio: "<:Support:1490702785443008584>",
            upvote: "<:tanh_plusone:1497592408316055612>",
            downvote: "<:MinusOne:1497592465430151239>",
            starJump: "<a:Galaxy:1401214011143360713>",
            redArrow: "<a:73288animatedarrowred:1400581832302657746>",
            purpleArrow: "<a:73288animatedarrowpurple:1400581825935446179>",
            greenArrow: "<a:68523animatedarrowgreen:1490702734901641388>"
        },
        colors: {
            requestPaid: "#2ecc71" as any,
            requestFree: "#3498db" as any,
            portfolio: "#f1c40f" as any,
            closed: "#95a5a6" as any
        }
    },
    // Cấu hình hệ thống Level
    xp: {
        cooldownMs: 30_000, // 30 giây giữa 2 lần nhận XP
        minWords: 3,        // Tối thiểu 3 từ để nhận XP
        maxXpPerMsg: 50,    // Tối đa 50 XP mỗi tin nhắn
        // Bảng Role theo Level
        levelTiers: [
            { minLevel: 1,  maxLevel: 9,   roleName: "⭐ Little Star [Lv.1-9]",   color: "#95a5a6" as any, configKey: "littleStar" as const },
            { minLevel: 10, maxLevel: 35,  roleName: "🌟 Star [Lv.10-35]",        color: "#f1c40f" as any, configKey: "star" as const },
            { minLevel: 36, maxLevel: 68,  roleName: "💫 Big Star [Lv.36-68]",    color: "#e67e22" as any, configKey: "bigStar" as const },
            { minLevel: 69, maxLevel: 100, roleName: "✨ Stella [Lv.69-100]",     color: "#9b59b6" as any, configKey: "stella" as const }
        ]
    },
    // Phần thưởng Scoin cho hành động dịch vụ (tập trung ở đây để dễ tinh chỉnh).
    // Payout của request giữ nguyên tại rateRequest (rating*10) — KHÔNG thêm reward
    // ở completeRequest để tránh farm/double-pay. Chỉ thêm thưởng showcase publish.
    rewards: {
        showcasePublished: 30 // Scoin cho tác giả khi showcase được duyệt lên better-showcase
    },
    facebook: {
        // Cross-post gated behind admin approval. Enabled only when env vars set.
        enabled: process.env.FB_CROSSPOST_ENABLED === 'true',
        pageId: process.env.FB_PAGE_ID || '',
        // Token read at call time from env; NEVER hardcoded, NEVER logged.
        graphVersion: 'v21.0'
    },
    ai: {
        // OpenAI-compatible endpoint (agentgw). Key read at call time from env,
        // sent via Authorization header, NEVER hardcoded/logged. Feature is
        // fail-closed: disabled unless AI_API_KEY + baseUrl + model all present.
        baseUrl: process.env.AI_BASE_URL || 'https://agentgw.cloud',
        model: process.env.AI_MODEL || 'agentgw-opus-4-8',
        // Free API — allow long answers so the AI can output full config/skill
        // samples. Long output means slower generation, so timeout is raised to
        // match; the Q&A reply splits into multiple messages past Discord's 2000 limit.
        maxTokens: 4000,
        temperature: 0.85, // giọng tự nhiên/lầy hơn (trước 0.6 hơi khô cho persona cà khịa)
        timeoutMs: 90_000,
        // Q&A assistant
        qaChannel: '1530093732500869231',
        qaCooldownMs: 20_000,   // light per-user cooldown to blunt spam
        qaMaxConcurrent: 3,     // global cap so simultaneous askers don't overload
        // AI image generation. OpenAI-compatible endpoint (/v1/images/generations),
        // separate provider/key from the text endpoint above. Fail-closed: /imagine
        // stays OFF until IMAGE_API_KEY + baseUrl + model are set. Gated like Q&A
        // (cooldown + global cap) because image gen is slower/pricier than a text reply.
        image: {
            baseUrl: process.env.IMAGE_BASE_URL || '',
            model: process.env.IMAGE_MODEL || 'antigravity/gemini-3.1-flash-image',
            cooldownMs: 45_000,    // heavier per-user cooldown than text Q&A
            maxConcurrent: 2,      // global cap on simultaneous image jobs
            timeoutMs: 120_000,    // image gen is slow; allow well past the text timeout
            maxPromptLen: 1000     // cap prompt length sent to the API
        },
        // Seed catalog of popular plugin wikis (create-if-absent on ready).
        seedWikis: [
            { name: 'mythicmobs', url: 'https://git.luminemc.net/MythicCraft/MythicMobs/-/wikis/home', aliases: 'mythic,mm' },
            { name: 'mmoitems', url: 'https://gitlab.com/phoenix-dvpmt/mmoitems/-/wikis/home', aliases: 'mmo items' },
            { name: 'mmocore', url: 'https://gitlab.com/phoenix-dvpmt/mmocore/-/wikis/home', aliases: 'mmo core' },
            { name: 'modelengine', url: 'https://git.luminemc.net/Nightcore/ModelEngine-Wiki/-/wikis/home', aliases: 'model engine,meg' },
            { name: 'deluxemenus', url: 'https://wiki.helpch.at/clips-plugins/deluxemenus', aliases: 'dm,menu' },
            { name: 'placeholderapi', url: 'https://wiki.placeholderapi.com/', aliases: 'papi' },
            { name: 'vault', url: 'https://github.com/MilkBowl/Vault/wiki', aliases: '' },
            { name: 'luckperms', url: 'https://luckperms.net/wiki/Home', aliases: 'lp,perms' },
            { name: 'citizens', url: 'https://wiki.citizensnpcs.co/', aliases: 'npc' },
            { name: 'worldguard', url: 'https://worldguard.enginehub.org/en/latest/', aliases: 'wg' }
        ] as { name: string; url: string; aliases: string }[]
    },
    // Trivia tự động: Stella đăng câu đố Minecraft ở kênh chat, random 3-4 lần/ngày,
    // né giờ ngủ (1h-8h VN). Người trả lời đúng ĐẦU TIÊN nhận Scoin; cap chống farm.
    trivia: {
        channelId: '943893730123980881', // = channels.chat
        perDayMin: 3,                     // số lần đăng tối thiểu / ngày
        perDayMax: 4,                     // số lần đăng tối đa / ngày
        quietStartHour: 1,                // không đăng từ 1h...
        quietEndHour: 8,                  // ...đến 8h (giờ Asia/Saigon)
        answerWindowMs: 90_000,           // thời gian mở mỗi câu trước khi hết hạn
        reward: 8,                        // Scoin cho người đúng đầu tiên (< showcase 30)
        maxWinsPerDay: 5                  // cap thắng / người / ngày (chống farm)
    },
    // Bộ nhớ thành viên: Stella nhớ "fact" ngắn từ chat CÔNG KHAI để cà khịa cá nhân
    // hoá. Fail-closed: tắt trừ khi STELLA_MEMORY_ENABLED=true (bật sau khi voice/trivia ổn).
    memory: {
        enabled: process.env.STELLA_MEMORY_ENABLED === 'true',
        maxFactsPerUser: 8,               // giữ tối đa N fact / người (xoá cũ nhất khi vượt)
        minChars: 4,                      // độ dài fact tối thiểu để lưu
        maxChars: 200                     // độ dài fact tối đa để lưu
    },
    // Nhiệm vụ ngày: 3 quest ngẫu nhiên / người / ngày, tự cộng Scoin khi hoàn thành.
    // Gán lazy khi có hoạt động đầu tiên trong ngày — không cần scheduler riêng.
    quests: {
        enabled: true,
        perDay: 3,
        allDoneBonusBase: 20,     // bonus khi hoàn thành đủ quest trong ngày
        allDoneBonusPerStreak: 2, // + mỗi ngày streak liên tiếp
        allDoneBonusCap: 40       // trần bonus (chống lạm phát)
    },
    // Shop Scoin: đổi màu tên bằng role màu do Stella tự tạo & quản lý (sink kinh tế).
    shop: {
        enabled: true,
        colorRolePrice: 200,
        colors: [
            { key: "ruby",     label: "Ruby Đỏ",      hex: "#e74c3c" },
            { key: "coral",    label: "San Hô",       hex: "#ff7f50" },
            { key: "gold",     label: "Hoàng Kim",    hex: "#f1c40f" },
            { key: "emerald",  label: "Ngọc Lục Bảo", hex: "#2ecc71" },
            { key: "aqua",     label: "Xanh Ngọc",    hex: "#1abc9c" },
            { key: "sapphire", label: "Sapphire",     hex: "#3498db" },
            { key: "orchid",   label: "Lan Tím",      hex: "#9b59b6" },
            { key: "rose",     label: "Hồng Anh Đào", hex: "#ff6b9d" },
            { key: "slate",    label: "Xám Khói",     hex: "#95a5a6" },
            { key: "midnight", label: "Nửa Đêm",      hex: "#34495e" }
        ]
    },
    // Bảng vàng tuần: sáng thứ 2 tổng kết XP tuần trước, thưởng Scoin top 3.
    weeklyRewards: {
        enabled: true,
        channelId: '943893730123980881', // = channels.chat
        announceHour: 9,                 // 9h sáng thứ 2 (giờ host, Asia/Saigon)
        prizes: [150, 100, 50],          // Scoin cho hạng 1/2/3
        minXp: 1                         // cần có hoạt động mới được xếp hạng
    },
    // Sinh nhật: thành viên tự đăng ký, Stella chúc mừng + tặng Scoin mỗi sáng.
    birthday: {
        enabled: true,
        channelId: '943893730123980881', // = channels.chat
        announceHour: 8,                 // 8h sáng (giờ host, Asia/Saigon)
        gift: 100                        // Scoin quà sinh nhật
    },
    report: {
        // Nightly AI report (replaces the old plain digest). Posts to a forum channel.
        forumChannel: '1530077329102078042',
        // Channels read LIVE for the 24h summary (never persisted).
        sourceChannels: [
            '1281598090058665996',
            '943893730123980881',
            '1401215533243957388',
            '1401215370978922506',
            '1490685483892867163',
            '1530093732500869231'
        ],
        hourStart: 21,           // 21:00 Asia/Saigon
        hourEnd: 22,             // fire within the 21-22h window
        maxMessagesPerChannel: 200,
        // Official Mojang patch-notes JSON (stable; preferred over HTML scraping).
        changelogUrl: 'https://launchercontent.mojang.com/v2/javaPatchNotes.json'
    },
    showcase: {
        threshold: 5,
        controlGif: "https://i.pinimg.com/originals/ae/52/d9/ae52d968e7d8117170d2eeff6245ca5c.gif",
        tags: ["Art", "Config", "Plugins", "Model", "Build", "Nothing"]
    },
    welcome: {
        banner: "https://i.pinimg.com/originals/75/37/fc/7537fcc63babf246b2ad52936e53d356.gif"
    },
    maintenance: {
        timezone: "Asia/Saigon",
        categories: {
            serverAds: "1214591309042688070",
            requests: "1490686130335780946"
        }
    },
    antiRaid: {
        enabled: true,
        windowMs: 60_000,
        punishmentReason: "Stella anti-raid protection",
        thresholds: {
            everyoneMention: 1,
            channelCreate: 3,
            channelDelete: 2,
            channelUpdate: 4,
            memberKick: 3,
            memberBan: 3,
            roleCreate: 3,
            roleDelete: 2,
            roleUpdate: 4,
            webhookCreate: 2,
            webhookUpdate: 2,
            webhookDelete: 2
        }
    }
};
