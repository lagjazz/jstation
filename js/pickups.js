// ============================================================
// pickups.js — battlefield salvage. Dead hostiles drop ammo crates
// and medkits (chances per class in config.js DROPS). Drops bob and
// spin over the corpse, expire after DROPS.lifetime seconds, and are
// collected by simply walking over them (game.js wires collection to
// player hp + weapon reserve, with a HUD toast and a synth blip).
// Geometry is cached; materials are shared; no lights are added
// (light count must stay constant to avoid shader recompiles).
// ============================================================

import * as THREE from 'three';
import { DROPS } from './config.js';
import { cachedBox } from './build.js';
import { damp, rand, chance } from './utils.js';

const _v = new THREE.Vector3();

let sharedMats = null;
function mats() {
  if (sharedMats) return sharedMats;
  sharedMats = {
    medBody: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.5, metalness: 0.1 }),
    medCross: new THREE.MeshStandardMaterial({ color: 0x5a0e0e, emissive: 0xff2a2a, emissiveIntensity: 1.6, roughness: 0.4 }),
    ammoBody: new THREE.MeshStandardMaterial({ color: 0x3a4230, roughness: 0.6, metalness: 0.25 }),
    ammoBand: new THREE.MeshStandardMaterial({ color: 0xb8902e, emissive: 0xffc23a, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.7 }),
  };
  return sharedMats;
}

function buildMedkit() {
  const g = new THREE.Group();
  const M = mats();
  const body = new THREE.Mesh(cachedBox(0.28, 0.19, 0.21), M.medBody);
  body.castShadow = true;
  g.add(body);
  const cross1 = new THREE.Mesh(cachedBox(0.2, 0.05, 0.02), M.medCross);
  cross1.position.set(0, 0.02, 0.108);
  const cross2 = new THREE.Mesh(cachedBox(0.05, 0.2, 0.02), M.medCross);
  cross2.position.set(0, 0.02, 0.108);
  cross2.scale.y = 0.62;
  g.add(cross1, cross2);
  const lid = new THREE.Mesh(cachedBox(0.29, 0.03, 0.22), M.medBody);
  lid.position.y = 0.105;
  g.add(lid);
  return g;
}

function buildAmmo() {
  const g = new THREE.Group();
  const M = mats();
  const body = new THREE.Mesh(cachedBox(0.32, 0.16, 0.2), M.ammoBody);
  body.castShadow = true;
  g.add(body);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(cachedBox(0.05, 0.06, 0.022), M.ammoBand);
    b.position.set(-0.1 + i * 0.1, 0.11, 0);
    g.add(b);
  }
  const lidL = new THREE.Mesh(cachedBox(0.1, 0.035, 0.2), M.ammoBody);
  lidL.position.set(0, 0.095, 0);
  g.add(lidL);
  return g;
}

export class PickupManager {
  constructor(scene, particles) {
    this.scene = scene;
    this.p = particles;
    this.drops = [];
    this._ammoMesh = null;   // pre-built templates cloned per drop
  }

  /** Roll + spawn drops at a killed hostile's feet. */
  spawnFrom(enemy) {
    const bonus = DROPS.bonus?.[enemy.cls] ?? 0;
    const elite = enemy.elite ? 0.1 : 0;
    if (chance(DROPS.ammoChance + bonus + elite)) this._spawn('ammo', enemy.group.position);
    if (chance(DROPS.medkitChance + bonus * 0.6 + elite)) this._spawn('medkit', enemy.group.position);
  }

  _spawn(kind, pos) {
    const mesh = kind === 'medkit' ? buildMedkit() : buildAmmo();
    const x = pos.x + rand(-0.35, 0.35);
    const z = pos.z + rand(-0.35, 0.35);
    mesh.position.set(x, 0.62, z);
    mesh.rotation.y = rand(0, 6.28);
    this.scene.add(mesh);
    this.p.dustPuff(x, 0.1, z, 3);
    this.drops.push({ kind, mesh, x, z, t: 0, bob: rand(0, 6.28) });
  }

  /**
   * Animate drops, expire old ones, and report (then remove) any the
   * player is standing on. `playerFeet` is the player's foot position.
   */
  update(dt, playerFeet) {
    const collected = [];
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      d.bob += dt * 2.4;
      d.mesh.rotation.y += dt * 1.2;
      d.mesh.position.y = 0.55 + Math.sin(d.bob) * 0.07;
      const dx = playerFeet.x - d.x, dz = playerFeet.z - d.z;
      if (dx * dx + dz * dz < 1.35 && playerFeet.y < 1.6) {
        collected.push(d.kind);
        const tint = d.kind === 'medkit' ? 0.9 : 0.75;
        this.p.smokePuff(d.x, 0.4, d.z, 4, tint);
        if (d.kind === 'medkit') this.p.sparkBurst(d.x, 0.5, d.z, 0, 1, 0, 6);
        this._remove(i);
        continue;
      }
      if (d.t > DROPS.lifetime) {
        // blink for the last two seconds, then fizzle out
        d.mesh.visible = Math.floor(d.t * 6) % 2 === 0;
        if (d.t > DROPS.lifetime + 2) this._remove(i);
      }
    }
    return collected;
  }

  _remove(i) {
    const d = this.drops[i];
    this.scene.remove(d.mesh);
    this.drops.splice(i, 1);
  }

  clear() {
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops.length = 0;
  }
}
