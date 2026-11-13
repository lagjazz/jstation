// ============================================================
// stationArch.js — architectural articulation for the station.
//
// The concourse was a box: four flat walls, a slab ceiling, plain
// cylinders for columns. This adds the layers a real terminal has,
// all visual (≤ 0.3 m proud of the walls, so no new colliders):
//
//   walls     stone wainscot, pilasters on the beam grid with bases
//             and capitals, a string course, recessed panel frames,
//             a cornice with a concealed light cove
//   ceiling   longitudinal secondary beams (coffers), services run
//             (cable tray + duct) down the centre
//   columns   base collar above each plinth + flared capital
//   platform  canopy purlins, cantilever brackets on every post, a
//             fascia with a lit edge, a hanging platform clock
//
// One baked mesh (+ one glow mesh). Positions are chosen around the
// existing posters, signs, screens and vending machines.
// ============================================================

import * as THREE from 'three';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';
import { LAYOUT } from './layout.js';

const H = LAYOUT.hall;
const STONE = { r: 0.8, m: 0.02 };
const PLASTER = { r: 0.9, m: 0 };
const STEEL = { r: 0.42, m: 0.8 };

const C_WAINSCOT = 0x4a505a, C_PILASTER = 0x9aa0a8, C_TRIM = 0x6f757e, C_FRAME = 0x7d838c, C_STEEL = 0x3a3f47;

// pilaster centres, chosen between the wall-mounted posters / signs / screens
const SOUTH_X = [-36, -28, -20, -12, -4, 0.5];
const WEST_Z = [-12.5, -5.2, 6.5, 13.2];
const COLUMNS = [[-32, -7], [-22, -7], [-12, -7], [-32, 7], [-22, 7], [-12, 7], [-2, 7], [8, 7]];

export class StationArch {
  constructor(scene) {
    this.scene = scene;
    this.mat = RMMaterial();
    this.glow = GlowMaterial(1.5);
  }

  build() {
    const L = new PartList();
    this._walls(L);
    this._ceiling(L);
    this._columns(L);
    this._platform(L);
    const baked = L.bake();
    const mesh = new THREE.Mesh(baked.geo, this.mat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.tag = 'concrete';
    this.scene.add(mesh);
    this.mesh = mesh;
    if (baked.glowGeo) this.scene.add(new THREE.Mesh(baked.glowGeo, this.glow));
    return mesh;
  }

  /** One pilaster against a wall. axis 'x': wall runs along X at z=wz (faces +z). */
  _pilaster(L, axis, a, wall, top) {
    const D = 0.26, W = 0.72;
    const put = (w, h, d, y, col, mat, out = 0) => {
      if (axis === 'x') L.add(G.box(w, h, d), col, a, y, wall + d / 2 + out, mat);
      else L.add(G.box(d, h, w), col, wall + d / 2 + out, y, a, mat);
    };
    put(W + 0.18, 0.5, D + 0.1, 0.25, C_WAINSCOT, STONE);           // base block
    put(W + 0.08, 0.14, D + 0.06, 0.57, C_TRIM, STONE);             // base moulding
    put(W, top - 1.3, D, 0.64 + (top - 1.3) / 2, C_PILASTER, PLASTER);   // shaft
    put(W - 0.3, top - 2.4, 0.03, 1.2 + (top - 2.4) / 2, C_FRAME, PLASTER, D);   // fluted inset
    put(W + 0.1, 0.12, D + 0.06, top - 0.6, C_TRIM, STONE);         // necking
    put(W + 0.26, 0.3, D + 0.14, top - 0.39, C_PILASTER, STONE);    // capital
    put(W + 0.4, 0.12, D + 0.2, top - 0.18, C_TRIM, STONE);         // abacus
  }

  _walls(L) {
    const top = H.h - 0.2;
    const zS = H.z0, xW = H.x0;
    // ---- south wall (runs along X at z = z0, faces +z) ----
    const xs0 = H.x0, xs1 = H.x1, len = xs1 - xs0, cx = (xs0 + xs1) / 2;
    L.add(G.box(len, 1.15, 0.12), C_WAINSCOT, cx, 0.575, zS + 0.06, STONE);          // wainscot
    L.add(G.box(len, 0.08, 0.18), C_TRIM, cx, 1.19, zS + 0.09, STONE);               // dado rail
    L.add(G.box(len, 0.16, 0.14), C_TRIM, cx, 5.0, zS + 0.07, STONE);                // string course
    L.add(G.box(len, 0.34, 0.34), C_PILASTER, cx, top - 0.02, zS + 0.17, STONE);     // cornice
    L.add(G.box(len, 0.1, 0.46), C_TRIM, cx, top + 0.15, zS + 0.23, STONE);
    L.add(G.box(len - 1, 0.04, 0.05), 0xdfe9ff, cx, top - 0.24, zS + 0.37, { glow: true });   // light cove
    for (const x of SOUTH_X) this._pilaster(L, 'x', x, zS, top);
    // recessed panel frames in the upper wall, one per bay
    for (let i = 0; i < SOUTH_X.length - 1; i++) {
      const a = SOUTH_X[i] + 0.8, b = SOUTH_X[i + 1] - 0.8;
      if (b - a < 2) continue;
      const mx = (a + b) / 2, w = b - a;
      for (const y of [5.5, 8.0]) L.add(G.box(w, 0.07, 0.05), C_FRAME, mx, y, zS + 0.025, PLASTER);
      for (const x of [a, b]) L.add(G.box(0.07, 2.5, 0.05), C_FRAME, x, 6.75, zS + 0.025, PLASTER);
    }
    // ---- west wall (runs along Z at x = x0, faces +x) ----
    const zl = H.z1 - H.z0, cz = (H.z0 + H.z1) / 2;
    L.add(G.box(0.12, 1.15, zl), C_WAINSCOT, xW + 0.06, 0.575, cz, STONE);
    L.add(G.box(0.18, 0.08, zl), C_TRIM, xW + 0.09, 1.19, cz, STONE);
    L.add(G.box(0.14, 0.16, zl), C_TRIM, xW + 0.07, 5.0, cz, STONE);
    L.add(G.box(0.34, 0.34, zl), C_PILASTER, xW + 0.17, top - 0.02, cz, STONE);
    L.add(G.box(0.46, 0.1, zl), C_TRIM, xW + 0.23, top + 0.15, cz, STONE);
    L.add(G.box(0.05, 0.04, zl - 1), 0xdfe9ff, xW + 0.37, top - 0.24, cz, { glow: true });
    for (const z of WEST_Z) this._pilaster(L, 'z', z, xW, top);
  }

  _ceiling(L) {
    const y = H.h - 0.55;
    // secondary beams along X between the main (Z-running) beams → coffers
    for (const z of [-12, -6, 0, 6, 12]) {
      L.add(G.box(H.x1 - H.x0 - 1, 0.34, 0.24), C_STEEL, (H.x0 + H.x1) / 2, y + 0.02, z, STEEL);
    }
    // services: cable tray + round duct with hangers down the centre
    const cx = (H.x0 + H.x1) / 2, len = H.x1 - H.x0 - 4;
    L.add(G.box(len, 0.06, 0.5), 0x555b64, cx, y - 0.5, -1.2, STEEL);
    for (const s of [-1, 1]) L.add(G.box(len, 0.1, 0.03), 0x555b64, cx, y - 0.45, -1.2 + s * 0.25, STEEL);
    L.add(G.cyl(0.22, 0.22, len, 12), 0x8d939c, cx, y - 0.62, 2.2, { ...STEEL, rot: [0, 0, Math.PI / 2] });
    for (let x = H.x0 + 4; x < H.x1 - 2; x += 4) {
      L.add(G.box(0.03, 0.5, 0.03), 0x30343a, x, y - 0.22, -1.2, STEEL);
      L.add(G.tor(0.24, 0.02, 4, 14), 0x30343a, x, y - 0.62, 2.2, { ...STEEL, rot: [0, Math.PI / 2, 0] });
      L.add(G.box(0.03, 0.34, 0.03), 0x30343a, x, y - 0.2, 2.2, STEEL);
    }
  }

  _columns(L) {
    for (const [x, z] of COLUMNS) {
      L.add(G.cyl(0.5, 0.56, 0.22, 16), C_STEEL, x, 1.22, z, STEEL);             // base collar on the plinth
      L.add(G.cyl(0.46, 0.46, 0.08, 16), 0xc8ccd2, x, 1.38, z, STEEL);
      L.add(G.cyl(0.46, 0.46, 0.1, 16), 0xc8ccd2, x, H.h - 1.25, z, STEEL);      // necking ring
      L.add(G.cyl(0.95, 0.46, 0.7, 16), 0x8d939c, x, H.h - 0.85, z, STEEL);      // flared capital
      L.add(G.box(2.1, 0.14, 2.1), C_STEEL, x, H.h - 0.43, z, STEEL);            // bearing plate
    }
  }

  _platform(L) {
    const P = LAYOUT.platform;
    const y = P.canopyH;
    const x0 = H.x0, x1 = H.x1, cx = (x0 + x1) / 2, len = x1 - x0;
    // purlins under the canopy deck
    for (const z of [15.2, 18.2, 21.2, 24.2]) L.add(G.box(len, 0.2, 0.14), C_STEEL, cx, y - 0.1, z, STEEL);
    // rafters + cantilever brackets on each post (posts at x = −36 + 8i, z = 23.9)
    for (let i = 0; i <= 6; i++) {
      const px = -36 + i * 8;
      L.add(G.box(0.16, 0.26, 10.6), C_STEEL, px, y - 0.24, 19.4, STEEL);        // rafter
      L.add(G.box(0.12, 0.12, 2.3), C_STEEL, px, y - 0.95, 22.95, { ...STEEL, rot: [0.62, 0, 0] });   // knee brace inward
      L.add(G.box(0.12, 0.12, 1.3), C_STEEL, px, y - 0.72, 24.45, { ...STEEL, rot: [-0.75, 0, 0] });  // brace to the edge
      L.add(G.cyl(0.26, 0.3, 0.3, 12), C_STEEL, px, 0.15, 23.9, STEEL);          // post base
      L.add(G.cyl(0.24, 0.2, 0.18, 12), C_STEEL, px, y - 0.42, 23.9, STEEL);     // post head
    }
    // fascia with a lit edge along the track side
    L.add(G.box(len + 1, 0.5, 0.1), 0x2a2f37, cx, y + 0.1, 25.45, STEEL);
    L.add(G.box(len + 1, 0.05, 0.03), 0xdfe9ff, cx, y - 0.13, 25.48, { glow: true });
    // hanging platform clock (double-faced)
    const kx = -14, kz = 22.2, ky = y - 1.1;
    L.add(G.cyl(0.02, 0.02, 0.7, 6), 0x30343a, kx, y - 0.4, kz, STEEL);
    L.add(G.cyl(0.42, 0.42, 0.16, 24), 0x23272e, kx, ky, kz, { ...STEEL, rot: [Math.PI / 2, 0, 0] });
    for (const s of [-1, 1]) {
      L.add(G.cyl(0.36, 0.36, 0.01, 24), 0xf2f4f6, kx, ky, kz + s * 0.086, { glow: true, rot: [Math.PI / 2, 0, 0] });
      L.add(G.box(0.03, 0.26, 0.012), 0x101216, kx, ky + 0.11, kz + s * 0.094, STEEL);            // minute hand
      L.add(G.box(0.03, 0.17, 0.012), 0x101216, kx + s * 0.07, ky + 0.03, kz + s * 0.094, { ...STEEL, rot: [0, 0, -1.1 * s] });  // hour hand
    }
  }
}
