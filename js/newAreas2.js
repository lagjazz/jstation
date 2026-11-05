// ============================================================
// newAreas2.js — MISSIONS 10–12 worlds (spec: moremaps2.md):
//   ice       永夜极地 · 极光破冰船 (aurora dome shader, blizzard
//             point field, shootable cliff icicles, slippery ice,
//             searchlights, radar-station high ground)
//   orbit     軌道ターミナル · orbital elevator ring (instanced
//             struts/containers/railings, layered rotating Earth
//             backdrop, deadly cargo train crossing the deck)
//   canopy    世界樹の冠 · eco-dome treetops (wind vertex shader
//             instanced leaves, elevated walkways, springy leaf
//             jump pads, glowing bug point field)
// Same contract as newAreas.js: build() once at boot, every light
// stays permanently in the scene (intensity-gated — no shader
// recompile mid-mission), bounds[] feeds the containment +
// anti-stuck guards, SPAWN_POOLS registers 7 anchors per area.
// Big repeating props are InstancedMesh; animated atmospherics are
// GPU ShaderMaterials driven by a single uT uniform.
// ============================================================

import * as THREE from 'three';
import { MAT } from './materials.js';
import { addBox, cachedBox } from './build.js';
import { SPAWN_POOLS } from './enemy.js';
import { canvas, floor, walls } from './newAreas.js';
import { rand } from './utils.js';

// ---------- shared GPU helpers (reused by newAreas3.js too) ----------

// Generic drifting point field (blizzard / bugs / brass dust): one
// draw call, motion computed on the GPU from a uT uniform.
export function pointField(count, x0, x1, y0, y1, z0, z1, {
  size = 2.0, color = 0xffffff, fall = 2.5, drift = 1.0, seed = 0,
} = {}) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rand(x0, x1);
    pos[i * 3 + 1] = rand(y0, y1);
    pos[i * 3 + 2] = rand(z0, z1);
    rnd[i * 3] = Math.random();
    rnd[i * 3 + 1] = Math.random();
    rnd[i * 3 + 2] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 }, uH: { value: Math.max(1, y1 - y0) },
      uY0: { value: y0 }, uSize: { value: size },
      uColor: { value: new THREE.Color(color) }, uFall: { value: fall },
      uDrift: { value: drift }, uSeed: { value: seed },
    },
    vertexShader: /* glsl */`
      uniform float uT, uH, uY0, uSize, uFall, uDrift, uSeed;
      attribute vec3 aRnd;
      varying float vA;
      void main() {
        vec3 p = position;
        float f = uFall * (0.6 + aRnd.x * 0.8);
        float w = mod(p.y - uY0 - uT * f, uH);
        p.y = uY0 + w;
        p.x += sin(uT * (0.6 + aRnd.y) + aRnd.z * 6.28 + uSeed) * uDrift;
        p.z += cos(uT * (0.5 + aRnd.z) + aRnd.x * 6.28 + uSeed) * uDrift;
        vA = 0.35 + aRnd.y * 0.65;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (140.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float m = smoothstep(0.5, 0.1, length(d));
        if (m <= 0.01) discard;
        gl_FragColor = vec4(uColor, m * vA);
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { pts, mat };
}

// Wavy additive aurora curtain on a dome — Perlin-ish fbm in the
// fragment shader drives green→violet ribbons (moremaps2 requirement).
export function auroraMat() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uT;
      varying vec3 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1,0)), f.x),
                   mix(h(i + vec2(0,1)), h(i + vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * vn(p); p *= 2.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 q = vec2(atan(vP.z, vP.x) * 1.2, vP.y * 0.045);
        float n = fbm(q + vec2(uT * 0.12, uT * 0.05));
        float band = smoothstep(0.42, 0.62, n) * smoothstep(0.85, 0.6, n);
        float ray = fbm(vec2(q.x * 6.0 + uT * 0.3, q.y * 2.0));
        band *= 0.55 + 0.45 * ray;
        float elev = smoothstep(0.05, 0.45, normalize(vP).y);
        vec3 green = vec3(0.12, 0.9, 0.42);
        vec3 violet = vec3(0.55, 0.22, 0.85);
        vec3 col = mix(green, violet, smoothstep(0.45, 0.75, n));
        float a = band * elev * 0.85;
        gl_FragColor = vec4(col * (1.2 + band), a);
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide,
    blending: THREE.AdditiveBlending, fog: false,
  });
  return mat;
}

// ---------- programmatic equirect backgrounds for MISSIONS 10–12 ----------
export const THEME_BG2 = (() => {
  const mk = (draw) => {
    const { c, x } = canvas(1024, 512);
    draw(x);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const stars = (x, n, maxA) => {
    for (let i = 0; i < n; i++) {
      const a = rand(0.05, maxA);
      x.fillStyle = `rgba(255,255,255,${a})`;
      const s = Math.random() < 0.08 ? 2 : 1;
      x.fillRect(Math.random() * 1024, Math.random() * 480, s, s);
    }
  };
  const B = {};
  B.aurora = mk((x) => {            // polar night: stars + painted aurora ribbons
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#050810'); g.addColorStop(0.5, '#12233a'); g.addColorStop(1, '#3a5468');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    stars(x, 700, 0.9);
    for (let b = 0; b < 6; b++) {
      const y = 60 + b * 34;
      x.strokeStyle = b % 2 ? 'rgba(120,255,170,0.16)' : 'rgba(150,110,255,0.13)';
      x.lineWidth = rand(24, 56);
      x.beginPath();
      for (let px = 0; px <= 1024; px += 32) {
        const py = y + Math.sin(px * 0.012 + b * 1.7) * 40 + Math.sin(px * 0.05 + b) * 12;
        px === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.stroke();
    }
  });
  B.orbit = mk((x) => {             // deep space over the ring platform
    x.fillStyle = '#01030a'; x.fillRect(0, 0, 1024, 512);
    stars(x, 1100, 1.0);
    const g = x.createRadialGradient(200, 470, 40, 200, 470, 500);
    g.addColorStop(0, '#2a6db8'); g.addColorStop(0.3, '#123a6e');
    g.addColorStop(0.65, '#071631'); g.addColorStop(1, '#01030a');
    x.fillStyle = g; x.fillRect(0, 300, 1024, 212);
    x.fillStyle = 'rgba(180,220,255,0.10)';
    for (let i = 0; i < 60; i++) x.fillRect(rand(0, 1024), rand(320, 500), rand(40, 160), rand(2, 6));
  });
  B.canopy = mk((x) => {            // sunlight through a glass dome
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#e8f4d8'); g.addColorStop(0.4, '#9dc088');
    g.addColorStop(0.75, '#3d5a3a'); g.addColorStop(1, '#16241a');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    x.strokeStyle = 'rgba(255,255,255,0.16)'; x.lineWidth = 3;
    for (let i = -20; i < 40; i++) {          // hex-ish glass ribs
      x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64 + 180, 300); x.stroke();
      x.beginPath(); x.moveTo(i * 64 + 180, 300); x.lineTo(i * 64, 512); x.stroke();
    }
    x.fillStyle = 'rgba(255,240,180,0.9)';
    x.beginPath(); x.arc(330, 80, 46, 0, Math.PI * 2); x.fill();
  });
  B.rust = mk((x) => {              // blood-red sunset canyon
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#3a1408'); g.addColorStop(0.5, '#8a3a18');
    g.addColorStop(0.8, '#c05a22'); g.addColorStop(1, '#e07a30');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = 'rgba(255,150,60,0.9)';
    x.beginPath(); x.arc(680, 350, 60, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(60,24,10,0.55)';
    for (let i = 0; i < 26; i++) x.fillRect(rand(0, 1024), rand(380, 512), rand(30, 180), rand(4, 26));
  });
  B.aqua = mk((x) => {              // neon aquarium hall darks
    x.fillStyle = '#050810'; x.fillRect(0, 0, 1024, 512);
    stars(x, 80, 0.2);
    const cols = ['00e5ff', 'ff2b9d', '7d5cff', '22ffd0'];
    for (let i = 0; i < 22; i++) {
      x.fillStyle = `#0a1826`;
      x.fillRect(rand(0, 1024), rand(80, 460), rand(30, 200), rand(20, 120));
      x.fillStyle = `rgba(${parseInt(cols[i % 4].slice(0, 2), 16)},${parseInt(cols[i % 4].slice(2, 4), 16)},${parseInt(cols[i % 4].slice(4, 6), 16)},0.14)`;
      x.beginPath(); x.arc(Math.random() * 1024, rand(120, 420), rand(40, 130), 0, Math.PI * 2); x.fill();
    }
  });
  B.brass = mk((x) => {             // eternal-dusk clockwork sky
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#241408'); g.addColorStop(0.5, '#6a4418');
    g.addColorStop(0.85, '#a8782c'); g.addColorStop(1, '#c89a44');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = 'rgba(255,210,120,0.85)';
    x.beginPath(); x.arc(420, 260, 54, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(60,36,10,0.35)'; x.lineWidth = 10;
    for (let i = 0; i < 10; i++) {            // distant gear silhouettes
      x.beginPath(); x.arc(rand(0, 1024), rand(300, 500), rand(30, 110), 0, Math.PI * 2); x.stroke();
    }
  });
  return B;
})();

export class NewAreas2 {
  constructor(scene, world, particles) {
    this.scene = scene;
    this.groups = {};
    this.world = world;
    this.p = particles;
    this.raycastMeshes = [];
    this.updaters = [];
    this.bounds = {};
    this.icicles = [];              // ice: shootable cliff icicles
    this.bouncePads = [];           // canopy: springy leaf pads
    this.cargo = null;              // orbit: active cargo train rect
  }

  build() {
    this._ice();
    this._orbit();
    this._canopy();
  }

  update(dt) {
    for (const u of this.updaters) u(dt);
  }

  /** Shot an icicle? Detach it — game.js also crushes hostiles below. */
  dropIcicle(mesh) {
    const ic = this.icicles.find((i) => i.mesh === mesh);
    if (!ic || ic.falling) return false;
    ic.falling = true;
    ic.t = 0;
    // slide its collider out of play immediately (mutate its AABB)
    ic.col.min.set(ic.col.min.x, -3, ic.col.min.z);
    ic.col.max.set(ic.col.max.x, -1, ic.col.max.z);
    return true;
  }

  // ============ MISSION 10 · 永夜极地 · 极光破冰船 · 52 × 52 m ============

  // per-world group: each themed world toggles visibility with the active
  // mission; lights stay scene-rooted so the shader light count never changes
  _g(area) {
    let g = this.groups[area];
    if (!g) { g = new THREE.Group(); g.name = 'world:' + area; this.scene.add(g); this.groups[area] = g; }
    return g;
  }

  setVisible(area) {
    for (const k of Object.keys(this.groups)) this.groups[k].visible = (k === area);
  }
  _ice() {
    const G = this._g('ice');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 120, X1 = 172, Z0 = -60, Z1 = -8;
    this.bounds.ice = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;

    const iceFloor = new THREE.MeshStandardMaterial({
      color: 0x9fc4dd, roughness: 0.14, metalness: 0.2,
    });
    const iceWall = new THREE.MeshStandardMaterial({ color: 0x5f86a4, roughness: 0.5, metalness: 0.1 });
    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: iceFloor });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 15, mat: iceWall });

    // ---- aurora dome (GPU fbm) over the whole arena ----
    const aur = auroraMat();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(95, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), aur);
    dome.position.set(cx, -4, cz);
    G.add(dome);
    this.updaters.push((dt) => { aur.uniforms.uT.value += dt; });

    // ---- blizzard point field ----
    const snow = pointField(360, X0 + 1, X1 - 1, 0, 17, Z0 + 1, Z1 - 1,
      { size: 1.8, color: 0xeaf4ff, fall: 3.2, drift: 2.2 });
    G.add(snow.pts);
    this.updaters.push((dt) => { snow.mat.uniforms.uT.value += dt; });

    // ---- icebreaker hull (walkable deck y=5, radar superstructure) ----
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x8a2f22, roughness: 0.55, metalness: 0.5 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x3d4854, roughness: 0.4, metalness: 0.7 });
    addBox(G, { w: 26, h: 5, d: 13, mat: hullMat, x: 146, y: 2.5, z: -34, collide: world, raycast: rc, tag: 'metal' });
    addBox(G, { w: 27, h: 1.2, d: 14, mat: steelMat, x: 146, y: 5.35, z: -34, collide: world, raycast: rc, tag: 'metal' }); // deck trim, deck top = 5.95? keep simple
    // deck access ramp-steps at the stern (each step ≤1 m)
    for (let i = 1; i <= 5; i++) {
      addBox(G, { w: 5, h: i, d: 1.3, mat: steelMat, x: 146, y: i / 2, z: -40.9 + i * 1.2, collide: world, raycast: rc, tag: 'metal' });
    }
    // bridge + tower + radar platform (the hard high ground)
    addBox(G, { w: 8, h: 2.5, d: 8, mat: steelMat, x: 146, y: 7.1, z: -34, collide: world, raycast: rc, tag: 'metal' });      // bridge top 8.35
    addBox(G, { w: 5.5, h: 2.9, d: 5.5, mat: steelMat, x: 146, y: 9.8, z: -34, collide: world, raycast: rc, tag: 'metal' }); // tower top 11.25
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd7dee6, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }));
    dish.position.set(146, 11.6, -34);
    dish.rotation.x = Math.PI * 0.72;
    G.add(dish);
    this.updaters.push((dt) => { dish.rotation.z += dt * 0.9; });
    // superstructure steps (8.35 → 11.25)
    addBox(G, { w: 2.4, h: 0.4, d: 2.4, mat: steelMat, x: 150, y: 8.75, z: -30.5, collide: world, raycast: rc, tag: 'metal' }); // top 8.95
    addBox(G, { w: 2.2, h: 2.2, d: 2.2, mat: steelMat, x: 149.4, y: 10.1, z: -31.4, collide: world, raycast: rc, tag: 'metal' });// top 11.2
    // containers on the deck (cover)
    for (const [bx, bz] of [[139.5, -36.5], [152, -31.5], [140, -30.5], [151.5, -37]]) {
      addBox(G, { w: 4, h: 2, d: 2.6, mat: new THREE.MeshStandardMaterial({ color: 0xb0652a, roughness: 0.6, metalness: 0.3 }),
        x: bx, y: 6.5, z: bz, collide: world, raycast: rc, tag: 'metal' });
    }

    // ---- glacier ridges (climable sniper perches) + icicles ----
    const stepIce = new THREE.MeshStandardMaterial({ color: 0x86b3d4, roughness: 0.25, metalness: 0.15 });
    const ridge = (sx) => {
      const tops = [1.1, 2.2, 3.3, 4.4];
      for (let i = 0; i < 4; i++) {
        const w = 9 - i * 2, d = 10 - i * 2.2;
        addBox(G, { w, h: tops[i], d, mat: stepIce, x: sx + (sx > cx ? -1 : 1) * i * 1.6, y: tops[i] / 2, z: -16, collide: world, raycast: rc, tag: 'concrete' });
      }
      return tops[3];
    };
    const perchE = ridge(166), perchW = ridge(126);

    // icicles hanging off the top step of each ridge — shoot them and
    // they fall on whoever is underneath
    const icicleAt = (ix, iz, perch) => {
      const geo = new THREE.ConeGeometry(0.65, 2.8, 7);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0xbfe0f4, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92,
      }));
      m.position.set(ix, perch - 1.4, iz);
      m.rotation.x = Math.PI;
      m.castShadow = true;
      m.userData.tag = 'glass';
      m.userData.icicle = true;
      G.add(m);
      rc.push(m);
      const col = new THREE.Box3(new THREE.Vector3(ix - 0.5, perch - 2.8, iz - 0.5),
        new THREE.Vector3(ix + 0.5, perch, iz + 0.5));
      world.addBox(col.min, col.max);
      this.icicles.push({ mesh: m, col, falling: false, t: 0 });
    };
    icicleAt(160.4, -14.8, perchE);
    icicleAt(162.6, -13.2, perchE);
    icicleAt(130.9, -14.5, perchW);
    this.updaters.push((dt) => {
      for (const ic of this.icicles) {
        if (ic.falling !== true) continue;
        ic.t += dt;
        ic.mesh.position.y -= 19 * dt;
        if (ic.mesh.position.y <= 1.4) {
          ic.mesh.position.y = 1.4;
          this.p.dustPuff(ic.mesh.position.x, 0.2, ic.mesh.position.z, 8);
          this.p.sparkBurst(ic.mesh.position.x, 0.6, ic.mesh.position.z, 0, 1, 0, 10);
          ic.falling = 'done';
        }
      }
    });

    // ---- rotating searchlight beams (additive cones, no extra lights) ----
    const beam = (bx, by, bz, rot) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 16, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff0c8, transparent: true, opacity: 0.10,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide,
        }));
      cone.position.set(bx, by, bz);
      cone.rotation.z = 1.15;
      G.add(cone);
      this.updaters.push((dt) => { cone.rotation.y = rot + Math.sin(performance.now() * 0.00012 + bx) * 1.1; });
    };
    beam(124, 6, -56, 0.7);
    beam(168, 6, -10, 2.6);

    // small ice hummocks for cover
    for (const [hx, hz, s] of [[134, -50, 1.6], [160, -52, 1.2], [128, -18, 1.4], [156, -12, 1.2], [150, -48, 1.0]]) {
      const h = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), stepIce);
      h.position.set(hx, s * 0.55, hz);
      h.scale.y = 0.8;
      h.castShadow = true;
      h.userData.tag = 'concrete';
      G.add(h);
      rc.push(h);
      world.addBox(new THREE.Vector3(hx - s * 0.7, 0, hz - s * 0.7), new THREE.Vector3(hx + s * 0.7, s * 1.1, hz + s * 0.7));
    }

    // warm ship lights (permanent — gated by being far inside the scene)
    const l1 = new THREE.PointLight(0xffd9a0, 95, 48, 2); l1.position.set(146, 8, -34); scene.add(l1);
    const l2 = new THREE.PointLight(0x7fb0d0, 80, 44, 2); l2.position.set(128, 7, -50); scene.add(l2);
    const l3 = new THREE.PointLight(0xa8d8f0, 70, 46, 2); l3.position.set(164, 7, -16); scene.add(l3);

    SPAWN_POOLS.ice = [
      { pos: [126, -50], wps: [[126, -50], [136, -46], [130, -38], [124, -40]] },
      { pos: [166, -52], wps: [[166, -52], [158, -46], [164, -36]] },
      { pos: [128, -30], wps: [[128, -30], [132, -20], [126, -12], [122, -22]] },
      { pos: [162, -26], wps: [[162, -26], [166, -22], [160, -12], [156, -20]] },
      { pos: [146, -48], wps: [[146, -48], [152, -44], [140, -44]] },
      { pos: [134, -14], wps: [[134, -14], [140, -10], [130, -10]] },
      { pos: [168, -44], wps: [[168, -44], [164, -48], [166, -38]] },
    ];
  }

  // ============ MISSION 11 · 軌道ターミナル · orbital elevator ring ============

  _orbit() {
    const G = this._g('orbit');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 120, X1 = 172, Z0 = 20, Z1 = 72;
    this.bounds.orbit = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;

    // ---- deck slab (the ring platform) + invisible air walls ----
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x39414d, roughness: 0.5, metalness: 0.65 });
    addBox(G, { w: X1 - X0, h: 0.5, d: Z1 - Z0, mat: deckMat, x: cx, y: -0.25, z: cz, collide: world, raycast: rc, tag: 'metal' });
    floor(G, rc, { w: X1 - X0, d: Z1 - Z0, x: cx, z: cz, mat: deckMat, y: 0.011 });
    for (const [[ax0, ax1, az0, az1]] of [
      [[X0 - 0.3, X0 + 0.3, Z0 - 0.3, Z1 + 0.3]],
      [[X1 - 0.3, X1 + 0.3, Z0 - 0.3, Z1 + 0.3]],
      [[X0 - 0.3, X1 + 0.3, Z0 - 0.3, Z0 + 0.3]],
      [[X0 - 0.3, X1 + 0.3, Z1 - 0.3, Z1 + 0.3]],
    ]) world.addBox(new THREE.Vector3(ax0, 0, az0), new THREE.Vector3(ax1, 9, az1));

    // ---- central elevator column + cable climbing to the stars ----
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x565f6c, roughness: 0.35, metalness: 0.8 });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 42, 20), towerMat);
    col.position.set(cx, 21, cz);
    col.castShadow = true;
    col.userData.tag = 'metal';
    G.add(col);
    rc.push(col);
    world.addBox(new THREE.Vector3(cx - 5, 0, cz - 5), new THREE.Vector3(cx + 5, 42, cz + 5));
    for (const ringY of [6, 14, 22, 30, 38]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.28, 6, 24),
        new THREE.MeshStandardMaterial({ color: 0x1c222b, emissive: 0x2a6aff, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.6 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, ringY, cz);
      G.add(ring);
    }
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 260, 8), towerMat);
    cable.position.set(cx, 150, cz);
    G.add(cable);

    // ---- layered background: slow-turning Earth + cloud shell ----
    const earthTex = canvas(1024, 512);
    (() => {
      const x = earthTex.x;
      x.fillStyle = '#0a2f66'; x.fillRect(0, 0, 1024, 512);
      x.fillStyle = '#1f7a3d';
      for (let i = 0; i < 26; i++) {
        x.beginPath();
        x.ellipse(rand(0, 1024), rand(0, 512), rand(40, 190), rand(24, 90), rand(0, 3), 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = '#8a6a3a';
      for (let i = 0; i < 18; i++) {
        x.beginPath();
        x.ellipse(rand(0, 1024), rand(0, 512), rand(16, 70), rand(10, 40), rand(0, 3), 0, Math.PI * 2);
        x.fill();
      }
    })();
    const eTex = new THREE.CanvasTexture(earthTex.c);
    eTex.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 20),
      new THREE.MeshStandardMaterial({ map: eTex, roughness: 0.9, fog: false }));
    earth.position.set(cx, -340, cz);
    G.add(earth);
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(308, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, fog: false }));
    cloud.position.copy(earth.position);
    G.add(cloud);
    this.updaters.push((dt) => { earth.rotation.y += dt * 0.008; cloud.rotation.y -= dt * 0.014; });

    // ---- instanced under-deck struts, railings, containers ----
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const strutGeo = cachedBox(0.3, 6, 0.3);
    const struts = new THREE.InstancedMesh(strutGeo, towerMat, 96);
    let k = 0;
    for (let i = 0; i < 16; i++) {
      for (const [ex, ez] of [[X0 + 1 + i * (X1 - X0 - 2) / 15, Z0 + 1], [X0 + 1 + i * (X1 - X0 - 2) / 15, Z1 - 1]]) {
        p.set(ex, -3, ez); q.identity(); s.set(1, 1, 1);
        mtx.compose(p, q, s);
        struts.setMatrixAt(k++, mtx);
      }
    }
    for (let i = 0; k < 96; i++) {   // diagonal braces under the rim
      const ex = i % 2 ? X0 + 2 : X1 - 2;
      p.set(ex, -1.5, Z0 + 4 + (i % 12) * (Z1 - Z0 - 8) / 11);
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), i % 2 ? 0.6 : -0.6);
      s.set(1, 1.6, 1);
      mtx.compose(p, q, s);
      struts.setMatrixAt(k++, mtx);
    }
    struts.instanceMatrix.needsUpdate = true;
    G.add(struts);

    const postGeo = cachedBox(0.1, 1.1, 0.1);
    const posts = new THREE.InstancedMesh(postGeo, towerMat, 64);
    k = 0;
    for (let i = 0; i < 20; i++) {
      p.set(X0 + 0.6 + i * (X1 - X0 - 1.2) / 23, 0.55, Z0 + 0.6);
      mtx.compose(p, q.identity(), s.set(1, 1, 1)); posts.setMatrixAt(k, mtx); k++;
      p.set(X0 + 0.6 + i * (X1 - X0 - 1.2) / 23, 0.55, Z1 - 0.6);
      mtx.compose(p, q.identity(), s.set(1, 1, 1)); posts.setMatrixAt(k, mtx); k++;
    }
    for (let i = 0; k < 64; i++) {
      p.set(i % 2 ? X0 + 0.6 : X1 - 0.6, 0.55, Z0 + 2 + i * (Z1 - Z0 - 4) / 30);
      mtx.compose(p, q.identity(), s.set(1, 1, 1)); posts.setMatrixAt(k, mtx); k++;
    }
    posts.instanceMatrix.needsUpdate = true;
    G.add(posts);

    const contGeo = cachedBox(3, 2.6, 2.2);
    const contMat = new THREE.MeshStandardMaterial({ color: 0x6a5a2e, roughness: 0.6, metalness: 0.35 });
    const conts = new THREE.InstancedMesh(contGeo, contMat, 14);
    const contPos = [[127, 27], [133, 33], [165, 27], [160, 35], [127, 60], [133, 66], [166, 61], [161, 66], [139, 25], [152, 68], [141, 60], [155, 24], [168, 44], [124, 40]];
    contPos.forEach(([bx, bz], i) => {
      p.set(bx, 1.3, bz);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(-0.3, 0.3));
      mtx.compose(p, q, s.set(1, 1, 1));
      conts.setMatrixAt(i, mtx);
      world.addBox(new THREE.Vector3(bx - 1.5, 0, bz - 1.1), new THREE.Vector3(bx + 1.5, 2.6, bz + 1.1));
    });
    G.add(conts);
    rc.push(conts);

    // ---- cargo train that rips across the deck (hazard) ----
    const railMat = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.4, metalness: 0.8 });
    addBox(G, { w: X1 - X0 + 8, h: 0.25, d: 3.6, mat: railMat, x: cx, y: 0.14, z: 46, cast: false, raycast: rc, tag: 'metal' });
    const train = new THREE.Group();
    const carMat = new THREE.MeshStandardMaterial({ color: 0x2f3a46, roughness: 0.45, metalness: 0.7, emissive: 0x101c2a, emissiveIntensity: 0.5 });
    const cars = [];
    for (let i = 0; i < 6; i++) {
      const car = new THREE.Mesh(cachedBox(5.4, 2.6, 3.2), carMat);
      car.castShadow = true;
      car.userData.tag = 'metal';
      train.add(car);
      cars.push(car);
      rc.push(car);
    }
    train.position.set(X0 - 40, 1.5, 46);
    G.add(train);
    const TR = { t: 4, period: 16, speed: 34, active: false };
    this.updaters.push((dt) => {
      TR.t += dt;
      if (!TR.active && TR.t > TR.period) { TR.active = true; TR.x = X0 - 30; }
      if (TR.active) {
        TR.x += TR.speed * dt;
        train.position.x = TR.x;
        cars.forEach((c, i) => { c.position.x = -i * 6; });
        if (TR.x > X1 + 40) {
          TR.active = false; TR.t = 0;
          train.position.x = X0 - 40;
        }
        this.cargo = TR.active
          ? { x0: TR.x - 34, x1: TR.x + 3, z0: 43.6, z1: 48.4, top: 2.8, dir: 1 }
          : null;
      } else this.cargo = null;
    });

    const l1 = new THREE.PointLight(0xbcd4ff, 60, 48, 2); l1.position.set(cx, 7, cz); scene.add(l1);

    SPAWN_POOLS.orbit = [
      { pos: [128, 26], wps: [[128, 26], [136, 24], [133, 31]] },
      { pos: [166, 26], wps: [[166, 26], [158, 24], [162, 31]] },
      { pos: [128, 66], wps: [[128, 66], [136, 68], [133, 60]] },
      { pos: [166, 66], wps: [[166, 66], [158, 68], [162, 60]] },
      { pos: [146, 64], wps: [[146, 64], [152, 60], [140, 60]] },
      { pos: [168, 36], wps: [[168, 36], [166, 30], [160, 30]] },
      { pos: [168, 56], wps: [[168, 56], [166, 62], [160, 60]] },
    ];
  }

  // ============ MISSION 12 · 世界樹の冠 · eco-dome canopy ============

  _canopy() {
    const G = this._g('canopy');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -240, X1 = -188, Z0 = -40, Z1 = 12;
    this.bounds.canopy = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;

    // dark forest floor below (the fight lives on the treetops)
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x22301d, roughness: 0.95 });
    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: dirtMat });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 18, mat: new THREE.MeshStandardMaterial({ color: 0x2e4630, roughness: 0.9 }) });

    // glass dome hint overhead (transparent shell, no collision)
    const shell = new THREE.Mesh(new THREE.SphereGeometry(64, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshBasicMaterial({ color: 0xaaddbb, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false, fog: true }));
    shell.position.set(cx, -2, cz);
    G.add(shell);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3623, roughness: 0.85 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b5334, roughness: 0.75 });

    // ---- giant trunks ----
    const trunkAt = (tx, tz, r = 1.5, h = 16) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 10), woodMat);
      t.position.set(tx, h / 2, tz);
      t.castShadow = true;
      t.userData.tag = 'wood';
      G.add(t);
      rc.push(t);
      world.addBox(new THREE.Vector3(tx - r, 0, tz - r), new THREE.Vector3(tx + r, h, tz + r));
      return t;
    };
    for (const [tx, tz] of [[-230, -22], [-198, -24], [-214, -14], [-228, 2], [-199, 4], [-214, -34]]) trunkAt(tx, tz);

    // ---- elevated walkways at y=6 (walkable deck colliders) ----
    const walk = (x0, x1, z0, z1) => {
      addBox(G, { w: x1 - x0, h: 0.4, d: z1 - z0, mat: deckMat,
        x: (x0 + x1) / 2, y: 5.8, z: (z0 + z1) / 2, collide: world, raycast: rc, tag: 'wood' });
    };
    walk(-234, -194, -16, -12);      // east-west bridge
    walk(-216, -212, -36, 8);        // north-south bridge
    walk(-220, -208, -18, -10);      // central platform
    // railings on the bridges (visual + low collide)
    for (const [rx0, rx1, rz0, rz1] of [[-234, -194, -16.2, -15.8], [-234, -194, -12.2, -11.8], [-216.2, -215.8, -36, 8], [-212.2, -211.8, -36, 8]]) {
      addBox(G, { w: rx1 - rx0, h: 1, d: rz1 - rz0, mat: new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.8 }),
        x: (rx0 + rx1) / 2, y: 6.5, z: (rz0 + rz1) / 2, collide: world, raycast: rc, tag: 'wood' });
    }
    // stair tower up to the N-S bridge, kept clear of the spawn sightline (top 6.0)
    for (let i = 1; i <= 6; i++) {
      addBox(G, { w: 1.2, h: i, d: 3, mat: woodMat, x: -220.2 + i * 1, y: i / 2, z: -30, collide: world, raycast: rc, tag: 'wood' });
    }

    // ---- springy leaf pads: step on, get launched up to the bridges ----
    const leafPad = (lx, lz) => {
      const ly = 1.0;
      const pad = new THREE.Mesh(cachedBox(2.8, 0.35, 2.8),
        new THREE.MeshStandardMaterial({ color: 0x3f8f4a, emissive: 0x1f6f2a, emissiveIntensity: 0.7, roughness: 0.5 }));
      pad.position.set(lx, ly, lz);
      pad.rotation.y = rand(0, 1.5);
      pad.castShadow = true;
      pad.userData.tag = 'wood';
      G.add(pad);
      rc.push(pad);
      world.addBox(new THREE.Vector3(lx - 1.3, ly - 0.18, lz - 1.3), new THREE.Vector3(lx + 1.3, ly + 0.18, lz + 1.3));
      this.bouncePads.push({ x: lx, z: lz, r: 1.7, top: ly + 0.18, power: 15.2 });
    };
    leafPad(-227, -24);
    leafPad(-201, -24);
    leafPad(-203, 2);

    // ---- instanced wind-swaying leaf canopy (vertex shader) ----
    const leafGeo = new THREE.PlaneGeometry(2.4, 2.4);
    const leafMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uSun: { value: new THREE.Color(0x86c86a) }, uDark: { value: new THREE.Color(0x27401f) } },
      vertexShader: /* glsl */`
        uniform float uT;
        varying float vSh;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          float sw = sin(uT * 1.6 + wp.x * 0.4 + wp.z * 0.55) * 0.22 +
                     sin(uT * 2.7 + wp.z * 0.9) * 0.1;
          wp.x += sw; wp.z += sw * 0.6; wp.y += sin(uT * 2.2 + wp.x) * 0.06;
          vSh = 0.55 + 0.45 * dot(normalize(mat3(instanceMatrix) * normal), normalize(vec3(0.4, 0.8, 0.3)));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun, uDark;
        varying float vSh;
        varying vec2 vUv;
        void main() {
          float rad = length(vUv - 0.5);
          if (rad > 0.5) discard;
          gl_FragColor = vec4(mix(uDark, uSun, vSh), 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 130);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < 130; i++) {
      const px = rand(X0 + 4, X1 - 4), pz = rand(Z0 + 4, Z1 - 4), py = rand(11.5, 15.5);
      e.set(rand(-0.5, 0.5), rand(0, 6.28), rand(-0.4, 0.4));
      q.setFromEuler(e);
      const sc = rand(0.8, 1.7);
      mtx.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sc, sc, 1));
      leaves.setMatrixAt(i, mtx);
    }
    leaves.instanceMatrix.needsUpdate = true;
    G.add(leaves);
    this.updaters.push((dt) => { leafMat.uniforms.uT.value += dt; });

    // ---- glowing mechanical bugs ----
    const bugs = pointField(70, X0 + 3, X1 - 3, 3, 13, Z0 + 3, Z1 - 3,
      { size: 2.6, color: 0xaef27a, fall: -0.6, drift: 2.6, seed: 2 });
    G.add(bugs.pts);
    this.updaters.push((dt) => { bugs.mat.uniforms.uT.value += dt; });

    const l1 = new THREE.PointLight(0xbfe8a0, 55, 44, 2); l1.position.set(cx, 9, cz); scene.add(l1);
    const l2 = new THREE.PointLight(0x9ac8ff, 40, 36, 2); l2.position.set(-228, 7, 4); scene.add(l2);

    SPAWN_POOLS.canopy = [
      { pos: [-230, -14], wps: [[-230, -14], [-224, -13], [-227, -15.5]] },
      { pos: [-198, -14], wps: [[-198, -14], [-204, -13], [-200, -15.5]] },
      { pos: [-214, -32], wps: [[-214, -32], [-213, -26], [-215, -22]] },
      { pos: [-214, 4], wps: [[-214, 4], [-213, -2], [-215, -6]] },
      { pos: [-228, -30], wps: [[-228, -30], [-222, -26], [-230, -22]] },
      { pos: [-196, -32], wps: [[-196, -32], [-202, -28], [-194, -24]] },
      { pos: [-200, 0], wps: [[-200, 0], [-206, 3], [-196, 6]] },
    ];
  }
}
