// ============================================================
// postfx.js — final "camera" grade, one full-screen pass after the
// OutputPass (display space):
//   • filmic contrast curve + saturation + shadow/highlight split-tone
//     (cool shadows, warm highlights) — less flat CG, more lens
//   • lens vignette and subtle edge chromatic aberration
//   • animated film grain (breaks up banding in fog gradients)
//   • gameplay feedback: low-HP desaturation + red edge pulse,
//     OVERDRIVE magenta rim, HASTE cyan rim, lightning flash, scope
// Cost: one texture read ×3 (CA) per pixel; LOW preset disables it.
// ============================================================

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uHurt: { value: 0 },        // 0..1 low-HP strength
    uPulse: { value: 0 },       // heartbeat pulse
    uBuff: { value: new THREE.Vector3(0, 0, 0) },   // overdrive, haste, flash
    uScope: { value: 0 },
    uGrain: { value: 0.035 },
    uSat: { value: 1.08 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uHurt, uPulse, uScope, uGrain, uSat, uContrast;
    uniform vec2 uRes;
    uniform vec3 uBuff, uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // chromatic aberration grows toward the frame edge
      float ca = 0.0016 * r2 * 4.0 + uHurt * 0.002;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      // grade: contrast S-curve around mid grey, saturation, split tone
      col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uHurt * 0.65));
      vec3 shadowT = vec3(0.94, 0.98, 1.06), highT = vec3(1.05, 1.0, 0.94);
      col *= mix(shadowT, highT, smoothstep(0.15, 0.8, l));
      col *= uTint;
      // vignette (+ red edge pulse when hurt, buff rims)
      float vig = smoothstep(0.85, 0.2, r2 * 1.6);
      col *= mix(0.62, 1.0, vig);
      float edge = smoothstep(0.12, 0.42, r2);
      col = mix(col, vec3(0.75, 0.02, 0.02), edge * uHurt * (0.35 + 0.35 * uPulse));
      col += edge * (uBuff.x * vec3(0.35, 0.02, 0.18) + uBuff.y * vec3(0.0, 0.25, 0.3));
      col += uBuff.z * vec3(0.55, 0.6, 0.75);
      // scope: hard circular mask
      if (uScope > 0.01) {
        vec2 a = c * vec2(uRes.x / uRes.y, 1.0);
        float d = length(a);
        float mask = smoothstep(0.43, 0.41, d);
        col *= mix(1.0, mask, uScope);
      }
      // grain
      float g = hash(vUv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
      col += g * uGrain * (1.0 - l * 0.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createGradePass() {
  const pass = new ShaderPass(GradeShader);
  pass.material.toneMapped = false;
  return pass;
}
