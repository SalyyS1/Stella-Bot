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

This package is already compiled: dist/ holds the built code and there is no src/.
scripts/build-dist.js detects the missing src/ and keeps dist/ as-is, so npm install will
not fail — but that also means YOU must rebuild and re-upload dist/ after every code change.

Prefer deploying with git instead: clone the repo on the host and run \`git pull\`. The
postinstall step then rebuilds dist/ from source with esbuild on every install, so the host
can never quietly run stale code. Do NOT run \`tsc\` on the host — it needs more RAM than a
shared container gets and the kernel kills it (exit code 137, "Out of memory: true").

Required on host:
1. Create .env from .env.example.
2. Run npm install. Its postinstall runs \`prisma generate\`, which MUST run here because
   the Prisma query engine is a per-platform binary.
3. Run npm run db:migrate once, by hand, whenever migrations are pending.
4. Start with: node index.js

Recommended startup command:
if [ -f /home/container/package.json ]; then npm install --no-fund --no-audit; fi; node /home/container/index.js

Keep db:migrate out of the startup command: every restart would wait on it, and an
unreachable database would turn one clear error into a crash loop.
`;

fs.writeFileSync(path.join(out, 'HOST_README.md'), readme, 'utf8');
console.log(`Prepared host package at ${out}`);
