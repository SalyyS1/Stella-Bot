// Biên dịch src/ -> dist/ bằng esbuild.
//
// VÌ SAO KHÔNG DÙNG tsc Ở ĐÂY: host là shared hosting, và tsc phải nạp toàn bộ type của
// Prisma Client (60+ model, .d.ts vài MB) cùng 250+ file nguồn. Đỉnh RAM của nó vượt hạn
// mức container nên kernel kill tiến trình (exit 137, "Out of memory: true"). esbuild viết
// bằng Go, chỉ dịch cú pháp chứ không dựng type graph, nên dùng vài chục MB.
//
// ĐÁNH ĐỔI PHẢI BIẾT: esbuild KHÔNG kiểm type. Việc đó thuộc `npm run typecheck`
// (tsc --noEmit) ở máy dev. Đừng bỏ bước đó — không có nó thì lỗi type chỉ lộ lúc chạy.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, 'dist');

/** Mọi file khớp `test` nằm dưới `dir`, trả về đường dẫn tuyệt đối. */
function walk(dir, test, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        // assets (font, ảnh) không cần copy: code tìm chúng ở cả src/assets và dist/assets.
        if (entry.isDirectory()) {
            if (entry.name !== 'assets') walk(full, test, found);
        } else if (test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

async function main() {
    // Gói host-package (dựng bằng `npm run host:prepare`) đã biên dịch sẵn và cố ý KHÔNG
    // mang src/ theo. Với gói đó thì không có gì để dịch — và cũng không có gì để bị cũ,
    // vì không tồn tại nguồn nào mới hơn dist. Bỏ qua, đừng làm `npm install` thất bại.
    if (!fs.existsSync(srcDir)) {
        console.log('[build] không có src/ — coi đây là gói đã biên dịch sẵn, giữ nguyên dist/.');
        return;
    }

    const entryPoints = walk(srcDir, name => name.endsWith('.ts'));
    // Có src/ mà không có file .ts nào thì là upload lỗi, không phải gói pre-built. Dừng
    // ầm ĩ: im lặng ở đây nghĩa là host chạy dist cũ mà không ai biết.
    if (!entryPoints.length) throw new Error('src/ tồn tại nhưng không có file .ts nào — upload bị thiếu?');

    // Xoá dist trước mỗi lần build. Không xoá thì file .js của một module đã bị đổi tên
    // hoặc xoá khỏi src vẫn nằm lại trong dist và vẫn được nạp — bug khó thấy nhất trong
    // cả quy trình deploy.
    fs.rmSync(outDir, { recursive: true, force: true });

    // require esbuild ở đây, không ở đầu file: gói pre-built không cần nó, và một gói
    // thiếu esbuild vẫn phải chạy được thay vì làm `npm install` chết.
    const esbuild = require('esbuild');
    await esbuild.build({
        entryPoints,
        outdir: outDir,
        outbase: srcDir,
        platform: 'node',
        // Khớp `target` trong tsconfig.json. Đổi một chỗ thì đổi cả hai.
        target: 'es2020',
        format: 'cjs',
        // bundle: false = dịch từng file một, giữ nguyên các lời gọi require tương đối.
        // Bundle lại thành một file sẽ phá handler tự nạp lệnh/event: chúng đọc thư mục
        // dist/commands và dist/events lúc chạy.
        bundle: false,
        sourcemap: false,
        logLevel: 'warning'
    });

    // tsconfig có resolveJsonModule nên trong src có `import ... from '*.json'`. esbuild ở
    // chế độ không bundle để nguyên lời gọi require nhưng không tự copy file json.
    const jsonFiles = walk(srcDir, name => name.endsWith('.json'));
    for (const file of jsonFiles) {
        const target = path.join(outDir, path.relative(srcDir, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
    }

    console.log(`[build] ${entryPoints.length} file .ts + ${jsonFiles.length} file .json -> dist/`);
}

main().catch(error => {
    console.error('[build] lỗi:', error);
    process.exit(1);
});
