const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const sourceDir = path.join(__dirname, 'src');
const buildScript = path.join(__dirname, 'scripts', 'build-dist.js');

// Git deploy chi cap nhat src/, con dist/ bi ignore. Neu khoi dong thang bang
// `node index.js` ma khong build, bot se am tham chay code cu. esbuild du nhe
// cho shared host, nen source checkout luon duoc build lai truoc khi require.
// Goi host-package khong mang src/ nen van dung dist da build san nhu cu.
if (fs.existsSync(sourceDir)) {
    if (!fs.existsSync(buildScript)) {
        console.error('Missing scripts/build-dist.js; cannot compile the checked-out source.');
        process.exit(1);
    }
    console.log('[startup] Source checkout detected; rebuilding dist before launch.');
    try {
        execFileSync(process.execPath, [buildScript], { cwd: __dirname, stdio: 'inherit' });
    } catch (error) {
        console.error('[startup] Build failed; refusing to run a stale dist/.');
        process.exit(typeof error?.status === 'number' ? error.status : 1);
    }
}

const entry = path.join(__dirname, 'dist', 'index.js');

if (!fs.existsSync(entry)) {
    console.error('Missing dist/index.js. Run `npm run build` locally or before starting the bot.');
    process.exit(1);
}

require(entry);
