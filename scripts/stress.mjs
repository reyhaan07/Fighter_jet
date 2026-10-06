// Performance check: builds the game, runs the stress scenario (60+ AI
// aircraft, ~1800 rounds in flight) headless and prints simulation/render cost.
// GPU numbers from a headless software renderer are meaningless; use the
// in-game F3 overlay with `?stress` on real hardware for frame rates.
import { execSync } from 'node:child_process';
execSync('npx vite build', { stdio: 'inherit' });
process.env.QS = '?stress';
process.argv[2] = 'stress-shots';
process.argv[3] = 'scripts/stress-scenario.mjs';
await import('./shoot.mjs');
