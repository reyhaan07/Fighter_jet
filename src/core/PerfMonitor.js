// Frame-time statistics, the F3 overlay and adaptive resolution.
//
// Adaptive quality: if the frame rate stays below target, the render scale
// drops in 10 % steps (down to 50 %), then effect density is reduced. When the
// game holds target comfortably for a while, the scale creeps back up.

const WINDOW = 120;

export class PerfMonitor {
  constructor(game, el) {
    this.game = game;
    this.el = el;
    this.visible = !!game.settings.showFps;
    el.hidden = !this.visible;
    this.times = new Float32Array(WINDOW);
    this.idx = 0;
    this.filled = 0;
    this.stepMs = 0;
    this.renderMs = 0;
    this.stepAccum = 0;
    this.stepCount = 0;
    this.lastText = 0;
    this.lowTime = 0;
    this.goodTime = 0;
    this.cooldown = 3;
    this.blockRaise = 0;
    this.lastChange = 0;
    this.fps = 0;
    this.avgMs = 0;
    this.maxMs = 0;
    this.events = [];
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    this.game.settings.showFps = this.visible;
  }

  beginStep() {
    this._t0 = performance.now();
  }

  endStep() {
    this.stepAccum += performance.now() - this._t0;
    this.stepCount++;
  }

  frame(dt, renderMs) {
    this.times[this.idx] = dt * 1000;
    this.idx = (this.idx + 1) % WINDOW;
    this.filled = Math.min(WINDOW, this.filled + 1);
    this.renderMs = this.renderMs * 0.9 + renderMs * 0.1;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < this.filled; i++) {
      sum += this.times[i];
      if (this.times[i] > max) max = this.times[i];
    }
    this.avgMs = sum / this.filled;
    this.maxMs = max;
    this.fps = 1000 / this.avgMs;
    if (this.stepCount) {
      this.stepMs = this.stepMs * 0.8 + (this.stepAccum / this.stepCount) * 0.2;
      this.stepAccum = 0;
      this.stepCount = 0;
    }
    this._adapt(dt);
    const now = performance.now();
    if (this.visible && now - this.lastText > 250) {
      this.lastText = now;
      this._draw();
    }
  }

  _adapt(dt) {
    const g = this.game;
    const s = g.session;
    if (!g.settings.adaptive || !s || this.filled < WINDOW) return;
    this.cooldown -= dt;
    this.blockRaise -= dt;
    const target = this.autoCap || g.settings.targetFps || 60;
    const r = g.renderer;
    const preset = g.quality.renderScale;
    if (this.fps < target * 0.92) {
      this.lowTime += dt;
      this.goodTime = 0;
    } else if (this.fps > target * 0.97) {
      this.goodTime += dt;
      this.lowTime = 0;
    }
    if (this.cooldown > 0) return;
    if (this.lowTime > 2) {
      if (r.scale > 0.5 + 1e-3) {
        r.setScale(Math.max(0.5, Math.round((r.scale - 0.1) * 100) / 100));
        this._log(`render scale → ${Math.round(r.scale * 100)}%`);
        if (performance.now() - this.lastChange < 8000) this.blockRaise = 60;
      } else if (s.fx.q > 0.3) {
        s.fx.q *= 0.75;
        this._log(`effects density → ${Math.round(s.fx.q * 100)}%`);
      } else if (!this.autoCap && (g.settings.targetFps || 60) > 30) {
        // Still can't hold the target at the lowest settings: a steady 30 FPS
        // feels far smoother than a frame rate jumping between 35 and 50.
        this.autoCap = 30;
        g.loop.fpsCap = 30;
        this._log('frame rate locked to a steady 30 FPS');
      }
      this.lastChange = performance.now();
      this.lowTime = 0;
      this.cooldown = 2.5;
      this.filled = 0;
    } else if (this.goodTime > 12 && this.blockRaise <= 0 && r.scale < preset - 1e-3) {
      r.setScale(Math.min(preset, Math.round((r.scale + 0.05) * 100) / 100));
      this._log(`render scale → ${Math.round(r.scale * 100)}%`);
      this.lastChange = performance.now();
      this.goodTime = 0;
      this.cooldown = 4;
      this.filled = 0;
    }
  }

  _log(msg) {
    this.events.push(msg);
    if (this.events.length > 3) this.events.shift();
    console.info('[perf]', msg);
  }

  _draw() {
    const g = this.game;
    const s = g.session;
    const info = g.renderer.renderer.info;
    const mem = performance.memory;
    const lines = [
      `FPS ${this.fps.toFixed(0).padStart(3)}   frame ${this.avgMs.toFixed(1)} ms (max ${this.maxMs.toFixed(1)})`,
      `sim ${this.stepMs.toFixed(2)} ms/step   cpu render ${this.renderMs.toFixed(2)} ms`,
      `draw calls ${info.render.calls}   tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `geometries ${info.memory.geometries}   textures ${info.memory.textures}   programs ${info.programs?.length ?? 0}`,
      `quality ${g.quality.label}   scale ${Math.round(g.renderer.scale * 100)}%   ${g.settings.adaptive ? 'adaptive' : 'fixed'}`,
    ];
    if (mem) lines.push(`JS heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB`);
    if (s) {
      let enemies = 0;
      for (const u of s.entities.units) if (u.alive && u.team === 1) enemies++;
      lines.push(`units ${s.entities.units.length} (enemies ${enemies})   bullets ${s.bullets.count}   ordnance ${s.ordnance.active.length}`);
      lines.push(`AI ${s.ai.stats.mode} (${s.ai.stats.air} air, ${s.ai.stats.missiles} msl${s.ai.stats.mode === 'worker' ? `, ${(s.ai.stats.latency * 1000).toFixed(0)} ms` : ''})   instanced ${s.instanced.visible}`);
      lines.push(`particles emitted ${s.fx.fire.emitted + s.fx.smoke.emitted}`);
    }
    for (const e of this.events) lines.push('· ' + e);
    this.el.textContent = lines.join('\n');
  }
}
