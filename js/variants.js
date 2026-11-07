// ============================================================
// variants.js — per-run atmosphere variants + weather.
//
// Each time a mission is armed it may roll a variant that fits the
// setting (VARIANTS.chance): dense fog, a thunderstorm with rain and
// lightning, a power blackout with flickering lights, a red alert,
// golden dusk, or a blizzard. Variants only modulate what
// _applyAtmosphere already sets (fog, moon, exposure, tint) and add
// two cheap systems: GPU rain (one LineSegments draw call that falls
// in the vertex shader around the camera) and timed events
// (lightning / power flicker / alarm). No lights are added.
// ============================================================

import * as THREE from 'three';
import { VARIANTS } from './config.js';
import { rand } from './utils.js';

// which variants make sense where
const OUTDOOR_WET = new Set(['platform', 'garden', 'cyber', 'skyport', 'canopy', 'clockwork']);
const INDOOR = new Set(['hall', 'moon', 'tomb', 'lab', 'aquarium', 'orbit']);

export const VARIANT_INFO = {
  clear:    { en: 'CLEAR', jp: '平常' },
  fog:      { en: 'DENSE FOG', jp: '濃霧' },
  storm:    { en: 'THUNDERSTORM', jp: '雷雨' },
  blackout: { en: 'POWER FAILURE', jp: '停電' },
  alert:    { en: 'RED ALERT', jp: '警戒態勢' },
  dusk:     { en: 'GOLDEN DUSK', jp: '黄昏' },
  blizzard: { en: 'WHITEOUT', jp: '猛吹雪' },
};

export function rollVariant(area) {
  if (Math.random() > VARIANTS.chance) return 'clear';
  const opts = ['fog', 'alert'];
  if (OUTDOOR_WET.has(area)) opts.push('storm', 'storm', 'dusk');
  if (INDOOR.has(area) || area === 'cyber') opts.push('blackout', 'blackout');
  if (area === 'ice') opts.push('blizzard', 'blizzard');
  if (area === 'canyon' || area === 'garden') opts.push('dusk');
  if (area === 'atlantis' || area === 'aquarium') return Math.random() < 0.5 ? 'alert' : 'clear';
  return opts[Math.floor(Math.random() * opts.length)];
}

export class Weather {
  constructor(scene) {
    const N = 2600;
    const pos = new Float32Array(N * 2 * 3);
    const seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = rand(-1, 1), y = Math.random(), z = rand(-1, 1);
      for (let k = 0; k < 2; k++) {
        pos[(i * 2 + k) * 3] = x; pos[(i * 2 + k) * 3 + 1] = y; pos[(i * 2 + k) * 3 + 2] = z;
        seed[i * 2 + k] = k;          // 0 = head, 1 = tail of the streak
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('tail', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(0.8, 0.3) },
        uSpeed: { value: 22 }, uLen: { value: 0.55 }, uColor: { value: new THREE.Color(0.6, 0.7, 0.85) }, uAlpha: { value: 0.35 },
      },
      vertexShader: /* glsl */`
        attribute float tail;
        uniform float uT, uSpeed, uLen;
        uniform vec3 uCam;
        uniform vec2 uWind;
        varying float vA;
        void main() {
          vec3 p = position;
          float h = 22.0;
          float y = fract(p.y - uT * uSpeed / h) * h - 6.0;      // fall + wrap
          // world-anchored drops, wrapped into a 40 m window around the camera
          vec2 base = p.xz * 20.0 + uWind * (y * 0.08);
          vec3 c = uCam;
          vec3 w = vec3(0.0, y + c.y, 0.0);
          w.xz = c.xz + mod(base - c.xz + 20.0, 40.0) - 20.0;
          w += tail * vec3(uWind.x, uSpeed, uWind.y) * (uLen / uSpeed);
          vA = 1.0 - tail * 0.7;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uAlpha;
        varying float vA;
        void main() { gl_FragColor = vec4(uColor, uAlpha * vA); }`,
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 5;
    scene.add(this.lines);
    this.kind = 'clear';
    this.evT = 0;
    this.flash = 0;          // 0..1 lightning / flicker amount (read by the game)
    this.dark = 0;           // blackout dip
  }

  set(kind) {
    this.kind = kind;
    const rain = kind === 'storm';
    const snow = kind === 'blizzard';
    this.lines.visible = rain || snow;
    const u = this.mat.uniforms;
    if (snow) {
      u.uSpeed.value = 5; u.uLen.value = 0.12; u.uColor.value.setRGB(0.9, 0.95, 1); u.uAlpha.value = 0.6;
      u.uWind.value.set(4.5, 1.5);
    } else {
      u.uSpeed.value = 24; u.uLen.value = 0.6; u.uColor.value.setRGB(0.55, 0.65, 0.8); u.uAlpha.value = 0.32;
      u.uWind.value.set(0.9, 0.35);
    }
    this.evT = rand(4, 9);
    this.flash = 0;
    this.dark = 0;
  }

  /** Returns an event name when one fires this frame ('lightning' | 'flicker' | 'alarm'). */
  update(dt, camPos) {
    const u = this.mat.uniforms;
    u.uT.value += dt;
    u.uCam.value.copy(camPos);
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.dark = Math.max(0, this.dark - dt * 1.2);
    this.evT -= dt;
    if (this.evT > 0) return null;
    switch (this.kind) {
      case 'storm':
        this.evT = rand(7, 16);
        this.flash = 1;
        return 'lightning';
      case 'blackout':
        this.evT = rand(5, 11);
        this.dark = 1;
        return 'flicker';
      case 'alert':
        this.evT = rand(14, 22);
        return 'alarm';
      default:
        this.evT = 99;
        return null;
    }
  }
}
