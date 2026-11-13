// ============================================================
// surfaceDetail.js — material fidelity for every building surface.
//
// The worlds are built from primitives with flat-colour (or one small
// stretched) textures: a 40 m wall and a 0.3 m trim share the same
// 0..1 UVs, so nothing has a believable surface. This adds real
// surface structure to ALL of it at once, without touching a single
// mesh or UV:
//
//   1. synthesise tileable detail sets per surface class — poured
//      concrete with panel seams and tie holes, coursed ashlar stone,
//      steel plate with rivets and brushed grain, sci-fi hull panels,
//      strata rock, timber planks, cracked ice. Each set is a height
//      field turned into
//        • a normal map              (relief that catches the lights)
//        • an albedo/roughness map   (seam grime, per-block tone,
//                                     worn edges, polished vs. dusty)
//   2. project them in WORLD SPACE with triplanar mapping, injected
//      into the standard PBR shader (onBeforeCompile). One texel
//      density everywhere: a panel seam is 1.2 m apart on a wall, a
//      floor and a crate alike, and patterns line up across meshes.
//
// classify() decides the class per material from the mesh's impact
// tag, the world it belongs to, and metalness. Emissive screens,
// glass, sprites and anything that is not a standard PBR material
// are left alone. Cost: 6 texture taps per fragment; the LOW preset
// skips the whole pass.
// ============================================================

import * as THREE from 'three';

const N = 512;

// ---------------------------------------------------------------- noise
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Tileable value noise: lattice period `p` cells across the tile. */
function vnoise(u, v, p, seed) {
  const x = u * p, y = v * p;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (i, j) => hash2(((i % p) + p) % p, ((j % p) + p) % p, seed);
  const a = w(x0, y0), b = w(x0 + 1, y0), c = w(x0, y0 + 1), d = w(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u, v, p, oct, seed) {
  let s = 0, a = 0.5, t = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(u, v, p << i, seed + i * 17); t += a; a *= 0.5; }
  return s / t;
}
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** 0 at a cell edge → 1 inside, `w` = groove half-width in tile units. */
const groove = (f, w) => smooth(0, w, Math.min(f, 1 - f));

// ---------------------------------------------------------------- classes
// Each generator returns, per texel: h (height 0..1), a (albedo multiplier
// ~0.6..1.2), r (roughness multiplier ~0.6..1.4).
const GEN = {
  /** Poured concrete: 2×2 form panels, tie holes, pores, blotchy weathering. */
  concrete(u, v) {
    const pu = (u * 2) % 1, pv = (v * 2) % 1;
    const seam = groove(pu, 0.012) * groove(pv, 0.012);
    let hole = 1;
    for (const [hx, hy] of [[0.18, 0.18], [0.82, 0.18], [0.18, 0.82], [0.82, 0.82]]) {
      hole = Math.min(hole, smooth(0.012, 0.03, Math.hypot(pu - hx, pv - hy)));
    }
    const pores = fbm(u, v, 64, 3, 3);
    const blotch = fbm(u, v, 4, 4, 9);
    const panelTone = 0.94 + 0.12 * hash2(Math.floor(u * 2), Math.floor(v * 2), 5);
    const h = 0.55 + (pores - 0.5) * 0.18 + (blotch - 0.5) * 0.1 - (1 - seam) * 0.35 - (1 - hole) * 0.3;
    const grime = 1 - (1 - seam) * 0.35 - (1 - smooth(0, 0.08, Math.min(pu, 1 - pu, pv, 1 - pv))) * 0.12;
    return { h, a: panelTone * grime * (0.86 + blotch * 0.3), r: 0.9 + pores * 0.3 };
  },
  /** Polished floor tile: 4×4 tiles, hairline grout, faint per-tile tone. */
  tile(u, v) {
    const tu = (u * 4) % 1, tv = (v * 4) % 1;
    const grout = groove(tu, 0.012) * groove(tv, 0.012);
    const id = hash2(Math.floor(u * 4), Math.floor(v * 4), 173);
    const veins = fbm(u, v, 6, 4, 179);
    const micro = fbm(u, v, 80, 2, 181);
    const h = 0.6 + (micro - 0.5) * 0.02 + (id - 0.5) * 0.02 - (1 - grout) * 0.4;
    return { h, a: (0.95 + id * 0.1) * (1 - (1 - grout) * 0.35) * (0.96 + veins * 0.08), r: 0.9 + (1 - grout) * 0.6 + micro * 0.1 };
  },
  /** Coursed ashlar: 4 courses, staggered blocks, mortar joints, chipped faces. */
  stone(u, v) {
    const row = Math.floor(v * 4), fv = (v * 4) % 1;
    const off = (row % 2) * 0.5 + hash2(row, 0, 21) * 0.2;
    const bu = u * 3 + off, col = Math.floor(bu), fu = bu - col;
    const joint = groove(fu, 0.035) * groove(fv, 0.07);
    const id = hash2(((col % 3) + 3) % 3, row, 31);
    const face = fbm(u, v, 24, 4, 41);
    const chip = smooth(0.62, 0.8, fbm(u, v, 12, 3, 47)) * 0.25;
    const h = 0.6 + (face - 0.5) * 0.3 + (id - 0.5) * 0.12 - (1 - joint) * 0.5 - chip * joint;
    return { h, a: (0.82 + id * 0.3) * (1 - (1 - joint) * 0.4) * (0.92 + face * 0.16), r: 1.0 + (1 - joint) * 0.2 + face * 0.15 };
  },
  /** Steel plate: 2×2 plates, bevelled joints, rivet rows, brushed grain, edge wear. */
  metal(u, v) {
    const pu = (u * 2) % 1, pv = (v * 2) % 1;
    const joint = groove(pu, 0.01) * groove(pv, 0.01);
    const e = Math.min(pu, 1 - pu, pv, 1 - pv);
    let rivet = 0;
    const ru = (pu * 8) % 1, rv = (pv * 8) % 1;
    if (e > 0.03 && e < 0.09) rivet = 1 - smooth(0.12, 0.3, Math.hypot(ru - 0.5, rv - 0.5));
    const grain = vnoise(u * 0.25, v, 256, 3) * 0.6 + vnoise(u * 0.5, v, 128, 5) * 0.4;
    const scuff = smooth(0.6, 0.85, fbm(u, v, 6, 4, 61));
    const tone = 0.95 + 0.1 * hash2(Math.floor(u * 2), Math.floor(v * 2), 71);
    const h = 0.55 + (grain - 0.5) * 0.06 - (1 - joint) * 0.4 + rivet * 0.35;
    const wear = 1 + smooth(0.05, 0.0, e) * 0.18;
    return { h, a: tone * wear * (1 - (1 - joint) * 0.3) * (0.94 + grain * 0.12) * (1 - scuff * 0.1), r: 0.85 + grain * 0.25 + scuff * 0.35 - rivet * 0.2 };
  },
  /** Hull / lab panelling: big clean panels, inset access hatches, vent slots. */
  panel(u, v) {
    const cu = Math.floor(u * 2), cv = Math.floor(v * 2);
    const pu = (u * 2) % 1, pv = (v * 2) % 1;
    const joint = groove(pu, 0.014) * groove(pv, 0.014);
    const kind = hash2(cu, cv, 83);
    let inset = 1, slots = 0;
    if (kind < 0.5) {                               // inset hatch with rounded-ish border
      const d = Math.max(Math.abs(pu - 0.5) - 0.28, Math.abs(pv - 0.5) - 0.2);
      inset = 1 - (1 - smooth(0, 0.012, Math.abs(d))) * 0.9;
    } else if (kind < 0.75 && pu > 0.25 && pu < 0.75 && pv > 0.3 && pv < 0.7) {   // vent
      slots = 1 - groove((pv * 12) % 1, 0.22);
    }
    const micro = fbm(u, v, 96, 2, 91);
    const tone = 0.96 + 0.08 * kind;
    const h = 0.6 + (micro - 0.5) * 0.04 - (1 - joint) * 0.45 - (1 - inset) * 0.3 - slots * 0.35;
    return { h, a: tone * (1 - (1 - joint) * 0.35) * (1 - (1 - inset) * 0.25) * (1 - slots * 0.4), r: 0.92 + micro * 0.16 + slots * 0.2 };
  },
  /** Bedded rock: ridged strata, fractures, strong relief. */
  rock(u, v) {
    const warp = fbm(u, v, 3, 3, 101) * 0.35;
    const strata = Math.abs(((v + warp) * 9) % 1 - 0.5) * 2;
    const ridged = 1 - Math.abs(fbm(u, v, 8, 5, 107) * 2 - 1);
    const crack = smooth(0.0, 0.05, Math.abs(fbm(u, v, 5, 4, 113) - 0.5));
    const h = 0.25 + ridged * 0.45 + smooth(0.1, 0.5, strata) * 0.2 - (1 - crack) * 0.3;
    return { h, a: (0.78 + ridged * 0.3) * (1 - (1 - crack) * 0.35) * (0.94 + strata * 0.1), r: 1.05 + (1 - ridged) * 0.2 };
  },
  /** Timber: 8 planks, long grain, knots, gaps. */
  wood(u, v) {
    const plank = Math.floor(u * 8), fu = (u * 8) % 1;
    const gap = groove(fu, 0.05);
    const pv = v + hash2(plank, 0, 121) * 0.7;
    const grain = vnoise(u * 2, pv * 0.2, 256, 127 + plank) * 0.65 + vnoise(u, pv * 0.1, 128, 131) * 0.35;
    const kd = Math.hypot(fu - 0.5, ((pv * 1.3) % 1) - 0.5);
    const knot = hash2(plank, 1, 137) > 0.6 ? 1 - smooth(0.04, 0.16, kd) : 0;
    const end = groove((pv * 1.0) % 1, 0.006);
    const tone = 0.86 + 0.26 * hash2(plank, 2, 139);
    const h = 0.55 + (grain - 0.5) * 0.14 - (1 - gap) * 0.45 - (1 - end) * 0.3 - knot * 0.12;
    return { h, a: tone * (0.84 + grain * 0.3) * (1 - (1 - gap) * 0.45) * (1 - knot * 0.35), r: 0.95 + grain * 0.2 };
  },
  /** Glacier ice: glassy, shallow relief, white fracture veins. */
  ice(u, v) {
    const ripple = fbm(u, v, 6, 3, 151);
    const vein = 1 - smooth(0.0, 0.035, Math.abs(fbm(u, v, 4, 4, 157) - 0.5));
    const frost = smooth(0.55, 0.8, fbm(u, v, 20, 3, 163));
    const h = 0.5 + (ripple - 0.5) * 0.2 - vein * 0.25 + frost * 0.05;
    return { h, a: 0.94 + vein * 0.2 + frost * 0.1, r: 0.75 + frost * 0.9 + vein * 0.5 };
  },
};

// metres per tile, normal strength, albedo/roughness strength
const SPEC = {
  concrete: { size: 2.4, bump: 2.2, mix: 1 },
  tile:     { size: 2.4, bump: 1.4, mix: 0.9 },
  stone:    { size: 2.0, bump: 3.0, mix: 1 },
  metal:    { size: 2.0, bump: 1.8, mix: 0.9 },
  panel:    { size: 2.4, bump: 1.6, mix: 0.85 },
  rock:     { size: 5.0, bump: 3.6, mix: 1 },
  wood:     { size: 1.6, bump: 2.0, mix: 1 },
  ice:      { size: 4.0, bump: 1.2, mix: 0.8 },
};
export const DETAIL_KINDS = Object.keys(SPEC);

function dataTex(bytes, srgb = false) {
  const t = new THREE.DataTexture(bytes, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const _sets = new Map();
/** { map (R albedo ×, G roughness ×), normal, size, bump, mix } for a class. */
export function detailSet(kind, res = N) {
  const k = `${kind}|${res}`;
  if (_sets.has(k)) return _sets.get(k);
  const gen = GEN[kind], spec = SPEC[kind];
  const H = new Float32Array(res * res);
  const map = new Uint8Array(res * res * 4), nrm = new Uint8Array(res * res * 4);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const s = gen((x + 0.5) / res, (y + 0.5) / res);
      const i = y * res + x;
      H[i] = s.h;
      map[i * 4] = Math.round(sat(s.a / 1.4) * 255);
      map[i * 4 + 1] = Math.round(sat(s.r / 1.6) * 255);
      map[i * 4 + 2] = Math.round(sat(s.h) * 255);
      map[i * 4 + 3] = 255;
    }
  }
  const at = (x, y) => H[((y + res) % res) * res + ((x + res) % res)];
  const k2 = spec.bump * (res / 512);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * k2, dy = (at(x, y - 1) - at(x, y + 1)) * k2;
      const l = 1 / Math.hypot(dx, dy, 1);
      const i = (y * res + x) * 4;
      nrm[i] = Math.round((dx * l * 0.5 + 0.5) * 255);
      nrm[i + 1] = Math.round((dy * l * 0.5 + 0.5) * 255);
      nrm[i + 2] = Math.round((l * 0.5 + 0.5) * 255);
      nrm[i + 3] = 255;
    }
  }
  const set = { kind, map: res === N ? dataTex(map) : null, normal: res === N ? dataTex(nrm) : null, mapData: map, normalData: nrm, ...spec };
  _sets.set(k, set);
  return set;
}

// ---------------------------------------------------------------- shader
const VERT_DECL = 'varying vec3 vDetP;\nvarying vec3 vDetN;';
const VERT_MAIN = /* glsl */`
  vec4 detWP = vec4( transformed, 1.0 );
  vec3 detON = objectNormal;
  #ifdef USE_INSTANCING
    detWP = instanceMatrix * detWP;
    detON = mat3( instanceMatrix ) * detON;
  #endif
  vDetP = ( modelMatrix * detWP ).xyz;
  vDetN = normalize( mat3( modelMatrix ) * detON );`;
// moving meshes (trains, turning gears, patrol props) project in OBJECT
// space instead, so the pattern rides with them rather than swimming
const VERT_MAIN_OBJ = /* glsl */`
  vDetP = transformed;
  vDetN = normalize( objectNormal );`;
const FRAG_DECL = /* glsl */`
uniform sampler2D detailMap;
uniform sampler2D detailNormal;
uniform vec3 detailParams;   // 1/size, albedo+roughness mix, normal strength
varying vec3 vDetP;
varying vec3 vDetN;
// safe defaults: if an earlier hook removed our anchor, detail is a no-op
vec3 detW = vec3( 0.0 );
vec3 detUV = vec3( 0.0 );
float detRough = 1.0;`;
const FRAG_ALBEDO = /* glsl */`
  {
    vec3 an = abs( normalize( vDetN ) );
    detW = an * an * an * an;
    detW /= ( detW.x + detW.y + detW.z );
    detUV = vDetP * detailParams.x;
    vec2 detC = texture2D( detailMap, detUV.zy ).rg * detW.x
              + texture2D( detailMap, detUV.xz ).rg * detW.y
              + texture2D( detailMap, detUV.xy ).rg * detW.z;
    diffuseColor.rgb *= mix( 1.0, detC.r * 1.4, detailParams.y );
    detRough = detC.g * 1.6;
  }`;
const FRAG_ROUGH = /* glsl */`
  roughnessFactor = clamp( roughnessFactor * mix( 1.0, detRough, detailParams.y ), 0.04, 1.0 );`;
const FRAG_NORMAL = /* glsl */`
  {
    vec3 tx = texture2D( detailNormal, detUV.zy ).xyz * 2.0 - 1.0;
    vec3 ty = texture2D( detailNormal, detUV.xz ).xyz * 2.0 - 1.0;
    vec3 tz = texture2D( detailNormal, detUV.xy ).xyz * 2.0 - 1.0;
    vec3 wn = normalize( vDetN );
    vec3 wd = vec3( 0.0, tx.y, tx.x ) * detW.x + vec3( ty.x, 0.0, ty.y ) * detW.y + vec3( tz.x, tz.y, 0.0 ) * detW.z;
    normal = normalize( normal + mat3( viewMatrix ) * ( wd * detailParams.z ) * ( gl_FrontFacing ? 1.0 : -1.0 ) );
  }`;

/** Patch one standard material with a triplanar detail set. Idempotent. */
export function applyDetail(mat, set, { mix = 1, bump = 1, object = false } = {}) {
  if (!mat?.isMeshStandardMaterial || mat.userData.detail) return false;
  mat.userData.detail = set.kind;
  // three's default program key is onBeforeCompile.toString(); keep whatever
  // identified this material's shader before (its own key, or the source of
  // an earlier hook) so differently-patched materials never share a program
  const ownHook = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile');
  const ownKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey');
  const prevCompile = ownHook ? mat.onBeforeCompile : null;
  const baseKey = ownKey ? mat.customProgramCacheKey.bind(mat) : () => (prevCompile ? prevCompile.toString() : '');
  mat.onBeforeCompile = (sh, renderer) => {
    prevCompile?.call(mat, sh, renderer);
    sh.uniforms.detailMap = { value: set.map };
    sh.uniforms.detailNormal = { value: set.normal };
    sh.uniforms.detailParams = { value: new THREE.Vector3(1 / set.size, set.mix * mix, bump) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${object ? VERT_MAIN_OBJ : VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      // anchored after <color_fragment>: terrain-splat shaders (mapChunks.js)
      // replace <map_fragment> wholesale, nothing replaces this one
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_ALBEDO}`)
      .replace('#include <normal_fragment_begin>', `${FRAG_ROUGH}\n#include <normal_fragment_begin>`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  };
  mat.customProgramCacheKey = () => `${baseKey()}|det1${object ? 'o' : ''}`;
  mat.needsUpdate = true;
  return true;
}

// ---------------------------------------------------------------- classify
// what a world is mostly made of (meshes can override via tag / metalness)
export const AREA_BASE = {
  station: 'concrete', cyber: 'concrete', moon: 'panel', tomb: 'stone', skyport: 'metal',
  lab: 'panel', atlantis: 'stone', ice: 'ice', orbit: 'panel', canopy: 'wood',
  canyon: 'rock', aquarium: 'panel', clockwork: 'metal',
};

/**
 * Detail class for a material on a mesh, or null to leave it alone.
 * info: { tag, area } — the mesh's impact tag and world.
 */
export function classify(mat, info = {}) {
  if (!mat || !mat.isMeshStandardMaterial) return null;
  if (mat.userData.noDetail || mat.userData.detail) return null;
  if (mat.userData.detailKind) return mat.userData.detailKind;     // authored override
  if (mat.transparent || mat.opacity < 1 || (mat.transmission ?? 0) > 0) return null;
  if (mat.emissiveMap) return null;
  const e = mat.emissive;
  if (e && mat.emissiveIntensity > 0.5 && (e.r + e.g + e.b) > 0.25) return null;    // lamps, LEDs, neon
  const { tag, area } = info;
  if (tag === 'glass' || tag === 'flesh') return null;
  const base = AREA_BASE[area] ?? 'concrete';
  if (tag === 'wood') return 'wood';
  if (mat.metalness >= 0.55 || tag === 'metal') return base === 'panel' ? 'panel' : 'metal';
  return base;
}

/**
 * Walk the scene and give every eligible environment material its
 * detail set. `skip(object)` prunes subtrees (camera/viewmodel, actors);
 * `moving(mesh)` selects object-space projection for things that move.
 * Returns { patched, byKind }.
 */
export function applySurfaceDetail(scene, { skip = () => false, moving = () => false } = {}) {
  const byKind = {};
  let patched = 0;
  const areaOf = (o) => {
    for (let p = o; p; p = p.parent) {
      if (p.name && p.name.startsWith('world:')) return p.name.slice(6);
    }
    return 'station';
  };
  const visit = (o) => {
    if (skip(o)) return;
    if (o.isMesh && !o.isSkinnedMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const kind = classify(m, { tag: o.userData.tag, area: areaOf(o) });
        if (!kind) continue;
        // materials that already carry their own colour map keep most of
        // it: mainly add relief, a little of the albedo modulation
        const own = !!m.map;
        if (applyDetail(m, detailSet(kind), { mix: own ? 0.45 : 1, bump: own ? 0.8 : 1, object: moving(o) })) {
          patched++;
          byKind[kind] = (byKind[kind] ?? 0) + 1;
        }
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(scene);
  return { patched, byKind };
}
