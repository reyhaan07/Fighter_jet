// Creates a "Strike Wing" shortcut on your desktop. One click on it starts
// the game in its own window (see scripts/serve.mjs). Run once: npm run shortcut

import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const SERVE = join(ROOT, 'scripts', 'serve.mjs');
const p = process.platform;

function desktopDir() {
  if (p === 'win32') {
    try {
      // Handles OneDrive-redirected desktops.
      return execSync('powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"').toString().trim();
    } catch {
      return join(homedir(), 'Desktop');
    }
  }
  if (p === 'linux') {
    try {
      const d = execSync('xdg-user-dir DESKTOP', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (d) return d;
    } catch {
      /* fall through */
    }
  }
  return join(homedir(), 'Desktop');
}

const desktop = desktopDir();
if (!existsSync(desktop)) mkdirSync(desktop, { recursive: true });

if (p === 'win32') {
  // A tiny VBScript starts the server without a console window.
  const vbs = join(ROOT, 'scripts', 'launch.vbs');
  writeFileSync(
    vbs,
    `Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "${ROOT}"\r\nsh.Run """${NODE}"" ""${SERVE}""", 0, False\r\n`,
  );
  const lnk = join(desktop, 'Strike Wing.lnk');
  const icon = join(ROOT, 'src-tauri', 'icons', 'icon.ico');
  const q = (x) => "'" + x.replace(/'/g, "''") + "'";
  const ps1 = join(ROOT, 'scripts', 'make-shortcut.ps1');
  writeFileSync(
    ps1,
    [
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)})`,
      `$s.TargetPath = 'wscript.exe'`,
      `$s.Arguments = ${q('"' + vbs + '"')}`,
      `$s.WorkingDirectory = ${q(ROOT)}`,
      `$s.IconLocation = ${q(icon)}`,
      `$s.Description = 'Strike Wing'`,
      `$s.Save()`,
    ].join('\r\n'),
  );
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { stdio: 'inherit' });
  console.log(`Shortcut created: ${lnk}`);
} else if (p === 'darwin') {
  const file = join(desktop, 'Strike Wing.command');
  writeFileSync(file, `#!/bin/bash\ncd "${ROOT}"\nnohup "${NODE}" "${SERVE}" >/dev/null 2>&1 &\nexit 0\n`);
  chmodSync(file, 0o755);
  console.log(`Shortcut created: ${file}`);
  console.log('Tip: right-click it → Get Info, and drag src-tauri/icons/icon.png onto the icon to give it the game icon.');
} else {
  const file = join(desktop, 'strike-wing.desktop');
  writeFileSync(
    file,
    `[Desktop Entry]\nType=Application\nName=Strike Wing\nComment=Offline fighter-jet combat\nExec="${NODE}" "${SERVE}"\nPath=${ROOT}\nIcon=${join(ROOT, 'src-tauri', 'icons', 'icon.png')}\nTerminal=false\nCategories=Game;\n`,
  );
  chmodSync(file, 0o755);
  try {
    execSync(`gio set "${file}" metadata::trusted true`, { stdio: 'ignore' });
  } catch {
    /* not GNOME */
  }
  console.log(`Shortcut created: ${file}`);
}

// Build once now so the first click starts instantly.
if (!existsSync(join(ROOT, 'dist', 'index.html'))) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
