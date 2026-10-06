import { TEAM } from '../entities/Unit.js';

// Damage, kills, splash damage and scoring. Every hit in the game goes
// through hit(); every death goes through kill(). The Session listens to the
// emitted events for HUD feedback, mission objectives, audio and rewards.

export class Combat {
  constructor(session) {
    this.s = session;
    this.events = session.events;
    this._splash = { x: 0, y: 0, z: 0, r: 0, dmg: 0, src: null, team: 0, weapon: null, skip: null, self: this };
  }

  /** Damage a unit. Returns true if the unit died from this hit. */
  hit(u, dmg, source, x, y, z, weapon = null) {
    if (!u.alive) return false;
    const s = this.s;
    // Difficulty: how hard enemies hit the player's team.
    if (u.team === TEAM.FRIEND && source && source.team === TEAM.ENEMY) dmg *= s.difficulty.damageTaken;
    if (weapon?.vsArmor !== undefined && u.armored) dmg *= weapon.vsArmor;
    else if (u.armored && !weapon?.antiArmor) dmg *= 0.35;
    if (weapon?.vsShip && u.kind === 'sea') dmg *= weapon.vsShip;
    if (weapon?.vsAir !== undefined && u.isAir) dmg *= weapon.vsAir;
    if (u.invulnerable) {
      this.events.emit('deflect', u, x, y, z);
      return false;
    }
    if (u.shieldActive > 0) {
      s.fx.shieldHit(x, y, z);
      this.events.emit('shieldHit', u);
      return false;
    }
    u.lastHitBy = source;
    u.lastHitTime = s.time;
    const killed = u.applyDamage(dmg);
    this.events.emit('hit', u, dmg, source, x, y, z);
    if (killed) this.kill(u, source, weapon?.id || 'weapon');
    return killed;
  }

  /** Area damage with linear falloff. */
  splash(x, y, z, radius, dmg, source, team, weapon = null, skip = null) {
    const c = this._splash;
    c.x = x;
    c.y = y;
    c.z = z;
    c.r = radius;
    c.dmg = dmg;
    c.src = source;
    c.team = team;
    c.weapon = weapon;
    c.skip = skip;
    this.s.hash.query(x, y, z, radius, splashVisit, c);
    c.src = c.weapon = c.skip = null;
  }

  kill(u, killer, cause) {
    if (!u.alive) return;
    const s = this.s;
    u.hp = 0;
    if (u.onDeath) u.onDeath(s, killer);
    if (u.isAir && u.kind === 'air' && cause !== 'ground' && !u.noFall && u.startDying) {
      u.startDying();
    } else {
      u.alive = false;
      this.finalExplosion(u);
    }
    this.events.emit('kill', u, killer, cause);
  }

  /** The final blast that removes a unit from the world. */
  finalExplosion(u) {
    const s = this.s;
    const p = u.pos;
    const size = u.def.explosion ?? Math.max(10, u.radius * 1.4);
    const water = u.kind === 'sea' || (p.y < 8 && s.world.heightAt(p.x, p.z) <= 0);
    s.fx.explosion(p.x, p.y, p.z, size, { water });
    if (!u.isAir || p.y - s.world.surfaceAt(p.x, p.z) < 6) s.fx.wreck(p.x, Math.max(p.y, s.world.surfaceAt(p.x, p.z)), p.z, Math.min(30, size * 0.8), u.kind === 'sea' ? 35 : 22);
    s.audio?.explosion(p, size);
    const d = p.distanceTo(s.camera.position);
    s.cameraRig.shake(Math.min(0.9, (size * 10) / Math.max(d, 30)));
    if (u.def.blastDamage) this.splash(p.x, p.y, p.z, u.def.blastRadius || size * 2, u.def.blastDamage, u, -1);
    this.events.emit('destroyed', u);
    s.entities.remove(u);
  }
}

function splashVisit(u, c) {
  if (!u.alive || u === c.skip || (u.team === c.team && u !== c.src) || u === c.src) return;
  const dx = u.pos.x - c.x;
  const dy = u.pos.y - c.y;
  const dz = u.pos.z - c.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - u.radius;
  if (d > c.r) return;
  const k = d <= 0 ? 1 : 1 - d / c.r;
  c.self.hit(u, c.dmg * k, c.src, u.pos.x, u.pos.y, u.pos.z, c.weapon);
}
