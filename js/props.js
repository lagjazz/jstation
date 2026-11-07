// ============================================================
// props.js — per-run battlefield dressing that changes every time a
// mission is armed: cover clusters (wooden crates, steel ammo lockers,
// sandbag walls, concrete jersey barriers) and EXPLOSIVE barrels.
//
// Props are placed at random open-floor spots (a 2 m clear radius, so
// they never plug a corridor), kept away from the player spawn and the
// enemy anchors, and are real geometry: dynamic AABB colliders (people
// and grenades bump into them) + raycast meshes (bullets stop, enemies
// use them as cover). Barrels take a few hits, start venting fire,
// then explode (chain reactions included).
// Meshes are baked meshKit parts sharing ONE material → one draw call
// per prop; instances are pooled and reused across missions.
// ============================================================

import * as THREE from 'three';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';
import { blockedAt } from './collision.js';
import { rand, chance } from './utils.js';

const WOOD = { r: 0.85, m: 0.02 };
const STEEL = { r: 0.45, m: 0.7 };
const PAINT = { r: 0.55, m: 0.35 };
const ROUGH = { r: 0.95, m: 0 };

function crateGeo() {
  const L = new PartList();
  L.add(G.box(1.2, 1.0, 1.0), 0x7a5a36, 0, 0.5, 0, WOOD);
  for (const y of [0.06, 0.94]) for (const z of [-0.47, 0.47]) L.add(G.box(1.24, 0.1, 0.08), 0x5d4326, 0, y, z, WOOD);
  for (const x of [-0.57, 0.57]) for (const z of [-0.47, 0.47]) L.add(G.box(0.08, 1.0, 0.08), 0x5d4326, x, 0.5, z, WOOD);
  L.add(G.box(1.5, 0.08, 0.06), 0x5d4326, 0, 0.5, 0.51, { ...WOOD, rot: [0, 0, 0.62] });
  L.add(G.box(1.5, 0.08, 0.06), 0x5d4326, 0, 0.5, -0.51, { ...WOOD, rot: [0, 0, -0.62] });
  L.add(G.box(0.3, 0.16, 0.01), 0x1a1a1a, 0.3, 0.75, 0.506, ROUGH);   // stencil
  return { ...L.bake(), w: 1.2, h: 1.0, d: 1.0, tag: 'wood' };
}

function stackGeo() {
  const L = new PartList();
  L.add(G.box(1.1, 0.9, 0.9), 0x6e5232, -0.35, 0.45, 0, WOOD);
  L.add(G.box(1.1, 0.9, 0.9), 0x7a5a36, 0.75, 0.45, 0.05, WOOD);
  L.add(G.box(1.0, 0.8, 0.85), 0x6a4e30, 0.2, 1.3, 0, { ...WOOD, rot: [0, 0.12, 0] });
  for (const [x, y] of [[-0.35, 0.45], [0.75, 0.45], [0.2, 1.3]]) {
    L.add(G.box(1.14, 0.08, 0.95), 0x4c3720, x, y + 0.36, 0, WOOD);
    L.add(G.box(1.14, 0.08, 0.95), 0x4c3720, x, y - 0.36, 0, WOOD);
  }
  return { ...L.bake(), w: 2.3, h: 1.7, d: 1.0, tag: 'wood', ox: 0.2 };
}

function lockerGeo() {
  const L = new PartList();
  L.add(G.box(1.6, 0.85, 0.75), 0x3c4a34, 0, 0.45, 0, PAINT);
  L.add(G.box(1.64, 0.08, 0.79), 0x2a3326, 0, 0.88, 0, PAINT);
  for (const x of [-0.55, 0, 0.55]) L.add(G.box(0.06, 0.8, 0.8), 0x2a3326, x, 0.45, 0, PAINT);
  for (const x of [-0.3, 0.3]) L.add(G.box(0.14, 0.05, 0.05), 0x8a8f96, x, 0.65, 0.41, STEEL);
  L.add(G.box(0.4, 0.12, 0.01), 0xc8a030, 0, 0.35, 0.381, PAINT);
  return { ...L.bake(), w: 1.6, h: 0.92, d: 0.8, tag: 'metal' };
}

function sandbagGeo() {
  const L = new PartList();
  const bag = G.cap(0.15, 0.42, 3, 8);
  for (let row = 0; row < 4; row++) {
    const n = 5 - (row % 2);
    for (let i = 0; i < n; i++) {
      const x = -1.0 + i * 0.5 + (row % 2) * 0.25;
      const tone = [0x8a7a58, 0x7d6e50, 0x948260][(i + row) % 3];
      L.add(bag, tone, x, 0.15 + row * 0.26, rand(-0.03, 0.03), { ...ROUGH, rot: [0, rand(-0.08, 0.08), Math.PI / 2], s: [1, 1, 1.5] });
    }
  }
  return { ...L.bake(), w: 2.4, h: 1.1, d: 0.6, tag: 'concrete' };
}

function barrierGeo() {
  const L = new PartList();
  L.add(G.box(2.2, 0.3, 0.7), 0x9a968c, 0, 0.15, 0, ROUGH);
  L.add(G.box(2.2, 0.6, 0.38), 0x9a968c, 0, 0.6, 0, ROUGH);
  L.add(G.box(2.2, 0.12, 0.25), 0xa6a298, 0, 0.96, 0, ROUGH);
  for (const x of [-0.8, 0, 0.8]) L.add(G.box(0.3, 0.12, 0.01), 0xd8b020, x, 0.7, 0.195, PAINT);
  return { ...L.bake(), w: 2.2, h: 1.02, d: 0.7, tag: 'concrete' };
}

function barrelGeo() {
  const L = new PartList();
  L.add(G.cyl(0.32, 0.32, 0.95, 18), 0xa8261c, 0, 0.475, 0, PAINT);
  for (const y of [0.04, 0.33, 0.62, 0.91]) L.add(G.tor(0.322, 0.018, 6, 22), 0x7a1a14, 0, y, 0, { ...PAINT, rot: [Math.PI / 2, 0, 0] });
  L.add(G.cyl(0.29, 0.29, 0.02, 18), 0x5a1410, 0, 0.955, 0, PAINT);
  L.add(G.cyl(0.05, 0.05, 0.04, 10), 0x8a8f96, 0.14, 0.97, 0.05, STEEL);
  L.add(G.box(0.24, 0.24, 0.01), 0xf0d020, 0, 0.55, 0.322, PAINT);                       // hazard diamond
  L.add(G.box(0.12, 0.12, 0.012), 0x111111, 0, 0.55, 0.325, { ...PAINT, rot: [0, 0, Math.PI / 4] });
  const glow = new PartList();
  return { ...L.bake(), glowGeo: glow.bake().glowGeo, w: 0.7, h: 0.95, d: 0.7, tag: 'metal' };
}

const KINDS = ['crate', 'stack', 'locker', 'sandbag', 'barrier'];
const AREA_STYLE = {
  // area → weighted cover kinds that fit the setting
  hall: ['barrier', 'crate', 'locker'], platform: ['barrier', 'crate', 'sandbag'],
  garden: ['sandbag', 'crate', 'stack'], cyber: ['crate', 'stack', 'locker'],
  moon: ['locker', 'locker', 'crate'], tomb: ['crate', 'stack', 'sandbag'],
  skyport: ['crate', 'stack', 'locker'], lab: ['locker', 'barrier', 'locker'],
  atlantis: ['crate', 'locker', 'barrier'], ice: ['crate', 'locker', 'sandbag'],
  canopy: ['crate', 'stack', 'sandbag'], canyon: ['sandbag', 'stack', 'barrier'],
  aquarium: ['locker', 'crate', 'barrier'],
};
// rotating floors / cargo lanes: no loose dressing
const NO_PROPS = new Set(['clockwork', 'orbit']);

export class PropManager {
  constructor(scene, world, particles, audio) {
    this.scene = scene;
    this.world = world;
    this.p = particles;
    this.audio = audio;
    this.mat = RMMaterial();
    this.glowMat = GlowMaterial(2);
    this.geos = { crate: crateGeo(), stack: stackGeo(), locker: lockerGeo(), sandbag: sandbagGeo(), barrier: barrierGeo(), barrel: barrelGeo() };
    this.pool = {};
    this.active = [];
    this.barrels = [];
    this.raycastMeshes = [];
    this.dirty = false;
  }

  _take(kind) {
    const list = this.pool[kind] ?? (this.pool[kind] = []);
    let m = list.pop();
    if (!m) {
      m = new THREE.Mesh(this.geos[kind].geo, this.mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.tag = this.geos[kind].tag;
      m.userData.kind = kind;
      this.scene.add(m);
    }
    m.visible = true;
    return m;
  }

  /** Warm-up: one of every kind placed in front of the camera (prewarm pass). */
  warm(x, z) {
    const out = [];
    let i = 0;
    for (const k of [...KINDS, 'barrel']) {
      const m = this._take(k);
      m.position.set(x + (i++ - 3) * 1.5, 0, z);
      out.push(m);
    }
    return () => { for (const m of out) { m.visible = false; this.pool[m.userData.kind].push(m); } };
  }

  clear() {
    for (const a of this.active) {
      a.mesh.visible = false;
      this.pool[a.mesh.userData.kind].push(a.mesh);
      if (a.col) this.world.removeDynamicBox(a.col);
    }
    this.active = [];
    this.barrels = [];
    this.raycastMeshes = [];
    this.dirty = true;
  }

  /**
   * Dress the arena. rect = arena interior (null for station areas → use
   * anchors), anchors = spawn pool, avoid = [{x,z,r}] keep-out circles.
   */
  setup(area, rect, anchors, avoid, density = 1) {
    this.clear();
    if (NO_PROPS.has(area)) return;
    const style = AREA_STYLE[area] ?? KINDS;
    const nCover = Math.round(rand(5, 8) * density);
    const nBarrel = Math.round(rand(3, 5) * density);
    const keep = avoid.slice();
    for (const a of anchors) keep.push({ x: a.pos[0], z: a.pos[1], r: 2.2 });
    const spot = () => {
      for (let k = 0; k < 40; k++) {
        let x, z;
        if (rect) {
          x = rand(rect.x0 + 3, rect.x1 - 3);
          z = rand(rect.z0 + 3, rect.z1 - 3);
        } else {
          const a = anchors[Math.floor(Math.random() * anchors.length)];
          const ang = rand(0, Math.PI * 2), r = rand(3, 7);
          x = a.pos[0] + Math.cos(ang) * r;
          z = a.pos[1] + Math.sin(ang) * r;
        }
        if (keep.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) continue;
        if (blockedAt(this.world, x, z, 2.0, 0, 2.2)) continue;      // open floor only
        if (this._groundY(x, z) > 0.05) continue;
        return { x, z };
      }
      return null;
    };
    for (let i = 0; i < nCover; i++) {
      const s = spot();
      if (!s) continue;
      const kind = style[Math.floor(Math.random() * style.length)];
      this._place(kind, s.x, s.z, chance(0.5) ? 0 : Math.PI / 2);
      keep.push({ x: s.x, z: s.z, r: 3.5 });
    }
    for (let i = 0; i < nBarrel; i++) {
      const s = spot();
      if (!s) continue;
      const b = this._place('barrel', s.x, s.z, rand(0, 6.28));
      b.hp = 38;
      b.burn = -1;
      this.barrels.push(b);
      b.mesh.userData.barrel = b;
      keep.push({ x: s.x, z: s.z, r: 2.5 });
      // sometimes a second barrel right beside it — chain reaction bait
      if (chance(0.35)) {
        const b2 = this._place('barrel', s.x + 0.8, s.z + rand(-0.3, 0.3), rand(0, 6.28));
        b2.hp = 38; b2.burn = -1;
        this.barrels.push(b2);
        b2.mesh.userData.barrel = b2;
      }
    }
    this.dirty = true;
  }

  _groundY(x, z) {
    const boxes = this.world.near(x, z, 0.6);
    let top = 0;
    for (const b of boxes) {
      if (x + 0.6 > b.min.x && x - 0.6 < b.max.x && z + 0.6 > b.min.z && z - 0.6 < b.max.z &&
          b.max.y <= 0.6 && b.max.y > top) top = b.max.y;
    }
    return top;
  }

  _place(kind, x, z, rotY) {
    const g = this.geos[kind];
    const m = this._take(kind);
    m.position.set(x, 0, z);
    m.rotation.set(0, kind === 'barrel' ? rotY : rotY, 0);
    m.updateMatrixWorld();
    // AABB: barrels are round; others are axis-aligned at 0 / 90°
    const quarter = Math.abs(Math.sin(rotY)) > 0.7 && kind !== 'barrel';
    const ox = (g.ox ?? 0) * (quarter ? 0 : 1), oz = (g.ox ?? 0) * (quarter ? -1 : 0);
    const hw = (quarter ? g.d : g.w) / 2, hd = (quarter ? g.w : g.d) / 2;
    const col = this.world.addDynamicBox(
      new THREE.Vector3(x + ox - hw, 0, z + oz - hd),
      new THREE.Vector3(x + ox + hw, g.h, z + oz + hd),
    );
    const rec = { mesh: m, col, kind };
    this.active.push(rec);
    this.raycastMeshes.push(m);
    return rec;
  }

  /** A bullet hit a barrel. Returns true when it was a barrel. */
  hitBarrel(mesh, dmg) {
    const b = mesh.userData.barrel;
    if (!b || b.dead) return false;
    b.hp -= dmg;
    const p = mesh.position;
    if (b.burn < 0 && b.hp < 26) {
      b.burn = rand(1.1, 1.8);        // punctured: vents fire, then goes up
      this.audio.play('ventHiss', { volume: 0.6 });
    }
    if (b.hp <= 0) b.burn = Math.min(b.burn < 0 ? 0 : b.burn, 0.05);
    this.p.sparkBurst(p.x, p.y + 0.6, p.z, 0, 1, 0, 5);
    return true;
  }

  /** Explosion blast reached barrels: they cook off quickly (chains). */
  blast(pos, r) {
    for (const b of this.barrels) {
      if (b.dead) continue;
      const d = Math.hypot(b.mesh.position.x - pos.x, b.mesh.position.z - pos.z);
      if (d < r) b.burn = b.burn < 0 ? rand(0.12, 0.35) : Math.min(b.burn, rand(0.12, 0.35));
    }
  }

  /** Returns barrels that blew up this frame (caller runs the explosion). */
  update(dt) {
    const out = [];
    for (const b of this.barrels) {
      if (b.dead || b.burn < 0) continue;
      b.burn -= dt;
      const p = b.mesh.position;
      if (Math.random() < 30 * dt) this.p.sparkBurst(p.x, p.y + 1.0, p.z, rand(-0.3, 0.3), 1, rand(-0.3, 0.3), 2);
      if (Math.random() < 12 * dt) this.p.smokePuff(p.x, p.y + 1.1, p.z, 1, 0.3, null, 0.8);
      if (b.burn <= 0) {
        b.dead = true;
        b.mesh.visible = false;
        this.world.removeDynamicBox(b.col);
        b.col = null;
        this.raycastMeshes = this.raycastMeshes.filter((m) => m !== b.mesh);
        this.dirty = true;
        out.push(p.clone().setY(0.5));
      }
    }
    return out;
  }
}
