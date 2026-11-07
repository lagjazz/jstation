// ============================================================
// player.js — first-person controller: PointerLockControls look,
// WASD + sprint/jump/crouch movement with AABB collision, gravity,
// camera-recoil/shake integration (applied additively each frame
// and removed next frame so PointerLockControls never fights it),
// HP (no regen — medkits only), footsteps.
// ============================================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { PLAYER } from './config.js';
import { LAYOUT } from './layout.js';
import { moveAndSlide } from './collision.js';
import { clamp, damp, rand } from './utils.js';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(camera, world, audio) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.controls = new PointerLockControls(camera, document.body);

    this.feet = new THREE.Vector3(LAYOUT.spawn.x, 0, LAYOUT.spawn.z);
    this.vel = new THREE.Vector2(0, 0);      // x,z m/s
    this.vy = 0;
    this.grounded = true;
    // Per-mission physics mods (MISSIONS[].mods — low gravity, deep water,
    // skyport's floorless deck). setMods() rewrites these each mission.
    this.gScale = 1;
    this.jScale = 1;
    this.sScale = 1;
    this.floorPlane = true;                  // false = only slab colliders hold you
    this.eye = PLAYER.eyeStand;
    this.hp = PLAYER.maxHp;
    this.lastDamage = -99;
    this.missionTime = 0;

    this.recoil = 0;
    this.shakeAmt = 0;
    this.prevExtra = { x: 0, y: 0 };
    this.prevPosOff = new THREE.Vector3();
    this.time = 0;
    this.stepT = 0;
    this.wasAirborne = false;

    camera.position.set(this.feet.x, this.eye, this.feet.z);
    camera.rotation.order = 'YXZ';
  }

  get position() { return this.feet; }
  get eyePos() { return new THREE.Vector3(this.feet.x, this.feet.y + this.eye, this.feet.z); }

  reset() {
    this.feet.set(LAYOUT.spawn.x, 0, LAYOUT.spawn.z);
    this.vel.set(0, 0);
    this.vy = 0;
    this.hp = PLAYER.maxHp;
    this.lastDamage = -99;
    this.recoil = 0;
    this.shakeAmt = 0;
    this.missionTime = 0;
  }

  /** Teleport to a mission start point and face `yaw` (0 = -Z). */
  /** Mission physics mods (config.js MISSIONS[].mods). */
  setMods(mods = {}) {
    this.gScale = mods.gravityScale ?? 1;
    this.jScale = mods.jumpScale ?? 1;
    this.sScale = mods.speedScale ?? 1;
    this.slip = !!mods.ice;                   // polar deck: low traction
    this.floorPlane = !mods.fallKill;
  }

  /**
   * Highest standing surface under the feet: the y=0 arena plane when the
   * mission has one, else the top of any collider box overlapping the foot
   * circle at/below foot level. Skyport's deck slabs sit at top=0 so the
   * deck feels solid while the open edges let you fall to your death.
   */
  _supportY(px, pz, feetY) {
    let top = this.floorPlane ? 0 : -Infinity;
    const r = PLAYER.radius;
    const boxes = this.world.near(px, pz, r + 0.05);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (px + r > b.min.x && px - r < b.max.x &&
          pz + r > b.min.z && pz - r < b.max.z &&
          b.max.y <= feetY + 0.06 && b.max.y > top) top = b.max.y;
    }
    return top;
  }

  setSpawn(sp) {
    this.feet.set(sp.x, 0, sp.z);
    this.vel.set(0, 0);
    this.vy = 0;
    this.grounded = true;
    this.prevExtra.x = 0;
    this.prevExtra.y = 0;
    this.prevPosOff.set(0, 0, 0);
    this.camera.quaternion.setFromEuler(new THREE.Euler(0, sp.yaw ?? 0, 0, 'YXZ'));
    this.camera.position.set(sp.x, this.eye, sp.z);
  }

  addRecoil(rad) { this.recoil = clamp(this.recoil + rad, 0, 0.06); }
  shake(amt) { this.shakeAmt = clamp(this.shakeAmt + amt, 0, 0.045); }

  /** CS-style permanent view climb: adds `rad` straight to camera pitch and
   *  leaves it there (unlike addRecoil's transient kick). Holding the trigger
   *  walks the muzzle up the screen; pulling down is the player's job. */
  addPitch(rad) {
    _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    _e.x = clamp(_e.x + rad, -1.5, 1.5);
    this.camera.quaternion.setFromEuler(_e);
  }

  damage(n) {
    this.hp = Math.max(0, this.hp - n);
    this.lastDamage = this.missionTime;
    this.shake(0.012);
    this.audio.play('hurt', { volume: 0.7 });
    return this.hp;
  }

  update(dt, keys, locked, time) {
    this.time += dt;
    this.missionTime += dt;

    // ---- strip last frame's additive look offset ----
    _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    _e.x -= this.prevExtra.x;
    _e.y -= this.prevExtra.y;

    // ---- wish direction from yaw ----
    const yaw = _e.y;
    let fwd = 0, strafe = 0;
    if (locked) {
      if (keys.KeyW) fwd += 1;
      if (keys.KeyS) fwd -= 1;
      if (keys.KeyD) strafe += 1;
      if (keys.KeyA) strafe -= 1;
    }
    const crouching = locked && (keys.ControlLeft || keys.ControlRight);
    const sprinting = locked && keys.ShiftLeft && fwd > 0 && !crouching;
    const speed = (crouching ? PLAYER.crouchSpeed : (sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed)) * this.sScale;

    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let wx = -sinY * fwd + cosY * strafe;
    let wz = -cosY * fwd - sinY * strafe;
    const wlen = Math.hypot(wx, wz) || 1;
    wx = (wx / wlen) * speed;
    wz = (wz / wlen) * speed;

    // ice mod: on the ground the boot barely bites — long slippery glide
    const accel = (this.grounded ? PLAYER.accel * (this.slip ? 0.26 : 1)
      : PLAYER.accel * PLAYER.airControl);
    this.vel.x = damp(this.vel.x, wx, accel, dt);
    this.vel.y = damp(this.vel.y, wz, accel, dt);

    // ---- integrate + collide ----
    const height = crouching ? PLAYER.height * 0.72 : PLAYER.height;
    const dx = this.vel.x * dt, dz = this.vel.y * dt;
    // step-assist: kerbs / stair treads / low crates are walked onto
    moveAndSlide(this.feet, dx, dz, PLAYER.radius, height, this.world,
      this.grounded ? PLAYER.stepUp : PLAYER.stepUp * 0.7);

    // ---- jump / gravity ----
    // Support = the y=0 arena plane (most missions) OR the top of any
    // collider directly under the feet (skyport's deck slabs, crates…).
    if (locked && keys.Space && this.grounded) {
      this.vy = PLAYER.jumpSpeed * this.jScale;
      this.grounded = false;
      this.audio.play('footstep', { volume: 0.5, rate: 1.4 });
    }
    this.vy -= PLAYER.gravity * this.gScale * dt;
    const ny = this.feet.y + this.vy * dt;
    const support = this._supportY(this.feet.x, this.feet.z, Math.max(this.feet.y, ny));
    if (this.vy <= 0 && ny <= support) {
      if (this.wasAirborne && this.vy < -5) {
        this.audio.play('land', { volume: clamp(-this.vy / 18, 0.2, 0.8) });
        this.shake(0.008);
      }
      this.feet.y = support;
      this.vy = 0;
      this.grounded = true;
      this.wasAirborne = false;
    } else {
      this.feet.y = ny;
      this.grounded = false;
      this.wasAirborne = true;
    }

    // ---- crouch eye height ----
    this.eye = damp(this.eye, crouching ? PLAYER.eyeCrouch : PLAYER.eyeStand, 12, dt);

    // ---- recoil + camera shake (additive, removed next frame) ----
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.shakeAmt = damp(this.shakeAmt, 0, 7, dt);
    const t = this.time;
    const n1 = Math.sin(t * 53.7) * Math.sin(t * 21.3 + 1.7);
    const n2 = Math.sin(t * 47.1 + 4) * Math.sin(t * 17.9);
    const n3 = Math.sin(t * 61.3 + 2) * Math.sin(t * 29.7);
    const extraX = this.recoil + n1 * this.shakeAmt * 0.55;
    const extraY = n2 * this.shakeAmt * 0.55;

    _e.x += extraX;
    _e.y += extraY;
    this.camera.quaternion.setFromEuler(_e);
    this.prevExtra.x = extraX;
    this.prevExtra.y = extraY;

    // ---- camera position (fully owned here) ----
    const posOff = this.prevPosOff.set(n2 * this.shakeAmt * 0.35, n3 * this.shakeAmt * 0.4, n1 * this.shakeAmt * 0.35);
    this.camera.position.set(this.feet.x + posOff.x, this.feet.y + this.eye + posOff.y, this.feet.z + posOff.z);

    // ---- sprint FOV ----
    // ADS zoom divides the FOV (weapon.zoom(), set by the game each frame)
    const targetFov = (sprinting ? PLAYER.fovSprint : PLAYER.fov) / (this.fovZoom ?? 1);
    if (Math.abs(this.camera.fov - targetFov) > 0.02) {
      this.camera.fov = damp(this.camera.fov, targetFov, this.fovZoom > 1.01 ? 14 : 6, dt);
      this.camera.updateProjectionMatrix();
    }

    // ---- footsteps ----
    const hSpeed = Math.hypot(this.vel.x, this.vel.y);
    if (this.grounded && hSpeed > 1.2) {
      this.stepT -= hSpeed * dt;
      if (this.stepT <= 0) {
        this.audio.play('footstep', { volume: crouching ? 0.18 : 0.42 });
        this.stepT = crouching ? 0.9 : 0.62;
      }
    }

    // No passive HP regen — health comes back only from picked-up medkits
    // (DROPS in config.js) or the partial restore after an overrun respawn.

    return { hSpeed, sprinting, crouching, grounded: this.grounded };
  }
}
