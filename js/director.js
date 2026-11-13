// ============================================================
// director.js — combat pacing (tuning lives in config.js DIRECTOR).
//
// The director owns the rules that make a firefight fair to read:
//
//   attack tokens   only N hostiles may open fire at once; a soldier asks
//                   for a slot before each burst and hands it back after.
//                   Everyone without a slot keeps moving (flank / cover).
//   head-count cap  reinforcements queue up and walk in one at a time;
//                   the live count never passes maxAlive().
//   grace           after a redeploy the player is shielded and unseen
//                   for a few seconds (see GameSystems._redeploy).
//   mercy           each death in a mission scales enemy damage down.
//
// Pure logic, no THREE objects — unit-testable in isolation.
// ============================================================

import { DIRECTOR } from './config.js';
import { clamp, rand } from './utils.js';

export class Director {
  constructor() {
    this.missionIdx = 0;
    this.reset(0);
  }

  /** New mission (or retry): fresh clocks, no mercy carried over. */
  reset(missionIdx = 0) {
    this.missionIdx = missionIdx;
    this.time = 0;
    this.deaths = 0;
    this.graceT = 0;          // invulnerable while > 0
    this.hiddenT = DIRECTOR.openingCalm;   // nobody can spot the player while > 0
    this._slots = [];         // [{ e, until }]
  }

  update(dt) {
    this.time += dt;
    if (this.graceT > 0) this.graceT = Math.max(0, this.graceT - dt);
    if (this.hiddenT > 0) this.hiddenT = Math.max(0, this.hiddenT - dt);
    if (this._slots.length) this._slots = this._slots.filter((s) => s.e.alive && s.until > this.time);
  }

  get shielded() { return this.graceT > 0; }
  get playerHidden() { return this.hiddenT > 0; }

  /** Concurrent shooters allowed this mission. */
  tokens() {
    return Math.floor(clamp(DIRECTOR.tokens + this.missionIdx * DIRECTOR.tokensPerMission, 1, DIRECTOR.tokensMax));
  }

  /** Live hostiles allowed on the field at once. */
  maxAlive() {
    return Math.floor(clamp(DIRECTOR.maxAlive + this.missionIdx * DIRECTOR.maxAlivePerMission, 2, DIRECTOR.maxAliveCap));
  }

  /**
   * A hostile wants to start a burst lasting ~`hold` seconds.
   * Bosses always shoot (and do not use up a slot).
   */
  requestFire(e, hold = 1) {
    if (this.playerHidden) return false;
    if (e.boss) return true;
    const mine = this._slots.find((s) => s.e === e);
    if (mine) { mine.until = this.time + hold; return true; }
    if (this._slots.length >= this.tokens()) return false;
    this._slots.push({ e, until: this.time + hold });
    return true;
  }

  release(e) {
    if (this._slots.length) this._slots = this._slots.filter((s) => s.e !== e);
  }

  shooters() { return this._slots.length; }

  /** Seconds a denied shooter waits before asking again. */
  retryDelay() { return rand(DIRECTOR.tokenCooldown[0], DIRECTOR.tokenCooldown[1]); }

  /** The player went down: start the grace window, remember it for mercy. */
  onPlayerDown() {
    this.deaths++;
    this.graceT = DIRECTOR.respawnGrace;
    this.hiddenT = DIRECTOR.respawnHidden;
    this._slots = [];
  }

  /** Multiplier on enemy damage (1 → mercyFloor as deaths pile up). */
  mercy() {
    return Math.max(DIRECTOR.mercyFloor, 1 - this.deaths * DIRECTOR.mercyPerDeath);
  }

  /**
   * Drop-chance overrides when the player is running dry.
   * reserveMags = current weapon reserve / magazine size; hpFrac = hp / max.
   */
  pity(reserveMags, hpFrac) {
    return {
      ammo: reserveMags < DIRECTOR.pityAmmoBelow ? DIRECTOR.pityAmmoChance : null,
      medkit: hpFrac < DIRECTOR.pityHpBelow ? DIRECTOR.pityMedChance : null,
    };
  }
}

/**
 * Best redeploy spot: the candidate farthest from every live hostile
 * (first one that clears `minDist` wins, so the list order is a priority).
 * cands: [{x,z}], hostiles: [{x,z}]. Returns a candidate or null.
 */
export function pickSafest(cands, hostiles, minDist = DIRECTOR.respawnMinDist) {
  let best = null, bestD = -1;
  for (const c of cands) {
    let d = Infinity;
    for (const h of hostiles) d = Math.min(d, Math.hypot(h.x - c.x, h.z - c.z));
    if (d >= minDist) return c;
    if (d > bestD) { bestD = d; best = c; }
  }
  return best;
}
