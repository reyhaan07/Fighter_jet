// One-click launcher: serves the built game from dist/ on 127.0.0.1 and opens
// it in its own browser window. No internet needed. Builds the game first if
// dist/ is missing. The server shuts itself down a minute after the game
// window is closed (the page pings it while open).
//
// Used by the desktop shortcut (npm run shortcut) and `npm run launch`.

import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/index.html`;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

function run(cmd, args, opts) {
  const c = spawn(cmd, args, opts);
  c.on('error', () => console.log(`Open ${URL} in your browser.`));
  c.unref();
}

function openWindow() {
  const p = process.platform;
  const quiet = { stdio: 'ignore', detached: true };
  try {
    if (p === 'win32') {
      // Edge ships with Windows: --app gives a clean game window without browser UI.
      run('cmd', ['/c', 'start', '', 'msedge', `--app=${URL}`, '--start-maximized'], { ...quiet, windowsHide: true });
    } else if (p === 'darwin') {
      const chrome = '/Applications/Google Chrome.app';
      if (existsSync(chrome)) run('open', ['-na', chrome, '--args', `--app=${URL}`, '--start-maximized'], quiet);
      else run('open', [URL], quiet);
    } else {
      const browsers = ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];
      const found = browsers.find((b) => {
        try {
          execSync(`command -v ${b}`, { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      });
      if (found) run(found, [`--app=${URL}`, '--start-maximized'], quiet);
      else run('xdg-open', [URL], quiet);
    }
  } catch {
    console.log(`Open ${URL} in your browser.`);
  }
}

/** Is a Strike Wing server already running? */
function alreadyRunning() {
  return new Promise((done) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/__alive', timeout: 800 }, (res) => {
      res.resume();
      done(res.statusCode === 204);
    });
    req.on('error', () => done(false));
    req.on('timeout', () => {
      req.destroy();
      done(false);
    });
    req.end();
  });
}

if (await alreadyRunning()) {
  openWindow();
  process.exit(0);
}

/** Newest modification time under a folder (to spot source changes). */
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(f) : statSync(f).mtimeMs);
  }
  return t;
}

const built = existsSync(join(DIST, 'index.html')) ? statSync(join(DIST, 'index.html')).mtimeMs : 0;
if (!built || newest(join(ROOT, 'src')) > built) {
  console.log(built ? 'Game updated: rebuilding…' : 'First start: building the game (takes a few seconds)…');
  if (!existsSync(join(ROOT, 'node_modules'))) execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}

let lastPing = Date.now();
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/__alive') {
    lastPing = Date.now();
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  let file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Strike Wing running at ${URL}`);
  openWindow();
});

// Quit once the game window has been closed for a minute.
setInterval(() => {
  if (Date.now() - lastPing > 60000) process.exit(0);
}, 10000);
