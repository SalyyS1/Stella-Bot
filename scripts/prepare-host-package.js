const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'host-package');

const copyFiles = [
    'index.js',
    'package.json',
    'package-lock.json',
    '.env.example',
    'docker-compose.lavalink.yml'
];

const copyDirs = [
    'dist',
    'prisma',
    'scripts',
    'docs',
    'lavalink'
];

function remove(target) {
    fs.rmSync(target, { recursive: true, force: true });
}

function ensureDir(target) {
    fs.mkdirSync(target, { recursive: true });
}

function shouldSkip(source) {
    const name = path.basename(source);
    if (name === 'node_modules' || name === '.git' || name === 'backups' || name === 'logs') return true;
    if (name.endsWith('.zip') || name.endsWith('.log')) return true;
    if (name.startsWith('tmp_')) return true;
    if (path.basename(path.dirname(source)) === 'prisma' && /\.(db|db-journal|db-shm|db-wal)$/i.test(name)) return true;
    return false;
}

function copyFile(source, target) {
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
}

function copyDir(source, target) {
    if (!fs.existsSync(source)) return;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const src = path.join(source, entry.name);
        const dst = path.join(target, entry.name);
        if (shouldSkip(src)) continue;
        if (entry.isDirectory()) copyDir(src, dst);
        else if (entry.isFile()) copyFile(src, dst);
    }
}

remove(out);
ensureDir(out);

for (const file of copyFiles) {
    const src = path.join(root, file);
    if (fs.existsSync(src)) copyFile(src, path.join(out, file));
}

for (const dir of copyDirs) {
    copyDir(path.join(root, dir), path.join(out, dir));
}

copyDir(path.join(root, 'src', 'assets'), path.join(out, 'assets'));

const readme = `# Stella Bot Host Package

Upload these files to /home/container on Pterodactyl.

Required on host:
1. Create .env from .env.example.
2. Run npm install.
3. Start with: node index.js

Recommended startup command:
if [ -f /home/container/package.json ]; then npm install; fi; node /home/container/index.js

If database migrations are ready:
if [ -f /home/container/package.json ]; then npm install; fi; npm run db:migrate; node /home/container/index.js
`;

fs.writeFileSync(path.join(out, 'HOST_README.md'), readme, 'utf8');
console.log(`Prepared host package at ${out}`);
