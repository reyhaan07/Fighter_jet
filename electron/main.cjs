// Electron shell: serves the built game from dist/ through a tiny local web
// server on 127.0.0.1 (random port, never reachable from the network), so ES
// modules, the AI Web Worker and fonts load exactly as in a browser on every
// OS. No internet access is used.
const { app, BrowserWindow, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel;
      try {
        rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.resolve(DIST, '.' + rel);
      if (!file.toLowerCase().startsWith(path.resolve(DIST).toLowerCase())) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    dialog.showErrorBox('Strike Wing', `Game files are missing:\n${DIST}\n\nExtract the whole ZIP and run Strike Wing.exe from the extracted folder.`);
    app.quit();
    return;
  }
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    title: 'Strike Wing',
    backgroundColor: '#05070b',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
  // F12 opens the developer console (handy if something goes wrong).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => app.quit());
