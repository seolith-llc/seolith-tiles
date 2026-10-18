// src/audio.js
// Procedural WebAudio Synthesizer for ASMR Micro-Tile Pops, Capsule Chimes, and Dynamic Synthwave Music.
// Zero external MP3/WAV bloat; rate-limited polyphony so 1,500 balls never clip the audio bus.

export class SeolithAudio {
  constructor() {
    this.ctx = null;
    this.sfxEnabled = true;
    this.musicEnabled = false;
    this.soundProfile = 'asmr-wood'; // 'asmr-wood' | 'crystal-chime' | 'retro-8bit'
    this.lastPopTime = 0;
    this.lastWallTime = 0;
    this.musicTimer = null;
    this.musicStep = 0;
    this.activeBallsRef = 1;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setSettings({ sfxEnabled, musicEnabled, soundProfile }) {
    if (typeof sfxEnabled === 'boolean') this.sfxEnabled = sfxEnabled;
    if (typeof soundProfile === 'string') this.soundProfile = soundProfile;
    if (typeof musicEnabled === 'boolean' && musicEnabled !== this.musicEnabled) {
      this.musicEnabled = musicEnabled;
      if (this.musicEnabled) {
        this.startMusic();
      } else {
        this.stopMusic();
      }
    }
  }

  // Triggered every frame with the number of micro-tiles broken and vertical row norm [0..1]
  playBrickHits(hitCount, rowNorm = 0.5, combo = 1) {
    if (!this.sfxEnabled || hitCount <= 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Throttle rapid grain bursts to ~18ms minimum spacing (55 pops/sec max) for crisp ASMR texture!
    const minInterval = hitCount > 15 ? 0.014 : 0.021;
    if (now - this.lastPopTime < minInterval) return;
    this.lastPopTime = now;

    // Pentatonic / harmonic pitch scaling based on row height + combo
    const scaleSemitones = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const idx = Math.min(
      scaleSemitones.length - 1,
      Math.floor(rowNorm * 7) + (combo % 4)
    );
    const jitter = (Math.random() - 0.5) * 18;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (this.soundProfile === 'crystal-chime') {
      const baseFreq = 520 * Math.pow(2, scaleSemitones[idx] / 12) + jitter;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + 0.055);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
    } else if (this.soundProfile === 'retro-8bit') {
      const baseFreq = 340 * Math.pow(2, scaleSemitones[idx] / 12) + jitter;
      osc.type = 'square';
      osc.frequency.setValueAtTime(baseFreq, now);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.042);
    } else {
      // Default: 'asmr-wood' (Viral X video percussive tactile pop/tick!)
      const baseFreq = 390 + rowNorm * 320 + (combo % 6) * 28 + jitter;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(115, now + 0.032);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    }
  }

  playWallOrPaddle(paddleHit = false) {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (!paddleHit && now - this.lastWallTime < 0.045) return;
    this.lastWallTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = paddleHit ? 'sine' : 'triangle';
    const freq = paddleHit ? 260 : 175;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + 0.035);

    gain.gain.setValueAtTime(paddleHit ? 0.16 : 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }

  playPowerup(kind) {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Arpeggio chime matching the viral video's capsule pickup!
    const notes =
      kind === 4
        ? [392, 330, 261.6] // Shrink hazard descending
        : [523.25, 659.25, 783.99, 1046.5]; // Uplifting major triad for x3 / +3 / Star!

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.045;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  playVictoryFanfare() {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.075;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  }

  startMusic() {
    this.stopMusic();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const bassline = [110, 110, 130.81, 146.83, 98, 98, 130.81, 164.81];
    const arp = [220, 277.18, 329.63, 440, 329.63, 277.18];

    this.musicTimer = setInterval(() => {
      if (!this.musicEnabled || !this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const step = this.musicStep++;

      // Subtle ambient pulse bass
      const bFreq = bassline[Math.floor(step / 2) % bassline.length];
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(bFreq, now);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);

      // Add high shimmer note when cascade intensifies (>30 balls)
      if (this.activeBallsRef > 25) {
        const aFreq = arp[step % arp.length] * 2;
        const osc2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(aFreq, now);
        g2.gain.setValueAtTime(0.025, now);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc2.connect(g2);
        g2.connect(this.ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.13);
      }
    }, 210);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
