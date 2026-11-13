// ============================================================
// weapon.js — first-person weapons + the player's arms.
//
// Six weapons (rifle / pistol / shotgun start in the loadout; PDW,
// DMR and grenade launcher are found in weapon crates or unlocked by
// the ARMORY perk). Each viewmodel is a detailed procedural model
// baked into a couple of meshes (meshKit) and is HELD by gloved hands
// on tactical sleeves: the right hand on the grip, the left on the
// handguard / pump (the left arm rides the shotgun pump).
//
// Animation: idle breathing, walk bob, sprint tilt, recoil spring,
// magazine drop + insert reload, switch dip, and aim-down-sights
// (right mouse): the sight line glides onto the crosshair, FOV zooms
// per weapon, spread/speed/sensitivity scale (config ADS). The DMR
// goes to a full scope overlay when fully aimed.
// Run-long perks (progression stats) scale mag size, reload speed,
// ammo caps and spread.
// ============================================================

import * as THREE from 'three';
import { ADS, RECOIL, STARTING_WEAPONS, WEAPONS, WEAPON_ORDER } from './config.js';
import { G, PartList, RMMaterial, GlowMaterial } from './meshKit.js';
import { TEX } from './textures.js';
import { damp, rand } from './utils.js';

const MET = { r: 0.36, m: 0.85 };
const DARK = { r: 0.45, m: 0.7 };
const POLY = { r: 0.6, m: 0.08 };
const RUB = { r: 0.92, m: 0 };
const CLOTH = { r: 0.9, m: 0 };

// lifted from near-black: the viewmodel must read as machined metal +
// polymer under night lighting, not as a silhouette
const C_MET = 0x4a515c, C_MET2 = 0x666d78, C_POLY = 0x3a3d45, C_FDE = 0x8a7450, C_RUB = 0x22252a;
const C_SLEEVE = 0x55604e, C_GLOVE = 0x2c3038, C_CUFF = 0x3c4238;

const Z = [Math.PI / 2, 0, 0];   // cylinder along Z

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _mp = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _rt = new THREE.Vector3();

/** Capsule limb from `a` to `b` (gun-local coords). */
function limb(L, a, b, r, color, opts = CLOTH) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  _dir.multiplyScalar(1 / len);
  _q.setFromUnitVectors(_up, _dir);
  _e.setFromQuaternion(_q);
  L.add(G.cap(r, Math.max(0.01, len - r * 2), 4, 10), color,
    (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, { ...opts, rot: [_e.x, _e.y, _e.z] });
}

/** Gloved hand wrapped around a vertical grip at `p` (fingers forward). */
function gripHand(L, p, side = 1, tilt = 0.3) {
  const [x, y, z] = p;
  L.add(G.box(0.06, 0.085, 0.075), C_GLOVE, x + 0.012 * side, y, z + 0.005, { ...RUB, rot: [tilt, 0, 0] });
  L.add(G.box(0.07, 0.065, 0.03), C_GLOVE, x - 0.004 * side, y - 0.005, z - 0.04, { ...RUB, rot: [tilt, 0, 0] });   // fingers
  L.add(G.box(0.02, 0.022, 0.06), C_GLOVE, x - 0.034 * side, y + 0.03, z - 0.02, { ...RUB, rot: [0, 0.2 * side, 0] }); // thumb
  L.add(G.box(0.03, 0.018, 0.018), C_GLOVE, x + 0.01 * side, y + 0.035, z - 0.045, RUB);                               // trigger finger
}

/** Gloved hand cupping a handguard at `p` from below/left. */
function supportHand(L, p) {
  const [x, y, z] = p;
  L.add(G.box(0.07, 0.05, 0.09), C_GLOVE, x - 0.02, y - 0.03, z, RUB);
  L.add(G.box(0.03, 0.06, 0.085), C_GLOVE, x + 0.035, y - 0.0, z, { ...RUB, rot: [0, 0, -0.3] });   // fingers wrap
  L.add(G.box(0.025, 0.05, 0.07), C_GLOVE, x - 0.05, y + 0.005, z + 0.01, { ...RUB, rot: [0, 0, 0.4] }); // thumb side
}

function sleeve(L, hand, elbow, wrist) {
  limb(L, wrist, elbow, 0.036, C_SLEEVE);
  // wrist cuff + a watch-style band so the forearm reads as an arm, not a pipe
  _dir.set(elbow[0] - wrist[0], elbow[1] - wrist[1], elbow[2] - wrist[2]).normalize();
  _q.setFromUnitVectors(_up, _dir);
  _e.setFromQuaternion(_q);
  const r = [_e.x, _e.y, _e.z];
  L.add(G.cyl(0.039, 0.037, 0.05, 12), C_CUFF, wrist[0] + _dir.x * 0.02, wrist[1] + _dir.y * 0.02, wrist[2] + _dir.z * 0.02, { ...CLOTH, rot: r });
  L.add(G.cyl(0.04, 0.04, 0.012, 12), C_GLOVE, wrist[0] + _dir.x * 0.1, wrist[1] + _dir.y * 0.1, wrist[2] + _dir.z * 0.1, { ...RUB, rot: r });
  void hand;
}

// ---------------- procedural weapon builders (forward = -Z) ----------------

function rifleModel() {
  const B = new PartList(), M = new PartList();
  const X = [0, 0, Math.PI / 2];
  // ---- receiver: stepped upper + lower, ejection port, forward assist ----
  B.add(G.box(0.056, 0.05, 0.3), C_MET, 0, 0.018, -0.12, MET);                  // upper
  B.add(G.box(0.044, 0.016, 0.3), C_MET, 0, 0.047, -0.12, MET);                 // upper chamfer
  B.add(G.box(0.052, 0.05, 0.2), C_MET2, 0, -0.03, -0.09, DARK);                // lower
  B.add(G.box(0.05, 0.03, 0.07), C_MET2, 0, -0.045, -0.2, { ...DARK, rot: [0.5, 0, 0] });   // magwell flare
  B.add(G.box(0.004, 0.022, 0.07), 0x15171b, 0.029, 0.022, -0.13, DARK);        // ejection port
  B.add(G.box(0.006, 0.026, 0.074), C_MET2, 0.031, 0.006, -0.13, { ...MET, rot: [0, 0, 0.5] });   // dust cover (open)
  B.add(G.cyl(0.008, 0.008, 0.03, 8), C_MET2, 0.034, 0.02, -0.02, { ...MET, rot: [0, 0.5, Math.PI / 2] });  // forward assist
  B.add(G.box(0.018, 0.012, 0.03), C_MET, -0.03, -0.012, -0.11, MET);           // bolt catch
  B.add(G.cyl(0.006, 0.006, 0.064, 8), 0xc8ccd2, 0, -0.028, -0.01, { r: 0.3, m: 0.9, rot: X });   // takedown pin
  B.add(G.cyl(0.006, 0.006, 0.064, 8), 0xc8ccd2, 0, -0.028, -0.17, { r: 0.3, m: 0.9, rot: X });   // pivot pin
  B.add(G.box(0.03, 0.012, 0.045), C_MET2, 0, 0.05, 0.035, MET);                // charging handle
  B.pair(G.box(0.012, 0.012, 0.02), C_MET2, 0.022, 0.05, 0.05, MET);
  // ---- continuous top rail with picatinny teeth ----
  B.add(G.box(0.03, 0.008, 0.56), C_MET, 0, 0.058, -0.27, MET);
  for (let i = 0; i < 22; i++) B.add(G.box(0.034, 0.007, 0.011), C_MET2, 0, 0.065, 0.0 - i * 0.0255, MET);
  // ---- free-float handguard: octagonal tube, M-LOK slots, tan furniture ----
  B.add(G.cyl(0.036, 0.036, 0.31, 8), C_FDE, 0, 0.018, -0.425, { ...POLY, rot: [Math.PI / 2, Math.PI / 8, 0] });
  B.add(G.cyl(0.0375, 0.0375, 0.02, 8), C_MET, 0, 0.018, -0.275, { ...MET, rot: [Math.PI / 2, Math.PI / 8, 0] });   // barrel nut ring
  B.add(G.cyl(0.0375, 0.0375, 0.012, 8), C_MET, 0, 0.018, -0.578, { ...MET, rot: [Math.PI / 2, Math.PI / 8, 0] });  // end cap
  for (let i = 0; i < 5; i++) {
    const z = -0.31 - i * 0.052;
    B.pair(G.box(0.003, 0.012, 0.034), 0x15171b, 0.0352, 0.018, z, DARK);       // side slots
    B.pair(G.box(0.012, 0.003, 0.034), 0x15171b, 0.0235, -0.0085, z, { ...DARK, rot: [0, 0, 0.785] });
  }
  // ---- barrel, gas block, muzzle brake ----
  B.add(G.cyl(0.0125, 0.0125, 0.3, 12), C_MET, 0, 0.018, -0.66, { ...MET, rot: Z });
  B.add(G.cyl(0.02, 0.02, 0.035, 10), C_MET2, 0, 0.018, -0.6, { ...MET, rot: Z });           // gas block
  B.add(G.cyl(0.019, 0.016, 0.075, 12), C_MET2, 0, 0.018, -0.815, { ...MET, rot: Z });       // brake
  for (let i = 0; i < 3; i++) B.pair(G.box(0.004, 0.012, 0.01), 0x0f1013, 0.017, 0.018, -0.795 - i * 0.02, DARK);   // ports
  B.add(G.cyl(0.0075, 0.0075, 0.004, 10), 0x050506, 0, 0.018, -0.854, { ...DARK, rot: Z });  // bore
  // ---- pistol grip (two-piece, raked) + trigger group ----
  B.add(G.box(0.04, 0.095, 0.05), C_FDE, 0, -0.092, 0.032, { ...RUB, rot: [-0.34, 0, 0] });
  B.add(G.cap(0.02, 0.06, 3, 8), C_FDE, 0, -0.095, 0.058, { ...RUB, rot: [-0.34, 0, 0] });   // backstrap
  B.add(G.box(0.042, 0.02, 0.052), C_RUB, 0, -0.142, 0.05, { ...RUB, rot: [-0.34, 0, 0] });  // grip cap
  B.add(G.tor(0.026, 0.0045, 5, 12, Math.PI), C_MET, 0, -0.055, -0.03, { ...MET, rot: [0, Math.PI / 2, Math.PI] });  // trigger guard
  B.add(G.box(0.008, 0.028, 0.008), 0xc8ccd2, 0, -0.065, -0.022, { r: 0.3, m: 0.9, rot: [0.3, 0, 0] });   // trigger
  // ---- buffer tube + adjustable stock ----
  B.add(G.cyl(0.0165, 0.0165, 0.2, 12), C_MET2, 0, 0.012, 0.13, { ...MET, rot: Z });
  B.add(G.cyl(0.021, 0.021, 0.02, 12), C_MET, 0, 0.012, 0.045, { ...MET, rot: Z });          // castle nut
  B.add(G.box(0.044, 0.05, 0.17), C_FDE, 0, 0.008, 0.215, POLY);                // stock body
  B.add(G.box(0.036, 0.075, 0.05), C_FDE, 0, -0.045, 0.27, { ...POLY, rot: [-0.35, 0, 0] });   // rear strut
  B.add(G.box(0.03, 0.02, 0.11), C_FDE, 0, -0.058, 0.2, { ...POLY, rot: [0.42, 0, 0] });       // lower strut
  B.add(G.box(0.05, 0.13, 0.022), C_RUB, 0, -0.02, 0.305, RUB);                 // butt pad
  B.add(G.box(0.012, 0.02, 0.04), C_MET, 0, -0.025, 0.16, MET);                 // adjust latch
  // ---- holographic sight: base, hooded window, glowing reticle ----
  B.add(G.box(0.04, 0.02, 0.085), C_MET, 0, 0.077, -0.09, MET);
  B.pair(G.box(0.006, 0.045, 0.05), C_MET, 0.022, 0.108, -0.085, MET);
  B.add(G.box(0.05, 0.006, 0.05), C_MET, 0, 0.133, -0.085, MET);
  B.pair(G.box(0.008, 0.008, 0.05), C_MET, 0.019, 0.129, -0.085, { ...MET, rot: [0, 0, 0.785] });   // hood chamfers
  B.add(G.box(0.006, 0.006, 0.002), 0xff2020, 0, 0.108, -0.06, { glow: true });  // dot
  B.add(G.tor(0.009, 0.0012, 4, 16), 0xff2020, 0, 0.108, -0.06, { glow: true }); // ring
  // ---- folded front sight, angled foregrip, weapon light, sling loop ----
  B.add(G.box(0.022, 0.012, 0.045), C_MET2, 0, 0.072, -0.54, MET);
  B.add(G.box(0.03, 0.07, 0.034), C_RUB, 0, -0.048, -0.46, { ...RUB, rot: [0.25, 0, 0] });
  B.add(G.cap(0.016, 0.05, 3, 8), C_RUB, 0, -0.05, -0.452, { ...RUB, rot: [0.25, 0, 0] });
  B.add(G.cyl(0.0165, 0.0165, 0.075, 12), C_MET, 0.052, 0.022, -0.5, { ...MET, rot: Z });
  B.add(G.cyl(0.02, 0.0165, 0.02, 12), C_MET2, 0.052, 0.022, -0.545, { ...MET, rot: Z });
  B.add(G.cyl(0.0145, 0.0145, 0.004, 12), 0xfff4d0, 0.052, 0.022, -0.556, { glow: true, rot: Z });
  B.add(G.tor(0.012, 0.003, 4, 10), C_MET2, -0.03, 0.0, 0.07, { ...MET, rot: [0, Math.PI / 2, 0] });
  // ---- magazine: three stepped segments = a real curve, witness ribs ----
  M.add(G.box(0.03, 0.07, 0.066), C_POLY, 0, -0.085, -0.155, { ...POLY, rot: [0.16, 0, 0] });
  M.add(G.box(0.03, 0.07, 0.066), C_POLY, 0, -0.148, -0.14, { ...POLY, rot: [0.3, 0, 0] });
  M.add(G.box(0.03, 0.05, 0.066), C_POLY, 0, -0.2, -0.118, { ...POLY, rot: [0.46, 0, 0] });
  M.add(G.box(0.034, 0.014, 0.072), C_RUB, 0, -0.226, -0.104, { ...RUB, rot: [0.46, 0, 0] });   // base plate
  for (let i = 0; i < 3; i++) M.pair(G.box(0.002, 0.045, 0.01), C_MET2, 0.0155, -0.12 - i * 0.004, -0.165 + i * 0.022, { ...POLY, rot: [0.22, 0, 0] });
  return { B, M, muzzle: -0.86, sightY: 0.108, grip: [0, -0.095, 0.03], fore: [0, -0.04, -0.46], magY: -0.1 };
}

function pistolModel() {
  const B = new PartList(), M = new PartList();
  B.add(G.box(0.036, 0.042, 0.2), C_MET, 0, 0.03, -0.08, MET);                  // slide
  for (let i = 0; i < 6; i++) B.add(G.box(0.038, 0.03, 0.006), C_MET2, 0, 0.03, 0.0 - i * 0.012, MET); // serrations
  B.add(G.box(0.034, 0.028, 0.18), C_POLY, 0, -0.0, -0.075, POLY);              // frame
  B.add(G.box(0.012, 0.012, 0.012), C_MET, 0, 0.056, 0.005, MET);              // rear sight
  B.add(G.box(0.006, 0.012, 0.008), C_MET, 0, 0.056, -0.17, MET);              // front sight
  B.add(G.box(0.004, 0.004, 0.002), 0x40ff60, 0, 0.058, -0.175, { glow: true });
  B.add(G.box(0.036, 0.11, 0.05), C_POLY, 0, -0.07, 0.035, { ...POLY, rot: [-0.25, 0, 0] });
  B.add(G.box(0.01, 0.025, 0.05), C_POLY, 0, -0.03, -0.035, POLY);
  B.add(G.cyl(0.009, 0.009, 0.02, 8), C_MET2, 0, 0.03, -0.185, { ...MET, rot: Z });
  M.add(G.box(0.03, 0.04, 0.045), C_MET2, 0, -0.13, 0.055, MET);
  return { B, M, muzzle: -0.2, sightY: 0.058, grip: [0, -0.07, 0.04], fore: null, magY: -0.12, twoHand: true };
}

function shotgunModel() {
  const B = new PartList(), P = new PartList();
  B.add(G.cyl(0.019, 0.019, 0.6, 12), C_MET, 0, 0.022, -0.36, { ...MET, rot: Z });
  B.add(G.cyl(0.015, 0.015, 0.48, 10), C_MET2, 0, -0.022, -0.32, { ...MET, rot: Z });
  B.add(G.box(0.056, 0.085, 0.24), C_MET, 0, 0.0, 0.04, MET);
  B.add(G.box(0.012, 0.05, 0.012), C_MET, 0, -0.06, 0.0, MET);
  B.add(G.box(0.05, 0.1, 0.3), C_FDE, 0, -0.035, 0.26, { ...POLY, rot: [0.12, 0, 0] });
  B.add(G.box(0.052, 0.075, 0.06), C_RUB, 0, -0.03, 0.41, { ...RUB, rot: [0.3, 0, 0] });
  B.add(G.box(0.012, 0.012, 0.5), C_MET2, 0, 0.046, -0.16, MET);
  B.add(G.sph(0.006, 6, 5), 0xffd040, 0, 0.056, -0.63, { glow: true });
  for (let i = 0; i < 4; i++) B.add(G.cyl(0.011, 0.011, 0.055, 8), 0xa02020, 0.034, 0.0, 0.0 + i * 0.03, { ...POLY, rot: [0, 0, Math.PI / 2] });
  // pump (left hand rides it)
  P.add(G.box(0.066, 0.058, 0.16), C_FDE, 0, -0.022, 0, POLY);
  for (let i = 0; i < 5; i++) P.add(G.box(0.07, 0.008, 0.012), 0x4a3e2c, 0, -0.022, -0.06 + i * 0.03, POLY);
  return { B, P, muzzle: -0.68, sightY: 0.056, grip: [0, -0.05, 0.12], fore: [0, -0.03, 0], pumpZ: -0.28, magY: 0 };
}

function smgModel() {
  const B = new PartList(), M = new PartList();
  B.add(G.box(0.055, 0.07, 0.26), C_MET, 0, 0.01, -0.1, MET);
  B.add(G.box(0.04, 0.012, 0.26), C_MET2, 0, 0.052, -0.1, MET);
  B.add(G.cyl(0.013, 0.013, 0.12, 10), C_MET, 0, 0.012, -0.29, { ...MET, rot: Z });
  B.add(G.cyl(0.02, 0.02, 0.12, 12), C_MET2, 0, 0.012, -0.36, { ...MET, rot: Z });  // suppressor
  B.add(G.box(0.045, 0.1, 0.05), C_POLY, 0, -0.085, 0.0, { ...POLY, rot: [-0.2, 0, 0] });
  B.add(G.box(0.03, 0.08, 0.035), C_POLY, 0, -0.07, -0.2, POLY);                 // foregrip
  B.add(G.box(0.02, 0.02, 0.16), C_MET2, 0, -0.01, 0.12, MET);                   // wire stock
  B.add(G.box(0.05, 0.08, 0.02), C_POLY, 0, -0.02, 0.2, POLY);
  B.add(G.box(0.035, 0.035, 0.05), C_MET, 0, 0.078, -0.07, MET);
  B.add(G.box(0.02, 0.02, 0.002), 0x30ff60, 0, 0.082, -0.044, { glow: true });
  M.add(G.box(0.028, 0.16, 0.035), C_POLY, 0, -0.14, 0.0, { ...POLY, rot: [-0.2, 0, 0] });
  return { B, M, muzzle: -0.43, sightY: 0.082, grip: [0, -0.085, 0.0], fore: [0, -0.07, -0.2], magY: -0.16 };
}

function dmrModel() {
  const B = new PartList(), M = new PartList();
  B.add(G.box(0.06, 0.07, 0.36), C_MET, 0, 0.01, -0.14, MET);
  B.add(G.box(0.07, 0.07, 0.36), 0x3a3528, 0, 0.0, -0.48, POLY);                 // chassis
  B.add(G.cyl(0.016, 0.016, 0.36, 10), C_MET, 0, 0.01, -0.84, { ...MET, rot: Z });
  B.add(G.cyl(0.025, 0.025, 0.08, 12), C_MET2, 0, 0.01, -1.04, { ...MET, rot: Z });
  B.add(G.box(0.05, 0.12, 0.06), C_RUB, 0, -0.1, 0.05, { ...RUB, rot: [-0.3, 0, 0] });
  B.add(G.box(0.06, 0.12, 0.22), 0x3a3528, 0, -0.02, 0.24, POLY);
  B.add(G.box(0.05, 0.04, 0.14), 0x3a3528, 0, 0.05, 0.22, POLY);
  // scope: tube, bells, turrets, lens glow
  B.add(G.cyl(0.021, 0.021, 0.24, 14), C_MET, 0, 0.1, -0.12, { ...MET, rot: Z });
  B.add(G.cyl(0.032, 0.022, 0.06, 14), C_MET, 0, 0.1, -0.27, { ...MET, rot: Z });
  B.add(G.cyl(0.026, 0.02, 0.05, 14), C_MET, 0, 0.1, 0.02, { ...MET, rot: Z });
  B.add(G.cyl(0.012, 0.012, 0.03, 10), C_MET2, 0, 0.13, -0.12, MET);
  B.add(G.cyl(0.012, 0.012, 0.03, 10), C_MET2, 0.03, 0.1, -0.12, { ...MET, rot: [0, 0, Math.PI / 2] });
  B.add(G.cyl(0.029, 0.029, 0.003, 14), 0x203048, 0, 0.1, -0.301, { glow: true, rot: Z });
  B.pair(G.box(0.02, 0.04, 0.02), C_MET2, 0.0, 0.068, -0.05, MET);
  B.pair(G.box(0.02, 0.04, 0.02), C_MET2, 0.0, 0.068, -0.2, MET);
  M.add(G.box(0.032, 0.11, 0.075), C_MET2, 0, -0.08, -0.16, MET);
  return { B, M, muzzle: -1.09, sightY: 0.1, grip: [0, -0.1, 0.05], fore: [0, -0.04, -0.5], magY: -0.08 };
}

function launcherModel() {
  const B = new PartList(), M = new PartList();
  B.add(G.cyl(0.045, 0.045, 0.36, 14), C_MET, 0, 0.03, -0.42, { ...MET, rot: Z });
  B.add(G.box(0.06, 0.08, 0.2), C_POLY, 0, 0.0, 0.0, POLY);
  B.add(G.box(0.05, 0.1, 0.06), C_RUB, 0, -0.1, 0.05, { ...RUB, rot: [-0.3, 0, 0] });
  B.add(G.box(0.035, 0.08, 0.04), C_POLY, 0, -0.08, -0.3, POLY);
  B.add(G.box(0.05, 0.1, 0.2), C_POLY, 0, -0.01, 0.22, POLY);
  B.add(G.box(0.04, 0.05, 0.05), C_MET, 0, 0.1, -0.15, MET);
  B.add(G.box(0.024, 0.024, 0.002), 0xff8020, 0, 0.11, -0.124, { glow: true });
  // revolving cylinder is the "magazine" (spins on reload)
  M.add(G.cyl(0.085, 0.085, 0.16, 14), C_MET2, 0, 0.0, -0.17, { ...MET, rot: Z });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    M.add(G.cyl(0.024, 0.024, 0.165, 10), 0x0a0b0d, Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.17, { ...RUB, rot: Z });
  }
  return { B, M, muzzle: -0.62, sightY: 0.11, grip: [0, -0.1, 0.05], fore: [0, -0.08, -0.3], magY: 0, spinMag: true };
}

const BUILDERS = { rifle: rifleModel, pistol: pistolModel, shotgun: shotgunModel, smg: smgModel, dmr: dmrModel, launcher: launcherModel };

/** Arms for a weapon: right forearm to the grip, left forearm to the
 *  foregrip (or cupping the pistol grip). Returns { right, left }. */
function armsFor(spec) {
  const R = new PartList(), Lf = new PartList();
  const g = spec.grip;
  gripHand(R, g, 1);
  const wristR = [g[0] + 0.03, g[1] - 0.05, g[2] + 0.07];
  sleeve(R, g, [wristR[0] + 0.14, wristR[1] - 0.24, wristR[2] + 0.34], wristR);
  if (spec.twoHand) {
    supportHand(Lf, [g[0] - 0.035, g[1] - 0.02, g[2] - 0.01]);
    const w = [g[0] - 0.07, g[1] - 0.06, g[2] + 0.05];
    sleeve(Lf, g, [w[0] - 0.2, w[1] - 0.24, w[2] + 0.3], w);
  } else if (spec.fore) {
    const f = spec.fore;
    supportHand(Lf, f);
    const w = [f[0] - 0.05, f[1] - 0.07, f[2] + 0.06];
    sleeve(Lf, f, [w[0] - 0.2, w[1] - 0.24, w[2] + 0.3], w);
  }
  return { right: R.bake(), left: Lf.bake() };
}

// ---------------- controller ----------------

export class WeaponController {
  constructor(camera, audio, particles) {
    this.camera = camera;
    this.audio = audio;
    this.particles = particles;
    this.weapons = [];
    this.current = 0;
    this.fireTimer = 0;
    this.heat = 0;
    this.spray = 0;
    this.sprayT = 99;
    this.sprayNorm = 0;
    this.kickPos = 0;
    this.kickRot = 0;
    this.reloadT = -1;
    this.reloadDur = 0;
    this.reloadSwapped = false;
    this.switchT = 0;
    this.switchDur = 0.5;
    this.pendingSwitch = -1;
    this.sprintAmt = 0;
    this.bobT = 0;
    this.flashT = 0;
    this.time = 0;
    this.ads = 0;              // 0 hip … 1 fully aimed
    this.wantAds = false;
    this.stats = null;         // progression stats (perks)
    this.buffHaste = false;
    this.owned = new Set(STARTING_WEAPONS);
    this.mat = RMMaterial();
    this.glow = GlowMaterial(3);

    // helper light so the viewmodel is always readable (no shadow)
    // soft fill from above-right, far enough from the (hand-held, close)
    // viewmodel that it never blows the gun out
    this.viewLight = new THREE.PointLight(0xe6ecff, 2.2, 3, 2);
    this.viewLight.position.set(0.45, 0.55, -0.1);
    camera.add(this.viewLight);
  }

  init(rifleGLB) {
    WEAPON_ORDER.forEach((key, i) => {
      const def = WEAPONS[key];
      const spec = BUILDERS[key]();
      const holder = new THREE.Group();
      const addBaked = (baked, parent) => {
        if (baked.geo) { const m = new THREE.Mesh(baked.geo, this.mat); m.frustumCulled = false; parent.add(m); }
        if (baked.glowGeo) { const m = new THREE.Mesh(baked.glowGeo, this.glow); m.frustumCulled = false; parent.add(m); }
      };
      if (key === 'rifle' && rifleGLB) holder.add(this._fromGLB(rifleGLB));
      else addBaked(spec.B.bake(), holder);
      let mag = null, pump = null;
      if (spec.M) { mag = new THREE.Group(); addBaked(spec.M.bake(), mag); holder.add(mag); }
      const arms = armsFor(spec);
      addBaked(arms.right, holder);
      if (spec.P) {
        pump = new THREE.Group();
        pump.position.z = spec.pumpZ;
        addBaked(spec.P.bake(), pump);
        addBaked(arms.left, pump);     // left hand rides the pump
        holder.add(pump);
      } else {
        addBaked(arms.left, holder);
      }
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.012, spec.muzzle);
      holder.add(muzzle);

      const root = new THREE.Group();
      root.add(holder);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.muzzleFlash, color: new THREE.Color(2.6, 2.0, 1.1),
        blending: THREE.AdditiveBlending, transparent: true, depthTest: false,
      }));
      flash.scale.setScalar(0.16);
      flash.position.copy(muzzle.position);
      flash.visible = false;
      flash.renderOrder = 999;
      holder.add(flash);
      const light = new THREE.PointLight(0xffb066, 0, 9, 2);
      light.position.copy(muzzle.position);
      holder.add(light);

      root.visible = i === 0;
      const basePos = {
        rifle: [0.145, -0.16, -0.32], pistol: [0.14, -0.14, -0.42], shotgun: [0.145, -0.155, -0.34],
        smg: [0.14, -0.15, -0.36], dmr: [0.145, -0.16, -0.3], launcher: [0.15, -0.165, -0.36],
      }[key];
      const bp = new THREE.Vector3(...basePos);
      // The bore converges on the crosshair ~9 m out, not at the muzzle:
      // the weapon sits low-right and nearly parallel to the view (the
      // old "muzzle on the crosshair" pose tilted it 15° and put the
      // barrel across the middle of the screen).
      const CONVERGE = 9;
      const tilt0 = Math.atan2(-bp.y - 0.012, CONVERGE) + 0.02;
      const yaw0 = Math.atan2(bp.x, CONVERGE) + 0.025;
      holder.rotation.set(tilt0, yaw0, 0);
      // ADS pose: sight line on the camera axis
      const adsPos = new THREE.Vector3(0, -spec.sightY, key === 'dmr' ? -0.26 : (key === 'pistol' ? -0.32 : -0.3));
      root.position.copy(bp);
      this.camera.add(root);
      this.weapons.push({
        def, key, root, holder, muzzle, flash, light, pump, spec, tilt0, yaw0,
        magMesh: mag, magBase: mag ? mag.position.clone() : null,
        mag: def.mag, reserve: def.reserve,
        basePos: bp, adsPos,
      });
    });
  }

  _fromGLB(gltf) {
    const src = gltf.scene ?? gltf;
    const inner = src.clone(true);
    const b = new THREE.Box3().setFromObject(inner);
    const size = b.getSize(new THREE.Vector3());
    inner.scale.setScalar(0.92 / Math.max(size.x, size.y, size.z, 0.001));
    const orient = new THREE.Group();
    orient.rotation.y = size.x >= Math.max(size.y, size.z) ? -Math.PI / 2 : 0;
    orient.add(inner);
    b.setFromObject(orient);
    const c = b.getCenter(new THREE.Vector3());
    orient.position.set(-c.x, -c.y, -c.z - 0.2);
    inner.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    return orient;
  }

  get w() { return this.weapons[this.current]; }

  /** Effective magazine size / reserve cap with perks. */
  magSize(wp = this.w) { return Math.max(1, Math.round(wp.def.mag * (this.stats?.magMul ?? 1))); }
  reserveCap(wp = this.w) { return Math.round((wp.def.reserveMax ?? 999) * (this.stats?.reserveMul ?? 1)); }

  addReserve(key, amount) {
    for (const wp of this.weapons) {
      if (key && wp.key !== key) continue;
      if (!this.owned.has(wp.key)) continue;
      // launcher rounds are precious: a crate gives a sixth as many
      const n = wp.key === 'launcher' ? Math.ceil(amount / 6) : (wp.key === 'dmr' ? Math.ceil(amount / 2.5) : amount);
      wp.reserve = Math.min(this.reserveCap(wp), wp.reserve + n);
    }
  }

  /** Ammo box: `mags` magazines for every owned weapon (launcher: 1 round
   *  per box, DMR: half a magazine — the heavy hitters stay precious). */
  addMags(mags = 1) {
    for (const wp of this.weapons) {
      if (!this.owned.has(wp.key)) continue;
      const scale = wp.key === 'launcher' ? 1 / 6 : (wp.key === 'dmr' ? 0.5 : 1);
      const n = Math.max(1, Math.round(this.magSize(wp) * mags * scale));
      wp.reserve = Math.min(this.reserveCap(wp), wp.reserve + n);
    }
  }

  /** Top every owned weapon's reserve up to at least `mags` magazines. */
  ensureReserve(mags = 2) {
    for (const wp of this.weapons) {
      if (!this.owned.has(wp.key)) continue;
      const want = Math.min(this.reserveCap(wp), Math.round(this.magSize(wp) * mags * (wp.key === 'launcher' ? 0.5 : 1)));
      if (wp.reserve < want) wp.reserve = want;
    }
  }

  /** Unlock a weapon (crate / ARMORY). Returns its key, or null. */
  unlock(key = null) {
    const locked = WEAPON_ORDER.filter((k) => !this.owned.has(k));
    if (!key) {
      if (!locked.length) return null;
      key = locked[Math.floor(Math.random() * locked.length)];
    }
    if (this.owned.has(key)) return null;
    this.owned.add(key);
    const wp = this.weapons.find((w) => w.key === key);
    wp.mag = this.magSize(wp);
    wp.reserve = wp.def.reserve;
    return key;
  }

  hasLocked() { return WEAPON_ORDER.some((k) => !this.owned.has(k)); }

  reset(full = true) {
    if (full) this.owned = new Set(STARTING_WEAPONS);
    for (const wp of this.weapons) {
      wp.mag = this.magSize(wp);
      wp.reserve = Math.min(this.reserveCap(wp), Math.round(wp.def.reserve * (this.stats?.reserveMul ?? 1)));
    }
    this.current = 0;
    this.weapons.forEach((wp, i) => { wp.root.visible = i === 0; });
    this.reloadT = -1;
    this.switchT = 0;
    this.pendingSwitch = -1;
    this.heat = 0;
    this.spray = 0;
    this.sprayT = 99;
    this.sprayNorm = 0;
    this.ads = 0;
  }

  canFire() {
    return this.reloadT < 0 && this.switchT <= 0 && this.w.mag > 0 && this.fireTimer <= 0;
  }

  /** Consume one shot; returns the weapon def (for raycast params). */
  fire() {
    const wp = this.w;
    wp.mag--;
    this.fireTimer = 60 / wp.def.rpm;
    this.sprayT = 0;
    this.spray = Math.min(this.spray + 1, 60);
    this.sprayNorm = Math.min(this.spray / (wp.def.sprayRamp ?? 8), 1);
    const tn = this.sprayNorm;
    const steady = this.stats?.recoilMul ?? 1;
    const adsK = 1 - this.ads * 0.35;

    this.heat = Math.min(this.heat + wp.def.spreadKick * (0.85 + 0.9 * tn), wp.def.spreadMax);
    this.kickPos = Math.min(this.kickPos + wp.def.kick * 0.045 * (0.6 + 0.7 * tn) * steady * adsK, 0.14 + 0.09 * tn);
    this.kickRot = Math.min(this.kickRot + wp.def.kick * 0.055 * (0.6 + 0.7 * tn) * steady * adsK, 0.16 + 0.14 * tn);

    this.flashT = 0.05;
    wp.flash.visible = true;
    wp.flash.material.rotation = rand(0, Math.PI * 2);
    wp.flash.scale.setScalar(rand(0.13, 0.19) * (wp.def.kick * 0.55 + 0.55) * (wp.key === 'smg' ? 0.6 : 1));
    wp.light.intensity = 16 + wp.def.kick * 8;

    wp.muzzle.getWorldPosition(_mp);
    this.camera.getWorldDirection(_fw);
    this.particles.muzzleSmoke(_mp.x, _mp.y, _mp.z, _fw.x, _fw.y, _fw.z);
    this.particles.sparkBurst(_mp.x, _mp.y, _mp.z, _fw.x, _fw.y, _fw.z, 3);
    if (wp.key !== 'launcher') {
      _rt.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.particles.shellCasing(_mp.x, _mp.y - 0.05, _mp.z, _rt.x, 2.2, _rt.z);
    }
    this.audio.play(wp.def.sound, { volume: 1, variant: true });
    if (wp.mag <= Math.ceil(this.magSize(wp) * 0.2) && wp.mag > 0) this.audio.play('lowAmmo', { volume: 0.35 });
    return wp.def;
  }

  reloadTimeFor(wp) {
    return wp.def.reloadTime * (this.stats?.reloadMul ?? 1) * (this.buffHaste ? 0.6 : 1);
  }

  startReload() {
    const wp = this.w;
    if (this.reloadT >= 0 || wp.mag >= this.magSize(wp) || wp.reserve <= 0) return false;
    this.reloadT = 0;
    this.reloadDur = this.reloadTimeFor(wp);
    this.reloadSwapped = false;
    this.audio.play('reload', { volume: 0.8 });
    return true;
  }

  switchTo(i) {
    if (i === this.current || i < 0 || i >= this.weapons.length || this.switchT > 0) return false;
    if (!this.owned.has(this.weapons[i].key)) return false;
    this.pendingSwitch = i;
    this.switchDur = 0.5 * (this.stats?.reloadMul ?? 1);
    this.switchT = this.switchDur;
    this.reloadT = -1;
    this.audio.play('switch', { volume: 0.6 });
    return true;
  }

  /** Mouse wheel: next / previous OWNED weapon. */
  cycle(dir) {
    const n = this.weapons.length;
    for (let k = 1; k < n; k++) {
      const i = (this.current + dir * k + n * 2) % n;
      if (this.owned.has(this.weapons[i].key)) return this.switchTo(i);
    }
    return false;
  }

  /** ctx = { hSpeed, sprinting, crouching, grounded } */
  update(dt, ctx) {
    this.time += dt;
    const wp = this.w;
    if (this.fireTimer > 0) this.fireTimer -= dt;

    this.sprayT += dt;
    if (this.sprayT > RECOIL.resetAfter) {
      this.heat = damp(this.heat, 0, 4.5, dt);
      this.spray = damp(this.spray, 0, RECOIL.coolRate, dt);
      if (this.spray < 0.05) this.spray = 0;
    }
    this.sprayNorm = Math.min(this.spray / (wp.def.sprayRamp ?? 8), 1);

    // aim down sights (not while sprinting / reloading / switching)
    const canAds = this.wantAds && !ctx.sprinting && this.switchT <= 0;
    this.ads = damp(this.ads, canAds ? 1 : 0, ADS.inTime, dt);
    if (this.ads < 0.002) this.ads = 0;

    // reload: magazine drops out, a fresh one goes in, rounds move
    let magDrop = 0;
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const r = this.reloadT / this.reloadDur;
      magDrop = r < 0.15 ? r / 0.15 : (r < 0.45 ? 1 : (r < 0.62 ? 1 - (r - 0.45) / 0.17 : 0));
      if (!this.reloadSwapped && r > 0.5) {
        this.reloadSwapped = true;
        const take = Math.min(this.magSize(wp) - wp.mag, wp.reserve);
        wp.mag += take;
        wp.reserve -= take;
        this.audio.play('reloadIn', { volume: 0.7 });
      }
      if (this.reloadT >= this.reloadDur) this.reloadT = -1;
    }
    if (wp.magMesh && wp.magBase) {
      if (wp.spec.spinMag) wp.magMesh.rotation.z = magDrop * Math.PI * 2;
      else wp.magMesh.position.set(wp.magBase.x, wp.magBase.y - magDrop * 0.28, wp.magBase.z + magDrop * 0.05);
      wp.magMesh.visible = !(magDrop > 0.9 && !wp.spec.spinMag);
    }

    let switchDip = 0;
    if (this.switchT > 0) {
      this.switchT -= dt;
      const t = 1 - Math.abs(this.switchT / this.switchDur - 0.5) * 2;
      switchDip = t;
      if (this.switchT <= 0 && this.pendingSwitch >= 0) {
        this.weapons[this.current].root.visible = false;
        this.current = this.pendingSwitch;
        this.pendingSwitch = -1;
        this.weapons[this.current].root.visible = true;
        switchDip = 0;
      }
    }

    this.kickPos = damp(this.kickPos, 0, 11, dt);
    this.kickRot = damp(this.kickRot, 0, 10, dt);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) wp.flash.visible = false;
    }
    if (wp.light.intensity > 0.05) wp.light.intensity *= Math.exp(-dt * 36);
    else wp.light.intensity = 0;

    const moving = ctx.hSpeed > 0.5 && ctx.grounded;
    const speedNorm = Math.min(ctx.hSpeed / 5.7, 1);
    this.sprintAmt = damp(this.sprintAmt, ctx.sprinting && moving ? 1 : 0, 9, dt);
    this.bobT += dt * (4 + speedNorm * 9);
    const a = this.ads;
    const hip = 1 - a;
    const idleBreath = Math.sin(this.time * 1.7) * 0.004 * (1 - a * 0.8);
    const bobAmp = ((0.008 + speedNorm * 0.02) * (1 - this.sprintAmt * 0.4) + this.sprintAmt * 0.014) * (1 - a * 0.85);
    const bobX = Math.cos(this.bobT) * bobAmp;
    const bobY = -Math.abs(Math.sin(this.bobT)) * bobAmp * 0.9;

    let reloadDip = 0, reloadTilt = 0, pumpSlide = 0;
    if (this.reloadT >= 0) {
      const r = this.reloadT / this.reloadDur;
      reloadDip = Math.sin(Math.min(r * 2, 1) * Math.PI / 2) * (r < 0.85 ? 1 : (1 - r) / 0.15) * 0.06;
      reloadTilt = Math.sin(r * Math.PI) * 0.45;
      pumpSlide = Math.sin(r * Math.PI * 3) * 0.05;
    }
    // shotgun: rack the pump after each shot
    if (wp.pump && this.fireTimer > 0) {
      const k = 1 - this.fireTimer / (60 / wp.def.rpm);
      if (k > 0.25 && k < 0.85) pumpSlide = Math.sin((k - 0.25) / 0.6 * Math.PI) * 0.07;
    }
    const crouchSway = ctx.crouching ? 0.012 * hip : 0;
    const bp = wp.basePos, ap = wp.adsPos;
    _tp.set(
      bp.x * hip + ap.x * a + bobX * (moving ? 1 : 0) + this.sprintAmt * 0.03,
      bp.y * hip + ap.y * a + bobY * (moving ? 1 : 0) + idleBreath - switchDip * 0.25 - reloadDip - crouchSway,
      bp.z * hip + ap.z * a + this.kickPos * (1 - a * 0.5) + this.sprintAmt * 0.06,
    );
    wp.root.position.lerp(_tp, 1 - Math.exp(-20 * dt));
    wp.holder.rotation.x = wp.tilt0 * hip;
    wp.holder.rotation.y = wp.yaw0 * hip;
    wp.root.rotation.x = damp(wp.root.rotation.x, -this.kickRot * (1 - a * 0.5) + reloadTilt + this.sprintAmt * 0.12, 16, dt);
    wp.root.rotation.y = damp(wp.root.rotation.y, this.sprintAmt * 0.55, 10, dt);
    wp.root.rotation.z = damp(wp.root.rotation.z, this.sprintAmt * 0.28 + (moving ? Math.sin(this.bobT) * 0.01 * hip : 0) + reloadTilt * 0.4, 10, dt);
    if (wp.pump) wp.pump.position.z = wp.spec.pumpZ + pumpSlide;
    // a full scope hides the viewmodel (HUD draws the reticle)
    const cur = this.w;                 // may differ from wp on the swap frame
    if (cur !== wp) wp.root.visible = false;
    cur.root.visible = !(cur.def.scope && a > 0.92);
  }

  /** Current spread in radians including heat, movement, ADS, perks. */
  currentSpread(ctx) {
    const wp = this.w;
    let s = wp.def.spreadBase + this.heat;
    if (ctx.sprinting) s += 0.012;
    if (!ctx.grounded) s += 0.02;
    if (ctx.hSpeed > 0.5) s += ctx.hSpeed * 0.0016;
    if (ctx.crouching) s *= 0.65;
    s *= 1 - this.ads * (1 - ADS.spreadMul);
    return s * (this.stats?.spreadMul ?? 1);
  }

  /** FOV zoom factor for the current ADS amount. */
  zoom() {
    const z = this.w.def.adsZoom ?? ADS.fovDefaultZoom;
    return 1 + (z - 1) * this.ads;
  }
}
