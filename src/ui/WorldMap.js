import { fbm2, rng, smoothstep } from '../core/math.js';
import { LEVELS, CHAPTERS } from '../config/campaign.js';

// Old-parchment campaign map. The artwork (relief, coastlines, mountains,
// forests, roads, chapter names, compass) is generated once from noise into an
// offscreen canvas; markers for the 100 levels are drawn on top every frame
// with a glowing, arrow-framed selection. Drag to pan, wheel to zoom, click a
// marker to select, arrow keys step through levels.

const W = 3600;
const H = 2400;
const INK = 'rgba(70, 48, 26, ';

// Chapter regions laid out as a serpentine journey across the map.
const CENTERS = [
  [0.12, 0.2], [0.34, 0.16], [0.57, 0.22], [0.84, 0.18], [0.86, 0.5],
  [0.62, 0.53], [0.37, 0.47], [0.12, 0.56], [0.3, 0.82], [0.72, 0.82],
];
const BIAS = { islands: -0.12, coast: -0.02, desert: 0.06, arctic: 0.04, ocean: -0.3, mountains: 0.22 };

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

/** 100 node positions along a spline through the chapter centres. */
function layoutNodes() {
  const pts = CENTERS.map(([x, y]) => [x * W, y * H]);
  const ctrl = [pts[0], ...pts, pts[pts.length - 1]];
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < 40; k++) dense.push(catmull(ctrl[i], ctrl[i + 1], ctrl[i + 2], ctrl[i + 3], k / 40));
  }
  dense.push(pts[pts.length - 1]);
  const len = [0];
  for (let i = 1; i < dense.length; i++) len.push(len[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = len[len.length - 1];
  const r = rng(77);
  const nodes = [];
  let j = 0;
  for (let n = 0; n < 100; n++) {
    const target = (total * (n + 0.5)) / 100;
    while (j < len.length - 2 && len[j + 1] < target) j++;
    const t = (target - len[j]) / (len[j + 1] - len[j] || 1);
    const x = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
    const y = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t;
    const nx = -(dense[j + 1][1] - dense[j][1]);
    const ny = dense[j + 1][0] - dense[j][0];
    const nl = Math.hypot(nx, ny) || 1;
    const off = (r() - 0.5) * 150;
    nodes.push([x + (nx / nl) * off, y + (ny / nl) * off]);
  }
  return nodes;
}

export class WorldMap {
  constructor({ onSelect, onLaunch }) {
    this.onSelect = onSelect;
    this.onLaunch = onLaunch;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'worldmap';
    this.g = this.canvas.getContext('2d');
    this.nodes = layoutNodes();
    this.art = null;
    this.view = { x: 0, y: 0, z: 0.5 };
    this.state = { unlocked: 1, completed: {}, selected: 'm1' };
    this.hover = -1;
    this.time = 0;
    this.drag = null;
    this._bind();
  }

  /** Builds the parchment artwork (once, lazily). */
  ensureArt() {
    if (this.art) return;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    this._paintTerrain(g);
    this._paintGlyphs(g);
    this._paintRoads(g);
    this._paintLabels(g);
    this._paintFrame(g);
    this.art = c;
  }

  _elev(x, y) {
    // Base relief + bias towards each chapter's theme near its centre.
    let e = fbm2(x / 520, y / 520, 5, 4242) * 1.15 - 0.08;
    for (let i = 0; i < CENTERS.length; i++) {
      const dx = x / W - CENTERS[i][0];
      const dy = y / H - CENTERS[i][1];
      const w = Math.exp(-(dx * dx + dy * dy) / 0.012);
      e += (BIAS[CHAPTERS[i].terrain[0]] ?? 0) * w;
    }
    // Margins fade into sea.
    const m = Math.min(x / W, 1 - x / W, y / H, 1 - y / H);
    e -= smoothstep(0.08, 0, m) * 0.35;
    return e;
  }

  _paintTerrain(g) {
    const S = 4; // compute at quarter resolution, scale up smoothly
    const w = W / S;
    const h = H / S;
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sg = small.getContext('2d');
    const img = sg.createImageData(w, h);
    const sea = 0.42;
    const E = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) E[y * w + x] = this._elev(x * S, y * S);
    this.E = E;
    this.Ew = w;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = E[y * w + x];
        const ex = E[y * w + Math.min(w - 1, x + 1)] - E[y * w + Math.max(0, x - 1)];
        const ey = E[Math.min(h - 1, y + 1) * w + x] - E[Math.max(0, y - 1) * w + x];
        const stain = fbm2(x / 30, y / 30, 3, 99) - 0.5;
        let r = 226;
        let gg = 206;
        let b = 160;
        if (e < sea) {
          // Water: darker tan with depth, light band near the shore.
          const depth = smoothstep(sea, sea - 0.25, e);
          r -= 28 + depth * 26;
          gg -= 30 + depth * 26;
          b -= 26 + depth * 18;
          const shore = smoothstep(sea - 0.035, sea, e);
          r += shore * 30;
          gg += shore * 28;
          b += shore * 22;
        } else {
          // Hill-shaded relief lit from the north-west.
          const shade = (-ex - ey) * 260;
          const hi = smoothstep(sea + 0.15, 0.85, e);
          r += shade - hi * 40;
          gg += shade - hi * 44;
          b += shade - hi * 40;
          // Coastline ink.
          const coast = 1 - smoothstep(0, 0.012, e - sea);
          r -= coast * 110;
          gg -= coast * 105;
          b -= coast * 90;
        }
        r += stain * 26;
        gg += stain * 24;
        b += stain * 20;
        const o = (y * w + x) * 4;
        img.data[o] = r;
        img.data[o + 1] = gg;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(small, 0, 0, W, H);
    // Age the paper: dark burnt edges and blotches.
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(90,60,25,0)');
    vg.addColorStop(1, 'rgba(90,60,25,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    const r = rng(5);
    for (let i = 0; i < 70; i++) {
      const x = r() * W;
      const y = r() * H;
      const rad = 40 + r() * 220;
      const bg = g.createRadialGradient(x, y, 0, x, y, rad);
      bg.addColorStop(0, `rgba(110,80,40,${0.04 + r() * 0.06})`);
      bg.addColorStop(1, 'rgba(110,80,40,0)');
      g.fillStyle = bg;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Sea hatching.
    g.strokeStyle = INK + '0.18)';
    g.lineWidth = 2;
    for (let i = 0; i < 2600; i++) {
      const x = r() * W;
      const y = r() * H;
      if (this.elevAt(x, y) > sea - 0.04) continue;
      g.beginPath();
      g.moveTo(x - 12, y);
      g.quadraticCurveTo(x - 6, y - 5, x, y);
      g.quadraticCurveTo(x + 6, y + 5, x + 12, y);
      g.stroke();
    }
  }

  elevAt(x, y) {
    const w = this.Ew;
    const i = Math.max(0, Math.min(w - 1, Math.floor(x / 4)));
    const j = Math.max(0, Math.min(H / 4 - 1, Math.floor(y / 4)));
    return this.E[j * w + i];
  }

  _paintGlyphs(g) {
    const r = rng(31);
    const sea = 0.42;
    // Mountains: little peaks with shaded flanks, back to front.
    const peaks = [];
    for (let i = 0; i < 9000; i++) {
      const x = r() * W;
      const y = r() * H;
      const e = this.elevAt(x, y);
      if (e > 0.6 && r() < (e - 0.55) * 2.2) peaks.push([x, y, 18 + (e - 0.6) * 160 + r() * 14]);
    }
    peaks.sort((a, b) => a[1] - b[1]);
    for (const [x, y, s] of peaks) {
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x - s * 0.1, y - s * 1.15);
      g.lineTo(x + s, y);
      g.closePath();
      g.fillStyle = 'rgba(222,200,152,0.95)';
      g.fill();
      g.beginPath();
      g.moveTo(x - s * 0.1, y - s * 1.15);
      g.lineTo(x + s, y);
      g.lineTo(x + s * 0.15, y);
      g.closePath();
      g.fillStyle = INK + '0.28)';
      g.fill();
      g.strokeStyle = INK + '0.75)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x - s * 0.1, y - s * 1.15);
      g.lineTo(x + s, y);
      g.stroke();
      g.lineWidth = 1;
      g.strokeStyle = INK + '0.4)';
      for (let k = 1; k < 4; k++) {
        g.beginPath();
        g.moveTo(x - s * 0.1 + k * s * 0.18, y - s * 1.15 + k * s * 0.22);
        g.lineTo(x + k * s * 0.12, y);
        g.stroke();
      }
    }
    // Forests: clusters of small tree glyphs.
    for (let i = 0; i < 26000; i++) {
      const x = r() * W;
      const y = r() * H;
      const e = this.elevAt(x, y);
      if (e < sea + 0.03 || e > 0.6) continue;
      const f = fbm2(x / 260, y / 260, 3, 777);
      if (f < 0.56) continue;
      const s = 4 + r() * 3;
      g.strokeStyle = INK + '0.55)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - s);
      g.stroke();
      g.beginPath();
      g.arc(x, y - s - 3, 3.6, 0, Math.PI * 2);
      g.fillStyle = INK + '0.35)';
      g.fill();
      g.stroke();
    }
    // Rivers from highlands to the sea.
    g.strokeStyle = INK + '0.5)';
    g.lineWidth = 2.2;
    for (let k = 0; k < 14; k++) {
      let x = r() * W;
      let y = r() * H;
      if (this.elevAt(x, y) < 0.6) continue;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 220; s++) {
        let bx = 0;
        let by = 0;
        let best = this.elevAt(x, y);
        for (let a = 0; a < 8; a++) {
          const dx = Math.cos((a / 8) * Math.PI * 2 + s * 0.3) * 14;
          const dy = Math.sin((a / 8) * Math.PI * 2 + s * 0.3) * 14;
          const e = this.elevAt(x + dx, y + dy);
          if (e < best) {
            best = e;
            bx = dx;
            by = dy;
          }
        }
        if (!bx && !by) break;
        x += bx + (r() - 0.5) * 6;
        y += by + (r() - 0.5) * 6;
        g.lineTo(x, y);
        if (best < sea) break;
      }
      g.stroke();
    }
    // Towns near some level sites.
    for (let n = 0; n < 100; n += 3) {
      const [nx, ny] = this.nodes[n];
      if (this.elevAt(nx, ny) < 0.44) continue;
      for (let k = 0; k < 6; k++) {
        const x = nx + (r() - 0.5) * 90 + 40;
        const y = ny + (r() - 0.5) * 60 + 30;
        g.fillStyle = INK + '0.55)';
        g.fillRect(x, y, 7, 6);
        g.beginPath();
        g.moveTo(x - 1, y);
        g.lineTo(x + 3.5, y - 4);
        g.lineTo(x + 8, y);
        g.fill();
      }
    }
  }

  _paintRoads(g) {
    // Pale roads linking every level, like trails on an old campaign map.
    const path = () => {
      g.beginPath();
      const p = this.nodes;
      g.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) {
        const mx = (p[i - 1][0] + p[i][0]) / 2;
        const my = (p[i - 1][1] + p[i][1]) / 2;
        g.quadraticCurveTo(p[i - 1][0], p[i - 1][1], mx, my);
      }
      g.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    path();
    g.strokeStyle = INK + '0.45)';
    g.lineWidth = 30;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(246,234,204,0.95)';
    g.lineWidth = 22;
    g.stroke();
    path();
    g.strokeStyle = INK + '0.25)';
    g.lineWidth = 2;
    g.setLineDash([14, 12]);
    g.stroke();
    g.setLineDash([]);
  }

  _paintLabels(g) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    CHAPTERS.forEach((ch, i) => {
      const [cx, cy] = CENTERS[i];
      g.save();
      g.translate(cx * W, cy * H - 150);
      g.rotate((i % 2 ? 1 : -1) * 0.04);
      g.font = '600 46px "Cinzel", serif';
      g.fillStyle = INK + '0.62)';
      g.fillText(ch.name.toUpperCase().split('').join(String.fromCharCode(8202)), 0, 0);
      g.font = '400 24px "Cinzel", serif';
      g.fillStyle = INK + '0.5)';
      g.fillText(`Chapter ${i + 1}`, 0, 40);
      g.restore();
    });
    // Compass rose.
    const cx = W - 260;
    const cy = H - 280;
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = INK + '0.7)';
    g.fillStyle = INK + '0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 110, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 96, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const len = k % 2 ? 70 : 150;
      g.beginPath();
      g.moveTo(Math.cos(a) * len, Math.sin(a) * len);
      g.lineTo(Math.cos(a + 0.18) * 18, Math.sin(a + 0.18) * 18);
      g.lineTo(Math.cos(a - 0.18) * 18, Math.sin(a - 0.18) * 18);
      g.closePath();
      if (k % 2 === 0) g.fill();
      g.stroke();
    }
    g.font = '700 40px "Cinzel", serif';
    g.fillText('N', 0, -180);
    g.restore();
    // Title cartouche.
    g.save();
    g.translate(W / 2, H - 110);
    g.font = '700 58px "Cinzel", serif';
    g.fillStyle = INK + '0.7)';
    g.fillText('THEATRE OF OPERATIONS', 0, 0);
    g.restore();
  }

  _paintFrame(g) {
    g.strokeStyle = INK + '0.8)';
    g.lineWidth = 10;
    g.strokeRect(30, 30, W - 60, H - 60);
    g.lineWidth = 3;
    g.strokeRect(54, 54, W - 108, H - 108);
  }

  // ── State + view ─────────────────────────────────────────────────────
  setState(state) {
    this.state = state;
  }

  mount(el) {
    this.ensureArt();
    el.appendChild(this.canvas);
    this.el = el;
    this._resize();
    if (!this._fitted) {
      this._fitted = true;
      this.focus(this.state.selected, true);
    }
    this._loop();
  }

  unmount() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.vw = r.width;
    this.vh = r.height;
    this.minZoom = Math.max(this.vw / W, this.vh / H);
    this.view.z = Math.max(this.view.z, this.minZoom);
  }

  focus(id, instant = false) {
    const i = LEVELS.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [x, y] = this.nodes[i];
    if (instant) this.view.z = Math.max(this.minZoom, 0.55);
    this.target = { x: x - this.vw / 2 / this.view.z, y: y - this.vh / 2 / this.view.z };
    if (instant) {
      this.view.x = this.target.x;
      this.view.y = this.target.y;
    }
    this._clamp();
  }

  _clamp() {
    const z = this.view.z;
    const maxX = W - this.vw / z;
    const maxY = H - this.vh / z;
    for (const v of [this.view, this.target].filter(Boolean)) {
      v.x = Math.max(0, Math.min(maxX, v.x));
      v.y = Math.max(0, Math.min(maxY, v.y));
    }
  }

  _toWorld(sx, sy) {
    return [this.view.x + sx / this.view.z, this.view.y + sy / this.view.z];
  }

  _pick(sx, sy) {
    const [wx, wy] = this._toWorld(sx, sy);
    let best = -1;
    let bestD = 34 / this.view.z;
    for (let i = 0; i < 100; i++) {
      const d = Math.hypot(this.nodes[i][0] - wx, this.nodes[i][1] - 16 - wy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  _bind() {
    const c = this.canvas;
    // Two fingers pinch-zoom around their midpoint (phones and tablets).
    const pts = new Map();
    const pinchState = () => {
      const [a, b] = [...pts.values()];
      const r = c.getBoundingClientRect();
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      if (pts.size === 2) {
        const p = pinchState();
        const [wx, wy] = this._toWorld(p.mx, p.my);
        this.pinch = { d: p.d, z: this.view.z, wx, wy };
        this.drag = null;
        return;
      }
      if (pts.size > 2) return;
      this.drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
    });
    const lift = (e) => {
      pts.delete(e.pointerId);
      if (this.pinch && pts.size < 2) {
        this.pinch = null;
        this.drag = null;
        this._afterPinch = true; // the finger left behind must not count as a tap
      }
    };
    c.addEventListener('pointercancel', (e) => {
      lift(e);
      this.drag = null;
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && pts.size >= 2) {
        const p = pinchState();
        this.view.z = Math.max(this.minZoom, Math.min(1.6, (this.pinch.z * p.d) / this.pinch.d));
        this.view.x = this.pinch.wx - p.mx / this.view.z;
        this.view.y = this.pinch.wy - p.my / this.view.z;
        this.target = null;
        this._clamp();
        return;
      }
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        this.view.x = this.drag.vx - dx / this.view.z;
        this.view.y = this.drag.vy - dy / this.view.z;
        this.target = null;
        this._clamp();
      }
      this.hover = this._pick(e.clientX - r.left, e.clientY - r.top);
      c.style.cursor = this.hover >= 0 ? 'pointer' : this.drag ? 'grabbing' : 'grab';
    });
    c.addEventListener('pointerup', (e) => {
      const r = c.getBoundingClientRect();
      const wasPinch = !!this.pinch || this._afterPinch;
      lift(e);
      if (!pts.size) this._afterPinch = false;
      if (wasPinch) return;
      if (this.drag && !this.drag.moved) {
        const i = this._pick(e.clientX - r.left, e.clientY - r.top);
        if (i >= 0) this.onSelect(LEVELS[i].id, i + 1 <= this.state.unlocked);
      }
      this.drag = null;
    });
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      const i = this._pick(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0 && i + 1 <= this.state.unlocked) this.onLaunch(LEVELS[i].id);
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const [wx, wy] = this._toWorld(sx, sy);
        this.view.z = Math.max(this.minZoom, Math.min(1.6, this.view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        this.view.x = wx - sx / this.view.z;
        this.view.y = wy - sy / this.view.z;
        this.target = null;
        this._clamp();
      },
      { passive: false },
    );
    window.addEventListener('resize', () => this.el && this.canvas.isConnected && this._resize());
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    let last = performance.now();
    const frame = (now) => {
      if (!this.canvas.isConnected) return;
      this.time += (now - last) / 1000;
      last = now;
      if (this.target) {
        this.view.x += (this.target.x - this.view.x) * 0.15;
        this.view.y += (this.target.y - this.view.y) * 0.15;
        if (Math.abs(this.target.x - this.view.x) + Math.abs(this.target.y - this.view.y) < 0.5) this.target = null;
      }
      this.draw();
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  // ── Drawing ──────────────────────────────────────────────────────────
  draw() {
    const g = this.g;
    const { x, y, z } = this.view;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#2a2015';
    g.fillRect(0, 0, this.vw, this.vh);
    g.save();
    g.scale(z, z);
    g.translate(-x, -y);
    g.drawImage(this.art, 0, 0);
    const st = this.state;
    // Progress: the travelled part of the road in red ink.
    const done = Math.min(99, st.unlocked - 1);
    if (done > 0) {
      g.beginPath();
      g.moveTo(this.nodes[0][0], this.nodes[0][1]);
      for (let i = 1; i <= done; i++) {
        const p = this.nodes;
        g.quadraticCurveTo(p[i - 1][0], p[i - 1][1], (p[i - 1][0] + p[i][0]) / 2, (p[i - 1][1] + p[i][1]) / 2);
      }
      g.lineTo(this.nodes[done][0], this.nodes[done][1]);
      g.strokeStyle = 'rgba(150,40,25,0.55)';
      g.lineWidth = 5;
      g.setLineDash([16, 10]);
      g.stroke();
      g.setLineDash([]);
    }
    const selIdx = LEVELS.findIndex((l) => l.id === st.selected);
    for (let i = 0; i < 100; i++) if (i !== selIdx) this._marker(g, i, false);
    if (selIdx >= 0) this._marker(g, selIdx, true);
    if (this.hover >= 0 && this.hover !== selIdx) this._label(g, this.hover, false);
    g.restore();
  }

  _marker(g, i, selected) {
    const L = LEVELS[i];
    const [x, y] = this.nodes[i];
    const st = this.state;
    const unlocked = i + 1 <= st.unlocked;
    const done = !!st.completed[L.id];
    const s = (L.boss ? 1.35 : 1) * (selected ? 1.25 : 1);
    const t = this.time;
    if (selected) {
      // Warm glow and four arrows converging on the marker.
      const glow = g.createRadialGradient(x, y - 16, 0, x, y - 16, 90);
      glow.addColorStop(0, 'rgba(255,190,110,0.75)');
      glow.addColorStop(1, 'rgba(255,150,60,0)');
      g.fillStyle = glow;
      g.fillRect(x - 90, y - 106, 180, 180);
      const pulse = 58 + Math.sin(t * 4) * 9;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.save();
        g.translate(x + Math.cos(a) * pulse, y - 16 + Math.sin(a) * pulse);
        g.rotate(a + Math.PI);
        const grad = g.createLinearGradient(-26, 0, 6, 0);
        grad.addColorStop(0, 'rgba(255,140,50,0)');
        grad.addColorStop(1, 'rgba(255,170,90,1)');
        g.fillStyle = grad;
        g.shadowColor = 'rgba(255,120,40,0.9)';
        g.shadowBlur = 12;
        g.beginPath();
        g.moveTo(14, 0);
        g.lineTo(-12, -17);
        g.lineTo(-4, 0);
        g.lineTo(-12, 17);
        g.closePath();
        g.fill();
        g.fillRect(-40, -3.5, 34, 7);
        g.shadowColor = 'transparent';
        g.restore();
      }
    }
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.globalAlpha = unlocked ? 1 : 0.5;
    // Pin.
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-6, -8, -14, -12, -14, -21);
    g.arc(0, -21, 14, Math.PI, 0);
    g.bezierCurveTo(14, -12, 6, -8, 0, 0);
    g.closePath();
    g.fillStyle = unlocked ? (L.boss ? '#fff1dc' : '#fbf6ec') : '#c9bba0';
    g.shadowColor = 'rgba(40,25,10,0.5)';
    g.shadowBlur = 6;
    g.shadowOffsetY = 2;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = L.boss ? 2.5 : 1.5;
    g.strokeStyle = L.boss ? 'rgba(150,40,25,0.9)' : INK + '0.7)';
    g.stroke();
    this._glyph(g, L.icon, unlocked);
    if (done) {
      g.beginPath();
      g.arc(10, -32, 6.5, 0, Math.PI * 2);
      g.fillStyle = '#b8862b';
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(7, -32);
      g.lineTo(9.5, -29.5);
      g.lineTo(13.5, -34.5);
      g.stroke();
    }
    g.restore();
    if (selected) this._label(g, i, true);
  }

  _glyph(g, icon, unlocked) {
    g.save();
    g.translate(0, -21);
    g.fillStyle = unlocked ? 'rgba(60,40,20,0.9)' : 'rgba(60,40,20,0.5)';
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 1.8;
    g.beginPath();
    if (icon === 'air') {
      g.moveTo(0, -9);
      g.lineTo(2, -2);
      g.lineTo(9, 2);
      g.lineTo(9, 4);
      g.lineTo(2, 2.5);
      g.lineTo(1.5, 6);
      g.lineTo(4, 8);
      g.lineTo(-4, 8);
      g.lineTo(-1.5, 6);
      g.lineTo(-2, 2.5);
      g.lineTo(-9, 4);
      g.lineTo(-9, 2);
      g.lineTo(-2, -2);
      g.closePath();
      g.fill();
    } else if (icon === 'strike') {
      g.arc(0, 0, 7, 0, Math.PI * 2);
      g.moveTo(-10, 0);
      g.lineTo(10, 0);
      g.moveTo(0, -10);
      g.lineTo(0, 10);
      g.stroke();
    } else if (icon === 'naval') {
      g.moveTo(-9, 1);
      g.lineTo(9, 1);
      g.lineTo(6, 6);
      g.lineTo(-6, 6);
      g.closePath();
      g.fill();
      g.fillRect(-2, -6, 5, 7);
      g.beginPath();
      g.moveTo(-10, 9);
      g.quadraticCurveTo(-5, 6.5, 0, 9);
      g.quadraticCurveTo(5, 11.5, 10, 9);
      g.stroke();
    } else if (icon === 'escort') {
      g.moveTo(0, -9);
      g.lineTo(8, -5);
      g.lineTo(7, 3);
      g.quadraticCurveTo(4, 8, 0, 10);
      g.quadraticCurveTo(-4, 8, -7, 3);
      g.lineTo(-8, -5);
      g.closePath();
      g.fill();
    } else if (icon === 'aces') {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const r = k % 2 ? 4 : 9;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    } else if (icon === 'boss') {
      g.fillStyle = unlocked ? 'rgba(150,40,25,0.95)' : 'rgba(150,40,25,0.5)';
      g.arc(0, -1, 8, Math.PI, 0);
      g.lineTo(6, 5);
      g.lineTo(-6, 5);
      g.closePath();
      g.fill();
      g.fillStyle = '#fbf6ec';
      g.fillRect(-4.5, -2, 3, 3);
      g.fillRect(1.5, -2, 3, 3);
      g.fillStyle = unlocked ? 'rgba(150,40,25,0.95)' : 'rgba(150,40,25,0.5)';
      g.fillRect(-5, 6, 10, 3);
    }
    g.restore();
  }

  _label(g, i, selected) {
    const L = LEVELS[i];
    const [x, y] = this.nodes[i];
    const z = this.view.z;
    g.save();
    g.translate(x + (selected ? 34 : 24), y - 18);
    g.scale(1 / Math.max(0.6, z), 1 / Math.max(0.6, z));
    g.font = `${selected ? 700 : 600} ${selected ? 28 : 20}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(40,25,10,0.75)';
    const txt = `${L.level}. ${L.name}`;
    g.strokeText(txt, 0, 0);
    g.fillStyle = selected ? '#ffffff' : '#fff6e6';
    g.fillText(txt, 0, 0);
    g.restore();
  }
}
