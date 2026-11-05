// ============================================================
// collision.js — lightweight AABB world (no physics engine).
// Static boxes registered at build time; one dynamic box (train).
// Movement resolution is per-axis "move then push out", which is
// stable for a capsule-approximated player against wall/pillar/prop
// boxes at FPS speeds.
// ============================================================

export class ColliderWorld {
  constructor() {
    this.staticBoxes = [];
    this.dynamicBoxes = [];
    this._all = null;
  }

  /** Add an axis-aligned box collider from THREE.Vector3 min/max. */
  addBox(min, max) {
    const box = { min, max };
    this.staticBoxes.push(box);
    this._all = null;
    return box;
  }

  /** Add a box whose min/max are mutated every frame (e.g. the train). */
  addDynamicBox(min, max) {
    const box = { min, max };
    this.dynamicBoxes.push(box);
    this._all = null;
    return box;
  }

  /**
   * All boxes as one array. moveAndSlide pulls this once per moving body
   * per frame (player + every hostile), so the concat is cached and only
   * rebuilt when boxes change — the sim stays allocation-free.
   */
  all() {
    if (!this._all) {
      this._all = this.dynamicBoxes.length ? this.staticBoxes.concat(this.dynamicBoxes) : this.staticBoxes;
    }
    return this._all;
  }
}

/** True if the vertical cylinder (circle in XZ + foot..head in Y) overlaps box. */
function overlaps(px, pz, radius, feetY, height, b) {
  return (
    px + radius > b.min.x && px - radius < b.max.x &&
    pz + radius > b.min.z && pz - radius < b.max.z &&
    feetY + height > b.min.y && feetY < b.max.y
  );
}

/**
 * Attempt to move a cylindrical player along X then Z, clamping against
 * every collider. Mutates and returns `pos` (Vector3, at FOOT level for Y).
 */
export function moveAndSlide(pos, dx, dz, radius, height, world) {
  const boxes = world.all();
  const feet = pos.y;

  // --- X axis ---
  let nx = pos.x + dx;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!overlaps(nx, pos.z, radius, feet, height, b)) continue;
    if (dx > 0) nx = Math.min(nx, b.min.x - radius);
    else if (dx < 0) nx = Math.max(nx, b.max.x + radius);
  }
  pos.x = nx;

  // --- Z axis ---
  let nz = pos.z + dz;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!overlaps(pos.x, nz, radius, feet, height, b)) continue;
    if (dz > 0) nz = Math.min(nz, b.min.z - radius);
    else if (dz < 0) nz = Math.max(nz, b.max.z + radius);
  }
  pos.z = nz;

  return pos;
}

/** Same slide logic for enemies (smaller radius, no jump — Y fixed). */
export function moveAndSlideSimple(pos, dx, dz, radius, height, world) {
  return moveAndSlide(pos, dx, dz, radius, height, world);
}
