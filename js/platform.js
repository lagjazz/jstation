// ============================================================
// platform.js — the boarding platform: yellow safety line, platform
// screen doors (animated with the train), tracks below, canopy with
// cool LED strips, benches, timetable, PA speaker and — beyond the
// tracks — a night city skyline for the cinematic backdrop.
// ============================================================

import * as THREE from 'three';
import { MAT } from './materials.js';
import { TEX } from './textures.js';
import { LAYOUT } from './layout.js';
import { addBox, makeBench, makeSign } from './build.js';
import { damp, rand } from './utils.js';

const P = LAYOUT.platform;

export class Platform {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.raycastMeshes = [];
    this.qualityLights = [];
    this.panels = [];           // PSD sliding panels
    this.doorOpen = 0;
    this.doorTarget = 0;
    this.speakerAnchor = new THREE.Object3D();
  }

  build() {
    const { scene, world, raycastMeshes: rc } = this;

    // yellow safety line
    addBox(scene, { w: 52, h: 0.03, d: 0.36, mat: MAT.yellowLine, x: -14, y: 0.016, z: 24.15, cast: false, receive: true, raycast: rc, tag: 'concrete' });

    // platform edge fascia (wall down into the pit)
    addBox(scene, { w: 52, h: 1.1, d: 0.35, mat: MAT.concreteDark, x: -14, y: -0.52, z: 25.2, cast: false, raycast: rc });
    // invisible player guard at the very edge
    world.addBox(new THREE.Vector3(-42, -1, 24.55), new THREE.Vector3(14, 3, 25.1));

    // ---------- tracks ----------
    addBox(scene, { w: 52, h: 0.12, d: 5.6, mat: MAT.gravel, x: -14, y: -1.0, z: 27.8, cast: false, receive: true, raycast: rc, tag: 'concrete' });
    // far pit wall
    addBox(scene, { w: 52, h: 1.8, d: 0.35, mat: MAT.concreteDark, x: -14, y: -0.3, z: 30.8, cast: false, raycast: rc });
    // rails
    for (const rz of [26.6, 28.6]) {
      addBox(scene, { w: 56, h: 0.11, d: 0.1, mat: MAT.rail, x: -13, y: -0.86, z: rz, cast: false, raycast: rc, tag: 'metal' });
    }
    // sleepers (instanced)
    const sleepGeo = new THREE.BoxGeometry(2.6, 0.12, 0.26);
    const sleepers = new THREE.InstancedMesh(sleepGeo, MAT.concreteDark, 80);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 80; i++) {
      mtx.makeTranslation(-40 + i * 0.7, -0.94, 27.6);
      sleepers.setMatrixAt(i, mtx);
    }
    sleepers.receiveShadow = true;
    scene.add(sleepers);

    // ---------- canopy ----------
    addBox(scene, { w: 54, h: 0.32, d: 11.8, mat: MAT.ceiling, x: -14, y: P.canopyH + 0.16, z: 19.6, raycast: rc, tag: 'concrete' });
    // LED strips under canopy
    for (const lz of [17.2, 22.4]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(52, 0.06, 0.18), MAT.led(0xdfe9ff, 2.0));
      s.position.set(-14, P.canopyH - 0.05, lz);
      scene.add(s);
    }
    // canopy posts
    for (let i = 0; i <= 6; i++) {
      const px = -36 + i * 8;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, P.canopyH, 10), MAT.metalDark);
      post.position.set(px, P.canopyH / 2, 23.9);
      post.castShadow = true;
      post.userData.tag = 'metal';
      scene.add(post);
      rc.push(post);
      world.addBox(new THREE.Vector3(px - 0.24, 0, 23.66), new THREE.Vector3(px + 0.24, P.canopyH, 24.14));
    }
    // canopy lights (cool white)
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xd6e4ff, 42, 18, 2);
      l.position.set(-34 + i * 11, P.canopyH - 0.3, 20);
      scene.add(l);
      this.qualityLights.push(l);
    }

    // ---------- platform screen doors ----------
    for (const dx of LAYOUT.doorXs) {
      addBox(scene, { w: 2.1, h: 0.3, d: 0.26, mat: MAT.metalDark, x: dx, y: 2.95, z: 25.0, cast: false });
      for (const edge of [-1.05, 1.05]) {
        addBox(scene, { w: 0.09, h: 2.9, d: 0.12, mat: MAT.metalDark, x: dx + edge, y: 1.45, z: 25.0, raycast: rc, tag: 'metal' });
      }
      for (const s of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.5, 0.05), MAT.glassPane);
        panel.position.set(dx + s * 0.47, 1.35, 25.0);
        panel.userData.tag = 'glass';
        panel.userData.baseX = dx + s * 0.47;
        panel.userData.dir = s;
        scene.add(panel);
        rc.push(panel);
        this.panels.push(panel);
      }
    }

    // ---------- platform furniture ----------
    makeBench(scene, world, rc, -26, 21, 0);
    makeBench(scene, world, rc, 2, 21, 0);

    // hanging station name (double sided) over the platform
    makeSign(scene, { tex: TEX.stationName, w: 1.7, h: 0.42, x: -14, y: 3.3, z: 20.5, rotY: 0, intensity: 0.8, raycast: rc });
    makeSign(scene, { tex: TEX.hangingSign('1', '', '#1d4f9c', ''), w: 0.55, h: 0.55, x: -5, y: 3.3, z: 20.5, intensity: 1.0 });
    makeSign(scene, { tex: TEX.hangingSign('2', '', '#177a4c', ''), w: 0.55, h: 0.55, x: -23, y: 3.3, z: 20.5, intensity: 1.0 });

    // timetable board on posts
    const tt = makeSign(scene, { tex: TEX.timetable, w: 0.8, h: 1.2, x: -31, y: 1.6, z: 17.0, rotY: Math.PI / 2, intensity: 0.55, raycast: rc, cast: true });
    tt.material.emissiveIntensity = 0.35;
    tt.material.color = new THREE.Color(0xffffff);
    for (const dz of [-0.3, 0.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), MAT.metalDark);
      post.position.set(-31.1, 0.5, 17.0 + dz);
      scene.add(post);
    }

    // small departure screen on the platform
    const dep = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), MAT.screen(TEX.infoScreen, 1.7));
    dep.position.set(9, 2.4, 24.6);
    dep.rotation.y = Math.PI;
    dep.userData.tag = 'glass';
    scene.add(dep);
    rc.push(dep);

    // PA speaker horn (positional-audio anchor)
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 10, 1, true), MAT.metalDark);
    horn.rotation.x = Math.PI / 2;
    horn.position.set(9, 4.4, 22);
    scene.add(horn);
    this.speakerAnchor.position.set(9, 4.3, 22);
    scene.add(this.speakerAnchor);

    // ---------- night city skyline beyond the tracks ----------
    this._city();
  }

  _city() {
    const { scene } = this;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: TEX.buildingFacade,
      emissive: 0xffffff,
      emissiveMap: TEX.buildingFacade,
      emissiveIntensity: 0.85,
      roughness: 0.85,
      color: 0x1a1e26,
    });
    const n = Math.max(10, Math.round(34 * (this.cityDetail ?? 1)));   // QUALITY_PRESETS.cityDetail
    const city = new THREE.InstancedMesh(geo, mat, n);
    const mtx = new THREE.Matrix4();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const w = rand(5, 15);
      const h = rand(7, 42);
      const d = rand(5, 13);
      pos.set(rand(-95, 55), h / 2 - 1, rand(36, 95));
      scl.set(w, h, d);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(-0.4, 0.4));
      mtx.compose(pos, q, scl);
      city.setMatrixAt(i, mtx);
    }
    city.frustumCulled = true;
    // grouped so game.js can hide the city backdrop for worlds where it
    // breaks the fiction (lunar base, underwater ruins, the tomb, …)
    this.cityGroup = new THREE.Group();
    this.cityGroup.add(city);
    // distant haze plane behind city
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(340, 90),
      new THREE.MeshBasicMaterial({ color: 0x0a1020, fog: true }),
    );
    haze.position.set(-20, 30, 120);
    this.cityGroup.add(haze);
    scene.add(this.cityGroup);
  }

  setDoors(open) { this.doorTarget = open ? 1 : 0; }

  update(dt) {
    this.doorOpen = damp(this.doorOpen, this.doorTarget, 3.2, dt);
    for (const p of this.panels) {
      p.position.x = p.userData.baseX + p.userData.dir * this.doorOpen * 0.86;
    }
  }
}
