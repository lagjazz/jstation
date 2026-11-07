// ============================================================
// audioManager.js — Web Audio API sound system.
//  • One shared AudioContext (THREE's singleton) + AudioListener.
//  • Every SFX is synthetically generated at boot, so the game is
//    fully voiced with zero audio files. Optional drop-in files in
//    assets/audio/ override the synth (see ASSETS.audio).
//  • 3D positional audio (train / store / PA / enemies) via
//    THREE.PositionalAudio; 2D sounds via THREE.Audio.
//  • Japanese station announcements via SpeechSynthesis with a
//    chime fallback.
//  • Gunshots are LAYERED syntheses (transient crack, chamber body,
//    pitch-dropping thump, bolt/action click, environment tail) with
//    several random variants per weapon so full-auto never sounds like
//    one sample on repeat.
//  • Everything goes through a reverb bus whose impulse response is
//    regenerated per world (tiled hall, stone tomb, open sky, metal
//    corridor, underwater…), and a procedural adaptive score
//    (music.js) runs on its own bus.
// ============================================================

import * as THREE from 'three';
import { ASSETS, ASSET_PATH } from './config.js';
import { rand } from './utils.js';
import { Music } from './music.js';

const TAU = Math.PI * 2;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.listener = null;
    this.buffers = new Map();
    this.positionals = new Map();
    this.loops = new Map();
    this._playPool = new Map();    // reused THREE.Audio one-shots per SFX name
    this._variants = new Map();    // name → number of '#k' variants
    this.masterVolume = 0.9;
    this.muted = false;
    this.ready = false;
    this.jaVoice = null;
  }

  /** Everything except starting the context. Called during loading: the
   *  synthesis below is tens of thousands of samples generated in JS and the
   *  external files need a fetch + decode, which is a multi-hundred-ms burst.
   *  Doing it on the start click is why the first seconds of play stutter —
   *  a context may be created before a gesture; it just starts suspended. */
  async prepare() {
    if (this.ready) return;
    this.ctx = THREE.AudioContext.getContext();
    this.listener = new THREE.AudioListener();
    this.masterGain = this.listener.getInput();
    this.masterGain.gain.value = this.masterVolume;

    this._buildBus();
    this._synthesizeAll();
    this._synthExtras();
    await this._tryExternalFiles();
    this._pickJaVoice();

    this.ready = true;
  }

  /** listener.gain → dry + convolver(wet) → destination; music bypasses reverb. */
  _buildBus() {
    const ctx = this.ctx;
    const src = this.listener.gain;
    try { src.disconnect(); } catch { /* not connected yet */ }
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.22;
    this.convolver = ctx.createConvolver();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    src.connect(this.dry);
    src.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.dry.connect(this.limiter);
    this.wet.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.connect(ctx.destination);
    this.music = new Music(ctx, this.musicGain);
    this._irCache = new Map();
    // every world's impulse response is generated now, during loading —
    // arming a mission never pays for it
    for (const a of ['hall', 'platform', 'garden', 'cyber', 'moon', 'tomb', 'skyport', 'lab',
      'atlantis', 'ice', 'orbit', 'canopy', 'canyon', 'aquarium', 'clockwork']) this.setEnvironment(a);
    this.setEnvironment('hall');
  }

  /** Per-world acoustics: impulse-response length / brightness / wet mix. */
  setEnvironment(area) {
    if (!this.convolver) return;
    const P = {
      hall: [1.8, 0.35, 0.24], platform: [1.1, 0.5, 0.16], garden: [0.7, 0.6, 0.1],
      cyber: [1.2, 0.45, 0.18], moon: [1.6, 0.3, 0.2], tomb: [2.8, 0.22, 0.32],
      skyport: [0.6, 0.7, 0.08], lab: [1.9, 0.4, 0.26], atlantis: [2.2, 0.08, 0.36],
      ice: [0.9, 0.55, 0.12], orbit: [1.4, 0.35, 0.18], canopy: [0.8, 0.5, 0.12],
      canyon: [1.7, 0.4, 0.2], aquarium: [2.4, 0.1, 0.34], clockwork: [2.0, 0.3, 0.26],
    }[area] ?? [1.2, 0.4, 0.18];
    const key = P.join('|');
    let ir = this._irCache.get(key);
    if (!ir) { ir = this._makeIR(P[0], P[1]); this._irCache.set(key, ir); }
    this.convolver.buffer = ir;
    this.wet.gain.setTargetAtTime(P[2], this.ctx.currentTime, 0.3);
    this.music?.setArea(area);
  }

  /** Stereo exponentially-decaying filtered noise (+ early reflections). */
  _makeIR(seconds, bright) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(2, len, rate);
    const alpha = 0.05 + bright * 0.8;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      const early = [0.011, 0.019, 0.027, 0.041, 0.053].map((t) => Math.floor((t + ch * 0.003) * rate));
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        lp += (Math.random() * 2 - 1 - lp) * alpha * Math.exp(-t * 1.5);
        d[i] = lp * Math.exp(-t * (6.9 / seconds)) * (t < 0.006 ? t / 0.006 : 1);
      }
      for (const e of early) if (e < len) d[e] += (Math.random() < 0.5 ? -1 : 1) * 0.5;
    }
    return buf;
  }

  /** Called from the start click: the graph is already built, so the only thing
   *  left is the gesture-gated resume. */
  async init() {
    await this.prepare();
    await this.ctx.resume();
  }

  // ------------------------------------------------ synthesis

  _createBuffer(seconds, fn) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(2, Math.floor(seconds * rate));
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = fn(i / rate, i);
    return buf;
  }

  /** Crossfade the tail into the head so the buffer loops seamlessly. */
  _makeLoopable(buf, fadeSec = 0.15) {
    const d = buf.getChannelData(0);
    const n = Math.floor(this.ctx.sampleRate * fadeSec);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = d[i] * t + d[d.length - n + i] * (1 - t);
      d[d.length - n + i] *= t;
    }
    return buf;
  }

  _synthesizeAll() {
    const B = this.buffers;
    let lp = 0;   // one-pole lowpass state per generator (fresh each call)

    const noise = () => Math.random() * 2 - 1;
    const lpNoise = (dt, alpha) => { lp += (noise() - lp) * alpha; return lp * (1 - alpha); };

    this._synthGuns(B, noise);

    B.set('impactMetal', this._createBuffer(0.32, (t) => {
      lp = 0;
      const ping = Math.sin(TAU * 1900 * t) * Math.exp(-t * 16) * 0.5;
      const ping2 = Math.sin(TAU * 2650 * t) * Math.exp(-t * 24) * 0.3;
      const tick = (noise() - lpNoise(0, 0.5)) * Math.exp(-t * 34) * 0.5;
      return ping + ping2 + tick;
    }));

    B.set('impactConcrete', this._createBuffer(0.2, (t) => {
      lp = 0;
      const thud = lpNoise(0, 0.12) * Math.exp(-t * 24) * 1.4;
      const grit = noise() * Math.exp(-t * 42) * 0.28;
      return thud + grit;
    }));

    B.set('impactWood', this._createBuffer(0.16, (t) => {
      lp = 0;
      const knock = Math.sin(TAU * (300 + rand(-40, 40)) * t) * Math.exp(-t * 28) * 0.55;
      const knock2 = Math.sin(TAU * (620 + rand(-60, 60)) * t) * Math.exp(-t * 36) * 0.25;
      const fib = noise() * Math.exp(-t * 45) * 0.2;
      return knock + knock2 + fib;
    }));

    B.set('impactGlass', (() => {
      const twinkles = Array.from({ length: 7 }, () => ({
        t0: rand(0.005, 0.28), f: rand(2100, 6200), a: rand(0.12, 0.3),
      }));
      return this._createBuffer(0.6, (t) => {
        lp = 0;
        let s = (noise() - lpNoise(0, 0.4)) * Math.exp(-t * 12) * 0.55;
        s += lpNoise(0, 0.1) * Math.exp(-t * 18) * 0.8;
        for (const tw of twinkles) {
          if (t > tw.t0) s += Math.sin(TAU * tw.f * (t - tw.t0)) * Math.exp(-(t - tw.t0) * 13) * tw.a;
        }
        return s;
      });
    })());

    B.set('footstep', this._createBuffer(0.08, (t) => {
      lp = 0;
      return lpNoise(0, 0.25) * Math.exp(-t * 50) * 1.1;
    }));

    B.set('land', this._createBuffer(0.16, (t) => {
      lp = 0;
      return lpNoise(0, 0.1) * Math.exp(-t * 22) * 1.3;
    }));

    B.set('reload', this._createBuffer(0.3, (t) => {
      lp = 0;
      const c1 = t > 0.03 && t < 0.1 ? (noise() - lpNoise(0, 0.55)) * 0.8 : 0;
      const c2 = t > 0.18 && t < 0.27 ? (noise() - lpNoise(0, 0.5)) * 0.9 : 0;
      return (c1 + c2) * Math.exp(-Math.abs(t - (t < 0.14 ? 0.03 : 0.18)) * 30) + 0;
    }));

    B.set('switch', this._createBuffer(0.12, (t) => {
      lp = 0;
      return t < 0.05 ? (noise() - lpNoise(0, 0.5)) * Math.exp(-t * 40) * 0.9 : 0;
    }));

    // EMP pulse (quantum lab) — descending zap sweep + crackle + thump
    B.set('emp', this._createBuffer(0.8, (t) => {
      lp = 0;
      const f = 1500 - 1150 * Math.min(1, t / 0.55);
      const sweep = Math.sin(TAU * f * t) * Math.exp(-t * 3.6) * 0.5;
      const zap = noise() * (t < 0.03 ? 2.2 : Math.exp(-(t - 0.03) * 7)) * 0.5;
      const thump = lpNoise(0, 0.05) * Math.exp(-t * 6) * 1.1;
      return (sweep + zap + thump) * 0.6;
    }));

    // ammo crate pickup — crisp two-step brass blip
    B.set('pickup', (() => {
      return this._createBuffer(0.3, (t) => {
        const n1 = t < 0.12 ? Math.sin(TAU * 740 * t) : 0;
        const n2 = t >= 0.1 ? Math.sin(TAU * 1110 * (t - 0.1)) * Math.exp(-(t - 0.1) * 14) : 0;
        return (n1 * Math.exp(-t * 12) + n2) * 0.5;
      });
    })());

    // medkit pickup — soft ascending medical chime
    B.set('medkit', (() => {
      const notes = [523.25, 659.25, 783.99];
      return this._createBuffer(0.55, (t) => {
        let s = 0;
        for (let i = 0; i < notes.length; i++) {
          const tt = t - i * 0.11;
          if (tt >= 0) s += Math.sin(TAU * notes[i] * tt) * Math.exp(-tt * 9) * 0.4;
        }
        return s;
      });
    })());

    B.set('hitMarker', this._createBuffer(0.1, (t) =>
      Math.sin(TAU * 1350 * t) * Math.exp(-t * 42) * 0.45));

    B.set('headshot', this._createBuffer(0.26, (t) => {
      const f = t < 0.09 ? 1500 : 2300;
      return Math.sin(TAU * f * t) * Math.exp(-t * (t < 0.09 ? 20 : 14)) * 0.5;
    }));

    B.set('enemyGrunt', this._createBuffer(0.26, (t) => {
      const f = 165 - 300 * t;
      const g = Math.sin(TAU * Math.max(60, f) * t) * Math.exp(-t * 11) * 0.5;
      lp = 0;
      return g + lpNoise(0, 0.2) * Math.exp(-t * 20) * 0.2;
    }));

    B.set('enemyDeath', (() => {
      lp = 0;
      return this._createBuffer(0.55, (t) => {
        const f = 160 - 180 * t;
        const g = Math.sin(TAU * Math.max(55, f) * t) * Math.exp(-t * 6.5) * 0.5;
        const thud = t > 0.14 ? lpNoise(0, 0.09) * Math.exp(-(t - 0.14) * 12) * 1.2 : 0;
        return g + thud;
      });
    })());

    B.set('hurt', this._createBuffer(0.3, (t) => {
      lp = 0;
      return lpNoise(0, 0.08) * Math.exp(-t * 14) * 1.2 + Math.sin(TAU * 88 * t) * Math.exp(-t * 10) * 0.5;
    }));

    B.set('chime', (() => {
      const notes = [659.25, 783.99, 880.0, 1046.5];
      return this._createBuffer(1.7, (t) => {
        let s = 0;
        notes.forEach((f, i) => {
          const t0 = i * 0.28;
          if (t > t0) {
            const dt = t - t0;
            const env = Math.min(1, dt / 0.012) * Math.exp(-dt * 3.2);
            s += (Math.sin(TAU * f * dt) + 0.35 * Math.sin(TAU * f * 2 * dt)) * env * 0.22;
          }
        });
        return s;
      });
    })());

    B.set('trainBrake', (() => {
      const ph = rand(0, TAU);
      return this._createBuffer(1.5, (t) => {
        const f = 640 - 300 * Math.min(1, t / 1.1);
        const env = Math.min(1, t / 0.25) * Math.max(0, 1 - t / 1.35);
        const wobble = 1 + 0.06 * Math.sin(TAU * 5.5 * t + ph);
        lp = 0;
        const screech = (Math.sin(TAU * f * wobble * t) * 0.6 + (noise() - lpNoise(0, 0.35)) * 0.5) * env * 0.2;
        return screech;
      });
    })());

    B.set('victory', (() => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      return this._createBuffer(1.5, (t) => {
        let s = 0;
        notes.forEach((f, i) => {
          const t0 = i * 0.17;
          if (t > t0) {
            const dt = t - t0;
            const env = Math.min(1, dt / 0.02) * Math.exp(-dt * 2.4);
            s += (Math.sin(TAU * f * dt) + 0.4 * Math.sin(TAU * f * 1.5 * dt)) * env * 0.16;
          }
        });
        return s;
      });
    })());

    B.set('trainRumble', this._makeLoopable(this._createBuffer(4.0, (t) => {
      lp = 0;
      const brown = lpNoise(0, 0.015);
      const am = 0.72 + 0.18 * Math.sin(TAU * 0.5 * t) + 0.1 * Math.sin(TAU * 0.75 * t + 1.3);
      const clack = Math.max(0, Math.sin(TAU * 2 * t)) ** 8 * 0.25;
      return (brown * 2.4 * am + clack * noise()) * 0.4;
    }), 0.25));

    B.set('ambient', this._makeLoopable(this._createBuffer(6.0, (t) => {
      lp = 0;
      const hush = lpNoise(0, 0.03) * 0.5;
      const hum = Math.sin(TAU * 50 * t) * 0.05 + Math.sin(TAU * 100 * t) * 0.03;
      const am = 0.8 + 0.2 * Math.sin(TAU * (1 / 6) * t * 2);
      return (hush * am + hum) * 0.5;
    }), 0.3));

    B.set('storeHum', this._makeLoopable(this._createBuffer(5.0, (t) => {
      lp = 0;
      const hush = lpNoise(0, 0.06) * 0.4;
      const hum = Math.sin(TAU * 120 * t) * 0.04;
      const voices = Math.max(0, Math.sin(TAU * 0.4 * t)) * lpNoise(0, 0.15) * 0.5;
      return (hush + hum + voices * 0.3) * 0.35;
    }), 0.25));
  }


  /**
   * Layered firearm synthesis. Each call writes N random variants
   * `${name}#k` (and `${name}` = variant 0 for code that asks directly).
   * p: { len, crack, crackK, body, bodyK, bodyA, thump, thumpF, thumpK,
   *      mech, mechT, tail, tailK, tailA, drive, n }
   */
  _gun(B, name, p, noise) {
    const n = p.n ?? 3;
    for (let k = 0; k < n; k++) {
      const jit = (v, a = 0.12) => v * (1 + rand(-a, a));
      const crackK = jit(p.crackK), bodyK = jit(p.bodyK), thumpF = jit(p.thumpF, 0.08);
      const tailK = jit(p.tailK), mechT = jit(p.mechT ?? 0.05, 0.2);
      let lpA = 0, lpB = 0, lpC = 0, hpS = 0;
      const ringF = rand(2600, 3600);
      const buf = this._createBuffer(p.len, (t) => {
        const w = noise();
        hpS += (w - hpS) * 0.6;
        const hp = w - hpS;
        lpA += (w - lpA) * (p.bodyA ?? 0.12);
        lpB += (w - lpB) * (p.tailA ?? 0.02);
        // transient: first ~3 ms is a hard broadband spike
        const crack = hp * Math.exp(-t * crackK) * (t < 0.003 ? 3 : 1) * p.crack;
        const body = lpA * Math.exp(-t * bodyK) * p.body * 2.2;
        const tf = thumpF * (1 + 2.2 * Math.exp(-t * 38));
        const thump = Math.sin(6.2832 * tf * t) * Math.exp(-t * p.thumpK) * p.thump;
        let mech = 0;
        if (p.mech && t > mechT && t < mechT + 0.03) {
          const u = t - mechT;
          lpC += (w - lpC) * 0.5;
          mech = ((w - lpC) * Math.exp(-u * 180) + Math.sin(6.2832 * ringF * u) * Math.exp(-u * 90) * 0.6) * p.mech;
        }
        const tail = lpB * Math.exp(-t * tailK) * p.tail * 4;
        const slap = t > 0.085 ? lpB * Math.exp(-(t - 0.085) * tailK * 1.4) * p.tail * 1.6 : 0;
        const x = (crack + body + thump + mech + tail + slap) * (p.drive ?? 1.4);
        return Math.tanh(x) * 0.8;
      });
      B.set(`${name}#${k}`, buf);
      if (k === 0) B.set(name, buf);
    }
    this._variants.set(name, n);
  }

  _synthGuns(B, noise) {
    const G = (name, p) => this._gun(B, name, p, noise);
    G('shotRifle',   { len: 0.55, crack: 1.0, crackK: 34, body: 0.9, bodyK: 16, bodyA: 0.14, thump: 0.9, thumpF: 72, thumpK: 14, mech: 0.35, mechT: 0.045, tail: 0.5, tailK: 6.5, tailA: 0.03 });
    G('shotPistol',  { len: 0.42, crack: 1.1, crackK: 44, body: 0.7, bodyK: 22, bodyA: 0.18, thump: 0.6, thumpF: 95, thumpK: 18, mech: 0.45, mechT: 0.035, tail: 0.38, tailK: 8, tailA: 0.035 });
    G('shotShotgun', { len: 0.8, crack: 1.0, crackK: 22, body: 1.3, bodyK: 9, bodyA: 0.09, thump: 1.3, thumpF: 52, thumpK: 9, mech: 0, tail: 0.75, tailK: 4.2, tailA: 0.025, drive: 1.7 });
    G('shotSmg',     { len: 0.34, crack: 0.75, crackK: 52, body: 0.6, bodyK: 26, bodyA: 0.22, thump: 0.45, thumpF: 110, thumpK: 24, mech: 0.5, mechT: 0.028, tail: 0.25, tailK: 10, tailA: 0.04, n: 4 });
    G('shotDmr',     { len: 0.9, crack: 1.3, crackK: 26, body: 1.1, bodyK: 12, bodyA: 0.11, thump: 1.2, thumpF: 60, thumpK: 10, mech: 0.4, mechT: 0.06, tail: 0.85, tailK: 3.8, tailA: 0.025, drive: 1.8 });
    G('shotLauncher',{ len: 0.6, crack: 0.3, crackK: 30, body: 1.0, bodyK: 10, bodyA: 0.05, thump: 1.4, thumpF: 48, thumpK: 11, mech: 0.6, mechT: 0.1, tail: 0.3, tailK: 7, tailA: 0.02 });
    // hostile weapons: same recipe, duller crack (they're further away)
    G('enemyShot',    { len: 0.5, crack: 0.55, crackK: 36, body: 0.85, bodyK: 15, bodyA: 0.1, thump: 0.7, thumpF: 78, thumpK: 15, mech: 0.15, tail: 0.5, tailK: 6, tailA: 0.025, n: 3 });
    G('enemyPistol',  { len: 0.4, crack: 0.6, crackK: 46, body: 0.6, bodyK: 22, bodyA: 0.14, thump: 0.5, thumpF: 100, thumpK: 18, mech: 0.2, tail: 0.35, tailK: 8, tailA: 0.03, n: 2 });
    G('enemyShotgun', { len: 0.7, crack: 0.6, crackK: 24, body: 1.2, bodyK: 9, bodyA: 0.08, thump: 1.1, thumpF: 55, thumpK: 9, mech: 0, tail: 0.6, tailK: 4.5, tailA: 0.022, n: 2, drive: 1.6 });
    G('enemySniper',  { len: 1.0, crack: 1.0, crackK: 22, body: 0.9, bodyK: 11, bodyA: 0.1, thump: 1.0, thumpF: 58, thumpK: 9, mech: 0.3, mechT: 0.3, tail: 0.95, tailK: 3, tailA: 0.022, n: 2, drive: 1.8 });
    G('enemyHeavy',   { len: 0.45, crack: 0.65, crackK: 34, body: 1.0, bodyK: 14, bodyA: 0.09, thump: 0.95, thumpF: 64, thumpK: 14, mech: 0.1, tail: 0.45, tailK: 6, tailA: 0.025, n: 3, drive: 1.6 });
    G('enemyLauncher',{ len: 0.5, crack: 0.2, crackK: 30, body: 0.8, bodyK: 10, bodyA: 0.05, thump: 1.3, thumpF: 45, thumpK: 10, mech: 0.4, mechT: 0.09, tail: 0.25, tailK: 7, tailA: 0.02, n: 2 });
    let lp = 0;
    const lpN = (a) => { lp += (noise() - lp) * a; return lp; };
    B.set('enemyFlame', this._createBuffer(0.7, (t) => {
      const env = Math.min(1, t / 0.04) * Math.exp(-t * 3.5);
      return (lpN(0.18) * 1.6 + (noise() - lp) * 0.25) * env * 0.7;
    }));
    B.set('enemyZap', this._createBuffer(0.22, (t) => {
      const f = 1800 - 4000 * t;
      return (Math.sin(6.2832 * Math.max(200, f) * t) * 0.5 + noise() * 0.25) * Math.exp(-t * 18) * 0.6;
    }));
  }

  _synthExtras() {
    const B = this.buffers;
    const TAU2 = Math.PI * 2;
    const noise = () => Math.random() * 2 - 1;
    let lp = 0, lp2 = 0;
    const lpN = (a) => { lp += (noise() - lp) * a; return lp; };
    const lpN2 = (a) => { lp2 += (noise() - lp2) * a; return lp2; };

    // explosion: crack + long rumbling body + sub drop + debris rattle
    for (let k = 0; k < 3; k++) {
      const subF = rand(38, 50);
      lp = 0; lp2 = 0;
      const buf = this._createBuffer(2.2, (t) => {
        const crack = noise() * Math.exp(-t * 30) * (t < 0.006 ? 2.5 : 1) * 0.8;
        const body = lpN(0.06) * Math.exp(-t * 3.2) * 3.2;
        const sub = Math.sin(TAU2 * subF * (1 + 1.5 * Math.exp(-t * 8)) * t) * Math.exp(-t * 3.5) * 1.1;
        const debris = t > 0.15 ? (noise() - lpN2(0.5)) * Math.max(0, Math.sin(t * 90 + k)) ** 6 * Math.exp(-(t - 0.15) * 3) * 0.5 : 0;
        return Math.tanh((crack + body + sub + debris) * 1.6) * 0.9;
      });
      B.set(`explosion#${k}`, buf);
      if (!k) B.set('explosion', buf);
    }
    this._variants.set('explosion', 3);

    B.set('grenadeBounce', this._createBuffer(0.18, (t) =>
      (Math.sin(TAU2 * 1450 * t) * 0.4 + Math.sin(TAU2 * 2310 * t) * 0.25 + noise() * 0.2 * Math.exp(-t * 80)) * Math.exp(-t * 26)));
    B.set('whiz', this._createBuffer(0.28, (t) => {
      const env = Math.sin(Math.PI * Math.min(1, t / 0.28)) ** 2;
      lp += (noise() - lp) * (0.35 - t);
      return (noise() - lp) * env * 0.55;
    }));
    B.set('shieldHit', this._createBuffer(0.3, (t) =>
      (Math.sin(TAU2 * 820 * t) * 0.5 + Math.sin(TAU2 * 1630 * t) * 0.3 + noise() * Math.exp(-t * 90) * 0.5) * Math.exp(-t * 14)));
    B.set('droneDie', this._createBuffer(0.9, (t) => {
      const f = 900 * Math.exp(-t * 2.5) + 60;
      return (Math.sin(TAU2 * f * t) * 0.35 + lpN(0.2) * 0.4) * Math.exp(-t * 2.4);
    }));
    B.set('levelUp', this._createBuffer(0.9, (t) => {
      let s = 0;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        const u = t - i * 0.07;
        if (u > 0) s += (Math.sin(TAU2 * f * u) + 0.3 * Math.sin(TAU2 * f * 2 * u)) * Math.exp(-u * 5) * 0.16;
      });
      return s;
    }));
    B.set('intel', this._createBuffer(0.5, (t) => {
      const f = t < 0.12 ? 880 : 1320;
      return Math.sin(TAU2 * f * t) * Math.exp(-t * 7) * 0.4 + Math.sin(TAU2 * 2640 * t) * Math.exp(-t * 20) * 0.1;
    }));
    B.set('objective', this._createBuffer(1.3, (t) => {
      let s = 0;
      [392, 523.25, 659.25, 783.99].forEach((f, i) => {
        const u = t - i * 0.12;
        if (u > 0) s += (Math.sin(TAU2 * f * u) + 0.5 * Math.sin(TAU2 * f * 1.5 * u)) * Math.min(1, u / 0.02) * Math.exp(-u * 2.6) * 0.14;
      });
      return s;
    }));
    B.set('fail', this._createBuffer(1.4, (t) => {
      let s = 0;
      [392, 349.2, 293.7].forEach((f, i) => {
        const u = t - i * 0.25;
        if (u > 0) s += Math.sin(TAU2 * f * u) * (1 + 0.3 * Math.sin(TAU2 * 5 * u)) * Math.exp(-u * 2.2) * 0.2;
      });
      return s;
    }));
    B.set('powerup', this._createBuffer(0.6, (t) => {
      const f = 300 + 1500 * t;
      return Math.sin(TAU2 * f * t) * Math.exp(-t * 4) * 0.35 + Math.sin(TAU2 * f * 1.5 * t) * Math.exp(-t * 6) * 0.15;
    }));
    B.set('armorPickup', this._createBuffer(0.35, (t) => {
      lp = 0;
      const rip = t < 0.12 ? (noise() - lpN(0.4)) * Math.max(0, Math.sin(t * 600)) * 0.6 : 0;
      const clank = t > 0.15 ? Math.sin(TAU2 * 640 * (t - 0.15)) * Math.exp(-(t - 0.15) * 22) * 0.4 : 0;
      return rip + clank;
    }));
    B.set('weaponPickup', this._createBuffer(0.45, (t) => {
      const c1 = t > 0.02 && t < 0.07 ? noise() * Math.exp(-(t - 0.02) * 90) * 0.9 : 0;
      const c2 = t > 0.22 && t < 0.3 ? noise() * Math.exp(-(t - 0.22) * 70) * 0.9 : 0;
      const ring = t > 0.22 ? Math.sin(TAU2 * 2200 * (t - 0.22)) * Math.exp(-(t - 0.22) * 30) * 0.25 : 0;
      return c1 + c2 + ring;
    }));
    B.set('enemyReload', this._createBuffer(0.4, (t) => {
      const c1 = t < 0.04 ? noise() * Math.exp(-t * 80) * 0.6 : 0;
      const c2 = t > 0.25 && t < 0.3 ? noise() * Math.exp(-(t - 0.25) * 90) * 0.7 : 0;
      return c1 + c2;
    }));
    B.set('reloadIn', this._createBuffer(0.12, (t) =>
      (noise() * Math.exp(-t * 70) * 0.7 + Math.sin(TAU2 * 1700 * t) * Math.exp(-t * 60) * 0.25)));
    B.set('lowAmmo', this._createBuffer(0.06, (t) => Math.sin(TAU2 * 2400 * t) * Math.exp(-t * 90) * 0.4));
    B.set('dryFire', this._createBuffer(0.08, (t) => noise() * Math.exp(-t * 120) * 0.5 + Math.sin(TAU2 * 3000 * t) * Math.exp(-t * 150) * 0.2));
    B.set('heartbeat', this._createBuffer(0.7, (t) => {
      const b1 = Math.sin(TAU2 * 55 * t) * Math.exp(-t * 18);
      const u = t - 0.22;
      const b2 = u > 0 ? Math.sin(TAU2 * 50 * u) * Math.exp(-u * 16) * 0.8 : 0;
      return (b1 + b2) * 0.7;
    }));
    B.set('thunder', this._createBuffer(3.2, (t) => {
      const env = Math.min(1, t / 0.08) * Math.exp(-t * 1.1);
      const crackle = Math.max(0, Math.sin(t * 23 + Math.sin(t * 7) * 3)) ** 3;
      return lpN(0.025) * env * (2.5 + crackle * 2) * 0.8;
    }));
    B.set('ventHiss', this._createBuffer(1.0, (t) => {
      lp = 0;
      return (noise() - lpN(0.3)) * Math.min(1, t / 0.05) * Math.exp(-t * 2) * 0.5;
    }));
    B.set('alarm', this._createBuffer(1.0, (t) => {
      const f = t % 0.5 < 0.25 ? 880 : 660;
      return Math.sign(Math.sin(TAU2 * f * t)) * 0.12 * Math.min(1, t / 0.02) * (t < 0.95 ? 1 : (1 - t) / 0.05);
    }));
    B.set('rainLoop', this._makeLoopable(this._createBuffer(4.0, () => {
      lp = 0;
      const drop = Math.random() < 0.002 ? 0.6 : 0;
      return ((noise() - lpN(0.6)) * 0.22 + lpN2(0.05) * 0.4 + drop * noise()) * 0.6;
    }), 0.3));
    B.set('throwWhoosh', this._createBuffer(0.25, (t) => {
      lp += (noise() - lp) * 0.2;
      return lp * Math.sin(Math.PI * Math.min(1, t / 0.25)) * 1.4;
    }));
  }

  async _tryExternalFiles() {
    const jobs = Object.entries(ASSETS.audio).map(async ([name, file]) => {
      try {
        const url = ASSET_PATH + 'audio/' + file;
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) return;
        const bytes = await (await fetch(url)).arrayBuffer();
        const buf = await this.ctx.decodeAudioData(bytes);
        this.buffers.set(name, buf);
        this._variants.delete(name);            // a real recording beats the synth variants
      } catch {
        /* keep synthesized fallback — not an error */
      }
    });
    await Promise.all(jobs);
  }

  _pickJaVoice() {
    if (typeof speechSynthesis === 'undefined') return;
    const pick = () => {
      try {
        this.jaVoice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('ja')) ?? null;
      } catch { this.jaVoice = null; }
    };
    pick();
    try { speechSynthesis.onvoiceschanged = pick; } catch { /* ignore */ }
  }

  // ------------------------------------------------ playback

  /**
   * 2D SFX. options: {volume, rate, pan, delay}
   * THREE.Audio instances (and their Web Audio nodes) are pooled per sound
   * and reused once idle — full-auto fire no longer churns a fresh
   * AudioBufferSourceNode per shot, which keeps the GC quiet.
   */
  play(name, { volume = 1, rate = 1, pan = 0, delay = 0, variant = false } = {}) {
    if (!this.ready) return null;
    if (variant) {
      const n = this._variants.get(name) ?? 0;
      if (n > 0) name = `${name}#${Math.floor(Math.random() * n)}`;
    }
    const buf = this.buffers.get(name);
    if (!buf) return null;

    let pool = this._playPool.get(name);
    if (!pool) { pool = []; this._playPool.set(name, pool); }
    let a = pool.find((x) => !x.isPlaying);
    if (!a && pool.length < 8) {
      a = new THREE.Audio(this.listener);
      a.setBuffer(buf);
      pool.push(a);
    }
    if (!a) return null;                     // pool saturated — drop the SFX

    a.setVolume(volume);
    a.setPlaybackRate(rate * rand(0.97, 1.03));
    if (pan && !a.stereo) {                  // lazily give this voice a stereo panner
      a.stereo = this.ctx.createStereoPanner();
      a.setFilter(a.stereo);
    }
    if (a.stereo) a.stereo.pan.value = pan;
    if (delay > 0) { a.play(); a.paused = true; setTimeout(() => { try { a.play(); } catch { /* noop */ } }, delay * 1000); }
    else a.play();
    return a;
  }

  /** Start (or reuse) a named 2D loop. */
  playLoop(name, volume = 0.5) {
    if (this.loops.has(name)) return this.loops.get(name);
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buf);
    a.setLoop(true);
    a.setVolume(volume);
    a.play();
    this.loops.set(name, a);
    return a;
  }

  stopLoop(name) {
    const a = this.loops.get(name);
    if (a) { a.stop(); this.loops.delete(name); }
  }

  /**
   * Attach a looping/oneshot 3D sound to an Object3D.
   * returns the THREE.PositionalAudio for later control.
   */
  attachPositional(name, object3D, {
    volume = 1, refDistance = 6, maxDistance = 90, rolloff = 0.9, loop = true,
  } = {}) {
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const pa = new THREE.PositionalAudio(this.listener);
    pa.setBuffer(buf);
    pa.setLoop(loop);
    pa.setVolume(volume);
    pa.setRefDistance(refDistance);
    pa.setMaxDistance(maxDistance);
    pa.setRolloffFactor(rolloff);
    pa.setDistanceModel('inverse');
    object3D.add(pa);
    this.positionals.set(name + '@' + object3D.uuid, pa);
    return pa;
  }

  playPositional(pa, { volume = 1, restart = false } = {}) {
    if (!pa || !this.ready) return;
    pa.setVolume(volume);
    try {
      if (pa.isPlaying && restart) pa.stop();
      if (!pa.isPlaying) { pa.setPlaybackRate(rand(0.94, 1.06)); pa.play(); }
    } catch { /* noop */ }
  }

  stopPositional(pa) {
    if (pa && pa.isPlaying) pa.pause();
  }

  startAmbient() {
    if (!this.ready) return;
    this.playLoop('ambient', 0.55);
  }

  setMuted(m) {
    this.muted = m;
    if (this.masterGain) this.masterGain.gain.value = m ? 0 : this.masterVolume;
    if (this.musicGain) this.musicGain.gain.value = m ? 0 : 1;
  }

  /** Japanese station announcement (SpeechSynthesis w/ chime fallback). */
  announce(text) {
    this.play('chime', { volume: 0.5 });
    if (typeof speechSynthesis === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      if (this.jaVoice) u.voice = this.jaVoice;
      u.volume = 0.85;
      u.rate = 0.95;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* chime already played as the fallback */
    }
  }
}
