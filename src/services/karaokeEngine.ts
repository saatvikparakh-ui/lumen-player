/**
 * LUMEN REAL-TIME CLIENT-SIDE KARAOKE ENGINE
 * Zero-cost, instantaneous vocal reduction via Web Audio API DSP.
 * Performs Center-Channel Phase Cancellation (L - R) with a low-frequency mono
 * state-variable filter (<160 Hz) to preserve kick drums and bass guitars.
 */

class KaraokeEngineClass {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private isEnabled: boolean = false;

  // DSP Nodes
  private inputGain: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private normalGain: GainNode | null = null;
  private karaokeGain: GainNode | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  private invertGain: GainNode | null = null;
  private listeners: ((enabled: boolean) => void)[] = [];

  /**
   * Directly hooks the Karaoke DSP into AudioEngine's existing Web Audio context graph.
   * Avoids duplicate MediaElementAudioSourceNode creation.
   */
  public initInAudioGraph(audioCtx: AudioContext, inputNode: AudioNode, destinationNode: AudioNode) {
    if (this.inputGain) return;

    try {
      this.audioCtx = audioCtx;
      this.inputGain = audioCtx.createGain();
      this.normalGain = audioCtx.createGain();
      this.karaokeGain = audioCtx.createGain();

      // Normal path: default 1.0 gain
      this.normalGain.gain.value = this.isEnabled ? 0 : 1;
      this.karaokeGain.gain.value = this.isEnabled ? 1 : 0;

      // 1. Center-channel cancellation stage
      this.splitter = audioCtx.createChannelSplitter(2);
      this.merger = audioCtx.createChannelMerger(2);
      this.invertGain = audioCtx.createGain();
      this.invertGain.gain.value = -1; // Invert Right channel phase

      // 2. Bass-preserve lowpass filter (<160 Hz) so kick and bass remain punchy
      this.bassFilter = audioCtx.createBiquadFilter();
      this.bassFilter.type = 'lowpass';
      this.bassFilter.frequency.value = 160;

      // Connect upstream inputNode to inputGain
      inputNode.connect(this.inputGain);

      // Normal dry branch
      this.inputGain.connect(this.normalGain);
      this.normalGain.connect(destinationNode);

      // Karaoke DSP branch
      this.inputGain.connect(this.splitter);

      // Phase cancellation: L + (-R) = L - R
      const diffGain = audioCtx.createGain();
      this.splitter.connect(diffGain, 0); // L
      this.splitter.connect(this.invertGain, 1); // -R
      this.invertGain.connect(diffGain);

      // Connect difference to Left & Right merger
      diffGain.connect(this.merger, 0, 0); // Left out
      diffGain.connect(this.merger, 0, 1); // Right out

      // Add back bass frequencies in mono
      this.inputGain.connect(this.bassFilter);
      this.bassFilter.connect(this.merger, 0, 0);
      this.bassFilter.connect(this.merger, 0, 1);

      // Route merger to karaoke gain and destination
      this.merger.connect(this.karaokeGain);
      this.karaokeGain.connect(destinationNode);

      console.info('[Lumen Karaoke] Real-time DSP vocal reducer node inserted into AudioEngine graph.');
    } catch (err) {
      console.warn('[Lumen Karaoke] Could not initialize Web Audio DSP in graph:', err);
    }
  }

  /**
   * Attaches the Karaoke DSP filter chain to a standalone HTML5 audio element.
   */
  public attachToAudioElement(audioElement: HTMLAudioElement) {
    if (this.sourceNode || this.inputGain || !audioElement) return;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      const ctx = new AudioCtxClass();
      this.audioCtx = ctx;
      this.sourceNode = ctx.createMediaElementSource(audioElement);
      this.initInAudioGraph(ctx, this.sourceNode, ctx.destination);
    } catch (err) {
      console.warn('[Lumen Karaoke] Could not initialize standalone Web Audio DSP:', err);
    }
  }

  public toggle(): boolean {
    return this.setEnabled(!this.isEnabled);
  }

  public setEnabled(enable: boolean): boolean {
    this.isEnabled = enable;

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    if (this.normalGain && this.karaokeGain && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      // Smooth 50ms crossfade to avoid audio clicks
      this.normalGain.gain.setTargetAtTime(enable ? 0 : 1, now, 0.05);
      this.karaokeGain.gain.setTargetAtTime(enable ? 1 : 0, now, 0.05);
    }

    this.listeners.forEach(fn => fn(this.isEnabled));
    return this.isEnabled;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public subscribe(fn: (enabled: boolean) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }
}

export const KaraokeEngine = new KaraokeEngineClass();
