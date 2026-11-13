import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { layoutCity, composeCity, Skyline } from '../../js/skyline.js';
import { GARDEN } from '../../js/garden.js';
import { LAYOUT } from '../../js/layout.js';
import '../helpers/dom.mjs';

test('city layout: three districts, none of them inside the playable station', () => {
  const towers = layoutCity(1);
  assert.ok(towers.length >= 50);
  const half = (t) => Math.hypot(t.w, t.d) / 2;
  for (const t of towers) {
    // clear of the hall + platform + tracks and of the garden
    const inStation = t.x + half(t) > LAYOUT.hall.x0 && t.x - half(t) < GARDEN.x1 + 1 &&
      t.z + half(t) > GARDEN.z0 - 1 && t.z - half(t) < 33;
    assert.ok(!inStation, `tower at ${t.x.toFixed(0)},${t.z.toFixed(0)} intrudes on the station`);
    assert.ok(t.h >= 9 && t.tiers >= 1 && t.tiers <= 3);
  }
  assert.ok(towers.some((t) => t.z > 45), 'north district');
  assert.ok(towers.some((t) => t.x > 60), 'east district');
  assert.ok(towers.some((t) => t.z < -40), 'south district');
  assert.ok(layoutCity(0.5).length < towers.length, 'detail preset scales density');
});

test('composition: tiers stack up to the tower height, set-backs shrink, tall towers get beacons', () => {
  const t = { x: 0, z: 0, w: 16, d: 14, h: 40, rot: 0, tiers: 3 };
  const { bodies, plant, beacons } = composeCity([t]);
  assert.equal(bodies.length, 3);
  const total = bodies.reduce((a, b) => a + b.h, 0);
  assert.ok(Math.abs(total - 40) < 1e-6);
  assert.ok(bodies[1].w < bodies[0].w && bodies[2].w < bodies[1].w);
  assert.ok(Math.abs(bodies[0].y - bodies[0].h / 2 + 1) < 1e-6, 'starts just below street level');
  assert.ok(plant.length >= 3 + 2, 'parapets + roof plant');
  assert.ok(beacons.length >= 1);
  for (const b of beacons) assert.ok(b.y > 39);
  const low = composeCity([{ ...t, h: 12, tiers: 1 }]);
  assert.equal(low.bodies.length, 1);
  assert.equal(low.beacons.length, 0);
});

test('Skyline.build produces four instanced layers in one group', () => {
  const scene = new THREE.Scene();
  const sky = new Skyline(scene);
  const stats = sky.build(0.5);
  assert.ok(stats.towers > 20 && stats.plant > stats.towers);
  const inst = sky.group.children.filter((c) => c.isInstancedMesh);
  assert.equal(inst.length, 4);
  assert.equal(inst[0].count, stats.towers);
  assert.ok(inst.every((m) => m.userData.noDetail));
  assert.equal(inst[0].material.customProgramCacheKey(), 'city-windows-1');
  const sh = { vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <normal_fragment_begin>\n#include <emissivemap_fragment>' };
  inst[0].material.onBeforeCompile(sh);
  assert.ok(sh.fragmentShader.includes('cityGlow') && sh.vertexShader.includes('vCitySeed'));
  assert.ok(scene.children.includes(sky.group));
});
