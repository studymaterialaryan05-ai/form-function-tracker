const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'www');
const indexPath = path.join(root, 'index.html');
const helperPath = path.join(root, 'tracker-core.js');
const assetPaths = ['manifest.webmanifest', 'assets/icon.svg', 'supabase-config.js'];
function releaseHash(html, helper, assets = []) {
  const normalized = html.replace(/(\.\/tracker-core\.js)\?release=[a-f0-9]{16}/g, '$1');
  return crypto.createHash('sha256').update(normalized + '\0' + helper + '\0' + assets.join('\0')).digest('hex').slice(0, 16);
}
function stamp(html, helper) {
  const id = releaseHash(html, helper, arguments[2] || []);
  const updated = html.replace(/(src=["']\.\/tracker-core\.js)(?:\?release=[a-f0-9]{16})?(["'])/g, '$1?release=' + id + '$2');
  if (!updated.includes('tracker-core.js?release=' + id)) throw new Error('Could not find tracker-core.js in www/index.html');
  return updated;
}
function run() {
  const html = fs.readFileSync(indexPath, 'utf8');
  const helper = fs.readFileSync(helperPath, 'utf8');
  const assets = assetPaths.map(relative => fs.readFileSync(path.join(root, relative), 'utf8'));
  const updated = stamp(html, helper, assets);
  if (process.argv.includes('--check')) {
    if (updated !== html) { console.error('Release stamp is stale; run npm run build:web.'); process.exitCode = 1; }
    return;
  }
  if (updated !== html) fs.writeFileSync(indexPath, updated);
}
if (require.main === module) run();
module.exports = { releaseHash, stamp, assetPaths };