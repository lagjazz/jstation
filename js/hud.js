// ============================================================
// hud.js — DOM HUD controller (modern minimal FPS UI).
// Crosshair, hit marker, ammo, HP, target counter, kill feed,
// mission banner, damage flash, reload indicator, victory screen.
// ============================================================

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      reload: $('reload-ind'),
      mag: $('ammo-mag'),
      reserve: $('ammo-reserve'),
      ammoLine: $('ammo-line'),
      weaponName: $('ammo-weapon'),
      hpNum: $('hp-num'),
      hpBar: $('hp-bar'),
      hpFill: $('hp-fill'),
      targets: $('targets-count'),
      killfeed: $('killfeed'),
      banner: $('mission-banner'),
      damage: $('damage-flash'),
      victory: $('victory'),
      vTitle: $('v-title'),
      vSub: $('v-sub'),
      vHint: $('v-hint'),
      vKills: $('v-kills'),
      vAcc: $('v-accuracy'),
      vTime: $('v-time'),
      missionInd: $('mission-ind'),
      mb1: document.querySelector('#mission-banner .mb-1'),
      mb2: document.querySelector('#mission-banner .mb-2'),
      mb3: document.querySelector('#mission-banner .mb-3'),
      wave: $('wave-ind'),
      waveAlert: $('wave-alert'),
      targetPips: $('target-pips'),
      hsLayer: $('hs-layer'),
      water: $('water-tint'),
      emp: $('emp-flash'),
    };
    this._hitTO = null;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  // Per-frame setters write the DOM only when the shown value changes:
  // a textContent/style write — even of an identical value — invalidates
  // style + layout, and the game calls these every frame.
  _txt(el, v) {
    const k = '_v';
    if (el[k] === v) return;
    el[k] = v;
    el.textContent = v;
  }

  setAmmo(mag, reserve) {
    this._txt(this.el.mag, String(mag));
    this._txt(this.el.reserve, String(reserve));
    if (this._lowAmmo !== (mag === 0)) {
      this._lowAmmo = mag === 0;
      this.el.ammoLine.classList.toggle('low', this._lowAmmo);
    }
  }

  setWeaponName(name) { this._txt(this.el.weaponName, name); }

  setHP(hp, maxHp = 100) {
    const shown = Math.max(0, Math.ceil(hp));
    const key = shown * 1000 + Math.round(maxHp);
    if (this._hpKey === key) return;
    this._hpKey = key;
    const frac = shown / maxHp;
    this.el.hpNum.textContent = shown;
    this.el.hpFill.style.width = `${Math.min(100, frac * 100)}%`;
    this.el.hpBar.classList.toggle('low', frac < 0.35);
    this.el.damage.classList.toggle('lowhp', frac < 0.3);
  }

  setTargets(n) { this._txt(this.el.targets, String(n)); }

  /** "WAVE 2/3" tick under the target counter (mission wave plan). */
  setWave(info) {
    if (!this.el.wave) return;
    this.el.wave.textContent = `WAVE ${info.current}/${info.total}`;
    this.el.wave.classList.toggle('done', info.total === 1);
  }

  /** Reinforcement dropped in — brief center-screen warning. */
  waveAlert(info) {
    const el = this.el.waveAlert;
    if (!el) return;
    el.textContent = `⚠ REINFORCEMENTS · 増援確認 — WAVE ${info.current}/${info.total}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** Last-target direction pips: when only a couple hostiles remain and the
   *  player can't see them, ring the crosshair with small bearing markers so
   *  "I can't find the last one" never stalls the mission. relAngles = screen
   *  bearings in radians (0 = straight ahead). Call with [] to clear. */
  targetPips(relAngles) {
    const box = this.el.targetPips;
    if (!box) return;
    const want = relAngles.length;
    while (box.childElementCount < want) {
      const d = document.createElement('div');
      d.className = 'tgt-pip';
      box.appendChild(d);
    }
    while (box.childElementCount > want) box.removeChild(box.lastChild);
    const R = 46;
    for (let i = 0; i < want; i++) {
      const a = relAngles[i];
      // relAngle sign: game.js computes atan2(-dx,-dz) - yaw with camera forward
      // = (-sin yaw, -cos yaw), so a POSITIVE angle means the subject sits to the
      // player's LEFT (-X in camera space). Screen x grows to the right, hence the
      // minus: without it the ring mirrors and a shooter on your right paints a dot
      // on the left.
      const x = -Math.sin(a) * R, y = -Math.cos(a) * R;
      const el = box.children[i];
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${y.toFixed(1)}px`;
    }
    box.classList.toggle('on', want > 0);
  }

  /** Salvage grabbed — brief center-screen confirmation. */
  pickupToast(text) {
    const el = this.el.waveAlert;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** Player was overrun / fell — explains the sudden teleport to the entry. */
  respawnAlert(kind = 'entry') {
    const el = this.el.waveAlert;
    if (!el) return;
    el.textContent = kind === 'fall'
      ? '↧ FELL OFF THE DECK — BACK TO ENTRY · 再配置'
      : '↑ OVERRUN — FELL BACK TO SECTOR ENTRY · 再集結';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** HP hit zero — a short card that says what happened before the
   *  respawn at the mission entry, so the teleport is never a mystery. */
  showDowned() {
    const el = document.getElementById('downed-card');
    if (!el) return;
    clearTimeout(this._downTO);
    el.classList.remove('hidden', 'show');
    void el.offsetWidth;
    el.classList.add('show');
    this._downTO = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  /**
   * Create a small floating tag; the game loop projects it over the
   * enemy head and fades it (see game.js _updateHSPops).
   */
  headshotPop() {
    const el = document.createElement('div');
    el.className = 'hs-pop';
    el.innerHTML = 'HEADSHOT <span class="hs-x">+2×</span>';
    this.el.hsLayer.appendChild(el);
    return el;
  }

  setFiring(on) { this.el.crosshair.classList.toggle('firing', on); }

  hitMarker(headshot) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('headshot', !!headshot);
    hm.classList.remove('show');
    void hm.offsetWidth;              // restart CSS animation
    hm.classList.add('show');
  }

  reloading(on) {
    if (this._reloadOn === on) return;
    this._reloadOn = on;
    this.el.reload.classList.toggle('show', on);
  }

  killFeed(headshot) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    row.innerHTML = headshot
      ? 'HEADSHOT <span class="kf-head">✕ ELIMINATED</span>'
      : 'ENEMY <span class="kf-head">✕ ELIMINATED</span>';
    this.el.killfeed.prepend(row);
    while (this.el.killfeed.children.length > 4) this.el.killfeed.lastChild.remove();
    setTimeout(() => {
      row.style.transition = 'opacity .4s';
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 420);
    }, 2200);
  }

  flashDamage() {
    const d = this.el.damage;
    d.classList.add('hit');
    setTimeout(() => d.classList.remove('hit'), 90);
  }

  /** Underwater missions: a permanent blue tint + caustic-ish vignette. */
  waterToggle(on) { if (this.el.water) this.el.water.classList.toggle('on', on); }

  /** EMP pulse: HUD glitches (scanlines/jitter) while the overlay is on. */
  empGlitch(on) {
    if (this.el.emp) this.el.emp.classList.toggle('on', on);
    if (this.el.hud) this.el.hud.classList.toggle('emp-glitch', on);
  }

  /** Fill the in-world banner with mission text (call before missionBanner). */
  setMission(m, idx = 0, total = 0) {
    if (this.el.missionInd && idx)
      this.el.missionInd.textContent = `MISSION ${String(idx).padStart(2, '0')} / ${total}`;
    this.el.mb1.textContent = m.name1;
    this.el.mb2.textContent = m.name2;
    this.el.mb3.textContent = `${m.desc} — ${m.jp}`;
  }

  missionBanner() {
    const b = this.el.banner;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  /** Non-final mission end: same overlay, "continue" framing. The window
   *  dismisses itself (game.js arms the actual advance); `autoSec` drives
   *  the countdown shown in the hint. Clicking only skips the countdown. */
  showIntermission(done, next, kills, accuracy, timeStr, autoSec = 0) {
    this.showVictory(kills, accuracy, timeStr);
    this.el.victory.classList.add('live');   // non-blocking: world keeps moving
    this.el.vTitle.textContent = `${done.name1} COMPLETE`;
    this.el.vSub.textContent = `${done.name2} — SECURED · NEXT: ${next.name1} · ${next.name2}`;
    clearInterval(this._countTO);
    this._countTO = 0;
    if (autoSec > 0) {
      let n = autoSec;
      const tick = () => {
        this.el.vHint.textContent = n > 0
          ? `AUTO-CONTINUE IN ${n} · 可自由活动`
          : 'CONTINUING…';
      };
      tick();
      this._countTO = setInterval(() => {
        n -= 1;
        if (n < 0) { clearInterval(this._countTO); this._countTO = 0; return; }
        tick();
      }, 1000);
    } else {
      this.el.vHint.textContent = 'CLICK TO CONTINUE';
    }
  }

  showVictory(kills, accuracy, timeStr, isFinal = false) {
    this.el.victory.classList.remove('live');
    this.el.vTitle.textContent = isFinal ? 'CAMPAIGN COMPLETE' : 'MISSION COMPLETE';
    this.el.vSub.textContent = isFinal
      ? 'ALL FIFTEEN SECTORS SECURED — 全作戦完了・桜見台駅制圧'
      : 'SECTOR SECURED — 区域制圧完了';
    this.el.vHint.textContent = 'CLICK TO RESTART';
    this.el.vKills.textContent = kills;
    this.el.vAcc.textContent = `${accuracy}%`;
    this.el.vTime.textContent = timeStr;
    this.el.victory.classList.remove('hidden');
  }

  hideVictory() {
    clearInterval(this._countTO);
    this._countTO = 0;
    this.el.victory.classList.add('hidden');
  }
}
