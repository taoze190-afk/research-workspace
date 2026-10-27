const fs = require('node:fs');
const path = require('node:path');

function readState(directory) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(directory, 'desktop-state.json'), 'utf8'));
    return { port: Number.isInteger(state.port) && state.port >= 1024 && state.port <= 65535 ? state.port : 0 };
  } catch {
    return { port: 0 };
  }
}
function saveState(directory, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('本机服务端口无效');
  const file = path.join(directory, 'desktop-state.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify({ port }, null, 2));
  fs.renameSync(file + '.tmp', file);
}
function isAppUrl(url, origin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
function isExternalUrl(url) {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
module.exports = { readState, saveState, isAppUrl, isExternalUrl };
