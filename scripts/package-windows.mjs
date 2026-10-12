// Builds the ready-to-play Windows version: release/StrikeWing-PC-Windows.zip
// (a "Strike Wing" folder with Strike Wing.exe; no install, no Node needed).
// Works on Windows, macOS or Linux: npm run package:windows
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const ELECTRON = '44.7.0';
const out = 'release';
const ignore = ['^/src($|/)', '^/src-tauri', '^/node_modules', '^/scripts', '^/release', '^/stress-shots', '^/mobile-game', '^/sound-preview', '^/\\.github', '^/public', '^/README', '^/index\\.html', '^/vite\\.config', '\\.apk$']
  .map((p) => `--ignore="${p}"`)
  .join(' ');
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('npm run build');
rmSync(out, { recursive: true, force: true });
run(
  `npx --yes @electron/packager@18 . "Strike Wing" --platform=win32 --arch=x64 --electron-version=${ELECTRON} --out=${out} --overwrite ` +
    `--icon=src-tauri/icons/icon.ico --app-version=${process.env.APP_VERSION || '1.0.0'} ` +
    `--win32metadata.CompanyName="Strike Wing" --win32metadata.ProductName="Strike Wing" --win32metadata.FileDescription="Strike Wing" ${ignore}`,
);
const dir = join(out, 'Strike Wing');
renameSync(join(out, 'Strike Wing-win32-x64'), dir);
cpSync(join('electron', 'READ ME FIRST.txt'), join(dir, 'READ ME FIRST.txt'));
const zip = join(out, 'StrikeWing-PC-Windows.zip');
if (process.platform === 'win32') run(`powershell -NoProfile -Command "Compress-Archive -Path '${dir}' -DestinationPath '${zip}' -Force"`);
else run(`cd ${out} && zip -q -r -9 StrikeWing-PC-Windows.zip "Strike Wing"`);
console.log(existsSync(zip) ? `Done: ${zip}` : 'Zip failed');
