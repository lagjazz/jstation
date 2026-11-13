// ============================================================
// skyline.js — the night city around the station.
//
// Replaces the old backdrop (34 boxes sharing one 128×256 window
// bitmap, stretched to whatever size each box happened to be) with
// buildings that hold up to being looked at:
//
//   • every tower is a composition — podium, shaft, set-back crown —
//     with parapets, roof plant (AC units, water tanks, lift
//     overruns), antenna masts with red aviation beacons and the odd
//     neon sign down a façade
//   • windows are drawn by the shader in WORLD space: a 2.6 m bay ×
//     3.3 m storey grid on every building regardless of its size,
//     mullions, dark glass, individually lit rooms, whole lit office
//     floors, warm/cool light mix, and a glowing shop-front strip at
//     street level
//   • three districts frame the map: across the tracks (north), and
//     — new — east and south, so the walled garden and the concourse
//     windows look out on a city instead of a void
//
// Draw cost: 4 InstancedMesh (bodies, roof plant, beacons, signs).
// ============================================================

import * as THREE from 'three';

export function layoutCity(detail = 1, rnd = Math.random) {
  const r = (a, b) => a + rnd() * (b - a);
  const towers = [];
  const district = (n, x0, x1, z0, z1, hMin, hMax) => {
    for (let i = 0; i < Math.round(n * detail); i++) {
      const w = r(9, 20), d = r(9, 18), h = r(hMin, hMax);
      towers.push({ x: r(x0, x1), z: r(z0, z1), w, d, h, rot: r(-0.25, 0.25), tiers: h > 26 ? 3 : (h > 14 ? 2 : 1) });
    }
  };
  district(30, -100, 60, 50, 110, 9, 52);     // north, across the tracks
  district(14, 64, 135, -55, 45, 12, 46);     // east, beyond the garden wall
  district(14, -35, 62, -105, -44, 10, 40);   // south
  return towers;
}

/** Boxes ({x,y,z,w,h,d,rot,tint}) + roof plant + beacons + signs for a layout. */
export function composeCity(towers, rnd = Math.random) {
  const r = (a, b) => a + rnd() * (b - a);
  const bodies = [], plant = [], beacons = [], signs = [];
  for (const t of towers) {
    const tint = [r(0.75, 1.1), r(0.78, 1.08), r(0.85, 1.15)];
    let w = t.w, d = t.d, y = -1;
    const hs = t.tiers === 3 ? [0.22, 0.56, 0.22] : (t.tiers === 2 ? [0.62, 0.38] : [1]);
    hs.forEach((f, i) => {
      const h = t.h * f;
      bodies.push({ x: t.x, y: y + h / 2, z: t.z, w, h, d, rot: t.rot, tint });
      // parapet / floor-plate lip at each set-back
      plant.push({ x: t.x, y: y + h + 0.3, z: t.z, w: w + 0.5, h: 0.6, d: d + 0.5, rot: t.rot });
      y += h;
      if (i < hs.length - 1) { w *= r(0.62, 0.82); d *= r(0.62, 0.82); }
    });
    const top = y + 0.6;
    const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
    const at = (lx, lz) => [t.x + lx * cos + lz * sin, t.z - lx * sin + lz * cos];
    // roof plant
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const [px, pz] = at(r(-w * 0.3, w * 0.3), r(-d * 0.3, d * 0.3));
      const pw = r(1.6, 3.6), ph = r(1.2, 3.2), pd = r(1.6, 3.2);
      plant.push({ x: px, y: top + ph / 2, z: pz, w: pw, h: ph, d: pd, rot: t.rot });
    }
    // masts + beacons on the tall ones
    if (t.h > 24) {
      const [mx, mz] = at(r(-w * 0.2, w * 0.2), r(-d * 0.2, d * 0.2));
      const mh = r(6, 14);
      plant.push({ x: mx, y: top + mh / 2, z: mz, w: 0.3, h: mh, d: 0.3, rot: 0 });
      beacons.push({ x: mx, y: top + mh + 0.3, z: mz });
      if (rnd() < 0.5) beacons.push({ x: mx, y: top + mh * 0.5, z: mz });
    }
    // a vertical neon sign on some façades (on the lowest tier)
    if (rnd() < 0.3) {
      const face = rnd() < 0.5 ? 1 : -1;
      const [sx, sz] = at(face * (t.w / 2 + 0.25), r(-t.d * 0.3, t.d * 0.3));
      const sh = r(5, 11);
      signs.push({ x: sx, y: r(5, Math.max(6, t.h * 0.2)) + sh / 2, z: sz, w: 0.3, h: sh, d: r(1.4, 2.4), rot: t.rot, hue: rnd() });
    }
  }
  return { bodies, plant, beacons, signs };
}

const WINDOW_VERT = /* glsl */`
  vec4 cityWP = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
  vCityP = cityWP.xyz;
  vCityN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
  vCitySeed = fract( sin( dot( instanceMatrix[3].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );`;

const WINDOW_FRAG = /* glsl */`
  {
    vec3 cn = normalize( vCityN );
    // the per-building seed arrives interpolated: snap it, or the hash below
    // turns sub-ulp differences between fragments into speckle
    float seed = floor( vCitySeed * 64.0 + 0.5 ) / 64.0;
    float wall = step( abs( cn.y ), 0.5 );
    float along = abs( cn.x ) > abs( cn.z ) ? vCityP.z : vCityP.x;
    vec2 cell = vec2( along / 2.6 + seed * 7.0, ( vCityP.y + 1.0 ) / 3.3 );
    vec2 id = floor( cell ), f = fract( cell );
    float h1 = cityHash( id + seed * 31.0 );
    float h2 = cityHash( id * 1.7 + 5.0 );
    float glass = step( 0.14, f.x ) * step( f.x, 0.86 ) * step( 0.26, f.y ) * step( f.y, 0.84 ) * wall;
    float officeFloor = step( 0.82, cityHash( vec2( id.y, seed * 91.0 ) ) );
    float lit = max( step( 0.8, h1 ), officeFloor * step( 0.35, h1 ) );
    // blinds: some lit rooms are half drawn
    float blind = mix( 1.0, step( f.y, 0.55 + h2 * 0.3 ), step( 0.6, h2 ) );
    vec3 lightCol = mix( vec3( 1.0, 0.74, 0.42 ), vec3( 0.62, 0.8, 1.0 ), step( 0.72, h2 ) );
    // street level: one continuous shop-front glow
    float shop = wall * step( vCityP.y, 3.4 ) * step( 0.4, vCityP.y ) * step( 0.08, f.x ) * step( f.x, 0.92 );
    vec3 shopCol = mix( vec3( 1.0, 0.85, 0.6 ), vec3( 0.5, 0.95, 1.0 ), step( 0.5, cityHash( vec2( id.x, seed ) ) ) );
    cityGlow = glass * lit * blind * lightCol * ( 0.45 + 0.55 * h2 ) + shop * shopCol * 0.35;
    // façade: dark glass in the bays, floor bands, vertical piers
    float pier = 1.0 - 0.25 * step( f.x, 0.06 );
    diffuseColor.rgb *= mix( pier, 0.22, glass );
    cityGlass = glass;
  }`;

function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.82, metalness: 0.1 });
  m.userData.noDetail = true;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityP;\nvarying vec3 vCityN;\nvarying float vCitySeed;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WINDOW_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCityP;
varying vec3 vCityN;
varying float vCitySeed;
vec3 cityGlow;
float cityGlass;
float cityHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${WINDOW_FRAG}`)
      .replace('#include <normal_fragment_begin>', 'roughnessFactor = mix( roughnessFactor, 0.12, cityGlass );\n#include <normal_fragment_begin>')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += cityGlow * 0.8;');
  };
  m.customProgramCacheKey = () => 'city-windows-1';
  return m;
}

export class Skyline {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'skyline';
    scene.add(this.group);
  }

  build(detail = 1) {
    const { bodies, plant, beacons, signs } = composeCity(layoutCity(detail));
    const box = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    const place = (inst, i, b) => {
      q.setFromAxisAngle(up, b.rot ?? 0);
      m4.compose(p.set(b.x, b.y, b.z), q, s.set(b.w, b.h, b.d));
      inst.setMatrixAt(i, m4);
    };

    const body = new THREE.InstancedMesh(box, facadeMaterial(), bodies.length);
    bodies.forEach((b, i) => { place(body, i, b); body.setColorAt(i, c.setRGB(...b.tint)); });
    const roof = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.9, metalness: 0.2 }), plant.length);
    plant.forEach((b, i) => place(roof, i, b));

    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const beaconGeo = new THREE.SphereGeometry(0.45, 8, 6);
    const bInst = new THREE.InstancedMesh(beaconGeo, glowMat, Math.max(1, beacons.length));
    beacons.forEach((b, i) => {
      m4.makeTranslation(b.x, b.y, b.z);
      bInst.setMatrixAt(i, m4);
      bInst.setColorAt(i, c.setRGB(3.2, 0.25, 0.15));
    });
    bInst.count = beacons.length;
    const sInst = new THREE.InstancedMesh(box, glowMat, Math.max(1, signs.length));
    signs.forEach((b, i) => {
      place(sInst, i, b);
      c.setHSL(b.hue, 0.9, 0.55).multiplyScalar(2.2);
      sInst.setColorAt(i, c);
    });
    sInst.count = signs.length;

    for (const m of [body, roof, bInst, sInst]) {
      m.frustumCulled = false;
      m.userData.noDetail = true;
      this.group.add(m);
    }
    // distant haze wall behind the northern district
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(420, 100), new THREE.MeshBasicMaterial({ color: 0x0a1020, fog: true }));
    haze.position.set(-20, 34, 138);
    this.group.add(haze);
    this.stats = { towers: bodies.length, plant: plant.length, beacons: beacons.length, signs: signs.length };
    return this.stats;
  }
}
