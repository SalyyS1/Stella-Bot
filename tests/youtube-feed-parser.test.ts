import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ALLOWED_HOSTS,
    decodeXmlEntities,
    extractChannelIdFromHtml,
    newestCursor,
    parseChannelInput,
    parseYoutubeFeed,
    pickNewVideos,
    type YoutubeVideo
} from '../src/systems/youtube/youtube-feed';

// Lý do có test này: hai lỗi tệ nhất của một bot báo video đều IM LẶNG. Một là dội cả kho
// video cũ vào chat ngay khi vừa thêm kênh (admin gỡ tính năng sau năm phút). Hai là bot
// fetch URL tuỳ ý người dùng dán vào (`/youtube add` biến thành máy SSRF). Cả hai đều nằm
// trong hàm thuần ở youtube-feed.ts, nên kiểm được không cần mạng.

// Feed thật của YouTube, rút gọn, đo 6/9/2026. Giữ nguyên các đặc điểm quan trọng: yt:channelId
// ở đầu feed KHÔNG có "UC", entry có "&amp;" trong tiêu đề, và thứ tự mới nhất trước.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"/>
 <id>yt:channel:_x5XG1OV2P6uZZ5FSM9Ttw</id>
 <yt:channelId>_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
 <title>Google for Developers</title>
 <link rel="alternate" href="https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"/>
 <author><name>Google for Developers</name><uri>https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw</uri></author>
 <published>2007-08-23T00:34:43+00:00</published>
 <entry>
  <id>yt:video:CBzLIKfWpdg</id>
  <yt:videoId>CBzLIKfWpdg</yt:videoId>
  <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
  <title>Gemma &amp; friends: 1B downloads &lt;live&gt;</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=CBzLIKfWpdg"/>
  <author><name>Google for Developers</name><uri>https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw</uri></author>
  <published>2026-09-04T19:00:35+00:00</published>
  <updated>2026-09-04T19:00:35+00:00</updated>
  <media:group>
   <media:title>Gemma &amp; friends</media:title>
   <media:content url="https://www.youtube.com/v/CBzLIKfWpdg?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i4.ytimg.com/vi/CBzLIKfWpdg/hqdefault.jpg" width="480" height="360"/>
   <media:description>desc</media:description>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:aaaaaaaaaaa</id>
  <yt:videoId>aaaaaaaaaaa</yt:videoId>
  <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
  <title>Older video</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=aaaaaaaaaaa"/>
  <published>2026-09-01T10:00:00+00:00</published>
  <updated>2026-09-01T10:00:00+00:00</updated>
 </entry>
 <entry>
  <id>yt:video:broken</id>
  <title>Entry thieu videoId va published</title>
 </entry>
</feed>`;

test('doc feed that: ten kenh, ID day du "UC", hai video, bo entry hong', () => {
    const feed = parseYoutubeFeed(FEED);
    assert.ok(feed);
    assert.equal(feed.channelTitle, 'Google for Developers');
    // Dau feed YouTube bo tien to "UC"; phai chuan hoa lai, khong thi khong so duoc voi
    // ID nguoi dung dua.
    assert.equal(feed.channelId, 'UC_x5XG1OV2P6uZZ5FSM9Ttw');
    assert.equal(feed.videos.length, 2);
    assert.equal(feed.videos[0].videoId, 'CBzLIKfWpdg');
    assert.equal(feed.videos[0].title, 'Gemma & friends: 1B downloads <live>');
    assert.equal(feed.videos[0].url, 'https://www.youtube.com/watch?v=CBzLIKfWpdg');
    assert.equal(feed.videos[0].thumbnailUrl, 'https://i4.ytimg.com/vi/CBzLIKfWpdg/hqdefault.jpg');
    assert.equal(feed.videos[0].publishedAt.toISOString(), '2026-09-04T19:00:35.000Z');
    assert.equal(feed.videos[1].thumbnailUrl, null);
});

test('feed khong phai cua YouTube thi tra null, khong nem', () => {
    assert.equal(parseYoutubeFeed('<html>not a feed</html>'), null);
    assert.equal(parseYoutubeFeed(''), null);
});

test('giai entity XML, &amp; giai cuoi cung', () => {
    assert.equal(decodeXmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x1F600;'), 'a & b <c> "d" \'e\' 😀');
    // "&amp;lt;" la chu "&lt;" that — giai &amp; truoc se ra "<" sai.
    assert.equal(decodeXmlEntities('&amp;lt;'), '&lt;');
});

test('nhan ID UC..., @handle, va link kenh; tu choi link video va host la', () => {
    assert.deepEqual(parseChannelInput('UC_x5XG1OV2P6uZZ5FSM9Ttw'), { kind: 'id', id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' });
    assert.deepEqual(parseChannelInput(' @GoogleDevelopers '), { kind: 'page', url: 'https://www.youtube.com/@GoogleDevelopers' });
    assert.deepEqual(
        parseChannelInput('https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/videos'),
        { kind: 'id', id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' }
    );
    // Link chia se co ?si=... : bo query, giu path.
    assert.deepEqual(
        parseChannelInput('https://youtube.com/@GoogleDevelopers?si=abc123'),
        { kind: 'page', url: 'https://www.youtube.com/@GoogleDevelopers' }
    );
    assert.equal(parseChannelInput('youtube.com/c/GoogleDevelopers').kind, 'page');

    assert.equal(parseChannelInput('https://www.youtube.com/watch?v=CBzLIKfWpdg').kind, 'invalid');
    assert.equal(parseChannelInput('https://youtu.be/CBzLIKfWpdg').kind, 'invalid');
    assert.equal(parseChannelInput('').kind, 'invalid');
});

test('KHONG bao gio tra ve URL ngoai youtube.com — day la chot SSRF', () => {
    const attempts = [
        'https://evil.example.com/@handle',
        'http://127.0.0.1:8080/@x',
        'https://www.youtube.com.evil.com/@x',
        'https://youtube.com@evil.com/@x',
        'file:///etc/passwd',
        'http://169.254.169.254/latest/meta-data/'
    ];
    for (const attempt of attempts) {
        const parsed = parseChannelInput(attempt);
        if (parsed.kind === 'page') {
            assert.ok(ALLOWED_HOSTS.has(new URL(parsed.url).hostname), `host lot luoi: ${attempt} -> ${parsed.url}`);
        } else {
            assert.equal(parsed.kind, 'invalid', `phai tu choi: ${attempt}`);
        }
    }
});

test('lay ID kenh tu HTML: externalId truoc, canonical la duong lui', () => {
    assert.equal(
        extractChannelIdFromHtml('..."externalId":"UC_x5XG1OV2P6uZZ5FSM9Ttw","keywords"...'),
        'UC_x5XG1OV2P6uZZ5FSM9Ttw'
    );
    assert.equal(
        extractChannelIdFromHtml('<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">'),
        'UCabcdefghijklmnopqrstuv'
    );
    assert.equal(extractChannelIdFromHtml('<html>404</html>'), null);
});

function video(id: string, iso: string): YoutubeVideo {
    return { videoId: id, title: id, url: `https://www.youtube.com/watch?v=${id}`, publishedAt: new Date(iso), thumbnailUrl: null };
}

const VIDEOS = [
    video('v5', '2026-09-05T00:00:00Z'),
    video('v4', '2026-09-04T00:00:00Z'),
    video('v3', '2026-09-03T00:00:00Z'),
    video('v2', '2026-09-02T00:00:00Z'),
    video('v1', '2026-09-01T00:00:00Z')
];

test('chua co con tro thi KHONG dang gi — kenh vua them khong doi kho cu vao chat', () => {
    assert.deepEqual(pickNewVideos(VIDEOS, { lastPublishedAt: null, lastVideoId: null }, 3), []);
});

test('chi lay video moi hon con tro, theo thu tu cu -> moi', () => {
    const fresh = pickNewVideos(VIDEOS, { lastPublishedAt: new Date('2026-09-03T00:00:00Z'), lastVideoId: 'v3' }, 3);
    assert.deepEqual(fresh.map(v => v.videoId), ['v4', 'v5']);
});

test('vuot tran moi tick thi giu nhung video MOI NHAT, bo phan cu', () => {
    const fresh = pickNewVideos(VIDEOS, { lastPublishedAt: new Date('2026-08-01T00:00:00Z'), lastVideoId: null }, 2);
    assert.deepEqual(fresh.map(v => v.videoId), ['v4', 'v5']);
});

test('video trung ID con tro khong dang lai du published bang nhau', () => {
    const fresh = pickNewVideos(VIDEOS, { lastPublishedAt: new Date('2026-09-05T00:00:00Z'), lastVideoId: 'v5' }, 3);
    assert.deepEqual(fresh, []);
});

test('con tro moi nhat la video co published lon nhat, khong phai phan tu dau mang', () => {
    const shuffled = [VIDEOS[2], VIDEOS[0], VIDEOS[4]];
    assert.deepEqual(newestCursor(shuffled), { lastPublishedAt: new Date('2026-09-05T00:00:00Z'), lastVideoId: 'v5' });
    assert.equal(newestCursor([]), null);
});
