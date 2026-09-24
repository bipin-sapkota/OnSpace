import { settings } from '../core/Settings';

/**
 * Fully procedural audio. Every sound effect, ambience bed and the adaptive
 * music score is synthesised with the Web Audio API at runtime — no audio
 * files, no licensing concerns, and a consistent sonic identity.
 */
export interface LoopHandle {
  set(volume: number, pitch?: number, filter?: number): void;
  stop(): void;
}

export type MusicMood = 'menu' | 'space' | 'planet' | 'night' | 'danger' | 'station' | 'silent';

const SCALES: Record<MusicMood, number[]> = {
  menu: [0, 2, 3, 7, 10],
  space: [0, 2, 7, 9, 11],
  planet: [0, 2, 4, 7, 9],
  night: [0, 3, 5, 7, 10],
  danger: [0, 1, 3, 6, 7],
  station: [0, 4, 7, 11, 14],
  silent: [0],
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private mood: MusicMood = 'silent';
  private musicTimer: number | null = null;
  private padNodes: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private lastPlay = new Map<string, number>();

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.amb.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);
    this.applyVolumes();
    settings.onChange(() => this.applyVolumes());
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = settings.data;
    this.master.gain.value = s.masterVolume;
    this.sfx.gain.value = s.sfxVolume;
    this.music.gain.value = s.musicVolume * 0.55;
    this.amb.gain.value = s.ambienceVolume;
  }

  private makeNoise(brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private out(bus: 'sfx' | 'amb' | 'music', pan = 0, reverb = 0.2): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(bus === 'sfx' ? this.sfx : bus === 'amb' ? this.amb : this.music);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      p.connect(s).connect(this.reverbSend);
    }
    return p;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noiseSrc(brown = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = brown ? this.brown : this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  /** One-shot sound effect by name. `vol` 0..1, `pan` -1..1. */
  play(name: string, vol = 1, pan = 0, pitch = 1): void {
    if (!this.ready || vol <= 0.001) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // simple rate limiting for spammy sounds
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);
    const o = this.out('sfx', pan, name.startsWith('ui') ? 0.05 : 0.25);
    const g = ctx.createGain();
    g.connect(o);
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, start = now) => {
      const x = ctx.createOscillator();
      x.type = type;
      x.frequency.setValueAtTime(f0 * pitch, start);
      x.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), start + dur);
      x.connect(g);
      x.start(start);
      x.stop(start + dur + 0.05);
      return x;
    };
    const nz = (dur: number, type: BiquadFilterType, f0: number, f1: number, q = 1, level = 1) => {
      const s = this.noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, now);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
      const ng = ctx.createGain();
      ng.gain.value = level;
      s.connect(f).connect(ng).connect(g);
      s.start(now);
      s.stop(now + dur + 0.05);
    };
    switch (name) {
      case 'ui_click': this.env(g, now, 0.002, 0.18 * vol, 0.06); osc('square', 1800, 1200, 0.06); break;
      case 'ui_hover': this.env(g, now, 0.002, 0.05 * vol, 0.04); osc('sine', 2400, 2600, 0.04); break;
      case 'ui_open': this.env(g, now, 0.01, 0.16 * vol, 0.25); osc('sine', 420, 880, 0.2); osc('triangle', 630, 1320, 0.22); break;
      case 'ui_close': this.env(g, now, 0.01, 0.14 * vol, 0.2); osc('sine', 880, 420, 0.18); break;
      case 'ui_error': this.env(g, now, 0.005, 0.2 * vol, 0.25); osc('square', 180, 140, 0.25); break;
      case 'ui_confirm': this.env(g, now, 0.005, 0.2 * vol, 0.35); osc('sine', 660, 660, 0.12); osc('sine', 990, 990, 0.3, now + 0.08); break;
      case 'pickup': this.env(g, now, 0.004, 0.22 * vol, 0.18); osc('sine', 900, 1500, 0.12); osc('triangle', 1350, 2250, 0.14); break;
      case 'harvest': this.env(g, now, 0.004, 0.35 * vol, 0.4); nz(0.35, 'bandpass', 3000, 600, 2, 0.8); osc('sine', 300, 90, 0.35); break;
      case 'blaster': this.env(g, now, 0.002, 0.35 * vol, 0.22); osc('sawtooth', 1400, 180, 0.2); nz(0.08, 'highpass', 4000, 2000, 0.7, 0.5); break;
      case 'laser': this.env(g, now, 0.002, 0.28 * vol, 0.25); osc('square', 900, 120, 0.24); osc('sawtooth', 1800, 240, 0.2); break;
      case 'enemy_laser': this.env(g, now, 0.002, 0.25 * vol, 0.25); osc('sawtooth', 600, 90, 0.24); break;
      case 'hit': this.env(g, now, 0.002, 0.3 * vol, 0.15); nz(0.14, 'lowpass', 3000, 400, 1, 1); osc('square', 220, 90, 0.1); break;
      case 'hurt': this.env(g, now, 0.004, 0.4 * vol, 0.3); osc('sawtooth', 160, 60, 0.3); nz(0.2, 'lowpass', 1200, 200, 1, 0.8); break;
      case 'explosion': {
        this.env(g, now, 0.005, 0.9 * vol, 2.2);
        nz(2.0, 'lowpass', 2400, 60, 0.8, 1.4);
        osc('sine', 120, 28, 1.5);
        break;
      }
      case 'thud': this.env(g, now, 0.003, 0.5 * vol, 0.35); osc('sine', 110, 40, 0.3); nz(0.2, 'lowpass', 800, 100, 1, 0.6); break;
      case 'footstep': this.env(g, now, 0.002, 0.06 * vol, 0.09); nz(0.08, 'bandpass', 900 * pitch, 400, 1.2, 1); break;
      case 'scan': {
        this.env(g, now, 0.02, 0.3 * vol, 1.6);
        osc('sine', 300, 2400, 1.2);
        osc('sine', 450, 3600, 1.4);
        break;
      }
      case 'discovery': {
        this.env(g, now, 0.02, 0.28 * vol, 2.2);
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => osc('sine', f, f, 1.6, now + i * 0.11));
        break;
      }
      case 'analyze': this.env(g, now, 0.01, 0.12 * vol, 0.12); osc('sine', 1200 + Math.random() * 800, 1600, 0.1); break;
      case 'craft': this.env(g, now, 0.01, 0.3 * vol, 0.6); nz(0.5, 'bandpass', 1500, 5000, 3, 0.6); osc('triangle', 440, 880, 0.4); break;
      case 'launch': this.env(g, now, 0.2, 0.8 * vol, 3.5); nz(3.4, 'lowpass', 300, 2500, 0.8, 1.5); osc('sawtooth', 50, 140, 3.0); break;
      case 'land': this.env(g, now, 0.05, 0.6 * vol, 1.6); nz(1.5, 'lowpass', 2000, 150, 0.8, 1.2); break;
      case 'warp_charge': this.env(g, now, 1.2, 0.5 * vol, 1.5); osc('sawtooth', 60, 900, 2.6); osc('sine', 120, 1800, 2.6); break;
      case 'warp_exit': this.env(g, now, 0.01, 0.8 * vol, 2.5); nz(2.3, 'lowpass', 6000, 100, 0.8, 1.4); osc('sine', 900, 50, 2); break;
      case 'pulse_start': this.env(g, now, 0.05, 0.5 * vol, 1.2); osc('sawtooth', 80, 400, 1.0); nz(1.1, 'bandpass', 500, 4000, 2, 0.8); break;
      case 'pulse_stop': this.env(g, now, 0.01, 0.4 * vol, 0.9); osc('sawtooth', 500, 60, 0.8); break;
      case 'alarm': this.env(g, now, 0.01, 0.2 * vol, 0.5); osc('square', 880, 880, 0.2); osc('square', 660, 660, 0.2, now + 0.25); break;
      case 'overheat': this.env(g, now, 0.01, 0.25 * vol, 0.6); nz(0.5, 'highpass', 3000, 6000, 1, 1); osc('square', 300, 200, 0.4); break;
      case 'shield_hit': this.env(g, now, 0.003, 0.3 * vol, 0.4); osc('sine', 700, 350, 0.35); osc('triangle', 1400, 500, 0.3); break;
      case 'dock': this.env(g, now, 0.02, 0.4 * vol, 1.2); osc('sine', 220, 110, 1.0); nz(0.8, 'lowpass', 900, 200, 1, 0.8); break;
      case 'monolith': {
        this.env(g, now, 0.8, 0.35 * vol, 4);
        [110, 164.8, 220, 277.2].forEach((f) => osc('sine', f, f * 1.01, 4.5));
        break;
      }
      case 'death': this.env(g, now, 0.02, 0.5 * vol, 3); osc('sine', 300, 40, 3); break;
      default: this.env(g, now, 0.005, 0.2 * vol, 0.2); osc('sine', 800, 400, 0.2);
    }
  }

  /** Procedural creature vocalisation driven by a species seed. */
  creatureCall(seed: number, size: number, vol: number, pan: number): void {
    if (!this.ready || vol < 0.01) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const r = (k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    const base = 900 / Math.max(0.5, size) * (0.5 + r(1));
    const o = this.out('sfx', pan, 0.4);
    const g = ctx.createGain();
    g.connect(o);
    const notes = 1 + Math.floor(r(2) * 3);
    for (let i = 0; i < notes; i++) {
      const t = now + i * (0.12 + r(3) * 0.2);
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      car.type = r(4) > 0.5 ? 'sine' : 'triangle';
      const f = base * (1 + (r(5 + i) - 0.5) * 0.6);
      car.frequency.setValueAtTime(f, t);
      car.frequency.exponentialRampToValueAtTime(f * (0.5 + r(6) * 1.2), t + 0.25);
      mod.frequency.value = f * (0.5 + r(7) * 2);
      mg.gain.value = f * r(8) * 2;
      mod.connect(mg).connect(car.frequency);
      const eg = ctx.createGain();
      this.env(eg, t, 0.02, 0.2 * vol, 0.2 + r(9) * 0.3);
      car.connect(eg).connect(g);
      car.start(t);
      mod.start(t);
      car.stop(t + 0.7);
      mod.stop(t + 0.7);
    }
  }

  /** Continuous sound. */
  loop(kind: 'engine' | 'wind' | 'rain' | 'beam' | 'jetpack' | 'pulse' | 'hum' | 'lava' | 'water'): LoopHandle {
    if (!this.ctx) return { set: () => undefined, stop: () => undefined };
    const ctx = this.ctx;
    const bus = kind === 'wind' || kind === 'rain' || kind === 'hum' || kind === 'lava' || kind === 'water' ? 'amb' : 'sfx';
    const o = this.out(bus, 0, kind === 'engine' ? 0.1 : 0.15);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(o);
    const filter = ctx.createBiquadFilter();
    filter.connect(g);
    const sources: AudioScheduledSourceNode[] = [];
    const oscs: OscillatorNode[] = [];
    let basePitch = 1;
    let lfo: OscillatorNode | null = null;
    switch (kind) {
      case 'engine': {
        filter.type = 'lowpass';
        filter.frequency.value = 600;
        filter.Q.value = 2;
        for (const [t, f] of [['sawtooth', 55], ['sawtooth', 55.7], ['square', 110.3]] as [OscillatorType, number][]) {
          const x = ctx.createOscillator();
          x.type = t;
          x.frequency.value = f;
          const xg = ctx.createGain();
          xg.gain.value = 0.25;
          x.connect(xg).connect(filter);
          oscs.push(x);
          sources.push(x);
        }
        const n = this.noiseSrc(true);
        const ng = ctx.createGain();
        ng.gain.value = 0.9;
        n.connect(ng).connect(filter);
        sources.push(n);
        basePitch = 55;
        break;
      }
      case 'wind':
      case 'rain':
      case 'water':
      case 'lava': {
        filter.type = kind === 'rain' ? 'highpass' : kind === 'wind' ? 'bandpass' : 'lowpass';
        filter.frequency.value = kind === 'rain' ? 2500 : kind === 'wind' ? 500 : kind === 'water' ? 900 : 300;
        filter.Q.value = kind === 'wind' ? 0.8 : 0.5;
        const n = this.noiseSrc(kind !== 'rain');
        n.connect(filter);
        sources.push(n);
        lfo = ctx.createOscillator();
        lfo.frequency.value = kind === 'wind' ? 0.13 : kind === 'water' ? 0.25 : 0.4;
        const lg = ctx.createGain();
        lg.gain.value = kind === 'wind' ? 250 : 150;
        lfo.connect(lg).connect(filter.frequency);
        lfo.start();
        break;
      }
      case 'beam': {
        filter.type = 'bandpass';
        filter.frequency.value = 1400;
        filter.Q.value = 3;
        const x = ctx.createOscillator();
        x.type = 'sawtooth';
        x.frequency.value = 180;
        x.connect(filter);
        oscs.push(x);
        sources.push(x);
        const n = this.noiseSrc();
        const ng = ctx.createGain();
        ng.gain.value = 0.3;
        n.connect(ng).connect(filter);
        sources.push(n);
        basePitch = 180;
        break;
      }
      case 'jetpack':
      case 'pulse': {
        filter.type = kind === 'pulse' ? 'bandpass' : 'lowpass';
        filter.frequency.value = kind === 'pulse' ? 900 : 1800;
        filter.Q.value = 1;
        const n = this.noiseSrc(kind === 'pulse');
        n.connect(filter);
        sources.push(n);
        if (kind === 'pulse') {
          const x = ctx.createOscillator();
          x.type = 'sawtooth';
          x.frequency.value = 40;
          const xg = ctx.createGain();
          xg.gain.value = 0.3;
          x.connect(xg).connect(filter);
          oscs.push(x);
          sources.push(x);
          basePitch = 40;
        }
        break;
      }
      case 'hum': {
        filter.type = 'lowpass';
        filter.frequency.value = 220;
        for (const f of [41.2, 61.7, 82.4]) {
          const x = ctx.createOscillator();
          x.type = 'sine';
          x.frequency.value = f;
          x.connect(filter);
          sources.push(x);
        }
        break;
      }
    }
    for (const s of sources) s.start();
    let stopped = false;
    return {
      set: (volume: number, pitch = 1, filt?: number) => {
        if (stopped) return;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(Math.max(0, volume), t, 0.08);
        if (oscs.length) {
          oscs.forEach((x, i) => x.frequency.setTargetAtTime(basePitch * pitch * (i === 1 ? 1.013 : i === 2 ? 2 : 1), t, 0.1));
        }
        if (filt !== undefined) filter.frequency.setTargetAtTime(Math.max(40, filt), t, 0.1);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.1);
        setTimeout(() => {
          for (const s of sources) {
            try { s.stop(); } catch { /* already stopped */ }
          }
          lfo?.stop();
          g.disconnect();
        }, 600);
      },
    };
  }

  /** Adaptive generative music. */
  setMood(mood: MusicMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (!this.ctx) return;
    this.fadePads();
    if (this.musicTimer !== null) clearTimeout(this.musicTimer);
    this.musicTimer = null;
    if (mood === 'silent') return;
    this.startPad();
    this.scheduleMelody();
  }

  private fadePads(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const p of this.padNodes) {
      p.gain.gain.cancelScheduledValues(t);
      p.gain.gain.setTargetAtTime(0, t, 1.5);
      const oscs = p.osc;
      setTimeout(() => oscs.forEach((o) => { try { o.stop(); } catch { /* */ } }), 7000);
    }
    this.padNodes = [];
  }

  private startPad(): void {
    const ctx = this.ctx!;
    const root = { menu: 110, space: 98, planet: 130.8, night: 103.8, danger: 92.5, station: 116.5, silent: 110 }[this.mood];
    const scale = SCALES[this.mood];
    const chord = [0, scale[2] ?? 7, scale[4] ?? 12, 12 + (scale[1] ?? 2)];
    const out = this.out('music', 0, 0.6);
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.mood === 'danger' ? 900 : 700;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 250;
    lfo.connect(lfoG).connect(lp.frequency);
    lp.connect(g).connect(out);
    const oscs: OscillatorNode[] = [lfo];
    for (const semi of chord) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = this.mood === 'danger' ? 'sawtooth' : 'triangle';
        o.frequency.value = root * Math.pow(2, semi / 12);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.05;
        o.connect(og).connect(lp);
        o.start();
        oscs.push(o);
      }
    }
    lfo.start();
    g.gain.setTargetAtTime(this.mood === 'danger' ? 0.7 : 0.55, ctx.currentTime, 3);
    this.padNodes.push({ osc: oscs, gain: g });
  }

  private scheduleMelody(): void {
    const ctx = this.ctx;
    if (!ctx || this.mood === 'silent') return;
    const scale = SCALES[this.mood];
    const root = { menu: 440, space: 392, planet: 523.3, night: 415.3, danger: 370, station: 466.2, silent: 440 }[this.mood];
    const notes = 3 + Math.floor(Math.random() * 5);
    const now = ctx.currentTime + 0.1;
    const step = this.mood === 'danger' ? 0.22 : 0.42 + Math.random() * 0.4;
    const out = this.out('music', (Math.random() - 0.5) * 0.6, 0.8);
    for (let i = 0; i < notes; i++) {
      const deg = scale[Math.floor(Math.random() * scale.length)];
      const oct = Math.random() < 0.3 ? 2 : 1;
      const f = root * Math.pow(2, deg / 12) * oct * 0.5;
      const t = now + i * step;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.01;
      const g = ctx.createGain();
      this.env(g, t, 0.01, 0.07, 2.4);
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      o.connect(g).connect(out);
      o2.connect(g2).connect(g);
      o.start(t);
      o2.start(t);
      o.stop(t + 2.6);
      o2.stop(t + 2.6);
    }
    const rest = (this.mood === 'danger' ? 2 : 6) + Math.random() * 9;
    this.musicTimer = window.setTimeout(() => this.scheduleMelody(), (notes * step + rest) * 1000);
  }
}

export const audio = new AudioEngine();
