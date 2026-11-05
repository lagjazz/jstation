// ============================================================
// build.js — tiny scene-assembly helpers shared by station / store /
// platform / train builders. Keeps those modules declarative.
// ============================================================

import * as THREE from 'three';
import { MAT } from './materials.js';

const _boxGeoCache = new Map();
export function cachedBox(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!_boxGeoCache.has(key)) _boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return _boxGeoCache.get(key);
}

/**
 * Add a box mesh. opts: {w,h,d,mat,x,y,z,rotY,tag,cast,receive,raycast[],collide[]}
 *  - raycast: array to push into (bullet / line-of-sight targets)
 *  - collide: ColliderWorld to register an AABB into (axis-aligned;
 *             90° rotations are accounted for, arbitrary angles are not)
 */
export function addBox(scene, opts) {
  const { w, h, d, mat, x, y, z, rotY = 0, tag = 'concrete',
    cast = true, receive = true, raycast = null, collide = null } = opts;
  const mesh = new THREE.Mesh(cachedBox(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.userData.tag = tag;
  scene.add(mesh);
  if (raycast) raycast.push(mesh);
  if (collide) {
    const fw = rotY ? d : w;
    const fd = rotY ? w : d;
    collide.addBox(
      new THREE.Vector3(x - fw / 2, y - h / 2, z - fd / 2),
      new THREE.Vector3(x + fw / 2, y + h / 2, z + fd / 2),
    );
  }
  return mesh;
}

/** Register a plain AABB (center + full size). */
export function addAABB(world, x, y, z, w, h, d) {
  world.addBox(
    new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
    new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
  );
}

/** Tag an entire loaded GLB subtree with an impact-material tag. */
export function tagTree(root, tag) {
  root.traverse((o) => { if (o.isMesh) o.userData.tag = tag; });
}

/** Japanese-station bench: wood seat + backrest, metal legs. */
export function makeBench(scene, world, raycast, x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);

  const seat = new THREE.Mesh(cachedBox(1.8, 0.08, 0.48), MAT.wood);
  seat.position.y = 0.46; seat.castShadow = seat.receiveShadow = true;
  seat.userData.tag = 'wood';
  g.add(seat);

  const back = new THREE.Mesh(cachedBox(1.8, 0.42, 0.07), MAT.wood);
  back.position.set(0, 0.78, -0.22); back.rotation.x = -0.18;
  back.castShadow = true; back.userData.tag = 'wood';
  g.add(back);

  for (const sx of [-0.75, 0.75]) {
    const leg = new THREE.Mesh(cachedBox(0.08, 0.46, 0.44), MAT.metalDark);
    leg.position.set(sx, 0.23, 0); leg.castShadow = true;
    leg.userData.tag = 'metal';
    g.add(leg);
  }

  const fw = rotY ? 0.9 : 2.0;
  const fd = rotY ? 2.0 : 0.9;
  world.addBox(
    new THREE.Vector3(x - fw / 2, 0, z - fd / 2),
    new THREE.Vector3(x + fw / 2, 0.9, z + fd / 2),
  );
  raycast.push(seat, back);
  return g;
}

/** Double-sided textured sign panel (emissive for bloom). */
export function makeSign(scene, { tex, w, h, x, y, z, rotY = 0, intensity = 1.1, raycast = null, cast = false }) {
  const mat = MAT.signMat(tex, intensity);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.material.side = THREE.DoubleSide;
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = cast;
  mesh.userData.tag = 'metal';
  scene.add(mesh);
  if (raycast) raycast.push(mesh);
  return mesh;
}
