import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/dom.mjs';
import * as THREE from 'three';
import { PickupManager, DROP_KINDS } from '../../js/pickups.js';
import { DROPS } from '../../js/config.js';
import { sink } from '../helpers/world.mjs';

const mk = () => new PickupManager(new THREE.Scene(), sink());
const corpse = (extra = {}) => ({ cls: 'rifle', elite: false, boss: false, anchorY: 0, group: { position: new THREE.Vector3(5, 0, 5) }, ...extra });
const far = new THREE.Vector3(100, 0, 100);

test('a model exists for every drop kind', () => {
  const p = mk();
  for (const k of DROP_KINDS) assert.ok(p.geos[k].geo, k);
});

test('walking over a drop collects it; height difference blocks it', () => {
  const p = mk();
  p.spawn('ammo', 0, 0, 0, { keep: true });
  assert.deepEqual(p.update(0.016, far), []);
  assert.deepEqual(p.update(0.016, new THREE.Vector3(0.5, 3, 0)), [], 'a floor above');
  assert.deepEqual(p.update(0.016, new THREE.Vector3(0.5, 0, 0.2)), ['ammo']);
  assert.equal(p.drops.length, 0);
});

test('loose drops expire; supply caches (keep) never do and sit exactly where placed', () => {
  const p = mk();
  p.spawn('medkit', 3, 0, 3);
  p.spawn('ammo', 7, 0, 7, { keep: true });
  assert.equal(p.drops[1].x, 7);
  p.update(DROPS.lifetime + 2.5, far);
  assert.deepEqual(p.drops.map((d) => d.kind), ['ammo']);
  p.update(1000, far);
  assert.equal(p.drops.length, 1);
});

test('meshes are pooled and reused', () => {
  const p = mk();
  p.spawn('armor', 0, 0, 0);
  const mesh = p.drops[0].mesh;
  p.clear();
  assert.equal(mesh.visible, false);
  p.spawn('armor', 1, 0, 1);
  assert.equal(p.drops[0].mesh, mesh);
  p._spawn('grenade', new THREE.Vector3(2, 1, 2));
  assert.equal(p.drops.length, 2);
});

test('pity overrides make ammo / medkits near-certain', () => {
  let ammo = 0, med = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const p = mk();
    p.spawnFrom(corpse(), { pity: { ammo: 0.95, medkit: 0.8 } });
    if (p.drops.some((d) => d.kind === 'ammo')) ammo++;
    if (p.drops.some((d) => d.kind === 'medkit')) med++;
  }
  assert.ok(ammo / N > 0.88, `ammo ${ammo / N}`);
  assert.ok(med / N > 0.68, `medkit ${med / N}`);
});

test('without pity the base chances apply; a boss always drops a weapon crate + a buff', () => {
  let ammo = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const p = mk();
    p.spawnFrom(corpse());
    if (p.drops.some((d) => d.kind === 'ammo')) ammo++;
  }
  assert.ok(Math.abs(ammo / N - DROPS.ammoChance) < 0.12, `ammo ${ammo / N}`);
  const p = mk();
  p.spawnFrom(corpse({ cls: 'commander', boss: true, elite: true }), { dropBonus: 0.1 });
  const kinds = p.drops.map((d) => d.kind);
  assert.ok(kinds.includes('weapon'));
  assert.ok(kinds.includes('overdrive') || kinds.includes('haste'));
});
