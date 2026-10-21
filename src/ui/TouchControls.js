import { buzz } from '../core/Platform.js';

// On-screen controls for phones and tablets (landscape). Two layouts
// (Settings → Controls → Touch layout):
//
// Two sticks (default, like the Sky Gamblers games):
//   left stick    up/down = speed (push all the way up for afterburner; let go
//                 and the speed stays), left/right = rudder (turn the nose)
//   right stick   up/down = nose up/down, left/right = roll
//   gun           fires by itself when a target is in the gunsight (optional)
// One stick:
//   left edge     throttle slider; the top notch past 100 % is the afterburner
//   left half     floating flight stick: drag to pitch and roll
// Both:
//   right side    GUN (hold), selected weapon (missiles lock on by themselves),
//                 180° quick turn,
//                 next weapon, flares, defence, next target
//   top right     pause, camera, wingman orders
//
// Everything feeds the normal Input actions, so gameplay code does not care
// whether a key, a gamepad or a thumb is flying the jet.

const STICK_RADIUS = 62; // px the knob can travel
const DEAD = 0.07;

const BUTTONS = [
  // id, action, mode, label, css class
  ['gun', 'fireGun', 'hold', 'GUN', 't-gun'],
  ['msl', 'fireSecondary', 'hold', 'MSL', 't-msl'],
  ['flr', 'flares', 'hold', 'FLR', 't-flr'],
  ['wpn', 'nextWeapon', 'tap', 'WPN', 't-wpn'],
  ['def', 'defense', 'tap', 'DEF', 't-def'],
  ['tgt', 'nextTarget', 'tap', 'TGT', 't-tgt'],
  ['flip', 'quickTurn', 'tap', '180°', 't-flip'],
  ['cam', 'camera', 'tap', 'CAM', 't-cam'],
  ['wing', 'wing', 'tap', 'WING', 't-wing'],
  ['pause', 'pause', 'tap', 'II', 't-pause'],
];
const WING_ORDERS = [
  ['wingAttack', 'ATTACK'],
  ['wingCover', 'COVER'],
  ['wingRegroup', 'REGROUP'],
];

function shape(v) {
  // Dead zone plus a gentle curve: fine control near centre, full deflection at the edge.
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  const n = (a - DEAD) / (1 - DEAD);
  return Math.sign(v) * Math.min(1, n * (0.45 + 0.55 * n));
}

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.visible = false;
    this.wingIndex = 0;
    this.sticks = [];
    this.layout = null;
    this.throttleId = -1;
    this._labels = {};

    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.hidden = true;
    root.innerHTML = `
      <div class="t-zone t-zone-l"></div>
      <div class="t-zone t-zone-r"></div>
      <div class="t-stick t-stick-l"><div class="t-knob"></div><i class="t-cap"></i></div>
      <div class="t-stick t-stick-r"><div class="t-knob"></div><i class="t-cap"></i></div>
      <div class="t-throttle">
        <div class="t-track"><div class="t-ab">AB</div><div class="t-fill"></div><div class="t-handle"></div></div>
        <div class="t-pct">70%</div>
      </div>
      ${BUTTONS.map(([id, , , label, cls]) => `<div class="t-btn ${cls}" data-id="${id}"><b>${label}</b><small></small></div>`).join('')}`;
    document.body.appendChild(root);
    this.track = root.querySelector('.t-track');
    this.fill = root.querySelector('.t-fill');
    this.handle = root.querySelector('.t-handle');
    this.pct = root.querySelector('.t-pct');
    this.btn = {};
    for (const el of root.querySelectorAll('.t-btn')) this.btn[el.dataset.id] = { el, small: el.querySelector('small'), b: el.querySelector('b') };

    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.left = this._makeStick(root.querySelector('.t-zone-l'), root.querySelector('.t-stick-l'), 'left');
    this.right = this._makeStick(root.querySelector('.t-zone-r'), root.querySelector('.t-stick-r'), 'right');
    this._bindThrottle();
    this._bindButtons();
  }

  // ── Sticks ───────────────────────────────────────────────────────────
  _makeStick(zone, el, side) {
    const st = { id: -1, ox: 0, oy: 0, x: 0, y: 0, zone, el, knob: el.querySelector('.t-knob'), cap: el.querySelector('.t-cap'), side };
    const place = () => (el.style.transform = `translate(${st.ox}px, ${st.oy}px)`);
    zone.addEventListener('pointerdown', (e) => {
      if (st.id >= 0) return;
      e.preventDefault();
      st.id = e.pointerId;
      st.ox = e.clientX;
      st.oy = e.clientY;
      st.x = st.y = 0;
      zone.setPointerCapture(e.pointerId);
      el.classList.add('on');
      place();
      this._apply(st);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== st.id) return;
      let dx = (e.clientX - st.ox) / STICK_RADIUS;
      let dy = (e.clientY - st.oy) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        // Dragging past the rim pulls the stick base along (floating stick).
        st.ox += (dx / len) * (len - 1) * STICK_RADIUS;
        st.oy += (dy / len) * (len - 1) * STICK_RADIUS;
        dx /= len;
        dy /= len;
        place();
      }
      st.x = dx;
      st.y = dy;
      this._apply(st);
    });
    const end = (e) => {
      if (e.pointerId !== st.id) return;
      st.id = -1;
      st.x = st.y = 0;
      el.classList.remove('on');
      this._rest(st);
      this._apply(st);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    this.sticks.push(st);
    return st;
  }

  /** What a stick does depends on the layout and which side it is on. */
  _apply(st) {
    const t = this.input.touch;
    const two = this.layout === 'two';
    const px = shape(st.x);
    const py = shape(-st.y); // up = positive
    st.knob.style.transform = `translate(${st.x * STICK_RADIUS}px, ${st.y * STICK_RADIUS}px)`;
    if (two && st.side === 'left') {
      // Speed and rudder.
      t.throttleUp = py > 0 ? py : 0;
      t.throttleDown = py < 0 ? -py : 0;
      const ab = -st.y > 0.9;
      if (ab !== !!t.afterburner) buzz(ab ? 18 : 8);
      t.afterburner = ab ? 1 : 0;
      t.yawLeft = px < 0 ? -px : 0;
      t.yawRight = px > 0 ? px : 0;
      return;
    }
    // Pitch and roll (right stick in two-stick mode, the only stick otherwise).
    const p = py * (this.game.settings.invertY ? -1 : 1);
    t.rollLeft = px < 0 ? -px : 0;
    t.rollRight = px > 0 ? px : 0;
    t.pitchUp = p > 0 ? p : 0;
    t.pitchDown = p < 0 ? -p : 0;
  }

  _rest(st) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (st.side === 'left') {
      st.ox = Math.round(w * (this.layout === 'two' ? 0.17 : 0.2) + (this.layout === 'two' ? 20 : 30));
      st.oy = Math.round(h - Math.min(130, h * 0.3));
    } else {
      st.ox = Math.round(w * 0.6);
      st.oy = Math.round(h * 0.6);
    }
    st.el.style.transform = `translate(${st.ox}px, ${st.oy}px)`;
  }

  /** Switch between the one-stick and two-stick layouts. */
  _setLayout(layout) {
    this.layout = layout;
    const two = layout === 'two';
    this.root.classList.toggle('two', two);
    this.right.zone.hidden = this.right.el.hidden = !two;
    this.left.cap.textContent = two ? 'SPEED · RUDDER' : '';
    this.right.cap.textContent = two ? 'FLY' : '';
    this.input.clearTouch();
    for (const st of this.sticks) {
      st.id = -1;
      st.x = st.y = 0;
      st.el.classList.remove('on');
      this._rest(st);
    }
  }

  // ── Throttle ─────────────────────────────────────────────────────────
  _bindThrottle() {
    const tr = this.track;
    const set = (e) => {
      const r = tr.getBoundingClientRect();
      const f = 1 - (e.clientY - r.top) / r.height; // 0 bottom .. 1 top
      // Top 12 % of the track is the afterburner detent.
      const v = f > 0.88 ? 1.1 : Math.max(0, Math.min(1, f / 0.86));
      if ((v > 1) !== (this._lastThr > 1)) buzz(18);
      this._lastThr = v;
      this.input.touchThrottle = v;
    };
    const host = tr.parentElement;
    host.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.throttleId = e.pointerId;
      host.setPointerCapture(e.pointerId);
      set(e);
    });
    host.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.throttleId) set(e);
    });
    const end = (e) => {
      if (e.pointerId === this.throttleId) this.throttleId = -1;
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  }

  // ── Buttons ──────────────────────────────────────────────────────────
  _bindButtons() {
    for (const [id, action, mode] of BUTTONS) {
      const { el } = this.btn[id];
      const ids = new Set();
      let downAt = 0;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        ids.add(e.pointerId);
        el.classList.add('down');
        buzz(id === 'gun' ? 8 : 12);
        if (id === 'pause') return this.game.pause();
        if (id === 'wing') return this._wing();
        this.input.touchPress(action);
        if (mode === 'hold') this.input.touch[action] = 1;
        downAt = performance.now();
      });
      const end = (e) => {
        if (!ids.delete(e.pointerId)) return;
        if (ids.size) return;
        el.classList.remove('down');
        if (mode !== 'hold') return;
        // A quick tap still holds for a few frames so the weapon sees it.
        const left = 70 - (performance.now() - downAt);
        if (left <= 0) this.input.touch[action] = 0;
        else setTimeout(() => !ids.size && (this.input.touch[action] = 0), left);
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
    }
  }

  _wing() {
    const [action, label] = WING_ORDERS[this.wingIndex];
    this.input.touchPress(action);
    this.wingIndex = (this.wingIndex + 1) % WING_ORDERS.length;
    this._set('wing', 'small', label);
  }

  _set(id, part, text) {
    const key = id + part;
    if (this._labels[key] === text) return;
    this._labels[key] = text;
    this.btn[id][part].textContent = text;
  }

  // ── Per frame ────────────────────────────────────────────────────────
  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.root.hidden = !v;
    if (!v) {
      this.input.clearTouch();
      for (const st of this.sticks) {
        st.id = -1;
        st.x = st.y = 0;
        st.el.classList.remove('on');
      }
      this.throttleId = -1;
      for (const b of Object.values(this.btn)) b.el.classList.remove('down');
    } else for (const st of this.sticks) this._rest(st);
  }

  update(session) {
    const g = this.game;
    const show = !!session && !g.paused && !g.loading && !session.ended && !!session.player?.alive && !session.cinematic;
    const layout = g.settings.touchLayout === 'one' ? 'one' : 'two';
    if (layout !== this.layout) this._setLayout(layout);
    this.setVisible(show);
    if (!show) return;
    const p = session.player;
    const f = p.flight;
    // Throttle display follows the real setting (keyboard, respawn, ...).
    const ab = session.controller?.abDetent || f.controls.ab;
    const frac = ab ? 1 : Math.min(1, f.throttleTarget) * 0.86;
    const fy = Math.round(frac * 1000) / 1000;
    if (fy !== this._fy || ab !== this._ab) {
      this._fy = fy;
      this._ab = ab;
      this.fill.style.transform = `scaleY(${fy})`;
      this.handle.style.bottom = `${fy * 100}%`;
      this.track.classList.toggle('ab', !!ab);
      this.pct.textContent = ab ? 'AB' : `${Math.round(f.throttleTarget * 100)}%`;
    }
    const lo = p.loadout;
    if (lo) {
      const gh = lo.gun?.hud();
      if (gh) this._set('gun', 'small', gh.status || (gh.ammo === Infinity ? '∞' : String(gh.ammo)));
      const cur = lo.current?.hud();
      if (cur) {
        this._set('msl', 'b', cur.name.length > 9 ? cur.name.slice(0, 9) : cur.name);
        this._set('msl', 'small', cur.status || (cur.ammo === Infinity ? '∞' : String(cur.ammo)));
      }
      if (lo.flares) this._set('flr', 'small', String(lo.flares.hud().ammo));
      if (lo.defense) {
        const h = lo.defense.hud();
        this._set('def', 'b', h.name.slice(0, 5));
        this._set('def', 'small', h.status || String(h.ammo === Infinity ? '∞' : h.ammo));
      }
    }
    // Quick-turn button: glows when a bandit is behind, dims while recharging.
    const cd = session.controller?.flipCd > 0 || f.flip > 0;
    this.btn.flip.el.classList.toggle('t-ready', !!session.warnings?.six && !cd);
    this.btn.flip.el.classList.toggle('t-cool', cd);
    const hasWing = session.wingmen?.some((w) => w.alive);
    this.btn.wing.el.hidden = !hasWing;
    if (!this._labels.wingsmall) this._set('wing', 'small', WING_ORDERS[this.wingIndex][1]);
  }
}
