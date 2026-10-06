import { Loop } from '../core/Loop.js';
import { Input } from '../core/Input.js';
import { Save } from '../core/Save.js';
import { Renderer } from '../world/Renderer.js';
import { PRESETS, detectPreset } from '../config/quality.js';
import { loadSettings } from './Settings.js';
import { Session } from './Session.js';

// Application shell: owns the renderer, input, save data and the main loop,
// and swaps Sessions (levels) in and out.

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
    this.session = null;
    this.loop = new Loop({
      onStep: (dt) => this.session?.step(dt),
      onRender: (dt, alpha) => this.session?.render(dt, alpha),
    });
    window.addEventListener('resize', () => this.renderer.resize());
    canvas.addEventListener('click', () => {
      if (this.session && this.settings.mouseAim) this.input.requestPointerLock();
    });
  }

  resolveQuality() {
    const id = this.settings.quality === 'auto' ? this.detected.preset : this.settings.quality;
    const q = { ...PRESETS[id] };
    if (this.settings.renderScale) q.renderScale = this.settings.renderScale;
    return q;
  }

  async startSession(mission) {
    this.endSession();
    this.session = new Session(this, mission);
    await this.session.build();
    this.loop.start();
  }

  endSession() {
    if (!this.session) return;
    this.session.dispose();
    this.session = null;
  }
}
