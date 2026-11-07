// ============================================================
// enemyModel.js — detailed procedural hostiles, baked per skeletal
// segment (meshKit PartList → one mesh per segment).
//
// Each class gets its own silhouette: plate carrier with pouch rows,
// helmet shell with rails / ear-pro / NVG shroud or full-face masks,
// knee + elbow pads, gloves, boots with soles, and a class weapon
// (carbine / DMR / shotgun / LMG drum / launcher / flamethrower /
// PDW + ballistic shield). The drone is a separate quad-rotor model.
//
// Output is cached per (class, elite, palette seed): a whole wave of
// one class shares the same GPU buffers.
// ============================================================

import { G, PartList } from './meshKit.js';

// palette per class: suit, vest (hard gear), helmet, glow accent
const PAL = {
  rifle:      { suit: [0x2b313c, 0x34312b, 0x28362f], vest: 0x1b2027, helm: [0x2f3542, 0x3a372f, 0x2c3a31], glow: 0xff3a30 },
  rusher:     { suit: [0x3a2a22, 0x423224, 0x35292b], vest: 0x231b16, helm: [0x45321f, 0x3a2b1f, 0x432a24], glow: 0xff8a1e },
  heavy:      { suit: [0x262c35, 0x2b2f36, 0x222a37], vest: 0x1a2029, helm: [0x313a4a, 0x374054, 0x2c3545], glow: 0x3aa0ff },
  marksman:   { suit: [0x26302c, 0x2a3329, 0x2d2e34], vest: 0x1a211c, helm: [0x27352e, 0x2d3830, 0x24322a], glow: 0x3dff7a },
  stalker:    { suit: [0x1d1d25, 0x231d2a, 0x1a1e23], vest: 0x121216, helm: [0x1b1920, 0x201c28, 0x191b20], glow: 0xb040ff },
  breacher:   { suit: [0x323a2c, 0x373e30, 0x2e3529], vest: 0x1f241a, helm: [0x313a2b, 0x36402f, 0x2c3426], glow: 0xaaff3a },
  bombardier: { suit: [0x3a2a1e, 0x342f24, 0x3c2c22], vest: 0x261c14, helm: [0x432a18, 0x3a281d, 0x43301b], glow: 0xff6a00 },
  flamer:     { suit: [0x40291a, 0x3a2d1e, 0x442416], vest: 0x2a1a10, helm: [0x4a2410, 0x422d14, 0x4d1e0c], glow: 0xff9500 },
  phantom:    { suit: [0x2a2d40, 0x22283b, 0x2e2a3c], vest: 0x191b28, helm: [0x313650, 0x283046, 0x34364e], glow: 0x7df9ff },
  juggernaut: { suit: [0x232830, 0x29262f, 0x1f262c], vest: 0x2a2f38, helm: [0x2e3440, 0x33323b, 0x272e38], glow: 0xffc300 },
  shield:     { suit: [0x232a36, 0x262b33, 0x20283a], vest: 0x161b24, helm: [0x2a3242, 0x2f3646, 0x263040], glow: 0x5ad0ff },
  medic:      { suit: [0x3b4044, 0x3e4340, 0x383d44], vest: 0x23282c, helm: [0x4a4f54, 0x50555a, 0x464b50], glow: 0x3dff9e },
  commander:  { suit: [0x1e1a1c, 0x221c1c, 0x1c1a1e], vest: 0x2b2224, helm: [0x2c1c1e, 0x301e1e, 0x2a1c20], glow: 0xff2050 },
  drone:      { suit: [0x2a2f38, 0x30343c, 0x262c36], vest: 0x15181d, helm: [0x3a404a, 0x3a404a, 0x3a404a], glow: 0xff3050 },
};

const SKIN = 0x2a2420;        // balaclava
const STRAP = 0x11151a;
const GLOVE = 0x101318;
const BOOT = 0x15171b;
const SOLE = 0x0a0b0d;
const GUN = 0x15181d;
const GUNP = 0x1d2026;        // polymer furniture
const BRASS = 0x8a6a2a;

const CLOTH = { r: 0.88, m: 0.02 };
const NYLON = { r: 0.74, m: 0.04 };
const HARD = { r: 0.5, m: 0.28 };
const METAL = { r: 0.38, m: 0.75 };
const POLY = { r: 0.62, m: 0.1 };

const _cache = new Map();

/** Baked segments for one hostile look. See Enemy._build for the rig. */
export function enemyModel(cls, elite, seed) {
  const k = `${cls}|${elite ? 1 : 0}|${seed}`;
  let v = _cache.get(k);
  if (!v) { v = cls === 'drone' ? buildDrone(elite) : buildSoldier(cls, elite, seed); _cache.set(k, v); }
  return v;
}

// ------------------------------------------------------------------
function buildSoldier(cls, elite, seed) {
  const P = PAL[cls] ?? PAL.rifle;
  const suit = P.suit[seed % 3];
  const helm = elite ? 0x4a1c1f : P.helm[seed % 3];
  const vest = P.vest;
  const glow = elite ? 0xff2424 : P.glow;
  const heavy = cls === 'heavy' || cls === 'juggernaut' || cls === 'commander';
  const light = cls === 'rusher' || cls === 'stalker' || cls === 'phantom';

  const body = new PartList();
  // ---- pelvis / belt ----
  body.add(G.box(0.31, 0.2, 0.21), suit, 0, 0.98, 0, CLOTH);
  body.add(G.box(0.34, 0.055, 0.235), STRAP, 0, 1.01, 0, NYLON);
  body.add(G.box(0.07, 0.05, 0.02), BRASS, 0, 1.01, 0.122, METAL);           // buckle
  body.pair(G.box(0.07, 0.09, 0.06), vest, 0.15, 0.98, 0.08, NYLON);          // hip pouches
  body.add(G.box(0.1, 0.11, 0.07), vest, 0.17, 0.97, -0.07, NYLON);           // dump pouch
  // ---- torso ----
  body.add(G.cap(0.165, 0.3, 4, 12), suit, 0, 1.23, 0, CLOTH);
  body.add(G.cyl(0.07, 0.085, 0.09, 10), suit, 0, 1.52, 0, CLOTH);           // collar
  // plate carrier: front + back plates, cummerbund, shoulder straps
  const carrierW = heavy ? 0.42 : 0.37;
  body.add(G.box(carrierW, 0.4, 0.07), vest, 0, 1.25, 0.125, HARD);
  body.add(G.box(carrierW, 0.42, 0.07), vest, 0, 1.25, -0.125, HARD);
  body.pair(G.box(0.05, 0.3, 0.26), vest, carrierW / 2 - 0.01, 1.2, 0, NYLON);
  body.pair(G.box(0.055, 0.035, 0.3), STRAP, 0.11, 1.46, 0, NYLON);
  body.add(G.box(carrierW - 0.04, 0.08, 0.025), STRAP, 0, 1.38, 0.165, NYLON); // chest rig top
  // magazine pouch row (+ flaps)
  for (let i = 0; i < 3; i++) {
    const px = -0.11 + i * 0.11;
    body.add(G.box(0.085, 0.13, 0.055), vest, px, 1.13, 0.175, NYLON);
    body.add(G.box(0.088, 0.035, 0.06), STRAP, px, 1.2, 0.177, NYLON);
  }
  body.add(G.box(0.14, 0.09, 0.04), STRAP, 0.06, 1.33, 0.175, NYLON);         // admin pouch
  // radio + antenna (not the quiet classes)
  if (!light) {
    body.add(G.box(0.05, 0.11, 0.04), GUN, -0.2, 1.36, -0.05, METAL);
    body.add(G.cyl(0.005, 0.004, 0.22, 5), GUN, -0.2, 1.52, -0.05, { ...METAL, rot: [0, 0, 0.12] });
  }
  // backpack / back kit per class
  if (cls === 'bombardier') {
    body.add(G.box(0.27, 0.36, 0.14), vest, 0, 1.26, -0.22, NYLON);
    body.add(G.cyl(0.07, 0.08, 0.6, 12), GUNP, 0.07, 1.46, -0.3, { ...POLY, rot: [0.15, 0, 0.1] });  // tube
    for (let i = 0; i < 3; i++) body.add(G.cyl(0.035, 0.035, 0.12, 8), 0x4a5a30, -0.1, 1.15 + i * 0.09, -0.3, { ...HARD, rot: [0, 0, Math.PI / 2] });
  } else if (cls === 'flamer') {
    for (const tx of [-0.1, 0.1]) {
      body.add(G.cap(0.068, 0.32, 4, 12), 0x5a2e12, tx, 1.3, -0.27, { r: 0.35, m: 0.65 });
      body.add(G.cyl(0.028, 0.028, 0.07, 8), BRASS, tx, 1.58, -0.27, METAL);
    }
    body.add(G.box(0.26, 0.06, 0.06), GUN, 0, 1.12, -0.26, METAL);
    body.add(G.cyl(0.016, 0.016, 0.55, 6), GUNP, 0.15, 1.18, -0.08, { ...POLY, rot: [1.15, 0, -0.5] }); // hose
  } else if (cls === 'medic') {
    body.add(G.box(0.3, 0.38, 0.16), 0xd8dcdc, 0, 1.25, -0.22, CLOTH);
    body.add(G.box(0.07, 0.2, 0.01), 0xff2a2a, 0, 1.28, -0.305, { glow: true });
    body.add(G.box(0.2, 0.07, 0.01), 0xff2a2a, 0, 1.28, -0.305, { glow: true });
  } else if (cls === 'phantom') {
    body.add(G.box(0.46, 0.85, 0.03), 0x1a1f33, 0, 1.12, -0.24, { r: 0.5, m: 0.2, rot: [0.08, 0, 0] }); // cloak panel
    body.add(G.box(0.02, 0.7, 0.012), P.glow, 0.17, 1.12, -0.26, { glow: true });
    body.add(G.box(0.02, 0.7, 0.012), P.glow, -0.17, 1.12, -0.26, { glow: true });
  } else if (!light) {
    body.add(G.box(0.27, 0.34, 0.13), vest, 0, 1.26, -0.22, NYLON);
    body.add(G.box(0.22, 0.1, 0.04), STRAP, 0, 1.18, -0.29, NYLON);
    body.add(G.cyl(0.05, 0.05, 0.25, 10), STRAP, 0, 1.44, -0.24, { ...NYLON, rot: [0, 0, Math.PI / 2] }); // bedroll
  }
  // heavy armour layers
  if (heavy) {
    body.add(G.box(0.46, 0.34, 0.06), vest, 0, 1.3, 0.18, HARD);
    body.add(G.box(0.36, 0.14, 0.05), vest, 0, 1.03, 0.16, HARD);               // groin plate
    body.pair(G.sph(0.15, 12, 9), vest, 0.27, 1.43, 0, { ...HARD, s: [1, 0.75, 1.05] });  // pauldrons
    body.pair(G.box(0.1, 0.06, 0.24), helm, 0.29, 1.36, 0, HARD);
  }
  if (cls === 'juggernaut') {
    body.add(G.box(0.52, 0.52, 0.36), vest, 0, 1.24, 0, HARD);                  // bomb-suit slab
    body.add(G.box(0.32, 0.44, 0.15), vest, 0, 1.34, -0.28, HARD);
    body.add(G.cyl(0.18, 0.2, 0.12, 14), vest, 0, 1.53, 0, HARD);                // neck guard
  }
  if (cls === 'commander') {
    body.add(G.box(0.5, 0.95, 0.025), 0x5a0d14, 0, 1.0, -0.27, { r: 0.9, m: 0, rot: [0.1, 0, 0] }); // cape
    body.add(G.box(0.12, 0.03, 0.02), 0xffc84a, -0.11, 1.4, 0.19, { ...METAL });      // rank bars
    body.add(G.box(0.12, 0.03, 0.02), 0xffc84a, -0.11, 1.35, 0.19, { ...METAL });
  }
  if (cls === 'medic' || elite || cls === 'rusher' || cls === 'stalker') {
    body.add(G.cyl(0.075, 0.075, 0.05, 12), elite ? 0xff2020 : glow, -0.25, 1.33, 0, { glow: true }); // armband
  }
  // ---- head ----
  body.add(G.cyl(0.055, 0.066, 0.1, 10), SKIN, 0, 1.55, 0, CLOTH);
  body.add(G.sph(0.098, 14, 11), SKIN, 0, 1.635, 0.005, { ...CLOTH, s: [0.95, 1.05, 1] });
  buildHead(body, cls, helm, glow, elite);

  // ---- legs ----
  const thigh = new PartList();
  thigh.add(G.cap(0.083, 0.17, 4, 10), suit, 0, -0.19, 0, CLOTH);
  thigh.add(G.box(0.1, 0.15, 0.07), vest, -0.02, -0.2, 0.06, NYLON);           // cargo pocket
  if (!light) thigh.add(G.box(0.09, 0.17, 0.08), GUNP, 0.075, -0.2, 0, POLY);  // holster (outer)
  const shin = new PartList();
  shin.add(G.cap(0.07, 0.2, 4, 10), suit, 0, -0.24, 0, CLOTH);
  shin.add(G.box(0.12, 0.12, 0.08), heavy ? helm : vest, 0, -0.02, 0.06, { ...HARD, rot: [0.15, 0, 0] }); // knee pad
  shin.add(G.box(0.13, 0.13, 0.25), BOOT, 0, -0.44, 0.035, { r: 0.6, m: 0.05 });
  shin.add(G.box(0.14, 0.035, 0.28), SOLE, 0, -0.505, 0.04, { r: 0.95, m: 0 });
  shin.add(G.box(0.12, 0.05, 0.06), BOOT, 0, -0.46, 0.16, { r: 0.5, m: 0.05 });  // toe cap
  if (heavy) shin.add(G.box(0.15, 0.24, 0.07), vest, 0, -0.22, 0.07, HARD);      // shin guard

  // ---- arms ----
  const upper = new PartList();
  upper.add(G.cap(0.06, 0.14, 4, 10), suit, 0, -0.13, 0, CLOTH);
  upper.add(G.sph(cls === 'heavy' ? 0.11 : 0.085, 10, 8), vest, 0, -0.02, 0, { ...NYLON, s: [1.1, 0.8, 1.1] });
  const fore = new PartList();
  fore.add(G.cap(0.052, 0.13, 4, 10), suit, 0, -0.12, 0, CLOTH);
  fore.add(G.box(0.1, 0.08, 0.1), vest, 0, 0, 0, HARD);                        // elbow pad
  fore.add(G.box(0.085, 0.06, 0.1), GLOVE, 0, -0.245, 0.01, NYLON);            // palm
  fore.add(G.box(0.08, 0.05, 0.05), GLOVE, 0, -0.29, 0.035, { ...NYLON, rot: [0.6, 0, 0] }); // fingers
  fore.add(G.box(0.03, 0.05, 0.03), GLOVE, 0.045, -0.255, 0.05, NYLON);        // thumb

  const gun = buildGun(cls, glow);
  let shieldSeg = null;
  if (cls === 'shield') shieldSeg = buildShield(glow);

  return {
    body: body.bake(),
    thigh: thigh.bake(),
    shin: shin.bake(),
    upper: upper.bake(),
    fore: fore.bake(),
    gun: gun.list.bake(),
    tipZ: gun.tipZ,
    shield: shieldSeg ? shieldSeg.bake() : null,
  };
}

function buildHead(body, cls, helm, glow, elite) {
  const HY = 1.675;
  if (cls === 'juggernaut' || cls === 'commander') {
    // full bomb-suit / command helmet with a slit visor
    body.add(G.sph(0.14, 16, 12), helm, 0, HY - 0.01, 0, { ...HARD, s: [1, 1.02, 1.08] });
    body.add(G.box(0.2, 0.05, 0.05), glow, 0, HY - 0.01, 0.135, { glow: true });
    body.add(G.box(0.23, 0.12, 0.06), helm, 0, HY - 0.11, 0.1, HARD);          // chin guard
    if (cls === 'commander') {
      body.add(G.box(0.03, 0.09, 0.2), 0x8a1020, 0, HY + 0.15, -0.02, { r: 0.7, m: 0.1 }); // crest
    }
    return;
  }
  if (cls === 'phantom') {
    // hood + single optic
    body.add(G.dome(0.14, 1.9, 16, 10), 0x1b1f30, 0, HY - 0.03, -0.01, { r: 0.85, m: 0, s: [1, 1.15, 1.1] });
    body.add(G.cyl(0.035, 0.035, 0.05, 12), GUN, 0, HY - 0.02, 0.1, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    body.add(G.cyl(0.026, 0.026, 0.01, 12), glow, 0, HY - 0.02, 0.127, { glow: true, rot: [Math.PI / 2, 0, 0] });
    return;
  }
  // ballistic helmet shell + brim + rails + ear protection
  body.add(G.dome(0.122, 1.62, 16, 9), helm, 0, HY - 0.01, -0.005, { ...HARD, s: [1, 0.92, 1.06] });
  body.add(G.cyl(0.125, 0.128, 0.025, 16), helm, 0, HY - 0.02, -0.005, { ...HARD, s: [1, 1, 1.06] });
  body.pair(G.box(0.012, 0.03, 0.14), GUN, 0.122, HY + 0.01, -0.01, METAL);    // side rails
  body.pair(G.cyl(0.042, 0.042, 0.035, 12), GUNP, 0.105, HY - 0.06, 0, { ...POLY, rot: [0, 0, Math.PI / 2] }); // ear-pro
  // goggles / visor band
  if (cls === 'heavy') {
    body.add(G.box(0.2, 0.13, 0.05), helm, 0, HY - 0.07, 0.095, HARD);          // face shield
    body.add(G.box(0.17, 0.035, 0.012), glow, 0, HY - 0.045, 0.122, { glow: true });
  } else {
    body.add(G.box(0.17, 0.048, 0.035), STRAP, 0, HY - 0.035, 0.088, NYLON);
    body.pair(G.cyl(0.024, 0.024, 0.02, 10), glow, 0.042, HY - 0.035, 0.108, { glow: true, rot: [Math.PI / 2, 0, 0] });
  }
  // NVG shroud + mount
  if (cls !== 'stalker' && cls !== 'medic') {
    body.add(G.box(0.05, 0.04, 0.035), GUN, 0, HY + 0.065, 0.098, METAL);
    if (cls === 'marksman' || cls === 'rifle' || elite) {
      body.add(G.box(0.08, 0.03, 0.05), GUN, 0, HY + 0.095, 0.11, { ...METAL, rot: [-0.9, 0, 0] });
    }
  }
  if (cls === 'medic') body.add(G.box(0.06, 0.06, 0.01), 0xff2a2a, 0, HY + 0.07, 0.11, { glow: true });
  if (elite) body.add(G.box(0.02, 0.02, 0.015), 0xff2020, 0.118, HY + 0.02, 0.02, { glow: true }); // IR strobe
}

/** Class weapon, gun-local (+Z forward). Returns PartList + muzzle z. */
function buildGun(cls, glow) {
  const L = new PartList();
  const kind = {
    marksman: 'dmr', breacher: 'shotgun', bombardier: 'launcher', flamer: 'flame',
    juggernaut: 'lmg', heavy: 'lmg', phantom: 'pdw', stalker: 'pdw', shield: 'pistol', medic: 'pdw',
  }[cls] ?? 'carbine';
  let tip = 0.58;
  // shared lower: pistol grip + trigger guard
  const grip = (z = -0.02) => {
    L.add(G.box(0.032, 0.095, 0.045), GUNP, 0, -0.085, z, { ...POLY, rot: [0.35, 0, 0] });
    L.add(G.box(0.01, 0.03, 0.06), GUN, 0, -0.05, z + 0.045, METAL);
  };
  if (kind === 'pistol') {
    L.add(G.box(0.032, 0.04, 0.19), GUN, 0, 0.02, 0.06, METAL);
    L.add(G.box(0.03, 0.03, 0.15), GUNP, 0, -0.01, 0.05, POLY);
    L.add(G.box(0.03, 0.1, 0.045), GUNP, 0, -0.07, -0.01, { ...POLY, rot: [0.25, 0, 0] });
    tip = 0.17;
  } else if (kind === 'shotgun') {
    L.add(G.box(0.06, 0.09, 0.26), GUN, 0, 0, 0.05, METAL);
    L.add(G.cyl(0.02, 0.02, 0.5, 10), GUN, 0, 0.02, 0.42, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    L.add(G.cyl(0.016, 0.016, 0.42, 10), GUN, 0, -0.03, 0.38, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    L.add(G.box(0.07, 0.065, 0.17), GUNP, 0, -0.03, 0.34, POLY);                 // pump
    L.add(G.box(0.05, 0.09, 0.22), GUNP, 0, -0.03, -0.17, { ...POLY, rot: [0.1, 0, 0] });
    for (let i = 0; i < 4; i++) L.add(G.cyl(0.011, 0.011, 0.05, 6), 0xb02020, 0.035, 0.0, -0.02 + i * 0.03, { r: 0.5, m: 0.2, rot: [0, 0, Math.PI / 2] }); // side saddle
    grip(-0.04);
    tip = 0.68;
  } else if (kind === 'launcher') {
    L.add(G.box(0.07, 0.1, 0.3), GUNP, 0, 0, 0.05, POLY);
    L.add(G.cyl(0.13, 0.13, 0.14, 14), GUN, 0, 0, 0.2, { ...METAL, rot: [Math.PI / 2, 0, 0] });     // revolver drum
    L.add(G.cyl(0.05, 0.055, 0.45, 12), GUN, 0, 0.03, 0.5, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    L.add(G.box(0.05, 0.08, 0.2), GUNP, 0, -0.02, -0.15, POLY);
    L.add(G.box(0.04, 0.06, 0.05), GUN, 0, 0.09, 0.2, METAL);                  // sight
    grip(-0.03);
    tip = 0.76;
  } else if (kind === 'flame') {
    L.add(G.box(0.06, 0.09, 0.3), GUN, 0, 0, 0.05, METAL);
    L.add(G.cyl(0.03, 0.05, 0.46, 12), GUN, 0, 0.02, 0.45, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    L.add(G.cyl(0.055, 0.055, 0.14, 12), BRASS, 0, -0.07, 0.15, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    L.add(G.cyl(0.03, 0.012, 0.06, 8), 0xff7a1a, 0, 0.02, 0.71, { glow: true, rot: [Math.PI / 2, 0, 0] });
    grip(-0.02);
    tip = 0.74;
  } else {
    // rifle family: carbine / dmr / lmg / pdw
    const long = kind === 'dmr', lmg = kind === 'lmg', pdw = kind === 'pdw';
    const recvL = pdw ? 0.24 : 0.34;
    L.add(G.box(0.05, 0.055, recvL), GUN, 0, 0.015, 0.08, METAL);                // upper
    L.add(G.box(0.045, 0.05, recvL * 0.8), GUNP, 0, -0.035, 0.07, POLY);         // lower
    L.add(G.box(0.03, 0.012, recvL + 0.04), GUN, 0, 0.05, 0.1, METAL);           // top rail
    const hgL = long ? 0.3 : (pdw ? 0.12 : 0.22);
    L.add(G.cyl(0.032, 0.032, hgL, 8), GUNP, 0, 0.012, 0.25 + hgL / 2, { ...POLY, rot: [Math.PI / 2, 0, 0] }); // handguard
    const barL = long ? 0.36 : (pdw ? 0.1 : (lmg ? 0.32 : 0.2));
    const bz = 0.25 + hgL;
    L.add(G.cyl(0.013, 0.013, barL, 8), GUN, 0, 0.012, bz + barL / 2, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    L.add(G.cyl(0.02, 0.02, 0.06, 10), GUN, 0, 0.012, bz + barL + 0.03, { ...METAL, rot: [Math.PI / 2, 0, 0] });
    tip = bz + barL + 0.065;
    // stock
    L.add(G.box(0.025, 0.025, 0.12), GUN, 0, 0.0, -0.13, METAL);
    L.add(G.box(0.042, 0.085, 0.12), GUNP, 0, -0.015, -0.22, POLY);
    // magazine
    if (lmg) {
      L.add(G.cyl(0.1, 0.1, 0.09, 16), GUNP, 0, -0.1, 0.06, { ...POLY, rot: [0, 0, Math.PI / 2] }); // drum
      L.add(G.box(0.07, 0.07, 0.12), GUN, 0, 0.045, 0.33, METAL);              // carry shroud
      L.pair(G.cyl(0.008, 0.008, 0.2, 5), GUN, 0.04, -0.06, 0.48, { ...METAL, rot: [0.5, 0, 0] }); // bipod legs
    } else {
      L.add(G.box(0.032, 0.13, 0.065), GUNP, 0, -0.11, 0.07, { ...POLY, rot: [-0.2, 0, 0] });
      L.add(G.box(0.032, 0.06, 0.06), GUNP, 0, -0.19, 0.095, { ...POLY, rot: [-0.45, 0, 0] });
    }
    // optic
    if (long) {
      L.add(G.cyl(0.024, 0.024, 0.22, 12), GUN, 0, 0.085, 0.09, { ...METAL, rot: [Math.PI / 2, 0, 0] });
      L.add(G.cyl(0.03, 0.03, 0.04, 12), GUN, 0, 0.085, 0.215, { ...METAL, rot: [Math.PI / 2, 0, 0] });
      L.add(G.cyl(0.026, 0.026, 0.006, 12), glow, 0, 0.085, 0.237, { glow: true, rot: [Math.PI / 2, 0, 0] });
    } else {
      L.add(G.box(0.035, 0.04, 0.06), GUN, 0, 0.078, 0.07, METAL);
      L.add(G.box(0.022, 0.022, 0.004), glow, 0, 0.082, 0.102, { glow: true });
    }
    L.add(G.box(0.024, 0.07, 0.03), GUNP, 0, -0.045, 0.32, POLY);              // foregrip
    L.add(G.box(0.02, 0.02, 0.05), 0x0d0f12, 0.03, 0.03, 0.31, METAL);          // weapon light
    grip(-0.02);
  }
  return { list: L, tipZ: tip };
}

function buildShield(glow) {
  const L = new PartList();
  L.add(G.box(0.6, 1.2, 0.04), 0x20262e, 0, 0, 0, { r: 0.45, m: 0.55 });
  L.add(G.box(0.64, 0.05, 0.06), 0x111418, 0, 0.6, 0, METAL);
  L.add(G.box(0.64, 0.05, 0.06), 0x111418, 0, -0.6, 0, METAL);
  L.add(G.box(0.22, 0.09, 0.05), 0x0f1a24, 0, 0.36, 0.005, { r: 0.08, m: 0.6 });  // viewport
  L.add(G.box(0.5, 0.025, 0.01), glow, 0, -0.42, 0.026, { glow: true });
  return L;
}

// ------------------------------------------------------------------
function buildDrone(elite) {
  const P = PAL.drone;
  const glow = elite ? 0xff2020 : P.glow;
  const hull = new PartList();
  hull.add(G.sph(0.24, 16, 10), P.helm[0], 0, 0, 0, { ...HARD, s: [1, 0.48, 1.25] });
  hull.add(G.box(0.3, 0.05, 0.42), P.vest, 0, -0.07, 0, HARD);
  hull.add(G.cyl(0.06, 0.06, 0.06, 14), GUN, 0, -0.03, 0.29, { ...METAL, rot: [Math.PI / 2, 0, 0] });
  hull.add(G.cyl(0.045, 0.045, 0.012, 14), glow, 0, -0.03, 0.322, { glow: true, rot: [Math.PI / 2, 0, 0] }); // eye
  for (const [ax, az] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = ax * 0.33, z = az * 0.33;
    hull.add(G.box(0.36, 0.035, 0.05), P.vest, x / 2, 0, z / 2, { ...HARD, rot: [0, Math.atan2(-az, ax), 0] });
    hull.add(G.cyl(0.05, 0.05, 0.07, 10), GUN, x, 0.01, z, METAL);              // motor
    hull.add(G.cyl(0.2, 0.2, 0.008, 20), 0x0b0d10, x, 0.05, z, { r: 0.4, m: 0.3 }); // blur disc
    hull.add(G.tor(0.2, 0.008, 4, 24), glow, x, 0.05, z, { glow: true, rot: [Math.PI / 2, 0, 0] });
  }
  // under-slung gun pod (+Z forward)
  const gun = new PartList();
  gun.add(G.box(0.08, 0.07, 0.2), GUN, 0, 0, 0.05, METAL);
  gun.add(G.cyl(0.014, 0.014, 0.2, 8), GUN, 0, 0, 0.24, { ...METAL, rot: [Math.PI / 2, 0, 0] });
  return { drone: true, body: hull.bake(), gun: gun.bake(), tipZ: 0.35 };
}
