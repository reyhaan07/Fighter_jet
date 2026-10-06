// Rasterises public/icon.svg into the desktop app icons (PNG, ICO, ICNS) used
// by Tauri and Electron. Needs Playwright's Chromium (run once, offline).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const svg = await readFile('public/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const png = {};
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  png[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
await mkdir('src-tauri/icons', { recursive: true });
await writeFile('src-tauri/icons/32x32.png', png[32]);
await writeFile('src-tauri/icons/128x128.png', png[128]);
await writeFile('src-tauri/icons/128x128@2x.png', png[256]);
await writeFile('src-tauri/icons/icon.png', png[512]);
await writeFile('public/icon-512.png', png[512]);

// ICO with embedded PNG images.
const icoSizes = [16, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, e);
  header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png[s].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png[s].length;
});
await writeFile('src-tauri/icons/icon.ico', Buffer.concat([header, ...icoSizes.map((s) => png[s])]));

// ICNS with PNG chunks.
const chunks = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, s]) => {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'ascii');
  h.writeUInt32BE(png[s].length + 8, 4);
  return Buffer.concat([h, png[s]]);
});
const body = Buffer.concat(chunks);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(body.length + 8, 4);
await writeFile('src-tauri/icons/icon.icns', Buffer.concat([icnsHeader, body]));
console.log('icons written to src-tauri/icons');
