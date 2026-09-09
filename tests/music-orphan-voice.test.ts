import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Events } from 'discord.js';
import { disconnectOrphanVoice } from '../src/systems/music/music-session-router';

function fakeEntry(options: { channelId: string | null; hasPlayer?: boolean }) {
    const client: any = new EventEmitter();
    client.user = { id: 'bot-1' };
    const sent: any[] = [];
    const member: any = { voice: { channelId: options.channelId } };
    const guild: any = {
        id: 'guild-1',
        members: { me: member },
        shard: {
            send: async (payload: any) => {
                sent.push(payload);
                member.voice.channelId = null;
                queueMicrotask(() => client.emit(Events.VoiceStateUpdate, {}, {
                    guild: { id: guild.id },
                    id: client.user.id,
                    channelId: null
                }));
            }
        }
    };
    client.guilds = { cache: new Map([[guild.id, guild]]) };

    return {
        sent,
        entry: {
            key: 'satellite-1',
            label: 'Stella Loa 2',
            role: 'satellite',
            client,
            lavalink: { getPlayer: () => options.hasPlayer ? {} : null }
        } as any
    };
}

test('disconnects an orphan Discord voice state before a new player is created', async () => {
    const { entry, sent } = fakeEntry({ channelId: 'voice-1' });

    assert.equal(await disconnectOrphanVoice(entry, 'guild-1'), true);
    assert.deepEqual(sent, [{
        op: 4,
        d: { guild_id: 'guild-1', channel_id: null, self_mute: false, self_deaf: false }
    }]);
});

test('does not disconnect a voice state owned by an existing player', async () => {
    const { entry, sent } = fakeEntry({ channelId: 'voice-1', hasPlayer: true });

    assert.equal(await disconnectOrphanVoice(entry, 'guild-1'), false);
    assert.equal(sent.length, 0);
});
