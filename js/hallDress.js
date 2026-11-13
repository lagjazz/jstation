// ============================================================
// hallDress.js — structured cover + set dressing for the concourse
// (MISSION 01) and the boarding platform (MISSION 02).
//
// The original hall was a 52 × 30 m open floor with pencil-thin
// columns: nothing to fight around, so every firefight was a stand-up
// duel. This lays the room out as three west→east lanes separated by
// cover islands (all convex, ≥ 3 m apart — the hostiles steer without
// path-finding):
//
//   z=+14 ──────────── platform edge planters ─────────────────
//          [bench]   ▣col      ▣col      ▣col    ▣col    ▣col
//   north lane                 ▤ planter            ▤ planter
//          ▣ INFO kiosk island (tall)      ║ ticket gates ║
//   south lane   ▤ planter
//          ▣col   ▥ ticket machines  ▣col   ▣col   ▤   [store]
//   z=−16 ─────────────────────────────────────────────────────
//
//   ▣col   every structural column gets a 1.5 m plinth (crouch cover)
//   ▤      planter: 0.95 m concrete trough + shrubs (crouch cover)
//   ▥ ▣    ticket-machine bank / info kiosk: full-height cover
//
// One baked mesh for the solid parts, one for the glow parts, one
// instanced contact-shadow decal layer (the hall has no shadow-casting
// light, so the soft blobs are what grounds everything).
// ============================================================

import * as THREE from 'three';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';

const CONC = { r: 0.9, m: 0.0 };
const STEEL = { r: 0.38, m: 0.8 };
const PAINT = { r: 0.5, m: 0.3 };
const DARK = { r: 0.6, m: 0.4 };

// structural columns (station.js colPositions) → plinths
const COLUMNS = [[-32, -7], [-22, -7], [-12, -7], [-32, 7], [-22, 7], [-12, 7], [-2, 7], [8, 7]];

// planters: [cx, cz, length, alongX]
const PLANTERS = [
  [-30, -1.5, 4.0, true],
  [-16.5, 2.4, 4.0, false],
  [-6.5, 2.2, 4.0, true],
  [-9.2, -11, 3.0, false],
  [4.5, 3.4, 3.6, true],
  // platform side (north of the hall/platform column row)
  [-25, 16, 3.6, true],
  [-12, 15.6, 3.6, true],
  [9, 16, 3.2, true],
];

export class HallDress {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.raycastMeshes = [];
    this.mat = RMMaterial();
    this.glow = GlowMaterial(1.7);
    this._shadows = [];
  }

  _col(x0, z0, x1, z1, h) {
    this.world.addBox(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, h, z1));
  }

  build() {
    const L = new PartList();
    this._plinths(L);
    this._planters(L);
    this._infoKiosk(L, -21, -1);
    this._ticketBank(L, -26.4, -11);
    this._platformKiosk(L, -20, 20.2);
    this._queueRails(L);
    const baked = L.bake();
    const mesh = new THREE.Mesh(baked.geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.tag = 'concrete';
    this.scene.add(mesh);
    this.raycastMeshes.push(mesh);
    if (baked.glowGeo) this.scene.add(new THREE.Mesh(baked.glowGeo, this.glow));
    this._contactShadows();
  }

  _plinths(L) {
    for (const [x, z] of COLUMNS) {
      L.add(G.box(1.5, 1.0, 1.5), 0x8d9096, x, 0.5, z, CONC);
      L.add(G.box(1.58, 0.1, 1.58), 0x3a3f47, x, 1.05, z, DARK);            // steel cap
      L.add(G.box(1.54, 0.12, 1.54), 0x2c3037, x, 0.06, z, DARK);           // kick plate
      // wayfinding band on the column shaft
      L.add(G.cyl(0.47, 0.47, 0.5, 14), 0x1f5fb0, x, 2.6, z, PAINT);
      L.add(G.cyl(0.475, 0.475, 0.05, 14), 0xdfe9ff, x, 2.9, z, { glow: true });
      this._col(x - 0.75, z - 0.75, x + 0.75, z + 0.75, 1.1);
      this._shadows.push([x, z, 2.6, 2.6]);
    }
  }

  _planters(L) {
    const ico = new THREE.IcosahedronGeometry(1, 1);
    let k = 0;
    for (const [cx, cz, len, alongX] of PLANTERS) {
      const w = alongX ? len : 1.2, d = alongX ? 1.2 : len;
      L.add(G.box(w, 0.85, d), 0x9a9c9f, cx, 0.425, cz, CONC);
      L.add(G.box(w + 0.08, 0.1, d + 0.08), 0x6c7076, cx, 0.9, cz, CONC);
      L.add(G.box(w - 0.2, 0.06, d - 0.2), 0x2a2018, cx, 0.94, cz, { r: 1, m: 0 });   // soil
      const n = Math.round(len / 0.75);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const s = 0.34 + ((k * 7) % 5) * 0.035;
        L.add(ico, [0x3f6b34, 0x4d7a3c, 0x356030][k++ % 3], cx + (alongX ? t * (len - 0.5) : 0), 1.16, cz + (alongX ? 0 : t * (len - 0.5)),
          { r: 0.95, m: 0, s: [s * 1.25, s, s * 1.25], rot: [0, k * 1.3, 0] });
      }
      this._col(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 1.0);
      this._shadows.push([cx, cz, w + 1.2, d + 1.2]);
    }
  }

  /** Free-standing information desk: full-height cover in the hall centre. */
  _infoKiosk(L, x, z) {
    const W = 3.6, D = 2.4, H = 2.5;
    L.add(G.box(W, 1.05, D), 0x2f343c, x, 0.525, z, DARK);                      // counter base
    L.add(G.box(W + 0.12, 0.06, D + 0.12), 0xb9bdc4, x, 1.08, z, STEEL);         // counter top
    L.add(G.box(W - 0.9, H - 1.1, D - 0.9), 0x262a31, x, 1.1 + (H - 1.1) / 2, z, DARK);   // core
    L.add(G.box(W + 0.5, 0.22, D + 0.5), 0x1d2026, x, H + 0.11, z, DARK);        // canopy
    L.add(G.box(W + 0.52, 0.06, D + 0.52), 0x35c8ff, x, H - 0.03, z, { glow: true });   // light band
    // screens on the two long faces
    for (const s of [-1, 1]) {
      L.add(G.box(W - 1.3, 0.8, 0.02), 0x1a6fd0, x, 1.75, z + s * ((D - 0.9) / 2 + 0.012), { glow: true });
      L.add(G.box(W - 1.6, 0.1, 0.022), 0xe8f2ff, x, 2.0, z + s * ((D - 0.9) / 2 + 0.014), { glow: true });
      L.add(G.box(1.0, 0.3, 0.03), 0xffffff, x, H + 0.11, z + s * (D / 2 + 0.26), { glow: true });   // "i" sign
    }
    this._col(x - W / 2, z - D / 2, x + W / 2, z + D / 2, H + 0.2);
    this._shadows.push([x, z, W + 2, D + 2]);
  }

  /** Bank of four ticket machines back-to-back with a wall: tall cover. */
  _ticketBank(L, x, z) {
    const W = 4.6, D = 0.9, H = 2.15;
    L.add(G.box(W, H, D), 0x3a4049, x, H / 2, z, DARK);
    L.add(G.box(W + 0.1, 0.12, D + 0.1), 0x23272d, x, H + 0.06, z, DARK);
    for (let i = 0; i < 4; i++) {
      const mx = x - W / 2 + 0.6 + i * 1.13;
      L.add(G.box(0.95, 1.55, 0.06), 0x55606d, mx, 1.05, z + D / 2 + 0.02, PAINT);
      L.add(G.box(0.62, 0.42, 0.02), i % 2 ? 0x2fd08a : 0x35a8ff, mx, 1.42, z + D / 2 + 0.06, { glow: true });
      L.add(G.box(0.5, 0.08, 0.02), 0xffd060, mx, 1.02, z + D / 2 + 0.06, { glow: true });
      L.add(G.box(0.4, 0.14, 0.1), 0x15181c, mx, 0.62, z + D / 2 + 0.06, DARK);     // ticket tray
    }
    L.add(G.box(W - 0.4, 0.3, 0.03), 0x1d4f9c, x, H - 0.25, z + D / 2 + 0.03, { glow: true });   // header
    this._col(x - W / 2, z - D / 2, x + W / 2, z + D / 2, H + 0.1);
    this._shadows.push([x, z, W + 1.6, D + 1.8]);
  }

  /** Platform snack kiosk: the one tall island on the boarding side. */
  _platformKiosk(L, x, z) {
    const W = 2.4, D = 1.3, H = 2.3;
    L.add(G.box(W, H, D), 0x8a2f2a, x, H / 2, z, PAINT);
    L.add(G.box(W + 0.3, 0.14, D + 0.5), 0x1f2227, x, H + 0.07, z, DARK);
    L.add(G.box(W - 0.3, 0.8, 0.02), 0xfff0c8, x, 1.5, z - D / 2 - 0.012, { glow: true });   // lit window
    L.add(G.box(W - 0.1, 0.3, 0.03), 0xff6a3a, x, H - 0.2, z - D / 2 - 0.02, { glow: true });
    L.add(G.box(W + 0.1, 0.06, 0.4), 0xb9bdc4, x, 1.02, z - D / 2 - 0.2, STEEL);              // shelf
    this._col(x - W / 2, z - D / 2, x + W / 2, z + D / 2, H + 0.1);
    this._shadows.push([x, z, W + 1.6, D + 1.8]);
  }

  /** Stainless queue rails funnelling into the gate line (visual + thin cover). */
  _queueRails(L) {
    for (const gx of [-14.9]) {
      for (const z of [-5.6, -0.4]) {
        L.add(G.cyl(0.035, 0.035, 1.0, 8), 0xc8ccd2, gx, 0.5, z, STEEL);
      }
      L.add(G.box(0.05, 0.05, 5.2), 0xc8ccd2, gx, 0.98, -3, STEEL);
      L.add(G.box(0.04, 0.04, 5.2), 0xc8ccd2, gx, 0.55, -3, STEEL);
      this._col(gx - 0.08, -5.65, gx + 0.08, -0.35, 1.0);
    }
  }

  /** Soft dark blobs under every island — cheap contact shadow for a
   *  room whose lights cast none. */
  _contactShadows() {
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: tex, transparent: true, opacity: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, mat, this._shadows.length);
    const m4 = new THREE.Matrix4();
    this._shadows.forEach(([x, z, w, d], i) => {
      m4.compose(new THREE.Vector3(x, 0.012, z), new THREE.Quaternion(), new THREE.Vector3(w, 1, d));
      inst.setMatrixAt(i, m4);
    });
    inst.renderOrder = 1;
    this.scene.add(inst);
  }
}
