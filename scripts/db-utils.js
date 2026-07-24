const fs = require('fs');
const path = require('path');

const tables = [
    {
        name: 'User',
        client: 'user',
        key: row => ({ id: row.id }),
        dateFields: ['lastDaily', 'createdAt']
    },
    {
        name: 'GuildSettings',
        client: 'guildSettings',
        key: row => ({ guildId: row.guildId }),
        dateFields: ['createdAt', 'updatedAt']
    },
    {
        name: 'Blacklist',
        client: 'blacklist',
        key: row => ({ id: row.id }),
        dateFields: ['createdAt']
    },
    {
        name: 'Vote',
        client: 'vote',
        key: row => ({ messageId_voterId: { messageId: row.messageId, voterId: row.voterId } }),
        dateFields: ['createdAt', 'updatedAt'],
        sequence: '"Vote_id_seq"'
    },
    {
        name: 'ShowcasePost',
        client: 'showcasePost',
        key: row => ({ messageId: row.messageId }),
        dateFields: ['createdAt', 'updatedAt', 'publishedAt']
    },
    {
        name: 'MaintenanceLog',
        client: 'maintenanceLog',
        key: row => ({ channelId_kind_period: { channelId: row.channelId, kind: row.kind, period: row.period } }),
        dateFields: ['createdAt'],
        sequence: '"MaintenanceLog_id_seq"'
    },
    {
        name: 'ManagedChannel',
        client: 'managedChannel',
        key: row => ({ key: row.key }),
        dateFields: ['updatedAt']
    },
    {
        name: 'ScoinTransaction',
        client: 'scoinTransaction',
        key: row => ({ id: row.id }),
        dateFields: ['createdAt'],
        sequence: '"ScoinTransaction_id_seq"'
    },
    {
        name: 'MusicPlaylistTrack',
        client: 'musicPlaylistTrack',
        key: row => ({ id: row.id }),
        dateFields: ['addedAt'],
        sequence: '"MusicPlaylistTrack_id_seq"'
    },
    {
        name: 'StarInventory',
        client: 'starInventory',
        key: row => ({ userId: row.userId }),
        dateFields: ['lastHuntAt', 'updatedAt']
    },
    {
        name: 'StarItemStack',
        client: 'starItemStack',
        key: row => ({ userId_key: { userId: row.userId, key: row.key } }),
        dateFields: ['updatedAt'],
        sequence: '"StarItemStack_id_seq"'
    },
    {
        name: 'StarTool',
        client: 'starTool',
        key: row => ({ userId_key: { userId: row.userId, key: row.key } }),
        dateFields: ['createdAt', 'updatedAt'],
        sequence: '"StarTool_id_seq"'
    },
    {
        name: 'StarBuff',
        client: 'starBuff',
        key: row => ({ id: row.id }),
        dateFields: ['expiresAt', 'createdAt'],
        sequence: '"StarBuff_id_seq"'
    },
    {
        name: 'StarHarvestSession',
        client: 'starHarvestSession',
        key: row => ({ id: row.id }),
        dateFields: ['createdAt'],
        sequence: '"StarHarvestSession_id_seq"'
    },
    {
        name: 'Giveaway',
        client: 'giveaway',
        key: row => ({ id: row.id }),
        dateFields: ['endsAt', 'createdAt', 'updatedAt'],
        sequence: '"Giveaway_id_seq"'
    },
    {
        name: 'GiveawayEntry',
        client: 'giveawayEntry',
        key: row => ({ giveawayId_userId: { giveawayId: row.giveawayId, userId: row.userId } }),
        dateFields: ['joinedAt'],
        sequence: '"GiveawayEntry_id_seq"'
    },
    {
        name: 'GiveawayRewardDelivery',
        client: 'giveawayRewardDelivery',
        key: row => ({ id: row.id }),
        dateFields: ['createdAt'],
        sequence: '"GiveawayRewardDelivery_id_seq"'
    },
    {
        name: 'RequestPost',
        client: 'requestPost',
        key: row => ({ id: row.id }),
        dateFields: ['completedAt', 'closedAt', 'createdAt', 'updatedAt'],
        sequence: '"RequestPost_id_seq"'
    },
    {
        name: 'RequestClaim',
        client: 'requestClaim',
        key: row => ({ requestId_claimerId: { requestId: row.requestId, claimerId: row.claimerId } }),
        dateFields: ['createdAt', 'updatedAt'],
        sequence: '"RequestClaim_id_seq"'
    },
    {
        name: 'RequestReview',
        client: 'requestReview',
        key: row => ({ requestId_reviewerId: { requestId: row.requestId, reviewerId: row.reviewerId } }),
        dateFields: ['createdAt'],
        sequence: '"RequestReview_id_seq"'
    }
];

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index++) {
        const item = argv[index];
        if (!item.startsWith('--')) continue;
        const key = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            index++;
        }
    }
    return args;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function timestampName() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveProjectPath(...parts) {
    return path.resolve(process.cwd(), ...parts);
}

function toDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    return new Date(value);
}

function normalizeDates(row, dateFields) {
    const next = { ...row };
    for (const field of dateFields) {
        if (field in next) next[field] = toDate(next[field]);
    }
    return next;
}

function serializeRows(rows) {
    return JSON.stringify({
        exportedAt: new Date().toISOString(),
        tables: rows
    }, null, 2);
}

async function resetSequences(prisma) {
    for (const table of tables) {
        if (!table.sequence) continue;
        await prisma.$executeRawUnsafe(
            `SELECT setval('${table.sequence}', COALESCE((SELECT MAX("id") FROM "${table.name}"), 1), (SELECT COUNT(*) FROM "${table.name}") > 0);`
        );
    }
}

async function countAll(prisma) {
    const result = {};
    for (const table of tables) {
        result[table.name] = await prisma[table.client].count();
    }
    return result;
}

module.exports = {
    countAll,
    ensureDir,
    normalizeDates,
    parseArgs,
    resetSequences,
    resolveProjectPath,
    serializeRows,
    tables,
    timestampName
};
