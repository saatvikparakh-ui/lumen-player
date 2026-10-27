/**
 * WatchSoundService
 * Synthesizes realistic mechanical watch crown / haptic click sounds using Web Audio API.
 * Emulates the tactile, crisp mechanical click of luxury watch bezels and Apple Watch digital crown.
 */
class WatchSoundServiceClass {
  private ctx: AudioContext | null = null;
  private lastTickTime: number = 0;

  private getAudioContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Plays a crisp, metallic mechanical watch crown tick
   */
  playTick(velocity: number = 1.0) {
    const now = performance.now();
    // Throttle slightly so rapid scrubbing doesn't produce harsh white noise
    if (now - this.lastTickTime < 28) return;
    this.lastTickTime = now;

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      // Dual-frequency transient click: metallic click at 3.8kHz decaying into 1.2kHz body
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(3800, t);
      osc.frequency.exponentialRampToValueAtTime(1100, t + 0.009);

      // Highpass/bandpass filter for sharp mechanical definition
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(3200, t);
      filter.Q.setValueAtTime(4.5, t);

      // Exponential decay envelope (7ms duration)
      const vol = Math.min(1.0, Math.max(0.15, velocity)) * 0.18;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.009);
    } catch (e) {
      // AudioContext policy suppression fallback
    }
  }

  /**
   * Plays a slightly softer, deeper mechanical ratcheting click
   */
  playSubTick() {
    this.playTick(0.6);
  }
}

export const WatchSoundService = new WatchSoundServiceClass();
