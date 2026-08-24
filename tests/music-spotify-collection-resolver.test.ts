import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpotifyCollection, parseSpotifyEmbedHtml } from '../src/systems/music/music-spotify-collection-resolver';

// Ly do co test nay: link Spotify tu nguoi dung co du dang (share link co ?si,
// link intl-vi, uri spotify:), va HTML embed la thu Spotify co the doi bat cu luc
// nao — parse sai thi bot bao "khong tim thay bai" chu khong bao la doc that bai.

function embedHtml(entity: unknown) {
    return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { state: { data: { entity } } } }
    })}</script></body></html>`;
}

const playlistEntity = {
    type: 'playlist',
    name: 'Nhaccc',
    coverArt: { sources: [{ url: 'https://cdn/small.jpg', width: 64 }, { url: 'https://cdn/big.jpg', width: 640 }] },
    trackList: [
        { title: 'Không Là Em', subtitle: 'Mibu, FEELAN', uri: 'spotify:track:6DpodVR9u4pmVTLVQjpWB5', duration: 288473 },
        { title: '23:40', subtitle: 'Hào', uri: 'spotify:track:6qyK9SquQSHvNzrGHEUYNV', duration: 224169 }
    ]
};

test('nhan ra moi dang link playlist/album, bo qua link track', () => {
    const cases: [string, { type: string; id: string } | null][] = [
        ['https://open.spotify.com/playlist/5glHCIpk2oeaNGMHru0BUr?si=c705f997ae0a49a5', { type: 'playlist', id: '5glHCIpk2oeaNGMHru0BUr' }],
        ['https://open.spotify.com/intl-vi/album/3T4tUhGYeRNVUGevb0wThu', { type: 'album', id: '3T4tUhGYeRNVUGevb0wThu' }],
        ['spotify:playlist:5glHCIpk2oeaNGMHru0BUr', { type: 'playlist', id: '5glHCIpk2oeaNGMHru0BUr' }],
        ['https://open.spotify.com/track/6DpodVR9u4pmVTLVQjpWB5', null],
        ['https://www.youtube.com/playlist?list=PL123', null],
        ['tên bài hát bất kỳ', null]
    ];

    for (const [input, expected] of cases) {
        assert.deepEqual(parseSpotifyCollection(input), expected, input);
    }
});

test('doc trackList thanh bai co link track chuan', () => {
    const collection = parseSpotifyEmbedHtml(embedHtml(playlistEntity), { type: 'playlist', id: '5glHCIpk2oeaNGMHru0BUr' });

    assert.equal(collection.name, 'Nhaccc');
    // Cover to nhat, khong phai cover dau tien.
    assert.equal(collection.artworkUrl, 'https://cdn/big.jpg');
    assert.equal(collection.tracks.length, 2);
    assert.deepEqual(collection.tracks[0], {
        title: 'Không Là Em',
        author: 'Mibu, FEELAN',
        uri: 'https://open.spotify.com/track/6DpodVR9u4pmVTLVQjpWB5',
        identifier: '6DpodVR9u4pmVTLVQjpWB5',
        duration: 288473
    });
});

test('bo qua local file / episode, khong tinh la bai', () => {
    const entity = {
        ...playlistEntity,
        trackList: [
            { title: 'Local file', subtitle: '', uri: 'spotify:local:::Local+file:180', duration: 180000 },
            { title: 'Tập podcast', subtitle: 'Ai đó', uri: 'spotify:episode:abc123', duration: 600000 },
            playlistEntity.trackList[0]
        ]
    };
    const collection = parseSpotifyEmbedHtml(embedHtml(entity), { type: 'playlist', id: 'x' });

    assert.equal(collection.tracks.length, 1);
    assert.equal(collection.tracks[0].identifier, '6DpodVR9u4pmVTLVQjpWB5');
});

test('HTML doi cau truc / link chet / playlist rong deu bao loi ro thay vi tra rong', () => {
    assert.throws(() => parseSpotifyEmbedHtml('<html>trang login</html>', { type: 'playlist', id: 'x' }), /đổi cấu trúc/);
    // Link sai/da xoa/private: Spotify van tra 200 nhung khong co entity.
    assert.throws(() => parseSpotifyEmbedHtml(embedHtml(null), { type: 'playlist', id: 'x' }), /Không mở được/);
    assert.throws(() => parseSpotifyEmbedHtml(embedHtml({ type: 'playlist', name: 'X', trackList: [] }), { type: 'playlist', id: 'x' }), /không có bài nào/);
    // Xin playlist ma nhan ve entity album -> coi la doi cau truc, khong luu bua.
    assert.throws(() => parseSpotifyEmbedHtml(embedHtml(playlistEntity), { type: 'album', id: 'x' }), /đổi cấu trúc/);
});
