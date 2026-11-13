import test from 'node:test';
import assert from 'node:assert/strict';
import { Progression, PERKS, baseStats } from '../../js/progression.js';
import { PROGRESSION } from '../../js/config.js';

test('xp curve: need() grows with level', () => {
  const p = new Progression();
  assert.equal(p.need(1), PROGRESSION.baseXp);
  assert.ok(p.need(5) > p.need(4));
});

test('gain() levels up, banks perk picks and carries the remainder', () => {
  const p = new Progression();
  assert.equal(p.gain(p.need(1) - 1), 0);
  assert.equal(p.level, 1);
  assert.equal(p.gain(1), 1);
  assert.equal(p.level, 2);
  assert.equal(p.pending, 1);
  assert.equal(p.xp, 0);
  const ups = p.gain(100000);
  assert.ok(ups > 3, 'one big award can cross several levels');
  assert.ok(p.frac() >= 0 && p.frac() < 1);
});

test('offer(): distinct perks, capped stacks excluded, armory only when something is locked', () => {
  const p = new Progression();
  const three = p.offer(3, true);
  assert.equal(three.length, 3);
  assert.equal(new Set(three.map((x) => x.id)).size, 3);
  for (let i = 0; i < 40; i++) assert.ok(!p.offer(PERKS.length, false).some((x) => x.id === 'armory'));
  p.pending = 99;
  const vit = PERKS.find((x) => x.id === 'vitality');
  for (let i = 0; i < vit.max; i++) assert.ok(p.take('vitality'));
  assert.ok(!p.offer(PERKS.length, true).some((x) => x.id === 'vitality'), 'maxed perk is no longer offered');
});

test('take(): needs a pending pick, applies the stat change, counts stacks', () => {
  const p = new Progression();
  assert.equal(p.take('vitality'), null, 'no pending pick');
  p.pending = 2;
  assert.equal(p.take('nope'), null);
  p.take('vitality');
  assert.equal(p.stats.maxHp, baseStats().maxHp + 20);
  assert.equal(p.stats.healNow, 20);
  assert.equal(p.pending, 1);
  assert.equal(p.taken.vitality, 1);
});

test('every perk applies cleanly and changes at least one stat', () => {
  for (const perk of PERKS) {
    const s = baseStats();
    perk.apply(s);
    assert.notDeepEqual(s, baseStats(), perk.id);
    for (const v of Object.values(s)) assert.ok(Number.isFinite(v), `${perk.id} produced a non-finite stat`);
    assert.ok(perk.max >= 1 && perk.name && perk.zh && perk.desc);
  }
});

test('reset() returns to a clean slate', () => {
  const p = new Progression();
  p.gain(5000);
  p.take(PERKS[0].id);
  p.reset();
  assert.equal(p.level, 1);
  assert.equal(p.pending, 0);
  assert.deepEqual(p.stats, baseStats());
});
