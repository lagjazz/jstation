// Gameplay rules of the v3 pacing pass, exercised on the real Enemy /
// EnemyManager code (headless: no renderer, canvas stubbed).
import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/dom.mjs';
import * as THREE from 'three';
import { Enemy, EnemyManager, ESTATE, SPAWN_POOLS } from '../../js/enemy.js';
import { DIRECTOR, ENEMY, MISSIONS } from '../../js/config.js';
import { Director } from '../../js/director.js';
import { ColliderWorld } from '../../js/collision.js';
import { enemyCtx, run } from '../helpers/world.mjs';

const mission = (over = {}) => ({ ...MISSIONS[0], ...over });
const mgr = () => new EnemyManager(new THREE.Scene(), new ColliderWorld());
const alive = (m) => m.enemies.filter((e) => e.alive);
const kill = (e, ctx) => e.applyDamage(1e6, 'body', 0, 1, { director: ctx.director, onKilled() {} });

test('deploy: the opening wave is on the field at once, the rest is still to come', () => {
  const m = mgr();
  m.deploy(mission({ enemyCount: 5, waves: [2, 3] }));
  assert.equal(m.aliveCount(), 2);
  assert.equal(m.remaining(), 5);
  assert.equal(m.waveInfo().total, 2);
  for (const e of m.enemies) {
    const d = Math.hypot(e.group.position.x - MISSIONS[0].spawn.x, e.group.position.z - MISSIONS[0].spawn.z);
    assert.ok(d > 10, `opening hostile ${d.toFixed(1)} m from the entry`);
  }
});

test('reinforcements walk in one at a time, far away, never past the head-count cap', () => {
  const m = mgr();
  const sp = MISSIONS[0].spawn;
  const ctx = enemyCtx({ px: sp.x, pz: sp.z });
  ctx.playerHidden = true;                      // nobody engages: pure spawn pacing
  m.deploy(mission({ enemyCount: 12, waves: [3, 3, 3, 3], waveGap: [0.5, 0.6] }));
  const cap = ctx.director.maxAlive();
  let maxAlive = 0, maxJump = 0, last = m.aliveCount(), minD = Infinity;
  const seen = new Set(m.enemies);
  let kills = 0;
  run(1200, (dt, i) => {
    // the next wave only launches once the field has room (≤ cap − 2 alive):
    // thin the squad now and then, the way a player would
    if (i % 60 === 59 && m.aliveCount() > 1 && kills < 6) { kill(alive(m)[0], ctx); kills++; }
    last = m.aliveCount();
    m.update(dt, ctx);
    const n = m.aliveCount();
    maxAlive = Math.max(maxAlive, n);
    maxJump = Math.max(maxJump, n - last);
    for (const e of m.enemies) if (!seen.has(e)) {
      seen.add(e);
      minD = Math.min(minD, Math.hypot(e.group.position.x - sp.x, e.group.position.z - sp.z));
    }
  });
  assert.ok(maxAlive <= cap, `alive ${maxAlive} > cap ${cap}`);
  assert.equal(maxJump, 1, 'arrivals are staggered');
  assert.ok(minD >= DIRECTOR.spawnMinDist - 3, `a reinforcement appeared ${minD.toFixed(1)} m from the player`);
  assert.equal(m.remaining() + kills, 12, 'queue + waves + alive always add up');
  assert.ok(seen.size > 3, 'reinforcements did arrive');
});

test('the queue drains as the field is cleared and the mission can always finish', () => {
  const m = mgr();
  const sp = MISSIONS[0].spawn;
  const ctx = enemyCtx({ px: sp.x, pz: sp.z });
  ctx.playerHidden = true;
  m.deploy(mission({ enemyCount: 9, waves: [3, 3, 3], waveGap: [0.5, 0.6] }));
  let steps = 0;
  while (m.remaining() > 0 && steps++ < 4000) {
    m.update(0.05, ctx);
    if (steps % 20 === 0) for (const e of alive(m)) kill(e, ctx);
  }
  assert.equal(m.remaining(), 0);
  assert.equal(m.waveInfo().current, 3);
});

test('assassinate flow: the boss is counted, scaled by bossHpMul, and its death clears it', () => {
  const m = mgr();
  const ctx = enemyCtx({ px: MISSIONS[2].spawn.x, pz: MISSIONS[2].spawn.z });
  ctx.playerHidden = true;
  const phases = [];
  ctx.onBossPhase = (p) => phases.push(p);
  m.deploy(MISSIONS[2], { bossNow: true, boss: 'commander' });
  assert.ok(m.boss && m.boss.boss);
  assert.ok(Math.abs(m.boss.maxHp - ENEMY.hp * ENEMY.classes.commander.hpMul * MISSIONS[2].bossHpMul) < 1);
  const before = m.remaining();
  m.boss.hp = m.boss.maxHp * 0.6;
  m.update(0.05, ctx);
  assert.deepEqual(phases, [1], 'phase call at 66 %');
  assert.equal(m.remaining(), before + 2, 'two escorts queued');
  m.boss.hp = m.boss.maxHp * 0.2;
  m.update(0.05, ctx);
  assert.deepEqual(phases, [1, 2]);
  kill(m.boss, ctx);
  m.update(0.05, ctx);
  assert.equal(m.boss, null);
  assert.ok(m.bossKilled);
});

test('attack tokens: a whole squad in ATTACK never has more shooters than slots', () => {
  const m = mgr();
  const ctx = enemyCtx({ px: 0, pz: 0 });
  m.deploy(mission({ enemyCount: 3, waves: [3] }));
  for (let i = 0; i < 3; i++) m._spawnOne('rifle', i % SPAWN_POOLS.hall.length, null);
  const squad = alive(m);
  squad.forEach((e, i) => {
    const a = (i / squad.length) * Math.PI * 2;
    e.group.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9);
    e.state = ESTATE.ATTACK;
    e.reactT = 0;
    e.fireCd = 0;
  });
  let maxShooters = 0, shots = 0;
  const fired = new Set();
  run(400, (dt) => {
    for (const e of squad) { e.update(dt, ctx); if (e.state !== ESTATE.ATTACK) e.state = ESTATE.ATTACK; }
    ctx.director.update(dt);
    const busy = squad.filter((e) => e.burstLeft > 0 || e.chargeT > 0);
    maxShooters = Math.max(maxShooters, busy.length);
    for (const e of busy) fired.add(e);
    shots = ctx.hits.length;
  });
  assert.ok(maxShooters <= ctx.director.tokens(), `${maxShooters} hostiles firing with ${ctx.director.tokens()} slots`);
  assert.ok(maxShooters >= 1, 'they do shoot');
  assert.ok(fired.size >= 4, `slots rotate through the squad (only ${fired.size} of ${squad.length} ever fired)`);
  assert.ok(shots > 0, 'and they do hit a stationary player');
});

test('nobody engages a hidden player (opening calm / redeploy)', () => {
  const m = mgr();
  const ctx = enemyCtx({ px: -30, pz: -9 });
  m.deploy(mission({ enemyCount: 3, waves: [3] }));
  ctx.playerHidden = true;
  for (const e of m.enemies) e.group.position.set(-30 + 3, 0, -9);
  run(100, (dt) => m.update(dt, ctx));
  assert.ok(m.enemies.every((e) => !e.inCombat));
  assert.equal(ctx.hits.length, 0);
});

test('stagger: a headshot cuts the burst, frees the slot and the soldier recovers', () => {
  const ctx = enemyCtx();
  const e = new Enemy(0, new THREE.Scene(), null, [[5, 5], [6, 6]], { cls: 'rifle' });
  e.group.position.set(8, 0, 0);
  e.state = ESTATE.ATTACK;
  e.burstLeft = 3;
  ctx.director.requestFire(e, 5);
  assert.equal(ctx.director.shooters(), 1);
  e.applyDamage(5, 'head', 0, 1, { director: ctx.director });
  assert.equal(e.state, ESTATE.HIT);
  assert.equal(e.burstLeft, 0);
  assert.equal(ctx.director.shooters(), 0);
  run(Math.ceil(DIRECTOR.stagger.time / 0.05) + 2, (dt) => e.update(dt, ctx));
  assert.notEqual(e.state, ESTATE.HIT, 'recovers after the stagger window');
  // a light body hit does not stagger an attacker
  e.state = ESTATE.ATTACK;
  e.applyDamage(5, 'body', 0, 1, { director: ctx.director });
  assert.equal(e.state, ESTATE.ATTACK);
  // bosses shrug it off
  const boss = new Enemy(1, new THREE.Scene(), null, [[5, 5]], { cls: 'commander' });
  boss.state = ESTATE.ATTACK;
  boss.applyDamage(50, 'head', 0, 1, { director: ctx.director });
  assert.equal(boss.state, ESTATE.ATTACK);
});

test('leaving ATTACK mid-shot aborts it (no frozen laser, no stale burst)', () => {
  const ctx = enemyCtx();
  const e = new Enemy(0, new THREE.Scene(), null, [[5, 5]], { cls: 'marksman' });
  e.group.position.set(14, 0, 0);
  e.state = ESTATE.ATTACK;
  e.chargeT = 1;
  e._showLaser(true);
  assert.ok(e.laser.visible);
  e.state = ESTATE.COVER;                 // hurt → breaks for cover mid-charge
  e._atCover = false;
  e.stateT = 5;
  e.coverPt.set(20, 0, 6);
  e.update(0.05, ctx);
  assert.equal(e.state, ESTATE.COVER);
  assert.equal(e.chargeT, 0);
  assert.equal(e.laser.visible, false);
  e.dispose();
  assert.equal(e.laser, null);
});

test('marksman: the shot lands where the laser locked — stand still and take it, move and dodge', () => {
  const shoot = (dodge) => {
    const ctx = enemyCtx({ px: 0, pz: 0 });
    const e = new Enemy(0, new THREE.Scene(), null, [[5, 5]], { cls: 'marksman' });
    e.group.position.set(15, 0, 0);
    e.group.rotation.y = -Math.PI / 2;
    e.state = ESTATE.ATTACK;
    e.fireCd = 99;
    for (let i = 0; i < 15; i++) { e.update(0.02, ctx); e.state = ESTATE.ATTACK; }   // establish line of sight
    assert.ok(e.seen);
    e.reactT = 0;
    e.fireCd = 0;
    let charged = false;
    for (let i = 0; i < 200 && !(charged && e.chargeT === 0); i++) {
      e.update(0.02, ctx);
      if (e.state !== ESTATE.ATTACK) e.state = ESTATE.ATTACK;
      if (e.chargeT > 0) charged = true;
      if (dodge && e._locked && e.chargeT > 0) ctx.playerPos.set(0, 0, 3);   // sprint out of the lock
    }
    assert.ok(charged, 'the marksman telegraphs before firing');
    return ctx.hits.length;
  };
  assert.equal(shoot(false), 1, 'stationary target is hit');
  assert.equal(shoot(true), 0, 'leaving the locked point dodges the round');
});

test('loseTrack: the whole squad drops contact and searches where it stands', () => {
  const m = mgr();
  const ctx = enemyCtx({ px: 0, pz: 0 });
  m.deploy(mission({ enemyCount: 3, waves: [3] }));
  for (const e of m.enemies) { e.state = ESTATE.ATTACK; e.burstLeft = 2; e.lastKnown.set(0, 0, 0); ctx.director.requestFire(e, 5); }
  m.loseTrack();
  for (const e of m.enemies) {
    assert.equal(e.state, ESTATE.SEARCH);
    assert.equal(e.burstLeft, 0);
    assert.ok(e.lastKnown.distanceTo(e.group.position) < 6, 'they search around themselves, not around the player');
  }
});

test('retreatAll empties the field, the queue and the plan', () => {
  const m = mgr();
  const ctx = enemyCtx();
  m.deploy(mission({ enemyCount: 6, waves: [3, 3] }));
  m._spawnBatch(2, ctx, 'flank');
  assert.ok(m.remaining() > 3);
  m.retreatAll(ctx);
  assert.equal(m.remaining(), 0);
  m.update(0.05, ctx);
  assert.equal(m.enemies.length, 0, 'retreated bodies are reaped');
});

test('hear / alertTo / heal basics', () => {
  const ctx = enemyCtx();
  const e = new Enemy(0, new THREE.Scene(), null, [[5, 5]], { cls: 'rifle' });
  e.hear(new THREE.Vector3(500, 0, 500));
  assert.equal(e.alertT, 0, 'too far to hear');
  e.hear(new THREE.Vector3(3, 0, 3));
  assert.ok(e.alertT > 0);
  e.hp = 10;
  assert.ok(e.heal(1000) > 0);
  assert.equal(e.hp, e.maxHp);
  kill(e, ctx);
  assert.equal(e.heal(10), 0);
  assert.equal(e.applyDamage(10, 'body', 0, 1, {}), false, 'dead stays dead');
});
