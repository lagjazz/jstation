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

    // ---------- trees ----------
    const treeDefs = [
      [16, -2, 1.1], [21.5, 4.5, 1.25], [17, 9.5, 1.0], [23, -7, 0.95],
    ];
    for (const [tx, tz, s] of treeDefs) this._tree(tx, tz, s);

    // ---------- petal field ----------
    const cap = Math.max(150, Math.round(900 * this.particleScale));
    this.petals = new ParticleSystem(scene, { capacity: cap, texture: TEX.petal });
    this.petals.respawnBox = { x: 18, z: 2, hx: 8.2, hz: 12.5, y0: 0.05, y1: 6.5 };
    for (let i = 0; i < cap; i++) {
      this.petals.spawn({
        x: 18 + rand(-8.2, 8.2), y: rand(0.05, 6.5), z: 2 + rand(-12.5, 12.5),
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

  _tree(x, z, s) {
    const { scene } = this;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    scene.add(g);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 2.4 * s, 8), trunkMat);
    trunk.position.y = 1.2 * s;
    trunk.rotation.z = rand(-0.06, 0.06);
    trunk.castShadow = true;
    trunk.userData.tag = 'wood';
    g.add(trunk);

    // branches
    const branchGeo = new THREE.CylinderGeometry(0.04 * s, 0.07 * s, 1.5 * s, 6);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(branchGeo, trunkMat);
      const a = (i / 3) * Math.PI * 2 + rand(-0.5, 0.5);
      b.position.set(Math.cos(a) * 0.5 * s, 2.2 * s, Math.sin(a) * 0.5 * s);
      b.rotation.z = Math.cos(a) * 0.9;
      b.rotation.x = -Math.sin(a) * 0.9;
      b.castShadow = true;
      b.userData.tag = 'wood';
      g.add(b);
    }

    // canopy blobs (low-poly icosa)
    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(blobGeo, canopyMat);
      const a = (i / 6) * Math.PI * 2 + rand(-0.4, 0.4);
      const r = (i === 0 ? 0 : rand(0.55, 1.15)) * s;
      m.position.set(Math.cos(a) * r, (2.6 + rand(0, 1.0)) * s, Math.sin(a) * r);
      const sc = rand(0.7, 1.25) * s;
      m.scale.set(sc, sc * 0.72, sc);
      m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      m.castShadow = true;
      m.userData.tag = 'wood';
      g.add(m);
      this.blobs.push(m);
    }
  }

  update(dt) {
    this.petals.update(dt);
    this.motes.update(dt);
  }
}
