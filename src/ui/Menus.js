import { AIRCRAFT, AIRCRAFT_ORDER, PAINTS } from '../config/aircraft.js';
import { LEVELS, CHAPTERS, levelById } from '../config/campaign.js';
import { WorldMap } from './WorldMap.js';
import { normalizeSave } from '../core/Save.js';
import { IS_TOUCH } from '../core/Platform.js';
import { WEAPONS, weaponsForSlot } from '../weapons/registry.js';
import { UPGRADES, MAX_LEVEL } from '../config/upgrades.js';
import { ACTIONS, describeCode } from '../config/controls.js';
import { PRESETS, PRESET_ORDER } from '../config/quality.js';
import { DIFFICULTY, DIFFICULTY_ORDER } from '../config/difficulty.js';

// DOM menus: main menu, campaign, hangar (aircraft, paint, loadout, shop,
// upgrades), settings (graphics, audio, controls with rebinding, gameplay),
// pause, results and leaderboard. Rendered as HTML over the 3D hangar.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const SLOT_LABEL = { gun: 'Gun', s1: 'Weapon 1', s2: 'Weapon 2', s3: 'Weapon 3', def: 'Defence' };
const SLOT_TYPE = { gun: 'gun', s1: 'secondary', s2: 'secondary', s3: 'secondary', def: 'def' };

export class Menus {
  constructor(game) {
    this.game = game;
    this.root = game.ui;
    this.screen = null;
    this.stack = [];
    this.pending = null; // what "Launch" in the hangar starts
    this.settingsTab = 'graphics';
    this.root.addEventListener('click', (e) => this._onClick(e));
    this.root.addEventListener('change', (e) => this._onChange(e));
    this.root.addEventListener('input', (e) => this._onInput(e));
    this.root.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('[data-act="rebind"]');
      if (!el) return;
      e.preventDefault();
      const g = this.game;
      const list = g.input.bindings[el.dataset.id];
      const kind = el.dataset.kind;
      const same = list.filter((c) => (kind === 'pad') === c.startsWith('Pad:'));
      const code = same[+el.dataset.i];
      if (code) g.input.setBinding(el.dataset.id, list.indexOf(code), null);
      g.persist();
      this.render();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.screen || this.capturing || this.screen === 'loading' || e.defaultPrevented) return;
      if (performance.now() - (this.game.pausedAt || 0) < 400) return;
      if (this.screen === 'pause') this.game.resume();
      else if (this.stack.length) this.back();
    });
  }

  get save() {
    return this.game.save.data;
  }

  hide() {
    this.root.innerHTML = '';
    this.screen = null;
    this.stack.length = 0;
  }

  show(name, push = true) {
    if (push && this.screen && this.screen !== name) this.stack.push(this.screen);
    this.screen = name;
    this.render();
  }

  back() {
    const prev = this.stack.pop();
    if (prev) {
      this.screen = prev;
      this.render();
    }
  }

  render() {
    const fn = this['_' + this.screen];
    this.root.innerHTML = fn ? fn.call(this) : '';
    this.root.querySelector('[data-autofocus]')?.focus();
    this._mountMap();
    if (!this.game.session) this._syncHangarJet();
  }

  _syncHangarJet() {
    const lo = this.save.loadout;
    this.game.hangar?.setJet(AIRCRAFT[lo.aircraft].design, PAINTS[lo.paint]?.color ?? 0x4c535c);
  }

  credits() {
    return `<div class="credits"><span>CREDITS</span>${fmt(this.save.credits)}</div>`;
  }

  // ── Screens ──────────────────────────────────────────────────────────
  _main() {
    return `
    <div class="menu main-menu">
      <div class="brand">
        <div class="brand-kicker">OFFLINE AIR COMBAT</div>
        <h1>STRIKE WING</h1>
      </div>
      <nav class="main-nav">
        <button class="play" data-act="campaign" data-autofocus>Play</button>
        <button data-act="survival">Survival</button>
        <button data-act="free">Free Flight · Training Range</button>
        <button data-act="hangar">Hangar · Buy jets</button>
        <button data-act="daily">Daily Rewards${this.game.daily.claimable ? ` <span class="badge">${this.game.daily.claimable}</span>` : ''}</button>
        <button data-act="leaderboard">Leaderboard</button>
        <button data-act="settings">Settings</button>
      </nav>
      <div class="main-foot">${this.credits()}${IS_TOUCH ? '' : '<span class="muted">F3 performance overlay · Esc pause</span>'}</div>
    </div>`;
  }

  _campaign() {
    const c = this.save.campaign;
    const sel = this.selectedMission || LEVELS[Math.min(LEVELS.length, c.unlocked) - 1].id;
    this.selectedMission = sel;
    const m = levelById(sel) || LEVELS[0];
    const idx = LEVELS.indexOf(m);
    const locked = idx + 1 > c.unlocked;
    const diff = this.game.settings.difficulty;
    const done = Object.keys(c.completed).length;
    const rec = (m.recommended || []).map((id) => WEAPONS[id]?.short || id).join(' · ');
    return `
    <div class="menu campaign-map">
      <div class="mapwrap" id="worldmap"></div>
      <header class="map-head"><button class="back" data-act="back">‹ Back</button><h2>Campaign</h2><span class="progress">${done} / ${LEVELS.length} levels</span>${this.credits()}</header>
      <aside class="map-brief">
        <div class="kicker">Chapter ${m.chapter + 1} · ${esc(CHAPTERS[m.chapter].name)}</div>
        <h3><span class="lvl">${m.level}</span> ${esc(m.name)}</h3>
        <div class="kicker type">${esc(m.type)}${m.boss ? ' · BOSS' : ''}</div>
        <p>${esc(m.brief)}</p>
        <dl>
          <dt>Conditions</dt><dd>${esc(m.env.time)} · ${esc(m.env.terrain)}</dd>
          <dt>Wingmen</dt><dd>${m.wingmen || 0}</dd>
          <dt>Reward</dt><dd>${fmt(m.reward)} credits</dd>
          <dt>Recommended</dt><dd>${esc(rec)}</dd>
          ${c.bestScores[m.id] ? `<dt>Best score</dt><dd>${fmt(c.bestScores[m.id])}</dd>` : ''}
        </dl>
        <div class="row">
          <div class="seg">${DIFFICULTY_ORDER.map((d) => `<button data-act="difficulty" data-id="${d}" class="${d === diff ? 'on' : ''}">${DIFFICULTY[d].label}</button>`).join('')}</div>
        </div>
        <div class="brief-actions">
          <div class="actions">
            <button data-act="prevLevel">‹</button>
            <button class="primary play-level" data-act="playLevel" ${locked ? 'disabled' : ''}>${locked ? 'Locked' : 'Play ›'}</button>
            <button data-act="nextLevel">›</button>
          </div>
          <div class="actions"><button data-act="toHangar" data-launch="mission" ${locked ? 'disabled' : ''}>Change jet & weapons</button></div>
        </div>
        <p class="muted small">${IS_TOUCH ? 'Tap a level, then Play · drag to pan · pinch to zoom' : 'Click a level, then Play · drag to pan · scroll to zoom · double-click a level to fly it'}</p>
      </aside>
    </div>`;
  }

  _mountMap() {
    const host = this.root.querySelector('#worldmap');
    if (!host) {
      this.map?.unmount();
      return;
    }
    if (!this.map) {
      this.map = new WorldMap({
        onSelect: (id) => {
          this.selectedMission = id;
          this.map.focus(id);
          this.render();
        },
        onLaunch: (id) => {
          this.selectedMission = id;
          this.game.launch({ kind: 'mission', id });
        },
      });
    }
    const c = this.save.campaign;
    this.map.setState({ unlocked: c.unlocked, completed: c.completed, selected: this.selectedMission });
    this.map.mount(host);
  }

  _hangar() {
    const s = this.save;
    const lo = s.loadout;
    const ac = AIRCRAFT[lo.aircraft];
    const stat = (label, v, max) => `<div class="stat"><span>${label}</span><i style="--v:${Math.min(1, v / max)}"></i></div>`;
    const planes = AIRCRAFT_ORDER.map((id) => {
      const a = AIRCRAFT[id];
      const owned = s.unlockedAircraft.includes(id);
      return `<button class="card ${id === lo.aircraft ? 'sel' : ''}" data-act="${owned ? 'pickAircraft' : 'buyAircraft'}" data-id="${id}">
        <b>${esc(a.name)}</b><small>${esc(a.role)}</small>
        ${owned ? '' : `<em class="price">${fmt(a.price)} cr</em>`}</button>`;
    }).join('');
    const paints = Object.entries(PAINTS)
      .map(([id, p]) => {
        const owned = p.price === 0 || (s.paints || []).includes(id);
        return `<button class="swatch ${id === lo.paint ? 'sel' : ''}" style="--c:#${p.color.toString(16).padStart(6, '0')}" data-act="${owned ? 'pickPaint' : 'buyPaint'}" data-id="${id}" title="${esc(p.name)}${owned ? '' : ` — ${p.price} cr`}">${owned ? '' : '<span>$</span>'}</button>`;
      })
      .join('');
    const slots = Object.keys(SLOT_LABEL)
      .map((slot) => {
        const opts = weaponsForSlot(SLOT_TYPE[slot]).filter((w) => s.unlockedWeapons.includes(w.id));
        const cur = lo.slots[slot];
        return `<div class="slot"><label>${SLOT_LABEL[slot]}</label>
          <select data-slot="${slot}">${slot !== 'gun' ? '<option value="">— empty —</option>' : ''}${opts.map((w) => `<option value="${w.id}" ${w.id === cur ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
          ${cur ? `<button class="mini" data-act="inspect" data-id="${cur}">Upgrades</button>` : ''}</div>`;
      })
      .join('');
    const shop = ['gun', 'secondary', 'def']
      .flatMap((t) => weaponsForSlot(t))
      .filter((w) => !s.unlockedWeapons.includes(w.id))
      .map((w) => `<div class="shop-item"><div><b>${esc(w.name)}</b><small>${esc(w.category)}</small><p>${esc(w.description || '')}</p></div>
        <button class="buy" data-act="buyWeapon" data-id="${w.id}" ${s.credits < w.price ? 'disabled' : ''}>${fmt(w.price)} cr</button></div>`)
      .join('') || '<p class="muted">Every weapon unlocked.</p>';
    const insp = this.inspect && s.unlockedWeapons.includes(this.inspect) ? this._upgradePanel(this.inspect) : '';
    const launch = this.pending
      ? `<button class="primary" data-act="launch">Launch ›</button>`
      : '';
    return `
    <div class="menu panel-layout hangar">
      <header><button class="back" data-act="back">‹ Back</button><h2>Hangar</h2>${this.credits()}</header>
      <div class="cols">
        <div class="col">
          <h4>Aircraft</h4><div class="cards">${planes}</div>
          <div class="ac-info"><p>${esc(ac.description)}</p>
            ${stat('Speed', ac.maxSpeed, 400)}${stat('Turn', ac.pitchRate, 2)}${stat('Roll', ac.rollRate, 4.5)}${stat('Armour', ac.hp, 200)}${stat('Radar', ac.radarRange, 14000)}${stat('Stealth', 1.2 - ac.signature, 1)}
          </div>
          <h4>Paint</h4><div class="swatches">${paints}</div>
        </div>
        <div class="col spacer"></div>
        <div class="col">
          <h4>Loadout</h4><div class="slots">${slots}</div>
          ${insp}
          <h4>Armoury</h4><div class="shop">${shop}</div>
        </div>
      </div>
      <footer>${launch}</footer>
    </div>`;
  }

  _upgradePanel(id) {
    const w = WEAPONS[id];
    const lv = this.save.upgrades[id] || {};
    const rows = Object.entries(UPGRADES)
      .filter(([, u]) => u.applies(w))
      .map(([key, u]) => {
        const l = lv[key] || 0;
        const cost = u.costs[l];
        const pips = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
        return `<div class="upg"><span>${u.label}</span><span class="pips">${pips}</span>
          ${l < MAX_LEVEL ? `<button class="buy" data-act="upgrade" data-id="${id}" data-key="${key}" ${this.save.credits < cost ? 'disabled' : ''}>${fmt(cost)} cr</button>` : '<em>MAX</em>'}</div>`;
      })
      .join('');
    return `<div class="upgrades"><h5>${esc(w.name)}</h5><p class="muted">${esc(w.description || '')}</p>${rows}</div>`;
  }

  _settings() {
    const st = this.game.settings;
    const tab = this.settingsTab;
    const tabs = ['graphics', 'audio', 'controls', 'gameplay']
      .map((t) => `<button class="${t === tab ? 'on' : ''}" data-act="settingsTab" data-id="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)
      .join('');
    let body = '';
    const range = (key, label, min, max, step, fmtv = (v) => v) => `<div class="row"><label>${label}</label><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${st[key]}"><output>${fmtv(st[key])}</output></div>`;
    const toggle = (key, label) => `<div class="row"><label>${label}</label><button class="toggle ${st[key] ? 'on' : ''}" data-act="toggle" data-id="${key}">${st[key] ? 'ON' : 'OFF'}</button></div>`;
    if (tab === 'graphics') {
      const det = this.game.detected;
      body = `
        <div class="row"><label>Quality preset</label><div class="seg">
          <button data-act="quality" data-id="auto" class="${st.quality === 'auto' ? 'on' : ''}">Auto (${PRESETS[det.preset].label})</button>
          ${PRESET_ORDER.map((q) => `<button data-act="quality" data-id="${q}" class="${st.quality === q ? 'on' : ''}">${PRESETS[q].label}</button>`).join('')}
        </div></div>
        <p class="muted small">Detected GPU: ${esc(det.gpu)}. Presets change resolution scale, shadows, bloom, particle counts, terrain detail and view distance. Terrain and view distance apply from the next mission.</p>
        ${range('brightness', 'Brightness', 0.6, 1.4, 0.05, (v) => Math.round(v * 100) + '%')}
        ${range('renderScale', 'Render scale (0 = preset)', 0, 1, 0.05, (v) => (+v ? Math.round(v * 100) + '%' : 'preset'))}
        ${toggle('adaptive', 'Adaptive resolution (lower scale when FPS drops)')}
        <div class="row"><label>Frame cap</label><div class="seg">${[30, 60, 90, 120, 0].map((f) => `<button data-act="fpsCap" data-id="${f}" class="${+st.targetFps === f ? 'on' : ''}">${f || 'Off'}</button>`).join('')}</div></div>
        ${toggle('showFps', 'Performance overlay (F3)')}`;
    } else if (tab === 'audio') {
      const pct = (v) => Math.round(v * 100) + '%';
      body = `${range('masterVolume', 'Master', 0, 1, 0.05, pct)}${range('sfxVolume', 'Effects', 0, 1, 0.05, pct)}${range('engineVolume', 'Engine', 0, 1, 0.05, pct)}${range('radioVolume', 'Radio', 0, 1, 0.05, pct)}${range('musicVolume', 'Music', 0, 1, 0.05, pct)}
        ${toggle('voice', 'Spoken radio (uses your system’s offline voices)')}`;
    } else if (tab === 'controls') {
      const groups = {};
      for (const [id, label, group] of ACTIONS) (groups[group] ||= []).push([id, label]);
      const binds = this.game.input.bindings;
      const rows = Object.entries(groups)
        .map(([g, list]) => `<h5>${g}</h5>` + list.map(([id, label]) => {
          const codes = binds[id] || [];
          const kb = codes.filter((c) => !c.startsWith('Pad:'));
          const pad = codes.filter((c) => c.startsWith('Pad:'));
          const btn = (c, i, kind) => `<button class="bind ${this.capturing === `${id}:${kind}:${i}` ? 'capture' : ''}" data-act="rebind" data-id="${id}" data-kind="${kind}" data-i="${i}">${this.capturing === `${id}:${kind}:${i}` ? 'press…' : esc(describeCode(c))}</button>`;
          return `<div class="bindrow"><span>${esc(label)}</span><span class="binds">${kb.map((c, i) => btn(c, i, 'kb')).join('')}${btn(null, kb.length, 'kb').replace('—', '+')}${pad.map((c, i) => btn(c, i, 'pad')).join('')}${pad.length ? '' : btn(null, 0, 'pad').replace('—', '+ pad')}</span></div>`;
        }).join(''))
        .join('');
      if (IS_TOUCH && !this.showKeys) {
        body = `
        ${toggle('autoLevel', 'Auto-level assist (levels the wings when you let go of the stick)')}
        ${toggle('invertY', 'Invert pitch (drag down to climb, like a real stick)')}
        <p class="muted small"><b>Touch controls:</b> drag anywhere on the left half to fly (up = climb, sideways = roll). The slider on the left edge is the throttle; slide into the orange <b>AB</b> zone at the top for afterburner. Hold <b>GUN</b> to fire the cannon. Tap the blue weapon button to fire the selected weapon (missiles lock on by themselves when a target is in front of you). <b>WPN</b> switches weapons, <b>FLR</b> drops flares, <b>DEF</b> fires chaff/ECM/shield, <b>TGT</b> picks the next target, <b>CAM</b> changes the view, <b>WING</b> orders your wingmen. A game controller also works.</p>
        <div class="actions"><button data-act="showKeys">Keyboard &amp; gamepad bindings</button></div>`;
      } else body = `
        ${toggle('mouseAim', 'Mouse-aim mode (mouse steers the aim, jet follows)')}
        ${toggle('autoLevel', 'Auto-level assist')}
        ${toggle('invertY', 'Invert Y (pitch)')}
        ${range('mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, (v) => (+v).toFixed(2))}
        <p class="muted small">Click a binding, then press a key, mouse button or gamepad button/stick (Esc cancels). Right-click a binding to clear it.</p>
        <div class="bindings">${rows}</div>
        <div class="actions"><button data-act="resetBindings">Reset to defaults</button></div>`;
    } else {
      body = `
        <div class="row"><label>Difficulty</label><div class="seg">${DIFFICULTY_ORDER.map((d) => `<button data-act="difficulty" data-id="${d}" class="${d === st.difficulty ? 'on' : ''}">${DIFFICULTY[d].label}</button>`).join('')}</div></div>
        <div class="row"><label>Pilot callsign</label><input type="text" maxlength="12" data-setting="pilotName" value="${esc(st.pilotName)}"></div>
        ${toggle('damageNumbers', 'Damage numbers')}
        ${toggle('killCam', 'Cinematic kill cam')}
        <div class="actions">
          <button data-act="exportSave">Export save file</button>
          <label class="filebtn">Import save file<input type="file" accept="application/json" data-import hidden></label>
          <button class="danger" data-act="resetProgress">Reset campaign progress</button>
        </div>
        <p class="muted small">Progress, credits, unlocks, settings and the leaderboard are saved automatically in this browser (localStorage). Export a save file to back it up or move it to another computer.</p>`;
    }
    return `
    <div class="menu panel-layout settings">
      <header><button class="back" data-act="back">‹ Back</button><h2>Settings</h2></header>
      <div class="tabs">${tabs}</div>
      <div class="settings-body">${body}</div>
    </div>`;
  }

  _daily() {
    const dy = this.game.daily;
    const d = dy.d;
    const days = [500, 750, 1000, 1500, 2000, 3000, 6000]
      .map((amt, i) => {
        const day = i + 1;
        const state = day < d.streak || (day === d.streak && !dy.loginAvailable) ? 'got' : day === d.streak ? 'today' : '';
        return `<div class="day ${state}"><small>Day ${day}</small><b>${fmt(amt)}</b>${state === 'got' ? '<i>✓</i>' : ''}</div>`;
      })
      .join('');
    const tasks = d.tasks
      .map((t, i) => {
        const done = t.progress >= t.target;
        return `<div class="task ${t.claimed ? 'claimed' : done ? 'done' : ''}">
          <div><b>${esc(t.text)}</b><div class="bar"><i style="--v:${t.progress / t.target}"></i></div><small>${t.progress} / ${t.target}</small></div>
          <button class="${done && !t.claimed ? 'primary' : ''}" data-act="claimTask" data-id="${i}" ${done && !t.claimed ? '' : 'disabled'}>${t.claimed ? 'Claimed' : `+${fmt(t.reward)} cr`}</button></div>`;
      })
      .join('');
    return `
    <div class="menu panel-layout narrow daily">
      <header><button class="back" data-act="back">‹ Back</button><h2>Daily Rewards</h2>${this.credits()}</header>
      <h4>Login streak · day ${d.streak} of 7</h4>
      <div class="streak">${days}</div>
      <div class="actions"><button class="primary" data-act="claimLogin" ${dy.loginAvailable ? 'data-autofocus' : 'disabled'}>${dy.loginAvailable ? `Claim ${fmt(dy.loginReward)} credits` : 'Come back tomorrow for more'}</button></div>
      <p class="muted small">Log in on consecutive days to climb the streak. Miss a day and it starts again from day 1.</p>
      <h4>Today's tasks</h4>
      <div class="tasks">${tasks}</div>
      <p class="muted small">New tasks every day at midnight. Spend credits in the Hangar on new jets, weapons, paints and upgrades.</p>
    </div>`;
  }

  _leaderboard() {
    const lb = this.save.leaderboard;
    const rows = lb.length
      ? lb.map((e, i) => `<tr class="${i === this.highlight ? 'hl' : ''}"><td>${i + 1}</td><td>${esc(e.name)}</td><td>${fmt(e.score)}</td><td>${e.wave}</td><td>${esc(e.date)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">No runs yet. Play Survival!</td></tr>';
    return `
    <div class="menu panel-layout narrow">
      <header><button class="back" data-act="back">‹ Back</button><h2>Survival Leaderboard</h2></header>
      <table class="lb"><thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="actions"><button class="primary" data-act="toHangar" data-launch="survival">Play Survival ›</button></div>
    </div>`;
  }

  _pause() {
    return `
    <div class="menu overlay">
      <div class="pause-box">
        <h2>Paused</h2>
        <button class="primary" data-act="resume" data-autofocus>Resume</button>
        <button data-act="restart">Restart</button>
        <button data-act="settings">Settings</button>
        <button data-act="help">Controls</button>
        <button data-act="quit">Quit to menu</button>
      </div>
    </div>`;
  }

  _help() {
    const b = this.game.input.bindings;
    const k = (id) => (b[id] || []).filter((c) => !c.startsWith('Pad:')).map(describeCode).join(' / ') || '—';
    const p = (id) => (b[id] || []).filter((c) => c.startsWith('Pad:')).map(describeCode).join(' / ') || '—';
    const rows = ACTIONS.map(([id, label]) => `<tr><td>${esc(label)}</td><td>${esc(k(id))}</td><td>${esc(p(id))}</td></tr>`).join('');
    if (IS_TOUCH) {
      const t = [
        ['Fly (pitch and roll)', 'Drag anywhere on the left half of the screen: up climbs, down dives, sideways rolls'],
        ['Throttle', 'Slider on the left edge; slide into the orange AB zone at the top for afterburner'],
        ['Fire gun', 'Hold GUN (red)'],
        ['Fire selected weapon', 'Tap the blue button (missiles lock on by themselves)'],
        ['Next weapon', 'WPN'],
        ['Flares', 'Hold FLR'],
        ['Chaff / ECM / shield', 'DEF'],
        ['Next target', 'TGT'],
        ['Camera view', 'CAM'],
        ['Wingman orders', 'WING (attack → cover → regroup)'],
        ['Pause', 'II (top right) or the Back button'],
      ];
      return `
    <div class="menu panel-layout narrow">
      <header><button class="back" data-act="back">‹ Back</button><h2>Controls</h2></header>
      <p class="muted small">Touch controls appear while you fly. Auto-level keeps the wings level when you let go of the stick. A Bluetooth game controller works too.</p>
      <table class="lb help"><thead><tr><th>Action</th><th>Touch</th></tr></thead><tbody>${t.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table>
    </div>`;
    }
    return `
    <div class="menu panel-layout narrow">
      <header><button class="back" data-act="back">‹ Back</button><h2>Controls</h2></header>
      <p class="muted small">Fly with the arrow keys (or the left stick); the mouse moves the aim circle and the jet follows it. Left mouse fires the gun, right mouse fires the selected weapon. Click the game view to capture the mouse.</p>
      <table class="lb help"><thead><tr><th>Action</th><th>Keyboard / mouse</th><th>Gamepad</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }

  _results() {
    const r = this.result;
    const st = r.stats || {};
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : null;
    const entry = r.mode === 'survival' && r.qualifies && !r.submitted
      ? `<div class="row"><label>Pilot name</label><input type="text" maxlength="12" id="lbname" value="${esc(this.game.settings.pilotName)}" data-autofocus><button class="primary" data-act="submitScore">Save score</button></div>`
      : '';
    return `
    <div class="menu overlay">
      <div class="results ${r.success ? 'ok' : 'fail'}">
        <div class="kicker">${r.mode === 'survival' ? 'SURVIVAL' : r.mode === 'campaign' ? 'CAMPAIGN' : 'FREE FLIGHT'}</div>
        <h2>${esc(r.title)}</h2>
        <p>${esc(r.subtitle || '')}</p>
        <dl>
          <dt>Score</dt><dd>${fmt(r.score)}</dd>
          <dt>Kills</dt><dd>${r.kills}</dd>
          ${r.wave ? `<dt>Wave</dt><dd>${r.wave}</dd>` : ''}
          <dt>Credits earned</dt><dd>+${fmt(r.credits)}</dd>
          ${acc !== null ? `<dt>Hit rounds</dt><dd>${fmt(st.hits)}</dd>` : ''}
        </dl>
        ${entry}
        ${r.unlocked ? `<p class="unlock">New mission unlocked: ${esc(r.unlocked)}</p>` : ''}
        <div class="actions">
          <button data-act="retry">Retry</button>
          ${r.mode === 'campaign' && r.success && r.next ? `<button class="primary" data-act="nextMission">Next mission ›</button>` : ''}
          <button data-act="hangar">Hangar</button>
          <button data-act="menu">Main menu</button>
        </div>
      </div>
    </div>`;
  }

  _loading() {
    return `<div class="menu overlay"><div class="loading"><div class="spinner"></div><p>${esc(this.loadingText || 'Preparing aircraft…')}</p></div></div>`;
  }

  // ── Events ───────────────────────────────────────────────────────────
  _onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    const g = this.game;
    const s = this.save;
    g.audio?.click();
    switch (act) {
      case 'back':
        this.capturing = null;
        g.applySettings();
        this.back();
        break;
      case 'campaign':
        this.show('campaign');
        break;
      case 'survival':
        this.pending = { kind: 'survival' };
        this.show('hangar');
        break;
      case 'free':
        this.pending = { kind: 'free' };
        this.show('hangar');
        break;
      case 'hangar':
        if (this.screen === 'results') {
          this.stack = ['main'];
          this.pending = this.result?.retry || null;
        } else this.pending = null;
        this.show('hangar');
        break;
      case 'leaderboard':
        this.show('leaderboard');
        break;
      case 'daily':
        this.show('daily');
        break;
      case 'claimLogin': {
        const amt = g.daily.claimLogin();
        if (amt) g.audio?.purchase();
        this.render();
        break;
      }
      case 'claimTask': {
        const amt = g.daily.claimTask(+id);
        if (amt) g.audio?.purchase();
        this.render();
        break;
      }
      case 'settings':
        this.show('settings');
        break;
      case 'help':
        this.show('help');
        break;
      case 'playLevel':
        g.launch({ kind: 'mission', id: this.selectedMission });
        break;
      case 'prevLevel':
      case 'nextLevel': {
        const i = LEVELS.findIndex((l) => l.id === this.selectedMission) + (act === 'nextLevel' ? 1 : -1);
        if (i >= 0 && i < LEVELS.length) {
          this.selectedMission = LEVELS[i].id;
          this.map?.focus(this.selectedMission);
          this.render();
        }
        break;
      }
      case 'pickMission':
        this.selectedMission = id;
        this.render();
        break;
      case 'difficulty':
        g.settings.difficulty = id;
        g.persist();
        this.render();
        break;
      case 'toHangar':
        this.pending = el.dataset.launch === 'mission' ? { kind: 'mission', id: this.selectedMission } : { kind: 'survival' };
        this.show('hangar');
        break;
      case 'pickAircraft':
        s.loadout.aircraft = id;
        g.persist();
        this.render();
        break;
      case 'buyAircraft': {
        const a = AIRCRAFT[id];
        if (s.credits >= a.price && confirm(`Buy the ${a.name} for ${fmt(a.price)} credits?`)) {
          s.credits -= a.price;
          s.unlockedAircraft.push(id);
          s.loadout.aircraft = id;
          g.persist();
          g.audio?.purchase();
        } else if (s.credits < a.price) g.audio?.denied();
        this.render();
        break;
      }
      case 'pickPaint':
        s.loadout.paint = id;
        g.persist();
        this.render();
        break;
      case 'buyPaint': {
        const p = PAINTS[id];
        if (s.credits >= p.price) {
          s.credits -= p.price;
          (s.paints ||= []).push(id);
          s.loadout.paint = id;
          g.persist();
          g.audio?.purchase();
        } else g.audio?.denied();
        this.render();
        break;
      }
      case 'buyWeapon': {
        const w = WEAPONS[id];
        if (s.credits >= w.price) {
          s.credits -= w.price;
          s.unlockedWeapons.push(id);
          this.inspect = id;
          g.persist();
          g.audio?.purchase();
        }
        this.render();
        break;
      }
      case 'inspect':
        this.inspect = this.inspect === id ? null : id;
        this.render();
        break;
      case 'upgrade': {
        const key = el.dataset.key;
        const lv = (s.upgrades[id] ||= {});
        const l = lv[key] || 0;
        const cost = UPGRADES[key].costs[l];
        if (l < MAX_LEVEL && s.credits >= cost) {
          s.credits -= cost;
          lv[key] = l + 1;
          g.persist();
          g.audio?.purchase();
        }
        this.render();
        break;
      }
      case 'launch':
        g.launch(this.pending);
        break;
      case 'settingsTab':
        this.settingsTab = id;
        this.capturing = null;
        this.render();
        break;
      case 'toggle':
        g.settings[id] = !g.settings[id];
        if (id === 'showFps') g.perf.toggle(), (g.settings.showFps = g.perf.visible);
        g.applySettings();
        this.render();
        break;
      case 'quality':
        g.settings.quality = id;
        g.applySettings(true);
        this.render();
        break;
      case 'fpsCap':
        g.settings.targetFps = +id;
        g.applySettings();
        this.render();
        break;
      case 'rebind': {
        const kind = el.dataset.kind;
        const i = +el.dataset.i;
        this.capturing = `${id}:${kind}:${i}`;
        this.render();
        g.input.captureNext((code) => {
          this.capturing = null;
          if (code && (kind === 'pad') === code.startsWith('Pad:')) {
            const list = g.input.bindings[id];
            const sameKind = list.filter((c) => (kind === 'pad') === c.startsWith('Pad:'));
            const target = sameKind[i];
            const idx = target ? list.indexOf(target) : list.length;
            g.input.setBinding(id, idx, code);
            g.settings.bindings = g.input.bindings;
            g.persist();
          }
          this.render();
        });
        break;
      }
      case 'showKeys':
        this.showKeys = true;
        this.render();
        break;
      case 'resetBindings':
        g.input.resetBindings();
        g.settings.bindings = g.input.bindings;
        g.persist();
        this.render();
        break;
      case 'exportSave': {
        const blob = new Blob([JSON.stringify(g.save.data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `strike-wing-save-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      case 'resetProgress':
        if (g.session) {
          alert('Quit the current mission first, then reset progress from the main menu.');
          break;
        }
        if (confirm('Reset all campaign progress, credits and unlocks?')) {
          g.save.reset();
          g.persist();
          this.render();
        }
        break;
      case 'resume':
        g.resume();
        break;
      case 'restart':
        g.restartSession();
        break;
      case 'quit':
        g.quitToMenu();
        break;
      case 'retry':
        g.launch(this.result.retry);
        break;
      case 'nextMission':
        this.selectedMission = this.result.next;
        this.pending = { kind: 'mission', id: this.result.next };
        this.stack = ['main', 'campaign'];
        this.show('hangar', false);
        break;
      case 'menu':
        this.stack.length = 0;
        this.show('main', false);
        break;
      case 'submitScore': {
        const name = (document.getElementById('lbname')?.value || 'PILOT').toUpperCase().slice(0, 12);
        g.settings.pilotName = name;
        const r = this.result;
        r.submitted = true;
        this.highlight = g.save.addScore({ name, score: r.score, wave: r.wave, date: new Date().toISOString().slice(0, 10) });
        g.persist();
        this.stack = ['main'];
        this.show('leaderboard', false);
        break;
      }
    }
  }

  _onChange(e) {
    const el = e.target;
    if (el.dataset.import !== undefined && el.files?.[0]) {
      el.files[0].text().then((txt) => {
        try {
          const data = JSON.parse(txt);
          if (!data || typeof data.credits !== 'number') throw new Error('not a save file');
          this.game.save.data = normalizeSave(data);
          this.game.save.write();
          alert('Save imported. The game will now reload.');
          location.reload();
        } catch (err) {
          alert('Could not import: ' + err.message);
        }
      });
      return;
    }
    if (el.dataset.slot) {
      const slot = el.dataset.slot;
      const lo = this.save.loadout;
      lo.slots[slot] = el.value || null;
      this.inspect = el.value || null;
      this.game.persist();
      this.render();
    }
  }

  _onInput(e) {
    const el = e.target;
    const key = el.dataset.setting;
    if (!key) return;
    const st = this.game.settings;
    st[key] = el.type === 'range' ? +el.value : el.value;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.type === 'range' ? (key.includes('Volume') || key === 'brightness' ? Math.round(el.value * 100) + '%' : key === 'renderScale' ? (+el.value ? Math.round(el.value * 100) + '%' : 'preset') : (+el.value).toFixed(2)) : el.value;
    this.game.applySettings();
  }
}
