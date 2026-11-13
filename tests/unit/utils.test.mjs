import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../../js/utils.js';

test('clamp / lerp / damp', () => {
  assert.equal(U.clamp(5, 0, 3), 3);
  assert.equal(U.clamp(-1, 0, 3), 0);
  assert.equal(U.clamp(2, 0, 3), 2);
  assert.equal(U.lerp(10, 20, 0.25), 12.5);
  assert.equal(U.damp(0, 10, 5, 0), 0);
  const a = U.damp(0, 10, 5, 0.1), b = U.damp(0, 10, 5, 0.2);
  assert.ok(a > 0 && b > a && b < 10, 'monotonic approach, never overshoots');
});

test('random helpers respect their ranges', () => {
  for (let i = 0; i < 200; i++) {
    const r = U.rand(2, 3);
    assert.ok(r >= 2 && r < 3);
    const n = U.randInt(1, 4);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 4);
    assert.ok(['a', 'b'].includes(U.randPick(['a', 'b'])));
  }
  assert.equal(U.chance(0), false);
  assert.equal(U.chance(1), true);
});

test('easing curves hit their endpoints', () => {
  for (const f of [U.smoothstep, U.easeOutCubic, U.easeInCubic, U.easeOutQuad]) {
    assert.equal(f(0), 0);
    assert.equal(f(1), 1);
  }
});

test('formatTime pads mm:ss', () => {
  assert.equal(U.formatTime(0), '00:00');
  assert.equal(U.formatTime(65.9), '01:05');
  assert.equal(U.formatTime(600), '10:00');
});

test('nextFrame resolves on the next animation frame', async () => {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  await U.nextFrame();
  delete globalThis.requestAnimationFrame;
});
