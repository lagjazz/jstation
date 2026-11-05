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
  }

  build() {
    this._cyber();
    this._moon();
    this._tomb();
    this._skyport();
    this._lab();
    this._atlantis();
  }

  update(dt) {
    for (const u of this.updaters) u(dt);
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
    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: (X0 + X1) / 2, z: (Z0 + Z1) / 2, mat: MAT.floor });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 16, mat: MAT.concreteDark });

    const building = (x0, x1, z0, z1, h) => {
      addBox(G, { w: x1 - x0, h, d: z1 - z0, mat: MAT.concreteDark,
        x: (x0 + x1) / 2, y: h / 2, z: (z0 + z1) / 2, collide: world, raycast: rc });
    };
    for (const [x0, x1, z0, z1, h] of [
      [-130, -121, -30, -21, 12], [-114, -106, -30, -23, 10], [-100, -86, -30, -22, 13],
      [-130, -120, 11, 20, 13], [-112, -103, 12, 20, 10], [-99, -86, 12, 20, 12],
      [-126, -119, -8, -3, 8], [-106, -99, -4, 3, 9], [-95, -90, -9, -3, 7],
    ]) building(x0, x1, z0, z1, h);

    // neon trims hugging building faces (some breakable panels)
    const neonCols = [0xff2b6d, 0x00e5ff, 0xa855f7, 0x22ff88, 0xffb400];
    const neon = (x, y, z, w, rotY, brk) => {
      const mat = MAT.led(randPick(neonCols), 2.2);
      const m = addBox(G, { w, h: 0.16, d: 0.06, mat, x, y, z, rotY, cast: false, raycast: rc,
        tag: brk ? 'glass' : 'metal' });
      if (brk) m.userData.shatter = true;
    };
    for (const [x, z, ry] of [
      [-120.9, -25, Math.PI / 2], [-125.9, -13, Math.PI / 2], [-106.4, -26, Math.PI / 2],
      [-100.4, -16, Math.PI / 2], [-99.4, 16, Math.PI / 2], [-112.4, 16, Math.PI / 2],
      [-120.4, 5.5, Math.PI / 2], [-119.4, -5.5, Math.PI / 2], [-98.4, 6, Math.PI / 2],
      [-117, -20.9, 0], [-102, -21.9, 0], [-105.5, 3.4, 0], [-94.5, -8.6, 0],
    ]) neon(x, rand(2.2, 7.5), z, rand(2, 4.6), ry, chance(0.35));
    // vertical neon strips (incl. the west entry lane around the spawn)
    for (const [x, z, h] of [[-129.7, -24, 8], [-129.7, -10, 7], [-129.7, 8, 8],
      [-129.6, -20, 7], [-129.6, -2, 6.5], [-129.6, 14, 8], [-119.8, -28.4, 6],
      [-86.4, -26, 7], [-86.4, 16, 7], [-99.8, -6, 6], [-106.6, -14, 6]]) {
      addBox(G, { w: 0.18, h, d: 0.06, mat: MAT.led(randPick(neonCols), 2.2), x, y: h / 2 + 0.5, z, rotY: Math.PI / 2, cast: false, raycast: rc, tag: 'metal' });
    }
    // big neon kanji signs
    makeSign(scene, { tex: TEX.hangingSign('九龍', 'SECTOR 04', '#04141c', '→'), w: 2.4, h: 0.7, x: -129.6, y: 5.9, z: -14, rotY: Math.PI / 2, intensity: 2.2 });
    makeSign(scene, { tex: TEX.hangingSign('電脳九龍', 'CYBER KOWLOON', '#12061e', ''), w: 3.2, h: 0.8, x: -120.6, y: 6, z: -25.4, rotY: 0, intensity: 2.4 });
    makeSign(scene, { tex: TEX.hangingSign('夜市', 'NEON MARKET', '#1b0512', '→'), w: 2.6, h: 0.7, x: -107, y: 5, z: -22.6, rotY: 0, intensity: 2.2 });
    makeSign(scene, { tex: TEX.hangingSign('龍', 'DRAGON BAR', '#04141c', ''), w: 1.4, h: 1.4, x: -86.4, y: 6, z: -25, rotY: Math.PI / 2, intensity: 2.6 });
    makeSign(scene, { tex: TEX.hangingSign('ホテル', 'LOVE HOTEL 4F', '#20061a', '↑'), w: 2.8, h: 0.7, x: -111, y: 5.4, z: 11.6, rotY: Math.PI, intensity: 2.2 });

    // hologram ads (animated shader planes)
    const holos = [];
    for (const [x, y, z, ry, c1, c2, w, h] of [
      [-120.8, 9, -24.9, 0, 0xff2b6d, 0x00e5ff, 4.2, 5.6],
      [-125.8, 9.5, -5.6, Math.PI / 2, 0x22ff88, 0xa855f7, 3.6, 4.8],
      [-99, 8, -21.9, 0, 0x00e5ff, 0xffb400, 4.6, 5.2],
      [-103.5, 9.5, 3.4, 0, 0xa855f7, 0x22ff88, 4.4, 5.4],
      [-102.5, 9, 11.8, Math.PI, 0xff2b6d, 0xffb400, 4, 5],
    ]) {
      const m = holoMat(c1, c2);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      pl.position.set(x, y, z); pl.rotation.y = ry;
      scene.add(pl);
      holos.push(m);
    }

    // overhead cable runs + vertical pipes — instanced (one draw call each)
    const cableGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 5);
    const cables = new THREE.InstancedMesh(cableGeo, MAT.plasticBlack, 18);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < 18; i++) {
      const z = Z0 + 1 + i * 2.7;
      const sag = 7.5 + Math.sin(i * 1.7) * 1.8;
      e.set(0, 0, Math.PI / 2); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(-108, sag, z), q, new THREE.Vector3(1, 42, 1));
      cables.setMatrixAt(i, mtx);
    }
    G.add(cables);
    const pipeGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 7);
    const pipes = new THREE.InstancedMesh(pipeGeo, MAT.metalDark, 14);
    for (let i = 0; i < 14; i++) {
      const [px, pz, ph] = [[-129.4, -27, 8], [-129.4, -14, 7], [-129.4, 6, 9], [-129.4, 17, 7],
        [-86.6, -24, 8], [-86.6, 14, 7], [-121, -29.4, 7], [-99, -29.4, 6], [-112, 19.4, 8],
        [-99.4, 19.4, 7], [-126.4, -9, 6], [-105.4, 3.4, 6], [-114.6, -29.4, 7], [-90.5, -9.4, 6]][i];
      q.identity();
      mtx.compose(new THREE.Vector3(px, ph / 2, pz), q, new THREE.Vector3(1, ph, 1));
      pipes.setMatrixAt(i, mtx);
    }
    G.add(pipes);

    // arcade cabinets + trash crates along the lanes
    for (const [cx, cz, ry] of [[-120, -28.6, 0], [-115.5, -28.6, 0], [-99.5, -28.8, 0],
      [-106, 4.5, Math.PI], [-119.5, 10.6, 0], [-97, 11.6, 0], [-129, -6, Math.PI / 2], [-87, 8, -Math.PI / 2]]) {
      addBox(G, { w: 0.8, h: 1.7, d: 0.75, mat: MAT.plasticBlack, x: cx, y: 0.85, z: cz, rotY: ry, collide: world, raycast: rc, tag: 'metal' });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), MAT.screen(TEX.vendingFace(2), 1.8));
      face.position.set(cx + (ry === 0 ? 0 : Math.cos(ry) * 0.4), 1.25, cz + (ry === 0 ? 0.4 : Math.sin(ry) * 0.4));
      face.rotation.y = ry;
      G.add(face);
    }

    // neon pool lights (permanent → constant light count) — west entry lane
    // around the spawn is lit so the mission start / death respawn reads as
    // a glowing alley, never a dark void
    const l1 = new THREE.PointLight(0xff3b7d, 90, 36, 1.9); l1.position.set(-124, 6, -12);
    const l2 = new THREE.PointLight(0x2bd8ff, 90, 36, 1.9); l2.position.set(-103, 6, 8);
    const l3 = new THREE.PointLight(0x9a5dff, 75, 32, 1.9); l3.position.set(-90, 6, -18);
    scene.add(l1, l2, l3);
    this.areaLights.push(l1, l2, l3);

    // flying-vehicle streaks crossing the sky lanes
    const cars = [];
    for (let i = 0; i < 5; i++) {
      const mat = MAT.led(i % 2 ? 0xffc26a : 0x9fd7ff, 3.2);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(cachedBox(1.4, 0.22, 0.5), mat));
      g.position.set(rand(X0, X1), rand(11, 15), rand(Z0 + 4, Z1 - 4));
      G.add(g);
      cars.push({ g, dir: i % 2 ? 1 : -1, sp: rand(9, 15) });
    }

    this.updaters.push((dt) => {
      for (const m of holos) m.uniforms.uT += dt;
      for (const c of cars) {
        c.g.position.x += c.dir * c.sp * dt;
        if (c.g.position.x > X1 + 4) c.g.position.x = X0 - 4;
        if (c.g.position.x < X0 - 4) c.g.position.x = X1 + 4;
      }
    });

    SPAWN_POOLS.cyber = [
      { pos: [-124, -18],  wps: [[-124, -18], [-119, -17], [-127.5, -16]] },
      { pos: [-117, 5],    wps: [[-117, 5], [-116, -1], [-115.5, 9.5]] },
      { pos: [-102, -15],  wps: [[-102, -15], [-103, -8.5], [-101, -21]] },
      { pos: [-92, 6],     wps: [[-92, 6], [-91, 10.5], [-93.5, -4.5]] },
      { pos: [-116, 16],   wps: [[-116, 16], [-113, 16.5], [-119, 15.8]] },
      { pos: [-89, -14],   wps: [[-89, -14], [-88, -9.5], [-88, -21]] },
      { pos: [-118, -5],   wps: [[-118, -5], [-117.5, -9.5], [-117.5, -1]] },
    ];
  }
  // ================= MISSION 05 · 月面基地 · 44 × 44 m =================

  _moon() {
    const G = this._g('moon');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -34, X1 = 10, Z0 = 36, Z1 = 80;
    // z1 reaches past the airlock into the annex (that side is walled, but
    // the containment guard rect must let the player through once opened)
    this.bounds.moon = { x0: X0, x1: X1, z0: Z0, z1: Z1 + 5.5 };
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
    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: (X0 + X1) / 2, z: (Z0 + Z1) / 2, mat: new THREE.MeshStandardMaterial({ map: panel, roughness: 0.8, metalness: 0.05 }) });
    // Perimeter, but the north wall is split around the airlock opening (x -14..-11.5).
    const cmc = (X0 + X1) / 2;
    addBox(G, { w: X1 - X0 + 1, h: 10, d: 0.5, mat: MAT.concrete, x: cmc, y: 5, z: Z0 - 0.25, collide: world, raycast: rc });
    addBox(G, { w: -14 - (X0 - 0.5), h: 10, d: 0.5, mat: MAT.concrete, x: (-14 + X0 - 0.5) / 2, y: 5, z: Z1 + 0.25, collide: world, raycast: rc });
    addBox(G, { w: (X1 + 0.5) - -11.5, h: 10, d: 0.5, mat: MAT.concrete, x: (-11.5 + X1 + 0.5) / 2, y: 5, z: Z1 + 0.25, collide: world, raycast: rc });
    addBox(G, { w: 0.5, h: 10, d: Z1 - Z0 + 1, mat: MAT.concrete, x: X0 - 0.25, y: 5, z: (Z0 + Z1) / 2, collide: world, raycast: rc });
    addBox(G, { w: 0.5, h: 10, d: Z1 - Z0 + 1, mat: MAT.concrete, x: X1 + 0.25, y: 5, z: (Z0 + Z1) / 2, collide: world, raycast: rc });
    addBox(G, { w: X1 - X0 + 2, h: 0.4, d: Z1 - Z0 + 2, mat: MAT.ceiling, x: cmc, y: 10.2, z: (Z0 + Z1) / 2, cast: false, raycast: rc });

    // decorative ceiling rings (dome suggestion — flat under the ceiling)
    for (const r of [5.5, 8.5, 11.5]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.1, 6, 28), MAT.metal);
      rib.position.set(-12, 9.5, 58);
      rib.rotation.x = Math.PI / 2;
      G.add(rib);
    }

    // viewport: painted Earth window on the north wall
    const earth = tex('earthview', () => {
      const { c, x } = canvas(512, 256);
      x.fillStyle = '#01020a'; x.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(255,255,255,${rand(0.05, 0.9)})`; x.fillRect(Math.random() * 512, Math.random() * 256, 1, 1); }
      const g = x.createRadialGradient(256, 150, 10, 256, 150, 90);
      g.addColorStop(0, '#a8d8ff'); g.addColorStop(0.4, '#2f6fd0'); g.addColorStop(1, '#04091a');
      x.fillStyle = g; x.beginPath(); x.arc(256, 150, 90, 0, Math.PI * 2); x.fill();
      return { c, x };
    });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.6), MAT.screen(earth, 1.6));
    win.position.set(1, 4.6, Z1 - 0.3); win.rotation.y = Math.PI;
    G.add(win);
    addBox(G, { w: 8.4, h: 4, d: 0.15, mat: MAT.metalDark, x: 1, y: 4.6, z: Z1 - 0.1, cast: false });

    // modular habitat pods
    const podMat = new THREE.MeshStandardMaterial({ color: 0xd7dbdf, roughness: 0.6, metalness: 0.15 });
    for (const [px, pz, ry] of [[-28, 40, 0], [-4, 40, Math.PI], [-28, 72, 0], [-4, 72, Math.PI], [-28, 56, 0], [-4, 56, Math.PI]]) {
      addBox(G, { w: 5.6, h: 2.9, d: 3.4, mat: podMat, x: px, y: 1.45, z: pz, rotY: ry, collide: world, raycast: rc, tag: 'metal' });
      addBox(G, { w: 5.7, h: 0.35, d: 3.5, mat: MAT.metalDark, x: px, y: 3.05, z: pz, rotY: ry, cast: false });
      const hatch = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), MAT.screen(TEX.infoScreen, 0.5));
      hatch.position.set(px, 1.1, pz + (ry === 0 ? 1.72 : -1.72));
      hatch.rotation.y = ry === 0 ? 0 : Math.PI;
      G.add(hatch);
    }

    // spinning centrifuge (animated torus) — off the spawn sight line
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.28, 10, 30), MAT.painted(0xb8863a));
    ring.position.set(-17, 3.6, 58);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    G.add(ring);
    rc.push(ring);
    addBox(G, { w: 0.9, h: 3.6, d: 0.9, mat: MAT.metalDark, x: -17, y: 1.8, z: 58, collide: world, raycast: rc, tag: 'metal' });
    this.updaters.push((dt) => { ring.rotation.z += dt * 0.8; });

    // crates + consoles
    for (const [cx, cz] of [[-24, 47], [-8, 50], [-21, 63], [-10, 44], [-31, 50], [3, 62], [-24, 76]]) {
      addBox(G, { w: 1.3, h: 1.1, d: 1.3, mat: MAT.painted(0xb8bcbf), x: cx, y: 0.55, z: cz, collide: world, raycast: rc, tag: 'metal' });
    }

    // airlock: two sliding panels + wall switch → shooting the switch opens it.
    // The switch sits ON the room-side face of the wall (not buried in it)
    // so it is visible and shootable from the main hall.
    const doorMat = MAT.painted(0x9aa4b0);
    const dl = addBox(G, { w: 1.2, h: 2.6, d: 0.3, mat: doorMat, x: -13.3, y: 1.3, z: Z1, raycast: rc, tag: 'metal' });
    const dr = addBox(G, { w: 1.2, h: 2.6, d: 0.3, mat: doorMat, x: -12.2, y: 1.3, z: Z1, raycast: rc, tag: 'metal' });
    const dlCol = world.addBox(new THREE.Vector3(-14.2, 0, Z1 - 0.2), new THREE.Vector3(-12.85, 2.6, Z1 + 0.2));
    const drCol = world.addBox(new THREE.Vector3(-12.85, 0, Z1 - 0.2), new THREE.Vector3(-11.4, 2.6, Z1 + 0.2));
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, emissive: 0x38ff5a, emissiveIntensity: 2.2 }));
    sw.position.set(-10.5, 1.6, Z1 - 0.15);
    sw.userData.tag = 'metal';
    sw.userData.switchDoor = this.doors.length;
    G.add(sw);
    rc.push(sw);
    // annex beyond the airlock (supplies — one patrol anchor lives there).
    // Three sides only: the south side IS the main north wall's door gap.
    addBox(G, { w: 5.5, h: 5, d: 0.5, mat: MAT.concrete, x: -12.8, y: 2.5, z: Z1 + 5.25, collide: world, raycast: rc });
    addBox(G, { w: 0.5, h: 5, d: 5.5, mat: MAT.concrete, x: -15.55, y: 2.5, z: Z1 + 2.75, collide: world, raycast: rc });
    addBox(G, { w: 0.5, h: 5, d: 5.5, mat: MAT.concrete, x: -10.05, y: 2.5, z: Z1 + 2.75, collide: world, raycast: rc });
    addBox(G, { w: 5.5, h: 0.4, d: 5.5, mat: MAT.ceiling, x: -12.8, y: 5.2, z: Z1 + 2.75, cast: false });
    floor(G, rc, { w: 5, d: 5, x: -12.8, z: Z1 + 2.75, mat: MAT.concrete });
    addBox(G, { w: 1.6, h: 1.3, d: 1.2, mat: MAT.painted(0x8f9aa6), x: -13.5, y: 0.65, z: Z1 + 3.6, collide: world, raycast: rc, tag: 'metal' });
    this.doors.push({ parts: [dl, dr], cols: [dlCol, drCol], open: false, t: 0, autoT: 110 });

    // blinking red alarms + debris drift
    const alarmMat1 = new THREE.MeshStandardMaterial({ color: 0x220505, emissive: 0xff2222, emissiveIntensity: 2 });
    const alarmMat2 = alarmMat1.clone();
    const a1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), alarmMat1); a1.position.set(X0 + 0.6, 6.5, Z0 + 3);
    const a2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), alarmMat2); a2.position.set(X1 - 0.6, 6.5, Z1 - 3);
    G.add(a1, a2);
    const al = new THREE.PointLight(0xff3030, 18, 22, 2); al.position.set(-12, 7, 58);
    scene.add(al);
    this.areaLights.push(al);
    // cold white habitat lighting (the moon base must read as lit, not black)
    const wl1 = new THREE.PointLight(0xdfe8f2, 110, 40, 1.8); wl1.position.set(-26, 8.6, 44);
    const wl2 = new THREE.PointLight(0xdfe8f2, 110, 40, 1.8); wl2.position.set(2, 8.6, 72);
    scene.add(wl1, wl2);
    this.areaLights.push(wl1, wl2);
    const dustT = { t: 0 };
    this.updaters.push((dt) => {
      const d = this.doors[0];
      if (d.autoT > 0) d.autoT -= dt;
      if (!d.open && d.autoT <= 0) d.open = true;
      if (d.open && d.t < 1) {
        d.t = Math.min(1, d.t + dt * 0.7);
        dl.position.x = -13.3 - d.t * 1.3;
        dr.position.x = -12.2 + d.t * 1.3;
        dlCol.min.set(-1000, 0, 0); dlCol.max.set(-999, 3, 1);
        drCol.min.set(-1000, 0, 0); drCol.max.set(-999, 3, 1);
      }
      const b = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      alarmMat1.emissiveIntensity = 0.3 + 2.2 * b;
      alarmMat2.emissiveIntensity = 0.3 + 2.2 * (1 - b);
      al.intensity = 6 + 16 * b;
      // zero-g debris: slow drifting motes (low gravity)
      dustT.t -= dt;
      if (dustT.t <= 0) {
        dustT.t = 0.35;
        this.p.dust.spawn({
          x: rand(X0 + 2, X1 - 2), y: rand(0.3, 5), z: rand(Z0 + 2, Z1 - 2),
          vx: rand(-0.12, 0.12), vy: rand(-0.04, 0.08), vz: rand(-0.12, 0.12),
          size: rand(0.05, 0.11), color: [0.85, 0.87, 0.9], alpha: 0.22,
          life: rand(4, 8), grow: 0.02, drag: 0.05, gravity: -0.02,
        });
      }
    });

    makeSign(scene, { tex: TEX.hangingSign('月面基地', 'LUNAR OUTPOST · LOW-G', '#20242a', ''), w: 3, h: 0.75, x: -28, y: 3.4, z: Z0 + 0.6, intensity: 1.3 });

    SPAWN_POOLS.moon = [
      { pos: [-24, 52],    wps: [[-24, 52], [-20.5, 50], [-25.5, 55]] },
      { pos: [-14, 48],    wps: [[-14, 48], [-10, 46.5], [-16, 51]] },
      { pos: [-2, 60],     wps: [[-2, 60], [3.5, 58], [-5, 63]] },
      { pos: [-24, 66],    wps: [[-24, 66], [-20, 68], [-27, 69]] },
      { pos: [-8, 52],     wps: [[-8, 52], [-4, 54], [-11, 55]] },
      { pos: [-12.8, Z1 + 2.75], wps: [[-12.8, Z1 + 2.75], [-11, Z1 + 1.5], [-14, Z1 + 4]] },
      { pos: [3, 43],      wps: [[3, 43], [7.5, 45], [2, 47]] },
    ];
  }

  // ================= MISSION 06 · 黄金の墓 · 52 × 46 m =================

  _tomb() {
    const G = this._g('tomb');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -46, X1 = 6, Z0 = -72, Z1 = -26;
    this.bounds.tomb = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
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

    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: (X0 + X1) / 2, z: (Z0 + Z1) / 2, mat: sandMat });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 9, mat: wallMat });
    addBox(G, { w: X1 - X0 + 2, h: 0.5, d: Z1 - Z0 + 2, mat: new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.95 }), x: (X0 + X1) / 2, y: 9.25, z: (Z0 + Z1) / 2, cast: false, raycast: rc });

    // two colonnades framing the central hall
    const pil = (x, z, r = 0.95) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, 8.2, 12), sandMat);
      col.position.set(x, 4.1, z);
      col.castShadow = true; col.userData.tag = 'concrete';
      G.add(col); rc.push(col);
      addBox(G, { w: r * 2.5, h: 0.55, d: r * 2.5, mat: wallMat, x, y: 8.5, z, cast: false });
      world.addBox(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, 8.2, z + r));
    };
    for (let i = 0; i < 6; i++) {
      pil(-40 + i * 7.5, -63);
      pil(-40 + i * 7.5, -35);
    }

    // central sarcophagus: dark outer, gold inner, lapis band (+ showcase
    // light between the entrance and the coffin, so the face the player
    // walks up to is lit — an overhead light leaves that face black)
    addBox(G, { w: 2.4, h: 1.8, d: 3.8, mat: new THREE.MeshStandardMaterial({ color: 0x4a3b26, roughness: 0.55, metalness: 0.25 }), x: -20, y: 0.9, z: -49, collide: world, raycast: rc, tag: 'stone' });
    const sarc = new THREE.PointLight(0xffb46a, 70, 26, 1.7);
    sarc.position.set(-20, 3.6, -54.5);
    scene.add(sarc);
    this.areaLights.push(sarc);
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.28, metalness: 1 });
    addBox(G, { w: 1.7, h: 1.2, d: 3.1, mat: goldMat, x: -20, y: 1.5, z: -49, raycast: rc, tag: 'metal' });
    addBox(G, { w: 1.8, h: 0.16, d: 0.5, mat: new THREE.MeshStandardMaterial({ color: 0x1c4fa0, roughness: 0.35, metalness: 0.5 }), x: -20, y: 2.05, z: -49, cast: false, tag: 'metal' });
    // guardian statues flanking the coffin
    for (const sx of [-23.5, -16.5]) {
      addBox(G, { w: 1.4, h: 2.6, d: 1.1, mat: sandMat, x: sx, y: 1.3, z: -49, collide: world, raycast: rc, tag: 'stone' });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), sandMat);
      head.position.set(sx, 3.0, -49);
      head.castShadow = true;
      G.add(head); rc.push(head);
    }
    // gold heaps (instanced coins + bowls)
    const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 8);
    const coins = new THREE.InstancedMesh(coinGeo, goldMat, 120);
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    let ci = 0;
    for (const [hx, hz, n] of [[-28, -45, 35], [-12, -45, 35], [-28, -54, 25], [-12, -54, 25]]) {
      for (let i = 0; i < n && ci < 120; i++, ci++) {
        q.setFromEuler(new THREE.Euler(rand(-0.5, 0.5), rand(0, 6), rand(-0.5, 0.5)));
        mtx.compose(new THREE.Vector3(hx + rand(-1, 1), rand(0.03, 0.55), hz + rand(-1, 1)), q, new THREE.Vector3(1, 1, 1));
        coins.setMatrixAt(ci, mtx);
      }
      addBox(G, { w: 2.2, h: 0.6, d: 2.2, mat: goldMat, x: hx, y: 0.3, z: hz, collide: world, raycast: rc, tag: 'metal' });
    }
    G.add(coins);
    // amphorae + rubble blocks
    for (const [x, z] of [[-38, -49], [-2, -49], [-38, -66], [-2, -32], [-30, -30], [-10, -68]]) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.8 }));
      jar.position.set(x, 0.45, z); jar.castShadow = true; jar.userData.tag = 'stone';
      G.add(jar); rc.push(jar);
      world.addBox(new THREE.Vector3(x - 0.3, 0, z - 0.3), new THREE.Vector3(x + 0.3, 0.9, z + 0.3));
    }
    for (const [bx, bz, w, d] of [[-44, -40, 3, 1.6], [3.5, -58, 2.4, 2.4], [-44, -58, 2.2, 3], [2, -40, 3, 1.4]]) {
      addBox(G, { w, h: 0.9, d, mat: sandMat, x: bx, y: 0.45, z: bz, rotY: rand(0, 0.5), collide: world, raycast: rc, tag: 'stone' });
    }

    // torches: 3 lit (flicker point light) + 2 decorative
    const flames = [];
    for (const [tx, tz, lit] of [[X0 + 1.4, -49, true], [X1 - 1.4, -49, true], [-20, Z0 + 1.4, true], [-20, Z1 - 1.4, false], [X0 + 1.4, -60, false]]) {
      addBox(G, { w: 0.14, h: 1.2, d: 0.14, mat: MAT.wood, x: tx, y: 1.8, z: tz, tag: 'wood' });
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a0d00, emissive: 0xff8a2a, emissiveIntensity: 2.6 }));
      fl.position.set(tx, 2.5, tz);
      G.add(fl);
      flames.push({ fl, lit });
      if (lit) {
        const pl = new THREE.PointLight(0xff9a4a, 90, 30, 1.7);
        pl.position.set(tx, 2.7, tz);
        scene.add(pl);
        this.areaLights.push(pl);
        flames[flames.length - 1].pl = pl;
      }
    }
    this.updaters.push(() => {
      const t = performance.now() / 1000;
      for (const f of flames) {
        const n = 0.75 + 0.25 * Math.sin(t * 11 + f.fl.position.x) * Math.sin(t * 5.3 + f.fl.position.z);
        f.fl.scale.setScalar(0.85 + n * 0.4);
        f.fl.material.emissiveIntensity = 1.8 + n * 2;
        if (f.pl) f.pl.intensity = 66 + n * 48;
      }
    });

    makeSign(scene, { tex: TEX.hangingSign('黄金の墓', "TOMB OF THE PHARAOH", '#2b1c07', '☥'), w: 3, h: 0.8, x: -20, y: 3.8, z: Z1 - 0.6, intensity: 1.1 });

    SPAWN_POOLS.tomb = [
      { pos: [-20, -30],   wps: [[-20, -30], [-16, -30.5], [-24, -30]] },
      { pos: [-30, -69],   wps: [[-30, -69], [-26, -69.5], [-34.5, -68]] },
      { pos: [-43, -49],   wps: [[-43, -49], [-43, -54], [-43, -44]] },
      { pos: [3, -49],     wps: [[3, -49], [3, -44], [3, -54]] },
      { pos: [-31, -49],   wps: [[-31, -49], [-34, -47], [-28.5, -51]] },
      { pos: [-9, -49],    wps: [[-9, -49], [-6, -51], [-11.5, -47]] },
      { pos: [-40, -30],   wps: [[-40, -30], [-36, -30.5], [-43, -32]] },
    ];
  }
  // ================= MISSION 07 · 天空港 · 52 × 46 m =================

  _skyport() {
    const G = this._g('skyport');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 44, X1 = 96, Z0 = -26, Z1 = 20;
    this.bounds.skyport = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const deckTex = tex('deck', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#4a3522'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = 'rgba(20,12,6,0.7)'; x.lineWidth = 3;
      for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo(0, i * 32); x.lineTo(256, i * 32); x.stroke(); }
      x.fillStyle = 'rgba(90,64,38,0.5)';
      for (let i = 0; i < 40; i++) x.fillRect(rand(0, 230), rand(0, 246), rand(8, 40), 5);
      return { c, x };
    }, { repeat: [13, 12] });
    floor(G, rc, { w: X1 - X0 + 1, d: Z1 - Z0 + 1, x: (X0 + X1) / 2, z: (Z0 + Z1) / 2, mat: new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }) });
    // Solid deck slab (top y=0). INVISIBLE AIR WALLS ring the open edges —
    // the cloud sea beyond is a view, not a walkway (colliders only, no
    // mesh, so it never looks like a cage but never lets you walk off).
    world.addBox(new THREE.Vector3(X0, -3, Z0), new THREE.Vector3(X1, 0, Z1));
    for (const [min, max] of [
      [[X0 - 0.3, 0, Z0 - 0.3], [X0 + 0.3, 9, Z1 + 0.3]],
      [[X1 - 0.3, 0, Z0 - 0.3], [X1 + 0.3, 9, Z1 + 0.3]],
      [[X0 - 0.3, 0, Z0 - 0.3], [X1 + 0.3, 9, Z0 + 0.3]],
      [[X0 - 0.3, 0, Z1 - 0.3], [X1 + 0.3, 9, Z1 + 0.3]],
    ]) world.addBox(new THREE.Vector3(...min), new THREE.Vector3(...max));

    // visible railings (dress the air walls)
    for (const [x, z, w, d] of [[(X0 + X1) / 2, Z0 + 0.2, X1 - X0 - 2, 0.15], [(X0 + X1) / 2, Z1 - 0.2, X1 - X0 - 2, 0.15],
      [X0 + 0.2, (Z0 + Z1) / 2, 0.15, Z1 - Z0 - 2], [X1 - 0.2, (Z0 + Z1) / 2, 0.15, Z1 - Z0 - 2]]) {
      const long = w > d;
      const span = long ? w : d;
      for (let i = 0; i < span / 3; i++) {
        const px = long ? x - span / 2 + i * 3 : x;
        const pz = long ? z : z - span / 2 + i * 3;
        addBox(G, { w: 0.12, h: 1.1, d: 0.12, mat: MAT.metalDark, x: px, y: 0.55, z: pz, tag: 'metal' });
      }
      addBox(G, { w, h: 0.1, d, mat: MAT.painted(0x8a6a2f), x, y: 1.05, z, tag: 'metal' });
    }
    // gantry columns (colliders) + overhead beams
    for (const [cx, cz] of [[48, -22], [48, 16], [92, -22], [92, 16], [70, 16], [70, -22]]) {
      addBox(G, { w: 0.8, h: 9, d: 0.8, mat: MAT.painted(0x6b5224), x: cx, y: 4.5, z: cz, collide: world, raycast: rc, tag: 'metal' });
    }
    for (const bz of [-22, 16]) {
      addBox(G, { w: X1 - X0 - 6, h: 0.5, d: 0.5, mat: MAT.painted(0x6b5224), x: (X0 + X1) / 2, y: 8.8, z: bz, cast: false });
    }

    // moored airships: breathing balloons + gondolas (gondolas float above
    // head height — walk under them, they are cover for the sight line only)
    const ship = (x, z) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); G.add(g);
      const envMat = new THREE.MeshStandardMaterial({ color: 0xe0bb66, roughness: 0.5, metalness: 0.05, envMapIntensity: 1.2 });
      const env = new THREE.Mesh(new THREE.SphereGeometry(3.4, 14, 10), envMat);
      env.scale.set(2.1, 0.85, 1);
      env.position.y = 6.6; env.castShadow = true; env.userData.tag = 'wood';
      g.add(env); rc.push(env);
      const band = new THREE.Mesh(new THREE.SphereGeometry(3.45, 14, 10), new THREE.MeshStandardMaterial({ color: 0x9a6a28, roughness: 0.6 }));
      band.scale.set(2.12, 0.87, 1.02); band.position.y = 6.6;
      g.add(band);
      addBox(G, { w: 3.2, h: 1.5, d: 2, mat: MAT.wood, x, y: 3.3, z, collide: world, raycast: rc, tag: 'wood' });
      for (const [rx, rz] of [[-2.2, 0], [2.2, 0], [0, -1.2], [0, 1.2]]) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 6), MAT.plasticBlack);
        rope.position.set(x + rx * 0.9, 4.6, z + rz * 0.9);
        rope.rotation.z = rx !== 0 ? (rx > 0 ? -0.45 : 0.45) : 0;
        rope.rotation.x = rz !== 0 ? (rz > 0 ? -0.35 : 0.35) : 0;
        G.add(rope);
      }
      return { g, env, band, ph: rand(0, 6) };
    };
    const ships = [ship(52, -16), ship(88, 12), ship(60, 13)];

    // giant turning gears on the gantry
    const gearMat = MAT.painted(0x8a6a2f);
    const gears = [];
    for (const [gx, gy, gz, r] of [[62, 5.8, -21.8, 2.4], [69, 4.6, -21.8, 1.6], [78, 6.6, 15.8, 2.8], [90, 5.2, -21.8, 1.8]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.22, 8, 22), gearMat);
      ring.position.set(gx, gy, gz); ring.castShadow = true;
      G.add(ring); rc.push(ring);
      const hub = new THREE.Mesh(cachedBox(0.5, 0.5, 0.5), MAT.metalDark);
      hub.position.set(gx, gy, gz);
      G.add(hub);
      for (let i = 0; i < 4; i++) {
        const spoke = new THREE.Mesh(cachedBox(0.18, r * 1.9, 0.18), gearMat);
        spoke.position.set(gx, gy, gz); spoke.rotation.z = (i / 4) * Math.PI;
        G.add(spoke);
        gears.push(spoke);
      }
      gears.push(ring); ring.userData.sp = (gz < 0 ? 1 : -1) * (2.6 / r);
      hub.userData.sp = ring.userData.sp; gears.push(hub);
    }

    // steam vents (game.js boosts the player over these)
    const ventPos = [[56, -6], [66, 6], [82, -12], [74, -19]];
    for (const [vx, vz] of ventPos) {
      addBox(G, { w: 1.4, h: 0.35, d: 1.4, mat: MAT.metalDark, x: vx, y: 0.18, z: vz, collide: world, raycast: rc, tag: 'metal' });
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 0.5, 10), MAT.painted(0xb8863a));
      nozzle.position.set(vx, 0.6, vz);
      G.add(nozzle);
      this.vents.push({ x: vx, z: vz, r: 1.5, power: 10.5 });
    }
    // crates + barrels + plank stacks
    for (const [cx, cz, ry] of [[47, 6, 0], [52, -11, 0.3], [90, -8, 0], [86, -2, -0.4], [46, 1, 0], [76, 10, 0.6], [66, -14, -0.3]]) {
      addBox(G, { w: 1.6, h: 1.4, d: 1.6, mat: MAT.wood, x: cx, y: 0.7, z: cz, rotY: ry, collide: world, raycast: rc, tag: 'wood' });
    }
    for (const [bx, bz] of [[54, 11], [62, -16.5], [93, -4], [80, 4], [49, -19]]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 10), MAT.painted(0x6b4a24));
      d.position.set(bx, 0.5, bz); d.castShadow = true; d.userData.tag = 'wood';
      G.add(d); rc.push(d);
      world.addBox(new THREE.Vector3(bx - 0.42, 0, bz - 0.42), new THREE.Vector3(bx + 0.42, 1, bz + 0.42));
    }

    const sun = new THREE.PointLight(0xffe2ae, 170, 52, 1.8);
    sun.position.set(70, 8, -2);
    scene.add(sun);
    const sun2 = new THREE.PointLight(0xffd89a, 120, 46, 1.8);
    sun2.position.set(50, 8, -14);
    scene.add(sun2);
    this.areaLights.push(sun, sun2);

    const vt = { t: 0 };
    this.updaters.push((dt) => {
      for (const s of ships) {
        s.ph += dt;
        const b = 1 + Math.sin(s.ph * 1.1) * 0.02;
        s.env.scale.set(2.1 * b, 0.85 * b, 1 * b);
        s.band.scale.set(2.12 * b, 0.87 * b, 1.02 * b);
        s.g.position.y = Math.sin(s.ph * 0.7) * 0.12;
      }
      for (const gr of gears) if (gr.userData.sp) gr.rotation.z += gr.userData.sp * dt;
      vt.t -= dt;
      if (vt.t <= 0) {
        vt.t = 0.16;
        const [vx, vz] = randPick(ventPos);
        this.p.smoke.spawn({
          x: vx + rand(-0.3, 0.3), y: 0.9, z: vz + rand(-0.3, 0.3),
          vx: rand(-0.1, 0.1), vy: rand(1.6, 2.8), vz: rand(-0.1, 0.1),
          size: rand(0.16, 0.3), color: [0.85, 0.86, 0.88], alpha: 0.3,
          life: rand(0.9, 1.8), grow: 0.5, drag: 0.5,
        });
      }
    });

    makeSign(scene, { tex: TEX.hangingSign('天空港', 'SKYPORT · HOLD THE RAIL', '#3a2b14', '⚑'), w: 3, h: 0.75, x: 56, y: 3.6, z: Z0 + 0.8, intensity: 1.5 });

    SPAWN_POOLS.skyport = [
      { pos: [50, 2],     wps: [[50, 2], [53, 4], [48, 6]] },
      { pos: [64, -4],    wps: [[64, -4], [68, -6], [61, -8]] },
      { pos: [84, 4],     wps: [[84, 4], [88, 1], [81, 7]] },
      { pos: [58, -18],   wps: [[58, -18], [62, -19.5], [55, -16]] },
      { pos: [72, 8],     wps: [[72, 8], [75, 10], [69, 11]] },
      { pos: [90, -14],   wps: [[90, -14], [92, -10], [88, -18]] },
      { pos: [70, -4],    wps: [[70, -4], [73, -2], [67, -6]] },
    ];
  }

  // ================= MISSION 08 · 量子実験室 · 46 × 46 m =================

  _lab() {
    const G = this._g('lab');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 64, X1 = 110, Z0 = 36, Z1 = 82;
    this.bounds.lab = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const labWall = tex('labwall', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#e8eaec'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = '#b9bec4'; x.lineWidth = 2;
      for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 128); x.lineTo(256, i * 128); x.stroke(); }
      x.fillStyle = 'rgba(150,158,166,0.25)';
      x.fillRect(0, 120, 256, 4);
      return { c, x };
    }, { repeat: [8, 2] });
    const wallMat = new THREE.MeshStandardMaterial({ map: labWall, roughness: 0.55, metalness: 0.05 });
    const floorMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe2e6, roughness: 0.16, metalness: 0.1, envMapIntensity: 1.5, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: floorMat });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 6.5, mat: wallMat });
    addBox(G, { w: X1 - X0 + 2, h: 0.4, d: Z1 - Z0 + 2, mat: MAT.ceiling, x: cx, y: 6.7, z: cz, cast: false, raycast: rc });

    // mirror wall (env-reflective panel on the north side)
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(20, 4.6), new THREE.MeshStandardMaterial({ color: 0xbfd4e2, metalness: 1, roughness: 0.04, envMapIntensity: 2.2 }));
    mirror.position.set(cx, 2.5, Z1 - 0.3); mirror.rotation.y = Math.PI;
    G.add(mirror);

    // quantum core: emissive base + floating core + pulse shell + rings
    addBox(G, { w: 4.5, h: 0.4, d: 4.5, mat: new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.3, metalness: 0.3 }), x: cx, y: 0.2, z: cz, collide: world, raycast: rc, tag: 'metal' });
    const coreMat = new THREE.MeshPhysicalMaterial({ color: 0x6fd4ff, emissive: 0x2f8fd0, emissiveIntensity: 0.9, roughness: 0.1, transmission: 0.6, thickness: 1.2, transparent: true, opacity: 0.85 });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 2), coreMat);
    core.position.set(cx, 2, cz);
    G.add(core);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 2), new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }));
    shell.position.copy(core.position);
    G.add(shell);
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(2, 0.05, 8, 40), new THREE.MeshStandardMaterial({ color: 0x10141a, emissive: 0x57c7ff, emissiveIntensity: 1.8 }));
    r1.position.copy(core.position); r1.rotation.x = Math.PI / 2.6;
    const r2 = r1.clone(); r2.rotation.x = -Math.PI / 3; r2.rotation.y = 0.8;
    G.add(r1, r2);
    const coreLight = new THREE.PointLight(0x7fd0ff, 30, 34, 2);
    coreLight.position.copy(core.position);
    scene.add(coreLight);
    this.areaLights.push(coreLight);
    const ring2Light = new THREE.PointLight(0xffffff, 34, 46, 1.8);
    ring2Light.position.set(cx, 6, cz);
    scene.add(ring2Light);
    this.areaLights.push(ring2Light);
    // ceiling light strips
    for (const lz of [Z0 + 5, Z0 + 12, cz, Z1 - 12, Z1 - 5]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0 - 8, 0.06, 0.3), MAT.led(0xf4f8ff, 1.4));
      s.position.set(cx, 6.45, lz);
      G.add(s);
    }

    // white benches + wall screens along the edges
    for (const [bx, bz, ry] of [[X0 + 3, cz - 6, Math.PI / 2], [X0 + 3, cz + 6, Math.PI / 2],
      [X1 - 3, cz - 6, -Math.PI / 2], [X1 - 3, cz + 6, -Math.PI / 2], [cx - 10, Z0 + 3.5, 0], [cx + 10, Z0 + 3.5, 0]]) {
      addBox(G, { w: 4.4, h: 0.95, d: 1, mat: new THREE.MeshStandardMaterial({ color: 0xf5f6f8, roughness: 0.4, metalness: 0.15 }), x: bx, y: 0.475, z: bz, rotY: ry, collide: world, raycast: rc, tag: 'metal' });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), MAT.screen(TEX.infoScreen, 1.2));
      scr.position.set(bx, 1.9, bz + (Math.abs(ry) === Math.PI / 2 ? 0 : -1.1));
      scr.position.x += Math.abs(ry) === Math.PI / 2 ? (ry > 0 ? 1.1 : -1.1) : 0;
      scr.rotation.y = ry + Math.PI / 2;
      G.add(scr);
    }
    // glass display cases
    for (const [gx, gz] of [[X0 + 8, Z1 - 8], [X1 - 8, Z1 - 8], [X0 + 8, Z0 + 8], [X1 - 8, Z0 + 8]]) {
      addBox(G, { w: 1.6, h: 1.8, d: 1.6, mat: MAT.glassPane, x: gx, y: 0.9, z: gz, tag: 'glass', raycast: rc });
      addBox(G, { w: 1.7, h: 0.1, d: 1.7, mat: MAT.metalDark, x: gx, y: 1.85, z: gz, cast: false });
      world.addBox(new THREE.Vector3(gx - 0.8, 0, gz - 0.8), new THREE.Vector3(gx + 0.8, 1.8, gz + 0.8));
    }

    const t = { pulse: 0 };
    this.updaters.push((dt) => {
      t.pulse += dt;
      const b = 1 + Math.sin(t.pulse * 2.4) * 0.08;
      core.scale.setScalar(b);
      core.rotation.y += dt * 0.6; core.rotation.x += dt * 0.25;
      shell.rotation.y -= dt * 0.35;
      const s = 1 + (t.pulse % 3) / 3 * 0.9;
      shell.scale.setScalar(s);
      shell.material.opacity = 0.25 * (1 - (t.pulse % 3) / 3);
      r1.rotation.z += dt * 1.2; r2.rotation.z -= dt * 0.9;
      coreLight.intensity = 26 + 8 * Math.sin(t.pulse * 2.4);
    });

    makeSign(scene, { tex: TEX.hangingSign('量子実験室', 'QUANTUM LAB · SECTOR R', '#dfe3e8', '∿'), w: 3, h: 0.75, x: cx, y: 3.8, z: Z0 + 0.6, intensity: 1.4 });

    SPAWN_POOLS.lab = [
      { pos: [X0 + 6, Z0 + 6],   wps: [[X0 + 6, Z0 + 6], [X0 + 10, Z0 + 8], [X0 + 5, Z0 + 12]] },
      { pos: [X1 - 6, Z0 + 6],   wps: [[X1 - 6, Z0 + 6], [X1 - 10, Z0 + 8], [X1 - 5, Z0 + 12]] },
      { pos: [X0 + 6, Z1 - 12],  wps: [[X0 + 6, Z1 - 12], [X0 + 10, Z1 - 14], [X0 + 5, Z1 - 16]] },
      { pos: [X1 - 6, Z1 - 12],  wps: [[X1 - 6, Z1 - 12], [X1 - 10, Z1 - 14], [X1 - 5, Z1 - 16]] },
      { pos: [cx, Z0 + 8],       wps: [[cx, Z0 + 8], [cx - 5, Z0 + 9], [cx + 5, Z0 + 9]] },
      { pos: [cx - 14, cz],      wps: [[cx - 14, cz], [cx - 16, cz + 4], [cx - 14, cz - 4]] },
      { pos: [cx + 14, cz],      wps: [[cx + 14, cz], [cx + 16, cz - 4], [cx + 14, cz + 4]] },
    ];
  }

  // ================= MISSION 09 · 沈没大陸 · 52 × 52 m =================

  _atlantis() {
    const G = this._g('atlantis');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -130, X1 = -78, Z0 = 36, Z1 = 88;
    this.bounds.atlantis = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const marble = tex('marble', () => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = '#7e93a0'; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = 'rgba(150,185,205,0.5)'; x.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        x.beginPath();
        const sx = Math.random() * 256, sy = Math.random() * 256;
        x.moveTo(sx, sy);
        x.bezierCurveTo(sx + 60, sy + 20, sx - 40, sy + 70, sx + 30, sy + 110);
        x.stroke();
      }
      x.fillStyle = 'rgba(60,90,110,0.4)';
      for (let i = 0; i < 1200; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      return { c, x };
    }, { repeat: [15, 15] });
    const stoneMat = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.82 });
    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: stoneMat });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 14, mat: stoneMat });

    // caustics overlay (the waterlight signature of the world)
    const caustic = causticMat();
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), caustic);
    ov.rotation.x = -Math.PI / 2;
    ov.position.set(cx, 0.05, cz);
    G.add(ov);

    // temple: 6 standing columns + architrave + steps + inner sanctum block
    for (const [px, pz] of [[-112, 52], [-112, 64], [-104, 52], [-104, 64], [-96, 52], [-96, 64]]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 7, 10), stoneMat);
      col.position.set(px, 3.5, pz); col.castShadow = true; col.userData.tag = 'concrete';
      G.add(col); rc.push(col);
      world.addBox(new THREE.Vector3(px - 0.95, 0, pz - 0.95), new THREE.Vector3(px + 0.95, 7, pz + 0.95));
    }
    addBox(G, { w: 18, h: 0.9, d: 14, mat: stoneMat, x: -104, y: 7.5, z: 58, collide: world, raycast: rc });
    for (const sz of [67, 68.4]) {
      addBox(G, { w: 16, h: 0.32, d: 1.3, mat: stoneMat, x: -104, y: 0.16, z: sz, collide: world, raycast: rc });
    }
    addBox(G, { w: 4, h: 2.2, d: 4, mat: new THREE.MeshStandardMaterial({ color: 0x22323e, roughness: 0.6, metalness: 0.2 }), x: -104, y: 1.1, z: 58, collide: world, raycast: rc, tag: 'stone' });
    // fallen columns (tilted, colliders)
    for (const [fx, fz, ry] of [[-120, 44, 0.12], [-86, 70, -0.2], [-92, 42, 0.5]]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 6.4, 10), stoneMat);
      f.position.set(fx, 0.85, fz); f.rotation.z = Math.PI / 2; f.rotation.y = ry;
      f.castShadow = true; f.userData.tag = 'concrete';
      G.add(f); rc.push(f);
      world.addBox(new THREE.Vector3(fx - 3.2, 0, fz - 1), new THREE.Vector3(fx + 3.2, 1.7, fz + 1));
    }
    // obelisks with a glowing core slit
    for (const [ox, oz] of [[X0 + 6, Z1 - 8], [X1 - 6, Z1 - 8], [X0 + 6, Z0 + 14]]) {
      addBox(G, { w: 1.4, h: 7, d: 1.4, mat: new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.5, metalness: 0.3 }), x: ox, y: 3.5, z: oz, collide: world, raycast: rc, tag: 'stone' });
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6, 0.16), MAT.led(0x38d8ff, 2.6));
      slit.position.set(ox, 3.5, oz + 0.73);
      G.add(slit);
    }
    // coral clusters + kelp
    const coralCols = [0xff5a8a, 0xb04d9a, 0x2fd0a0];
    for (let i = 0; i < 20; i++) {
      const px = rand(X0 + 3, X1 - 3), pz = rand(Z0 + 3, Z1 - 3);
      if (Math.abs(px + 104) < 11 && pz > 50 && pz < 69) continue;   // keep the temple clear
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.3, 0.7), 1), new THREE.MeshStandardMaterial({ color: randPick(coralCols), emissive: randPick(coralCols), emissiveIntensity: 0.5, roughness: 0.8 }));
      c.position.set(px, 0.25, pz);
      G.add(c);
    }
    // glowing fish drifting in loops
    const fish = [];
    for (let i = 0; i < 10; i++) {
      const f = new THREE.Mesh(cachedBox(0.34, 0.14, 0.12), MAT.led(0x6fe8ff, 2.2));
      G.add(f);
      fish.push({ f, a: rand(0, 6.28), px: rand(X0 + 8, X1 - 8), pz: rand(Z0 + 8, Z1 - 8), r: rand(3, 8), sp: rand(0.4, 1), y: rand(1.2, 4) });
    }
    // light shafts
    const l1 = new THREE.PointLight(0x3fa8d8, 85, 40, 1.8); l1.position.set(-118, 7, 44);
    const l2 = new THREE.PointLight(0x2a7fb8, 85, 40, 1.8); l2.position.set(-92, 7, 74);
    const l3 = new THREE.PointLight(0x58c8e8, 65, 34, 1.9); l3.position.set(-104, 6, 58);
    scene.add(l1, l2, l3);
    this.areaLights.push(l1, l2, l3);

    const bt = { t: 0 };
    this.updaters.push((dt) => {
      caustic.uniforms.uT += dt * 0.9;
      for (const fl of fish) {
        fl.a += fl.sp * dt;
        fl.f.position.set(fl.px + Math.cos(fl.a) * fl.r, fl.y + Math.sin(fl.a * 2) * 0.3, fl.pz + Math.sin(fl.a) * fl.r);
        fl.f.rotation.y = -fl.a + Math.PI / 2;
      }
      bt.t -= dt;
      if (bt.t <= 0) {
        bt.t = 0.28;
        this.p.bubbles.spawn({
          x: rand(X0 + 2, X1 - 2), y: rand(0, 2), z: rand(Z0 + 2, Z1 - 2),
          vx: rand(-0.05, 0.05), vy: rand(0.5, 1.1), vz: rand(-0.05, 0.05),
          size: rand(0.04, 0.09), color: [0.7, 0.9, 1], alpha: 0.5,
          life: rand(2.5, 5), grow: 0.01, drag: 0.1, gravity: -0.15,
        });
      }
    });

    makeSign(scene, { tex: TEX.hangingSign('沈没大陸', 'ATLANTIS RUINS', '#07202e', '◈'), w: 3, h: 0.8, x: X1 - 3, y: 3.8, z: Z0 + 0.8, intensity: 1.6 });

    SPAWN_POOLS.atlantis = [
      { pos: [-122, 70],  wps: [[-122, 70], [-126, 66], [-118, 74]] },
      { pos: [-85, 42],   wps: [[-85, 42], [-89, 41], [-81, 47]] },
      { pos: [-125, 72],  wps: [[-125, 72], [-121, 73], [-126, 78]] },
      { pos: [-83, 76],   wps: [[-83, 76], [-88, 77], [-80, 71]] },
      { pos: [-104, 42],  wps: [[-104, 42], [-100, 41], [-108, 43]] },
      { pos: [-94, 58],   wps: [[-94, 58], [-92, 54], [-92, 62]] },
      { pos: [-104, 82],  wps: [[-104, 82], [-108, 81], [-100, 83]] },
    ];
  }
}
