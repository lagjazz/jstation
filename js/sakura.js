// ============================================================
// sakura.js — the sakura garden beside the concourse: procedural
// cherry trees + a GPU point-field of petals that fall, drift,
// rotate and loop (wind-influenced), plus subtle air motes in the
// hall for atmosphere.
// ============================================================

import * as THREE from 'three';
import { ParticleSystem } from './particleManager.js';
import { TEX } from './textures.js';
import { MAT } from './materials.js';
import { rand } from './utils.js';

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.9 });
const canopyMat = new THREE.MeshStandardMaterial({
  color: 0xf7a8c4, roughness: 0.95, metalness: 0,
  emissive: 0xd96d9a, emissiveIntensity: 0.08,
});

export class Sakura {
  constructor(scene, particleScale = 1) {
    this.scene = scene;
    this.particleScale = particleScale;
    this.petals = null;
    this.motes = null;
    this.blobs = [];
  }

  build() {
    const { scene } = this;

    // (the trees themselves are built by js/garden.js)
    // ---------- petal field ----------
    const cap = Math.max(200, Math.round(1500 * this.particleScale));
    this.petals = new ParticleSystem(scene, { capacity: cap, texture: TEX.petal });
    this.petals.respawnBox = { x: 27, z: -2, hx: 14.5, hz: 21.5, y0: 0.05, y1: 7 };
    for (let i = 0; i < cap; i++) {
      this.petals.spawn({
        x: 27 + rand(-14.5, 14.5), y: rand(0.05, 7), z: -2 + rand(-21.5, 21.5),
        vx: rand(-0.25, 0.25), vy: rand(-0.45, -0.15), vz: rand(-0.25, 0.25),
        size: rand(0.035, 0.085),
        color: [rand(0.85, 1), rand(0.55, 0.78), rand(0.68, 0.85)],
        alpha: rand(0.6, 0.95),
        life: Infinity, gravity: 0.16, drag: 0.6,
        spin: rand(-1.5, 1.5), sway: rand(0.5, 1.6),
      });
    }

    // ---------- air motes in the hall ----------
    const mcap = Math.max(80, Math.round(320 * this.particleScale));
    this.motes = new ParticleSystem(scene, { capacity: mcap, texture: TEX.spark });
    this.motes.respawnBox = { x: -14, z: -1, hx: 26, hz: 15, y0: 0.25, y1: 8.5 };
    for (let i = 0; i < mcap; i++) {
      this.motes.spawn({
        x: -14 + rand(-26, 26), y: rand(0.25, 8.5), z: -1 + rand(-15, 15),
        vx: rand(-0.05, 0.05), vy: rand(-0.05, 0.05), vz: rand(-0.05, 0.05),
        size: rand(0.008, 0.02),
        color: [0.75, 0.82, 0.95], alpha: rand(0.05, 0.16),
        life: Infinity, gravity: -0.004, drag: 0.2, sway: rand(0.05, 0.18),
      });
    }
  }

  update(dt) {
    this.petals.update(dt);
    this.motes.update(dt);
  }
}
