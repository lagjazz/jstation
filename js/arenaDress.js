// ============================================================
// arenaDress.js — structured, themed cover for the twelve arena
// worlds (MISSIONS 04–15).
//
// The arenas were open floors dressed with RANDOM crates each run:
// cluttered where the dice landed, empty everywhere else. This lays a
// stable, even field of cover islands over every arena instead —
// the same layout every time, so a map can be learned.
//
// Layout (layoutArena, pure logic — unit-tested):
//   • candidates on a 1 m grid inside the arena rect
//   • a candidate is legal when its footprint (+ a walking margin) is
//     free of colliders, clear of every enemy anchor / patrol waypoint,
//     the player entry and the map's hazard zones, and — on floorless
//     decks (skyport) — fully supported by deck slabs
//   • farthest-point sampling picks N islands ≥ MIN_GAP apart, so
//     cover is spread evenly instead of clumping
//   • every third island is TALL (full standing cover), the rest LOW
//     (1.1 m, crouch behind / shoot over); each wall turns broadside
//     to the player entry
//   • islands are small and convex with wide lanes between them —
//     the hostiles steer without path-finding
//
// Look (THEMES): each world gets its own low + tall piece built from
// meshKit parts in that world's materials and accent glow. All of an
// arena's pieces bake into one mesh (+ one glow mesh) inside a
// `world:<area>` group, so the existing per-world visibility gating
// and per-arena raycast lists pick them up unchanged.
// ============================================================

import * as THREE from 'three';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';

export const DRESS = {
  minGap: 6.5,        // centre-to-centre spacing between islands
  margin: 1.5,        // free walking space required around a footprint
  edge: 3.5,          // keep-off distance from the arena walls
  anchorClear: 2.8,   // from enemy anchors
  wpClear: 2.0,       // from patrol waypoints
  spawnClear: 7.5,    // from the player entry
  areaPer: 200,       // one island per this many m² …
  minCount: 6, maxCount: 14,
};

const LOW = { len: 3.4, dep: 0.8, h: 1.1 };
const TALL = { len: 2.4, dep: 1.3, h: 2.25 };

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Choose cover-island placements for one arena.
 *
 * @param {object} o
 *   rect      {x0,x1,z0,z1} arena interior
 *   spawn     {x,z} player entry
 *   anchors   [{pos:[x,z], wps:[[x,z]…]}] enemy spawn pool
 *   avoid     [{x,z,r}] hazard / mechanic circles to keep clear
 *   rects     [{x0,x1,z0,z1}] rectangles to keep clear (cargo lanes)
 *   blocked   (x0,z0,x1,z1) => bool — true when that footprint hits a collider
 *   supported (x0,z0,x1,z1) => bool — optional: footprint rests on floor
 *   seed      string
 * @returns [{x,z,alongX,tall}]
 */
export function layoutArena(o) {
  const { rect, spawn, anchors = [], avoid = [], rects = [], blocked, supported = null, seed = 'arena' } = o;
  const rnd = seeded(seed);
  const W = rect.x1 - rect.x0, D = rect.z1 - rect.z0;
  const want = Math.max(DRESS.minCount, Math.min(DRESS.maxCount, Math.round((W * D) / DRESS.areaPer)));
  const pts = [];
  for (const a of anchors) {
    pts.push({ x: a.pos[0], z: a.pos[1], r: DRESS.anchorClear });
    for (const w of a.wps ?? []) pts.push({ x: w[0], z: w[1], r: DRESS.wpClear });
  }
  pts.push({ x: spawn.x, z: spawn.z, r: DRESS.spawnClear });
  for (const c of avoid) pts.push({ x: c.x, z: c.z, r: c.r + 2 });

  const fits = (x, z, alongX, spec) => {
    const hx = (alongX ? spec.len : spec.dep) / 2, hz = (alongX ? spec.dep : spec.len) / 2;
    const m = DRESS.margin;
    if (x - hx < rect.x0 + DRESS.edge || x + hx > rect.x1 - DRESS.edge) return false;
    if (z - hz < rect.z0 + DRESS.edge || z + hz > rect.z1 - DRESS.edge) return false;
    for (const p of pts) {
      // distance from the point to the footprint rectangle
      const dx = Math.max(Math.abs(p.x - x) - hx, 0), dz = Math.max(Math.abs(p.z - z) - hz, 0);
      if (dx * dx + dz * dz < p.r * p.r) return false;
    }
    for (const r of rects) {
      if (x + hx + m > r.x0 && x - hx - m < r.x1 && z + hz + m > r.z0 && z - hz - m < r.z1) return false;
    }
    if (blocked(x - hx - m, z - hz - m, x + hx + m, z + hz + m)) return false;
    if (supported && !supported(x - hx, z - hz, x + hx, z + hz)) return false;
    return true;
  };

  // legal candidates (either orientation, either size)
  const cands = [];
  for (let x = rect.x0 + DRESS.edge; x <= rect.x1 - DRESS.edge; x += 1) {
    for (let z = rect.z0 + DRESS.edge; z <= rect.z1 - DRESS.edge; z += 1) {
      // broadside to the entry: the wall's long axis is perpendicular to
      // the dominant axis of (piece − spawn)
      const preferX = Math.abs(x - spawn.x) < Math.abs(z - spawn.z);
      const okA = fits(x, z, preferX, LOW), okB = !okA && fits(x, z, !preferX, LOW);
      if (!okA && !okB) continue;
      cands.push({ x, z, alongX: okA ? preferX : !preferX, j: rnd() });
    }
  }
  if (!cands.length) return [];

  // farthest-point sampling, seeded start near the arena centre
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const out = [];
  let first = cands[0], fd = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.x - cx, c.z - cz) + c.j * 3;
    if (d < fd) { fd = d; first = c; }
  }
  out.push(first);
  while (out.length < want) {
    let best = null, bd = -1;
    for (const c of cands) {
      let d = Infinity;
      for (const p of out) d = Math.min(d, Math.hypot(c.x - p.x, c.z - p.z));
      d += c.j * 0.8;                       // seeded tie-break → organic, repeatable
      if (d > bd) { bd = d; best = c; }
    }
    if (!best || bd < DRESS.minGap) break;
    out.push(best);
  }
  // every third island (by pick order, so they spread out) is tall — if a
  // tall footprint fits there
  return out.map((c, i) => {
    const tall = i % 3 === 1 && fits(c.x, c.z, c.alongX, TALL);
    return { x: c.x, z: c.z, alongX: c.alongX, tall };
  });
}

// ------------------------------------------------------------------ look

const ico = new THREE.IcosahedronGeometry(1, 1);
const R = (r, m) => ({ r, m });

/** Panelled barrier with a lit strip (sci-fi / urban worlds). */
function barrier(L, p, c) {
  const { len, dep, h } = LOW;
  const w = p.alongX ? len : dep, d = p.alongX ? dep : len;
  L.add(G.box(w, h - 0.12, d), c.base, p.x, (h - 0.12) / 2, p.z, c.mat);
  L.add(G.box(w + 0.1, 0.12, d + 0.1), c.trim, p.x, h - 0.06, p.z, c.mat);
  L.add(G.box(w + 0.06, 0.14, d + 0.06), c.trim, p.x, 0.07, p.z, c.mat);
  const n = 3;
  for (let i = 0; i <= n; i++) {                                   // ribs
    const t = (i / n - 0.5) * (len - 0.1);
    L.add(G.box(p.alongX ? 0.1 : dep + 0.05, h - 0.2, p.alongX ? dep + 0.05 : 0.1), c.trim,
      p.x + (p.alongX ? t : 0), h / 2, p.z + (p.alongX ? 0 : t), c.mat);
  }
  for (const s of [-1, 1]) {                                       // glow strips, both faces
    L.add(G.box(p.alongX ? len - 0.5 : 0.02, 0.06, p.alongX ? 0.02 : len - 0.5), c.glow,
      p.x + (p.alongX ? 0 : s * (dep / 2 + 0.012)), h - 0.28, p.z + (p.alongX ? s * (dep / 2 + 0.012) : 0), { glow: true });
  }
}

/** Ribbed container / machine block with a lit panel (tall). */
function container(L, p, c) {
  const { len, dep, h } = TALL;
  const w = p.alongX ? len : dep, d = p.alongX ? dep : len;
  L.add(G.box(w, h, d), c.base, p.x, h / 2, p.z, c.mat);
  L.add(G.box(w + 0.12, 0.14, d + 0.12), c.trim, p.x, h + 0.02, p.z, c.mat);
  L.add(G.box(w + 0.12, 0.16, d + 0.12), c.trim, p.x, 0.08, p.z, c.mat);
  for (let i = 0; i < 5; i++) {                                    // corrugation
    const t = (i / 4 - 0.5) * (len - 0.3);
    L.add(G.box(p.alongX ? 0.08 : dep + 0.06, h - 0.3, p.alongX ? dep + 0.06 : 0.08), c.trim,
      p.x + (p.alongX ? t : 0), h / 2, p.z + (p.alongX ? 0 : t), c.mat);
  }
  for (const s of [-1, 1]) {
    const off = dep / 2 + 0.035;
    L.add(G.box(p.alongX ? len * 0.42 : 0.02, 0.5, p.alongX ? 0.02 : len * 0.42), c.glow2 ?? c.glow,
      p.x + (p.alongX ? 0 : s * off), h * 0.62, p.z + (p.alongX ? s * off : 0), { glow: true });
    L.add(G.box(p.alongX ? len * 0.7 : 0.02, 0.05, p.alongX ? 0.02 : len * 0.7), c.glow,
      p.x + (p.alongX ? 0 : s * off), 0.36, p.z + (p.alongX ? s * off : 0), { glow: true });
  }
}

/** Coursed masonry / block wall (ancient + natural worlds). */
function masonry(L, p, c, rnd) {
  const { len, dep } = LOW;
  const n = 4, bw = len / n;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < n; i++) {
      if (row === 2 && rnd() < 0.35) continue;                     // broken top course
      const t = (i + 0.5) * bw - len / 2 + (row % 2 ? bw * 0.22 : -bw * 0.08);
      const o = Math.max(-len / 2 + bw * 0.46, Math.min(len / 2 - bw * 0.46, t));
      const tone = c.tones[Math.floor(rnd() * c.tones.length)];
      const dd = dep - rnd() * 0.08;
      L.add(G.box(p.alongX ? bw * 0.95 : dd, 0.36, p.alongX ? dd : bw * 0.95), tone,
        p.x + (p.alongX ? o : 0), 0.19 + row * 0.37, p.z + (p.alongX ? 0 : o), c.mat);
    }
  }
  if (c.glow) {
    L.add(G.box(p.alongX ? 0.5 : 0.02, 0.2, p.alongX ? 0.02 : 0.5), c.glow, p.x + (p.alongX ? 0 : dep / 2 + 0.012), 0.56, p.z + (p.alongX ? dep / 2 + 0.012 : 0), { glow: true });
    L.add(G.box(p.alongX ? 0.5 : 0.02, 0.2, p.alongX ? 0.02 : 0.5), c.glow, p.x - (p.alongX ? 0 : dep / 2 + 0.012), 0.56, p.z - (p.alongX ? dep / 2 + 0.012 : 0), { glow: true });
  }
}

/** Broken column on a plinth (tall, ancient worlds). */
function column(L, p, c, rnd) {
  const tone = () => c.tones[Math.floor(rnd() * c.tones.length)];
  L.add(G.box(1.5, 0.3, 1.5), tone(), p.x, 0.15, p.z, c.mat);
  L.add(G.box(1.25, 0.18, 1.25), tone(), p.x, 0.39, p.z, c.mat);
  let y = 0.48;
  for (let i = 0; i < 4; i++) {
    const hh = 0.42 + rnd() * 0.08;
    L.add(G.cyl(0.5 - i * 0.012, 0.52 - i * 0.012, hh, 14), tone(), p.x + (rnd() - 0.5) * 0.05, y + hh / 2, p.z + (rnd() - 0.5) * 0.05, { ...c.mat, rot: [0, rnd() * 3, 0] });
    y += hh;
    if (c.band && i === 1) L.add(G.cyl(0.53, 0.53, 0.07, 14), c.band, p.x, y, p.z, c.bandMat ?? c.mat);
  }
  L.add(G.cyl(0.36, 0.48, 0.2, 9), tone(), p.x + 0.06, y + 0.08, p.z, { ...c.mat, rot: [0.12, 0, 0.1] });   // broken top
  if (c.glow) L.add(G.tor(0.525, 0.02, 4, 18), c.glow, p.x, 1.2, p.z, { glow: true, rot: [Math.PI / 2, 0, 0] });
}

/** Boulder cluster (tall, natural worlds). */
function boulder(L, p, c, rnd) {
  const tone = () => c.tones[Math.floor(rnd() * c.tones.length)];
  L.add(ico, tone(), p.x, 1.05, p.z, { ...c.mat, s: p.alongX ? [1.25, 1.3, 0.72] : [0.72, 1.3, 1.25], rot: [0.1, rnd() * 0.5, 0.08] });
  const sx = p.alongX ? 0.85 : 0.1, sz = p.alongX ? 0.1 : 0.85;
  L.add(ico, tone(), p.x + sx, 0.5, p.z + sz, { ...c.mat, s: [0.55, 0.6, 0.5], rot: [0, rnd() * 3, 0] });
  L.add(ico, tone(), p.x - sx, 0.42, p.z - sz, { ...c.mat, s: [0.5, 0.5, 0.45], rot: [0, rnd() * 3, 0] });
  if (c.cap) L.add(ico, c.cap, p.x, 2.0, p.z, { ...c.mat, s: p.alongX ? [0.85, 0.3, 0.5] : [0.5, 0.3, 0.85] });
}

/** Stacked logs (low, canopy). */
function logs(L, p, c, rnd) {
  const { len } = LOW;
  const rot = p.alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
  for (const [o, y, r] of [[-0.24, 0.3, 0.3], [0.24, 0.3, 0.3], [0, 0.8, 0.29]]) {
    const l = len - rnd() * 0.3;
    L.add(G.cyl(r, r, l, 10), c.tones[Math.floor(rnd() * c.tones.length)], p.x + (p.alongX ? 0 : o), y, p.z + (p.alongX ? o : 0), { ...c.mat, rot });
    for (const e of [-1, 1]) {                                     // pale cut ends
      L.add(G.cyl(r * 0.86, r * 0.86, 0.02, 10), c.cut, p.x + (p.alongX ? e * (l / 2 + 0.005) : o), y, p.z + (p.alongX ? o : e * (l / 2 + 0.005)), { ...c.mat, rot });
    }
  }
  L.add(ico, c.cap, p.x, 1.08, p.z, { r: 1, m: 0, s: p.alongX ? [1.2, 0.12, 0.3] : [0.3, 0.12, 1.2] });   // moss
}

/** Strapped cargo crates (skyport). */
function crates(L, p, c, rnd) {
  const { len, dep, h } = LOW;
  const n = 3, bw = len / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * bw - len / 2;
    const hh = h - (i === 1 ? 0 : rnd() * 0.18);
    const x = p.x + (p.alongX ? t : 0), z = p.z + (p.alongX ? 0 : t);
    L.add(G.box(p.alongX ? bw * 0.96 : dep, hh, p.alongX ? dep : bw * 0.96), c.tones[i % c.tones.length], x, hh / 2, z, c.mat);
    for (const yy of [0.1, hh - 0.1]) L.add(G.box(p.alongX ? bw : dep + 0.04, 0.07, p.alongX ? dep + 0.04 : bw), c.trim, x, yy, z, c.trimMat);
  }
}

const SCI = R(0.5, 0.45), STONE = R(0.92, 0), ICE = R(0.22, 0.1), BRASS = R(0.38, 0.8), WOOD = R(0.85, 0);

/** area → { low, tall } piece builders. */
export const THEMES = {
  cyber:     { low: [barrier, { base: 0x2a2f3c, trim: 0x161a22, glow: 0xff2a8a, mat: SCI }],
               tall: [container, { base: 0x232a38, trim: 0x12161d, glow: 0x35e0ff, glow2: 0xff2a8a, mat: SCI }] },
  moon:      { low: [barrier, { base: 0xa9adb3, trim: 0x6b7078, glow: 0xffa030, mat: R(0.6, 0.3) }],
               tall: [container, { base: 0xc2c6cc, trim: 0x7a808a, glow: 0xffa030, glow2: 0x9fe0ff, mat: R(0.55, 0.35) }] },
  tomb:      { low: [masonry, { tones: [0xb89a62, 0xa88a54, 0xc4a66c, 0x9c7e4c], mat: STONE }],
               tall: [column, { tones: [0xc2a56c, 0xb4965e, 0xcdb078], band: 0xd8a830, bandMat: BRASS, mat: STONE }] },
  skyport:   { low: [crates, { tones: [0x7a5a36, 0x6c4e2e, 0x86633c], trim: 0xb08a3a, trimMat: BRASS, mat: WOOD }],
               tall: [container, { base: 0x6a4a2c, trim: 0xa8843a, glow: 0xffc060, mat: R(0.55, 0.5) }] },
  lab:       { low: [barrier, { base: 0xdfe3e8, trim: 0x9aa2ac, glow: 0x40b0ff, mat: R(0.35, 0.2) }],
               tall: [container, { base: 0xe6e9ed, trim: 0x8f98a4, glow: 0x40b0ff, glow2: 0x7fffd0, mat: R(0.3, 0.25) }] },
  atlantis:  { low: [masonry, { tones: [0x4f7a78, 0x466e6c, 0x5a8684, 0x3e6462], glow: 0x40ffd0, mat: R(0.8, 0.05) }],
               tall: [column, { tones: [0x6a9a94, 0x5e8c88, 0x74a49e], glow: 0x40ffd0, mat: R(0.75, 0.05) }] },
  ice:       { low: [masonry, { tones: [0xbfe0f0, 0xa8d2ea, 0xd2ecf8, 0x98c6e0], mat: ICE }],
               tall: [boulder, { tones: [0xa8d0e8, 0xbcdcf0, 0x94c2de], cap: 0xf2f8fc, mat: ICE }] },
  orbit:     { low: [barrier, { base: 0x3a4252, trim: 0x1e232c, glow: 0x40a0ff, mat: SCI }],
               tall: [container, { base: 0x505a6a, trim: 0x262c36, glow: 0xff8a30, glow2: 0x40a0ff, mat: SCI }] },
  canopy:    { low: [logs, { tones: [0x5a4028, 0x4e3620, 0x664a30], cut: 0xc8a878, cap: 0x4a7a34, mat: WOOD }],
               tall: [boulder, { tones: [0x5c6058, 0x6a6e64, 0x50544c], cap: 0x4a7a34, mat: STONE }] },
  canyon:    { low: [masonry, { tones: [0x8a4a2a, 0x7a4024, 0x985634, 0x6c3a22], mat: R(0.7, 0.45) }],
               tall: [boulder, { tones: [0x8a5232, 0x7a4628, 0x9a5e3a], cap: 0xb07a4a, mat: STONE }] },
  aquarium:  { low: [barrier, { base: 0x1e3044, trim: 0x0f1a26, glow: 0x30ffe0, mat: SCI }],
               tall: [container, { base: 0x243a50, trim: 0x101c28, glow: 0x30ffe0, glow2: 0xff40c0, mat: SCI }] },
  clockwork: { low: [masonry, { tones: [0x8a6a2a, 0x7a5c22, 0x9a7832, 0x6e521e], mat: BRASS }],
               tall: [column, { tones: [0x9a7a30, 0x8a6c28, 0xa88638], band: 0x3a2a14, mat: BRASS }] },
};

// ------------------------------------------------------------------ walls
// Sealed-room arenas get engaged piers along their (otherwise flat)
// perimeter walls: rhythm, shadow lines and a base/capital on what was a
// 50 m blank box face. Visual only (≤ 0.36 m proud of the wall).
const PIER_STYLE = {
  tomb:      { kind: 'column', shaft: 0xc2a56c, base: 0x9c7e4c, band: 0xd8a830, bandMat: BRASS, mat: STONE },
  atlantis:  { kind: 'column', shaft: 0x6a9a94, base: 0x466e6c, glow: 0x40ffd0, mat: R(0.75, 0.05) },
  clockwork: { kind: 'column', shaft: 0x9a7a30, base: 0x5a4418, band: 0x3a2a14, mat: BRASS },
  lab:       { kind: 'rib', shaft: 0xcfd4da, base: 0x8f98a4, glow: 0x40b0ff, mat: R(0.35, 0.25) },
  aquarium:  { kind: 'rib', shaft: 0x243a50, base: 0x101c28, glow: 0x30ffe0, mat: SCI },
};
const PIER_GAP = 6, PIER_MAX_H = 6.2;

/**
 * Pier positions along the inside of an arena's perimeter.
 * wallTop(x, z) → height of the wall collider at that point (0 = no wall),
 * blocked(x0,z0,x1,z1) → something already stands there.
 * Returns [{x, z, nx, nz, h}] (n = inward normal).
 */
export function layoutPiers(rect, wallTop, blocked) {
  const out = [];
  const side = (ax, az, bx, bz, nx, nz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.round(len / PIER_GAP));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const top = wallTop(x - nx * 0.25, z - nz * 0.25);
      if (top < 2.6) continue;                                   // no (or only a low) wall here
      // free floor in front of the wall (doors, stairs, props stay clear)
      const fx = x + nx * 0.7, fz = z + nz * 0.7;
      if (blocked(fx - 0.6, fz - 0.6, fx + 0.6, fz + 0.6)) continue;
      out.push({ x, z, nx, nz, h: Math.min(top - 0.1, PIER_MAX_H) });
    }
  };
  side(rect.x0, rect.z0, rect.x1, rect.z0, 0, 1);
  side(rect.x0, rect.z1, rect.x1, rect.z1, 0, -1);
  side(rect.x0, rect.z0, rect.x0, rect.z1, 1, 0);
  side(rect.x1, rect.z0, rect.x1, rect.z1, -1, 0);
  return out;
}

function pier(L, p, c) {
  const alongX = p.nz !== 0;                         // wall runs along X
  const at = (out) => [p.x + p.nx * out, p.z + p.nz * out];
  const box = (w, h, d, y, col, mat, out) => {
    const [x, z] = at(out);
    L.add(G.box(alongX ? w : d, h, alongX ? d : w), col, x, y, z, mat);
  };
  if (c.kind === 'column') {
    // everything stays ≤ 0.36 m proud of the wall — inside the player's
    // 0.38 m body radius, so the camera can never end up inside a pier
    box(1.0, 0.5, 0.32, 0.25, c.base, c.mat, 0.16);
    box(0.84, 0.16, 0.28, 0.58, c.base, c.mat, 0.14);
    const [x, z] = at(0.02);
    L.add(G.cyl(0.27, 0.3, p.h - 1.3, 14), c.shaft, x, 0.66 + (p.h - 1.3) / 2, z, c.mat);
    if (c.band) for (const y of [1.2, p.h - 1.0]) L.add(G.cyl(0.315, 0.315, 0.1, 14), c.band, x, y, z, c.bandMat ?? c.mat);
    if (c.glow) L.add(G.tor(0.305, 0.018, 4, 16), c.glow, x, p.h * 0.55, z, { glow: true, rot: [Math.PI / 2, 0, 0] });
    box(0.86, 0.16, 0.3, p.h - 0.56, c.base, c.mat, 0.15);
    box(1.06, 0.34, 0.34, p.h - 0.31, c.shaft, c.mat, 0.17);
    box(1.2, 0.14, 0.36, p.h - 0.07, c.base, c.mat, 0.18);
  } else {
    box(0.7, 0.4, 0.34, 0.2, c.base, c.mat, 0.17);
    box(0.5, p.h - 0.7, 0.22, 0.4 + (p.h - 0.7) / 2, c.shaft, c.mat, 0.11);
    box(0.7, 0.3, 0.34, p.h - 0.15, c.base, c.mat, 0.17);
    const [x, z] = at(0.228);
    L.add(G.box(alongX ? 0.08 : 0.012, p.h - 1.4, alongX ? 0.012 : 0.08), c.glow, x, p.h / 2, z, { glow: true });
  }
}

export class ArenaDress {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.groups = {};
    this.raycastMeshes = [];
    this.layouts = {};
    this.mat = RMMaterial();
    this.glow = GlowMaterial(1.8);
  }

  /**
   * Lay out + build one arena. ctx: { rect, spawn, anchors, avoid, rects,
   * floorless } (see layoutArena). Colliders already in the world at this
   * point are the arena's own geometry.
   */
  build(area, ctx) {
    const theme = THEMES[area];
    if (!theme || !ctx.rect) return [];
    const world = this.world;
    // any collider crossing the 0.06–2.3 m band over the footprint blocks it
    const blocked = (x0, z0, x1, z1) => {
      for (const b of world.all()) {
        if (b.max.x > x0 && b.min.x < x1 && b.max.z > z0 && b.min.z < z1 && b.max.y > 0.06 && b.min.y < 2.3) return true;
      }
      return false;
    };
    // floorless decks: every corner + the centre must sit on a slab top at y≈0
    const onSlab = (x, z) => {
      for (const b of world.near(x, z, 0.1)) {
        if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && Math.abs(b.max.y) < 0.08) return true;
      }
      return false;
    };
    const supported = ctx.floorless
      ? (x0, z0, x1, z1) => onSlab(x0, z0) && onSlab(x1, z0) && onSlab(x0, z1) && onSlab(x1, z1) && onSlab((x0 + x1) / 2, (z0 + z1) / 2)
      : null;
    const layout = layoutArena({ ...ctx, blocked, supported, seed: area });
    this.layouts[area] = layout;
    if (!layout.length) return layout;

    const rnd = seeded(area + ':look');
    const L = new PartList();
    // engaged piers along the perimeter walls of sealed-room arenas
    const ps = PIER_STYLE[area];
    if (ps) {
      const r = ctx.rect;
      const near = world.all().filter((b) => b.max.x > r.x0 - 3 && b.min.x < r.x1 + 3 && b.max.z > r.z0 - 3 && b.min.z < r.z1 + 3);
      const wallTop = (x, z) => {
        let top = 0;
        for (const b of near) if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.min.y < 0.5) top = Math.max(top, b.max.y);
        return top;
      };
      const piers = layoutPiers(r, wallTop, blocked);
      for (const p of piers) pier(L, p, ps);
      this.piers = this.piers ?? {};
      this.piers[area] = piers.length;
    }
    for (const p of layout) {
      const [fn, style] = p.tall ? theme.tall : theme.low;
      fn(L, p, style, rnd);
      const spec = p.tall ? TALL : LOW;
      // column / boulder footprints are squarer than the wall slot
      const round = fn === column;
      const hx = round ? 0.75 : (p.alongX ? spec.len : spec.dep) / 2;
      const hz = round ? 0.75 : (p.alongX ? spec.dep : spec.len) / 2;
      world.addBox(new THREE.Vector3(p.x - hx, 0, p.z - hz), new THREE.Vector3(p.x + hx, spec.h, p.z + hz));
    }
    const baked = L.bake();
    const g = new THREE.Group();
    g.name = 'world:' + area;
    const mesh = new THREE.Mesh(baked.geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.tag = theme.low[0] === barrier ? 'metal' : (theme.low[0] === logs || theme.low[0] === crates ? 'wood' : 'concrete');
    g.add(mesh);
    if (baked.glowGeo) g.add(new THREE.Mesh(baked.glowGeo, this.glow));
    this.scene.add(g);
    this.groups[area] = g;
    this.raycastMeshes.push(mesh);
    return layout;
  }

  setVisible(area) {
    for (const k of Object.keys(this.groups)) this.groups[k].visible = (k === area);
  }
}
