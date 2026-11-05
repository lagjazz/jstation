// ============================================================
// assetManager.js — loads GLB / GLTF / HDR / Texture / Audio with
// LoadingManager progress, caching, and safe fallbacks: a missing
// asset NEVER crashes the game, it logs and the procedural fallback
// is used instead.
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export class AssetManager {
  constructor() {
    this.manager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.manager);
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.hdrLoader = new RGBELoader(this.manager);
    this.cache = new Map();      // url -> loaded payload
    this.failed = new Set();     // urls that 404'd (fallback in use)
    this.fallbackNotices = [];   // user-visible list for the loading screen
  }

  /** Current manager progress 0..1 (before first item is known: 0). */
  get progress() {
    return this.manager.total ? this.manager.itemsLoaded / this.manager.total : 0;
  }

  has(key) {
    return this.cache.has(key) && this.cache.get(key) != null;
  }

  get(key) {
    return this.cache.get(key) ?? null;
  }

  /**
   * Load a GLB with a hard timeout so a missing file (404 or CORS hang)
   * never blocks boot. Resolves {scene, animations, meshes} or null.
   */
  async loadGLTF(key, url, timeoutMs = 4500) {
    try {
      const gltf = await Promise.race([
        new Promise((resolve, reject) => {
          this.gltfLoader.load(
            url,
            (g) => resolve(g),
            undefined,
            (e) => reject(e ?? new Error('GLTF load failed')),
          );
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);

      // Post-process per spec: shadows, material updates.
      const meshes = [];
      gltf.scene.traverse((object) => {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          if (object.material) object.material.needsUpdate = true;
          meshes.push(object);
        }
      });

      const payload = {
        scene: gltf.scene,
        animations: gltf.animations ?? [],
        meshes,
      };
      this.cache.set(key, payload);
      return payload;
    } catch (err) {
      this.failed.add(url);
      this.fallbackNotices.push(`${key}: fallback model (GLB unavailable)`);
      console.warn(`[AssetManager] GLB "${url}" unavailable — procedural fallback. (${err.message})`);
      return null;
    }
  }

  /** Load an HDR (equirect .hdr → scene.environment). null on failure. */
  async loadHDR(key, url, timeoutMs = 4500) {
    try {
      const tex = await Promise.race([
        new Promise((resolve, reject) => {
          this.hdrLoader.load(
            url,
            (t) => resolve(t),
            undefined,
            (e) => reject(e ?? new Error('HDR load failed')),
          );
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      this.cache.set(key, tex);
      return tex;
    } catch (err) {
      this.failed.add(url);
      this.fallbackNotices.push('HDR: procedural night environment used');
      console.warn(`[AssetManager] HDR "${url}" unavailable — procedural environment. (${err.message})`);
      return null;
    }
  }

  /** Optional texture drop-in (kept for future asset swaps). */
  async loadTexture(key, url) {
    try {
      const tex = await this.textureLoader.loadAsync(url);
      this.cache.set(key, tex);
      return tex;
    } catch (err) {
      this.failed.add(url);
      return null;
    }
  }

  /**
   * Try to fetch an audio file; resolves decoded AudioBuffer or null.
   * Uses fetch so a 404 is cheap and never hits THREE's audio pipeline.
   */
  async loadAudioBuffer(audioCtx, key, url, timeoutMs = 4000) {
    try {
      const res = await Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const buf = await audioCtx.decodeAudioData(bytes);
      this.cache.set(key, buf);
      return buf;
    } catch (err) {
      this.failed.add(url);
      this.fallbackNotices.push(`${key}: synthesized sound (audio file unavailable)`);
      return null;
    }
  }
}
