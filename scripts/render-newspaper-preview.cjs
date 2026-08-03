// Render thử tờ báo từ sample data (chạy TAY sau khi build: npm run build).
// Ghi ra tmp_newspaper_preview.png (đã nằm trong .gitignore) — mở bằng mắt để
// kiểm dấu tiếng Việt, bố cục, không tràn trước khi đưa vào đường thật.
const fs = require('fs');
const path = require('path');
const { renderNewspaper } = require('../dist/systems/report/newspaper/newspaper-canvas.js');
const { registerFonts } = require('../dist/systems/report/newspaper/newspaper-fonts.js');

(async () => {
    registerFonts();
    const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-front-page.json'), 'utf8'));

    const daily = await renderNewspaper(sample);
    fs.writeFileSync('tmp_newspaper_preview.png', daily);
    console.log('daily  -> tmp_newspaper_preview.png');

    const weekly = await renderNewspaper(sample, { weekly: true });
    fs.writeFileSync('tmp_newspaper_preview_weekly.png', weekly);
    console.log('weekly -> tmp_newspaper_preview_weekly.png');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
