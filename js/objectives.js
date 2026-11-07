// ============================================================
// objectives.js — mission win / loss conditions.
//
//   eliminate    clear every hostile (classic)
//   survive      hold out for N seconds against endless reinforcements
//   defend       keep a data terminal alive for N seconds — saboteurs
//                walk up and hack it (fail when its integrity hits 0)
//   capture      stand in the uplink zone until it reaches 100 %
//                (hostiles inside the zone contest it)
//   intel        recover 3 data drives scattered across the map, then
//                reach the extraction beacon
//   assassinate  a commander (boss) is on site — kill it; the rest
//                of the force retreats
//
// Each mission draws one type from its MISSIONS[].objectives pool when
// it is armed, so replays play differently. Markers are a vertical
// light beam (world) + a HUD waypoint the game projects every frame.
// ============================================================

import * as THREE from 'three';
import { OBJECTIVES } from './config.js';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';
import { blockedAt } from './collision.js';
import { clamp, rand } from './utils.js';

const LABEL = {
  eliminate: ['ELIMINATE', '殲滅'],
  survive: ['SURVIVE', '持久'],
  defend: ['DEFEND THE TERMINAL', '端末防衛'],
  capture: ['CAPTURE THE UPLINK', '拠点確保'],
  intel: ['RECOVER INTEL', '情報回収'],
  assassinate: ['ASSASSINATE THE COMMANDER', '指揮官排除'],
};

function terminalGeo() {
  const L = new PartList();
  L.add(G.box(1.2, 1.0, 0.7), 0x2a3038, 0, 0.5, 0, { r: 0.5, m: 0.6 });
  L.add(G.box(1.1, 0.7, 0.12), 0x1a1e24, 0, 1.25, -0.2, { r: 0.4, m: 0.6, rot: [-0.25, 0, 0] });
  L.add(G.box(0.95, 0.55, 0.01), 0x40e0ff, 0, 1.27, -0.13, { glow: true, rot: [-0.25, 0, 0] });
  L.add(G.box(1.0, 0.04, 0.3), 0x0e1014, 0, 1.01, 0.15, { r: 0.6, m: 0.3 });
  for (let i = 0; i < 6; i++) L.add(G.box(0.05, 0.05, 0.01), i % 2 ? 0x30ff80 : 0xffb030, -0.4 + i * 0.16, 0.8, 0.356, { glow: true });
  L.add(G.cyl(0.02, 0.02, 0.6, 6), 0x8a8f96, 0.5, 1.6, -0.25, { r: 0.4, m: 0.8 });
  L.add(G.sph(0.05, 8, 6), 0xff3030, 0.5, 1.92, -0.25, { glow: true });
  return L.bake();
}

function driveGeo() {
  const L = new PartList();
  L.add(G.box(0.36, 0.1, 0.26), 0x1c2026, 0, 0, 0, { r: 0.35, m: 0.75 });
  L.add(G.box(0.3, 0.012, 0.2), 0xffc040, 0, 0.056, 0, { glow: true });
  L.add(G.box(0.08, 0.04, 0.02), 0x40e0ff, 0.1, 0.02, 0.131, { glow: true });
  return L.bake();
}

export class Objectives {
  constructor(scene, world, particles, audio) {
    this.scene = scene;
    this.world = world;
    this.p = particles;
    this.audio = audio;
    this.type = 'eliminate';
    this.done = false;
    this.failed = false;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.mat = RMMaterial();
    this.glow = GlowMaterial(2.4);
    const tg = terminalGeo();
    this.terminal = new THREE.Group();
    this.terminal.add(new THREE.Mesh(tg.geo, this.mat), new THREE.Mesh(tg.glowGeo, this.glow));
    this.terminal.children[0].castShadow = true;
    this.terminal.children[0].userData.tag = 'metal';
    this.root.add(this.terminal);
    const dg = driveGeo();
    this.drives = [];
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Group();
      d.add(new THREE.Mesh(dg.geo, this.mat), new THREE.Mesh(dg.glowGeo, this.glow));
      this.root.add(d);
      this.drives.push({ g: d, got: false });
    }
    // light beam marker (shared shape, tinted per use)
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.3, 40, 12, 1, true);
    beamGeo.translate(0, 20, 0);
    this.beams = [];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.4, 1.4, 2), transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      b.frustumCulled = false;
      this.root.add(b);
      this.beams.push(b);
    }
    // capture zone: floor ring + translucent wall
    this.zone = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.4, 1.6, 2.2), transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const wallGeo = new THREE.CylinderGeometry(1, 1, 2.2, 48, 1, true);
    wallGeo.translate(0, 1.1, 0);
    const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.3, 1.2, 1.8), transparent: true, opacity: 0.09, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.zone.add(ring, wall);
    this.zone.userData = { ring, wall };
    this.root.add(this.zone);
    this._termCol = null;
    this.raycastMeshes = [];
  }

  /** Warm-up: everything visible once (prewarm pass) then hidden again. */
  warm(x, z) {
    this.root.visible = true;
    this.terminal.position.set(x, 0, z);
    this.terminal.visible = this.zone.visible = true;
    for (const d of this.drives) { d.g.visible = true; d.g.position.set(x + 1, 0.5, z); }
    for (const b of this.beams) { b.visible = true; b.position.set(x, 0, z); }
    return () => this.clear();
  }

  clear() {
    this.root.visible = false;
    this.terminal.visible = false;
    this.zone.visible = false;
    for (const d of this.drives) d.g.visible = false;
    for (const b of this.beams) b.visible = false;
    if (this._termCol) { this.world.removeDynamicBox(this._termCol); this._termCol = null; }
    this.raycastMeshes = [];
    this.done = this.failed = false;
  }

  /**
   * ctx: { mission, anchors (SPAWN_POOLS entry), spawn {x,z}, enemyMgr }
   * Returns the enemy-manager deploy options this objective needs.
   */
  setup(type, ctx) {
    this.clear();
    this.type = type;
    this.t = 0;
    this.root.visible = true;
    const C = OBJECTIVES[type] ?? {};
    this.duration = C.duration ? C.duration + (ctx.missionIdx ?? 0) * (C.perMission ?? 0) : 0;
    const anchors = ctx.anchors;
    const sp = ctx.spawn;
    const deploy = {};
    const pts = this._points(anchors, sp);
    if (type === 'survive') {
      deploy.trickle = { gap: C.gap, max: C.maxAlive, batch: C.batch };
    } else if (type === 'defend') {
      const p = pts.center;
      this.terminal.visible = true;
      this.terminal.position.set(p.x, p.y, p.z);
      this.terminal.rotation.y = Math.atan2(sp.x - p.x, sp.z - p.z);
      this._termCol = this.world.addDynamicBox(
        new THREE.Vector3(p.x - 0.7, p.y, p.z - 0.7), new THREE.Vector3(p.x + 0.7, p.y + 1.6, p.z + 0.7));
      this.raycastMeshes = [this.terminal.children[0]];
      this.termHp = 100;
      this.target = {
        x: p.x, z: p.z, y: p.y,
        sabotage: (dt, e) => {
          this.termHp -= C.hackRate * dt;
          this._hackT = 0.3;
          if (Math.random() < 6 * dt) this.p.sparkBurst(p.x, p.y + 1.2, p.z, 0, 1, 0, 3);
          void e;
        },
      };
      this._beam(0, p, 0xff8030);
      deploy.trickle = { gap: C.gap, max: C.maxAlive, batch: C.batch };
      deploy.objTarget = this.target;
    } else if (type === 'capture') {
      const p = pts.center;
      this.zoneR = C.radius;
      this.zone.visible = true;
      this.zone.position.set(p.x, p.y, p.z);
      this.zone.scale.set(this.zoneR, 1, this.zoneR);
      this.capture = 0;
      this._beam(0, p, 0x40e0ff);
      deploy.trickle = { gap: C.gap, max: C.maxAlive, batch: C.batch };
    } else if (type === 'intel') {
      this.got = 0;
      this.extract = null;
      pts.spread.forEach((p, i) => {
        const d = this.drives[i];
        d.got = false;
        d.g.visible = true;
        d.g.position.set(p.x, p.y + 0.55, p.z);
        this._beam(i, p, 0xffc040);
      });
      this._sp = { x: sp.x, y: 0, z: sp.z };
    } else if (type === 'assassinate') {
      deploy.bossNow = true;
    }
    return deploy;
  }

  _beam(i, p, hex) {
    const b = this.beams[i];
    b.visible = true;
    b.position.set(p.x, p.y, p.z);
    b.material.color.setHex(hex);
  }

  /** Objective sites: one central point + three well-separated ones. */
  _points(anchors, sp) {
    const cands = [];
    for (const a of anchors) {
      for (let k = 0; k < 4; k++) {
        const x = a.pos[0] + rand(-2.5, 2.5), z = a.pos[1] + rand(-2.5, 2.5), y = a.y ?? 0;
        if (blockedAt(this.world, x, z, 0.9, y)) continue;
        cands.push({ x, y, z });
        break;
      }
    }
    if (!cands.length) cands.push({ x: sp.x + 6, y: 0, z: sp.z + 6 });
    const cx = cands.reduce((s, p) => s + p.x, 0) / cands.length;
    const cz = cands.reduce((s, p) => s + p.z, 0) / cands.length;
    const ground = cands.filter((p) => p.y === 0);
    const pool = ground.length ? ground : cands;
    const center = pool.slice().sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[Math.floor(Math.random() * Math.min(2, pool.length))];
    // greedy farthest-point picks for the three drives, away from the spawn
    const spread = [];
    const far = cands.filter((p) => Math.hypot(p.x - sp.x, p.z - sp.z) > 9);
    const src = far.length >= 3 ? far : cands;
    spread.push(src[Math.floor(Math.random() * src.length)]);
    while (spread.length < 3 && spread.length < src.length) {
      let best = null, bd = -1;
      for (const p of src) {
        const d = Math.min(...spread.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
        if (d > bd) { bd = d; best = p; }
      }
      spread.push(best);
    }
    while (spread.length < 3) spread.push(spread[0]);
    return { center, spread };
  }

  /**
   * ctx: { dt, playerPos, enemyMgr }
   * Returns 'complete' | 'failed' | null.
   */
  update(dt, ctx) {
    if (this.done || this.failed) return null;
    this.t += dt;
    const pp = ctx.playerPos;
    const em = ctx.enemyMgr;
    // beams breathe
    for (const b of this.beams) if (b.visible) b.material.opacity = 0.08 + 0.04 * Math.sin(this.t * 3);
    for (const d of this.drives) if (d.g.visible) d.g.rotation.y += dt * 1.6;

    switch (this.type) {
      case 'eliminate':
        if (em.remaining() === 0) return this._complete();
        break;
      case 'survive':
        if (this.t >= this.duration) return this._complete();
        break;
      case 'defend': {
        if (this._hackT > 0) this._hackT -= dt;
        if (this.termHp <= 0) return this._fail();
        if (this.t >= this.duration) return this._complete();
        const scr = this.terminal.children[1];
        scr.visible = !(this._hackT > 0 && Math.sin(this.t * 30) > 0);
        break;
      }
      case 'capture': {
        const z = this.zone.position;
        const inside = Math.hypot(pp.x - z.x, pp.z - z.z) < this.zoneR && Math.abs(pp.y - z.y) < 2;
        let contested = false;
        for (const e of em.enemies) {
          if (!e.alive) continue;
          const ep = e.group.position;
          if (Math.hypot(ep.x - z.x, ep.z - z.z) < this.zoneR) { contested = true; break; }
        }
        this.contested = inside && contested;
        this.inside = inside;
        if (inside && !contested) this.capture = Math.min(1, this.capture + dt / OBJECTIVES.capture.time);
        else if (!inside) this.capture = Math.max(0, this.capture - dt / (OBJECTIVES.capture.time * 4));
        const { ring, wall } = this.zone.userData;
        const col = this.contested ? [2.2, 0.4, 0.3] : (inside ? [0.4, 2.2, 0.8] : [0.4, 1.6, 2.2]);
        ring.material.color.setRGB(...col);
        wall.material.color.setRGB(col[0] * 0.7, col[1] * 0.7, col[2] * 0.7);
        wall.material.opacity = 0.06 + 0.05 * this.capture + (inside ? 0.04 : 0);
        if (this.capture >= 1) return this._complete();
        break;
      }
      case 'intel': {
        for (let i = 0; i < 3; i++) {
          const d = this.drives[i];
          if (d.got) continue;
          const g = d.g.position;
          if (Math.hypot(pp.x - g.x, pp.z - g.z) < 1.4 && Math.abs(pp.y + 0.6 - g.y) < 1.6) {
            d.got = true;
            d.g.visible = false;
            this.beams[i].visible = false;
            this.got++;
            this.p.sparkBurst(g.x, g.y, g.z, 0, 1, 0, 14);
            this.audio.play('intel', { volume: 0.8 });
            ctx.onIntel?.(this.got);
            if (this.got === 3) {
              this.extract = this._sp;
              this._beam(3, this.extract, 0x40ff80);
            }
          }
        }
        if (this.extract && Math.hypot(pp.x - this.extract.x, pp.z - this.extract.z) < 2.6) return this._complete();
        break;
      }
      case 'assassinate':
        if (em.bossKilled || (em.boss && !em.boss.alive)) return this._complete();
        break;
    }
    return null;
  }

  _complete() { this.done = true; for (const b of this.beams) b.visible = false; return 'complete'; }
  _fail() { this.failed = true; return 'failed'; }

  /** HUD line + progress + waypoint markers (world positions). */
  hud(em) {
    const [en, jp] = LABEL[this.type] ?? LABEL.eliminate;
    const out = { title: `${en} · ${jp}`, detail: '', progress: null, markers: [], warn: false };
    switch (this.type) {
      case 'eliminate': out.detail = `HOSTILES ${em.remaining()}`; break;
      case 'survive': {
        const left = Math.max(0, this.duration - this.t);
        out.detail = `HOLD OUT ${Math.ceil(left)}s`;
        out.progress = clamp(this.t / this.duration, 0, 1);
        break;
      }
      case 'defend': {
        const left = Math.max(0, this.duration - this.t);
        out.detail = `INTEGRITY ${Math.max(0, Math.ceil(this.termHp))}% · ${Math.ceil(left)}s`;
        out.progress = clamp(this.t / this.duration, 0, 1);
        out.warn = this._hackT > 0;
        out.markers.push({ pos: this.terminal.position, label: 'DEFEND', color: '#ff9a40' });
        break;
      }
      case 'capture':
        out.detail = `UPLINK ${Math.floor(this.capture * 100)}%${this.contested ? ' · CONTESTED' : (this.inside ? ' · CAPTURING' : '')}`;
        out.progress = this.capture;
        out.warn = this.contested;
        out.markers.push({ pos: this.zone.position, label: 'UPLINK', color: '#40e0ff' });
        break;
      case 'intel':
        out.detail = this.extract ? 'REACH EXTRACTION' : `DRIVES ${this.got}/3`;
        out.progress = this.got / 3;
        for (const d of this.drives) if (!d.got) out.markers.push({ pos: d.g.position, label: 'INTEL', color: '#ffc040' });
        if (this.extract) out.markers.push({ pos: new THREE.Vector3(this.extract.x, 0, this.extract.z), label: 'EXTRACT', color: '#40ff80' });
        break;
      case 'assassinate': {
        const b = em.boss;
        out.detail = b ? 'COMMANDER ON SITE' : 'LOCATING…';
        if (b && b.alive) out.markers.push({ pos: b.group.position, label: 'TARGET', color: '#ff3050' });
        break;
      }
    }
    return out;
  }
}
