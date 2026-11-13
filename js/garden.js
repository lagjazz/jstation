// ============================================================
// garden.js — the sakura garden east of the concourse (MISSION 03).
//
// A walled Japanese stroll garden, 30 × 44 m (x 12..42, z −24..20):
//
//        N (z=20)  plaster wall — the commuter line passes behind it
//   ┌──────────────────────────────────────────┐
//   │  bamboo        D            I   pavilion │
//   │ G    ▓wall                    ┌───────┐  │
//   │ ⛩ torii   ● rock      H       │ A tea │  │   E
//   │ → hall     path · · · · · · · └───────┘  │
//   │    ▓wall        ≈≈≈≈≈ pond ≈≈≈   ▓wall   │
//   │  ● rock   F     ≈≈≈≈≈≈≈≈≈≈≈   E          │
//   │        dry garden        ● rock     B    │
//   │                   C       ▓wall          │
//   └──────────────────────────────────────────┘
//        S (z=−24)
//
// Design rules (the hostiles steer without path-finding, so):
//   • every obstacle is a small convex island with ≥ 3 m lanes around it
//   • cover comes in two heights: 1.15 m dry-stone walls / low rocks
//     (crouch cover, shoot over) and tall rocks / lantern clusters
//   • three lanes run west → east (north path, centre across the pond,
//     south dry garden); the tea pavilion is the boss's high-value corner
//   • the perimeter wall is only 3.4 m so the night skyline frames it
//
// Everything static is baked into a handful of meshes (meshKit) —
// walls, stonework, wood, trunks — plus one InstancedMesh of blossom.
// ============================================================

import * as THREE from 'three';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';
import { makeBench } from './build.js';
import { rand } from './utils.js';

export const GARDEN = { x0: 12, x1: 42, z0: -24, z1: 20 };

const STONE = { r: 0.92, m: 0.0 };
const PLASTER = { r: 0.85, m: 0.0 };
const TILE = { r: 0.55, m: 0.15 };
const WOODR = { r: 0.8, m: 0.0 };
const LACQUER = { r: 0.42, m: 0.05 };

// dry-stone cover walls: [cx, cz, length, alongX]
const LOW_WALLS = [
  [19.5, 8.5, 4.2, false],
  [25.5, -1.5, 4.4, true],
  [31.5, -17.5, 4.6, true],
  [36.5, -1.5, 4.0, false],
  [22.5, -9.5, 4.0, false],
  [29.5, 14.5, 4.4, true],
  [17.5, -17, 3.6, true],
];

// boulders: [x, z, sx, sy, sz, rotY]
const ROCKS = [
  [21.5, 2.2, 1.25, 1.0, 1.0, 0.4], [22.6, 3.1, 0.7, 0.55, 0.8, 1.3],
  [27.2, -13.6, 1.3, 1.1, 1.05, 2.1], [28.4, -12.6, 0.75, 0.6, 0.7, 0.2],
  [33.6, 2.0, 1.1, 0.95, 1.2, 0.9],
  [18.6, -11.6, 1.0, 0.8, 0.9, 2.7],
  [25.4, 11.2, 1.2, 1.05, 0.95, 1.8], [24.3, 10.3, 0.6, 0.5, 0.65, 0.3],
  [38.6, -8.2, 1.15, 0.9, 1.1, 0.6],
  [33.8, -11.4, 0.9, 0.7, 1.0, 2.2],
];

// stone lanterns: [x, z, lit]
const LANTERNS = [
  [18, -3.5, true], [23.2, 8.8, false], [30.2, 1.6, true], [36, -13.5, true],
  [22.5, -19, true], [27.5, 17.2, true], [39.5, 1.5, false], [15, 13.5, true],
  [33, -21.5, false], [39.5, -20.5, false],
];

// cherry trees: [x, z, scale]
const TREES = [
  [15.5, -5.5, 1.25], [16.2, 17.2, 1.1], [22.2, 17.6, 1.3], [34.5, 17.8, 1.15],
  [40, 13.6, 1.0], [40.2, -4.2, 1.3], [39.6, -17.2, 1.15], [28.2, -22, 1.2],
  [20.2, -22, 1.05], [14.6, -14.6, 1.3], [26.6, 5.6, 1.4], [31.4, -9.8, 1.2],
  [14.8, 9.4, 1.0], [35.4, -21.6, 1.0],
];

/** Procedural moss / short-grass albedo (tileable speckle, no assets). */
function mossTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#4c6a36';
  g.fillRect(0, 0, S, S);
  const tones = ['#3b5529', '#587a3d', '#44602f', '#6a8a48', '#34492a', '#7b8f52'];
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = tones[i % tones.length];
    g.globalAlpha = 0.25 + Math.random() * 0.45;
    const r = 0.6 + Math.random() * 2.2;
    const x = Math.random() * S, y = Math.random() * S;
    // draw wrapped so the tile has no seams
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox < -4 || x + ox > S + 4 || y + oy < -4 || y + oy > S + 4) continue;
      g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + Math.random()), Math.random() * 3, 0, 6.3); g.fill();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 13);
  t.anisotropy = 8;
  return t;
}

export class Garden {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.raycastMeshes = [];
    this.qualityLights = [];
    this.group = new THREE.Group();
    this.group.name = 'garden';
    scene.add(this.group);
    this.mat = RMMaterial();
    this.glow = GlowMaterial(2.6);
  }

  _col(x0, z0, x1, z1, h, y0 = 0) {
    this.world.addBox(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, h, z1));
  }

  _mesh(baked, tag, { cast = true, receive = true, ray = true } = {}) {
    const m = new THREE.Mesh(baked.geo, this.mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.userData.tag = tag;
    this.group.add(m);
    if (ray) this.raycastMeshes.push(m);
    if (baked.glowGeo) this.group.add(new THREE.Mesh(baked.glowGeo, this.glow));
    return m;
  }

  build() {
    this._ground();
    this._perimeter();
    this._lowWalls();
    this._rocks();
    this._lanterns();
    this._torii();
    this._pavilion();
    this._trees();
    this._bamboo();
    this._furniture();
  }

  // ------------------------------------------------------------ ground
  _ground() {
    const { x0, x1, z0, z1 } = GARDEN;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // moss base
    const moss = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, map: mossTexture() }),
    );
    moss.rotation.x = -Math.PI / 2;
    moss.position.set(cx, 0.012, cz);
    moss.receiveShadow = true;
    moss.userData.tag = 'concrete';
    this.group.add(moss);
    this.raycastMeshes.push(moss);

    // raked-gravel courts (flat discs/rects just above the moss) + path
    const L = new PartList();
    const GRAVEL = 0xb9b3a4, GRAVEL2 = 0xa8a294, SLAB = 0x6f7275;
    const flat = { r: 0.97, m: 0, ao: false };
    L.add(G.box(12, 0.02, 9), GRAVEL, 21, 0.02, -15, flat);            // dry garden (SW)
    L.add(G.cyl(4.2, 4.2, 0.02, 28), GRAVEL2, 21, 0.026, -15, flat);   // raked rings
    L.add(G.cyl(2.6, 2.6, 0.02, 24), GRAVEL, 21, 0.03, -15, flat);
    L.add(G.cyl(1.1, 1.1, 0.02, 18), GRAVEL2, 21, 0.034, -15, flat);
    L.add(G.box(9, 0.02, 7.4), GRAVEL, 36, 0.02, 8, flat);             // pavilion apron
    L.add(G.box(7, 0.02, 6), GRAVEL, 16.5, 0.02, 4, flat);             // entry court
    // stepping-stone path: hall opening → pavilion (north lane)
    const path = [
      [14, 4], [15.6, 4.2], [17.3, 4.0], [19, 4.6], [20.6, 5.4], [22.2, 5.9], [23.8, 6.6],
      [25.4, 7.6], [27.2, 8.2], [28.9, 8.4], [30.6, 8.2], [32.2, 8.0],
    ];
    path.forEach(([px, pz], i) => {
      L.add(G.box(1.25, 0.05, 0.9), SLAB, px, 0.04, pz, { r: 0.9, m: 0, rot: [0, (i % 3 - 1) * 0.18, 0] });
    });
    // south lane: stones through the dry garden toward the south-east
    for (const [px, pz] of [[16.5, 0.6], [17.2, -1.4], [18.4, -6.5], [19.8, -8.2], [26, -17.2], [29, -19.2], [33, -15.2], [35.6, -11.6]]) {
      L.add(G.cyl(0.55, 0.6, 0.06, 9), SLAB, px, 0.04, pz, { r: 0.9, m: 0 });
    }
    // pond stepping stones (centre lane)
    for (const [px, pz] of [[25.6, -6.2], [27.2, -5.6], [28.8, -6.4], [30.4, -5.8], [32, -6.5], [33.6, -6]]) {
      L.add(G.cyl(0.6, 0.66, 0.1, 9), 0x5d6063, px, 0.06, pz, { r: 0.85, m: 0 });
    }
    // pond rim stones (visual only, low)
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rx = 5.2 + Math.sin(i * 2.3) * 0.25, rz = 3.5 + Math.cos(i * 1.7) * 0.2;
      const s = 0.28 + ((i * 37) % 10) * 0.022;
      L.add(G.sph(1, 7, 5), i % 3 ? 0x6a6d70 : 0x565a5c, 29.6 + Math.cos(a) * rx, 0.05, -6 + Math.sin(a) * rz,
        { r: 0.9, m: 0, s: [s * 1.3, s * 0.6, s] });
    }
    this._mesh(L.bake(), 'concrete', { cast: false });

    // pond: a dark mirror that picks up the lanterns and the skyline
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshStandardMaterial({ color: 0x0c181d, roughness: 0.16, metalness: 0.8, envMapIntensity: 1.5 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.scale.set(5.0, 3.3, 1);
    water.position.set(29.6, 0.03, -6);
    water.userData.tag = 'glass';
    this.group.add(water);
    this.water = water;
  }

  // ------------------------------------------------------------ walls
  _perimeter() {
    const { x0, x1, z0, z1 } = GARDEN;
    const H = 3.4, T = 0.5;
    const L = new PartList();
    const seg = (ax, az, bx, bz) => {
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const w = alongX ? len : T, d = alongX ? T : len;
      L.add(G.box(w + 0.06, 0.7, d + 0.06), 0x55585c, cx, 0.35, cz, STONE);            // stone footing
      L.add(G.box(w, H - 0.7, d), 0xd9d3c4, cx, 0.7 + (H - 0.7) / 2, cz, PLASTER);      // plaster
      L.add(G.box(alongX ? w : 0.56, 0.1, alongX ? 0.56 : d), 0x3a2c20, cx, H - 0.5, cz, WOODR);  // timber band
      L.add(G.box(alongX ? w + 0.1 : 1.0, 0.14, alongX ? 1.0 : d + 0.1), 0x2b3036, cx, H + 0.07, cz, TILE);  // tile cap
      L.add(G.box(alongX ? w + 0.1 : 0.34, 0.16, alongX ? 0.34 : d + 0.1), 0x23272c, cx, H + 0.2, cz, TILE); // ridge
      // timber posts every ~4 m
      const n = Math.max(1, Math.round(len / 4));
      for (let i = 0; i <= n; i++) {
        const t = i / n - 0.5;
        L.add(G.box(alongX ? 0.2 : T + 0.08, H - 0.7, alongX ? T + 0.08 : 0.2), 0x3a2c20,
          cx + (alongX ? t * len : 0), 0.7 + (H - 0.7) / 2, cz + (alongX ? 0 : t * len), WOODR);
      }
      this._col(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, H + 2.5);   // +2.5: no jumping the wall
    };
    seg(x1 + T / 2, z0, x1 + T / 2, z1);              // east
    seg(x0, z0 - T / 2, x1 + T, z0 - T / 2);          // south
    seg(x0, z1 + T / 2, x1 + T, z1 + T / 2);          // north
    seg(x0 - T / 2, z0, x0 - T / 2, -16);             // west, below the hall
    seg(x0 - T / 2, 14, x0 - T / 2, z1);              // west, platform end
    this._mesh(L.bake(), 'concrete');
  }

  _lowWalls() {
    const L = new PartList();
    const tones = [0x74777a, 0x686b6e, 0x7d7f80, 0x5f6265];
    let k = 0;
    for (const [cx, cz, len, alongX] of LOW_WALLS) {
      const H = 1.15, T = 0.62;
      // coursed stones: 3 rows of offset blocks
      for (let row = 0; row < 3; row++) {
        const n = Math.round(len / 0.9);
        const bw = len / n;
        for (let i = 0; i < n; i++) {
          const off = (i + 0.5) * bw - len / 2 + (row % 2 ? bw * 0.25 : -bw * 0.1);
          const o = Math.max(-len / 2 + bw * 0.45, Math.min(len / 2 - bw * 0.45, off));
          const jit = ((k * 13) % 7) * 0.008;
          L.add(G.box(alongX ? bw * 0.96 : T - jit, 0.36, alongX ? T - jit : bw * 0.96), tones[k++ % 4],
            cx + (alongX ? o : 0), 0.19 + row * 0.37, cz + (alongX ? 0 : o), STONE);
        }
      }
      L.add(G.box(alongX ? len + 0.12 : T + 0.14, 0.09, alongX ? T + 0.14 : len + 0.12), 0x4b4e52, cx, H - 0.02, cz, STONE);
      const hw = (alongX ? len : T) / 2, hd = (alongX ? T : len) / 2;
      this._col(cx - hw, cz - hd, cx + hw, cz + hd, H);
    }
    this._mesh(L.bake(), 'concrete');
  }

  _rocks() {
    const L = new PartList();
    const ico = new THREE.IcosahedronGeometry(1, 1);
    for (const [x, z, sx, sy, sz, ry] of ROCKS) {
      L.add(ico, sy > 0.9 ? 0x5e6266 : 0x6c7074, x, sy * 0.78, z, { r: 0.95, m: 0, s: [sx, sy, sz], rot: [0.15, ry, 0.1] });
      // moss cap
      L.add(ico, 0x34432a, x - sx * 0.1, sy * 1.25, z + sz * 0.05, { r: 1, m: 0, s: [sx * 0.62, sy * 0.3, sz * 0.6], rot: [0, ry, 0] });
      this._col(x - sx * 0.8, z - sz * 0.8, x + sx * 0.8, z + sz * 0.8, sy * 1.55);
    }
    this._mesh(L.bake(), 'concrete');
  }

  _lanterns() {
    const L = new PartList();
    const hex = (r1, r2, h) => G.cyl(r1, r2, h, 6);
    for (const [x, z, lit] of LANTERNS) {
      const c = 0x7b7e80, d = 0x5c5f62;
      L.add(hex(0.38, 0.44, 0.18), d, x, 0.09, z, STONE);
      L.add(G.cyl(0.13, 0.16, 0.8, 8), c, x, 0.58, z, STONE);
      L.add(hex(0.34, 0.2, 0.14), c, x, 1.05, z, STONE);
      L.add(hex(0.24, 0.24, 0.34), d, x, 1.29, z, STONE);                       // fire box
      L.add(hex(0.2, 0.2, 0.26), lit ? 0xffb060 : 0x3a2a18, x, 1.29, z, { glow: lit, r: 0.9, m: 0 });
      L.add(hex(0.08, 0.5, 0.26), d, x, 1.59, z, STONE);                        // roof
      L.add(G.sph(0.07, 8, 6), c, x, 1.76, z, STONE);
      this._col(x - 0.36, z - 0.36, x + 0.36, z + 0.36, 1.7);
      if (lit) {
        const p = new THREE.PointLight(0xffb066, 30, 13, 2);
        p.position.set(x, 1.5, z);
        this.scene.add(p);
        this.qualityLights.push(p);
      }
    }
    this._mesh(L.bake(), 'concrete');
  }

  _torii() {
    // vermilion gate framing the way in from the concourse (opening z 2..6)
    const L = new PartList();
    const X = 14.4, RED = 0xb3261a, BLACK = 0x1c1a1a;
    for (const z of [1.5, 6.5]) {
      L.add(G.cyl(0.2, 0.24, 4.4, 12), RED, X, 2.2, z, LACQUER);
      L.add(G.cyl(0.3, 0.32, 0.3, 12), BLACK, X, 0.15, z, STONE);
      this._col(X - 0.28, z - 0.28, X + 0.28, z + 0.28, 4.6);
    }
    L.add(G.box(0.24, 0.26, 5.8), RED, X, 3.55, 4, LACQUER);                      // nuki
    L.add(G.box(0.34, 0.3, 7.0), RED, X, 4.45, 4, LACQUER);                       // shimaki
    L.add(G.box(0.46, 0.16, 7.6), BLACK, X, 4.68, 4, { r: 0.5, m: 0.1 });          // kasagi
    L.add(G.box(0.1, 0.6, 0.5), RED, X, 4.0, 4, LACQUER);                          // gakuzuka
    L.add(G.box(0.02, 0.4, 0.3), 0xe8c060, X - 0.06, 4.0, 4, { glow: true });
    this._mesh(L.bake(), 'wood');
  }

  _pavilion() {
    // open tea pavilion, 7 × 6 m: plinth, four posts, hipped roof, two
    // low rail walls (cover) and a paper lantern
    const cx = 36, cz = 8, hw = 3.5, hd = 3.0;
    const L = new PartList();
    const TIMBER = 0x3b2a1e, DARK = 0x2a1e16;
    L.add(G.box(hw * 2 + 0.8, 0.1, hd * 2 + 0.8), 0x64676a, cx, 0.05, cz, STONE);          // stone plinth (walkable lip)
    L.add(G.box(hw * 2, 0.06, hd * 2), 0x6b4c30, cx, 0.12, cz, { r: 0.7, m: 0 });           // timber floor
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = cx + sx * hw, pz = cz + sz * hd;
      L.add(G.box(0.3, 3.0, 0.3), TIMBER, px, 1.6, pz, WOODR);
      L.add(G.box(0.46, 0.14, 0.46), 0x55585c, px, 0.17, pz, STONE);
      this._col(px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, 3.1);
    }
    // ring beams + brackets
    for (const sz of [-1, 1]) L.add(G.box(hw * 2 + 0.9, 0.22, 0.2), DARK, cx, 3.0, cz + sz * hd, WOODR);
    for (const sx of [-1, 1]) L.add(G.box(0.2, 0.22, hd * 2 + 0.9), DARK, cx + sx * hw, 3.0, cz, WOODR);
    // rail walls: north side and east side (leave south + west open)
    const rail = (ax, az, bx, bz) => {
      const alongX = Math.abs(bx - ax) > 0.01;
      const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      L.add(G.box(alongX ? len : 0.14, 0.9, alongX ? 0.14 : len), 0x4a3524, mx, 0.6, mz, WOODR);
      L.add(G.box(alongX ? len + 0.1 : 0.22, 0.08, alongX ? 0.22 : len + 0.1), DARK, mx, 1.08, mz, WOODR);
      this._col(mx - (alongX ? len / 2 : 0.11), mz - (alongX ? 0.11 : len / 2), mx + (alongX ? len / 2 : 0.11), mz + (alongX ? 0.11 : len / 2), 1.12);
    };
    rail(cx - hw + 0.4, cz + hd, cx + hw - 0.4, cz + hd);
    rail(cx + hw, cz - hd + 0.4, cx + hw, cz + hd - 0.4);
    // roof: hipped pyramid + ridge cap + upturned eave band
    const roofGeo = new THREE.CylinderGeometry(0.7, 6.0, 1.9, 4, 1).rotateY(Math.PI / 4);
    L.add(roofGeo, 0x2a2f35, cx, 4.1, cz, { ...TILE, s: [1, 1, 0.88] });
    const eaveGeo = new THREE.CylinderGeometry(6.0, 6.25, 0.14, 4, 1).rotateY(Math.PI / 4);
    L.add(eaveGeo, 0x1f2328, cx, 3.2, cz, { ...TILE, s: [1, 1, 0.88] });
    L.add(G.box(1.1, 0.22, 0.3), 0x1f2328, cx, 5.12, cz, TILE);
    // low table + cushions
    L.add(G.box(1.5, 0.08, 0.9), 0x2e2018, cx - 0.4, 0.5, cz - 0.2, LACQUER);
    for (const sx of [-0.6, 0.6]) L.add(G.box(0.1, 0.36, 0.7), 0x2e2018, cx - 0.4 + sx, 0.33, cz - 0.2, LACQUER);
    this._col(cx - 1.15, cz - 0.65, cx + 0.35, cz + 0.25, 0.55);
    // paper lantern
    L.add(G.cyl(0.01, 0.01, 0.5, 4), 0x111111, cx, 2.75, cz, WOODR);
    L.add(G.sph(0.26, 12, 9), 0xffd9a0, cx, 2.35, cz, { glow: true, s: [1, 1.25, 1] });
    this._mesh(L.bake(), 'wood');
    const p = new THREE.PointLight(0xffc98a, 36, 14, 2);
    p.position.set(cx, 2.3, cz);
    this.scene.add(p);
    this.qualityLights.push(p);
  }

  // ------------------------------------------------------------ flora
  _trees() {
    const trunks = new PartList();
    const BARK = 0x3d2c22, BARK2 = 0x4a372a;
    const blobs = [];
    for (const [x, z, s] of TREES) {
      const lean = rand(-0.12, 0.12), lean2 = rand(-0.12, 0.12);
      trunks.add(G.cyl(0.16 * s, 0.27 * s, 1.5 * s, 9), BARK, x, 0.75 * s, z, { ...WOODR, rot: [lean2, 0, lean] });
      trunks.add(G.cyl(0.12 * s, 0.17 * s, 1.3 * s, 8), BARK2, x - lean * 1.2 * s, 2.0 * s, z + lean2 * 1.2 * s, { ...WOODR, rot: [lean2 * 1.6, 0, lean * 1.8] });
      trunks.add(G.cyl(0.3 * s, 0.36 * s, 0.12, 9), 0x2b3a22, x, 0.06, z, { r: 1, m: 0 });   // moss mound
      const nb = 5;
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * Math.PI * 2 + rand(-0.4, 0.4);
        const len = rand(1.3, 1.9) * s;
        const tilt = rand(0.7, 1.05);
        trunks.add(G.cyl(0.035 * s, 0.085 * s, len, 6), BARK2,
          x + Math.cos(a) * len * 0.36, (2.35 + rand(0, 0.3)) * s, z + Math.sin(a) * len * 0.36,
          { ...WOODR, rot: [-Math.sin(a) * tilt, 0, Math.cos(a) * tilt] });
        // blossom clusters along each branch
        for (let j = 0; j < 2; j++) {
          const r = len * (0.55 + j * 0.42);
          blobs.push([x + Math.cos(a) * r + rand(-0.2, 0.2), (2.75 + j * 0.25 + rand(0, 0.5)) * s, z + Math.sin(a) * r + rand(-0.2, 0.2), rand(0.7, 1.05) * s]);
        }
      }
      blobs.push([x, 3.5 * s, z, 1.2 * s], [x + rand(-0.5, 0.5), 3.95 * s, z + rand(-0.5, 0.5), 0.85 * s]);
      this._col(x - 0.24 * s, z - 0.24 * s, x + 0.24 * s, z + 0.24 * s, 2.6 * s);
    }
    this._mesh(trunks.bake(), 'wood');

    // all blossom in one instanced draw; per-instance tint for depth
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true,
      emissive: 0xe07aa6, emissiveIntensity: 0.16,
    });
    const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, blobs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
    blobs.forEach(([x, y, z, s], i) => {
      e.set(rand(0, 3), rand(0, 3), rand(0, 3));
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * 0.7, s));
      inst.setMatrixAt(i, m4);
      const t = Math.random();
      c.setRGB(0.98 - t * 0.12, 0.62 + t * 0.2 - (y < 3 ? 0.08 : 0), 0.76 + t * 0.12);
      inst.setColorAt(i, c);
    });
    inst.castShadow = true;
    inst.receiveShadow = false;
    inst.userData.tag = 'wood';
    this.group.add(inst);
    this.blossom = inst;
  }

  _bamboo() {
    // bamboo screens along the east + south walls (visual depth, no collision)
    const stalks = [];
    const row = (ax, az, bx, bz, n) => {
      for (let i = 0; i < n; i++) {
        const t = (i + Math.random() * 0.6) / n;
        stalks.push([ax + (bx - ax) * t + rand(-0.25, 0.25), az + (bz - az) * t + rand(-0.25, 0.25), rand(4.2, 6.4), rand(-0.05, 0.05)]);
      }
    };
    row(41.2, -3, 41.2, 3, 16);
    row(41.2, -16, 41.2, -10, 14);
    row(23, -23.2, 27, -23.2, 12);
    row(36, -23.2, 39, -23.2, 9);
    row(18, 19.3, 21, 19.3, 9);
    row(30, 19.3, 33, 19.3, 9);
    const geo = new THREE.CylinderGeometry(0.035, 0.05, 1, 6).translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5f8a3c, roughness: 0.55, metalness: 0 });
    const inst = new THREE.InstancedMesh(geo, mat, stalks.length);
    const leafGeo = new THREE.IcosahedronGeometry(1, 0);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6a2a, roughness: 0.9, flatShading: true });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, stalks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    stalks.forEach(([x, z, h, lean], i) => {
      e.set(lean, 0, lean * 0.7);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, h, 1));
      inst.setMatrixAt(i, m4);
      e.set(rand(0, 3), rand(0, 3), 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x + lean * h, h * 0.86, z), q, new THREE.Vector3(0.55, 0.95, 0.55));
      leaves.setMatrixAt(i, m4);
    });
    inst.castShadow = leaves.castShadow = true;
    this.group.add(inst, leaves);
  }

  _furniture() {
    const rc = this.raycastMeshes;
    makeBench(this.scene, this.world, rc, 17, 19, 0);
    makeBench(this.scene, this.world, rc, 41.2, 6.5, Math.PI / 2);
    makeBench(this.scene, this.world, rc, 25, -23.2, 0);
  }
}
