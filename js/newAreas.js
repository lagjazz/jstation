// ============================================================
// newAreas.js — the six themed worlds of MISSIONS 04–09
// (spec: moremaps.md), procedural and zero-asset like the rest:
//   cyber     電脳九龍  neon alley: holo ads (custom shader), breakable
//             neon panels, instanced cables/pipes, flying-vehicle streaks
//   moon      月面基地  lunar dome: LOW GRAVITY (player mod), rotating
//             centrifuge, drifting debris, blinking alarms, airlock door
//             opened by SHOOTING its wall switch (auto-opens as a failsafe)
//   tomb      黄金の墓  golden tomb: hieroglyph sandstone, torchlit
//             flicker, sarcophagus, gold heaps (metallic PBR)
//   skyport   天空港    airship harbor: gantry deck ringed by INVISIBLE
//             air walls (the cloud sea is a view, not a walkway),
//             breathing balloons, turning gears, STEAM VENTS that launch
//             the player
//   lab       量子実験室 quantum lab: white minimal hall, pulsing quantum
//             core, mirror wall; the core's EMP pulses glitch the HUD
//   atlantis  沈没大陸  sunken ruins: animated CAUSTICS shader overlay,
//             drifting fish, bubbles, blue murk (player mods underwater)
// Every world is a SEALED big room (44–52 m across — deliberately roomy),
// all outside the train corridor band (z 24..31) so the commuter line can
// never drive through a mission arena. Walls/props are colliders AND
// raycast meshes (nothing is walkable or shootable through), and
// `bounds` exports each interior rect so game.js can run a containment
// guard (player never leaks out of its own map) and enemy.js an
// anti-stuck guard (no invisible unhittable shooter soft-locking a wave).
// THEME_BG holds procedural equirect backgrounds swapped per mission.
// ============================================================

import * as THREE from 'three';
import { MAT } from './materials.js';
import { TEX } from './textures.js';
import { addBox, makeSign, cachedBox } from './build.js';
import { SPAWN_POOLS } from './enemy.js';
import { rand, randPick, chance } from './utils.js';
import { ChunkGrid, lodNode, bboxProxy } from './mapChunks.js';

// ---------------- tiny canvas texture kit (local to these worlds) ----------------
const _tc = {};
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, x: c.getContext('2d') };
}
export function tex(key, factory, { repeat = [1, 1], srgb = true } = {}) {
  if (!_tc[key]) {
    const t = new THREE.CanvasTexture(factory().c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    _tc[key] = t;
  }
  return _tc[key];
}

export function floor(scene, rc, { w, d, x, z, mat, y = 0.015 }) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  f.rotation.x = -Math.PI / 2;
  f.position.set(x, y, z);
  f.receiveShadow = true;
  f.userData.tag = 'concrete';
  scene.add(f);
  rc.push(f);
}

export function walls(scene, world, rc, { x0, x1, z0, z1, h, mat }) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  addBox(scene, { w: x1 - x0 + 1, h, d: 0.5, mat, x: cx, y: h / 2, z: z0 - 0.25, collide: world, raycast: rc });
  addBox(scene, { w: x1 - x0 + 1, h, d: 0.5, mat, x: cx, y: h / 2, z: z1 + 0.25, collide: world, raycast: rc });
  addBox(scene, { w: 0.5, h, d: z1 - z0 + 1, mat, x: x0 - 0.25, y: h / 2, z: cz, collide: world, raycast: rc });
  addBox(scene, { w: 0.5, h, d: z1 - z0 + 1, mat, x: x1 + 0.25, y: h / 2, z: cz, collide: world, raycast: rc });
}

// ---------------- animated shaders ----------------
const HOLO_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HOLO_FRAG = /* glsl */`
uniform float uT; uniform vec3 uC1; uniform vec3 uC2;
varying vec2 vUv;
void main() {
  float flow = fract(vUv.y * 3.0 - uT * 0.35);
  float scan = step(0.55, fract(vUv.y * 42.0 - uT * 2.2));
  float flick = 0.78 + 0.22 * sin(uT * 13.0 + sin(uT * 3.1) * 4.0);
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x)
             * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
  float a = edge * flick * (0.30 + 0.45 * flow * flow + 0.18 * scan);
  vec3 c = mix(uC1, uC2, 0.5 + 0.5 * sin(vUv.y * 6.28 + uT));
  gl_FragColor = vec4(c * 1.8, a * 0.9);
}`;
const CAUSTIC_FRAG = /* glsl */`
uniform float uT; uniform float uI;
varying vec2 vUv;
float w(vec2 p) { return sin(p.x + uT) * cos(p.y * 1.3 - uT * 0.8) + sin((p.x + p.y) * 0.9 + uT * 1.3); }
void main() {
  vec2 uv = vUv * 16.0;
  float c = w(uv) * 0.5 + w(uv * 1.7 + 7.0) * 0.5;
  c = pow(max(0.0, c * 0.5 + 0.5), 4.0);
  gl_FragColor = vec4(vec3(0.22, 0.72, 1.0) * c * uI, c * 0.55 * uI);
}`;
export function holoMat(c1, c2) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) } },
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
export function causticMat(intensity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uI: { value: intensity } },
    vertexShader: HOLO_VERT, fragmentShader: CAUSTIC_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// ---------------- procedural equirect backgrounds (per-mission swap) ----------------
export const THEME_BG = (() => {
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
  B.space = mk((x) => {
    x.fillStyle = '#01020a'; x.fillRect(0, 0, 1024, 512);
    stars(x, 900, 0.9);
    const g = x.createRadialGradient(720, 300, 20, 720, 300, 110);
    g.addColorStop(0, '#9fd0ff'); g.addColorStop(0.35, '#2f6fd0');
    g.addColorStop(0.7, '#123a80'); g.addColorStop(1, '#050b1c');
    x.fillStyle = g; x.beginPath(); x.arc(720, 300, 110, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 40; i++) {
      x.beginPath();
      x.ellipse(660 + Math.random() * 120, 240 + Math.random() * 120, rand(6, 26), rand(2, 7), rand(0, 3), 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = 'rgba(120,180,255,0.12)';
    x.beginPath(); x.arc(720, 300, 128, 0, Math.PI * 2); x.fill();
  });
  B.cloud = mk((x) => {
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#cfe0ee'); g.addColorStop(0.45, '#8fa4b8');
    g.addColorStop(0.62, '#5f6f80'); g.addColorStop(1, '#2c343e');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = 'rgba(255,236,190,0.9)';
    x.beginPath(); x.arc(300, 90, 42, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 90; i++) {
      x.beginPath();
      x.ellipse(Math.random() * 1024, 300 + Math.random() * 190, rand(30, 130), rand(6, 18), 0, 0, Math.PI * 2);
      x.fill();
    }
  });
  B.deep = mk((x) => {
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#1a5f7a'); g.addColorStop(0.4, '#0b3550'); g.addColorStop(1, '#03101c');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = 'rgba(140,220,255,0.08)';
    for (let i = 0; i < 30; i++) x.fillRect(rand(0, 1024), rand(0, 300), rand(20, 90), rand(60, 200));
  });
  B.neon = mk((x) => {
    x.fillStyle = '#07040e'; x.fillRect(0, 0, 1024, 512);
    stars(x, 60, 0.25);
    const cols = ['#ff2b6d', '#00e5ff', '#a855f7', '#22ff88'];
    for (let i = 0; i < 18; i++) {
      const c = randPick(cols);
      x.fillStyle = c + '18';
      x.beginPath(); x.arc(Math.random() * 1024, rand(120, 420), rand(40, 140), 0, Math.PI * 2); x.fill();
    }
  });
  B.dark = mk((x) => {
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#0a0c12'); g.addColorStop(1, '#04050a');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  });
  return B;
})();

export class NewAreas {
  constructor(scene, world, particles) {
    this.scene = scene;
    this.groups = {};
    this.world = world;
    this.p = particles;
    this.raycastMeshes = [];
    this.areaLights = [];
    this.updaters = [];
    this.vents = [];              // skyport steam vents: {x,z,r,power}
    this.doors = [];              // moon airlock doors (switch-opened)
    this.bounds = {};             // per-area interior rect (containment + anti-stuck guard)
    this.grids = {};              // per-area ChunkGrid (chunk-based visibility)
    this._vd = {};                // per-area chunk view distance (meters)
    this.quicksand = [];          // tomb: slow zones {x,z,r}
    this.currents = [];           // atlantis: current-jet lanes {x,z,dx,dz,r,power}
    this.fallTraps = [];          // tomb: shootable rockfall triggers {mesh,col,rock,falling,t}
  }

  // ---- chunk plumbing (moremaps2.md: chunk-based big-map loading) ----
  _grid(area, { x0, z0, x1, z1 }, cell = 17) {
    const g = new ChunkGrid(this._g(area), x0, z0, x1, z1, cell);
    this.grids[area] = g;
    return g;
  }
  /** Chunk group a prop at (x,z) belongs to. */
  _cell(area, x, z) { const g = this.grids[area]; return g ? g.at(x, z) : this._g(area); }
  /** Always-rendered core group of an area (backdrops, spanning InstancedMesh). */
  _core(area) { const g = this.grids[area]; return g ? g.core : this._g(area); }
  setViewDist(area, vd) { this._vd[area] = vd; }

  /** Shot a boulder trigger? Its rock starts falling. True if handled. */
  dropFallTrap(mesh) {
    const t = this.fallTraps.find((f) => f.mesh === mesh);
    if (!t || t.falling) return false;
    t.falling = true; t.t = 0;
    if (t.trigCol) { t.trigCol.min.set(-10000, 0, 0); t.trigCol.max.set(-9999, 3, 1); }
    return true;
  }

  build() {
    this._cyber();
    this._moon();
    this._tomb();
    this._skyport();
    this._lab();
    this._atlantis();
  }

  update(dt, ctx) {
    for (const u of this.updaters) u(dt);
    if (ctx && ctx.feet) {
      for (const [a, g] of Object.entries(this.grids)) {
        if (this.groups[a] && this.groups[a].visible) g.update(ctx.feet.x, ctx.feet.z, this._vd[a] ?? 150);
      }
    }
  }

  /** Shot a wall switch? Opens its linked door. Returns true if handled. */
  openSwitch(mesh) {
    const d = mesh.userData.switchDoor;
    if (d == null) return false;
    const door = this.doors[d];
    if (!door || door.open) return true;
    door.open = true;
    return true;
  }

  // ================= MISSION 04 · 電脳九龍 · 44 × 50 m =================

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
  _cyber() {
    const G = this._g('cyber');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -130, X1 = -86, Z0 = -30, Z1 = 20;
    this.bounds.cyber = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('cyber', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('cyber');
    const cell = (x, z) => this._cell('cyber', x, z);

    // ---- wet asphalt: dark, roughness 0.15 + clearcoat, so the alley mirrors
    // the neon stacked above it (the rain-slick mirror is THIS world's signature)
    const asphalt = tex('wetasphalt', () => {
      const { c, x } = canvas(512, 512);
      x.fillStyle = '#0d0f14'; x.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 130; i++) {
        const g = rand(16, 44) | 0;
        x.fillStyle = `rgba(${g},${g + 4},${g + 12},0.5)`;
        x.fillRect(rand(0, 470), rand(0, 470), rand(12, 84), rand(2, 6));
      }
      x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 2;
      for (let i = 0; i <= 3; i++) {
        x.beginPath(); x.moveTo(0, i * 168 + rand(0, 30)); x.lineTo(512, i * 168 + rand(0, 30)); x.stroke();
      }
      return { c, x };
    }, { repeat: [7, 8] });
    const wet = new THREE.MeshPhysicalMaterial({
      map: asphalt, roughness: 0.28, metalness: 0.12,
      envMapIntensity: 1.0, clearcoat: 0.4, clearcoatRoughness: 0.22,
    });
    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: (X0 + X1) / 2, z: (Z0 + Z1) / 2, mat: wet });
    // 30 m shell: a slot-canyon of towers, not a plaza (perimeter sealed all sides)
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 30, mat: MAT.concreteDark });

    // ---- tower blocks flank narrow alleys: main alley (z -23..-9, 14 m),
    // two 6 m cross-alleys, a 7 m back-alley (z 1..8) behind the middle row
    for (const [bx0, bx1, bz0, bz1, h] of [
      [-130, -116, -30, -23, 24], [-110, -100, -30, -23, 28], [-94, -86, -30, -23, 21],
      [-130, -116, -9, 1, 26], [-110, -100, -9, 1, 20], [-94, -86, -9, 1, 27],
      [-130, -118, 10, 20, 30], [-112, -98, 10, 20, 25], [-92, -86, 10, 20, 28],
    ]) {
      addBox(cell((bx0 + bx1) / 2, (bz0 + bz1) / 2), { w: bx1 - bx0, h, d: bz1 - bz0, mat: MAT.concreteDark,
        x: (bx0 + bx1) / 2, y: h / 2, z: (bz0 + bz1) / 2, collide: world, raycast: rc });
    }

    // ---- multi-level fighting: continuous scaffold walkways at y=4.5 along
    // both main-alley facades, an upper tier at 9 on the north side, and two
    // overhead bridges. Ground reach: stacked 0.45 m slab stairs + vent updrafts.
    const deck = MAT.painted(0x4c5560);
    const plank = (x0, x1, z, yTop) => addBox(cell((x0 + x1) / 2, z), { w: x1 - x0, h: 0.3, d: 2.4, mat: deck,
      x: (x0 + x1) / 2, y: yTop - 0.15, z, collide: world, raycast: rc, tag: 'metal' });
    const segs = [[-129, -117], [-109, -101], [-95, -87]];
    for (const [x0, x1] of segs) { plank(x0, x1, -21.8, 4.5); plank(x0, x1, -10.2, 4.5); }
    plank(-127, -117, -22, 9); plank(-109, -95, -22, 9);
    for (const bx of [-113, -97])
      addBox(cell(bx, -16), { w: 2.6, h: 0.3, d: 14, mat: deck, x: bx, y: 8.85, z: -16, collide: world, raycast: rc, tag: 'metal' });
    const stair = (x, z, n, fromY = 0) => {           // stacked columns: step i tops at fromY + i*0.45
      for (let i = 1; i <= n; i++) {
        const h = fromY + i * 0.45;
        addBox(cell(x + i * 0.62, z), { w: 0.62, h, d: 1.7, mat: deck,
          x: x + i * 0.62, y: h / 2, z, collide: world, raycast: rc, tag: 'metal' });
      }
    };
    stair(-128.4, -21.8, 10);                          // ground -> lower walkway (north facade)
    stair(-126.6, -10.2, 10);                          // ground -> lower walkway (south facade)
    stair(-108.6, -22, 10, 4.5);                       // lower -> upper tier (columns rise through deck A)

    // vent updrafts launch the player straight onto the walkways
    for (const [vx, vz] of [[-121, -20.3], [-105.5, -11.7]]) {
      addBox(cell(vx, vz), { w: 1, h: 0.3, d: 1, mat: MAT.metalDark, x: vx, y: 0.15, z: vz, collide: world, raycast: rc, tag: 'metal' });
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.45, 8), MAT.painted(0xb8863a));
      nz.position.set(vx, 0.52, vz);
      cell(vx, vz).add(nz);
      this.vents.push({ x: vx, z: vz, r: 1.4, power: 15 });
    }

    // ---- instanced families (one draw call each, per moremaps1 §1 perf note)
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const put = (im, i, px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };
    // facade windows, warm + cyan, on the four alley-facing lines
    const winGeo = new THREE.PlaneGeometry(1.1, 1.5);
    const winWarm = new THREE.InstancedMesh(winGeo, MAT.led(0xffc86a, 1.2), 44);
    const winCyan = new THREE.InstancedMesh(winGeo, MAT.led(0x58e0ff, 1.5), 26);
    const faces = [
      { z: -22.92, ry: 0, xs: [[-130, -116], [-110, -100], [-94, -86]], hs: [24, 28, 21] },
      { z: -9.08, ry: Math.PI, xs: [[-130, -116], [-110, -100], [-94, -86]], hs: [26, 20, 27] },
      { z: 1.08, ry: 0, xs: [[-130, -116], [-110, -100], [-94, -86]], hs: [26, 20, 27] },
      { z: 9.92, ry: Math.PI, xs: [[-130, -118], [-112, -98], [-92, -86]], hs: [30, 25, 28] },
    ];
    let wi = 0, ci = 0;
    for (const f of faces) for (let b = 0; b < 3; b++) {
      const [bx0, bx1] = f.xs[b];
      for (let k = 0; k < Math.floor((bx1 - bx0) / 2.6); k++) {
        const px = rand(bx0 + 1, bx1 - 1), py = rand(2.2, f.hs[b] - 2);
        if (chance(0.35) && ci < 26) put(winCyan, ci++, px, py, f.z, f.ry);
        else if (wi < 44) put(winWarm, wi++, px, py, f.z, f.ry);
      }
    }
    winWarm.count = wi; winCyan.count = ci;
    core.add(winWarm, winCyan);
    // AC boxes on the main-alley facades
    const acs = new THREE.InstancedMesh(cachedBox(0.75, 0.55, 0.5), MAT.metalDark, 18);
    let ai = 0;
    for (const az of [-22.75, -9.25])
      for (let k = 0; k < 9; k++) put(acs, ai++, rand(X0 + 3, X1 - 3), rand(3, 13), az);
    acs.count = ai;
    // vertical pipes at block corners + sagging overhead cable runs
    const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 7), MAT.metalDark, 12);
    for (let i = 0; i < 12; i++) {
      const [px, pz, ph] = [[-116.3, -23.3, 12], [-110.3, -23.3, 14], [-94.3, -23.3, 11],
        [-116.3, -9.7, 13], [-110.3, -9.7, 10], [-94.3, -9.7, 12], [-129.3, -23.3, 15],
        [-87.3, -23.3, 13], [-116.3, 0.3, 12], [-110.3, 0.3, 10], [-129.3, 0.7, 14], [-87.3, 9.7, 12]][i];
      q.identity();
      mtx.compose(v.set(px, ph / 2, pz), q, s.set(1, ph, 1));
      pipes.setMatrixAt(i, mtx);
    }
    const cables = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), MAT.plasticBlack, 24);
    let ki = 0;
    for (const [cz0, cy] of [[-21.5, 11], [-18.8, 13], [-13.5, 12.5], [-10.5, 14]])
      for (let k = 0; k < 6; k++) {
        const sag = Math.sin(((k + 0.5) / 6) * Math.PI) * 1.6;
        e.set(0, 0, Math.PI / 2 + rand(-0.08, 0.08)); q.setFromEuler(e);
        mtx.compose(v.set(X0 + 6.6 + k * 7.2, cy - sag, cz0), q, s.set(1, 7.5, 1));
        cables.setMatrixAt(ki++, mtx);
      }
    // lanterns under the walkway lip + balcony posts on the deck edges
    const lants = new THREE.InstancedMesh(cachedBox(0.2, 0.2, 0.2), MAT.led(0xffc26a, 1.6), 24);
    let li = 0;
    for (const [x0, x1] of segs) for (let x = x0 + 2; x < x1; x += 3) {
      put(lants, li++, x, 4.05, -20.45, 0.4);
      put(lants, li++, x, 4.05, -11.55, 0.4);
    }
    lants.count = li;
    const rails = new THREE.InstancedMesh(cachedBox(0.08, 1, 0.08), MAT.rail, 72);
    let ri = 0;
    for (const [x0, x1, rz, yt] of [[-129, -117, -20.55, 4.5], [-109, -101, -20.55, 4.5], [-95, -87, -20.55, 4.5],
      [-129, -117, -11.45, 4.5], [-109, -101, -11.45, 4.5], [-95, -87, -11.45, 4.5],
      [-127, -117, -20.75, 9], [-109, -95, -20.75, 9]])
      for (let x = x0 + 1; x < x1; x += 1.6) put(rails, ri++, x, yt + 0.5, rz);
    rails.count = ri;
    core.add(acs, pipes, cables, lants, rails);
    // neon trims hugging the facades (two colors, instanced) + vertical strips
    const neonCols = [0xff2b6d, 0x00e5ff, 0xa855f7, 0x22ff88, 0xffb400];
    const trimA = new THREE.InstancedMesh(cachedBox(1, 0.16, 0.06), MAT.led(0x00e5ff, 1.7), 16);
    const trimB = new THREE.InstancedMesh(cachedBox(1, 0.16, 0.06), MAT.led(0xff2b6d, 1.7), 16);
    let ta = 0, tb = 0;
    for (const [x0, x1] of segs) for (const [fz, fry] of [[-22.9, 0], [-9.1, Math.PI]]) {
      const y = rand(2.2, 6.5);
      if (chance(0.5) && ta < 16) put(trimA, ta++, (x0 + x1) / 2, y, fz, fry, x1 - x0);
      else if (tb < 16) put(trimB, tb++, (x0 + x1) / 2, y, fz, fry, x1 - x0);
    }
    trimA.count = ta; trimB.count = tb;
    const strips = new THREE.InstancedMesh(cachedBox(0.18, 1, 0.06), MAT.led(0x22ff88, 1.7), 12);
    for (let i = 0; i < 12; i++) {
      const [x, z, sh] = [[-129.7, -26, 9], [-129.7, -12, 8], [-129.7, 3, 9], [-116.2, -24.5, 7],
        [-109.8, -13, 6], [-99.8, -18, 7], [-93.8, -27, 6], [-86.3, -24, 9], [-86.3, -12, 8],
        [-86.3, 12, 9], [-91.8, 9.7, 7], [-111.8, 9.7, 7]][i];
      put(strips, i, x, 1 + sh / 2, z, Math.PI / 2, 1, sh, 1);
    }
    core.add(trimA, trimB, strips);

    // breakable neon lightboxes at chest/head height — a glass-tag hit
    // shatters them (game.js hides the mesh; sparks already routed there)
    for (const [bx, bz, ry] of [
      [-124, -22.72, 0], [-118.4, -22.72, 0], [-106.5, -22.72, 0], [-91.5, -22.72, 0],
      [-122.5, -9.28, Math.PI], [-107.5, -9.28, Math.PI], [-95.5, -9.28, Math.PI],
      [-115.72, -27, Math.PI / 2], [-110.28, -12.5, -Math.PI / 2],
      [-99.72, -16, Math.PI / 2], [-94.28, -25.5, -Math.PI / 2], [-115.72, 4.5, Math.PI / 2],
    ]) {
      const m = addBox(cell(bx, bz), { w: 1.5, h: 2, d: 0.35, mat: MAT.led(randPick(neonCols), 1.5),
        x: bx, y: 1.7, z: bz, rotY: ry, cast: false, raycast: rc, tag: 'glass' });
      m.userData.shatter = true;
    }

    // kanji signs bolted to the facades
    makeSign(cell(-124, -23), { tex: TEX.hangingSign('電脳九龍', 'CYBER KOWLOON', '#12061e', ''), w: 3.4, h: 0.85, x: -124, y: 6.4, z: -22.6, rotY: 0, intensity: 1.4 });
    makeSign(cell(-104, -23), { tex: TEX.hangingSign('夜市', 'NEON MARKET', '#1b0512', '→'), w: 2.6, h: 0.75, x: -104, y: 5.4, z: -22.6, intensity: 1.3 });
    makeSign(cell(-100, -16), { tex: TEX.hangingSign('龍', 'DRAGON BAR', '#04141c', ''), w: 1.4, h: 1.4, x: -99.85, y: 5.6, z: -16, rotY: Math.PI / 2, intensity: 1.5 });
    makeSign(cell(-87, -14), { tex: TEX.hangingSign('九龍', 'SECTOR 04', '#04141c', '←'), w: 2.6, h: 0.75, x: -86.35, y: 5.8, z: -14, rotY: -Math.PI / 2, intensity: 1.3 });
    makeSign(cell(-104, -9), { tex: TEX.hangingSign('ホテル', 'LOVE HOTEL 4F', '#20061a', '↑'), w: 2.8, h: 0.75, x: -104, y: 5.2, z: -9.35, rotY: Math.PI, intensity: 1.3 });
    makeSign(cell(-128, -9), { tex: TEX.hangingSign('濡街', 'WET STREET', '#041424', ''), w: 2.4, h: 0.7, x: -128, y: 5, z: -9.35, rotY: Math.PI, intensity: 1.2 });

    // ---- ten big hologram ads stacked up the facades (flowing shader ads)
    const holos = [];
    for (const [x, y, z, ry, c1, c2, w, h] of [
      [-124, 11.5, -22.6, 0, 0xff2b6d, 0x00e5ff, 4.6, 6.2],
      [-117.5, 13.5, -22.6, 0, 0x22ff88, 0xa855f7, 3.6, 4.8],
      [-104.5, 11, -22.6, 0, 0x00e5ff, 0xffb400, 4.8, 5.6],
      [-90, 13, -22.6, 0, 0xa855f7, 0x22ff88, 4.4, 5.4],
      [-121, 17, -22.6, 0, 0x00e5ff, 0x22ff88, 4.4, 5.6],
      [-113, 15.5, -22.6, 0, 0xffb400, 0xff2b6d, 6, 7],
      [-122, 10.5, -9.4, Math.PI, 0xff2b6d, 0xffb400, 4, 5.2],
      [-105, 12.5, -9.4, Math.PI, 0x00e5ff, 0xff2b6d, 5, 6],
      [-97.5, 10.5, -9.4, Math.PI, 0x22ff88, 0x00e5ff, 3.6, 4.6],
      [-103, 16.5, -9.4, Math.PI, 0xa855f7, 0xffb400, 5.2, 6.4],
    ]) {
      const m = holoMat(c1, c2);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      pl.position.set(x, y, z); pl.rotation.y = ry;
      cell(x, z).add(pl);
      holos.push(m);
    }

    // ---- neon pool lights: the spawn lane must read as a glowing alley
    const l1 = new THREE.PointLight(0xff3b7d, 95, 42, 1.9); l1.position.set(-124, 6, -16);
    const l2 = new THREE.PointLight(0x2bd8ff, 95, 42, 1.9); l2.position.set(-103, 6, -16);
    const l3 = new THREE.PointLight(0x9a5dff, 75, 34, 1.9); l3.position.set(-113, 6, 2);
    const l4 = new THREE.PointLight(0x35e0c0, 75, 36, 1.9); l4.position.set(-90, 6, -16);
    const l5 = new THREE.PointLight(0xffc26a, 60, 30, 1.9); l5.position.set(-121, 5, 4.5);
    scene.add(l1, l2, l3, l4, l5);
    this.areaLights.push(l1, l2, l3, l4, l5);

    // ---- far skyline silhouettes outside the shell: hi box clusters with a
    // bboxProxy stand-in past 55 m (mapChunks LOD)
    for (const [gx, gz, n] of [[-72, -18, 5], [-70, 8, 4], [-108, -44, 6], [-146, -6, 5]]) {
      const hi = new THREE.Group();
      for (let i = 0; i < n; i++) {
        const t = new THREE.Mesh(cachedBox(rand(4, 9), rand(14, 30), rand(4, 9)), MAT.concreteDark);
        t.position.set(gx + rand(-9, 9), rand(7, 15), gz + rand(-9, 9));
        hi.add(t);
      }
      core.add(lodNode(hi, bboxProxy(hi, 0x10131c), 55));
    }

    // high facade washes so the 30 m canyon walls read from the cross-alleys
    const l6 = new THREE.PointLight(0x2bd8ff, 55, 40, 1.9); l6.position.set(-113, 15, -16);
    const l7 = new THREE.PointLight(0xff3b7d, 55, 40, 1.9); l7.position.set(-95, 13, -14);
    const l8 = new THREE.PointLight(0x9fb8ff, 45, 34, 1.9); l8.position.set(-108, 6, 4); // south-alley wash
    scene.add(l6, l7, l8);
    this.areaLights.push(l6, l7, l8);

    // flying-vehicle streaks crossing the sky lanes above the main alley
    const cars = [];
    for (let i = 0; i < 6; i++) {
      const col = i % 2 ? 0xffc26a : 0x9fd7ff;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(cachedBox(1.5, 0.22, 0.55), MAT.led(col, 3.2)));
      const trail = new THREE.Mesh(cachedBox(6.5, 0.1, 0.3), MAT.led(col, 1.1));
      trail.position.x = -4;
      g.add(trail);
      g.position.set(rand(X0, X1), rand(12, 19), rand(-21, -11));
      core.add(g);
      cars.push({ g, dir: i % 2 ? 1 : -1, sp: rand(10, 17) });
    }

    this.updaters.push((dt) => {
      for (const m of holos) m.uniforms.uT.value += dt;
      for (const c of cars) {
        c.g.position.x += c.dir * c.sp * dt;
        if (c.g.position.x > X1 + 6) c.g.position.x = X0 - 6;
        if (c.g.position.x < X0 - 6) c.g.position.x = X1 + 6;
      }
    });

    SPAWN_POOLS.cyber = [
      { pos: [-124, -16],  wps: [[-124, -16], [-120, -15], [-127.5, -17.5]] },
      { pos: [-113, -19],  wps: [[-113, -19], [-113, -14], [-113, -22.5]] },
      { pos: [-113, -3],   wps: [[-113, -3], [-113, -7], [-113.5, 0.5]] },
      { pos: [-103, -16],  wps: [[-103, -16], [-106, -17], [-99.5, -14.5]] },
      { pos: [-97, -26],   wps: [[-97, -26], [-93.5, -25], [-99, -28.5]] },
      { pos: [-120, 4.5],  wps: [[-120, 4.5], [-116.5, 4.5], [-124, 5.5]] },
      { pos: [-90, 14],    wps: [[-90, 14], [-88, 10.5], [-91.5, 17.5]] },
    ];
  }

  // ================= MISSION 05 · 月面基地 · 44 × 44 m (+ annex) ============

  _moon() {
    const G = this._g('moon');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -34, X1 = 10, Z0 = 36, Z1 = 80;
    // z1 reaches past the airlock into the annex (that side is walled, but
    // the containment guard rect must let the player through once opened)
    this.bounds.moon = { x0: X0, x1: X1, z0: Z0, z1: Z1 + 5.5 };
    this._grid('moon', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('moon');
    const cell = (x, z) => this._cell('moon', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;

    const panel = tex('moonPanel', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#c9cdd2'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = '#8a9096'; x.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke();
        x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke();
      }
      x.fillStyle = 'rgba(90,95,105,0.12)';
      for (let i = 0; i < 30; i++) x.fillRect(rand(0, 240), rand(0, 240), rand(4, 22), rand(4, 8));
      return { c, x };
    }, { repeat: [9, 9] });
    const panelMat = new THREE.MeshStandardMaterial({ map: panel, roughness: 0.8, metalness: 0.05 });
    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: panelMat });

    // ---- dome instead of a flat ceiling: a panelled hemisphere caps the base;
    // outside it is vacuum (the 'space' equirect), nothing beyond is walkable.
    // A slice is cut open above the broken viewport, so shooting through the
    // shattered window really looks out onto the rotating Earth.
    const gap0 = THREE.MathUtils.degToRad(128), gap = Math.PI * 2 - THREE.MathUtils.degToRad(28);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(34, 28, 14, gap0, gap, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: panel, side: THREE.BackSide, roughness: 0.85, metalness: 0.1 }));
    dome.position.set(cx, 0, cz);
    dome.scale.y = 0.5;
    dome.userData.tag = 'metal';
    core.add(dome);
    rc.push(dome);
    // meridian ribs — instanced, squashed with the dome
    const ribs = new THREE.InstancedMesh(new THREE.TorusGeometry(33.5, 0.22, 6, 24, Math.PI), MAT.metal, 12);
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    for (let i = 0; i < 12; i++) {
      e.set(0, i * Math.PI / 6, 0); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(cx, 0, cz), q, new THREE.Vector3(1, 0.5, 1));
      ribs.setMatrixAt(i, mtx);
    }
    core.add(ribs);

    // ---- perimeter walls (9 m), the north one split around the airlock gap
    // (x -26..-23.5) and the shattered viewport (x -6..2, y 2.2..6.2)
    const seg = (x0, x1, y0, y1, z) => addBox(core, { w: x1 - x0, h: y1 - y0, d: 0.5, mat: MAT.concrete,
      x: (x0 + x1) / 2, y: (y0 + y1) / 2, z, collide: world, raycast: rc });
    seg(X0 - 0.5, -26, 0, 9, Z1); seg(-23.5, -6, 0, 9, Z1); seg(2, X1 + 0.5, 0, 9, Z1);
    seg(-26, -23.5, 2.6, 9, Z1);
    seg(-6, 2, 0, 2.2, Z1); seg(-6, 2, 6.2, 9, Z1);
    addBox(core, { w: X1 - X0 + 1, h: 9, d: 0.5, mat: MAT.concrete, x: cx, y: 4.5, z: Z0 - 0.25, collide: world, raycast: rc });
    addBox(core, { w: 0.5, h: 9, d: Z1 - Z0 + 1, mat: MAT.concrete, x: X0 - 0.25, y: 4.5, z: cz, collide: world, raycast: rc });
    addBox(core, { w: 0.5, h: 9, d: Z1 - Z0 + 1, mat: MAT.concrete, x: X1 + 0.25, y: 4.5, z: cz, collide: world, raycast: rc });

    // ---- THE broken viewport: frame + cracked shards, and an invisible air
    // wall sealing the hole (a view onto space, never a walk-out)
    world.addBox(new THREE.Vector3(-6, 2.2, Z1 - 0.3), new THREE.Vector3(2, 6.2, Z1 + 0.3));
    for (const [x0, x1, y0, y1] of [[-6.4, -5.6, 2.2, 6.2], [1.6, 2.4, 2.2, 6.2], [-6.4, 2.4, 1.8, 2.4], [-6.4, 2.4, 6, 6.6]])
      addBox(core, { w: x1 - x0, h: y1 - y0, d: 0.35, mat: MAT.metalDark, x: (x0 + x1) / 2, y: (y0 + y1) / 2,
        z: Z1 - 0.25, collide: world, raycast: rc, tag: 'metal' });
    for (const [sx, sy, sw, sh, tilt] of [[-5.2, 5.5, 1.5, 1.1, 0.5], [-1.2, 5.9, 1.8, 0.8, -0.35],
      [1.4, 4.8, 0.9, 1.3, 0.9], [-2.8, 2.8, 1.4, 0.9, -0.6], [0.4, 3.6, 0.7, 0.6, 0.2]]) {
      const m = new THREE.Mesh(cachedBox(sw, sh, 0.05), MAT.glassPane);
      m.position.set(sx, sy, Z1 - 0.12);
      m.rotation.z = tilt; m.rotation.y = rand(-0.25, 0.25);
      m.userData.tag = 'glass'; m.userData.shatter = true;
      core.add(m); rc.push(m);
    }
    // shattered shards hanging on the frame edge + spidering off it: the
    // broken reinforced-glass read has to land at a glance, not just the
    // five big panes
    const shards = new THREE.InstancedMesh(cachedBox(0.52, 0.74, 0.04), MAT.glassPane, 48);
    {
      let shi = 0;
      const putShard = (sx, sy, tilt) => {
        e.set(rand(-0.12, 0.12), rand(-0.25, 0.25), tilt); q.setFromEuler(e);
        mtx.compose(new THREE.Vector3(sx, sy, Z1 - 0.18), q, new THREE.Vector3(1, 1, 1));
        shards.setMatrixAt(shi++, mtx);
      };
      for (let ex = -5.7; ex <= 1.7; ex += 0.75) {           // top + bottom frame edges
        putShard(ex + rand(-0.2, 0.2), 6.05 + rand(-0.25, 0.1), rand(-0.8, 0.8));
        putShard(ex + rand(-0.2, 0.2), 2.35 + rand(-0.1, 0.25), rand(-0.8, 0.8));
      }
      for (let ey = 2.6; ey <= 5.9; ey += 0.66) {            // left + right frame edges
        putShard(-5.85 + rand(-0.1, 0.2), ey + rand(-0.2, 0.2), Math.PI / 2 + rand(-0.5, 0.5));
        putShard(1.85 + rand(-0.2, 0.1), ey + rand(-0.2, 0.2), Math.PI / 2 + rand(-0.5, 0.5));
      }
      for (const [jx, jy] of [[-3.5, 5.4], [-1, 4.6], [1, 5.6], [-4.6, 3.6], [0.2, 2.9],
        [-2.2, 4.2], [1.2, 3.8], [-5.4, 4.4], [-0.3, 5.9], [-3, 2.5], [1.6, 4.9],
        [-1.8, 5.7], [-4.2, 5.0], [0.7, 3.1], [-2.6, 3.4]])
        putShard(jx + rand(-0.1, 0.1), jy + rand(-0.1, 0.1), rand(-1.2, 1.2));  // spider cracks
      shards.count = shi;
    }
    shards.userData.tag = 'glass';
    core.add(shards); rc.push(shards);
    // slowly rotating Earth (core group, outside bounds, inside fogFar 210)
    const earthTex = tex('earthbig', () => {
      const { c, x } = canvas(512, 256);
      const g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#1a4f9c'); g.addColorStop(0.5, '#2f6fd0'); g.addColorStop(1, '#123a80');
      x.fillStyle = g; x.fillRect(0, 0, 512, 256);
      x.fillStyle = 'rgba(52,130,74,0.9)';
      for (let i = 0; i < 16; i++) {
        x.beginPath();
        x.ellipse(rand(0, 512), rand(40, 216), rand(22, 70), rand(12, 40), rand(0, 3), 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = 'rgba(255,255,255,0.45)';
      for (let i = 0; i < 70; i++) {
        x.beginPath();
        x.ellipse(rand(0, 512), rand(0, 256), rand(14, 46), rand(3, 8), rand(-0.4, 0.4), 0, Math.PI * 2);
        x.fill();
      }
      return { c, x };
    }, { repeat: [2, 1] });
    // unlit: no fixture outside the dome reaches it, and a Standard Earth
    // would sit pitch black in the viewport — sunlit planets read as Basic
    const earth = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 20),
      new THREE.MeshBasicMaterial({ map: earthTex, color: 0xcfe2ff }));
    earth.position.set(0, 22, Z1 + 58);
    core.add(earth);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(41.2, 32, 20),
      new THREE.MeshBasicMaterial({ color: 0x4f9fff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.copy(earth.position);
    core.add(halo);

    // ---- habitat pods: white pressure shells with an inner L-wall each, so
    // the corners become real CQB rooms; each has one 1.5 m door gap
    const podMat = new THREE.MeshStandardMaterial({ color: 0xd7dbdf, roughness: 0.6, metalness: 0.15 });
    const pod = (px, pz, door) => {
      const C = cell(px, pz);
      const W = 5.6, D = 3.4, H = 2.9, t = 0.25, g = 1.5;
      const wall = (w, d, x, z) => addBox(C, { w, h: H, d, mat: podMat, x, y: H / 2, z, collide: world, raycast: rc, tag: 'metal' });
      if (door === 'N') { wall((W - g) / 2, t, px - (W + g) / 4, pz - D / 2 + t / 2); wall((W - g) / 2, t, px + (W + g) / 4, pz - D / 2 + t / 2); }
      else wall(W, t, px, pz - D / 2 + t / 2);
      if (door === 'S') { wall((W - g) / 2, t, px - (W + g) / 4, pz + D / 2 - t / 2); wall((W - g) / 2, t, px + (W + g) / 4, pz + D / 2 - t / 2); }
      else wall(W, t, px, pz + D / 2 - t / 2);
      if (door === 'E') { wall(t, (D - g) / 2, px + W / 2 - t / 2, pz - (D + g) / 4); wall(t, (D - g) / 2, px + W / 2 - t / 2, pz + (D + g) / 4); }
      else wall(t, D - 2 * t, px + W / 2 - t / 2, pz);
      if (door === 'W') { wall(t, (D - g) / 2, px - W / 2 + t / 2, pz - (D + g) / 4); wall(t, (D - g) / 2, px - W / 2 + t / 2, pz + (D + g) / 4); }
      else wall(t, D - 2 * t, px - W / 2 + t / 2, pz);
      wall(2.0, 0.25, px - 0.6, pz - 0.5);            // inner L → corner room
      wall(0.25, 1.2, px + 0.7, pz + 0.2);
      addBox(C, { w: W + 0.3, h: 0.35, d: D + 0.3, mat: MAT.metalDark, x: px, y: H + 0.17, z: pz, cast: false });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.6), MAT.screen(TEX.infoScreen, 0.5));
      scr.position.set(px, 1.5, pz + D / 2 - t - 0.03);
      scr.rotation.y = Math.PI;
      C.add(scr);
    };
    pod(-27, 44, 'E'); pod(-2, 44, 'W'); pod(-29, 68, 'N'); pod(0, 66, 'W'); pod(-19.5, 74, 'S');

    // ---- THE centrifuge: walkable support ring (top y=1.2, four deck
    // segments + 0.4 m step boxes) and a slow-spinning rotor overhead:
    // torus + spokes + three rim cabins riding the hub
    const ringDeck = MAT.painted(0x8f9aa6);
    for (const [w, d, x, z] of [[17.6, 2.8, cx, cz - 7.4], [17.6, 2.8, cx, cz + 7.4],
      [2.8, 12, cx - 7.4, cz], [2.8, 12, cx + 7.4, cz]])
      addBox(cell(x, z), { w, h: 0.3, d, mat: ringDeck, x, y: 1.05, z, collide: world, raycast: rc, tag: 'metal' });
    for (let i = 1; i <= 3; i++)
      addBox(cell(cx, cz + 10.3 - i * 0.6), { w: 3, h: i * 0.4, d: 0.7, mat: ringDeck,
        x: cx, y: i * 0.2, z: cz + 10.3 - i * 0.6, collide: world, raycast: rc, tag: 'metal' });
    addBox(cell(cx, cz), { w: 1.7, h: 6.6, d: 1.7, mat: MAT.metalDark, x: cx, y: 3.3, z: cz, collide: world, raycast: rc, tag: 'metal' });
    const cg = new THREE.Group();
    cg.position.set(cx, 6.6, cz);
    core.add(cg);
    const bigRing = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.32, 10, 30), MAT.painted(0xb8863a));
    bigRing.rotation.x = Math.PI / 2;
    bigRing.castShadow = true;
    bigRing.userData.tag = 'metal';
    cg.add(bigRing); rc.push(bigRing);
    for (const ry of [0, Math.PI / 2]) {
      const sp = new THREE.Mesh(cachedBox(13, 0.28, 0.28), MAT.painted(0xb8863a));
      sp.rotation.y = ry; sp.userData.tag = 'metal';
      cg.add(sp); rc.push(sp);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const cab = new THREE.Mesh(cachedBox(1.6, 1.6, 2.2), podMat);
      cab.position.set(Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5);
      cab.rotation.y = -a; cab.userData.tag = 'metal';
      cg.add(cab); rc.push(cab);
    }

    // ---- zero-G: tumbling debris chunks + a fine dust field + slow motes
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0xb8bcbf, roughness: 0.6, metalness: 0.3 });
    const debris = [];
    for (const [dx, dy, dz] of [[-20, 3.8, 42], [-6, 4.4, 52], [-22, 5.0, 60], [-30, 3.4, 52],
      [4, 4.8, 56], [-16, 4.2, 70], [-30, 4.6, 74], [6, 3.6, 74], [-8, 5.4, 64], [-26, 3.2, 40]]) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.25, 0.65), 0), debrisMat);
      m.position.set(dx, dy, dz);
      m.castShadow = true; m.userData.tag = 'metal';
      cell(dx, dz).add(m); rc.push(m);
      debris.push({ m, rx: rand(-0.5, 0.5), ry: rand(-0.5, 0.5), y0: dy, ph: rand(0, 6.3), bob: rand(0.08, 0.3) });
    }
    const dpos = [];
    for (let i = 0; i < 180; i++) dpos.push(rand(X0 + 1, X1 - 1) - cx, rand(0.3, 8.5) - 4, rand(Z0 + 1, Z1 - 1) - cz);
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
    const dustPts = new THREE.Points(dgeo, new THREE.PointsMaterial({
      map: TEX.dust, color: 0xdfe4ea, size: 0.09, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    dustPts.position.set(cx, 4, cz);
    core.add(dustPts);

    // ---- supply crates — instanced
    const crates = new THREE.InstancedMesh(cachedBox(1.3, 1.1, 1.3), MAT.painted(0xb8bcbf), 7);
    for (let i = 0; i < 7; i++) {
      const [px, pz] = [[-24, 50], [-8, 48], [5, 62], [-31, 54], [6, 42], [-28, 76], [-14, 41]][i];
      e.set(0, rand(0, 1), 0); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(px, 0.55, pz), q, new THREE.Vector3(1, 1, 1));
      crates.setMatrixAt(i, mtx);
      world.addBox(new THREE.Vector3(px - 0.65, 0, pz - 0.65), new THREE.Vector3(px + 0.65, 1.1, pz + 0.65));
    }
    cell(-14, 50).add(crates); rc.push(crates);

    // ---- airlock: two sliding panels + wall switch → shooting the switch
    // opens it (auto-opens after ~110 s as a failsafe). Annex beyond: supplies.
    const doorMat = MAT.painted(0x9aa4b0);
    const dl = addBox(cell(-25.6, Z1), { w: 1.2, h: 2.6, d: 0.3, mat: doorMat, x: -25.65, y: 1.3, z: Z1, raycast: rc, tag: 'metal' });
    const dr = addBox(cell(-24.4, Z1), { w: 1.2, h: 2.6, d: 0.3, mat: doorMat, x: -24.35, y: 1.3, z: Z1, raycast: rc, tag: 'metal' });
    const dlCol = world.addBox(new THREE.Vector3(-26.3, 0, Z1 - 0.2), new THREE.Vector3(-25.05, 2.6, Z1 + 0.2));
    const drCol = world.addBox(new THREE.Vector3(-25.05, 0, Z1 - 0.2), new THREE.Vector3(-23.7, 2.6, Z1 + 0.2));
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, emissive: 0x38ff5a, emissiveIntensity: 2.2 }));
    sw.position.set(-22.9, 1.6, Z1 - 0.4);
    sw.userData.tag = 'metal';
    sw.userData.switchDoor = this.doors.length;
    cell(-22.9, Z1).add(sw);
    rc.push(sw);
    const AC = cell(-24.75, Z1 + 2.75);
    addBox(AC, { w: 7.5, h: 5, d: 0.5, mat: MAT.concrete, x: -24.75, y: 2.5, z: Z1 + 5.5, collide: world, raycast: rc });
    addBox(AC, { w: 0.5, h: 5, d: 5.5, mat: MAT.concrete, x: -28.5, y: 2.5, z: Z1 + 2.75, collide: world, raycast: rc });
    addBox(AC, { w: 0.5, h: 5, d: 5.5, mat: MAT.concrete, x: -21, y: 2.5, z: Z1 + 2.75, collide: world, raycast: rc });
    addBox(AC, { w: 7.5, h: 0.4, d: 5.5, mat: MAT.ceiling, x: -24.75, y: 5.2, z: Z1 + 2.75, cast: false });
    floor(AC, rc, { w: 7, d: 5, x: -24.75, z: Z1 + 2.75, mat: panelMat });
    addBox(AC, { w: 1.6, h: 1.3, d: 1.2, mat: MAT.painted(0x8f9aa6), x: -26.5, y: 0.65, z: Z1 + 3.9, collide: world, raycast: rc, tag: 'metal' });
    this.doors.push({ parts: [dl, dr], cols: [dlCol, drCol], open: false, t: 0, autoT: 110 });

    // ---- blinking red alarms (+ one habitat lamp with a power-out stutter)
    const alarmMatA = new THREE.MeshStandardMaterial({ color: 0x220505, emissive: 0xff2222, emissiveIntensity: 2 });
    const alarmMatB = alarmMatA.clone();
    for (const [ax, az, am] of [[X0 + 0.8, Z0 + 1.5, alarmMatA], [X1 - 0.8, Z1 - 1.5, alarmMatB],
      [-22.5, Z1 - 0.9, alarmMatA], [2.2, Z1 - 0.9, alarmMatB]]) {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), am);
      a.position.set(ax, 5.6, az);
      cell(ax, az).add(a);
    }
    const al1 = new THREE.PointLight(0xff3030, 16, 26, 2); al1.position.set(-24, 5.4, 76.5);
    const al2 = new THREE.PointLight(0xff3030, 16, 26, 2); al2.position.set(8, 5.4, 39);
    const wl1 = new THREE.PointLight(0xdfe8f2, 115, 44, 1.8); wl1.position.set(-24, 7.6, 46);
    const wl2 = new THREE.PointLight(0xdfe8f2, 115, 44, 1.8); wl2.position.set(3, 7.6, 70);
    const wl3 = new THREE.PointLight(0xdfe8f2, 95, 40, 1.8); wl3.position.set(-29, 7, 64);   // dead lamp
    const winLight = new THREE.PointLight(0x8fc0ff, 60, 40, 1.8); winLight.position.set(4, 7, 62); // moonlight spill, kept off the spawn→window sightline
    const clLight = new THREE.PointLight(0x9fc8e0, 45, 26, 2); clLight.position.set(cx, 4.6, cz);
    scene.add(al1, al2, wl1, wl2, wl3, winLight, clLight);
    this.areaLights.push(al1, al2, wl1, wl2, wl3, winLight, clLight);

    makeSign(cell(-20, Z0), { tex: TEX.hangingSign('月面基地', 'LUNAR OUTPOST · LOW-G', '#20242a', ''), w: 3, h: 0.75, x: -20, y: 3.4, z: Z0 + 0.65, intensity: 1.3 });

    const mote = { t: 0 };
    this.updaters.push((dt) => {
      const d = this.doors[0];
      if (d.autoT > 0) d.autoT -= dt;
      if (!d.open && d.autoT <= 0) d.open = true;
      if (d.open && d.t < 1) {
        d.t = Math.min(1, d.t + dt * 0.7);
        dl.position.x = -25.65 - d.t * 1.4;
        dr.position.x = -24.35 + d.t * 1.4;
        dlCol.min.set(-1000, 0, 0); dlCol.max.set(-999, 3, 1);
        drCol.min.set(-1000, 0, 0); drCol.max.set(-999, 3, 1);
      }
      const blink = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      alarmMatA.emissiveIntensity = 0.3 + 2.2 * blink;
      alarmMatB.emissiveIntensity = 0.3 + 2.2 * (1 - blink);
      al1.intensity = 5 + 14 * blink;
      al2.intensity = 5 + 14 * (1 - blink);
      // power-out stutter on wl3: mostly dark, occasional hard flicker
      const tt = performance.now() / 1000;
      const cyc = tt % 9;
      wl3.intensity = cyc < 6.6 ? 95 : (Math.sin(cyc * 31) > 0.2 ? 30 : 0);
      earth.rotation.y += dt * 0.02;
      cg.rotation.y += dt * 0.35;
      dustPts.rotation.y += dt * 0.012;
      for (const b of debris) {
        b.m.rotation.x += b.rx * dt; b.m.rotation.y += b.ry * dt;
        b.m.position.y = b.y0 + Math.sin(tt * 0.6 + b.ph) * b.bob;
      }
      mote.t -= dt;
      if (mote.t <= 0) {
        mote.t = 0.4;
        this.p.dust.spawn({
          x: rand(X0 + 2, X1 - 2), y: rand(0.3, 5), z: rand(Z0 + 2, Z1 - 2),
          vx: rand(-0.12, 0.12), vy: rand(-0.04, 0.08), vz: rand(-0.12, 0.12),
          size: rand(0.05, 0.11), color: [0.85, 0.87, 0.9], alpha: 0.22,
          life: rand(4, 8), grow: 0.02, drag: 0.05, gravity: -0.02,
        });
      }
    });

    SPAWN_POOLS.moon = [
      { pos: [-12, 42],     wps: [[-12, 42], [-8.5, 43.5], [-15.5, 44]] },
      { pos: [-16, 52],     wps: [[-16, 52], [-13, 50.5], [-19.5, 54]] },
      { pos: [-2, 56],      wps: [[-2, 56], [-2, 51.5], [1, 60]] },
      { pos: [-27, 57],     wps: [[-27, 57], [-24.5, 59.5], [-30, 54]] },
      { pos: [-27, 74],     wps: [[-27, 74], [-24.5, 72], [-30, 76.5]] },
      { pos: [-24.75, Z1 + 2.75], wps: [[-24.75, Z1 + 2.75], [-23, Z1 + 1.6], [-26.5, Z1 + 4.2]] },
      { pos: [2, 74],       wps: [[2, 74], [0, 71], [4.5, 77]] },
    ];
  }

  // ================= MISSION 06 · 黄金の墓 · 52 × 46 m =====================

  _tomb() {
    const G = this._g('tomb');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -46, X1 = 6, Z0 = -72, Z1 = -26;
    this.bounds.tomb = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('tomb', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('tomb');
    const cell = (x, z) => this._cell('tomb', x, z);

    const sand = tex('sand', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#a2814f'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        const g = 120 + Math.floor(Math.random() * 70);
        x.fillStyle = `rgba(${g},${g * 0.78},${g * 0.45},0.35)`;
        x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
      x.strokeStyle = 'rgba(60,42,20,0.5)'; x.lineWidth = 2;
      for (let i = 0; i <= 2; i++) {
        x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, 256); x.stroke();
        x.beginPath(); x.moveTo(0, i * 128); x.lineTo(256, i * 128); x.stroke();
      }
      return { c, x };
    }, { repeat: [13, 12] });
    const sandMat = new THREE.MeshStandardMaterial({ map: sand, roughness: 0.92 });
    const hiero = tex('hiero', () => {
      const { c, x } = canvas(512, 256);
      x.fillStyle = '#96774a'; x.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 1800; i++) {
        const g = 110 + Math.floor(Math.random() * 60);
        x.fillStyle = `rgba(${g},${g * 0.8},${g * 0.5},0.3)`;
        x.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
      }
      x.strokeStyle = 'rgba(46,30,12,0.85)'; x.lineWidth = 3;
      for (let row = 0; row < 3; row++) {
        const y = 40 + row * 72;
        for (let col = 0; col < 12; col++) {
          const gx = 24 + col * 40;
          const k = (row * 12 + col) % 6;
          x.beginPath();
          if (k === 0) { x.arc(gx, y, 11, 0, Math.PI * 2); x.moveTo(gx, y + 11); x.lineTo(gx, y + 26); }
          else if (k === 1) { x.moveTo(gx - 12, y); x.lineTo(gx + 12, y); x.lineTo(gx, y + 24); x.closePath(); }
          else if (k === 2) { x.rect(gx - 9, y - 8, 18, 26); x.moveTo(gx - 9, y + 5); x.lineTo(gx + 9, y + 5); }
          else if (k === 3) { x.arc(gx, y, 10, Math.PI, 0); x.moveTo(gx - 10, y); x.lineTo(gx - 10, y + 20); x.moveTo(gx + 10, y); x.lineTo(gx + 10, y + 20); }
          else if (k === 4) { x.moveTo(gx - 10, y + 20); x.bezierCurveTo(gx - 4, y - 12, gx + 4, y + 24, gx + 10, y - 8); }
          else { x.moveTo(gx, y - 12); x.lineTo(gx + 10, y + 8); x.lineTo(gx, y + 24); x.lineTo(gx - 10, y + 8); x.closePath(); }
          x.stroke();
        }
      }
      return { c, x };
    }, { repeat: [7, 1] });
    const wallMat = new THREE.MeshStandardMaterial({ map: hiero, roughness: 0.9 });

    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: (X0 + X1) / 2, z: (Z0 + Z1) / 2, mat: sandMat });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 9, mat: wallMat });
    addBox(core, { w: X1 - X0 + 2, h: 0.5, d: Z1 - Z0 + 2, mat: new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.95 }), x: (X0 + X1) / 2, y: 9.25, z: (Z0 + Z1) / 2, cast: false, raycast: rc });

    // ---- the maze: entrance corridor → bends → pillared hall → burial
    // chamber. Inner hiero walls (h 5.2) break every sight line under ~25 m.
    const HW = 5.2;
    const mw = (x0, x1, z0, z1) => {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      addBox(cell(mx, mz), { w: x1 - x0, h: HW, d: z1 - z0, mat: wallMat, x: mx, y: HW / 2, z: mz, collide: world, raycast: rc });
    };
    // entrance corridor (x -24.4..-16.4): a real antechamber — 1.8 m doorway
    // in its east wall opens into the starting area, so nothing (player or
    // enemy) can ever be sealed inside it.
    mw(-25.0, -24.4, -72, -64);
    mw(-16.4, -15.8, -72, -69.1);  mw(-16.4, -15.8, -67.3, -64);
    mw(-24.4, -4.2, -64, -63.4);                                 // bend 1 (turn west or east)
    mw(-46, -29.4, -57.3, -56.7); mw(-12.6, 3.4, -57.3, -56.7);  // bend 2/3 → pillared hall
    mw(-40.4, -25.4, -40.7, -40.1); mw(-14.6, 0.4, -40.7, -40.1);// bend 4 → burial chamber
    mw(-38.3, -37.7, -38, -30);   mw(1.7, 2.3, -38, -30);        // chamber corner stubs

    // ---- 14 round sandstone columns (hiero-wrapped) with base + capital
    const colXs = [-42, -34, -26, -18, -10, -2];
    const cols = [[...colXs.map((x) => [x, -53.5])], [...colXs.map((x) => [x, -44.5])]].flat();
    cols.push([-26.5, -38], [-13.5, -38]);                      // chamber entrance pair
    const caps = new THREE.InstancedMesh(cachedBox(1, 1, 1), wallMat, cols.length);
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    cols.forEach(([px, pz], i) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.24, 8.3, 14), wallMat);
      col.position.set(px, 4.6, pz);
      col.castShadow = true; col.userData.tag = 'concrete';
      cell(px, pz).add(col); rc.push(col);
      world.addBox(new THREE.Vector3(px - 1.15, 0, pz - 1.15), new THREE.Vector3(px + 1.15, 8.3, pz + 1.15));
      e.set(0, rand(0, Math.PI / 4), 0); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(px, 8.85, pz), q, new THREE.Vector3(2.8, 0.55, 2.8));
      caps.setMatrixAt(i, mtx);
    });
    core.add(caps);

    // ---- golden sarcophagus on a raised 2-step dais: dark outer chest, gold
    // inner coffin, lapis bands, and a mask head facing the approach (the
    // showcase light sits in front so that face reads, never black)
    const DX = -10, DZ = -33;   // east side of the chamber; the x=-20 sight line runs out the gate into the hall
    for (const [w, d, z] of [[7.2, 5.4, 0.45], [5.6, 4.2, 0.9]]) {
      const y = z / 2;
      addBox(cell(DX, DZ), { w, h: z, d, mat: sandMat, x: DX, y, z: DZ, collide: world, raycast: rc, tag: 'stone' });
    }
    addBox(cell(DX, DZ), { w: 2.4, h: 1.5, d: 4.4, mat: new THREE.MeshStandardMaterial({ color: 0x4a3b26, roughness: 0.55, metalness: 0.25 }), x: DX, y: 1.65, z: DZ, collide: world, raycast: rc, tag: 'stone' });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.28, metalness: 1 });
    addBox(cell(DX, DZ), { w: 1.7, h: 0.9, d: 3.5, mat: goldMat, x: DX, y: 2.85, z: DZ, raycast: rc, tag: 'metal' });
    for (const bz of [DZ + 1.2, DZ - 1.2])
      addBox(cell(DX, bz), { w: 1.85, h: 0.14, d: 0.55, mat: new THREE.MeshStandardMaterial({ color: 0x1c4fa0, roughness: 0.35, metalness: 0.5 }), x: DX, y: 3.37, z: bz, cast: false, tag: 'metal' });
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.45), goldMat);
    mask.position.set(DX, 2.0, DZ - 2.35);
    mask.rotation.y = Math.PI;
    cell(DX, DZ).add(mask); rc.push(mask);
    // guardian statues flanking the approach
    for (const sx of [DX - 4.2, DX + 4.2]) {
      addBox(cell(sx, DZ - 4.2), { w: 1.4, h: 2.6, d: 1.1, mat: sandMat, x: sx, y: 1.3, z: DZ - 4.2, collide: world, raycast: rc, tag: 'stone' });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), sandMat);
      head.position.set(sx, 3.0, DZ - 4.2);
      head.castShadow = true;
      cell(sx, DZ - 4.2).add(head); rc.push(head);
    }
    const sarc = new THREE.PointLight(0xffb46a, 70, 26, 1.7);
    sarc.position.set(DX, 3.6, DZ - 5.5);
    scene.add(sarc);
    this.areaLights.push(sarc);

    // ---- treasure: five heaps of gold mounds + instanced coins / bowls /
    // vases, plus chests — big pile volume along the walls and the chamber
    const heaps = [[-38, -47.5, 40], [-6, -47.5, 40], [-27, -30.5, 34], [-3, -28.8, 34], [-40, -60.5, 28]];
    const mounds = new THREE.InstancedMesh(cachedBox(1, 1, 1), goldMat, heaps.length);
    let ci = 0;
    for (const [hx, hz] of heaps) {
      e.set(0, rand(0, 1), 0); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(hx, 0.36, hz), q, new THREE.Vector3(rand(2.4, 3.2), 0.72, rand(2.4, 3.2)));
      mounds.setMatrixAt(ci++, mtx);
      world.addBox(new THREE.Vector3(hx - 1.3, 0, hz - 1.3), new THREE.Vector3(hx + 1.3, 0.95, hz + 1.3));
    }
    core.add(mounds); rc.push(mounds);
    const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 8);
    const coins = new THREE.InstancedMesh(coinGeo, goldMat, 180);
    let ki = 0;
    for (const [hx, hz, n] of heaps) for (let k = 0; k < n && ki < 180; k++, ki++) {
      q.setFromEuler(new THREE.Euler(rand(-0.5, 0.5), rand(0, 6), rand(-0.5, 0.5)));
      mtx.compose(new THREE.Vector3(hx + rand(-1.3, 1.3), rand(0.72, 1.05), hz + rand(-1.3, 1.3)), q, new THREE.Vector3(1, 1, 1));
      coins.setMatrixAt(ki, mtx);
    }
    core.add(coins); rc.push(coins);
    const bowls = new THREE.InstancedMesh(new THREE.TorusGeometry(0.32, 0.12, 8, 12), goldMat, 22);
    const vases = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 0.75, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.8 }), 16);
    let bi = 0, vi = 0;
    for (const [hx, hz] of heaps) {
      for (let k = 0; k < 4 && bi < 22; k++, bi++) {
        q.identity();
        mtx.compose(new THREE.Vector3(hx + rand(-1, 1), 0.85, hz + rand(-1, 1)), q, new THREE.Vector3(1, 1, 1));
        bowls.setMatrixAt(bi, mtx);
      }
      for (let k = 0; k < 3 && vi < 16; k++, vi++) {
        e.set(rand(-0.2, 0.2), rand(0, 6), 0); q.setFromEuler(e);
        mtx.compose(new THREE.Vector3(hx + rand(-1.8, 1.8), 0.36, hz + rand(-1.8, 1.8)), q, new THREE.Vector3(1, 1, 1));
        vases.setMatrixAt(vi, mtx);
      }
    }
    bowls.count = bi; vases.count = vi;
    core.add(bowls, vases); rc.push(bowls, vases);
    for (const [cx2, cz2, ry] of [[-30.5, -49.5, 0], [0.5, -49.5, 0.15], [-27, -27.5, 0.2], [-11, -27.5, -0.15]]) {
      addBox(cell(cx2, cz2), { w: 1.4, h: 0.8, d: 0.9, mat: MAT.wood, x: cx2, y: 0.4, z: cz2, rotY: ry, collide: world, raycast: rc, tag: 'wood' });
      addBox(cell(cx2, cz2), { w: 1.5, h: 0.12, d: 1.0, mat: goldMat, x: cx2, y: 0.86, z: cz2, rotY: ry, cast: false, tag: 'metal' });
    }

    // ---- torches: 12 wall sconces, each with its own flicker PointLight —
    // the rig's nearest-N pool keeps only the ones the player can actually see
    const torches = [
      [-24.35, -66.5], [-16.45, -66.5],                       // entrance corridor
      [-30, -63.35], [-8, -63.35],                            // bend 1 wall
      [-36, -56.65], [-20, -56.65],                           // hall south wall
      [-10, -57.35], [2, -57.35],                             // hall north wall
      [-33, -40.85], [-8, -40.85],                            // chamber wall
      [-33, -25.95], [-7, -25.95],                            // chamber back wall
    ];
    const posts = new THREE.InstancedMesh(cachedBox(1, 1, 1), MAT.wood, torches.length);
    const flameMatA = new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameMatB = new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const flamesA = new THREE.InstancedMesh(new THREE.ConeGeometry(0.13, 0.42, 7), flameMatA, 6);
    const flamesB = new THREE.InstancedMesh(new THREE.ConeGeometry(0.13, 0.42, 7), flameMatB, 6);
    let fa = 0, fb = 0;
    const torchLights = [];
    torches.forEach(([tx, tz], i) => {
      q.identity();
      mtx.compose(new THREE.Vector3(tx, 1.7, tz), q, new THREE.Vector3(0.14, 1.1, 0.14));
      posts.setMatrixAt(i, mtx);
      const fl = i % 2 ? flamesA : flamesB;
      const fi = i % 2 ? fa++ : fb++;
      mtx.compose(new THREE.Vector3(tx, 2.45, tz), q, new THREE.Vector3(1, 1, 1));
      fl.setMatrixAt(fi, mtx);
      const pl = new THREE.PointLight(0xff9a4a, 55, 24, 1.7);
      pl.position.set(tx, 2.7, tz);
      scene.add(pl);
      this.areaLights.push(pl);
      torchLights.push(pl);
    });
    flamesA.count = fa; flamesB.count = fb;
    core.add(posts, flamesA, flamesB);
    const entry = new THREE.PointLight(0xffa050, 35, 22, 1.9);
    entry.position.set(-20, 3.2, -66);
    scene.add(entry);
    this.areaLights.push(entry);

    // ---- 2 mechanisms: a scarab relief plate (shoot it) drops a ceiling
    // boulder onto the corridor below; the rock lands and stays, blocking it
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2f, emissive: 0xc9a227, emissiveIntensity: 1.4, roughness: 0.4, metalness: 0.6 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f5a3c, roughness: 0.95 });
    for (const [px, pz, py, ry, rx, rz] of [
      [-18, -52.28, 1.5, 0, -18, -49.2],       // hall, between the column rows
      [-24.05, -69, 1.5, Math.PI / 2, -20, -69.5], // entrance corridor
    ]) {
      const plate = addBox(cell(px, pz), { w: 0.6, h: 0.8, d: 0.14, mat: plateMat, x: px, y: py, z: pz, rotY: ry, raycast: rc, tag: 'metal' });
      plate.userData.fallTrap = this.fallTraps.length;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), rockMat);
      rock.position.set(rx, 7.6, rz);
      rock.castShadow = true; rock.userData.tag = 'stone';
      cell(rx, rz).add(rock);
      this.fallTraps.push({ mesh: plate, rock, falling: false, t: 0, landed: false, startY: 7.6 });
    }

    // ---- 2 quicksand pits in the side corridors (mods.traps slows inside)
    const qMat = new THREE.MeshStandardMaterial({ color: 0x7a6038, roughness: 1 });
    const pits = [[-33, -60.8, 2.4], [4.2, -49, 1.9]];
    for (const [qx, qz, qr] of pits) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(qr, qr * 0.85, 0.5, 16), qMat);
      disc.position.set(qx, -0.12, qz);
      disc.receiveShadow = true; disc.userData.tag = 'concrete';
      cell(qx, qz).add(disc); rc.push(disc);
      this.quicksand.push({ x: qx, z: qz, r: qr });
    }

    makeSign(cell(-20, -64), { tex: TEX.hangingSign('黄金の墓', 'TOMB OF THE PHARAOH', '#2b1c07', '☥'), w: 3, h: 0.8, x: -20, y: 3.8, z: -64.15, rotY: Math.PI, intensity: 1.1 });

    const qt = { t: 0 };
    this.updaters.push((dt) => {
      const t = performance.now() / 1000;
      torchLights.forEach((pl, i) => {
        const n = 0.75 + 0.25 * Math.sin(t * 11 + i * 1.7) * Math.sin(t * 5.3 + i * 0.9);
        pl.intensity = 40 + n * 44;
      });
      flameMatA.opacity = 0.7 + 0.25 * Math.sin(t * 9);
      flameMatB.opacity = 0.7 + 0.25 * Math.sin(t * 7 + 2);
      for (const f of this.fallTraps) {
        if (!f.falling || f.landed) continue;
        f.t += dt;
        const y = f.startY - 9 * f.t * f.t;   // gravity ≈ 18 m/s²
        if (y <= 1.55) {
          f.rock.position.y = 1.55;
          f.landed = true;
          const rx2 = f.rock.position.x, rz2 = f.rock.position.z;
          world.addBox(new THREE.Vector3(rx2 - 1.5, 0, rz2 - 1.5), new THREE.Vector3(rx2 + 1.5, 3, rz2 + 1.5));
          for (let i = 0; i < 16; i++) this.p.dust.spawn({
            x: rx2 + rand(-1.6, 1.6), y: rand(0.1, 1.3), z: rz2 + rand(-1.6, 1.6),
            vx: rand(-1.6, 1.6), vy: rand(0.2, 1.1), vz: rand(-1.6, 1.6),
            size: rand(0.3, 0.7), color: [0.72, 0.6, 0.42], alpha: 0.5,
            life: rand(1.2, 2.4), grow: 0.4, drag: 1.2, gravity: -1.5,
          });
        } else {
          f.rock.position.y = y;
          f.rock.rotation.y += dt * 2;
        }
      }
      qt.t -= dt;
      if (qt.t <= 0) {
        qt.t = 0.6;
        const [qx, qz] = pits[Math.floor(Math.random() * pits.length)];
        this.p.dust.spawn({
          x: qx + rand(-1.4, 1.4), y: 0.1, z: qz + rand(-1.4, 1.4),
          vx: rand(-0.1, 0.1), vy: -0.15, vz: rand(-0.1, 0.1),
          size: rand(0.08, 0.16), color: [0.75, 0.62, 0.4], alpha: 0.35,
          life: rand(1.2, 2.2), grow: 0.02, drag: 0.3, gravity: 0,
        });
      }
    });

    SPAWN_POOLS.tomb = [
      // none inside the entrance room (player antechamber) — every anchor
      // sits in the connected maze body, all reachability-verified
      { pos: [-22, -60],   wps: [[-22, -60], [-19, -59], [-24, -61.5]] },
      { pos: [-35.5, -60.5], wps: [[-35.5, -60.5], [-33, -59.8], [-37.5, -62.3]] },
      { pos: [1, -61],     wps: [[1, -61], [-3, -60], [3.5, -62.5]] },
      { pos: [-33, -49],   wps: [[-33, -49], [-30, -47.5], [-35.5, -51]] },
      { pos: [-6, -49.5],  wps: [[-6, -49.5], [-9, -51], [-3.5, -47]] },
      { pos: [-24.8, -33.2], wps: [[-24.8, -33.2], [-24.8, -28.5], [-26, -34.5]] },
      { pos: [4.7, -44],   wps: [[4.7, -44], [5, -41], [4.5, -46.5]] },
    ];
  }
  // ================= MISSION 07 · 天空港 · 60 × 52 m ======================

  // Open brass harbor over a rolling cloud sea. No visible walls: the deck
  // edge is brass railing + ghost-thin INVISIBLE air walls (colliders stay
  // on always). Four giant yellow airships breathe on their moorings,
  // exposed gear clusters counter-rotate on gantry and walls, steam
  // nozzles puff on a timer, and three launch vents throw the player onto
  // the high decks.
  _skyport() {
    const G = this._g('skyport');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 44, X1 = 104, Z0 = -30, Z1 = 22;
    this.bounds.skyport = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('skyport', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('skyport');
    const cell = (x, z) => this._cell('skyport', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const put = (im, i, px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };

    // ---- riveted bronze deck plates (harbor metal, never wood)
    const deckTex = tex('deck', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#8a6538'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = 'rgba(16,10,4,0.8)'; x.lineWidth = 3;
      for (let i = 1; i < 4; i++) {
        x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke();
        x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke();
      }
      x.fillStyle = 'rgba(196,152,84,0.6)';
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) for (const [ox, oy] of [[9, 9], [53, 9], [9, 53], [53, 53]])
        x.fillRect(gx * 64 + ox, gy * 64 + oy, 3, 3);
      x.fillStyle = 'rgba(90,64,38,0.4)';
      for (let i = 0; i < 40; i++) x.fillRect(rand(0, 230), rand(0, 246), rand(8, 40), 5);
      return { c, x };
    }, { repeat: [11, 10] });
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.42, metalness: 0.55, envMapIntensity: 1.5 });
    const brass = MAT.painted(0xb8863a);
    const bronze = MAT.painted(0x6b5224);
    const deckSlab = MAT.painted(0x8f6a2c);

    floor(core, rc, { w: X1 - X0 + 1, d: Z1 - Z0 + 1, x: cx, z: cz, mat: deckMat });
    // Solid deck slab (top y=0) under everything. INVISIBLE AIR WALLS ring
    // the open edges: a 5%-opacity ghost pane nobody notices, collider on
    // always — the cloud sea below is a view, never a walkway.
    world.addBox(new THREE.Vector3(X0, -3, Z0), new THREE.Vector3(X1, 0, Z1));
    const airWallMat = new THREE.MeshBasicMaterial({
      color: 0xaebfcd, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide,
    });
    const airWall = (w, d, x, z) => addBox(core, { w, h: 9, d, mat: airWallMat, x, y: 4.5, z,
      cast: false, receive: false, collide: world, raycast: rc, tag: 'metal' });
    airWall(X1 - X0 + 1, 0.24, cx, Z0 - 0.12);
    airWall(X1 - X0 + 1, 0.24, cx, Z1 + 0.12);
    airWall(0.24, Z1 - Z0 + 1, X0 - 0.12, cz);
    airWall(0.24, Z1 - Z0 + 1, X1 + 0.12, cz);

    // ---- brass railings dressing every edge (instanced balusters + caps)
    const rails = new THREE.InstancedMesh(cachedBox(0.12, 1.1, 0.12), brass, 132);
    let ri = 0;
    for (let x = X0 + 1.2; x < X1 - 1; x += 1.7) { put(rails, ri++, x, 0.55, Z0 + 0.35); put(rails, ri++, x, 0.55, Z1 - 0.35); }
    for (let z = Z0 + 1.2; z < Z1 - 1; z += 1.7) { put(rails, ri++, X0 + 0.35, 0.55, z); put(rails, ri++, X1 - 0.35, 0.55, z); }
    rails.count = ri;
    core.add(rails);
    for (const [w, d, x, z] of [[X1 - X0 - 1, 0.14, cx, Z0 + 0.35], [X1 - X0 - 1, 0.14, cx, Z1 - 0.35],
      [0.14, Z1 - Z0 - 1, X0 + 0.35, cz], [0.14, Z1 - Z0 - 1, X1 - 0.35, cz]])
      addBox(core, { w, h: 0.12, d, mat: brass, x, y: 1.12, z, cast: false });

    // ---- three deck levels: main (0), east observation deck (2.25) and
    // the south gantry walkway (3.6), all reached by stacked 0.45 m planks.
    // The observation slab sits high enough to walk (and fight) underneath.
    addBox(cell(94, 14), { w: 15, h: 0.3, d: 12, mat: deckSlab, x: 94, y: 2.1, z: 14, collide: world, raycast: rc, tag: 'metal' });
    for (const [px, pz] of [[87.5, 9.2], [100.5, 9.2], [87.5, 18.8], [100.5, 18.8]])
      addBox(cell(px, pz), { w: 0.55, h: 1.95, d: 0.55, mat: bronze, x: px, y: 0.975, z: pz, collide: world, raycast: rc, tag: 'metal' });
    for (let i = 1; i <= 5; i++)                                   // plank stair to the observation deck
      addBox(cell(93.5, 8 - (5 - i + 0.5) * 0.9), { w: 2, h: i * 0.45, d: 0.9, mat: deckSlab,
        x: 93.5, y: i * 0.225, z: 8 - (5 - i + 0.5) * 0.9, collide: world, raycast: rc, tag: 'metal' });
    addBox(cell(74, -27), { w: 36, h: 0.3, d: 3, mat: deckSlab, x: 74, y: 3.45, z: -27, collide: world, raycast: rc, tag: 'metal' });
    for (const gx of [64, 74, 84])
      addBox(cell(gx, -27), { w: 0.55, h: 3.3, d: 0.55, mat: bronze, x: gx, y: 1.65, z: -27, collide: world, raycast: rc, tag: 'metal' });
    for (let i = 1; i <= 8; i++)                                   // plank stair up to the gantry
      addBox(cell(53.4 + i * 0.62, -27), { w: 0.62, h: i * 0.45, d: 1.6, mat: deckSlab,
        x: 53.4 + i * 0.62, y: i * 0.225, z: -27, collide: world, raycast: rc, tag: 'metal' });
    const deckRails = new THREE.InstancedMesh(cachedBox(0.1, 1, 0.1), brass, 92);
    let di = 0;
    for (let x = 87; x < 101.5; x += 1.7) {
      if (x > 91.8 && x < 95.4) continue;                          // stair mouth gap
      put(deckRails, di++, x, 3.25, 8.2); put(deckRails, di++, x, 3.25, 19.8);
    }
    for (let z = 9; z < 19.5; z += 1.7) { put(deckRails, di++, 86.7, 3.25, z); put(deckRails, di++, 101.3, 3.25, z); }
    for (let x = 56.5; x < 92; x += 1.7) { put(deckRails, di++, x, 4.5, -25.7); put(deckRails, di++, x, 4.5, -28.3); }
    deckRails.count = di;
    core.add(deckRails);

    // ---- THE cloud sea: a 900 m animated fbm plane at y = -12 in the
    // core group, fogged to murk past the arena (uNear/uFar below match
    // the MISSION 07 atmo fogNear 20 / fogFar 150 in config.js — sync)
    const cloudU = { t: { value: 0 } };
    const cloudSea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShaderMaterial({
      uniforms: { uT: cloudU.t },
      vertexShader: /* glsl */`
        varying vec2 vUv; varying float vD;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform float uT;
        varying vec2 vUv; varying float vD;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 p = vUv * 190.0; p.x += uT * 1.5; p.y += sin(uT * 0.11) * 9.0;
          float f = n2(p) * 0.5 + n2(p * 2.3 + 13.0) * 0.27 + n2(p * 5.1 - 7.0) * 0.15 + n2(p * 11.3) * 0.08;
          f = smoothstep(0.34, 0.84, f);
          float roll = 0.5 + 0.5 * sin(uT * 0.35 + vUv.x * 26.0) * n2(p * 0.7);
          vec3 col = mix(vec3(0.46, 0.5, 0.57), vec3(1.0, 1.0, 0.97), clamp(f * 1.0 + roll * 0.3, 0.0, 1.0));
          col += vec3(0.09, 0.07, 0.03) * smoothstep(0.72, 1.0, f);
          float sun = max(0.0, 1.0 - length(vUv - vec2(0.31, 0.72)) * 3.2);
          col += vec3(0.3, 0.2, 0.07) * sun * f;
          float fogF = 1.0 - smoothstep(24.0, 120.0, vD);
          gl_FragColor = vec4(mix(vec3(0.027, 0.043, 0.082), col, fogF), 1.0);
        }`,
    }));
    cloudSea.rotation.x = -Math.PI / 2;
    cloudSea.position.set(cx, -7.5, cz);
    core.add(cloudSea);
    for (const [fx, fz, fw, fd] of [[cx, Z0 - 0.15, X1 - X0 + 2.4, 0.5], [cx, Z1 + 0.15, X1 - X0 + 2.4, 0.5],
      [X0 - 0.15, cz, 0.5, Z1 - Z0 + 2.4], [X1 + 0.15, cz, 0.5, Z1 - Z0 + 2.4]])
      addBox(core, { w: fw, h: 3.4, d: fd, mat: MAT.painted(0x6f4c22), x: fx, y: -1.6, z: fz, cast: false, raycast: rc, tag: 'metal' });

    // ---- four GIANT yellow airships: canvas envelopes that breathe via a
    // vertex-shader swell, rigging lines, gondolas, mooring masts
    const envU = { value: 0 };
    const envMat = new THREE.MeshStandardMaterial({ color: 0xf6d470, roughness: 0.55, metalness: 0.02, envMapIntensity: 1.1, emissive: 0x2a1e08, emissiveIntensity: 0.5 });
    envMat.onBeforeCompile = (sh) => {
      sh.uniforms.uB = envU;
      sh.vertexShader = 'uniform float uB;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += normal * (0.13 * sin(uB * 1.25 + modelMatrix[3][0] * 0.7 + position.x * 1.3)
                               + 0.05 * sin(uB * 2.4 + position.y * 3.0));`);
    };
    envMat.customProgramCacheKey = () => 'envswell';
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x8a5a20, roughness: 0.55, metalness: 0.15 });
    const bandGeo = new THREE.SphereGeometry(3.46, 16, 12);
    const ropes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 5), MAT.plasticBlack, 26);
    let pi = 0;
    const UP = new THREE.Vector3(0, 1, 0);
    const rope = (x1, y1, z1, x2, y2, z2) => {
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      q.setFromUnitVectors(UP, v.set(dx / L, dy / L, dz / L));
      mtx.compose(s.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2), q, new THREE.Vector3(1, L, 1));
      ropes.setMatrixAt(pi++, mtx);
    };
    const ship = (x, z, gy) => {                                  // gy = gondola base height
      const C = cell(x, z);
      const env = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 12), envMat);
      env.scale.set(4.2, 0.85, 1.05);
      env.position.set(x, gy + 3.4, z);
      env.castShadow = true; env.userData.tag = 'wood';
      C.add(env); rc.push(env);
      for (const bx of [-9, -3.6, 3.6, 9]) {                      // hoop bands riding the envelope
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.scale.set(0.05, 0.88, 1.09);
        band.position.set(x + bx, gy + 3.4, z);
        C.add(band);
      }
      for (const bx of [-9.8, 9.8]) for (const fy of [1.2, 5.6]) { // dorsal/ventral fins
        const fin = new THREE.Mesh(cachedBox(1.7, 2.2, 0.16), bandMat);
        fin.position.set(x + bx, gy + fy, z);
        fin.userData.tag = 'wood';
        C.add(fin); rc.push(fin);
      }
      world.addBox(new THREE.Vector3(x - 14.3, gy + 0.5, z - 3.6), new THREE.Vector3(x + 14.3, gy + 6.3, z + 3.6));
      const gondY = gy < 3 ? gy + 0.85 : gy - 1.0;                     // slung below the envelope belly (gy+0.5)
      addBox(C, { w: 5.4, h: 1.7, d: 2.8, mat: MAT.wood, x, y: gondY, z, collide: world, raycast: rc, tag: 'wood' });
      const win = new THREE.Mesh(cachedBox(4.6, 0.34, 0.06), MAT.led(0xffd89a, 1.8));
      win.position.set(x, gondY + 0.3, z - 1.44);
      C.add(win);
      if (gy >= 3) for (const sx of [x - 1.6, x + 1.6]) {
        const strut = new THREE.Mesh(cachedBox(0.18, 1.4, 0.18), MAT.metalDark);
        strut.position.set(sx, gondY + 1.45, z);
        strut.userData.tag = 'metal';
        C.add(strut); rc.push(strut);
      }
      for (const [rx, rz] of [[-1.6, -0.9], [1.6, -0.9], [-1.6, 0.9], [1.6, 0.9]])
        rope(x + rx, gy + 2.1, z + rz, x + rx * 0.4, gy + 1.55, z + rz * 0.4);
    };
    ship(60, -12, 3.4); ship(62, 16, 3.4); ship(86, -20, 3.4);
    ship(94, 14, 2.25);                                           // moored on the observation deck
    const masts = new THREE.InstancedMesh(cachedBox(0.8, 1, 0.8), bronze, 4);
    for (let i = 0; i < 4; i++) {
      const [mx, mz] = [[46, -12], [48.5, 16], [71, -20], [100.6, 19.2]][i];
      const mh = i === 3 ? 6 : 9, y0 = i === 3 ? 2.25 : 0;
      e.set(0, 0, 0); q.setFromEuler(e);
      mtx.compose(v.set(mx, y0 + mh / 2, mz), q, s.set(1, mh, 1));
      masts.setMatrixAt(i, mtx);
      world.addBox(new THREE.Vector3(mx - 0.4, y0, mz - 0.4), new THREE.Vector3(mx + 0.4, y0 + mh, mz + 0.4));
      const [sx2, sz2, gy2] = [[60, -12, 4.6], [62, 16, 4.6], [86, -20, 4.6], [94, 14, 3.5]][i];
      rope(mx, y0 + mh - 0.3, mz, sx2, gy2, sz2);
    }
    ropes.count = pi;
    core.add(masts, ropes);

    // ---- exposed gear machinery: counter-rotating brass clusters with
    // instanced teeth; meshing pairs turn at matched rim speed (-rA/rB)
    const gears = [];
    const wheel = (r, th) => {
      const g = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, th, 8, Math.max(16, Math.round(r * 7))), brass);
      rim.castShadow = true; rim.userData.tag = 'metal';
      g.add(rim); rc.push(rim);
      for (const a of [0, Math.PI / 3, -Math.PI / 3]) {
        const sp = new THREE.Mesh(cachedBox(0.16, r * 2, th * 1.4), brass);
        sp.rotation.z = a; sp.userData.tag = 'metal';
        g.add(sp);
      }
      const n = Math.max(14, Math.round(r * 4.2));
      const teeth = new THREE.InstancedMesh(cachedBox(0.42, 0.8, th * 2.8), brass, n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        e.set(0, 0, a); q.setFromEuler(e);
        mtx.compose(v.set(Math.cos(a) * (r + 0.44), Math.sin(a) * (r + 0.44), 0), q, s.set(1, 1, 1));
        teeth.setMatrixAt(i, mtx);
      }
      g.add(teeth);
      g.add(new THREE.Mesh(cachedBox(th * 2.6, th * 2.6, th * 3.6), MAT.metalDark));
      return g;
    };
    const cluster = (x, y, z, r, ry = 0) => {
      const p = new THREE.Group(); p.position.set(x, y, z); p.rotation.y = ry;
      core.add(p);
      const big = wheel(r, 0.36); p.add(big);
      const sm = wheel(r * 0.55, 0.3);
      sm.position.set(r + r * 0.55 + 0.32, -0.1, 0.08);
      p.add(sm);
      const om = 2.1 / r;                                         // equal rim speed both wheels
      gears.push([big, om], [sm, -om / 0.55]);
    };
    cluster(66, 5.6, -26.4, 2.8);
    cluster(80, 4.8, -26.4, 2.1, Math.PI);
    cluster(102.9, 5.9, -10, 2.7, -Math.PI / 2);
    cluster(102.9, 6.4, 10, 2.7, -Math.PI / 2);
    cluster(50.6, 8.4, -14, 2.2, Math.PI / 2);

    // ---- two gantry cranes: mast + jib over the deck, cargo hanging high
    for (const [kx, kz, jx] of [[49, -14, 55], [99, -22, 91]]) {
      addBox(cell(kx, kz), { w: 0.9, h: 10, d: 0.9, mat: bronze, x: kx, y: 5, z: kz, collide: world, raycast: rc, tag: 'metal' });
      addBox(cell((kx + jx) / 2, kz), { w: Math.abs(jx - kx), h: 0.5, d: 0.5, mat: bronze,
        x: (kx + jx) / 2, y: 9.7, z: kz, collide: world, raycast: rc, tag: 'metal' });
      const hx = (kx + jx) / 2;
      rope(hx, 9.5, kz, hx, 5.4, kz);
      const cargo = new THREE.Mesh(cachedBox(1.8, 1.4, 1.8), MAT.wood);
      cargo.position.set(hx, 4.6, kz);
      cargo.castShadow = true; cargo.userData.tag = 'wood';
      cell(hx, kz).add(cargo); rc.push(cargo);
    }

    // ---- steam: eight wall nozzles puffing on a timer + three launch
    // vents (this.vents) that throw the player onto the high decks
    const nozzles = [[50, -27.6], [70, -27.6], [84, -27.6], [101.2, -20], [101.2, -2],
      [46.6, -16], [46.6, 12], [70, 19.2]];
    const nzI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.44, 1, 8), brass, 8);
    nozzles.forEach(([nx, nz], i) => put(nzI, i, nx, 1.6, nz, 0, 1, 3.2, 1));
    const nzCap = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.54, 0.3, 0.4, 8), MAT.metalDark, 8);
    nozzles.forEach(([nx, nz], i) => put(nzCap, i, nx, 3.4, nz));
    core.add(nzI, nzCap);
    const vents = [[66, -25.2], [94, 14], [72, 10]];
    for (const [vx, vz] of vents) {
      addBox(cell(vx, vz), { w: 1.6, h: 0.32, d: 1.6, mat: MAT.metalDark, x: vx, y: 0.16, z: vz, collide: world, raycast: rc, tag: 'metal' });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.16, 8, 16), brass);
      ring.position.set(vx, 0.5, vz); ring.rotation.x = Math.PI / 2;
      ring.userData.tag = 'metal';
      cell(vx, vz).add(ring);
      this.vents.push({ x: vx, z: vz, r: 1.7, power: 13 });
    }

    // ---- fake god-rays punching down through the cloud light
    const rayMats = [];
    for (const [gx, gz, tilt] of [[58, -6, 0.16], [86, 6, -0.12], [66, 16, 0.22]]) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.2, 15, 14, 1, true), m);
      cone.position.set(gx, 7.6, gz);
      cone.rotation.x = Math.PI; cone.rotation.z = tilt;
      core.add(cone);
      rayMats.push(m);
    }

    // ---- supply cover: instanced crates + powder drums (solid, one AABB each)
    const crates = new THREE.InstancedMesh(cachedBox(1.5, 1.4, 1.5), MAT.wood, 8);
    [[52, 4, 0.2], [57, -20, -0.3], [76, 18, 0.5], [98, -14, 0.1], [63, -12, 0.8], [88, -6, -0.5], [50, -4, 0.4], [78, -12, 0.2]]
      .forEach(([px, pz, ry], i) => {
        put(crates, i, px, 0.7, pz, ry);
        world.addBox(new THREE.Vector3(px - 1.06, 0, pz - 1.06), new THREE.Vector3(px + 1.06, 1.4, pz + 1.06));
      });
    const drums = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 10), bronze, 6);
    [[55, 8], [68, -2], [90, -18], [60, 20], [82, 8], [47, -24]].forEach(([px, pz], i) => {
      put(drums, i, px, 0.53, pz);
      world.addBox(new THREE.Vector3(px - 0.44, 0, pz - 0.44), new THREE.Vector3(px + 0.44, 1.05, pz + 0.44));
    });
    core.add(crates, drums); rc.push(crates, drums);

    // ---- far machinery silhouettes floating over the sea (hi LOD + bbox proxy)
    for (const [gx, gz] of [[cx - 95, cz - 80], [cx + 110, cz - 55], [cx - 80, cz + 90], [cx + 125, cz + 65]]) {
      const hi = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const t = new THREE.Mesh(cachedBox(rand(2.4, 5), rand(9, 20), rand(2.4, 5)), bronze);
        t.position.set(gx + rand(-12, 12), rand(2, 9), gz + rand(-12, 12));
        hi.add(t);
      }
      const gr = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.9, 8, 20), MAT.metalDark);
      gr.position.set(gx, 6, gz);
      hi.add(gr);
      core.add(lodNode(hi, bboxProxy(hi, 0x5d5240), 55));
    }

    // ---- brass lanterns under the gantry lip + at the mooring masts
    const lants = new THREE.InstancedMesh(cachedBox(0.22, 0.26, 0.22), MAT.led(0xffc26a, 2.1), 14);
    let li = 0;
    for (let x = 58; x <= 90; x += 6.5) put(lants, li++, x, 3.15, -25.8);
    for (const [mx, mz, my] of [[46, -12, 6.4], [48.5, 16, 6.4], [71, -20, 6.4], [100.6, 19.2, 6.2], [50, -29.2, 2.4], [70, 20.8, 2.4]])
      put(lants, li++, mx, my, mz);
    lants.count = li;
    core.add(lants);

    // ---- warm sunlit harbor: one key sun wash + fills (fixture pool safe)
    const sun = new THREE.PointLight(0xffe2ae, 120, 50, 1.8); sun.position.set(70, 9, -4);
    const sun2 = new THREE.PointLight(0xffd89a, 90, 46, 1.8); sun2.position.set(92, 8.5, 12);
    const sun3 = new THREE.PointLight(0xffdcb0, 75, 42, 1.8); sun3.position.set(52, 8.5, 14);
    const warm = new THREE.PointLight(0xffc878, 90, 40, 1.9); warm.position.set(84, 7, -24);
    scene.add(sun, sun2, sun3, warm);
    this.areaLights.push(sun, sun2, sun3, warm);

    makeSign(cell(48, -14), { tex: TEX.hangingSign('天空港', 'SKYPORT · HOLD THE RAIL', '#3a2b14', '⚑'),
      w: 3, h: 0.75, x: 48.5, y: 3.4, z: -14, rotY: Math.PI / 2, intensity: 1.6 });

    const vt = { t: 0 };
    this.updaters.push((dt) => {
      envU.value += dt;
      cloudU.t.value += dt;
      for (const [gnode, om] of gears) gnode.rotation.z += om * dt;
      const tt = performance.now() / 1000;
      rayMats.forEach((m, i) => { m.opacity = 0.035 + 0.02 * Math.sin(tt * 0.7 + i * 2.1); });
      vt.t -= dt;
      if (vt.t <= 0) {
        vt.t = 0.35;
        const [nx, nz] = randPick(nozzles);
        this.p.smokePuff(nx, 3.8, nz, 3, 0.9, { x: 0, y: 1, z: 0 }, 1.1);
        const [vx, vz] = randPick(vents);
        this.p.smokePuff(vx, 0.8, vz, 2, 0.95, { x: 0, y: 1, z: 0 }, 1.6);
      }
    });

    SPAWN_POOLS.skyport = [
      { pos: [64, -6],   wps: [[64, -6], [69, -5], [60, -8]] },
      { pos: [84, -2],   wps: [[84, -2], [89, -4], [80, -5]] },
      { pos: [72, 4],    wps: [[72, 4], [76, 6], [68, 7]] },
      { pos: [56, 12],   wps: [[56, 12], [60, 14], [52, 15]] },
      { pos: [96, -10],  wps: [[96, -10], [92, -12], [99, -7]] },
      { pos: [80, -20],  wps: [[80, -20], [84, -18], [76, -17]] },
      { pos: [90, 8],    wps: [[90, 8], [86, 6], [93, 5]] },
    ];
  }

  // ================= MISSION 08 · 量子実験室 · 46 × 46 m ===================

  // White minimal hall: thin-line panels with recessed light coves, a
  // polished near-mirror dark floor, ONE full mirror wall, two
  // transmission-glass partitions — and cover hugging ONLY the walls, so
  // every sight line across the open center stays duel-clean. The quantum
  // core floats dead center (no pedestal): transparent body + fresnel
  // shell + pale ripple rings; its flash cycles on the EMP mod's cadence.
  _lab() {
    const G = this._g('lab');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 64, X1 = 110, Z0 = 36, Z1 = 82;
    this.bounds.lab = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('lab', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('lab');
    const cell = (x, z) => this._cell('lab', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const put = (im, i, px, py, pz, ry = 0) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(1, 1, 1));
      im.setMatrixAt(i, mtx);
    };

    // ---- thin-line white panels with a recessed glow band
    const labWall = tex('labwall', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#eceef0'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = '#aeb4ba'; x.lineWidth = 2;
      for (let i = 0; i <= 2; i++) {
        x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, 256); x.stroke();
        x.beginPath(); x.moveTo(0, i * 128); x.lineTo(256, i * 128); x.stroke();
      }
      x.fillStyle = '#c6ccd2'; x.fillRect(0, 150, 256, 6);
      x.fillStyle = 'rgba(210,235,255,0.7)'; x.fillRect(0, 152, 256, 2);
      return { c, x };
    }, { repeat: [11, 3] });
    const wallMat = new THREE.MeshStandardMaterial({ map: labWall, roughness: 0.5, metalness: 0.05 });
    // polished near-mirror dark floor — the hall's other signature
    const labFloor = tex('labfloor', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#23262b'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = 'rgba(220,230,240,0.07)'; x.lineWidth = 2;
      x.strokeRect(2, 2, 252, 252);
      x.fillStyle = 'rgba(255,255,255,0.04)';
      for (let i = 0; i < 400; i++) x.fillRect(rand(0, 254), rand(0, 254), 2, 2);
      return { c, x };
    }, { repeat: [22, 22] });
    const floorMat = new THREE.MeshPhysicalMaterial({
      map: labFloor, roughness: 0.1, metalness: 0.18,
      envMapIntensity: 2.2, clearcoat: 0.85, clearcoatRoughness: 0.12,
    });
    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: floorMat });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 6.5, mat: wallMat });
    addBox(core, { w: X1 - X0 + 2, h: 0.4, d: Z1 - Z0 + 2, mat: MAT.painted(0xdfe3e8), x: cx, y: 6.7, z: cz, cast: false, raycast: rc });

    // ---- ONE full mirror wall (north): one-way mirror look, floor to cove
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 - 1, 5.9),
      new THREE.MeshStandardMaterial({ color: 0x141e2a, metalness: 1.0, roughness: 0.06, envMapIntensity: 3.2 }));
    mirror.position.set(cx, 3.1, Z1 - 0.32);
    mirror.rotation.y = Math.PI;
    mirror.userData.tag = 'glass';
    core.add(mirror); rc.push(mirror);
    for (const fx of [X0 + 0.7, X1 - 0.7])                              // mirror frame + edge pilots
      addBox(core, { w: 0.5, h: 6.1, d: 0.3, mat: MAT.metalDark, x: fx, y: 3.05, z: Z1 - 0.4, collide: world, raycast: rc, tag: 'metal' });
    addBox(core, { w: X1 - X0 - 0.6, h: 0.35, d: 0.3, mat: MAT.metalDark, x: cx, y: 6.25, z: Z1 - 0.4, collide: world, raycast: rc, tag: 'metal' });
    for (const fx of [X0 + 1.05, X1 - 1.05]) {
      const edge = new THREE.Mesh(cachedBox(0.1, 5.6, 0.1), MAT.led(0x9fdcff, 1.8));
      edge.position.set(fx, 3.1, Z1 - 0.58);
      core.add(edge);
    }
    const reflMat = new THREE.MeshBasicMaterial({ color: 0xe8f1fb, transparent: true,
      opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 11; i++) {                                 // smeared 'reflections' of the cove strips
      const refl = new THREE.Mesh(cachedBox(0.7 + (i % 3) * 0.8, 5.0 - (i % 4) * 0.8, 0.02), reflMat);
      refl.position.set(X0 + 3 + i * 4.05 + (i % 3) * 1.1, 3.0, Z1 - 0.35);
      refl.renderOrder = 2;
      core.add(refl);
    }

    // ---- recessed light strips at the floor + ceiling wall lines, plus
    // ceiling coves down the hall (both instanced)
    const cove = new THREE.InstancedMesh(cachedBox(1, 0.1, 0.07), MAT.led(0xeaf2ff, 1.2), 24);
    let ci2 = 0;
    e.set(0, 0, 0); q.setFromEuler(e);
    for (const yy of [0.4, 6.1]) {
      mtx.compose(v.set(X0 + 11, yy, Z0 + 0.35), q, s.set(18, 1, 1)); cove.setMatrixAt(ci2++, mtx);
      mtx.compose(v.set(X0 + 33, yy, Z0 + 0.35), q, s.set(18, 1, 1)); cove.setMatrixAt(ci2++, mtx);
      mtx.compose(v.set(X0 + 11, yy, Z1 - 0.35), q, s.set(18, 1, 1)); cove.setMatrixAt(ci2++, mtx);
      mtx.compose(v.set(X0 + 33, yy, Z1 - 0.35), q, s.set(18, 1, 1)); cove.setMatrixAt(ci2++, mtx);
    }
    e.set(0, Math.PI / 2, 0); q.setFromEuler(e);
    for (const zz of [Z0 + 11, Z0 + 33]) for (const [xx, yy] of [[X0 + 0.35, 0.4], [X0 + 0.35, 6.1], [X1 - 0.35, 0.4], [X1 - 0.35, 6.1]]) {
      mtx.compose(v.set(xx, yy, zz), q, s.set(18, 1, 1)); cove.setMatrixAt(ci2++, mtx);
    }
    cove.count = ci2;
    core.add(cove);
    const coveT = new THREE.InstancedMesh(cachedBox(0.35, 0.08, 8), MAT.led(0xf4f8ff, 1.0), 12);
    let cti = 0;
    for (const lx of [X0 + 6, cx, X1 - 6]) for (const lz of [Z0 + 6, Z0 + 15, Z0 + 24, Z0 + 32]) put(coveT, cti++, lx, 6.45, lz);
    coveT.count = cti;
    core.add(coveT);

    // ---- THE quantum core: floating transparent body (no pedestal), an
    // outer fresnel shell, pale ripple rings spreading down to the floor
    const coreMat = new THREE.MeshPhysicalMaterial({
      color: 0x6fd4ff, emissive: 0x2f8fd0, emissiveIntensity: 1.1, roughness: 0.12,
      transmission: 0.65, thickness: 1.4, transparent: true, opacity: 0.9,
    });
    const qcore = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), coreMat);
    qcore.position.set(cx, 2.5, cz);
    core.add(qcore); rc.push(qcore);
    const fresU = { p: { value: 0 } };
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 3), new THREE.ShaderMaterial({
      uniforms: { uP: fresU.p, uC: { value: new THREE.Color(0x9fe4ff) } },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vV;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform float uP; uniform vec3 uC;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
          float p = 0.55 + 0.45 * sin(uP * 2.2);
          gl_FragColor = vec4(uC * (f * (1.2 + p)), f * (0.35 + 0.3 * p));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    shell.position.copy(qcore.position);
    core.add(shell);
    const ripples = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 48),
        new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      r.position.copy(qcore.position);
      r.rotation.x = Math.PI / 2;
      core.add(r);
      ripples.push({ m: r, ph: i / 3 });
    }
    const coreLight = new THREE.PointLight(0x7fd0ff, 34, 40, 2);
    coreLight.position.copy(qcore.position);
    scene.add(coreLight);
    this.areaLights.push(coreLight);

    // ---- cover ONLY along the walls: instanced consoles + low cabinets;
    // two transmission-glass partitions cut the flanks, never the center
    const benchMat = new THREE.MeshStandardMaterial({ color: 0xf3f5f7, roughness: 0.4, metalness: 0.15 });
    const consoles = new THREE.InstancedMesh(cachedBox(4.4, 0.95, 1), benchMat, 6);
    const cSpots = [[X0 + 1.1, cz - 7, Math.PI / 2], [X0 + 1.1, cz + 7, Math.PI / 2],
      [X1 - 1.1, cz - 7, -Math.PI / 2], [X1 - 1.1, cz + 7, -Math.PI / 2],
      [cx - 9, Z0 + 1.1, 0], [cx + 9, Z0 + 1.1, 0]];
    cSpots.forEach(([px, pz, ry], i) => {
      put(consoles, i, px, 0.475, pz, ry);
      const fw = ry ? 1 : 4.4, fd = ry ? 4.4 : 1;
      world.addBox(new THREE.Vector3(px - fw / 2, 0, pz - fd / 2), new THREE.Vector3(px + fw / 2, 0.95, pz + fd / 2));
    });
    core.add(consoles); rc.push(consoles);
    const scrMat = MAT.screen(TEX.infoScreen, 1.2);
    for (const [px, pz, ry] of cSpots) {
      const alongX = ry === 0;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), scrMat);
      if (alongX) { scr.position.set(px, 2.15, Z0 + 0.45); scr.rotation.y = 0; }
      else if (px < cx) { scr.position.set(X0 + 0.45, 2.15, pz); scr.rotation.y = Math.PI / 2; }
      else { scr.position.set(X1 - 0.45, 2.15, pz); scr.rotation.y = -Math.PI / 2; }
      cell(px, pz).add(scr);
    }
    const cabinets = new THREE.InstancedMesh(cachedBox(1.2, 0.85, 0.5), benchMat, 4);
    for (let i = 0; i < 4; i++) {
      const [px, pz] = [[X0 + 0.9, Z0 + 7], [X0 + 0.9, Z1 - 7], [X1 - 0.9, Z0 + 7], [X1 - 0.9, Z1 - 7]][i];
      put(cabinets, i, px, 0.425, pz, Math.PI / 2);
      world.addBox(new THREE.Vector3(px - 0.25, 0, pz - 0.6), new THREE.Vector3(px + 0.25, 0.85, pz + 0.6));
    }
    core.add(cabinets); rc.push(cabinets);
    const partition = (px, pz, horiz) => {
      const C = cell(px, pz);
      addBox(C, { w: horiz ? 8 : 0.24, h: 2.6, d: horiz ? 0.24 : 9, mat: MAT.glass, x: px, y: 1.3, z: pz, collide: world, raycast: rc, tag: 'glass', cast: false });
      for (const [ex, ez] of horiz ? [[px - 4, pz], [px + 4, pz]] : [[px, pz - 4.5], [px, pz + 4.5]])
        addBox(C, { w: 0.16, h: 2.7, d: 0.16, mat: MAT.metalDark, x: ex, y: 1.35, z: ez, collide: world, raycast: rc, tag: 'metal' });
      const cap = new THREE.Mesh(cachedBox(horiz ? 8 : 0.1, 0.08, horiz ? 0.1 : 9), MAT.led(0xbfe8ff, 1.2));
      cap.position.set(px, 2.64, pz);
      C.add(cap);
    };
    partition(75, 52, false);
    partition(99, 66, true);

    const wl1 = new THREE.PointLight(0xf4f8ff, 70, 46, 1.8); wl1.position.set(X0 + 10, 5.9, Z0 + 11);
    const wl2 = new THREE.PointLight(0xf4f8ff, 70, 46, 1.8); wl2.position.set(X1 - 10, 5.9, Z0 + 11);
    const wl3 = new THREE.PointLight(0xf4f8ff, 70, 46, 1.8); wl3.position.set(X0 + 10, 5.9, Z1 - 11);
    const wl4 = new THREE.PointLight(0xf4f8ff, 70, 46, 1.8); wl4.position.set(X1 - 10, 5.9, Z1 - 11);
    const mw = new THREE.PointLight(0xbfd8e8, 70, 34, 2); mw.position.set(cx, 5.4, Z1 - 6);
    scene.add(wl1, wl2, wl3, wl4, mw);
    this.areaLights.push(wl1, wl2, wl3, wl4, mw);

    makeSign(cell(cx, Z0), { tex: TEX.hangingSign('量子実験室', 'QUANTUM LAB · SECTOR R', '#dfe3e8', '∿'),
      w: 3, h: 0.75, x: cx, y: 3.6, z: Z0 + 0.68, intensity: 1.4 });

    const t = { p: 0 };
    this.updaters.push((dt) => {
      t.p += dt;
      const tt = t.p;
      qcore.scale.setScalar(1 + Math.sin(tt * 2.4) * 0.07);
      qcore.rotation.y += dt * 0.5; qcore.rotation.x += dt * 0.22;
      shell.rotation.y -= dt * 0.3;
      fresU.p.value = tt;
      for (const rp of ripples) {
        const k = (tt * 0.34 + rp.ph) % 1;
        rp.m.scale.setScalar(1 + k * 4.6);
        rp.m.position.y = 2.5 - k * 1.9;
        rp.m.material.opacity = 0.38 * (1 - k);
      }
      // EMP flash riding the HUD-glitch cadence (game.js: 17-25 s)
      const em = tt % 19;
      const flash = em < 1.4 ? 1 - em / 1.4 : 0;
      coreMat.emissiveIntensity = 1.1 + 2.8 * flash + 0.35 * Math.sin(tt * 2.4);
      coreLight.intensity = 30 + 30 * flash + 8 * Math.sin(tt * 2.4);
    });

    SPAWN_POOLS.lab = [
      { pos: [87, 72],    wps: [[87, 72], [83, 70], [91, 70]] },
      { pos: [70, 47],    wps: [[70, 47], [73, 50], [66, 44]] },
      { pos: [103, 56],   wps: [[103, 56], [100, 58], [106, 53]] },
      { pos: [67, 72],    wps: [[67, 72], [70, 74], [64, 75]] },
      { pos: [103, 74],   wps: [[103, 74], [100, 76], [106, 77]] },
      { pos: [74, 40],    wps: [[74, 40], [77, 42], [71, 42]] },
      { pos: [100, 40],   wps: [[100, 40], [103, 42], [97, 42]] },
    ];
  }

  // ================= MISSION 09 · 沈没大陸 · 52 × 52 m =====================

  // Drowned Atlantis: two Greek colonnades with architraves and a broken
  // pediment, glowing-seam obelisks in a NE plaza, instanced coral fans +
  // swaying kelp, orbiting glowing fish schools, caustic overlays on the
  // seabed AND the temple faces, and three visible current channels that
  // throw the player spawn → temple → plaza (mods.currents).
  _atlantis() {
    const G = this._g('atlantis');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -130, X1 = -78, Z0 = 36, Z1 = 88;
    this.bounds.atlantis = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('atlantis', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('atlantis');
    const cell = (x, z) => this._cell('atlantis', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const putM = (im, i, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      e.set(rx, ry, rz); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };

    const marble = tex('marble', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#7e93a0'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = 'rgba(160,195,215,0.5)'; x.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        x.beginPath();
        const sx = Math.random() * 256, sy = Math.random() * 256;
        x.moveTo(sx, sy);
        x.bezierCurveTo(sx + 60, sy + 20, sx - 40, sy + 70, sx + 30, sy + 110);
        x.stroke();
      }
      x.fillStyle = 'rgba(55,85,105,0.4)';
      for (let i = 0; i < 1200; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      x.fillStyle = 'rgba(230,120,150,0.12)';
      for (let i = 0; i < 30; i++) x.fillRect(Math.random() * 256, Math.random() * 256, rand(2, 7), rand(2, 7));
      return { c, x };
    }, { repeat: [14, 14] });
    const stoneMat = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.8 });
    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: stoneMat });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 14, mat: stoneMat });

    // ---- CAUSTICS everywhere: one seabed overlay + two big vertical
    // sheets in front of the temple faces (different scale per sheet)
    const caustics = [];
    const causticPlane = (w, h, x, y, z, ry, i0) => {
      const m = causticMat(i0);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      p.position.set(x, y, z);
      p.rotation.y = ry;
      core.add(p);
      caustics.push(m);
    };
    causticPlane(X1 - X0, Z1 - Z0, cx, 0.05, cz, 0, 1);
    causticPlane(26, 7.6, -104, 3.9, 70.78, Math.PI, 0.85);   // broken pediment face
    causticPlane(24, 8, -102, 4, 55.75, Math.PI, 0.7);        // colonnade south face

    // ---- two marble colonnades: instanced shafts + bases + capitals with
    // architrave beams riding on top (12 columns, fluting from the map)
    const colXs = [-116, -111.2, -106.4, -101.6, -96.8, -92];
    const colPos = [];
    for (const cz2 of [56, 68]) for (const px of colXs) colPos.push([px, cz2]);
    const shafts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 0.95, 7, 12), stoneMat, colPos.length);
    const bases = new THREE.InstancedMesh(cachedBox(2.1, 0.4, 2.1), stoneMat, colPos.length);
    const caps = new THREE.InstancedMesh(cachedBox(2.2, 0.5, 2.2), stoneMat, colPos.length);
    colPos.forEach(([px, pz], i) => {
      putM(shafts, i, px, 3.7, pz);
      putM(bases, i, px, 0.2, pz);
      putM(caps, i, px, 7.45, pz, 0, rand(0, 0.3));
      world.addBox(new THREE.Vector3(px - 0.95, 0, pz - 0.95), new THREE.Vector3(px + 0.95, 7.2, pz + 0.95));
    });
    core.add(shafts, bases, caps); rc.push(shafts);
    for (const bz of [56, 68])
      addBox(cell(-104, bz), { w: 26.5, h: 0.9, d: 1.7, mat: stoneMat, x: -104, y: 8.15, z: bz, collide: world, raycast: rc });
    for (const bx of [-114.5, -93.5])
      addBox(cell(bx, 62), { w: 1.7, h: 0.9, d: 13.5, mat: stoneMat, x: bx, y: 8.15, z: 62, collide: world, raycast: rc });

    // ---- broken pediment wall north of the colonnade: two wall halves +
    // flattened pyramid caps, a jagged gap where the middle collapsed
    for (const [px0, px1] of [[-118, -108.6], [-99.4, -90]]) {
      addBox(cell((px0 + px1) / 2, 71.5), { w: px1 - px0, h: 4.8, d: 1.3, mat: stoneMat,
        x: (px0 + px1) / 2, y: 2.4, z: 71.5, collide: world, raycast: rc });
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.4, 3), stoneMat);
      ped.rotation.x = -Math.PI / 2;                                // 3-gon prism -> gable, apex up
      ped.scale.set(px0 < -104 ? 1.45 : 0.95, 1.15, 0.6);           // Y = slab thickness, Z = gable height
      ped.position.set((px0 + px1) / 2, 5.9, 71.5);
      ped.castShadow = true; ped.userData.tag = 'concrete';
      cell((px0 + px1) / 2, 71.5).add(ped); rc.push(ped);
      world.addBox(new THREE.Vector3(px0, 4.8, 70.8), new THREE.Vector3(px1, 6.6, 72.2));
      // broken-jaw debris spilling from the gap
      addBox(cell(-104, 71.8), { w: 1.2, h: 1.1, d: 1.2, mat: stoneMat, x: -104.8, y: 0.55, z: 72.2, rotY: 0.5, collide: world, raycast: rc });
      addBox(cell(-103, 72.4), { w: 0.9, h: 0.8, d: 0.9, mat: stoneMat, x: -103.2, y: 0.4, z: 72.6, rotY: -0.3, collide: world, raycast: rc });
    }
    // fallen lintel slab in the pediment gap (cover)
    addBox(cell(-104, 71), { w: 4, h: 0.8, d: 1.4, mat: stoneMat, x: -104, y: 0.4, z: 71, rotY: 0.18, collide: world, raycast: rc });
    // sanctum altar under the colonnade, glowing rune seam on its face
    addBox(cell(-104, 62), { w: 6, h: 0.35, d: 4.2, mat: stoneMat, x: -104, y: 0.175, z: 62, collide: world, raycast: rc });
    addBox(cell(-104, 62), { w: 3.4, h: 1.15, d: 2.6, mat: new THREE.MeshStandardMaterial({ color: 0x22323e, roughness: 0.6, metalness: 0.2 }),
      x: -104, y: 0.925, z: 62, collide: world, raycast: rc, tag: 'stone' });
    const runeSeam = new THREE.Mesh(cachedBox(3.5, 0.08, 0.1), MAT.led(0x38d8ff, 2.2));
    runeSeam.position.set(-104, 1.5, 60.65);
    cell(-104, 62).add(runeSeam);

    // ---- OBELISKS: four dark stone needles with glowing blue seams in a
    // NE plaza — the ancient tech still drinking the sea
    const obeliskMat = new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.5, metalness: 0.3 });
    const seamMat = MAT.led(0x38d8ff, 2.6);
    const seams = new THREE.InstancedMesh(cachedBox(0.14, 5.6, 0.14), seamMat, 8);
    let sei = 0;
    for (const [ox, oz] of [[-90, 78], [-84, 78], [-90, 85], [-84, 85]]) {
      const C = cell(ox, oz);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 6.2, 4), obeliskMat);
      shaft.position.set(ox, 3.1, oz);
      shaft.rotation.y = Math.PI / 4;
      shaft.castShadow = true; shaft.userData.tag = 'stone';
      C.add(shaft); rc.push(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 4), obeliskMat);
      tip.position.set(ox, 6.8, oz);
      tip.rotation.y = Math.PI / 4;
      tip.userData.tag = 'stone';
      C.add(tip); rc.push(tip);
      putM(seams, sei++, ox - 0.42, 3.1, oz - 0.42);
      putM(seams, sei++, ox + 0.42, 3.1, oz + 0.42, 0, Math.PI / 8);
      world.addBox(new THREE.Vector3(ox - 0.75, 0, oz - 0.75), new THREE.Vector3(ox + 0.75, 7.4, oz + 0.75));
    }
    seams.count = sei;
    core.add(seams);

    // ---- fallen column drums as cover (instanced, one collider each) +
    // seabed rubble (instanced decor)
    const drums = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.85, 0.85, 1.3, 12), stoneMat, 12);
    const drumSpots = [[-124, 47, 0.15], [-122.5, 49.5, -0.3], [-124.5, 51.5, 0.5],
      [-110, 39, 0.4], [-112, 41.5, -0.2], [-108, 37.5, 0.8],
      [-95, 39.5, 0.2], [-93, 41, 0.9], [-97, 41.5, -0.4],
      [-110, 79.5, 0.1], [-108, 82, -0.35], [-79, 58.5, 0.25]];
    drumSpots.forEach(([px, pz, ry], i) => {
      putM(drums, i, px, 0.85, pz, 0, ry, Math.PI / 2);
      world.addBox(new THREE.Vector3(px - 1.1, 0, pz - 1.1), new THREE.Vector3(px + 1.1, 1.7, pz + 1.1));
    });
    core.add(drums); rc.push(drums);
    const rubble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), stoneMat, 20);
    for (let i = 0; i < 20; i++)
      putM(rubble, i, rand(X0 + 4, X1 - 4), 0.18, rand(Z0 + 4, Z1 - 4), rand(0, 3), rand(0, 3), 0, rand(0.5, 1.2), rand(0.3, 0.6), rand(0.5, 1.2));
    core.add(rubble);

    // ---- CORAL: instanced fans (two families) on column bases, drums and
    // rubble — KELP: instanced strips swaying on a vertex-shader breeze
    const coralA = new THREE.InstancedMesh(new THREE.CircleGeometry(0.95, 7, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xff5a8a, emissive: 0xff5a8a, emissiveIntensity: 0.5, roughness: 0.85, side: THREE.DoubleSide }), 24);
    const coralB = new THREE.InstancedMesh(new THREE.CircleGeometry(0.8, 7, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x2fd0a0, emissive: 0x2fd0a0, emissiveIntensity: 0.5, roughness: 0.85, side: THREE.DoubleSide }), 20);
    let ca = 0, cb = 0;
    const coral = (px, py, pz, rx, ry2, rz, alt) => {
      if (alt && cb < 20) putM(coralB, cb++, px, py, pz, rx, ry2, rz);
      else if (ca < 24) putM(coralA, ca++, px, py, pz, rx, ry2, rz);
      else if (cb < 20) putM(coralB, cb++, px, py, pz, rx, ry2, rz);
    };
    colPos.forEach(([px, pz]) => {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + rand(0, 1);
        coral(px + Math.cos(a) * 1.1, 0.42, pz + Math.sin(a) * 1.1, Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55, chance(0.5));
      }
    });
    drumSpots.forEach(([px, pz]) => coral(px + rand(-1, 1), 1.85, pz + rand(-1, 1), rand(-0.4, 0.4), rand(0, 3), rand(-0.4, 0.4), chance(0.5)));
    for (let i = 0; i < 10; i++) coral(rand(X0 + 6, X1 - 6), 0.42, rand(Z0 + 6, Z1 - 6), rand(-0.5, 0.5), 0, rand(-0.5, 0.5), chance(0.7));
    coralA.count = ca; coralB.count = cb;
    core.add(coralA, coralB);
    const kelpU = { value: 0 };
    const kelpMat = new THREE.MeshStandardMaterial({ color: 0x2e7d5a, roughness: 0.9, metalness: 0 });
    kelpMat.onBeforeCompile = (sh) => {
      sh.uniforms.uK = kelpU;
      sh.vertexShader = 'uniform float uK;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        transformed.x += sin(uK * 1.5 + instanceMatrix[3][0] + instanceMatrix[3][2]) * max(0.0, position.y + 1.2) * 0.1;
        transformed.z += cos(uK * 1.2 + instanceMatrix[3][2]) * max(0.0, position.y + 1.2) * 0.07;
        #endif`);
    };
    kelpMat.customProgramCacheKey = () => 'kelpsway';
    const kelp = new THREE.InstancedMesh(cachedBox(0.16, 2.4, 0.06), kelpMat, 36);
    for (let i = 0; i < 36; i++) {
      let px = rand(X0 + 3, X1 - 3), pz = rand(Z0 + 3, Z1 - 3), guard = 0;
      while (px > -119 && px < -90 && pz > 54 && pz < 73 && guard++ < 10) {
        px = rand(X0 + 3, X1 - 3); pz = rand(Z0 + 3, Z1 - 3);
      }
      putM(kelp, i, px, 1.2 * rand(0.8, 1.3), pz, 0, rand(0, 3), 0, 1, rand(0.7, 1.5), 1);
    }
    core.add(kelp);

    // ---- glowing fish in three slow orbit schools (instanced per frame)
    const fishMat = new THREE.MeshStandardMaterial({ color: 0xa8e2f2, emissive: 0x3a86a0,
      emissiveIntensity: 0.7, roughness: 0.55, metalness: 0.05, envMapIntensity: 1.4 });
    const fish = new THREE.InstancedMesh(cachedBox(0.85, 0.3, 0.22), fishMat, 18);
    const fishTail = new THREE.InstancedMesh(cachedBox(0.4, 0.95, 0.08), fishMat, 18);  // tall caudal fin
    const fishD = [];
    for (const sc of [[-104, 62], [-113, 64], [-95, 61]])     // schools inside the colonnade corridor, clear of anchors
      for (let k = 0; k < 6; k++)
        fishD.push({ a: rand(0, 6.3), px: sc[0], pz: sc[1], r: rand(2.5, 5.5), sp: rand(0.35, 0.9), y: rand(1.4, 3.6) });
    fish.frustumCulled = false; fishTail.frustumCulled = false;   // absolute-space instances; origin sphere would cull them
    core.add(fish, fishTail);

    // ---- WATER CURRENT CHANNELS: spawn → temple → obelisk plaza, each
    // made visible by drifting bubble streaks pinned along its lane
    const lanes = [
      { x: -124, z: 48, dx: 0.71, dz: 0.7, r: 4.5, power: 7 },
      { x: -97, z: 69, dx: 0.71, dz: 0.7, r: 5, power: 7.5 },
      { x: -104, z: 81, dx: -1, dz: 0, r: 4.5, power: 6.5 },
    ];
    for (const l of lanes) this.currents.push(l);
    const streaks = new THREE.InstancedMesh(cachedBox(0.6, 0.04, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false }), 60);
    const streakD = [];
    for (const l of lanes) for (let k = 0; k < 20; k++) streakD.push({ l, o: k / 20, off: rand(-l.r * 0.7, l.r * 0.7) });
    streaks.frustumCulled = false;
    core.add(streaks);
    const intake = new THREE.InstancedMesh(new THREE.TorusGeometry(0.9, 0.12, 8, 18), MAT.led(0x38d8ff, 1.1), 3);
    lanes.forEach((l, i) => {
      e.set(Math.PI / 2, 0, 0); q.setFromEuler(e);
      mtx.compose(v.set(l.x - l.dx * l.r * 0.8, 0.5, l.z - l.dz * l.r * 0.8), q, s.set(1, 1, 1));
      intake.setMatrixAt(i, mtx);
    });
    core.add(intake);

    // ---- ambient plankton/bubble motes + timed bubble columns on the lanes
    const mpos = [];
    for (let i = 0; i < 260; i++) mpos.push(rand(X0 + 2, X1 - 2) - cx, rand(0.3, 9) - 4.5, rand(Z0 + 2, Z1 - 2) - cz);
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.Float32BufferAttribute(mpos, 3));
    const motes = new THREE.Points(mgeo, new THREE.PointsMaterial({
      map: TEX.dust, color: 0x9fdcff, size: 0.11, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    motes.position.set(cx, 4.5, cz);
    core.add(motes);

    // ---- murk light: cold shafts from the surface, plaza glow, spawn wash
    const l1 = new THREE.PointLight(0x3fa8d8, 90, 42, 1.8); l1.position.set(-118, 7, 44);
    const l2 = new THREE.PointLight(0x2a7fb8, 90, 42, 1.8); l2.position.set(-92, 7, 74);
    const l3 = new THREE.PointLight(0x58c8e8, 70, 36, 1.9); l3.position.set(-104, 6.5, 62);
    const l4 = new THREE.PointLight(0x3f7fd0, 55, 30, 2); l4.position.set(-87, 6, 81.5);
    const l5 = new THREE.PointLight(0x58b8d8, 55, 30, 2); l5.position.set(-124, 5, 42);
    scene.add(l1, l2, l3, l4, l5);
    this.areaLights.push(l1, l2, l3, l4, l5);

    makeSign(cell(-120, Z0), { tex: TEX.hangingSign('沈没大陸', 'ATLANTIS RUINS', '#07202e', '◈'),
      w: 3, h: 0.8, x: -120, y: 3.8, z: Z0 + 0.7, intensity: 1.7 });

    const bt = { t: 0 };
    let warmed = false;                                         // preheat bubble columns for mission entry
    this.updaters.push((dt) => {
      const tt = performance.now() / 1000;
      if (!warmed) {
        warmed = true;
        for (let i = 0; i < 36; i++) {
          const l0 = randPick(lanes);
          const along0 = rand(-l0.r, l0.r);
          this.p.bubbles.spawn({
            x: l0.x + l0.dx * along0 + rand(-l0.r * 0.5, l0.r * 0.5), y: rand(0.2, 5.5),
            z: l0.z + l0.dz * along0 + rand(-l0.r * 0.5, l0.r * 0.5),
            vx: rand(-0.05, 0.05), vy: rand(0.8, 1.5), vz: rand(-0.05, 0.05),
            size: rand(0.16, 0.28), color: [0.75, 0.93, 1], alpha: 0.8,
            life: rand(0.5, 5.5), grow: 0.012, drag: 0.1, gravity: -0.15,
          });
        }
      }
      for (const cm of caustics) cm.uniforms.uT.value += dt * 0.9;
      kelpU.value += dt;
      fishD.forEach((fl, i) => {
        fl.a += fl.sp * dt;
        e.set(0, -fl.a + Math.PI / 2, 0); q.setFromEuler(e);
        const fx = fl.px + Math.cos(fl.a) * fl.r, fy = fl.y + Math.sin(fl.a * 2) * 0.3,
          fz = fl.pz + Math.sin(fl.a) * fl.r;
        mtx.compose(v.set(fx, fy, fz), q, s.set(2.3, 2.3, 2.3));
        fish.setMatrixAt(i, mtx);
        const tx = -1.7 * Math.cos(-fl.a + Math.PI / 2), tz = 1.7 * Math.sin(-fl.a + Math.PI / 2);
        mtx.compose(v.set(fx + tx, fy, fz + tz), q, s.set(2.3, 2.3, 2.3));
        fishTail.setMatrixAt(i, mtx);
      });
      fish.instanceMatrix.needsUpdate = true;
      fishTail.instanceMatrix.needsUpdate = true;
      streakD.forEach((sd, i) => {
        sd.o = (sd.o + dt * sd.l.power / (sd.l.r * 2)) % 1;
        const l = sd.l;
        const along = (sd.o * 2 - 1) * l.r;
        e.set(0, Math.atan2(l.dx, l.dz), 0); q.setFromEuler(e);
        mtx.compose(v.set(l.x + l.dx * along - l.dz * sd.off, 0.12, l.z + l.dz * along + l.dx * sd.off), q, s.set(1, 1, 1.8));
        streaks.setMatrixAt(i, mtx);
      });
      streaks.instanceMatrix.needsUpdate = true;
      seamMat.emissiveIntensity = 2.2 + 0.8 * Math.sin(tt * 1.6);
      runeSeam.material.emissiveIntensity = 1.8 + 0.6 * Math.sin(tt * 1.1 + 1);
      motes.rotation.y += dt * 0.015;
      bt.t -= dt;
      if (bt.t <= 0) {
        bt.t = 0.18;
        for (let bq = 0; bq < 3; bq++) {
          const l = randPick(lanes);
          const along = rand(-l.r, l.r);
          this.p.bubbles.spawn({
            x: l.x + l.dx * along + rand(-l.r * 0.5, l.r * 0.5), y: rand(0, 2),
            z: l.z + l.dz * along + rand(-l.r * 0.5, l.r * 0.5),
            vx: rand(-0.05, 0.05), vy: rand(0.8, 1.5), vz: rand(-0.05, 0.05),
            size: rand(0.16, 0.28), color: [0.75, 0.93, 1], alpha: 0.8,
            life: rand(3, 6), grow: 0.012, drag: 0.1, gravity: -0.15,
          });
        }
      }
    });

    SPAWN_POOLS.atlantis = [
      { pos: [-118, 46],  wps: [[-118, 46], [-121, 50], [-115, 43]] },
      { pos: [-88, 46],   wps: [[-88, 46], [-84, 48], [-91, 43]] },
      { pos: [-124, 62],  wps: [[-124, 62], [-121, 64], [-126, 66]] },
      { pos: [-79, 48],   wps: [[-79, 48], [-82, 50], [-77, 52]] },
      { pos: [-100, 44],  wps: [[-100, 44], [-96, 45], [-104, 42]] },
      { pos: [-118, 80],  wps: [[-118, 80], [-114, 82], [-121, 83]] },
      { pos: [-86, 56],   wps: [[-86, 56], [-83, 59], [-89, 59]] },
    ];
  }
}
