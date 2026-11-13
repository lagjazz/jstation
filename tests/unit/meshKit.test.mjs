import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G, PartList, RMMaterial, GlowMaterial, bakedMesh } from '../../js/meshKit.js';

test('primitive geometry is cached per parameter set', () => {
  assert.equal(G.box(1, 2, 3), G.box(1, 2, 3));
  assert.notEqual(G.box(1, 2, 3), G.box(1, 2, 4));
  for (const g of [G.cap(0.1, 0.3), G.cyl(0.1, 0.2, 1), G.sph(0.5), G.dome(0.5), G.tor(0.5, 0.1)]) {
    assert.ok(g.attributes.position.count > 0);
  }
});

test('bake merges parts into one geometry with colour + rm attributes', () => {
  const L = new PartList();
  L.add(G.box(1, 1, 1), 0xff0000, 0, 0.5, 0, { r: 0.3, m: 0.9 });
  L.add(G.box(1, 1, 1), 0x00ff00, 5, 0.5, 0);
  const { geo, glowGeo } = L.bake();
  assert.equal(glowGeo, null);
  const n = G.box(1, 1, 1).attributes.position.count;
  assert.equal(geo.attributes.position.count, n * 2);
  assert.equal(geo.index.count, G.box(1, 1, 1).index.count * 2);
  assert.ok(Math.abs(geo.attributes.rm.getX(0) - 0.3) < 1e-6);
  assert.ok(Math.abs(geo.attributes.rm.getY(0) - 0.9) < 1e-6);
  assert.ok(Math.abs(geo.attributes.rm.getX(n) - 0.8) < 1e-6, 'default roughness');
  assert.ok(geo.boundingBox.max.x > 5 && geo.boundingBox.min.x < -0.4, 'translation applied');
  assert.ok(geo.attributes.color.getX(0) > 0.5 && geo.attributes.color.getY(0) === 0, 'red part stays red');
});

test('baked AO: up-facing vertices are brighter than down-facing ones', () => {
  const L = new PartList();
  L.add(G.box(1, 1, 1), 0xffffff);
  const { geo } = L.bake();
  let top = 0, bottom = 0;
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const ny = geo.attributes.normal.getY(i), c = geo.attributes.color.getX(i);
    if (ny > 0.9) top = c;
    if (ny < -0.9) bottom = c;
  }
  assert.ok(top > bottom);
  const flat = new PartList();
  flat.add(G.box(1, 1, 1), 0xffffff, 0, 0, 0, { ao: false });
  const c = flat.bake().geo.attributes.color;
  for (let i = 0; i < c.count; i++) assert.equal(c.getX(i), 1);
});

test('rotation, scale and pair() mirroring are applied', () => {
  const L = new PartList();
  L.add(G.box(2, 0.2, 0.2), 0xffffff, 0, 0, 0, { rot: [0, 0, Math.PI / 2], s: 2 });
  const bb = L.bake().geo.boundingBox;
  assert.ok(bb.max.y > 1.9 && bb.max.x < 0.3, 'box stood on end and doubled');
  const P = new PartList();
  P.pair(G.box(0.1, 0.1, 0.1), 0xffffff, 1, 0, 0, { rot: [0, 0.3, 0.2] });
  const pb = P.bake().geo.boundingBox;
  assert.ok(pb.min.x < -0.9 && pb.max.x > 0.9);
});

test('glow parts bake into their own geometry; non-indexed parts work', () => {
  const L = new PartList();
  L.add(new THREE.IcosahedronGeometry(1, 0), 0x888888);   // non-indexed
  L.add(G.box(0.1, 0.1, 0.1), 0x00ffff, 0, 2, 0, { glow: true });
  const { geo, glowGeo } = L.bake();
  assert.equal(geo.index.count, geo.attributes.position.count);
  assert.ok(glowGeo.attributes.position.count > 0);
  assert.equal(new PartList().bake().geo, null);
});

test('materials + bakedMesh helper', () => {
  const m = RMMaterial({ transparent: true });
  assert.ok(m.vertexColors && m.transparent);
  assert.equal(m.customProgramCacheKey(), RMMaterial().customProgramCacheKey(), 'all instances share one program');
  const sh = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>' };
  m.onBeforeCompile(sh);
  assert.ok(sh.vertexShader.includes('vRM = rm'));
  assert.ok(sh.fragmentShader.includes('roughness * vRM.x') && sh.fragmentShader.includes('metalness * vRM.y'));
  const gl = GlowMaterial(3);
  assert.equal(gl.color.r, 3);
  assert.equal(gl.toneMapped, false);
  const parent = new THREE.Group();
  const mesh = bakedMesh(G.box(1, 1, 1), m, parent, { receive: true });
  assert.ok(mesh.castShadow && mesh.receiveShadow && parent.children.includes(mesh));
  assert.equal(bakedMesh(null, m, parent), null);
  assert.ok(bakedMesh(G.box(1, 1, 1), m).isMesh, 'parent is optional');
});
