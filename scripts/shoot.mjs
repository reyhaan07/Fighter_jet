// Headless smoke test: serves dist/, opens the game in Chromium, runs an
// optional scenario, reports console errors and saves screenshots.
// Usage: node scripts/shoot.mjs <outDir> [scenario.js]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const out = resolve(process.argv[2] || 'shots');
const scenarioPath = process.argv[3];
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try {
    const data = await readFile(p);
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text());
  else if (m.text().startsWith('[test]')) console.log(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${port}/index.html${process.env.QS || ''}`);
try {
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 120000 });
} catch (e) {
  console.log('BOOT FAILED:', await page.evaluate(() => document.getElementById('boot')?.textContent));
  console.log(errors.join('\n'));
  process.exit(1);
}
const { mkdir } = await import('node:fs/promises');
await mkdir(out, { recursive: true });
const ctx = { page, out, shot: (name) => page.screenshot({ path: join(out, name + '.png') }) };
if (scenarioPath) {
  const mod = await import(resolve(scenarioPath));
  try {
    await mod.default(ctx);
  } catch (e) {
    console.log('SCENARIO FAILED:', e.message.split('\n')[0]);
    await ctx.shot('failure').catch(() => {});
  }
} else {
  await page.waitForTimeout(3000);
  await ctx.shot('default');
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 30).join('\n') : 'no console errors');
await browser.close();
server.close();
