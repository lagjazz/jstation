// ============================================================
// meshKit.js — build detailed procedural models as FEW draw calls.
//
// A PartList collects primitive parts (box / capsule / cylinder /
// sphere …) with a colour and a per-part roughness/metalness, then
// bakes them into ONE indexed BufferGeometry carrying vertex colours
// and a per-vertex `rm` (roughness, metalness) attribute. RMMaterial
// reads `rm` in the standard PBR shader, so cloth, polymer and gun
// metal can share one material — a 60-part soldier is one mesh per
// skeletal segment instead of one mesh per part.
//
// Emissive parts (visors, sights, pilot lights) go to a separate
// `glow` list that bakes into an unlit additive-bright mesh.
// A cheap baked AO term (up-facing brighter, down-facing darker) is
// folded into the vertex colours so the merged shapes read with depth.
// ============================================================

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n3 = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

// ---------- shared primitive geometry (one per parameter set) ----------
const _prim = new Map();
const prim = (k, make) => {
  let g = _prim.get(k);
  if (!g) { g = make(); _prim.set(k, g); }
  return g;
};
export const G = {
  box: (w, h, d) => prim(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cap: (r, len, rs = 4, cs = 10) => prim(`c${r},${len},${rs},${cs}`, () => new THREE.CapsuleGeometry(r, len, rs, cs)),
  cyl: (r1, r2, h, seg = 12) => prim(`y${r1},${r2},${h},${seg}`, () => new THREE.CylinderGeometry(r1, r2, h, seg)),
  sph: (r, ws = 14, hs = 10) => prim(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  // partial sphere — helmet shells (top cap down to thetaLen)
  dome: (r, thetaLen = 1.75, ws = 16, hs = 9) =>
    prim(`d${r},${thetaLen},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen)),
  tor: (r, t, rs = 8, ts = 18, arc = Math.PI * 2) =>
    prim(`t${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
};

/** One bakeable part list. Units: metres; rotations: radians (XYZ). */
export class PartList {
  constructor() { this.parts = []; this.glow = []; }

  /**
   * opts: { r: roughness 0..1, m: metalness 0..1, rot: [x,y,z],
   *         s: [sx,sy,sz] | number, glow: true (emissive list), ao: bool }
   */
  add(geo, color, x = 0, y = 0, z = 0, opts = {}) {
    const rot = opts.rot ?? [0, 0, 0];
    const sc = opts.s ?? 1;
    const s = typeof sc === 'number' ? [sc, sc, sc] : sc;
    const part = { geo, color, x, y, z, rot, s, r: opts.r ?? 0.8, m: opts.m ?? 0.05, ao: opts.ao ?? true };
    (opts.glow ? this.glow : this.parts).push(part);
    return this;
  }

  /** Mirror helper: adds the part at +x and -x (rotation y/z mirrored). */
  pair(geo, color, x, y, z, opts = {}) {
    this.add(geo, color, x, y, z, opts);
    const rot = opts.rot ? [opts.rot[0], -opts.rot[1], -opts.rot[2]] : undefined;
    return this.add(geo, color, -x, y, z, { ...opts, rot });
  }

  bake() { return { geo: bakeParts(this.parts), glowGeo: bakeParts(this.glow) }; }
}

function bakeParts(parts) {
  if (!parts.length) return null;
  let nv = 0, ni = 0;
  for (const p of parts) {
    nv += p.geo.attributes.position.count;
    ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const rm = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    _e.set(p.rot[0], p.rot[1], p.rot[2]);
    _q.setFromEuler(_e);
    _p.set(p.x, p.y, p.z);
    _s.set(p.s[0], p.s[1], p.s[2]);
    _m.compose(_p, _q, _s);
    _n3.getNormalMatrix(_m);
    _c.set(p.color);
    const P = p.geo.attributes.position, N = p.geo.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize();
      nor[(vo + i) * 3] = _v.x; nor[(vo + i) * 3 + 1] = _v.y; nor[(vo + i) * 3 + 2] = _v.z;
      // baked directional AO: tops catch sky light, undersides go dark
      const ao = p.ao ? 0.72 + 0.28 * (0.5 + 0.5 * _v.y) : 1;
      col[(vo + i) * 3] = _c.r * ao; col[(vo + i) * 3 + 1] = _c.g * ao; col[(vo + i) * 3 + 2] = _c.b * ao;
      rm[(vo + i) * 2] = p.r; rm[(vo + i) * 2 + 1] = p.m;
    }
    if (p.geo.index) {
      const I = p.geo.index.array;
      for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
      io += I.length;
    } else {
      for (let i = 0; i < P.count; i++) idx[io + i] = vo + i;
      io += P.count;
    }
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('rm', new THREE.BufferAttribute(rm, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * PBR material whose roughness/metalness come from the baked `rm`
 * attribute. All instances share ONE program (customProgramCacheKey),
 * so per-entity clones (hit flash, cloak opacity) cost no compile.
 */
export function RMMaterial(params = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, ...params });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 rm;\nvarying vec2 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRM;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vRM.y;');
  };
  m.customProgramCacheKey = () => 'rm-pbr-1';
  return m;
}

/** Unlit glow material for baked emissive parts (bloom picks them up). */
export function GlowMaterial(intensity = 2.2, params = {}) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, ...params });
  m.color.setScalar(intensity);
  return m;
}

/** Mesh from a baked geometry (null-safe). */
export function bakedMesh(geo, mat, parent, { cast = true, receive = false } = {}) {
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (parent) parent.add(mesh);
  return mesh;
}
