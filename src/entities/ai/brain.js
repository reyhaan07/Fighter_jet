// AI decision making as pure functions over flat Float32Arrays, so the exact
// same code runs on the main thread (small fights) or inside a Web Worker
// (large waves). No allocation inside think().
//
// Aircraft snapshot (A_STRIDE floats per aircraft) → decisions (O_STRIDE).
// Missile snapshot (M_STRIDE) → desired heading (MO_STRIDE).

export const A_STRIDE = 32;
export const O_STRIDE = 10;
export const M_STRIDE = 16;
export const MO_STRIDE = 4;

export const A = {
  ID: 0, TEAM: 1, ROLE: 2, SKILL: 3, PX: 4, VX: 7, FX: 10, UX: 13, HP: 16, FLAGS: 17,
  THREAT: 18, CMD: 19, CMD_TARGET: 20, LEADER: 21, MODE: 22, TIMER: 23, GROUND: 24,
  TARGET: 25, WX: 26, GUN_RANGE: 29, MIS_RANGE: 30, SIG: 31,
};
export const ROLE = { FIGHTER: 0, BOMBER: 1, DRONE: 2, WINGMAN: 3, PLAYER: 4, HELI: 5 };
export const FLAG = { ALIVE: 1, GUN: 2, MISSILE: 4, PLAYER: 8, FLARES: 16 };
export const OUT = { GUN: 1, MISSILE: 2, FLARES: 4, AB: 8, BRAKE: 16 };
export const MODE = { PATROL: 0, PURSUE: 1, EVADE: 2, FLANK: 3, DEFEND: 4, EXTEND: 5, FORMATION: 6, PATH: 7, ORBIT: 8 };
export const CMD = { COVER: 0, ATTACK: 1, REGROUP: 2 };

const BULLET_SPEED = 950;

// Scratch (module scope, reused).
const d = new Float64Array(3);

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function findById(air, n, id) {
  if (id < 0) return -1;
  for (let j = 0; j < n; j++) if (air[j * A_STRIDE + A.ID] === id) return j;
  return -1;
}

function setDir(x, y, z) {
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  d[0] = x / l;
  d[1] = y / l;
  d[2] = z / l;
}

/** Picks the best hostile for aircraft i. Returns index or -1. */
function chooseTarget(air, n, i, focusIdx) {
  const o = i * A_STRIDE;
  const team = air[o + A.TEAM];
  const px = air[o + A.PX];
  const py = air[o + A.PX + 1];
  const pz = air[o + A.PX + 2];
  // Distance from the focus point (the leader when covering) instead of self.
  const fo = focusIdx >= 0 ? focusIdx * A_STRIDE : o;
  const fx = air[fo + A.PX];
  const fy = air[fo + A.PX + 1];
  const fz = air[fo + A.PX + 2];
  let best = -1;
  let bestScore = Infinity;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const q = j * A_STRIDE;
    if (air[q + A.TEAM] === team || !(air[q + A.FLAGS] & FLAG.ALIVE)) continue;
    const dx = air[q + A.PX] - fx;
    const dy = air[q + A.PX + 1] - fy;
    const dz = air[q + A.PX + 2] - fz;
    let s = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.3, air[q + A.SIG]);
    if (air[q + A.FLAGS] & FLAG.PLAYER) s *= 0.75; // the player draws aggro
    // Prefer targets in front of us.
    const ex = air[q + A.PX] - px;
    const ey = air[q + A.PX + 1] - py;
    const ez = air[q + A.PX + 2] - pz;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
    const front = (ex * air[o + A.FX] + ey * air[o + A.FX + 1] + ez * air[o + A.FX + 2]) / el;
    s *= 1.25 - front * 0.25;
    if (s < bestScore) {
      bestScore = s;
      best = j;
    }
  }
  return best;
}

/**
 * Runs one decision tick for every AI aircraft.
 * air/nAir: snapshot; out: decisions; time: sim time; dt: seconds since last tick.
 */
export function think(air, nAir, mis, nMis, out, misOut, time, dt, mapHalf) {
  for (let i = 0; i < nAir; i++) {
    const o = i * A_STRIDE;
    const r = i * O_STRIDE;
    out[r] = air[o + A.ID];
    const role = air[o + A.ROLE];
    if (role === ROLE.PLAYER || !(air[o + A.FLAGS] & FLAG.ALIVE)) {
      out[r + 5] = 0;
      continue;
    }
    thinkOne(air, nAir, mis, i, out, r, time, dt, mapHalf);
  }
  guideMissiles(mis, nMis, misOut);
}

function thinkOne(air, n, mis, i, out, r, time, dt, mapHalf) {
  const o = i * A_STRIDE;
  const role = air[o + A.ROLE];
  const skill = air[o + A.SKILL];
  const px = air[o + A.PX];
  const py = air[o + A.PX + 1];
  const pz = air[o + A.PX + 2];
  const vx = air[o + A.VX];
  const vy = air[o + A.VX + 1];
  const vz = air[o + A.VX + 2];
  const fx = air[o + A.FX];
  const fy = air[o + A.FX + 1];
  const fz = air[o + A.FX + 2];
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  const flagsIn = air[o + A.FLAGS];
  const id = air[o + A.ID];
  let mode = air[o + A.MODE];
  let timer = air[o + A.TIMER] - dt;
  let throttle = 0.85;
  let flags = 0;
  let targetId = air[o + A.TARGET];

  // ── Non-combat roles ──
  if (role === ROLE.BOMBER || role === ROLE.DRONE) {
    const wx = air[o + A.WX];
    const wy = air[o + A.WX + 1];
    const wz = air[o + A.WX + 2];
    if (role === ROLE.BOMBER) {
      setDir(wx - px, (wy - py) * 0.5, wz - pz);
      throttle = 0.9;
      mode = MODE.PATH;
    } else {
      // Lazy circuit around the waypoint (training targets).
      const rx = px - wx;
      const rz = pz - wz;
      const rl = Math.sqrt(rx * rx + rz * rz) || 1;
      const radius = 1400 + hash(id) * 900;
      const sgn = hash(id + 3) < 0.5 ? 1 : -1;
      const tx = (-rz / rl) * sgn + (rx / rl) * ((radius - rl) / radius) * 1.5;
      const tz = (rx / rl) * sgn + (rz / rl) * ((radius - rl) / radius) * 1.5;
      setDir(tx, ((wy + Math.sin(time * 0.2 + id) * 150 - py) / 600) * 0.6, tz);
      throttle = 0.7;
      mode = MODE.ORBIT;
    }
    finish(air, o, out, r, throttle, flags, -1, mode, timer, speed, py, mapHalf, px, pz);
    return;
  }

  // ── Fighters and wingmen ──
  const isWing = role === ROLE.WINGMAN;
  const leader = air[o + A.LEADER] | 0;
  const cmd = air[o + A.CMD];

  let ti = findById(air, n, targetId);
  if (ti >= 0 && !(air[ti * A_STRIDE + A.FLAGS] & FLAG.ALIVE)) ti = -1;
  if (isWing && cmd === CMD.ATTACK) {
    const ct = findById(air, n, air[o + A.CMD_TARGET]);
    if (ct >= 0) ti = ct;
  }
  // Re-evaluate targets every ~2 s (staggered per aircraft).
  const retarget = ((time + hash(id) * 2) % 2) < dt + 1e-4;
  if (ti < 0 || (retarget && !(isWing && cmd === CMD.ATTACK))) {
    const focus = isWing && cmd === CMD.COVER ? leader : -1;
    ti = chooseTarget(air, n, i, focus);
    if (isWing && cmd === CMD.COVER && ti >= 0 && leader >= 0) {
      // Only engage threats close to the leader.
      const q = ti * A_STRIDE;
      const lo = leader * A_STRIDE;
      const dx = air[q + A.PX] - air[lo + A.PX];
      const dy = air[q + A.PX + 1] - air[lo + A.PX + 1];
      const dz = air[q + A.PX + 2] - air[lo + A.PX + 2];
      if (dx * dx + dy * dy + dz * dz > 4500 * 4500) ti = -1;
    }
  }
  targetId = ti >= 0 ? air[ti * A_STRIDE + A.ID] : -1;

  // Wingman regroup / nothing to do → fly formation on the leader.
  if (isWing && (cmd === CMD.REGROUP || ti < 0) && leader >= 0) {
    const lo = leader * A_STRIDE;
    const lfx = air[lo + A.FX];
    const lfz = air[lo + A.FX + 2];
    const hl = Math.sqrt(lfx * lfx + lfz * lfz) || 1;
    const side = id % 2 === 0 ? 1 : -1;
    const slotX = air[lo + A.PX] + (-lfz / hl) * 60 * side - (lfx / hl) * 50;
    const slotZ = air[lo + A.PX + 2] + (lfx / hl) * 60 * side - (lfz / hl) * 50;
    const slotY = air[lo + A.PX + 1] - 8;
    const lvx = air[lo + A.VX];
    const lvy = air[lo + A.VX + 1];
    const lvz = air[lo + A.VX + 2];
    setDir(slotX + lvx * 2.5 - px, slotY + lvy * 2.5 - py, slotZ + lvz * 2.5 - pz);
    const along = (slotX - px) * (lfx / hl) + (slotZ - pz) * (lfz / hl);
    const ls = Math.sqrt(lvx * lvx + lvy * lvy + lvz * lvz);
    throttle = Math.max(0, Math.min(1, 0.6 + (ls - speed) * 0.02 + along * 0.004));
    if (along > 400) flags |= OUT.AB;
    if (along < -150) flags |= OUT.BRAKE;
    finish(air, o, out, r, throttle, flags, -1, MODE.FORMATION, timer, speed, py, mapHalf, px, pz);
    return;
  }

  // Incoming missile → evade (reaction depends on skill).
  const thr = air[o + A.THREAT] | 0;
  if (thr >= 0 && mode !== MODE.EVADE) {
    const m = thr * M_STRIDE;
    const dx = mis[m + 2] - px;
    const dy = mis[m + 3] - py;
    const dz = mis[m + 4] - pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const react = 1200 + skill * 2600;
    if (dist < react && hash(mis[m] * 7 + id) < 0.35 + skill * 0.65) {
      mode = MODE.EVADE;
      timer = 3 + skill * 1.5;
    }
  }

  if (mode === MODE.EVADE) {
    if (thr < 0 && timer < 1.5) timer = Math.min(timer, 0.5);
    if (thr >= 0) {
      const m = thr * M_STRIDE;
      const mvx = mis[m + 5];
      const mvz = mis[m + 7];
      const rx = px - mis[m + 2];
      const rz = pz - mis[m + 4];
      // Turn to put the missile on our beam (perpendicular), then dive.
      let bx = -mvz;
      let bz = mvx;
      if (bx * rx + bz * rz < 0) {
        bx = -bx;
        bz = -bz;
      }
      setDir(bx, -0.25, bz);
      const dist = Math.sqrt(rx * rx + rz * rz + (py - mis[m + 3]) ** 2);
      if (dist < 1600 && (flagsIn & FLAG.FLARES) && hash(Math.floor(time * 2) + id) < 0.25 + skill * 0.6) flags |= OUT.FLARES;
    } else setDir(fx, fy, fz);
    throttle = 1;
    flags |= OUT.AB;
    if (timer <= 0) {
      mode = MODE.PURSUE;
      timer = 0;
    }
    finish(air, o, out, r, throttle, flags, targetId, mode, timer, speed, py, mapHalf, px, pz);
    return;
  }

  if (ti < 0) {
    // Patrol: gentle circles around the area centre.
    const ang = time * 0.05 + hash(id) * 6.28;
    setDir(Math.cos(ang) * 3000 - px * 0.0003, (2200 - py) * 0.0005, Math.sin(ang) * 3000 - pz * 0.0003);
    finish(air, o, out, r, 0.7, 0, -1, MODE.PATROL, timer, speed, py, mapHalf, px, pz);
    return;
  }

  const q = ti * A_STRIDE;
  const tx = air[q + A.PX];
  const ty = air[q + A.PX + 1];
  const tz = air[q + A.PX + 2];
  const tvx = air[q + A.VX];
  const tvy = air[q + A.VX + 1];
  const tvz = air[q + A.VX + 2];
  const dx = tx - px;
  const dy = ty - py;
  const dz = tz - pz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const facing = (dx * fx + dy * fy + dz * fz) / dist; // target ahead of me?
  const tfx = air[q + A.FX];
  const tfy = air[q + A.FX + 1];
  const tfz = air[q + A.FX + 2];
  const threatening = -(dx * tfx + dy * tfy + dz * tfz) / dist; // target pointing at me?

  // Tactical mode changes.
  if (mode === MODE.PATROL || mode === MODE.FORMATION || mode === MODE.PATH || mode === MODE.ORBIT) mode = MODE.PURSUE;
  if (timer <= 0) {
    if (mode === MODE.FLANK || mode === MODE.DEFEND || mode === MODE.EXTEND) mode = MODE.PURSUE;
    if (mode === MODE.PURSUE) {
      if (dist < 1300 && facing < -0.3 && threatening > 0.85 && hash(time + id) < 0.3 + skill * 0.6) {
        mode = MODE.DEFEND; // bandit on my six
        timer = 2.5 + skill * 2;
      } else if (dist > 3500 && threatening > 0.75 && skill > 0.35 && hash(id + Math.floor(time / 8)) < skill) {
        mode = MODE.FLANK; // avoid a head-on merge
        timer = 8;
      } else if (dist < 250 && facing < 0) {
        mode = MODE.EXTEND; // overshot: extend and come back around
        timer = 3;
      } else timer = 1;
    }
  }

  if (mode === MODE.DEFEND) {
    // Hard break turn perpendicular to the attacker, alternating sides.
    const side = hash(id + Math.floor(time / 3)) < 0.5 ? 1 : -1;
    setDir(fx + -fz * side * 2, fy + 0.15, fz + fx * side * 2);
    throttle = 1;
    flags |= OUT.AB;
    if (dist < 900 && (flagsIn & FLAG.FLARES) && hash(Math.floor(time) * 3 + id) < 0.08 * skill) flags |= OUT.FLARES;
  } else if (mode === MODE.FLANK) {
    // Aim for a point off the target's flank.
    const hl = Math.sqrt(tfx * tfx + tfz * tfz) || 1;
    const side = hash(id) < 0.5 ? 1 : -1;
    setDir(tx + (-tfz / hl) * 1800 * side - px, ty + 300 - py, tz + (tfx / hl) * 1800 * side - pz);
    throttle = 1;
    if (dist < 2200) timer = 0;
  } else if (mode === MODE.EXTEND) {
    setDir(fx, fy * 0.5 + 0.1, fz);
    throttle = 1;
    flags |= OUT.AB;
  } else {
    // PURSUE with lead: aim where bullets will meet the target.
    const t = dist / (BULLET_SPEED + speed * 0.5);
    const err = (1 - skill) * 0.9;
    const wob = Math.sin(time * 1.7 + id) * err * 18;
    const ax = tx + tvx * t + wob;
    const ay = ty + tvy * t + Math.cos(time * 1.3 + id) * err * 12;
    const az = tz + tvz * t - wob;
    const adx = ax - px;
    const ady = ay - py;
    const adz = az - pz;
    setDir(adx, ady, adz);
    const aimDot = d[0] * fx + d[1] * fy + d[2] * fz;
    const gunRange = air[o + A.GUN_RANGE];
    const tol = 0.9993 - (1 - skill) * 0.002;
    if ((flagsIn & FLAG.GUN) && dist < gunRange && aimDot > tol) flags |= OUT.GUN;
    const misRange = air[o + A.MIS_RANGE];
    if ((flagsIn & FLAG.MISSILE) && dist > 500 && dist < misRange && facing > 0.9) flags |= OUT.MISSILE;
    // Energy management.
    const closing = ((tvx - vx) * dx + (tvy - vy) * dy + (tvz - vz) * dz) / dist;
    if (dist > 2500) {
      throttle = 1;
      if (dist > 4000) flags |= OUT.AB;
    } else if (dist < 600 && closing < -60 && skill > 0.3) {
      throttle = 0.3;
      if (closing < -120) flags |= OUT.BRAKE;
    } else throttle = 0.9;
  }

  // Too close: break off to avoid collisions.
  if (dist < 120 && facing > 0.3) setDir(fx + (air[o + A.UX] || 0), fy + 1, fz + (air[o + A.UX + 2] || 0));

  finish(air, o, out, r, throttle, flags, targetId, mode, timer, speed, py, mapHalf, px, pz);
}

/** Terrain avoidance, ceiling and map bounds, then writes the decision. */
function finish(air, o, out, r, throttle, flags, targetId, mode, timer, speed, py, mapHalf, px, pz) {
  const ground = air[o + A.GROUND];
  const clearance = py - ground;
  const safe = 220 + speed * 1.1;
  if (clearance < safe) {
    const k = 1 - clearance / safe;
    d[1] = Math.max(d[1], -0.1 + k * 1.2);
    setDir(d[0], d[1], d[2]);
    if (clearance < safe * 0.4) flags &= ~OUT.BRAKE;
  } else if (clearance < safe * 2.2 && d[1] < -0.25) {
    setDir(d[0], -0.25, d[2]);
  }
  if (py > 9000 && d[1] > 0) setDir(d[0], 0, d[2]);
  const lim = mapHalf * 0.8;
  if (Math.abs(px) > lim || Math.abs(pz) > lim) {
    const k = Math.min(1, (Math.max(Math.abs(px), Math.abs(pz)) - lim) / 1500);
    setDir(d[0] * (1 - k) - px * k * 0.001, d[1], d[2] * (1 - k) - pz * k * 0.001);
  }
  out[r + 1] = d[0];
  out[r + 2] = d[1];
  out[r + 3] = d[2];
  out[r + 4] = throttle;
  out[r + 5] = flags;
  out[r + 6] = targetId;
  out[r + 7] = mode;
  out[r + 8] = timer;
  air[o + A.MODE] = mode;
  air[o + A.TIMER] = timer;
  air[o + A.TARGET] = targetId;
}

/**
 * Missile guidance (lead pursuit / proportional navigation equivalent).
 * Snapshot: id, team, pos3, vel3, tpos3, tvel3, nav, hasTarget
 */
export function guideMissiles(mis, n, out) {
  for (let k = 0; k < n; k++) {
    const m = k * M_STRIDE;
    const o = k * MO_STRIDE;
    out[o] = mis[m];
    const vx = mis[m + 5];
    const vy = mis[m + 6];
    const vz = mis[m + 7];
    if (mis[m + 15] < 0) {
      const l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      out[o + 1] = vx / l;
      out[o + 2] = vy / l;
      out[o + 3] = vz / l;
      continue;
    }
    const rx = mis[m + 8] - mis[m + 2];
    const ry = mis[m + 9] - mis[m + 3];
    const rz = mis[m + 10] - mis[m + 4];
    const rvx = mis[m + 11] - vx;
    const rvy = mis[m + 12] - vy;
    const rvz = mis[m + 13] - vz;
    const dist = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    const closing = Math.max(80, -(rx * rvx + ry * rvy + rz * rvz) / dist);
    const tgo = Math.min(dist / closing, 6) * mis[m + 14];
    let ax = rx + mis[m + 11] * tgo;
    let ay = ry + mis[m + 12] * tgo;
    let az = rz + mis[m + 13] * tgo;
    const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= l;
    ay /= l;
    az /= l;
    out[o + 1] = ax;
    out[o + 2] = ay;
    out[o + 3] = az;
  }
}
