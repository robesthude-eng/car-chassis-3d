export class ChassisAudioEngine {
  constructor({ finalDriveRatio = 3.73, masterVolume = 0.35 } = {}) {
    this.finalDriveRatio = finalDriveRatio;
    this.masterVolume = masterVolume;
    this.ctx = null;
    this.enabled = false;
    this.initialized = false;
    this.driveshaftOsc = null;
    this.diffOsc = null;
    this.masterGain = null;
    this.driveshaftGain = null;
    this.diffGain = null;
  }

  init() {
    if (this.initialized) return true;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return false;

    try {
      this.ctx = new AudioContextCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(
        this.masterVolume,
        this.ctx.currentTime,
      );
      this.masterGain.connect(this.ctx.destination);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(350, this.ctx.currentTime);

      this.driveshaftOsc = this.ctx.createOscillator();
      this.driveshaftOsc.type = "sawtooth";
      this.driveshaftOsc.frequency.setValueAtTime(30, this.ctx.currentTime);
      this.driveshaftGain = this.ctx.createGain();
      this.driveshaftGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.driveshaftOsc.connect(filter);
      filter.connect(this.driveshaftGain);
      this.driveshaftGain.connect(this.masterGain);
      this.driveshaftOsc.start();

      this.diffOsc = this.ctx.createOscillator();
      this.diffOsc.type = "sine";
      this.diffOsc.frequency.setValueAtTime(100, this.ctx.currentTime);
      this.diffGain = this.ctx.createGain();
      this.diffGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.diffOsc.connect(this.diffGain);
      this.diffGain.connect(this.masterGain);
      this.diffOsc.start();

      this.initialized = true;
      this.enabled = true;
      void this.resume();
      return true;
    } catch (error) {
      this.dispose();
      console.warn("Audio initialization failed.", error);
      return false;
    }
  }

  async resume() {
    if (this.ctx?.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    return this.ctx?.state === "running";
  }

  setSpeed(speedKmh, rpm, hasWheelDrive) {
    if (!this.enabled || !this.ctx) return;

    const time = this.ctx.currentTime;
    if (speedKmh <= 0.1) {
      this.driveshaftGain.gain.setTargetAtTime(0, time, 0.05);
      this.diffGain.gain.setTargetAtTime(0, time, 0.05);
      return;
    }

    const frequency = Math.max(25, rpm * 0.04);
    const targetGain = Math.min(0.25, 0.04 + (speedKmh / 240) * 0.18);
    this.driveshaftOsc.frequency.setTargetAtTime(frequency, time, 0.05);
    this.diffOsc.frequency.setTargetAtTime(
      frequency * this.finalDriveRatio,
      time,
      0.05,
    );
    this.driveshaftGain.gain.setTargetAtTime(targetGain, time, 0.05);
    this.diffGain.gain.setTargetAtTime(
      hasWheelDrive ? targetGain * 0.4 : 0,
      time,
      0.05,
    );
  }

  playBoltClink() {
    this.playTone({
      type: "sine",
      startFrequency: 1600 + Math.random() * 400,
      endFrequency: 300,
      duration: 0.08,
      volume: 0.2,
    });
  }

  playPartDropThud() {
    this.playTone({
      type: "triangle",
      startFrequency: 140,
      endFrequency: 35,
      duration: 0.15,
      volume: 0.3,
    });
  }

  playTone({ type, startFrequency, endFrequency, duration, volume }) {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    try {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = this.ctx.currentTime;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(startFrequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(
        endFrequency,
        start + duration,
      );
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.masterGain);
      oscillator.addEventListener(
        "ended",
        () => {
          oscillator.disconnect();
          gain.disconnect();
        },
        { once: true },
      );
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    } catch (error) {
      console.warn("Audio effect failed.", error);
    }
  }

  playDamperHiss() {
    if (!this.enabled || !this.ctx || !this.masterGain) return;

    try {
      const duration = 0.12;
      const bufferSize = Math.round(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let index = 0; index < bufferSize; index += 1) {
        output[index] =
          (Math.random() * 2 - 1) * Math.exp(-index / (bufferSize * 0.3));
      }

      const noise = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      noise.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = 1200;
      filter.Q.value = 2;
      gain.gain.value = 0.08;
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.addEventListener(
        "ended",
        () => {
          noise.disconnect();
          filter.disconnect();
          gain.disconnect();
        },
        { once: true },
      );
      noise.start();
    } catch (error) {
      console.warn("Damper audio effect failed.", error);
    }
  }

  toggle() {
    if (!this.initialized) return this.init();

    this.enabled = !this.enabled;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
        this.enabled ? this.masterVolume : 0,
        this.ctx.currentTime,
      );
    }
    if (this.enabled) void this.resume();
    return this.enabled;
  }

  dispose() {
    for (const node of [this.driveshaftOsc, this.diffOsc]) {
      try {
        node?.stop();
      } catch {}
      try {
        node?.disconnect();
      } catch {}
    }
    for (const node of [this.driveshaftGain, this.diffGain, this.masterGain]) {
      try {
        node?.disconnect();
      } catch {}
    }
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
    this.enabled = false;
    this.initialized = false;
  }
}
