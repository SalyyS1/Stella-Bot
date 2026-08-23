import { randomBytes } from 'crypto';
import { config } from '../../config';
import prisma from '../../lib/prisma';

// ============================================================
//  MUSIC PLAYLIST SERVICE — playlist ca nhan v2 (nhieu playlist/nguoi)
// ============================================================
// Playlist duoc goi theo TEN (unique theo tung nguoi) chu khong phai id, vi
// nguoi dung go ten trong slash command; autocomplete lo phan goi y.

const LIMITS = config.music.playlist;
const SHARE_CODE_ATTEMPTS = 5;

export type PlaylistTrackInput = {
    title: string;
    author?: string;
    uri: string;
    identifier?: string;
    source?: string;
    duration?: number | null;
    artworkUrl?: string;
};

/**
 * Doi loi Prisma thanh cau tieng Viet nguoi dung hieu duoc.
 * P2021/P2022 = bang/cot chua ton tai -> chua chay migration, day la loi setup
 * chu khong phai loi nguoi dung, phai noi ro de khoi doan.
 */
function rethrowPrisma(error: any, context: string): never {
    const code = error?.code;
    if (code === 'P2021' || code === 'P2022') {
        throw new Error('Playlist v2 chưa có trong database. Chạy `npm run db:migrate` rồi thử lại.');
    }
    if (code === 'P2002') throw new Error(`${context}: tên này đã tồn tại rồi.`);
    throw error;
}

function normalizeName(raw: string) {
    const name = (raw || '').replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('Tên playlist không được để trống.');
    if (name.length > LIMITS.nameMaxLength) throw new Error(`Tên playlist tối đa ${LIMITS.nameMaxLength} ký tự.`);
    return name;
}

function normalizeDescription(raw: string | null | undefined) {
    const value = (raw || '').trim();
    if (!value) return null;
    if (value.length > LIMITS.descriptionMaxLength) throw new Error(`Mô tả tối đa ${LIMITS.descriptionMaxLength} ký tự.`);
    return value;
}

/** Ma share ngan, de doc qua chat. Bo ky tu de nhin lan (0/O, 1/I). */
function newShareCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    let code = '';
    for (const byte of bytes) code += alphabet[byte % alphabet.length];
    return code;
}

export async function listPlaylists(userId: string) {
    try {
        return await prisma.musicPlaylist.findMany({
            where: { userId },
            orderBy: { createdAt: 'asc' },
            include: { _count: { select: { tracks: true } } }
        });
    } catch (error) {
        rethrowPrisma(error, 'Playlist');
    }
}

export async function getPlaylistByName(userId: string, name: string) {
    const playlist = await prisma.musicPlaylist.findUnique({
        where: { userId_name: { userId, name: normalizeName(name) } },
        include: { tracks: { orderBy: { position: 'asc' } } }
    }).catch(error => rethrowPrisma(error, 'Playlist'));
    if (playlist) return playlist;

    // Nguoi dung hay go "chill" cho playlist ten "Chill" -> thu khong phan biet
    // hoa/thuong truoc khi bao khong tim thay.
    const loose = await prisma.musicPlaylist.findFirst({
        where: { userId, name: { equals: normalizeName(name), mode: 'insensitive' } },
        include: { tracks: { orderBy: { position: 'asc' } } }
    }).catch(() => null);
    if (loose) return loose;

    // Liet ke ten dang co: "khong tim thay playlist" gan nhu luon la sai ten
    // (go tay thay vi chon autocomplete), nen phai chi ra ten dung luon.
    const owned = await listPlaylists(userId).catch(() => []);
    const hint = owned.length
        ? `Playlist của bạn: ${owned.map(item => `**${item.name}**`).join(', ')}.`
        : 'Bạn chưa có playlist nào — tạo bằng `/music playlist create name:<tên>`.';
    throw new Error(`Không thấy playlist tên **${normalizeName(name)}**. ${hint}`);
}

/** Mo playlist bang ma share. Chi chu moi xem duoc playlist private. */
export async function getPlaylistByShareCode(shareCode: string, viewerId: string) {
    const code = (shareCode || '').trim().toUpperCase();
    if (!code) throw new Error('Thiếu mã share.');

    const playlist = await prisma.musicPlaylist.findUnique({
        where: { shareCode: code },
        include: { tracks: { orderBy: { position: 'asc' } } }
    }).catch(error => rethrowPrisma(error, 'Playlist'));

    if (!playlist) throw new Error('Không tìm thấy playlist với mã này.');
    if (!playlist.isPublic && playlist.userId !== viewerId) throw new Error('Playlist này đang ở chế độ riêng tư.');
    return playlist;
}

export async function createPlaylist(userId: string, rawName: string, options: { description?: string | null; coverUrl?: string | null } = {}) {
    const name = normalizeName(rawName);
    const description = normalizeDescription(options.description);

    try {
        const count = await prisma.musicPlaylist.count({ where: { userId } });
        if (count >= LIMITS.maxPerUser) throw new Error(`Mỗi người tối đa ${LIMITS.maxPerUser} playlist. Xóa bớt một cái trước nhé.`);
        await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });

        // shareCode random nen co the trung (rat kho); thu lai vai lan thay vi
        // de nguoi dung nhan loi unique.
        for (let attempt = 0; attempt < SHARE_CODE_ATTEMPTS; attempt++) {
            try {
                return await prisma.musicPlaylist.create({
                    data: { userId, name, description, coverUrl: options.coverUrl || null, shareCode: newShareCode() }
                });
            } catch (error: any) {
                const conflictOnShareCode = error?.code === 'P2002' && String(error?.meta?.target || '').includes('shareCode');
                if (!conflictOnShareCode) throw error;
            }
        }
        throw new Error('Không tạo được mã share, thử lại lần nữa nhé.');
    } catch (error) {
        rethrowPrisma(error, 'Playlist');
    }
}

export async function renamePlaylist(userId: string, name: string, rawNewName: string) {
    const playlist = await getPlaylistByName(userId, name);
    const newName = normalizeName(rawNewName);
    try {
        return await prisma.musicPlaylist.update({ where: { id: playlist.id }, data: { name: newName } });
    } catch (error) {
        rethrowPrisma(error, 'Playlist');
    }
}

export async function deletePlaylist(userId: string, name: string) {
    const playlist = await getPlaylistByName(userId, name);
    await prisma.musicPlaylist.delete({ where: { id: playlist.id } });
    return playlist;
}

export async function setPlaylistCover(userId: string, name: string, cover: { coverUrl?: string | null; coverMessageId?: string | null }) {
    const playlist = await getPlaylistByName(userId, name);
    return prisma.musicPlaylist.update({
        where: { id: playlist.id },
        data: { coverUrl: cover.coverUrl ?? null, coverMessageId: cover.coverMessageId ?? null }
    });
}

export async function setPlaylistPublic(userId: string, name: string, isPublic: boolean) {
    const playlist = await getPlaylistByName(userId, name);
    return prisma.musicPlaylist.update({ where: { id: playlist.id }, data: { isPublic } });
}

export type AddTracksResult = {
    playlistName: string;
    /** So bai thuc su ghi vao DB. */
    added: number;
    /** Bai bi bo vi trung uri voi bai da co trong playlist. */
    duplicates: number;
    /** Bai bi bo vi playlist het cho. */
    overflow: number;
    firstPosition: number;
};

/**
 * Them NHIEU bai mot luot — dung khi nguoi dung dan link ca mot playlist
 * Spotify/YouTube. Bo bai trung uri de dan playlist hai lan khong nhan doi.
 */
export async function addTracksToPlaylist(userId: string, name: string, tracks: PlaylistTrackInput[]): Promise<AddTracksResult> {
    const playlist = await getPlaylistByName(userId, name);
    if (!tracks.length) throw new Error('Không có bài nào để thêm.');

    try {
        return await prisma.$transaction(async tx => {
            const existing = await tx.musicPlaylistItem.findMany({
                where: { playlistId: playlist.id },
                select: { uri: true, position: true }
            });
            const known = new Set(existing.map(item => item.uri));
            const room = LIMITS.maxTracks - existing.length;
            if (room <= 0) throw new Error(`Playlist **${playlist.name}** đã đủ ${LIMITS.maxTracks} bài.`);

            const fresh: PlaylistTrackInput[] = [];
            let duplicates = 0;
            for (const track of tracks) {
                if (known.has(track.uri)) {
                    duplicates++;
                    continue;
                }
                known.add(track.uri);
                fresh.push(track);
            }
            if (!fresh.length) throw new Error(`Mọi bài trong link đã có sẵn trong **${playlist.name}**.`);

            const accepted = fresh.slice(0, room);
            const nextPosition = existing.reduce((max, item) => Math.max(max, item.position), 0) + 1;
            await tx.musicPlaylistItem.createMany({
                data: accepted.map((track, index) => ({
                    playlistId: playlist.id,
                    position: nextPosition + index,
                    title: track.title.slice(0, 300),
                    author: track.author ? track.author.slice(0, 200) : null,
                    uri: track.uri,
                    identifier: track.identifier || null,
                    source: track.source || null,
                    duration: track.duration ?? null,
                    artworkUrl: track.artworkUrl || null
                }))
            });

            return {
                playlistName: playlist.name,
                added: accepted.length,
                duplicates,
                overflow: fresh.length - accepted.length,
                firstPosition: nextPosition
            };
        });
    } catch (error: any) {
        if (error?.code === 'P2002') throw new Error('Có lệnh khác vừa thêm bài cùng lúc, thử lại nhé.');
        rethrowPrisma(error, 'Playlist');
    }
}

export async function addTrackToPlaylist(userId: string, name: string, track: PlaylistTrackInput) {
    const result = await addTracksToPlaylist(userId, name, [track]);
    return { title: track.title, position: result.firstPosition, playlistName: result.playlistName };
}

export async function removeTrackFromPlaylist(userId: string, name: string, position: number) {
    const playlist = await getPlaylistByName(userId, name);
    const track = playlist.tracks.find(item => item.position === position);
    if (!track) throw new Error(`Playlist **${playlist.name}** không có bài ở vị trí ${position}.`);

    await prisma.$transaction(async tx => {
        await tx.musicPlaylistItem.delete({ where: { id: track.id } });
        // Don vi tri TANG DAN: unique(playlistId, position) khong deferrable nen
        // phai doi tung dong theo thu tu, cho tro trong o phia truoc.
        const rest = playlist.tracks.filter(item => item.position > position).sort((a, b) => a.position - b.position);
        for (const item of rest) {
            await tx.musicPlaylistItem.update({ where: { id: item.id }, data: { position: item.position - 1 } });
        }
    });
    return { playlist, track };
}

export async function movePlaylistTrack(userId: string, name: string, from: number, to: number) {
    const playlist = await getPlaylistByName(userId, name);
    const total = playlist.tracks.length;
    if (from < 1 || from > total || to < 1 || to > total) throw new Error(`Vị trí phải từ 1 đến ${total}.`);
    if (from === to) return playlist;

    const ordered = playlist.tracks.slice().sort((a, b) => a.position - b.position);
    const [moved] = ordered.splice(from - 1, 1);
    ordered.splice(to - 1, 0, moved);

    await prisma.$transaction(async tx => {
        // Hai pha: dua het sang so am truoc de khong dung unique khi doi cho.
        for (const item of ordered) {
            await tx.musicPlaylistItem.update({ where: { id: item.id }, data: { position: -item.position } });
        }
        for (let index = 0; index < ordered.length; index++) {
            await tx.musicPlaylistItem.update({ where: { id: ordered[index].id }, data: { position: index + 1 } });
        }
    });
    return { playlist, moved };
}

/** Copy playlist nguoi khac (theo ma share) ve tai khoan minh. */
export async function copyPlaylistFromShareCode(userId: string, shareCode: string, rawName?: string | null) {
    const source = await getPlaylistByShareCode(shareCode, userId);
    if (!source.tracks.length) throw new Error('Playlist đó đang trống, không có gì để copy.');

    const name = normalizeName(rawName || `${source.name} (copy)`);
    const created = await createPlaylist(userId, name, { description: source.description, coverUrl: source.coverUrl });

    const tracks = source.tracks.slice(0, LIMITS.maxTracks);
    await prisma.musicPlaylistItem.createMany({
        data: tracks.map((track, index) => ({
            playlistId: created.id,
            position: index + 1,
            title: track.title,
            author: track.author,
            uri: track.uri,
            identifier: track.identifier,
            source: track.source,
            duration: track.duration,
            artworkUrl: track.artworkUrl
        }))
    });
    return { created, copied: tracks.length, skipped: source.tracks.length - tracks.length };
}

export async function bumpPlaylistPlayCount(playlistId: number) {
    await prisma.musicPlaylist.update({ where: { id: playlistId }, data: { playCount: { increment: 1 } } }).catch(() => {});
}
