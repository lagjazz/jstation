import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/dom.mjs';
import * as THREE from 'three';
import { layoutArena, seeded, DRESS, THEMES, ArenaDress } from '../../js/arenaDress.js';
import { ColliderWorld } from '../../js/collision.js';
import { MISSIONS } from '../../js/config.js';

const rect = { x0: 0, x1: 52, z0: 0, z1: 52 };
const spawn = { x: 4, z: 26 };
const open = () => false;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('seeded(): same seed → same sequence, different seed → different, values in [0,1)', () => {
  const a = seeded('cyber'), b = seeded('cyber'), c = seeded('moon');
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of [...sa, ...sc]) assert.ok(v >= 0 && v < 1);
});

test('open arena: the wanted number of islands, evenly spread', () => {
  const out = layoutArena({ rect, spawn, blocked: open, seed: 't' });
  const want = Math.min(DRESS.maxCount, Math.round((52 * 52) / DRESS.areaPer));
  assert.equal(out.length, want);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    assert.ok(dist(out[i], out[j]) >= DRESS.minGap - 1, `islands ${i},${j} too close`);
  }
  assert.ok(out.some((p) => p.tall) && out.some((p) => !p.tall), 'a mix of tall and low cover');
});

test('layout is deterministic per seed (a map can be learned)', () => {
  const a = layoutArena({ rect, spawn, blocked: open, seed: 'lab' });
  const b = layoutArena({ rect, spawn, blocked: open, seed: 'lab' });
  const c = layoutArena({ rect, spawn, blocked: open, seed: 'tomb' });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('keeps clear of the entry, enemy anchors, waypoints, hazards, lanes and walls', () => {
  const anchors = [{ pos: [30, 30], wps: [[34, 30], [30, 36]] }, { pos: [44, 10], wps: [[40, 12]] }];
  const avoid = [{ x: 20, z: 40, r: 3 }];
  const lane = { x0: 0, x1: 52, z0: 14, z1: 18 };
  const out = layoutArena({ rect, spawn, anchors, avoid, rects: [lane], blocked: open, seed: 'k' });
  assert.ok(out.length >= DRESS.minCount);
  for (const p of out) {
    const half = (p.tall ? 2.4 : 3.4) / 2;
    assert.ok(dist(p, spawn) >= DRESS.spawnClear - half, 'too close to the entry');
    for (const a of anchors) {
      assert.ok(dist(p, { x: a.pos[0], z: a.pos[1] }) >= DRESS.anchorClear, 'on an anchor');
      for (const w of a.wps) assert.ok(dist(p, { x: w[0], z: w[1] }) >= DRESS.wpClear, 'on a waypoint');
    }
    assert.ok(dist(p, avoid[0]) >= avoid[0].r, 'inside a hazard zone');
    const hz = (p.alongX ? 0.8 : 3.4) / 2;
    assert.ok(p.z + hz < lane.z0 || p.z - hz > lane.z1, 'inside the kept-clear lane');
    assert.ok(p.x > rect.x0 + DRESS.edge && p.x < rect.x1 - DRESS.edge);
    assert.ok(p.z > rect.z0 + DRESS.edge && p.z < rect.z1 - DRESS.edge);
  }
});

test('never overlaps colliders (with walking margin) and honours floor support', () => {
  const solid = { x0: 20, x1: 32, z0: 20, z1: 32 };
  const blocked = (x0, z0, x1, z1) => x1 > solid.x0 && x0 < solid.x1 && z1 > solid.z0 && z0 < solid.z1;
  const out = layoutArena({ rect, spawn, blocked, seed: 'b' });
  for (const p of out) {
    const inside = p.x > solid.x0 - 1 && p.x < solid.x1 + 1 && p.z > solid.z0 - 1 && p.z < solid.z1 + 1;
    assert.ok(!inside, 'island inside / hugging a collider');
  }
  // floor only on the west half
  const supported = (x0, _z0, x1) => x1 <= 26 && x0 >= 0;
  const west = layoutArena({ rect, spawn: { x: 48, z: 48 }, blocked: open, supported, seed: 's' });
  assert.ok(west.length > 0);
  for (const p of west) assert.ok(p.x <= 26);
});

test('a fully blocked arena yields no islands instead of throwing', () => {
  assert.deepEqual(layoutArena({ rect, spawn, blocked: () => true, seed: 'x' }), []);
});

test('walls turn broadside to the entry', () => {
  const out = layoutArena({ rect, spawn: { x: 26, z: 2 }, blocked: open, seed: 'o' });
  // islands far "north" of the entry, roughly in line with it, must run along X
  const inLine = out.filter((p) => Math.abs(p.x - 26) < 6 && p.z > 20);
  for (const p of inLine) assert.ok(p.alongX);
});

test('every arena mission has a theme; every theme builds geometry + colliders', () => {
  const arenas = MISSIONS.map((m) => m.area).filter((a) => !['hall', 'platform', 'garden'].includes(a));
  for (const a of arenas) assert.ok(THEMES[a], `no theme for ${a}`);
  for (const area of Object.keys(THEMES)) {
    const scene = new THREE.Scene(), world = new ColliderWorld();
    const d = new ArenaDress(scene, world);
    const layout = d.build(area, { rect, spawn, anchors: [], avoid: [], rects: [] });
    assert.ok(layout.length >= DRESS.minCount, area);
    assert.equal(world.all().length, layout.length, 'one collider per island');
    const g = d.groups[area];
    assert.equal(g.name, 'world:' + area, 'group is tagged for per-arena raycasts');
    const mesh = d.raycastMeshes.at(-1);
    assert.ok(mesh.geometry.attributes.position.count > 100);
    assert.ok(mesh.geometry.attributes.rm, 'baked roughness/metal attribute');
    for (const b of world.all()) assert.ok(b.max.y >= 1.0 && b.min.y === 0);
  }
});

test('build(): existing colliders are respected; unknown areas and missing rects are skipped', () => {
  const scene = new THREE.Scene(), world = new ColliderWorld();
  world.addBox(new THREE.Vector3(10, 0, 10), new THREE.Vector3(42, 3, 42));   // a big building
  const d = new ArenaDress(scene, world);
  const layout = d.build('lab', { rect, spawn, anchors: [], avoid: [], rects: [] });
  for (const p of layout) assert.ok(p.x < 10 || p.x > 42 || p.z < 10 || p.z > 42);
  assert.deepEqual(d.build('nowhere', { rect, spawn }), []);
  assert.deepEqual(d.build('lab', { rect: null, spawn }), []);
});

test('setVisible shows only the active arena', () => {
  const scene = new THREE.Scene(), world = new ColliderWorld();
  const d = new ArenaDress(scene, world);
  d.build('lab', { rect, spawn });
  d.build('tomb', { rect: { x0: 100, x1: 152, z0: 0, z1: 52 }, spawn: { x: 104, z: 26 } });
  d.setVisible('tomb');
  assert.equal(d.groups.lab.visible, false);
  assert.equal(d.groups.tomb.visible, true);
  d.setVisible('hall');
  assert.equal(d.groups.tomb.visible, false);
});

test('wall piers: only where a real wall stands, never in front of obstacles, capped height', async () => {
  const { layoutPiers } = await import('../../js/arenaDress.js');
  // walls on the south (9 m) and west (3 m) sides only; the north "wall" is a 1 m kerb
  const wallTop = (x, z) => (z < 0 ? 9 : (x < 0 ? 3 : (z > 52 ? 1 : 0)));
  const door = { x0: 20, x1: 30, z0: 0, z1: 2 };                       // something stands at the south wall here
  const blocked = (x0, z0, x1, z1) => x1 > door.x0 && x0 < door.x1 && z1 > door.z0 && z0 < door.z1;
  const piers = layoutPiers(rect, wallTop, blocked);
  assert.ok(piers.length >= 8);
  for (const p of piers) {
    const south = p.nz === 1, west = p.nx === 1;
    assert.ok(south || west, 'no piers on the open / kerb sides');
    assert.ok(p.h <= 6.2 && p.h >= 2.5);
    if (south) assert.ok(p.x < door.x0 - 0.5 || p.x > door.x1 + 0.5, 'pier in front of the door');
    if (west) assert.ok(Math.abs(p.h - 2.9) < 1e-9, 'pier follows a low wall');
  }
  assert.deepEqual(layoutPiers(rect, () => 0, () => false), []);
});

test('sealed-room arenas get piers when their walls exist', () => {
  const scene = new THREE.Scene(), world = new ColliderWorld();
  const r = { x0: 0, x1: 52, z0: 0, z1: 52 };
  for (const [a, b] of [[[-1, -1], [53, 0]], [[-1, 52], [53, 53]], [[-1, 0], [0, 52]], [[52, 0], [53, 52]]]) {
    world.addBox(new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(b[0], 8, b[1]));
  }
  const d = new ArenaDress(scene, world);
  d.build('tomb', { rect: r, spawn });
  d.build('lab', { rect: r, spawn });
  assert.ok(d.piers.tomb >= 20 && d.piers.lab >= 20);
  const open = new ArenaDress(new THREE.Scene(), new ColliderWorld());
  open.build('tomb', { rect: r, spawn });
  assert.equal(open.piers.tomb, 0, 'no walls → no piers');
});

test('every piece stays inside its collider in both orientations (≤ 0.2 m visual overhang)', () => {
  for (const area of Object.keys(THEMES)) {
    const scene = new THREE.Scene(), world = new ColliderWorld();
    const d = new ArenaDress(scene, world);
    const layout = d.build(area, { rect, spawn, anchors: [], avoid: [], rects: [] });
    assert.ok(layout.some((p) => p.alongX) && layout.some((p) => !p.alongX), `${area}: both orientations present`);
    const pos = d.raycastMeshes.at(-1).geometry.attributes.position;
    const boxes = world.all();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const ok = boxes.some((b) => x > b.min.x - 0.2 && x < b.max.x + 0.2 && z > b.min.z - 0.2 && z < b.max.z + 0.2);
      assert.ok(ok, `${area}: vertex at ${x.toFixed(2)},${z.toFixed(2)} sticks out of every collider`);
    }
  }
});
