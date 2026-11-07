// ============================================================
// collision.js — lightweight AABB world (no physics engine).
// Static boxes registered at build time; dynamic boxes (train) are
// mutated in place. Movement resolution is per-axis "move then push
// out", which is stable for a capsule-approximated body against
// wall/pillar/prop boxes at FPS speeds.
//
// Broad phase: static boxes are bucketed into a uniform XZ hash grid
// (CELL m). Every query (player move + support, each hostile's move,
// anti-stuck, spawn validation) only touches the handful of boxes in
// the cells it overlaps instead of all ~800 boxes of all 16 arenas.
// Boxes that are later "disabled" by moving them far away (icicles,
// opened doors) stay in their old cells — the narrow-phase overlap
// test rejects them, so the grid never needs rebuilding.
// ============================================================

const CELL = 4;
const OFF = 4096;                         // keeps cell indices positive
const key = (ix, iz) => (ix + OFF) * 16384 + (iz + OFF);

export class ColliderWorld {
  constructor() {
    this.staticBoxes = [];
    this.dynamicBoxes = [];
    this._all = null;
    this._grid = new Map();
    this._stamp = 1;
    this._out = [];
  }

  /** Add an axis-aligned box collider from THREE.Vector3 min/max. */
  addBox(min, max) {
    const box = { min, max, _q: 0 };
    this.staticBoxes.push(box);
    this._insert(box);
    this._all = null;
    return box;
  }

  /** Add a box whose min/max are mutated every frame (e.g. the train). */
  addDynamicBox(min, max) {
    const box = { min, max, _q: 0 };
    this.dynamicBoxes.push(box);
    this._all = null;
    return box;
  }

  /** Remove a dynamic box (runtime cover props). */
  removeDynamicBox(box) {
    const i = this.dynamicBoxes.indexOf(box);
    if (i >= 0) { this.dynamicBoxes.splice(i, 1); this._all = null; }
  }

  _insert(box) {
    const x0 = Math.floor(box.min.x / CELL), x1 = Math.floor(box.max.x / CELL);
    const z0 = Math.floor(box.min.z / CELL), z1 = Math.floor(box.max.z / CELL);
    // pathological giant boxes (sky domes, kill floors) go in a shared list
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) {
      (this._huge ??= []).push(box);
      return;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let cell = this._grid.get(k);
        if (!cell) { cell = []; this._grid.set(k, cell); }
        cell.push(box);
      }
    }
  }

  /**
   * Boxes whose cells overlap the XZ rect — a SHARED array, valid until
   * the next query (callers consume it immediately; never nest queries).
   */
  query(x0, z0, x1, z1) {
    const out = this._out;
    out.length = 0;
    const s = ++this._stamp;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let ix = cx0; ix <= cx1; ix++) {
      for (let iz = cz0; iz <= cz1; iz++) {
        const cell = this._grid.get(key(ix, iz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const b = cell[i];
          if (b._q !== s) { b._q = s; out.push(b); }
        }
      }
    }
    if (this._huge) for (const b of this._huge) out.push(b);
    for (let i = 0; i < this.dynamicBoxes.length; i++) out.push(this.dynamicBoxes[i]);
    return out;
  }

  /** Boxes near a point (radius r). Same sharing rule as query(). */
  near(x, z, r) { return this.query(x - r, z - r, x + r, z + r); }

  /** Every box as one array (cached) — for rare whole-world scans only. */
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
 * Attempt to move a cylindrical body along X then Z, clamping against
 * every nearby collider. Mutates and returns `pos` (Vector3, FOOT level).
 * `stepUp` (m): a box whose top is within stepUp of the feet and has
 * head-room above it is climbed instead of blocking (stairs, kerbs,
 * low crates) — returns with pos.y raised to that top.
 */
export function moveAndSlide(pos, dx, dz, radius, height, world, stepUp = 0) {
  const pad = radius + 0.05;
  const boxes = world.query(
    Math.min(pos.x, pos.x + dx) - pad, Math.min(pos.z, pos.z + dz) - pad,
    Math.max(pos.x, pos.x + dx) + pad, Math.max(pos.z, pos.z + dz) + pad,
  );
  let feet = pos.y;

  const tryStep = (nx, nz, b) => {
    if (stepUp <= 0) return false;
    const top = b.max.y;
    if (top <= feet || top - feet > stepUp) return false;
    for (let j = 0; j < boxes.length; j++) {           // head-room at the new height
      if (overlaps(nx, nz, radius, top + 0.01, height, boxes[j])) return false;
    }
    feet = top;
    return true;
  };

  // --- X axis ---
  let nx = pos.x + dx;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!overlaps(nx, pos.z, radius, feet, height, b)) continue;
    if (tryStep(nx, pos.z, b)) continue;
    if (dx > 0) nx = Math.min(nx, b.min.x - radius);
    else if (dx < 0) nx = Math.max(nx, b.max.x + radius);
  }
  pos.x = nx;

  // --- Z axis ---
  let nz = pos.z + dz;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!overlaps(pos.x, nz, radius, feet, height, b)) continue;
    if (tryStep(pos.x, nz, b)) continue;
    if (dz > 0) nz = Math.min(nz, b.min.z - radius);
    else if (dz < 0) nz = Math.max(nz, b.max.z + radius);
  }
  pos.z = nz;
  pos.y = feet;
  return pos;
}

/** Same slide logic for enemies (smaller radius, no jump — Y fixed). */
export function moveAndSlideSimple(pos, dx, dz, radius, height, world) {
  return moveAndSlide(pos, dx, dz, radius, height, world, 0);
}

/** True when a body footprint at (x,z) on level `y` is inside any box. */
export function blockedAt(world, x, z, r, y = 0, h = 1.7) {
  const boxes = world.near(x, z, r + 0.1);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z &&
        b.min.y < y + h && b.max.y > y + 0.05) return true;
  }
  return false;
}
