// ============================================================
// newAreas3.js — MISSIONS 13–15 worlds (spec: moremaps2.md):
//   canyon     錆の峡谷 · wind-carved red-rock canyon with the
//              ribcage wreck of a kilometer starship; periodic
//              sandstorms dim the whole map (fog drives it)
//   aquarium   無重力水槽 · zero-G neon aquarium: floating water
//              orbs (fresnel shader) slow you inside, a mechanical
//              megalodon patrols the hall, caustic floor overlay
//   clockwork  歯車の煉獄 · endless brass gear world: hierarchical
//              gears with transmission ratios, gothic silhouettes,
//              floating brass dust
// Same contract as newAreas.js / newAreas2.js: one-time build,
// lights permanent in-scene, bounds[] + SPAWN_POOLS registration,
// InstancedMesh for repeats, ShaderMaterial for atmosphere.
// ============================================================

import * as THREE from 'three';
import { addBox, cachedBox } from './build.js';
import { SPAWN_POOLS } from './enemy.js';
import { floor, walls, causticMat } from './newAreas.js';
import { THEME_BG2, pointField } from './newAreas2.js';
import { MAT } from './materials.js';
import { rand } from './utils.js';

// bg names re-exported for the mission loader (defined in newAreas2)
export const THEME_BG3 = { rust: THEME_BG2.rust, aqua: THEME_BG2.aqua, brass: THEME_BG2.brass };

export class NewAreas3 {
  constructor(scene, world, particles) {
    this.scene = scene;
    this.groups = {};
    this.world = world;
    this.p = particles;
    this.raycastMeshes = [];
    this.updaters = [];
    this.bounds = {};
    this.orbs = [];               // aquarium: {x,y,z,r} slow zones
    this.sandstorm = 0;           // canyon: 0 calm → 1 full storm (game reads it)
  }

  build() {
    this._canyon();
    this._aquarium();
    this._clockwork();
  }

  update(dt) {
    for (const u of this.updaters) u(dt);
  }

  // ============ MISSION 13 · 錆の峡谷 · rusting canyon · 52 × 52 m ============

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
  _canyon() {
    const G = this._g('canyon');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -240, X1 = -188, Z0 = 40, Z1 = 92;
    this.bounds.canyon = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;

    // sand floor
    const sandTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = '#8a4a28'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 900; i++) {
        x.fillStyle = `rgba(${140 + Math.random() * 70 | 0},${70 + Math.random() * 40 | 0},40,0.35)`;
        x.fillRect(Math.random() * 256, Math.random() * 256, rand(1, 4), rand(1, 3));
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, color: 0xc87a44, roughness: 0.95 });
    floor(G, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: sandMat });

    // canyon walls: jagged sandstone (instanced slabs stepped up the sides)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a4a24, roughness: 0.9 });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 16, mat: rockMat });
    const slab = new THREE.InstancedMesh(cachedBox(6, 3, 6), rockMat, 60);
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    for (let i = 0; i < 60; i++) {
      const side = i % 2;
      const px = side ? X0 + 1 + rand(0, 3) : X1 - 1 - rand(0, 3);
      const pz = Z0 + 2 + (i >> 1) * (Z1 - Z0 - 4) / 29 + rand(-1, 1);
      const py = 2 + ((i >> 1) % 4) * 2.4;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 1.2));
      mtx.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(rand(0.7, 1.3), rand(0.8, 1.5), rand(0.7, 1.2)));
      slab.setMatrixAt(i, mtx);
    }
    slab.instanceMatrix.needsUpdate = true;
    G.add(slab);

    // ---- the wreck: a kilometer starship broken into a metal cave ----
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 0.85, metalness: 0.45 });
    const hullDark = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 0.9, metalness: 0.3 });
    const seg = (x0, x1, z0, z1, y0, h) => {
      addBox(G, { w: x1 - x0, h, d: z1 - z0, mat: hullMat, x: (x0 + x1) / 2, y: y0 + h / 2, z: (z0 + z1) / 2, collide: world, raycast: rc, tag: 'metal' });
    };
    // three broken hull segments — walkable tops (≤1.2 m steps from crates)
    seg(-234, -222, 58, 68, 0, 3.2);
    seg(-220, -206, 56, 70, 0, 4.4);
    seg(-204, -194, 58, 66, 0, 2.6);
    // the cave: two tilted shell walls with a dark corridor between
    addBox(G, { w: 14, h: 6, d: 1.2, mat: hullMat, x: -213, y: 3, z: 76, collide: world, raycast: rc, tag: 'metal' });
    addBox(G, { w: 14, h: 6, d: 1.2, mat: hullMat, x: -213, y: 3, z: 82, collide: world, raycast: rc, tag: 'metal' });
    addBox(G, { w: 1.2, h: 6, d: 7, mat: hullMat, x: -220, y: 3, z: 79, collide: world, raycast: rc, tag: 'metal' });
    addBox(G, { w: 1.2, h: 6, d: 7, mat: hullMat, x: -206, y: 3, z: 79, collide: world, raycast: rc, tag: 'metal' });
    addBox(G, { w: 15, h: 1.2, d: 8, mat: hullDark, x: -213, y: 6.6, z: 79, collide: world, raycast: rc, tag: 'metal' });
    // engine bell: giant nozzle throwing a long shadow
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 2.4, 6, 14, 1, true), hullMat);
    bell.rotation.z = Math.PI / 2;
    bell.position.set(-192, 3.4, 62);
    bell.userData.tag = 'metal';
    G.add(bell);
    rc.push(bell);
    world.addBox(new THREE.Vector3(-195, 0, 59), new THREE.Vector3(-189, 6.5, 65));
    // scattered debris + stair-stepped crates (each ≤1.2 m → hop up)
    for (const [bx, bz, h] of [[-226, 54, 1.1], [-222.5, 54, 2.2], [-219, 54, 3.3], [-207, 52, 1.1], [-204, 52, 2.2], [-201, 52, 3.3], [-200, 70, 1.1], [-224, 72, 1.1], [-221, 72, 2.2]]) {
      addBox(G, { w: 2.2, h, d: 2.2, mat: hullDark, x: bx, y: h / 2, z: bz, collide: world, raycast: rc, tag: 'metal' });
    }
    const debris = new THREE.InstancedMesh(cachedBox(1.4, 1.0, 1.2), hullDark, 22);
    for (let i = 0; i < 22; i++) {
      const px = rand(X0 + 3, X1 - 3), pz = rand(Z0 + 3, Z1 - 3);
      if (px > -234 && px < -194 && pz > 54 && pz < 70) continue;
      q.setFromAxisAngle(new THREE.Vector3(rand(-0.2, 0.2), 1, rand(-0.2, 0.2)), rand(0, 6.28));
      mtx.compose(new THREE.Vector3(px, 0.4, pz), q, new THREE.Vector3(1, 1, 1));
      debris.setMatrixAt(i, mtx);
    }
    debris.instanceMatrix.needsUpdate = true;
    G.add(debris);

    // ---- sandstorm: full-map particle flow + fog cycle driven by storm ----
    const dust = pointField(500, X0, X1, 0, 14, Z0, Z1, { size: 3.4, color: 0xcf9a5e, fall: 0.4, drift: 9.5, seed: 5 });
    dust.pts.material.opacity = 0.0;
    G.add(dust.pts);
    let storm = 0, target = 0, timer = rand(12, 20);
    this.updaters.push((dt) => {
      timer -= dt;
      if (timer <= 0) {
        target = target > 0.5 ? 0 : 1;
        timer = target > 0.5 ? rand(9, 14) : rand(16, 26);
      }
      storm += (target - storm) * Math.min(1, dt * 0.5);
      this.sandstorm = storm;
      dust.mat.uniforms.uT.value += dt * (1 + storm * 3);
      dust.pts.material.opacity = 0.12 + storm * 0.55;
    });

    const sun = new THREE.PointLight(0xff8a4a, 60, 52, 2); sun.position.set(cx, 10, 64); scene.add(sun);

    SPAWN_POOLS.canyon = [
      { pos: [-232, 46], wps: [[-232, 46], [-224, 48], [-228, 52]] },
      { pos: [-196, 46], wps: [[-196, 46], [-204, 48], [-200, 52]] },
      { pos: [-232, 88], wps: [[-232, 88], [-224, 86], [-228, 82]] },
      { pos: [-196, 88], wps: [[-196, 88], [-204, 86], [-200, 82]] },
      { pos: [-196, 62], wps: [[-196, 62], [-198, 70], [-194, 76]] },
      { pos: [-236, 76], wps: [[-236, 76], [-232, 82], [-228, 78]] },
      { pos: [-214, 88], wps: [[-214, 88], [-208, 84], [-218, 84]] },
    ];
  }

  // ============ MISSION 14 · 無重力水槽 · zero-G aquarium ============

  _aquarium() {
    const G = this._g('aquarium');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 180, X1 = 232, Z0 = 20, Z1 = 72;
    this.bounds.aquarium = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.4, metalness: 0.6 });
    floor(G, rc, { w: X1 - X0, d: Z1 - Z0, x: cx, z: cz, mat: deckMat, y: 0.011 });
    addBox(G, { w: X1 - X0, h: 0.5, d: Z1 - Z0, mat: deckMat, x: cx, y: -0.25, z: cz, collide: world, raycast: rc, tag: 'metal' });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 13, mat: new THREE.MeshStandardMaterial({ color: 0x0e1420, roughness: 0.5, metalness: 0.4 }) });

    // animated caustic overlay on the floor (reuses atlantis shader, dimmed —
    // the arena already glows from neon/orbs and enemies must stay readable)
    const caust = causticMat(0.45);
    const cPlane = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 - 2, Z1 - Z0 - 2), caust);
    cPlane.rotation.x = -Math.PI / 2;
    cPlane.position.set(cx, 0.03, cz);
    G.add(cPlane);
    this.updaters.push((dt) => { caust.uniforms.uT.value += dt; });

    // neon wall strips (emissive only — no extra lights)
    for (const [nx, nz, w, d, col] of [
      [X0 + 0.4, cz, 0.12, Z1 - Z0 - 6, 0x00e5ff], [X1 - 0.4, cz, 0.12, Z1 - Z0 - 6, 0xff2b9d],
      [cx, Z0 + 0.4, X1 - X0 - 6, 0.12, 0x7d5cff], [cx, Z1 - 0.4, X1 - X0 - 6, 0.12, 0x22ffd0],
    ]) {
      addBox(G, { w, h: 5, d, mat: MAT.led(col, 0.9), x: nx, y: 4, z: nz, cast: false, raycast: rc, tag: 'glass' });
    }

    // ---- floating water orbs: fresnel shader spheres (slow zones) ----
    const orbMat = () => new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(0x39c8e8) } },
      vertexShader: /* glsl */`
        varying vec3 vN, vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform float uT; uniform vec3 uC;
        varying vec3 vN, vV;
        void main() {
          float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.2);
          float rip = 0.04 * sin(uT * 2.0 + vN.y * 14.0 + vN.x * 9.0);
          gl_FragColor = vec4(uC * (0.15 + f * 0.75 + rip), 0.15 + f * 0.4);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const orbDefs = [[200, 4, 34, 2.6], [214, 5, 46, 3.0], [196, 3.4, 56, 2.4], [218, 4.2, 62, 2.6], [206, 6.5, 30, 2.2]];
    const orbMats = [];
    for (const [ox, oy, oz, r] of orbDefs) {
      const m = orbMat();
      orbMats.push(m);
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m);
      s.position.set(ox, oy, oz);
      G.add(s);
      this.orbs.push({ x: ox, y: oy, z: oz, r });
    }
    this.updaters.push((dt) => { for (const m of orbMats) m.uniforms.uT.value += dt; });

    // ---- viewing platforms + ramps (jumping is floaty here) ----
    const platMat = new THREE.MeshStandardMaterial({ color: 0x232c3a, roughness: 0.45, metalness: 0.7 });
    for (const [px, pz, w, d, top] of [[188, 30, 6, 6, 2.6], [226, 66, 6, 6, 3.0], [206, 46, 5, 5, 4.0]]) {
      addBox(G, { w, h: 0.4, d, mat: platMat, x: px, y: top - 0.2, z: pz, collide: world, raycast: rc, tag: 'metal' });
      for (const sx of [px - w / 2 - 1.4, px + w / 2 + 1.4]) {
        const steps = Math.ceil(top);
        for (let i = 1; i <= steps; i++) {
          addBox(G, { w: 1.4, h: i, d: 1.3, mat: platMat,
            x: sx, y: i / 2, z: pz + (steps - i) * 1.3, collide: world, raycast: rc, tag: 'metal' });
        }
      }
    }

    // ---- mechanical megalodon prowling the ceiling (backdrop threat) ----
    const shark = new THREE.Group();
    const smat = new THREE.MeshStandardMaterial({ color: 0x2c3644, roughness: 0.35, metalness: 0.75 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 6.5, 6, 10), smat);
    body.rotation.z = Math.PI / 2;
    body.scale.set(1, 1, 0.75);
    body.userData.tag = 'metal';
    shark.add(body);
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 8), smat);
    jaw.rotation.z = -Math.PI / 2;
    jaw.position.set(5, 0, 0);
    jaw.userData.tag = 'metal';
    shark.add(jaw);
    const fin = new THREE.Mesh(cachedBox(0.12, 1.8, 1.2), smat);
    fin.position.set(0, 1.4, 0);
    shark.add(fin);
    const tail = new THREE.Mesh(cachedBox(0.12, 2.4, 1.6), smat);
    tail.position.set(-4.6, 0.4, 0);
    shark.add(tail);
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3040, emissiveIntensity: 1.8 }));
      eye.position.set(3.4, 0.3, side * 0.75);
      shark.add(eye);
    }
    const dorsalGlow = new THREE.Mesh(cachedBox(3, 0.05, 0.3), new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x00e5ff, emissiveIntensity: 1.2 }));
    dorsalGlow.position.set(0, 1.9, 0);
    shark.add(dorsalGlow);
    shark.position.set(cx, 10.5, cz);
    G.add(shark);
    let sh = 0;
    this.updaters.push((dt) => {
      sh += dt;
      const a = sh * 0.35;
      shark.position.set(cx + Math.cos(a) * 18, 10.2 + Math.sin(sh * 0.9) * 0.7, cz + Math.sin(a) * 18);
      shark.rotation.y = -a + Math.PI / 2;
      shark.rotation.z = Math.sin(sh * 1.6) * 0.06;
    });

    const l1 = new THREE.PointLight(0x39c8e8, 26, 42, 2); l1.position.set(200, 6, 38); scene.add(l1);
    const l2 = new THREE.PointLight(0xff2b9d, 20, 38, 2); l2.position.set(220, 6, 60); scene.add(l2);

    SPAWN_POOLS.aquarium = [
      { pos: [188, 24], wps: [[188, 24], [196, 26], [190, 30]] },
      { pos: [226, 26], wps: [[226, 26], [218, 28], [224, 32]] },
      { pos: [188, 66], wps: [[188, 66], [196, 64], [190, 60]] },
      { pos: [226, 68], wps: [[226, 68], [218, 66], [224, 62]] },
      { pos: [184, 54], wps: [[184, 54], [190, 50], [184, 60]] },
      { pos: [228, 46], wps: [[228, 46], [222, 42], [226, 38]] },
      { pos: [206, 66], wps: [[206, 66], [212, 62], [200, 62]] },
    ];
  }

  // ============ MISSION 15 · 歯車の煉獄 · clockwork purgatory ============

  _clockwork() {
    const G = this._g('clockwork');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 180, X1 = 232, Z0 = -60, Z1 = -8;
    this.bounds.clockwork = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;

    const plateMat = new THREE.MeshStandardMaterial({ color: 0x3a2f1e, roughness: 0.6, metalness: 0.5 });
    floor(G, rc, { w: X1 - X0, d: Z1 - Z0, x: cx, z: cz, mat: plateMat, y: 0.011 });
    addBox(G, { w: X1 - X0, h: 0.5, d: Z1 - Z0, mat: plateMat, x: cx, y: -0.25, z: cz, collide: world, raycast: rc, tag: 'metal' });
    walls(G, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 15, mat: new THREE.MeshStandardMaterial({ color: 0x2b2113, roughness: 0.7, metalness: 0.45 }) });

    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2c, roughness: 0.32, metalness: 0.85 });
    const brass2 = new THREE.MeshStandardMaterial({ color: 0x9c7c3a, roughness: 0.28, metalness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.5, metalness: 0.8 });

    // ---- the big floor gears: visual spin, static AABB walk surfaces ----
    // (collider stays axis-aligned so movement stays predictable, while
    // the disc + teeth + spokes rotate under your feet — the spec's
    // "standing on turning floors" disorientation)
    const bigGear = (gx, gz, r, teeth, dir, ratio) => {
      const grp = new THREE.Group();
      grp.position.set(gx, 0.35, gz);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.5, 26), brass);
      disc.receiveShadow = true;
      grp.add(disc);
      const tGeo = cachedBox(0.9, 0.42, 1.1);
      const ring = new THREE.InstancedMesh(tGeo, brass2, teeth);
      const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        q.setFromAxisAngle(up, a);
        mtx.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
        ring.setMatrixAt(i, mtx);
      }
      ring.instanceMatrix.needsUpdate = true;
      grp.add(ring);
      for (let sIdx = 0; sIdx < 4; sIdx++) {
        const spoke = new THREE.Mesh(cachedBox(r * 1.7, 0.24, 0.6), iron);
        spoke.rotation.y = (sIdx / 4) * Math.PI;
        grp.add(spoke);
      }
      G.add(grp);
      rc.push(disc);   // bullets spark off the gear rim and top
      // walkable static AABB, kept in the shallow band that the
      // anti-stuck guard ignores (max.y ≤ 0.3) — you hop on, it spins
      world.addBox(new THREE.Vector3(gx - r, -0.5, gz - r), new THREE.Vector3(gx + r, 0.18, gz + r));
      let ang = 0;
      this.updaters.push((dt) => { ang += dir * ratio * dt; grp.rotation.y = ang; });
      return grp;
    };
    bigGear(cx, cz, 9, 42, 1, 0.24);            // the master wheel
    bigGear(cx - 16, cz - 12, 6.5, 30, -1, 0.33);  // meshed counter-rotations
    bigGear(cx + 15, cz + 13, 7.5, 34, -1, 0.29);

    // ---- elevated gear platforms (stepping stones, ≤1.2 steps) ----
    const gearStep = (gx, gz, top, r = 3) => {
      addBox(G, { w: r * 2, h: 0.4, d: r * 2, mat: brass2, x: gx, y: top - 0.2, z: gz, collide: world, raycast: rc, tag: 'metal' });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r + 0.3, 0.16, 6, 18), iron);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(gx, top, gz);
      G.add(rim);
    };
    gearStep(cx - 13, cz + 8, 1.2, 2.6);
    gearStep(cx - 15, cz + 14, 2.4, 2.4);
    gearStep(cx + 12, cz - 10, 1.2, 2.6);
    gearStep(cx + 14, cz - 16, 2.4, 2.4);

    // ---- gothic silhouettes on the far rims (decor, no collision) ----
    const gothMat = new THREE.MeshStandardMaterial({ color: 0x241a0e, roughness: 0.8, metalness: 0.3 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const gx = cx + Math.cos(a) * 24, gz = cz + Math.sin(a) * 22;
      const h = rand(4, 9);
      addBox(G, { w: rand(1.6, 2.6), h, d: rand(1.6, 2.6), mat: gothMat, x: gx, y: h / 2, z: gz, cast: true, raycast: rc, tag: 'concrete' });
      addBox(G, { w: 0.5, h: 1.6, d: 0.5, mat: gothMat, x: gx, y: h + 0.8, z: gz, cast: false });
    }

    // ---- brass dust in the eternal dusk ----
    const dust = pointField(120, X0 + 2, X1 - 2, 0.5, 12, Z0 + 2, Z1 - 2,
      { size: 1.8, color: 0xffd67a, fall: -0.35, drift: 1.6, seed: 9 });
    G.add(dust.pts);
    this.updaters.push((dt) => { dust.mat.uniforms.uT.value += dt; });

    const l1 = new THREE.PointLight(0xffb45a, 55, 46, 2); l1.position.set(cx, 8, cz); scene.add(l1);

    SPAWN_POOLS.clockwork = [
      { pos: [186, -54], wps: [[186, -54], [194, -50], [188, -46]] },
      { pos: [226, -54], wps: [[226, -54], [218, -50], [224, -46]] },
      { pos: [186, -14], wps: [[186, -14], [194, -18], [188, -22]] },
      { pos: [226, -14], wps: [[226, -14], [218, -18], [224, -22]] },
      { pos: [206, -12], wps: [[206, -12], [212, -16], [200, -16]] },
      { pos: [206, -56], wps: [[206, -56], [212, -52], [200, -52]] },
      { pos: [184, -22], wps: [[184, -22], [190, -26], [186, -30]] },
    ];
  }
}
