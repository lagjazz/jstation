// Data integrity + balance invariants. These are the rules the v3 balance
// pass was built on — if a tuning edit breaks one, the campaign regresses
// to "the boss cannot be killed with the ammo you are given".
import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/dom.mjs';
import * as C from '../../js/config.js';
import { SPAWN_POOLS } from '../../js/enemy.js';
import { PERKS } from '../../js/progression.js';

const OBJ = Object.keys(C.OBJECTIVES);

test('15 missions, each well-formed', () => {
  assert.equal(C.MISSIONS.length, 15);
  for (const m of C.MISSIONS) {
    assert.ok(m.name1 && m.name2 && m.desc && m.zh, m.name1);
    assert.ok(Number.isFinite(m.spawn.x) && Number.isFinite(m.spawn.z));
    assert.ok(m.objectives.length >= 1);
    for (const o of m.objectives) assert.ok(OBJ.includes(o), `${m.name1}: unknown objective ${o}`);
    for (const cls of [...m.roster, ...(m.specials ?? []), ...(m.boss ? [m.boss] : [])]) {
      assert.ok(C.ENEMY.classes[cls], `${m.name1}: unknown class ${cls}`);
    }
    assert.equal(m.waves.reduce((a, n) => a + n, 0), m.enemyCount, `${m.name1}: waves must sum to enemyCount`);
    if (m.objectives.includes('assassinate')) assert.ok(m.boss, `${m.name1}: assassinate needs a boss`);
  }
});

test('every enemy class has XP and sane stats', () => {
  for (const [name, c] of Object.entries(C.ENEMY.classes)) {
    assert.ok(C.PROGRESSION.xp[name] > 0, `${name}: no XP entry`);
    const burst = c.burst ?? C.ENEMY.burst, gap = c.fireGap ?? C.ENEMY.fireGap;
    assert.ok(burst[0] >= 1 && burst[1] >= burst[0], name);
    assert.ok(gap[0] > 0 && gap[1] >= gap[0], name);
    assert.ok((c.damageMin ?? C.ENEMY.damageMin) <= (c.damageMax ?? C.ENEMY.damageMax), name);
  }
});

test('weapons: starting loadout exists, reserves fit under their caps', () => {
  for (const k of C.WEAPON_ORDER) assert.ok(C.WEAPONS[k], k);
  for (const k of C.STARTING_WEAPONS) assert.ok(C.WEAPON_ORDER.includes(k));
  for (const w of Object.values(C.WEAPONS)) {
    assert.ok(w.reserve <= w.reserveMax, w.key);
    assert.ok(w.mag > 0 && w.rpm > 0 && w.reloadTime > 0, w.key);
  }
});

test('BALANCE: the starting rifle alone can kill every boss with half its ammo', () => {
  const rifle = C.WEAPONS.rifle;
  const budget = (rifle.mag + rifle.reserve) * rifle.damage * 0.5;   // 50 % accuracy, body shots only
  C.MISSIONS.forEach((m, idx) => {
    if (!m.boss) return;
    const cls = C.ENEMY.classes[m.boss];
    const hp = C.ENEMY.hp * cls.hpMul * (m.elite ? C.ENEMY.eliteHpMultiplier : 1) * (1 + idx * 0.025) * (m.bossHpMul ?? 1);
    assert.ok(hp < budget, `${m.name1}: boss ${Math.round(hp)} hp vs rifle budget ${Math.round(budget)}`);
  });
});

test('BALANCE: the first commander is a lesson, not a wall', () => {
  const idx = C.MISSIONS.findIndex((m) => m.boss);
  const m = C.MISSIONS[idx];
  const hp = C.ENEMY.hp * C.ENEMY.classes[m.boss].hpMul * (m.elite ? C.ENEMY.eliteHpMultiplier : 1) * (1 + idx * 0.025) * (m.bossHpMul ?? 1);
  assert.ok(hp <= 800, `first boss has ${Math.round(hp)} hp`);
  assert.ok(!C.MISSIONS[0].elite && !C.MISSIONS[1].elite && !C.MISSIONS[2].elite, 'no all-elite missions in the opening act');
});

test('BALANCE: a rifle hostile dies to one magazine at 40 % accuracy; player survives several bursts', () => {
  const rifle = C.WEAPONS.rifle;
  assert.ok(C.ENEMY.hp <= rifle.mag * rifle.damage * 0.4);
  const worstBurst = C.ENEMY.damageMax * 1.25;                       // roundScale caps a trigger pull at 1.25× the listed damage
  assert.ok(C.PLAYER.maxHp / worstBurst >= 6, 'at least six full rifle-class bursts to go down');
  assert.ok(C.ENEMY.hitChance <= 0.6);
});

test('DIRECTOR: pacing rules are internally consistent', () => {
  const D = C.DIRECTOR;
  assert.ok(D.tokens >= 1 && D.tokensMax >= D.tokens);
  assert.ok(D.maxAlive >= 2 && D.maxAliveCap >= D.maxAlive);
  assert.ok(D.respawnHidden <= D.respawnGrace, 'never visible while still shielded-less… and never hidden longer than shielded');
  assert.ok(D.respawnMinDist > D.spawnMinDist - 1);
  assert.ok(D.mercyFloor > 0 && D.mercyFloor < 1 && D.mercyPerDeath > 0);
  assert.ok(D.pityAmmoChance > C.DROPS.ammoChance && D.pityMedChance > C.DROPS.medkitChance);
  // the opening wave must fit under the head-count cap of mission 1
  assert.ok(C.MISSIONS[0].waves[0] <= D.maxAlive);
  for (const o of ['survive', 'defend', 'capture']) assert.ok(C.OBJECTIVES[o].maxAlive <= D.maxAliveCap);
});

test('spawn pools: station areas have enough far anchors for a wave', () => {
  for (const m of C.MISSIONS.slice(0, 3)) {
    const pool = SPAWN_POOLS[m.area];
    assert.ok(pool.length >= 6, m.area);
    const far = pool.filter((a) => Math.hypot(a.pos[0] - m.spawn.x, a.pos[1] - m.spawn.z) > C.DIRECTOR.spawnMinDist);
    assert.ok(far.length >= 3, `${m.area}: only ${far.length} anchors beyond spawnMinDist`);
    for (const a of pool) assert.ok(a.wps.length >= 2);
  }
});

test('quality presets + perks are complete', () => {
  for (const q of ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']) assert.ok(C.QUALITY_PRESETS[q].lightBudget > 0);
  assert.ok(PERKS.length >= 10);
  assert.equal(new Set(PERKS.map((p) => p.id)).size, PERKS.length);
});
