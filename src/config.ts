export const config = {
    roles: {
        trusted: "1385258274131279956",
        appealStaff: "894579088843485244", // Role xử lý khiếu nại Feedback
        // Level Roles (Bot sẽ tự tạo nếu chưa có, bạn sửa ID sau khi tạo xong)
        levelRoles: {
            littleStar: "", // Lv.1-9 — Bot tự tạo
            star: "",       // Lv.10-35 — Bot tự tạo
            bigStar: "",    // Lv.36-68 — Bot tự tạo
            stella: ""      // Lv.69-100 — Bot tự tạo
        }
    },
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
        feedback: "1490685714055041145",
        suggestions: "1497594149010935808",
        botLog: "1214596264617050173",
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
            feedbackHigh: "#2ecc71" as any,
            feedbackMed: "#f1c40f" as any,
            feedbackLow: "#e74c3c" as any,
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
            webhookCreate: 2
        }
    }
};
