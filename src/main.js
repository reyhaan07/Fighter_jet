import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';
import './styles.css';
import { Game } from './game/Game.js';
import { installAtmosphere } from './world/Atmosphere.js';

installAtmosphere();

// Entry point. Everything (code, fonts, sounds) is bundled locally: the game
// never touches the network.

async function boot() {
  const boot = document.getElementById('boot');
  try {
    await Promise.all([
      document.fonts.load('600 20px "Barlow Condensed"'),
      document.fonts.load('400 14px "JetBrains Mono"'),
      document.fonts.load('700 40px "Cinzel"'),
      document.fonts.load('400 24px "Cinzel"'),
    ]);
  } catch {
    /* fonts are optional */
  }
  const game = new Game({
    canvas: document.getElementById('game'),
    hudCanvas: document.getElementById('hud'),
    ui: document.getElementById('ui'),
  });
  window.__game = game; // handy for debugging and the stress script
  await game.boot();
  // Android app: hardware back button.
  window.Capacitor?.Plugins?.App?.addListener?.('backButton', () => game.handleBack());
  // Tell the one-click launcher (scripts/serve.mjs) the game window is still open.
  if (location.port === '4173') {
    const ping = () => fetch('./__alive', { cache: 'no-store' }).catch(() => {});
    ping();
    setInterval(ping, 15000);
  }
  boot.remove();
}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Failed to start: ' + e.message;
});
