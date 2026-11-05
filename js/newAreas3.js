// ============================================================
// newAreas3.js — MISSIONS 13–15 worlds (spec: moremaps2.md §4-6):
//   canyon     錆の峡谷 · red-sandstone canyon with the ribcage
//              wreck of a starship: 3 broken hull segments you can
//              fight INSIDE (breach holes, ribs, strip lights), a
//              cargo-stair sniper roost on the hull TOP, engine
//              bells throwing long sunset shadows, cliff ranges
//              instanced both ends, dense streaked sandstorm cycle
//   aquarium   無重力水槽 · zero-G neon aquarium: fresnel water
//              orbs, instanced jellyfish, a mechanical megalodon
//              that marks → circles → lunges at one orb every
//              ~20 s (swallows you if you're inside during the
//              lunge), caustic glow on all four walls, grating
//              observation decks at y 2.4 / 4.6 / 7
//   clockwork  歯車の煉獄 · gear-walled purgatory: spinning floor
//              gears with transmission ratios carry you (gearSpin),
//              their mesh points are lethal (hazards + spark
//              flicker), two r13 stadium gears carry gothic cities
//              as child nodes, manhole gears are jump plates, and
//              huge wall gears fill all four sides — no sky
// Same contract as newAreas.js / newAreas2.js: one-time build,
// lights permanent in-scene, bounds[] + SPAWN_POOLS registration,
// InstancedMesh for repeats, ShaderMaterial for atmosphere,
// ChunkGrid visibility + lodNode far decor.
// ============================================================

import * as THREE from 'three';
import { addBox, cachedBox } from './build.js';
import { SPAWN_POOLS } from './enemy.js';
import { canvas, floor, walls, causticMat } from './newAreas.js';
import { THEME_BG2, pointField } from './newAreas2.js';
import { ChunkGrid, splatShader } from './mapChunks.js';
import { MAT } from './materials.js';
import { rand } from './utils.js';

// bg names re-exported for the mission loader (defined in newAreas2)
export const THEME_BG3 = { rust: THEME_BG2.rust, aqua: THEME_BG2.aqua, brass: THEME_BG2.brass };

// Streaked sand: same GPU-driven drift as pointField, but each point
// is drawn as a stretched horizontal streak (gl_PointCoord squashed on
// x) — wind-carved grains read as lines, not dots (moremaps2 §4).
function sandStreaks(count, x0, x1, y0, y1, z0, z1, { size = 6.0, color = 0xd8a86a, seed = 3 } = {}) {
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
      uT: { value: 0 }, uH: { value: Math.max(1, y1 - y0) }, uY0: { value: y0 },
      uSize: { value: size }, uColor: { value: new THREE.Color(color) }, uSeed: { value: seed },
    },
    vertexShader: /* glsl */`
      uniform float uT, uH, uY0, uSize, uSeed;
      attribute vec3 aRnd;
      varying float vA;
      void main() {
        vec3 p = position;
        // horizontal gust sweep down-canyon + vertical tumble
        p.x = ${x0.toFixed(1)} + mod(p.x - ${x0.toFixed(1)} + uT * (6.0 + aRnd.x * 9.0), ${(x1 - x0).toFixed(1)});
        p.y = uY0 + mod(p.y - uY0 - uT * (0.6 + aRnd.y * 1.4), uH);
        p.z += sin(uT * (0.8 + aRnd.z) + aRnd.x * 6.28 + uSeed) * 1.8;
        vA = 0.3 + aRnd.z * 0.7;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (1.0 + aRnd.y) * (140.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 d = (gl_PointCoord - 0.5) * vec2(0.7, 4.2);   // long thin horizontal streak
        float m = smoothstep(0.5, 0.08, length(d));
        if (m <= 0.01) discard;
        gl_FragColor = vec4(uColor, m * vA);
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { pts, mat };
}

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
    this.gearSpin = [];           // clockwork: carry zones {x,z,top,r,omega}
    this.hazards = [];            // clockwork: lethal gear-mesh gaps {x,z,y,r,dmg}
    this.grids = {};              // per-area ChunkGrid (chunk-based visibility)
    this._vd = {};
    this._wctx = null;            // last world ctx (shark hunt needs the player)
  }

  build() {
    this._canyon();
    this._aquarium();
    this._clockwork();
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
    if (ctx) this._wctx = ctx;    // the megalodon hunt reads feet/damage from here
    for (const u of this.updaters) u(dt);
    if (ctx && ctx.feet) {
      for (const [a, g] of Object.entries(this.grids)) {
        if (this.groups[a] && this.groups[a].visible) g.update(ctx.feet.x, ctx.feet.z, this._vd[a] ?? 150);
      }
    }
  }

  // ============ MISSION 13 · 錆の峡谷 · rusting canyon · 72 × 52 m ============

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

  // moremaps2 §4: wind-carved red cliffs both ends, the wreck of a
  // starship lying along X with a walkable interior CQB corridor and a
  // sniper roost on its back, sunset light raking down the canyon and
  // sandstorms that periodically swallow the map.
  _canyon() {
    const G = this._g('canyon');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = -244, X1 = -172, Z0 = 40, Z1 = 92;
    this.bounds.canyon = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('canyon', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('canyon');
    const cell = (x, z) => this._cell('canyon', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const put = (im, i, px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };
    const putE = (im, i, px, py, pz, rx, ry, rz, sx = 1, sy = 1, sz = 1) => {
      e.set(rx, ry, rz); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(sx, sy, sz));
      im.setMatrixAt(i, mtx);
    };
    const specTex = (base, n, cols) => {
      const { c, x } = canvas(256, 256);
      x.fillStyle = base; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < n; i++) {
        x.fillStyle = `rgba(${cols[i % cols.length]},${0.12 + Math.random() * 0.22})`;
        x.fillRect(rand(0, 250), rand(0, 250), rand(2, 26), rand(2, 12));
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    // ---- sand floor: 3-way splat (sand base, rust blow-ins, pale dust) ----
    const sandMat = new THREE.MeshStandardMaterial({
      map: (() => {
        const { c, x } = canvas(256, 256);
        x.fillStyle = '#8a4a28'; x.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 900; i++) {
          x.fillStyle = `rgba(${140 + Math.random() * 70 | 0},${70 + Math.random() * 40 | 0},40,0.35)`;
          x.fillRect(Math.random() * 256, Math.random() * 256, rand(1, 4), rand(1, 3));
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(12, 9);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })(),
      color: 0xc87a44, roughness: 0.95,
    });
    splatShader(sandMat,
      specTex('#6e2a12', 90, ['150,60,26', '96,38,16']),
      specTex('#d8b078', 70, ['236,204,150', '180,140,90']),
      { n: 0.13, e: 0.3 });
    floor(core, rc, { w: X1 - X0 + 2, d: Z1 - Z0 + 2, x: cx, z: cz, mat: sandMat });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a4a24, roughness: 0.9, flatShading: true });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 18, mat: rockMat });

    // ---- CLIFF WALLS: instanced angular sandstone stacks up to 18 m
    // packed against the X0/X1 walls; one mass AABB per ridge keeps the
    // player out, bullets stop on the chunk faces themselves.
    const cliffs = new THREE.InstancedMesh(cachedBox(1, 1, 1), rockMat, 46);
    let ci = 0;
    const ridgeRun = (west) => {
      const xWall = west ? X0 : X1;
      for (let bz = Z0 + 2.6; bz < Z1 - 1; bz += 5.4) {
        const w = rand(4.6, 6.4), h = rand(9, 18), d = rand(4.6, 7.2);
        const xc = west ? xWall + w / 2 + rand(0, 1.2) : xWall - w / 2 - rand(0, 1.2);
        putE(cliffs, ci++, xc + rand(-0.8, 0.8), h / 2, bz + rand(-1.2, 1.2),
          0, rand(-0.3, 0.3), 0, w, h, d);
        if (h > 12) {  // crown shelf chunk
          const ch = rand(3, 5);
          putE(cliffs, ci++, xc + (west ? -0.9 : 0.9), h + ch / 2 - 0.5, bz + rand(-1.5, 1.5),
            0, rand(0.2, 0.7), 0, w * 0.7, ch, d * 0.6);
        }
      }
    };
    ridgeRun(true); ridgeRun(false);
    cliffs.count = ci;
    cliffs.frustumCulled = false;
    core.add(cliffs); rc.push(cliffs);
    world.addBox(new THREE.Vector3(X0, 0, Z0), new THREE.Vector3(X0 + 5.6, 18, Z1));
    world.addBox(new THREE.Vector3(X1 - 5.6, 0, Z0), new THREE.Vector3(X1, 18, Z1));

    // far cliff ranges beyond the canyon mouths: instanced silhouettes
    for (const [gx, gz] of [[X0 - 78, cz - 8], [X1 + 76, cz + 10], [cx - 10, Z0 - 84], [cx + 14, Z1 + 82]]) {
      const hi = new THREE.Group();
      const im = new THREE.InstancedMesh(cachedBox(1, 1, 1), rockMat, 9);
      for (let i = 0; i < 9; i++) {
        const w = rand(7, 13), h = rand(9, 20), d = rand(7, 13);
        putE(im, i, gx + rand(-20, 20), h / 2, gz + rand(-20, 20), 0, rand(0, 3), 0, w, h, d);
      }
      hi.add(im);
      // no lodNode here: its swap distance is measured to the chunk origin,
      // which sits outside the canyon — the hi mesh would never show. One
      // instanced draw per ridge is cheap enough to keep always-on.
      im.frustumCulled = false;
      core.add(hi);
    }

    // ---- THE WRECK: a 46 m starship broken into 3 hull segments along
    // X (axis y=3.9, r=6 → half-buried). You can walk INSIDE through
    // breach holes (rib frames, strip lights, CQB rooms) and climb the
    // cargo stair onto the roof for the sniper roost.
    const paintTex = specTex('#7d8ea0', 60, ['190,205,220', '70,84,96']);
    const rustTex = specTex('#7a3a1c', 110, ['158,72,30', '64,30,12']);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x8fa2b8, roughness: 0.55, metalness: 0.35, envMapIntensity: 1.2, emissive: 0x141b24, emissiveIntensity: 0.55 });
    splatShader(hullMat, rustTex, paintTex, { n: 0.22, e: 0.35 });
    const hullDark = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 0.9, metalness: 0.3 });
    const HZ0 = 60, HZ1 = 72, AX = 3.9, ROOF0 = 9.4, ROOF1 = 9.9;
    const segDefs = [[-232, -220], [-216, -200], [-196, -186.2]];
    const wallSeg = (x0, x1, z0, z1) => addBox(cell((x0 + x1) / 2, (z0 + z1) / 2),
      { w: x1 - x0, h: ROOF0, d: z1 - z0, mat: hullMat, x: (x0 + x1) / 2, y: ROOF0 / 2, z: (z0 + z1) / 2, collide: world, raycast: rc, tag: 'metal' });
    // outer skin: curved shell per segment (visual; the AABBs below collide)
    for (const [sx0, sx1] of segDefs) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, sx1 - sx0, 16, 1, true), hullMat);
      shell.rotation.z = Math.PI / 2;
      shell.position.set((sx0 + sx1) / 2, AX, 66);
      shell.castShadow = true;
      shell.userData.tag = 'metal';
      G.add(shell); rc.push(shell);
    }
    // bow nose cone at the west end (crumpled into the west cliff)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(6, 5.5, 14), hullMat);
    nose.rotation.z = Math.PI / 2;
    nose.position.set(-234.7, AX, 66);
    nose.castShadow = true;
    nose.userData.tag = 'metal';
    cell(-234, 66).add(nose); rc.push(nose);
    // hull side walls with breach gaps (walk-in holes for the corridor)
    // segment seams: fat glowing collars at the drum breaks + one emissive
    // rescue strip mid-gap, so the 3-segment starship silhouette parses.
    // (audit r3: 0.5-tube rings read as thin arcs pasted on a flat wall)
    // audit r5: the slab is 12 m wide but the cylindrical shell hides inside
    // it, so circular tori poked out only as thin arcs = "neon decals".
    // The collars become RECTANGULAR frames that hug the slab cross-section:
    // dark frame + inset glowing strip, legible from every flank.
    // audit r14c: camera fwd is (+0.48,+0.88) — spawn looks NE. The intact
    // drum must fill the -220..-216 gap on that line: closed r6.6 tube,
    // crown 1 m above the roofline, a rounded hull silhouette against sky
    // dead ahead instead of open rib lattice.
    const gapSeamXs = [-222.3, -213.7, -200.5, -195.5];
    const intact = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 8, 20), hullMat);
    intact.rotation.z = Math.PI / 2;
    intact.position.set(-218, 4.3, 66);
    intact.castShadow = true;
    intact.userData.tag = 'metal';
    cell(-218, 66).add(intact); rc.push(intact);
    world.addBox(new THREE.Vector3(-222, 0, 59.4), new THREE.Vector3(-214, 10.9, 72.6));
    const frameDark = new THREE.InstancedMesh(cachedBox(1, 1, 1), hullDark, 16);
    const seamLedMat = MAT.led(0xe04a26, 1.5);   // red emergency, pulsed below
    const frameLed = new THREE.InstancedMesh(cachedBox(1, 1, 1), seamLedMat, 16);
    let fi = 0;
    for (const sx of gapSeamXs) {
      q.identity();
      mtx.compose(v.set(sx, 9.8, 66), q, s.set(1.5, 0.9, 13.4)); frameDark.setMatrixAt(fi, mtx);
      mtx.compose(v.set(sx, 0.45, 66), q, s.set(1.5, 0.9, 13.4)); frameDark.setMatrixAt(fi + 1, mtx);
      mtx.compose(v.set(sx, 4.9, 59.55), q, s.set(1.5, 8.6, 0.9)); frameDark.setMatrixAt(fi + 2, mtx);
      mtx.compose(v.set(sx, 4.9, 72.45), q, s.set(1.5, 8.6, 0.9)); frameDark.setMatrixAt(fi + 3, mtx);
      mtx.compose(v.set(sx, 9.8, 66), q, s.set(0.5, 0.28, 13.0)); frameLed.setMatrixAt(fi, mtx);
      mtx.compose(v.set(sx, 0.45, 66), q, s.set(0.5, 0.28, 13.0)); frameLed.setMatrixAt(fi + 1, mtx);
      mtx.compose(v.set(sx, 4.9, 59.55), q, s.set(0.5, 8.2, 0.28)); frameLed.setMatrixAt(fi + 2, mtx);
      mtx.compose(v.set(sx, 4.9, 72.45), q, s.set(0.5, 8.2, 0.28)); frameLed.setMatrixAt(fi + 3, mtx);
      fi += 4;
    }
    frameDark.instanceMatrix.needsUpdate = true; frameLed.instanceMatrix.needsUpdate = true;
    core.add(frameDark); core.add(frameLed);
    const endCollars = new THREE.InstancedMesh(new THREE.TorusGeometry(6.3, 0.55, 6, 24), hullDark, 2);
    // audit r10: the free-floating rescue tori read as 'glowing portal
    // arches' competing with the frame LEDs — they come out.
    [-231.5, -186.6].forEach((sx, i) => putE(endCollars, i, sx, AX, 66, 0, Math.PI / 2, 0));
    endCollars.instanceMatrix.needsUpdate = true;
    core.add(endCollars);
    // cool rim high above the wreck: pale hull pops off the red cliffs
    const wreckRim = new THREE.PointLight(0x9fb8d0, 70, 80, 2); wreckRim.position.set(-208, 16, 66); scene.add(wreckRim);
    // audit r10: anchor cameras park 10-15 m off each face; the far end and
    // both flanks sat in pure shadow (anchor2 = a 70% black void quad).
    // One key per face, parked near where those cameras stand.
    const wEnd = new THREE.PointLight(0x8fa8c0, 55, 42, 2); wEnd.position.set(-227, 8, 52); scene.add(wEnd);
    const gapS1 = new THREE.PointLight(0xffc890, 34, 22, 2); gapS1.position.set(-218, 4.5, 57.5); scene.add(gapS1);
    const gapS2 = new THREE.PointLight(0xffc890, 34, 22, 2); gapS2.position.set(-198, 4.5, 57.5); scene.add(gapS2);
    const nFill = new THREE.PointLight(0x9fb8d0, 50, 38, 2); nFill.position.set(-208, 8, 79); scene.add(nFill);
    // anchor cameras walk the NORTH face too; wash it end-to-end
    const nW = new THREE.PointLight(0xffc890, 45, 32, 2); nW.position.set(-224, 7, 78); scene.add(nW);
    const nE = new THREE.PointLight(0xffc890, 45, 32, 2); nE.position.set(-195, 7, 78); scene.add(nE);
    // paint-band segmentation: each of the 3 drums gets a dark belly band
    // and a pale deck-line band. (audit r3: the old bands at z 66±5.7 were
    // buried INSIDE the 60..72 wallSeg slab — strap them on the slab faces)
    const bandDark = new THREE.MeshStandardMaterial({ color: 0x120d09, roughness: 0.85, metalness: 0.3 });
    const bandPale = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.5, metalness: 0.35, emissive: 0x3a342a, emissiveIntensity: 0.8 });
    for (const [sx0, sx1] of segDefs) {
      const mid = (sx0 + sx1) / 2, len = sx1 - sx0 - 0.4;
      for (const zc of [59.85, 72.15]) {
        addBox(cell(mid, zc), { w: len, h: 2.4, d: 0.3, mat: bandDark, x: mid, y: 1.2, z: zc, cast: false, raycast: rc, tag: 'metal' });
        addBox(cell(mid, zc), { w: len, h: 1.0, d: 0.3, mat: bandPale, x: mid, y: 8.6, z: zc, cast: false, raycast: rc, tag: 'metal' });
      }
    }
    // end-face banding so the wreck reads segmented from bow/stern axes too
    for (const [ex, em] of [[-232.18, -231.82], [-185.88, -186.24]]) {
      addBox(cell(ex, 66), { w: 0.35, h: 2.4, d: 11.2, mat: bandDark, x: ex, y: 1.2, z: 66, cast: false, raycast: rc, tag: 'metal' });
      addBox(cell(em, 66), { w: 0.35, h: 1.0, d: 11.2, mat: bandPale, x: em, y: 8.6, z: 66, cast: false, raycast: rc, tag: 'metal' });
    }
    // hull plating: dark vertical seams every ~2.6 m + two horizontal
    // panel lines per face — a bolted PANEL GRID, not flat billboards
    const plating = new THREE.InstancedMesh(cachedBox(0.55, 9.4, 0.18), hullDark, 40);
    let pli = 0;
    for (let x = -231; x <= -187 && pli < 40; x += 2.6)
      for (const zc of [59.9, 72.2])
        if (!((zc < 66 && (x < -226.2 && x > -225.8) || x < -211.2 && x > -210.8) || (zc > 66 && x < -211.2 && x > -210.8)))
          q.identity(), mtx.compose(v.set(x, 4.7, zc), q, s.set(1, 1, 1)), plating.setMatrixAt(pli++, mtx);
    plating.count = pli;
    plating.instanceMatrix.needsUpdate = true;
    core.add(plating);
    const hSeams = new THREE.InstancedMesh(cachedBox(1, 0.35, 0.2), hullDark, 4);
    pli = 0;
    for (const zc of [59.92, 72.18])
      for (const hy of [2.8, 6.6])
        { q.identity(); mtx.compose(v.set(-209, hy, zc), q, s.set(45, 1, 1)); hSeams.setMatrixAt(pli++, mtx); }
    hSeams.instanceMatrix.needsUpdate = true;
    core.add(hSeams);
    // mid-hull fill: the sun+key pair leaves segment 2's flanks unlit
    const canyonFill = new THREE.PointLight(0xffb877, 60, 40, 2); canyonFill.position.set(-207, 7, 57); scene.add(canyonFill);
    // audit r14b: the west spawn sight line (intact drum + torn bell) sat in
    // shadow — one key parked spawn-side so hull curves read from the start
    const spawnKey = new THREE.PointLight(0xffa866, 50, 36, 2); spawnKey.position.set(-226, 6.5, 50); scene.add(spawnKey);
    wallSeg(-232, -228, HZ0, HZ0 + 0.8); wallSeg(-224, -220, HZ0, HZ0 + 0.8);   // breach -228..-224
    wallSeg(-232, -220, HZ1 - 0.8, HZ1);
    wallSeg(-216, -211, HZ0, HZ0 + 0.8); wallSeg(-207, -200, HZ0, HZ0 + 0.8);   // breach -211..-207
    wallSeg(-216, -214, HZ1 - 0.8, HZ1); wallSeg(-210, -200, HZ1 - 0.8, HZ1);   // breach -214..-210
    wallSeg(-196, -187, HZ0, HZ0 + 0.8); wallSeg(-196, -187, HZ1 - 0.8, HZ1);
    // closed ends + interior bulkheads with door gaps = 3 CQB rooms
    wallSeg(-232, -231.2, HZ0, HZ1);
    wallSeg(-187, -186.2, HZ0, HZ1);
    wallSeg(-224, -223.5, 60.8, 66.8);          // door gap z 66.8..71.2
    wallSeg(-208, -207.5, 65.2, 71.2);          // door gap z 60.8..65.2
    // walkable roof (sniper roost) at y = ROOF1
    for (const [sx0, sx1] of segDefs)
      addBox(cell((sx0 + sx1) / 2, 66), { w: sx1 - sx0, h: ROOF1 - ROOF0, d: HZ1 - HZ0, mat: hullMat,
        x: (sx0 + sx1) / 2, y: (ROOF0 + ROOF1) / 2, z: 66, collide: world, raycast: rc, tag: 'metal' });
    // roof cover crates on the roost
    for (const [rx, rz] of [[-226, 63], [-210, 69], [-192, 64]])
      addBox(cell(rx, rz), { w: 3, h: 1.8, d: 2.4, mat: hullDark, x: rx, y: ROOF1 + 0.9, z: rz, collide: world, raycast: rc, tag: 'metal' });
    // interior rib frames (instanced rings) + dark deck plate underfoot
    const ribs = new THREE.InstancedMesh(new THREE.TorusGeometry(5.3, 0.22, 6, 20), hullDark, 14);
    let ri = 0;
    for (const [sx0, sx1] of segDefs)
      for (let x = sx0 + 2.5; x < sx1 - 1 && ri < 14; x += 4) {
        putE(ribs, ri++, x, AX, 66, 0, Math.PI / 2, 0);
      }
    ribs.count = ri;
    core.add(ribs); rc.push(ribs);
    for (const [sx0, sx1] of segDefs)
      addBox(cell((sx0 + sx1) / 2, 66), { w: sx1 - sx0, h: 0.1, d: 10.6, mat: hullDark,
        x: (sx0 + sx1) / 2, y: 0.06, z: 66, cast: false, raycast: rc, tag: 'metal' });
    // warm glow in the breach mouths so the corridor reads from outside
    // audit r14: warm steady = 'lit windows'. RED emergency pulse = damage.
    const breachGlowMat = new THREE.MeshBasicMaterial({ color: 0xe03a22, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const [bx, bz, ry] of [[-209, HZ0 + 0.06, 0], [-212, HZ1 - 0.06, Math.PI], [-226, HZ0 + 0.06, 0]]) {
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 5.2), breachGlowMat);
      bg.position.set(bx, 4.4, bz);
      bg.rotation.y = ry;
      cell(bx, bz).add(bg);
    }
    // emergency strip lights along the corridor ceiling: red, pulsed —
    // the breach glow must read as DAMAGE, not as a lit interior
    const stripLedMat = MAT.led(0xe8402a, 1.3);
    const strips = new THREE.InstancedMesh(cachedBox(2.4, 0.1, 0.24), stripLedMat, 8);
    const stripList = [[-229, 64], [-225, 68.6], [-212, 64], [-208.5, 68.6], [-203, 64], [-193, 64], [-190, 68.6], [-218, 66.3]];
    stripList.forEach(([lx, lz], i) => put(strips, i, lx, 5.6, lz, 0.7));
    core.add(strips);
    // shared red-emergency pulse: seam frames, corridor strips, breach glow
    this.updaters.push(() => {
      const t = performance.now() / 1000;
      const p = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.4)) * (Math.random() < 0.06 ? 0.25 : 1);
      seamLedMat.emissiveIntensity = 1.6 * p;
      stripLedMat.emissiveIntensity = 1.5 * p;
      breachGlowMat.opacity = 0.18 + 0.26 * p;
    });

    // ---- stern: two engine nozzle bells + tail fin, throwing shadows
    // down-canyon into the sunset ----
    // audit r14: bells in pale hull paint read as drum continuations. They
    // are dark metal now, one step bigger, with a dim red inner glow — the
    // crash-ship cue that must parse even in silhouette.
    const bellMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.8, metalness: 0.55, emissive: 0x140402, emissiveIntensity: 0.8 });
    for (const bz of [63, 69]) {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 2.1, 6, 14, 1, false), bellMat);
      bell.rotation.z = -Math.PI / 2;              // flare faces +X (down-canyon)
      bell.position.set(-183, AX, bz);
      bell.castShadow = true;
      bell.userData.tag = 'metal';
      cell(-183, bz).add(bell); rc.push(bell);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.42, 6, 18), bellMat);
      rim.rotation.y = Math.PI / 2;
      rim.position.set(-180.1, AX, bz);
      cell(-180, bz).add(rim);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(2.0, 16),
        new THREE.MeshBasicMaterial({ color: 0xe04028, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.y = Math.PI / 2;
      glow.position.set(-180.02, AX, bz);
      cell(-180, bz).add(glow);
      world.addBox(new THREE.Vector3(-186, 0, bz - 3.8), new THREE.Vector3(-180, 7.7, bz + 3.8));
    }
    // one bell TORN OFF, lying on the sand ON the NE spawn sight line: crash
    // debris that says 'this lattice was an engine' before you read the wreck
    {
      const bellM = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.8, metalness: 0.55, emissive: 0x2c0a04, emissiveIntensity: 1.0 });
      const dBell = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 2, 4.6, 14, 1, false), bellM);
      dBell.rotation.order = 'YXZ';
      dBell.rotation.y = 1.52;                       // mouth SW but 42° off-axis: 3/4 cone view
      dBell.rotation.z = -Math.PI / 2 + 0.12;        // mouth on the spawn-side end
      dBell.rotation.x = 0.1;
      dBell.position.set(-207, 1.9, 51);
      dBell.castShadow = true;
      dBell.userData.tag = 'metal';
      cell(-214, 53).add(dBell); rc.push(dBell);
      // orientation-proof red mouth: additive ball + dark rim torus
      const dGlow = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xd83820, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      dGlow.position.set(-206.9, 2.0, 48.7);
      cell(-206, 48).add(dGlow);
      const dRim = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.42, 6, 18), bellM);
      dRim.rotation.y = 3.09;
      dRim.position.set(-206.9, 2.0, 48.7);
      cell(-206, 48).add(dRim);
      world.addBox(new THREE.Vector3(-210.7, 0, 45.4), new THREE.Vector3(-203.3, 4.1, 54.6));
    }
    addBox(cell(-187, 66), { w: 6, h: 6, d: 0.8, mat: hullMat, x: -187, y: 12.9, z: 66, collide: world, raycast: rc, tag: 'metal' });   // tail fin
    for (const fz of [58.2, 73.8])
      addBox(cell(-187, fz), { w: 6, h: 0.8, d: 3.8, mat: hullMat, x: -187, y: 4.9, z: fz, collide: world, raycast: rc, tag: 'metal' }); // side fins

    // ---- cargo-box stair onto the hull roof: 24 × 0.4 m steps along
    // the segment-3 north wall, then a landing flush with the roofline ----
    // warm cargo-box steel so the stair reads against the cold dark hull
    const stairMat = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.8, metalness: 0.2, emissive: 0x1a0f04, emissiveIntensity: 0.4 });
    for (let i = 1; i <= 24; i++)
      addBox(cell(-210 + i * 0.55, 73.3), { w: 0.55, h: i * 0.4, d: 2.2, mat: stairMat,
        x: -210 + i * 0.55, y: i * 0.2, z: 73.3, collide: world, raycast: rc, tag: 'metal' });
    addBox(cell(-197.5, 72.8), { w: 6, h: 0.4, d: 3.6, mat: stairMat, x: -197.5, y: 9.8, z: 72.8, collide: world, raycast: rc, tag: 'metal' });
    // lit landing lip: the stair top reads warm against the cold hull from
    // the north anchors, so the roof route is findable at a glance
    addBox(cell(-197.5, 71.1), { w: 6, h: 0.07, d: 0.14, mat: MAT.led(0xffa860, 1.6),
      x: -197.5, y: 10.04, z: 71.12, cast: false, raycast: rc, tag: 'metal' });
    for (const i of [6, 11, 16, 21]) {
      const sx = -210 + i * 0.55;
      addBox(cell(sx, 73.3), { w: 0.5, h: 0.08, d: 2.0, mat: MAT.led(0xffa860, 1.5),
        x: sx, y: i * 0.4 + 0.04, z: 73.3, cast: false, raycast: rc, tag: 'metal' });
    }

    // ---- props: instanced crates (with AABBs), half-buried hull plates,
    // buckled plates tearing the segment ends, low dune mounds ----
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.75, metalness: 0.25 });
    const cratePos = [[-229, 47], [-226.6, 47.6], [-227.8, 49.4], [-227.8, 47], [-196, 50], [-193.6, 50.8], [-194.8, 48.4],
      [-229, 80], [-226.6, 80.6], [-227.8, 82.2], [-227.8, 80], [-180, 48], [-182.4, 48.8], [-181.2, 46.4], [-181.2, 48], [-199, 79]];
    const crates = new THREE.InstancedMesh(cachedBox(2, 2, 2), crateMat, cratePos.length);
    cratePos.forEach(([px, pz], i) => {
      put(crates, i, px, 1, pz, rand(0, 1));
      world.addBox(new THREE.Vector3(px - 1, 0, pz - 1), new THREE.Vector3(px + 1, 2, pz + 1));
    });
    cell(-227, 48).add(crates); rc.push(crates);
    const plateGeo = cachedBox(4, 0.16, 2.6);
    const buried = new THREE.InstancedMesh(plateGeo, hullMat, 10);
    [[-215, 84, 0.5, 0.4], [-198, 86, -0.6, 0.3], [-221, 44, 0.9, 0.25], [-183, 60, 1.4, 0.5],
      [-237, 55, -1.2, 0.35], [-238, 78, 0.8, 0.45], [-179, 82, -0.4, 0.3], [-205, 43, 1.1, 0.4],
      [-190, 44, -0.8, 0.35], [-216, 89, 0.2, 0.5]].forEach(([px, pz, ry, tilt], i) =>
      putE(buried, i, px, 0.35, pz, tilt, ry, 0, rand(0.9, 1.4), 1, rand(0.9, 1.3)));
    core.add(buried); rc.push(buried);
    // upright buckled plates for cover (axis-aligned colliders)
    for (const [px, pz, ry] of [[-222, 56, 0], [-199, 57, Math.PI / 2], [-212, 79, 0.02], [-184, 76, Math.PI / 2 + 0.02]])
      addBox(cell(px, pz), { w: 3.2, h: 2.4, d: 0.3, mat: hullMat, x: px, y: 1.2, z: pz, rotY: ry, collide: world, raycast: rc, tag: 'metal' });
    const buckled = new THREE.InstancedMesh(cachedBox(3.4, 0.14, 2.4), hullMat, 12);
    [[-220, 62, 0.6], [-220, 70, -0.7], [-216.4, 63, 1.1], [-216, 72, -0.4], [-200.4, 66, 0.8],
      [-196.4, 62, -1.2], [-196, 71, 0.5], [-211, 60.6, 1.3], [-208.4, 71.6, -0.9], [-232, 65, 0.4],
      [-186.4, 66, 1.0], [-225, 71.8, -0.5]].forEach(([px, pz, rz], i) =>
      putE(buckled, i, px, 4 + rand(-1.5, 3.5), pz, rand(-0.2, 0.2), rand(0, 3), rz, 1, 1, 1));
    core.add(buckled);
    const dunes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), sandMat, 12);
    [[-237, 60, 3.2], [-238, 84, 2.8], [-179, 52, 3.0], [-178, 68, 2.6], [-236, 44, 2.4], [-180, 88, 2.9],
      [-224, 90, 3.4], [-196, 41, 2.6], [-208, 45, 2.2], [-239, 68, 2.7], [-178, 78, 2.3], [-214, 89, 2.5]]
      .forEach(([px, pz, sc], i) => put(dunes, i, px, sc * 0.18, pz, rand(0, 3), sc, sc * 0.32, sc * 0.8));
    core.add(dunes); rc.push(dunes);

    // ---- sandstorm: dense streaked flow + fine grain, cycled by storm
    // value (game.js crushes the fog with it — see MISSIONS mods) ----
    const streaks = sandStreaks(1400, X0 + 1, X1 - 1, 0.2, 15, Z0 + 1, Z1 - 1, { size: 0.9, seed: 5 });
    streaks.pts.material.opacity = 0.0;
    core.add(streaks.pts);
    const grain = pointField(110, X0, X1, 0, 13, Z0, Z1, { size: 0.7, color: 0xcf9a5e, fall: 0.5, drift: 11, seed: 7 });
    grain.pts.material.opacity = 0.0;
    core.add(grain.pts);
    let storm = 0, target = 0, timer = rand(12, 20);
    this.updaters.push((dt) => {
      timer -= dt;
      if (timer <= 0) {
        target = target > 0.5 ? 0 : 1;
        timer = target > 0.5 ? rand(9, 14) : rand(16, 26);
      }
      storm += (target - storm) * Math.min(1, dt * 0.5);
      this.sandstorm = storm;
      // calm: nearly still + tiny points (no soft blobs at spawn); storm:
      // dense count, thin 0.9 px points streaking, never a white blob wall
      streaks.mat.uniforms.uT.value += dt * (0.35 + storm * 3.5);
      streaks.mat.uniforms.uSize.value = 0.9 * (0.5 + storm * 0.5);
      streaks.pts.material.opacity = 0.02 + storm * 0.4;    // always a thin drift, never a whiteout
      grain.mat.uniforms.uT.value += dt * (0.3 + storm * 2.2);
      grain.pts.material.opacity = 0.02 + storm * 0.32;
    });

    // sunset key raking down the canyon past the nozzles + dim corridor fill
    const sun = new THREE.PointLight(0xff7a3a, 190, 115, 2); sun.position.set(-178, 10, 66); scene.add(sun);
    const key = new THREE.PointLight(0xffb066, 150, 75, 2); key.position.set(-226, 8, 66); scene.add(key);
    for (const lx of [-226, -212, -204]) {
      const l = new THREE.PointLight(0xffa060, 26, 15, 2); l.position.set(lx, 3.4, 66); scene.add(l);
    }

    SPAWN_POOLS.canyon = [
      { pos: [-233, 47], wps: [[-233, 47], [-228, 45], [-231, 52]] },
      { pos: [-220, 46], wps: [[-220, 46], [-214, 48], [-222, 52]] },
      { pos: [-196, 47], wps: [[-196, 47], [-202, 49], [-194, 53]] },
      { pos: [-231, 84], wps: [[-231, 84], [-226, 86], [-230, 78]] },
      { pos: [-207, 77], wps: [[-207, 77], [-203, 75], [-209, 76]] },   // foot of the cargo stair
      { pos: [-181, 84], wps: [[-181, 84], [-184, 78], [-178, 74]] },
      { pos: [-209, 57], wps: [[-209, 57], [-209, 63], [-206, 66]] },   // at the breach mouth, feeds the corridor
    ];
  }

  // ============ MISSION 14 · 無重力水槽 · zero-G aquarium ============

  // moremaps2 §5: the sealed neon hall plus floating fresnel water orbs,
  // instanced jellyfish, caustic mottle on all four walls, grating decks
  // at y 2.4 / 4.6 / 7 — and a mechanical megalodon that HUNTS one orb at
  // a time: mark → circle → dive-lunge, swallowing anyone inside it.
  _aquarium() {
    const G = this._g('aquarium');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 180, X1 = 232, Z0 = 20, Z1 = 72;
    this.bounds.aquarium = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('aquarium', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('aquarium');
    const cell = (x, z) => this._cell('aquarium', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.62, metalness: 0.4, envMapIntensity: 0.35 });
    floor(core, rc, { w: X1 - X0, d: Z1 - Z0, x: cx, z: cz, mat: deckMat, y: 0.011 });
    addBox(core, { w: X1 - X0, h: 0.5, d: Z1 - Z0, mat: deckMat, x: cx, y: -0.25, z: cz, collide: world, raycast: rc, tag: 'metal' });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 13, mat: new THREE.MeshStandardMaterial({ color: 0x1c2636, roughness: 0.5, metalness: 0.4, emissive: 0x0d1524, emissiveIntensity: 0.8 }) });
    // sealed hall: lid a full step brighter + instanced roof girders, so
    // the eye finds a CEILING at the top of the bounds instead of cyan haze
    addBox(core, { w: X1 - X0 + 1, h: 0.6, d: Z1 - Z0 + 1, mat: new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.6, metalness: 0.5, emissive: 0x141f33, emissiveIntensity: 1.2 }), x: cx, y: 13.3, z: cz, cast: false, raycast: rc, tag: 'metal' });
    const girders = new THREE.InstancedMesh(cachedBox(1, 0.7, 0.5), new THREE.MeshStandardMaterial({ color: 0x465570, roughness: 0.55, metalness: 0.6, emissive: 0x182338, emissiveIntensity: 1.0 }), 6);
    for (let gi = 0; gi < 6; gi++) {
      q.identity();
      mtx.compose(v.set(X0 + 4 + gi * (X1 - X0 - 8) / 5, 12.8, cz), q, s.set(1, 1, (Z1 - Z0 - 2) / 0.5));
      girders.setMatrixAt(gi, mtx);
    }
    girders.instanceMatrix.needsUpdate = true;
    core.add(girders);

    // animated caustics: floor + one dim overlay panel on ALL FOUR inner
    // walls (moremaps2's projected caustic light-map, kept dim so the
    // neon/orb glow and enemy silhouettes stay readable)
    const caust = causticMat(0.32);
    const cPlane = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 - 2, Z1 - Z0 - 2), caust);
    cPlane.rotation.x = -Math.PI / 2;
    cPlane.position.set(cx, 0.03, cz);
    core.add(cPlane);
    const caustW = causticMat(0.45);    // kept dim: walls must read as walls, not void OR wash
    for (const [px, pz, ry, w] of [
      [X0 + 0.35, cz, Math.PI / 2, Z1 - Z0 - 2], [X1 - 0.35, cz, -Math.PI / 2, Z1 - Z0 - 2],
      [cx, Z0 + 0.35, 0, X1 - X0 - 2], [cx, Z1 - 0.35, Math.PI, X1 - X0 - 2],
    ]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, 11), caustW);
      p.position.set(px, 6.4, pz);
      p.rotation.y = ry;
      core.add(p);
    }
    this.updaters.push((dt) => { caust.uniforms.uT.value += dt; caustW.uniforms.uT.value += dt * 0.8; });

    // neon wall strips (emissive only — no extra lights)
    // audit r9: pink/violet strips bloomed the walls into a synthwave
    // cyclorama; all four are deep aqua now, half intensity
    for (const [nx, nz, w, d, col] of [
      [X0 + 0.4, cz, 0.12, Z1 - Z0 - 6, 0x2ac0dc], [X1 - 0.4, cz, 0.12, Z1 - Z0 - 6, 0x1898b8],
      [cx, Z0 + 0.4, X1 - X0 - 6, 0.12, 0x1a6a9a], [cx, Z1 - 0.4, X1 - X0 - 6, 0.12, 0x1898b8],
    ]) {
      addBox(cell(nx, nz), { w, h: 8, d, mat: MAT.led(col, 0.5), x: nx, y: 5.5, z: nz, cast: false, raycast: rc, tag: 'glass' });
    }

    // ---- floating water orbs: fresnel shader spheres (slow zones),
    // radii 3-7; the big center one keeps a glow-jelly captive inside ----
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
          float rip = 0.03 * sin(uT * 2.0 + vN.y * 14.0 + vN.x * 9.0);
          // audit r11: orbs read as flat decal discs. A specular hotspot +
          // stronger rim give them spherical volume at a glance.
          vec3 L = normalize(vec3(0.45, 0.8, 0.35));
          float spec = pow(max(dot(normalize(vN), L), 0.0), 24.0);
          gl_FragColor = vec4(uC * (0.10 + f * f * 0.85 + rip) + vec3(0.75, 0.95, 1.0) * spec * 0.5,
            0.10 + f * f * 0.55 + spec * 0.25);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    // audit r14: orb clusters sat right on the anchor→patrol sight lines and
    // the (212,40) pair swamped the spawn view. Big centre orb moves north of
    // the z=58 patrol leg (no orb centre within 6 m of any anchor→shark
    // segment); the right-side spawn cluster shrinks ~45%.
    const orbDefs = [[200, 5, 27, 3.5], [215.5, 5.5, 38.5, 1.4], [207, 4.5, 24.5, 3], [189, 6.5, 47, 3.2], [220, 6.2, 44, 1.15], [212, 6.8, 66.5, 4.4]];
    const orbMats = [];
    for (const [ox, oy, oz, r] of orbDefs) {
      const m = orbMat();
      orbMats.push(m);
      const sp = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m);
      sp.position.set(ox, oy, oz);
      cell(ox, oz).add(sp);
      this.orbs.push({ x: ox, y: oy, z: oz, r });
    }
    // glow-jelly inside the big orb
    const hostJelly = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a4a5a, emissive: 0x66ffe0, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }));
    hostJelly.position.set(212, 6.8, 66.5);
    cell(212, 66).add(hostJelly);
    this.updaters.push((dt) => {
      for (const m of orbMats) m.uniforms.uT.value += dt;
      const t = performance.now() / 1000;
      hostJelly.position.y = 6.8 + Math.sin(t * 0.8) * 0.5;
      hostJelly.scale.setScalar(1 + Math.sin(t * 1.7) * 0.08);
    });

    // ---- jellyfish: instanced bells + trailing tentacle strips, slow
    // bob/drift updaters; several huddle around the orbs ----
    const JN = 14;
    const jellyMat = new THREE.MeshStandardMaterial({ color: 0x1a4a5a, emissive: 0x39c8e8, emissiveIntensity: 1.3, transparent: true, opacity: 0.85, roughness: 0.4 });
    const tentMat = new THREE.MeshStandardMaterial({ color: 0x2a1a3a, emissive: 0xd246a0, emissiveIntensity: 1.0, transparent: true, opacity: 0.7 });
    const bells = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), jellyMat, JN);
    const tents = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), tentMat, JN * 3);
    bells.frustumCulled = false; tents.frustumCulled = false;
    core.add(bells, tents);
    const jellies = [
      [211, 7.4, 64.5, 0.9], [212, 5.6, 65, 0.55], [216, 6.2, 55, 0.8], [196, 5.6, 37, 0.7],
      [190, 7.2, 49, 0.65], [220, 6.8, 35, 0.75], [199, 9.5, 44, 0.6], [214, 10.5, 40, 0.7],
      [188, 8.5, 30, 0.55], [226, 9.5, 60, 0.6], [204, 11, 50, 0.5], [211, 4, 24, 0.6],
      [224, 5, 46, 0.5], [185, 6, 66, 0.7],
    ].map(([x, y, z, r], i) => ({ x, y, z, r, ph: i * 0.9, sp: 0.5 + (i % 4) * 0.22 }));
    this.updaters.push((dt) => {
      const t = performance.now() / 1000;
      for (let i = 0; i < JN; i++) {
        const j = jellies[i];
        const jy = j.y + Math.sin(t * j.sp + j.ph) * 0.7;
        const jx = j.x + Math.sin(t * 0.22 + j.ph * 2) * 0.5;
        e.set(0, t * 0.3 + j.ph, 0); q.setFromEuler(e);
        mtx.compose(v.set(jx, jy, j.z), q, s.set(j.r, j.r * 0.72, j.r));
        bells.setMatrixAt(i, mtx);
        for (let k = 0; k < 3; k++) {
          const a = j.ph + k * 2.09;
          e.set(Math.sin(t * 1.1 + a) * 0.14, 0, Math.cos(t * 0.9 + a) * 0.14); q.setFromEuler(e);
          mtx.compose(v.set(jx + Math.cos(a) * j.r * 0.5, jy - j.r * 0.7 - 0.85, j.z + Math.sin(a) * j.r * 0.5), q, s.set(1, 1 + 0.3 * Math.sin(t * 0.7 + a), 1));
          tents.setMatrixAt(i * 3 + k, mtx);
        }
      }
      bells.instanceMatrix.needsUpdate = true;
      tents.instanceMatrix.needsUpdate = true;
    });

    // ---- grating observation decks at y 2.4 / 4.6 / 7 + instanced rail
    // posts; jetpack routes between them (zeroG) ----
    const platMat = new THREE.MeshStandardMaterial({ color: 0x5a6779, roughness: 0.35, metalness: 0.7, envMapIntensity: 1.4 });
    const decks = [[187, 30, 6, 5, 2.4], [226, 26, 6, 5, 2.4], [206, 46, 7, 7, 4.6], [190, 64, 6, 5, 7.0], [224, 62, 5, 5, 4.6]];
    // thin emissive lip around every grating deck: the platforms read as
    // solid grating boxes in the murk instead of gray smears
    const lipMat = MAT.led(0x66d8ff, 2.8);
    const lipIM = new THREE.InstancedMesh(cachedBox(1, 0.18, 0.3), lipMat, 20);
    let li = 0;
    const putLip = (px, py, pz, len, ry) => {
      e.set(0, ry, 0); q.setFromEuler(e);
      mtx.compose(v.set(px, py, pz), q, s.set(len, 1, 1));
      lipIM.setMatrixAt(li++, mtx);
    };
    const rails = new THREE.InstancedMesh(cachedBox(0.09, 0.9, 0.09), platMat, 84);
    let qi = 0;
    const putRail = (px, py, pz) => {
      q.identity();
      mtx.compose(v.set(px, py, pz), q, s.set(1, 1, 1));
      rails.setMatrixAt(qi++, mtx);
    };
    for (const [px, pz, w, d, top] of decks) {
      addBox(cell(px, pz), { w, h: 0.4, d, mat: platMat, x: px, y: top - 0.2, z: pz, collide: world, raycast: rc, tag: 'metal' });
      putLip(px, top + 0.11, pz - d / 2, w, 0); putLip(px, top + 0.11, pz + d / 2, w, 0);
      putLip(px - w / 2, top + 0.11, pz, d, Math.PI / 2); putLip(px + w / 2, top + 0.11, pz, d, Math.PI / 2);
      for (let x = px - w / 2 + 0.3; x <= px + w / 2 - 0.2; x += 1.6) { putRail(x, top + 0.65, pz - d / 2 + 0.15); putRail(x, top + 0.65, pz + d / 2 - 0.15); }
      for (let z = pz - d / 2 + 1.4; z <= pz + d / 2 - 1.3; z += 1.6) { putRail(px - w / 2 + 0.15, top + 0.65, z); putRail(px + w / 2 - 0.15, top + 0.65, z); }
      // suspension cables up to the lid (visual only)
      for (const [ox, oz] of [[px - w / 2 + 0.4, pz - d / 2 + 0.4], [px + w / 2 - 0.4, pz + d / 2 - 0.4]]) {
        // audit r9: bright thin cables read as 'stray white diagonals' —
        // they get a matte dark material so they stop lighting up the ceiling
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 13 - top, 6),
          new THREE.MeshStandardMaterial({ color: 0x242e3c, roughness: 0.8, metalness: 0.3 }));
        cab.position.set(ox, (13 + top) / 2, oz);
        cell(px, pz).add(cab);
      }
    }
    rails.count = qi;
    core.add(rails);
    lipIM.count = li;
    core.add(lipIM);
    // floor light-grid: the black deck plane was a dead void; a faint grid
    // of cyan strips gives perspective and says "hall floor" at every angle
    const gridIM = new THREE.InstancedMesh(cachedBox(0.14, 0.05, 1), MAT.led(0x2e7a90, 0.25), 24);
    let gi2 = 0;
    for (let gx2 = X0 + 4; gx2 <= X1 - 4; gx2 += 6) {
      e.set(0, 0, 0); q.setFromEuler(e);
      mtx.compose(v.set(gx2, 0.05, cz), q, s.set(1, 1, Z1 - Z0 - 6));
      gridIM.setMatrixAt(gi2++, mtx);
    }
    for (let gz2 = Z0 + 4; gz2 <= Z1 - 4; gz2 += 6) {
      e.set(0, Math.PI / 2, 0); q.setFromEuler(e);
      mtx.compose(v.set(cx, 0.05, gz2), q, s.set(1, 1, X1 - X0 - 6));
      gridIM.setMatrixAt(gi2++, mtx);
    }
    gridIM.count = gi2;
    gridIM.instanceMatrix.needsUpdate = true;
    core.add(gridIM);
    // audit r14 (spawn view): the glowing grid alone read as smooth tile.
    // Dark panel-gap strips cross-hatch between the light lines every 3 m,
    // so the deck reads as bolted GRATING, not polished flooring.
    const gapIM = new THREE.InstancedMesh(cachedBox(0.55, 0.04, 1),
      new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.9, metalness: 0.2 }), 32);
    let gi3 = 0;
    for (let gx3 = X0 + 3; gx3 <= X1 - 3; gx3 += 6) {
      q.identity();
      mtx.compose(v.set(gx3, 0.04, cz), q, s.set(1, 1, Z1 - Z0 - 3));
      gapIM.setMatrixAt(gi3++, mtx);
    }
    for (let gz3 = Z0 + 3; gz3 <= Z1 - 3; gz3 += 6) {
      e.set(0, Math.PI / 2, 0); q.setFromEuler(e);
      mtx.compose(v.set(cx, 0.04, gz3), q, s.set(1, 1, X1 - X0 - 3));
      gapIM.setMatrixAt(gi3++, mtx);
    }
    gapIM.count = gi3;
    gapIM.instanceMatrix.needsUpdate = true;
    core.add(gapIM);
    // ceiling light bars: audit r10 — full-hall-length LED bars read as one
    // giant white slab cutting the frame; now short 10 m fixtures in a row
    const cbar = new THREE.InstancedMesh(cachedBox(1, 0.16, 0.22), MAT.led(0x9fe8ff, 0.5), 7);
    for (let bi = 0; bi < 7; bi++) {
      e.set(0, 0, 0); q.setFromEuler(e);
      const bz3 = bi < 4 ? cz - 9 : cz + 9;
      mtx.compose(v.set(X0 + 7 + (bi % 4) * ((X1 - X0 - 14) / 3), 12.2, bz3), q, s.set(10, 1, 1));
      cbar.setMatrixAt(bi, mtx);
    }
    cbar.instanceMatrix.needsUpdate = true;
    core.add(cbar);
    // ceiling ribs so the roof reads as hall structure, not empty void
    const ceilRibs = new THREE.InstancedMesh(cachedBox(1, 0.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x5a6f92, roughness: 0.6, metalness: 0.6, emissive: 0x2a3d5c, emissiveIntensity: 1.7 }), 6);
    for (let bi = 0; bi < 6; bi++) {
      q.identity();
      mtx.compose(v.set(X0 + 5 + bi * (X1 - X0 - 10) / 5, 12.7, cz), q, s.set(1, 1, Z1 - Z0 - 2));
      ceilRibs.setMatrixAt(bi, mtx);
    }
    ceilRibs.instanceMatrix.needsUpdate = true;
    core.add(ceilRibs);

    // ---- THE MEGALODON: ~8.5 m box-built mechanical shark prowling the
    // overhead circuit; every ~20 s it marks one orb, circles it, then
    // dive-lunges through it — anyone within 4 m during the lunge gets
    // swallowed (damage + flash + respawn + low 'land' growl). ----
    const shark = new THREE.Group(); shark.name = "m14shark"; const bodyCyl = new THREE.CylinderGeometry(1.3, 0.85, 8.6, 12);
    shark.rotation.order = 'YXZ';
    // audit r5: at 25-40 m the gray shark vanished against the black hall.
    // A build-time fixture parented to the beast: it drags its own key
    // light on patrol, so it reads as the brightest living thing in the hall
    const sharkGlow = new THREE.PointLight(0xffd8a0, 85, 34, 2);
    sharkGlow.position.set(0, 0.5, 0);
    shark.add(sharkGlow);
    // audit: at 8.5 m and 25-40 m it read as 'a machine console', not a
    // shark — audit r14: bigger beast (true megalodon mass) and the fin
    // tops pulled under the lid so it can patrol at y 7.5+ scaled up
    shark.scale.setScalar(1.7);
    // brushed steel with a faint cold glow: at metalness 0.75 the whole
    // megalodon rendered as a black box in this dim neon hall
    const smat = new THREE.MeshStandardMaterial({ color: 0xcf6a38, roughness: 0.45, metalness: 0.3, envMapIntensity: 1.3, emissive: 0x8a3414, emissiveIntensity: 1.5 });
    // audit r14 spawn read: 'flat slab + gray fins + orange blob'. The eye
    // needs a CONTINUOUS tapered profile: snout cone -> cheek taper ->
    // body, one tall DORSAL blade mid-back, vertical crescent tail.
    const cheek = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.72, 2.0, 10), smat);
    cheek.rotation.z = Math.PI / 2;
    cheek.position.set(3.6, -0.15, 0);                       // smooth neck between cone tip and body
    shark.add(cheek);
    // fins ride a pale painted steel; audit r14: emissive up one more step
    // so the silhouette reads against the ceiling lights at 30-40 m
    const finMat = new THREE.MeshStandardMaterial({ color: 0xcddbe8, roughness: 0.5, metalness: 0.25, emissive: 0x35516e, emissiveIntensity: 1.9 });
    // audit r13: a box hull reads as 'floating platform with wing plates'
    // from head-on angles — the body is now a tapered streamlined trunk.
    const body = new THREE.Mesh(bodyCyl, smat);
    body.rotation.z = Math.PI / 2;
    body.position.set(0.4, 0, 0);
    body.userData.tag = 'metal';
    body.castShadow = true;
    shark.add(body); rc.push(body);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 8), smat);
    snout.rotation.z = -Math.PI / 2;
    snout.position.set(4.05, -0.1, 0);
    snout.userData.tag = 'metal';
    shark.add(snout); rc.push(snout);
    const dorsal = new THREE.Mesh(cachedBox(1.5, 1.5, 0.16), finMat);
    dorsal.position.set(0.3, 1.85, 0);
    dorsal.rotation.z = -0.4;                           // tall swept DORSAL blade: >=1.2 m cue
    shark.add(dorsal);
    const tailFin = new THREE.Mesh(cachedBox(0.22, 3.9, 1.5), finMat);
    tailFin.position.set(-4.4, 1.15, 0);
    tailFin.rotation.z = 0.32;                           // upper crescent lobe
    shark.add(tailFin);
    // pectoral fins: the horizontal cross-bar a shark silhouette needs
    for (const zs of [1, -1]) {
      const pec = new THREE.Mesh(cachedBox(3.2, 0.2, 2.0), finMat);
      pec.position.set(1.4, -0.9, zs * 2.1);
      pec.rotation.y = zs * 0.55; pec.rotation.z = zs * 0.25;
      shark.add(pec);
    }
    // gill slits: four dark cuts behind the head, both flanks
    for (const zs of [1, -1]) for (let gg = 0; gg < 4; gg++) {
      const gill = new THREE.Mesh(cachedBox(0.09, 1.15, 0.06),
        new THREE.MeshBasicMaterial({ color: 0x0c1219 }));
      gill.position.set(1.9 - gg * 0.45, 0.15, zs * 1.22);
      shark.add(gill);
    }
    const lowerTail = new THREE.Mesh(cachedBox(0.24, 1.7, 1.1), finMat);
    lowerTail.position.set(-4.1, -1.35, 0);
    lowerTail.rotation.z = -0.35;                       // lower lobe: vertical crescent closes
    shark.add(lowerTail);
    // tail peduncle ties the fin into the body (a floating slab read as debris),
    // belly + lower jaw give the side profile a real shark wedge
    const peduncle = new THREE.Mesh(cachedBox(1.9, 0.9, 0.9), smat);
    peduncle.position.set(-3.35, 0.25, 0);
    shark.add(peduncle);
    const belly = new THREE.Mesh(cachedBox(4.0, 1.0, 1.9), smat);
    belly.position.set(-0.2, -1.45, 0);
    belly.userData.tag = 'metal';
    shark.add(belly); rc.push(belly);
    const jaw = new THREE.Mesh(cachedBox(2.2, 0.5, 1.4), finMat);
    jaw.position.set(3.1, -1.15, 0);
    jaw.rotation.z = 0.12;
    shark.add(jaw);
    for (const side of [1, -1]) {
      const pec = new THREE.Mesh(cachedBox(1.6, 0.14, 1.7), finMat);
      pec.position.set(1.2, -0.3, side * 1.7);
      pec.rotation.y = side * 0.5;
      shark.add(pec);
      // red eye lights + jaw tooth strip
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3040, emissiveIntensity: 4.6 }));
      eye.position.set(3.1, 0.45, side * 0.85);
      shark.add(eye);
      // additive red halo: the eye must read at 30 m, not just close-up
      const egl = new THREE.Mesh(new THREE.SphereGeometry(0.46, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.62,
          blending: THREE.AdditiveBlending, depthWrite: false }));
      egl.scale.set(1.9, 1.9, 1.9);
      egl.position.set(3.22, 0.52, side * 0.97);
      shark.add(egl);
      const teeth = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.4, 5),
        new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.3 }), 6);
      for (let ti = 0; ti < 6; ti++) {
        q.identity();
        mtx.compose(v.set(2.2 + ti * 0.34, -1.05, side * (0.35 + ti * 0.09)), q,
          s.set(1, ti % 2 ? 1 : 1.4, 1));
        teeth.setMatrixAt(ti, mtx);
      }
      teeth.instanceMatrix.needsUpdate = true;
      shark.add(teeth);
    }
    // spine + keel ridge and WIDE cyan flank panels: side views read a
    // ridged body, never a plain black bar
    // (audit r3: 0.8 m tall flank panels at LED 3.0 bloomed the whole shark
    // into a glowing crate — stripes, not light-panels)
    const spine = new THREE.Mesh(cachedBox(4.8, 0.3, 0.62), MAT.led(0x00e5ff, 1.0));
    spine.position.set(-0.5, 1.5, 0);
    shark.add(spine);
    // audit r11: four flank stripes + keel read as 'stacked shelves' from
    // aft angles — one waterline stripe per flank, keel and upper stripe out
    // audit r14: strip one emissive step up so the outline cuts the murk
    for (const fside of [1, -1]) {
      const flank = new THREE.Mesh(cachedBox(4.2, 0.16, 0.08), MAT.led(0x00e5ff, 1.9));
      flank.position.set(-0.3, -0.35, fside * 1.27);
      shark.add(flank);
    }
    for (const gy of [0.3, -0.3]) {
      const gill = new THREE.Mesh(cachedBox(0.05, 1.0, 0.06), MAT.led(0x7d5cff, 1.5));
      gill.position.set(-1.4, gy, 1.22);
      shark.add(gill);
    }
    shark.position.set(cx, 9.0, cz);   // clears the lid even with the raised dorsal
    core.add(shark);
    // the marked-orb warning ring (hidden until the shark picks prey)
    const markRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 44),
      new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    markRing.rotation.x = Math.PI / 2;
    markRing.visible = false;
    core.add(markRing);
    const SH = { phase: 'patrol', t: 0, huntIn: 45, orb: -1, prev: new THREE.Vector3(cx, 9.0, cz), pitch: 0 };
    this.updaters.push((dt) => {
      SH.t += dt;
      const o = SH.orb >= 0 ? this.orbs[SH.orb] : null;
      let px, py, pz;
      if (SH.phase === 'patrol') {
        // audit r14: patrol raised to y 7.5-8.2 — above the orb cluster
        // midline so the beast silhouettes against the ceiling light bars
        // (lid at 13, dorsal top stays under it even at bob peak).
        const PP = [[204, 8.6, 40.5], [214, 8.5, 45], [196, 8.7, 52], [192, 8.8, 58], [228, 8.4, 58]];
        const cyc = 45, legT = cyc / PP.length, seg = Math.floor((SH.t % cyc) / legT);
        const k = (SH.t % cyc - seg * legT) / legT;
        const PA = PP[seg], PB = PP[(seg + 1) % PP.length];
        px = PA[0] + (PB[0] - PA[0]) * k; pz = PA[2] + (PB[2] - PA[2]) * k;
        py = PA[1] + (PB[1] - PA[1]) * k + Math.sin(SH.t * 0.9) * 0.35;
        if (SH.huntIn > 0) {
          SH.huntIn -= dt;
          if (SH.huntIn <= 0 && this.orbs.length) {
            let pick = Math.floor(Math.random() * this.orbs.length);
            if (pick === SH.orb) pick = (pick + 1) % this.orbs.length;
            SH.orb = pick; SH.phase = 'circle'; SH.t = 0;
            markRing.visible = true;
          }
        }
      } else if (o && SH.phase === 'circle') {
        const a = SH.t * 1.1;
        const rr = o.r + 4.5;
        px = o.x + Math.cos(a) * rr; pz = o.z + Math.sin(a) * rr;
        // stay under the lid: dorsal top clears 13 m even bobbing
        py = Math.min(o.y + 2.2, 8.9) + Math.sin(SH.t * 1.6) * 0.4;
        if (SH.t > 6.4) { SH.phase = 'dive'; SH.t = 0; }
      } else if (o && SH.phase === 'dive') {
        if (SH.t < 1.1) {                       // straight nose-dive from wherever the circling left off
          const k = SH.t / 1.1;
          px = SH.prev.x + (o.x - SH.prev.x) * Math.min(1, k * 1.3);
          pz = SH.prev.z + (o.z - SH.prev.z) * Math.min(1, k * 1.3);
          py = SH.prev.y + (o.y - SH.prev.y) * Math.min(1, k * 1.3);
        } else if (SH.t < 2.2) {                // lunge clean through it
          const k = (SH.t - 1.1) / 1.1;
          const dirx = Math.cos(o.x * 7), dirz = Math.sin(o.x * 7);
          px = o.x + dirx * (k - 0.5) * (o.r + 5);
          pz = o.z + dirz * (k - 0.5) * (o.r + 5);
          py = o.y + 0.5 * Math.sin(k * Math.PI);
        } else {                                // climb back to the circuit
          const k = Math.min(1, (SH.t - 2.2) / 2.0);
          px = o.x + Math.cos(o.x * 7) * (o.r + 5) * (1 - k);
          pz = o.z + Math.sin(o.x * 7) * (o.r + 5) * (1 - k);
          py = o.y + (6.0 - o.y) * k;
          if (SH.t > 4.4) { SH.phase = 'patrol'; SH.t = 0; SH.huntIn = 20 + rand(0, 5); SH.orb = -1; markRing.visible = false; }
        }
      } else { SH.phase = 'patrol'; SH.orb = -1; markRing.visible = false; return; }
      const dx = px - SH.prev.x, dz = pz - SH.prev.z;
      if (Math.hypot(dx, dz) > 0.01) shark.rotation.y = Math.atan2(-dz, dx);
      SH.pitch = damp3(SH.pitch, SH.phase === 'dive' ? -0.35 : 0, dt);
      shark.rotation.z = SH.pitch + Math.sin(SH.t * 1.7) * 0.05;
      shark.position.set(px, py, pz);
      SH.prev.set(px, py, pz);
      if (o) {
        markRing.position.set(o.x, o.y, o.z);
        markRing.scale.setScalar(o.r + 0.6 + Math.sin(SH.t * 5) * 0.25);
        markRing.material.opacity = 0.5 + 0.35 * Math.sin(SH.t * 6);
      }
      // the swallow window: inside the marked orb while it's diving
      if (SH.phase === 'dive' && o && this._wctx?.feet) {
        const f = this._wctx.feet;
        const d2 = (f.x - o.x) ** 2 + (f.y + 0.9 - o.y) ** 2 + (f.z - o.z) ** 2;
        if (d2 < 16) {
          this._wctx.damage(40);
          this._wctx.flash();
          this._wctx.shake(0.045);
          this._wctx.audio.play('land', { volume: 1.0, rate: 0.45 });
          this.p.sparkBurst(o.x, o.y, o.z, 0, 1, 0, 24);
          this._wctx.respawnPlayer();
          SH.phase = 'patrol'; SH.t = 0; SH.huntIn = 20 + rand(0, 5); SH.orb = -1;
          markRing.visible = false;
        }
      }
    });

    const l1 = new THREE.PointLight(0x39c8e8, 34, 46, 2); l1.position.set(200, 6, 38); scene.add(l1);
    const l2 = new THREE.PointLight(0xff2b9d, 26, 42, 2); l2.position.set(220, 6, 60); scene.add(l2);
    const l3 = new THREE.PointLight(0x22ffd0, 24, 44, 2); l3.position.set(cx, 11, cz); scene.add(l3);
    // cool top light over the megalodon circuit so the beast is lit mid-air
    // as it circles, instead of a black box against a black ceiling
    const l4 = new THREE.PointLight(0x66d8ff, 90, 50, 2); l4.position.set(cx, 12.4, cz); scene.add(l4);
    // dim wall washes parked near each SPAWN anchor, aimed at the four
    // walls: every anchor view keeps the hall shell lit in frame
    for (const [wx, wz] of [[182.3, 30], [182.3, 60], [229.7, 30], [229.7, 60], [200, 22.3], [212, 69.7], [228, 46.5]]) {
      const w = new THREE.PointLight(0x39c8e8, 34, 26, 2); w.position.set(wx, 3.0, wz); scene.add(w);
    }
    // mid-wall floods straight down the two long sightlines from the corner anchors
    const wf1 = new THREE.PointLight(0x2fa8c8, 36, 46, 2); wf1.position.set(228, 6, 46); scene.add(wf1);
    const wf2 = new THREE.PointLight(0x2fa8c8, 36, 46, 2); wf2.position.set(184, 6, 46); scene.add(wf2);

    SPAWN_POOLS.aquarium = [
      { pos: [188, 24], wps: [[188, 24], [196, 26], [190, 30]] },
      { pos: [226, 26], wps: [[226, 26], [218, 28], [224, 32]] },
      { pos: [188, 66], wps: [[188, 66], [196, 64], [190, 60]] },
      { pos: [226, 68], wps: [[226, 68], [218, 66], [224, 62]] },
      { pos: [184, 54], wps: [[184, 54], [190, 50], [184, 60]] },
      { pos: [228, 46], wps: [[228, 46], [222, 42], [226, 38]] },
      { pos: [206, 68], wps: [[206, 68], [212, 64], [200, 64]] },
    ];
  }

  // ============ MISSION 15 · 歯車の煉獄 · clockwork purgatory ============

  // moremaps2 §6: no sky at all — wall gears floor-to-ceiling on all
  // four sides, a floor of three big spinning gears carrying you with
  // matched rim speeds, lethal mesh points, two r13 stadium gears
  // carrying gothic cities on their backs, and manhole gears for
  // jump plates. Transmission: |omega*r| = V on every meshed pair,
  // alternating sign (parent-driven spin, hierarchies per gear).
  _clockwork() {
    const G = this._g('clockwork');
    const { scene, world, raycastMeshes: rc } = this;
    const X0 = 180, X1 = 232, Z0 = -60, Z1 = -8;
    this.bounds.clockwork = { x0: X0, x1: X1, z0: Z0, z1: Z1 };
    this._grid('clockwork', { x0: X0, z0: Z0, x1: X1, z1: Z1 }, 17);
    const core = this._core('clockwork');
    const cell = (x, z) => this._cell('clockwork', x, z);
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const mtx = new THREE.Matrix4(); const q = new THREE.Quaternion();
    const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const V = 0.9;                              // shared rim speed, m/s

    const plateMat = new THREE.MeshStandardMaterial({ color: 0x3a2f1e, roughness: 0.6, metalness: 0.5 });
    floor(core, rc, { w: X1 - X0, d: Z1 - Z0, x: cx, z: cz, mat: plateMat, y: 0.011 });
    addBox(core, { w: X1 - X0, h: 0.5, d: Z1 - Z0, mat: plateMat, x: cx, y: -0.25, z: cz, collide: world, raycast: rc, tag: 'metal' });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a2c18, roughness: 0.7, metalness: 0.45, emissive: 0x2a1a08, emissiveIntensity: 1.0 });
    walls(core, world, rc, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: 22, mat: wallMat });
    // the lid: brass-dark ceiling — there is no sky here, ever. Ribs across
    // it so the eye finds a sealed roof at 22 m instead of black void.
    addBox(core, { w: X1 - X0 + 2, h: 1, d: Z1 - Z0 + 2, mat: new THREE.MeshStandardMaterial({ color: 0x2e2210, roughness: 0.8, metalness: 0.3, emissive: 0x241404, emissiveIntensity: 0.9 }), x: cx, y: 22.5, z: cz, cast: false, raycast: rc, tag: 'metal' });
    const lidRibs = new THREE.InstancedMesh(cachedBox(1, 0.8, 0.6), new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.5, metalness: 0.8 }), 5);
    for (let ri2 = 0; ri2 < 5; ri2++) {
      mtx.compose(v.set(cx, 21.6, Z0 + 6 + ri2 * (Z1 - Z0 - 12) / 4), q.identity(), s.set((X1 - X0 - 2) / 1, 1, 1));
      lidRibs.setMatrixAt(ri2, mtx);
    }
    lidRibs.instanceMatrix.needsUpdate = true;
    core.add(lidRibs);

    // dusk env is dim, so keep metalness moderate + warm emissive or the
    // brass reads black (all other worlds ride envMapIntensity ~1.2-1.9)
    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6528, roughness: 0.4, metalness: 0.55, envMapIntensity: 1.5, emissive: 0x38220a, emissiveIntensity: 0.9 });
    const brass2 = new THREE.MeshStandardMaterial({ color: 0xdcaf5e, roughness: 0.36, metalness: 0.6, envMapIntensity: 1.5, emissive: 0x5a3810, emissiveIntensity: 1.0 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.5, metalness: 0.8 });

    // flat gear builder: disc + instanced teeth + spokes; caller spins
    // the returned group (or a child) in an updater
    // audit: thin discs + low teeth read as flat brown cutouts — the rim
    // band is a solid >=1.2 m proud of the disc, spokes are square-section
    // >=0.5 m bars, and every gear gets a visible hub drum.
    const gearDisc = (r, thick, mat) => {
      const grp = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, thick, 30), mat);
      disc.receiveShadow = true;
      disc.userData.tag = 'metal';
      grp.add(disc); rc.push(disc);
      const teeth = Math.max(12, Math.round((2 * Math.PI * r) / 1.7));
      const rimH = Math.max(1.6, thick);
      const ring = new THREE.InstancedMesh(cachedBox(1.35, rimH, 1.6), brass2, teeth);
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        q.identity();
        e.set(0, a, 0); q.setFromEuler(e);
        mtx.compose(v.set(Math.cos(a) * r, 0, Math.sin(a) * r), q, s.set(1, 1, 1));
        ring.setMatrixAt(i, mtx);
      }
      ring.instanceMatrix.needsUpdate = true;
      grp.add(ring);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.55, r * 0.16), Math.max(0.55, r * 0.16), thick + 1.0, 14), brass2);
      hub.position.y = thick / 2 + 0.2;
      grp.add(hub);
      const spokes = Math.max(3, Math.round(r / 3));
      for (let k = 0; k < spokes; k++) {
        const sh = Math.max(0.55, thick * 0.5);
        const spoke = new THREE.Mesh(cachedBox(r * 1.7, sh, 0.62), iron);
        // audit r7: spokes were placed at thick*0.35 — INSIDE the disc, so
        // every gear read as a flat cutout. They stand proud of the face now.
        spoke.position.y = thick / 2 + sh / 2 + 0.06;
        spoke.rotation.y = (k / spokes) * Math.PI;
        grp.add(spoke);
      }
      return grp;
    };
    // wall gear with real depth: 1.5 m extruded disc + raised face spokes
    // on the hall side — the old 0.9 m disc read as a decal (hub comes from
    // gearDisc now)
    const deepWallGear = (r) => {
      const grp = gearDisc(r, 1.5, brass);
      for (let k = 0; k < 3; k++) {
        const bar = new THREE.Mesh(cachedBox(r * 1.9, 0.55, 0.85), brass2);
        bar.position.y = 1.35;
        bar.rotation.y = k * Math.PI / 3;
        grp.add(bar);
      }
      return grp;
    };
    // circle-faithful static AABB for a spinning floor disc (cross + square)
    const discColliders = (gx, gz, r, top) => {
      for (const [hx, hz] of [[r, r * 0.55], [r * 0.55, r], [r * 0.82, r * 0.82]])
        world.addBox(new THREE.Vector3(gx - hx, -0.5, gz - hz), new THREE.Vector3(gx + hx, top, gz + hz));
    };

    // ---- FLOOR GEARS: three big discs that actually carry the player.
    // G2/G3 mesh G1 (19 m center distance, r 11+9 / 11+8) so the teeth
    // visibly interpenetrate at the mesh points — and kill you there.
    const spinners = [];
    const floorGear = (gx, gz, r, sign, boost = 0) => {
      const grp = new THREE.Group();
      grp.position.set(gx, 0.1, gz);
      grp.add(gearDisc(r, 0.5, brass));
      // audit r14: floor gear teeth sat flush and read as tan cut cubes from
      // the anchors. A boosted tooth ring stands 1.5 m proud of the rim on
      // the two gears nearest the anchor sight lines, so every bite throws
      // real relief + shadow.
      if (boost) {
        const bt = Math.max(12, Math.round((2 * Math.PI * r) / 1.7));
        const ring = new THREE.InstancedMesh(cachedBox(1.6, 1.0, 0.8), brass2, bt);
        for (let i = 0; i < bt; i++) {
          const a = (i / bt) * Math.PI * 2;
          e.set(0, a, 0); q.setFromEuler(e);
          mtx.compose(v.set(Math.cos(a) * (r + 0.15), 0.85, Math.sin(a) * (r + 0.15)), q, s.set(1, 1, 1));
          ring.setMatrixAt(i, mtx);
        }
        ring.instanceMatrix.needsUpdate = true;
        grp.add(ring);
      }
      G.add(grp);
      const omega = sign * V / r;
      discColliders(gx, gz, r, 0.35);
      this.gearSpin.push({ x: gx, z: gz, top: 0.35, r, omega });
      spinners.push({ grp, omega });
      return grp;
    };
    floorGear(cx, cz - 2, 11, +1, 1);                   // master wheel
    floorGear(cx - 15.2, cz - 14, 9, -1, 1);            // meshed pair 1
    floorGear(cx + 15.9, cz + 10.5, 8, -1);             // meshed pair 2 (teeth overlap by design)
    // lethal mesh points + spark fixtures that flicker where teeth bite
    const gapDark = new THREE.MeshStandardMaterial({ color: 0x120d07, roughness: 0.9, metalness: 0.25 });
    for (const [ax, az, bx, bz, ra, rb] of [
      [cx, cz - 2, cx - 15.2, cz - 14, 11, 9],
      [cx, cz - 2, cx + 15.9, cz + 10.5, 11, 8],
    ]) {
      const mx = ax + (bx - ax) * ra / (ra + rb), mz = az + (bz - az) * ra / (ra + rb);
      this.hazards.push({ x: mx, z: mz, y: 0.35, r: 1.2, dmg: 85 });
      const sl = new THREE.PointLight(0xffa840, 26, 13, 2); sl.position.set(mx, 1.5, mz); scene.add(sl);
      const bbulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), MAT.led(0xffa840, 1.3));
      bbulb.position.set(mx, 0.95, mz);
      core.add(bbulb);
      spinners.push({ light: sl, ph: rand(0, 6), mx, mz, sparkT: rand(0, 1) });
      // the bite: dark gap plate under the mesh + instanced teeth cluster
      // overlapping across the seam so the mesh point reads as machinery
      const sA = Math.atan2(bz - az, bx - ax), ux = Math.cos(sA), uz = Math.sin(sA);
      addBox(cell(mx, mz), { w: 2.6, h: 0.55, d: 2.4, mat: gapDark, x: mx, y: 0.275, z: mz,
        rotY: sA + Math.PI / 2, collide: world, raycast: rc, tag: 'metal' });
      const bite = new THREE.InstancedMesh(cachedBox(0.7, 0.5, 0.55), brass2, 12);
      for (let ti2 = 0; ti2 < 12; ti2++) {
        const t = -1.1 + ti2 * 0.2, o = ti2 % 2 ? 0.5 : -0.5;
        e.set(0, sA + (ti2 % 2 ? 0.6 : -0.6), 0); q.setFromEuler(e);
        mtx.compose(v.set(mx + ux * t - uz * o, 0.8, mz + uz * t + ux * o), q, s.set(1, 1, 1));
        bite.setMatrixAt(ti2, mtx);
      }
      bite.instanceMatrix.needsUpdate = true;
      core.add(bite);
      // audit r14: live spark field at the hero floor bite (the one on the
      // anchor sight line) — the mesh must prove itself in a still frame
      const fsp = pointField(26, mx - 1.2, mx + 1.2, 0.3, 1.9, mz - 1.2, mz + 1.2,
        { size: 0.42, color: 0xffc060, fall: -0.4, drift: 0.8, seed: 91 + this.hazards.length });
      core.add(fsp.pts);
      this.updaters.push((dt) => { fsp.mat.uniforms.uT.value += dt; });
    }

    // ---- audit r7: nothing stood in the spawn sight line — every gear was
    // either a floor plate or a wall decal. One VERTICAL hero pair on the
    // east wall, face to the hall: big wheel r8 meshing a r5 pinion on a
    // diagonal, teeth interpenetrating ~0.3 m, sparks + bulb at the bite.
    const vBig = gearDisc(8, 2.5, brass);
    const vPin = gearDisc(5, 2.5, brass2);
    vBig.rotation.z = Math.PI / 2;                  // disc faces point -X, at the hall
    vPin.rotation.z = Math.PI / 2;
    // audit r9: face-on view hid the thickness, so the pair read flat.
    // A stacked inner disc toward the hall + a stub axle into the wall
    // give the wheels real layer depth and mechanical logic.
    for (const [g2, r2, om] of [[vBig, 8, 1], [vPin, 5, 1]]) {
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(r2 * 0.62, r2 * 0.62, 1.4, 24), brass2);
      inner.position.y = 2.05;
      inner.userData.tag = 'metal'; g2.add(inner); rc.push(inner);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.6, 10), iron);
      axle.position.y = -1.6;
      g2.add(axle);
    }
    const vOuter = new THREE.Group();
    vOuter.position.set(226.5, 9, -30);
    vOuter.add(vBig);
    const vOuter2 = new THREE.Group();
    vOuter2.position.set(226.5, 4.5, -42.9);        // 13.7 m centre distance: discs clear, teeth bite
    vOuter2.add(vPin);
    core.add(vOuter); core.add(vOuter2);
    spinners.push({ disc: vBig, omega: V / 8 }, { disc: vPin, omega: -V / 5 });
    const vBite = { x: 226.5, y: 6.2, z: -37.9 };   // along the 8+5 centre line
    const vBulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), MAT.led(0xffa840, 0.9));
    vBulb.position.set(vBite.x - 2.4, vBite.y, vBite.z);
    core.add(vBulb);
    const vSpark = new THREE.PointLight(0xffa840, 20, 20, 2);
    vSpark.position.set(vBite.x - 3.0, vBite.y, vBite.z); scene.add(vSpark);
    spinners.push({ light: vSpark, ph: 1.3, mx: vBite.x - 1.0, my: vBite.y, mz: vBite.z, sparkT: 0.4 });
    // permanent tooth cluster straddling the seam: the mesh reads in a
    // still frame, not only when a spark happens to fire
    // (audit r11: the cluster sat at disc-slab x — INSIDE the discs; now
    // strapped to the hall-facing surfaces where cameras actually see it)
    const nY = -0.329, nZ = -0.944, tY = 0.944, tZ = -0.329;
    const vBiteIM = new THREE.InstancedMesh(cachedBox(1.1, 0.9, 0.9), brass2, 8);
    for (let ti3 = 0; ti3 < 8; ti3++) {
      const tt = -1.75 + ti3 * 0.5, off = (ti3 % 2 ? 0.5 : -0.5);
      mtx.compose(v.set(vBite.x - 2.0, vBite.y + tt * tY + off * nY, vBite.z + tt * tZ + off * nZ),
        q.identity(), s.set(1, 1, 1));
      vBiteIM.setMatrixAt(ti3, mtx);
    }
    vBiteIM.instanceMatrix.needsUpdate = true;
    core.add(vBiteIM);

    // ---- STADIUM GEARS (r 13): west-wall half-disc + SE-corner quarter,
    // each carrying a ring of gothic spires as CHILD nodes so the whole
    // town orbits. Fenced off — the city rides the gear, you watch it.
    const stadium = (gx, gz, sign) => {
      const grp = new THREE.Group();
      grp.position.set(gx, 4.2, gz);          // audit: lifted so the toothed disc EDGE
      // reads under the town from ground anchors — edge-on at y 0.75 it
      // looked like a flat floating platform, not a stadium GEAR
      grp.add(gearDisc(13, 1.6, brass));
      const city = new THREE.Group();
      const gothMat = new THREE.MeshStandardMaterial({ color: 0x3c2c1a, roughness: 0.85, metalness: 0.25, emissive: 0x3a2410, emissiveIntensity: 0.55 }); // dark warm stone: reads gothic, not tan foam under the lamps
      // audit: the town read as a thimble silhouette floating in haze —
      // bodies/spires ~2x, ring-wall bowl on the gear rim, deck lanterns,
      // everything grounded on the gear deck.
      const NB = 6;
      // audit r14: town x1.5 so the gothic city reads as a skyline riding
      // the gear, not thimble cubes. Bodies/spires live in a scaled subgroup
      // (rr pulled in so everything stays inside the 12.4 m bowl wall).
      const town = new THREE.Group();
      town.scale.setScalar(1.5);
      city.add(town);
      const bodies = new THREE.InstancedMesh(cachedBox(1, 1, 1), gothMat, NB);
      const spires = new THREE.InstancedMesh(new THREE.ConeGeometry(0.85, 4.0, 6), gothMat, NB);
      // warm beacons on the spire tips: hot points sell the town at 40 m
      const tips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 5), MAT.led(0xffc884, 1.2), NB);
      tips.castShadow = false; tips.tag = 'glass'; tips.raycast = () => {};
      const tipPos = [];
      const butt = new THREE.InstancedMesh(cachedBox(1, 1, 1), gothMat, NB * 2);
      for (let i = 0; i < NB; i++) {
        const a = (i / NB) * Math.PI * 2 + gx * 0.3;
        const rr = 3 + (i % 3) * 2.1;
        const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr;
        const h = rand(6, 10), w = rand(1.8, 2.8);
        q.identity(); e.set(0, a, 0); q.setFromEuler(e);
        mtx.compose(v.set(bx, 0.5 + h / 2, bz), q, s.set(w, h, w)); bodies.setMatrixAt(i, mtx);
        mtx.compose(v.set(bx, 0.5 + h + 2.0, bz), q, s.set(1, rand(0.8, 1.3), 1)); spires.setMatrixAt(i, mtx);
        tipPos.push([bx, 0.5 + h + 4.2, bz]);
        for (const side of [1, -1]) {
          e.set(0, a, side * 0.5); q.setFromEuler(e);
          mtx.compose(v.set(bx + side * w * 0.62, 0.5 + h * 0.32, bz), q, s.set(0.55, h * 0.66, 0.7));
          butt.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), mtx);
        }
      }
      tipPos.forEach((tp, i) => { mtx.compose(v.set(tp[0], tp[1], tp[2]), q.identity(), s.set(1, 1, 1)); tips.setMatrixAt(i, mtx); });
      for (const im of [bodies, spires, butt, tips]) { im.instanceMatrix.needsUpdate = true; town.add(im); }
      // 2 m ring-wall bowl hugging the gear rim + deck lanterns on it:
      // the gear reads as a CONTAINED stadium deck, the town sits inside
      const SEG = 18, bowlR = 12.4, segLen = 2 * Math.PI * bowlR / SEG + 0.25;
      const bowl = new THREE.InstancedMesh(cachedBox(1, 1, 1), gothMat, SEG);
      const lampIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 5), MAT.led(0xffc884, 0.8), 8);
      lampIM.castShadow = false; lampIM.tag = 'glass'; lampIM.raycast = () => {};
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        e.set(0, -(a + Math.PI / 2), 0); q.setFromEuler(e);
        mtx.compose(v.set(Math.cos(a) * bowlR, 1.8, Math.sin(a) * bowlR), q, s.set(segLen, 2, 0.8));
        bowl.setMatrixAt(i, mtx);
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.3;
        mtx.compose(v.set(Math.cos(a) * bowlR, 3.1, Math.sin(a) * bowlR), q.identity(), s.set(1, 1, 1));
        lampIM.setMatrixAt(i, mtx);
      }
      bowl.instanceMatrix.needsUpdate = true; lampIM.instanceMatrix.needsUpdate = true;
      city.add(bowl); city.add(lampIM);
      // audit r14: two big ring-deck lamps at opposite ends of the rim —
      // from the anchors the stadium gear carries its own floodlights.
      const deckLampMat = MAT.led(0xffd894, 2.0);
      for (const dl of [0.3, Math.PI + 0.3]) {
        const dLamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), deckLampMat);
        dLamp.position.set(Math.cos(dl) * bowlR, 3.9, Math.sin(dl) * bowlR);
        dLamp.castShadow = false;
        city.add(dLamp);
        const post = new THREE.Mesh(cachedBox(0.18, 1.4, 0.18), iron);
        post.position.set(Math.cos(dl) * bowlR, 3.1, Math.sin(dl) * bowlR);
        city.add(post);
      }
      // audit r8: the deck read as 'stepped platform', not a cog. A visible
      // TOOTH SKIRT below the bowl wall: 26 proud teeth ring the whole town.
      const skirt = new THREE.InstancedMesh(cachedBox(1, 1, 1), brass2, 26);
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        e.set(0, -(a + Math.PI / 2), 0); q.setFromEuler(e);
        mtx.compose(v.set(Math.cos(a) * 13.9, 1.15, Math.sin(a) * 13.9), q, s.set(1.5, 1.7, 1.5));
        skirt.setMatrixAt(i, mtx);
      }
      skirt.instanceMatrix.needsUpdate = true;
      city.add(skirt);
      // hot ring under the deck edge: at distance the CIRCLE of the stadium
      // gear reads as a gear, not a platform
      const rimGlow = new THREE.Mesh(new THREE.TorusGeometry(13.3, 0.14, 6, 48), MAT.led(0xffa840, 1.1));
      rimGlow.rotation.x = Math.PI / 2;
      rimGlow.position.y = -0.9;
      grp.add(rimGlow);
      grp.add(city);
      G.add(grp);
      spinners.push({ grp, omega: sign * V / 13 });
      // fence the ride out: a 12-gon ring of low brass rails (honest AABBs)
      const L = 2 * 13.4 * Math.tan(Math.PI / 12) + 0.4;
      for (let i = 0; i < 12; i++) {
        const th = (i / 12) * Math.PI * 2;
        const rotY = th - Math.PI / 2;
        const px = gx + Math.cos(th) * 13.7, pz = gz + Math.sin(th) * 13.7;
        addBox(cell(px, pz), { w: L, h: 1.1, d: 0.5, mat: iron, x: px, y: 0.55, z: pz, rotY, cast: false, raycast: rc, tag: 'metal' });
        const ca = Math.abs(Math.cos(rotY)), sa = Math.abs(Math.sin(rotY));
        const hx = (L * ca + 0.5 * sa) / 2, hz = (L * sa + 0.5 * ca) / 2;
        world.addBox(new THREE.Vector3(px - hx, 0, pz - hz), new THREE.Vector3(px + hx, 1.1, pz + hz));
      }
      // audit: these two blew out the fence/walkway on the right of the
      // anchor-2 frame — dimmed ~50%; the town still lights from its tips.
      // audit r14: dimmed again — the face-mounted glow was erasing the gear
      // form on the right of anchor-1 (blown bulb over the disc face).
      const lamp = new THREE.PointLight(0xffb45a, 16, 44, 2); lamp.position.set(gx + (gx < cx ? 7 : -7), 7.5, gz + (gz < cz ? 7 : -7)); scene.add(lamp);
      const top = new THREE.PointLight(0xffc884, 15, 44, 2); top.position.set(gx, 12, gz); scene.add(top);
    };
    stadium(186, -18, -1);        // NW stadium gear carrying a gothic town
    stadium(230, -56, +1);        // SE-corner gear, half sunk in the walls

    // ---- manhole gears: spinning jump plates at y 1.2-4 (colliders +
    // gearSpin so they drag you round while you snipe from them) ----
    for (const [gx, gz, r, top, sign] of [
      [194, -32, 2.2, 1.6, +1], [207, -47.5, 1.8, 2.4, -1], [214, -46, 2.5, 3.2, +1],
      [202, -13, 2.0, 1.2, -1], [226, -15, 1.6, 4.0, +1], [182.5, -57, 2.4, 2.0, +1],
      [201, -24, 1.5, 3.4, -1], [212, -52, 2.0, 1.6, +1], [203, -50, 1.7, 4.0, -1], [215, -13, 1.8, 2.4, +1],
    ]) {
      const grp = new THREE.Group();
      grp.position.set(gx, top - 0.1, gz);
      grp.add(gearDisc(r, 0.3, brass));
      G.add(grp);
      addBox(cell(gx, gz), { w: r * 1.7, h: 0.3, d: r * 1.7, mat: brass2, x: gx, y: top - 0.15, z: gz, collide: world, raycast: rc, tag: 'metal' });
      const omega = sign * (V + 0.5) / r;
      this.gearSpin.push({ x: gx, z: gz, top, r: r * 0.85, omega });
      spinners.push({ grp, omega });
    }

    // ---- wall-gear backdrops: two per side, floor to ceiling, embedded
    // in the walls — every direction you look, gears turn. Added straight
    // to core (no lodNode: its distance is measured to the chunk origin,
    // which would proxy the whole hall's backdrops from the spawn point).
    // audit: the pairs overlapped at random — the small gear of every pair
    // is now parked TANGENT to the big one (~0.3 m tooth interpenetration)
    // so they mesh as machinery, with sparks + a flicker lamp at the bite.
    // audit r14: small gear of each pair nudged so tooth tips interpenetrate
    // ~0.3 m — a clean visible bite, not a jammed overlap or a shy gap.
    const wallGearPairs = [];
    for (const wx of [X0 + 0.4, X1 - 0.4]) {   // X-side walls: discs stand upright facing along X
      for (const [r, py, pz] of [[11, 10, cz - 10], [6.5, 17, -25.9]]) {
        const grp = new THREE.Group();
        grp.position.set(wx, py, pz);
        grp.rotation.z = wx < cx ? -Math.PI / 2 : Math.PI / 2;
        const disc = deepWallGear(r);
        grp.add(disc);
        core.add(grp);
        spinners.push({ disc, omega: (py > 15 ? -1 : 1) * V / r });
      }
      wallGearPairs.push([wx, 10, cz - 10, 11, 17, -25.9, 6.5]);
    }
    for (const [wz, rxr] of [[Z0 + 0.4, Math.PI / 2], [Z1 - 0.4, -Math.PI / 2]]) {
      for (const [r, py, px] of [[12, 11, cx - 11], [6.5, 19, cx + 6.9]]) {
        const grp = new THREE.Group();
        grp.position.set(px, py, wz);
        grp.rotation.x = rxr;
        const disc = deepWallGear(r);
        grp.add(disc);
        core.add(grp);
        spinners.push({ disc, omega: (py > 15 ? 1 : -1) * V / r });
      }
      wallGearPairs.push([wz, 11, cx - 11, 12, 19, cx + 6.9, 6.5, 'z']);
    }
    // spark cluster + flickering fixture parked exactly at each tooth bite
    for (const p of wallGearPairs) {
      const [w, ay, az, ra, by, bz, rb, isZ] = p;
      const d = Math.hypot(by - ay, bz - az);
      const k = ra / d;
      const cy = ay + (by - ay) * k, cc = az + (bz - az) * k;
      const cxp = isZ ? cc : w, czp = isZ ? w : cc;
      const off = isZ ? (w > cz ? -1.4 : 1.4) : (w < cx ? 1.4 : -1.4);
      const lx = isZ ? cxp : cxp + off, lz = isZ ? czp + off : czp;
      const sl = new THREE.PointLight(0xffa840, 14, 24, 2); sl.position.set(lx, cy + 0.6, lz); scene.add(sl);
      // hot bulb at the bite: the spark glow must be readable at 40 m,
      // not only 26 sub-pixel points at 1 m. audit r14: 2.8 blew out the
      // gear face it sits on — a lamp, not a star.
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), MAT.led(0xffa840, 0.8));
      bulb.position.set(lx, cy + 0.1, lz);
      core.add(bulb);
      spinners.push({ light: sl, ph: rand(0, 6), mx: lx, mz: lz, my: cy, sparkT: rand(0, 1) });
      const sp = pointField(26, lx - 0.9, lx + 0.9, cy - 0.6, cy + 1.6, lz - 0.9, lz + 0.9,
        { size: 0.38, color: 0xffc060, fall: -0.5, drift: 0.7, seed: 31 + wallGearPairs.indexOf(p) });
      core.add(sp.pts);
      this.updaters.push((dt) => { sp.mat.uniforms.uT.value += dt; });
    }

    // ---- pendulum + escapement arm crossing the hall: one toothed wheel
    // ticks (wheel face turned to the hall), the long arm below it swings
    // slow over the master wheel, glowing bob for readability in the dusk ----
    const pivot = new THREE.Group();
    pivot.position.set(cx, 20.6, cz - 2);
    const escWheel = gearDisc(2.2, 0.35, iron);
    escWheel.rotation.x = Math.PI / 2;
    pivot.add(escWheel);
    const arm = new THREE.Group();
    const armMesh = new THREE.Mesh(cachedBox(0.7, 14, 0.7), iron);
    armMesh.position.y = -7;
    armMesh.userData.tag = 'metal';
    arm.add(armMesh); rc.push(armMesh);
    const bob = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xb8863a, roughness: 0.3, metalness: 0.4, emissive: 0xff9c3a, emissiveIntensity: 0.45 }));
    bob.position.y = -14.2;
    bob.userData.tag = 'metal';
    arm.add(bob); rc.push(bob);
    pivot.add(arm);
    core.add(pivot);
    let escTick = 0;

    // ---- brass dust in the eternal dusk + the turning world itself ----
    // audit: big soft dust points read as random bokeh — capped small so
    // they're fine brass motes, not fog blobs
    const dust = pointField(140, X0 + 2, X1 - 2, 0.5, 12, Z0 + 2, Z1 - 2,
      { size: 0.5, color: 0xffd67a, fall: -0.35, drift: 1.6, seed: 9 });
    core.add(dust.pts);
    const l1 = new THREE.PointLight(0xffb45a, 64, 62, 2); l1.position.set(cx, 9, cz); scene.add(l1);
    // key light parked on the vertical hero pair: it is the spawn's focal
    // silhouette and must not be an unlit silhouette (audit r8)
    const lHero = new THREE.PointLight(0xffb45a, 48, 34, 2); lHero.position.set(220, 8, -36); scene.add(lHero);
    // brass floor strips: the dead hall floor gets scale + a walking grid
    const floorStrips = new THREE.InstancedMesh(cachedBox(0.16, 0.05, 1), MAT.led(0x8a5a20, 0.5), 20);
    let fs = 0;
    for (let fx = X0 + 6; fx <= X1 - 6 && fs < 20; fx += 8) {
      mtx.compose(v.set(fx, 0.04, cz), q.identity(), s.set(1, 1, (Z1 - Z0 - 6)));
      floorStrips.setMatrixAt(fs++, mtx);
    }
    floorStrips.count = fs; floorStrips.instanceMatrix.needsUpdate = true;
    core.add(floorStrips);
    // fills parked right on the gear faces (inverse-square falloff is
    // brutal: a fill mid-hall leaves the wall discs as void silhouettes)
    const fN = new THREE.PointLight(0xffa850, 38, 32, 2); fN.position.set(cx - 11, 11, Z1 - 3); scene.add(fN);
    const fS = new THREE.PointLight(0xffa850, 38, 32, 2); fS.position.set(cx - 11, 11, Z0 + 3); scene.add(fS);
    const fW = new THREE.PointLight(0xffa850, 38, 32, 2); fW.position.set(X0 + 3, 10, cz - 10); scene.add(fW);
    const fE = new THREE.PointLight(0xffa850, 26, 30, 2); fE.position.set(X1 - 3, 12, cz + 10); scene.add(fE);

    this.updaters.push((dt) => {
      dust.mat.uniforms.uT.value += dt;
      for (const sp of spinners) {
        if (sp.grp) sp.grp.rotation.y += sp.omega * dt;
        if (sp.disc) sp.disc.rotation.y += sp.omega * dt;
        if (sp.light) {
          const t = performance.now() / 1000;
          sp.light.intensity = 10 + Math.max(0, Math.sin(t * 9 + sp.ph)) * 16 + Math.random() * 6;
          sp.sparkT -= dt;
          if (sp.sparkT <= 0) { this.p.sparkBurst(sp.mx, sp.my ?? 0.6, sp.mz, 0, 1, 0, 9); sp.sparkT = rand(0.5, 1.1); }
        }
      }
      const t = performance.now() / 1000;
      arm.rotation.z = Math.sin(t * 0.55) * 0.5;
      escTick += dt * (1 + Math.max(0, Math.cos(t * 0.55)) * 2.2);
      escWheel.rotation.x = Math.floor(escTick * 2) * (Math.PI * 2 / 16);
    });

    SPAWN_POOLS.clockwork = [
      { pos: [185, -38], wps: [[185, -38], [189, -35], [183, -33]] },
      { pos: [210, -56], wps: [[210, -56], [204, -54], [211, -49]] },
      { pos: [196, -58], wps: [[196, -58], [201, -55], [193, -52]] },
      { pos: [226, -14], wps: [[226, -14], [221, -16], [227, -21]] },
      { pos: [206, -12], wps: [[206, -12], [212, -15], [200, -15]] },
      { pos: [210, -16], wps: [[210, -16], [205, -19], [213, -21]] },
      { pos: [204, -49], wps: [[204, -49], [207, -52], [200, -52]] },
    ];
  }
}

// tiny local damp for the shark pitch (no utils damp import churn)
function damp3(cur, to, dt) { return cur + (to - cur) * Math.min(1, dt * 4); }
