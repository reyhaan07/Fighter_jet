import { DEFAULT_BINDINGS, ACTIONS } from '../config/controls.js';

// Unified keyboard + mouse + gamepad input with remappable bindings.
// Gameplay asks for actions, never for raw keys:
//   value(action)   analog 0..1 (keys/buttons are 0 or 1, pad axes are analog)
//   down(action)    held this step
//   pressed(action) went down since the previous simulation step

const PAD_DEADZONE = 0.16;

export class Input {
  constructor(canvas, bindings) {
    this.canvas = canvas;
    this.bindings = structuredClone(bindings || DEFAULT_BINDINGS);
    for (const [id] of ACTIONS) if (!this.bindings[id]) this.bindings[id] = [];
    this.keys = new Set();
    this.pending = []; // codes pressed since the last simulation step (reused array)
    this.wheelNotches = 0; // net mouse-wheel notches not yet consumed (+ = up)
    this._wheelAcc = 0; // touchpad scroll distance below one notch
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseX = 0; // normalised -1..1 position (fallback when no pointer lock)
    this.mouseY = 0;
    this.pointerLocked = false;
    this.padIndex = -1;
    this.padButtons = new Float32Array(20);
    this.padPrev = new Uint8Array(20);
    this.padAxes = new Float32Array(8);
    this.lastDevice = 'keyboard';
    this.enabled = true;
    this.flying = false; // set by Game while a session runs unpaused
    this._capture = null;
    this._stepPressed = new Set();

    this._onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (!this._capture && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
      if (this._capture) {
        e.preventDefault();
        if (e.code !== 'Escape') this._finishCapture(e.code);
        else this._finishCapture(null);
        return;
      }
      if (this._isGameKey(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this._pulse(e.code);
      }
      this.lastDevice = 'keyboard';
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseDown = (e) => {
      const code = 'Mouse' + e.button;
      if (this._capture) {
        e.preventDefault();
        this._finishCapture(code);
        return;
      }
      if (e.target !== this.canvas) return;
      this.keys.add(code);
      this._pulse(code);
      this.lastDevice = 'mouse';
    };
    this._onMouseUp = (e) => this.keys.delete('Mouse' + e.button);
    this._onMouseMove = (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      } else {
        const r = this.canvas.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
        this.mouseDX += (nx - this.mouseX) * r.width * 0.5;
        this.mouseDY += (ny - this.mouseY) * r.height * 0.5;
        this.mouseX = nx;
        this.mouseY = ny;
      }
    };
    this._onWheel = (e) => {
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      if (this._capture) {
        this._finishCapture(code);
        return;
      }
      if (e.target !== this.canvas) return;
      this._pulse(code);
      // Count notches from the scroll distance so a mouse wheel click is one
      // notch and a laptop touchpad swipe moves smoothly instead of jumping.
      const px = -e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1);
      this._wheelAcc += px;
      let n = Math.trunc(this._wheelAcc / 100);
      if (!n && Math.abs(px) >= 50) n = Math.sign(px); // one physical wheel click
      if (n) this._wheelAcc = 0;
      this.wheelNotches += n;
    };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    };
    this._onBlur = () => this.keys.clear();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this._gameKeys = new Set();
    this._rebuildGameKeys();
  }

  _rebuildGameKeys() {
    this._gameKeys.clear();
    for (const list of Object.values(this.bindings)) for (const c of list) this._gameKeys.add(c);
    this._gameKeys.add('Tab');
    this._gameKeys.add('F3');
  }

  _isGameKey(code) {
    // Only swallow keys (e.g. Space, arrows) while actually flying.
    return this.enabled && this.flying && this._gameKeys.has(code);
  }

  _pulse(code) {
    if (this.pending.length < 64) this.pending.push(code);
  }

  requestPointerLock() {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const p = this.canvas.requestPointerLock?.();
        p?.catch?.(() => {});
      } catch {
        /* not available (e.g. headless) */
      }
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Polls the gamepad. Call once per rendered frame. */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.padIndex = -1;
      this.padButtons.fill(0);
      this.padAxes.fill(0);
      return;
    }
    this.padIndex = pad.index;
    const nb = Math.min(pad.buttons.length, this.padButtons.length);
    for (let i = 0; i < nb; i++) {
      const v = pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0);
      this.padButtons[i] = v;
      const on = v > 0.5 ? 1 : 0;
      if (on && !this.padPrev[i]) {
        const code = 'Pad:B' + i;
        if (this._capture) this._finishCapture(code);
        else this._pulse(code);
        this.lastDevice = 'gamepad';
      }
      this.padPrev[i] = on;
    }
    const na = Math.min(pad.axes.length, this.padAxes.length);
    for (let i = 0; i < na; i++) {
      const raw = pad.axes[i];
      const v = Math.abs(raw) < PAD_DEADZONE ? 0 : (raw - Math.sign(raw) * PAD_DEADZONE) / (1 - PAD_DEADZONE);
      if (this._capture && Math.abs(v) > 0.7) this._finishCapture('Pad:A' + i + (v > 0 ? '+' : '-'));
      if (Math.abs(v) > 0.3) this.lastDevice = 'gamepad';
      this.padAxes[i] = v;
    }
  }

  /** Call at the start of every simulation step: latches edge-triggered presses. */
  beginStep() {
    this._stepPressed.clear();
    for (let i = 0; i < this.pending.length; i++) this._stepPressed.add(this.pending[i]);
    this.pending.length = 0;
  }

  _codeValue(code) {
    if (code.startsWith('Pad:')) {
      if (this.padIndex < 0) return 0;
      if (code[4] === 'B') return this.padButtons[+code.slice(5)] || 0;
      const n = +code.slice(5, -1);
      const v = this.padAxes[n] || 0;
      return code.endsWith('+') ? (v > 0 ? v : 0) : v < 0 ? -v : 0;
    }
    return this.keys.has(code) ? 1 : 0;
  }

  value(action) {
    if (!this.enabled) return 0;
    const list = this.bindings[action];
    let v = 0;
    for (let i = 0; i < list.length; i++) {
      const c = this._codeValue(list[i]);
      if (c > v) v = c;
    }
    return v;
  }

  down(action) {
    return this.value(action) > 0.5;
  }

  pressed(action) {
    if (!this.enabled) return false;
    const list = this.bindings[action];
    for (let i = 0; i < list.length; i++) if (this._stepPressed.has(list[i])) return true;
    return false;
  }

  /** Drop queued presses (e.g. the Esc that closed a menu). */
  flush() {
    this.pending.length = 0;
    this._stepPressed.clear();
    this.mouseDX = this.mouseDY = this.wheelNotches = 0;
  }

  /** Raw key press check outside the binding system (F3 etc.). */
  pressedCode(code) {
    return this._stepPressed.has(code);
  }

  /** Signed axis from two actions, e.g. axis('pitchDown','pitchUp'). */
  axis(neg, pos) {
    return this.value(pos) - this.value(neg);
  }

  /** Net wheel notches since the last call (+ = scrolled up). */
  consumeWheel() {
    const n = this.wheelNotches;
    this.wheelNotches = 0;
    return this.enabled ? n : 0;
  }

  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = this.mouseDY = 0;
    return [dx, dy];
  }

  // ── Rebinding ─────────────────────────────────────────────────────────
  captureNext(cb) {
    this._capture = cb;
  }

  _finishCapture(code) {
    const cb = this._capture;
    this._capture = null;
    cb?.(code);
  }

  setBinding(action, index, code) {
    const list = this.bindings[action];
    if (code) {
      // A code drives only one action: remove it elsewhere.
      for (const l of Object.values(this.bindings)) {
        const i = l.indexOf(code);
        if (i >= 0) l.splice(i, 1);
      }
      list[index] = code;
    } else list.splice(index, 1);
    for (let i = list.length - 1; i >= 0; i--) if (!list[i]) list.splice(i, 1);
    this._rebuildGameKeys();
  }

  resetBindings() {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this._rebuildGameKeys();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
