import * as THREE from 'three';
import { bakeSounds, RECORDING_NAMES } from './SoundBake.js';

const RECORDINGS = import.meta.glob('../assets/sounds/*.{ogg,mp3,wav}', { eager: true, query: '?url', import: 'default' });

// Procedural audio with the Web Audio API. Every sound is synthesised at
// runtime (no audio files to download): jet engine and afterburner, guns,
// missiles, explosions, lock tones, missile-warning, radio squelch (with
// optional offline speech synthesis), UI clicks and an ambient music pad.
// World sounds are spatialised with PannerNodes relative to the camera.

const MAX_VOICES = 28;
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.voices = 0;
    this.loops = {};
    this.engine = null;
    this.camera = null;
    this.listenerPos = new THREE.Vector3();
    this.warnPhase = 0;
    this.lockState = 'off';
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.engineBus = ctx.createGain();
    this.radioBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.gameBus = ctx.createGain(); // everything in-game (muted on pause)
    this.sfx.connect(this.gameBus);
    this.engineBus.connect(this.gameBus);
    this.gameBus.connect(this.master);
    this.radioBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.uiBus.connect(this.master);
    // Shared white-noise buffer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Pre-rendered sound bank + outdoor reverb send.
    this.bank = bakeSounds(ctx);
    // The outdoor echo (convolution) is skipped on budget phones to save CPU.
    if (!this.lite) {
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.bank.ir;
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.32;
      this.reverb.connect(this.reverbGain).connect(this.gameBus);
    } else this.reverb = null;
    this.loadRecordings();
    this.setVolumes(this.settings);
    this._startTones();
    this._startMusic();
    if (this._engineWanted) this.startEngine();
  }

  setVolumes(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.engineBus.gain.setTargetAtTime(s.engineVolume, t, 0.05);
    this.radioBus.gain.setTargetAtTime(s.radioVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicVolume * 0.35, t, 0.2);
    this.uiBus.gain.setTargetAtTime(Math.min(1, s.sfxVolume) * 0.5, t, 0.05);
  }

  suspendGame(paused) {
    if (!this.ctx) return;
    this.gameBus.gain.setTargetAtTime(paused ? 0 : 1, this.ctx.currentTime, 0.05);
    if (paused) this.lockTone('off');
  }

  /** Real recordings in src/assets/sounds/ (bundled at build time) override the baked sounds. */
  async loadRecordings() {
    for (const [path, url] of Object.entries(RECORDINGS)) {
      const name = path.split('/').pop().replace(/\.(ogg|mp3|wav)$/, '');
      if (!RECORDING_NAMES.includes(name)) continue;
      try {
        const res = await fetch(url);
        this.bank[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
        if ((name === 'engine' || name === 'afterburner') && this.engine) this._restartEngineLoop();
      } catch {
        console.warn('Could not decode sound', path);
      }
    }
  }

  /** Play a bank sound (one-shot), optionally spatialised. */
  _play(name, pos, gain = 1, rate = 1, wet = 0.4) {
    const buf = this.bank?.[name];
    if (!buf) return false;
    const o = this._out(pos, gain, this.sfx, wet);
    if (!o) return true;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(o);
    src.start();
    this._done(o, buf.duration / rate + 0.1);
    return true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  /** Output node for a one-shot: spatialised if pos is given. Returns null if culled. */
  _out(pos, gain = 1, bus = this.sfx, wet = 0) {
    if (!this.ctx || this.voices >= MAX_VOICES) return null;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (wet > 0 && this.reverb) {
      const send = ctx.createGain();
      send.gain.value = wet * (pos ? Math.min(1.5, 0.5 + pos.distanceTo(this.listenerPos) / 1500) : 1);
      g.connect(send).connect(this.reverb);
    }
    if (pos) {
      const d = pos.distanceTo(this.listenerPos);
      if (d > 5000) return null;
      // Air absorbs high frequencies with distance.
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.max(700, 18000 * Math.exp(-d / 1400));
      g.connect(air);
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 60;
      p.rolloffFactor = 1.1;
      p.maxDistance = 6000;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      air.connect(p).connect(bus);
    } else g.connect(bus);
    this.voices++;
    return g;
  }

  _done(node, t) {
    setTimeout(() => {
      this.voices--;
      try {
        node.disconnect();
      } catch {
        /* already gone */
      }
    }, t * 1000 + 50);
  }

  _burst(out, { dur = 0.2, f0 = 1000, f1 = 200, q = 0.8, type = 'lowpass', vol = 1, attack = 0.002, delay = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const n = this._noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(out);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  _tone(out, { f0 = 440, f1 = f0, dur = 0.15, type = 'sine', vol = 0.5, attack = 0.005, delay = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ── Engine ───────────────────────────────────────────────────────────
  startEngine() {
    this._engineWanted = true;
    if (!this.ctx || this.engine) return;
    const ctx = this.ctx;
    const e = {};
    e.out = ctx.createGain();
    e.out.gain.value = 0;
    e.out.connect(this.engineBus);
    // Turbine whine.
    e.whine = ctx.createOscillator();
    e.whine.type = 'sawtooth';
    e.whineF = ctx.createBiquadFilter();
    e.whineF.type = 'bandpass';
    e.whineF.Q.value = 6;
    e.whineG = ctx.createGain();
    e.whine.connect(e.whineF).connect(e.whineG).connect(e.out);
    // Roar: low-passed noise.
    e.roar = this._noiseSrc();
    e.roarF = ctx.createBiquadFilter();
    e.roarF.type = 'lowpass';
    e.roarG = ctx.createGain();
    e.roar.connect(e.roarF).connect(e.roarG).connect(e.out);
    // Afterburner rumble.
    e.ab = this._noiseSrc();
    e.abF = ctx.createBiquadFilter();
    e.abF.type = 'lowpass';
    e.abF.frequency.value = 220;
    e.abG = ctx.createGain();
    e.abG.gain.value = 0;
    e.ab.connect(e.abF).connect(e.abG).connect(e.out);
    // Wind rush with speed.
    e.wind = this._noiseSrc();
    e.windF = ctx.createBiquadFilter();
    e.windF.type = 'bandpass';
    e.windF.Q.value = 0.6;
    e.windG = ctx.createGain();
    e.wind.connect(e.windF).connect(e.windG).connect(e.out);
    for (const s of [e.whine, e.roar, e.ab, e.wind]) s.start();
    e.out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    this.engine = e;
    this._restartEngineLoop();
  }

  /** Looping turbine (baked or a real recording) and afterburner layers. */
  _restartEngineLoop() {
    const e = this.engine;
    if (!e || !this.bank) return;
    for (const k of ['loop', 'abLoop']) {
      if (e[k]) {
        e[k].stop();
        e[k] = null;
      }
    }
    const ctx = this.ctx;
    e.loop = ctx.createBufferSource();
    e.loop.buffer = this.bank.engine;
    e.loop.loop = true;
    e.loopG ||= ctx.createGain();
    e.loopG.gain.value = 0.5;
    e.loop.connect(e.loopG).connect(e.out);
    e.loop.start();
    if (this.bank.afterburner) {
      e.abLoop = ctx.createBufferSource();
      e.abLoop.buffer = this.bank.afterburner;
      e.abLoop.loop = true;
      e.abLoopG ||= ctx.createGain();
      e.abLoopG.gain.value = 0;
      e.abLoop.connect(e.abLoopG).connect(e.out);
      e.abLoop.start();
    }
  }

  stopEngine() {
    this._engineWanted = false;
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    const t = this.ctx.currentTime;
    e.out.gain.setTargetAtTime(0, t, 0.1);
    setTimeout(() => {
      for (const s of [e.whine, e.roar, e.ab, e.wind, e.loop, e.abLoop]) s?.stop();
      e.out.disconnect();
    }, 600);
  }

  /** Per-frame: listener, engine, warning tones. */
  update(s) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const cam = s.camera;
    this.listenerPos.copy(cam.position);
    const L = ctx.listener;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.position.x, t, 0.02);
      L.positionY.setTargetAtTime(cam.position.y, t, 0.02);
      L.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      L.forwardX.value = _f.x;
      L.forwardY.value = _f.y;
      L.forwardZ.value = _f.z;
      L.upX.value = _u.x;
      L.upY.value = _u.y;
      L.upZ.value = _u.z;
    }
    const p = s.player;
    const e = this.engine;
    if (e) {
      const f = p.flight;
      const alive = p.alive ? 1 : 0;
      const thr = f.throttle;
      const cockpit = s.cameraRig.mode === 'cockpit' ? 0.55 : 1;
      e.whine.frequency.setTargetAtTime(380 + thr * 900 + f.afterburner * 200, t, 0.1);
      e.whineF.frequency.setTargetAtTime(900 + thr * 1800, t, 0.1);
      e.whineG.gain.setTargetAtTime((0.025 + thr * 0.05) * alive, t, 0.1);
      e.roarF.frequency.setTargetAtTime((300 + thr * 900) * cockpit, t, 0.1);
      e.roarG.gain.setTargetAtTime((0.12 + thr * 0.25) * alive, t, 0.1);
      e.abG.gain.setTargetAtTime(f.afterburner * (e.abLoop ? 0.25 : 0.7) * alive, t, 0.08);
      if (e.loop) {
        e.loop.playbackRate.setTargetAtTime(0.7 + thr * 0.45 + f.afterburner * 0.1, t, 0.15);
        e.loopG.gain.setTargetAtTime((0.25 + thr * 0.55 + f.afterburner * 0.3) * alive, t, 0.1);
      }
      if (e.abLoop) e.abLoopG.gain.setTargetAtTime(f.afterburner * 0.9 * alive, t, 0.08);
      const sp = Math.min(1, f.speed / 380);
      e.windF.frequency.setTargetAtTime(500 + sp * 2500, t, 0.2);
      e.windG.gain.setTargetAtTime((0.02 + sp * sp * 0.2) * (f.controls.brake ? 1.8 : 1) * alive, t, 0.15);
    }
    // Jets roaring past the camera.
    if (this.bank?.flyby) {
      const air = s.entities.air;
      for (let i = 0; i < air.length; i++) {
        const u = air[i];
        if (u === p || !u.alive || u.kind !== 'air' || !u.flight) continue;
        const d = u.pos.distanceTo(cam.position);
        if (d > 260 || t - (u._flybyAt || -99) < 6) continue;
        const rel = u.vel.distanceTo(p.vel);
        if (rel < 120) continue;
        u._flybyAt = t;
        this._play('flyby', u.pos, 2.2, 0.8 + Math.min(0.5, rel / 900), 0.5);
      }
    }
    // Missile warning (fast) / lock warning (slow) beeps.
    const w = s.warnings;
    let mode = 0;
    if (w.incoming.length && p.alive) mode = 2;
    else if (w.lockLevel > 0.05 && p.alive) mode = 1;
    const tg = this.warnG.gain;
    if (mode === 0) tg.setTargetAtTime(0, t, 0.02);
    else {
      const rate = mode === 2 ? 9 : w.lockLevel >= 1 ? 4 : 2;
      const on = (t * rate) % 1 < 0.5;
      this.warn.frequency.setTargetAtTime(mode === 2 ? (((t * rate) | 0) % 2 ? 1700 : 1300) : 1000, t, 0.005);
      tg.setTargetAtTime(on ? 0.12 : 0, t, 0.004);
    }
    if (!p.loadout?.current || p.loadout.current.def.class !== 'MissileWeapon') this.lockTone('off');
  }

  // ── Lock tones (persistent oscillators) ─────────────────────────────
  _startTones() {
    const ctx = this.ctx;
    this.lock = ctx.createOscillator();
    this.lock.type = 'square';
    this.lockAM = ctx.createGain();
    this.lockG = ctx.createGain();
    this.lockG.gain.value = 0;
    this.lockLFO = ctx.createOscillator();
    this.lockLFO.frequency.value = 28;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    this.lockLFO.connect(lfoDepth).connect(this.lockAM.gain);
    this.lockAM.gain.value = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    this.lock.connect(this.lockAM).connect(f).connect(this.lockG).connect(this.sfx);
    this.lock.start();
    this.lockLFO.start();
    this.warn = ctx.createOscillator();
    this.warn.type = 'square';
    this.warnG = ctx.createGain();
    this.warnG.gain.value = 0;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 3000;
    this.warn.connect(wf).connect(this.warnG).connect(this.sfx);
    this.warn.start();
  }

  /** state: off | search | locking (IR growl) | radar (beeps) | locked */
  lockTone(state) {
    if (!this.ctx || state === this.lockState) return;
    this.lockState = state;
    const t = this.ctx.currentTime;
    const g = this.lockG.gain;
    if (state === 'locking') {
      this.lock.frequency.setTargetAtTime(420, t, 0.02);
      this.lockLFO.frequency.setTargetAtTime(28, t, 0.02);
      g.setTargetAtTime(0.06, t, 0.02);
    } else if (state === 'radar') {
      this.lock.frequency.setTargetAtTime(900, t, 0.02);
      this.lockLFO.frequency.setTargetAtTime(5, t, 0.02);
      g.setTargetAtTime(0.05, t, 0.02);
    } else if (state === 'locked') {
      this.lock.frequency.setTargetAtTime(1500, t, 0.01);
      this.lockLFO.frequency.setTargetAtTime(0.01, t, 0.01);
      g.setTargetAtTime(0.06, t, 0.01);
    } else if (state === 'search') {
      this.lock.frequency.setTargetAtTime(300, t, 0.02);
      this.lockLFO.frequency.setTargetAtTime(14, t, 0.02);
      g.setTargetAtTime(0.012, t, 0.05);
    } else g.setTargetAtTime(0, t, 0.02);
  }

  lockAcquired() {
    const o = this._out(null, 0.35);
    if (!o) return;
    this._tone(o, { f0: 1600, dur: 0.07, type: 'square', vol: 0.3 });
    this._tone(o, { f0: 2000, dur: 0.07, type: 'square', vol: 0.3, delay: 0.09 });
    this._done(o, 0.3);
  }

  // ── Guns ─────────────────────────────────────────────────────────────
  gunLoop(id, sound, spin) {
    if (!this.ctx) return;
    let l = this.loops[id];
    const t = this.ctx.currentTime;
    if (!l && this.bank?.[sound] && sound === 'gun20') {
      // Rendered (or recorded) rotary-cannon loop; spin-up raises the pitch.
      l = this.loops[id] = { g: this.ctx.createGain(), sample: true };
      l.src = this.ctx.createBufferSource();
      l.src.buffer = this.bank.gun20;
      l.src.loop = true;
      l.g.gain.value = 0;
      const send = this.ctx.createGain();
      send.gain.value = 0.35;
      l.src.connect(l.g).connect(this.sfx);
      if (this.reverb) l.g.connect(send).connect(this.reverb);
      l.src.start();
    }
    if (l?.sample) {
      l.src.playbackRate.setTargetAtTime(0.55 + spin * 0.45, t, 0.04);
      l.g.gain.setTargetAtTime(0.75 * spin, t, 0.02);
      l.active = true;
      return;
    }
    if (!l) {
      const ctx = this.ctx;
      l = this.loops[id] = {};
      l.src = this._noiseSrc();
      l.f = ctx.createBiquadFilter();
      l.f.type = 'bandpass';
      l.f.Q.value = 0.9;
      l.f.frequency.value = sound === 'gun20' ? 900 : 600;
      l.am = ctx.createGain();
      l.am.gain.value = 0.5;
      l.lfo = ctx.createOscillator();
      l.lfo.type = 'square';
      l.lfoG = ctx.createGain();
      l.lfoG.gain.value = 0.5;
      l.lfo.connect(l.lfoG).connect(l.am.gain);
      l.g = ctx.createGain();
      l.g.gain.value = 0;
      l.body = ctx.createOscillator();
      l.body.type = 'sawtooth';
      l.bodyG = ctx.createGain();
      l.bodyG.gain.value = 0.18;
      l.body.connect(l.bodyG).connect(l.am);
      l.src.connect(l.f).connect(l.am).connect(l.g).connect(this.sfx);
      l.src.start();
      l.lfo.start();
      l.body.start();
    }
    const rate = 60 * spin;
    l.lfo.frequency.setTargetAtTime(Math.max(5, rate), t, 0.03);
    l.body.frequency.setTargetAtTime(Math.max(20, rate), t, 0.03);
    l.g.gain.setTargetAtTime(0.5 * spin, t, 0.02);
    l.active = true;
  }

  gunStop(id) {
    const l = this.loops[id];
    if (!l || !l.active || !this.ctx) return;
    l.active = false;
    l.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    // Barrel spin-down whine.
    const o = this._out(null, 0.12);
    if (o) {
      this._tone(o, { f0: 700, f1: 120, dur: 0.6, type: 'triangle', vol: 0.4 });
      this._done(o, 0.7);
    }
  }

  shot(sound, pos) {
    if (sound !== 'plasma' && this._play(sound === 'gun30' ? 'gun30' : sound === 'aa' ? 'aa' : 'gunEnemy', pos, pos ? 1.6 : 0.9, 0.92 + Math.random() * 0.16, 0.45)) return;
    const o = this._out(pos, pos ? 1.4 : 0.8);
    if (!o) return;
    switch (sound) {
      case 'gun30':
        this._burst(o, { dur: 0.18, f0: 2400, f1: 200, vol: 0.9 });
        this._tone(o, { f0: 140, f1: 45, dur: 0.18, vol: 0.9 });
        break;
      case 'plasma':
        this._tone(o, { f0: 1400, f1: 180, dur: 0.25, type: 'sawtooth', vol: 0.25 });
        this._burst(o, { dur: 0.15, f0: 4000, f1: 800, type: 'bandpass', vol: 0.3 });
        break;
      case 'aa':
        this._burst(o, { dur: 0.12, f0: 1800, f1: 300, vol: 0.8 });
        break;
      default:
        this._burst(o, { dur: 0.07, f0: 3000, f1: 600, type: 'bandpass', vol: 0.6 });
    }
    this._done(o, 0.4);
  }

  overheat() {
    const o = this._out(null, 0.4);
    if (!o) return;
    this._burst(o, { dur: 0.8, f0: 6000, f1: 2000, type: 'highpass', vol: 0.4, attack: 0.05 });
    this._done(o, 0.9);
  }

  railCharge(level) {
    if (!this.ctx) return;
    let l = this.loops.rail;
    const t = this.ctx.currentTime;
    if (!l) {
      const ctx = this.ctx;
      l = this.loops.rail = { o: ctx.createOscillator(), g: ctx.createGain() };
      l.o.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 4;
      f.frequency.value = 2000;
      l.g.gain.value = 0;
      l.o.connect(f).connect(l.g).connect(this.sfx);
      l.o.start();
    }
    l.o.frequency.setTargetAtTime(200 + level * 2200, t, 0.03);
    l.g.gain.setTargetAtTime(level > 0 ? 0.08 + level * 0.12 : 0, t, 0.03);
  }

  railFire(charge) {
    this.railCharge(0);
    const o = this._out(null, 1);
    if (!o) return;
    this._tone(o, { f0: 3000, f1: 80, dur: 0.5, type: 'sawtooth', vol: 0.5 * (0.5 + charge) });
    this._burst(o, { dur: 0.6, f0: 5000, f1: 100, vol: 0.8 });
    this._done(o, 0.7);
  }

  laser(on) {
    if (!this.ctx) return;
    let l = this.loops.laser;
    const t = this.ctx.currentTime;
    if (!l) {
      const ctx = this.ctx;
      l = this.loops.laser = { o: ctx.createOscillator(), o2: ctx.createOscillator(), g: ctx.createGain() };
      l.o.type = 'sawtooth';
      l.o.frequency.value = 180;
      l.o2.type = 'square';
      l.o2.frequency.value = 181.5;
      l.g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      l.o.connect(f);
      l.o2.connect(f);
      f.connect(l.g).connect(this.sfx);
      l.o.start();
      l.o2.start();
    }
    l.g.gain.setTargetAtTime(on ? 0.12 : 0, t, 0.03);
  }

  // ── Ordnance ─────────────────────────────────────────────────────────
  missileLaunch(kind, pos) {
    if (this._play(kind === 'missileHeavy' || kind === 'swarm' ? 'missileHeavy' : 'missile', pos, pos ? 1.8 : 1, 0.94 + Math.random() * 0.12, 0.5)) return;
    const o = this._out(pos, pos ? 1.6 : 0.8);
    if (!o) return;
    const big = kind === 'missileHeavy';
    this._burst(o, { dur: big ? 1.6 : 1.1, f0: 400, f1: 3000, type: 'bandpass', q: 1.2, vol: 0.9, attack: 0.03 });
    this._burst(o, { dur: big ? 1.2 : 0.6, f0: 1200, f1: 100, vol: 0.7 });
    this._done(o, 1.8);
  }

  rocket(pos) {
    if (this._play('rocket', pos, pos ? 1.3 : 0.6, 0.9 + Math.random() * 0.2, 0.3)) return;
    const o = this._out(pos, pos ? 1.2 : 0.5);
    if (!o) return;
    this._burst(o, { dur: 0.35, f0: 600, f1: 2500, type: 'bandpass', q: 1.5, vol: 0.7, attack: 0.01 });
    this._done(o, 0.5);
  }

  explosion(pos, size = 10) {
    const name = size < 12 ? 'explosionSmall' : size < 30 ? 'explosionMedium' : 'explosionLarge';
    if (this._play(name, pos, 2.4 + Math.min(1, size / 40) * 2, 0.85 + Math.random() * 0.3, 0.8)) return;
    const big = Math.min(1, size / 40);
    const o = this._out(pos, 2.2 + big * 2);
    if (!o) return;
    const dur = 0.8 + big * 1.8;
    this._burst(o, { dur, f0: 2500 + big * 2000, f1: 60, vol: 1, attack: 0.004 });
    this._tone(o, { f0: 90 - big * 40, f1: 28, dur: dur * 0.8, vol: 1 });
    this._done(o, dur + 0.2);
  }

  bombRelease() {
    const o = this._out(null, 0.4);
    if (!o) return;
    this._burst(o, { dur: 0.12, f0: 800, f1: 200, vol: 0.8 });
    this._tone(o, { f0: 220, f1: 90, dur: 0.15, type: 'square', vol: 0.2 });
    this._done(o, 0.3);
  }

  countermeasure(type) {
    const o = this._out(null, 0.5);
    if (!o) return;
    for (let i = 0; i < 3; i++) {
      this._tone(o, { f0: type === 'flare' ? 500 : 900, f1: 120, dur: 0.08, type: 'square', vol: 0.25, delay: i * 0.1 });
    }
    this._burst(o, { dur: 0.4, f0: 3000, f1: 800, type: 'highpass', vol: 0.3 });
    this._done(o, 0.6);
  }

  emp(pos) {
    const o = this._out(pos, 2);
    if (!o) return;
    this._tone(o, { f0: 60, f1: 2000, dur: 0.4, type: 'sawtooth', vol: 0.5 });
    this._tone(o, { f0: 2000, f1: 40, dur: 1.2, type: 'sine', vol: 0.7, delay: 0.35 });
    this._burst(o, { dur: 1.4, f0: 8000, f1: 200, vol: 0.5, delay: 0.3 });
    this._done(o, 1.8);
  }

  shield() {
    const o = this._out(null, 0.5);
    if (!o) return;
    this._tone(o, { f0: 120, f1: 900, dur: 0.6, type: 'triangle', vol: 0.5 });
    this._done(o, 0.7);
  }

  ecm() {
    const o = this._out(null, 0.4);
    if (!o) return;
    this._burst(o, { dur: 0.9, f0: 4000, f1: 1500, type: 'bandpass', q: 3, vol: 0.5 });
    this._done(o, 1);
  }

  droneDeploy() {
    const o = this._out(null, 0.4);
    if (!o) return;
    this._tone(o, { f0: 300, f1: 1200, dur: 0.3, type: 'square', vol: 0.2 });
    this._tone(o, { f0: 1200, dur: 0.1, type: 'square', vol: 0.2, delay: 0.32 });
    this._done(o, 0.5);
  }

  // ── Feedback ─────────────────────────────────────────────────────────
  hitConfirm() {
    const now = performance.now();
    if (now - (this._lastHit || 0) < 60) return;
    this._lastHit = now;
    const o = this._out(null, 0.25);
    if (!o) return;
    this._tone(o, { f0: 2400, f1: 1800, dur: 0.05, type: 'triangle', vol: 0.5 });
    this._done(o, 0.1);
  }

  playerHit() {
    const now = performance.now();
    if (now - (this._lastPHit || 0) < 90) return;
    this._lastPHit = now;
    const o = this._out(null, 0.7);
    if (!o) return;
    this._burst(o, { dur: 0.15, f0: 1500, f1: 200, vol: 0.9 });
    this._tone(o, { f0: 160, f1: 60, dur: 0.12, type: 'square', vol: 0.3 });
    this._done(o, 0.25);
  }

  click() {
    const o = this._out(null, 0.25, this.uiBus);
    if (!o) return;
    this._tone(o, { f0: 1800, f1: 1200, dur: 0.03, type: 'square', vol: 0.2 });
    this._done(o, 0.1);
  }

  purchase() {
    const o = this._out(null, 0.4, this.uiBus);
    if (!o) return;
    [880, 1320, 1760].forEach((f, i) => this._tone(o, { f0: f, dur: 0.12, type: 'triangle', vol: 0.3, delay: i * 0.07 }));
    this._done(o, 0.4);
  }

  denied() {
    const o = this._out(null, 0.4, this.uiBus);
    if (!o) return;
    this._tone(o, { f0: 220, dur: 0.18, type: 'square', vol: 0.2 });
    this._done(o, 0.3);
  }

  // ── Radio ────────────────────────────────────────────────────────────
  radio(text, urgent = false) {
    if (!this.ctx) return;
    const o = this._out(null, 0.6, this.radioBus);
    if (o) {
      // Squelch open, a little static, squelch close.
      this._burst(o, { dur: 0.08, f0: 2500, f1: 1800, type: 'bandpass', q: 2, vol: 0.6 });
      const len = Math.min(3, 0.4 + text.length * 0.035);
      this._burst(o, { dur: len, f0: 2200, f1: 1600, type: 'bandpass', q: 6, vol: 0.05, attack: 0.05 });
      this._tone(o, { f0: 1200, dur: 0.05, type: 'square', vol: 0.08, delay: len });
      this._done(o, len + 0.2);
    }
    if (this.settings.voice && window.speechSynthesis) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.startsWith('en'));
        if (voices.length) u.voice = voices[0];
        u.rate = urgent ? 1.3 : 1.12;
        u.pitch = 0.9;
        u.volume = this.settings.radioVolume * this.settings.masterVolume;
        if (urgent) speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch {
        /* speech not available */
      }
    }
  }

  // ── Music: slow generative pad ──────────────────────────────────────
  _startMusic() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    f.Q.value = 0.7;
    out.connect(f).connect(this.musicBus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 300;
    lfo.connect(lfoG).connect(f.frequency);
    lfo.start();
    const chords = [
      [110, 164.8, 220, 261.6],
      [98, 146.8, 196, 246.9],
      [87.3, 130.8, 174.6, 220],
      [103.8, 155.6, 207.7, 261.6],
    ];
    const oscs = [];
    for (let i = 0; i < 4; i++) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        o.connect(g).connect(out);
        o.start();
        oscs.push({ o, i });
      }
    }
    let c = 0;
    const next = () => {
      const t = ctx.currentTime;
      const ch = chords[c++ % chords.length];
      for (const { o, i } of oscs) o.frequency.setTargetAtTime(ch[i], t, 2.5);
      this._musicTimer = setTimeout(next, 9000);
    };
    next();
  }

  stopLoops() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const l of Object.values(this.loops)) {
      if (l.g) l.g.gain.setTargetAtTime(0, t, 0.03);
      l.active = false;
    }
    this.lockTone('off');
    if (this.warnG) this.warnG.gain.setTargetAtTime(0, t, 0.02);
    if (window.speechSynthesis) speechSynthesis.cancel();
  }
}
