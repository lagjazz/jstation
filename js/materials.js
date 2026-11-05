// ============================================================
// materials.js — shared PBR materials (MeshStandard/Physical).
// One instance per material type so the GPU batches state changes;
// quality presets can toggle clearcoat / transmission here.
// ============================================================

import * as THREE from 'three';
import { TEX } from './textures.js';

function std(params) {
  return new THREE.MeshStandardMaterial(params);
}

const _painted = new Map();

export const MAT = {
  // --- architecture ---
  get floor() {
    if (!this._floor) {
      this._floor = new THREE.MeshPhysicalMaterial({
        map: TEX.marbleFloor,
        roughnessMap: TEX.floorRough,
        roughness: 0.34,
        metalness: 0.05,
        envMapIntensity: 1.35,          // wet reflective look via HDR env
        clearcoat: 0.35,
        clearcoatRoughness: 0.24,
      });
    }
    return this._floor;
  },

  get concrete() {
    if (!this._concrete) this._concrete = std({ map: TEX.concrete, roughness: 0.85, metalness: 0.0 });
    return this._concrete;
  },

  get concreteDark() {
    if (!this._concreteDark) this._concreteDark = std({ map: TEX.concreteDark, roughness: 0.9, metalness: 0.0 });
    return this._concreteDark;
  },

  get ceiling() {
    if (!this._ceiling) this._ceiling = std({ color: 0x1b1e24, map: TEX.concreteDark, roughness: 0.95 });
    return this._ceiling;
  },

  // --- metals (metalness ≈ 1, roughness 0.2~0.4) ---
  get metal() {
    if (!this._metal) this._metal = std({ map: TEX.metalBrushed, color: 0xb9bec4, metalness: 1.0, roughness: 0.32, envMapIntensity: 1.1 });
    return this._metal;
  },

  get metalDark() {
    if (!this._metalDark) this._metalDark = std({ color: 0x3c4046, metalness: 1.0, roughness: 0.42 });
    return this._metalDark;
  },

  get rail() {
    if (!this._rail) this._rail = std({ color: 0x6e747c, metalness: 1.0, roughness: 0.28 });
    return this._rail;
  },

  painted(color) {
    if (!_painted.has(color)) {
      _painted.set(color, std({ color, metalness: 0.85, roughness: 0.36, envMapIntensity: 1.0 }));
    }
    return _painted.get(color);
  },

  // --- glass (MeshPhysical transmission on HIGH/ULTRA) ---
  get glass() {
    if (!this._glass) {
      this._glass = new THREE.MeshPhysicalMaterial({
        color: 0xbfd6e8,
        metalness: 0, roughness: 0.08,
        transmission: 0.92, thickness: 0.4, ior: 1.5,
        transparent: true, opacity: 0.55,
        envMapIntensity: 1.4,
      });
    }
    return this._glass;
  },

  get glassPane() {   // emissive-ish lit display glass, never transmissive
    if (!this._glassPane) {
      this._glassPane = std({ color: 0x9db8cc, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.35 });
    }
    return this._glassPane;
  },

  // --- emissive / LED ---
  led(color = 0xdfe9ff, intensity = 1.9) {
    return new THREE.MeshStandardMaterial({
      color: 0x0c0c0c, emissive: color, emissiveIntensity: intensity, roughness: 0.5,
    });
  },

  screen(tex, intensity = 1.5) {
    return new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex,
      emissiveIntensity: intensity, roughness: 0.4,
    });
  },

  signMat(tex, intensity = 1.1) {
    return new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex,
      emissiveIntensity: intensity, roughness: 0.6,
    });
  },

  // --- misc ---
  get gravel() {
    if (!this._gravel) this._gravel = std({ map: TEX.gravel, roughness: 0.95 });
    return this._gravel;
  },

  get yellowLine() {
    if (!this._yellow) this._yellow = std({ color: 0xd9a500, emissive: 0x6b5200, emissiveIntensity: 0.25, roughness: 0.6 });
    return this._yellow;
  },

  get wood() {
    if (!this._wood) this._wood = std({ color: 0x6e4a2f, roughness: 0.75, metalness: 0 });
    return this._wood;
  },

  get plasticBlack() {
    if (!this._pb) this._pb = std({ color: 0x14161a, roughness: 0.6, metalness: 0.05 });
    return this._pb;
  },

  get luggage() {
    if (!this._luggage) this._luggage = std({ color: 0x2a3340, roughness: 0.55, metalness: 0.1 });
    return this._luggage;
  },

  get trainBody() {
    if (!this._trainBody) this._trainBody = std({ color: 0xe6e8ea, metalness: 0.55, roughness: 0.3, envMapIntensity: 1.2 });
    return this._trainBody;
  },

  get trainSkirt() {
    if (!this._trainSkirt) this._trainSkirt = std({ color: 0x565c66, metalness: 0.7, roughness: 0.45 });
    return this._trainSkirt;
  },

  get trainStripe() {
    if (!this._trainStripe) this._trainStripe = std({ color: 0xc22f27, metalness: 0.4, roughness: 0.4 });
    return this._trainStripe;
  },

  get trainWindow() {
    if (!this._trainWindow) {
      this._trainWindow = std({
        color: 0x0e1620, metalness: 0.4, roughness: 0.1,
        emissive: 0xa8c4e0, emissiveIntensity: 0.55,   // interior light bleed
      });
    }
    return this._trainWindow;
  },

  /** Apply a quality preset (clearcoat + transmission toggles). */
  setQuality(preset) {
    if (this._floor) {
      this._floor.clearcoat = preset.floorClearcoat ? 0.35 : 0.0;
      this._floor.needsUpdate = true;
    }
    if (this._glass) {
      this._glass.transmission = preset.glassTransmission ? 0.92 : 0.0;
      this._glass.opacity = preset.glassTransmission ? 0.55 : 0.28;
      this._glass.needsUpdate = true;
    }
  },
};
