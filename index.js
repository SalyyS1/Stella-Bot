const fs = require('fs');
const path = require('path');

const entry = path.join(__dirname, 'dist', 'index.js');

if (!fs.existsSync(entry)) {
    console.error('Missing dist/index.js. Run `npm run build` locally or before starting the bot.');
    process.exit(1);
}

require(entry);
