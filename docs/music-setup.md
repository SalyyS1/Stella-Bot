# Setup Music Cho Stella Bot

Music của Stella dùng Lavalink v4. Bot sẽ không phát nhạc nếu thiếu `LAVALINK_*` trong `.env` hoặc Lavalink chưa chạy.

## Chọn Kiểu Chạy

- **Máy local/VPS có Docker:** chạy Lavalink bằng `docker-compose.lavalink.yml`.
- **Hosting Node.js/shared hosting:** bot chỉ chạy Node.js, còn Lavalink nên dùng node remote riêng. Hosting thường không chạy được Docker/Java service ổn định.

Nếu dùng hosting, ưu tiên cấu hình `LAVALINK_NODES` hoặc `LAVALINK_HOST/LAVALINK_PORT/LAVALINK_PASSWORD` trỏ đến Lavalink remote.

## 1. Cấu Hình `.env`

Local Docker:

```env
MUSIC_PREFIX=s!
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=doi_password_dai_ngau_nhien
LAVALINK_SECURE=false
```

Remote/hosting:

```env
MUSIC_PREFIX=s!
LAVALINK_NODES=[{"id":"Remote Main","host":"your-lavalink-host.com","port":443,"authorization":"your-password","secure":true}]
```

`LAVALINK_NODES` cho phép nhiều node. Nếu có biến này, bot sẽ bỏ qua `LAVALINK_HOST/LAVALINK_PORT`. Password là bắt buộc và phải trùng `LAVALINK_SERVER_PASSWORD` của node; không dùng giá trị mẫu hay để trống.

Tuỳ chọn thêm:

```env
# SponsorBlock (bỏ đoạn quảng cáo trong video). Mặc định bật.
# Đặt =0 nếu node Lavalink của bạn không có plugin sponsorblock.
MUSIC_SPONSORBLOCK=1
# Bot loa phụ để phát song song nhiều kênh voice — xem mục 8.
MUSIC_SATELLITE_TOKENS=
# Kênh lưu ảnh bìa playlist do member upload — xem mục 5.
MUSIC_ASSET_CHANNEL_ID=
```

Key Spotify **không** đặt vào `.env` của bot khi chạy Lavalink remote — xem mục 6.

## 2. Chạy Lavalink Local Bằng Docker

Tại thư mục repo:

```powershell
docker compose -f docker-compose.lavalink.yml up -d
```

Xem log:

```powershell
docker logs -f stella-lavalink
```

Khi thấy Lavalink started/listening port `2333` là ổn. Lần start đầu sau khi thêm plugin mới, log phải có dòng nạp `youtube-plugin`, `lavasrc-plugin` và `sponsorblock-plugin` mà không có exception.

## 3. Restart Bot

```powershell
npm run db:migrate
npm run build
npm start
```

`npm run db:migrate` là bắt buộc cho playlist v2 (bảng `MusicPlaylist`/`MusicPlaylistItem`). Bỏ bước này thì mọi lệnh `/music playlist` sẽ báo "Playlist v2 chưa có trong database".

Log bot nên có dòng Lavalink connected. Nếu còn thấy `Lavalink env is missing`, kiểm tra lại `.env` và restart bot.

Kiểm tra nhanh:

```text
/music health
s!health
```

Health check chỉ hiện node/host/port và số bot nhạc, không hiện password.

## 4. Cách Dùng

Vào voice channel trước, rồi dùng:

```text
s!play tên bài hoặc link
s!search tên bài        # ra danh sách, chọn bài muốn phát
s!queue
s!skip
s!volume 120
s!filter bassboost
s!pl tên playlist       # nạp playlist đã lưu vào queue
s!save tên playlist     # lưu bài đang phát vào playlist đó
s!stop
```

Slash command:

```text
/music play query:...
/music search query:...
/music queue
/music volume value:120
/music filter preset:nightcore
```

Panel now-playing gồm một ảnh card (ảnh bìa, tên bài tối đa 2 dòng, progress bar, và các chip: âm lượng, số bài còn trong queue, chế độ lặp, người yêu cầu, loa đang phát), phần embed bên dưới chỉ còn tên bài bấm được + danh sách bài kế tiếp, 2 hàng nút điều khiển và một select menu để nhảy tới bài bất kỳ trong queue. Panel chỉ hiện **tên bài**, không hiện link thô. Mỗi lần bấm nút, card được vẽ lại nên card không bao giờ nói ngược với embed.

Filter dùng được: `bassboost`, `nightcore`, `vaporwave`, `karaoke`, `8d`, `clear` (tắt hết). Filter chạy trên Lavalink nên có cooldown 5s mỗi server.

Âm lượng cho phép 10-150%.

Khi Stella đã phát nhạc, người dùng phải ở **cùng voice channel với Stella** mới điều khiển được player, gồm các thao tác như queue, skip và stop. Nếu Stella đang ở channel khác, hãy vào đúng channel đó trước.

## 5. Playlist Cá Nhân

Mỗi người có playlist riêng, lưu trong database nên sống qua mọi lần restart bot.

```text
/music playlist create name:Chill mô tả + link ảnh bìa (tuỳ chọn)
/music playlist create name:Chill from:<link playlist Spotify/YouTube>
/music playlist list
/music playlist view name:Chill
/music playlist add name:Chill query:tên bài
/music playlist add name:Chill query:<link cả playlist/album>
/music playlist save name:Chill          # lưu bài đang phát
/music playlist play name:Chill shuffle:true
/music playlist remove name:Chill position:3
/music playlist move name:Chill from:5 to:1
/music playlist cover name:Chill url:... | file:<ảnh upload>
/music playlist share name:Chill public:true
/music playlist import code:ABCD1234 name:Chill của bạn
/music playlist rename name:Chill newname:Chill 2
/music playlist delete name:Chill
```

Ô `name` có autocomplete: gõ vài chữ là Stella gợi ý playlist của chính bạn. Gõ tay cũng được, không phân biệt hoa/thường.

**Nạp cả một playlist có sẵn:** dán link playlist/album (Spotify, YouTube, SoundCloud...) vào `query` của `add`, hoặc vào `from` của `create`. Bot lấy **toàn bộ** bài trong link đó, không phải chỉ bài đầu. Bài nào đã có trong playlist thì bỏ qua (dán 2 lần không bị nhân đôi), và khi vượt trần bài/playlist thì bot báo rõ còn bao nhiêu bài chưa vào.

Link Spotify chỉ chạy khi **node Lavalink** có bật Spotify — xem mục 6 và kiểm tra bằng `/music health`. Thiếu là bot nói luôn cần sửa gì, không báo lỗi tiếng Anh khó hiểu.

Giới hạn (sửa ở `src/config.ts`, khối `music.playlist`): 5 playlist/người, 100 bài/playlist, mỗi lần `play` nạp tối đa 50 bài. Trần 50 bài/lần là có chủ ý — mỗi bài là một lượt resolve qua Lavalink, nạp 100 bài một lượt bắt node làm việc rất lâu chỉ cho một lệnh.

**Ảnh bìa** có 2 đường:

- **Dán link** (`url:`): phải là `https` và trỏ trực tiếp tới file `.png/.jpg/.jpeg/.gif/.webp`. Không cần cấu hình gì thêm.
- **Upload file** (`file:`): cần `MUSIC_ASSET_CHANNEL_ID` trỏ tới một text channel mà bot gửi được. Bot đăng lại ảnh vào kênh đó rồi lưu message id. Lý do không lưu URL đính kèm trực tiếp: URL attachment của Discord bây giờ có signature hết hạn (`?ex=&is=&hm=`), lưu URL thẳng thì vài ngày sau ảnh bìa chết. Thiếu env này thì lệnh sẽ bảo dùng `url:` thay thế.

**Share:** `share` bật công khai và trả về một mã ngắn (ví dụ `K7M2QP4R`). Người khác dùng `import code:...` để copy playlist về tài khoản họ — bản copy độc lập, họ sửa không ảnh hưởng bản gốc. Playlist chưa bật công khai thì chỉ chủ mở được bằng mã.

Bảng playlist cũ (`MusicPlaylistTrack`, 20 bài phẳng mỗi người) **không bị xoá**. Migration copy dữ liệu cũ sang một playlist tên "Playlist cũ"; chỉ khi đã kiểm tra dữ liệu đủ thì mới xoá bảng cũ ở migration sau.

## 6. Setup Spotify (LavaSrc)

Spotify được xử lý bởi plugin LavaSrc **chạy bên trong Lavalink**, không phải trong bot. Vì vậy `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` phải có mặt ở nơi Lavalink chạy:

- **Local Docker:** để trong `.env` ở gốc repo là đủ. `docker-compose.lavalink.yml` đọc `.env` rồi truyền 2 biến này vào container.
- **Lavalink remote (`lavalink-host/`):** đặt 2 biến trong environment của **panel/host chạy Lavalink**. Đặt vào `.env` của bot sẽ không có tác dụng gì.

Các bước:

1. Vào Spotify Developer Dashboard, tạo app mới (redirect URI điền gì cũng được, mình không dùng OAuth user).
2. Copy Client ID + Client Secret.
3. Đặt vào environment của Lavalink như trên.
4. Restart Lavalink (`docker compose -f docker-compose.lavalink.yml restart` hoặc restart service ở panel).
5. Kiểm tra bằng `/music health`: mục **Source node đang bật** phải có `✅ spotify`. Còn `❌ spotify` nghĩa là plugin/keys chưa vào — link Spotify sẽ không dùng được, kể cả khi bot vẫn phát nhạc YouTube bình thường.

Có Client ID/Secret là dùng được: search `spsearch:`, link track, album, playlist, artist top tracks.

Chưa dùng được (cần thêm auth, không setup ở phase này): `sprec:` (recommendations), playlist do Spotify tự sinh như Discover Weekly, và lyrics (cần cookie `spDc`).

Hai điều quan trọng cần biết:

- **Spotify chỉ là nguồn metadata.** LavaSrc đọc tên bài/artist/ISRC từ Spotify rồi tìm và phát audio từ YouTube (`providers` trong `application.yml`). Không có byte audio nào chảy từ Spotify. Hệ quả: bài nào YouTube không có thì link Spotify vẫn fail, và **Spotify Premium không liên quan gì đến chất lượng nhạc của bot**.
- **Cần LavaSrc >= 4.8.3.** Bản này sửa việc đọc playlist Spotify sang endpoint `/items`; app Spotify tạo mới bắt buộc phải có bản này mới load được playlist. Repo đang ghim 4.8.3 ở cả `lavalink/application.yml` và `lavalink-host/application.yml`.

Không bật `preferPartnerApi: true` trong config LavaSrc: nó bắn N request ISRC tuần tự cho mỗi playlist nên load rất chậm.

## 7. Chất Lượng Âm Thanh

Các nút xoay thật sự có tác dụng, đã set trong `application.yml`:

| Key | Giá trị | Ý nghĩa |
|---|---|---|
| `opusEncodingQuality` | 10 | Đây là **complexity** của Opus encoder (0-10), **không phải bitrate**. 10 = encode sạch nhất, tốn CPU hơn chút. |
| `resamplingQuality` | MEDIUM | Chỉ ảnh hưởng nguồn có sample rate khác 48kHz. HIGH chỉ nên bật khi node chạy dưới 5 player. |
| `bufferDurationMs` | 400 | Buffer của JDA-NAS. Nâng lên 800 nếu log thấy GC pause làm tiếng bị ngắt. |
| `frameBufferDurationMs` | 4000-5000 | Số ms audio đệm sẵn **cho mỗi player**. Cao thì đỡ giật, đổi lại tốn RAM theo số player. |
| `nonAllocatingFrameBuffer` | false | Bật lên thì ít cấp phát bộ nhớ hơn, nhưng đổi volume/filter sẽ không có hiệu lực tức thì. |

Giới hạn thật của bot: Lavaplayer không gọi `OPUS_SET_BITRATE`, nên libopus dùng chế độ tự động và đầu ra **chỉ khoảng 99 kbps**. Vì vậy:

- Nâng bitrate của voice channel lên 256/384 kbps (boost server) **không** làm nhạc bot hay hơn. 96-128 kbps là đủ.
- Muốn nghe hay hơn thật thì tập trung vào: nguồn nhạc tốt, node Lavalink không quá tải, và mạng của node ổn định.

Âm lượng: bot đang dùng `volumeDecrementer: 0.75`, nghĩa là số % người dùng thấy được nhân 0.75 trước khi gửi xuống Lavalink (100% người dùng = 75% thật). Trần 150% (tức 112% thật) để to mà chưa rè. Trên 130% thì dễ méo tiếng tuỳ bài.

## 8. Phát Song Song Nhiều Kênh Voice

Discord chỉ cho **một** bot user ở **một** kênh voice trong một server. Nên "kênh voice 1 và kênh voice 2 cùng phát 2 bài khác nhau" **không thể** làm bằng một token — bắt buộc phải có bot thứ hai.

Cách làm:

1. Vào Discord Developer Portal, tạo application mới (ví dụ "Stella Loa 2"), lấy bot token.
2. Mời bot đó vào server với quyền `Connect` + `Speak` (không cần quyền đọc/gửi tin nhắn).
3. Thêm token vào `.env` của bot chính:

```env
MUSIC_SATELLITE_TOKENS=token_loa_2,token_loa_3
```

4. Restart bot chính. Log sẽ có `[music] Stella Loa 2 online: ...`.

Cách nó chạy: bot chính (loa 1) khởi động xong thì tự login các bot loa phụ trong cùng process. Loa phụ chỉ bật intent `Guilds` + `GuildVoiceStates`, không load command, không đọc tin nhắn — mọi panel và phản hồi vẫn do bot chính gửi. Khi có người `s!play` ở một kênh voice đang bị chiếm, router tự chọn loa còn rảnh.

Số kênh phát cùng lúc = 1 + số token. Ba điều cần biết:

- Token sai hoặc bot phụ chưa được mời vào server thì chỉ loa đó bị bỏ, bot chính vẫn chạy bình thường (log ghi rõ loa nào lỗi).
- Tất cả loa dùng chung Lavalink node. Mỗi player thêm vào là thêm RAM (`frameBufferDurationMs`) và CPU encode, nên đừng thêm 5 loa vào một node 512MB.
- `/music health` hiện danh sách loa và loa nào đang phát ở kênh nào.

## 9. Chặn Quảng Cáo

"Chặn quảng cáo" có 3 loại khác nhau, đừng lẫn:

1. **Quảng cáo pre-roll/mid-roll của YouTube:** Lavalink stream trực tiếp track audio nên **vốn đã không có**. Không cần làm gì.
2. **Đoạn sponsor/tự quảng cáo trong chính video** (kiểu "video này được tài trợ bởi..."): cần plugin SponsorBlock, repo đã cấu hình sẵn. Bot bật các nhóm `sponsor`, `selfpromo`, `interaction`, `intro`, `outro`, `preview`, `music_offtopic`. Cố ý **không** bật `filler` vì nó hay cắt luôn phần muốn nghe.
3. **Quảng cáo Spotify:** không tồn tại, vì audio không đến từ Spotify (xem mục 6).

Nếu Lavalink log 404 khi tải `sponsorblock-plugin`, đổi `repository` của plugin đó sang `https://maven.topi.wtf/releases` rồi restart. Nếu plugin gây lỗi load track, đặt `MUSIC_SPONSORBLOCK=0` trong `.env` của bot để tắt phía client — không cần sửa Lavalink.

Lưu ý: bản SponsorBlock mới nhất là 3.0.1 (2024), khá lâu không có release mới. Nó vẫn tương thích Lavalink v4 nhưng nên coi là tính năng thử nghiệm: nếu thấy bài bị cắt lạ, tắt bằng env ở trên.

## Lưu Ý Cho Hosting

- Không upload `.env` lên GitHub. Tạo `.env` trực tiếp trong file manager/SFTP hoặc biến môi trường của panel.
- Nếu hosting không có Java/Docker, không chạy Lavalink trên cùng hosting. Dùng node Lavalink remote.
- Cần chạy `npm install`, `npm run build`, `npm start`.
- Nếu dùng database cloud, chạy `npm run db:migrate` trước lần start chính thức.
- Nếu upload bản zip, đừng upload `node_modules`, `dist.zip`, backup DB, log cũ.

## Lỗi Thường Gặp

- Bot không vào voice: kiểm tra bot có quyền `Connect`, `Speak`, `Use Voice Activity`.
- Không điều khiển được nhạc: kiểm tra bạn có đang ở cùng voice channel với Stella không.
- Không search được YouTube: xem log `stella-lavalink`, plugin YouTube có tải thành công không.
- `/music playlist` báo "Playlist v2 chưa có trong database": chưa chạy `npm run db:migrate`.
- Upload ảnh bìa báo thiếu `MUSIC_ASSET_CHANNEL_ID`: đặt env đó, hoặc dùng option `url` để dán link ảnh.
- Spotify không chạy: kiểm tra `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` có mặt ở **nơi Lavalink chạy** (mục 6), rồi restart Lavalink.
- Dán link playlist Spotify vào `/music playlist add` mà bot nói node chưa bật Spotify: đúng như vậy — node chưa có LavaSrc/keys. Sửa theo mục 6 rồi xem lại `/music health`.
- `/music health` báo `❌ youtube`: plugin `youtube-plugin` chưa nạp được, xem log Lavalink lúc start.
- Playlist đã lưu phát thiếu vài bài: link gốc chết thì bot tự tìm lại theo **tên + nghệ sĩ**; bài nào cả hai cách đều không ra mới bị bỏ và được báo trong phần "bỏ qua N bài lỗi".
- Playlist Spotify load lỗi trong khi track lẻ vẫn được: node đang dùng LavaSrc cũ hơn 4.8.3.
- Ảnh card panel không hiện: bình thường khi nguồn nhạc không có ảnh bìa; bot tự vẽ card nền gradient thay thế.
- Bot loa phụ không online: xem log dòng `login thất bại` — token sai, hoặc bot phụ chưa được mời vào server.
- Port 2333 bị chiếm: đổi port trong `docker-compose.lavalink.yml` và `.env`.
- Trên hosting `/music health` có node nhưng không play: kiểm tra firewall outbound tới Lavalink remote và password node.
