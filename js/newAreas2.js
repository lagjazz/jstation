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
import { ChunkGrid, lodNode, bboxProxy, splatShader } from './mapChunks.js';
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
    this.grids = {};                // per-area ChunkGrid (chunk-based visibility)
    this._vd = {};
  }

  build() {
    this._ice();
    this._orbit();
    this._canopy();
  }

  // ---- chunk plumbing (see mapChunks.js) ----
  _grid(area, { x0, z0, x1, z1 }, cell = 17) {
    const g = new ChunkGrid(this._g(area), x0, z0, x1, z1, cell);
    this.grids[area] = g;
    return g;
  }
  _cell(area, x, z) { const g = this.grids[area]; return g ? g.at(x, z) : this._g(area); }
  _core(area) { const g = this.grids[area]; return g ? g.core : this._g(area); }
  setViewDist(area, vd) { this._vd[area] = vd; }

  update(dt, ctx) {
    for (const u of this.updaters) u(dt);
    if (ctx && ctx.feet) {
      for (const [a, g] of Object.entries(this.grids)) {
        if (this.groups[a] && this.groups[a].visible) g.update(ctx.feet.x, ctx.feet.z, this._vd[a] ?? 150);
      }
    }
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

  // ============ MISSION 10 · 永夜极地 · 极光破冰船 · 76 × 52 m ============

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

  // THREE ZONES (moremaps2 §1): the 36 m icebreaker on the frozen sea
  // (bulkhead rooms below, bridge + radar mast above), glacier cliff
  // ridges north and south with shootable icicles overhanging the yard,
  // and the splat-mapped frozen sea itself, swept by two searchlights.
  _ice() {
    const G = this._g('ice');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 116, X1 = 192, Z0 = -60, Z1 = -8;
    this.bounds.ice = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('ice', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 19);
    const core = this._core('ice');
    const cell = (x, z) => this._cell('ice', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const put = (im, i, px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };

    // ---- frozen sea: 3-way terrain splat (snow base, ice + bare rock
    // blended by world-space value noise — moremaps2's texture splatting)
    const splatTex = (base, spec) => {
      const { c, x } = canvas(512, 512);
      x.fillStyle = base; x.fillRect(0, 0, 512, 512);
      for (let i = 0; i < spec.n; i++) {
        x.fillStyle = `rgba(${spec.cols[i % spec.cols.length]},${0.14 + Math.random() * 0.2})`;
        x.fillRect(rand(0, 500), rand(0, 500), rand(6, 60), rand(3, 30));
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const seaMat = new THREE.MeshStandardMaterial({ color: 0x7e94a6, roughness: 0.85, metalness: 0.05 });
    splatShader(seaMat,
      splatTex('#a8cfe8', { n: 90, cols: ['220,244,255', '120,170,210'] }),
      splatTex('#5c646c', { n: 70, cols: ['40,44,50', '96,104,112'] }),
      { n: 0.09, e: 0.3 });
    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: seaMat });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 16,
      mat: new THREE.MeshStandardMaterial({ color: 0x51708a, roughness: 0.6, metalness: 0.05 }) });

    // ---- aurora dome (GPU fbm) over the whole sky (core group) ----
    const aur = auroraMat();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(130, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), aur);
    dome.position.set(cx, -10, cz);
    core.add(dome);
    this.updaters.push((dt) => { aur.uniforms.uT.value += dt; });

    // ---- blizzard point field sweeping the yard ----
    const snow = pointField(160, X0 + 1, X1 - 1, 0, 18, Z0 + 1, Z1 - 1,
      { size: 1.0, color: 0xeaf4ff, fall: 3.2, drift: 2.8, seed: 5 });
    core.add(snow.pts);
    this.updaters.push((dt) => { snow.mat.uniforms.uT.value += dt; });

    // ---- GLACIER CLIFF RIDGES: instanced faceted chunks to 20 m on the
    // north and south edges; one mass AABB per ridge keeps the player out,
    // bullets stop at the chunk faces themselves.
    // audit: ice read one value step too dark and too uniform against the
    // night — one step brighter, wider scale/rotation spread per chunk.
    const iceRock = new THREE.MeshStandardMaterial({ color: 0x9cc0de, roughness: 0.3, metalness: 0.08, flatShading: true });
    const chunks = new THREE.InstancedMesh(cachedBox(1, 1, 1), iceRock, 48);
    let ci = 0;
    const ridgeRun = (north) => {
      const zWall = north ? Z0 : Z1;                   // chunks pack between wall and face
      for (let bx = X0 + 2.5; bx < X1 - 1; bx += 4.9) {
        const w = rand(3.6, 8.6), h = rand(6, 22), d = rand(3.8, 6.4);
        const zc = north ? zWall + d / 2 + rand(0, 6 - Math.min(d, 6)) : zWall - d / 2 - rand(0, 6 - Math.min(d, 6));
        e.set(0, rand(-0.55, 0.55), 0); q.setFromEuler(e);
        mtx.compose(v.set(bx + rand(-1.2, 1.2), h / 2, zc), q, s.set(w, h, d));
        chunks.setMatrixAt(ci++, mtx);
      }
      const sz = north ? -51 : -15;                    // icicle shelf jutting 1.5 m past the face
      for (const ox of north ? [124, 140, 156, 172] : [132, 149, 165]) {
        e.set(0, rand(-0.1, 0.1), 0); q.setFromEuler(e);
        mtx.compose(v.set(ox, 6.2, sz), q, s.set(6, 3.2, 3.2));
        chunks.setMatrixAt(ci++, mtx);
      }
    };
    ridgeRun(true);                                    // north ridge, face at z=-52
    ridgeRun(false);                                   // south ridge, face at z=-16
    chunks.count = ci;
    chunks.frustumCulled = false;
    core.add(chunks); rc.push(chunks);
    world.addBox(new THREE.Vector3(X0, 0, Z0), new THREE.Vector3(X1, 20, -52));
    world.addBox(new THREE.Vector3(X0, 0, -16), new THREE.Vector3(X1, 20, Z1));

    // distant ice ranges beyond the walls (hi chunk clusters + bbox proxies)
    for (const [gx, gz] of [[cx - 100, cz - 78], [cx + 108, cz + 70], [X1 + 72, cz - 60], [X0 - 66, cz + 52]]) {
      const hi = new THREE.Group();
      const im = new THREE.InstancedMesh(cachedBox(1, 1, 1), iceRock, 9);
      for (let i = 0; i < 9; i++) {
        const w = rand(6, 12), h = rand(9, 19), d = rand(6, 12);
        e.set(0, rand(0, 3), 0); q.setFromEuler(e);
        mtx.compose(v.set(gx + rand(-18, 18), h / 2, gz + rand(-18, 18)), q, s.set(w, h, d));
        im.setMatrixAt(i, mtx);
      }
      hi.add(im);
      core.add(lodNode(hi, bboxProxy(hi, 0x5a7f9c), 55));
    }

    // ---- THE ICEBREAKER (36 m along X, bow east) ----
    // audit read ONE flat maroon plane on black sky: hull is two-tone now —
    // near-white boot-top band along the deck line + a dark ice-belt at the
    // waterline, and the whole superstructure rides a lighter steel so the
    // ship's profile cuts out of the night instead of dissolving into it.
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xb04028, roughness: 0.55, metalness: 0.5, emissive: 0x4a180a, emissiveIntensity: 0.7 });
    // audit r14: near-white bands bloomed into the aurora. Upper band drops
    // a full value step; the superstructure gets a near-black ROOF CAP so
    // the top outline cuts a dark line against the bright sky.
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x8d867c, roughness: 0.5, metalness: 0.35 });
    const roofCapMat = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.8, metalness: 0.3 });
    const iceBeltMat = new THREE.MeshStandardMaterial({ color: 0x100c0a, roughness: 0.85, metalness: 0.2 });
    // audit r14b: superMat one step darker + half its glow: white-on-aurora
    // dissolved the top edge; a smoky steel cabin keeps value separation
    // from the green glow while the window bands stay the warm cue.
    const superMat = new THREE.MeshStandardMaterial({ color: 0xa9b4c2, roughness: 0.45, metalness: 0.5, emissive: 0x44556b, emissiveIntensity: 1.1 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x3d4854, roughness: 0.4, metalness: 0.7 });
    const deckTop = 5.0;
    // hull sides / stern / stepped bow (walkable main deck on top)
    for (const [w, d, px, pz] of [
      [36, 1.4, 155, -39.3], [36, 1.4, 155, -28.7],
      [2, 11.4, 135, -34],
      [3, 8.8, 173.5, -34], [2.6, 5.4, 176.3, -34], [1.4, 2.2, 178.3, -34],
    ]) addBox(cell(px, pz), { w, h: 5, d, mat: hullMat, x: px, y: 2.5, z: pz, collide: world, raycast: rc, tag: 'metal' });
    // interior deckplate (steel underfoot instead of sea ice)
    addBox(cell(154, -34), { w: 36, h: 0.12, d: 10.6, mat: steelMat, x: 154, y: -0.04, z: -34, cast: false, raycast: rc, tag: 'metal' });
    // paint bands on the hull flanks (decor skin over the solid sides):
    // bright 1.5 m shear stripe up top, black ice-belt low — the side
    // profile parses as a ship from every yard angle
    for (const [w, d, px, pz] of [
      [36.4, 0.32, 155, -40.1], [36.4, 0.32, 155, -27.9],
      [0.32, 11.6, 133.9, -34],
    ]) {
      addBox(cell(px, pz), { w, h: 2.0, d, mat: bandMat, x: px, y: 4.0, z: pz, collide: world, raycast: rc, tag: 'metal' });
      addBox(cell(px, pz), { w, h: 1.1, d: d + 0.04, mat: iceBeltMat, x: px, y: 0.75, z: pz, collide: world, raycast: rc, tag: 'metal' });
    }
    // main deck: split around the stern stairway hatch at x 135..137, z -35..-32.7
    for (const [w, d, px, pz] of [
      [36.5, 13.4, 155.25, -34], [2, 5.7, 136, -37.85], [2, 5.4, 136, -30],
    ]) addBox(cell(px, pz), { w, h: 0.4, d, mat: steelMat, x: px, y: deckTop - 0.2, z: pz, collide: world, raycast: rc, tag: 'metal' });
    // lower interior: two bulkheads with 1.8 m door gaps = three CQB rooms
    for (const [d, pz2, bx] of [
      [5, -37.5, 146], [5.2, -30.4, 146],
      [3.5, -38.25, 157], [5.8, -30.1, 157],
    ]) addBox(cell(bx, pz2), { w: 0.5, h: 4.6, d, mat: hullMat, x: bx, y: 2.3, z: pz2, collide: world, raycast: rc, tag: 'metal' });
    // room props: consoles with glowing panels + supply crates
    for (const [px, pz, ry] of [[142, -38.5, 0.1], [151, -29.5, -0.2], [166, -38.2, 0.15]]) {
      addBox(cell(px, pz), { w: 2.2, h: 1.2, d: 0.7, mat: steelMat, x: px, y: 0.6, z: pz, rotY: ry, collide: world, raycast: rc, tag: 'metal' });
      const panel = new THREE.Mesh(cachedBox(1.7, 0.5, 0.06), MAT.led(0x7fb8e8, 1.7));
      panel.position.set(px, 1.45, pz + (pz < -34 ? 0.36 : -0.36));
      panel.rotation.y = ry;
      cell(px, pz).add(panel);
    }
    for (const [px, pz] of [[143, -31.5], [152.5, -38], [164, -30.5]])
      addBox(cell(px, pz), { w: 1.3, h: 1.1, d: 1.3, mat: MAT.wood, x: px, y: 0.55, z: pz, collide: world, raycast: rc, tag: 'wood' });
    // stern stairway: 11 stacked 0.45 m steps through the stern door and hatch
    for (let i = 1; i <= 11; i++)
      addBox(cell(128.8 + i * 0.6, -33.9), { w: 0.6, h: i * 0.45, d: 1.6, mat: steelMat,
        x: 128.8 + i * 0.6, y: i * 0.225, z: -33.9, collide: world, raycast: rc, tag: 'metal' });
    // bridge block + lit window bands — superMat is a full value step up
    // from the maroon hull so the bridge reads against sky and deck alike
    addBox(cell(155, -34), { w: 12, h: 3.2, d: 9, mat: superMat, x: 155, y: 6.6, z: -34, collide: world, raycast: rc, tag: 'metal' });
    for (const [w, d, px, pz, ry] of [
      [10, 0.08, 155, -29.46, 0], [10, 0.08, 155, -38.54, Math.PI],
      [7, 0.08, 161.04, -34, Math.PI / 2], [7, 0.08, 148.96, -34, -Math.PI / 2],
    ]) {
      // split into 5 window panes with dark mullions: a single long LED bar
      // blooms into a featureless white stripe (audit) — panes keep detail
      const panes = 5;
      for (let wi = 0; wi < panes; wi++) {
        const frac = (wi + 0.5) / panes - 0.5;
        const band = new THREE.Mesh(cachedBox(w * 0.7 / panes, 0.9, d), MAT.led(0xffd9a0, 0.6));
        band.position.set(px + Math.cos(ry) * w * frac, 7.2, pz - Math.sin(ry) * w * frac);
        band.rotation.y = ry;
        cell(px, pz).add(band);
      }
    }
    // bridge accommodation wings: two bright side blocks widen the white
    // superstructure mass so the profile reads as a ship at a glance
    for (const [wx2, wz2] of [[147.5, -34], [162.5, -34]])
      addBox(cell(wx2, wz2), { w: 3, h: 2.6, d: 8, mat: superMat, x: wx2, y: 6.3, z: wz2, collide: world, raycast: rc, tag: 'metal' });
    // bridge roof caps (audit r14): near-black caps on every superstructure
    // top so the ship's upper outline is a DARK line against the aurora
    for (const [w, h, d, px, py, pz] of [
      [12.6, 0.3, 9.6, 155, 8.35, -34], [3.5, 0.3, 8.4, 147.5, 7.75, -34], [3.5, 0.3, 8.4, 162.5, 7.75, -34],
      [9.4, 0.3, 7.4, 155, 9.2, -34.5], [3.3, 0.3, 3.3, 144.5, 8.55, -34], [4.5, 0.25, 12.9, 171.5, 8.77, -34],
    ]) addBox(cell(px, pz), { w, h, d, mat: roofCapMat, x: px, y: py, z: pz, collide: world, raycast: rc, tag: 'metal' });
    // radar mast: step-up tower block + high platform (marksman perch, y=9.05)
    addBox(cell(155.5, -34.5), { w: 5, h: 0.45, d: 4.5, mat: superMat, x: 155.5, y: 8.425, z: -34.5, collide: world, raycast: rc, tag: 'metal' });
    addBox(cell(155, -34.5), { w: 9, h: 0.4, d: 7, mat: superMat, x: 155, y: 8.85, z: -34.5, collide: world, raycast: rc, tag: 'metal' });
    addBox(cell(155, -34), { w: 2, h: 3.2, d: 2, mat: superMat, x: 155, y: 10.65, z: -34, collide: world, raycast: rc, tag: 'metal' });
    const radarArm = new THREE.Mesh(cachedBox(5, 0.3, 0.7), steelMat);
    radarArm.position.set(155, 12.4, -34);
    radarArm.userData.tag = 'metal';
    cell(155, -34).add(radarArm); rc.push(radarArm);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd7dee6, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }));
    dish.position.set(163.5, 6.4, -37.5);
    dish.rotation.x = Math.PI * 0.72;
    cell(163.5, -37.5).add(dish);
    this.updaters.push((dt) => { radarArm.rotation.y += dt * 0.8; dish.rotation.z += dt * 0.9; });
    // deck cover: containers + funnel with a hot band
    for (const [px, pz] of [[141, -36.5], [149, -30.8], [164, -36.8], [167, -31.2]])
      addBox(cell(px, pz), { w: 4, h: 2.2, d: 2.6, mat: new THREE.MeshStandardMaterial({ color: 0xb0652a, roughness: 0.6, metalness: 0.3 }),
        x: px, y: 6.1, z: pz, collide: world, raycast: rc, tag: 'metal' });
    // audit r14c: funnel was pale superMat melting into the green aurora —
    // dark steel body + near-black cap so its outline cuts the sky
    addBox(cell(144.5, -34), { w: 3, h: 3.4, d: 3, mat: steelMat, x: 144.5, y: 6.7, z: -34, collide: world, raycast: rc, tag: 'metal' });
    const funBand = new THREE.Mesh(cachedBox(3.1, 0.3, 3.1), MAT.led(0xff7a3a, 1.4));
    funBand.position.set(144.5, 8.1, -34);
    cell(144.5, -34).add(funBand);
    addBox(cell(144.5, -34), { w: 3.3, h: 0.4, d: 3.3, mat: roofCapMat, x: 144.5, y: 8.6, z: -34, collide: world, raycast: rc, tag: 'metal' });
    // deck edge stanchions
    const deckRails = new THREE.InstancedMesh(cachedBox(0.12, 1.1, 0.12), steelMat, 28);
    let ri = 0;
    for (let x = 137; x <= 173; x += 2.8) { put(deckRails, ri++, x, 5.55, -40.4); put(deckRails, ri++, x, 5.55, -27.6); }
    for (let z = -38; z <= -30; z += 5.2) put(deckRails, ri++, 173.4, 5.55, z);
    deckRails.count = ri;
    core.add(deckRails);

    // ---- shootable icicles on the ridge overhangs — drop them on the yard ----
    const icicleAt = (ix, iz) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.65, 2.8, 7), new THREE.MeshStandardMaterial({
        color: 0xbfe0f4, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92,
      }));
      m.position.set(ix, 6, iz);
      m.rotation.x = Math.PI;
      m.castShadow = true;
      m.userData.tag = 'glass';
      m.userData.icicle = true;
      cell(ix, iz).add(m);
      rc.push(m);
      const col = new THREE.Box3(new THREE.Vector3(ix - 0.5, 4.4, iz - 0.5),
        new THREE.Vector3(ix + 0.5, 7.2, iz + 0.5));
      world.addBox(col.min, col.max);
      this.icicles.push({ mesh: m, col, falling: false, t: 0 });
    };
    for (const [ix, iz] of [[124, -51], [140, -51], [156, -51], [172, -51], [132, -15], [149, -15], [165, -15]])
      icicleAt(ix, iz);
    this.updaters.push((dt) => {
      for (const ic of this.icicles) {
        if (ic.falling !== true) continue;
        ic.t += dt;
        ic.mesh.position.y -= 19 * dt;
        if (ic.mesh.position.y <= 1.4) {
          ic.mesh.position.y = 1.4;
          this.p.dustPuff(ic.mesh.position.x, 0.2, ic.mesh.position.z, 10);
          this.p.sparkBurst(ic.mesh.position.x, 0.6, ic.mesh.position.z, 0, 1, 0, 12);
          ic.falling = 'done';
        }
      }
    });

    // ---- pressure-ridge blades + hummocks: shattered sea ice for cover ----
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xbdd9ec, roughness: 0.25, metalness: 0.12, flatShading: true });
    const blades = new THREE.InstancedMesh(cachedBox(1, 1, 1), bladeMat, 10);
    const bladeList = [
      [131, -47.5, 0.4, 3.2, 1.3], [141, -45, -0.3, 4.2, 1.2], [171, -45.5, 0.2, 3.6, 1.4],
      [186, -38, -0.15, 3.0, 1.2], [119, -38.5, 0.35, 3.4, 1.3], [131, -21, -0.3, 3.8, 1.2],
      [159, -20, 0.25, 4.0, 1.35], [174, -21, -0.2, 3.4, 1.15], [118, -19, 0.5, 3.0, 1.25],
    ];
    bladeList.forEach(([bx, bz, ry, w, h], i) => {
      put(blades, i, bx, h / 2, bz, ry, w, h, 0.6);
      const ca = Math.abs(Math.cos(ry)), sa = Math.abs(Math.sin(ry));
      const hw = (w * ca + 0.6 * sa) / 2, hd = (w * sa + 0.6 * ca) / 2;
      world.addBox(new THREE.Vector3(bx - hw, 0, bz - hd), new THREE.Vector3(bx + hw, h, bz + hd));
    });
    blades.count = bladeList.length;
    core.add(blades); rc.push(blades);
    const hummocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), bladeMat, 18);
    [[135.4, -44, 1.6], [167, -47, 1.4], [124, -27, 1.5], [178, -17.5, 1.3], [150, -45.5, 1.1], [187, -27, 1.2], [117, -49, 1.4],
      // crushed-channel read: rubble trail off the bow and along the flank
      [170, -13, 1.5], [176, -10, 1.2], [186, -6, 1.3], [163, -11.5, 1.1], [186, -52, 1.3],
      // pressure ridges pressing along both hull flanks: the hull is frozen
      // INTO the pack, not parked on a clean rink (audit r6 flaw)
      [148, -47.8, 1.7], [157, -48.2, 1.5], [138, -46.5, 1.3],
      [140, -13.5, 1.6], [149, -11.5, 1.4], [158, -10.5, 1.2]]
      .forEach(([hx, hz, sc], i) => {
        put(hummocks, i, hx, sc * 0.55, hz, rand(0, 3), sc, sc * 0.8, sc);
        world.addBox(new THREE.Vector3(hx - sc * 0.7, 0, hz - sc * 0.7), new THREE.Vector3(hx + sc * 0.7, sc * 1.1, hz + sc * 0.7));
      });
    core.add(hummocks); rc.push(hummocks);
    // audit r7: the ship sat on a clean reflective plane = 'open water'.
    // Flat ice FLOES press against both flanks and the bow: the hull is
    // frozen into the pack, not anchored in a rink.
    const floes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), iceRock, 26);
    const floePos = [];
    for (let fx = 139; fx <= 176; fx += 5) { floePos.push([fx, -42.6, rand(2.2, 3.4)]); floePos.push([fx, -25.4, rand(2.2, 3.4)]); }
    for (const [fx, fz, fs2] of [[187.5, -34, 2.4], [188, -30, 2.0], [188, -38, 2.0], [136, -41, 2.4], [134, -27, 2.6]]) floePos.push([fx, fz, fs2]);
    floePos.forEach(([fx, fz, fs2], i) => {
      if (i >= 26) return;
      put(floes, i, fx, 0.5, fz, rand(0, 3), fs2, 0.9, fs2 * 0.8);
      world.addBox(new THREE.Vector3(fx - fs2 * 0.7, 0, fz - fs2 * 0.6), new THREE.Vector3(fx + fs2 * 0.7, 1.0, fz + fs2 * 0.6));
    });
    floes.count = Math.min(26, floePos.length);
    floes.instanceMatrix.needsUpdate = true;
    core.add(floes); rc.push(floes);

    // ---- two searchlights sweep from the mast; their pools slide on the ice ----
    const poolTex = (() => {
      const { c, x } = canvas(256, 256);
      const g = x.createRadialGradient(128, 128, 8, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,240,200,0.8)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    const beams = [];
    // audit: mast-top cones bloomed straight across the bridge and erased it.
    // Fixtures now sit ON THE HULL FLANKS at ice-line height (below the
    // bridge block), tilted 60-70 deg off vertical: the shafts sweep the
    // yard outboard and never cross the superstructure silhouette.
    for (const [ph, tilt, mx, mz] of [[0, 1.12, 146, -40.3], [0.9, 1.18, 163, -40.3],
      [3.1, 1.15, 148, -27.7], [3.8, 1.1, 160, -27.7]]) {
      const g = new THREE.Group();
      g.position.set(mx, 4.6, mz);                        // flank mounts, deck line
      // audit r5: THREE rounds of shrinking/de-fading the shafts still left
      // translucent polygon occluders in every enemy-adjacent anchor view.
      // The volumetric cones come OUT entirely: fixtures, hot lens and the
      // moving ice pool below sell the searchlight without veil geometry.
      const stub = new THREE.Mesh(cachedBox(0.62, 0.55, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.6, metalness: 0.5 }));
      stub.position.set(mx, 4.6, mz + (mz < -34 ? -0.2 : 0.2));   // lamp housing on the flank
      stub.castShadow = false;
      core.add(stub);
      // hot lens on the housing: the beam's origin must read as a lamp ON
      // the ship, not as light bleeding out of the ice
      const lens = new THREE.Mesh(cachedBox(0.45, 0.36, 0.12), MAT.led(0xffe2b0, 0.8));
      lens.position.set(mx, 4.6, mz + (mz < -34 ? -0.46 : 0.46));
      core.add(lens);
      // audit r6: the additive ice pools read as blown-out white veils from
      // enemy-adjacent anchors (anchor2 3/10). Pool geometry removed.
      beams.push({ g, ph, tilt, mx, mz });
    }
    const bdir = new THREE.Vector3();
    this.updaters.push((dt) => {
      const t = performance.now() / 1000;
      for (const b of beams) {
        // tight outboard sweeps: the shafts stay on their own side of the
        // hull instead of laying a cone along the flank across the ship
        const sweep = b.ph + Math.sin(t * 0.16 + b.ph) * 0.55;
        b.g.rotation.set(b.tilt, sweep, 0, 'YXZ');
      }
    });

    // warm CQB in the rooms, cold key on the mast, yard fills
    for (const lx of [141.5, 151.5, 166.5]) {
      const l = new THREE.PointLight(0xffc07a, 30, 16, 2); l.position.set(lx, 2.4, -34); scene.add(l);
    }
    const l2 = new THREE.PointLight(0x9fc0e0, 58, 46, 2); l2.position.set(155, 10.2, -34.5); scene.add(l2);
    const l3 = new THREE.PointLight(0x7fb0d0, 34, 36, 2); l3.position.set(128, 7, -44); scene.add(l3);
    const l4 = new THREE.PointLight(0xa8d8f0, 36, 36, 2); l4.position.set(172, 7, -18); scene.add(l4);
    // build-time rim fills parked off each hull flank: cold wash up the
    // maroon side so the ship's silhouette separates from the black sky
    // (audit: 85 blew the hull to beige bloom from enemy-adjacent cameras)
    const rim1 = new THREE.PointLight(0xcfe4f2, 55, 34, 2); rim1.position.set(143, 6.4, -44.5); scene.add(rim1);
    const rim2 = new THREE.PointLight(0xcfe4f2, 40, 34, 2); rim2.position.set(166, 6.4, -20.5); scene.add(rim2);

    // mid-hull readability at ALL viewing distances (audit: enemy-adjacent
    // anchors face the flank at 3-8 m and saw bare maroon): porthole row +
    // taffrail strip along each side, one InstancedMesh family
    const portMat = MAT.led(0xffcf94, 0.9);
    // audit r10: square glowing panels read as light fixtures, not portholes
    const portGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12);
    portGeo.rotateX(Math.PI / 2);                      // disc faces ±Z
    const ports = new THREE.InstancedMesh(portGeo, portMat, 24);
    let pi2 = 0;
    for (const zSide of [-40.34, -27.66])
      for (let x = 137; x <= 172 && pi2 < 24; x += 3.6) put(ports, pi2++, x, 2.6, zSide);
    ports.count = pi2;
    ports.instanceMatrix.needsUpdate = true;
    core.add(ports);
    const taffrail = new THREE.InstancedMesh(cachedBox(1, 0.12, 0.14), MAT.led(0xbfd8ea, 0.5), 4);
    [[144.5, 16, -40.3], [166.5, 12, -40.3], [144.5, 16, -27.7], [166.5, 12, -27.7]].forEach(([tx, tw, tz], i) => put(taffrail, i, tx, 5.12, tz, 0, tw, 1, 1));
    taffrail.instanceMatrix.needsUpdate = true;
    core.add(taffrail);
    // raked icebreaker bow: ONE smooth sloped stem face (audit r12: the
    // old stepping stack read as 'blunt steps'; a single raked plane + a
    // white forecastle cap higher than the aft deck is the icebreaker cue)
    {
      const bow = new THREE.Mesh(cachedBox(11, 9, 12.6), hullMat);
      bow.position.set(176.6, 4.2, -34); bow.rotation.z = -0.52;
      bow.userData.tag = 'metal'; core.add(bow); rc.push(bow);
      world.addBox(new THREE.Vector3(171, 0, -40.3), new THREE.Vector3(182, 8.4, -27.7));
      const bowBelt = new THREE.Mesh(cachedBox(11.2, 1.7, 12.7), iceBeltMat);
      bowBelt.position.set(176.7, 0.85, -34); bowBelt.rotation.z = -0.52;
      core.add(bowBelt);
      const bowStripe = new THREE.Mesh(cachedBox(11.2, 1.3, 12.75), bandMat);
      bowStripe.position.set(176.9, 5.4, -34); bowStripe.rotation.z = -0.52;
      core.add(bowStripe);
      // white forecastle bulwark: tallest point forward of midships
      addBox(cell(171.5, -34), { w: 4.2, h: 1.3, d: 12.6, mat: superMat, x: 171.5, y: 8.0, z: -34, collide: world, raycast: rc, tag: 'metal' });
      for (let bi = 0; bi < 3; bi++) {
        const bp = new THREE.Mesh(portGeo, portMat);
        bp.position.set(176.2 - bi * 2.6, 2.9 - bi * 0.55, -38.2); bp.rotation.y = Math.PI / 2;
        bp.rotation.x = 0.52; core.add(bp);
        const bp2 = bp.clone(); bp2.position.z = -29.8; core.add(bp2);
      }
    }
    const bowFlood = new THREE.PointLight(0xffc884, 22, 18, 2); bowFlood.position.set(181, 5, -34); scene.add(bowFlood);
    // audit r14: the raked wedge read as a slanted wall. A PLUMB near-white
    // stem strip + a black boot stripe at the wedge tip draw the bow profile:
    // vertical white line = stem, dark band = ice belt, wedge rake between.
    {
      const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.4, metalness: 0.3, emissive: 0x2a2822, emissiveIntensity: 0.6 });
      addBox(cell(181.8, -34), { w: 1.0, h: 8.2, d: 1.7, mat: stemMat, x: 181.8, y: 4.1, z: -34, collide: world, raycast: rc, tag: 'metal' });
      addBox(cell(180.4, -34), { w: 1.1, h: 1.6, d: 1.9, mat: iceBeltMat, x: 180.4, y: 0.8, z: -34, collide: world, raycast: rc, tag: 'metal' });
    }
    // east (bow) end gets the SAME band language as the flanks: anchor
    // cameras park east and were staring at a blank red slab (audit r9)
    addBox(cell(172.55, -34), { w: 0.28, h: 2.0, d: 11.9, mat: bandMat, x: 172.55, y: 4.0, z: -34, cast: false, raycast: rc, tag: 'metal' });
    addBox(cell(172.55, -34), { w: 0.28, h: 1.1, d: 11.9, mat: iceBeltMat, x: 172.55, y: 0.75, z: -34, cast: false, raycast: rc, tag: 'metal' });
    const eBulwark = new THREE.Mesh(cachedBox(0.3, 1.0, 11.9), superMat);
    eBulwark.position.set(172.55, 5.6, -34); core.add(eBulwark);
    for (let ei = 0; ei < 3; ei++) {
      const ep = new THREE.Mesh(portGeo, portMat);
      ep.position.set(172.5, 2.6, -38.4 + ei * 4.4); ep.rotation.y = Math.PI / 2; core.add(ep);
    }
    // masthead + nav lights at the bow corners: the iconic ship cue that
    // sells 'vessel' from ANY direction (audit r11 east anchors)
    // audit r14: 0.24 m wire mast was invisible — 0.5 m dark post +
    // crossbar + dish now cut a real mast silhouette against the sky.
    const mastMat = roofCapMat;
    const mast = new THREE.Mesh(cachedBox(0.5, 4.8, 0.5), mastMat);
    mast.position.set(171.5, 11.0, -34); core.add(mast);
    const crossbar = new THREE.Mesh(cachedBox(0.3, 0.34, 3.6), mastMat);
    crossbar.position.set(171.5, 12.3, -34); core.add(crossbar);
    const mastDish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x242a30, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
    mastDish.position.set(171.5, 12.9, -32.7); mastDish.rotation.x = Math.PI * 0.8; core.add(mastDish);
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), MAT.led(0xff5a4a, 1.2));
    navR.position.set(172.3, 6.3, -39.4); core.add(navR);
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), MAT.led(0x5aff7a, 1.2));
    navG.position.set(172.3, 6.3, -28.6); core.add(navG);
    const mastTop = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), MAT.led(0xfff0c0, 1.5));
    mastTop.position.set(171.5, 13.5, -34); core.add(mastTop);
    // stern end gets the same pale band language + a work lamp, so the
    // 'stepped black mass' reads as an aft deck, not a hole in the ship
    for (const [bz2, bw2] of [[-40.3, 2.2], [-27.7, 2.2]])
      addBox(cell(137.1, bz2), { w: 0.26, h: 2.0, d: bw2, mat: bandMat, x: 137.1, y: 4.0, z: bz2, cast: false, raycast: rc, tag: 'metal' });
    const sternLamp = new THREE.PointLight(0xffc07a, 34, 20, 2); sternLamp.position.set(136.5, 6.2, -34); scene.add(sternLamp);

    SPAWN_POOLS.ice = [
      { pos: [122, -46], wps: [[122, -46], [130, -42], [124, -34]] },
      { pos: [149, -49], wps: [[149, -49], [156, -44], [146, -41]] },
      { pos: [184, -44], wps: [[184, -44], [180, -38], [186, -30]] },
      { pos: [121, -24], wps: [[121, -24], [127, -20], [122, -17]] },
      { pos: [146, -21], wps: [[146, -21], [152, -18], [143, -17]] },
      { pos: [166, -49.6], wps: [[166, -49.6], [160, -45], [167, -41]] },
      { pos: [184, -20], wps: [[184, -20], [179, -17], [186, -14]] },
    ];
  }

  // ============ MISSION 11 · 軌道ターミナル · orbital elevator ring ============

  // A TRUE RING (moremaps2 §2): annulus deck plates r 12..30 with hollow
  // railings on both rims, an open center lattice over a slow-turning
  // Earth 160 m below, elevator cable pillar + docking arms, a container
  // yard, hover-cart guideway, and the cargo train ripping a chord of the
  // ring (this.cargo keeps the shove mechanic alive). No exterior walls —
  // ghost-thin air walls at the bounds; corner gantry pads justify the
  // square containment rect around the circle.
  _orbit() {
    const G = this._g('orbit');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 120, X1 = 172, Z0 = 20, Z1 = 72;
    this.bounds.orbit = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('orbit', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('orbit');
    const cell = (x, z) => this._cell('orbit', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const put = (im, i, px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };
    const R_IN = 12, R_OUT = 30;

    // ---- invisible deck: one slab collider under the whole rect +
    // ghost-thin air walls ring the open edges (skyport pattern)
    world.addBox(new THREE.Vector3(X0, -0.7, Z0), new THREE.Vector3(X1, 0, Z1));
    const airWallMat = new THREE.MeshBasicMaterial({
      color: 0xaebfcd, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide,
    });
    const airWall = (w, d, x, z) => addBox(core, { w, h: 9, d, mat: airWallMat, x, y: 4.5, z,
      cast: false, receive: false, collide: world, raycast: rc, tag: 'metal' });
    airWall(X1 - X0 + 1, 0.24, cx, Z0 - 0.12);
    airWall(X1 - X0 + 1, 0.24, cx, Z1 + 0.12);
    airWall(0.24, Z1 - Z0 + 1, X0 - 0.12, cz);
    airWall(0.24, Z1 - Z0 + 1, X1 + 0.12, cz);

    const steel = new THREE.MeshStandardMaterial({ color: 0x39414d, roughness: 0.5, metalness: 0.65 });
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x565f6c, roughness: 0.35, metalness: 0.8 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x454e5a, roughness: 0.45, metalness: 0.6, envMapIntensity: 1.2 });

    // ---- ring deck plates: instanced polar tiles between r12 and r30,
    // clipped where the circle runs past the containment rect
    const plates = new THREE.InstancedMesh(cachedBox(2.9, 0.14, 3.35), plateMat, 480);
    let pi = 0;
    for (let r = 13.8; r <= R_OUT - 0.8; r += 3.4) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 3.6));
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2 + r * 0.37;   // stagger rings
        const px = cx + Math.cos(th) * r, pz = cz + Math.sin(th) * r;
        if (px < X0 + 1.3 || px > X1 - 1.3 || pz < Z0 + 1.3 || pz > Z1 - 1.3) continue;
        put(plates, pi++, px, -0.02, pz, -(th + Math.PI / 2));
      }
    }
    plates.count = pi;
    core.add(plates); rc.push(plates);

    // ---- central void: a sparse safety lattice over the drop, then the
    // elevator pillar climbing out of it with docking arms and the cable
    const bars = new THREE.InstancedMesh(cachedBox(8.6, 0.1, 0.24), steel, 20);
    for (let i = 0; i < 20; i++) put(bars, i, cx + Math.cos(i * 0.314) * 7.6, 0.03, cz + Math.sin(i * 0.314) * 7.6, -(i * 0.314 + Math.PI / 2));
    core.add(bars); rc.push(bars);
    for (const br of [5, 8, 11]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(br, 0.05, 6, 40), steel);
      ring.rotation.x = Math.PI / 2; ring.position.set(cx, 0.03, cz);
      core.add(ring);
    }
    // observation glass over the void: the slab collider reads as a
    // transparent center window straight down onto the Earth
    const obsGlass = new THREE.Mesh(new THREE.CircleGeometry(11.9, 48),
      new THREE.MeshBasicMaterial({ color: 0x7fb8e8, transparent: true, opacity: 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    obsGlass.rotation.x = -Math.PI / 2;
    obsGlass.position.set(cx, 0.02, cz);
    core.add(obsGlass);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 46, 18), towerMat);
    col.position.set(cx, 23, cz);
    col.castShadow = true;
    col.userData.tag = 'metal';
    core.add(col); rc.push(col);
    world.addBox(new THREE.Vector3(cx - 3.4, 0, cz - 3.4), new THREE.Vector3(cx + 3.4, 46, cz + 3.4));
    for (const ringY of [6, 14, 22, 30, 38]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.24, 6, 24),
        new THREE.MeshStandardMaterial({ color: 0x1c222b, emissive: 0x2a6aff, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.6 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, ringY, cz);
      core.add(ring);
    }
    for (const th of [0.8, 2.8, 4.9]) for (const ay of [6, 12, 18]) {
      const ax = cx + Math.cos(th) * 6.4, az = cz + Math.sin(th) * 6.4;
      addBox(core, { w: 6.8, h: 0.5, d: 1.5, mat: towerMat, x: ax, y: ay, z: az, rotY: -th, cast: false, raycast: rc, tag: 'metal' });
      addBox(core, { w: 2.4, h: 0.7, d: 2.4, mat: towerMat, x: cx + Math.cos(th) * 9.8, y: ay - 0.1, z: cz + Math.sin(th) * 9.8, rotY: -th, cast: false, raycast: rc, tag: 'metal' });
    }
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, 240, 8), towerMat);
    cable.position.set(cx, 165, cz);
    core.add(cable);

    // ---- layered background: slow-turning Earth + cloud + air rim,
    // 160 m under the platform (config farClip 780 keeps it all visible)
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
    const earth = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 20),
      new THREE.MeshStandardMaterial({ map: eTex, roughness: 0.9, fog: false }));
    earth.position.set(cx, -160, cz);
    core.add(earth);
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(127, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, fog: false }));
    cloud.position.copy(earth.position);
    core.add(cloud);
    const airRim = new THREE.Mesh(new THREE.SphereGeometry(131, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x3a7fd0, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    airRim.position.copy(earth.position);
    core.add(airRim);
    this.updaters.push((dt) => { earth.rotation.y += dt * 0.008; cloud.rotation.y -= dt * 0.014; });

    // ---- hollow railings both rims (see-through) + perimeter rail at the air walls
    const posts = new THREE.InstancedMesh(cachedBox(0.11, 1.1, 0.11), towerMat, 160);
    let ki = 0;
    for (let i = 0; i < 46; i++) {                            // inner rim r12
      const th = (i / 46) * Math.PI * 2;
      put(posts, ki++, cx + Math.cos(th) * (R_IN - 0.2), 0.55, cz + Math.sin(th) * (R_IN - 0.2));
    }
    for (let i = 0; i < 46; i++) {                            // outer rim r30, rect-clipped
      const th = (i / 46) * Math.PI * 2;
      const px = cx + Math.cos(th) * (R_OUT - 0.2), pz = cz + Math.sin(th) * (R_OUT - 0.2);
      if (px < X0 + 1 || px > X1 - 1 || pz < Z0 + 1 || pz > Z1 - 1) continue;
      put(posts, ki++, px, 0.55, pz);
    }
    for (let x = X0 + 1.2; x < X1 - 1; x += 1.9) { put(posts, ki++, x, 0.55, Z0 + 0.35); put(posts, ki++, x, 0.55, Z1 - 0.35); }
    for (let z = Z0 + 1.2; z < Z1 - 1; z += 1.9) { put(posts, ki++, X0 + 0.35, 0.55, z); put(posts, ki++, X1 - 0.35, 0.55, z); }
    posts.count = ki;
    core.add(posts);
    for (const ty of [1.12, 0.6]) {
      const cap = new THREE.Mesh(new THREE.TorusGeometry(R_IN - 0.2, 0.05, 6, 56), towerMat);
      cap.rotation.x = Math.PI / 2; cap.position.set(cx, ty, cz);
      core.add(cap);
    }
    for (const [w, d, x, z] of [[X1 - X0 - 1, 0.12, cx, Z0 + 0.35], [X1 - X0 - 1, 0.12, cx, Z1 - 0.35],
      [0.12, Z1 - Z0 - 1, X0 + 0.35, cz], [0.12, Z1 - Z0 - 1, X1 - 0.35, cz]])
      for (const ty of [1.12, 0.6])
        addBox(core, { w, h: 0.1, d, mat: towerMat, x, y: ty, z, cast: false });

    // ---- struts & girders hanging under the deck (visible from the rims)
    const struts = new THREE.InstancedMesh(cachedBox(0.3, 6, 0.3), towerMat, 128);
    let si = 0;
    for (let i = 0; i < 12; i++) {                            // radial girder rows
      const th = (i / 12) * Math.PI * 2;
      for (const r of [14.5, 18.5, 22.5, 26.5, 29]) {
        const px = cx + Math.cos(th) * r, pz = cz + Math.sin(th) * r;
        if (px < X0 + 1 || px > X1 - 1 || pz < Z0 + 1 || pz > Z1 - 1) continue;
        put(struts, si++, px, -3.4, pz, -th);
      }
    }
    for (let i = 0; i < 66 && si < 128; i++) {                    // diagonal braces under both rims
      const th = (i / 66) * Math.PI * 2;
      const r = i % 2 ? R_IN - 0.5 : R_OUT - 0.5;
      const px = cx + Math.cos(th) * r, pz = cz + Math.sin(th) * r;
      if (px < X0 + 1 || px > X1 - 1 || pz < Z0 + 1 || pz > Z1 - 1) continue;
      e.set(0, 0, i % 2 ? 0.6 : -0.6); q.setFromEuler(e);
      mtx.compose(v.set(px, -1.6, pz), q, s.set(0.22, 7.5, 0.22));
      struts.setMatrixAt(si++, mtx);
    }
    struts.count = si;
    core.add(struts);

    // ---- corner docking pads + gantry arms: walkable ground outside the
    // annulus, which is what makes the square bounds read honestly
    const padMat = new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.6, metalness: 0.5 });
    for (const [px, pz, jx] of [[129, 29, 138], [163, 29, 154], [129, 63, 138], [163, 63, 154]]) {
      const C = cell(px, pz);
      addBox(C, { w: 16, h: 0.16, d: 16, mat: padMat, x: px, y: -0.05, z: pz, cast: false, receive: true, raycast: rc, tag: 'metal' });
      const stripe = new THREE.Mesh(cachedBox(15, 0.02, 0.5), MAT.painted(0x6b5a1e));
      stripe.position.set(px, 0.05, pz - 6.8);
      C.add(stripe);
      addBox(C, { w: 0.8, h: 11, d: 0.8, mat: towerMat, x: px + (px < cx ? 0 : -6), y: 5.5, z: pz + (pz < cz ? 0 : -6), collide: world, raycast: rc, tag: 'metal' });
      addBox(C, { w: 9, h: 0.5, d: 0.5, mat: towerMat, x: jx, y: 10.7, z: pz + (pz < cz ? -6 : 6), collide: world, raycast: rc, tag: 'metal' });
      const hang = new THREE.Mesh(cachedBox(2, 1.6, 2), steel);
      hang.position.set(jx, 8.6, pz + (pz < cz ? -6 : 6));
      hang.castShadow = true; hang.userData.tag = 'metal';
      C.add(hang); rc.push(hang);
    }
    const padLamps = new THREE.InstancedMesh(cachedBox(0.24, 0.24, 0.24), MAT.led(0xffc26a, 1.3), 16);
    let li = 0;
    for (const [px, pz] of [[129, 29], [163, 29], [129, 63], [163, 63]])
      for (const [ox, oz] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]])
        put(padLamps, li++, px + ox, 0.15, pz + oz);
    core.add(padLamps);

    // ---- container yard: instanced rows on the ring + on the pads
    const contGeo = cachedBox(3, 2.6, 2.2);
    const contMat = new THREE.MeshStandardMaterial({ color: 0x6a5a2e, roughness: 0.6, metalness: 0.35 });
    const contRows = [
      [133, 44, 2], [136.2, 44, 1], [133, 47.5, 1], [136.2, 47.5, 2],
      [163, 36, 2], [166.2, 36, 1], [163, 39.2, 1], [166.2, 39.2, 2],
      [129.5, 57.5, 2], [129.5, 60.8, 1], [161, 53.5, 1], [164.5, 52.5, 2],
      [138.5, 68, 1], [141.7, 68, 2], [155, 26, 2], [158.2, 26, 1],
      [127, 29, 2], [130.2, 29, 1], [165, 63, 2], [168, 63, 1], [165, 66.2, 1],
    ];
    const conts = new THREE.InstancedMesh(contGeo, contMat, contRows.reduce((a, [, , n]) => a + n, 0));
    let cti = 0;
    contRows.forEach(([bx, bz, n], r) => {
      for (let lv = 0; lv < n; lv++) {
        e.set(0, ((r * 7) % 5 - 2) * 0.05, 0); q.setFromEuler(e);
        mtx.compose(v.set(bx, 1.3 + lv * 2.6, bz), q, s.set(1, 1, 1));
        conts.setMatrixAt(cti++, mtx);
        world.addBox(new THREE.Vector3(bx - 1.6, lv * 2.6, bz - 1.2), new THREE.Vector3(bx + 1.6, (lv + 1) * 2.6, bz + 1.2));
      }
    });
    conts.position.set(0, 0, 0);
    cell(146, 46).add(conts);                              // one IM, one parent cell
    rc.push(conts);

    // ---- hover-cart guideway: elevated ring rail + carts hanging under
    // it at y5, high enough for the cargo train to run underneath
    const wayBeam = new THREE.Mesh(new THREE.TorusGeometry(21.5, 0.16, 8, 72), towerMat);
    wayBeam.rotation.x = Math.PI / 2; wayBeam.position.set(cx, 5, cz);
    core.add(wayBeam);
    const wayPosts = new THREE.InstancedMesh(cachedBox(0.2, 5, 0.2), towerMat, 12);
    for (let i = 0; i < 12; i++) {
      const th = (i / 12) * Math.PI * 2 + 0.26;         // offset clear of the rail chord
      const px = cx + Math.cos(th) * 21.5, pz = cz + Math.sin(th) * 21.5;
      put(wayPosts, i, px, 2.5, pz);
      world.addBox(new THREE.Vector3(px - 0.16, 0, pz - 0.16), new THREE.Vector3(px + 0.16, 5, pz + 0.16));
    }
    core.add(wayPosts); rc.push(wayPosts);
    const cartMat = new THREE.MeshStandardMaterial({ color: 0x2f3a46, roughness: 0.45, metalness: 0.7, emissive: 0x101c2a, emissiveIntensity: 0.6 });
    const carts = new THREE.InstancedMesh(cachedBox(1.9, 1.1, 1.3), cartMat, 8);
    carts.frustumCulled = false;                            // matrices move on absolute coords
    const cartStripe = new THREE.InstancedMesh(cachedBox(2.0, 0.14, 1.35), MAT.led(0x4fc8ff, 1.6), 8);
    cartStripe.frustumCulled = false;
    core.add(carts, cartStripe);
    this.updaters.push((dt) => {
      const t = performance.now() / 1000;
      for (let i = 0; i < 8; i++) {
        const th = t * (0.22 + (i % 3) * 0.05) + i * 0.785;
        put(carts, i, cx + Math.cos(th) * 21.5, 4.2, cz + Math.sin(th) * 21.5, -th);
        put(cartStripe, i, cx + Math.cos(th) * 21.5, 3.6, cz + Math.sin(th) * 21.5, -th);
      }
      carts.instanceMatrix.needsUpdate = true;
      cartStripe.instanceMatrix.needsUpdate = true;
    });

    // ---- drones: little patrol lights with rotor discs, no collision
    const drones = [];
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Group();
      const body = new THREE.Mesh(cachedBox(0.5, 0.26, 0.7), towerMat);
      body.userData.tag = 'metal';
      d.add(body);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 10),
        new THREE.MeshStandardMaterial({ color: 0x1a222c, transparent: true, opacity: 0.4, roughness: 0.3 }));
      disc.position.y = 0.2;
      d.add(disc);
      const eye = new THREE.Mesh(cachedBox(0.12, 0.1, 0.06), MAT.led(0xff5a4a, 2.2));
      eye.position.set(0, 0, 0.38);
      d.add(eye);
      core.add(d);
      drones.push({ d, th: i * 1.257, r: 16 + (i % 3) * 5, y: 4.5 + i * 0.9, sp: 0.3 + i * 0.04 });
    }
    this.updaters.push((dt) => {
      const t = performance.now() / 1000;
      for (const dr of drones) {
        const th = dr.th + t * dr.sp;
        dr.d.position.set(cx + Math.cos(th) * dr.r, dr.y + Math.sin(t * 1.3 + dr.th) * 0.8, cz + Math.sin(th) * dr.r);
        dr.d.rotation.y = -th;
      }
    });

    // ---- the cargo train: a chord of the ring at z=cz+18, clear of the
    // center hole; this.cargo keeps the game.js shove mechanic (moremaps2)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.4, metalness: 0.8 });
    addBox(core, { w: 50, h: 0.05, d: 3.4, mat: railMat, x: cx, y: 0.05, z: 64, cast: false, raycast: rc, tag: 'metal' });
    for (const rz of [62.7, 65.3])
      addBox(core, { w: 50, h: 0.2, d: 0.18, mat: railMat, x: cx, y: 0.12, z: rz, cast: false, raycast: rc, tag: 'metal' });
    const carMatTrain = new THREE.MeshStandardMaterial({ color: 0x3a4450, roughness: 0.45, metalness: 0.7 });
    const train = new THREE.Group();
    const cars = [];
    for (let i = 0; i < 6; i++) {
      const car = new THREE.Mesh(cachedBox(5.4, 2.6, 3.2), i === 0
        ? new THREE.MeshStandardMaterial({ color: 0xc2551f, roughness: 0.45, metalness: 0.7, emissive: 0x2a1000, emissiveIntensity: 0.3 })
        : carMatTrain);
      car.position.y = 1.55;
      car.castShadow = true;
      car.userData.tag = 'metal';
      train.add(car);
      cars.push(car);
      rc.push(car);
    }
    // dim headlight: at 1.8 the head lamp + warm line light read as an
    // orange-white flare on the elevator pillar base from every south anchor
    const head = new THREE.Mesh(cachedBox(0.5, 0.5, 0.2), MAT.led(0xfff2c0, 1.0));
    head.position.set(3.1, 1.7, 0);
    train.add(head);
    train.position.set(X0 - 40, 0, 64);
    core.add(train);
    const TR = { t: 4, period: 16, speed: 36, active: false, x: 0 };
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
          ? { x0: TR.x - 34, x1: TR.x + 3.2, z0: 62.1, z1: 65.9, top: 2.9, dir: 1 }
          : null;
      } else this.cargo = null;
    });

    const l1 = new THREE.PointLight(0xbcd4ff, 30, 50, 2); l1.position.set(cx, 9, cz); scene.add(l1);
    const l2 = new THREE.PointLight(0xffd89a, 26, 34, 2); l2.position.set(129, 4, 29); scene.add(l2);
    const l3 = new THREE.PointLight(0xffd89a, 26, 34, 2); l3.position.set(163, 4, 63); scene.add(l3);
    // was 26: this fixture pools right on the pillar base over the train
    // chord and blew the frame center out; ~40% dimmer + softer range
    const l4 = new THREE.PointLight(0x9ab8e8, 16, 28, 2); l4.position.set(cx, 7, 64); scene.add(l4);

    SPAWN_POOLS.orbit = [
      { pos: [146, 27], wps: [[146, 27], [152, 26], [143, 24]] },
      { pos: [166, 42], wps: [[166, 42], [164, 36], [169, 37]] },
      { pos: [126, 50], wps: [[126, 50], [131, 54], [124, 56]] },
      { pos: [135, 29], wps: [[135, 29], [140, 31], [137, 24]] },
      { pos: [163, 58], wps: [[163, 58], [158, 55], [165, 53]] },
      { pos: [157, 32], wps: [[157, 32], [161, 34], [154, 35]] },
      { pos: [126, 35], wps: [[126, 35], [131, 37], [128, 30]] },
    ];
  }

  // ============ MISSION 12 · 巨型植物園 · raised boardwalk through
  // six giant trunks under a glass biodome ============

  // Main walkable layer at y≈6.75: plank boardwalk grid + three alloy
  // platforms (8.75/10.75) joined by 3.5 m-wide branch-logs between six
  // trunks (r 2.5-4, LOD roots); T3 + T5 are HOLLOW with dead-straight
  // sight corridors. The dark forest floor (splat soil, instanced ferns,
  // mushrooms, plank routes, bounce pads) lives 6.75 m below. Leaves are
  // wind-shader discs up close + lodNode billboards far off; mecha-bugs
  // and additive sunbeams fill the air, glass dome above (moremaps2 §3).
  _canopy() {
    const G = this._g('canopy');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -240, X1 = -188, Z0 = -40, Z1 = 8;
    this.bounds.canopy = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('canopy', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 18);
    const core = this._core('canopy');
    const cell = (x, z) => this._cell('canopy', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const put = (im, i, px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };
    const DECK = 6.75;

    // ---- dark forest floor: soil/loam/moss splat ----
    const soilTex = (base, spec) => {
      const { c, x } = canvas(512, 512);
      x.fillStyle = base; x.fillRect(0, 0, 512, 512);
      for (let i = 0; i < spec.n; i++) {
        x.fillStyle = `rgba(${spec.cols[i % spec.cols.length]},${0.15 + Math.random() * 0.22})`;
        x.beginPath();
        x.ellipse(rand(0, 512), rand(0, 512), rand(4, 46), rand(4, 30), rand(0, 3), 0, Math.PI * 2);
        x.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4c4030, roughness: 0.95, metalness: 0 });
    splatShader(groundMat,
      soilTex('#2e2417', { n: 80, cols: ['92,70,44', '30,38,24'] }),
      soilTex('#2f4423', { n: 60, cols: ['62,92,48', '22,30,18'] }),
      { n: 0.07, e: 0.32 });
    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: groundMat });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 22,
      mat: new THREE.MeshStandardMaterial({ color: 0x24362c, roughness: 0.7, metalness: 0.1 }) });

    // ---- glass biodome: dark green steel web + barely-there skin (core) ----
    const web = new THREE.Mesh(new THREE.IcosahedronGeometry(58, 2),
      new THREE.MeshBasicMaterial({ color: 0x5d8568, wireframe: true, transparent: true, opacity: 0.3 }));
    web.position.set(cx, -3, cz);
    core.add(web);
    const skin = new THREE.Mesh(new THREE.IcosahedronGeometry(57.5, 2),
      new THREE.MeshBasicMaterial({ color: 0x9fd4a0, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    skin.position.copy(web.position);
    core.add(skin);
    // 45° glass facets catching the sun
    const facets = new THREE.InstancedMesh(cachedBox(5.4, 5.4, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xbfe8c8, transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 40);
    {
      let fi = 0;
      for (const [th, ph] of [[-0.4, 0.4], [0.3, 0.8], [-0.9, 0.7], [1.9, 0.5], [2.8, 0.9], [-2.4, 0.6], [0.9, 0.3], [3.9, 0.7], [-1.6, 1.0], [2.2, 0.4]])
        for (const rr of [42, 50]) {
          const px = cx + Math.cos(th) * Math.cos(ph) * rr;
          const py = 14 + Math.sin(ph) * rr * 0.8;
          const pz = cz + Math.sin(th) * Math.cos(ph) * rr;
          e.set(ph * 0.7, th, 0.4); q.setFromEuler(e);
          mtx.compose(v.set(px, py, pz), q, s.set(1, 1, 1));
          facets.setMatrixAt(fi++, mtx);
        }
      facets.count = fi;
    }
    core.add(facets);

    // ---- SIX GIANT TRUNKS (r 2.5-4) with LOD root flares ----
    const barkTex = (() => {
      const { c, x } = canvas(256, 512);
      x.fillStyle = '#4a3a26'; x.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 90; i++) {
        x.fillStyle = `rgba(${30 + Math.random() * 60 | 0},${24 + Math.random() * 40 | 0},20,0.5)`;
        x.fillRect(rand(0, 250), rand(0, 460), rand(3, 9), rand(40, 160));
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, color: 0xc8b090, roughness: 0.92, metalness: 0 });
    const TRUNKS = [
      { x: -229, z: -27, r: 2.8, h: 12, hollow: false },   // T1
      { x: -204, z: -27, r: 2.8, h: 13, hollow: false },   // T2
      { x: -214, z: -14, r: 4.0, h: 17, hollow: true },    // T3 corridor along X
      { x: -226, z: -6, r: 3.2, h: 13.5, hollow: false },  // T4
      { x: -198, z: -1, r: 3.0, h: 16, hollow: true },     // T5 corridor along Z
      { x: -218, z: -37, r: 2.4, h: 11.5, hollow: false }, // T6
    ];
    for (const t of TRUNKS) {
      const C = cell(t.x, t.z);
      for (const [segH, segR, segY] of [[t.h * 0.45, t.r, t.h * 0.225], [t.h * 0.35, t.r * 0.82, t.h * 0.45 + t.h * 0.175], [t.h * 0.2, t.r * 0.6, t.h * 0.8 + t.h * 0.1]]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(segR * 0.8, segR, segH, 10), barkMat);
        m.position.set(t.x, segY, t.z);
        m.castShadow = true;
        m.userData.tag = 'wood';
        C.add(m); rc.push(m);
      }
      const roots = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const a = i * 2.094 + t.x * 0.7;
        const root = new THREE.Mesh(new THREE.ConeGeometry(t.r * 0.4, 6, 6), barkMat);
        root.position.set(t.x + Math.cos(a) * t.r * 0.85, 3, t.z + Math.sin(a) * t.r * 0.85);
        root.rotation.z = Math.cos(a + Math.PI / 2) * 0.5;
        root.rotation.x = -Math.sin(a + Math.PI / 2) * 0.5;
        roots.add(root);
      }
      C.add(lodNode(roots, bboxProxy(roots, 0x3f3324), 40));
    }
    // solid trunk footprints; the two hollow ones get wall + cap boxes so
    // the straight corridors stay walkable and shootable
    for (const t of TRUNKS) {
      if (t.hollow) continue;
      const hw = t.r * 0.85;
      world.addBox(new THREE.Vector3(t.x - hw, 0, t.z - hw), new THREE.Vector3(t.x + hw, t.h, t.z + hw));
    }
    const trunkWall = (t, w, d, x, z) =>
      addBox(cell(x, z), { w, h: t.h, d, mat: barkMat, x, y: t.h / 2, z, collide: world, raycast: rc, tag: 'wood' });
    // T3: corridor along X, half-width 1.35, chord z ±2.65 at the caps
    trunkWall(TRUNKS[2], 8.2, 2.65, -214, -16.675);
    trunkWall(TRUNKS[2], 8.2, 2.65, -214, -10.325);
    trunkWall(TRUNKS[2], 1.4, 2.9, -217.3, -14);
    trunkWall(TRUNKS[2], 1.4, 2.9, -210.7, -14);
    // T5: corridor along Z, half-width 1.35, chord x ±2.36 at the caps
    trunkWall(TRUNKS[4], 1.65, 5.9, -200.175, -1);
    trunkWall(TRUNKS[4], 1.65, 5.9, -195.825, -1);
    trunkWall(TRUNKS[4], 4.8, 1.2, -198, 2.45);
    trunkWall(TRUNKS[4], 4.8, 1.2, -198, -4.45);
    // hollow trunks wear arc shells that skip their corridor mouths
    for (const [ti, g] of [[2, 0.343], [4, 0.464]]) {
      const t = TRUNKS[ti];
      for (const [ts, len] of [[Math.PI / 2 + g, Math.PI - 2 * g], [3 * Math.PI / 2 + g, Math.PI - 2 * g]]) {
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r * 1.15, t.h * 0.92, 14, 1, true, ts, len), barkMat);
        shell.position.set(t.x, t.h * 0.46, t.z);
        shell.material.side = THREE.DoubleSide;
        shell.userData.tag = 'wood';
        cell(t.x, t.z).add(shell); rc.push(shell);
      }
    }

    // ---- BOARDWALK NETWORK at y 6.75 (plank decks, 2.6-3 m wide) ----
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6f5b3e, roughness: 0.85, metalness: 0.05 });
    const deck = (x0, z0, x1, z1) => {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      addBox(cell(mx, mz), { w: x1 - x0, h: 0.35, d: z1 - z0, mat: deckMat,
        x: mx, y: DECK - 0.175, z: mz, collide: world, raycast: rc, tag: 'wood' });
    };
    // main E-W boardwalk; the T3 corridor deck sits between its walls
    deck(-237, -15.75, -218.1, -12.25);
    deck(-218.1, -15.35, -210, -12.65);
    deck(-210, -15.75, -191, -12.25);
    // secondary E-W boardwalk
    deck(-236.5, -30, -232.6, -27);
    deck(-224.6, -30, -207.6, -27);
    deck(-201, -30, -189.9, -27);
    // N-S boardwalk, threading exactly through the T5 corridor
    deck(-199.3, -36, -196.7, -3.95);
    deck(-199.3, 1.95, -196.7, 8);
    // stubs tying trunks into the grid
    deck(-204.5, -27, -203, -24.2);                       // seg2 -> T2
    deck(-236.5, -29.3, -232.6, -27);                     // west return

    // ---- 3.5 m branch-logs between trunks: walkable chord decks ----
    const log = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const a = -Math.atan2(z1 - z0, x1 - x0);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const m = addBox(cell(mx, mz), { w: L + 0.4, h: 0.35, d: 3.5, mat: deckMat,
        x: mx, y: DECK - 0.175, z: mz, raycast: rc, tag: 'wood' });
      m.rotation.y = a;
      const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
      const fw = (L + 0.4) * ca + 3.5 * sa, fd = (L + 0.4) * sa + 3.5 * ca;
      world.addBox(new THREE.Vector3(mx - fw / 2, DECK - 0.35, mz - fd / 2),
        new THREE.Vector3(mx + fw / 2, DECK, mz + fd / 2));
      const trunkLog = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, L + 0.4, 10), barkMat);
      trunkLog.position.set(mx, DECK - 1.7, mz);
      trunkLog.rotation.z = Math.PI / 2;
      trunkLog.rotation.y = 0;
      const holder = new THREE.Group();
      holder.position.set(mx, 0, mz);
      holder.rotation.y = a;
      trunkLog.position.set(0, DECK - 1.7, 0);
      holder.add(trunkLog);
      cell(mx, mz).add(holder);
    };
    log(-226.6, -24.9, -217, -16.6);                      // T1 -> T3
    log(-217.3, -11.2, -228.9, -3.5);                     // T3 -> T4
    log(-211.6, -18.8, -201.6, -23.4);                    // T3 -> T2
    log(-210.2, -11.5, -200.9, -3.5);                     // T3 -> T5

    // ---- stairs: two 0.45 m flights to the boardwalk, 0.4 m flights to
    // the platforms; every riser <=0.45 m, landings flush with deck tops ----
    const stair = (px, pz, i, ax, rise = 0.45, yBase = 0) => {
      addBox(cell(px, pz), { w: ax === 'z' ? 1.5 : 1.3, h: i * rise, d: ax === 'z' ? 1.3 : 1.5,
        mat: deckMat, x: px, y: yBase + i * rise / 2, z: pz, collide: world, raycast: rc, tag: 'wood' });
    };
    for (let i = 1; i <= 15; i++) stair(-235, -30.65 - (15 - i) * 0.62, i, 'z', 0.45);     // west -> seg1
    for (let i = 1; i <= 15; i++) stair(-190, -3.55 - (i - 1) * 0.62, i, 'z', 0.45);       // SE tower -> E bridge
    addBox(cell(-190, -20), { w: 2.4, h: 0.35, d: 14.12, mat: deckMat,
      x: -190, y: DECK - 0.175, z: -20, collide: world, raycast: rc, tag: 'wood' });

    // ---- three alloy platforms: 8.75 (x2) and 10.75 ----
    const alloy = new THREE.MeshStandardMaterial({ color: 0x525a63, roughness: 0.45, metalness: 0.75 });
    for (const [w, d, px, pz, top] of [[6, 4, -215, -20.5, 8.75], [4, 4, -215.8, -19.5, 10.75], [6, 6, -192, -7, 8.75]]) {
      addBox(cell(px, pz), { w, h: 0.35, d, mat: alloy, x: px, y: top - 0.175, z: pz, collide: world, raycast: rc, tag: 'metal' });
      for (const [ox, oz] of [[-w / 2 + 0.4, -d / 2 + 0.4], [w / 2 - 0.4, -d / 2 + 0.4], [-w / 2 + 0.4, d / 2 - 0.4], [w / 2 - 0.4, d / 2 - 0.4]])
        addBox(cell(px, pz), { w: 0.45, h: top - 0.35, d: 0.45, mat: alloy, x: px + ox, y: (top - 0.35) / 2, z: pz + oz, collide: world, raycast: rc, tag: 'metal' });
      const lamp = new THREE.Mesh(cachedBox(0.3, 0.3, 0.3), MAT.led(0xffd28a, 2.0));
      lamp.position.set(px, top + 2.4, pz);
      cell(px, pz).add(lamp);
      const post = new THREE.Mesh(cachedBox(0.1, 2.4, 0.1), alloy);
      post.position.set(px, top + 1.2, pz);
      cell(px, pz).add(post);
    }
    for (let i = 1; i <= 5; i++) stair(-215, -19.15 + (5 - i) * 0.62, i, 'z', 0.4, 6.75);           // main -> P1
    for (let i = 1; i <= 5; i++) stair(-213.15 - (5 - i) * 0.62, -19.5, i, 'x', 0.4, 8.75);         // P1 -> P2
    for (let i = 1; i <= 5; i++) stair(-194.35 - (5 - i) * 0.35, -7, i, 'x', 0.4, 6.75);            // N-S -> P3

    // ---- boardwalk edge stanchions (visual rails) ----
    const railPosts = new THREE.InstancedMesh(cachedBox(0.1, 1.05, 0.1), barkMat, 128);
    let qi = 0;
    const railRun = (x, z, dx, dz, n) => {
      for (let i = 0; i < n; i++) put(railPosts, qi++, x + dx * i, DECK + 0.55, z + dz * i);
    };
    for (let x = -236; x <= -191; x += 2.6) {
      if (x > -219 && x < -209) continue;
      railRun(x, -12.45, 0, 0, 1); railRun(x, -15.55, 0, 0, 1);
    }
    for (let x = -236; x <= -190; x += 2.6) {
      if ((x > -232 && x < -226) || (x > -207 && x < -201)) continue;
      railRun(x, -27.2, 0, 0, 1);
    }
    for (let z = -35; z <= 7; z += 2.6) {
      if (z > -4.4 && z < 2.4) continue;
      railRun(-196.85, z, 0, 0, 1); railRun(-199.15, z, 0, 0, 1);
    }
    railPosts.count = qi;
    core.add(railPosts);

    // ---- LEAVES: instanced wind-swaying discs around each crown ----
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
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 48);
    {
      const crowns = [
        [-214, -14.5, 14.2, 7.5, 12], [-229, -27, 11.5, 5.8, 8], [-204, -27, 12, 5.5, 8],
        [-226, -6, 13, 6, 8], [-198, -1, 12.5, 5.2, 7], [-218, -37, 11.5, 4.8, 6],
      ];
      let li = 0;
      for (const [lx, lz, ly, lr, n] of crowns)
        for (let i = 0; i < n; i++) {
          const a = rand(0, Math.PI * 2), d = rand(0, lr);
          const sc = rand(2.2, 3.6);
          e.set(-Math.PI / 2 + rand(-0.45, 0.45), rand(0, 6.28), rand(-0.45, 0.45));
          q.setFromEuler(e);
          mtx.compose(v.set(lx + Math.cos(a) * d, ly + rand(-0.8, 1.2), lz + Math.sin(a) * d),
            q, s.set(sc, sc, 1));
          leaves.setMatrixAt(li++, mtx);
        }
      leaves.count = li;
    }
    core.add(leaves);
    this.updaters.push((dt) => { leafMat.uniforms.uT.value += dt; });
    // far canopy masses beyond the dome — billboard quads + bbox proxies
    const leafBillboard = new THREE.MeshBasicMaterial({ color: 0x2c4a28, transparent: true, opacity: 0.85 });
    for (const [bx, bz] of [[-258, -22], [-176, -30], [-214, -74]]) {
      const hi = new THREE.Group();
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(cachedBox(9, 11, 0.1), leafBillboard);
        b.position.set(bx + rand(-10, 10), rand(6, 15), bz + rand(-10, 10));
        b.rotation.y = rand(0, Math.PI);
        hi.add(b);
      }
      core.add(lodNode(hi, bboxProxy(hi, 0x2c4a28), 50));
    }

    // ---- ground cover: instanced ferns + glowing mushrooms ----
    const ferns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.55, 0.95, 5),
      new THREE.MeshStandardMaterial({ color: 0x35602c, roughness: 0.9, flatShading: true }), 90);
    for (let i = 0; i < 90; i++) {
      const fx = rand(X0 + 2, X1 - 2), fz = rand(Z0 + 2, Z1 - 2);
      put(ferns, i, fx, 0.47, fz, rand(0, 6), rand(0.7, 1.5), rand(0.7, 1.5), rand(0.7, 1.5));
    }
    cell(cx, cz).add(ferns);
    const shroomStem = new THREE.InstancedMesh(cachedBox(0.09, 0.3, 0.09),
      new THREE.MeshStandardMaterial({ color: 0xcfc4a4, roughness: 0.8 }), 24);
    const shroomCap = new THREE.InstancedMesh(cachedBox(0.32, 0.1, 0.32), MAT.led(0x6fe8c8, 1.3), 24);
    for (let i = 0; i < 24; i++) {
      const mx2 = rand(X0 + 3, X1 - 3), mz2 = rand(Z0 + 3, Z1 - 3);
      put(shroomStem, i, mx2, 0.15, mz2, rand(0, 6), 1, rand(0.7, 1.4), 1);
      put(shroomCap, i, mx2, 0.34, mz2, rand(0, 6), rand(1, 1.6), rand(0.8, 1.2), rand(1, 1.6));
    }
    cell(cx, cz).add(shroomStem, shroomCap);
    // mossy boulders for the lower fight
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x46523c, roughness: 0.9, flatShading: true }), 10);
    [[-231, -33, 1.3], [-221, -18, 1.5], [-208, -12, 1.2], [-196, -31, 1.4], [-224, -33, 1.1],
      [-212, -4, 1.5], [-238, -25, 1.2], [-192, 4, 1.3], [-226, -21, 1.0], [-202, -20, 1.4]]
      .forEach(([rx, rz, sc], i) => {
        put(rocks, i, rx, sc * 0.5, rz, rand(0, 6), sc, sc * 0.75, sc);
        world.addBox(new THREE.Vector3(rx - sc * 0.65, 0, rz - sc * 0.65), new THREE.Vector3(rx + sc * 0.65, sc * 1.0, rz + sc * 0.65));
      });
    core.add(rocks); rc.push(rocks);

    // ---- lower plank routes: sparse single-file paths through the dark ----
    const planks = new THREE.InstancedMesh(cachedBox(2.25, 0.09, 1.7), MAT.wood, 70);
    {
      let pi2 = 0;
      for (let x = -237; x <= -191; x += 2.05) put(planks, pi2++, x, 0.05, -18);
      for (let z = -38; z <= 6; z += 2.05) put(planks, pi2++, -214, 0.05, z);
      for (let x = -236; x <= -192; x += 2.05) put(planks, pi2++, x, 0.05, 6.2);
      planks.count = pi2;
    }
    cell(cx, cz).add(planks);
    const lampPosts = new THREE.InstancedMesh(cachedBox(0.09, 3.2, 0.09), barkMat, 12);
    const lampHeads = new THREE.InstancedMesh(cachedBox(0.22, 0.22, 0.22), MAT.led(0xffcf7a, 1.8), 12);
    for (let i = 0; i < 12; i++) {
      const lx2 = -236 + i * 4.3;
      put(lampPosts, i, lx2, 1.6, i % 2 ? -16.6 : -19.4);
      put(lampHeads, i, lx2, 3.25, i % 2 ? -16.6 : -19.4);
    }
    cell(cx, cz).add(lampPosts, lampHeads);

    // ---- bounce pads: ground -> boardwalk launches (keep the pattern) ----
    const padMat = new THREE.MeshStandardMaterial({ color: 0x1d4438, emissive: 0x2affc8, emissiveIntensity: 0.65, roughness: 0.5 });
    const pads = [];
    for (const [px, pz] of [[-231, -9.5], [-192.5, -33.5], [-220, -35], [-200.5, 5]]) {
      const pad = new THREE.Mesh(cachedBox(1.7, 0.36, 1.7), padMat);
      pad.position.set(px, 1.0, pz);
      pad.userData.tag = 'wood';
      cell(px, pz).add(pad); rc.push(pad);
      const base = new THREE.Mesh(cachedBox(1.6, 0.22, 1.6), alloy);
      base.position.set(px, 0.11, pz);
      cell(px, pz).add(base);
      world.addBox(new THREE.Vector3(px - 0.85, 0, pz - 0.85), new THREE.Vector3(px + 0.85, 1.18, pz + 0.85));
      this.bouncePads.push({ x: px, z: pz, r: 1.7, top: 1.18, power: 17.6 });
      pads.push(pad);
    }
    this.updaters.push(() => {
      const t = performance.now() / 1000;
      pads.forEach((pad, i) => { pad.scale.y = 1 + Math.sin(t * 3 + i) * 0.25; });
    });

    // ---- mecha-bugs: drifting point field + instanced glowing shells ----
    const bugsField = pointField(70, X0 + 2, X1 - 2, 1, 13, Z0 + 2, Z1 - 2,
      { size: 1.35, color: 0x7fe85a, fall: -0.5, drift: 2.2, seed: 7 });
    core.add(bugsField.pts);
    const bugShell = new THREE.InstancedMesh(cachedBox(0.65, 0.4, 1.05),
      new THREE.MeshStandardMaterial({ color: 0x1c2e1c, emissive: 0x54e05a, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.5 }), 6);
    const bugWing = new THREE.InstancedMesh(cachedBox(1.7, 0.04, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xa8f0b0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }), 6);
    bugShell.frustumCulled = false;                         // matrices move per-frame
    bugWing.frustumCulled = false;
    core.add(bugShell, bugWing);
    this.updaters.push((dt) => {
      bugsField.mat.uniforms.uT.value += dt;
      const t = performance.now() / 1000;
      for (let i = 0; i < 6; i++) {
        const a = t * (0.25 + i * 0.07) + i * 1.047;
        const r = 14 + (i % 3) * 5;
        put(bugShell, i, cx + Math.cos(a) * r, 5 + (i % 4) * 1.6 + Math.sin(t * 2 + i) * 0.7, cz + Math.sin(a) * r, -a);
        put(bugWing, i, cx + Math.cos(a) * r, 5.3 + (i % 4) * 1.6 + Math.sin(t * 2 + i) * 0.7, cz + Math.sin(a) * r, -a + Math.sin(t * 9 + i) * 0.4);
      }
      bugShell.instanceMatrix.needsUpdate = true;
      bugWing.instanceMatrix.needsUpdate = true;
    });

    // ---- additive sunbeams raking down through the glass ----
    for (const [sx, sz, sh, tilt] of [[-222, -20, 15, 0.1], [-205, -8, 16, -0.14], [-195, -24, 15, 0.18], [-228, -2, 14, -0.08]]) {
      const bm = new THREE.Mesh(new THREE.ConeGeometry(4.2, sh, 14, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xa8e0a0, transparent: true, opacity: 0.06,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide }));
      bm.position.set(sx, sh / 2, sz);
      bm.rotation.z = tilt;
      core.add(bm);
    }

    const l1 = new THREE.PointLight(0x7fae6a, 100, 54, 2); l1.position.set(cx, 11, cz); scene.add(l1);
    const lg1 = new THREE.PointLight(0x86b878, 60, 46, 2); lg1.position.set(-230, 7, -14); scene.add(lg1);
    const lg2 = new THREE.PointLight(0x86b878, 55, 44, 2); lg2.position.set(-198, 8, 2); scene.add(lg2);
    const l2 = new THREE.PointLight(0xffd89a, 30, 18, 2); l2.position.set(-226, 3, -8); scene.add(l2);
    const l3 = new THREE.PointLight(0xffd89a, 30, 18, 2); l3.position.set(-204, 4, -24); scene.add(l3);
    for (const lx of [-232, -214, -204, -194]) {
      const l = new THREE.PointLight(0xffc87a, 18, 14, 2); l.position.set(lx, 3.1, -18); scene.add(l);
    }

    // four anchors ride the y 6.75 boardwalk network (enemy.js honours the
    // per-anchor y), three stay on the dark forest floor. Boardwalk ones sit
    // on plank/branch-log colliders, clear of the rail-post lines.
    SPAWN_POOLS.canopy = [
      { pos: [-224.5, -24.5], wps: [[-224.5, -24.5], [-221, -21], [-224, -29]] },
      { pos: [-233, -18], wps: [[-233, -18], [-236, -22], [-230, -14]] },
      { pos: [-214, -33], wps: [[-214, -33], [-218, -29], [-214, -37]] },
      { pos: [-222, -14], y: 6.75, wps: [[-222, -14], [-227.5, -14], [-217.8, -14]] },     // main E-W plank run
      { pos: [-198, -23.3], y: 6.75, wps: [[-198, -23.3], [-198, -20.7], [-198, -25.9]] }, // N-S run (mid post gaps)
      { pos: [-223, -7.4], y: 6.75, wps: [[-223, -7.4], [-220, -9.5], [-226, -5.5]] },     // 3.5 m T3->T4 branch log
      { pos: [-214.5, -14], y: 6.75, wps: [[-214.5, -14], [-210.5, -14], [-217.5, -14]] }, // T3 corridor deck
    ];
  }

}
