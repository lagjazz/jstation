// ============================================================
// hudExtras.js — HUD widgets for the progression / objective / loadout
// systems, mixed into HUD.prototype (hud.js stays the core HUD).
// Every per-frame setter caches what it last wrote, so the DOM is only
// touched when a shown value actually changes.
// ============================================================

import { HUD } from './hud.js';

const $ = (id) => document.getElementById(id);

const Extras = {
  _x(id) { return (this._xc ??= {})[id] ?? (this._xc[id] = $(id)); },

  setArmor(a, max) {
    const k = Math.ceil(a) * 1000 + max;
    if (this._armorK === k) return;
    this._armorK = k;
    this._x('armor-num').textContent = Math.ceil(a);
    this._x('armor-fill').style.width = `${max ? Math.min(100, (a / max) * 100) : 0}%`;
    this._x('hud-armor').classList.toggle('empty', a <= 0);
  },

  setGrenades(n, max) {
    const k = n * 100 + max;
    if (this._grenK === k) return;
    this._grenK = k;
    this._x('gren-num').textContent = `${n}/${max}`;
    this._x('hud-gren').classList.toggle('empty', n <= 0);
  },

  setXP(level, frac, pending) {
    const k = level * 10000 + Math.round(frac * 200) + pending * 1e6;
    if (this._xpK === k) return;
    this._xpK = k;
    this._x('xp-lvl').textContent = `LV ${level}${pending ? ` · +${pending} PERK` : ''}`;
    this._x('xp-fill').style.width = `${Math.round(frac * 100)}%`;
  },

  /** Weapon slot strip: owned weapons, current highlighted. */
  setSlots(weapons, owned, current) {
    const k = [...owned].sort().join(',') + '|' + current;
    if (this._slotK === k) return;
    this._slotK = k;
    const box = this._x('hud-slots');
    box.innerHTML = '';
    weapons.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'slot' + (i === current ? ' on' : '') + (owned.has(w.key) ? '' : ' locked');
      d.textContent = `${i + 1} ${owned.has(w.key) ? w.def.label.split(' ')[0] : '—'}`;
      box.appendChild(d);
    });
  },

  setObjective(info) {
    const k = info.title + '|' + info.detail + '|' + (info.progress == null ? -1 : Math.round(info.progress * 200)) + '|' + info.warn;
    if (this._objK === k) return;
    this._objK = k;
    this._x('obj-title').textContent = info.title;
    this._x('obj-detail').textContent = info.detail;
    const bar = this._x('obj-bar');
    bar.classList.toggle('hidden', info.progress == null);
    if (info.progress != null) this._x('obj-fill').style.width = `${Math.round(info.progress * 100)}%`;
    this._x('hud-obj').classList.toggle('warn', !!info.warn);
  },

  /** Projected waypoint markers: [{x, y, off, label, color, dist}] (screen px). */
  setMarkers(list) {
    const box = this._x('markers');
    while (box.childElementCount < list.length) {
      const d = document.createElement('div');
      d.className = 'wp';
      d.innerHTML = '<i></i><b></b>';
      box.appendChild(d);
    }
    for (let i = 0; i < box.childElementCount; i++) {
      const el = box.children[i];
      const m = list[i];
      if (!m) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      if (el.style.display === 'none') el.style.display = '';
      el.style.transform = `translate(${m.x.toFixed(0)}px, ${m.y.toFixed(0)}px)`;
      const txt = `${m.label} ${Math.round(m.dist)}m`;
      if (el._t !== txt) { el._t = txt; el.lastChild.textContent = txt; }
      if (el._c !== m.color) { el._c = m.color; el.style.color = m.color; }
      el.classList.toggle('off', !!m.off);
    }
  },

  setBoss(name, frac) {
    const bar = this._x('boss-bar');
    if (frac == null) { if (!bar.classList.contains('hidden')) bar.classList.add('hidden'); this._bossK = null; return; }
    const k = Math.round(frac * 400);
    if (this._bossK === k) return;
    this._bossK = k;
    bar.classList.remove('hidden');
    this._x('boss-name').textContent = name;
    this._x('boss-fill').style.width = `${Math.max(0, frac * 100)}%`;
  },

  setBuffs(od, haste) {
    const k = Math.ceil(od) * 100 + Math.ceil(haste);
    if (this._buffK === k) return;
    this._buffK = k;
    const box = this._x('buffs');
    box.innerHTML = '';
    if (od > 0) box.innerHTML += `<div class="buff od">OVERDRIVE ${Math.ceil(od)}s</div>`;
    if (haste > 0) box.innerHTML += `<div class="buff hs">HASTE ${Math.ceil(haste)}s</div>`;
  },

  /** Red wedge pointing at whoever just hit you (relative bearing, rad). */
  damageFrom(rel) {
    const box = this._x('dmg-ind');
    const d = document.createElement('div');
    d.className = 'dmg-arc';
    d.style.transform = `rotate(${(-rel).toFixed(3)}rad)`;
    box.appendChild(d);
    while (box.childElementCount > 6) box.firstChild.remove();
    setTimeout(() => d.remove(), 900);
  },

  /** Live hostile grenades near you (relative bearings). */
  grenadeWarn(rels) {
    const box = this._x('gren-warn');
    while (box.childElementCount < rels.length) {
      const d = document.createElement('div');
      d.className = 'gw';
      d.textContent = '⬣';
      box.appendChild(d);
    }
    while (box.childElementCount > rels.length) box.lastChild.remove();
    rels.forEach((a, i) => {
      const x = -Math.sin(a) * 90, y = -Math.cos(a) * 90;
      box.children[i].style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    });
  },

  scope(on) {
    if (this._scopeOn === on) return;
    this._scopeOn = on;
    this._x('scope').classList.toggle('on', on);
    this.el.crosshair.classList.toggle('hidden', on);
  },

  adsCross(a) {
    const v = a > 0.5;
    if (this._adsV === v) return;
    this._adsV = v;
    this.el.crosshair.classList.toggle('ads', v);
  },

  /** Perk cards on the intermission panel. */
  showPerks(choices, pending) {
    const row = this._x('perk-row');
    row.innerHTML = '';
    row.classList.toggle('hidden', !choices.length);
    if (!choices.length) return;
    const head = document.createElement('div');
    head.className = 'perk-head';
    head.textContent = `LEVEL UP — CHOOSE A PERK (${pending} left) · [1] [2] [3]`;
    row.appendChild(head);
    choices.forEach((p, i) => {
      const c = document.createElement('div');
      c.className = 'perk';
      c.dataset.id = p.id;
      c.innerHTML = `<div class="pk-key">${i + 1}</div><div class="pk-name">${p.name}</div><div class="pk-jp">${p.jp}</div><div class="pk-desc">${p.desc}</div>`;
      row.appendChild(c);
    });
  },

  hidePerks() { const r = this._x('perk-row'); r.innerHTML = ''; r.classList.add('hidden'); },

  showFail(reason) {
    const el = this._x('fail-card');
    el.querySelector('.f-sub').textContent = reason;
    el.classList.remove('hidden');
    clearTimeout(this._failTO);
    this._failTO = setTimeout(() => el.classList.add('hidden'), 3200);
  },

  /** Mission banner line 4: objective + atmosphere variant. */
  setBannerExtra(text) { this._x('mb-4').textContent = text; },

  levelUp(level) {
    const el = this._x('lvl-toast');
    el.textContent = `▲ LEVEL ${level} · 昇級 — PERK READY`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  },
};

Object.assign(HUD.prototype, Extras);
