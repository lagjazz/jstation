import test from 'node:test';
import assert from 'node:assert/strict';
import { Director, pickSafest } from '../../js/director.js';
import { DIRECTOR } from '../../js/config.js';

const soldier = (extra = {}) => ({ alive: true, boss: false, ...extra });
const ready = (missionIdx = 0) => { const d = new Director(); d.reset(missionIdx); d.hiddenT = 0; return d; };

test('attack tokens: only tokens() hostiles may hold a firing slot', () => {
  const d = ready(0);
  const squad = [soldier(), soldier(), soldier(), soldier()];
  const granted = squad.filter((e) => d.requestFire(e, 1));
  assert.equal(granted.length, d.tokens());
  assert.equal(d.shooters(), DIRECTOR.tokens);
});

test('a slot holder may re-request; release frees the slot for someone else', () => {
  const d = ready(0);
  const [a, b, c] = [soldier(), soldier(), soldier()];
  assert.ok(d.requestFire(a, 1));
  assert.ok(d.requestFire(b, 1));
  assert.ok(d.requestFire(a, 1), 'holder keeps its slot');
  assert.equal(d.requestFire(c, 1), false);
  d.release(a);
  assert.ok(d.requestFire(c, 1));
});

test('slots expire on their own and dead holders are dropped', () => {
  const d = ready(0);
  const [a, b, c] = [soldier(), soldier(), soldier()];
  d.requestFire(a, 0.5);
  d.requestFire(b, 5);
  d.update(0.6);
  assert.equal(d.shooters(), 1, 'expired slot is purged');
  b.alive = false;
  d.update(0.01);
  assert.equal(d.shooters(), 0, 'dead holder is purged');
  assert.ok(d.requestFire(c, 1));
});

test('bosses always fire and never consume a slot', () => {
  const d = ready(0);
  const boss = soldier({ boss: true });
  assert.ok(d.requestFire(boss, 1));
  assert.equal(d.shooters(), 0);
});

test('nobody fires while the player is hidden (opening calm / redeploy)', () => {
  const d = new Director();
  d.reset(0);
  assert.ok(d.playerHidden, 'a mission opens calm');
  assert.equal(d.requestFire(soldier(), 1), false);
  assert.equal(d.requestFire(soldier({ boss: true }), 1), false);
  d.update(DIRECTOR.openingCalm + 0.01);
  assert.equal(d.playerHidden, false);
  assert.ok(d.requestFire(soldier(), 1));
});

test('tokens and head-count cap grow with the campaign but stay bounded', () => {
  const early = ready(0), late = ready(14), absurd = ready(500);
  assert.ok(late.tokens() >= early.tokens());
  assert.ok(late.maxAlive() > early.maxAlive());
  assert.equal(early.maxAlive(), DIRECTOR.maxAlive);
  assert.equal(absurd.tokens(), DIRECTOR.tokensMax);
  assert.equal(absurd.maxAlive(), DIRECTOR.maxAliveCap);
});

test('going down: grace + hidden windows open, slots clear, mercy accrues to a floor', () => {
  const d = ready(0);
  d.requestFire(soldier(), 10);
  d.onPlayerDown();
  assert.ok(d.shielded);
  assert.ok(d.playerHidden);
  assert.equal(d.shooters(), 0);
  assert.equal(d.mercy(), 1 - DIRECTOR.mercyPerDeath);
  for (let i = 0; i < 20; i++) d.onPlayerDown();
  assert.equal(d.mercy(), DIRECTOR.mercyFloor);
  d.update(DIRECTOR.respawnGrace + 0.01);
  assert.equal(d.shielded, false);
});

test('reset wipes mercy, grace and slots (a retry is a clean slate)', () => {
  const d = ready(3);
  d.onPlayerDown();
  d.reset(4);
  assert.equal(d.deaths, 0);
  assert.equal(d.mercy(), 1);
  assert.equal(d.shielded, false);
  assert.equal(d.missionIdx, 4);
});

test('pity: near-certain ammo when dry, likely medkit when hurt, nothing otherwise', () => {
  const d = ready(0);
  assert.deepEqual(d.pity(3, 1), { ammo: null, medkit: null });
  assert.equal(d.pity(0.2, 1).ammo, DIRECTOR.pityAmmoChance);
  assert.equal(d.pity(3, 0.2).medkit, DIRECTOR.pityMedChance);
});

test('retryDelay stays inside the configured cooldown', () => {
  const d = ready(0);
  for (let i = 0; i < 50; i++) {
    const t = d.retryDelay();
    assert.ok(t >= DIRECTOR.tokenCooldown[0] && t <= DIRECTOR.tokenCooldown[1]);
  }
});

test('pickSafest: first candidate clearing minDist wins, else the farthest', () => {
  const hostiles = [{ x: 0, z: 0 }];
  const near = { x: 5, z: 0 }, mid = { x: 15, z: 0 }, far = { x: 30, z: 0 }, far2 = { x: 40, z: 0 };
  assert.equal(pickSafest([near, far, far2], hostiles, 22), far, 'list order is a priority');
  assert.equal(pickSafest([near, mid], hostiles, 22), mid, 'nothing clears → farthest');
  assert.equal(pickSafest([near], [], 22), near, 'no hostiles → first');
  assert.equal(pickSafest([], hostiles, 22), null);
});
