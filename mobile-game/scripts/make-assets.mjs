// Renders the Android launcher icons and splash screens from ../public/icon.svg
// (the same artwork as the desktop icon). Run once: node scripts/make-assets.mjs
// Needs Playwright's Chromium.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, '..', 'android', 'app', 'src', 'main', 'res');
const svg = await readFile(join(HERE, '..', '..', 'public', 'icon.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const defs = inner.match(/<defs>[\s\S]*?<\/defs>/)[0];
const art = inner.replace(defs, '').replace(/<rect[^>]*\/>/, '');

// Adaptive-icon foreground: the artwork shrunk into the 66 % safe zone.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}<g transform="translate(512 512) scale(0.62) translate(-512 -512)">${art}</g></svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}<circle cx="512" cy="512" r="512" fill="url(#bg)"/><g transform="translate(512 512) scale(0.86) translate(-512 -512)">${art}</g></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(markup, w, h, bg = 'transparent') {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${bg};width:${w}px;height:${h}px;overflow:hidden">${markup}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: w, height: h } });
}
const sized = (s, n) => s.replace('<svg ', `<svg width="${n}" height="${n}" `);

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const n = Math.round(48 * k);
  await writeFile(join(RES, `mipmap-${d}`, 'ic_launcher.png'), await render(sized(svg, n), n, n));
  await writeFile(join(RES, `mipmap-${d}`, 'ic_launcher_round.png'), await render(sized(round, n), n, n));
  const f = Math.round(108 * k);
  await writeFile(join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'), await render(sized(fg, f), f, f));
}

// Splash: dark sky, the icon and the title.
const splash = (w, h) => {
  const s = Math.round(Math.min(w, h) * 0.32);
  return `<div style="width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(s * 0.12)}px;background:radial-gradient(ellipse at 50% 40%,#16263a,#05070b 70%)">
    ${sized(svg, s)}
    <div style="font:700 ${Math.round(s * 0.2)}px Georgia,serif;letter-spacing:${Math.round(s * 0.04)}px;color:#e6f2ff">STRIKE WING</div></div>`;
};
const sizes = {
  'drawable/splash.png': [480, 320],
  'drawable-land-mdpi/splash.png': [480, 320],
  'drawable-land-hdpi/splash.png': [800, 480],
  'drawable-land-xhdpi/splash.png': [1280, 720],
  'drawable-land-xxhdpi/splash.png': [1600, 960],
  'drawable-land-xxxhdpi/splash.png': [1920, 1280],
  'drawable-port-mdpi/splash.png': [320, 480],
  'drawable-port-hdpi/splash.png': [480, 800],
  'drawable-port-xhdpi/splash.png': [720, 1280],
  'drawable-port-xxhdpi/splash.png': [960, 1600],
  'drawable-port-xxxhdpi/splash.png': [1280, 1920],
};
for (const [file, [w, h]] of Object.entries(sizes)) await writeFile(join(RES, file), await render(splash(w, h), w, h, '#05070b'));
await browser.close();
console.log('Android icons and splash screens written.');
