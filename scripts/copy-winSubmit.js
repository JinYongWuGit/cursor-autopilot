const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'core', 'winSubmit.ps1');
const destDir = path.join(root, 'out', 'core');
const dest = path.join(destDir, 'winSubmit.ps1');

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[compile] copied winSubmit.ps1 -> out/core/');
