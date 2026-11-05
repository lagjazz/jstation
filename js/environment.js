// ============================================================
// environment.js — HDR environment lighting for PBR.
// Tries the real HDR first (assets/hdr/*.hdr); otherwise builds a
// procedural night-sky equirectangular HDR DataTexture (float32, so
// city-light "pixels" exceed 1.0 and bloom correctly). Both go
// through PMREMGenerator and drive scene.environment — the map is
// used for PBR reflections/IBL, NOT just as a background.
// ============================================================

import * as THREE from 'three';

function makeNightHDR(res = 256) {
  const w = res, h = res / 2;
  const data = new Float32Array(w * h * 4);
  const spots = [];
  const spotCount = 140;
  for (let i = 0; i < spotCount; i++) {
    const horizonBias = Math.pow(Math.random(), 2.2);      // mostly near horizon
    spots.push({
      u: Math.random(),
      v: 0.52 - horizonBias * 0.16,                        // just under horizon band
      warm: Math.random() < 0.68,
      power: 1.2 + Math.random() * 7,
      size: 0.002 + Math.random() * 0.006,
    });
  }
  for (let y = 0; y < h; y++) {
    const v = y / h;                                       // 0=top … 1=bottom
    // sky: deep night blue → slightly lighter toward horizon
    const t = Math.min(1, Math.abs(v - 0.5) / 0.5);
    const skyR = 0.008 + 0.05 * Math.pow(1 - v, 3);
    const skyG = 0.012 + 0.07 * Math.pow(1 - v, 3);
    const skyB = 0.030 + 0.14 * Math.pow(1 - v, 3);
    const glow = Math.exp(-Math.pow((v - 0.5) / 0.10, 2)) * 0.10;   // horizon city glow
    const ground = v > 0.5 ? 0.006 : 0;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let r = skyR + glow * 1.4, g = skyG + glow * 1.0, b = skyB + glow * 0.6;
      r += ground; g += ground * 1.1; b += ground * 1.4;
      // a few brighter "station window" bands
      const band = Math.max(0, Math.sin(u * Math.PI * 14)) ** 18 * (v > 0.42 && v < 0.52 ? 0.25 : 0);
      b += band; g += band * 0.8;
      data[(y * w + x) * 4 + 0] = r;
      data[(y * w + x) * 4 + 1] = g;
      data[(y * w + x) * 4 + 2] = b;
      data[(y * w + x) * 4 + 3] = 1;
    }
  }
  for (const s of spots) {
    const cx = Math.floor(s.u * w), cy = Math.floor(s.v * h);
    const rad = Math.max(1, Math.floor(s.size * w));
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const d2 = (dx * dx + dy * dy) / (rad * rad);
        if (d2 > 1) continue;
        const idx = ((((cy + dy + h) % h) * w) + ((cx + dx + w) % w)) * 4;
        const f = s.power * (1 - d2) * 0.5;
        if (s.warm) { data[idx] += f; data[idx + 1] += f * 0.62; data[idx + 2] += f * 0.3; }
        else { data[idx] += f * 0.5; data[idx + 1] += f * 0.7; data[idx + 2] += f; }
      }
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Install the environment on the scene.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Texture|null} hdrTex loaded HDR (null → procedural)
 * @param {number} envResolution resolution for the procedural fallback
 */
export function applyEnvironment(scene, renderer, hdrTex, envResolution = 256) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const src = hdrTex ?? makeNightHDR(envResolution);
  const envRT = pmrem.fromEquirectangular(src);
  scene.environment = envRT.texture;
  scene.background = envRT.texture;
  scene.backgroundIntensity = hdrTex ? 0.35 : 0.28;
  scene.environmentIntensity = hdrTex ? 0.75 : 0.85;

  scene.fog = new THREE.Fog(0x070b15, 55, 230);

  pmrem.dispose();
  if (!hdrTex) src.dispose();          // pmrem consumed the procedural source
  return envRT.texture;
}
