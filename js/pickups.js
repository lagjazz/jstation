// ============================================================
// pickups.js — battlefield salvage. Dead hostiles roll every entry of
// DROPS (config.js): ammo, medkits, armor plates, frag grenades,
// weapon crates and two timed buffs (OVERDRIVE damage, HASTE speed).
//
// Drops spawn at the corpse's OWN level (elevated walkways included),
// bob and spin with a coloured ground ring + faint light shaft so they
// read at a distance, blink out after DROPS.lifetime, and are grabbed
// by walking over them. Models are baked meshKit parts (one shared
// material, one draw call each) and every mesh is pooled; no lights
// are created (constant light count = no shader recompiles).
// ============================================================

import * as THREE from 'three';
import { DROPS } from './config.js';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';
import { rand, chance } from './utils.js';

const STEEL = { r: 0.4, m: 0.75 };
const PAINT = { r: 0.55, m: 0.25 };
const SOFT = { r: 0.85, m: 0.02 };

const COLOR = {
  ammo: 0xffc23a, medkit: 0xff3a3a, armor: 0x4aa8ff, grenade: 0x9aff4a,
  weapon: 0xff8a2a, overdrive: 0xff2a6a, haste: 0x3affe0,
};

function model(kind) {
  const L = new PartList();
  switch (kind) {
    case 'medkit':
      L.add(G.box(0.34, 0.2, 0.24), 0xe2e5e8, 0, 0, 0, PAINT);
      L.add(G.box(0.35, 0.04, 0.25), 0xb8bcc0, 0, 0.1, 0, PAINT);
      L.add(G.box(0.08, 0.04, 0.03), 0x30343a, 0, 0.13, 0, STEEL);       // handle
      L.add(G.box(0.2, 0.06, 0.01), 0xff2a2a, 0, 0.0, 0.121, { glow: true });
      L.add(G.box(0.06, 0.18, 0.01), 0xff2a2a, 0, 0.0, 0.121, { glow: true });
      break;
    case 'ammo':
      L.add(G.box(0.36, 0.18, 0.2), 0x3d4632, 0, 0, 0, PAINT);
      L.add(G.box(0.37, 0.04, 0.21), 0x2c3324, 0, 0.1, 0, PAINT);
      for (let i = 0; i < 5; i++) L.add(G.cyl(0.018, 0.018, 0.1, 8), 0xc8a040, -0.12 + i * 0.06, 0.16, 0, STEEL);
      L.add(G.box(0.16, 0.05, 0.01), 0xffc23a, 0, -0.02, 0.101, { glow: true });
      break;
    case 'armor':
      L.add(G.box(0.3, 0.38, 0.05), 0x22303e, 0, 0, 0, { r: 0.5, m: 0.5, rot: [0.1, 0, 0] });
      L.add(G.box(0.26, 0.1, 0.06), 0x161e28, 0, 0.12, 0.01, PAINT);
      L.add(G.box(0.2, 0.03, 0.01), 0x4aa8ff, 0, -0.05, 0.034, { glow: true, rot: [0.1, 0, 0] });
      break;
    case 'grenade':
      L.add(G.sph(0.08, 12, 9), 0x3a4430, 0, 0, 0, { ...PAINT, s: [1, 1.2, 1] });
      L.add(G.cyl(0.03, 0.035, 0.05, 8), 0x8a8f96, 0, 0.1, 0, STEEL);
      L.add(G.box(0.02, 0.07, 0.03), 0x8a8f96, 0.03, 0.08, 0, STEEL);
      L.add(G.tor(0.025, 0.006, 4, 10), 0xc8c8c8, -0.03, 0.13, 0, STEEL);
      L.add(G.tor(0.081, 0.006, 4, 20), 0x9aff4a, 0, 0, 0, { glow: true, rot: [Math.PI / 2, 0, 0] });
      break;
    case 'weapon':
      L.add(G.box(0.7, 0.16, 0.26), 0x2e3a2a, 0, 0, 0, PAINT);
      L.add(G.box(0.72, 0.03, 0.27), 0x1d2419, 0, 0.09, 0, PAINT);
      for (const x of [-0.25, 0.25]) L.add(G.box(0.05, 0.05, 0.28), 0x8a8f96, x, 0.03, 0, STEEL);
      L.add(G.box(0.4, 0.04, 0.01), 0xff8a2a, 0, 0, 0.131, { glow: true });
      break;
    case 'overdrive':
      L.add(G.cyl(0.07, 0.07, 0.24, 12), 0x2a0a14, 0, 0, 0, STEEL);
      L.add(G.cyl(0.055, 0.055, 0.18, 12), 0xff2a6a, 0, 0, 0, { glow: true, s: [1.02, 1, 1.02] });
      L.add(G.cyl(0.075, 0.075, 0.03, 12), 0x8a8f96, 0, 0.13, 0, STEEL);
      break;
    case 'haste':
      L.add(G.cyl(0.07, 0.07, 0.24, 12), 0x0a2a28, 0, 0, 0, STEEL);
      L.add(G.cyl(0.055, 0.055, 0.18, 12), 0x3affe0, 0, 0, 0, { glow: true, s: [1.02, 1, 1.02] });
      L.add(G.cyl(0.075, 0.075, 0.03, 12), 0x8a8f96, 0, 0.13, 0, STEEL);
      break;
  }
  return L.bake();
}

export const DROP_KINDS = Object.keys(COLOR);

export class PickupManager {
  constructor(scene, particles) {
    this.scene = scene;
    this.p = particles;
    this.drops = [];
    this._pool = {};
    this.mat = RMMaterial();
    this.glow = GlowMaterial(2.4);
    this.geos = {};
    for (const k of DROP_KINDS) this.geos[k] = model(k);
    this._ringGeo = new THREE.RingGeometry(0.34, 0.4, 32);
    this._ringGeo.rotateX(-Math.PI / 2);
    this._shaftGeo = new THREE.CylinderGeometry(0.015, 0.09, 1.5, 8, 1, true);
    this._shaftGeo.translate(0, 0.75, 0);
    this._fxMats = {};
    for (const k of DROP_KINDS) {
      const c = new THREE.Color(COLOR[k]);
      this._fxMats[k] = {
        ring: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
        shaft: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      };
    }
  }

  _build(kind) {
    const g = new THREE.Group();
    const item = new THREE.Group();
    const geo = this.geos[kind];
    const body = new THREE.Mesh(geo.geo, this.mat);
    body.castShadow = true;
    item.add(body);
    if (geo.glowGeo) item.add(new THREE.Mesh(geo.glowGeo, this.glow));
    g.add(item);
    const ring = new THREE.Mesh(this._ringGeo, this._fxMats[kind].ring);
    ring.position.y = 0.03;
    const shaft = new THREE.Mesh(this._shaftGeo, this._fxMats[kind].shaft);
    g.add(ring, shaft);
    g.userData = { item, kind };
    return g;
  }

  _take(kind) {
    const list = this._pool[kind] ?? (this._pool[kind] = []);
    const m = list.pop() ?? this._build(kind);
    m.visible = true;
    if (!m.parent) this.scene.add(m);
    return m;
  }

  /**
   * Roll + spawn drops at a killed hostile's feet.
   * mods: { dropBonus, wantWeapon (bool: a locked weapon exists) }
   */
  spawnFrom(enemy, mods = {}) {
    const bonus = (DROPS.bonus?.[enemy.cls] ?? 0) + (enemy.elite ? 0.1 : 0) + (mods.dropBonus ?? 0);
    const pos = enemy.group.position;
    const y = enemy.anchorY ?? 0;
    const roll = (c) => chance(Math.min(0.95, c));
    if (roll(DROPS.ammoChance + bonus)) this.spawn('ammo', pos.x, y, pos.z);
    if (roll(DROPS.medkitChance + bonus * 0.6)) this.spawn('medkit', pos.x, y, pos.z);
    if (roll(DROPS.armorChance + bonus * 0.5)) this.spawn('armor', pos.x, y, pos.z);
    if (roll(DROPS.grenadeChance + bonus * 0.4)) this.spawn('grenade', pos.x, y, pos.z);
    if (enemy.boss || roll(DROPS.weaponChance + bonus * 0.15)) this.spawn('weapon', pos.x, y, pos.z);
    const buff = chance(0.5) ? 'overdrive' : 'haste';
    if (enemy.boss || roll((buff === 'overdrive' ? DROPS.overdriveChance : DROPS.hasteChance) + bonus * 0.2)) {
      this.spawn(buff, pos.x, y, pos.z);
    }
  }

  spawn(kind, px, y, pz) {
    const mesh = this._take(kind);
    const x = px + rand(-0.55, 0.55);
    const z = pz + rand(-0.55, 0.55);
    mesh.position.set(x, y, z);
    mesh.userData.item.rotation.y = rand(0, 6.28);
    this.p.dustPuff(x, y + 0.1, z, 3);
    this.drops.push({ kind, mesh, x, y, z, t: 0, bob: rand(0, 6.28) });
  }

  /** Back-compat: drop at a world position (y = level). */
  _spawn(kind, pos) { this.spawn(kind, pos.x, Math.max(0, pos.y - 0.62), pos.z); }

  /**
   * Animate drops, expire old ones, and report (then remove) any the
   * player is standing on. Returns the collected kinds.
   */
  update(dt, playerFeet) {
    const collected = [];
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      d.bob += dt * 2.4;
      const it = d.mesh.userData.item;
      it.rotation.y += dt * 1.3;
      it.position.y = 0.5 + Math.sin(d.bob) * 0.07;
      const dx = playerFeet.x - d.x, dz = playerFeet.z - d.z;
      if (dx * dx + dz * dz < 1.4 && Math.abs(playerFeet.y - d.y) < 1.2) {
        collected.push(d.kind);
        this.p.smokePuff(d.x, d.y + 0.4, d.z, 3, 0.85);
        this.p.sparkBurst(d.x, d.y + 0.5, d.z, 0, 1, 0, 6);
        this._remove(i);
        continue;
      }
      if (d.t > DROPS.lifetime) {
        d.mesh.visible = Math.floor(d.t * 6) % 2 === 0;
        if (d.t > DROPS.lifetime + 2) this._remove(i);
      }
    }
    return collected;
  }

  _remove(i) {
    const d = this.drops[i];
    d.mesh.visible = false;
    this._pool[d.kind].push(d.mesh);
    this.drops.splice(i, 1);
  }

  clear() {
    for (let i = this.drops.length - 1; i >= 0; i--) this._remove(i);
  }
}
