# Strike Wing

An **offline** 3D fighter-jet combat game for the browser and desktop, built with Three.js and Vite in plain JavaScript (ES modules).

It runs entirely on your own computer: no backend, no accounts, no hosting and no CDN. Fonts are bundled, every sound is synthesised in the browser, and every model is generated from code. The player jet, sky, clouds, afterburner, panel-line shader and post-processing come from [reyhaan07/3D-portfolio](https://github.com/reyhaan07/3D-portfolio) (`src/scene/...`) and were extended for the game.

- **Campaign:** 10 missions (air superiority, ground strike, escort, bomber intercept, anti-ship, night strike, close air support, an ace squadron, a carrier strike, and a boss fight against a giant flying fortress with weak points).
- **Survival:** endless waves that keep getting harder, with a local leaderboard.
- **Free flight:** a training range with target drones that respawn and unlimited ammo.
- **4 jets, 20+ weapons**, a hangar to choose loadout and paint, and upgrades bought with credits.

---

## Run it (offline)

Requirements: [Node.js](https://nodejs.org) 18 or newer, and a browser with WebGL2 (Chrome, Edge, Firefox or Safari 15+).

```bash
npm install      # once; this is the only step that needs the internet
npm run dev      # development server, opens http://127.0.0.1:5173
```

Or build an optimised version and play that:

```bash
npm run play     # builds to dist/ and opens http://127.0.0.1:4173
```

After `npm install`, everything works with the network cable unplugged. `dist/` is a self-contained static build, so any local static server can serve it.

> Click the game view to capture the mouse (pointer lock). Press **Esc** to release it and pause. Browsers only start audio after your first click or key press.

Developer shortcuts (append to the URL): `?free`, `?survival`, `?mission=m4`, `?duel` (one bandit), `?stress` (stress test).

---

## Controls

Every binding can be changed in **Settings → Controls**: click a binding and press a key, mouse button or gamepad button or stick. Right-click a binding to clear it.

### Keyboard + mouse (default)

| Action | Key |
|---|---|
| Pitch up / down | **↑ / ↓** |
| Roll left / right | **← / →** |
| Rudder (yaw) | **A / D** |
| Throttle up / down | **W / S** |
| Afterburner (hold) | **Shift** |
| Airbrake (hold) | **B** |
| Aim | **Mouse** (in mouse-aim mode the jet flies toward the aim circle) |
| Fire gun | **Left mouse** / Space |
| Fire selected weapon | **Right mouse** / F |
| Next / previous weapon | R / mouse wheel, or **1 2 3** to pick a slot |
| Next target | T / middle mouse |
| Flares | **X** |
| Defence system (chaff / ECM / shield) | **V** |
| Wingman: attack my target / cover me / regroup | **Z / G / H** |
| Cycle camera (chase / cockpit / cinematic) | **C** |
| Toggle auto-level assist | L |
| Toggle mouse-aim mode | M |
| Radar range | N |
| Free look | Numpad 4 / 6 / 8 / 2 |
| Performance overlay | **F3** |
| Pause | **Esc** / P |

**Mouse-aim mode** (on by default): the mouse moves an aim circle and an autopilot flies the nose toward it. Touching the arrow keys flies the jet directly, and the aim follows the nose so nothing snaps back. The guns gimbal a few degrees toward the aim, and when the selected target's lead point is near your aim, the guns fire at the lead point. Turn mouse-aim off (M, or Settings) for classic keyboard flying with optional auto-level.

### Gamepad (standard layout: Xbox / PlayStation)

| Action | Button |
|---|---|
| Pitch / roll | Left stick |
| Free look | Right stick |
| Throttle up / down | RT / LT (hold RT at 100 % for afterburner) |
| Rudder | LB / RB |
| Gun / weapon | A / B |
| Next target / next weapon | X / Y |
| Flares / defence | D-pad down / up |
| Wingman attack / cover | D-pad left / right |
| Camera / pause | Back (View) / Start (Menu) |

### HUD

The HUD shows:

- a pitch ladder, with speed, altitude and heading tapes;
- a flight-path marker and a gun cross;
- target brackets with distance, a gun lead pipper, and a lock diamond (it converges while locking and turns solid red when locked);
- missile-warning arrows pointing at incoming missiles;
- a CCIP pipper for bombs and a laser designator mark;
- ammo, heat and energy per weapon, plus hull and shield status;
- a radar, hit markers and optional damage numbers;
- a red screen-edge vignette when you take damage, and stall, PULL UP and out-of-area warnings.

---

## Content

### Aircraft

| Jet | Role | Strengths |
|---|---|---|
| F/A-41 Viper | Agile fighter | Best turn and roll rate |
| A/F-60 Hammer | Heavy striker | 190 hull, carries 60 % more ground ordnance |
| X-77 Wraith | Stealth jet | 40 % radar signature: slow enemy locks, SAMs lose track |
| MiR-35 Lancer | Interceptor | 400 m/s, 14 km radar, fast missile locks |

Each jet is a variant of the portfolio's procedural fighter builder (`src/entities/models/jets.js`).

### Weapons

| Category | Weapons |
|---|---|
| Guns | 20 mm rotary cannon (tracers, overheats), 30 mm HE autocannon, railgun (charge, hitscan, pierces up to 4 targets) |
| Air-to-air | IR heat-seeker (lock growl, flares decoy it), radar long-range (fire-and-forget, 4 locks), swarm pod (12 micro-missiles) |
| Anti-ship / strike | Sea-skimming anti-ship missile, TV-guided cruise missile (you steer it through its camera) |
| Air-to-ground | Rocket pods, laser-guided bomb, cluster bomb, bunker buster, napalm |
| Special | EMP burst, laser beam (drains energy), plasma cannon, deployable homing combat drone |
| Defence | Flares (always carried), chaff, ECM jammer, energy shield |

### Enemies

The roster covers dogfighting fighters and interceptors, red aces, stealth fighters, attack drones, bombers with defensive gunners, attack helicopters, SAM launchers, AA guns, tanks, trucks, radar stations, bunkers, fuel depots, frigates, destroyers, an aircraft carrier that launches fighters, and the Sky Fortress boss.

Enemy fighter AI pursues with lead, flanks to avoid head-on merges, breaks when someone is on its tail, extends after overshooting, and evades missiles by beaming them and popping flares. **Difficulty levels** (Recruit, Pilot, Veteran, Ace) change AI skill, accuracy, lock speed, how often they use flares, and how much damage you take.

Wingmen follow your commands: **attack my target**, **cover me** (engage threats near you) or **regroup** (fly formation).

### Progression

Missions and survival waves pay credits. Spend them in the **Hangar** on jets, paints, weapons, and three upgrade levels per weapon: damage, reload, and lock speed.

Progress, settings and the leaderboard are saved automatically in `localStorage`. **Settings → Gameplay → Export / Import save** copies your save to a file and back.

---

## Performance

The game is built to hold 60 FPS on a mid-range laptop with integrated graphics.

- **Fixed timestep:** physics and gameplay run at 60 Hz (`src/core/Loop.js`), separate from rendering. Rendering interpolates the previous and current states, so motion stays smooth when the frame rate dips. An optional frame cap gives a locked 60 on high-refresh screens.
- **No per-frame allocation:**
  - Units, bullets, missiles, bombs, decoys and fire zones come from pools.
  - AI controllers and loadouts are reused when a pooled aircraft respawns.
  - Hot paths use module-level scratch `Vector3`s and `Quaternion`s.
  - Bullets are structure-of-arrays typed arrays.
- **Few draw calls:** about one per effect type and per model LOD.
  - Every non-player unit is drawn with an `InstancedMesh` per model per LOD level.
  - Particles (fire and smoke) and debris are GPU-evaluated ring buffers: the CPU only writes a particle when it spawns.
  - Tracers, lasers and railgun beams are one instanced beam batch, and glows are one sprite batch.
- **Collision:** a spatial hash broad phase (`src/core/SpatialHash.js`) with sphere, then capsule, hitboxes for aircraft and ships. Bullets raycast the segment they travel each step, so they never tunnel. The railgun and laser are hitscan raycasts. There is no per-triangle collision.
- **LOD and culling:** two LOD levels per model with per-instance frustum culling, plus exponential fog that hides the view distance.
- **Web Worker AI:** once more than 24 aircraft and guided missiles are active, the AI brain and missile guidance (`src/entities/ai/brain.js`, pure functions over `Float32Array`s) move to `ai.worker.js`. The buffers are transferred back and forth with no copying. With fewer units the same code runs inline.
- **Quality presets** (Low, Medium, High, Ultra, plus GPU auto-detection) set render scale, shadows, bloom, particle and debris counts, terrain resolution, view distance, cloud count, explosion lights and LOD distances.
- **Adaptive resolution:** if FPS stays below target for 2 seconds, the render scale drops 10 % at a time (down to 50 %), then effect density drops. It recovers after a stable stretch.
- **F3 overlay:** FPS, frame time, sim and render CPU time, draw calls, triangles, GPU geometries and textures, JS heap, unit, bullet and particle counts, AI mode and worker latency, and adaptive changes.
- **Clean level changes:** each `Session` disposes its geometries, materials, textures, render targets, lights and the worker when it ends. After every menu → level → menu cycle, the renderer's geometry, texture and shader-program counts return exactly to the menu baseline.

### Stress test

Open `?stress` (60 AI aircraft that keep firing, AA guns, about 1,800 rounds in the air) and press F3, or run the headless benchmark:

```bash
npm run stress
```

Measured headlessly in this repo's CI-like container (Chromium with the SwiftShader software renderer), with the AI forced to run on the main thread (worst case):

| Scene | Sim CPU per 60 Hz step | Render CPU per frame | Draw calls |
|---|---|---|---|
| 72 enemies, ~1,800 bullets, 18k particles | 0.47 ms avg, 0.7 ms max | ~2.5 ms | ~30 |

These are CPU numbers. A software renderer cannot measure GPU frame rate, so check real FPS with `?stress` and F3 on your own hardware.

A 30-minute simulated soak of the stress scene (108,000 steps, AI on the main thread) showed no leaks:

- The JS heap stayed flat (15.08 MB at minute 5, 15.14 MB at minute 30, after GC).
- The pools never grew past their first high-water mark.
- GPU geometry and texture counts were identical at every check.

---

## Adding a new weapon

A weapon is **one config file** plus **one behaviour class**. Both folders are auto-registered with `import.meta.glob`, so nothing else needs editing.

1. Add a config in `src/config/weapons/`, for example `flakRockets.js`:

   ```js
   export default {
     id: 'flakRockets',          // unique id, also used in save data
     name: 'Flak Rocket Pod',
     short: 'FLAK',              // HUD label
     slot: 'secondary',          // 'gun' | 'secondary' | 'def'
     class: 'FlakRocketWeapon',  // file name in src/weapons/types/
     category: 'air-to-air',
     price: 3000,                // hangar price in credits
     description: 'Rockets that burst into flak near aircraft.',
     ammo: 24, reload: 0.3, damage: 18,
     // ...any parameters your class reads (speed, splash, model, sound, ...)
   };
   ```

2. Add the class in `src/weapons/types/FlakRocketWeapon.js`. The file name must match `class`:

   ```js
   import * as THREE from 'three';
   import { Weapon } from '../Weapon.js';

   const _pos = new THREE.Vector3();
   const _dir = new THREE.Vector3();

   export class FlakRocketWeapon extends Weapon {
     // Called every simulation step while selected.
     // trig = { held, pressed, released }
     update(dt, ctx, trig) {
       if (!trig.pressed || this.cooldown > 0 || !this.useAmmo(1)) return;
       this.cooldown = this.reloadTime;
       const o = this.owner;
       this.muzzle(_pos, _dir.set(0, -0.6, 0));        // aircraft-space offset → world
       _dir.set(0, 0, -1).applyQuaternion(o.quat);
       // Spawn pooled projectiles through ctx (the running Session):
       ctx.bullets.spawn(_pos.x, _pos.y, _pos.z, _dir.x * 700, _dir.y * 700, _dir.z * 700,
         3, this.damage, o.team, o, 4, 0, this.def, 0, /* proximity fuse */ 25);
       ctx.audio?.rocket();
     }
   }
   ```

Most new weapons need **no new class**: reuse `GunWeapon`, `MissileWeapon`, `RocketPodWeapon`, `BombWeapon` and the others with different numbers. The weapon then shows up in the hangar armoury (unlocked by buying it) and can be equipped in its slot. `this.damage`, `this.reloadTime` and `this.lockTime` already include the player's upgrades. `ctx` gives access to `bullets`, `ordnance` (missiles, bombs, drones, decoys), `combat` (hit and splash), `fx`, `audio`, `hash` (spatial queries) and `world` (terrain heights).

`scripts/weapons-scenario.mjs` fires every weapon headlessly as a smoke test:

```bash
npm run build && QS=?duel node scripts/shoot.mjs shots scripts/weapons-scenario.mjs
```

---

## Desktop app (double-click to play)

### Tauri (recommended: small, about 10 MB)

1. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/): Rust (`rustup`), plus WebView2 on Windows, Xcode Command Line Tools on macOS, or `webkit2gtk-4.1` and friends on Linux.
2. Build:

   ```bash
   npm run desktop:tauri          # runs `vite build`, then bundles the native app
   ```

   Installers and the executable end up in `src-tauri/target/release/bundle/`: `.msi` or `.exe` on Windows, `.app` or `.dmg` on macOS, `.deb`, `.AppImage` or `.rpm` on Linux. `npm run desktop:tauri:dev` opens the game in a native window with hot reload.

The first Tauri build downloads the Tauri CLI and Rust crates, so it needs the internet once. The finished app is fully offline.

### Electron (alternative)

```bash
npm run desktop:electron           # build, then run it in an Electron window
npm run desktop:electron:package   # build a double-clickable app in release/
```

`electron/main.cjs` serves `dist/` through a private `app://` protocol, so the ES modules and the AI worker load the same way they do in the browser.

Icons for both shells are generated from `public/icon.svg` with `npm run icons`.

---

## Project structure

```
src/
  main.js               entry: self-hosted fonts, boot
  core/                 Loop (fixed timestep), Input (remappable kb/mouse/gamepad), Audio (procedural
                        Web Audio), Pool, SpatialHash, PerfMonitor (F3 + adaptive), Save, math helpers
  config/               aircraft, enemies, missions, quality presets, controls, difficulty, upgrades,
                        weapons/*.js (one file per weapon)
  entities/             Unit, Aircraft + FlightModel, PlayerController, GroundUnit, Helicopter,
                        EntityManager, InstancedRenderer (LOD instancing)
    ai/                 brain.js (pure decision + guidance code), AIDirector, ai.worker.js
    projectiles/        Bullets (SoA, swept raycasts), Ordnance (missiles, bombs, drones, decoys)
    models/             procedural jets (from the portfolio), units, ships, boss, ordnance
  weapons/              Weapon base, Loadout, registry (auto-discovers config + classes), types/*.js
  world/                Sky, Clouds, Terrain, Water, World, HangarScene, Renderer (post-processing)
  fx/                   GPU particles, debris, glow and beam batches, afterburner, Effects facade
  game/                 Game (app shell), Session (one level), Combat, CameraRig, Targeting,
                        Warnings, Settings, modes/ (Mission, Survival, FreeFlight)
  ui/                   Hud (canvas 2D), Menus (DOM)
src-tauri/              Tauri v2 desktop shell
electron/               Electron desktop shell
scripts/                headless smoke tests, stress benchmark, icon generator
```

---

## Troubleshooting

- **Black screen or "Failed to start":** the browser needs WebGL2. Update the GPU driver or try Chrome or Edge.
- **Low FPS:** press F3. Choose a lower preset in Settings → Graphics, or lower the render scale. Adaptive resolution is on by default. Disabling browser extensions and closing other GPU-heavy tabs also helps.
- **The mouse doesn't steer:** click the game view to capture the mouse. If pointer lock isn't available, the aim follows the cursor position instead.
- **No sound:** browsers start audio only after a click or key press. Check the volume sliders in Settings → Audio.
- **Spoken radio** uses your operating system's offline voices (Settings → Audio → Spoken radio); it's off by default.

## Credits

The procedural fighter jet, panel-line skin shader, afterburner plume, sky, cloud billboards and post-processing chain are adapted from [reyhaan07/3D-portfolio](https://github.com/reyhaan07/3D-portfolio). The game uses [Three.js](https://threejs.org), [Vite](https://vite.dev), and the Barlow Condensed and JetBrains Mono fonts (OFL) via Fontsource, all bundled locally.
