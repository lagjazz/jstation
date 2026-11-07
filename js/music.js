// ============================================================
// music.js — procedural, adaptive background score (Web Audio).
//
// A tiny step sequencer schedules notes ~120 ms ahead on the audio
// clock (drift-free, independent of frame rate). Every world has its
// own THEME: key, scale, tempo, chord loop and timbre. The score has
// two layers that crossfade with combat INTENSITY (0 calm … 1 full
// firefight, fed by the game every frame):
//   explore  pad chords + soft arpeggio + sparse kick
//   combat   driving bass, drums (kick / snare / hats), lead stabs
// Nodes are created per note and released by the browser when they
// stop — no buffers to synthesize at boot except two short noises.
// ============================================================

const SCALES = {
  minor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:   [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  insen:    [0, 1, 5, 7, 10, 12, 13],      // Japanese in-sen
  hirajoshi:[0, 2, 3, 7, 8, 12, 14],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  lydian:   [0, 2, 4, 6, 7, 9, 11],
};

// root = MIDI note of the tonic; prog = scale degrees (chord roots)
const THEMES = {
  station:   { root: 50, scale: 'insen', bpm: 104, prog: [0, 3, 1, 4], wave: 'sawtooth', cut: 1400, arp: 'triangle' },
  cyber:     { root: 45, scale: 'phrygian', bpm: 122, prog: [0, 1, 0, 5], wave: 'sawtooth', cut: 2200, arp: 'square' },
  space:     { root: 43, scale: 'lydian', bpm: 96, prog: [0, 4, 2, 5], wave: 'triangle', cut: 1200, arp: 'sine' },
  tomb:      { root: 47, scale: 'harmonic', bpm: 100, prog: [0, 5, 4, 0], wave: 'sawtooth', cut: 1000, arp: 'triangle' },
  sky:       { root: 52, scale: 'dorian', bpm: 112, prog: [0, 3, 4, 6], wave: 'sawtooth', cut: 1800, arp: 'triangle' },
  lab:       { root: 48, scale: 'minor', bpm: 118, prog: [0, 5, 2, 6], wave: 'square', cut: 1600, arp: 'sine' },
  deep:      { root: 41, scale: 'phrygian', bpm: 92, prog: [0, 1, 5, 4], wave: 'triangle', cut: 800, arp: 'sine' },
  ice:       { root: 49, scale: 'hirajoshi', bpm: 108, prog: [0, 3, 2, 4], wave: 'sawtooth', cut: 1500, arp: 'triangle' },
  forest:    { root: 50, scale: 'dorian', bpm: 106, prog: [0, 4, 3, 1], wave: 'triangle', cut: 1300, arp: 'triangle' },
  rust:      { root: 44, scale: 'harmonic', bpm: 116, prog: [0, 5, 1, 4], wave: 'sawtooth', cut: 1700, arp: 'square' },
  brass:     { root: 46, scale: 'minor', bpm: 126, prog: [0, 6, 5, 4], wave: 'sawtooth', cut: 2000, arp: 'square' },
};

const AREA_THEME = {
  hall: 'station', platform: 'station', garden: 'station', cyber: 'cyber', moon: 'space',
  tomb: 'tomb', skyport: 'sky', lab: 'lab', atlantis: 'deep', ice: 'ice', orbit: 'space',
  canopy: 'forest', canyon: 'rust', aquarium: 'deep', clockwork: 'brass',
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0;
    this.out.connect(destination);
    // gentle glue: compressor + a send to a short stereo delay
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 3;
    this.comp.connect(this.out);
    this.explore = ctx.createGain();
    this.combat = ctx.createGain();
    this.explore.connect(this.comp);
    this.combat.connect(this.comp);
    this.delay = ctx.createDelay(1);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.32;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayOut = ctx.createGain();
    this.delayOut.gain.value = 0.35;
    this.delay.connect(this.delayOut);
    this.delayOut.connect(this.comp);
    this.noise = this._noise(1);
    this.theme = THEMES.station;
    this.step = 0;
    this.nextT = 0;
    this.intensity = 0;
    this.volume = 0.42;
    this.running = false;
    this._timer = null;
  }

  _noise(sec) {
    const b = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * sec), this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setArea(area) {
    const t = THEMES[AREA_THEME[area] ?? 'station'];
    if (t === this.theme && this.running) return;
    this.theme = t;
    this.delay.delayTime.value = (60 / t.bpm) * 0.75;
    this.step = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextT = this.ctx.currentTime + 0.1;
    this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 1.2);
    this._timer = setInterval(() => this._schedule(), 30);
  }

  stop() {
    this.running = false;
    clearInterval(this._timer);
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  /** 0 … 1, smoothed by the caller; layers crossfade over ~1 s. */
  setIntensity(x) {
    this.intensity = x;
    const t = this.ctx.currentTime;
    this.explore.gain.setTargetAtTime(0.55 + 0.25 * (1 - x), t, 0.6);
    this.combat.gain.setTargetAtTime(x * 0.95, t, 0.5);
  }

  /** Short sting (mission complete / level up / failure). */
  sting(kind) {
    const th = this.theme;
    const t = this.ctx.currentTime + 0.02;
    const sc = SCALES[th.scale];
    const notes = kind === 'fail' ? [0, -1, -3] : (kind === 'level' ? [0, 2, 4, 7] : [0, 4, 7, 9]);
    notes.forEach((d, i) => {
      const deg = ((d % 7) + 7) % 7;
      const oct = Math.floor(d / 7);
      const m = th.root + 12 + sc[deg] + 12 * oct;
      this._tone(mtof(m), t + i * 0.12, 0.9, 'triangle', 0.16, this.comp, 2600);
    });
  }

  _schedule() {
    if (!this.running) return;
    const ahead = this.ctx.currentTime + 0.14;
    const th = this.theme;
    const s16 = 60 / th.bpm / 4;
    while (this.nextT < ahead) {
      this._playStep(this.step, this.nextT, s16);
      this.nextT += s16;
      this.step = (this.step + 1) % 128;      // 8 bars of 16ths
    }
  }

  _deg(deg, oct = 0) {
    const th = this.theme;
    const sc = SCALES[th.scale];
    const n = sc.length;
    const d = ((deg % n) + n) % n;
    return th.root + sc[d] + 12 * (oct + Math.floor(deg / n));
  }

  _playStep(step, t, s16) {
    const th = this.theme;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = th.prog[Math.floor(bar / 2) % th.prog.length];
    const I = this.intensity;

    // ---- explore layer ----
    if (s === 0 && bar % 2 === 0) {
      // pad: triad over two bars
      for (const k of [0, 2, 4]) {
        const m = this._deg(chord + k, 0);
        this._pad(mtof(m), t, s16 * 32, th.wave, 0.05, th.cut * 0.7);
      }
      this._pad(mtof(this._deg(chord, -1)), t, s16 * 32, 'sine', 0.08, 400);
    }
    if (s % 2 === 0) {
      const pat = [0, 2, 4, 2, 7, 4, 2, 4];
      const deg = chord + pat[(s / 2 + bar) % pat.length];
      if (Math.random() < 0.75) this._tone(mtof(this._deg(deg, 1)), t, s16 * 1.6, th.arp, 0.035, this.explore, th.cut * 1.4, true);
    }
    if ((s === 0 || s === 10) && I < 0.5) this._kick(t, 0.35, this.explore);

    // ---- combat layer (only scheduled when audible) ----
    if (I > 0.04) {
      if (s % 4 === 0 || s === 14) this._kick(t, 0.9, this.combat);
      if (s === 4 || s === 12) this._snare(t, 0.5);
      if (s % 2 === 1) this._hat(t, s % 4 === 3 ? 0.16 : 0.09);
      const bassPat = [0, 0, 7, 0, 0, 5, 0, 3];
      if (s % 2 === 0) {
        const off = bassPat[(s / 2) % 8];
        const m = this._deg(chord, -1) + (off === 7 ? 12 : off === 5 ? 7 : off === 3 ? 3 : 0);
        this._tone(mtof(m), t, s16 * 1.7, 'sawtooth', 0.11, this.combat, 700 + I * 900);
      }
      if ((s === 0 || s === 6 || s === 11) && bar % 2 === 1) {
        for (const k of [0, 2, 4]) this._tone(mtof(this._deg(chord + k, 1)), t, s16 * 1.2, th.wave, 0.03, this.combat, th.cut * 1.6, true);
      }
    }
  }

  _tone(f, t, dur, type, vol, dest, cut = 3000, send = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(fl); fl.connect(g); g.connect(dest);
    if (send) g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _pad(f, t, dur, type, vol, cut) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(cut * 0.6, t);
    fl.frequency.linearRampToValueAtTime(cut, t + dur * 0.5);
    fl.frequency.linearRampToValueAtTime(cut * 0.6, t + dur);
    fl.connect(g); g.connect(this.explore);
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(fl);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  _kick(t, vol, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.3);
  }

  _snare(t, vol) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(bp); bp.connect(g); g.connect(this.combat);
    g.connect(this.delay);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.frequency.value = 190;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.25, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og); og.connect(this.combat);
    o.start(t); o.stop(t + 0.1);
  }

  _hat(t, vol) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(hp); hp.connect(g); g.connect(this.combat);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.06);
  }
}
