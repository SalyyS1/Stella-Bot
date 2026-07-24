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
