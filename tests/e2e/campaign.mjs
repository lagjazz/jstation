// End-to-end campaign check: boots the real game in headless Chrome,
// arms all 15 missions, plays a few seconds of each and asserts the
// invariants of the pacing / level-dressing work. Self-contained: serves
// the repo itself.   npm run test:e2e   (CHROME_PATH overrides the browser)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const CHROME = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/snap/bin/chromium'].find((p) => fs.existsSync(p));

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/404|Failed to load/.test(t)) errors.push(t.slice(0, 200)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.GAME && window.GAME.state === 'start', null, { timeout: 300000 });

  const report = await page.evaluate(async () => {
    const G = window.GAME;
    await G.startGame();
    G.state = 'playing';
    const out = { missions: [], detail: 0, dress: {} };
    G.scene.traverse((o) => { if (o.isMesh && o.material?.userData?.detail) out.detail++; });
    for (const [k, v] of Object.entries(G.arenaDress.layouts)) out.dress[k] = v.length;
    out.skyline = G.skyline.stats;
    for (let mi = 0; mi < 15; mi++) {
      G.missionIdx = mi; G._attempts = {}; G._setupMission(); G.state = 'playing';
      const m = G._mission();
      const row = { n: mi + 1, area: m.area, obj: G.objectives.type, firstObj: m.objectives[0], cap: G.director.maxAlive(), tokens: G.director.tokens(), maxAlive: 0, maxShooters: 0, caches: G.pickups.drops.filter((d) => d.keep).length };
      const sp = G.player.feet.clone();
      row.opening = G.enemyMgr.enemies.length;
      row.nearestAtStart = Math.min(99, ...G.enemyMgr.enemies.map((e) => e.group.position.distanceTo(sp)));
      for (let i = 0; i < 200; i++) {
        G.player.controls.isLocked = true;
        G._update(0.05);
        row.maxAlive = Math.max(row.maxAlive, G.enemyMgr.aliveCount());
        row.maxShooters = Math.max(row.maxShooters, G.director.shooters());
      }
      // going down must redeploy safely
      G.director.graceT = 0;
      G.player.hp = 1;
      G._damagePlayer(999, G.enemyMgr.enemies.find((e) => e.alive) ?? null);
      const live = G.enemyMgr.enemies.filter((e) => e.alive);
      row.afterDown = { hp: G.player.hp, shielded: G.director.shielded, nearest: live.length ? Math.min(...live.map((e) => e.group.position.distanceTo(G.player.feet))) : 99 };
      const hp = G.player.hp;
      G._damagePlayer(50, live[0] ?? null);
      row.graceHolds = G.player.hp === hp;
      G.renderer.info.reset(); G.composer.render();
      row.calls = G.renderer.info.render.calls;
      out.missions.push(row);
    }
    return out;
  });

  check(errors.length === 0, `page errors: ${errors.slice(0, 3).join(' | ')}`);
  check(report.detail > 200, `surface detail only on ${report.detail} meshes`);
  check(report.skyline.towers > 20, 'skyline missing');
  for (const r of report.missions) {
    const tag = `M${r.n} ${r.area}`;
    check(r.obj === r.firstObj, `${tag}: first attempt should play the authored objective`);
    check(r.maxAlive <= r.cap, `${tag}: ${r.maxAlive} alive > cap ${r.cap}`);
    check(r.maxShooters <= r.tokens, `${tag}: ${r.maxShooters} shooters > ${r.tokens} tokens`);
    check(r.caches >= 2, `${tag}: only ${r.caches} supply caches`);
    check(r.nearestAtStart > 8, `${tag}: a hostile starts ${r.nearestAtStart.toFixed(1)} m from the entry`);
    check(r.afterDown.hp >= 80 && r.afterDown.shielded, `${tag}: redeploy did not heal/shield`);
    // unseeded spawns: on the narrow platform the farthest free point can be ~10 m out
    check(r.afterDown.nearest > 8, `${tag}: redeployed ${r.afterDown.nearest.toFixed(1)} m from a hostile`);
    check(r.opening > 0, `${tag}: no opening wave`);
    check(r.graceHolds, `${tag}: took damage during grace`);
    check(r.calls < 1500, `${tag}: ${r.calls} draw calls`);
    if (!['hall', 'platform', 'garden'].includes(r.area)) check((report.dress[r.area] ?? 0) >= 6, `${tag}: ${report.dress[r.area] ?? 0} cover islands`);
    console.log(`${tag.padEnd(14)} ${r.obj.padEnd(11)} alive ${r.maxAlive}/${r.cap}  shooters ${r.maxShooters}/${r.tokens}  caches ${r.caches}  redeploy ${r.afterDown.nearest.toFixed(0)} m  calls ${r.calls}`);
  }
} catch (err) {
  fails.push(`harness: ${err.message}`);
} finally {
  await browser.close();
  server.close();
}
if (fails.length) {
  console.error(`\nFAILED (${fails.length})\n - ${fails.join('\n - ')}`);
  process.exit(1);
}
console.log('\nE2E OK — 15 missions');
