// ============================================================
// enemy.js — hostile soldiers + drones with a tactical FSM:
//
//   IDLE ↔ PATROL ──(sight / hearing / squad call)──▶ CHASE
//   CHASE ─▶ ATTACK (burst fire, strafing, mag + reload window)
//   ATTACK ─▶ COVER (wounded / reloading: sprint to a spot that breaks
//                     line of sight, crouch, reload, then peek again)
//   CHASE ─▶ SEARCH (lost you: sweep the last known position, then
//                     give up and patrol) — no more wall-hack tracking
//   any ─▶ HIT stagger ─▶ DEAD (directional fall, corpse sinks away)
//
// Squad behaviour: a hostile that spots you radios your position to
// everyone within ENEMY.alertRadius (they react after a short delay);
// flankers (rusher / stalker / phantom / drone) circle to your side;
// grenadiers lob frags when you camp or hide; medics patch up wounded
// squadmates; shield bearers soak frontal fire; the commander boss
// calls reinforcements as it loses health.
//
// Models are baked per skeletal segment (enemyModel.js → meshKit) and
// cached per class, so a soldier is ~12 draw calls instead of ~45 and
// a new wave never re-uploads geometry. Hitboxes are per body part
// (head ×2, torso ×1, limbs ×ENEMY.limbMultiplier) and ride the rig.
// ============================================================

import * as THREE from 'three';
import { ENEMY, PLAYER, WAVES } from './config.js';
import { cachedBox } from './build.js';
import { moveAndSlide, blockedAt } from './collision.js';
import { TEX } from './textures.js';
import { enemyModel } from './enemyModel.js';
import { RMMaterial, GlowMaterial, bakedMesh } from './meshKit.js';
import { clamp, damp, rand, chance } from './utils.js';

export const ESTATE = {
  IDLE: 'IDLE', PATROL: 'PATROL', CHASE: 'CHASE', ATTACK: 'ATTACK',
  COVER: 'COVER', SEARCH: 'SEARCH', HIT: 'HIT', DEAD: 'DEAD',
};
const COMBAT = new Set([ESTATE.CHASE, ESTATE.ATTACK, ESTATE.COVER, ESTATE.HIT]);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _mv = new THREE.Vector3();
const _aim = new THREE.Vector3();

let enemyMatSeed = 0;
const _hitMat = new THREE.MeshBasicMaterial({ visible: false });

// ------------------------------------------------------------
// Spawn pools — one per campaign area. `pos` is a home anchor and
// `wps` a safe patrol loop; batches pick anchors by wave pattern
// (see EnemyManager._pickAnchors), jitter everything, and validate
// against the collider world. Station pools live here; themed worlds
// register theirs in newAreas*.js. Optional `y` = elevated layer.
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

const randRange = (r) => rand(r[0], r[1]);
const randInt = (r) => Math.floor(rand(r[0], r[1] + 0.999));

export class Enemy {
  constructor(index, scene, gltfScene, waypoints, opts = {}) {
    this.index = index;
    this.scene = scene;
    this.waypoints = waypoints;
    this.wpIndex = 0;
    this.elite = !!opts.elite;
    this.cls = ENEMY.classes[opts.cls] ? opts.cls : 'rifle';
    const C = ENEMY.classes[this.cls];
    const pick = (k) => C[k] ?? ENEMY[k];

    // ---- class-resolved combat stats (base overridden per class) ----
    const eliteHp = this.elite ? ENEMY.eliteHpMultiplier : 1;
    this.maxHp = ENEMY.hp * (C.hpMul ?? 1) * eliteHp * (opts.hpScale ?? 1);
    this.speedScale = (C.chaseMul ?? 1) * (this.elite ? ENEMY.eliteSpeedScale : 1);
    this.patrolScale = (C.patrolMul ?? 1) * (this.elite ? ENEMY.eliteSpeedScale : 1);
    this.viewDistance = pick('viewDistance');
    this.attackRange = pick('attackRange');
    this.loseRange = pick('loseRange');
    this.fireGap = pick('fireGap');
    this.burst = pick('burst');
    this.magSize = pick('mag');
    this.fireRateScale = this.speedScale;
    this.hitBias = (C.hitBias ?? 0) + (this.elite ? 0.05 : 0);
    this.dmgMin = pick('damageMin');
    this.dmgMax = pick('damageMax');
    // damage values are per TRIGGER PULL; a burst splits them across rounds
    const avgBurst = (this.burst[0] + this.burst[1]) / 2;
    this.roundScale = avgBurst > 1 ? 1.25 / avgBurst : 1;
    this.bodyScale = C.scale ?? 1;
    this.keepDist = C.keepDist ?? 0;
    this.shots = C.shots ?? 1;
    this.quiet = !!C.quiet;
    this.bigShot = !!C.bigShot;
    this.aimSpeed = C.aimSpeed ?? 8;
    this.ghost = !!C.ghost;
    this.flank = !!C.flank;
    this.grenades = !!C.grenades;
    this.medic = !!C.medic;
    this.flying = !!C.flying;
    this.hover = C.hover ?? 0;
    this.boss = !!C.boss;
    this.noCover = !!C.noCover;
    this.hasShield = !!C.shield;
    this.sound = C.sound ?? 'enemyShot';

    this.aimAmt = 0;
    this.recoil = 0;
    this.crouch = 0;
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
    this.gone = false;
    this.losTimer = rand(0, ENEMY.losCheckInterval);
    this.losOK = false;
    this.seen = false;
    this.lastSeen = 99;
    this.fireCd = rand(0.6, 1.4);
    this.burstLeft = 0;
    this.burstT = 0;
    this.ammo = this.magSize;
    this.reloadT = 0;
    this.reactT = 0;
    this.alertT = 0;
    this.strafeDir = 0;
    this.strafeT = 0;
    this.coverCd = rand(2, 5);
    this.coverPt = new THREE.Vector3();
    this.flankPt = new THREE.Vector3();
    this.flankT = 0;
    this.flankSide = chance(0.5) ? 1 : -1;
    this.searchPt = new THREE.Vector3();
    this.grenadeCd = randRange(ENEMY.grenadeGap) * 0.6;
    this.healCd = rand(1, 2.5);
    this.playerStill = 0;
    this.lastKnown = new THREE.Vector3();
    this.fallDir = 1;
    this.pa = null;
    this.anchorIdx = -1;
    this.anchorY = 0;
    this.objTarget = null;      // defend-objective saboteurs walk here

    this.hitMeshes = [];
    this.gltfAnim = null;
    this._build(gltfScene);
  }

  // ======================= model / rig =======================

  _build(gltf) {
    if (gltf) { this._buildGLTF(gltf); return; }
    const seed = enemyMatSeed++ % 3;
    const model = enemyModel(this.cls, this.elite, seed);
    this.mat = RMMaterial();
    if (this.ghost) { this.mat.transparent = true; this.mat.opacity = 0.9; }
    this.glowMat = GlowMaterial(this.elite ? 2.8 : 2.2);
    this._glowBase = this.elite ? 2.8 : 2.2;
    if (model.drone) this._rigDrone(model); else this._rigSoldier(model);
    this._addFlash();
    if (this.bodyScale !== 1) this.body.scale.setScalar(this.bodyScale);
  }

  _seg(baked, parent) {
    const m = bakedMesh(baked.geo, this.mat, parent);
    if (m) m.userData.tag = 'flesh';
    bakedMesh(baked.glowGeo, this.glowMat, parent, { cast: false });
    return m;
  }

  _rigSoldier(M) {
    const body = this.body;
    this._seg(M.body, body);
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.1 * s, 0.92, 0);
      body.add(hip);
      this._seg(M.thigh, hip);
      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0);
      hip.add(knee);
      this._seg(M.shin, knee);
      hip.knee = knee;
      this._hitbox(hip, 0.18, 0.44, 0.19, 0, -0.2, 0, 'limb');
      this._hitbox(knee, 0.16, 0.5, 0.2, 0, -0.26, 0.02, 'limb');
      if (s < 0) this.legL = hip; else this.legR = hip;
    }
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0.25 * s, 1.4, 0);
      body.add(arm);
      this._seg(M.upper, arm);
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.24, 0);
      arm.add(elbow);
      this._seg(M.fore, elbow);
      arm.elbow = elbow;
      this._hitbox(arm, 0.14, 0.3, 0.14, 0, -0.12, 0, 'limb');
      if (s < 0) this.armL = arm; else this.armR = arm;
    }
    this.rifle = new THREE.Group();
    this.rifle.position.set(0.17, 1.05, 0.13);
    body.add(this.rifle);
    this._seg(M.gun, this.rifle);
    this.rifleTip = new THREE.Object3D();
    this.rifleTip.position.set(0, 0.012, M.tipZ);
    this.rifle.add(this.rifleTip);
    if (M.shield) {
      // ballistic shield braced on the left forearm, covering head + torso
      this.shieldMesh = this._seg(M.shield, body);
      this.shieldMesh.position.set(-0.08, 1.12, 0.42);
      this.shieldMesh.userData.enemy = this;
      this.shieldMesh.userData.part = 'shield';
      this.shieldMesh.userData.tag = 'metal';
      this.hitMeshes.push(this.shieldMesh);
    }
    this._hitbox(body, 0.27, 0.31, 0.29, 0, 1.655, 0.01, 'head');
    this._hitbox(body, 0.46, 0.58, 0.36, 0, 1.24, 0, 'body');
    this._hitbox(body, 0.36, 0.24, 0.27, 0, 0.95, 0, 'body');
  }

  _rigDrone(M) {
    this.hoverRoot = new THREE.Group();
    this.hoverRoot.position.y = this.hover;
    this.body.add(this.hoverRoot);
    this._seg(M.body, this.hoverRoot);
    this.rifle = new THREE.Group();
    this.rifle.position.set(0, -0.14, 0.05);
    this.hoverRoot.add(this.rifle);
    this._seg(M.gun, this.rifle);
    this.rifleTip = new THREE.Object3D();
    this.rifleTip.position.set(0, 0, M.tipZ);
    this.rifle.add(this.rifleTip);
    this._hitbox(this.hoverRoot, 0.62, 0.3, 0.72, 0, -0.02, 0, 'body');
    this._hitbox(this.hoverRoot, 0.22, 0.16, 0.2, 0, -0.03, 0.27, 'head');   // sensor eye
  }

  _buildGLTF(gltf) {
    const src = gltf.scene ?? gltf;
    const root = src.clone(true);
    const b = new THREE.Box3().setFromObject(root);
    const size = b.getSize(new THREE.Vector3());
    root.scale.setScalar(1.75 / Math.max(size.y, 0.01));
    b.setFromObject(root);
    const c = b.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -b.min.y, -c.z);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.tag = 'flesh'; } });
    this.body.add(root);
    if (gltf.animations?.length) {
      this.mixer = new THREE.AnimationMixer(root);
      const clip = THREE.AnimationClip.findByName(gltf.animations, 'Idle') ?? gltf.animations[0];
      if (clip) this.gltfAnim = this.mixer.clipAction(clip).play();
    }
    this.rifleTip = new THREE.Object3D();
    this.rifleTip.position.set(0.16, 1.35, 0.35);
    this.body.add(this.rifleTip);
    this._hitbox(this.body, 0.3, 0.34, 0.3, 0, 1.64, 0, 'head');
    this._hitbox(this.body, 0.52, 1.5, 0.44, 0, 0.78, 0, 'body');
    this._addFlash();
  }

  _hitbox(parent, w, h, d, x, y, z, part) {
    const m = new THREE.Mesh(cachedBox(w, h, d), _hitMat);
    m.position.set(x, y, z);
    m.userData.enemy = this;
    m.userData.part = part;
    parent.add(m);
    this.hitMeshes.push(m);
    if (part === 'head') this.headBox = m;
    return m;
  }

  _addFlash() {
    this.muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.muzzleFlash, color: new THREE.Color(2.6, 1.9, 0.95),
      blending: THREE.AdditiveBlending, transparent: true, depthTest: true,
    }));
    this.muzzleFlash.scale.setScalar(0.5);
    this.muzzleFlash.visible = false;
    (this.rifleTip ?? this.body).add(this.muzzleFlash);
    this.flashT = 0;
  }

  attachAudio(audioManager) {
    if (this.pa) return;
    const name = audioManager.buffers.has(this.sound) ? this.sound : 'enemyShot';
    this.pa = audioManager.attachPositional(name, this.group, {
      volume: 0.9, refDistance: 5, maxDistance: 70, loop: false,
    });
  }

  get eye() { _v1.set(this.group.position.x, this.group.position.y + 1.6, this.group.position.z); return _v1; }
  get alive() { return this.state !== ESTATE.DEAD; }
  get inCombat() { return COMBAT.has(this.state); }
  /** World-space chest height (drones fly). */
  get chestY() { return this.group.position.y + (this.flying ? this.hover : 1.2 * this.bodyScale); }

  // ======================= perception =======================

  hear(noisePos) {
    if (!this.alive) return;
    const gp = this.group.position;
    const d = Math.hypot(gp.x - noisePos.x, gp.z - noisePos.z);
    if (d < PLAYER.hearingRadius) {
      this.lastKnown.copy(noisePos);
      if (!this.inCombat) this.alertTo(noisePos, rand(0.15, 0.5));
    }
  }

  /** Squad call or noise: react to `pos` after `delay` seconds. */
  alertTo(pos, delay) {
    if (!this.alive || this.inCombat) return;
    this.lastKnown.copy(pos);
    if (this.alertT <= 0 || this.alertT > delay) this.alertT = delay;
  }

  _engage(ctx, spotted) {
    const was = this.inCombat;
    this.state = ESTATE.CHASE;
    this.reactT = randRange(ENEMY.reaction) * (this.elite ? 0.7 : 1);
    if (!was && spotted) {
      if (!this.quiet) ctx.audio.play('enemyGrunt', { volume: 0.45, rate: rand(0.9, 1.1) });
      ctx.alert?.(this, this.lastKnown);
    }
  }

  // ======================= damage =======================

  applyDamage(dmg, part, dirX, dirZ, ctx) {
    if (!this.alive) return false;
    if (part === 'shield') {
      // the ballistic shield eats the round — sparks + ping, no damage
      ctx.particles?.sparkBurst(ctx.hitPoint.x, ctx.hitPoint.y, ctx.hitPoint.z, dirX, 0.4, dirZ, 9);
      ctx.audio?.play('shieldHit', { volume: 0.7, rate: rand(0.9, 1.1) });
      this.recoil = Math.max(this.recoil, 0.25);
      return false;
    }
    const mult = part === 'head' ? (ctx.headMult ?? ENEMY.headshotMultiplier)
      : (part === 'limb' ? ENEMY.limbMultiplier : 1);
    this.hp -= dmg * mult;
    this.flash = 1;
    this.recoil = Math.max(this.recoil, part === 'head' ? 0.9 : 0.55);
    const kb = this.boss || this.cls === 'juggernaut' ? 0.35 : 1;
    this.knock.x += dirX * (part === 'head' ? 2.4 : 1.4) * kb;
    this.knock.z += dirZ * (part === 'head' ? 2.4 : 1.4) * kb;
    if (ctx.hitPoint) {
      ctx.particles?.impact(this.flying ? 'metal' : 'flesh', ctx.hitPoint.x, ctx.hitPoint.y, ctx.hitPoint.z, dirX, 0.6, dirZ);
    }
    // getting shot reveals where it came from
    if (ctx.playerPos) this.lastKnown.copy(ctx.playerPos);
    if (!this.inCombat && ctx.audio) this._engage(ctx, true);

    if (this.hp <= 0) {
      this.state = ESTATE.DEAD;
      this.deadT = 0;
      this.anchorIdx = -1;
      // fall away from the shot: back if hit from the front, else forward
      const fx = Math.sin(this.group.rotation.y), fz = Math.cos(this.group.rotation.y);
      this.fallDir = (fx * dirX + fz * dirZ) < 0 ? 1 : -1;
      this.fallSide = rand(-0.35, 0.35);
      this.muzzleFlash.visible = false;
      ctx.audio?.play(this.flying ? 'droneDie' : 'enemyDeath', { volume: 0.9, rate: rand(0.92, 1.08) });
      ctx.onKilled?.(this, part === 'head');
      return true;
    }
    if (ctx.audio) ctx.audio.play('enemyGrunt', { volume: 0.55, rate: rand(0.85, 1.15) });
    if (this.state === ESTATE.HIT) {
      this.stateT = Math.max(this.stateT, 0.2);
    } else if (this.state !== ESTATE.ATTACK && this.state !== ESTATE.COVER && !this.boss) {
      this.prevState = ESTATE.CHASE;
      this.state = ESTATE.HIT;
      this.stateT = 0.2;
    }
    return false;
  }

  heal(n) {
    if (!this.alive) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    return this.hp - before;
  }

  // ======================= movement =======================

  _move(dx, dz, ctx) {
    const gp = this.group.position;
    if (this.flying) {
      // hovering: only tall geometry (walls, columns) blocks a drone
      _mv.set(gp.x, this.anchorY + 1.75, gp.z);
      moveAndSlide(_mv, dx, dz, 0.42, 1.3, ctx.world);
    } else {
      _mv.set(gp.x, this.anchorY, gp.z);
      moveAndSlide(_mv, dx, dz, 0.34, 1.7, ctx.world);
    }
    gp.x = _mv.x;
    gp.z = _mv.z;
  }

  _moveToward(tx, tz, speed, dt, ctx, face = true) {
    const gp = this.group.position;
    const dx = tx - gp.x, dz = tz - gp.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return 0;
    const step = Math.min(len, speed * dt);
    this._move((dx / len) * step, (dz / len) * step, ctx);
    if (face) this._setFacing(Math.atan2(dx, dz), dt);
    return len;
  }

  _setFacing(angle, dt = 0.016, rate = 8) {
    let d = angle - this.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));          // shortest way round
    this.group.rotation.y += d * (1 - Math.exp(-rate * dt));
  }

  // ======================= main update =======================

  update(dt, ctx) {
    const gp = this.group.position;
    const playerPos = ctx.playerPos;
    const toX = playerPos.x - gp.x, toZ = playerPos.z - gp.z;
    const dist = Math.hypot(toX, toZ);

    if (this.knock.lengthSq() > 0.0001) this._move(this.knock.x * dt, this.knock.z * dt, ctx);
    this.knock.multiplyScalar(Math.exp(-dt * 6));

    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.mat) this.mat.emissive.setScalar(this.flash * 0.9);
    if (this.glowMat) {
      const strobe = this.elite && Math.sin(this.walkPhase * 7) > 0.85 ? 1.6 : 0;
      this.glowMat.color.setScalar(this._glowBase + this.flash * 4 + strobe);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.muzzleFlash.visible = false;
    }

    if (this.state === ESTATE.DEAD) { this._updateDead(dt, ctx); return; }

    // ---------- perception ----------
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = ENEMY.losCheckInterval;
      this.losOK = this._hasLineOfSight(ctx, playerPos);
    }
    const combat = this.inCombat;
    let inCone = true;
    if (!combat) {
      const ang = Math.atan2(toX, toZ);
      let diff = Math.abs(ang - this.group.rotation.y) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      inCone = diff < (ENEMY.viewAngleDeg * Math.PI / 180) / 2;
    }
    const range = combat ? Math.max(this.viewDistance, this.loseRange) : this.viewDistance;
    this.seen = this.losOK && dist < range && (combat || inCone || dist < 8);
    if (this.seen) { this.lastKnown.copy(playerPos); this.lastSeen = 0; } else this.lastSeen += dt;
    // a still player is a grenade magnet
    this.playerStill = (ctx.playerSpeed ?? 0) < 0.4 ? this.playerStill + dt : 0;

    if (this.alertT > 0) {
      this.alertT -= dt;
      if (this.alertT <= 0 && !this.inCombat) this._engage(ctx, false);
    }
    if (!this.inCombat && this.seen) this._engage(ctx, true);
    if (this.reactT > 0) this.reactT -= dt;
    if (this.coverCd > 0) this.coverCd -= dt;
    if (this.grenadeCd > 0) this.grenadeCd -= dt;

    if (this.medic) this._medicTick(dt, ctx);
    if (this.grenades && this.inCombat) this._grenadeTick(ctx, dist);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo = this.magSize;
    }

    switch (this.state) {
      case ESTATE.IDLE: this._stIdle(dt, ctx); break;
      case ESTATE.PATROL: this._stPatrol(dt, ctx); break;
      case ESTATE.CHASE: this._stChase(dt, ctx, dist); break;
      case ESTATE.ATTACK: this._stAttack(dt, ctx, dist, toX, toZ); break;
      case ESTATE.COVER: this._stCover(dt, ctx, dist, toX, toZ); break;
      case ESTATE.SEARCH: this._stSearch(dt, ctx); break;
      case ESTATE.HIT:
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = this.prevState === ESTATE.PATROL ? ESTATE.CHASE : this.prevState;
        break;
    }

    // ---------- pose ----------
    const wantAim = this.state === ESTATE.ATTACK || (this.state === ESTATE.COVER && this.crouch > 0.5);
    this.aimAmt = damp(this.aimAmt, wantAim && this.reloadT <= 0 ? 1 : 0, this.aimSpeed, dt);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    const wantCrouch = this.state === ESTATE.COVER && this._atCover ? 1 : 0;
    this.crouch = damp(this.crouch, wantCrouch, 6, dt);
    if (this.flying) this._animateDrone(dt);
    else this._animateSoldier(dt);

    if (this.ghost && this.mat) {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostOn = !this.ghostOn;
        this.ghostT = this.ghostOn ? rand(1.8, 3.0) : rand(1.0, 1.8);
      }
      this.mat.opacity = damp(this.mat.opacity, this.ghostOn ? 0.92 : 0.22, 2.2, dt);
    }
  }

  // ---------------- states ----------------

  _stIdle(dt, ctx) {
    this.moveAmt = damp(this.moveAmt, 0, 10, dt);
    this.stateT -= dt;
    if (this.stateT <= 0) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      this.state = ESTATE.PATROL;
    }
    if (this.objTarget) this.state = ESTATE.PATROL;
  }

  _stPatrol(dt, ctx) {
    let tx, tz, sp = ENEMY.patrolSpeed * this.patrolScale;
    if (this.objTarget) {
      // defend objective: saboteurs head for the terminal
      tx = this.objTarget.x; tz = this.objTarget.z; sp *= 1.35;
      const gp = this.group.position;
      if (Math.hypot(tx - gp.x, tz - gp.z) < 4.2) {
        this.moveAmt = damp(this.moveAmt, 0, 8, dt);
        this._setFacing(Math.atan2(tx - gp.x, tz - gp.z), dt);
        this.objTarget.sabotage?.(dt, this);
        return;
      }
    } else {
      const wp = this.waypoints[this.wpIndex];
      tx = wp[0]; tz = wp[1];
    }
    const len = this._moveToward(tx, tz, sp, dt, ctx);
    this.moveAmt = damp(this.moveAmt, 1, 6, dt);
    if (len < 0.8 && !this.objTarget) {
      this.state = ESTATE.IDLE;
      this.stateT = rand(1.5, 4);
    }
  }

  _stChase(dt, ctx, dist) {
    const gp = this.group.position;
    let tx = this.lastKnown.x, tz = this.lastKnown.z;
    // flankers swing wide to your side while they close in
    if (this.flank && dist > 7 && this.lastSeen < 4) {
      this.flankT -= dt;
      if (this.flankT <= 0) {
        this.flankT = rand(2, 3.2);
        const nx = (gp.x - this.lastKnown.x) / (dist || 1), nz = (gp.z - this.lastKnown.z) / (dist || 1);
        const side = this.flankSide * Math.min(9, dist * 0.6);
        this.flankPt.set(this.lastKnown.x + nx * dist * 0.55 - nz * side, 0,
          this.lastKnown.z + nz * dist * 0.55 + nx * side);
        if (ctx.arena) {
          const a = ctx.arena;
          this.flankPt.x = clamp(this.flankPt.x, a.x0 + 1, a.x1 - 1);
          this.flankPt.z = clamp(this.flankPt.z, a.z0 + 1, a.z1 - 1);
        }
      }
      tx = this.flankPt.x; tz = this.flankPt.z;
    }
    const sp = ENEMY.chaseSpeed * this.speedScale;
    const len = this._moveToward(tx, tz, sp, dt, ctx, !this.seen);
    if (this.seen) this._setFacing(Math.atan2(ctx.playerPos.x - gp.x, ctx.playerPos.z - gp.z), dt);
    this.moveAmt = damp(this.moveAmt, 1, 6, dt);

    if (this.seen && dist < this.attackRange) {
      this.state = ESTATE.ATTACK;
      this.fireCd = Math.max(this.fireCd, this.reactT, 0.25);
    } else if (!this.seen && (len < 1.4 || this.lastSeen > 9)) {
      this._startSearch();
    }
  }

  _stAttack(dt, ctx, dist, toX, toZ) {
    const gp = this.group.position;
    this.moveAmt = damp(this.moveAmt, this.strafeT > 0 ? 0.7 : 0.15, 8, dt);
    this._setFacing(Math.atan2(toX, toZ), dt, 10);

    if (this.keepDist && dist < this.keepDist) {
      const inv = 1 / (dist || 1);
      const sp = ENEMY.chaseSpeed * 0.85;
      this._move(-toX * inv * sp * dt, -toZ * inv * sp * dt, ctx);
      this.moveAmt = damp(this.moveAmt, 1, 8, dt);
    } else if (dist > this.attackRange * 0.75 && !this.keepDist) {
      // advance slowly while shooting
      const inv = 1 / (dist || 1);
      this._move(toX * inv * 0.9 * dt, toZ * inv * 0.9 * dt, ctx);
    }
    if (this.strafeT > 0) {
      this.strafeT -= dt;
      const sx = Math.cos(this.group.rotation.y) * this.strafeDir;
      const sz = -Math.sin(this.group.rotation.y) * this.strafeDir;
      this._move(sx * 1.7 * dt, sz * 1.7 * dt, ctx);
    }

    this._trigger(dt, ctx, dist);

    // break for cover when hurt or dry
    const hurt = this.hp < this.maxHp * ENEMY.coverHp;
    if (!this.noCover && this.coverCd <= 0 && (hurt || (this.ammo <= 0 && chance(0.5)))) {
      this.coverCd = rand(3, 5);
      if (this._findCover(ctx)) {
        this.state = ESTATE.COVER;
        this._atCover = false;
        this.stateT = rand(1.6, 3.2);
        return;
      }
    }
    if (this.lastSeen > 0.9 || dist > this.attackRange + 3) {
      this.state = ESTATE.CHASE;
      this.flankT = 0;
    }
  }

  _stCover(dt, ctx, dist, toX, toZ) {
    const gp = this.group.position;
    if (!this._atCover) {
      const len = this._moveToward(this.coverPt.x, this.coverPt.z, ENEMY.chaseSpeed * this.speedScale * 1.15, dt, ctx);
      this.moveAmt = damp(this.moveAmt, 1, 8, dt);
      if (len < 0.5 || this.stateT < -4) this._atCover = true;
      this.stateT -= dt * 0.25;
    } else {
      this.moveAmt = damp(this.moveAmt, 0, 8, dt);
      this._setFacing(Math.atan2(toX, toZ), dt, 6);
      if (this.ammo < this.magSize && this.reloadT <= 0) this._reload(ctx);
      this.stateT -= dt;
    }
    if (dist < 4.5 && this.seen) { this.state = ESTATE.ATTACK; return; }   // flushed out
    if (this._atCover && this.stateT <= 0 && this.reloadT <= 0) {
      this.coverCd = rand(7, 12);
      this.state = this.seen ? ESTATE.ATTACK : ESTATE.CHASE;
      this.strafeT = rand(0.3, 0.6);
      this.strafeDir = chance(0.5) ? 1 : -1;
      void gp;
    }
  }

  _startSearch() {
    this.state = ESTATE.SEARCH;
    this.stateT = randRange(ENEMY.searchTime);
    this.searchPt.copy(this.lastKnown);
    this._searchHop = 0;
  }

  _stSearch(dt, ctx) {
    this.stateT -= dt;
    this._searchHop -= dt;
    if (this._searchHop <= 0) {
      this._searchHop = rand(1.4, 2.4);
      const a = rand(0, Math.PI * 2), r = rand(1.5, 5);
      this.searchPt.set(this.lastKnown.x + Math.cos(a) * r, 0, this.lastKnown.z + Math.sin(a) * r);
    }
    const len = this._moveToward(this.searchPt.x, this.searchPt.z, ENEMY.patrolSpeed * 1.3 * this.patrolScale, dt, ctx);
    this.moveAmt = damp(this.moveAmt, len > 0.6 ? 0.8 : 0, 6, dt);
    if (len <= 0.6) this._setFacing(this.group.rotation.y + 1.2, dt, 1.5);
    if (this.stateT <= 0) { this.state = ESTATE.PATROL; this.flankT = 0; }
  }

  // ---------------- weapons ----------------

  _trigger(dt, ctx, dist) {
    if (this.reloadT > 0 || this.reactT > 0) return;
    if (this.ammo <= 0) { this._reload(ctx); return; }
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this._fire(ctx, dist);
        this.burstLeft--;
        this.burstT = this.bigShot ? 0.16 : 0.11;
      }
      return;
    }
    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.burstLeft = randInt(this.burst);
      this.burstT = 0;
      this.fireCd = randRange(this.fireGap) / this.fireRateScale * (ctx.gapScale ?? 1);
      if (chance(this.flank ? 0.55 : 0.35)) { this.strafeT = rand(0.3, 0.8); this.strafeDir = chance(0.5) ? 1 : -1; }
    }
  }

  _reload(ctx) {
    if (this.reloadT > 0) return;
    this.reloadT = randRange(ENEMY.reloadTime);
    this.burstLeft = 0;
    const d = this.group.position.distanceTo(ctx.playerPos);
    if (d < 22) ctx.audio.play('enemyReload', { volume: clamp(1 - d / 22, 0.1, 0.7) });
  }

  _hasLineOfSight(ctx, playerPos) {
    const gp = this.group.position;
    _eye.set(gp.x, this.flying ? gp.y + this.hover : gp.y + 1.6 * this.bodyScale - this.crouch * 0.4, gp.z);
    _v3.set(playerPos.x, playerPos.y + 1.45, playerPos.z).sub(_eye);
    const dist = _v3.length();
    if (dist > 70) return false;
    _v3.multiplyScalar(1 / dist);
    ctx.raycaster.set(_eye, _v3);
    ctx.raycaster.far = dist - 0.4;
    const hits = ctx.raycaster.intersectObjects(ctx.envMeshes, false);
    return hits.length === 0;
  }

  _fire(ctx, dist) {
    if (!this.rifleTip) return;
    this.ammo--;
    const big = this.bigShot ? 1.7 : 1;
    this.recoil = this.bigShot ? 1.5 : (this.shots > 1 ? 0.85 : 0.6);
    this.rifleTip.getWorldPosition(_muzzle);
    this.muzzleFlash.visible = true;
    this.muzzleFlash.material.rotation = rand(0, 6.28);
    this.muzzleFlash.scale.setScalar(rand(0.45, 0.62) * big);
    this.flashT = 0.07 * big;
    ctx.addMuzzleLight(_muzzle);
    const pp = ctx.playerPos;
    const dirv = _v3.set(pp.x - _muzzle.x, pp.y + 1.3 - _muzzle.y, pp.z - _muzzle.z).normalize();
    ctx.particles.muzzleSmoke(_muzzle.x, _muzzle.y, _muzzle.z, dirv.x, dirv.y, dirv.z);
    ctx.particles.sparkBurst(_muzzle.x, _muzzle.y, _muzzle.z, dirv.x, dirv.y, dirv.z, this.bigShot ? 7 : 3);
    if (ctx.bubbles) ctx.particles.bubblePuff(_muzzle.x, _muzzle.y, _muzzle.z, 4);
    ctx.audio.playPositional(this.pa, { volume: this.bigShot ? 1.1 : 0.9, restart: true });

    // bombardier: lobbed explosive round instead of a hitscan shot
    if (this.cls === 'bombardier' && ctx.throwGrenade) {
      _aim.set(pp.x + rand(-1.2, 1.2), pp.y, pp.z + rand(-1.2, 1.2));
      ctx.throwGrenade(_muzzle, _aim, { impact: true, speed: 19, dmg: rand(this.dmgMin, this.dmgMax) * 1.3, radius: 3.6, owner: this });
      return;
    }

    const speed = ctx.playerSpeed ?? 0;
    const hitChance = clamp(
      ENEMY.hitChance + this.hitBias - dist * 0.016
      - (ctx.playerCrouch ? 0.1 : 0) - speed * 0.028 + (speed < 0.3 ? 0.05 : 0),
      0.1, 0.78);
    let anyMiss = false;
    for (let s = 0; s < this.shots; s++) {
      const aim = ctx.scratchAim.set(pp.x, pp.y + 1.3, pp.z);
      const hit = chance(hitChance);
      if (!hit) { aim.add(_v1.set(rand(-0.9, 0.9), rand(0.1, 0.8), rand(-0.9, 0.9))); anyMiss = true; }
      ctx.addTracer(_muzzle, aim);
      if (hit) ctx.onPlayerDamage(rand(this.dmgMin, this.dmgMax) * this.roundScale, this);
    }
    if (anyMiss && dist > 3 && chance(0.45)) ctx.nearMiss?.(this);
    if (this.bigShot && ctx.playerShake) ctx.playerShake(0.012);
  }

  /** Pick a reachable spot within ~8 m whose sightline to the player is
   *  blocked. Rate-limited by coverCd; ≤ 16 raycasts per decision. */
  _findCover(ctx) {
    const gp = this.group.position;
    const pp = ctx.playerPos;
    let best = null, bestScore = Infinity;
    const base = rand(0, Math.PI * 2);
    for (let i = 0; i < 16; i++) {
      const a = base + (i % 8) * (Math.PI / 4);
      const r = i < 8 ? 3.5 : 7;
      const x = gp.x + Math.cos(a) * r, z = gp.z + Math.sin(a) * r;
      if (ctx.arena && (x < ctx.arena.x0 + 1 || x > ctx.arena.x1 - 1 || z < ctx.arena.z0 + 1 || z > ctx.arena.z1 - 1)) continue;
      const pd = Math.hypot(x - pp.x, z - pp.z);
      if (pd < 6) continue;
      if (blockedAt(ctx.world, x, z, 0.4, this.anchorY)) continue;
      _eye.set(x, this.anchorY + 1.0, z);
      _v3.set(pp.x - x, pp.y + 1.45 - _eye.y, pp.z - z);
      const d = _v3.length();
      _v3.multiplyScalar(1 / d);
      ctx.raycaster.set(_eye, _v3);
      ctx.raycaster.far = d - 0.5;
      if (ctx.raycaster.intersectObjects(ctx.envMeshes, false).length === 0) continue;   // exposed
      const score = r + Math.abs(pd - 12) * 0.3;
      if (score < bestScore) { bestScore = score; best = [x, z]; }
    }
    if (!best) return false;
    this.coverPt.set(best[0], 0, best[1]);
    return true;
  }

  _grenadeTick(ctx, dist) {
    if (this.grenadeCd > 0 || !ctx.throwGrenade || this.reloadT > 0) return;
    if (dist < 6 || dist > 24) return;
    // throw at campers, or over the cover the player just ducked behind
    const camping = this.seen && this.playerStill > 2.2;
    const hiding = !this.seen && this.lastSeen > 0.8 && this.lastSeen < 5;
    if (!(camping || hiding)) return;
    this.grenadeCd = randRange(ENEMY.grenadeGap);
    const gp = this.group.position;
    _muzzle.set(gp.x, gp.y + 1.7 * this.bodyScale, gp.z);
    const t = this.seen ? ctx.playerPos : this.lastKnown;
    _aim.set(t.x + rand(-1, 1), t.y ?? 0, t.z + rand(-1, 1));
    ctx.throwGrenade(_muzzle, _aim, { fuse: 2.1, owner: this, dmg: 85, radius: 5.5 });
    this.recoil = 1.1;
    ctx.onGrenadeThrown?.(this);
  }

  _medicTick(dt, ctx) {
    this.healCd -= dt;
    if (this.healCd > 0) return;
    this.healCd = rand(2, 2.8);
    const mates = ctx.allies?.() ?? [];
    for (const e of mates) {
      if (!e.alive || e.hp >= e.maxHp * 0.98) continue;
      const d = e.group.position.distanceTo(this.group.position);
      if (d > 8.5) continue;
      const got = e.heal(e.maxHp * 0.16);
      if (got > 0) {
        const p = e.group.position;
        ctx.particles.sparkBurst(p.x, e.chestY + 0.3, p.z, 0, 1, 0, 6);
        ctx.particles.smokePuff(p.x, e.chestY, p.z, 2, 0.9);
        ctx.onHealed?.(e, got);
      }
    }
  }

  // ---------------- animation ----------------

  _animateSoldier(dt) {
    if (this.gltfAnim || !this.legL) { this.mixer?.update(dt); return; }
    this._poseWeapon(dt);
    this.walkPhase += dt * (4 + this.moveAmt * 6);
    const swing = Math.sin(this.walkPhase) * 0.6 * this.moveAmt;
    const c = this.crouch;
    this.legL.rotation.x = swing - c * 1.05;
    this.legR.rotation.x = -swing - c * 0.55;
    this.legL.knee.rotation.x = 0.18 + Math.max(0, -swing) * 1.35 + c * 1.75;
    this.legR.knee.rotation.x = 0.18 + Math.max(0, swing) * 1.35 + c * 1.45;
    const carry = (1 - this.aimAmt) * this.moveAmt;
    this.armR.rotation.x += Math.sin(this.walkPhase + Math.PI) * 0.14 * carry;
    this.armL.rotation.x += Math.sin(this.walkPhase) * 0.14 * carry;
    if (this.rifle) {
      this.rifle.position.y += Math.abs(Math.sin(this.walkPhase)) * 0.02 * carry;
      this.rifle.rotation.z += Math.sin(this.walkPhase) * 0.05 * carry;
    }
    this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.035 * this.moveAmt - c * 0.36 * this.bodyScale;
    const rest = Math.max(0, 1 - this.moveAmt * 4);
    this.body.rotation.z = Math.sin(this.walkPhase * 0.45) * 0.014 * rest;
    this.body.rotation.x = this.moveAmt * 0.08 + c * 0.12;           // lean into the run
    if (this.shieldMesh) this.shieldMesh.position.y = 1.12 - c * 0.12 + Math.abs(Math.sin(this.walkPhase)) * 0.02;
  }

  _animateDrone(dt) {
    this.walkPhase += dt * 3;
    const h = this.hoverRoot;
    h.position.y = this.hover + Math.sin(this.walkPhase * 1.3) * 0.12;
    h.rotation.x = damp(h.rotation.x, this.moveAmt * 0.22 - this.recoil * 0.1, 5, dt);
    h.rotation.z = Math.sin(this.walkPhase * 0.9) * 0.06;
    this.rifle.rotation.x = damp(this.rifle.rotation.x, this.aimAmt * -0.08, 6, dt);
  }

  /** Two-handed carry: aimAmt 0→1 glides the gun from low-ready to a
   *  shouldered aim while the elbow-jointed arms track it. Shield
   *  bearers hold the pistol one-handed over the shield edge. */
  _poseWeapon(dt) {
    if (!this.rifle || !this.armR) return;
    const a = this.aimAmt, rk = this.recoil;
    if (this.hasShield) {
      this.rifle.position.set(0.2, 1.28 + rk * 0.03, 0.42 - rk * 0.05);
      this.rifle.rotation.set(-0.05 + rk * 0.4 + (1 - a) * 0.5, 0, 0);
      const ar = this.armR, al = this.armL;
      ar.rotation.x = damp(ar.rotation.x, -1.25 * (0.5 + 0.5 * a) - rk * 0.2, 10, dt);
      ar.rotation.z = damp(ar.rotation.z, -0.12, 10, dt);
      ar.elbow.rotation.x = damp(ar.elbow.rotation.x, -0.25, 10, dt);
      al.rotation.x = damp(al.rotation.x, -0.95, 10, dt);
      al.rotation.z = damp(al.rotation.z, 0.32, 10, dt);
      al.elbow.rotation.x = damp(al.elbow.rotation.x, -1.0, 10, dt);
      return;
    }
    this.rifle.position.set(
      0.17 + (0.1 - 0.17) * a,
      1.05 + (1.21 - 1.05) * a + rk * 0.035,
      0.13 + (0.27 - 0.13) * a - rk * 0.07,
    );
    this.rifle.rotation.set(0.55 + (-0.07 - 0.55) * a + rk * 0.42, 0.16 * (1 - a), -0.08 * a);
    const ar = this.armR, al = this.armL;
    ar.rotation.x = damp(ar.rotation.x, -0.32 - 0.05 * a - rk * 0.3, 10, dt);
    ar.rotation.z = damp(ar.rotation.z, -0.16 - 0.24 * a, 10, dt);
    ar.elbow.rotation.x = damp(ar.elbow.rotation.x, -0.75 - 0.5 * a + rk * 0.45, 10, dt);
    al.rotation.x = damp(al.rotation.x, -0.24 - 0.02 * a, 10, dt);
    al.rotation.z = damp(al.rotation.z, 0.22 + 0.62 * a, 10, dt);
    al.elbow.rotation.x = damp(al.elbow.rotation.x, -0.85 - 0.25 * a, 10, dt);
  }

  _updateDead(dt, ctx) {
    this.deadT += dt;
    if (this.flying) {
      // drone: drop out of the air spinning, burst on impact
      const h = this.hoverRoot;
      this._fallV = (this._fallV ?? 0) + 14 * dt;
      h.position.y = Math.max(0.25, h.position.y - this._fallV * dt);
      h.rotation.z += dt * 7;
      h.rotation.x += dt * 2;
      if (h.position.y <= 0.25 && !this._crashed) {
        this._crashed = true;
        const p = this.group.position;
        ctx.particles.sparkBurst(p.x, p.y + 0.4, p.z, 0, 1, 0, 18);
        ctx.particles.smokePuff(p.x, p.y + 0.5, p.z, 6, 0.4);
        ctx.particles.debris(p.x, p.y + 0.4, p.z, [0.2, 0.22, 0.25], 6, 1.4);
        ctx.audio.play('impactMetal', { volume: 0.8, rate: 0.7 });
      }
    } else {
      const fall = clamp(this.deadT / 0.55, 0, 1);
      const e = 1 - (1 - fall) * (1 - fall);
      this.body.rotation.x = (-Math.PI / 2 + 0.12) * e * this.fallDir;
      this.body.rotation.z = (this.fallSide ?? 0) * e;
      this.body.position.y = damp(this.body.position.y, 0.12, 4, dt);
      if (this.legL) {
        this.legL.rotation.x = damp(this.legL.rotation.x, 0.15, 6, dt);
        this.legR.rotation.x = damp(this.legR.rotation.x, -0.2, 6, dt);
        this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, 0.3, 6, dt);
        this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, 0.6, 6, dt);
        this.armL.rotation.z = damp(this.armL.rotation.z, 1.1, 5, dt);
        this.armR.rotation.z = damp(this.armR.rotation.z, -1.0, 5, dt);
      }
      if (this.rifle && this.deadT < 0.6) this.rifle.rotation.z += dt * 3;
    }
    // corpse clean-up: sink away, then the manager drops it from the scene
    const T = ENEMY.corpseTime;
    if (this.deadT > T) {
      this.group.position.y -= dt * 0.6;
      if (this.deadT > T + 1.6) { this.group.visible = false; this.gone = true; }
    }
  }
}

// ------------------------------------------------------------
// EnemyManager — deployment (wave patterns), squad comms, crowd
// separation, anti-stuck guards and continuous "trickle" pressure
// for timed objectives.
// ------------------------------------------------------------

const PATTERNS = ['standard', 'flank', 'pincer', 'squad', 'rush'];

export class EnemyManager {
  constructor(scene, world, gltfScene = null) {
    this.scene = scene;
    this.world = world;
    this.gltfScene = gltfScene;
    this.enemies = [];
    this.hitMeshes = [];
    this._wavePlan = [];
    this._waveGap = WAVES.gap;
    this._waveT = 0;
    this._waveIdx = 0;
    this._waveTotal = 1;
    this._roster = ['rifle'];
    this._specials = [];
    this._elite = false;
    this._eliteChance = 0;
    this._hpScale = 1;
    this._area = 'hall';
    this._spawnRef = null;
    this.trickle = null;
    this.boss = null;
    this.lastPattern = 'standard';
    this.kills = 0;
  }

  /**
   * Arm a mission: clear the field, then deploy hostiles in waves.
   * opts: { eliteChance, hpScale, bossNow, trickle }
   */
  deploy(mission, opts = {}) {
    this._clearAll();
    this._mission = mission;
    this._area = mission.area;
    this._elite = !!mission.elite;
    this._eliteChance = opts.eliteChance ?? 0;
    this._hpScale = opts.hpScale ?? 1;
    this._roster = mission.roster ?? ['rifle'];
    this._specials = mission.specials ?? [];
    this._waveGap = mission.waveGap ?? WAVES.gap;
    this._spawnRef = mission.spawn ?? null;
    this._objTarget = opts.objTarget ?? null;
    this._bossCls = opts.boss ?? mission.boss ?? null;
    this.bossKilled = false;
    this._bossNow = !!opts.bossNow;
    this.trickle = opts.trickle ?? null;
    this._trickleT = this.trickle ? randRange(this.trickle.gap) : 0;
    const plan = mission.waves?.length ? [...mission.waves] : splitWaves(mission.enemyCount ?? 4);
    this._wavePlan = plan.slice(1);
    this._waveTotal = plan.length;
    this._waveIdx = 0;
    this._waveT = randRange(this._waveGap);
    this._spawnBatch(plan[0], null, 'standard');
    if (this._bossCls && (this._bossNow || plan.length === 1)) this._spawnBoss(null);
  }

  _clearAll() {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies = [];
    this.hitMeshes = [];
    this._wavePlan = [];
    this.boss = null;
    this.trickle = null;
  }

  respawn(mission) { this.deploy(mission ?? { enemyCount: 0, area: 'hall' }); }

  waveInfo() {
    return { current: Math.min(this._waveIdx, this._waveTotal), total: this._waveTotal, pattern: this.lastPattern };
  }

  /** Choose a class for the next hostile: mission roster, with special
   *  units mixed into later waves. */
  _rollClass(bag, i) {
    if (this._specials.length && this._waveIdx > 0 && chance(0.18 + this._waveIdx * 0.06)) {
      return this._specials[Math.floor(Math.random() * this._specials.length)];
    }
    return bag[i % bag.length];
  }

  /** Anchor indices for a batch, ordered by the wave pattern. */
  _pickAnchors(n, pattern, ctx) {
    const pool = SPAWN_POOLS[this._area] ?? SPAWN_POOLS.hall;
    const used = new Set(this.enemies.filter((e) => e.alive && e.anchorIdx >= 0).map((e) => e.anchorIdx));
    let idx = pool.map((_, i) => i).filter((i) => !used.has(i));
    if (!idx.length) idx = pool.map((_, i) => i);
    const ref = ctx?.playerPos ?? (this._spawnRef ? { x: this._spawnRef.x, z: this._spawnRef.z } : null);
    if (!ref) return shuffle(idx);
    const fwd = ctx?.playerFwd ?? null;
    const info = idx.map((i) => {
      const [x, z] = pool[i].pos;
      const dx = x - ref.x, dz = z - ref.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = fwd ? (dx * fwd.x + dz * fwd.z) / d : 0;
      const side = fwd ? (dx * -fwd.z + dz * fwd.x) / d : 0;
      return { i, d, dot, side, r: Math.random() };
    });
    const far = info.filter((a) => a.d > 13);
    const src = far.length >= Math.min(n, 2) ? far : info;
    let order;
    switch (pattern) {
      case 'flank': order = src.sort((a, b) => a.dot - b.dot + (a.r - b.r) * 0.3); break;   // behind you
      case 'pincer': {
        const L = shuffle(src.filter((a) => a.side < 0)), R = shuffle(src.filter((a) => a.side >= 0));
        order = [];
        while (L.length || R.length) { if (L.length) order.push(L.shift()); if (R.length) order.push(R.shift()); }
        break;
      }
      case 'squad': { const one = src[Math.floor(Math.random() * src.length)]; order = [one]; break; }
      default: order = src.sort((a, b) => (a.dot - b.dot) * 0.5 + (a.r - b.r));          // out of view first
    }
    return order.map((a) => a.i);
  }

  _spawnBatch(n, ctx = null, pattern = 'standard') {
    const pool = SPAWN_POOLS[this._area] ?? SPAWN_POOLS.hall;
    const anchors = this._pickAnchors(n, pattern, ctx);
    const bag = shuffle([...this._roster]);
    this.lastPattern = pattern;
    for (let i = 0; i < n; i++) {
      const anchorIdx = anchors.length ? anchors[i % anchors.length] : Math.floor(Math.random() * pool.length);
      const cls = this._rollClass(bag, i);
      this._spawnOne(cls, anchorIdx, ctx, pattern, i);
    }
    this._waveIdx++;
  }

  _spawnOne(cls, anchorIdx, ctx, pattern = 'standard', i = 0, extra = {}) {
    const pool = SPAWN_POOLS[this._area] ?? SPAWN_POOLS.hall;
    const def = pool[anchorIdx];
    const ey = def.y ?? 0;
    const spread = pattern === 'squad' ? 2.6 : 1.4;
    const [x, z] = this._freeSpot(def.pos[0] + rand(-spread, spread), def.pos[1] + rand(-spread, spread), ey);
    const wps = def.wps.map(([wx, wz]) => [wx + rand(-1, 1), wz + rand(-1, 1)]);
    const elite = this._elite || chance(this._eliteChance);
    const e = new Enemy(this.enemies.length, this.scene, this.gltfScene, wps, {
      elite, cls, hpScale: (extra.hpScale ?? 1) * this._hpScale,
    });
    e.group.position.set(x, ey, z);
    e.anchorY = ey;
    e.group.rotation.y = rand(0, Math.PI * 2);
    e.wpIndex = Math.floor(Math.random() * wps.length);
    e.anchorIdx = anchorIdx;
    if (this._objTarget && chance(0.5)) e.objTarget = this._objTarget;
    this.enemies.push(e);
    this.hitMeshes.push(...e.hitMeshes);
    if (ctx) {
      ctx.particles.dustPuff(x, ey + 0.3, z, 5);
      ctx.particles.smokePuff(x, ey + 1.1, z, 2, 0.35);
      e.attachAudio(ctx.audio);
      // rush / flank waves come in hot: they already know where you are
      if (pattern === 'rush' || pattern === 'flank' || pattern === 'pincer') {
        e.lastKnown.copy(ctx.playerPos);
        e.alertTo(ctx.playerPos, 0.3 + i * 0.25);
      }
    }
    return e;
  }

  _spawnBoss(ctx) {
    if (!this._bossCls || this.boss) return;
    const pool = SPAWN_POOLS[this._area] ?? SPAWN_POOLS.hall;
    const idx = this._pickAnchors(1, 'standard', ctx)[0] ?? 0;
    this.boss = this._spawnOne(this._bossCls, idx % pool.length, ctx, 'standard', 0);
    this.boss.elite = true;
    this._bossPhase = 0;
    ctx?.onBoss?.(this.boss);
  }

  _freeSpot(x, z, ey = 0) {
    for (let k = 0; k < 26; k++) {
      const a = k * 2.39996;
      const r = k === 0 ? 0 : 0.45 + k * 0.28;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!blockedAt(this.world, px, pz, 0.45, ey)) return [px, pz];
    }
    return [x, z];
  }

  attachAudio(audioManager) { for (const e of this.enemies) e.attachAudio(audioManager); }

  removeHitMeshes(enemy) {
    const set = new Set(enemy.hitMeshes);
    this.hitMeshes = this.hitMeshes.filter((m) => !set.has(m));
  }

  aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /** Live hostiles + reinforcements still queued — what "clear the area" means. */
  remaining() { return this.aliveCount() + this._wavePlan.reduce((a, n) => a + n, 0) + (this._bossCls && !this.boss ? 1 : 0); }

  /** Objective done: every hostile still standing pulls out (smoke + gone). */
  retreatAll(ctx) {
    this._wavePlan = [];
    this.trickle = null;
    this._bossCls = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const p = e.group.position;
      ctx?.particles.smokePuff(p.x, p.y + 1, p.z, 4, 0.5);
      e.state = ESTATE.DEAD;
      e.deadT = ENEMY.corpseTime + 2;
      e.group.visible = false;
      e.gone = true;
      this.removeHitMeshes(e);
    }
  }

  /** Defend objective: half the arrivals go for this target. */
  setObjectiveTarget(t) {
    this._objTarget = t;
    if (!t) for (const e of this.enemies) e.objTarget = null;
  }

  resetRecallClock() { this._recallAge = 0; }

  update(dt, ctx) {
    ctx.alert = ctx.alert ?? ((src, pos) => this._squadAlert(src, pos));
    ctx.allies = ctx.allies ?? (() => this.enemies);
    for (const e of this.enemies) e.update(dt, ctx);
    this._separate(ctx);
    this._antiStuck(ctx);
    this._idleRecall(dt, ctx);
    this._reapCorpses();
    this._bossTick(ctx);

    if (this._wavePlan.length) {
      this._waveT -= dt;
      // the next wave also comes early once the field is nearly clear
      if (this._waveT <= 0 || (this.aliveCount() <= 1 && this._waveT > 3)) {
        if (this._waveT > 0) { this._waveT = Math.min(this._waveT, 3); }
        else {
          const n = this._wavePlan.shift();
          const pattern = this._waveIdx === 0 ? 'standard' : PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
          this._spawnBatch(n, ctx, pattern);
          this._waveT = randRange(this._waveGap);
          if (!this._wavePlan.length && this._bossCls) this._spawnBoss(ctx);
          ctx.onWave?.(this.waveInfo());
        }
      }
    }
    if (this.trickle) {
      this._trickleT -= dt;
      if (this._trickleT <= 0) {
        this._trickleT = randRange(this.trickle.gap);
        if (this.aliveCount() < this.trickle.max) {
          const n = Math.min(randInt(this.trickle.batch), this.trickle.max - this.aliveCount());
          const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
          this._spawnBatch(n, ctx, pattern);
          ctx.onWave?.({ ...this.waveInfo(), trickle: true });
        }
      }
    }
  }

  _squadAlert(src, pos) {
    const sp = src.group.position;
    for (const e of this.enemies) {
      if (e === src || !e.alive || e.inCombat) continue;
      const d = e.group.position.distanceTo(sp);
      if (d < ENEMY.alertRadius) e.alertTo(pos, 0.35 + d * 0.05 + rand(0, 0.5));
    }
  }

  /** Bodies never overlap each other or the player (no more walking
   *  through a hostile or two soldiers sharing one spot). */
  _separate(ctx) {
    const E = this.enemies;
    for (let i = 0; i < E.length; i++) {
      const a = E[i];
      if (!a.alive) continue;
      const pa = a.group.position;
      for (let j = i + 1; j < E.length; j++) {
        const b = E[j];
        if (!b.alive || a.flying !== b.flying) continue;
        const pb = b.group.position;
        const dx = pb.x - pa.x, dz = pb.z - pa.z;
        const d2 = dx * dx + dz * dz;
        const min = 0.78;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        a._move(-dx / d * push, -dz / d * push, ctx);
        b._move(dx / d * push, dz / d * push, ctx);
      }
      if (!a.flying && ctx.pushPlayer) {
        const pp = ctx.playerPos;
        if (Math.abs(pp.y - a.anchorY) < 1.3) {
          const dx = pp.x - pa.x, dz = pp.z - pa.z;
          const d = Math.hypot(dx, dz);
          const min = 0.38 + 0.36 * a.bodyScale;
          if (d < min && d > 1e-4) ctx.pushPlayer((dx / d) * (min - d), (dz / d) * (min - d));
        }
      }
    }
  }

  _reapCorpses() {
    let changed = false;
    for (const e of this.enemies) {
      if (e.gone && e.group.parent) { this.scene.remove(e.group); changed = true; }
    }
    if (changed) this.enemies = this.enemies.filter((e) => !e.gone);
  }

  _bossTick(ctx) {
    const b = this.boss;
    if (!b) return;
    ctx.onBossHp?.(b.alive ? b.hp / b.maxHp : 0, b);
    if (!b.alive) { this.boss = null; this.bossKilled = true; return; }
    const f = b.hp / b.maxHp;
    // phase calls: at 66 % and 33 % the commander radios for backup
    const phase = f < 0.33 ? 2 : (f < 0.66 ? 1 : 0);
    if (phase > this._bossPhase) {
      this._bossPhase = phase;
      this._spawnBatch(2 + phase, ctx, 'pincer');
      ctx.onWave?.({ ...this.waveInfo(), boss: true });
    }
  }

  hearAll(pos) { for (const e of this.enemies) e.hear(pos); }

  /** Last-hostile failsafe: a hostile that never engaged for ~45 s is moved
   *  into open ground near the player so a mission can always finish. */
  _idleRecall(dt, ctx) {
    this._recallAge = (this._recallAge ?? 0) + dt;
    const T = this._recallAge;
    if (!ctx.playerPos) return;
    let recalled = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.inCombat || e.objTarget) e._engagedAt = T;
      if (e.hp < (e._lastHp ?? e.hp)) e._engagedAt = T;
      e._lastHp = e.hp;
      if ((e._engagedAt ?? 0) > T - 45 || T < 25) continue;
      const ang = ((T * 0.7) + recalled * 2.1) % (Math.PI * 2);
      recalled++;
      const py = ctx.playerPos.y ?? 0;
      const [sx, sz] = this._freeSpot(ctx.playerPos.x + Math.sin(ang) * 10, ctx.playerPos.z + Math.cos(ang) * 10, py);
      e.group.position.set(sx, py, sz);
      e.anchorY = py;
      e._engagedAt = T;
      e.lastKnown.copy(ctx.playerPos);
      e.state = ESTATE.CHASE;
      e.losTimer = 0;
      ctx.onRecall?.(e);
    }
  }

  /**
   * Anti-stuck guard: a live hostile whose centre lands inside a collider
   * or outside its arena rect is relocated to a free anchor with a poof
   * (a raycast starting inside a box never hits it — the old soft-lock).
   */
  _antiStuck(ctx) {
    const arena = ctx?.arena;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const p = e.group.position;
      let bad = false;
      if (arena && (p.x < arena.x0 - 2 || p.x > arena.x1 + 2 || p.z < arena.z0 - 2 || p.z > arena.z1 + 2)) {
        bad = true;
      } else if (!e.flying) {
        const py = e.anchorY ?? 0;
        const boxes = this.world.near(p.x, p.z, 0.3);
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          if (p.x > b.min.x - 0.2 && p.x < b.max.x + 0.2 && p.z > b.min.z - 0.2 && p.z < b.max.z + 0.2 &&
              b.min.y < py + 1.7 && b.max.y > py + 0.3) { bad = true; break; }
        }
      }
      if (bad) this._respawnStuck(e, ctx);
    }
  }

  _respawnStuck(e, ctx) {
    const pool = SPAWN_POOLS[this._area] ?? SPAWN_POOLS.hall;
    const used = new Set(this.enemies.filter((o) => o !== e && o.alive && o.anchorIdx >= 0).map((o) => o.anchorIdx));
    const fresh = shuffle(pool.map((_, i) => i).filter((i) => !used.has(i)));
    const anchorIdx = fresh.length ? fresh[0] : Math.floor(Math.random() * pool.length);
    const def = pool[anchorIdx];
    const ey = def.y ?? 0;
    const [x, z] = this._freeSpot(def.pos[0] + rand(-1.2, 1.2), def.pos[1] + rand(-1.2, 1.2), ey);
    e.group.position.set(x, ey, z);
    e.anchorY = ey;
    e.knock.set(0, 0, 0);
    e.anchorIdx = anchorIdx;
    e.wpIndex = Math.floor(Math.random() * e.waypoints.length);
    if (e.inCombat) e.state = ESTATE.SEARCH;
    if (ctx?.particles) {
      ctx.particles.dustPuff(x, ey + 0.3, z, 5);
      ctx.particles.smokePuff(x, ey + 1.1, z, 2, 0.35);
    }
  }
}
