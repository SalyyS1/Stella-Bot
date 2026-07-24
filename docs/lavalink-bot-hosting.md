# Lavalink Trên Bot-Hosting.net Cho Stella

Stella không nên chạy Lavalink chung process với bot Node.js. Tạo **deployment/server Java riêng** cho Lavalink, rồi bot Stella kết nối qua `LAVALINK_NODES`.

## 1. Tạo Deployment Lavalink

Trên Bot-Hosting.net:

1. Create Server / Deployment mới.
2. Runtime/Language: `Java`.
3. Plan: nếu Starter+ có nhiều slot, dùng slot thứ hai.
4. Upload hoặc deploy GitHub repo này.
5. Root folder cần có thư mục `lavalink-host/`.

Nếu panel cho chọn startup command, dùng:

```bash
cd /home/container/lavalink-host && bash start.sh
```

Nếu panel chỉ có `JAR FILE`, cách dễ hơn:

```bash
cd /home/container/lavalink-host && curl -L --fail -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar && java -Xmx768m -jar Lavalink.jar
```

## 2. Env Cho Lavalink Deployment

`LAVALINK_SERVER_PASSWORD` là **bắt buộc**. Lavalink sẽ không khởi động nếu thiếu biến này; không còn password mặc định trong package host.

Đặt các biến này:

```env
LAVALINK_SERVER_PASSWORD=doi_password_dai_ngau_nhien
LAVALINK_VERSION=4.2.2
JAVA_OPTS=-Xmx768m
```

Nếu muốn Spotify playlist/album tốt hơn:

```env
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

## 3. Lấy Host/Port

Sau khi Lavalink online, lấy host/port public trong panel Bot-Hosting.

Ví dụ:

```text
Host: lavalink-example.bot-hosting.net
Port: 12345
Secure: false
Password: giống LAVALINK_SERVER_PASSWORD
```

Nếu Bot-Hosting cấp domain HTTPS/WSS riêng thì `secure=true`, còn port TCP thường thì `secure=false`.

## 4. Env Cho Stella Bot

Trong deployment bot Node.js, thêm:

```env
MUSIC_PREFIX=s!
LAVALINK_NODES=[{"id":"Stella Lavalink","host":"HOST_CUA_LAVALINK","port":PORT_CUA_LAVALINK,"authorization":"PASSWORD_CUA_LAVALINK","secure":false}]
```

Ví dụ:

```env
LAVALINK_NODES=[{"id":"Stella Lavalink","host":"1.2.3.4","port":2333,"authorization":"doi_password_dai_ngau_nhien","secure":false}]
```

Restart bot, rồi test:

```text
/music health
```

Nếu health thấy node configured và Lavalink log có `Node connected`, bắt đầu test:

```text
/music play query:lofi minecraft
s!play lofi minecraft
```

## Lưu Ý

- Lavalink cần Java 17+.
- Dùng password dài, ngẫu nhiên và không tái sử dụng; bot Stella phải dùng đúng cùng giá trị trong `LAVALINK_PASSWORD` hoặc `LAVALINK_NODES`.
- `http` source đã tắt để Lavalink không thể fetch URL nội bộ/cloud metadata. Dùng search hoặc link từ các source âm nhạc được Lavalink hỗ trợ thay vì URL `.mp3` trực tiếp.
- Nếu `/music health` có node nhưng play lỗi, kiểm tra firewall/port public của deployment Lavalink.
- Nếu Lavalink log báo thiếu plugin hoặc YouTube search lỗi, restart Lavalink để plugin manager tải lại.
