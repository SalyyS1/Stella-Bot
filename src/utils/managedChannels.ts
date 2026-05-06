import prisma from '../lib/prisma';
import { config } from '../config';

export type ManagedChannelKey = 'requestPaid' | 'requestFree' | 'serverAds';

const fallbackChannelIds: Record<ManagedChannelKey, string> = {
    requestPaid: config.channels.requestPaid,
    requestFree: config.channels.requestFree,
    serverAds: config.channels.serverAds
};

export async function getManagedChannelId(key: ManagedChannelKey): Promise<string> {
    const saved = await prisma.managedChannel.findUnique({ where: { key } }).catch(() => null);
    return saved?.channelId || fallbackChannelIds[key];
}

export async function getManagedChannelIds(): Promise<Record<ManagedChannelKey, string>> {
    const [requestPaid, requestFree, serverAds] = await Promise.all([
        getManagedChannelId('requestPaid'),
        getManagedChannelId('requestFree'),
        getManagedChannelId('serverAds')
    ]);
    return { requestPaid, requestFree, serverAds };
}

export async function setManagedChannelId(key: ManagedChannelKey, channelId: string): Promise<void> {
    await prisma.managedChannel.upsert({
        where: { key },
        update: { channelId },
        create: { key, channelId }
    });
}
