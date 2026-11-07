// ============================================================
// gameSystems.js — the gameplay layer on top of the core Game loop,
// mixed into Game.prototype (keeps game.js about rendering + flow):
//
//   • objectives (win/lose conditions) + mission complete / failed
//   • XP, levels and perk picks between missions (progression.js)
//   • armor, frag grenades, timed buffs, weapon crates, salvage
//   • launcher rounds + explosions + explosive barrels (explosives.js)
//   • randomized cover props per run (props.js)
//   • atmosphere variants + weather events (variants.js)
//   • adaptive music intensity, HUD waypoints / boss bar / threats
//   • per-area raycast target lists (bullets and enemy sight lines only
//     test the CURRENT arena's meshes, not all 16 worlds)
// ============================================================

import * as THREE from 'three';
import { ADS, ARMOR, DROPS, ENEMY, GRENADE, MISSIONS, PLAYER, PROGRESSION, WEAPON_ORDER } from './config.js';
import { SPAWN_POOLS } from './enemy.js';
import { Explosives } from './explosives.js';
import { PropManager } from './props.js';
import { Progression } from './progression.js';
import { Objectives } from './objectives.js';
import { Weather, rollVariant, VARIANT_INFO } from './variants.js';
import { moveAndSlide } from './collision.js';
import { clamp, damp, formatTime, rand } from './utils.js';

const STATION = new Set(['hall', 'platform', 'garden']);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export const GameSystems = {
  _initSystems() {
    this.progress = new Progression();
    this.explosives = new Explosives(this.scene, this.world, this.particles, this.audio);
    this.props = new PropManager(this.scene, this.world, this.particles, this.audio);
    this.objectives = new Objectives(this.scene, this.world, this.particles, this.audio);
    this.weather = new Weather(this.scene);
    this.armor = 0;
    this.grenades = GRENADE.start;
    this._grenCd = 0;
    this.buffs = { overdrive: 0, haste: 0 };
    this._intensity = 0;
    this._lastDamageT = -99;
    this._hbT = 0;
    this._buildRayIndex();
  },

  // ---------------------------------------------------------------- rays
  /** Tag every raycast mesh with the arena it belongs to (world group
   *  name, or null for station / shared geometry). */
  _buildRayIndex() {
    const tagOf = (o) => {
      for (let p = o; p; p = p.parent) if (p.name && p.name.startsWith('world:')) return p.name.slice(6);
      return null;
    };
    for (const m of this.envMeshes) {
      if (m.userData._area !== undefined) continue;
      m.userData._area = tagOf(m);
    }
  },

  /** Bullets + enemy LoS only test the active arena (or the station). */
  _refreshEnvActive() {
    const area = this._mission().area;
    const station = STATION.has(area);
    const rect = this._arenaRect;
    this._envActive = this.envMeshes.filter((m) => {
      const a = m.userData._area;
      if (a === area) return true;
      if (a) return false;
      if (station) return true;
      if (!rect) return true;
      // shared geometry that physically sits inside this arena
      m.getWorldPosition(_v);
      return _v.x > rect.x0 - 12 && _v.x < rect.x1 + 12 && _v.z > rect.z0 - 12 && _v.z < rect.z1 + 12;
    });
    this._shotDirty = true;
  },

  _rayTargets() {
    if (this._shotDirty || !this._shotTargets) {
      this._shotTargets = this._envActive.concat(this.props.raycastMeshes, this.objectives.raycastMeshes, this.enemyMgr.hitMeshes);
      this._losTargets = this._envActive.concat(this.props.raycastMeshes, this.objectives.raycastMeshes);
      this._shotDirty = false;
      this.props.dirty = false;
    }
    return this._shotTargets;
  },

  // ---------------------------------------------------------------- arming
  /** Called from _setupMission: objective, enemies, props, variant. */
  _armSystems(m) {
    const types = m.objectives ?? ['eliminate'];
    const type = types[Math.floor(Math.random() * types.length)];
    const anchors = SPAWN_POOLS[m.area] ?? SPAWN_POOLS.hall;
    this.explosives.clear();
    this.props.clear();
    const deployOpts = this.objectives.setup(type, { anchors, spawn: m.spawn, missionIdx: this.missionIdx });
    // difficulty ramps with the campaign: occasional elites + a little more hp
    deployOpts.eliteChance = m.elite ? 0 : Math.min(0.3, this.missionIdx * 0.022);
    deployOpts.hpScale = 1 + this.missionIdx * 0.025;
    if (type === 'assassinate') deployOpts.boss = m.boss ?? 'commander';
    else if (type !== 'eliminate') deployOpts.boss = null;
    this.enemyMgr.deploy(m, deployOpts);
    if (deployOpts.objTarget) this.enemyMgr.setObjectiveTarget(deployOpts.objTarget);
    // dress the arena (keep clear of spawn + objective sites)
    const avoid = [{ x: m.spawn.x, z: m.spawn.z, r: 6 }];
    if (this.objectives.terminal.visible) avoid.push({ x: this.objectives.terminal.position.x, z: this.objectives.terminal.position.z, r: 4 });
    if (this.objectives.zone.visible) avoid.push({ x: this.objectives.zone.position.x, z: this.objectives.zone.position.z, r: 6 });
    for (const d of this.objectives.drives) if (d.g.visible) avoid.push({ x: d.g.position.x, z: d.g.position.z, r: 2.5 });
    this.props.setup(m.area, this._arenaRect, anchors, avoid);
    // atmosphere variant
    this._variant = rollVariant(m.area);
    this.weather.set(this._variant);
    this.audio.stopLoop('rainLoop');
    if (this._variant === 'storm' && this.audio.ready) this.audio.playLoop('rainLoop', 0.35);
    this._applyVariant();
    const vi = VARIANT_INFO[this._variant];
    const oi = this.objectives.hud(this.enemyMgr);
    this.hud.setBannerExtra(`OBJECTIVE: ${oi.title}${this._variant !== 'clear' ? `  ·  CONDITIONS: ${vi.en} ${vi.jp}` : ''}`);
    // loadout carry-over: full HP, grenades topped up to the starting count
    const S = this.progress.stats;
    this.player.hp = S.maxHp;
    this.grenades = Math.max(this.grenades, Math.min(GRENADE.start, S.grenadeMax));
    this.buffs.overdrive = this.buffs.haste = 0;
    this._missionDone = false;
    this.audio.setEnvironment(m.area);
    this._refreshEnvActive();
  },

  /** Layer the rolled variant over the mission's base atmosphere. */
  _applyVariant() {
    const v = this._variant;
    const fog = this.scene.fog;
    this._exposureBase = 1.05;
    this._moonBase = this.moon ? this.moon.intensity : 1;
    const tint = this.gradePass?.uniforms.uTint.value;
    tint?.set(1, 1, 1);
    if (!fog) return;
    switch (v) {
      case 'fog':
        fog.near *= 0.35; fog.far = Math.max(42, fog.far * 0.45);
        fog.color.lerp(_v.set(0.32, 0.34, 0.38) && new THREE.Color(0x40444c), 0.6);
        break;
      case 'storm':
        fog.near *= 0.6; fog.far *= 0.7;
        fog.color.lerp(new THREE.Color(0x1a1e28), 0.6);
        this._moonBase *= 0.65; this._exposureBase = 0.95;
        tint?.set(0.94, 0.98, 1.06);
        break;
      case 'blackout':
        this._moonBase *= 0.3; this._exposureBase = 0.78;
        fog.color.multiplyScalar(0.5);
        tint?.set(0.92, 0.96, 1.08);
        break;
      case 'alert':
        fog.color.lerp(new THREE.Color(0x3a0a0c), 0.55);
        tint?.set(1.08, 0.94, 0.92);
        break;
      case 'dusk':
        fog.color.lerp(new THREE.Color(0x5a3418), 0.6);
        this._moonBase *= 1.25;
        tint?.set(1.1, 1.0, 0.86);
        break;
      case 'blizzard':
        fog.near *= 0.4; fog.far = Math.max(40, fog.far * 0.4);
        fog.color.lerp(new THREE.Color(0x8a96a8), 0.7);
        break;
    }
    if (this.moon) this.moon.intensity = this._moonBase;
    this.renderer.toneMappingExposure = this._exposureBase;
    this._fogBase = { near: fog.near, far: fog.far };
  },

  // ---------------------------------------------------------------- per frame
  _updateSystems(dt, mctx, locked) {
    const S = this.progress.stats;
    const p = this.player;
    // ---- buffs ----
    for (const k of ['overdrive', 'haste']) {
      if (this.buffs[k] > 0) {
        this.buffs[k] -= dt;
        if (this.buffs[k] <= 0) { this.buffs[k] = 0; this.audio.play('switch', { volume: 0.5, rate: 0.7 }); }
      }
    }
    this.weapon.buffHaste = this.buffs.haste > 0;
    this.hud.setBuffs(this.buffs.overdrive, this.buffs.haste);

    // ---- ADS: input, zoom, sensitivity, movement ----
    this.weapon.wantAds = !!this.rightDown && locked;
    const ads = this.weapon.ads;
    p.fovZoom = this.weapon.zoom();
    p.controls.pointerSpeed = 1 / (1 + (p.fovZoom - 1) * 0.85);
    this.hud.adsCross(ads);
    this.hud.scope(!!this.weapon.w.def.scope && ads > 0.92);
    const md = this._mods ?? {};
    p.sScale = (md.speedScale ?? 1) * (this._zoneSlow ?? 1) * S.speedMul *
      (this.buffs.haste > 0 ? 1.3 : 1) * (1 - ads * (1 - ADS.speedMul));

    // ---- grenades ----
    if (this._grenCd > 0) this._grenCd -= dt;
    this.hud.setGrenades(this.grenades, S.grenadeMax);

    // ---- explosives / barrels ----
    this.explosives.update(dt, this._explodeCtx());
    for (const pos of this.props.update(dt)) {
      this.explosives.explode(pos, { dmg: 160, radius: 6, owner: 'barrel' }, this._explodeCtx());
    }
    if (this.props.dirty) this._shotDirty = true;

    // ---- weather events ----
    const ev = this.weather.update(dt, this.camera.position);
    if (ev === 'lightning') {
      setTimeout(() => this.audio.play('thunder', { volume: 0.9, rate: rand(0.85, 1.1) }), rand(300, 1400));
    } else if (ev === 'flicker') {
      this.audio.play('switch', { volume: 0.5, rate: 0.5 });
    } else if (ev === 'alarm') {
      this.audio.play('alarm', { volume: 0.35 });
    }
    if (this.moon && this._moonBase != null) {
      const w = this.weather;
      const flick = w.dark > 0 ? (Math.sin(this.time * 60) > 0.2 ? 0.05 : 0.6) * w.dark + (1 - w.dark) : 1;
      this.moon.intensity = this._moonBase * flick + w.flash * 3.5;
      this.renderer.toneMappingExposure = (this._exposureBase ?? 1.05) * (1 - w.dark * 0.35) + w.flash * 0.25;
    }

    // ---- objective ----
    const res = this.objectives.update(dt, {
      playerPos: p.feet, enemyMgr: this.enemyMgr,
      onIntel: (n) => this.hud.pickupToast(`◆ INTEL ${n}/3 RECOVERED · 情報回収${n === 3 ? ' — GET TO EXTRACTION' : ''}`),
    });
    const oi = this.objectives.hud(this.enemyMgr);
    this.hud.setObjective(oi);
    this._projectMarkers(oi.markers);
    if (res === 'complete' && !this._missionDone) this._missionComplete();
    else if (res === 'failed' && !this._missionDone) this._missionFailed('THE TERMINAL WAS COMPROMISED · 端末喪失');

    // ---- threats + boss + music ----
    _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.hud.grenadeWarn(this.explosives.threats(p.feet, _e.y));
    let fighting = 0;
    for (const e of this.enemyMgr.enemies) if (e.alive && (e.state === 'ATTACK' || e.state === 'COVER')) fighting++;
    const recent = this.time - this._lastDamageT < 4 ? 0.35 : 0;
    const target = clamp(fighting * 0.28 + recent, 0, 1);
    this._intensity = damp(this._intensity, target, target > this._intensity ? 2.5 : 0.35, dt);
    this.audio.music?.setIntensity(this._intensity);

    // ---- low-HP heartbeat + grade uniforms ----
    const hpF = p.hp / S.maxHp;
    const hurt = clamp((0.4 - hpF) / 0.4, 0, 1);
    if (hurt > 0) {
      this._hbT -= dt;
      if (this._hbT <= 0) { this._hbT = 0.95 - hurt * 0.35; this.audio.play('heartbeat', { volume: 0.25 + hurt * 0.5 }); }
    }
    const g = this.gradePass?.uniforms;
    if (g) {
      g.uTime.value = this.time;
      g.uHurt.value = damp(g.uHurt.value, hurt, 4, dt);
      g.uPulse.value = Math.max(0, Math.sin(this.time * (5 + hurt * 4)));
      g.uBuff.value.set(this.buffs.overdrive > 0 ? 0.7 : 0, this.buffs.haste > 0 ? 0.7 : 0, this.weather.flash * 0.35);
      g.uScope.value = this.weapon.w.def.scope ? clamp((ads - 0.85) / 0.15, 0, 1) : 0;
    }

    // ---- HUD: armor / xp / slots ----
    this.hud.setHP(p.hp, S.maxHp);
    this.hud.setArmor(this.armor, S.maxArmor);
    this.hud.setXP(this.progress.level, this.progress.frac(), this.progress.pending);
    this.hud.setSlots(this.weapon.weapons, this.weapon.owned, this.weapon.pendingSwitch >= 0 ? this.weapon.pendingSwitch : this.weapon.current);
    void mctx;
  },

  _explodeCtx() {
    if (this._xctx) { this._xctx.enemies = this.enemyMgr.enemies; return this._xctx; }
    this._xctx = {
      enemies: this.enemyMgr.enemies,
      playerPos: this.player.feet,
      floorPlane: true,
      shake: (a) => this.player.shake(a),
      onExplode: (pos, g) => {
        this.audio.play('explosion', { volume: 1, variant: true, rate: rand(0.9, 1.05) });
        this._addMuzzleLight(pos);
        this._addMuzzleLight(pos);
        if (this._mods?.underwater) this.particles.bubblePuff(pos.x, pos.y, pos.z, 12);
        // explosions are loud: everyone nearby comes to look
        this.enemyMgr.hearAll(pos);
        void g;
      },
      damageEnemy: (e, dmg, dx, dz, g) => {
        const mul = g.owner === 'player' || g.owner === 'barrel' ? this.progress.stats.dmgMul * (this.buffs.overdrive > 0 ? 1.5 : 1) : 0.6;
        const ctx = this._hitCtx(e.group.position);
        ctx.hitPoint = _v2.set(e.group.position.x, e.chestY, e.group.position.z);
        e.applyDamage(dmg * mul, 'body', dx, dz, ctx);
        if (g.owner === 'player' || g.owner === 'barrel') this.hud.hitMarker(false);
      },
      damagePlayer: (n, g) => this._damagePlayer(n, { blast: true, pos: g?.mesh?.position ?? null }),
      barrels: (pos, r) => this.props.blast(pos, r),
      hitTest: (pos, owner) => {
        if (owner === 'player') {
          for (const e of this.enemyMgr.enemies) {
            if (!e.alive) continue;
            const ep = e.group.position;
            if (Math.hypot(ep.x - pos.x, ep.z - pos.z) < 0.6 && pos.y > ep.y && pos.y < ep.y + 2.1 * e.bodyScale + (e.flying ? e.hover : 0)) return true;
          }
          return false;
        }
        const pp = this.player.feet;
        return Math.hypot(pp.x - pos.x, pp.z - pos.z) < 0.55 && pos.y > pp.y && pos.y < pp.y + 1.9;
      },
    };
    return this._xctx;
  },

  /** Shared ctx for Enemy.applyDamage from player sources. */
  _hitCtx(hitPoint) {
    const c = this._hctx ?? (this._hctx = {
      particles: this.particles, audio: this.audio, raycaster: this._raycaster,
      onKilled: (e, hs) => this._onEnemyKilled(e, hs),
      onPlayerDamage: (n) => this._damagePlayer(n),
      world: this.world, playerPos: this.player.position,
    });
    c.hitPoint = hitPoint;
    c.headMult = this.progress.stats.headMul;
    c.envMeshes = this._losTargets ?? this.envMeshes;
    return c;
  },

  _syncExplodeEnemies() { if (this._xctx) this._xctx.enemies = this.enemyMgr.enemies; },

  /** Screen-space waypoints (edge-clamped when off screen / behind). */
  _projectMarkers(markers) {
    const W = window.innerWidth, H = window.innerHeight;
    const out = this._mk ?? (this._mk = []);
    out.length = 0;
    const cam = this.camera;
    for (const m of markers) {
      _v.copy(m.pos);
      _v.y += 1.6;
      const dist = cam.position.distanceTo(_v);
      _v.project(cam);
      let x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      let off = false;
      if (_v.z > 1) { x = W - x; y = H - 40; off = true; }
      if (x < 40 || x > W - 40 || y < 70 || y > H - 90) off = true;
      x = clamp(x, 40, W - 40);
      y = clamp(y, 70, H - 90);
      out.push({ x, y, off, label: m.label, color: m.color, dist });
    }
    this.hud.setMarkers(out);
  },

  // ---------------------------------------------------------------- combat
  /** G: throw a frag along the view direction (arcing). */
  _throwGrenade() {
    if (this.grenades <= 0 || this._grenCd > 0 || this.state !== 'playing') {
      if (this.grenades <= 0) this.audio.play('dryFire', { volume: 0.5 });
      return;
    }
    this.grenades--;
    this._grenCd = GRENADE.cooldown;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    dir.y += 0.28;
    dir.normalize();
    const from = this.camera.position.clone().addScaledVector(dir, 0.5);
    from.y -= 0.15;
    this.explosives.launch(from, dir, {
      speed: GRENADE.throwSpeed, fuse: GRENADE.fuse, dmg: GRENADE.dmg, radius: GRENADE.radius, owner: 'player',
    });
    this.audio.play('throwWhoosh', { volume: 0.7 });
    this.weapon.kickRot += 0.12;
  },

  /** Launcher: an impact round instead of hitscan. */
  _fireProjectile(def) {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const spread = this.weapon.currentSpread(this.lastMoveCtx);
    dir.x += rand(-spread, spread); dir.y += rand(-spread, spread) + 0.04;
    dir.normalize();
    const from = this.weapon.w.muzzle.getWorldPosition(new THREE.Vector3());
    this.explosives.launch(from, dir, {
      speed: def.projectile.speed, impact: true, armDelay: 0.06,
      dmg: def.damage, radius: def.projectile.radius, owner: 'player',
    });
    this.shotsFired++;
  },

  /** Shared enemy-hit routine (hitscan): damage scaling + feedback. */
  _hitEnemy(enemy, part, base, shot, point) {
    const S = this.progress.stats;
    const dmg = base * S.dmgMul * (this.buffs.overdrive > 0 ? 1.5 : 1);
    if (part === 'shield') {
      enemy.applyDamage(0, 'shield', -shot.x, -shot.z, this._hitCtx(point));
      return false;
    }
    this.shotsHit++;
    const head = part === 'head';
    enemy.applyDamage(dmg, part, -shot.x, -shot.z, this._hitCtx(point));
    this.hud.hitMarker(head);
    this.audio.play(head ? 'headshot' : 'hitMarker', { volume: 0.7 });
    if (head) {
      this.player.shake(0.008);
      this._slowmo({ scale: 0.16, duration: 0.07 });
      this._addHSPop(enemy);
    }
    return true;
  },

  _onEnemyKilled(enemy, headshot) {
    this.kills++;
    const S = this.progress.stats;
    this.pickups.spawnFrom(enemy, { dropBonus: S.dropBonus });
    this.hud.killFeed(headshot);
    this.hud.setTargets(this.enemyMgr.remaining());
    this.enemyMgr.removeHitMeshes(enemy);
    this._shotDirty = true;
    this.player.shake(0.01);
    this.audio.play('headshot', { volume: 0.4, rate: 0.8 });
    if (S.onKillHeal) this.player.hp = Math.min(S.maxHp, this.player.hp + S.onKillHeal);
    const xp = (PROGRESSION.xp[enemy.cls] ?? 20) * (headshot ? 1 + PROGRESSION.headshotBonus : 1) * (enemy.elite ? 1.4 : 1);
    this._gainXP(xp);
    if (this.objectives.type === 'eliminate' && this.enemyMgr.remaining() === 0) {
      this._slowmo({ scale: 0.12, duration: 0.16 });
    } else if (headshot) {
      this._slowmo({ scale: 0.14, duration: 0.09 });
    }
  },

  _gainXP(n) {
    const ups = this.progress.gain(Math.round(n));
    if (ups > 0) {
      this.hud.levelUp(this.progress.level);
      this.audio.play('levelUp', { volume: 0.7 });
    }
  },

  /** n = raw damage; src: Enemy | { blast, pos } */
  _damagePlayer(n, src = null) {
    if (this.state !== 'playing' || this._missionDone) return;
    const S = this.progress.stats;
    if (src?.blast) n *= S.blastResist;
    // armor plates soak most of the hit until they break
    if (this.armor > 0) {
      const soak = Math.min(this.armor, n * ARMOR.absorb);
      this.armor -= soak;
      n -= soak;
      if (this.armor <= 0) { this.armor = 0; this.audio.play('shieldHit', { volume: 0.6, rate: 0.6 }); }
    }
    this._lastDamageT = this.time;
    this.hud.flashDamage();
    // direction wedge toward the source
    const sp = src?.group?.position ?? src?.pos;
    if (sp) {
      _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
      const dx = sp.x - this.player.feet.x, dz = sp.z - this.player.feet.z;
      this.hud.damageFrom(Math.atan2(-dx, -dz) - _e.y);
    }
    const hp = this.player.damage(n);
    if (hp <= 0) {
      this.player.setSpawn(this._pickRespawnPoint());
      this.player.hp = Math.min(S.maxHp, PLAYER.overrunHp + S.overrunBonus);
      this.player.shake(0.03);
      this.hud.showDowned();
      this.hud.missionBanner();
    }
    this.hud.setHP(this.player.hp, S.maxHp);
  },

  /** Grabbed a salvage drop. */
  _collect(kind) {
    const S = this.progress.stats;
    switch (kind) {
      case 'medkit': {
        const heal = Math.round(DROPS.medkitHp * S.medkitMul);
        this.player.hp = Math.min(S.maxHp, this.player.hp + heal);
        this.audio.play('medkit', { volume: 0.8 });
        this.hud.pickupToast(`✚ +${heal} HP · 応急処置 MEDKIT`);
        break;
      }
      case 'ammo':
        this.weapon.addReserve(null, DROPS.ammoRounds);
        this._syncHudAmmo();
        this.audio.play('pickup', { volume: 0.8 });
        this.hud.pickupToast(`▮ +${DROPS.ammoRounds} ROUNDS · 弾薬補給 AMMO`);
        break;
      case 'armor':
        this.armor = Math.min(S.maxArmor, this.armor + DROPS.armorPts);
        this.audio.play('armorPickup', { volume: 0.8 });
        this.hud.pickupToast(`◈ +${DROPS.armorPts} ARMOR · 防弾板`);
        break;
      case 'grenade':
        if (this.grenades < S.grenadeMax) this.grenades++;
        this.audio.play('pickup', { volume: 0.8, rate: 0.8 });
        this.hud.pickupToast(`⬣ FRAG GRENADE · 手榴弾 [G] (${this.grenades}/${S.grenadeMax})`);
        break;
      case 'weapon': {
        const key = this.weapon.unlock();
        if (key) {
          const idx = WEAPON_ORDER.indexOf(key);
          this.hud.pickupToast(`▲ NEW WEAPON: ${this.weapon.weapons[idx].def.label} · [${idx + 1}]`);
        } else {
          this.weapon.addReserve(null, DROPS.ammoRounds * 2);
          this.hud.pickupToast('▲ WEAPON CRATE · FULL RESUPPLY 弾薬満載');
        }
        this.audio.play('weaponPickup', { volume: 0.9 });
        this._syncHudAmmo();
        break;
      }
      case 'overdrive':
        this.buffs.overdrive = DROPS.buffTime;
        this.audio.play('powerup', { volume: 0.8 });
        this.hud.pickupToast('◆ OVERDRIVE · +50% DAMAGE 火力増強');
        break;
      case 'haste':
        this.buffs.haste = DROPS.buffTime;
        this.audio.play('powerup', { volume: 0.8, rate: 1.25 });
        this.hud.pickupToast('◆ HASTE · SPEED + FAST RELOAD 加速');
        break;
    }
  },

  // ---------------------------------------------------------------- flow
  _missionComplete() {
    this._missionDone = true;
    if (this.objectives.type !== 'eliminate') this.enemyMgr.retreatAll(this.particles ? { particles: this.particles } : null);
    this._shotDirty = true;
    this._gainXP(PROGRESSION.objectiveXp + this.missionIdx * 10);
    this.audio.play('objective', { volume: 0.8 });
    this.audio.music?.sting('win');
    const isFinal = this.missionIdx >= MISSIONS.length - 1;
    setTimeout(() => { if (isFinal) this._victory(); else this._intermission(); }, 900);
  },

  _missionFailed(reason) {
    this._missionDone = true;
    this.audio.play('fail', { volume: 0.9 });
    this.audio.music?.sting('fail');
    this.hud.showFail(reason);
    setTimeout(() => {
      if (this.state !== 'playing' && this.state !== 'paused') return;
      this._setupMission();            // retry the same mission
    }, 3200);
  },

  /** Intermission perk picks: returns true while a choice is pending. */
  _offerPerks() {
    const P = this.progress;
    if (P.pending <= 0) { this.hud.hidePerks(); this._perkChoices = null; return false; }
    this._perkChoices = P.offer(3, this.weapon.hasLocked());
    if (!this._perkChoices.length) { P.pending = 0; this.hud.hidePerks(); return false; }
    this.hud.showPerks(this._perkChoices, P.pending);
    return true;
  },

  _choosePerk(i) {
    const c = this._perkChoices?.[i];
    if (!c) return;
    const p = this.progress.take(c.id);
    if (!p) return;
    const S = this.progress.stats;
    if (S.healNow) { this.player.hp = Math.min(S.maxHp, this.player.hp + S.healNow); S.healNow = 0; }
    if (S.armorNow) { this.armor = Math.min(S.maxArmor, this.armor + S.armorNow); S.armorNow = 0; }
    if (S.grenadeNow) { this.grenades = Math.min(S.grenadeMax, this.grenades + S.grenadeNow); S.grenadeNow = 0; }
    while (S.unlockWeapon > 0) {
      S.unlockWeapon--;
      const k = this.weapon.unlock();
      if (k) this.hud.pickupToast(`▲ ARMORY: ${this.weapon.weapons[WEAPON_ORDER.indexOf(k)].def.label} UNLOCKED`);
    }
    this.audio.play('powerup', { volume: 0.6 });
    this.hud.pickupToast(`★ PERK: ${p.name} · ${p.jp}`);
    this._offerPerks();
  },

  _autoPickPerks() {
    while (this.progress.pending > 0 && this._perkChoices?.length) {
      this._choosePerk(Math.floor(Math.random() * this._perkChoices.length));
    }
    this.hud.hidePerks();
  },

  /** Push the player out of a hostile (crowd separation). */
  _pushPlayer(dx, dz) {
    moveAndSlide(this.player.feet, dx, dz, PLAYER.radius, PLAYER.height, this.world, 0);
  },

  /** Every material with a colour map and no relief map gets that map as
   *  a bump map — free micro relief on tiles, brick, concrete, wood,
   *  metal panels (no new textures: the same texture is sampled). */
  _applyBumpDetail() {
    const seen = new Set();
    let n = 0;
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        if (!m.isMeshStandardMaterial || !m.map || m.normalMap || m.bumpMap) continue;
        if (m.transparent || m.emissiveMap || (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0.2)) continue;
        if (m.roughness < 0.25) continue;
        m.bumpMap = m.map;
        m.bumpScale = 1.6 + m.roughness * 1.4;
        m.needsUpdate = true;
        n++;
      }
    });
    console.log(`[detail] bump relief on ${n} materials`);
  },

  _statsLine() {
    const acc = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    return { acc, time: formatTime(this.elapsed) };
  },

  _enemyCtxExtras(c) {
    c.playerSpeed = Math.hypot(this.player.vel.x, this.player.vel.y);
    c.envMeshes = this._losTargets ?? this._envActive;
    if (c._extras) return;
    c._extras = true;
    c.throwGrenade = (from, to, opts) => this.explosives.throw(from, to, opts);
    c.nearMiss = (e) => {
      const ep = e.group.position;
      _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
      const rel = Math.atan2(-(ep.x - this.player.feet.x), -(ep.z - this.player.feet.z)) - _e.y;
      this.audio.play('whiz', { volume: 0.5, rate: rand(0.85, 1.2), pan: clamp(-Math.sin(rel), -0.9, 0.9) });
      this.player.shake(0.002);
    };
    c.pushPlayer = (dx, dz) => this._pushPlayer(dx, dz);
    c.onBoss = (b) => {
      this.hud.pickupToast('☠ COMMANDER ON SITE · 敵指揮官出現');
      this.audio.play('alarm', { volume: 0.4 });
      void b;
    };
    c.onBossHp = (f) => this.hud.setBoss('COMMANDER · 敵指揮官', f > 0 ? f : null);
    c.onHealed = () => {};
    c.onGrenadeThrown = () => {};
  },
};

/** Damage multiplier for a hit part (exported for tests / tools). */
export function partMultiplier(part, headMul = ENEMY.headshotMultiplier) {
  return part === 'head' ? headMul : (part === 'limb' ? ENEMY.limbMultiplier : 1);
}
