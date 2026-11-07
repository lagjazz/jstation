// ============================================================
// explosives.js — frag grenades, launcher rounds and explosions.
//
// Projectiles are pooled meshes integrated against the AABB collider
// world (bounce off walls/floors, or detonate on impact). Fused frags
// blink faster as they cook. Explosions damage every hostile, the
// player and explosive barrels inside the radius (falloff), and spawn
// a pooled additive fireball + shock ring + sparks/smoke/debris.
// No lights are created — the game's shared muzzle-light pool is used
// for the flash, so the light count never changes (no recompiles).
// ============================================================

import * as THREE from 'three';
import { clamp, rand } from './utils.js';

const GRAV = 18;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

function makeGrenadeMesh(mats) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 9), mats.body);
  body.scale.set(1, 1.2, 1);
  body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 8), mats.cap);
  cap.position.y = 0.09;
  g.add(cap);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mats.led.clone());
  led.position.set(0, 0.11, 0.02);
  g.add(led);
  g.userData.led = led;
  return g;
}

export class Explosives {
  constructor(scene, world, particles, audio) {
    this.scene = scene;
    this.world = world;
    this.p = particles;
    this.audio = audio;
    this.live = [];
    this._pool = [];
    this._fx = [];
    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0x3a4430, roughness: 0.55, metalness: 0.4 }),
      cap: new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.85 }),
      led: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2), toneMapped: false }),
    };
    // fireball + shock ring pool (additive, unlit)
    const ballGeo = new THREE.IcosahedronGeometry(1, 2);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
    for (let i = 0; i < 6; i++) {
      const ball = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.2, 1.6, 0.5), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(2, 1.4, 0.8), transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ball.visible = ring.visible = false;
      ball.frustumCulled = ring.frustumCulled = false;
      scene.add(ball, ring);
      this._fx.push({ ball, ring, t: 99, r: 1 });
    }
  }

  _mesh() {
    const m = this._pool.pop() ?? makeGrenadeMesh(this.mats);
    m.visible = true;
    if (!m.parent) this.scene.add(m);
    return m;
  }

  /**
   * Lob a projectile from `from` to land near `to`.
   * opts: { fuse (s), impact (bool: detonate on contact), speed, dmg,
   *         radius, owner (enemy | 'player') }
   */
  throw(from, to, opts = {}) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    const speed = opts.speed ?? 14;
    const T = clamp(dist / speed, 0.45, 1.5);
    const vel = new THREE.Vector3(dx / T, (to.y - from.y) / T + 0.5 * GRAV * T, dz / T);
    return this._spawn(from, vel, opts);
  }

  /** Fire along a direction (player launcher / thrown frag). */
  launch(from, dir, opts = {}) {
    const vel = dir.clone().multiplyScalar(opts.speed ?? 16);
    return this._spawn(from, vel, opts);
  }

  _spawn(from, vel, opts) {
    if (this.live.length >= 24) return null;
    const mesh = this._mesh();
    mesh.position.copy(from);
    const g = {
      mesh, vel, fuse: opts.fuse ?? 2.2, t: 0, impact: !!opts.impact,
      dmg: opts.dmg ?? 120, radius: opts.radius ?? 6, owner: opts.owner ?? null,
      bounces: 0, spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
      armed: opts.armDelay ?? 0.08,
    };
    mesh.userData.led.material.color.setRGB(opts.owner === 'player' ? 0.3 : 3, opts.owner === 'player' ? 2.4 : 0.3, 0.3);
    this.live.push(g);
    return g;
  }

  /** True when a point is inside any collider. */
  _solid(x, y, z) {
    const boxes = this.world.near(x, z, 0.1);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && y > b.min.y && y < b.max.y) return b;
    }
    return null;
  }

  /**
   * ctx: { enemies, playerPos (feet), floorPlane, onExplode(pos, g),
   *        hitTest(pos) → enemy|'player'|null for impact rounds }
   */
  update(dt, ctx) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.t += dt;
      g.armed -= dt;
      const p = g.mesh.position;
      g.vel.y -= GRAV * dt;
      let hit = false;
      // per-axis integration with simple reflection
      const nx = p.x + g.vel.x * dt;
      if (this._solid(nx, p.y, p.z)) { g.vel.x *= -0.4; hit = true; } else p.x = nx;
      const nz = p.z + g.vel.z * dt;
      if (this._solid(p.x, p.y, nz)) { g.vel.z *= -0.4; hit = true; } else p.z = nz;
      const ny = p.y + g.vel.y * dt;
      const floor = ctx.floorPlane === false ? -50 : 0.08;
      const below = g.vel.y < 0 ? this._solid(p.x, ny, p.z) : null;
      if (below || ny < floor) {
        p.y = below ? below.max.y + 0.08 : floor;
        if (Math.abs(g.vel.y) > 2.5) {
          hit = true;
          if (!g.impact) this.audio.play('grenadeBounce', { volume: clamp(Math.abs(g.vel.y) / 10, 0.15, 0.6), rate: rand(0.9, 1.15) });
        }
        g.vel.y *= -0.32;
        g.vel.x *= 0.62; g.vel.z *= 0.62;
      } else if (g.vel.y > 0 && this._solid(p.x, ny, p.z)) {
        g.vel.y *= -0.3; hit = true;
      } else p.y = ny;
      g.mesh.rotation.x += g.spin.x * dt * (g.vel.lengthSq() > 1 ? 1 : 0.1);
      g.mesh.rotation.z += g.spin.z * dt * (g.vel.lengthSq() > 1 ? 1 : 0.1);
      // cooking blink
      const left = g.fuse - g.t;
      const rate = left < 0.7 ? 18 : 6;
      g.mesh.userData.led.visible = Math.sin(g.t * rate) > 0;
      if (g.impact && Math.random() < 0.6) this.p.smokePuff(p.x, p.y, p.z, 1, 0.75, null, 0.15);

      let boom = !g.impact && g.t >= g.fuse;
      if (g.impact && g.armed <= 0) {
        if (hit) boom = true;
        else if (ctx.hitTest && ctx.hitTest(p, g.owner)) boom = true;
        else if (g.t > 6) boom = true;
      }
      if (boom) {
        this.explode(p.clone(), g, ctx);
        this._release(i);
      }
    }
    // fireballs
    for (const f of this._fx) {
      if (f.t > 1) continue;
      f.t += dt;
      const k = f.t / 0.55;
      if (k >= 1) { f.ball.visible = f.ring.visible = false; f.t = 99; continue; }
      const s = f.r * (0.35 + 0.75 * Math.sqrt(k));
      f.ball.scale.setScalar(s);
      f.ball.material.opacity = (1 - k) * 0.9;
      f.ball.material.color.setRGB(3.2 - k * 2.2, 1.6 - k * 1.2, 0.5 - k * 0.45);
      f.ring.scale.setScalar(f.r * (0.3 + 1.6 * k));
      f.ring.material.opacity = (1 - k) * 0.6;
    }
  }

  _release(i) {
    const g = this.live[i];
    g.mesh.visible = false;
    this._pool.push(g.mesh);
    this.live.splice(i, 1);
  }

  /** Detonate at `pos` (also used by barrels): damage + VFX + sound. */
  explode(pos, g, ctx) {
    const r = g.radius;
    const f = this._fx.find((x) => x.t > 1) ?? this._fx[0];
    f.t = 0; f.r = r * 0.55;
    f.ball.position.copy(pos); f.ring.position.set(pos.x, pos.y + 0.05, pos.z);
    f.ball.visible = f.ring.visible = true;
    this.p.sparkBurst(pos.x, pos.y + 0.2, pos.z, 0, 1, 0, 36);
    this.p.smokePuff(pos.x, pos.y + 0.6, pos.z, 12, 0.32, null, 2.2);
    this.p.dustPuff(pos.x, pos.y + 0.1, pos.z, 10);
    this.p.debris(pos.x, pos.y + 0.2, pos.z, [0.25, 0.22, 0.2], 10, 2.2);
    ctx.onExplode?.(pos, g);
    // hostiles
    for (const e of ctx.enemies ?? []) {
      if (!e.alive) continue;
      const ep = e.group.position;
      _d.set(ep.x - pos.x, e.chestY - pos.y, ep.z - pos.z);
      const d = _d.length();
      if (d > r) continue;
      const fall = 1 - Math.pow(d / r, 1.4);
      const n = d > 0.01 ? 1 / d : 0;
      ctx.damageEnemy?.(e, g.dmg * fall, _d.x * n, _d.z * n, g);
      e.knock.x += _d.x * n * 6 * fall;
      e.knock.z += _d.z * n * 6 * fall;
    }
    // player
    if (ctx.playerPos) {
      const pp = ctx.playerPos;
      _v.set(pp.x - pos.x, pp.y + 1 - pos.y, pp.z - pos.z);
      const d = _v.length();
      if (d < r * 1.05) {
        const fall = 1 - Math.pow(clamp(d / r, 0, 1), 1.4);
        ctx.damagePlayer?.(g.dmg * fall * (g.owner === 'player' ? 0.45 : 0.55), g);
      }
      ctx.shake?.(clamp(0.06 - d * 0.003, 0.006, 0.06));
    }
    ctx.barrels?.(pos, r, g);
  }

  clear() {
    for (let i = this.live.length - 1; i >= 0; i--) this._release(i);
    for (const f of this._fx) { f.ball.visible = f.ring.visible = false; f.t = 99; }
  }

  /** Bearings of hostile grenades near the player (HUD warning). */
  threats(pp, yaw, radius = 9) {
    const out = [];
    for (const g of this.live) {
      if (g.owner === 'player') continue;
      const dx = g.mesh.position.x - pp.x, dz = g.mesh.position.z - pp.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      out.push(Math.atan2(-dx, -dz) - yaw);
    }
    return out;
  }
}
