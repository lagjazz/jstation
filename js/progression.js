// ============================================================
// progression.js — run-long player growth.
//
// Kills (and objectives) award XP; every level grants one PERK pick.
// Between missions the intermission card offers three random perks
// (keys 1/2/3 or click; one is auto-picked if the timer runs out).
// Perks stack up to their cap and feed one `stats` object that the
// player, weapon, drop and damage code read every frame — nothing is
// baked into config, so a campaign restart is a clean slate.
// ============================================================

import { PROGRESSION } from './config.js';

export const PERKS = [
  { id: 'vitality', name: 'VITALITY', jp: '体力強化', desc: '+20 max HP (and heal it)', max: 4,
    apply: (s) => { s.maxHp += 20; s.healNow += 20; } },
  { id: 'plating', name: 'ARMOR PLATING', jp: '防弾板', desc: '+25 max armor · armor absorbs 60% damage', max: 3,
    apply: (s) => { s.maxArmor += 25; s.armorNow += 25; } },
  { id: 'hands', name: 'QUICK HANDS', jp: '早業', desc: 'Reload & weapon swap 18% faster', max: 3,
    apply: (s) => { s.reloadMul *= 0.82; } },
  { id: 'hollow', name: 'HOLLOW POINT', jp: '強装弾', desc: '+12% weapon damage', max: 4,
    apply: (s) => { s.dmgMul *= 1.12; } },
  { id: 'deadeye', name: 'DEADEYE', jp: '一撃必中', desc: 'Headshots deal +0.5× damage', max: 3,
    apply: (s) => { s.headMul += 0.5; } },
  { id: 'lightfoot', name: 'LIGHTFOOT', jp: '俊足', desc: '+8% move speed', max: 3,
    apply: (s) => { s.speedMul *= 1.08; } },
  { id: 'pockets', name: 'DEEP POCKETS', jp: '弾薬嚢', desc: '+25% magazine size and ammo cap', max: 2,
    apply: (s) => { s.magMul *= 1.25; s.reserveMul *= 1.25; } },
  { id: 'medic', name: 'FIELD MEDIC', jp: '衛生兵', desc: 'Medkits heal 40% more', max: 2,
    apply: (s) => { s.medkitMul *= 1.4; } },
  { id: 'scavenger', name: 'SCAVENGER', jp: '回収屋', desc: '+12% drop chance for everything', max: 3,
    apply: (s) => { s.dropBonus += 0.12; } },
  { id: 'steady', name: 'STEADY AIM', jp: '安定射撃', desc: '−20% recoil climb and spread', max: 3,
    apply: (s) => { s.recoilMul *= 0.8; s.spreadMul *= 0.8; } },
  { id: 'grenadier', name: 'GRENADIER', jp: '擲弾兵', desc: '+1 grenade capacity (+1 now)', max: 3,
    apply: (s) => { s.grenadeMax += 1; s.grenadeNow += 1; } },
  { id: 'adrenaline', name: 'ADRENALINE', jp: '興奮剤', desc: 'Each kill restores 5 HP', max: 3,
    apply: (s) => { s.onKillHeal += 5; } },
  { id: 'blast', name: 'BLAST SHIELD', jp: '耐爆', desc: '−40% explosive damage taken', max: 2,
    apply: (s) => { s.blastResist *= 0.6; } },
  { id: 'secondwind', name: 'SECOND WIND', jp: '不屈', desc: 'Overrun redeploy restores +25 HP', max: 2,
    apply: (s) => { s.overrunBonus += 25; } },
  { id: 'armory', name: 'ARMORY ACCESS', jp: '武器庫', desc: 'Unlock a random locked weapon', max: 3,
    apply: (s) => { s.unlockWeapon += 1; } },
];

export function baseStats() {
  return {
    maxHp: 100, maxArmor: 50, dmgMul: 1, reloadMul: 1, headMul: 2, speedMul: 1,
    magMul: 1, reserveMul: 1, medkitMul: 1, dropBonus: 0, recoilMul: 1, spreadMul: 1,
    grenadeMax: 3, onKillHeal: 0, blastResist: 1, overrunBonus: 0,
    // one-shot effects consumed by the game after a perk is applied
    healNow: 0, armorNow: 0, grenadeNow: 0, unlockWeapon: 0,
  };
}

export class Progression {
  constructor() { this.reset(); }

  reset() {
    this.xp = 0;
    this.level = 1;
    this.pending = 0;          // unspent perk picks
    this.taken = {};           // perk id → stacks
    this.stats = baseStats();
  }

  /** XP needed to go from `level` to `level + 1`. */
  need(level = this.level) { return Math.round(PROGRESSION.baseXp * Math.pow(level, PROGRESSION.growth)); }

  /** Award XP; returns the number of levels gained. */
  gain(n) {
    this.xp += n;
    let ups = 0;
    while (this.xp >= this.need()) {
      this.xp -= this.need();
      this.level++;
      this.pending++;
      ups++;
    }
    return ups;
  }

  frac() { return this.xp / this.need(); }

  /** Three distinct perks that still have stacks left. */
  offer(n = 3, canUnlock = true) {
    const open = PERKS.filter((p) => (this.taken[p.id] ?? 0) < p.max && (p.id !== 'armory' || canUnlock));
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [open[i], open[j]] = [open[j], open[i]];
    }
    return open.slice(0, n);
  }

  take(id) {
    const p = PERKS.find((x) => x.id === id);
    if (!p || this.pending <= 0) return null;
    this.taken[id] = (this.taken[id] ?? 0) + 1;
    this.pending--;
    p.apply(this.stats);
    return p;
  }
}
