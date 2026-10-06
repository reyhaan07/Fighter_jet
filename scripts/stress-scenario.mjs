export default async ({ page, shot }) => {
  await page.keyboard.press('F3');
  const r = await page.evaluate(async () => {
    const g = window.__game, s = g.session;
    g.loop.stop(); s.ai.worker?.terminate(); s.ai.worker = null; s.ai.workerFailed = true; s.ai.inflight = false;
    s.player.hp = s.player.maxHp = 1e9; // stay alive for the benchmark
    // Warm up: let the battle develop.
    for (let i = 0; i < 300; i++) s.step(1 / 60);
    const samples = [];
    let maxBullets = 0, minEnemies = 1e9, maxOrd = 0;
    for (let k = 0; k < 10; k++) {
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) {
        s.step(1 / 60);
        maxBullets = Math.max(maxBullets, s.bullets.count);
        maxOrd = Math.max(maxOrd, s.ordnance.active.length);
      }
      samples.push((performance.now() - t0) / 60);
      let e = 0; for (const u of s.entities.units) if (u.alive && u.team === 1) e++;
      minEnemies = Math.min(minEnemies, e);
      await new Promise((r) => setTimeout(r, 0));
    }
    // CPU cost of one rendered frame (scene graph, instancing, HUD) — GPU time excluded.
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) s.render(1 / 60, 0.5);
    const renderMs = (performance.now() - t1) / 10;
    const info = g.renderer.renderer.info.render;
    return { stepMsAvg: (samples.reduce((a, b) => a + b) / samples.length).toFixed(3), stepMsMax: Math.max(...samples).toFixed(3), maxBullets, maxOrd, minEnemies, renderCpuMs: renderMs.toFixed(2), drawCalls: info.calls, tris: info.triangles, particles: s.fx.fire.emitted + s.fx.smoke.emitted, heapMB: performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) : '?' };
  });
  console.log('[test]', JSON.stringify(r, null, 1));
  await page.evaluate(() => window.__game.loop.start());
  await page.waitForTimeout(1500);
  await shot('s3_stress');
};
