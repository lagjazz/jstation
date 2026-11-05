// ============================================================
// utils.js — small math / timing helpers shared across modules.
// ============================================================

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent exponential damping toward target. */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const rand = (min, max) => min + Math.random() * (max - min);

export const randInt = (min, max) => Math.floor(rand(min, max + 1));

export const chance = (p) => Math.random() < p;

export const randPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const smoothstep = (t) => t * t * (3 - 2 * t);

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeInCubic = (t) => t * t * t;

export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

/** Next animation frame as a promise (lets the browser paint between load stages). */
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

export const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
