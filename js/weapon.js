// ============================================================
// weapon.js — first-person weapon system (camera-space viewmodels).
// Three weapons (1 rifle / 2 pistol / 3 shotgun), each built from
// detailed procedural PBR parts (receiver, barrel, magazine, stock,
// grip, sights, muzzle device …) unless assets/models/rifle.glb is
// provided. Programmatic animation: idle breathing, walk bob,
// sprint tilt, recoil spring, reload sequence, switch animation.
// ============================================================

import * as THREE from 'three';
import { RECOIL, WEAPONS, WEAPON_ORDER } from './config.js';
import { MAT } from './materials.js';
import { TEX } from './textures.js';
import { damp, rand } from './utils.js';

const metalA = () => MAT.metalDark;
const metalB = () => MAT.metal;
const polymerMat = () => {
  if (!polymerMat._m) {
    polymerMat._m = new THREE.MeshStandardMaterial({ color: 0x17181d, roughness: 0.52, metalness: 0.15 });
  }
  return polymerMat._m;
};
const rubberMat = () => {
  if (!rubberMat._m) {
    rubberMat._m = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.92, metalness: 0 });
  }
  return rubberMat._m;
};

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  m.receiveShadow = false;
  m.frustumCulled = false;
  parent.add(m);
  return m;
}

const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylG = (r, len, seg = 10) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);   // align along Z
  return g;
};

// ---------------- procedural builders ----------------
// forward = -Z (camera space convention)

function buildRifle() {
  const g = new THREE.Group();
  const M = metalA(), P = polymerMat();

  part(g, boxG(0.075, 0.09, 0.46), M, 0, 0, -0.18);                 // receiver
  part(g, boxG(0.052, 0.013, 0.42), metalB(), 0, 0.053, -0.2);      // top rail
  part(g, boxG(0.056, 0.012, 0.18), M, 0, 0.07, -0.06);             // optic base
  part(g, boxG(0.04, 0.05, 0.012), M, 0, 0.085, -0.03);             // rear sight
  part(g, boxG(0.012, 0.055, 0.012), metalB(), 0, 0.082, -0.52);    // front post
  part(g, boxG(0.07, 0.07, 0.26), P, 0, 0, -0.46);                  // handguard
  for (let i = 0; i < 4; i++) {                                     // vents
    part(g, boxG(0.074, 0.008, 0.028), M, 0, 0.026, -0.38 - i * 0.05);
  }
  part(g, cylG(0.016, 0.3), M, 0, 0.005, -0.6);                     // barrel
  part(g, cylG(0.023, 0.06, 12), M, 0, 0.005, -0.755);              // muzzle device
  part(g, boxG(0.05, 0.17, 0.085), P, 0, -0.115, -0.13, 0.2);       // magazine (raked)
  part(g, boxG(0.048, 0.115, 0.062), rubberMat(), 0, -0.1, 0.045, -0.35); // grip
  part(g, boxG(0.055, 0.03, 0.12), M, 0, 0.02, 0.09);               // buffer tube
  part(g, boxG(0.07, 0.1, 0.15), P, 0, -0.015, 0.22);               // stock
  part(g, boxG(0.03, 0.05, 0.02), P, 0, -0.02, 0.315);              // buttpad
  part(g, boxG(0.024, 0.02, 0.05), metalB(), 0.042, 0.045, 0.05);   // charging handle
  part(g, boxG(0.012, 0.045, 0.012), M, 0, -0.052, -0.015);         // trigger guard front

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, -0.8);
  g.add(muzzle);
  return { group: g, muzzle };
}

function buildPistol() {
  const g = new THREE.Group();
  const M = metalA(), P = polymerMat();
  part(g, boxG(0.045, 0.056, 0.22), M, 0, 0.028, -0.1);             // slide
  part(g, boxG(0.042, 0.03, 0.19), P, 0, -0.012, -0.085);           // frame
  part(g, boxG(0.044, 0.015, 0.024), metalB(), 0, 0.06, -0.16);     // rear sight
  part(g, boxG(0.012, 0.017, 0.012), metalB(), 0, 0.062, 0.02);     // front sight
  part(g, boxG(0.042, 0.125, 0.06), P, 0, -0.085, 0.045, -0.28);    // grip
  part(g, boxG(0.046, 0.02, 0.06), P, 0, -0.15, 0.06);              // mag base
  part(g, boxG(0.01, 0.04, 0.01), M, 0, -0.05, -0.03);              // trigger guard
  part(g, cylG(0.012, 0.03, 10), M, 0, 0.028, -0.225);              // crown
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.028, -0.25);
  g.add(muzzle);
  return { group: g, muzzle };
}

function buildShotgun() {
  const g = new THREE.Group();
  const M = metalA();
  part(g, cylG(0.019, 0.62, 12), M, 0, 0.02, -0.35);                // barrel
  part(g, cylG(0.014, 0.5, 10), M, 0, -0.025, -0.32);               // tube mag
  part(g, boxG(0.062, 0.095, 0.24), M, 0, 0, 0.04);                 // receiver
  const pump = part(g, boxG(0.07, 0.06, 0.15), rubberMat(), 0, -0.025, -0.28); // forend
  part(g, boxG(0.012, 0.05, 0.012), M, 0, -0.06, 0.0);              // trigger guard
  part(g, boxG(0.05, 0.1, 0.3), rubberMat(), 0, -0.035, 0.26, 0.12);// stock
  part(g, boxG(0.052, 0.075, 0.06), rubberMat(), 0, -0.03, 0.41, 0.3); // butt
  part(g, boxG(0.014, 0.02, 0.5), metalB(), 0, 0.045, -0.16);       // bead rail
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.68);
  g.add(muzzle);
  return { group: g, muzzle, pump };
}

// ---------------- controller ----------------

export class WeaponController {
  constructor(camera, audio, particles) {
    this.camera = camera;
    this.audio = audio;
    this.particles = particles;
    this.weapons = [];
    this.current = 0;
    this.fireTimer = 0;
    this.heat = 0;
    // CS-style spray pattern (RECOIL in config.js): shots since the last
    // pause; sprayNorm = 0..1 position on the weapon's climb ramp.
    this.spray = 0;
    this.sprayT = 99;
    this.sprayNorm = 0;
    this.kickPos = 0;
    this.kickRot = 0;
    this.reloadT = -1;
    this.reloadDur = 0;
    this.reloadSwapped = false;
    this.switchT = 0;
    this.pendingSwitch = -1;
    this.sprintAmt = 0;
    this.bobT = 0;
    this.flashT = 0;
    this.time = 0;

    // helper light so the viewmodel is always readable (no shadow)
    this.viewLight = new THREE.PointLight(0xcfe0ff, 5, 3.5, 2);
    this.viewLight.position.set(0.25, 0.12, -0.6);
    camera.add(this.viewLight);
  }

  init(rifleGLB) {
    const defs = WEAPON_ORDER.map((k) => WEAPONS[k]);
    defs.forEach((def, i) => {
      let built;
      if (def.key === 'rifle' && rifleGLB) built = this._fromGLB(rifleGLB);
      else if (def.key === 'rifle') built = buildRifle();
      else if (def.key === 'pistol') built = buildPistol();
      else built = buildShotgun();

      const root = new THREE.Group();
      root.add(built.group);
      built.group.rotation.y = 0.1;                    // slight inward angle

      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.muzzleFlash, color: new THREE.Color(2.6, 2.0, 1.1),
        blending: THREE.AdditiveBlending, transparent: true, depthTest: false,
      }));
      flash.scale.setScalar(0.16);
      flash.position.copy(built.muzzle.position);
      flash.visible = false;
      flash.renderOrder = 999;
      built.group.add(flash);

      const light = new THREE.PointLight(0xffb066, 0, 9, 2);
      light.position.copy(built.muzzle.position);
      built.group.add(light);

      root.visible = i === 0;
      // natural carry height (chest/shoulder, well below the eye). The gun
      // is NOT raised to eye level anymore — vertical convergence through
      // the crosshair comes from the muzzle-up pitch computed below, so the
      // barrel line still passes through the crosshair while the gun body
      // stays low. (group rotation.y 0.1 handles horizontal convergence.)
      const basePos = def.key === 'rifle' ? new THREE.Vector3(0.3, -0.14, -0.58)
        : def.key === 'pistol' ? new THREE.Vector3(0.28, -0.11, -0.5)
          : new THREE.Vector3(0.28, -0.13, -0.52);
      // pitch the weapon up exactly enough that its muzzle anchor lands on
      // the camera axis: sin(tilt) = rise needed / muzzle distance ahead
      const mz = Math.max(-built.muzzle.position.z, 0.05);
      const rise = -basePos.y - built.muzzle.position.y;
      built.group.rotation.x = Math.asin(THREE.MathUtils.clamp(rise / mz, -0.6, 0.6));

      this.camera.add(root);
      this.weapons.push({
        def, root, holder: built.group, muzzle: built.muzzle, flash, light,
        pump: built.pump ?? null,
        mag: def.mag, reserve: def.reserve,
        basePos, baseRotY: 0.1,
      });
    });
  }

  _fromGLB(gltf) {
    const src = gltf.scene ?? gltf;
    const inner = src.clone(true);
    const b = new THREE.Box3().setFromObject(inner);
    const size = b.getSize(new THREE.Vector3());
    const len = Math.max(size.x, size.y, size.z, 0.001);
    const s = 0.92 / len;
    inner.scale.setScalar(s);

    // Orientation lives on an inner wrapper: init() applies the slight inward
    // view angle (rotation.y) to the returned group, which must compose with
    // — not clobber — the axis fix below.
    const orient = new THREE.Group();
    orient.rotation.y = size.x >= Math.max(size.y, size.z) ? -Math.PI / 2 : 0; // faces -Z
    orient.add(inner);

    b.setFromObject(orient);
    const c = b.getCenter(new THREE.Vector3());
    orient.position.set(-c.x, -c.y, -c.z - size.z * s * 0.35);

    const group = new THREE.Group();
    group.add(orient);
    b.setFromObject(group);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.01, b.min.z);   // barrel tip, in group space
    group.add(muzzle);

    inner.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
    return { group, muzzle };
  }

  get w() { return this.weapons[this.current]; }

  /** Salvage pickup: add rounds to one weapon (or all) up to its cap. */
  addReserve(key, amount) {
    for (const wp of this.weapons) {
      if (key && wp.def.key !== key) continue;
      const cap = wp.def.reserveMax ?? wp.reserve + amount;
      wp.reserve = Math.min(cap, wp.reserve + amount);
    }
  }

  reset() {
    for (const wp of this.weapons) {
      wp.mag = wp.def.mag;
      wp.reserve = wp.def.reserve;
    }
    this.current = 0;
    this.weapons.forEach((wp, i) => { wp.root.visible = i === 0; });
    this.reloadT = -1;
    this.switchT = 0;
    this.pendingSwitch = -1;
    this.heat = 0;
    this.spray = 0;
    this.sprayT = 99;
    this.sprayNorm = 0;
  }

  canFire() {
    return this.reloadT < 0 && this.switchT <= 0 && this.w.mag > 0 && this.fireTimer <= 0;
  }

  /** Consume one shot; returns the weapon def (for raycast params). */
  fire() {
    const wp = this.w;
    wp.mag--;
    this.fireTimer = 60 / wp.def.rpm;

    // CS-style spray: every shot on the same trigger pull heats the pattern
    // more (spread AND viewmodel kick grow with sprayNorm); a pause of
    // RECOIL.resetAfter s lets it wash out in update().
    this.sprayT = 0;
    this.spray = Math.min(this.spray + 1, 60);
    this.sprayNorm = Math.min(this.spray / (wp.def.sprayRamp ?? 8), 1);
    const tn = this.sprayNorm;

    this.heat = Math.min(this.heat + wp.def.spreadKick * (0.85 + 0.9 * tn), wp.def.spreadMax);
    this.kickPos = Math.min(this.kickPos + wp.def.kick * 0.045 * (0.6 + 0.7 * tn), 0.14 + 0.09 * tn);
    this.kickRot = Math.min(this.kickRot + wp.def.kick * 0.055 * (0.6 + 0.7 * tn), 0.16 + 0.14 * tn);

    this.flashT = 0.05;
    wp.flash.visible = true;
    wp.flash.material.rotation = rand(0, Math.PI * 2);
    wp.flash.scale.setScalar(rand(0.13, 0.19) * (wp.def.kick * 0.55 + 0.55));
    wp.light.intensity = 16 + wp.def.kick * 8;

    const mp = wp.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.particles.muzzleSmoke(mp.x, mp.y, mp.z, dir.x, dir.y, dir.z);
    this.particles.sparkBurst(mp.x, mp.y, mp.z, dir.x, dir.y, dir.z, 3);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.particles.shellCasing(mp.x, mp.y - 0.05, mp.z, right.x, 2.2, right.z);

    this.audio.play(wp.def.sound, { volume: 1 });
    return wp.def;
  }

  startReload() {
    const wp = this.w;
    if (this.reloadT >= 0 || wp.mag >= wp.def.mag || wp.reserve <= 0) return false;
    this.reloadT = 0;
    this.reloadDur = wp.def.reloadTime;
    this.reloadSwapped = false;
    this.audio.play('reload', { volume: 0.8 });
    return true;
  }

  switchTo(i) {
    if (i === this.current || i < 0 || i >= this.weapons.length || this.switchT > 0) return;
    this.pendingSwitch = i;
    this.switchT = 0.5;
    this.reloadT = -1;
    this.audio.play('switch', { volume: 0.6 });
  }

  /**
   * ctx = { hSpeed, sprinting, crouching, grounded, firing }
   */
  update(dt, ctx) {
    this.time += dt;
    const wp = this.w;

    if (this.fireTimer > 0) this.fireTimer -= dt;

    // Spray pattern: HELD while the trigger stays down (spread never cools
    // mid-burst — CS behaviour), washes out once firing pauses.
    this.sprayT += dt;
    if (this.sprayT > RECOIL.resetAfter) {
      this.heat = damp(this.heat, 0, 4.5, dt);
      this.spray = damp(this.spray, 0, RECOIL.coolRate, dt);
      if (this.spray < 0.05) this.spray = 0;
    }
    this.sprayNorm = Math.min(this.spray / (wp.def.sprayRamp ?? 8), 1);

    // reload
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      if (!this.reloadSwapped && this.reloadT > this.reloadDur * 0.42) {
        this.reloadSwapped = true;
        const need = wp.def.mag - wp.mag;
        const take = Math.min(need, wp.reserve);
        wp.mag += take;
        wp.reserve = Math.min(wp.def.reserveMax ?? wp.reserve, wp.reserve - take);
      }
      if (this.reloadT >= this.reloadDur) this.reloadT = -1;
    }

    // switching
    let switchDip = 0;
    if (this.switchT > 0) {
      this.switchT -= dt;
      const t = 1 - Math.abs(this.switchT / 0.5 - 0.5) * 2;  // 0→1→0
      switchDip = t;
      if (this.switchT <= 0 && this.pendingSwitch >= 0) {
        this.weapons[this.current].root.visible = false;
        this.current = this.pendingSwitch;
        this.pendingSwitch = -1;
        this.weapons[this.current].root.visible = true;
        switchDip = 0;
      }
    }

    // spring recoil recovery
    this.kickPos = damp(this.kickPos, 0, 11, dt);
    this.kickRot = damp(this.kickRot, 0, 10, dt);

    // flash + muzzle light decay
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) wp.flash.visible = false;
    }
    if (wp.light.intensity > 0.05) wp.light.intensity *= Math.exp(-dt * 36);
    else wp.light.intensity = 0;

    // movement state
    const moving = ctx.hSpeed > 0.5 && ctx.grounded;
    const speedNorm = Math.min(ctx.hSpeed / 5.7, 1);
    this.sprintAmt = damp(this.sprintAmt, ctx.sprinting && moving ? 1 : 0, 9, dt);
    this.bobT += dt * (4 + speedNorm * 9);

    const idleBreath = Math.sin(this.time * 1.7) * 0.004;
    const bobAmp = (0.008 + speedNorm * 0.02) * (1 - this.sprintAmt * 0.4) + this.sprintAmt * 0.014;
    const bobX = Math.cos(this.bobT) * bobAmp;
    const bobY = -Math.abs(Math.sin(this.bobT)) * bobAmp * 0.9;

    // reload animation curve (dip + tilt)
    let reloadDip = 0, reloadTilt = 0, pumpSlide = 0;
    if (this.reloadT >= 0) {
      const r = this.reloadT / this.reloadDur;
      reloadDip = Math.sin(Math.min(r * 2, 1) * Math.PI / 2) * (r < 0.85 ? 1 : (1 - r) / 0.15) * 0.12;
      reloadTilt = Math.sin(r * Math.PI) * 0.5;
      pumpSlide = Math.sin(r * Math.PI * 3) * 0.05;
    }

    const crouchSway = ctx.crouching ? 0.012 : 0;

    const targetPos = new THREE.Vector3(
      wp.basePos.x + bobX * (moving ? 1 : 0) + this.sprintAmt * 0.03,
      wp.basePos.y + bobY * (moving ? 1 : 0) + idleBreath - switchDip * 0.25 - reloadDip - crouchSway,
      wp.basePos.z + this.kickPos + this.sprintAmt * 0.06,
    );
    wp.root.position.lerp(targetPos, 1 - Math.exp(-18 * dt));
    wp.root.rotation.x = damp(wp.root.rotation.x, -this.kickRot + reloadTilt + this.sprintAmt * 0.12, 16, dt);
    wp.root.rotation.y = damp(wp.root.rotation.y, wp.baseRotY * (1 - this.sprintAmt) + this.sprintAmt * 0.55, 10, dt);
    wp.root.rotation.z = damp(wp.root.rotation.z, this.sprintAmt * 0.28 + (moving ? Math.sin(this.bobT) * 0.01 : 0), 10, dt);

    if (wp.pump) wp.pump.position.z = -0.28 + pumpSlide;
  }

  /** Current spread in radians including heat and movement penalties. */
  currentSpread(ctx) {
    const wp = this.w;
    let s = wp.def.spreadBase + this.heat;
    if (ctx.sprinting) s += 0.012;
    if (!ctx.grounded) s += 0.02;
    if (ctx.hSpeed > 0.5) s += ctx.hSpeed * 0.0016;
    if (ctx.crouching) s *= 0.65;
    return s;
  }
}
