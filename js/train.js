// ============================================================
// train.js — a 4-car modern Japanese commuter train with a full
// arrival state machine:
//   IDLE → APPROACH → BRAKE → STOP → DOORS OPEN → DWELL →
//   DOORS CLOSE → DEPART → IDLE …
// Headlights, lit windows, LED destination display, rotating wheels,
// sliding doors, a dynamic AABB collider, a positional rumble loop
// and hooks so the game can trigger brake / chime / PA announce.
// Prefers assets/models/train.glb when present.
// ============================================================

import * as THREE from 'three';
import { MAT } from './materials.js';
import { TEX } from './textures.js';
import { LAYOUT } from './layout.js';
import { rand } from './utils.js';

const T = LAYOUT.train;

const STATE = {
  IDLE: 'IDLE', APPROACH: 'APPROACH', BRAKE: 'BRAKE', STOP: 'STOP',
  DWELL: 'DWELL', CLOSE: 'CLOSE', DEPART: 'DEPART',
};

export class Train {
  constructor(scene, world, events = {}, gltf = null) {
    this.scene = scene;
    this.world = world;
    this.ev = events;
    this.gltf = gltf;

    this.group = new THREE.Group();
    this.group.name = 'train';
    scene.add(this.group);

    this.state = STATE.IDLE;
    this.timer = rand(6, 9);          // first arrival is soon (showcase!)
    this.x = T.farX;                  // front-car nose X
    this.v = 0;
    this.doorsOpen = false;
    this.doorT = 0;                   // 0 closed … 1 open
    this.cars = [];
    this.doorPanels = [];
    this.wheels = [];
    this.rumble = null;
    this.mixer = null;
    this.raycastMeshes = [];
    this.collider = null;
  }

  build() {
    if (this.gltf) this._buildFromGLB();
    else this._buildProcedural();

    // put the whole train ON the track: cars are built around local z=0, so
    // the group itself must sit on the track centre line (update() slides it
    // along X only)
    this.group.position.z = LAYOUT.platform.trackZ;

    // dynamic AABB (updated every frame)
    this.collider = this.world.addDynamicBox(
      new THREE.Vector3(-60, -1, 25.6), new THREE.Vector3(2, 3.1, 29.2),
    );

    // rumble positional (game attaches the audio after init)
    this.rumbleAnchor = new THREE.Object3D();
    this.rumbleAnchor.position.set(-34, 1, 0);   // local — group is already at trackZ
    this.group.add(this.rumbleAnchor);
  }

  setRumble(positionalAudio) { this.rumble = positionalAudio; }

  // ---------------- procedural ----------------

  _buildProcedural() {
    const bodyMat = MAT.trainBody;
    const skirtMat = MAT.trainSkirt;
    const winMat = MAT.trainWindow;
    const stripeMat = MAT.trainStripe;

    const bodyGeo = new THREE.BoxGeometry(16.9, 2.95, 2.9);
    const skirtGeo = new THREE.BoxGeometry(16.6, 0.6, 2.7);
    const winGeo = new THREE.BoxGeometry(16.2, 0.95, 2.94);
    const stripeGeo = new THREE.BoxGeometry(16.95, 0.14, 2.93);
    const roofGeo = new THREE.BoxGeometry(16.7, 0.16, 2.5);
    const doorFrameGeo = new THREE.BoxGeometry(1.36, 2.15, 0.06);
    const doorGeo = new THREE.BoxGeometry(0.62, 2.0, 0.07);
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.16, 12);
    wheelGeo.rotateX(Math.PI / 2);
    const bogieGeo = new THREE.BoxGeometry(2.4, 0.4, 2.2);

    const frameMat = MAT.metalDark;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.6, roughness: 0.35 });

    for (let i = 0; i < T.carCount; i++) {
      const car = new THREE.Group();
      this.group.add(car);
      this.cars.push(car);

      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.set(-8.5, 1.5, 0);
      body.castShadow = body.receiveShadow = true;
      body.userData.tag = 'metal';
      car.add(body);
      this.raycastMeshes.push(body);

      const skirt = new THREE.Mesh(skirtGeo, skirtMat);
      skirt.position.set(-8.5, -0.05, 0);
      skirt.userData.tag = 'metal';
      car.add(skirt);

      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(-8.5, 2.12, 0);
      win.userData.tag = 'glass';
      car.add(win);
      this.raycastMeshes.push(win);

      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(-8.5, 1.42, 0);
      car.add(stripe);

      const roof = new THREE.Mesh(roofGeo, frameMat);
      roof.position.set(-8.5, 3.05, 0);
      car.add(roof);

      // doors on both sides (local x: 3 / 9 / 15 from the car front)
      for (const side of [-1, 1]) {
        for (const dLocal of [3, 9, 15]) {
          const frame = new THREE.Mesh(doorFrameGeo, frameMat);
          frame.position.set(-dLocal, 1.15, side * 1.47);
          car.add(frame);
          for (const s of [-1, 1]) {
            const panel = new THREE.Mesh(doorGeo, doorMat);
            panel.position.set(-dLocal + s * 0.33, 1.15, side * 1.49);
            panel.userData.baseX = -dLocal + s * 0.33;
            panel.userData.dir = s;
            panel.userData.tag = 'metal';
            car.add(panel);
            this.doorPanels.push(panel);
          }
        }
      }

      // bogies + wheels
      for (const bx of [-4.5, -12.5]) {
        const bogie = new THREE.Mesh(bogieGeo, frameMat);
        bogie.position.set(bx, 0.28, 0);
        car.add(bogie);
        for (const [wx, wz] of [[-0.8, -1.05], [-0.8, 1.05], [0.8, -1.05], [0.8, 1.05]]) {
          const wheel = new THREE.Mesh(wheelGeo, MAT.rail);
          wheel.position.set(bx + wx, 0.0, wz);
          car.add(wheel);
          this.wheels.push(wheel);
        }
      }
    }

    // ---- front car face ----
    const front = this.cars[0];
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 2.4), new THREE.MeshStandardMaterial({
      color: 0x101822, metalness: 0.5, roughness: 0.08, emissive: 0x6f9cc9, emissiveIntensity: 0.35,
    }));
    windshield.position.set(0.03, 2.25, 0);
    front.add(windshield);

    const ledMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffb400, emissiveIntensity: 1.8 });
    ledMat.emissiveMap = null;
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 1.15), ledMat);
    led.position.set(0.05, 2.85, 0);
    front.add(led);
    // destination texture on a small plane at the nose side too
    const destPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), MAT.screen(TEX.destLED, 1.9));
    destPlane.position.set(0.1, 2.85, 0);
    destPlane.rotation.y = Math.PI / 2;
    front.add(destPlane);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2cc, emissiveIntensity: 3.2 });
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), headMat);
      hl.position.set(0.05, 1.35, side * 0.85);
      front.add(hl);
      const tl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x330505, emissive: 0xff2222, emissiveIntensity: 1.6 }));
      tl.position.set(-T.carLen * (T.carCount - 1) - 0.05, 1.35, side * 0.9);
      this.cars[T.carCount - 1].add(tl);
    }

    // Headlight beam + interior lights live at the SCENE ROOT, permanently
    // visible with intensity 0 while the train is hidden. If they were
    // parented to the (initially invisible) train group, the train's first
    // appearance would change NUM_POINT/SPOT_LIGHTS and force three.js to
    // recompile EVERY material in the scene — a multi-second freeze right
    // as the train rolls in. update() slides them along with the train.
    this.spot = new THREE.SpotLight(0xfff4dd, 0, 90, 0.35, 0.45, 1.6);
    this.spotTarget = new THREE.Object3D();
    this.scene.add(this.spot, this.spotTarget);
    this.spot.target = this.spotTarget;

    this.interiorLights = [];
    for (let i = 0; i < 2; i++) {
      const inl = new THREE.PointLight(0xdfe8ff, 0, 7, 2);
      this.scene.add(inl);
      this.interiorLights.push(inl);
    }
    this._carInteriorX = [1, 2];     // cars carrying interior lights

    // couplers
    for (let i = 0; i < T.carCount - 1; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), frameMat);
      c.position.set(-T.carLen * (i + 1), 0.55, 0);
      this.group.add(c);
      c.userData.tag = 'metal';
    }
  }

  _buildFromGLB() {
    const root = this.gltf.scene.clone(true);
    // fit: measure, scale to total length, center
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const totalLen = T.carLen * T.carCount;
    const scale = totalLen / Math.max(size.x, size.z, 0.001);
    root.scale.setScalar(scale);
    box.setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    root.position.set(-totalLen / 2 - c.x, -box.min.y, -c.z);
    this._glbBaseX = root.position.x;    // update() slides the root along X with this.x

    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        if (!o.userData.tag) o.userData.tag = 'metal';
        this.raycastMeshes.push(o);
      }
    });
    this.group.add(root);
    this._glbRoot = root;

    if (this.gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(root);
      const clip = THREE.AnimationClip.findByName(this.gltf.animations, 'Idle') ?? this.gltf.animations[0];
      if (clip) this.mixer.clipAction(clip).play();
    }
  }

  // ---------------- simulation ----------------

  update(dt) {
    const accel = 5, cruise = 21, brake = 4.6, depCruise = 23;
    const stopX = T.stopFrontX;
    let moved = true;

    switch (this.state) {
      case STATE.IDLE:
        moved = false;
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = STATE.APPROACH;
          this.x = T.farX;
          this.v = 0;
          this.group.visible = true;
          this.ev.onApproach?.();
        }
        break;

      case STATE.APPROACH: {
        this.v = Math.min(this.v + accel * dt, cruise);
        this.x += this.v * dt;
        const brakePoint = stopX - (cruise * cruise) / (2 * brake);
        if (this.x >= brakePoint) {
          this.state = STATE.BRAKE;
          this.ev.onBrake?.();
        }
        break;
      }

      case STATE.BRAKE: {
        this.v = Math.max(this.v - brake * dt, 0);
        this.x += this.v * dt;
        if (this.v <= 0.05 || this.x >= stopX) {
          this.x = stopX;
          this.v = 0;
          this.state = STATE.STOP;
          this.timer = 1.1;
          this.ev.onStop?.();
        }
        break;
      }

      case STATE.STOP:
        this.timer -= dt;
        if (this.timer <= 0) {
          this.doorsOpen = true;
          this.ev.onDoorsOpen?.();
          this.state = STATE.DWELL;
          this.timer = 9;
        }
        break;

      case STATE.DWELL:
        this.timer -= dt;
        if (this.timer <= 0) {
          this.doorsOpen = false;
          this.ev.onDoorsClose?.();
          this.state = STATE.CLOSE;
          this.timer = 1.6;
        }
        break;

      case STATE.CLOSE:
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = STATE.DEPART;
          this.ev.onDepart?.();
        }
        break;

      case STATE.DEPART: {
        this.v = Math.min(this.v + 3.4 * dt, depCruise);
        this.x += this.v * dt;
        if (this.x > T.departX) {
          this.state = STATE.IDLE;
          this.group.visible = false;
          this.x = T.farX;
          this.v = 0;
          this.timer = rand(38, 62);
        }
        break;
      }
    }

    // doors slide (∓ along car axis)
    const doorTarget = this.doorsOpen ? 1 : 0;
    this.doorT += (doorTarget - this.doorT) * Math.min(1, dt * 4);
    for (const p of this.doorPanels) {
      p.position.x = p.userData.baseX + p.userData.dir * this.doorT * 0.56;
    }

    // Move the whole train group along X (works for procedural cars AND a
    // GLB root child); cars keep a fixed local offset relative to the group.
    this.group.position.x = this.x;
    for (let i = 0; i < this.cars.length; i++) {
      this.cars[i].position.x = -i * T.carLen;
    }
    const wheelSpin = (this.v * dt) / 0.4;
    for (const w of this.wheels) w.rotation.z -= wheelSpin;
    if (this.mixer) this.mixer.update(dt);   // GLB animation (idle/ride loop)

    // rumble volume follows speed (+ distance model handles proximity)
    if (this.rumble) {
      if (this.v > 0.4) {
        this.rumble.setVolume(Math.min(1, 0.25 + this.v / 16));
        if (!this.rumble.isPlaying) { try { this.rumble.play(); } catch { /* not started yet */ } }
      } else if (this.rumble.isPlaying && this.state !== STATE.DWELL && this.state !== STATE.STOP && this.state !== STATE.CLOSE) {
        this.rumble.pause();
      } else if (this.rumble.isPlaying) {
        this.rumble.setVolume(0.06);
      }
    }

    // dynamic collider
    if (this.group.visible) {
      const back = this.x - T.carLen * T.carCount;
      this.collider.min.set(Math.max(back, -500), -1.05, 25.55);
      this.collider.max.set(this.x + 0.3, 3.2, 29.3);
      this.collider.enabled = true;
    } else {
      this.collider.min.set(500, -1.05, 25.55);
      this.collider.max.set(510, 3.2, 29.3);
    }

    // scene-root train lights follow it (they stay visible so the light
    // count — and therefore every shader — never changes mid-fight)
    const lit = this.group.visible;
    this.spot.intensity = lit ? 900 : 0;
    if (lit) {
      this.spot.position.set(this.x + 0.2, 1.4, LAYOUT.platform.trackZ);
      this.spotTarget.position.set(this.x + 60, 0.6, LAYOUT.platform.trackZ);
    }
    for (let li = 0; li < this.interiorLights.length; li++) {
      const L = this.interiorLights[li];
      L.intensity = lit ? 10 : 0;
      if (lit) L.position.set(this.x - this._carInteriorX[li] * T.carLen - 8.5, 2.5, LAYOUT.platform.trackZ);
    }
  }

  reset() {
    this.state = STATE.IDLE;
    this.timer = rand(8, 14);
    this.x = T.farX;
    this.v = 0;
    this.doorsOpen = false;
    this.doorT = 0;
    this.group.visible = false;
  }
}
