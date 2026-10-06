import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import { Game } from './game/Game.js';

// Entry point. Everything (code, fonts, sounds) is bundled locally: the game
// never touches the network.

async function boot() {
  const boot = document.getElementById('boot');
  try {
    await Promise.all([
      document.fonts.load('600 20px "Barlow Condensed"'),
      document.fonts.load('400 14px "JetBrains Mono"'),
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
  await game.boot?.();
  if (!game.boot) {
    const { FreeFlight } = await import('./game/modes/FreeFlight.js');
    const qs = new URLSearchParams(location.search);
    await game.startSession({ id: 'free', mode: FreeFlight, duel: qs.has('duel'), stress: qs.has('stress'), env: { time: 'day', terrain: 'islands', seed: 7 } });
  }
  boot.remove();
}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Failed to start: ' + e.message;
});
