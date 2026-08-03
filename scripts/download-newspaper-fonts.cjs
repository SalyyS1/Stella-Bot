// Tải lại font tờ báo nhật báo (chạy TAY khi cần tái lập — font đã commit vào repo
// nên host không bao giờ cần chạy script này).
//
// Nguồn:
//   - static TTF: notofonts/notofonts.github.io (repo chính thức của Noto team) —
//     đúng weight Bold/Regular, renderer dùng trực tiếp.
//   - variable TTF: google/fonts repo (dự phòng khi static thiếu — weight chỉ ra
//     mặc định nhưng chữ vẫn đúng dấu tiếng Việt).
//   - OFL.txt: giấy phép SIL Open Font License 1.1 từ google/fonts.
const https = require('https');
const fs = require('fs');
const path = require('path');

const FILES = [
    // static (chính)
    ['https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf', 'NotoSans-Regular.ttf'],
    ['https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf', 'NotoSans-Bold.ttf'],
    ['https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSerif/hinted/ttf/NotoSerif-Regular.ttf', 'NotoSerif-Regular.ttf'],
    ['https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSerif/hinted/ttf/NotoSerif-Bold.ttf', 'NotoSerif-Bold.ttf'],
    // variable (dự phòng)
    ['https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf', 'NotoSans-variable.ttf'],
    ['https://raw.githubusercontent.com/google/fonts/main/ofl/notoserif/NotoSerif%5Bwdth,wght%5D.ttf', 'NotoSerif-variable.ttf'],
    // giấy phép
    ['https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/OFL.txt', 'OFL.txt']
];

function download(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode !== 200) return reject(new Error(`${url} -> HTTP ${res.statusCode}`));
            const ws = fs.createWriteStream(dest);
            res.pipe(ws);
            ws.on('finish', () => ws.close(resolve));
        }).on('error', reject);
    });
}

(async () => {
    const dir = path.join(__dirname, '..', 'src', 'assets', 'fonts');
    fs.mkdirSync(dir, { recursive: true });
    for (const [url, name] of FILES) {
        const dest = path.join(dir, name);
        await download(url, dest);
        console.log(`ok  ${name} (${fs.statSync(dest).size} bytes)`);
    }
    console.log('done — font đã sẵn sàng commit.');
})().catch(err => {
    console.error('lỗi:', err.message);
    process.exit(1);
});
