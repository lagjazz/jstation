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
// ============================================================

import * as THREE from 'three';
import { ASSETS, ASSET_PATH } from './config.js';
import { rand } from './utils.js';

const TAU = Math.PI * 2;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.listener = null;
    this.buffers = new Map();
    this.positionals = new Map();
    this.loops = new Map();
    this._playPool = new Map();    // reused THREE.Audio one-shots per SFX name
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

    this._synthesizeAll();
    await this._tryExternalFiles();
    this._pickJaVoice();

    this.ready = true;
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

    B.set('shotRifle', this._createBuffer(0.34, (t) => {
      lp = 0;
      const crack = noise() * Math.exp(-t * 24) * (t < 0.012 ? 2.6 : 1);
      const mid = noise() * Math.exp(-t * 17) * 0.7;
      const boom = lpNoise(0, 0.06) * Math.exp(-t * 9) * 1.5;
      const sub = Math.sin(TAU * 78 * t) * Math.exp(-t * 13) * 0.9;
      return (crack + mid + boom + sub) * 0.55;
    }));

    B.set('shotPistol', this._createBuffer(0.24, (t) => {
      lp = 0;
      const crack = noise() * Math.exp(-t * 30) * (t < 0.008 ? 2.4 : 1);
      const mid = noise() * Math.exp(-t * 22) * 0.6;
      const boom = lpNoise(0, 0.09) * Math.exp(-t * 12) * 1.1;
      return (crack + mid + boom) * 0.5;
    }));

    B.set('shotShotgun', this._createBuffer(0.5, (t) => {
      lp = 0;
      const crack = noise() * Math.exp(-t * 14) * (t < 0.02 ? 2.2 : 1.3);
      const boom = lpNoise(0, 0.045) * Math.exp(-t * 7) * 2.0;
      const sub = Math.sin(TAU * 55 * t) * Math.exp(-t * 9) * 1.1;
      return (crack + boom + sub) * 0.5;
    }));

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

    B.set('enemyShot', this._createBuffer(0.3, (t) => {
      lp = 0;
      const crack = noise() * Math.exp(-t * 26) * 0.8;
      const body = lpNoise(0, 0.08) * Math.exp(-t * 14) * 0.9;
      return (crack + body) * 0.42;
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

  async _tryExternalFiles() {
    const jobs = Object.entries(ASSETS.audio).map(async ([name, file]) => {
      try {
        const url = ASSET_PATH + 'audio/' + file;
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) return;
        const bytes = await (await fetch(url)).arrayBuffer();
        const buf = await this.ctx.decodeAudioData(bytes);
        this.buffers.set(name, buf);
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
  play(name, { volume = 1, rate = 1, pan = 0, delay = 0 } = {}) {
    if (!this.ready) return null;
    const buf = this.buffers.get(name);
    if (!buf) return null;

    let pool = this._playPool.get(name);
    if (!pool) { pool = []; this._playPool.set(name, pool); }
    let a = pool.find((x) => !x.isPlaying);
    if (!a && pool.length < 8) {
      a = new THREE.Audio(this.listener);
      a.setBuffer(buf);
      if (pan) a.setPanning(true);
      pool.push(a);
    }
    if (!a) return null;                     // pool saturated — drop the SFX

    a.setVolume(volume);
    a.setPlaybackRate(rate * rand(0.97, 1.03));
    if (pan) a.panner.pan.value = pan;
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

  playPositional(pa, { volume = 1 } = {}) {
    if (!pa || !this.ready) return;
    pa.setVolume(volume);
    if (!pa.isPlaying) { try { pa.play(); } catch { /* noop */ } }
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
