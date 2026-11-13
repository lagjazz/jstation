// Shared fakes for gameplay tests: a collider world, a particle sink,
// a silent audio manager and the per-frame enemy context.
import './dom.mjs';
import * as THREE from 'three';
import { ColliderWorld } from '../../js/collision.js';
import { Director } from '../../js/director.js';

export const sink = () => new Proxy({}, { get: (_t, k) => (typeof k === 'symbol' ? undefined : () => {}) });

export function fakeAudio() {
  return { buffers: new Map(), ready: false, play() {}, playPositional() {}, attachPositional() { return {}; }, playLoop() {}, stopLoop() {} };
}

/** Enemy update context around a player standing at (px, pz). */
export function enemyCtx({ px = 0, pz = 0, director = new Director(), world = new ColliderWorld() } = {}) {
  const hits = [];
  director.hiddenT = 0;
  const ctx = {
    playerPos: new THREE.Vector3(px, 0, pz),
    playerCrouch: false,
    playerSpeed: 0,
    world,
    envMeshes: [],
    raycaster: new THREE.Raycaster(),
    particles: sink(),
    audio: fakeAudio(),
    scratchAim: new THREE.Vector3(),
    addTracer() {},
    addMuzzleLight() {},
    playerShake() {},
    onPlayerDamage: (n, src) => hits.push({ n, src }),
    director,
    playerHidden: false,
    hits,
  };
  return ctx;
}

/** Step fn(dt) n times. */
export function run(n, fn, dt = 0.05) { for (let i = 0; i < n; i++) fn(dt, i); }
