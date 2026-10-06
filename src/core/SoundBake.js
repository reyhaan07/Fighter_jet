// Offline sound design: renders realistic sound effects into AudioBuffers
// once at startup (plain JS DSP, ~0.2 s). Layered transients, filtered noise,
// sub-bass sweeps, debris crackle, Doppler fly-bys and seamless loops, far
// closer to recordings than live oscillators. Real recordings dropped into
// src/assets/sounds/ replace any of these (see Audio.loadRecordings).

const TAU = Math.PI * 2;

function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
}

/** One-pole low-pass coefficient for a cutoff in Hz. */
const lpk = (fc, sr) => 1 - Math.exp((-TAU * fc) / sr);

function toBuffer(ctx, channels) {
  const buf = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((d, i) => buf.copyToChannel(d, i));
  return buf;
}

function normalize(chs, peak = 0.9) {
  let m = 1e-6;
  for (const c of chs) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  const k = peak / m;
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
  return chs;
}

/** Stereo decorrelation: right channel slightly delayed and filtered. */
function stereoize(mono, sr, delayMs = 7) {
  const r = new Float32Array(mono.length);
  const d = Math.round((delayMs / 1000) * sr);
  let y = 0;
  const k = lpk(6000, sr);
  for (let i = 0; i < mono.length; i++) {
    y += k * ((i >= d ? mono[i - d] : 0) - y);
    r[i] = y;
  }
  return [mono, r];
}

// ── Guns ────────────────────────────────────────────────────────────────
/** Rotary cannon: a seamless loop of individual rounds ("brrrt"). */
function rotaryLoop(ctx, rps = 60) {
  const sr = ctx.sampleRate;
  const rounds = 30;
  const len = Math.round((rounds / rps) * sr);
  const out = new Float32Array(len);
  const rnd = makeRand(20);
  const period = len / rounds;
  for (let r = 0; r < rounds; r++) {
    const start = Math.round(r * period + rnd() * period * 0.05);
    const amp = 0.85 + rnd() * 0.15;
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < period * 2.2; i++) {
      const t = i / sr;
      const idx = (start + i) % len;
      const n = rnd();
      lp += lpk(3500, sr) * (n - lp);
      lp2 += lpk(700, sr) * (n - lp2);
      const crack = lp * Math.exp(-t / 0.0016) * 1.2;
      const body = lp2 * Math.exp(-t / 0.009) * 1.6;
      const thump = Math.sin(TAU * 95 * t) * Math.exp(-t / 0.011) * 0.9;
      out[idx] += (crack + body + thump) * amp;
    }
  }
  // Mechanical buzz of the spinning barrels.
  for (let i = 0; i < len; i++) out[i] += Math.sin((TAU * rps * 2 * i) / sr) * 0.05;
  return toBuffer(ctx, stereoize(normalize([out])[0], sr, 4));
}

function cannonShot(ctx, { thumpHz = 70, len = 0.5, crackMs = 2.5, bodyHz = 900, seed = 3 } = {}) {
  const sr = ctx.sampleRate;
  const n = Math.round(len * sr);
  const out = new Float32Array(n);
  const rnd = makeRand(seed);
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = rnd();
    a += lpk(5000, sr) * (x - a);
    b += lpk(bodyHz, sr) * (x - b);
    const f = thumpHz * (1 + 1.5 * Math.exp(-t / 0.02));
    out[i] = a * Math.exp(-t / (crackMs / 1000)) * 1.4 + b * Math.exp(-t / 0.06) * 2.2 + Math.sin(TAU * f * t) * Math.exp(-t / 0.05) * 1.1;
  }
  return toBuffer(ctx, stereoize(normalize([out])[0], sr));
}

// ── Explosions ──────────────────────────────────────────────────────────
function explosion(ctx, size, seed) {
  const sr = ctx.sampleRate;
  const len = 1.6 + size * 2.6;
  const n = Math.round(len * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rnd = makeRand(seed);
  let c = 0;
  let bL = 0;
  let bR = 0;
  let b2L = 0;
  let b2R = 0;
  const bodyT = 0.25 + size * 0.9;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const xl = rnd();
    const xr = rnd();
    // Initial supersonic crack.
    c += lpk(9000, sr) * (xl - c);
    const crack = c * Math.exp(-t / (0.006 + size * 0.008)) * 1.6;
    // Rolling body: low-passed noise whose cutoff falls over time.
    const fc = 300 + 2500 * Math.exp(-t / (0.12 + size * 0.2));
    bL += lpk(fc, sr) * (xl - bL);
    bR += lpk(fc, sr) * (xr - bR);
    b2L += lpk(fc * 0.5, sr) * (bL - b2L);
    b2R += lpk(fc * 0.5, sr) * (bR - b2R);
    const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / bodyT);
    // Sub boom sweeping down.
    const sub = Math.sin(TAU * (25 + 45 * Math.exp(-t / 0.15)) * t) * Math.exp(-t / (0.3 + size * 0.6)) * (1.2 + size);
    L[i] = crack + b2L * env * 4.5 + sub;
    R[i] = crack * 0.9 + b2R * env * 4.5 + sub;
  }
  // Debris and secondary crackle.
  const pops = Math.round(20 + size * 90);
  for (let p = 0; p < pops; p++) {
    const at = Math.round((0.05 + Math.pow(Math.random(), 1.7) * (len * 0.75)) * sr);
    const amp = (0.08 + Math.random() * 0.25) * Math.exp(-at / sr / (len * 0.5));
    const ch = Math.random() < 0.5 ? L : R;
    let y = 0;
    for (let i = 0; i < 0.012 * sr && at + i < n; i++) {
      y += 0.5 * (rnd() - y);
      ch[at + i] += y * amp * Math.exp(-i / (0.002 * sr));
    }
  }
  return toBuffer(ctx, normalize([L, R], 0.95));
}

// ── Missiles / rockets ──────────────────────────────────────────────────
function rocketLaunch(ctx, len = 2.2, seed = 9, big = false) {
  const sr = ctx.sampleRate;
  const n = Math.round(len * sr);
  const out = new Float32Array(n);
  const rnd = makeRand(seed);
  let a = 0;
  let b = 0;
  let flutter = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = rnd();
    a += lpk(big ? 900 : 1500, sr) * (x - a);
    b += lpk(4500, sr) * (x - b);
    if (i % 512 === 0) flutter = 0.7 + Math.random() * 0.6;
    const ignite = b * Math.exp(-t / 0.015) * 2;
    const roar = a * flutter * Math.min(1, t / 0.04) * Math.exp(-t / (len * 0.45)) * 3;
    const hiss = b * 0.25 * Math.min(1, t / 0.08) * Math.exp(-t / (len * 0.35));
    out[i] = ignite + roar + hiss;
  }
  return toBuffer(ctx, stereoize(normalize([out])[0], sr, 9));
}

// ── Aircraft ────────────────────────────────────────────────────────────
/** Seamless turbine engine loop: rumble, roar and whining harmonics. */
function engineLoop(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.round(2 * sr);
  const out = new Float32Array(len);
  const rnd = makeRand(77);
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const x = rnd();
    a += lpk(140, sr) * (x - a);
    b += lpk(700, sr) * (x - b);
    c += lpk(2600, sr) * (x - c);
    // Harmonics at exact multiples of 1/2 Hz so the loop is seamless.
    const f = 600;
    const whine = Math.sin(TAU * f * t + Math.sin(TAU * 3 * t) * 0.6) * 0.05 + Math.sin(TAU * f * 2 * t) * 0.025 + Math.sin(TAU * 1450 * t) * 0.012;
    out[i] = a * 4 + b * 1.6 + c * 0.35 + whine;
  }
  // Crossfade the tail into the head for a click-free loop.
  const xf = Math.round(0.1 * sr);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    out[i] = out[i] * k + out[len - xf + i] * (1 - k);
  }
  const trimmed = out.subarray(0, len - xf);
  return toBuffer(ctx, stereoize(normalize([Float32Array.from(trimmed)])[0], sr, 11));
}

/** A jet roaring past: bell-shaped level, Doppler pitch drop. */
function flyby(ctx) {
  const sr = ctx.sampleRate;
  const len = 3;
  const n = Math.round(len * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rnd = makeRand(55);
  let a = 0;
  let b = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = (t - 1.2) / 0.45;
    const env = Math.exp(-u * u) + 0.25 * Math.exp(-Math.max(0, t - 1.2) / 0.8) * (t > 1.2 ? 1 : 0);
    const dop = t < 1.2 ? 1.25 : 0.8 + 0.45 * Math.exp(-(t - 1.2) / 0.15);
    const x = rnd();
    a += lpk(400 + 2200 * Math.exp(-u * u), sr) * (x - a);
    b += lpk(150, sr) * (x - b);
    phase += (TAU * 780 * dop) / sr;
    const tone = Math.sin(phase) * 0.06 * Math.exp(-u * u);
    const pan = Math.max(-1, Math.min(1, u * 0.8));
    const s = (a * 2.4 + b * 3 + tone) * env;
    L[i] = s * (1 - pan) * 0.7;
    R[i] = s * (1 + pan) * 0.7;
  }
  return toBuffer(ctx, normalize([L, R], 0.9));
}

/** Outdoor impulse response for the reverb send (long, darkening tail). */
function outdoorIR(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.round(2.8 * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rl = makeRand(101);
  const rr = makeRand(202);
  let yl = 0;
  let yr = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = lpk(5000 * Math.exp(-t / 0.6) + 300, sr);
    yl += k * (rl() - yl);
    yr += k * (rr() - yr);
    const env = Math.exp(-t / 0.7) * (t < 0.03 ? t / 0.03 : 1);
    L[i] = yl * env;
    R[i] = yr * env;
  }
  return toBuffer(ctx, normalize([L, R], 0.5));
}

/** Renders the whole bank. */
export function bakeSounds(ctx) {
  return {
    gun20: rotaryLoop(ctx, 60),
    gun30: cannonShot(ctx, { thumpHz: 60, len: 0.6, crackMs: 3, bodyHz: 700, seed: 4 }),
    gunEnemy: cannonShot(ctx, { thumpHz: 120, len: 0.25, crackMs: 1.5, bodyHz: 1600, seed: 5 }),
    aa: cannonShot(ctx, { thumpHz: 80, len: 0.45, crackMs: 2, bodyHz: 1000, seed: 6 }),
    explosionSmall: explosion(ctx, 0.15, 11),
    explosionMedium: explosion(ctx, 0.45, 12),
    explosionLarge: explosion(ctx, 1, 13),
    missile: rocketLaunch(ctx, 2.2, 21, false),
    missileHeavy: rocketLaunch(ctx, 3, 22, true),
    rocket: rocketLaunch(ctx, 0.7, 23, false),
    engine: engineLoop(ctx),
    flyby: flyby(ctx),
    ir: outdoorIR(ctx),
  };
}

/** Recording names that can override the baked sounds (src/assets/sounds/<name>.ogg|.mp3|.wav). */
export const RECORDING_NAMES = ['engine', 'afterburner', 'gun20', 'gun30', 'gunEnemy', 'aa', 'explosionSmall', 'explosionMedium', 'explosionLarge', 'missile', 'missileHeavy', 'rocket', 'flyby', 'wind'];
