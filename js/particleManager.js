// ============================================================
// particleManager.js — pooled GPU point-sprite particles.
// Each kind is ONE THREE.Points + BufferGeometry + ShaderMaterial
// (never a Mesh per particle). Swap-remove compaction keeps the
// active range contiguous. Also contains the bullet-decal pool and
// the enemy tracer pool (small pooled Mesh sets).
// ============================================================

import * as THREE from 'three';
import { TEX } from './textures.js';
import { rand, randPick, clamp } from './utils.js';

const VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3  aColor;
attribute float aRot;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.08), 1.0, 460.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float s = sin(vRot), c = cos(vRot);
  uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
  vec4 t = texture2D(uMap, uv);
  float a = t.a * vAlpha;
  if (a < 0.012) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

export class ParticleSystem {
  constructor(scene, { capacity, texture, additive = false }) {
    this.capacity = capacity;
    this.count = 0;
    this.time = 0;
    this.respawnBox = null;     // {x,z,hx,hz,y0,y1} → falling-loop fields (sakura)

    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.sway = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 300);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uScale: { value: 500 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(p) {
    if (this.count >= this.capacity) return;
    const i = this.count++, i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx ?? 0; this.vel[i3 + 1] = p.vy ?? 0; this.vel[i3 + 2] = p.vz ?? 0;
    const c = p.color ?? [1, 1, 1];
    this.col[i3] = c[0]; this.col[i3 + 1] = c[1]; this.col[i3 + 2] = c[2];
    this.size[i] = p.size ?? 0.05;
    this.baseAlpha[i] = p.alpha ?? 1;
    this.alpha[i] = this.baseAlpha[i];
    this.rot[i] = p.rot ?? rand(0, Math.PI * 2);
    this.spin[i] = p.spin ?? 0;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.life[i] = p.life ?? 1;
    this.maxLife[i] = this.life[i];
    this.grow[i] = p.grow ?? 0;
    this.phase[i] = p.phase ?? rand(0, Math.PI * 2);
    this.sway[i] = p.sway ?? 0;
  }

  _swap(i, j) {
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[j3 + k];
      this.col[i3 + k] = this.col[j3 + k];
      this.vel[i3 + k] = this.vel[j3 + k];
    }
    this.size[i] = this.size[j];
    this.alpha[i] = this.alpha[j];
    this.baseAlpha[i] = this.baseAlpha[j];
    this.rot[i] = this.rot[j];
    this.spin[i] = this.spin[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.grow[i] = this.grow[j];
    this.phase[i] = this.phase[j];
    this.sway[i] = this.sway[j];
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._swap(i, this.count - 1);
        this.count--;
        continue;
      }
      const i3 = i * 3;
      // forces
      this.vel[i3 + 1] -= this.grav[i] * dt;
      if (this.sway[i] > 0) {
        const ph = this.phase[i];
        this.vel[i3] += Math.sin(t * 1.1 + ph) * this.sway[i] * dt;
        this.vel[i3 + 2] += Math.cos(t * 0.83 + ph * 1.7) * this.sway[i] * 0.7 * dt;
      }
      if (this.drag[i] > 0) {
        const f = Math.exp(-this.drag[i] * dt);
        this.vel[i3] *= f; this.vel[i3 + 1] *= f; this.vel[i3 + 2] *= f;
      }
      // integrate
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      if (this.grow[i] !== 0) this.size[i] = Math.max(0.001, this.size[i] + this.grow[i] * dt);

      // infinite field: recycle particles that leave the box through either
      // end — bottom (falling petals) or top (rising hall motes)
      const rb = this.respawnBox;
      if (rb) {
        const y = this.pos[i3 + 1];
        if (y < rb.y0 || y > rb.y1) {
          this.pos[i3] = rb.x + rand(-rb.hx, rb.hx);
          this.pos[i3 + 1] = y < rb.y0
            ? rand(rb.y0 + (rb.y1 - rb.y0) * 0.6, rb.y1)   // fell out → back to top
            : rand(rb.y0, rb.y0 + (rb.y1 - rb.y0) * 0.4);  // rose out → back to floor
          this.pos[i3 + 2] = rb.z + rand(-rb.hz, rb.hz);
          this.life[i] = this.maxLife[i];
        }
      }

      // alpha curve
      const lf = clamp(this.life[i] / this.maxLife[i], 0, 1);
      this.alpha[i] = this.baseAlpha[i] * (lf < 0.25 ? lf / 0.25 : 1);

      i++;
    }

    this.geo.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aRot.needsUpdate = true;
    }
  }

  setViewScale(s) { this.material.uniforms.uScale.value = s; }
}

// ------------------------------------------------------------

class DecalPool {
  constructor(scene, count) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.pool = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: TEX.bulletHole, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push({ mesh: m, life: 0, maxLife: 0, size: 0.1 });
    }
    this.cursor = 0;
  }

  spawn(point, normal, size = 0.11) {
    const d = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    d.mesh.position.copy(point).addScaledVector(normal, 0.012);
    d.mesh.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    d.mesh.rotateZ(rand(0, Math.PI * 2));
    const s = size * rand(0.75, 1.3);
    d.mesh.scale.setScalar(s);
    d.size = s;
    d.maxLife = rand(18, 26);
    d.life = d.maxLife;
    d.mesh.visible = true;
    d.mesh.material.opacity = 0.95;
  }

  update(dt) {
    for (const d of this.pool) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      if (d.life < 3) d.mesh.material.opacity = 0.95 * (d.life / 3);
    }
  }
}

class TracerPool {
  constructor(scene, count = 14) {
    this.geo = new THREE.BoxGeometry(0.016, 0.016, 1);
    this.pool = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.2, 1.6, 0.7), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push({ mesh: m, life: 0 });
    }
    this.cursor = 0;
    this._dir = new THREE.Vector3();
  }

  spawn(from, to) {
    const t = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    const { mesh } = t;
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    this._dir.subVectors(to, from);
    const len = this._dir.length();
    mesh.scale.set(1, 1, Math.max(len, 0.1));
    mesh.lookAt(to);
    mesh.visible = true;
    mesh.material.opacity = 0.9;
    t.life = 0.07;
  }

  update(dt) {
    for (const t of this.pool) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }
}

// ------------------------------------------------------------

export class ParticleManager {
  constructor(scene, particleScale = 1) {
    const s = (n) => Math.max(24, Math.round(n * particleScale));
    this.sparks = new ParticleSystem(scene, { capacity: s(1400), texture: TEX.spark, additive: true });
    this.smoke = new ParticleSystem(scene, { capacity: s(700), texture: TEX.smoke });
    this.dust = new ParticleSystem(scene, { capacity: s(700), texture: TEX.dust });
    this.debrisSys = new ParticleSystem(scene, { capacity: s(900), texture: TEX.spark });
    this.glass = new ParticleSystem(scene, { capacity: s(420), texture: TEX.shard });
    this.bubbles = new ParticleSystem(scene, { capacity: s(500), texture: TEX.smoke, additive: true });
    this.systems = [this.sparks, this.smoke, this.dust, this.debrisSys, this.glass, this.bubbles];

    this.decals = new DecalPool(scene, Math.max(24, Math.round(80 * particleScale)));
    this.tracers = new TracerPool(scene);

    this._n = Math.max(1, Math.round(particleScale));
  }

  setViewScale(s) { for (const ps of this.systems) ps.setViewScale(s); }

  sparkBurst(x, y, z, nx, ny, nz, count = 12) {
    const c = Math.min(this._n * count, 40);
    for (let i = 0; i < c; i++) {
      const sp = rand(1.6, 6.5);
      this.sparks.spawn({
        x, y, z,
        vx: (nx + rand(-0.9, 0.9)) * sp, vy: (ny + rand(-0.3, 1.0)) * sp, vz: (nz + rand(-0.9, 0.9)) * sp,
        size: rand(0.015, 0.045), color: [1, rand(0.55, 0.85), rand(0.15, 0.35)],
        alpha: 1, life: rand(0.18, 0.55), gravity: 9, drag: 1.4,
      });
    }
  }

  smokePuff(x, y, z, count = 2, tint = 0.55, dir = null, speed = 0.5) {
    for (let i = 0; i < Math.min(this._n * count, 10); i++) {
      this.smoke.spawn({
        x: x + rand(-0.03, 0.03), y: y + rand(-0.03, 0.03), z: z + rand(-0.03, 0.03),
        vx: (dir ? dir.x * speed : 0) + rand(-0.2, 0.2),
        vy: (dir ? dir.y * speed : 0) + rand(0.15, 0.55),
        vz: (dir ? dir.z * speed : 0) + rand(-0.2, 0.2),
        size: rand(0.06, 0.14), color: [tint, tint, tint * 1.05],
        alpha: rand(0.14, 0.3), life: rand(0.7, 1.6), grow: 0.28, drag: 1.1,
      });
    }
  }

  dustPuff(x, y, z, count = 4) {
    for (let i = 0; i < Math.min(this._n * count, 14); i++) {
      this.dust.spawn({
        x: x + rand(-0.05, 0.05), y: y + rand(-0.05, 0.05), z: z + rand(-0.05, 0.05),
        vx: rand(-0.6, 0.6), vy: rand(0.1, 0.7), vz: rand(-0.6, 0.6),
        size: rand(0.07, 0.16), color: [0.62, 0.6, 0.55],
        alpha: rand(0.16, 0.32), life: rand(0.6, 1.3), grow: 0.2, drag: 1.3,
      });
    }
  }

  debris(x, y, z, color, count = 4, upBias = 1) {
    for (let i = 0; i < Math.min(this._n * count, 16); i++) {
      this.debrisSys.spawn({
        x, y, z,
        vx: rand(-3, 3), vy: rand(0.5, 4) * upBias, vz: rand(-3, 3),
        size: rand(0.02, 0.05), color, alpha: 1,
        life: rand(0.5, 1.3), gravity: 13, drag: 0.25, spin: rand(-9, 9),
      });
    }
  }

  glassBurst(x, y, z, count = 9) {
    for (let i = 0; i < Math.min(this._n * count, 18); i++) {
      this.glass.spawn({
        x, y, z,
        vx: rand(-2.4, 2.4), vy: rand(0.4, 3.2), vz: rand(-2.4, 2.4),
        size: rand(0.04, 0.1), color: [rand(0.7, 0.95), rand(0.85, 1), 1],
        alpha: 1, life: rand(0.5, 1.15), gravity: 11, drag: 0.15, spin: rand(-12, 12),
      });
    }
  }

  muzzleSmoke(x, y, z, dx, dy, dz) {
    this.smokePuff(x, y, z, 2, 0.5, { x: dx, y: dy, z: dz }, 1.6);
  }

  // Underwater flavour: rising bubble clusters (muzzle blast, impacts, vents).
  bubblePuff(x, y, z, count = 6) {
    for (let i = 0; i < Math.min(this._n * count, 20); i++) {
      this.bubbles.spawn({
        x: x + rand(-0.08, 0.08), y: y + rand(-0.08, 0.08), z: z + rand(-0.08, 0.08),
        vx: rand(-0.25, 0.25), vy: rand(0.6, 1.5), vz: rand(-0.25, 0.25),
        size: rand(0.03, 0.07), color: [0.72, 0.9, 1],
        alpha: rand(0.4, 0.7), life: rand(1.2, 2.4), grow: 0.012, drag: 0.3, gravity: -0.6,
      });
    }
  }

  shellCasing(x, y, z, rx, ry, rz) {
    this.debris(x, y, z, [0.95, 0.75, 0.3], 1, 1.2);
    const ps = this.debrisSys;
    const j = ps.count - 1;
    if (j >= 0) {
      ps.vel[j * 3] = rx * rand(1.5, 2.6) + rand(-0.3, 0.3);
      ps.vel[j * 3 + 1] = ry + rand(1.6, 2.6);
      ps.vel[j * 3 + 2] = rz * rand(1.5, 2.6) + rand(-0.3, 0.3);
    }
  }

  /** Full impact response based on material tag. Returns true if decal placed. */
  impact(tag, x, y, z, nx, ny, nz) {
    const n = { x: nx, y: ny, z: nz };
    switch (tag) {
      case 'metal':
        this.sparkBurst(x, y, z, nx, ny, nz, 14);
        this.smokePuff(x, y, z, 1, 0.45, n, 0.7);
        this.debris(x, y, z, [0.4, 0.42, 0.45], 2);
        return true;
      case 'glass':
        this.glassBurst(x, y, z, 9);
        this.smokePuff(x, y, z, 1, 0.7, n, 0.5);
        return false;
      case 'wood':
        this.debris(x, y, z, [0.45, 0.3, 0.16], 6);
        this.dustPuff(x, y, z, 1);
        return true;
      case 'flesh':
        this.smokePuff(x, y, z, 2, 0.42);
        this.sparkBurst(x, y, z, nx, ny, nz, 4);
        return false;
      default: // concrete / stone
        this.dustPuff(x, y, z, 5);
        this.debris(x, y, z, [0.52, 0.52, 0.55], 3);
        this.smokePuff(x, y, z, 1, 0.5);
        return true;
    }
  }

  addDecal(point, normal) { this.decals.spawn(point, normal); }

  addTracer(from, to) { this.tracers.spawn(from, to); }

  update(dt) {
    for (const ps of this.systems) ps.update(dt);
    this.decals.update(dt);
    this.tracers.update(dt);
  }

  get active() {
    return this.systems.reduce((a, ps) => a + ps.count, 0);
  }
}
