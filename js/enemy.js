// ============================================================
// enemy.js — hostile figures with a full FSM:
//   IDLE ↔ PATROL → (detect: vision cone / LoS / hearing) → CHASE
//   → ATTACK (windup, tracer, hit-roll) → HIT stagger → DEAD fall.
// Missions deploy hostiles in REINFORCEMENT WAVES: a first batch at
// random anchors, later batches dropping in every WAVES.gap seconds
// (see EnemyManager.deploy / update). Spawn positions are RANDOMIZED
// from per-area SPAWN_POOLS (jittered + validated against the
// collider world), each with a randomized patrol loop.
// Classes (config.js ENEMY.classes): rifle / rusher / heavy /
// marksman, each with distinct stats and visual silhouette; the
// mission `elite` flag adds red band + strobe and buffs.
// Detailed procedural tactical model (capsule limbs, helmet + NVG
// mount, plate carrier, pouches, backpack, carbine) or
// assets/models/enemy.glb. Invisible head/body hitboxes, hit-flash,
// knockback, positional gunfire, muzzle flash + light + smoke when
// firing. NO blood — feedback is flash + particles + sound.
// Geometry is shared through a module cache so respawning a fresh
// wave never re-uploads buffers to the GPU mid-fight.
// ============================================================

import * as THREE from 'three';
import { ENEMY, PLAYER, WAVES } from './config.js';
import { cachedBox } from './build.js';
import { moveAndSlideSimple } from './collision.js';
import { TEX } from './textures.js';
import { clamp, damp, rand, chance } from './utils.js';

export const ESTATE = {
  IDLE: 'IDLE', PATROL: 'PATROL', CHASE: 'CHASE', ATTACK: 'ATTACK', HIT: 'HIT', DEAD: 'DEAD',
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

let enemyMatSeed = 0;

// ---------- shared geometry cache (one BufferGeometry per size) ----------
const _capGeo = new Map();
const _sphGeo = new Map();
const _cylGeo = new Map();
const box = (w, h, d) => cachedBox(w, h, d);
const cap = (r, len) => {
  const k = `c|${r}|${len}`;
  if (!_capGeo.has(k)) _capGeo.set(k, new THREE.CapsuleGeometry(r, len, 3, 7));
  return _capGeo.get(k);
};
const sph = (r, ws, hs) => {
  const k = `s|${r}|${ws}|${hs}`;
  if (!_sphGeo.has(k)) _sphGeo.set(k, new THREE.SphereGeometry(r, ws, hs));
  return _sphGeo.get(k);
};
const cyl = (r1, r2, h, seg) => {
  const k = `y|${r1}|${r2}|${h}|${seg}`;
  if (!_cylGeo.has(k)) _cylGeo.set(k, new THREE.CylinderGeometry(r1, r2, h, seg));
  return _cylGeo.get(k);
};

// ------------------------------------------------------------
// Spawn pools — one per campaign area. `pos` is a home anchor and
// `wps` a safe patrol loop; every batch picks anchors/patrol order
// randomly (avoiding anchors already held by live hostiles), jitters
// everything, so hostiles never stand in the same spots twice.
// Anchors are authored in open floor away from props; _freeSpot()
// guarantees the final position is clear. Original station areas
// live here; the six sector maps register their pools in newAreas.js.
// ------------------------------------------------------------
export const SPAWN_POOLS = {
  hall: [
    { pos: [-30, -9],     wps: [[-30, -9], [-23, -12.5], [-27, -3], [-34, -4.5]] },
    { pos: [-6, 6],      wps: [[-6, 6], [2, 10.5], [-10, 11.5], [-14, 3.5]] },
    { pos: [1, -10.5],   wps: [[1, -10.5], [-6, -9], [-1, -6.5]] },
    { pos: [-24, 3],     wps: [[-24, 3], [-17, -2], [-28, -6], [-31, 5]] },
    { pos: [-36, 9],     wps: [[-36, 9], [-30, 12.5], [-24, 10], [-33, 5.5]] },
    { pos: [-2, 11.5],   wps: [[-2, 11.5], [-9, 10], [-5, 12.8]] },
  ],
  platform: [
    { pos: [-30, 21],    wps: [[-30, 21], [-23, 19], [-17, 21.5]] },
    { pos: [-16, 18],    wps: [[-16, 18], [-9, 17], [-3, 19.5], [-12, 22]] },
    { pos: [-4, 22],     wps: [[-4, 22], [3, 21], [8, 22.5], [1, 23.5]] },
    { pos: [-34, 18],    wps: [[-34, 18], [-37, 21], [-29, 22.5]] },
    { pos: [6, 17],      wps: [[6, 17], [0, 16], [-5, 18]] },
    { pos: [-22, 23],    wps: [[-22, 23], [-15, 23.5], [-27, 22]] },
  ],
  garden: [
    { pos: [14.5, 4],    wps: [[14.5, 4], [20, 6], [14, 9.5], [19, 1]] },
    { pos: [24, 1],      wps: [[24, 1], [21, -3], [24.5, -5], [19, 2]] },
    { pos: [15, -6],     wps: [[15, -6], [20, -8], [22.5, -3.5], [17, -1]] },
    { pos: [24, 11],     wps: [[24, 11], [20, 12.5], [23, 8]] },
    { pos: [19, 5],      wps: [[19, 5], [15, 2], [22, 3], [18, 10]] },
    { pos: [13.5, -9],   wps: [[13.5, -9], [18, -8.5], [14, -5.5]] },
  ],
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function splitWaves(count) {
  const [lo, hi] = WAVES.batchSize;
  const out = [];
  let left = count;
  while (left > 0) {
    const n = Math.min(left, Math.floor(rand(lo, hi + 1)));
    out.push(n);
    left -= n;
  }
  return out;
}

export class Enemy {
  constructor(index, scene, gltfScene, waypoints, opts = {}) {
    this.index = index;
    this.scene = scene;
    this.waypoints = waypoints;
    this.wpIndex = 0;
    this.elite = !!opts.elite;
    this.cls = ENEMY.classes[opts.cls] ? opts.cls : 'rifle';
    const C = ENEMY.classes[this.cls];

    // ---- class-resolved combat stats (base overridden per class) ----
    const eliteHp = this.elite ? ENEMY.eliteHpMultiplier : 1;
    this.maxHp = ENEMY.hp * (C.hpMul ?? 1) * eliteHp;
    this.speedScale = (C.chaseMul ?? 1) * (this.elite ? ENEMY.eliteSpeedScale : 1);
    this.patrolScale = (C.patrolMul ?? 1) * (this.elite ? ENEMY.eliteSpeedScale : 1);
    this.viewDistance = C.viewDistance ?? ENEMY.viewDistance;
    this.attackRange = C.attackRange ?? ENEMY.attackRange;
    this.loseRange = C.loseRange ?? ENEMY.loseRange;
    this.fireGap = C.fireGap ?? ENEMY.fireGap;
    this.fireRateScale = this.speedScale;
    this.hitBias = C.hitBias ?? 0;
    this.dmgMin = C.damageMin ?? ENEMY.damageMin;
    this.dmgMax = C.damageMax ?? ENEMY.damageMax;
    this.bodyScale = C.scale ?? 1;
    this.keepDist = C.keepDist ?? 0;   // kites away when the player crowds it
    this.shots = C.shots ?? 1;         // >1 = shotgun-like pellet pattern
    this.quiet = !!C.quiet;           // no detection grunt (stalker)
    this.bigShot = !!C.bigShot;       // heavier muzzle FX
    this.aimSpeed = C.aimSpeed ?? 8;  // how fast the weapon comes to the shoulder
    this.ghost = !!C.ghost;           // phantom: pulsing translucency
    this.aimAmt = 0;                  // 0 = gun at low-ready, 1 = shouldered/aiming
    this.recoil = 0;                  // decaying kick applied to gun + arms
    this.ghostT = rand(1.4, 2.6);
    this.ghostOn = true;

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    scene.add(this.group);

    this.state = ESTATE.IDLE;
    this.prevState = ESTATE.PATROL;
    this.hp = this.maxHp;
    this.stateT = rand(0, 2);
    this.walkPhase = rand(0, 6);
    this.moveAmt = 0;
    this.knock = new THREE.Vector3();
    this.flash = 0;
    this.deadT = 0;
    this.losTimer = rand(0, 0.25);
    this.losOK = false;
    this.fireCd = rand(0.6, 1.4);
    this.windup = 0;
    this.strafeDir = 0;
    this.strafeT = 0;
    this.lastKnown = new THREE.Vector3();
    this.pa = null;               // positional gunfire
    this.anchorIdx = -1;          // pool anchor this enemy holds (wave de-conflict)

    this.hitMeshes = [];
    this.gltfAnim = null;

    this._build(gltfScene);
  }

  _build(gltf) {
    const body = this.body;
    if (gltf) {
      const src = gltf.scene ?? gltf;
      const root = src.clone(true);
      const b = new THREE.Box3().setFromObject(root);
      const size = b.getSize(new THREE.Vector3());
      const s = 1.75 / Math.max(size.y, 0.01);
      root.scale.setScalar(s);
      b.setFromObject(root);
      const c = b.getCenter(new THREE.Vector3());
      root.position.set(-c.x, -b.min.y, -c.z);
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.userData.tag = 'flesh';
          o.userData.enemy = this;
          o.userData.part = 'body';
          this.hitMeshes.push(o);
        }
      });
      body.add(root);
      if (gltfScene.animations && gltfScene.animations.length) {
        this.mixer = new THREE.AnimationMixer(root);
        const clip = THREE.AnimationClip.findByName(gltfScene.animations, 'Idle') ?? gltfScene.animations[0];
        if (clip) this.gltfAnim = this.mixer.clipAction(clip).play();
      }
      // muzzle anchor for gunfire FX even without a procedural rifle
      this.rifleTip = new THREE.Object3D();
      this.rifleTip.position.set(0.16, 1.35, 0.35);
      body.add(this.rifleTip);
      this._addHitboxes();
      this._addFlash();
      return;
    }

    // ---------------- detailed procedural model ----------------
    const seed = (enemyMatSeed++ % 3);
    const elite = this.elite;
    const cls = this.cls;

    // per-class silhouettes: suits / helmets / visors + gear extras
    const suits = {
      rifle:      [0x262b36, 0x2d2a26, 0x232f2a],
      rusher:     [0x32241e, 0x3a2d20, 0x2e2426],
      heavy:      [0x232830, 0x282b31, 0x1f2733],
      marksman:   [0x20282a, 0x242b25, 0x28282e],
      stalker:    [0x1b1b22, 0x201a26, 0x181c20],
      breacher:   [0x2e3428, 0x33382c, 0x2a3026],
      bombardier: [0x33241a, 0x2e2a20, 0x35281f],
      flamer:     [0x3a2410, 0x33281a, 0x3d1f12],
      phantom:    [0x26283a, 0x1f2435, 0x2a2636],
      juggernaut: [0x20242c, 0x25222a, 0x1c2228],
    }[cls];
    const helmets = elite
      ? [0x3a1d1d, 0x3a1d1d, 0x3a1d1d]
      : {
        rifle:      [0x2a2f3a, 0x33302a, 0x27332c],
        rusher:     [0x3a2b1d, 0x33261c, 0x3a2420],
        heavy:      [0x2c3442, 0x31394a, 0x28303e],
        marksman:   [0x22302a, 0x28332c, 0x202c26],
        stalker:    [0x18161d, 0x1d1a24, 0x16181c],
        breacher:   [0x2c3326, 0x31382a, 0x282e22],
        bombardier: [0x3a2415, 0x33231a, 0x3a2a18],
        flamer:     [0x40200e, 0x3a2812, 0x431a0a],
        phantom:    [0x2c3048, 0x242a3e, 0x303246],
        juggernaut: [0x282e38, 0x2d2c34, 0x222831],
      }[cls];
    const visorColor = elite ? 0xff2222
      : { rifle: 0xff3030, rusher: 0xff8a1e, heavy: 0x3aa0ff, marksman: 0x3dff7a,
          stalker: 0xb040ff, breacher: 0xaaff3a, bombardier: 0xff6a00,
          flamer: 0xff9500, phantom: 0x7df9ff, juggernaut: 0xffc300 }[cls];

    const suitMat = new THREE.MeshStandardMaterial({ color: suits[seed], roughness: 0.78, metalness: 0.06 });
    const vestMat = new THREE.MeshStandardMaterial({ color: cls === 'heavy' ? 0x1a202a : 0x14181f, roughness: 0.62, metalness: cls === 'heavy' ? 0.4 : 0.22 });
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.85, metalness: 0.05 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: helmets[seed], roughness: 0.5, metalness: 0.3 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 0.9 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.95 });  // balaclava
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x110505, emissive: visorColor,
      emissiveIntensity: elite ? 2.3 : 1.6, roughness: 0.3,
    });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.45, metalness: 0.55 });
    const gunPoly = new THREE.MeshStandardMaterial({ color: 0x191c22, roughness: 0.75, metalness: 0.1 });
    if (this.ghost) {                       // phantom suit shimmers semi-transparent
      suitMat.transparent = true;
      suitMat.opacity = 0.85;
    }
    this.suitMat = suitMat;
    this.visorMat = visorMat;

    const mk = (geo, mat, x, y, z, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.tag = 'flesh';
      parent.add(m);
      return m;
    };

    // ---------- legs: hip + knee joints (articulated walk cycle) ----------
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.1 * s, 0.92, 0);
      body.add(hip);
      mk(cap(0.078, 0.16), suitMat, 0, -0.19, 0, hip);                 // thigh
      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0);
      hip.add(knee);
      mk(cap(0.066, 0.18), suitMat, 0, -0.24, 0, knee);                // shin
      mk(box(0.14, 0.1, 0.27), strapMat, 0, -0.46, 0.035, knee);       // boot
      hip.knee = knee;
      if (s < 0) this.legL = hip; else this.legR = hip;
    }
    mk(box(0.09, 0.16, 0.07), vestMat, 0, -0.22, -0.09, this.legR);    // thigh holster
    if (cls === 'heavy' || cls === 'juggernaut') {
      mk(box(0.19, 0.3, 0.13), vestMat, 0, -0.05, 0.1, this.legL.knee);   // knee/thigh armor
      mk(box(0.19, 0.3, 0.13), vestMat, 0, -0.05, 0.1, this.legR.knee);
    }
    if (cls === 'rusher' || cls === 'stalker') {
      const sheath = mk(box(0.05, 0.26, 0.05), gunPoly, 0, -0.3, 0.1, this.legL); // leg blade
      sheath.rotation.x = -0.3;
    }

    // ---------- hips / belt ----------
    mk(box(0.3, 0.2, 0.2), suitMat, 0, 0.98, 0);
    mk(box(0.33, 0.06, 0.23), strapMat, 0, 0.98, 0);
    mk(box(0.06, 0.05, 0.02), gunMat, 0, 0.98, 0.13);                  // buckle

    // ---------- torso: capsule + plate carrier + pouches + pack ----------
    mk(cap(0.16, 0.32), suitMat, 0, 1.22, 0);
    mk(box(0.37, 0.42, 0.27), vestMat, 0, 1.22, 0);                    // carrier
    mk(box(0.3, 0.24, 0.035), helmetMat, 0, 1.3, 0.15);                // hard chest plate
    if (cls === 'heavy') {                                             // extra armor layers
      mk(box(0.42, 0.3, 0.06), vestMat, 0, 1.28, 0.17);
      mk(box(0.34, 0.3, 0.05), vestMat, 0, 1.24, -0.19);
    }
    mk(box(0.09, 0.12, 0.05), vestMat, -0.09, 1.08, 0.15);             // mag pouches
    mk(box(0.09, 0.12, 0.05), vestMat, 0.02, 1.08, 0.15);
    if (cls !== 'rusher' && cls !== 'stalker') mk(box(0.26, 0.34, 0.13), vestMat, 0, 1.26, -0.2);   // backpack
    if (cls === 'bombardier') {
      mk(box(0.18, 0.22, 0.55), gunPoly, 0, 1.42, -0.3);                       // back-mounted launcher
      mk(box(0.1, 0.14, 0.08), vestMat, -0.16, 1.02, 0.12);                    // extra ammo box
    }
    if (cls === 'flamer') {                                                    // fuel tanks on the back
      for (const tx of [-0.1, 0.1]) {
        const tank = mk(cyl(0.062, 0.062, 0.42, 10),
          new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.4, metalness: 0.6 }),
          tx, 1.36, -0.27);
        tank.material.emissive = new THREE.Color(0x2a0c00);
        tank.material.emissiveIntensity = 0.6;
        mk(cyl(0.03, 0.03, 0.07, 8), gunMat, tx, 1.6, -0.27);                  // valve
      }
      const hose = mk(cyl(0.016, 0.016, 0.5, 6), gunPoly, 0.13, 1.28, -0.12);      // hose to the gun
      hose.rotation.set(1.2, 0, -0.45);
    }
    if (cls === 'phantom') {                                                      // shimmering optic cloak
      const cloak = mk(box(0.44, 0.8, 0.03),
        new THREE.MeshStandardMaterial({
          color: 0x161a2c, emissive: 0x224466, emissiveIntensity: 0.7,
          transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 0.4,
        }), 0, 1.18, -0.26);
      cloak.rotation.x = 0.06;
      this.cloakMat = cloak.material;
    }
    if (cls === 'juggernaut') {                                                   // walking tank plating
      mk(box(0.48, 0.5, 0.34), vestMat, 0, 1.24, 0);                             // oversized carrier
      mk(box(0.5, 0.36, 0.08), vestMat, 0, 1.3, 0.2);                            // breastplate
      mk(sph(0.14, 8, 6), vestMat, -0.25, 1.42, 0);                              // slab pauldrons
      mk(sph(0.14, 8, 6), vestMat, 0.25, 1.42, 0);
      mk(box(0.3, 0.42, 0.14), vestMat, 0, 1.34, -0.28);                        // back slab
    }
    mk(box(0.045, 0.3, 0.03), strapMat, -0.1, 1.34, 0.14);             // shoulder straps
    mk(box(0.045, 0.3, 0.03), strapMat, 0.1, 1.34, 0.14);
    if (elite || cls === 'rusher' || cls === 'stalker') mk(box(0.13, 0.035, 0.13), visorMat, -0.2, 1.4, 0.1);  // arm/shoulder band

    // ---------- arms: shoulder + elbow joints so the hands grip the gun ----------
    const padGeo = sph(cls === 'heavy' ? 0.115 : (cls === 'breacher' ? 0.1 : 0.085), 8, 6);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0.25 * s, 1.4, 0);
      body.add(arm);
      mk(cap(0.058, 0.13), suitMat, 0, -0.13, 0, arm);                 // upper arm
      mk(padGeo, vestMat, 0, 0, 0, arm);                               // shoulder pad
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.24, 0);
      arm.add(elbow);
      mk(cap(0.05, 0.12), suitMat, 0, -0.12, 0, elbow);                // forearm
      mk(sph(0.055, 6, 5), gloveMat, 0, -0.25, 0, elbow);              // glove / hand
      arm.elbow = elbow;
      if (s < 0) this.armL = arm; else this.armR = arm;
    }

    // ---------- carbine: held in both hands (low-ready ↔ shouldered) ----------
    // The pose is driven in update() by aimAmt — the rifle glides between
    // a chest-level low-ready carry and a level firing position while the
    // articulated arms follow it, so both gloves stay on the weapon.
    this.rifle = new THREE.Group();
    this.rifle.position.set(0.17, 1.05, 0.13);
    this.rifle.rotation.x = 0.55;
    body.add(this.rifle);
    const long = cls === 'marksman';
    mk(box(0.05, 0.08, 0.34), gunMat, 0, 0, 0.1, this.rifle);                       // receiver
    const barrel = mk(cyl(0.015, 0.015, long ? 0.4 : 0.26, 8), gunMat, 0, 0.01, long ? 0.47 : 0.4, this.rifle);
    barrel.rotation.x = Math.PI / 2;
    const brake = mk(cyl(0.021, 0.021, 0.055, 8), gunMat, 0, 0.01, long ? 0.7 : 0.545, this.rifle);
    brake.rotation.x = Math.PI / 2;
    const mag = mk(box(0.035, 0.15, 0.07), gunPoly, 0, -0.11, 0.06, this.rifle);
    mag.rotation.x = -0.25;
    mk(box(0.04, 0.07, 0.19), gunPoly, 0, 0.01, -0.17, this.rifle);                 // stock
    const grip = mk(box(0.03, 0.09, 0.04), gunPoly, 0, -0.1, -0.02, this.rifle);
    grip.rotation.x = 0.4;
    const scope = mk(cyl(0.021, 0.021, long ? 0.2 : 0.11, 8), gunMat, 0, 0.075, 0.08, this.rifle);
    scope.rotation.x = Math.PI / 2;
    if (long) mk(sph(0.026, 8, 6), visorMat, 0, 0.075, 0.185, this.rifle);          // scope objective glow
    mk(box(0.024, 0.075, 0.03), gunPoly, 0, -0.075, 0.3, this.rifle);               // vertical foregrip
    if (cls === 'breacher') {
      mk(box(0.07, 0.07, 0.2), gunPoly, 0, -0.05, 0.32, this.rifle);                // shotgun pump
      mk(box(0.08, 0.1, 0.36), gunMat, 0, 0, 0.1, this.rifle);                      // fat receiver
    }
    if (cls === 'bombardier') {
      mk(cyl(0.04, 0.045, 0.5, 10), gunMat, 0, 0.04, 0.55, this.rifle);             // wide-bore barrel
    }
    if (cls === 'flamer') {                                                        // incinerator flamethrower
      const noz = mk(cyl(0.028, 0.05, 0.44, 10), gunMat, 0, 0.02, 0.55, this.rifle);
      noz.rotation.x = Math.PI / 2;
      const pilot = mk(cyl(0.03, 0.012, 0.06, 8),
        new THREE.MeshStandardMaterial({ color: 0x140a04, emissive: 0xff7711, emissiveIntensity: 3.2 }),
        0, 0.02, 0.8, this.rifle);
      pilot.rotation.x = Math.PI / 2;
      this.pilotMat = pilot.material;
    }
    if (cls === 'juggernaut') {                                                    // miniguan drum + shroud
      const drum = mk(cyl(0.1, 0.1, 0.09, 12), gunPoly, 0, -0.09, 0.02, this.rifle);
      drum.rotation.z = Math.PI / 2;
      mk(box(0.07, 0.07, 0.42), gunMat, 0, 0.035, 0.42, this.rifle);
    }
    this.rifleTip = new THREE.Object3D();
    this.rifleTip.position.set(0, 0.01, cls === 'bombardier' ? 0.82 : (long ? 0.73 : 0.575));
    this.rifle.add(this.rifleTip);

    // ---------- radio on left shoulder (stalker carries none — stays quiet) ----------
    if (cls !== 'rusher' && cls !== 'stalker') {
      mk(box(0.04, 0.09, 0.03), gunMat, -0.22, 1.35, -0.04);
      const ant = mk(cyl(0.006, 0.006, 0.13, 5), gunMat, -0.22, 1.46, -0.04);
      ant.rotation.z = 0.15;
    }

    // ---------- head: balaclava + helmet + NVG mount + visor ----------
    mk(sph(0.095, 10, 8), faceMat, 0, 1.63, 0);
    mk(cyl(0.055, 0.065, 0.09, 8), faceMat, 0, 1.545, 0);                            // neck
    const helm = mk(sph(0.115, 10, 8), helmetMat, 0, 1.68, 0);
    helm.scale.set(1, 0.78, 1.04);
    mk(box(0.05, 0.045, 0.05), gunMat, 0, 1.76, 0.085);                              // NVG mount
    mk(box(0.17, 0.045, 0.03), visorMat, 0, 1.655, 0.1);                             // glowing visor
    if (elite) mk(box(0.02, 0.02, 0.015), visorMat, 0.115, 1.68, 0.02);              // helmet IR strobe
    if (cls === 'rusher') mk(box(0.21, 0.035, 0.21), visorMat, 0, 1.615, 0);         // headband
    if (cls === 'heavy') mk(sph(0.13, 10, 8), helmetMat, 0, 1.675, 0).scale.set(1.05, 0.8, 1.08); // heavy shell

    this._addHitboxes();
    this._addFlash();
    if (this.bodyScale !== 1) this.body.scale.setScalar(this.bodyScale);
  }

  _addHitboxes() {
    const hm = new THREE.MeshBasicMaterial({ visible: false });
    this.headBox = new THREE.Mesh(box(0.3, 0.34, 0.3), hm);
    this.headBox.position.set(0, 1.64, 0);
    this.headBox.userData.enemy = this;
    this.headBox.userData.part = 'head';
    this.body.add(this.headBox);

    this.bodyBox = new THREE.Mesh(box(0.52, 1.5, 0.44), hm);
    this.bodyBox.position.set(0, 0.78, 0);
    this.bodyBox.userData.enemy = this;
    this.bodyBox.userData.part = 'body';
    this.body.add(this.bodyBox);

    this.hitMeshes.push(this.headBox, this.bodyBox);
  }

  _addFlash() {
    this.muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.muzzleFlash, color: new THREE.Color(2.6, 1.9, 0.95),
      blending: THREE.AdditiveBlending, transparent: true, depthTest: true,
    }));
    this.muzzleFlash.scale.setScalar(0.5);
    this.muzzleFlash.visible = false;
    if (this.rifleTip) this.rifleTip.add(this.muzzleFlash);
    else this.body.add(this.muzzleFlash);
    this.flashT = 0;
  }

  attachAudio(audioManager) {
    if (this.pa) return;                     // already wired (respawn-safe)
    this.pa = audioManager.attachPositional('enemyShot', this.group, {
      volume: 0.9, refDistance: 5, maxDistance: 60, loop: false,
    });
  }

  get eye() { _v1.set(this.group.position.x, 1.6, this.group.position.z); return _v1; }

  hear(noisePos) {
    if (this.state === ESTATE.DEAD) return;
    const d = this.group.position.distanceTo(noisePos);
    if (d < PLAYER.hearingRadius) {
      this.lastKnown.copy(noisePos);
      if (this.state === ESTATE.IDLE || this.state === ESTATE.PATROL) this.state = ESTATE.CHASE;
    }
  }

  applyDamage(dmg, part, dirX, dirZ, ctx) {
    if (this.state === ESTATE.DEAD) return false;
    const mult = part === 'head' ? ENEMY.headshotMultiplier : 1;
    this.hp -= dmg * mult;
    this.flash = 1;
    this.recoil = Math.max(this.recoil, part === 'head' ? 0.9 : 0.55); // flinch lifts the gun
    this.knock.x += dirX * (part === 'head' ? 2.4 : 1.4);
    this.knock.z += dirZ * (part === 'head' ? 2.4 : 1.4);
    ctx.particles.impact('flesh', ctx.hitPoint.x, ctx.hitPoint.y, ctx.hitPoint.z, dirX, 0.6, dirZ);

    if (this.hp <= 0) {
      this.state = ESTATE.DEAD;
      this.deadT = 0;
      this.group.userData.deadAt = performance.now();
      this.anchorIdx = -1;
      ctx.audio.play('enemyDeath', { volume: 0.9 });
      ctx.onKilled(this, part === 'head');
      return true;
    }
    this.audio_grunt(ctx);
    if (this.state === ESTATE.HIT) {
      this.stateT = Math.max(this.stateT, 0.22);  // re-stun, but keep the real prevState
    } else if (this.state !== ESTATE.ATTACK) {
      this.prevState = this.state === ESTATE.CHASE ? ESTATE.CHASE : this.state;
      this.state = ESTATE.HIT;
      this.stateT = 0.22;
    }
    return false;
  }

  audio_grunt(ctx) {
    ctx.audio.play('enemyGrunt', { volume: 0.6 });
  }

  _setFacing(angle, dt = 0.016) {
    this.group.rotation.y = damp(this.group.rotation.y, angle, 8, dt);
  }

  update(dt, ctx) {
    const gp = this.group.position;
    const playerPos = ctx.playerPos;
    const toPlayer = _v2.subVectors(playerPos, gp);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);

    // knockback integrates THROUGH collision — raw integration used to
    // shove enemies inside/through houses, which is how they appeared to
    // "walk through walls" and how one got stuck inside M8 geometry
    if (this.knock.lengthSq() > 0.0001) {
      moveAndSlideSimple(gp, this.knock.x * dt, this.knock.z * dt, 0.34, 1.7, ctx.world);
    }
    this.knock.multiplyScalar(Math.exp(-dt * 6));

    // hit flash decay
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.suitMat) this.suitMat.emissive.setScalar(this.flash * 0.9);
    if (this.visorMat) this.visorMat.emissiveIntensity = (this.elite ? 2.3 : 1.6) + this.flash * 5;

    // muzzle flash sprite
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.muzzleFlash.visible = false;
    }

    if (this.state === ESTATE.DEAD) {
      this.deadT += dt;
      this.body.rotation.x = damp(this.body.rotation.x, -Math.PI / 2 - 0.15, 4, dt);
      this.body.position.y = damp(this.body.position.y, 0, 3, dt);
      if (this.mixer) this.mixer.stopAllAction();
      return;
    }

    // periodic LoS check (staggered)
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = ENEMY.losCheckInterval;
      this.losOK = this._hasLineOfSight(ctx, playerPos);
    }

    // vision detection
    if (this.state === ESTATE.IDLE || this.state === ESTATE.PATROL) {
      const yaw = this.group.rotation.y;
      const ang = Math.atan2(toPlayer.x, toPlayer.z);
      let diff = Math.abs(ang - yaw);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      const inCone = diff < (ENEMY.viewAngleDeg * Math.PI / 180) / 2;
      if (dist < this.viewDistance && (this.losOK || dist < 7) && (inCone || dist < 10)) {
        this.lastKnown.copy(playerPos);
        this.state = ESTATE.CHASE;
        if (!this.quiet) ctx.audio.play('enemyGrunt', { volume: 0.45 });
      }
    }

    switch (this.state) {
      case ESTATE.IDLE:
        this.moveAmt = damp(this.moveAmt, 0, 10, dt);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.wpIndex = (this.wpIndex + 1) % this.waypoints.length; this.state = ESTATE.PATROL; }
        break;

      case ESTATE.PATROL: {
        const wp = this.waypoints[this.wpIndex];
        _v3.set(wp[0], 0, wp[1]);
        const d = _v3.sub(gp);
        const len = Math.hypot(d.x, d.z);
        if (len < 0.8) {
          this.state = ESTATE.IDLE;
          this.stateT = rand(1.5, 4);
        } else {
          const sp = ENEMY.patrolSpeed * this.patrolScale;
          const step = moveAndSlideSimple(gp, (d.x / len) * sp * dt, (d.z / len) * sp * dt, 0.34, 1.7, ctx.world);
          void step;
          this.group.position.copy(gp);
          this._setFacing(Math.atan2(d.x, d.z), dt);
          this.moveAmt = damp(this.moveAmt, 1, 6, dt);
        }
        break;
      }

      case ESTATE.CHASE: {
        this.lastKnown.lerp(_v2.set(playerPos.x, 0, playerPos.z), 0.5);
        _v3.subVectors(this.lastKnown, gp);
        const len = Math.hypot(_v3.x, _v3.z) || 1;
        const sp = ENEMY.chaseSpeed * this.speedScale;
        moveAndSlideSimple(gp, (_v3.x / len) * sp * dt, (_v3.z / len) * sp * dt, 0.34, 1.7, ctx.world);
        this._setFacing(Math.atan2(_v3.x, _v3.z), dt);
        this.moveAmt = damp(this.moveAmt, 1, 6, dt);
        if (dist < this.attackRange && this.losOK) {
          this.state = ESTATE.ATTACK;
          this.windup = 0.35;
          this.fireCd = 0.35;
        } else if (dist > this.loseRange) {
          this.state = ESTATE.PATROL;
        }
        break;
      }

      case ESTATE.ATTACK: {
        this.moveAmt = damp(this.moveAmt, this.strafeT > 0 ? 0.7 : 0.15, 8, dt);
        this._setFacing(Math.atan2(toPlayer.x, toPlayer.z), dt);

        // keep-distance classes (marksman / bombardier) kite away when crowded
        if (this.keepDist && dist < this.keepDist) {
          const inv = 1 / (dist || 1);
          moveAndSlideSimple(gp, -toPlayer.x * inv * ENEMY.chaseSpeed * 0.85 * dt,
            -toPlayer.z * inv * ENEMY.chaseSpeed * 0.85 * dt, 0.34, 1.7, ctx.world);
          this.moveAmt = damp(this.moveAmt, 1, 8, dt);
        }

        // occasional strafe
        if (this.strafeT > 0) {
          this.strafeT -= dt;
          const side = Math.cos(this.group.rotation.y) * this.strafeDir;
          const sideZ = -Math.sin(this.group.rotation.y) * this.strafeDir;
          moveAndSlideSimple(gp, side * 1.6 * dt, sideZ * 1.6 * dt, 0.34, 1.7, ctx.world);
        }

        this.fireCd -= dt;
        if (this.fireCd <= 0) {
          this._fire(ctx, playerPos, dist);
          this.fireCd = rand(this.fireGap[0], this.fireGap[1]) / this.fireRateScale * (ctx.gapScale ?? 1);
          if (chance(this.cls === 'rusher' ? 0.55 : 0.35)) { this.strafeT = rand(0.3, 0.7); this.strafeDir = chance(0.5) ? 1 : -1; }
        }
        if (dist > this.attackRange + 3 || !this.losOK) {
          this.state = ESTATE.CHASE;   // _poseWeapon blends the gun back down
        }
        break;
      }

      case ESTATE.HIT:
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = this.prevState === ESTATE.PATROL ? ESTATE.CHASE : this.prevState;
        break;
    }

    // ---- weapon handling: aim blend + recoil, then hands follow the gun ----
    this.aimAmt = damp(this.aimAmt, this.state === ESTATE.ATTACK ? 1 : 0, this.aimSpeed, dt);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this._poseWeapon(dt);

    // phantom class: optic cloak pulses between solid and near-transparent
    if (this.ghost && this.suitMat) {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostOn = !this.ghostOn;
        this.ghostT = this.ghostOn ? rand(1.8, 3.0) : rand(1.0, 1.8);
      }
      const op = damp(this.suitMat.opacity, this.ghostOn ? 0.92 : 0.3, 2.2, dt);
      this.suitMat.opacity = op;
      if (this.cloakMat) this.cloakMat.opacity = 0.15 + op * 0.3;
    }
    // incinerator pilot flame always flickers at the nozzle
    if (this.pilotMat) this.pilotMat.emissiveIntensity = 2.6 + Math.sin(this.walkPhase * 9.3) * 1.3;

    // walk animation — articulated: thighs swing from the hips, knees
    // bend on the trailing leg, arms counter-swing ONLY while the gun is
    // in low-ready (a shouldered weapon stays steady on the target)
    this.walkPhase += dt * (4 + this.moveAmt * 6);
    if (!this.gltfAnim) {
      const swing = Math.sin(this.walkPhase) * 0.6 * this.moveAmt;
      if (this.legL.knee) {
        this.legL.rotation.x = swing;
        this.legR.rotation.x = -swing;
        this.legL.knee.rotation.x = 0.18 + Math.max(0, -swing) * 1.35;
        this.legR.knee.rotation.x = 0.18 + Math.max(0, swing) * 1.35;
      }
      const carry = (1 - this.aimAmt) * this.moveAmt;
      this.armR.rotation.x += Math.sin(this.walkPhase + Math.PI) * 0.14 * carry;
      this.armL.rotation.x += Math.sin(this.walkPhase) * 0.14 * carry;
      if (this.rifle) {
        this.rifle.position.y += Math.abs(Math.sin(this.walkPhase)) * 0.02 * carry;
        this.rifle.rotation.z += Math.sin(this.walkPhase) * 0.05 * carry;
        if (this.aimAmt > 0.5) this.rifle.rotation.x += Math.sin(this.walkPhase * 0.8) * 0.012 * this.aimAmt;
      }
      this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.035 * this.moveAmt;
      // idle breathing sway keeps a standing hostile alive
      const rest = Math.max(0, 1 - this.moveAmt * 4);
      this.body.rotation.z = Math.sin(this.walkPhase * 0.45) * 0.014 * rest;
    } else if (this.mixer) {
      this.mixer.update(dt);
    }
  }

  /**
   * Two-handed carry pose. aimAmt 0→1 glides the carbine from a chest
   * low-ready (muzzle down, canted right) to a level shouldered aim;
   * the elbow-jointed arms track it so both gloves stay on the weapon.
   * `recoil` punches the gun back+up and kicks the right elbow.
   */
  _poseWeapon(dt) {
    if (!this.rifle || this.state === ESTATE.DEAD) return;
    const a = this.aimAmt, rk = this.recoil;
    this.rifle.position.set(
      0.17 + (0.1 - 0.17) * a,
      1.05 + (1.21 - 1.05) * a + rk * 0.035,
      0.13 + (0.27 - 0.13) * a - rk * 0.07,
    );
    this.rifle.rotation.set(
      0.55 + (-0.07 - 0.55) * a + rk * 0.42,
      0.16 * (1 - a),
      -0.08 * a,
    );
    const ar = this.armR, al = this.armL;
    ar.rotation.x = damp(ar.rotation.x, -0.32 - 0.05 * a - rk * 0.3, 10, dt);
    ar.rotation.z = damp(ar.rotation.z, -0.16 - 0.24 * a, 10, dt);
    ar.elbow.rotation.x = damp(ar.elbow.rotation.x, -0.75 - 0.5 * a + rk * 0.45, 10, dt);
    al.rotation.x = damp(al.rotation.x, -0.24 - 0.02 * a, 10, dt);
    al.rotation.z = damp(al.rotation.z, 0.22 + 0.62 * a, 10, dt);
    al.elbow.rotation.x = damp(al.elbow.rotation.x, -0.85 - 0.25 * a, 10, dt);
  }

  _hasLineOfSight(ctx, playerPos) {
    _eye.set(this.group.position.x, 1.6, this.group.position.z);
    _v3.set(playerPos.x, 1.5, playerPos.z).sub(_eye);
    const dist = _v3.length();
    _v3.normalize();
    ctx.raycaster.set(_eye, _v3);
    ctx.raycaster.far = dist - 0.4;
    const hits = ctx.raycaster.intersectObjects(ctx.envMeshes, false);
    return hits.length === 0;
  }

  _fire(ctx, playerPos, dist) {
    // muzzle flash sprite + pooled light + smoke/sparks + tracer + sound
    const big = this.bigShot ? 1.7 : 1;
    this.recoil = this.bigShot ? 1.5 : (this.shots > 1 ? 0.85 : 0.65);  // gun jump
    this.rifleTip.getWorldPosition(_muzzle);
    this.muzzleFlash.visible = true;
    this.muzzleFlash.material.rotation = rand(0, 6.28);
    this.muzzleFlash.scale.setScalar(rand(0.45, 0.62) * big);
    this.flashT = 0.08 * big;
    ctx.addMuzzleLight(_muzzle);
    const dirv = _v3.set(playerPos.x - _muzzle.x, 1.35 - _muzzle.y, playerPos.z - _muzzle.z).normalize();
    ctx.particles.muzzleSmoke(_muzzle.x, _muzzle.y, _muzzle.z, dirv.x, dirv.y, dirv.z);
    ctx.particles.sparkBurst(_muzzle.x, _muzzle.y, _muzzle.z, dirv.x, dirv.y, dirv.z, this.bigShot ? 7 : 4);
    if (ctx.bubbles) ctx.particles.bubblePuff(_muzzle.x, _muzzle.y, _muzzle.z, 5);
    ctx.audio.playPositional(this.pa, { volume: this.bigShot ? 1.1 : 0.9 });

    const hitChance = clamp(ENEMY.hitChance + this.hitBias - dist * 0.016 - (ctx.playerCrouch ? 0.1 : 0), 0.14, 0.72);
    // breacher fires a shotgun-like pattern; everyone else a single shot
    for (let s = 0; s < this.shots; s++) {
      const aim = ctx.scratchAim.set(playerPos.x, 1.35, playerPos.z);
      const hit = chance(hitChance);
      if (!hit) aim.add(_v1.set(rand(-0.9, 0.9), rand(0.1, 0.8), rand(-0.9, 0.9)));
      ctx.addTracer(_muzzle, aim);
      if (hit) ctx.onPlayerDamage(rand(this.dmgMin, this.dmgMax));
    }
    if (this.bigShot && ctx.playerShake) ctx.playerShake(0.012);
  }
}

// ------------------------------------------------------------

export class EnemyManager {
  constructor(scene, world, gltfScene = null) {
    this.scene = scene;
    this.world = world;
    this.gltfScene = gltfScene;
    this.enemies = [];
    this.hitMeshes = [];
    this._wavePlan = [];        // counts still queued (reinforcements)
    this._waveGap = WAVES.gap;
    this._waveT = 0;
    this._waveIdx = 0;
    this._waveTotal = 1;
    this._roster = ['rifle'];
    this._elite = false;
    this._area = 'hall';
  }

  /**
   * Arm a mission: clear the field, then deploy hostiles in waves —
   * first batch at RANDOM anchors right away, later batches dropping
   * in `waveGap` seconds apart (enemy.js update drives the queue).
   * `mission` is a config.js MISSIONS entry.
   */
  deploy(mission) {
    this._clearAll();
    this._area = mission.area;
    this._elite = !!mission.elite;
    this._roster = mission.roster ?? ['rifle'];
    this._waveGap = mission.waveGap ?? WAVES.gap;
    const plan = mission.waves?.length ? [...mission.waves] : splitWaves(mission.enemyCount);
    this._wavePlan = plan.slice(1);
    this._waveTotal = plan.length;
    this._waveIdx = 0;
    this._waveT = rand(this._waveGap[0], this._waveGap[1]);
    this._spawnBatch(plan[0]);
  }

  /** Remove every enemy (queued waves included) — used by respawn/deploy. */
  _clearAll() {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies = [];
    this.hitMeshes = [];
    this._wavePlan = [];
  }

  /** Remove every enemy and re-arm the last mission (new random rolls). */
  respawn(mission) {
    this.deploy(mission ?? { enemyCount: 0, area: 'hall' });
  }

  waveInfo() {
    return { current: Math.min(this._waveIdx + 1, this._waveTotal), total: this._waveTotal };
  }

  _spawnBatch(n, ctx = null) {
    const pool = SPAWN_POOLS[this._area] ?? SPAWN_POOLS.hall;
    // anchors currently held by live hostiles → prefer the rest
    const used = new Set(this.enemies.filter((e) => e.state !== ESTATE.DEAD && e.anchorIdx >= 0).map((e) => e.anchorIdx));
    const fresh = shuffle(pool.map((_, i) => i).filter((i) => !used.has(i)));
    const bag = shuffle([...this._roster]);
    for (let i = 0; i < n; i++) {
      const anchorIdx = fresh.length ? fresh.shift() : Math.floor(Math.random() * pool.length);
      const def = pool[anchorIdx];
      const [x, z] = this._freeSpot(def.pos[0] + rand(-1.4, 1.4), def.pos[1] + rand(-1.4, 1.4));
      const wps = def.wps.map(([wx, wz]) => [wx + rand(-1, 1), wz + rand(-1, 1)]);
      const e = new Enemy(this.enemies.length, this.scene, this.gltfScene, wps, {
        elite: this._elite, cls: bag[i % bag.length],
      });
      e.group.position.set(x, 0, z);
      e.group.rotation.y = rand(0, Math.PI * 2);
      e.wpIndex = Math.floor(Math.random() * wps.length);
      e.anchorIdx = anchorIdx;
      this.enemies.push(e);
      this.hitMeshes.push(...e.hitMeshes);
      if (ctx) {
        // small "inbound" poof at each insertion point
        ctx.particles.dustPuff(x, 0.3, z, 5);
        ctx.particles.smokePuff(x, 1.1, z, 2, 0.35);
      }
    }
    this._waveIdx++;
  }

  _freeSpot(x, z) {
    // jittered pick first, then a golden-angle spiral until clear of colliders
    for (let k = 0; k < 26; k++) {
      const a = k * 2.39996;
      const r = k === 0 ? 0 : 0.45 + k * 0.28;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (!this._blocked(px, pz)) return [px, pz];
    }
    return [x, z];
  }

  _blocked(x, z) {
    for (const b of this.world.all()) {
      if (x + 0.45 > b.min.x && x - 0.45 < b.max.x &&
          z + 0.45 > b.min.z && z - 0.45 < b.max.z &&
          b.min.y < 1.7 && b.max.y > 0.05) return true;
    }
    return false;
  }

  attachAudio(audioManager) {
    for (const e of this.enemies) e.attachAudio(audioManager);
  }

  removeHitMeshes(enemy) {
    this.hitMeshes = this.hitMeshes.filter((m) => !m.userData.enemy || m.userData.enemy !== enemy);
    for (const m of enemy.hitMeshes) m.visible = false;
  }

  aliveCount() {
    return this.enemies.filter((e) => e.state !== ESTATE.DEAD).length;
  }

  /** Live hostiles + reinforcements still queued — what "clear the area" means. */
  remaining() {
    return this.aliveCount() + this._wavePlan.reduce((a, n) => a + n, 0);
  }

  update(dt, ctx) {
    for (const e of this.enemies) e.update(dt, ctx);
    this._antiStuck(ctx);

    if (this._wavePlan.length) {
      this._waveT -= dt;
      if (this._waveT <= 0) {
        const n = this._wavePlan.shift();
        this._spawnBatch(n, ctx);
        this.attachAudio(ctx.audio);         // wire gunfire on the new arrivals
        this._waveT = rand(this._waveGap[0], this._waveGap[1]);
        ctx.onWave?.(this.waveInfo());
      }
    }
  }

  hearAll(pos) {
    for (const e of this.enemies) e.hear(pos);
  }

  /**
   * Anti-stuck guard — fixes the soft-lock where a hostile ends up INSIDE
   * geometry: you can neither see nor hit it (a raycast starting inside a
   * box never hits that box), yet it still fires at you, so the wave can
   * never be cleared. Any live enemy whose center lands inside a collider
   * or outside its arena rect (ctx.arena) is relocated to a free spawn
   * anchor with an "inbound" poof.
   */
  _antiStuck(ctx) {
    const arena = ctx?.arena;
    for (const e of this.enemies) {
      if (e.state === ESTATE.DEAD) continue;
      const p = e.group.position;
      let bad = false;
      if (arena && (p.x < arena.x0 - 2 || p.x > arena.x1 + 2 ||
                    p.z < arena.z0 - 2 || p.z > arena.z1 + 2)) {
        bad = true;
      } else {
        for (const b of this.world.all()) {
          // margin 0.2 sits inside the 0.34 slide radius, so enemies
          // leaning on a wall are NOT flagged — only genuine embedding is
          if (p.x > b.min.x - 0.2 && p.x < b.max.x + 0.2 &&
              p.z > b.min.z - 0.2 && p.z < b.max.z + 0.2 &&
              b.min.y < 1.7 && b.max.y > 0.3) { bad = true; break; }
        }
      }
      if (bad) this._respawnStuck(e, ctx);
    }
  }

  _respawnStuck(e, ctx) {
    const pool = SPAWN_POOLS[this._area] ?? SPAWN_POOLS.hall;
    const used = new Set(this.enemies
      .filter((o) => o !== e && o.state !== ESTATE.DEAD && o.anchorIdx >= 0)
      .map((o) => o.anchorIdx));
    const fresh = shuffle(pool.map((_, i) => i).filter((i) => !used.has(i)));
    const anchorIdx = fresh.length ? fresh.shift() : Math.floor(Math.random() * pool.length);
    const def = pool[anchorIdx];
    const [x, z] = this._freeSpot(def.pos[0] + rand(-1.2, 1.2), def.pos[1] + rand(-1.2, 1.2));
    e.group.position.set(x, 0, z);
    e.knock.set(0, 0, 0);
    e.anchorIdx = anchorIdx;
    e.wpIndex = Math.floor(Math.random() * e.waypoints.length);
    if (e.state === ESTATE.CHASE || e.state === ESTATE.ATTACK) e.state = ESTATE.PATROL;
    if (ctx?.particles) {
      ctx.particles.dustPuff(x, 0.3, z, 5);
      ctx.particles.smokePuff(x, 1.1, z, 2, 0.35);
    }
  }
}
