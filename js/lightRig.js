// ============================================================
// lightRig.js — a constant light budget for a forward renderer.
//
// The world asks for 53 PointLights: 16 arenas' worth, and the player stands
// in exactly one of them. In three's forward renderer every light in the
// scene is uploaded to every material and looped over per fragment, so 53
// lights cost several times the fragment work of 10 — measured on this scene:
// 825 ms/frame with 53 lights, 434 ms/frame with 10, same 469 draw calls.
//
// And it is not only the per-fragment cost: three re-keys a shader program
// whenever the light COUNT in the scene changes, so any light entering or
// leaving the graph — a weapon viewmodel becoming visible, a prop appearing
// mid-fight — forces a full recompile of every material: the multi-second
// freeze. Lights parented to hidden groups make this worse, because
// "invisible subtree" means "not in the count", so the count itself fluctuates.
//
// The rig keeps a FIXED number of PointLights in the scene forever and feeds
// them the N nearest fixtures each frame. Fixtures stay live objects — the
// flicker/pulse/alarm code in station.js and newAreas*.js keeps mutating
// them — they are simply no longer children of the scene, so they cannot
// change the light count.
// ============================================================

import * as THREE from 'three';

export class LightRig {
  /**
   * @param {THREE.Scene} scene
   * @param {number} budget how many point lights the shaders will ever hold
   */
  constructor(scene, budget = 12) {
    this.scene = scene;
    this.fixtures = [];     // { light, parent } — every point light the world built
    this.pool = [];         // the ONLY point lights that live in the scene
    this.budget = 0;
    this.updated = 0;       // fixtures considered at the last update (debug)
    this.active = 0;        // pool slots actually lit at the last update (debug)
    this._cands = [];
    this._tmp = new THREE.Vector3();
    this.setBudget(budget);
  }

  /**
   * Move every point light currently in the graph into the fixture library.
   * Called once at boot, BEFORE renderer.compile, so the compiled programs are
   * built for the pool size and never need recompiling afterwards.
   * traverse() ignores visibility, which is what we want: lights inside hidden
   * viewmodel groups are exactly the ones that would otherwise change the count.
   */
  collect() {
    const found = [];
    this.scene.traverse((o) => { if (o.isPointLight && !this.pool.includes(o)) found.push(o); });
    for (const light of found) {
      const parent = light.parent;
      if (parent) parent.remove(light);
      // Keep the parent reference: lights authored inside moving groups (train
      // cars, holo panels, the weapon viewmodel) still follow that group.
      this.fixtures.push({ light, parent: parent && parent !== this.scene ? parent : null });
    }
    return this.fixtures.length;
  }

  /** Resize the pool. Called only on a deliberate quality change (which
   *  recompiles for shadows/pixel ratio anyway), never mid-fight. */
  setBudget(n) {
    n = Math.max(1, n | 0);
    while (this.pool.length < n) {
      const l = new THREE.PointLight(0xffffff, 0, 0, 2);
      l.name = `lightRigPool${this.pool.length}`;
      this.scene.add(l);
      this.pool.push(l);
    }
    while (this.pool.length > n) this.scene.remove(this.pool.pop());
    this.budget = n;
  }

  /** World position of a fixture, following its original parent's transform. */
  _worldPos(f, out) {
    if (f.parent) out.copy(f.light.position).applyMatrix4(f.parent.matrixWorld);
    else out.copy(f.light.position);
    return out;
  }

  /** Sweep for point lights added to the graph after boot. A scene light that
   *  is not in the pool changes the shader light count, which recompiles every
   *  material — the multi-second freeze this whole file exists to prevent. So
   *  anything a future edit spawns at runtime gets adopted as a fixture instead.
   *  Walking the graph costs about a tenth of a millisecond; do it rarely. */
  _sweep() {
    // A fixture whose parent left the graph (a cleared enemy, a picked-up pod)
    // must stop lighting the world.
    this.fixtures = this.fixtures.filter((f) => {
      if (!f.parent) return true;
      let o = f.parent;
      while (o) { if (o === this.scene) return true; o = o.parent; }
      return false;
    });
    this.scene.traverse((o) => {
      if (o.isPointLight && !this.pool.includes(o) && !this.fixtures.some((f) => f.light === o)) {
        const parent = o.parent;
        if (parent) parent.remove(o);
        this.fixtures.push({ light: o, parent: parent && parent !== this.scene ? parent : null });
      }
    });
  }

  /** Feed the pool the fixtures that can actually reach the camera. */
  update(camPos) {
    if ((this._frame = (this._frame || 0) + 1) % 45 === 0) this._sweep();
    const cands = this._cands;
    cands.length = 0;
    for (const f of this.fixtures) {
      const L = f.light;
      // qualityLights are switched with .visible at LOW; intensity 0 covers the
      // pooled muzzle lights between shots.
      if (!L.visible || L.intensity <= 0) continue;
      const d2 = this._worldPos(f, this._tmp).distanceToSquared(camPos);
      const reach = (L.distance || 0) + 8;   // three fades a light to 0 at L.distance
      if (d2 > reach * reach) continue;
      cands.push({ f, d2 });
    }
    cands.sort((a, b) => a.d2 - b.d2);

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      const c = cands[i];
      if (!c) { slot.intensity = 0; continue; }   // dark slot, but still counted
      const L = c.f.light;
      slot.color.copy(L.color);
      slot.intensity = L.intensity;
      slot.distance = L.distance;
      slot.decay = L.decay;
      this._worldPos(c.f, slot.position);
    }
    this.updated = this.fixtures.length;
    this.active = Math.min(cands.length, this.pool.length);
  }

  /** Debug snapshot (window.__prof). */
  stats() {
    return { fixtures: this.fixtures.length, budget: this.budget, active: this.active };
  }
}
