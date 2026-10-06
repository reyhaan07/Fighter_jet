import { Loop } from '../core/Loop.js';
import { Input } from '../core/Input.js';
import { Save } from '../core/Save.js';
import { Audio } from '../core/Audio.js';
import { PerfMonitor } from '../core/PerfMonitor.js';
import { Renderer } from '../world/Renderer.js';
import { HangarScene } from '../world/HangarScene.js';
import { PRESETS, detectPreset } from '../config/quality.js';
import { LEVELS, levelById } from '../config/campaign.js';
import { loadSettings } from './Settings.js';
import { Session } from './Session.js';
import { Hud } from '../ui/Hud.js';
import { Daily } from './Daily.js';
import { Menus } from '../ui/Menus.js';
import { Mission } from './modes/Mission.js';
import { Survival } from './modes/Survival.js';
import { FreeFlight } from './modes/FreeFlight.js';

// Application shell: owns the renderer, input, audio, save data, menus and
// the main loop, and swaps Sessions (levels) in and out. Every Session's GPU
// resources are disposed when it ends; the menu hangar is rebuilt on return.

export class Game {
  constructor({ canvas, hudCanvas, ui }) {
    this.canvas = canvas;
    this.hudCanvas = hudCanvas;
    this.ui = ui;
    this.save = new Save();
    this.settings = loadSettings(this.save);
    this.detected = detectPreset();
    this.quality = this.resolveQuality();
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas, this.settings.bindings);
    this.audio = new Audio(this.settings);
    this.hud = new Hud(hudCanvas, this.settings);
    this.daily = new Daily(this.save);
    this.daily.onComplete = (t) => {
      this.hud.message(`DAILY TASK DONE: ${t.text.toUpperCase()}`, 3.5, '#ffcf5a');
      this.audio.purchase();
    };
    this.perf = new PerfMonitor(this, document.getElementById('perf'));
    this.menus = new Menus(this);
    this.session = null;
    this.hangar = null;
    this.paused = false;
    this.loop = new Loop({
      fpsCap: this.settings.targetFps,
      onStep: (dt) => {
        if (!this.session || this.paused) return;
        this.perf.beginStep();
        this.session.step(dt);
        this.perf.endStep();
      },
      onRender: (dt, alpha) => {
        const t0 = performance.now();
        this.input.pollGamepad();
        this.input.flying = !!this.session && !this.paused;
        if (this.session) {
          if (this.paused) {
            this.renderer.render(this.session.renderTime);
            this.hud.draw(this.session, 0);
          } else {
            this.session.render(dt, alpha);
            if (this.input.pressed('pause')) this.pause();
          }
        } else this.hangar?.render(dt);
        this.perf.frame(dt, performance.now() - t0);
      },
    });
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        if (!this.session) this.perf.toggle();
      }
    });
    canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.session && !this.paused && this.settings.mouseAim) this.input.requestPointerLock();
    });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });
    // Releasing the mouse (Esc in pointer lock) pauses the game.
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.session && !this.paused && !this.session.ended && this._wantLock) this.pause();
      this._wantLock = !!document.pointerLockElement;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session && !this.paused) this.pause();
    });
  }

  resolveQuality() {
    const forced = new URLSearchParams(location.search).get('quality');
    const id = PRESETS[forced] ? forced : this.settings.quality === 'auto' ? this.detected.preset : this.settings.quality;
    const q = { ...PRESETS[id] };
    if (this.settings.renderScale) q.renderScale = this.settings.renderScale;
    return q;
  }

  persist() {
    this.settings.bindings = this.input.bindings;
    this.save.data.settings = this.settings;
    this.save.write();
  }

  /** Apply settings that can change live. rebuild = quality preset changed. */
  applySettings(rebuild = false) {
    const s = this.settings;
    this.audio.setVolumes(s);
    this.loop.fpsCap = s.targetFps || 0;
    if (rebuild || this.settings.renderScale !== this._lastScaleSetting) {
      this._lastScaleSetting = this.settings.renderScale;
      this.quality = this.resolveQuality();
      if (this.session) this.renderer.configure(this.quality, this.session.scene, this.session.camera);
      else this.hangar?.activate();
    }
    if (this.session?.controller) {
      this.session.controller.mouseAim = s.mouseAim;
      this.session.controller.autoLevel = s.autoLevel;
    }
    this.persist();
  }

  async boot() {
    this.hangar = new HangarScene(this);
    this.hangar.activate();
    this.menus.show('main', false);
    if (this.daily.loginAvailable) this.menus.show('daily');
    this.loop.start();
    // Dev shortcuts: ?free, ?survival, ?mission=m3, ?stress, ?duel
    const qs = new URLSearchParams(location.search);
    if (qs.has('stress') || qs.has('duel') || qs.has('free')) await this.launch({ kind: 'free', stress: qs.has('stress'), duel: qs.has('duel') });
    else if (qs.has('survival')) await this.launch({ kind: 'survival' });
    else if (qs.get('mission')) await this.launch({ kind: 'mission', id: qs.get('mission') });
  }

  /** Start a mode from the menus. what = { kind: 'mission'|'survival'|'free', id? } */
  async launch(what) {
    if (!what) return;
    const lo = this.save.data.loadout;
    let mission;
    if (what.kind === 'mission') {
      const def = levelById(what.id) || LEVELS[0];
      mission = { id: def.id, def, mode: Mission, env: def.env, start: def.start, loadout: lo };
    } else if (what.kind === 'survival') {
      mission = { id: 'survival', mode: Survival, env: { time: 'day', terrain: 'islands', seed: 5 + Math.floor(Math.random() * 1000), cloudiness: 1 }, start: { x: 0, z: 4000, alt: 1600, yaw: 0 }, loadout: lo, wingmen: 1 };
    } else {
      mission = { id: 'free', mode: FreeFlight, stress: what.stress, duel: what.duel, env: { time: 'day', terrain: 'islands', seed: 7 }, start: { x: 0, z: 6000, alt: 1200, yaw: 0 }, loadout: lo, infiniteAmmo: !what.stress && !what.duel };
    }
    mission.retry = what;
    this.menus.loadingText = what.kind === 'mission' ? `Mission: ${mission.def.name}` : what.kind === 'survival' ? 'Survival' : 'Training range';
    this.menus.show('loading', false);
    // Let the loading screen paint before the heavy build.
    await new Promise((r) => setTimeout(r, 30));
    await this.startSession(mission);
    this.menus.hide();
    this.audio.unlock();
    if (this.settings.mouseAim) this.input.requestPointerLock();
  }

  async startSession(mission) {
    this.lastMission = mission;
    this.endSession();
    if (this.hangar) {
      this.hangar.dispose();
      this.hangar = null;
    }
    this.quality = this.resolveQuality();
    this.paused = false;
    this.loop.paused = false;
    this.session = new Session(this, mission);
    await this.session.build();
    this.input.flush();
    this.audio.startEngine();
  }

  async restartSession() {
    if (!this.lastMission) return;
    const retry = this.lastMission.retry;
    this.menus.hide();
    await this.launch(retry);
  }

  endSession() {
    if (!this.session) return;
    this.session.ended = true;
    this.session.dispose();
    this.session = null;
    this.audio.stopLoops();
    this.audio.stopEngine();
    this.hud.clear();
    this.loop.timeScale = 1;
  }

  pause() {
    if (!this.session || this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
    this.loop.paused = true;
    this.audio.suspendGame(true);
    this.input.exitPointerLock();
    this.menus.stack.length = 0;
    this.menus.show('pause', false);
  }

  resume() {
    if (!this.session) return;
    this.paused = false;
    this.loop.paused = false;
    this.audio.suspendGame(false);
    this.input.flush();
    this.menus.hide();
    if (this.settings.mouseAim) this.input.requestPointerLock();
  }

  quitToMenu() {
    this.endSession();
    this._toMenu();
    this.menus.stack.length = 0;
    this.menus.show('main', false);
  }

  _toMenu() {
    this.paused = false;
    this.loop.paused = false;
    this.input.exitPointerLock();
    if (!this.hangar) {
      this.hangar = new HangarScene(this);
      this.hangar.activate();
    }
  }

  /** Called by game modes when a run ends. Applies rewards and shows results. */
  finishSession(result) {
    const s = this.save.data;
    s.credits += Math.max(0, Math.round(result.credits || 0));
    result.retry = this.lastMission?.retry;
    if (result.mode === 'campaign') {
      const c = s.campaign;
      const idx = LEVELS.findIndex((m) => m.id === result.missionId);
      if (result.success) {
        c.completed[result.missionId] = true;
        c.bestScores[result.missionId] = Math.max(c.bestScores[result.missionId] || 0, result.score);
        if (idx + 2 > c.unlocked && idx + 1 < LEVELS.length) {
          c.unlocked = idx + 2;
          result.unlocked = `Level ${idx + 2}: ${LEVELS[idx + 1].name}`;
        }
        result.next = LEVELS[idx + 1]?.id;
      }
    }
    if (result.mode === 'campaign' && result.success) {
      this.daily.track('wins');
      if (['hard', 'ace'].includes(this.settings.difficulty)) this.daily.track('winHard');
    }
    if (result.mode === 'survival') this.daily.track('waves', result.wave || 0);
    if (result.mode === 'survival') {
      const lb = s.leaderboard;
      result.qualifies = lb.length < 10 || result.score > lb[lb.length - 1].score;
    }
    this.save.write();
    this.endSession();
    this._toMenu();
    this.menus.result = result;
    this.menus.stack = ['main'];
    this.menus.show('results', false);
  }
}
