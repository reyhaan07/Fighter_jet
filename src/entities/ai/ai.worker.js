import { think } from './brain.js';

// AI worker: receives transferred snapshot buffers, runs the same brain as
// the main thread and transfers the buffers straight back (zero copy).
self.onmessage = (e) => {
  const m = e.data;
  think(m.air, m.nAir, m.mis, m.nMis, m.out, m.misOut, m.time, m.dt, m.mapHalf);
  self.postMessage(m, [m.air.buffer, m.mis.buffer, m.out.buffer, m.misOut.buffer]);
};
