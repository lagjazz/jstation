// ============================================================
// store.js — “駅コンビニ STATION MARKET”: glass storefront with
// auto-sliding doors, shelves with low-poly products, fridge,
// register counter, warm interior light + ambient hum anchor.
// ============================================================

import * as THREE from 'three';
import { MAT } from './materials.js';
import { TEX } from './textures.js';
import { LAYOUT } from './layout.js';
import { addBox, addAABB } from './build.js';
import { damp, rand } from './utils.js';

const S = LAYOUT.store;

export class Store {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.raycastMeshes = [];
    this.qualityLights = [];
    this.openness = 0;
    this.doorA = null;
    this.doorB = null;
    this.humAnchor = new THREE.Object3D();
  }

  build() {
    const { scene, world, raycastMeshes: rc } = this;
    const cx = (S.x0 + S.x1) / 2;
    const cz = (S.z0 + S.z1) / 2;

    // interior floor (lighter tile)
    const storeFloorMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.3, metalness: 0.05, envMapIntensity: 1.1 });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(S.x1 - S.x0, S.z1 - S.z0), storeFloorMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(cx, 0.012, cz);
    f.receiveShadow = true;
    f.userData.tag = 'concrete';
    scene.add(f);
    rc.push(f);

    // walls: east (x1), south (z0), partial north
    addBox(scene, { w: 0.3, h: S.h, d: 9.6, mat: MAT.concrete, x: S.x1 + 0.15, y: S.h / 2, z: cz, collide: world, raycast: rc });
    addBox(scene, { w: 9.6, h: S.h, d: 0.3, mat: MAT.concrete, x: cx, y: S.h / 2, z: S.z0 - 0.15, collide: world, raycast: rc });
    addBox(scene, { w: 9.6, h: 0.35, d: 9.6, mat: MAT.ceiling, x: cx, y: S.h + 0.15, z: cz, cast: false, raycast: rc });

    // ---- storefront wall at x = S.x0 with entrance opening z -8.6..-6.4
    const frontGlassMat = MAT.glass;
    addBox(scene, { w: 0.07, h: 3.2, d: 4.4, mat: frontGlassMat, x: S.x0, y: 1.6, z: -10.8, raycast: rc, tag: 'glass', cast: false });   // panel south of door
    addBox(scene, { w: 0.07, h: 3.2, d: 2.4, mat: frontGlassMat, x: S.x0, y: 1.6, z: -5.2, raycast: rc, tag: 'glass', cast: false });     // panel north of door
    world.addBox(new THREE.Vector3(S.x0 - 0.15, 0, S.z0), new THREE.Vector3(S.x0 + 0.15, S.h, -8.6));
    world.addBox(new THREE.Vector3(S.x0 - 0.15, 0, -6.4), new THREE.Vector3(S.x0 + 0.15, S.h, S.z1));

    // header beam + posts
    addBox(scene, { w: 0.34, h: 0.3, d: 9.6, mat: MAT.metalDark, x: S.x0, y: 3.35, z: cz, cast: true });
    for (const dz of [-8.6, -6.4]) {
      addBox(scene, { w: 0.16, h: 3.2, d: 0.16, mat: MAT.metalDark, x: S.x0, y: 1.6, z: dz });
    }

    // auto sliding doors (open toward sides along z)
    const doorMat = MAT.glassPane;
    this.doorA = addBox(scene, { w: 0.05, h: 2.7, d: 1.15, mat: doorMat, x: S.x0, y: 1.37, z: -8.02, tag: 'glass', raycast: rc, cast: false });
    this.doorB = addBox(scene, { w: 0.05, h: 2.7, d: 1.15, mat: doorMat, x: S.x0, y: 1.37, z: -6.98, tag: 'glass', raycast: rc, cast: false });
    this.doorBaseA = -8.02;
    this.doorBaseB = -6.98;

    // illuminated sign above entrance (faces the hall, -X)
    const signMat = MAT.signMat(TEX.storeSign, 1.5);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), signMat);
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(S.x0 - 0.2, 4.05, cz + 1.5);
    scene.add(sign);
    sign.userData.tag = 'metal';
    rc.push(sign);
    const signBack = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), signMat);
    signBack.rotation.y = Math.PI / 2;
    signBack.position.set(S.x0 + 0.2, 4.05, cz + 1.5);
    scene.add(signBack);

    // ---- shelves ----
    const shelfMat = MAT.metalDark;
    const shelfDefs = [
      [4.6, -10.6, 0], [7.2, -10.6, 0], [4.6, -7.6, 0], [7.2, -7.6, 0],
    ];
    const productGeo = new THREE.BoxGeometry(0.16, 0.22, 0.16);
    const productMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
    const products = new THREE.InstancedMesh(productGeo, productMat, 96);
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let pi = 0;
    for (const [sx, sz] of shelfDefs) {
      addBox(scene, { w: 0.6, h: 1.7, d: 2.3, mat: shelfMat, x: sx, y: 0.85, z: sz, collide: world, raycast: rc, tag: 'metal' });
      for (const shelfY of [0.55, 1.05, 1.55]) {
        for (let k = 0; k < 8; k++) {
          const px = sx + rand(-0.18, 0.18);
          const pz = sz + (k - 3.5) * 0.27;
          mtx.makeTranslation(px, shelfY + 0.13, pz);
          products.setMatrixAt(pi, mtx);
          products.setColorAt(pi, col.setHSL(Math.random(), 0.55, 0.5 + rand(-0.1, 0.1)));
          pi++;
        }
      }
    }
    products.count = pi;
    products.castShadow = true;
    products.userData.tag = 'wood';
    scene.add(products);
    rc.push(products);

    // ---- fridge (east wall) ----
    addBox(scene, { w: 0.7, h: 2.1, d: 2.6, mat: MAT.metalDark, x: S.x1 - 0.45, y: 1.05, z: -11.4, collide: world, raycast: rc, tag: 'metal' });
    const fridgeGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.8), new THREE.MeshStandardMaterial({
      color: 0xbfe0f2, transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.3,
      emissive: 0x9fd0e8, emissiveIntensity: 0.4,
    }));
    fridgeGlass.rotation.y = -Math.PI / 2;
    fridgeGlass.position.set(S.x1 - 0.81, 1.15, -11.4);
    fridgeGlass.userData.tag = 'glass';
    scene.add(fridgeGlass);
    rc.push(fridgeGlass);

    // ---- register counter ----
    addBox(scene, { w: 1.7, h: 0.95, d: 0.55, mat: MAT.plasticBlack, x: S.x0 + 1.3, y: 0.475, z: -4.9, collide: world, raycast: rc, tag: 'wood' });
    const posScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), MAT.led(0x7dff9a, 1.2));
    posScreen.position.set(S.x0 + 1.3, 1.12, -4.75);
    posScreen.rotation.x = -0.4;
    scene.add(posScreen);

    // ---- interior warm light ----
    const warm = new THREE.PointLight(0xffd9a0, 26, 14, 2);
    warm.position.set(cx, 2.9, cz);
    scene.add(warm);
    this.qualityLights.push(warm);
    for (const lz of [S.z0 + 1.5, S.z1 - 1.5]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 3.4), MAT.led(0xfff2d8, 2.0));
      strip.position.set(cx, S.h - 0.06, lz);
      scene.add(strip);
    }

    this.humAnchor.position.set(cx, 1.6, cz);
    scene.add(this.humAnchor);
  }

  update(dt, playerPos) {
    const inZone = playerPos
      && playerPos.x > S.x0 - 3.2 && playerPos.x < S.x0 + 2.5
      && playerPos.z > -10.8 && playerPos.z < -4.2;
    const target = inZone ? 1 : 0;
    this.openness = damp(this.openness, target, 7, dt);
    this.doorA.position.z = this.doorBaseA - this.openness * 1.02;
    this.doorB.position.z = this.doorBaseB + this.openness * 1.02;
  }
}
