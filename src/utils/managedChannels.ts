import prisma from '../lib/prisma';
import { config } from '../config';

export type ManagedChannelKey = 'requestPaid' | 'requestFree' | 'serverAds';

const fallbackChannelIds: Record<ManagedChannelKey, string> = {
    requestPaid: config.channels.requestPaid,
    requestFree: config.channels.requestFree,
    serverAds: config.channels.serverAds
};

let channelCache: Record<ManagedChannelKey, string> = { ...fallbackChannelIds };
let cacheLoadedAt = 0;
let refreshPromise: Promise<Record<ManagedChannelKey, string>> | null = null;
const CACHE_TTL_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 1_000;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(fallback), LOOKUP_TIMEOUT_MS);
        promise
            .then(value => resolve(value))
            .catch(() => resolve(fallback))
            .finally(() => clearTimeout(timer));
    });
}

async function refreshManagedChannelCache() {
    let rows;
    try {
        rows = await prisma.managedChannel.findMany({
            where: { key: { in: ['requestPaid', 'requestFree', 'serverAds'] } }
        });
    } catch (error) {
        console.warn('Managed channel cache refresh failed; retaining last known values:', error);
        return channelCache;
    }
    const next = { ...fallbackChannelIds };
    for (const row of rows) {
        if (row.key === 'requestPaid' || row.key === 'requestFree' || row.key === 'serverAds') {
            next[row.key] = row.channelId;
        }
    }
    channelCache = next;
    cacheLoadedAt = Date.now();
    return channelCache;
}

export function getCachedManagedChannelIds(): Record<ManagedChannelKey, string> {
    return channelCache;
}

export async function getManagedChannelId(key: ManagedChannelKey): Promise<string> {
    const ids = await getManagedChannelIds();
    return ids[key];
}

export async function getManagedChannelIds(): Promise<Record<ManagedChannelKey, string>> {
    if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return channelCache;
    if (!refreshPromise) {
        refreshPromise = refreshManagedChannelCache().finally(() => {
            refreshPromise = null;
        });
    }
    return withTimeout(refreshPromise, channelCache);
}

export async function setManagedChannelId(key: ManagedChannelKey, channelId: string): Promise<void> {
    await prisma.managedChannel.upsert({
        where: { key },
        update: { channelId },
        create: { key, channelId }
    });
    channelCache = { ...channelCache, [key]: channelId };
    cacheLoadedAt = Date.now();
}
