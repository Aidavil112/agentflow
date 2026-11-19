import { safeGet, safeSet } from "./utils.js";

const MUTE_KEY = "monsoon-drift-muted-v1";

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engine = null;
    this.muted = safeGet(MUTE_KEY, false) === true;
    this.engineActive = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      this.ctx = new Context();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.42;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    } catch {
      this.ctx = null;
    }
  }

  createNoiseBuffer() {
    const length = Math.floor(this.ctx.sampleRate * 0.7);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setMuted(muted) {
    this.muted = !!muted;
    safeSet(MUTE_KEY, this.muted);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.42, this.ctx.currentTime, 0.03);
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  startEngine() {
    if (!this.ctx || this.muted) return;
    if (!this.engine) {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc1.type = "sawtooth";
      osc2.type = "triangle";
      osc1.frequency.value = 62;
      osc2.frequency.value = 93;
      filter.type = "lowpass";
      filter.frequency.value = 420;
      filter.Q.value = 2.2;
      gain.gain.value = 0;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc1.start();
      osc2.start();
      this.engine = { osc1, osc2, filter, gain };
    }
    this.engineActive = true;
    this.engine.gain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.08);
  }

  setEngine(speedRatio, boosting) {
    if (!this.engine || !this.ctx || !this.engineActive || this.muted) return;
    const t = this.ctx.currentTime;
    const base = 58 + speedRatio * 128 + (boosting ? 38 : 0);
    this.engine.osc1.frequency.setTargetAtTime(base, t, 0.06);
    this.engine.osc2.frequency.setTargetAtTime(base * 1.52, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(340 + speedRatio * 1150 + (boosting ? 420 : 0), t, 0.08);
    this.engine.gain.gain.setTargetAtTime(0.045 + speedRatio * 0.055 + (boosting ? 0.025 : 0), t, 0.08);
  }

  stopEngine() {
    this.engineActive = false;
    if (!this.engine || !this.ctx) return;
    this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
  }

  tone(freq, duration, type = "sine", gain = 0.08, endFreq = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  noise(duration = 0.2, gain = 0.08, filterFreq = 800, delay = 0) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  sfx(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case "ui":
        this.tone(520, 0.07, "sine", 0.07, 760);
        break;
      case "start":
        this.tone(330, 0.12, "triangle", 0.09, 440);
        this.tone(440, 0.13, "triangle", 0.08, 660, 0.08);
        this.tone(660, 0.18, "triangle", 0.07, 880, 0.16);
        break;
      case "coin":
        this.tone(880, 0.11, "triangle", 0.075, 1320);
        this.tone(1320, 0.09, "sine", 0.045, 1760, 0.06);
        break;
      case "gate":
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, "triangle", 0.08, f * 1.08, i * 0.07));
        this.noise(0.25, 0.035, 1800);
        break;
      case "combo":
        this.tone(720, 0.13, "square", 0.055, 1080);
        break;
      case "near":
        this.tone(300, 0.13, "sawtooth", 0.045, 620);
        this.noise(0.11, 0.03, 1200);
        break;
      case "boost":
        this.noise(0.28, 0.075, 1100);
        this.tone(180, 0.3, "sawtooth", 0.06, 460);
        break;
      case "crash":
        this.noise(0.34, 0.14, 260);
        this.tone(95, 0.26, "sawtooth", 0.1, 42);
        break;
      case "gameover":
        [440, 330, 247, 165].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.07, f * 0.82, i * 0.13));
        break;
      default:
        break;
    }
  }
}
