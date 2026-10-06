import * as THREE from 'three';
import { ParticleSystem, smokeTexture } from './Particles.js';
import { Debris } from './Debris.js';
import { GlowBatch, BeamBatch } from './Batches.js';
import { rand } from '../core/math.js';

// Visual effects facade. Gameplay code calls these named effects; they turn
// into emits on a handful of pooled GPU systems:
//   fire     additive particles (fireballs, sparks, muzzle flashes, flares)
//   smoke    alpha particles (smoke, dust, spray, contrails)
//   debris   tumbling chunks
//   glows    per-frame sprites (engine glows, missile motors, plasma)
//   beams    per-frame beams (tracers, lasers, railgun trails)
// plus a small fixed pool of point lights for explosion flashes.

const _v = new THREE.Vector3();

export class Effects {
  constructor(scene, quality, world) {
    this.scene = scene;
    this.q = Math.max(0.25, Math.min(1.6, quality.particles / 24000));
    const fogDensity = world.fogDensity;
    const fogColor = scene.fog.color;
    this.smokeTex = smokeTexture();
    const half = Math.round(quality.particles / 2);
    this.fire = new ParticleSystem(half, { additive: true, fogDensity, fogColor, texture: this.smokeTex });
    this.smoke = new ParticleSystem(half, { additive: false, fogDensity, fogColor, texture: this.smokeTex });
    this.debris = new Debris(quality.debris, fogDensity, fogColor, world.sunDir);
    this.glows = new GlowBatch(2048, fogDensity);
    this.beams = new BeamBatch(4096, fogDensity);
    scene.add(this.smoke.mesh, this.fire.mesh, this.debris.mesh, this.glows.mesh, this.beams.mesh);

    this.wrecks = [];
    for (let i = 0; i < 24; i++) this.wrecks.push({ x: 0, y: 0, z: 0, size: 1, t: 0, life: 1, timer: 0 });
    // Timed beams (railgun trails, laser hits) stored in a fixed pool.
    this.timedBeams = [];
    for (let i = 0; i < 64; i++) this.timedBeams.push({ t: 0, life: 1, s: new THREE.Vector3(), e: new THREE.Vector3(), w: 1, r: 1, g: 1, b: 1 });

    // Explosion flash lights (fixed count so shaders never recompile).
    this.lights = [];
    for (let i = 0; i < quality.lights; i++) {
      const l = new THREE.PointLight(0xffa050, 0, 900, 1.6);
      scene.add(l);
      this.lights.push({ light: l, t: 0, life: 1, peak: 0 });
    }
    this.time = 0;
    this.shake = null; // set by Session: (pos, strength) => camera shake
  }

  setTime(t) {
    this.time = t;
    this.fire.time = this.smoke.time = this.debris.time = t;
  }

  _n(n) {
    return Math.max(1, Math.round(n * this.q));
  }

  // ── Explosions ───────────────────────────────────────────────────────
  /** size ≈ blast radius in metres. */
  explosion(x, y, z, size = 12, { water = false, debris = true, ember = true } = {}) {
    const f = this.fire;
    const s = this.smoke;
    // Textured fireball: churning flame puffs that expand and cool.
    const n = this._n(12 + size * 1.4);
    for (let i = 0; i < n; i++) {
      const sp = size * rand(0.5, 2.4);
      const delay = Math.random() < 0.3 ? rand(0, 0.12) : 0;
      f.emit(x, y, z, rand(-1, 1) * sp, rand(-0.5, 1.1) * sp, rand(-1, 1) * sp, rand(0.6, 1.3), size * 0.6, size * rand(1.6, 2.8), 3.6, 1.55, 0.42, 1, 3.2, -2, 1, delay);
    }
    // White-hot core and flash.
    for (let i = 0; i < this._n(4); i++) f.emit(x, y, z, rand(-1, 1) * size, rand(-1, 1) * size, rand(-1, 1) * size, 0.35, size * 0.8, size * 2, 6, 5, 3.6, 1, 3, 0, 1);
    f.emit(x, y, z, 0, 0, 0, 0.22, size * 2.4, size * 5, 6, 5, 4, 1, 0, 0, 0);
    // Shockwave ring.
    f.emit(x, y, z, 0, 0, 0, 0.45, size * 0.5, size * 9, 2.2, 2.0, 1.8, 0.9, 0, 0, 3);
    // Sparks and burning fragments.
    const sparks = this._n(10 + size);
    for (let i = 0; i < sparks; i++) {
      const sp = size * rand(4, 10);
      f.emit(x, y, z, rand(-1, 1) * sp, rand(-0.2, 1.2) * sp, rand(-1, 1) * sp, rand(0.6, 1.8), 0.8, 0.2, 4, 2.4, 1, 1, 1, 9.8, 2);
    }
    // Rolling smoke, then a rising column for big blasts.
    const sm = this._n(10 + size);
    for (let i = 0; i < sm; i++) {
      const sp = size * rand(0.3, 1.3);
      const c = water ? 0.62 : rand(0.06, 0.2);
      s.emit(x, y, z, rand(-1, 1) * sp, rand(0, 1) * sp + 2, rand(-1, 1) * sp, rand(3, 7), size * 0.9, size * rand(3, 5), c, c, c * 1.05, water ? 0.75 : 0.85, 1.1, -2.5, 1, rand(0.05, 0.35));
    }
    if (size >= 14) {
      for (let i = 0; i < this._n(6 + size * 0.3); i++) {
        const c = water ? 0.55 : rand(0.05, 0.12);
        s.emit(x + rand(-1, 1) * size * 0.3, y, z + rand(-1, 1) * size * 0.3, rand(-2, 2), rand(14, 26) + size * 0.4, rand(-2, 2), rand(6, 10), size * 0.8, size * 3.5, c, c, c, 0.7, 0.35, -1, 1, rand(0.3, 1.2));
      }
      // Secondary blasts.
      for (let k = 0; k < Math.min(4, Math.floor(size / 12)); k++) {
        const ox = x + rand(-1, 1) * size;
        const oy = y + rand(-0.3, 1) * size;
        const oz = z + rand(-1, 1) * size;
        const d = rand(0.15, 0.7);
        for (let i = 0; i < this._n(6); i++) f.emit(ox, oy, oz, rand(-1, 1) * size, rand(-0.5, 1) * size, rand(-1, 1) * size, rand(0.5, 0.9), size * 0.4, size * 1.6, 3.6, 1.5, 0.4, 1, 3, -2, 1, d);
      }
    }
    if (water) this.splash(x, z, size * 1.5);
    if (debris) {
      const d = this._n(5 + size * 0.6);
      for (let i = 0; i < d; i++) {
        const sp = size * rand(1.5, 4);
        this.debris.emit(x, y, z, rand(-1, 1) * sp, rand(0, 1.2) * sp, rand(-1, 1) * sp, rand(2, 5), rand(0.3, 1.2) * Math.min(3, 0.5 + size * 0.08), rand(0.6, 1.2), ember ? rand(0, 1) : 0);
      }
    }
    this.flash(x, y, z, size * 30, 0.35 + size * 0.01);
  }

  /** A burning wreck that smokes for a while (destroyed ground units, ships). */
  wreck(x, y, z, size, life = 20) {
    let w = this.wrecks[0];
    for (const c of this.wrecks) {
      if (c.t <= 0) {
        w = c;
        break;
      }
      if (c.t < w.t) w = c;
    }
    w.x = x;
    w.y = y;
    w.z = z;
    w.size = size;
    w.t = w.life = life;
    w.timer = 0;
  }

  /** Foam wake behind a moving ship. */
  wake(x, z, vx, vz, size) {
    this.smoke.emit(x + rand(-1, 1) * size * 0.3, 1, z + rand(-1, 1) * size * 0.3, -vx * 0.2 + rand(-2, 2), 0.5, -vz * 0.2 + rand(-2, 2), rand(5, 8), size * 0.5, size * 2.5, 0.9, 0.93, 0.95, 0.5, 0.3, 0, 1);
  }

  contrail(x, y, z, scale = 1) {
    this.smoke.emit(x, y, z, rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5), rand(5, 9), 1.2 * scale, 7 * scale, 0.95, 0.96, 1, 0.32, 0.2, -0.1, 1);
  }

  /** Per-step emitters (wrecks). */
  step(dt) {
    for (const w of this.wrecks) {
      if (w.t <= 0) continue;
      w.t -= dt;
      w.timer -= dt;
      if (w.timer > 0) continue;
      w.timer = 0.12;
      const k = w.t / w.life;
      const sz = w.size * (0.5 + k * 0.5);
      if (Math.random() < 0.8 * k) this.fire.emit(w.x + rand(-1, 1) * sz * 0.3, w.y + sz * 0.2, w.z + rand(-1, 1) * sz * 0.3, rand(-1, 1), rand(3, 8), rand(-1, 1), rand(0.5, 1), sz * 0.45, sz * 0.15, 3.5, 1.4, 0.35, 1, 0.5, -3, 1);
      const c = rand(0.04, 0.1);
      this.smoke.emit(w.x, w.y + sz * 0.4, w.z, rand(-1, 1), rand(7, 12), rand(-1, 1), rand(6, 10), sz * 0.6, sz * 3.2, c, c, c, 0.75 * (0.4 + k * 0.6), 0.25, -0.6, 1);
    }
  }

  /** Air burst of flak (AA guns). */
  flak(x, y, z) {
    const s = this.smoke;
    for (let i = 0; i < this._n(5); i++) s.emit(x, y, z, rand(-6, 6), rand(-3, 6), rand(-6, 6), rand(2, 3.5), 6, 18, 0.06, 0.06, 0.06, 0.9, 1, -0.5, 1);
    this.fire.emit(x, y, z, 0, 0, 0, 0.18, 8, 20, 4, 2.4, 1, 1, 0, 0, 0);
  }

  hitSparks(x, y, z, scale = 1) {
    const f = this.fire;
    const n = this._n(5 * scale);
    for (let i = 0; i < n; i++) {
      const sp = rand(15, 50) * scale;
      f.emit(x, y, z, rand(-1, 1) * sp, rand(-1, 1) * sp, rand(-1, 1) * sp, rand(0.15, 0.4), 0.5 * scale, 0.1, 4, 3, 1.6, 1, 2, 9.8, 2);
    }
    f.emit(x, y, z, 0, 0, 0, 0.08, 2.5 * scale, 4 * scale, 4, 3, 2, 1, 0, 0, 0);
    this.smoke.emit(x, y, z, rand(-2, 2), rand(0, 3), rand(-2, 2), 0.8, 1.5 * scale, 5 * scale, 0.2, 0.2, 0.2, 0.5, 1, 0, 1);
  }

  muzzle(x, y, z, scale = 1, r = 4, g = 3, b = 1.6) {
    this.fire.emit(x, y, z, 0, 0, 0, 0.05, 1.4 * scale, 2.2 * scale, r, g, b, 1, 0, 0, 0);
  }

  impactGround(x, y, z, scale = 1, water = false) {
    if (water) {
      this.smoke.emit(x, y, z, rand(-1, 1), rand(8, 14) * scale, rand(-1, 1), 0.9, 1.5 * scale, 4 * scale, 0.85, 0.9, 0.95, 0.75, 1, 9.8, 1);
    } else {
      this.smoke.emit(x, y, z, rand(-2, 2), rand(2, 6) * scale, rand(-2, 2), 1.4, 2 * scale, 6 * scale, 0.32, 0.28, 0.22, 0.7, 1, 0, 1);
      if (Math.random() < 0.3) this.fire.emit(x, y, z, 0, 0, 0, 0.06, 2 * scale, 3 * scale, 4, 3, 1.5, 1, 0, 0, 0);
    }
  }

  splash(x, z, size) {
    const s = this.smoke;
    for (let i = 0; i < this._n(6 + size * 0.2); i++) {
      s.emit(x + rand(-1, 1) * size * 0.3, 0.5, z + rand(-1, 1) * size * 0.3, rand(-1, 1) * size * 0.3, rand(1, 3) * size * 0.6, rand(-1, 1) * size * 0.3, rand(1.2, 2.4), size * 0.25, size * 0.8, 0.8, 0.85, 0.9, 0.45, 0.8, 9.8, 1);
    }
  }

  // ── Trails ───────────────────────────────────────────────────────────
  missileTrail(x, y, z, vx, vy, vz, scale = 1, bright = 1) {
    const life = this.q > 0.8 ? rand(3, 5.5) : rand(1.8, 3.2);
    this.smoke.emit(x, y, z, vx * 0.05 + rand(-1, 1), vy * 0.05 + rand(-1, 1), vz * 0.05 + rand(-1, 1), life * scale, 1.2 * scale, 7 * scale, 0.86, 0.86, 0.88, 0.55, 0.8, -0.6, 1);
    if (bright > 0) this.fire.emit(x, y, z, vx * 0.2, vy * 0.2, vz * 0.2, 0.08, 1.4 * scale, 0.4, 4, 2.2, 1, bright, 0, 0, 0);
  }

  rocketTrail(x, y, z) {
    this.smoke.emit(x, y, z, rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(0.8, 1.4), 0.8, 3.5, 0.75, 0.75, 0.75, 0.45, 1, -0.5, 1);
  }

  damageSmoke(u, hpf) {
    const p = u.pos;
    const dark = hpf < 0.3 ? 0.06 : 0.25;
    this.smoke.emit(p.x, p.y, p.z, u.vel.x * 0.15 + rand(-2, 2), u.vel.y * 0.15 + rand(-2, 2), u.vel.z * 0.15 + rand(-2, 2), rand(1.5, 3), 2, 9, dark, dark, dark, 0.65, 0.8, -1, 1);
    if (hpf < 0.25) this.fire.emit(p.x, p.y, p.z, u.vel.x * 0.3, u.vel.y * 0.3, u.vel.z * 0.3, 0.25, 2.5, 1, 3.5, 1.4, 0.4, 1, 1, 0, 0);
  }

  burningTrail(u) {
    const p = u.pos;
    this.fire.emit(p.x, p.y, p.z, u.vel.x * 0.4 + rand(-3, 3), u.vel.y * 0.4 + rand(-3, 3), u.vel.z * 0.4 + rand(-3, 3), rand(0.25, 0.5), 3.5, 1.5, 3.5, 1.4, 0.4, 1, 1, 0, 0);
    this.smoke.emit(p.x, p.y, p.z, u.vel.x * 0.1, u.vel.y * 0.1, u.vel.z * 0.1, rand(2.5, 4), 3, 12, 0.05, 0.05, 0.05, 0.75, 0.6, -1.5, 1);
  }

  /** Burning ground wreck / napalm fire. */
  groundFire(x, y, z, size = 6) {
    this.fire.emit(x + rand(-1, 1) * size, y, z + rand(-1, 1) * size, rand(-1, 1), rand(4, 10), rand(-1, 1), rand(0.6, 1.2), size * 0.6, size * 0.2, 3.5, 1.4, 0.35, 1, 0.5, -3, 0);
    if (Math.random() < 0.5) this.smoke.emit(x, y + size, z, rand(-1, 1), rand(6, 10), rand(-1, 1), rand(3, 6), size * 0.6, size * 3, 0.07, 0.07, 0.07, 0.7, 0.4, -1, 1);
  }

  flareBurst(x, y, z, vx, vy, vz) {
    this.fire.emit(x, y, z, vx, vy, vz, 0.15, 6, 10, 5, 4.4, 3.4, 1, 0, 0, 0);
  }

  flareTrail(x, y, z) {
    this.smoke.emit(x, y, z, rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(1.2, 2.2), 1.5, 5, 0.85, 0.85, 0.85, 0.5, 1, -0.4, 1);
  }

  chaff(x, y, z, vx, vy, vz) {
    for (let i = 0; i < this._n(14); i++) {
      this.fire.emit(x, y, z, vx * 0.3 + rand(-14, 14), vy * 0.3 + rand(-14, 14), vz * 0.3 + rand(-14, 14), rand(1.5, 3), 0.5, 0.4, 0.9, 1, 1.1, 0.8, 1.5, 2, 2);
    }
  }

  /** Expanding EMP shell. */
  empWave(x, y, z, radius) {
    const n = this._n(70);
    for (let i = 0; i < n; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(radius * 1.2);
      this.fire.emit(x, y, z, _v.x, _v.y, _v.z, 0.9, 10, 30, 0.6, 1.6, 4, 0.9, 1.2, 0, 0);
    }
    this.fire.emit(x, y, z, 0, 0, 0, 0.4, radius * 0.3, radius * 2, 0.8, 1.6, 4, 1, 0, 0, 0);
    this.flash(x, y, z, 2000, 0.4, 0x88bbff);
  }

  shieldHit(x, y, z) {
    for (let i = 0; i < this._n(6); i++) this.fire.emit(x, y, z, rand(-10, 10), rand(-10, 10), rand(-10, 10), 0.3, 3, 0.5, 0.6, 1.6, 4, 1, 3, 0, 0);
  }

  vapor(x, y, z, vx, vy, vz) {
    this.smoke.emit(x, y, z, vx * 0.9, vy * 0.9, vz * 0.9, 0.35, 0.6, 2.2, 0.95, 0.97, 1, 0.25, 4, 0, 1);
  }

  timedBeam(sx, sy, sz, ex, ey, ez, width, life, r, g, b) {
    let best = this.timedBeams[0];
    for (const tb of this.timedBeams) {
      if (tb.t <= 0) {
        best = tb;
        break;
      }
      if (tb.t < best.t) best = tb;
    }
    best.s.set(sx, sy, sz);
    best.e.set(ex, ey, ez);
    best.t = best.life = life;
    best.w = width;
    best.r = r;
    best.g = g;
    best.b = b;
  }

  flash(x, y, z, intensity, life, color = 0xffa050) {
    if (!this.lights.length) return;
    let best = this.lights[0];
    for (const l of this.lights) if (l.t < best.t) best = l;
    best.light.position.set(x, y, z);
    best.light.color.set(color);
    best.peak = intensity * 40;
    best.t = best.life = life;
  }

  /** Called once per rendered frame (renderTime is interpolated sim time). */
  render(dt, renderTime) {
    this.fire.update(renderTime);
    this.smoke.update(renderTime);
    this.debris.update(renderTime);
    for (const l of this.lights) {
      if (l.t > 0) {
        l.t -= dt;
        const k = Math.max(0, l.t / l.life);
        l.light.intensity = l.peak * k * k;
      } else l.light.intensity = 0;
    }
    for (const tb of this.timedBeams) {
      if (tb.t <= 0) continue;
      tb.t -= dt;
      const k = Math.max(0, tb.t / tb.life);
      this.beams.add(tb.s.x, tb.s.y, tb.s.z, tb.e.x, tb.e.y, tb.e.z, tb.w * (0.5 + k * 0.5), 0.0012, tb.r * k, tb.g * k, tb.b * k, 1);
    }
  }

  dispose() {
    this.scene.remove(this.smoke.mesh, this.fire.mesh, this.debris.mesh, this.glows.mesh, this.beams.mesh);
    this.fire.dispose();
    this.smoke.dispose();
    this.debris.dispose();
    this.glows.dispose();
    this.beams.dispose();
    this.smokeTex.dispose();
    for (const l of this.lights) {
      this.scene.remove(l.light);
      l.light.dispose();
    }
  }
}

