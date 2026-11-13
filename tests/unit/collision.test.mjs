import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ColliderWorld, moveAndSlide, moveAndSlideSimple, blockedAt } from '../../js/collision.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (w, x0, z0, x1, z1, h = 2, y0 = 0) => w.addBox(V(x0, y0, z0), V(x1, h, z1));

test('query returns only boxes whose cells overlap the rect (plus dynamics)', () => {
  const w = new ColliderWorld();
  const near = box(w, 0, 0, 1, 1), far = box(w, 100, 100, 101, 101);
  const dyn = w.addDynamicBox(V(50, 0, 50), V(51, 1, 51));
  const got = [...w.near(0.5, 0.5, 1)];
  assert.ok(got.includes(near));
  assert.ok(!got.includes(far));
  assert.ok(got.includes(dyn), 'dynamic boxes are always candidates');
  assert.equal(w.all().length, 3);
  w.removeDynamicBox(dyn);
  assert.equal(w.all().length, 2);
  assert.ok(![...w.near(0.5, 0.5, 1)].includes(dyn));
  w.removeDynamicBox(dyn);   // removing twice is harmless
});

test('a box spanning several cells is reported once; giant boxes always', () => {
  const w = new ColliderWorld();
  const wide = box(w, -10, -10, 10, 10);
  const giant = box(w, -500, -500, 500, 500, 0, -1);
  const got = [...w.query(-9, -9, 9, 9)];
  assert.equal(got.filter((b) => b === wide).length, 1);
  assert.ok(got.includes(giant));
  assert.ok([...w.near(900, 900, 1)].includes(giant), 'huge boxes live in the shared list');
});

test('moveAndSlide stops at a wall and slides along it', () => {
  const w = new ColliderWorld();
  box(w, 2, -5, 3, 5);                       // wall across +x
  const p = V(0, 0, 0);
  moveAndSlide(p, 2, 1, 0.4, 1.7, w);       // per-frame steps are small: no tunnelling test here
  assert.ok(Math.abs(p.x - 1.6) < 1e-9, 'clamped to wall face minus radius');
  assert.equal(p.z, 1, 'still slides on the free axis');
  const q = V(4.5, 0, 0);
  moveAndSlideSimple(q, -1.5, 0, 0.4, 1.7, w);
  assert.ok(Math.abs(q.x - 3.4) < 1e-9, 'blocked from the other side too');
});

test('boxes above the head or below the feet do not block', () => {
  const w = new ColliderWorld();
  box(w, 2, -5, 3, 5, 5, 3);                 // beam at y 3..5
  const p = V(0, 0, 0);
  moveAndSlide(p, 2.5, 0, 0.4, 1.7, w);
  assert.equal(p.x, 2.5);
});

test('stepUp climbs a low ledge with head-room, refuses a tall one', () => {
  const w = new ColliderWorld();
  box(w, 2, -5, 4, 5, 0.4);                  // kerb
  const p = V(0, 0, 0);
  moveAndSlide(p, 2, 0, 0.4, 1.7, w, 0.48);
  assert.equal(p.x, 2);
  assert.equal(p.y, 0.4, 'stands on the kerb');
  const w2 = new ColliderWorld();
  box(w2, 2, -5, 4, 5, 0.9);
  const q = V(0, 0, 0);
  moveAndSlide(q, 2, 0, 0.4, 1.7, w2, 0.48);
  assert.ok(q.x < 2 && q.y === 0, 'too tall to step');
  const w3 = new ColliderWorld();
  box(w3, 2, -5, 4, 5, 0.4);
  box(w3, 2, -5, 4, 5, 2.5, 1.0);            // low ceiling over the kerb
  const r = V(0, 0, 0);
  moveAndSlide(r, 2, 0, 0.4, 1.7, w3, 0.48);
  assert.ok(r.x < 2, 'no head-room → blocked');
});

test('blockedAt respects footprint radius and the vertical band', () => {
  const w = new ColliderWorld();
  box(w, 0, 0, 1, 1, 2);
  assert.ok(blockedAt(w, 0.5, 0.5, 0.3));
  assert.ok(blockedAt(w, 1.2, 0.5, 0.3), 'radius reaches the box');
  assert.ok(!blockedAt(w, 2, 0.5, 0.3));
  assert.ok(!blockedAt(w, 0.5, 0.5, 0.3, 2.5), 'standing above the box');
  const floor = new ColliderWorld();
  box(floor, -5, -5, 5, 5, 0, -1);           // slab with its top at y=0
  assert.ok(!blockedAt(floor, 0, 0, 0.3), 'a floor slab is not an obstacle');
});
