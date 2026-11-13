import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/dom.mjs';
import * as THREE from 'three';
import { Objectives } from '../../js/objectives.js';
import { ColliderWorld } from '../../js/collision.js';
import { OBJECTIVES } from '../../js/config.js';
import { sink, fakeAudio } from '../helpers/world.mjs';

const anchors = [
  { pos: [20, 0], wps: [[22, 0]] }, { pos: [0, 20], wps: [[0, 22]] },
  { pos: [-20, 0], wps: [[-22, 0]] }, { pos: [0, -20], wps: [[0, -22]] }, { pos: [14, 14], wps: [[16, 14]] },
];
const spawn = { x: 0, z: 0 };
const mk = () => {
  const world = new ColliderWorld();
  return { o: new Objectives(new THREE.Scene(), world, sink(), fakeAudio()), world };
};
const em = (over = {}) => ({ remaining: () => 3, enemies: [], boss: null, bossKilled: false, ...over });
const P = (x, z, y = 0) => new THREE.Vector3(x, y, z);

test('eliminate completes when nothing remains', () => {
  const { o } = mk();
  o.setup('eliminate', { anchors, spawn, missionIdx: 0 });
  assert.equal(o.update(0.1, { playerPos: P(0, 0), enemyMgr: em() }), null);
  assert.equal(o.hud(em()).detail.includes('3'), true);
  assert.equal(o.update(0.1, { playerPos: P(0, 0), enemyMgr: em({ remaining: () => 0 }) }), 'complete');
  assert.equal(o.update(0.1, { playerPos: P(0, 0), enemyMgr: em() }), null, 'stays done');
});

test('survive: trickle deploy options + completes on the timer, scaled per mission', () => {
  const { o } = mk();
  const dep = o.setup('survive', { anchors, spawn, missionIdx: 4 });
  assert.deepEqual(dep.trickle.gap, OBJECTIVES.survive.gap);
  assert.equal(o.duration, OBJECTIVES.survive.duration + 4 * OBJECTIVES.survive.perMission);
  assert.equal(o.update(o.duration - 1, { playerPos: P(0, 0), enemyMgr: em() }), null);
  const h = o.hud(em());
  assert.ok(h.progress > 0.9 && h.progress <= 1);
  assert.equal(o.update(1.1, { playerPos: P(0, 0), enemyMgr: em() }), 'complete');
});

test('defend: terminal collider + sabotage drains integrity → fail; otherwise timer wins', () => {
  const { o, world } = mk();
  const dep = o.setup('defend', { anchors, spawn, missionIdx: 0 });
  assert.ok(dep.objTarget && dep.trickle);
  assert.equal(world.all().length, 1, 'terminal blocks movement');
  assert.equal(o.raycastMeshes.length, 1);
  dep.objTarget.sabotage(1, {});
  assert.ok(o.termHp < 100);
  assert.ok(o.hud(em()).warn, 'HUD warns while being hacked');
  for (let i = 0; i < 100 && o.termHp > 0; i++) dep.objTarget.sabotage(1, {});
  assert.equal(o.update(0.1, { playerPos: P(0, 0), enemyMgr: em() }), 'failed');
  o.clear();
  assert.equal(world.all().length, 0, 'collider removed on clear');
  const d2 = o.setup('defend', { anchors, spawn, missionIdx: 0 });
  assert.ok(d2.objTarget);
  assert.equal(o.update(o.duration + 1, { playerPos: P(0, 0), enemyMgr: em() }), 'complete');
});

test('capture: fills while inside, pauses when contested, decays outside', () => {
  const { o } = mk();
  o.setup('capture', { anchors, spawn, missionIdx: 0 });
  const z = o.zone.position;
  const inside = P(z.x, z.z);
  o.update(OBJECTIVES.capture.time / 2, { playerPos: inside, enemyMgr: em() });
  assert.ok(Math.abs(o.capture - 0.5) < 0.01);
  const foe = { alive: true, group: { position: P(z.x + 1, z.z) } };
  o.update(5, { playerPos: inside, enemyMgr: em({ enemies: [foe] }) });
  assert.ok(Math.abs(o.capture - 0.5) < 0.01, 'contested: no progress');
  assert.ok(o.hud(em()).warn);
  o.update(4, { playerPos: P(z.x + 50, z.z), enemyMgr: em() });
  assert.ok(o.capture < 0.5 && o.capture > 0.4, 'slow decay outside');
  assert.equal(o.update(OBJECTIVES.capture.time, { playerPos: inside, enemyMgr: em() }), 'complete');
});

test('intel: three drives, then extraction at the entry', () => {
  const { o } = mk();
  o.setup('intel', { anchors, spawn, missionIdx: 0 });
  const got = [];
  assert.equal(o.hud(em()).markers.length, 3);
  for (const d of o.drives) {
    const g = d.g.position;
    assert.ok(Math.hypot(g.x - spawn.x, g.z - spawn.z) > 5, 'drives sit away from the entry');
    assert.equal(o.update(0.1, { playerPos: P(g.x, g.z), enemyMgr: em(), onIntel: (n) => got.push(n) }), null);
  }
  assert.deepEqual(got, [1, 2, 3]);
  assert.ok(o.extract);
  assert.equal(o.hud(em()).markers.length, 1);
  assert.equal(o.update(0.1, { playerPos: P(spawn.x + 1, spawn.z), enemyMgr: em() }), 'complete');
});

test('assassinate: boss deployed up-front, completes when it dies', () => {
  const { o } = mk();
  const dep = o.setup('assassinate', { anchors, spawn, missionIdx: 0 });
  assert.equal(dep.bossNow, true);
  const boss = { alive: true, group: { position: P(9, 9) } };
  assert.equal(o.update(0.1, { playerPos: P(0, 0), enemyMgr: em({ boss }) }), null);
  assert.equal(o.hud(em({ boss })).markers.length, 1);
  assert.equal(o.hud(em()).detail.includes('LOCATING'), true);
  assert.equal(o.update(0.1, { playerPos: P(0, 0), enemyMgr: em({ bossKilled: true }) }), 'complete');
});

test('warm() shows everything once and its disposer hides it; blocked anchors are skipped', () => {
  const { o, world } = mk();
  const off = o.warm(0, 0);
  assert.ok(o.root.visible && o.terminal.visible);
  off();
  assert.ok(!o.root.visible && !o.terminal.visible);
  world.addBox(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 3, 100));   // everything blocked
  const dep = o.setup('capture', { anchors, spawn, missionIdx: 0 });
  assert.ok(dep.trickle, 'falls back to a point near the entry instead of throwing');
  assert.ok(Number.isFinite(o.zone.position.x));
});
