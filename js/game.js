// ============================================================
// game.js — orchestrator: renderer + post-processing pipeline
// (RenderPass → UnrealBloom → OutputPass, ACES, sRGB), staged
// loading, world assembly, input, the full fire pipeline
// (recoil → flash → sound → shake → raycast → impact → hitmarker),
// train/announcement events, mission/victory/restart, quality
// presets and the debug overlay.
// ============================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { ASSETS, DROPS, ENEMY, INTERMISSION, MISSIONS, PLAYER, SLOWMO, QUALITY_PRESETS } from './config.js';
import { TEX } from './textures.js';
import { MAT } from './materials.js';
import { AssetManager } from './assetManager.js';
import { AudioManager } from './audioManager.js';
import { applyEnvironment } from './environment.js';
import { ColliderWorld } from './collision.js';
import { LightRig } from './lightRig.js';
import { Station } from './station.js';
import { Store } from './store.js';
import { Platform } from './platform.js';
import { Sakura } from './sakura.js';
import { NewAreas, THEME_BG } from './newAreas.js';
import { NewAreas2, THEME_BG2 } from './newAreas2.js';
import { NewAreas3 } from './newAreas3.js';
import { PickupManager } from './pickups.js';
import { Train } from './train.js';
import { WeaponController } from './weapon.js';
import { Player } from './player.js';
import { Enemy, EnemyManager } from './enemy.js';
import { ParticleManager } from './particleManager.js';
import { HUD } from './hud.js';
import { clamp, formatTime, nextFrame, rand } from './utils.js';

const ANNOUNCE_TEXT = '次の電車がまいります。危険ですので、黄色い線の内側までお下がりください。';
// maps that actually contain the subway — station audio/arrivals only here
const STATION_AREAS = new Set(['hall', 'platform', 'garden']);

export class Game {
  constructor() {
    this.state = 'boot';               // boot → start → playing → paused → victory
    this.qualityName = 'HIGH';
    this.keys = {};
    this.mouseDown = false;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.missionIdx = 0;               // campaign progress (config.js MISSIONS)
    this.elapsed = 0;                  // campaign time (victory stats)
    this._advancePending = false;      // victory overlay click → next mission vs restart
    this._interTO = 0;                 // intermission auto-advance timeout id
    this.slow = { t: 0, scale: 1 };
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.kills = 0;
    this.hearCd = 0;
    this.debugOn = true;
    this.fpsEMA = 60;
    this._statT = 0;
    this._scratch = new THREE.Vector3();
    this._hsPops = [];                 // floating HEADSHOT tags
    this._hsNdc = new THREE.Vector3();
    this._shotDirty = true;            // shot target list rebuild flag
    this._enemyAim = new THREE.Vector3();  // scratch for enemy fire aims
    this._raycaster = new THREE.Raycaster();
    this.raycaster = this._raycaster;
    this.hud = new HUD();
  }

  // ==================== BOOT ====================

  async boot() {
    const ui = {
      loading: document.getElementById('loading'),
      bar: document.getElementById('l-bar'),
      pct: document.getElementById('l-pct'),
      step: document.getElementById('l-step'),
      items: document.getElementById('l-items'),
    };
    const stage = async (pct, label, itemLabel) => {
      ui.bar.style.width = `${pct}%`;
      ui.pct.textContent = `${pct}%`;
      ui.step.textContent = label;
      if (itemLabel) ui.items.appendChild(Object.assign(document.createElement('div'), { textContent: `✓ ${itemLabel}` }));
      await nextFrame();
      await nextFrame();
    };

    try {
      await stage(4, 'Renderer · WebGL2');
      this._initRenderer();
      this._initScene();

      // ---------- external assets (never blocks on failure) ----------
      await stage(10, 'Loading assets (GLB / HDR)');
      this.assets = new AssetManager();
      const [hdrTex, enemyGLB, rifleGLB, trainGLB] = await Promise.all([
        this.assets.loadHDR('hdr', ASSETS.hdr),
        this.assets.loadGLTF('enemy', ASSETS.models.enemy),
        this.assets.loadGLTF('rifle', ASSETS.models.rifle),
        this.assets.loadGLTF('train', ASSETS.models.train),
      ]);
      this.enemyGLB = enemyGLB; this.rifleGLB = rifleGLB; this.trainGLB = trainGLB;

      await stage(22, 'HDR environment · PBR · ACES', hdrTex ? 'HDR loaded' : 'Textures + procedural HDR env');
      this._initPost();
      applyEnvironment(this.scene, this.renderer, hdrTex, this._preset().envResolution);

      await stage(34, 'Materials · procedural textures', 'PBR materials');

      await stage(48, 'Building: Station', 'Station');
      this._buildStation();

      await stage(60, 'Building: Platform + train', 'Platform');
      this._buildPlatform();
      await stage(66, 'Building: Train', 'Train');
      this._buildTrain();

      await stage(72, 'Building: Convenience store', 'Store');
      this._buildStore();

      await stage(78, 'Planting: Sakura garden', 'Sakura');
      this._buildSakura();

      // Themed maps are built ONE PER AREA (newAreas*.buildArea) so boot
      // yields between maps: each map is one canvas+geometry block of a few
      // hundred ms; one block per AREA keeps every main-thread task short
      // and lets the bar animate — the "loading screen wedges several
      // times" pattern was exactly these blocks back-to-back.
      this.newAreas = new NewAreas(this.scene, this.world, this.particles);
      this.newAreas2 = new NewAreas2(this.scene, this.world, this.particles);
      this.newAreas3 = new NewAreas3(this.scene, this.world, this.particles);
      const mgrs = [this.newAreas, this.newAreas2, this.newAreas3];
      const totalAreas = mgrs.reduce((n, m) => n + m.areaNames.length, 0);
      let pct = 82;
      const stepPct = (89 - pct) / totalAreas;
      for (const mgr of mgrs) {
        for (const a of mgr.areaNames) {
          mgr.buildArea(a);
          pct += stepPct;
          await stage(Math.round(pct), `Building: Sector map · ${a.toUpperCase()}`, a);
        }
        this.envMeshes.push(...mgr.raycastMeshes);
      }
      this.pickups = new PickupManager(this.scene, this.particles);
      // MISSIONS[0] is the station. Boot never runs _setupMission, so without
      // this every themed world stays visible for mission 01 — measured
      // 14.8k draw calls / 881k tris on the first minutes of play vs 480
      // after a mission change. The prewarm pass uploads their buffers
      // anyway, so arming a themed mission later costs nothing.
      this._applyWorldVisibility(this._mission().area);

      await stage(90, 'Loading: Weapons', 'Weapons');
      this.player = new Player(this.camera, this.world, this.audio);
      this.scene.add(this.camera);
      this.weapon = new WeaponController(this.camera, this.audio, this.particles);
      this.weapon.init(this.rifleGLB ?? null);

      await stage(92, 'Spawning: Enemies', 'Enemies');
      this._buildEnemies();

      await stage(94, 'Lighting: fixed-budget rig', `${(this._preset().lightBudget)} light slots`);
      // Every point light the 16 arenas ask for would be uploaded to every
      // material and looped per fragment; the rig keeps a constant count and
      // feeds it the fixtures nearest the camera. Collected BEFORE the prewarm
      // compile so the compiled programs match what play will actually use.
      this.lightRig = new LightRig(this.scene, this._preset().lightBudget);
      console.log(`[lights] ${this.lightRig.collect()} fixtures -> pool of ${this.lightRig.budget}`);

      await stage(96, 'Preparing: Audio graph', 'Audio (synth, Web Audio)');
      await this.audio.prepare();   // synth + file fetch here, not on the start click

      await stage(98, 'Final self-check');
      await this._finalChecks();

      await stage(100, 'READY');
      this._installProfilers();
      ui.loading.classList.add('hidden');
      document.getElementById('start-screen').classList.remove('hidden');
      this.state = 'start';
    } catch (err) {
      ui.step.textContent = `FATAL: ${err.message}`;
      console.error(err);
      return;
    }

    this._wireUI();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _stage() {}

  _preset() { return QUALITY_PRESETS[this.qualityName]; }

  _initRenderer() {
    const canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // accumulate draw stats across the whole composer chain, not just the last pass
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(PLAYER.fov, window.innerWidth / window.innerHeight, 0.05, 800);
    this.world = new ColliderWorld();
    this.audio = new AudioManager();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.envMeshes = [];
    this.particles = new ParticleManager(this.scene, this._preset().particleScale);
    this._initMuzzleFX();
  }

  // Shared pool of point lights for ENEMY muzzle flashes: three lights
  // stay in the scene permanently (intensity 0 when idle) so the light
  // count — and therefore shader compilation — never changes mid-game.
  _initMuzzleFX() {
    this._mfx = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb066, 0, 11, 2);
      this.scene.add(l);
      this._mfx.push({ l, t: 0 });
    }
    this._mfxI = 0;
  }

  _addMuzzleLight(pos) {
    const s = this._mfx[this._mfxI];
    this._mfxI = (this._mfxI + 1) % this._mfx.length;
    s.l.position.copy(pos);
    s.t = 0.12;
  }

  _updateMuzzleFX(dt) {
    for (const s of this._mfx) {
      if (s.t > 0) {
        s.t -= dt;
        s.l.intensity = 40 * Math.max(0, s.t / 0.12);
      } else if (s.l.intensity !== 0) {
        s.l.intensity = 0;
      }
    }
  }

  _initPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const p = this._preset();
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      p.bloomStrength, 0.55, 0.82,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this._applyPixelRatio();
  }

  _applyPixelRatio() {
    const p = this._preset();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
    this._updateParticleScale();
  }

  _updateParticleScale() {
    const h = this.renderer.domElement.height;               // physical px
    const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.particles?.setViewScale(s);
  }

  _buildStation() {
    this.station = new Station(this.scene, this.world);
    this.station.build();
    this.envMeshes.push(...this.station.raycastMeshes);

    // configure the moon as the ONE shadow caster (perf)
    const p = this._preset();
    this.moon = this.station.moon;
    this.moon.castShadow = p.shadows;
    this.moon.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    Object.assign(this.moon.shadow.camera, { left: -52, right: 20, top: 26, bottom: -32, near: 10, far: 180 });
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.05;
    this.moon.shadow.camera.updateProjectionMatrix();
  }

  _buildPlatform() {
    this.platform = new Platform(this.scene, this.world);
    this.platform.cityDetail = this._preset().cityDetail;   // skyline density per preset
    this.platform.build();
    this.envMeshes.push(...this.platform.raycastMeshes);
    for (const pnl of this.platform.panels) pnl.userData.shatter = true;
  }

  _buildStore() {
    this.store = new Store(this.scene, this.world);
    this.store.build();
    this.envMeshes.push(...this.store.raycastMeshes);
    this.store.doorA.userData.shatter = true;
    this.store.doorB.userData.shatter = true;
  }

  _buildSakura() {
    this.sakura = new Sakura(this.scene, this._preset().particleScale);
    this.sakura.build();
  }

  /** Show only the current mission's themed world (station missions hide all
   *  three managers' groups). Called at boot AND on every mission change:
   *  un-armed worlds are uploaded to VRAM once by the prewarm pass, then stay
   *  hidden — walking into a new arena never pays an upload, and the current
   *  mission never draws the other 15 worlds. */
  _applyWorldVisibility(area) {
    this.newAreas.setVisible(area);
    this.newAreas2.setVisible(area);
    this.newAreas3.setVisible(area);
    if (this.platform?.cityGroup) {
      this.platform.cityGroup.visible = STATION_AREAS.has(area) || area === 'cyber';
    }
  }

  _buildTrain() {
    // The station jingle (Japanese arrival announcement, chimes, brake
    // squeal) belongs to the subway maps only — themed worlds must never
    // hear it (the train line itself stays parked out there).
    const inStation = () => STATION_AREAS.has(this._mission().area);
    this.train = new Train(this.scene, this.world, {
      onApproach: () => {
        if (!inStation()) return;
        this.audio.announce(ANNOUNCE_TEXT);
        if (this.speakerChime) this.audio.playPositional(this.speakerChime);
      },
      onBrake: () => { if (inStation()) this.audio.play('trainBrake', { volume: 0.8 }); },
      onStop: () => {},
      onDoorsOpen: () => { this.platform.setDoors(true); if (inStation()) this.audio.play('chime', { volume: 0.35 }); },
      onDoorsClose: () => this.platform.setDoors(false),
      onDepart: () => {},
    }, this.trainGLB ?? null);
    this.train.build();
    this.train.group.visible = false;   // first arrival after a few seconds
    this.envMeshes.push(...this.train.raycastMeshes);
  }

  _buildEnemies() {
    this.enemyMgr = new EnemyManager(this.scene, this.world, this.enemyGLB ?? null);
    this.enemyMgr.deploy(this._mission());
  }

  _mission() { return MISSIONS[this.missionIdx]; }

  // Program compilation and GPU buffer uploads for everything in the world,
  // done behind the loading screen. Also right before play starts, because a
  // quality change moves the shadow map, pixel ratio and light-pool size, and
  // each of those re-keys every program: warmed here, none of that lands as a
  // freeze in the first minutes of a run.
  /** TEX and MAT are lazy memoized registries: a texture's canvas drawing, its
   *  GPU upload and (for MeshPhysicalMaterial) its program variant are paid on
   *  FIRST use — muzzleFlash/spark/smoke/shard/bulletHole in the first
   *  firefight, signage when a sign first enters view. Touch every getter so
   *  none of that lands mid-fight. */
  _warmRegistries() {
    const t0 = performance.now();
    let touched = 0;
    for (const reg of [TEX, MAT]) {
      const seen = new Set();
      for (let o = reg; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
        for (const key of Object.getOwnPropertyNames(o)) {
          if (seen.has(key) || key === 'constructor') continue;
          seen.add(key);
          if (typeof Object.getOwnPropertyDescriptor(o, key)?.get === 'function') { void reg[key]; touched++; }
        }
      }
    }
    return { touched, ms: Math.round(performance.now() - t0) };
  }

  // Program compilation and GPU buffer uploads for everything in the world,
  // done behind the loading screen. Measured on boot this used to be ONE
  // ~8 s synchronous block (compile + two full-res composer renders of all
  // 16 arenas) — that was the loading screen wedging at "READY". Now it is
  // incremental, in three steps, each one a short task:
  //   1. compileAsync (r165) when the driver has KHR_parallel_shader_compile,
  //      so the ~110 program variants link while the browser keeps painting;
  //   2. batched first-draws into a tiny OFFSCREEN target — the first draw of
  //      a geometry/texture is what uploads it, and a 480×270 offscreen pass
  //      pays full upload cost at ~zero raster cost. Offscreen because these
  //      frames show only one batch of the world (and the overlays here are
  //      semi-transparent, so they must never reach the canvas);
  //   3. one real composer frame at full size — compiles/allocates the post
  //      chain targets and the shadow map with the final object set.
  // Total GPU work is unchanged; no single main-thread task is long.
  async _prewarmMaterials(bootPass = false) {
    if (this._pwPromise) { this._pwAgain = true; return this._pwPromise; }
    this._pwPromise = this._prewarmRun(bootPass).finally(() => {
      this._pwPromise = null;
      // a quality change mid-warm re-keyed programs again — one follow-up pass
      if (this._pwAgain) { this._pwAgain = false; this._prewarmMaterials(false); }
    });
    return this._pwPromise;
  }

  async _prewarmRun(bootPass = false) {
    const t0 = performance.now();
    const registries = this._warmRegistries();

    // Quality change mid-session: buffers were uploaded at boot and never
    // leave VRAM, so ONLY the programs need re-keying (shadows / pixel ratio
    // / light pool). compileAsync links them while the browser keeps
    // painting; then one normal frame. The live loop keeps rendering the
    // real scene the whole time — nothing in the graph is touched.
    if (!bootPass) {
      try {
        if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
        else this.renderer.compile(this.scene, this.camera);
      } catch (err) {
        console.warn('[warm] compileAsync failed — sync fallback', err);
        this.renderer.compile(this.scene, this.camera);
      }
      this.composer.render();
      window.__bootTimings = { registries, rewarm: Math.round(performance.now() - t0) };
      console.log(`[warm] re-compile ${Math.round(performance.now() - t0)} ms (yielded, no scene edits)`);
      return;
    }

    const undoWarm = await this._warmUpEntities();
    const hidden = [];
    const culled = [];
    const lods = [];
    this.scene.traverse((o) => {
      if (!o.visible) { o.visible = true; hidden.push(o); }
      // Visible is not enough: one camera pose frustum-culls the other 15 arenas,
      // and a culled object never binds its attribute buffers, so their geometry
      // and textures upload the moment you first walk into each area. That is the
      // "stalls for the first few minutes" pattern. One no-cull pass puts the
      // whole station into VRAM while the loading screen still covers the canvas.
      if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
      // Same trap in LOD form: from the spawn pose every distant cluster renders
      // only its bboxProxy level, so the HI geometry + its canvas textures upload
      // mid-fight when the player first walks close enough to swap. Force every
      // level to draw during the warm passes; the next real frame's LOD.update
      // picks the right level again.
      if (o.isLOD) {
        lods.push(o);
        o.autoUpdate = false;
        for (const lv of o.levels) {
          if (!lv.object.visible) { lv.object.visible = true; hidden.push(lv.object); }
        }
      }
    });
    const tc = performance.now();

    // 1 — shader programs (async where the driver supports it)
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
      else this.renderer.compile(this.scene, this.camera);
    } catch (err) {
      console.warn('[warm] compileAsync failed — sync fallback', err);
      this.renderer.compile(this.scene, this.camera);
    }

    // 2 — batched buffer uploads, offscreen, one frame per batch.
    // The per-batch frame does the MINIMUM: no background pass and (after
    // the first batch) no shadow pass — the point of a batch is the first
    // gl.bindBuffer of that batch's geometries, not re-rasterizing the
    // moon's 2048² shadow map eighteen times.
    const rt = new THREE.WebGLRenderTarget(480, 270);
    const kids = this.scene.children.slice();
    const B = 20;
    const stepEl = document.getElementById('l-step');
    const barEl = document.getElementById('l-bar');
    const bg = this.scene.background;
    this.scene.background = null;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setRenderTarget(rt);
    for (let i = 0; i < kids.length; i += B) {
      for (let j = 0; j < kids.length; j++) kids[j].visible = (j >= i && j < i + B);
      this.renderer.shadowMap.needsUpdate = i === 0;   // casters bind once
      this.renderer.render(this.scene, this.camera);
      if (this.state === 'boot') {   // keep the loading panel alive during this phase
        const f = i / kids.length;
        stepEl.textContent = `Uploading VRAM · ${Math.min(kids.length, i + B)}/${kids.length}`;
        barEl.style.width = `${Math.round(98 + 2 * f)}%`;
      }
      await nextFrame();
    }
    for (const k of kids) k.visible = true;

    // 2b — warm every themed sky: each world's equirect background texture
    // AND its background-program variant first bind at that mission's
    // switch (measured: textures 68→81, programs 172→177 climbing during
    // play). Bind them now, one offscreen frame per sky, while nothing
    // depends on that frame.
    const bgMap = this._bgMap ?? (this._bgMap = { ...THEME_BG, ...THEME_BG2 });
    const bgs = [...new Set(Object.values(bgMap).filter((t) => t))];
    this.renderer.setRenderTarget(rt);
    for (const k of kids) k.visible = false;   // background-only frames
    for (let i = 0; i < bgs.length; i++) {
      this.scene.background = bgs[i];
      if (this.state === 'boot') stepEl.textContent = `Warming skies · ${i + 1}/${bgs.length}`;
      this.renderer.render(this.scene, this.camera);
      await nextFrame();
    }
    for (const k of kids) k.visible = true;
    this.renderer.setRenderTarget(null);
    this.scene.background = bg;

    // 3 — one warm frame for the POST CHAIN (bloom/output programs, RTs,
    // the complete-caster shadow map): run the composer itself at the tiny
    // size, then hand the real size back. Full-res rasterization here buys
    // nothing that the first gameplay frame wouldn't pay at its normal cost,
    // and at 11k objects that full-res frame IS the stall.
    this.composer.setSize(480, 270);
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
    this.renderer.shadowMap.autoUpdate = true;
    this.composer.setSize(window.innerWidth, window.innerHeight);
    rt.dispose();

    const compileMs = Math.round(performance.now() - tc);
    for (const o of culled) o.frustumCulled = true;
    for (const o of hidden) o.visible = false;
    for (const o of lods) o.autoUpdate = true;   // next frame re-picks the level
    undoWarm();
    // What startup actually costs, per phase: readable here (window.__bootTimings)
    // so a stall on a real GPU can be traced to a phase instead of guessed at.
    window.__bootTimings = { registries, compileRender: compileMs, total: Math.round(performance.now() - t0) };
    console.log(`[warm] ${registries.touched} lazy textures/materials in ${registries.ms} ms; compile+batched upload ${compileMs} ms (yielded)`);
  }

  // Every hostile class and every drop builds its own meshes, materials and
  // geometry on first spawn, so a session's first rifle/rusher/heavy/marksman/
  // stalker/breacher/bombardier each pays a shader + upload cost mid-fight.
  // Put one of each in FRONT of the camera (frustum-culled objects never get
  // their buffers uploaded, so they cannot be parked out of sight), render the
  // prewarm pass over them, then clear. They are drawn once, behind the loading
  // screen, and never seen again.
  async _warmUpEntities() {
    if (this._entityWarm) return () => {};   // one pass per session is enough
    this._entityWarm = true;
    const em = this.enemyMgr;
    const spawned = [];
    const cam = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    for (const cls of Object.keys(ENEMY.classes)) {
      for (const elite of [false, true]) {
        const e = new Enemy(spawned.length, this.scene, em.gltfScene, [[0, 0]], { cls, elite });
        e.group.position.set(cam.x + dir.x * 6, 0, cam.z + dir.z * 6);
        e.group.rotation.y = Math.atan2(-dir.x, -dir.z);
        em.enemies.push(e);
        em.hitMeshes.push(...e.hitMeshes);
        spawned.push(e);
      }
      await nextFrame();   // one class's geometry per frame — no build burst
    }
    const dropFloor = this.pickups.drops.length;
    for (const kind of ['ammo', 'medkit']) {
      this.pickups._spawn(kind, new THREE.Vector3(cam.x + dir.x * 4, 0.62, cam.z + dir.z * 4));
    }
    const drops = this.pickups.drops.slice(dropFloor);
    console.log(`[warmup] ${spawned.length} hostile dummies (${Object.keys(ENEMY.classes).length} classes) + ${drops.length} drops`);
    // Remove exactly the dummies. _clearAll() is NOT usable here: wave 1 is
    // already deployed at boot (game.js _buildEnemies), so clearing the field
    // would delete the real hostiles and the queued waves with them.
    return () => {
      const dummies = new Set(spawned);
      for (const e of spawned) this.scene.remove(e.group);
      em.enemies = em.enemies.filter((e) => !dummies.has(e));
      em.hitMeshes = em.enemies.flatMap((e) => e.hitMeshes || []);
      const extra = new Set(drops);
      for (const d of drops) this.scene.remove(d.mesh);
      this.pickups.drops = this.pickups.drops.filter((d) => !extra.has(d));
    };
  }

  async _finalChecks() {
    // touch texture getters so canvas work happens during loading, and warm shaders
    void TEX.marbleFloor; void TEX.infoScreen;
    // Prewarm: flip every not-yet-seen object visible (train is hidden until
    // its first arrival; tracer/decal/hitbox meshes until their first use) and
    // compile + upload in short batches, so program compilation and GPU buffer
    // uploads all happen behind the loading screen instead of as a
    // multi-second hitch mid-fight when those objects first appear.
    await this._prewarmMaterials(true);
    const gl = this.renderer.getContext();
    if (!gl || !(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)) {
      console.warn('[Game] WebGL2 context not detected — continuing with whatever we have.');
    }
  }

  // ==================== UI / STATE ====================

  _wireUI() {
    const startEl = document.getElementById('start-screen');
    const pauseEl = document.getElementById('pause-screen');
    const victoryEl = document.getElementById('victory');

    document.getElementById('start-quality').addEventListener('change', (e) => this._setQuality(e.target.value));
    document.getElementById('pause-quality').addEventListener('change', (e) => this._setQuality(e.target.value));

    // clicks that land on the quality picker (or its label) must not also
    // start/resume — pointer lock would snap the native dropdown shut
    startEl.addEventListener('click', (e) => {
      if (!e.target.closest('select, label')) this.startGame();
    });
    pauseEl.addEventListener('click', (e) => {
      if (!e.target.closest('select, label')) this.resume();
    });
    victoryEl.addEventListener('click', () => {
      if (this._advancePending) this._advanceMission();
      else this.restart();
    });

    this.player.controls.addEventListener('lock', () => {
      pauseEl.classList.add('hidden');
      if (this.state === 'paused') this.state = 'playing';
    });
    this.player.controls.addEventListener('unlock', () => {
      if (this.state === 'playing') {
        this.state = 'paused';
        pauseEl.classList.remove('hidden');
      }
    });

    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('keydown', (e) => this._onKey(e, true));
    document.addEventListener('keyup', (e) => this._onKey(e, false));
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.state === 'playing') this.mouseDown = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  async startGame() {
    if (this.state !== 'start') return;
    document.getElementById('start-screen').classList.add('hidden');
    const q = document.getElementById('start-quality').value;
    const changed = q !== this.qualityName;
    this._setQuality(q);
    // Only re-warm when the quality actually differs from what boot compiled:
    // a change re-keys every program, and that must not land in the first
    // minutes of play. Same quality, nothing to recompile, no blocked click.
    // When it DOES differ, re-warm incrementally (compileAsync + batched
    // uploads, frames yielded) with the loading card back up — the click is
    // never followed by a multi-second freeze.
    if (changed) {
      const loadEl = document.getElementById('loading');
      const barEl = document.getElementById('l-bar');
      const stepEl = document.getElementById('l-step');
      loadEl.classList.remove('hidden');
      barEl.style.width = '60%';
      stepEl.textContent = `Recompiling shaders for ${q} · 再コンパイル中…`;
      await this._prewarmMaterials();
      barEl.style.width = '100%';
      loadEl.classList.add('hidden');
    }
    this.hud.show();
    this.hud.setMission(this._mission());
    this.hud.setWave(this.enemyMgr.waveInfo());
    this.hud.setWeaponName(this.weapon.w.def.label);
    this.hud.setTargets(this.enemyMgr.remaining());
    this.hud.setAmmo(this.weapon.w.mag, this.weapon.w.reserve);
    this.hud.setHP(this.player.hp);

    await this.audio.init();
    this.audio.listener && this.camera.add(this.audio.listener);
    this._attachPositionalAudio();
    this.audio.startAmbient();
    this.hud.missionBanner();
    this._lockPointer();
    this.state = 'playing';
    this.clock.getDelta();
  }

  _attachPositionalAudio() {
    this.train.setRumble(this.audio.attachPositional('trainRumble', this.train.rumbleAnchor, {
      volume: 0.9, refDistance: 8, maxDistance: 130, rolloff: 0.8,
    }));
    this.storeHumPA = this.audio.attachPositional('storeHum', this.store.humAnchor, {
      volume: 0.55, refDistance: 2.5, maxDistance: 14,
    });
    this.speakerChime = this.audio.attachPositional('chime', this.platform.speakerAnchor, {
      volume: 1.2, refDistance: 4, maxDistance: 40, loop: false,
    });
    if (this.storeHumPA) this.storeHumPA.play();
    this.enemyMgr.attachAudio(this.audio);
    // train rumble: train.update() starts it the first time the train moves
  }

  _lockPointer() {
    // requestPointerLock() rejects a Promise when no user gesture covers it —
    // catch BOTH forms so the auto-advance path never logs an unhandled error
    // (Chrome's engagement window usually covers it; _autoLockGuard/pause
    // card handles the rest).
    try {
      const p = this.player.controls.lock();
      if (p && typeof p.catch === 'function') p.catch(() => { /* see _autoLockGuard */ });
    } catch { /* user gesture may not register; click again */ }
  }

  resume() {
    if (this.state !== 'paused') return;
    this._lockPointer();
    document.getElementById('pause-screen').classList.add('hidden');
    this.state = 'playing';
    this.clock.getDelta();
  }

  restart() {
    this.hud.hideVictory();
    clearTimeout(this._interTO);
    this._advancePending = false;
    this.missionIdx = 0;
    this.kills = 0; this.shotsFired = 0; this.shotsHit = 0;
    this.elapsed = 0;
    this._setupMission();
    this.state = 'playing';
    this._lockPointer();
    this.clock.getDelta();
  }

  // ---------- campaign mission flow ----------

  /** Arm the current mission: player spawn, wave-based RANDOM hostiles, HUD, atmosphere. */
  _setupMission() {
    const m = this._mission();
    this._deembedSpawn(m.spawn);
    this.player.setSpawn(m.spawn);
    this.player.hp = PLAYER.maxHp;
    this.player.missionTime = 0;
    this.hud.setHP(this.player.hp);
    this.weapon.reset();
    this.hud.setWeaponName(this.weapon.w.def.label);
    this.hud.setAmmo(this.weapon.w.mag, this.weapon.w.reserve);
    this.enemyMgr.deploy(m);
    this.enemyMgr.resetRecallClock();
    this.pickups.clear();
    this._shotDirty = true;
    this.enemyMgr.attachAudio(this.audio);
    this.train.reset();
    this.platform.setDoors(false);
    if (STATION_AREAS.has(m.area)) {
      if (m.trainSoon) this.train.timer = 4;   // a train rolls in early — platform showcase
    } else {
      this.train.timer = 1e9;   // no subway out here: the commuter line stays parked
    }
    // interior rect of themed arenas (station areas are walled by the map
    // itself) — drives the player containment guard + enemy anti-stuck
    this._arenaRect = this.newAreas.bounds[m.area]
      ?? this.newAreas2.bounds[m.area]
      ?? this.newAreas3.bounds[m.area]
      ?? null;
    // the night-city skyline belongs to the station (+ the neon city of
    // cyber); a lunar base / tomb / sky gantry / lab / sunken ruins must
    // not have Tokyo towers poking over the walls. Each themed world
    // renders only while its own mission is active — kills cross-world
    // bleed-through and keeps draw calls down (same call boot uses).
    this._applyWorldVisibility(m.area);
    this._applyAtmosphere(m);
    // Per-world player physics + special mechanics (moremaps.md mods)
    this._mods = m.mods ?? {};
    this.player.setMods(this._mods);
    this._empT = 9 + Math.random() * 7;
    this._empActive = 0;
    this._cargoCd = 0;
    this._hazCd = 0;
    this._zoneSlow = 1;
    // chunk visibility radius: just past the fog wall (mapChunks)
    const vd = (m.atmo?.fogFar ?? 160) + 25;
    this.newAreas.setViewDist(m.area, vd);
    this.newAreas2.setViewDist(m.area, vd);
    this.newAreas3.setViewDist(m.area, vd);
    this.hud.waterToggle(!!this._mods.underwater);
    this.hud.empGlitch(false);
    this.slow.t = 0;
    this.hud.setMission(m, this.missionIdx + 1, MISSIONS.length);
    this.hud.setWave(this.enemyMgr.waveInfo());
    this.hud.setTargets(this.enemyMgr.remaining());
    this.hud.missionBanner();
  }

  _intermission() {
    if (this.state !== 'playing') return;
    // LIVE intermission: the world keeps running (the last kill already
    // happened — nothing left to fight) so the player can walk around,
    // reload, loot while the result card counts down and auto-advances.
    // state stays 'playing'; pointer lock stays on.
    this._advancePending = true;
    this.audio.play('victory', { volume: 0.9 });
    const acc = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    this.hud.showIntermission(this._mission(), MISSIONS[this.missionIdx + 1], this.kills, acc, formatTime(this.elapsed), INTERMISSION.seconds);
    document.getElementById('pause-screen').classList.add('hidden');
    // the window dismisses itself when the countdown runs out — the player
    // never has to click; if they ESC-paused, defer until they are back
    clearTimeout(this._interTO);
    const tryAdvance = () => {
      if (!this._advancePending) return;
      if (!document.getElementById('pause-screen').classList.contains('hidden')) {
        this._interTO = setTimeout(tryAdvance, 1000);
        return;
      }
      this._advanceMission(true);
    };
    this._interTO = setTimeout(tryAdvance, INTERMISSION.seconds * 1000);
  }

  _advanceMission(auto = false) {
    if (this.missionIdx >= MISSIONS.length - 1) { this.restart(); return; }
    clearTimeout(this._interTO);
    this._advancePending = false;
    this.missionIdx++;
    this.hud.hideVictory();
    this._setupMission();
    this.state = 'playing';
    this._lockPointer();
    if (auto) this._autoLockGuard();
    this.clock.getDelta();
  }

  /** Chrome lets a just-released pointer lock re-lock without a click only
   *  inside its short engagement window — the auto-advance fires inside it,
   *  but if the re-lock still fails show the pause card so one real click
   *  (a genuine user gesture) restores mouse-look. */
  _autoLockGuard() {
    setTimeout(() => {
      if (this.state === 'playing' && !this.player.controls.isLocked) {
        this.state = 'paused';
        document.getElementById('pause-screen').classList.remove('hidden');
      }
    }, 400);
  }

  _applyAtmosphere(m) {
    const at = m.atmo ?? {};
    if (this.scene.fog) {
      this.scene.fog.near = at.fogNear ?? 55;
      this.scene.fog.far = at.fogFar ?? 230;
      // per-world fog tint: sealed brass halls need warm haze, not navy void
      this.scene.fog.color.set(at.fogColor ?? 0x070b15);
    }
    this._fogBase = { near: this.scene.fog?.near ?? 55, far: this.scene.fog?.far ?? 230 };
    // clip the frustum near the fog wall — neighbouring worlds 200+ m
    // away never need to be drawn (orbit overrides with a huge farClip
    // so the Earth sphere stays visible)
    this.camera.far = at.farClip ?? Math.max(150, (at.fogFar ?? 230) + 90);
    this.camera.updateProjectionMatrix();
    if (this.moon) this.moon.intensity = at.moon ?? 0.8;
    // Themed equirect background (THEME_BG) for the twelve new worlds;
    // station missions keep the env-mapped night sky.
    if (this._bgStation === undefined) {
      this._bgStation = this.scene.background;
      this._bgStationIntensity = this.scene.backgroundIntensity ?? 1;
    }
    const bgMap = this._bgMap ?? (this._bgMap = { ...THEME_BG, ...THEME_BG2 });
    const bg = at.bg ? bgMap[at.bg] : this._bgStation;
    this.scene.background = bg ?? this.scene.background;
    this.scene.backgroundIntensity = at.bg ? 1 : this._bgStationIntensity;
    // per-mission bloom multiplier — glow-heavy worlds (aquarium) dial
    // their own bloom down so enemy silhouettes stay readable
    this._bloomScale = at.bloom ?? 1;
    if (this.bloomPass && this.bloomPass.enabled) {
      this.bloomPass.strength = this._preset().bloomStrength * this._bloomScale;
    }
  }

  _setQuality(name) {
    if (!QUALITY_PRESETS[name]) return;
    this.qualityName = name;
    const p = this._preset();
    document.getElementById('d-quality').textContent = p.label;
    this._applyPixelRatio();
    // bloom
    if (this.bloomPass) {
      this.bloomPass.enabled = p.bloom;
      this.bloomPass.strength = p.bloomStrength * (this._bloomScale ?? 1);
    }
    // shadows
    this.renderer.shadowMap.enabled = p.shadows;
    if (this.moon) {
      this.moon.castShadow = p.shadows;
      if (this.moon.shadow.map) { this.moon.shadow.map.dispose(); this.moon.shadow.map = null; }
      this.moon.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    }
    // extra lights + materials
    for (const l of [...(this.station?.qualityLights ?? []), ...(this.platform?.qualityLights ?? []), ...(this.store?.qualityLights ?? [])]) {
      l.visible = name !== 'LOW';
    }
    // Light budget follows the preset. This is the one place the pool resizes,
    // and a quality change recompiles for shadows/pixel ratio anyway.
    if (this.lightRig) this.lightRig.setBudget(p.lightBudget);
    MAT.setQuality(p);
    this.renderer.shadowMap.needsUpdate = true;
    // A quality change mid-session re-keys EVERY program (shadows, pixel
    // ratio, light-pool size) — the shadow map is also re-allocated above.
    // Without an immediate re-warm that whole compile lands as a
    // multi-second freeze on the first seconds after RESUME. Run the
    // incremental prewarm now, behind the pause card: yielded batches, no
    // stall when play resumes. (start/boot paths warm explicitly.)
    if (this.player && (this.state === 'playing' || this.state === 'paused')) {
      this._prewarmMaterials().catch((err) => console.warn('[warm] post-quality re-warm failed', err));
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this._updateParticleScale();
  }

  _onKey(e, down) {
    if (down && (e.code === 'Space' || e.code === 'Tab')) e.preventDefault();
    this.keys[e.code] = down;
    if (!down) return;

    if (e.code === 'F3') {
      this.debugOn = !this.debugOn;
      document.getElementById('debug').classList.toggle('hidden', !this.debugOn);
    } else if (e.code === 'KeyM' && this.audio.ready) {
      this.audio.setMuted(!this.audio.muted);
    } else if (this.state === 'playing') {
      if (e.code === 'KeyR') this.weapon.startReload();
      else if (e.code === 'Digit1') this.weapon.switchTo(0);
      else if (e.code === 'Digit2') this.weapon.switchTo(1);
      else if (e.code === 'Digit3') this.weapon.switchTo(2);
    }
  }

  // ==================== FIRING ====================

  _fireOnce() {
    const def = this.weapon.fire();
    const ctx = this.lastMoveCtx;
    if (!ctx) return;
    const spread = this.weapon.currentSpread(ctx);

    // camera recoil + shake + crosshair — the transient punch deepens as the
    // spray pattern heats up (see WeaponController.fire / RECOIL config)
    this.player.addRecoil(def.kick * 0.011 * (0.4 + 0.9 * this.weapon.sprayNorm));
    this.player.shake(0.004 * def.kick);
    this.hud.setFiring(true);
    clearTimeout(this._fireClassTO);
    this._fireClassTO = setTimeout(() => this.hud.setFiring(false), 60);

    // muzzle world position for hearing
    const mp = this.weapon.w.muzzle.getWorldPosition(this._scratch);
    if (this._mods?.underwater) this.particles.bubblePuff(mp.x, mp.y, mp.z, 5);

    // enemies hear the shot
    this.hearCd -= 1;
    if (this.hearCd <= 0) { this.enemyMgr.hearAll(mp); this.hearCd = 6; }

    // raycast pellets (scratch vectors — full-auto should allocate ~nothing)
    const dir = this._shotDir ?? (this._shotDir = new THREE.Vector3());
    this.camera.getWorldDirection(dir);
    const up = this._shotUp ?? (this._shotUp = new THREE.Vector3(0, 1, 0));
    const right = this._shotRight ?? (this._shotRight = new THREE.Vector3());
    right.crossVectors(dir, up).normalize();
    up.crossVectors(right, dir).normalize();
    // env ∩ hit-mesh target list is rebuilt only when the world or the
    // roster actually changed (respawn / kill / shatter) — not per shot
    if (this._shotDirty || !this._shotTargets) {
      this._shotTargets = this.envMeshes.concat(this.enemyMgr.hitMeshes);
      this._shotDirty = false;
    }
    const targets = this._shotTargets;

    for (let p = 0; p < def.pellets; p++) {
      this.shotsFired++;
      const jx = (Math.random() + Math.random() - 1) * spread;
      const jy = (Math.random() + Math.random() - 1) * spread;
      const shot = dir.clone()
        .addScaledVector(right, jx)
        .addScaledVector(up, jy)
        .normalize();
      this._raycaster.set(this.camera.position, shot);
      this._raycaster.far = def.range;
      const hits = this._raycaster.intersectObjects(targets, false);
      if (!hits.length) continue;
      const hit = hits[0];
      const enemy = hit.object.userData.enemy;

      if (enemy && enemy.state !== 'DEAD') {
        this.shotsHit++;
        const head = hit.object.userData.part === 'head';
        const killed = enemy.applyDamage(def.damage, hit.object.userData.part, -shot.x, -shot.z, {
          particles: this.particles,
          audio: this.audio,
          raycaster: this._raycaster,
          envMeshes: this.envMeshes,
          hitPoint: hit.point,
          onKilled: (e, hs) => this._onEnemyKilled(e, hs),
          onPlayerDamage: (n) => this._damagePlayer(n),
          world: this.world,
          playerPos: this.player.position,
        });
        this.hud.hitMarker(head);
        this.audio.play(head ? 'headshot' : 'hitMarker', { volume: 0.7 });
        if (head) {
          this.player.shake(0.008);
          this._slowmo(SLOWMO.headshot);
          this._addHSPop(enemy);           // small floating tag over the head
        }
        void killed;
      } else {
        this._environmentImpact(hit, shot);
      }
    }

    // CS-style view climb — permanent camera-pitch kick applied AFTER the
    // raycast: this shot goes where you aimed, the next one starts higher.
    // Sustained fire ramps the climb per shot (climbMin → climbMax across
    // sprayRamp shots); slow fire only ever pays climbMin, i.e. nothing.
    const cm = def.climbMin ?? 0.0015;
    const cx = def.climbMax ?? 0.008;
    const knee = def.climbKnee ?? 0;
    let t = this.weapon.sprayNorm;
    if (knee && this.weapon.spray > 0) {
      const n = this.weapon.spray;
      // gentle for the first `knee` shots, ACCELERATED climb after
      t = n <= knee ? 0.12 * (n / knee)
                    : 0.12 + 0.88 * Math.min((n - knee) / Math.max((def.sprayRamp ?? 8) - knee, 1), 1);
    }
    this.player.addPitch(cm + (cx - cm) * t);

    this._syncHudAmmo();
  }

  _environmentImpact(hit, shot) {
    const mesh = hit.object;
    // Polar cliff icicle — shooting one drops it on whatever is below.
    if (mesh.userData.icicle) {
      if (this.newAreas2.dropIcicle(mesh)) {
        const px = mesh.position.x, pz = mesh.position.z;
        this.audio.play('land', { volume: 1.0, rate: 0.7 });
        this.player.shake(0.02);
        for (const e of this.enemyMgr.enemies) {
          if (e.state === 'DEAD') continue;
          const dx = e.group.position.x - px, dz = e.group.position.z - pz;
          if (dx * dx + dz * dz < 9) {
            e.applyDamage(45, 'body', dx * 0.2, dz * 0.2, {
              particles: this.particles, audio: this.audio,
              hitPoint: new THREE.Vector3(px, 1.2, pz),
            });
          }
        }
      }
      this.particles.sparkBurst(hit.point.x, hit.point.y, hit.point.z, 0, -1, 0, 8);
      return;
    }
    // Tomb pillar mechanism — shooting it drops a boulder on whoever
    // stands below (same routing as the polar icicles, own drop logic).
    if (mesh.userData.fallTrap != null) {
      if (this.newAreas.dropFallTrap(mesh)) {
        const px = mesh.position.x, pz = mesh.position.z;
        this.audio.play('land', { volume: 1.0, rate: 0.6 });
        this.player.shake(0.03);
        for (const e of this.enemyMgr.enemies) {
          if (e.state === 'DEAD') continue;
          const dx = e.group.position.x - px, dz = e.group.position.z - pz;
          if (dx * dx + dz * dz < 12) {
            e.applyDamage(52, 'body', dx * 0.2, dz * 0.2, {
              particles: this.particles, audio: this.audio,
              hitPoint: new THREE.Vector3(px, 1.2, pz),
            });
          }
        }
      }
      this.particles.sparkBurst(hit.point.x, hit.point.y, hit.point.z, 0, -1, 0, 10);
      return;
    }
    // Lunar airlock wall switch — shooting it unseals the door.
    if (mesh.userData.switchDoor != null) {
      if (this.newAreas.openSwitch(mesh)) {
        mesh.material.emissive.setHex(0x4a0808);
        mesh.material.emissiveIntensity = 0.5;
      }
      this.particles.sparkBurst(hit.point.x, hit.point.y, hit.point.z, 0, 1, 0, 14);
      this.audio.play('switch', { volume: 0.8 });
      this.player.shake(0.003);
      return;
    }
    const tag = mesh.userData.tag ?? 'concrete';
    const n = hit.face
      ? hit.face.normal.clone().transformDirection(mesh.matrixWorld)
      : shot.clone().negate();
    const pt = hit.point;
    const placedDecal = this.particles.impact(tag, pt.x, pt.y, pt.z, n.x, n.y, n.z);
    if (placedDecal) this.particles.addDecal(pt, n);

    switch (tag) {
      case 'metal': this.audio.play('impactMetal', { volume: 0.55, rate: rand(0.9, 1.15) }); break;
      case 'wood': this.audio.play('impactWood', { volume: 0.6, rate: rand(0.9, 1.15) }); break;
      case 'glass':
        this.audio.play('impactGlass', { volume: 0.7 });
        if (mesh.userData.shatter && mesh.visible) {
          mesh.visible = false;
          this.envMeshes = this.envMeshes.filter((m) => m !== mesh);
          this._shotDirty = true;
        }
        break;
      default: this.audio.play('impactConcrete', { volume: 0.6, rate: rand(0.9, 1.12) }); break;
    }
    if (this._mods?.underwater) this.particles.bubblePuff(pt.x, pt.y, pt.z, 3);
    this.player.shake(0.0015);
  }

  /** Last-target bearing pips: once at most 2 hostiles remain, ring the
   *  crosshair with a marker per live enemy so a hidden last target is
   *  always findable (MISSION 06 tomb + MISSION 09 ruins deadlock class). */
  /** If a builder/prop ever eats a mission spawn point (MISSION 10 glacier
   *  ridge class of bug), nudge the spawn to the nearest open cell instead
   *  of spawning the player half-inside a collider. */
  _deembedSpawn(sp) {
    const world = this.player.world || this.world;
    if (!world) return;
    const R = 0.45;
    const solid = (x, z) => {
      for (const b of world.all())
        if (b.max.x > x - R && b.min.x < x + R && b.max.z > z - R && b.min.z < z + R &&
            b.max.y > 0.1 && b.min.y < 2.0) return true;
      return false;
    };
    if (!solid(sp.x, sp.z)) return;
    for (let ring = 1; ring <= 8; ring++) {
      const d = ring * 0.8;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d;
        if (!solid(x, z)) {
          console.warn(`[spawn] ${this._mission().area} spawn embedded — nudged to ${x.toFixed(1)},${z.toFixed(1)}`);
          sp.x = x; sp.z = z;
          return;
        }
      }
    }
  }

  _targetPips() {
    const rem = this.enemyMgr.remaining();
    if (rem === 0 || rem > 2) { this.hud.targetPips?.([]); return; }
    const p = this.player;
    // yaw lives in the camera quaternion (player has no .yaw field)
    this._pipEuler = this._pipEuler ?? new THREE.Euler();
    this._pipEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    const rel = [];
    for (const e of this.enemyMgr.enemies) {
      if (e.state === 'DEAD' || rel.length >= 2) continue;
      const dx = e.group.position.x - p.position.x;
      const dz = e.group.position.z - p.position.z;
      if (Math.hypot(dx, dz) < 3) continue;
      rel.push(Math.atan2(-dx, -dz) - this._pipEuler.y);
    }
    this.hud.targetPips?.(rel);
  }

  _onEnemyKilled(enemy, headshot) {
    this.kills++;
    this.pickups.spawnFrom(enemy);        // salvage drops (medkit / ammo)
    this.hud.killFeed(headshot);
    this.hud.setTargets(this.enemyMgr.remaining());
    this.enemyMgr.removeHitMeshes(enemy);
    this._shotDirty = true;
    this.player.shake(0.01);
    this.audio.play('headshot', { volume: 0.4, rate: 0.8 });

    if (this.enemyMgr.remaining() === 0) {
      this._slowmo(SLOWMO.finalKill);
      const isFinal = this.missionIdx >= MISSIONS.length - 1;
      setTimeout(() => { if (isFinal) this._victory(); else this._intermission(); }, 650);
    } else if (headshot) {
      // extra punch for headshot kills
      this._slowmo({ scale: 0.14, duration: 0.09 });
    }
  }

  _damagePlayer(n) {
    if (this.state !== 'playing') return;
    this.hud.flashDamage();
    const hp = this.player.damage(n);
    if (hp <= 0) {
      // overrun — redeploy at a RANDOM open point far from the live
      // hostiles (the fixed gate respawn meant walking out into a
      // firing squad every death). Partial refill only; full heals are
      // medkit-only. No hearAll: the insertion is meant to be quiet.
      this.player.setSpawn(this._pickRespawnPoint());
      this.player.hp = PLAYER.overrunHp;
      this.player.shake(0.03);
      this.hud.showDowned();              // WHY you woke up somewhere new
      this.hud.missionBanner();            // and which mission you're in
    }
    this.hud.setHP(this.player.hp);
  }

  /** Random safe redeploy point: open ground inside the arena bounds,
   *  >=16 m from every live hostile when findable, facing arena center.
   *  Falls back to the mission spawn if nothing clears. */
  _pickRespawnPoint() {
    const m = this._mission();
    const b = this._arenaRect;
    if (!b) return { ...m.spawn };
    const world = this.player.world || this.world;
    const solid = (x, z) => {
      for (const bb of world.all())
        if (bb.max.x > x - 0.5 && bb.min.x < x + 0.5 && bb.max.z > z - 0.5 && bb.min.z < z + 0.5 &&
            bb.max.y > 0.1 && bb.min.y < 2.0) return true;
      return false;
    };
    const live = this.enemyMgr.enemies.filter((e) => e.state !== 'DEAD');
    const pad = 2.5;
    if (b.x1 - b.x0 < pad * 3 || b.z1 - b.z0 < pad * 3) return { ...m.spawn };
    let best = null, bestD = -1;
    for (let i = 0; i < 48; i++) {
      const x = b.x0 + pad + Math.random() * (b.x1 - b.x0 - pad * 2);
      const z = b.z0 + pad + Math.random() * (b.z1 - b.z0 - pad * 2);
      if (solid(x, z)) continue;
      let d = 1e9;
      for (const e of live)
        d = Math.min(d, Math.hypot(e.group.position.x - x, e.group.position.z - z));
      if (d >= 16) { best = { x, z }; break; }
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    if (!best) return { ...m.spawn };
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    best.yaw = Math.atan2(-(cx - best.x), -(cz - best.z));
    return best;
  }

  _slowmo(cfg) { this.slow.t = cfg.duration; this.slow.scale = cfg.scale; }

  /** Grabbed a salvage drop: medkit patches HP, ammo restocks every weapon. */
  _collect(kind) {
    if (kind === 'medkit') {
      this.player.hp = Math.min(PLAYER.maxHp, this.player.hp + DROPS.medkitHp);
      this.hud.setHP(this.player.hp);
      this.audio.play('medkit', { volume: 0.8 });
      this.hud.pickupToast(`✚ +${DROPS.medkitHp} HP · 応急処置 MEDKIT`);
    } else {
      this.weapon.addReserve(null, DROPS.ammoRounds);
      this._syncHudAmmo();
      this.audio.play('pickup', { volume: 0.8 });
      this.hud.pickupToast(`▮ +${DROPS.ammoRounds} ROUNDS · 弾薬補給 AMMO`);
    }
  }

  // ---------- headshot tags (small text floating over the struck head) ----------

  _addHSPop(enemy) {
    if (this._hsPops.length >= 10) { const old = this._hsPops.shift(); old.el.remove(); }
    const el = this.hud.headshotPop();
    this._hsPops.push({
      el,
      pos: new THREE.Vector3(enemy.group.position.x, 2.05, enemy.group.position.z),
      t: 1.15, max: 1.15,
    });
  }

  _updateHSPops(dt) {
    if (!this._hsPops.length) return;
    for (let i = this._hsPops.length - 1; i >= 0; i--) {
      const p = this._hsPops[i];
      p.t -= dt;
      if (p.t <= 0) { p.el.remove(); this._hsPops.splice(i, 1); continue; }
      p.pos.y += dt * 0.45;                       // slow world-space drift up
      const ndc = this._hsNdc.copy(p.pos).project(this.camera);
      if (ndc.z > 1 || ndc.z < -1) { p.el.style.opacity = '0'; continue; }
      const rise = (1 - p.t / p.max) * 22;        // screen-space rise
      const x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-ndc.y * 0.5 + 0.5) * window.innerHeight - rise;
      p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      p.el.style.opacity = String(Math.min(1, p.t * 2.2));
    }
  }

  _victory() {
    if (this.state !== 'playing') return;
    this.state = 'victory';
    this.audio.play('victory', { volume: 0.9 });
    const acc = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    const isFinal = this.missionIdx >= MISSIONS.length - 1;
    this.hud.showVictory(this.kills, acc, formatTime(this.elapsed), isFinal);
    try { this.player.controls.unlock(); } catch { /* noop */ }
    document.getElementById('pause-screen').classList.add('hidden');
  }

  _syncHudAmmo() {
    const wp = this.weapon.w;
    this.hud.setAmmo(wp.mag, wp.reserve);
  }

  // ==================== LOOP ====================

  _loop() {
    requestAnimationFrame(this._loop);
    const dtReal = clamp(this.clock.getDelta(), 0, 0.05);
    this.time += dtReal;
    this.renderer.info.reset();

    const playing = this.state === 'playing';
    if (this.slow.t > 0) this.slow.t -= dtReal;
    const scale = this.slow.t > 0 ? this.slow.scale : 1;
    const dt = dtReal * scale;

    if (playing) {
      try {
        this._update(dt, dtReal);
      } catch (err) {
        if (!this._updErrLogged) { this._updErrLogged = true; console.error('[update]', err); }
      }
    }

    // world ambience keeps breathing even paused/victory (cheap)
    this.particles.update(playing ? dt : dtReal);
    if (!playing) this.station.update(dtReal, this.time);
    this._updateHSPops(dtReal);

    if (this.lightRig) this.lightRig.update(this.camera.position);
    this._profileFrame();
    this.composer.render();
    this._debug(dtReal);
  }

  // ==================== PROFILER (window.__prof) ====================
  // A live snapshot for measuring on real hardware: percentiles of TRUE frame
  // gaps (the loop's own dtReal is clamped to 50 ms, so it cannot show a hitch),
  // draw stats, program count and how much of the light budget is in use.
  // Call __prof(true) to clear the window between A/B runs.

  _installProfilers() {
    this._frameGaps = [];
    window.__hitches = [];
    this._bootT = performance.now();
    this._lastFrameT = performance.now();
    window.__prof = (reset = false) => {
      const gaps = [...this._frameGaps].sort((a, b) => a - b);
      const q = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0);
      const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
      const info = this.renderer.info;
      const out = {
        samples: gaps.length,
        fps: mean ? +(1000 / mean).toFixed(1) : 0,
        frameMS: { p50: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), p99: +q(0.99).toFixed(1), max: +q(0.999).toFixed(1) },
        hitchesOver50ms: this._frameGaps.filter((v) => v > 50).length,
        quality: this.qualityName, pixelRatio: this.renderer.getPixelRatio(),
        drawCalls: info.render.calls, triangles: info.render.triangles,
        programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures,
        lights: this.lightRig ? this.lightRig.stats() : null,
        state: this.state, mission: this._mission().name ?? this.missionIdx,
      };
      if (reset) this._frameGaps.length = 0;
      return out;
    };
  }

  // Every frame slower than HITCH_MS is recorded with its context so a stall on
  // real hardware explains itself (what was on screen, how many programs and
  // buffers existed, how busy the light pool was). Read it with
  // copy(window.__hitches) after a few minutes of play.
  _profileFrame() {
    if (!this._frameGaps) return;
    const now = performance.now();
    const gap = now - this._lastFrameT;
    this._lastFrameT = now;
    this._frameGaps.push(gap);
    if (this._frameGaps.length > 240) this._frameGaps.shift();
    if (gap > 160 && now - (this._lastHitchLog || 0) > 900) {
      this._lastHitchLog = now;
      const info = this.renderer.info;
      const rec = {
        t: +((now - this._bootT) / 1000).toFixed(1), ms: Math.round(gap),
        state: this.state, wave: this.enemyMgr.waveInfo().current,
        hostiles: this.enemyMgr.enemies.length, drops: this.pickups.drops.length,
        drawCalls: info.render.calls, programs: info.programs.length,
        geometries: info.memory.geometries, textures: info.memory.textures,
        lights: this.lightRig ? this.lightRig.stats() : null,
        pixelRatio: this.renderer.getPixelRatio(), quality: this.qualityName,
      };
      window.__hitches.push(rec);
      if (window.__hitches.length > 120) window.__hitches.shift();
      console.warn(`[hitch] ${rec.ms}ms @${rec.t}s`, rec);
    }
  }

  _update(dt) {
    this.elapsed += dt;
    const locked = this.player.controls.isLocked;
    const ctx = this.player.update(dt, this.keys, locked, this.time);
    this.lastMoveCtx = ctx;
    this.hud.setHP(this.player.hp);

    // containment guard: every themed arena is a sealed room, and this
    // backstop keeps the player inside their own map at any geometry
    // seam (kills the "walked through a wall and landed somewhere else"
    // leak, and with it the feeling of random teleporting)
    const ar = this._arenaRect;
    if (ar) {
      const R = PLAYER.radius;
      const f = this.player.feet;
      f.x = clamp(f.x, ar.x0 + R, ar.x1 - R);
      f.z = clamp(f.z, ar.z0 + R, ar.z1 - R);
    }

    // ---- per-world mission mechanics (MISSIONS[].mods — moremaps.md) ----
    const md = this._mods ?? {};
    if (md.fallKill && this.player.feet.y < -8) {
      // skyport: the deck has open edges — falling costs HP, you get lifted back
      this.player.setSpawn(this._mission().spawn);
      this.player.hp = Math.max(25, this.player.hp - 35);
      this.player.shake(0.04);
      this.hud.flashDamage();
      this.hud.setHP(this.player.hp);
      this.hud.respawnAlert('fall');
      this.audio.play('land', { volume: 0.9 });
    }
    for (const v of this.newAreas.vents) {   // steam vent updrafts (skyport)
      const dx = this.player.feet.x - v.x, dz = this.player.feet.z - v.z;
      if (dx * dx + dz * dz < v.r * v.r && this.player.feet.y < 1.4) {
        this.player.vy = Math.max(this.player.vy, v.power);
      }
    }
    if (md.emp) {                            // quantum core EMP blinds the HUD
      if (this._empActive > 0) {
        this._empActive -= dt;
        if (this._empActive <= 0) this.hud.empGlitch(false);
      } else {
        this._empT -= dt;
        if (this._empT <= 0) {
          this._empActive = 1.4;
          this._empT = 17 + Math.random() * 8;
          this.hud.empGlitch(true);
          this.audio.play('emp', { volume: 0.9 });
        }
      }
    }

    // weapon update + fire logic
    this.weapon.update(dt, ctx);
    const def = this.weapon.w.def;
    const wantFire = this.mouseDown && locked;
    if (wantFire) {
      if (this.weapon.w.mag === 0 && this.weapon.reloadT < 0) {
        this.weapon.startReload();
        this.hud.reloading(true);
      } else if (this.weapon.canFire() && (def.auto || !this._semiLatch)) {
        this._semiLatch = true;
        this._fireOnce();
      }
    } else {
      this._semiLatch = false;
    }
    if (this.weapon.w.mag > 0 && this.weapon.reloadT < 0) this.hud.reloading(false);
    else this.hud.reloading(this.weapon.reloadT >= 0);

    // enemies (update also drives reinforcement waves — onWave fires when a
    // new batch drops in somewhere on the map)
    this._enemyCtx = this._enemyCtx ?? {
      playerPos: this.player.position,
      playerCrouch: false,
      world: this.world,
      envMeshes: this.envMeshes,
      raycaster: this._raycaster,
      particles: this.particles,
      audio: this.audio,
      scratchAim: this._enemyAim,
      addTracer: (a, b) => this.particles.addTracer(a, b),
      addMuzzleLight: (p) => this._addMuzzleLight(p),
      playerShake: (a) => this.player.shake(a),
      onPlayerDamage: (n) => this._damagePlayer(n),
      onWave: (info) => {
        this.hud.waveAlert(info);
        this.hud.setWave(info);
        this.hud.setTargets(this.enemyMgr.remaining());
        this._shotDirty = true;
      },
      onRecall: () => {
        this.hud.pickupToast('⚠ LAST CONTACT REDIRECTED · 久未接敌的敌人已被重新部署到你附近');
        this.audio.play('enemyGrunt', { volume: 0.8 });
      },
    };
    this._enemyCtx.playerCrouch = ctx.crouching;
    this._enemyCtx.envMeshes = this.envMeshes;
    this._enemyCtx.gapScale = md.gapScale ?? 1;
    this._enemyCtx.bubbles = !!md.underwater;
    this._enemyCtx.arena = this._arenaRect;
    this.enemyMgr.update(dt, this._enemyCtx);
    this._targetPips();
    this._updateMuzzleFX(dt);

    // shared context handed to the themed-world updaters (design-doc
    // mechanics that need the player: currents, quicksand, shark…)
    this._worldCtx = this._worldCtx ?? {
      feet: this.player.feet,
      damage: (n) => this._damagePlayer(n),
      respawnPlayer: () => this.player.setSpawn(this._pickRespawnPoint()),
      shake: (a) => this.player.shake(a),
      flash: () => this.hud.flashDamage(),
      particles: this.particles,
      audio: this.audio,
    };

    // battlefield salvage — walk over a drop to grab it
    for (const kind of this.pickups.update(dt, this.player.feet)) this._collect(kind);

    // train + platform + store + ambience
    this.train.update(dt);
    this.platform.update(dt);
    this.store.update(dt, this.player.position);
    this.station.update(dt, this.time);
    this.sakura.update(dt);
    this.newAreas.update(dt, this._worldCtx);   // holo ads, caustics, gears, torches, fish, alarms…
    this.newAreas2.update(dt, this._worldCtx);  // aurora, blizzard, icicles, cargo train, leaves, bugs
    this.newAreas3.update(dt, this._worldCtx);  // sandstorm cycle, water orbs, megalodon, big gears

    // sandstorm (canyon): periodically crush the visibility
    if (md.sandstorm && this.scene.fog && this._fogBase) {
      const st = this.newAreas3.sandstorm;
      this.scene.fog.near = this._fogBase.near + (5 - this._fogBase.near) * st;
      this.scene.fog.far = this._fogBase.far + (40 - this._fogBase.far) * st;
    }

    // zero-G aquarium: jetpack thrust while Space is held in mid-air
    if (md.zeroG && locked && this.keys.Space && !this.player.grounded && this.player.vy < 5.5) {
      this.player.vy += 15 * dt;
    }

    // zone slow fields: aquarium water orbs (swim drag) + tomb quicksand
    let zoneSlow = 1;
    if (md.zeroG) {
      const f = this.player.feet;
      for (const o of this.newAreas3.orbs) {
        const dx = f.x - o.x, dy = (f.y + 0.9) - o.y, dz = f.z - o.z;
        if (dx * dx + dy * dy + dz * dz < o.r * o.r) { zoneSlow = 0.5; break; }
      }
    }
    if (md.traps) {
      const f = this.player.feet;
      for (const q of this.newAreas.quicksand) {
        const dx = f.x - q.x, dz = f.z - q.z;
        if (dx * dx + dz * dz < q.r * q.r) { zoneSlow = Math.min(zoneSlow, 0.45); }
      }
    }
    if (this._zoneSlow !== zoneSlow) {
      this._zoneSlow = zoneSlow;
      this.player.sScale = (md.speedScale ?? 1) * zoneSlow;
    }

    // water-channel jets (atlantis): ride a current for fast traversal
    if (md.currents) {
      for (const c of this.newAreas.currents) {
        const f = this.player.feet;
        const dx = f.x - c.x, dz = f.z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) {
          f.x += c.dx * c.power * dt;
          f.z += c.dz * c.power * dt;
          if (Math.random() < 8 * dt) this.particles.bubblePuff(f.x, f.y + 0.6, f.z, 4);
        }
      }
    }

    // clockwork: standing on a turning gear drags you around with it
    if (md.gears) {
      const f = this.player.feet;
      for (const gs of this.newAreas3.gearSpin) {
        if (!this.player.grounded || Math.abs(f.y - gs.top) > 0.55) continue;
        const dx = f.x - gs.x, dz = f.z - gs.z;
        if (dx * dx + dz * dz > gs.r * gs.r) continue;
        const a = gs.omega * dt;
        const cos = Math.cos(a), sin = Math.sin(a);
        f.x = gs.x + dx * cos - dz * sin;
        f.z = gs.z + dx * sin + dz * cos;
      }
    }

    // lethal gear-mesh gaps: bite once, then a short grace period
    if (md.hazards && this._hazCd <= 0) {
      const f = this.player.feet;
      for (const h of this.newAreas3.hazards) {
        const dx = f.x - h.x, dz = f.z - h.z;
        if (dx * dx + dz * dz < h.r * h.r && Math.abs(f.y - h.y) < 1.4) {
          this._hazCd = 2.5;
          const d = Math.hypot(dx, dz) || 1;
          f.x += (dx / d) * 1.6; f.z += (dz / d) * 1.6;
          this.player.shake(0.08);
          this.hud.flashDamage();
          this.particles.sparkBurst(f.x, h.y + 0.5, f.z, 0, 1, 0, 16);
          this.audio.play('impactMetal', { volume: 1.0, rate: 0.6 });
          this._damagePlayer(h.dmg ?? 85);
          break;
        }
      }
    }
    if (this._hazCd > 0) this._hazCd -= dt;

    // springy canopy leaves launch you up to the walkways
    for (const v of this.newAreas2.bouncePads) {
      const f = this.player.feet;
      const dx = f.x - v.x, dz = f.z - v.z;
      if (dx * dx + dz * dz < v.r * v.r && this.player.grounded && Math.abs(f.y - v.top) < 0.6) {
        this.player.vy = v.power;
        this.player.grounded = false;
        this.particles.dustPuff(f.x, v.top, f.z, 5);
        this.audio.play('footstep', { volume: 0.7, rate: 0.7 });
      }
    }

    // orbital cargo train — it shoves you along the deck if you stand in it
    const cargo = this.newAreas2.cargo;
    if (cargo && this._cargoCd <= 0) {
      const f = this.player.feet;
      if (f.x > cargo.x0 && f.x < cargo.x1 && f.z > cargo.z0 && f.z < cargo.z1 && f.y < cargo.top) {
        this._cargoCd = 2.2;
        f.x = cargo.x1 + 1.2;
        this.player.vy = 3.2;
        this.player.shake(0.05);
        this.hud.flashDamage();
        this._damagePlayer(14);
        this.particles.smokePuff(f.x, 1, f.z, 6, 0.8);
      }
    }
    if (this._cargoCd > 0) this._cargoCd -= dt;

    // weapon switch reload HUD
    this._syncHudAmmo();
    this.hud.setWeaponName(this.weapon.w.def.label);
  }

  _debug(dtReal) {
    if (!this.debugOn) return;
    this.fpsEMA = this.fpsEMA * 0.92 + (dtReal > 0 ? 1 / dtReal : 60) * 0.08;
    this._statT -= dtReal;
    if (this._statT <= 0) {
      this._statT = 0.5;
      document.getElementById('d-fps').textContent = Math.round(this.fpsEMA);
      document.getElementById('d-calls').textContent = this.renderer.info.render.calls;
      document.getElementById('d-tris').textContent = this.renderer.info.render.triangles.toLocaleString();
      document.getElementById('d-parts').textContent = this.particles.active;
    }
  }
}
