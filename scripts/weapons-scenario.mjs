export default async ({ page, shot }) => {
  const res = await page.evaluate(async () => {
    const g = window.__game, s = g.session;
    g.loop.stop();
    const p = s.player;
    p.hp = p.maxHp = 1e9;
    const Loadout = p.loadout.constructor;
    const inp = g.input;
    const script = { down: new Set(), pressed: new Set() };
    inp.down = (a) => script.down.has(a);
    inp.value = (a) => (script.down.has(a) ? 1 : 0);
    inp.pressed = (a) => script.pressed.has(a);
    const results = {};
    const ids = ['cannon20','cannon30','railgun','irMissile','radarMissile','swarmMissile','antiShipMissile','cruiseMissile','rocketPod','lgb','clusterBomb','bunkerBuster','napalm','emp','laser','plasmaCannon','homingDrone','chaff','ecm','shield'];
    for (const id of ids) {
      // Level the jet at 1500 m and put targets ahead.
      p.pos.set(0, 1500, 4000); p.quat.identity(); p.vel.set(0, 0, -200); p.flight.angVel.set(0,0,0);
      s.controller.reset(p);
      const air = s.entities.spawnAir('drone', 1, 40, 1520, 2700, Math.PI, { waypoint: { x: 40, y: 1520, z: 2700 } });
      const gz = 1500;
      const ground = s.world.surfaceAt(0, gz);
      const tk = s.entities.spawnGround('tank', 1, 0, gz, 0, {});
      const sea = s.world.terrain.findSea(0, 0, 9000) || { x: 200, z: gz - 400 }; const sh = s.entities.spawnGround('frigate', 1, sea.x, sea.z, 0, { y: 0 });
      const isGun = ['cannon20','cannon30','railgun'].includes(id);
      const isDef = ['chaff','ecm','shield'].includes(id);
      const a2g = ['rocketPod','lgb','clusterBomb','bunkerBuster','napalm','cruiseMissile'].includes(id);
      let err = null, fired = 0;
      const hits = { air: 0, tank: 0, ship: 0 };
      const off = s.events.on('hit', (u) => { if (u === air) hits.air++; if (u === tk) hits.tank++; if (u === sh) hits.ship++; });
      try {
        p.loadout = new Loadout(p, { gun: isGun ? id : 'cannon20', s1: isGun || isDef ? 'irMissile' : id, def: isDef ? id : 'chaff', flares: 'flares' }, {});
        for (let i = 0; i < 420; i++) {
          const tgt = id === 'antiShipMissile' ? sh : a2g || id === 'emp' ? tk : air;
          if (tgt.alive) { s.targeting.current = tgt; s.controller.aimDir.copy(tgt.pos).sub(p.pos).normalize(); }
          script.down.clear(); script.pressed.clear();
          const ph = i % 90;
          if (isGun) { if (ph < 70) script.down.add('fireGun'); }
          else if (isDef) { if (ph === 5) script.pressed.add('defense'); }
          else {
            const hold = id === 'laser' || id === 'plasmaCannon' || id === 'rocketPod';
            const w = p.loadout.current;
            const needLock = ['irMissile','radarMissile','antiShipMissile'].includes(id);
            const ok = !needLock || (w.locks && w.locks.length > 0);
            if (ok && (hold ? ph < 60 : ph === 60 || (needLock && ph % 20 === 0))) { script.down.add('fireSecondary'); script.pressed.add('fireSecondary'); }
          }
          s.step(1 / 60);
          if (i % 60 === 0) s.render(1 / 60, 0.5);
        }
      } catch (ex) { err = String(ex.stack || ex).slice(0, 400); }
      off();
      results[id] = { err, hits, air: air.alive ? Math.round(air.hp) : 'dead', tank: tk.alive ? Math.round(tk.hp) : 'dead', ship: sh.alive ? Math.round(sh.hp) : 'dead', ammo: p.loadout.current?.ammo ?? null, def: p.loadout.defense?.status };
      if (s.ordnance.cruise) s.ordnance.detonate(s.ordnance.cruise, null);
      s.ordnance.clear(); s.bullets.clear();
      for (const u of [air, tk, sh]) if (u.active) s.entities.remove(u);
      p.ecm = 0; p.shieldActive = 0;
    }
    return results;
  });
  for (const [k, v] of Object.entries(res)) console.log('[test]', k.padEnd(16), JSON.stringify(v));
};
