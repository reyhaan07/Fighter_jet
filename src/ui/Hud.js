import * as THREE from 'three';

// Canvas-2D heads-up display drawn over the 3D view every frame:
// pitch ladder, speed / altitude / heading tapes, aim reticle, target boxes
// with distance, lock diamond, missile-warning arrows, weapons and ammo,
// health / shield, radar, hit markers, damage numbers, messages.

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const DEG = 180 / Math.PI;

const COL = {
  hud: '#8dffb5',
  dim: 'rgba(141,255,181,0.55)',
  faint: 'rgba(141,255,181,0.25)',
  warn: '#ffcf5a',
  danger: '#ff5a4a',
  friend: '#7fd4ff',
  white: '#ffffff',
  shadow: 'rgba(0,0,0,0.55)',
};

export class Hud {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.settings = settings;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.radarRange = 6000;
    this.hitMarker = 0;
    this.hitKill = false;
    this.damageFlash = 0;
    this.numbers = []; // floating damage numbers (pooled objects)
    for (let i = 0; i < 48; i++) this.numbers.push({ t: 0, x: 0, y: 0, z: 0, v: 0, kill: false });
    this.messages = []; // { text, t, color }
    this.feed = []; // kill feed
    this.radioLine = null;
    this.visible = true;
    this.flash = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** Forget messages and feedback from a previous level. */
  reset() {
    this.messages.length = 0;
    this.feed.length = 0;
    this.radioLine = null;
    this.hitMarker = 0;
    this.damageFlash = 0;
    for (const n of this.numbers) n.t = 0;
  }

  clear() {
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ── Feedback API ─────────────────────────────────────────────────────
  hit(kill) {
    this.hitMarker = kill ? 0.5 : 0.18;
    this.hitKill = kill;
  }

  damageNumber(x, y, z, v, kill) {
    if (!this.settings.damageNumbers) return;
    let n = this.numbers[0];
    for (const m of this.numbers) {
      if (m.t <= 0) {
        n = m;
        break;
      }
      if (m.t < n.t) n = m;
    }
    n.t = 1;
    n.x = x;
    n.y = y;
    n.z = z;
    n.v = v;
    n.kill = kill;
  }

  damaged(amount) {
    this.damageFlash = Math.min(1, this.damageFlash + amount * 0.04 + 0.15);
  }

  message(text, duration = 3, color = COL.hud) {
    this.messages.push({ text, t: duration, color });
    if (this.messages.length > 4) this.messages.shift();
  }

  killFeed(text) {
    this.feed.push({ text, t: 4 });
    if (this.feed.length > 5) this.feed.shift();
  }

  radio(who, text, duration = 4) {
    this.radioLine = { who, text, t: duration };
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  project(cam, x, y, z, out) {
    _v.set(x, y, z).project(cam);
    out.x = (_v.x * 0.5 + 0.5) * this.w;
    out.y = (-_v.y * 0.5 + 0.5) * this.h;
    out.z = _v.z;
    out.behind = _v.z > 1;
    return out;
  }

  text(t, x, y, size = 13, color = COL.hud, align = 'left', weight = 600, font = 'mono') {
    const g = this.g;
    g.font = `${weight} ${size}px ${font === 'mono' ? '"JetBrains Mono", monospace' : '"Barlow Condensed", sans-serif'}`;
    g.textAlign = align;
    g.fillStyle = COL.shadow;
    g.fillText(t, x + 1, y + 1);
    g.fillStyle = color;
    g.fillText(t, x, y);
  }

  // ── Main draw ────────────────────────────────────────────────────────
  draw(s, dt) {
    const g = this.g;
    this.clear();
    if (!this.visible || !s.player) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    const p = s.player;
    const cam = s.camera;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const scale = Math.min(1.25, Math.max(0.75, this.h / 900));
    this.ui = scale;

    // Damage vignette.
    this.damageFlash = Math.max(0, this.damageFlash - dt * 0.9);
    const hpf = p.hp / p.maxHp;
    const vig = Math.max(this.damageFlash, hpf < 0.3 ? 0.25 + Math.sin(s.time * 6) * 0.1 : 0);
    if (vig > 0.01) {
      const grd = g.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.55, cx, cy, Math.max(cx, cy) * 1.15);
      grd.addColorStop(0, 'rgba(255,0,0,0)');
      grd.addColorStop(1, `rgba(200,10,0,${Math.min(0.75, vig)})`);
      g.fillStyle = grd;
      g.fillRect(0, 0, this.w, this.h);
    }

    if (s.cinematic) return;
    if (s.ordnance.cruise) {
      this.drawCruise(s);
      this.drawMessages(s, dt);
      return;
    }

    const cockpit = s.cameraRig.mode === 'cockpit';
    if (cockpit) this.drawCanopy(cx, cy);
    this.drawPitchLadder(s, cx, cy, scale);
    this.drawReticles(s, cam);
    this.drawTapes(s, cx, cy, scale);
    this.drawTargets(s, cam, dt);
    this.drawWarnings(s, cx, cy, scale);
    this.drawWeapons(s, scale);
    this.drawStatus(s, scale);
    this.drawRadar(s, scale);
    this.drawMessages(s, dt);
    this.drawHitMarker(cx, cy, dt);
    this.drawNumbers(s, cam, dt);
  }

  drawCanopy(cx, cy) {
    const g = this.g;
    g.strokeStyle = 'rgba(20,24,28,0.9)';
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(cx - this.w * 0.42, 0);
    g.quadraticCurveTo(cx - this.w * 0.5, this.h * 0.5, cx - this.w * 0.62, this.h);
    g.moveTo(cx + this.w * 0.42, 0);
    g.quadraticCurveTo(cx + this.w * 0.5, this.h * 0.5, cx + this.w * 0.62, this.h);
    g.stroke();
    g.lineWidth = 1.5;
  }

  drawPitchLadder(s, cx, cy, k) {
    const g = this.g;
    const p = s.player;
    const cam = s.camera;
    _f.set(0, 0, -1).applyQuaternion(p.renderQuat);
    _r.set(1, 0, 0).applyQuaternion(p.renderQuat);
    _u.set(0, 1, 0).applyQuaternion(p.renderQuat);
    const pitch = Math.asin(Math.max(-1, Math.min(1, _f.y))) * DEG;
    const roll = Math.atan2(-_r.y, _u.y);
    const ppd = this.h / cam.fov; // pixels per degree (approx)
    g.save();
    g.beginPath();
    g.rect(cx - 230 * k, cy - 210 * k, 460 * k, 420 * k);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-roll);
    g.strokeStyle = COL.dim;
    g.fillStyle = COL.dim;
    g.font = `500 ${11 * k}px "JetBrains Mono", monospace`;
    g.textAlign = 'center';
    const base = Math.round(pitch / 5) * 5;
    for (let a = base - 25; a <= base + 25; a += 5) {
      if (a < -90 || a > 90) continue;
      const y = (pitch - a) * ppd;
      const wHalf = (a === 0 ? 170 : a % 10 === 0 ? 70 : 40) * k;
      const gap = 28 * k;
      g.beginPath();
      if (a < 0) g.setLineDash([6, 5]);
      else g.setLineDash([]);
      g.moveTo(-wHalf, y);
      g.lineTo(-gap, y);
      g.moveTo(gap, y);
      g.lineTo(wHalf, y);
      if (a !== 0) {
        const tick = a > 0 ? 8 : -8;
        g.moveTo(-wHalf, y);
        g.lineTo(-wHalf, y + tick * k);
        g.moveTo(wHalf, y);
        g.lineTo(wHalf, y + tick * k);
      }
      g.stroke();
      if (a !== 0 && a % 10 === 0) {
        g.fillText(String(Math.abs(a)), -wHalf - 16 * k, y + 4);
        g.fillText(String(Math.abs(a)), wHalf + 16 * k, y + 4);
      }
    }
    g.setLineDash([]);
    g.restore();
    // Boresight / waterline symbol.
    g.strokeStyle = COL.hud;
    g.beginPath();
    g.moveTo(cx - 22 * k, cy);
    g.lineTo(cx - 9 * k, cy);
    g.lineTo(cx - 4 * k, cy + 6 * k);
    g.lineTo(cx, cy);
    g.lineTo(cx + 4 * k, cy + 6 * k);
    g.lineTo(cx + 9 * k, cy);
    g.lineTo(cx + 22 * k, cy);
    g.stroke();
  }

  drawReticles(s, cam) {
    const g = this.g;
    const p = s.player;
    const k = this.ui;
    const sp = this._sp2 || (this._sp2 = { x: 0, y: 0, z: 0, behind: false });
    // Flight path marker (where the jet is actually going).
    const vl = p.vel.length() || 1;
    this.project(cam, p.renderPos.x + (p.vel.x / vl) * 1000, p.renderPos.y + (p.vel.y / vl) * 1000, p.renderPos.z + (p.vel.z / vl) * 1000, sp);
    if (!sp.behind) {
      g.strokeStyle = COL.hud;
      g.beginPath();
      g.arc(sp.x, sp.y, 6 * k, 0, Math.PI * 2);
      g.moveTo(sp.x - 14 * k, sp.y);
      g.lineTo(sp.x - 6 * k, sp.y);
      g.moveTo(sp.x + 6 * k, sp.y);
      g.lineTo(sp.x + 14 * k, sp.y);
      g.moveTo(sp.x, sp.y - 6 * k);
      g.lineTo(sp.x, sp.y - 12 * k);
      g.stroke();
    }
    // Gun cross: where rounds will be at convergence range.
    this.project(cam, p.renderPos.x + p.gunDir.x * 700, p.renderPos.y + p.gunDir.y * 700, p.renderPos.z + p.gunDir.z * 700, sp);
    if (!sp.behind) {
      const gx = sp.x;
      const gy = sp.y;
      g.strokeStyle = COL.white;
      g.beginPath();
      g.moveTo(gx - 10 * k, gy);
      g.lineTo(gx - 3 * k, gy);
      g.moveTo(gx + 3 * k, gy);
      g.lineTo(gx + 10 * k, gy);
      g.moveTo(gx, gy - 10 * k);
      g.lineTo(gx, gy - 3 * k);
      g.moveTo(gx, gy + 3 * k);
      g.lineTo(gx, gy + 10 * k);
      g.stroke();
      // Gun heat arc.
      const gun = p.loadout?.gun;
      if (gun?.def.heatPerShot && gun.heat > 0.02) {
        g.strokeStyle = gun.overheated > 0 ? COL.danger : gun.heat > 0.75 ? COL.warn : COL.dim;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(gx, gy, 18 * k, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * gun.heat);
        g.stroke();
        g.lineWidth = 1.5;
      }
    }
    // Bombs: CCIP pipper / laser designator.
    const cur = p.loadout?.current;
    if (cur && cur.def.class === 'BombWeapon') {
      const laser = cur.def.guidance === 'laser';
      const pt = laser ? (p.target && !p.target.isAir && p.target.alive ? p.target.pos : s.groundAim()) : s.bombImpact();
      if (pt) {
        this.project(cam, pt.x, pt.y, pt.z, sp);
        if (!sp.behind) {
          g.strokeStyle = laser ? COL.danger : COL.warn;
          g.beginPath();
          g.arc(sp.x, sp.y, 12 * k, 0, Math.PI * 2);
          g.moveTo(sp.x - 20 * k, sp.y);
          g.lineTo(sp.x - 12 * k, sp.y);
          g.moveTo(sp.x + 12 * k, sp.y);
          g.lineTo(sp.x + 20 * k, sp.y);
          g.stroke();
          this.text(laser ? 'LASER' : 'CCIP', sp.x, sp.y + 28 * k, 10 * k, laser ? COL.danger : COL.warn, 'center');
        }
      }
    }
    // Mouse-aim circle.
    if (s.controller.usingMouseAim) {
      const a = s.controller.aimDir;
      this.project(cam, cam.position.x + a.x * 1000, cam.position.y + a.y * 1000, cam.position.z + a.z * 1000, sp);
      if (!sp.behind) {
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.beginPath();
        g.arc(sp.x, sp.y, 13 * k, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(sp.x - 1, sp.y - 1, 2, 2);
      }
    }
  }

  drawTapes(s, cx, cy, k) {
    const g = this.g;
    const p = s.player;
    const f = p.flight;
    const speedKmh = f.speed * 3.6;
    const alt = p.pos.y;
    const tapeH = 260 * k;
    // Speed tape (left).
    const lx = cx - 300 * k;
    const rx = cx + 300 * k;
    g.strokeStyle = COL.dim;
    g.beginPath();
    g.moveTo(lx, cy - tapeH / 2);
    g.lineTo(lx, cy + tapeH / 2);
    g.moveTo(rx, cy - tapeH / 2);
    g.lineTo(rx, cy + tapeH / 2);
    g.stroke();
    g.font = `500 ${10 * k}px "JetBrains Mono", monospace`;
    g.fillStyle = COL.dim;
    const spPx = 1.4 * k; // px per km/h
    for (let v = Math.floor((speedKmh - 100) / 50) * 50; v <= speedKmh + 100; v += 50) {
      const y = cy - (v - speedKmh) * spPx;
      if (Math.abs(y - cy) > tapeH / 2 || v < 0) continue;
      g.fillRect(lx - 8 * k, y, 8 * k, 1);
      g.textAlign = 'right';
      g.fillText(String(v), lx - 12 * k, y + 3);
    }
    const altPx = 0.18 * k; // px per m
    for (let v = Math.floor((alt - 800) / 100) * 100; v <= alt + 800; v += 100) {
      const y = cy - (v - alt) * altPx;
      if (Math.abs(y - cy) > tapeH / 2) continue;
      g.fillRect(rx, y, v % 500 === 0 ? 10 * k : 5 * k, 1);
      if (v % 500 === 0) {
        g.textAlign = 'left';
        g.fillText(String(v), rx + 14 * k, y + 3);
      }
    }
    // Ground level marker on altimeter.
    const ground = s.world.surfaceAt(p.pos.x, p.pos.z);
    const gy = cy - (ground - alt) * altPx;
    if (gy < cy + tapeH / 2) {
      g.fillStyle = 'rgba(255,140,60,0.35)';
      g.fillRect(rx, Math.max(gy, cy - tapeH / 2), 6 * k, cy + tapeH / 2 - Math.max(gy, cy - tapeH / 2));
    }
    // Readout boxes.
    this.box(lx - 74 * k, cy - 11 * k, 66 * k, 22 * k);
    this.text(String(Math.round(speedKmh)), lx - 12 * k, cy + 5 * k, 15 * k, COL.hud, 'right');
    this.box(rx + 8 * k, cy - 11 * k, 70 * k, 22 * k);
    this.text(String(Math.round(alt)), rx + 72 * k, cy + 5 * k, 15 * k, COL.hud, 'right');
    this.text('KM/H', lx - 40 * k, cy - tapeH / 2 - 10 * k, 10 * k, COL.dim, 'center');
    this.text('ALT M', rx + 40 * k, cy - tapeH / 2 - 10 * k, 10 * k, COL.dim, 'center');
    this.text(`M ${(f.speed / 340).toFixed(2)}`, lx - 40 * k, cy + tapeH / 2 + 18 * k, 11 * k, COL.dim, 'center');
    const gcol = Math.abs(f.gForce) > p.stats.maxG * 0.9 ? COL.warn : COL.dim;
    this.text(`G ${f.gForce.toFixed(1)}`, lx - 40 * k, cy + tapeH / 2 + 34 * k, 11 * k, gcol, 'center');
    const vs = p.vel.y;
    this.text(`VS ${vs >= 0 ? '+' : ''}${Math.round(vs)}`, rx + 40 * k, cy + tapeH / 2 + 18 * k, 11 * k, COL.dim, 'center');
    this.text(`R ${Math.round(Math.max(0, alt - ground))}`, rx + 40 * k, cy + tapeH / 2 + 34 * k, 11 * k, COL.dim, 'center');

    // Throttle.
    const tx = lx - 96 * k;
    const th = 120 * k;
    g.strokeStyle = COL.faint;
    g.strokeRect(tx, cy - th / 2, 8 * k, th);
    g.fillStyle = f.afterburner > 0.3 ? COL.warn : COL.dim;
    const tv = Math.min(1, f.throttle) * 0.8 + f.afterburner * 0.2;
    g.fillRect(tx, cy + th / 2 - th * tv, 8 * k, th * tv);
    this.text(f.afterburner > 0.3 ? 'AB' : `${Math.round(f.throttleTarget * 100)}%`, tx + 4 * k, cy + th / 2 + 14 * k, 10 * k, f.afterburner > 0.3 ? COL.warn : COL.dim, 'center');
    if (f.controls.brake) this.text('BRAKE', tx + 4 * k, cy - th / 2 - 8 * k, 10 * k, COL.warn, 'center');

    // Heading tape (top).
    _f.set(0, 0, -1).applyQuaternion(p.renderQuat);
    let hdg = Math.atan2(_f.x, -_f.z) * DEG;
    if (hdg < 0) hdg += 360;
    const hy = 46 * k;
    const hpx = 4 * k;
    g.fillStyle = COL.dim;
    g.font = `500 ${10 * k}px "JetBrains Mono", monospace`;
    g.textAlign = 'center';
    for (let a = Math.floor((hdg - 40) / 5) * 5; a <= hdg + 40; a += 5) {
      const x = cx + (a - hdg) * hpx;
      const aa = ((a % 360) + 360) % 360;
      g.fillRect(x, hy, 1, aa % 10 === 0 ? 8 * k : 4 * k);
      if (aa % 30 === 0) g.fillText(aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : String(aa / 10).padStart(2, '0'), x, hy - 4 * k);
    }
    this.box(cx - 24 * k, hy + 12 * k, 48 * k, 18 * k);
    this.text(String(Math.round(hdg)).padStart(3, '0'), cx, hy + 25 * k, 12 * k, COL.hud, 'center');
    // Assist indicators.
    const assist = [];
    if (s.controller.usingMouseAim) assist.push('MOUSE AIM');
    if (s.controller.autoLevel) assist.push('AUTO-LVL');
    this.text(assist.join('  '), cx, hy + 46 * k, 10 * k, COL.faint, 'center');
  }

  box(x, y, w, h) {
    const g = this.g;
    g.fillStyle = 'rgba(0,12,6,0.35)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = COL.dim;
    g.strokeRect(x, y, w, h);
  }

  drawTargets(s, cam) {
    const g = this.g;
    const p = s.player;
    const k = this.ui;
    const units = s.entities.units;
    const sel = s.targeting.current;
    const wpn = p.loadout?.current;
    const locks = wpn?.locks;
    const range = p.stats.radarRange * 1.6;
    const sp = this._sp || (this._sp = { x: 0, y: 0, z: 0, behind: false });
    g.font = `500 ${10 * k}px "JetBrains Mono", monospace`;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || !u.isTarget || u === p) continue;
      const friend = u.team === p.team;
      const dist = u.renderPos.distanceTo(p.renderPos);
      if (dist > range && !u.objective) continue;
      if (friend && dist > 6000) continue;
      this.project(cam, u.renderPos.x, u.renderPos.y, u.renderPos.z, sp);
      if (sp.behind || sp.x < -50 || sp.x > this.w + 50 || sp.y < -50 || sp.y > this.h + 50) continue;
      const size = Math.max(10 * k, Math.min(60, (u.radius * 900) / Math.max(dist, 1))) ;
      const isSel = u === sel;
      const col = friend ? COL.friend : u.objective ? COL.warn : isSel ? COL.danger : COL.hud;
      g.strokeStyle = col;
      g.lineWidth = isSel ? 2 : 1.2;
      if (friend) {
        g.beginPath();
        g.arc(sp.x, sp.y, size * 0.7, 0, Math.PI * 2);
        g.stroke();
      } else {
        // Corner brackets.
        const h = size;
        const c = h * 0.45;
        g.beginPath();
        g.moveTo(sp.x - h, sp.y - h + c);
        g.lineTo(sp.x - h, sp.y - h);
        g.lineTo(sp.x - h + c, sp.y - h);
        g.moveTo(sp.x + h - c, sp.y - h);
        g.lineTo(sp.x + h, sp.y - h);
        g.lineTo(sp.x + h, sp.y - h + c);
        g.moveTo(sp.x + h, sp.y + h - c);
        g.lineTo(sp.x + h, sp.y + h);
        g.lineTo(sp.x + h - c, sp.y + h);
        g.moveTo(sp.x - h + c, sp.y + h);
        g.lineTo(sp.x - h, sp.y + h);
        g.lineTo(sp.x - h, sp.y + h - c);
        g.stroke();
      }
      if (isSel || dist < 4000 || u.objective) {
        g.fillStyle = col;
        g.textAlign = 'left';
        g.fillText(dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`, sp.x + size + 4, sp.y - size + 8);
        if (isSel || u.objective) g.fillText(u.def.name.toUpperCase(), sp.x + size + 4, sp.y - size + 20 * k);
        if (u.maxHp > 60 && u.hp < u.maxHp) {
          g.fillStyle = COL.faint;
          g.fillRect(sp.x - size, sp.y + size + 4, size * 2, 3);
          g.fillStyle = col;
          g.fillRect(sp.x - size, sp.y + size + 4, size * 2 * (u.hp / u.maxHp), 3);
        }
      }
      // Lock diamond.
      if (locks && locks.includes(u)) this.diamond(sp.x, sp.y, size + 8, COL.danger, true);
      else if (wpn?.candidate === u && wpn.lockProgress > 0) {
        const lp = wpn.lockProgress;
        this.diamond(sp.x, sp.y, size + 8 + (1 - lp) * 60, COL.warn, false);
      }
      // Gun lead indicator for the selected air target.
      if (isSel && u.isAir && dist < 2200 && p.loadout?.gun) {
        const bs = p.loadout.gun.def.speed;
        const t = dist / bs;
        this.project(cam, u.renderPos.x + (u.vel.x - p.vel.x) * t, u.renderPos.y + (u.vel.y - p.vel.y) * t, u.renderPos.z + (u.vel.z - p.vel.z) * t, sp);
        if (!sp.behind) {
          g.strokeStyle = COL.danger;
          g.beginPath();
          g.arc(sp.x, sp.y, 7 * k, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = COL.danger;
          g.fillRect(sp.x - 1.5, sp.y - 1.5, 3, 3);
        }
      }
    }
    g.lineWidth = 1.5;
    // Off-screen arrow to the selected target.
    if (sel && sel.alive) {
      this.project(cam, sel.renderPos.x, sel.renderPos.y, sel.renderPos.z, sp);
      const on = !sp.behind && sp.x > 0 && sp.x < this.w && sp.y > 0 && sp.y < this.h;
      if (!on) this.edgeArrow(cam, sel.renderPos, COL.danger, `${(sel.renderPos.distanceTo(p.renderPos) / 1000).toFixed(1)}`);
    }
  }

  /** Arrow at a ring around the centre pointing toward a world position. */
  edgeArrow(cam, pos, color, label, radius = 0.36) {
    const g = this.g;
    _inv.copy(cam.quaternion).invert();
    _w.copy(pos).sub(cam.position).applyQuaternion(_inv);
    const ang = Math.atan2(-_w.y, _w.x);
    const R = Math.min(this.w, this.h) * radius;
    const x = this.w / 2 + Math.cos(ang) * R;
    const y = this.h / 2 + Math.sin(ang) * R;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(14, 0);
    g.lineTo(-6, -9);
    g.lineTo(-2, 0);
    g.lineTo(-6, 9);
    g.closePath();
    g.fill();
    g.restore();
    if (label) this.text(label, x, y + 22, 11, color, 'center');
  }

  diamond(x, y, r, color, filled) {
    const g = this.g;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    g.stroke();
    if (filled) {
      g.fillStyle = 'rgba(255,90,74,0.12)';
      g.fill();
    }
    g.lineWidth = 1.5;
  }

  drawWarnings(s, cx, cy, k) {
    const w = s.warnings;
    const blink = Math.sin(s.time * 14) > 0;
    let y = cy - 120 * k;
    if (w.incoming.length) {
      for (const m of w.incoming) this.edgeArrow(s.camera, m.renderPos, COL.danger, `${(m.pos.distanceTo(s.player.pos) / 1000).toFixed(1)}`, 0.28);
      if (blink) this.text('MISSILE', cx, y, 26 * k, COL.danger, 'center', 600, 'ui');
      y -= 30 * k;
    } else if (w.lockLevel >= 1) {
      if (blink) this.text('LOCKED', cx, y, 22 * k, COL.danger, 'center', 600, 'ui');
      y -= 26 * k;
    } else if (w.lockLevel > 0.05) {
      this.text('LOCK WARNING', cx, y, 18 * k, COL.warn, 'center', 600, 'ui');
      y -= 24 * k;
    }
    let y2 = cy + 150 * k;
    if (w.pullUp && blink) {
      this.text('PULL UP', cx, y2, 26 * k, COL.danger, 'center', 600, 'ui');
      y2 += 30 * k;
    }
    if (w.stall) {
      this.text('STALL', cx, y2, 22 * k, COL.warn, 'center', 600, 'ui');
      y2 += 26 * k;
    }
    if (w.outOfBounds > 0) {
      this.text(`RETURN TO COMBAT AREA  ${Math.max(0, Math.ceil(12 - w.outOfBounds))}`, cx, y2, 20 * k, COL.warn, 'center', 600, 'ui');
      y2 += 26 * k;
    }
    const p = s.player;
    if (Math.abs(p.flight.gForce) > p.stats.maxG * 0.95) this.text('OVER-G', cx, y2, 18 * k, COL.warn, 'center', 600, 'ui');
    if (p.disabled > 0) this.text('SYSTEMS DISABLED', cx, cy + 60 * k, 20 * k, COL.danger, 'center', 600, 'ui');
  }

  drawWeapons(s, k) {
    const g = this.g;
    const lo = s.player.loadout;
    if (!lo) return;
    const x = this.w - 24 * k;
    let y = this.h - 30 * k;
    const line = (name, value, active, status, bar, color) => {
      this.text(String(value), x, y, 14 * k, active ? COL.hud : COL.dim, 'right');
      this.text(name, x - 70 * k, y, 13 * k, active ? COL.hud : COL.dim, 'right', 600, 'ui');
      if (status) this.text(status, x - 160 * k, y, 11 * k, color || (status === 'OVERHEAT' || status === 'NO LOCK' ? COL.danger : COL.warn), 'right');
      if (bar) {
        g.fillStyle = COL.faint;
        g.fillRect(x - 160 * k, y + 5 * k, 160 * k, 3);
        g.fillStyle = bar.warn ? COL.danger : bar.value > 0.8 ? COL.warn : COL.hud;
        g.fillRect(x - 160 * k, y + 5 * k, 160 * k * Math.min(1, bar.value), 3);
      }
      if (active) {
        g.fillStyle = COL.hud;
        g.fillRect(x - 230 * k, y - 10 * k, 4 * k, 13 * k);
      }
      y -= (bar ? 26 : 21) * k;
    };
    if (lo.flares) {
      const h = lo.flares.hud();
      line('FLARES [X]', h.ammo === Infinity ? '∞' : h.ammo, false, '', null);
    }
    if (lo.defense) {
      const h = lo.defense.hud();
      line(`${h.name} [V]`, h.ammo === Infinity ? '∞' : h.ammo, false, h.status, h.bar, h.status === 'ACTIVE' ? COL.friend : null);
    }
    for (let i = lo.secondaries.length - 1; i >= 0; i--) {
      const w = lo.secondaries[i];
      const h = w.hud();
      line(`${i + 1} ${h.name}`, h.ammo === Infinity ? '∞' : h.ammo, i === lo.index, h.status, h.bar);
    }
    if (lo.gun) {
      const h = lo.gun.hud();
      line(h.name, h.ammo === Infinity ? '∞' : h.ammo, true, h.status, h.bar);
    }
  }

  drawStatus(s, k) {
    const g = this.g;
    const p = s.player;
    const x = 24 * k;
    const y = this.h - 260 * k;
    const w = 190 * k;
    const hpf = p.hp / p.maxHp;
    this.text('HULL', x, y, 12 * k, COL.dim, 'left', 600, 'ui');
    g.fillStyle = COL.faint;
    g.fillRect(x + 40 * k, y - 9 * k, w, 8 * k);
    g.fillStyle = hpf < 0.3 ? COL.danger : hpf < 0.6 ? COL.warn : COL.hud;
    g.fillRect(x + 40 * k, y - 9 * k, w * hpf, 8 * k);
    this.text(`${Math.ceil(hpf * 100)}%`, x + 44 * k + w, y, 11 * k, COL.dim);
    if (p.shieldActive > 0) this.text('SHIELD ACTIVE', x + 40 * k, y + 16 * k, 11 * k, COL.friend);
    // Score / objective line.
    const hdr = s.mode?.hudLines?.(s) || [];
    let yy = 28 * k;
    for (const line of hdr) {
      this.text(line, 24 * k, yy, 14 * k, line.startsWith('!') ? COL.warn : COL.hud, 'left', 600, 'ui');
      yy += 18 * k;
    }
    // Wingmen.
    const wing = s.wingmen;
    if (wing?.length) {
      let wy = y + 36 * k;
      const order = ['COVER', 'ATTACK', 'REGROUP'];
      for (const wm of wing) {
        const alive = wm.alive;
        this.text(`${wm.callsign} ${alive ? order[wm.controller?.command ?? 2] : 'DOWN'}`, x, wy, 11 * k, alive ? COL.friend : COL.danger);
        wy += 15 * k;
      }
    }
  }

  drawRadar(s, k) {
    const g = this.g;
    const p = s.player;
    const R = 92 * k;
    const cx = 24 * k + R;
    const cy = this.h - 24 * k - R;
    g.fillStyle = 'rgba(0,14,8,0.45)';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = COL.faint;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.moveTo(cx + R * 0.5, cy);
    g.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.stroke();
    // Field of view wedge.
    g.fillStyle = 'rgba(141,255,181,0.06)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
    g.closePath();
    g.fill();
    _f.set(0, 0, -1).applyQuaternion(p.renderQuat);
    const hdg = Math.atan2(_f.x, -_f.z);
    const cos = Math.cos(-hdg);
    const sin = Math.sin(-hdg);
    const range = this.radarRange;
    const plot = (wx, wz, color, size, shape) => {
      const dx = wx - p.pos.x;
      const dz = wz - p.pos.z;
      let rx = (dx * cos - dz * sin) / range;
      let ry = (dx * sin + dz * cos) / range;
      const l = Math.hypot(rx, ry);
      if (l > 1) {
        if (shape !== 'edge') return;
        rx /= l;
        ry /= l;
      }
      g.fillStyle = color;
      const x = cx + rx * R;
      const y = cy + ry * R;
      if (shape === 'tri') {
        g.beginPath();
        g.moveTo(x, y - size);
        g.lineTo(x + size, y + size);
        g.lineTo(x - size, y + size);
        g.fill();
      } else g.fillRect(x - size / 2, y - size / 2, size, size);
    };
    const units = s.entities.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || u === p || !u.isTarget) continue;
      const friend = u.team === p.team;
      const col = friend ? COL.friend : u.objective ? COL.warn : u === s.targeting.current ? COL.white : COL.danger;
      plot(u.pos.x, u.pos.z, col, (u.radius > 30 ? 6 : 4) * k, u.isAir ? 'tri' : u.objective ? 'edge' : 'sq');
    }
    const ord = s.ordnance.active;
    for (let i = 0; i < ord.length; i++) {
      const o = ord[i];
      if (o.kind !== 'missile') continue;
      plot(o.pos.x, o.pos.z, o.target === p ? COL.danger : 'rgba(255,255,255,0.7)', 2 * k, 'sq');
    }
    if (s.mode?.waypoint) plot(s.mode.waypoint.x, s.mode.waypoint.z, COL.warn, 6 * k, 'edge');
    // Player.
    g.fillStyle = COL.hud;
    g.beginPath();
    g.moveTo(cx, cy - 6 * k);
    g.lineTo(cx + 4 * k, cy + 4 * k);
    g.lineTo(cx - 4 * k, cy + 4 * k);
    g.fill();
    this.text(`${(range / 1000).toFixed(0)} KM`, cx + R, cy + R - 2, 10 * k, COL.dim, 'right');
  }

  drawMessages(s, dt) {
    const k = this.ui;
    const cx = this.w / 2;
    let y = this.h * 0.22;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      m.t -= dt;
      if (m.t <= 0) {
        this.messages.splice(i, 1);
        continue;
      }
    }
    for (const m of this.messages) {
      this.g.globalAlpha = Math.min(1, m.t * 2);
      this.text(m.text, cx, y, 22 * k, m.color, 'center', 600, 'ui');
      y += 28 * k;
    }
    this.g.globalAlpha = 1;
    // Kill feed (top right).
    let fy = 30 * k;
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.feed.splice(i, 1);
        continue;
      }
    }
    for (const f of this.feed) {
      this.g.globalAlpha = Math.min(1, f.t);
      this.text(f.text, this.w - 24 * k, fy, 13 * k, COL.hud, 'right', 600, 'ui');
      fy += 18 * k;
    }
    this.g.globalAlpha = 1;
    // Radio subtitle.
    const r = this.radioLine;
    if (r) {
      r.t -= dt;
      if (r.t <= 0) this.radioLine = null;
      else {
        const y2 = this.h - 120 * k;
        this.g.globalAlpha = Math.min(1, r.t * 2);
        this.text(`${r.who}:`, cx, y2 - 18 * k, 12 * k, COL.friend, 'center');
        this.text(r.text, cx, y2, 16 * k, COL.white, 'center', 500, 'ui');
        this.g.globalAlpha = 1;
      }
    }
  }

  drawHitMarker(cx, cy, dt) {
    if (this.hitMarker <= 0) return;
    this.hitMarker -= dt;
    const g = this.g;
    const k = this.ui;
    g.strokeStyle = this.hitKill ? COL.danger : COL.white;
    g.lineWidth = this.hitKill ? 3 : 2;
    const a = 8 * k;
    const b = 16 * k;
    g.beginPath();
    g.moveTo(cx - a, cy - a);
    g.lineTo(cx - b, cy - b);
    g.moveTo(cx + a, cy - a);
    g.lineTo(cx + b, cy - b);
    g.moveTo(cx - a, cy + a);
    g.lineTo(cx - b, cy + b);
    g.moveTo(cx + a, cy + a);
    g.lineTo(cx + b, cy + b);
    g.stroke();
    g.lineWidth = 1.5;
  }

  drawNumbers(s, cam, dt) {
    const sp = this._sp;
    for (const n of this.numbers) {
      if (n.t <= 0) continue;
      n.t -= dt;
      n.y += dt * 12;
      this.project(cam, n.x, n.y, n.z, sp);
      if (sp.behind) continue;
      this.g.globalAlpha = Math.min(1, n.t * 2);
      this.text(String(Math.round(n.v)), sp.x, sp.y - (1 - n.t) * 30, n.kill ? 16 : 12, n.kill ? COL.danger : COL.warn, 'center');
    }
    this.g.globalAlpha = 1;
  }

  drawCruise(s) {
    const g = this.g;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const m = s.ordnance.cruise;
    g.strokeStyle = COL.white;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx - 60, cy);
    g.lineTo(cx - 15, cy);
    g.moveTo(cx + 15, cy);
    g.lineTo(cx + 60, cy);
    g.moveTo(cx, cy - 60);
    g.lineTo(cx, cy - 15);
    g.moveTo(cx, cy + 15);
    g.lineTo(cx, cy + 60);
    g.strokeRect(cx - 120, cy - 90, 240, 180);
    g.stroke();
    // Scanlines.
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < this.h; y += 4) g.fillRect(0, y, this.w, 1);
    this.text('CRUISE MISSILE — STEER WITH MOUSE / ARROWS', cx, 60, 16, COL.white, 'center', 600, 'ui');
    this.text(`ALT ${Math.round(m.pos.y)}   SPD ${Math.round(m.speed * 3.6)}   T-${Math.max(0, m.life).toFixed(1)}`, cx, 84, 13, COL.white, 'center');
    this.text('FIRE AGAIN TO DETONATE', cx, this.h - 60, 14, COL.warn, 'center', 600, 'ui');
  }
}
