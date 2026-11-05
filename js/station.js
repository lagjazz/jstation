// ============================================================
// station.js — the main hall: marble floor, walls, ceiling with LED
// strips, metal columns, ticket gates, vending machines, benches,
// trash, luggage, hanging Japanese signage, ad billboards, info
// screens, ticket office and the sakura-garden partition.
// Registers AABB colliders + bullet raycast meshes.
// ============================================================

import * as THREE from 'three';
import { MAT } from './materials.js';
import { TEX } from './textures.js';
import { LAYOUT } from './layout.js';
import { addBox, makeBench, makeSign } from './build.js';
import { rand, randPick } from './utils.js';

const H = LAYOUT.hall;

export class Station {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.raycastMeshes = [];
    this.qualityLights = [];
    this.flickerLights = [];
  }

  build() {
    const { scene, world, raycastMeshes: rc } = this;
    const wall = MAT.concrete;

    // ---------- floor (hall + platform one slab) ----------
    const floorGeo = new THREE.PlaneGeometry(72, 48);
    const floor = new THREE.Mesh(floorGeo, MAT.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(-7, 0, 3);
    floor.receiveShadow = true;
    floor.userData.tag = 'concrete';
    scene.add(floor);
    rc.push(floor);

    // ---------- ceiling ----------
    addBox(scene, { w: 53, h: 0.45, d: 31, mat: MAT.ceiling, x: -14, y: 9.25, z: -1, cast: false, receive: true, raycast: rc, tag: 'concrete' });

    // ---------- perimeter walls ----------
    addBox(scene, { w: 53, h: 9, d: 0.5, mat: wall, x: -14.5, y: 4.5, z: H.z0 - 0.25, collide: world, raycast: rc });  // south
    addBox(scene, { w: 0.5, h: 9, d: 31, mat: wall, x: H.x0 - 0.25, y: 4.5, z: -1, collide: world, raycast: rc });     // west
    addBox(scene, { w: 0.5, h: 9, d: 6.5, mat: wall, x: H.x1 + 0.25, y: 4.5, z: -13, collide: world, raycast: rc });   // east (store side, below garden)

    // ---------- sakura garden partition (glass) + garden walls ----------
    // glass wall at x=12 with a pedestrian opening at z 2..6
    addBox(scene, { w: 0.12, h: 3.6, d: 12, mat: MAT.glass, x: 12, y: 1.8, z: -4, raycast: rc, tag: 'glass', cast: false });
    addBox(scene, { w: 0.12, h: 3.6, d: 8, mat: MAT.glass, x: 12, y: 1.8, z: 10, raycast: rc, tag: 'glass', cast: false });
    addBox(scene, { w: 0.3, h: 0.25, d: 12, mat: MAT.metalDark, x: 12, y: 3.75, z: -4, cast: false });
    addBox(scene, { w: 0.3, h: 0.25, d: 8, mat: MAT.metalDark, x: 12, y: 3.75, z: 10, cast: false });
    world.addBox(new THREE.Vector3(11.8, 0, -10), new THREE.Vector3(12.2, 3.9, 2));   // collider w (opening z2..6)
    world.addBox(new THREE.Vector3(11.8, 0, 6), new THREE.Vector3(12.2, 3.9, 14));    // collider e
    // garden east + south walls
    addBox(scene, { w: 0.4, h: 6, d: 24, mat: wall, x: 26.2, y: 3, z: 2, collide: world, raycast: rc });
    addBox(scene, { w: 14.5, h: 6, d: 0.4, mat: wall, x: 19, y: 3, z: -10.2, collide: world, raycast: rc });
    // garden gravel
    const gravel = new THREE.Mesh(new THREE.PlaneGeometry(14, 24), MAT.gravel);
    gravel.rotation.x = -Math.PI / 2;
    gravel.position.set(19, 0.015, 2);
    gravel.receiveShadow = true;
    gravel.userData.tag = 'concrete';
    scene.add(gravel);
    rc.push(gravel);

    // ---------- structural ceiling beams ----------
    const beamGeo = cachedBeams();
    const beams = new THREE.InstancedMesh(beamGeo, MAT.metalDark, 7);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 7; i++) {
      mtx.makeTranslation(-36 + i * 8, 8.62, -1);
      beams.setMatrixAt(i, mtx);
    }
    beams.castShadow = true;
    scene.add(beams);

    // ---------- metal columns ----------
    const colGeo = new THREE.CylinderGeometry(0.42, 0.46, 9, 14);
    const colPositions = [
      [-32, -7], [-22, -7], [-12, -7],
      [-32, 7], [-22, 7], [-12, 7], [-2, 7], [8, 7],
    ];
    const cols = new THREE.InstancedMesh(colGeo, MAT.metal, colPositions.length);
    cols.castShadow = cols.receiveShadow = true;
    cols.userData.tag = 'metal';
    colPositions.forEach(([cx, cz], i) => {
      mtx.makeTranslation(cx, 4.5, cz);
      cols.setMatrixAt(i, mtx);
      world.addBox(new THREE.Vector3(cx - 0.5, 0, cz - 0.5), new THREE.Vector3(cx + 0.5, 9, cz + 0.5));
    });
    scene.add(cols);
    rc.push(cols);

    // hall/platform separator column row (z ≈ 13.6)
    const rowGeo = new THREE.CylinderGeometry(0.3, 0.34, 9, 12);
    const rowN = 9;
    const row = new THREE.InstancedMesh(rowGeo, MAT.metalDark, rowN);
    row.castShadow = true;
    row.userData.tag = 'metal';
    for (let i = 0; i < rowN; i++) {
      const cx = -38 + i * 6;
      mtx.makeTranslation(cx, 4.5, 13.6);
      row.setMatrixAt(i, mtx);
      world.addBox(new THREE.Vector3(cx - 0.38, 0, 13.22), new THREE.Vector3(cx + 0.38, 9, 13.98));
    }
    scene.add(row);
    rc.push(row);

    // ---------- LED ceiling panels ----------
    const ledGeo = new THREE.BoxGeometry(1.9, 0.07, 0.4);
    const ledMat = MAT.led(0xdfe9ff, 2.1);
    const leds = [];
    for (const lz of [-11, -3, 5, 11]) {
      for (let lx = -36; lx <= 8; lx += 8) leds.push([lx, lz]);
    }
    const ledMesh = new THREE.InstancedMesh(ledGeo, ledMat, leds.length);
    leds.forEach(([lx, lz], i) => {
      mtx.makeTranslation(lx, 8.94, lz);
      ledMesh.setMatrixAt(i, mtx);
    });
    scene.add(ledMesh);

    // ---------- lighting ----------
    scene.add(new THREE.HemisphereLight(0x223052, 0x0a0c11, 0.55));
    const moon = new THREE.DirectionalLight(0x93a7ff, 0.8);
    moon.position.set(40, 60, 70);
    scene.add(moon);
    this.moon = moon;

    const hallLightPts = [
      [-30, -6], [-18, -6], [-6, -6],
      [-30, 8], [-18, 8], [-6, 8], [6, 1],
    ];
    for (const [lx, lz] of hallLightPts) {
      const p = new THREE.PointLight(0xcfe0ff, 55, 24, 2);
      p.position.set(lx, 8.2, lz);
      scene.add(p);
      this.qualityLights.push(p);
    }
    // two flickering fluorescent lights (classic station detail)
    for (const [lx, lz] of [[-12, -11], [0, 11]]) {
      const p = new THREE.PointLight(0xdfe9ff, 45, 16, 2);
      p.position.set(lx, 8.2, lz);
      p.userData.base = 45;
      scene.add(p);
      this.flickerLights.push(p);
      this.qualityLights.push(p);
    }

    // ---------- ticket gates ----------
    const gateMat = MAT.metalDark;
    for (let i = 0; i < 5; i++) {
      const gx = -13 + i * 3.4;
      addBox(scene, { w: 0.34, h: 1.05, d: 2.2, mat: gateMat, x: gx, y: 0.525, z: -3, collide: world, raycast: rc, tag: 'metal' });
      // glass flaps
      const flap = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.5), MAT.glassPane);
      flap.position.set(gx, 0.5, -3);
      // green arrow screen on top
      const arrowMat = MAT.led(0x38e07a, 1.6);
      const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.5), arrowMat);
      arrow.position.set(gx, 1.06, -2.6);
      scene.add(arrow);
      flap.userData.tag = 'glass';
      scene.add(flap);
      rc.push(flap);
    }

    // ---------- vending machines (west wall) ----------
    for (let i = 0; i < 3; i++) {
      const vz = -3 + i * 3.3;
      addBox(scene, { w: 0.85, h: 2.05, d: 1.05, mat: MAT.metalDark, x: -39.55, y: 1.025, z: vz, collide: world, raycast: rc, tag: 'metal' });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.8), MAT.screen(TEX.vendingFace(i), 1.35));
      face.rotation.y = Math.PI / 2;
      face.position.set(-39.11, 1.15, vz);
      face.userData.tag = 'glass';
      scene.add(face);
      rc.push(face);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.9), MAT.led(0x9fd7ff, 1.4));
      glow.position.set(-39.1, 2.0, vz);
      scene.add(glow);
    }

    // ---------- ticket office (みどりの窓口) ----------
    addBox(scene, { w: 3.6, h: 1.1, d: 0.9, mat: MAT.plasticBlack, x: 8.6, y: 0.55, z: -15.2, collide: world, raycast: rc, tag: 'wood' });
    addBox(scene, { w: 3.6, h: 1.4, d: 0.08, mat: MAT.glassPane, x: 8.6, y: 1.9, z: -15.2, tag: 'glass', raycast: rc });
    makeSign(scene, { tex: TEX.hangingSign('みどりの窓口', 'TICKET OFFICE', '#0d7a4f', ''), w: 2.6, h: 0.65, x: 8.6, y: 3.1, z: -15.6, intensity: 1.15 });

    // ---------- benches ----------
    makeBench(scene, world, rc, -30, 12, 0);
    makeBench(scene, world, rc, -14, 12, 0);
    makeBench(scene, world, rc, -22, -14.4, 0);
    makeBench(scene, world, rc, 4, 12, 0);
    makeBench(scene, world, rc, 16, 12.8, Math.PI / 2);   // garden-side bench

    // ---------- trash bins ----------
    const binGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.85, 10);
    for (const [bx, bz] of [[-27, 12], [-9, 12], [-19, -13.6], [9, -12.5]]) {
      const bin = new THREE.Mesh(binGeo, MAT.plasticBlack);
      bin.position.set(bx, 0.43, bz);
      bin.castShadow = true;
      bin.userData.tag = 'metal';
      scene.add(bin);
      rc.push(bin);
    }

    // ---------- luggage (fleeing commuters left in a hurry) ----------
    const caseGeo = new THREE.BoxGeometry(0.55, 0.78, 0.26);
    const handleGeo = new THREE.BoxGeometry(0.3, 0.2, 0.05);
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(caseGeo, MAT.luggage);
      c.position.set(rand(-36, -16), 0.39, rand(-13.5, -8));
      c.rotation.y = rand(0, Math.PI * 2);
      c.castShadow = c.receiveShadow = true;
      c.userData.tag = 'wood';
      scene.add(c);
      rc.push(c);
      const hnd = new THREE.Mesh(handleGeo, MAT.metalDark);
      hnd.position.y = 0.48;
      c.add(hnd);
    }

    // ---------- hanging signage ----------
    const signPositions = [
      { tex: TEX.hangingSign('きっぷうりば', 'TICKETS', '#1d4f9c', '→'), x: -8, z: 2.5, rotY: 0 },
      { tex: TEX.hangingSign('のりば 1・2', 'PLATFORMS', '#177a4c', '↑'), x: 1, z: 9, rotY: 0 },
      { tex: TEX.hangingSign('出口', 'EXIT', '#41464e', '←'), x: -30, z: -12.5, rotY: Math.PI / 2 },
    ];
    for (const s of signPositions) {
      const panel = makeSign(scene, { tex: s.tex, w: 2.6, h: 0.65, x: s.x, y: 5.6, z: s.z, rotY: s.rotY, intensity: 1.0, raycast: rc });
      panel.castShadow = true;
      for (const sx of [-0.9, 0.9]) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.4, 5), MAT.metalDark);
        // hang from the ceiling above the sign's ends: offset along the axis
        // the panel's width spans (x when unrotated, z when rotated 90°)
        cable.position.set(s.x + (s.rotY ? 0 : sx), 7.3, s.z + (s.rotY ? sx : 0));
        scene.add(cable);
      }
    }

    // station name plaques (west wall + garden wall)
    makeSign(scene, { tex: TEX.stationName, w: 2.4, h: 0.6, x: -39.9, y: 3.1, z: 9, rotY: Math.PI / 2, intensity: 0.75 });
    makeSign(scene, { tex: TEX.stationName, w: 2.4, h: 0.6, x: 19, y: 3.4, z: -9.95, rotY: 0, intensity: 0.8 });

    // exit signs above south wall
    for (const ex of [-26, 4]) {
      const m = makeSign(scene, { tex: TEX.exitSign, w: 1.1, h: 0.42, x: ex, y: 4.3, z: -15.9, rotY: 0, intensity: 1.5 });
      m.userData.tag = 'metal';
    }

    // ---------- info screens ----------
    const infoMat = MAT.screen(TEX.infoScreen, 1.55);
    const sc1 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), infoMat);
    sc1.rotation.y = Math.PI / 2;
    sc1.position.set(-39.9, 3.4, -8);
    scene.add(sc1);
    sc1.userData.tag = 'glass';
    rc.push(sc1);

    // ---------- ad billboards ----------
    const posters = [
      [-24, -15.85, 2.7, 0], [-16, -15.85, 2.7, 0], [17, -9.98, 2.7, 0], [22, -9.98, 2.7, 0],
    ];
    posters.forEach(([px, pz, py, rY], i) => this._poster(px, py, pz, rY, i));
    this._posterWallX(-39.85, -9, 2.7, 4);
    this._posterWallX(-39.85, 12, 2.7, 5);

    // ---------- garden lanterns (warm glow for bloom) ----------
    for (const [lx, lz] of [[15.5, 11.5], [23, -6]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8), MAT.metalDark);
      post.position.set(lx, 1.6, lz);
      post.castShadow = true;
      scene.add(post);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), MAT.led(0xffc37a, 2.6));
      bulb.position.set(lx, 3.3, lz);
      scene.add(bulb);
      const lp = new THREE.PointLight(0xffb36b, 26, 12, 2);
      lp.position.set(lx, 3.3, lz);
      scene.add(lp);
      this.qualityLights.push(lp);
    }
  }

  _poster(x, y, z, rotY, i) {
    const { scene, raycastMeshes: rc } = this;
    addBox(scene, { w: 1.5, h: 2.1, d: 0.08, mat: MAT.metalDark, x, y, z, rotY, raycast: rc, tag: 'metal', cast: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 1.94), MAT.screen(TEX.adPoster(i), 1.15));
    face.position.set(x + (rotY ? 0 : 0), y, z + (rotY ? 0 : 0.05));
    face.rotation.y = rotY;
    if (!rotY) face.position.z += 0.001;
    scene.add(face);
    face.userData.tag = 'glass';
    rc.push(face);
  }

  _posterWallX(x, z, y, i) {
    const { scene, raycastMeshes: rc } = this;
    addBox(scene, { w: 0.08, h: 2.1, d: 1.5, mat: MAT.metalDark, x, y, z, raycast: rc, tag: 'metal', cast: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 1.94), MAT.screen(TEX.adPoster(i), 1.15));
    face.rotation.y = Math.PI / 2;
    face.position.set(x + 0.05, y, z);
    scene.add(face);
    face.userData.tag = 'glass';
    rc.push(face);
  }

  update(dt, time) {
    for (const p of this.flickerLights) {
      // mostly-steady fluorescent with occasional dips
      const n = Math.sin(time * 37 + p.position.x) * Math.sin(time * 11.7 + p.position.z * 2);
      const dip = n > 0.92 ? rand(0.3, 0.6) : 1;
      p.intensity = p.userData.base * dip * (0.94 + 0.06 * Math.sin(time * 3 + p.position.x));
    }
  }
}

function cachedBeams() {
  return new THREE.BoxGeometry(0.34, 0.5, 31);
}
