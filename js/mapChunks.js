// ============================================================
// mapChunks.js — big-map manager primitives (moremaps2.md brief):
// every themed world is a THREE.Group split into a grid of CHUNKS;
// only the chunks the player can actually see (within the mission's
// fog distance) are rendered, so a map can grow several times bigger
// without the draw-call budget growing with it.
//
//   const grid = new ChunkGrid(parentGroup, X0, Z0, X1, Z1, 17);
//   grid.at(x, z).add(mesh);      // route a prop to its chunk
//   grid.core.add(bigBackdrop);   // backdrop / world-spanning InstancedMesh
//   grid.update(px, pz);          // per frame: activate visible chunks
//
// Colliders and bullet raycast arrays stay global (a hidden wall still
// blocks and still stops bullets), so visibility gating is purely a
// rendering optimization — it never changes gameplay geometry.
// Lights are scene-root fixtures (lightRig) and are never chunked.
// ============================================================

import * as THREE from 'three';

export class ChunkGrid {
  /**
   * @param parent the world's THREE.Group
   * @param cell   chunk edge length in meters (~16-18 for 50-90 m arenas)
   */
  constructor(parent, x0, z0, x1, z1, cell = 17) {
    this.parent = parent;
    this.cell = cell;
    this.cells = [];
    this.core = new THREE.Group();
    this.core.name = 'core';
    parent.add(this.core);
    for (let x = x0; x < x1; x += cell) {
      for (let z = z0; z < z1; z += cell) {
        const cx = Math.min(x + cell, x1), cz = Math.min(z + cell, z1);
        const g = new THREE.Group();
        g.name = `chunk:${x|0},${z|0}`;
        parent.add(g);
        // center + half-extent for a cheap rect-distance test
        this.cells.push({ g, mx: (x + cx) / 2, mz: (z + cz) / 2,
          hx: (cx - x) / 2, hz: (cz - z) / 2 });
      }
    }
    this.active = this.cells.length;
  }

  /** The chunk group a world position belongs to (fallback: core). */
  at(x, z) {
    let best = null, bd = Infinity;
    for (const c of this.cells) {
      const dx = Math.max(0, Math.abs(x - c.mx) - c.hx);
      const dz = Math.max(0, Math.abs(z - c.mz) - c.hz);
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = c; }
    }
    return best ? best.g : this.core;
  }

  /** Show only chunks within viewDist of the player (0.5 s of hysteresis
   *  worth of margin baked into viewDist by the caller). */
  update(px, pz, viewDist = 90) {
    let n = 0;
    for (const c of this.cells) {
      const dx = Math.max(0, Math.abs(px - c.mx) - c.hx);
      const dz = Math.max(0, Math.abs(pz - c.mz) - c.hz);
      const vis = (dx * dx + dz * dz) < viewDist * viewDist;
      if (c.g.visible !== vis) c.g.visible = vis;
      if (vis) n++;
    }
    this.active = n;
  }
}

/**
 * LOD helper: build a decoration twice (hi = full detail, lo = merged /
 * flat-shaded stand-in) and swap by camera distance. Used for far
 * silhouettes: cliff walls, gear clusters, distant skyline blocks.
 * THREE.LOD measures distance to ITS OWN position — in this codebase
 * clusters are authored at absolute world coords inside origin groups,
 * so we recentre: the LOD node moves to the cluster's bbox center and
 * the children shift back by the same amount (render result unchanged,
 * distance now measured to the cluster, not to world origin).
 */
export function lodNode(hi, lo, dist = 60) {
  const box = new THREE.Box3().setFromObject(hi);
  const c = new THREE.Vector3();
  if (box.isEmpty()) c.set(0, 0, 0); else box.getCenter(c);
  hi.position.sub(c);
  if (lo) lo.position.sub(c);
  const lod = new THREE.LOD();
  lod.position.copy(c);
  lod.addLevel(hi, 0);
  if (lo) lod.addLevel(lo, dist);
  return lod;
}

/** Simple far stand-in: one flat-color box approximating a group's bbox. */
export function bboxProxy(group, color = 0x444444) {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3(); box.getSize(size);
  const ctr = new THREE.Vector3(); box.getCenter(ctr);
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.2, size.x), Math.max(0.2, size.y), Math.max(0.2, size.z)),
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }));
  m.position.copy(ctr);
  const g = new THREE.Group(); g.add(m);
  return g;
}

/**
 * onBeforeCompile splat: blend 3 procedural maps by cheap 2-octave value
 * noise + height (terrain "splatting" à la moremaps2.md, keeps full PBR
 * + lightRig compatibility because it patches MeshStandardMaterial).
 * mats = [base, blendA, blendB]; noise scale n; boundary softness e.
 */
export function splatShader(mat, mapA, mapB, { n = 0.11, e = 0.25 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMapA = { value: mapA };
    shader.uniforms.uMapB = { value: mapB };
    shader.uniforms.uN = { value: n };
    shader.uniforms.uE = { value: e };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSplatPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplatPos = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSplatPos;
uniform sampler2D uMapA; uniform sampler2D uMapB;
uniform float uN; uniform float uE;
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453);
  float b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
  float c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453);
  float d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }`)
      .replace('#include <map_fragment>', `
float s1 = vnoise(vSplatPos.xz * uN);
float s2 = vnoise(vSplatPos.xz * uN * 3.1 + 41.0);
float sa = smoothstep(0.5 - uE, 0.5 + uE, s1);
float sb = smoothstep(0.42 - uE, 0.48 + uE, s2 * sa);
vec4 sc = diffuseColor;
vec2 suv = vSplatPos.xz;
vec3 mA = texture2D(uMapA, suv * 0.10).rgb;
vec3 mB = texture2D(uMapB, suv * 0.13).rgb;
vec3 mS = mix(diffuseColor.rgb, mix(mA, mB, clamp(sb/(max(sa,0.001)),0.0,1.0)), max(sa, sb*0.6));
diffuseColor = vec4(mS, sc.a);`);
  };
  mat.customProgramCacheKey = () => 'splat';
  return mat;
}
