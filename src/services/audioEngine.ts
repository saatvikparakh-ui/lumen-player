import { EQPresetName, Track } from '../types/music';
import { RatingAndStatsService } from './ratingAndStatsService';

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<EQPresetName, number[]> = {
  'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [5.5, 4.5, 3.5, 2.0, 0.5, 0, 0, 0, 0, 0],
  'Rock': [4.0, 3.0, 1.5, 0, -1.0, -0.5, 1.5, 3.0, 3.5, 4.0],
  'Jazz': [3.0, 2.0, 0, 1.5, 1.5, 1.5, 0, 1.5, 2.5, 3.0],
  'Electronic': [4.5, 4.0, 1.5, 0, -1.0, 1.0, 2.0, 3.0, 4.0, 4.5],
  'Vocal': [-1.5, -1.0, 0, 2.0, 3.5, 3.5, 2.5, 1.0, 0, -1.0]
};

export class AudioEngine {
  private static audio: HTMLAudioElement;
  private static ctx: AudioContext | null = null;
  private static sourceNode: MediaElementAudioSourceNode | null = null;
  private static eqFilters: BiquadFilterNode[] = [];
  private static compressorNode: DynamicsCompressorNode | null = null;
  private static masterGainNode: GainNode | null = null;
  private static analyserNode: AnalyserNode | null = null;
  private static isInitialized = false;

  private static currentTrack: Track | null = null;
  private static queue: Track[] = []; // Current context sequence (e.g. active playlist or album)
  private static queueIndex = -1;
  private static priorityQueue: Track[] = []; // Explicitly queued tracks ("Play Next")
  private static isShuffle = false;
  private static repeatMode: 'off' | 'all' | 'one' = 'off';

  // Playback & Transition Settings
  private static crossfadeSeconds = 3;
  private static isGapless = true;
  private static isAutomix = true;
  private static isNormalized = true;
  private static isCrossfading = false;

  // Sleep Timer
  private static sleepTimerTimeout: any = null;
  private static sleepTimerEndsAt: number | null = null;
  private static sleepTimerMode: 'off' | 'duration' | 'end_of_track' = 'off';

  private static onTimeUpdateCallback: ((time: number, duration: number) => void) | null = null;
  private static onTrackChangeCallback: ((track: Track | null) => void) | null = null;
  private static onPlayStateChangeCallback: ((isPlaying: boolean) => void) | null = null;
  private static queueListeners: (() => void)[] = [];

  // Playback Telemetry Tracking
  private static currentTrackAccumulatedSeconds = 0;
  private static lastPlayTime = 0;
  private static currentTrackLogged = false;

  static init(): void {
    if (this.isInitialized) return;

    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';

    this.audio.addEventListener('timeupdate', () => {
      const current = this.audio.currentTime;
      const total = this.audio.duration || 0;
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(current, total);
      }
      if (!this.audio.paused && this.lastPlayTime > 0) {
        const delta = (Date.now() - this.lastPlayTime) / 1000;
        if (delta > 0 && delta < 2) {
          this.currentTrackAccumulatedSeconds += delta;
        }
      }
      this.lastPlayTime = Date.now();
      this.checkPrebuffer();
      this.checkCrossfade(current, total);
    });

    this.audio.addEventListener('play', () => {
      this.lastPlayTime = Date.now();
      this.updateMediaSessionState();
      if (this.onPlayStateChangeCallback) this.onPlayStateChangeCallback(true);
    });

    this.audio.addEventListener('pause', () => {
      if (this.lastPlayTime > 0) {
        const delta = (Date.now() - this.lastPlayTime) / 1000;
        if (delta > 0 && delta < 2) {
          this.currentTrackAccumulatedSeconds += delta;
        }
      }
      this.lastPlayTime = 0;
      this.updateMediaSessionState();
      if (this.onPlayStateChangeCallback) this.onPlayStateChangeCallback(false);
    });

    this.audio.addEventListener('ended', () => {
      this.handleTrackEnded();
    });

    this.isInitialized = true;
  }

  // Build the Web Audio DSP Graph on first user interaction
  private static setupAudioContext(): void {
    if (this.ctx) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.sourceNode = this.ctx.createMediaElementSource(this.audio);

      // 1. Create 10-band EQ
      this.eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = this.ctx!.createBiquadFilter();
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;
        return filter;
      });

      // 2. Dynamics Compressor (Volume Normalisation)
      this.compressorNode = this.ctx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -24;
      this.compressorNode.knee.value = 30;
      this.compressorNode.ratio.value = this.isNormalized ? 4 : 1;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.25;

      // 3. Master Gain Node (Crossfading)
      this.masterGainNode = this.ctx.createGain();
      this.masterGainNode.gain.value = 1.0;

      // 4. Analyser Node (Visualizer)
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.82;

      // Chain: Source -> EQ[0..9] -> Compressor -> Gain -> Analyser -> Destination
      let lastNode: AudioNode = this.sourceNode;
      for (const filter of this.eqFilters) {
        lastNode.connect(filter);
        lastNode = filter;
      }

      lastNode.connect(this.compressorNode);
      this.compressorNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Web Audio DSP graph could not connect to element directly:', e);
    }
  }

  static async playTrack(track: Track, newQueue?: Track[]): Promise<void> {
    this.init();
    this.setupAudioContext();

    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (newQueue) {
      this.queue = [...newQueue];
      this.queueIndex = this.queue.findIndex(t => t.id === track.id);
    } else if (this.queue.length === 0) {
      this.queue = [track];
      this.queueIndex = 0;
    } else {
      const idx = this.queue.findIndex(t => t.id === track.id);
      if (idx !== -1) {
        this.queueIndex = idx;
      } else {
        this.queue.splice(this.queueIndex + 1, 0, track);
        this.queueIndex++;
      }
    }

    if (this.currentTrack && !this.currentTrackLogged) {
      this.finishTrackTelemetry(this.currentTrack, 'skipped');
    }
    this.currentTrackAccumulatedSeconds = 0;
    this.currentTrackLogged = false;
    this.lastPlayTime = Date.now();

    this.currentTrack = track;
    this.isCrossfading = false;
    if (this.masterGainNode && this.ctx) {
      this.masterGainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }

    this.audio.src = track.streamUrl;
    try {
      await this.audio.play();
    } catch (err) {
      console.error('Playback error:', err);
    }

    this.setupMediaSession(track);
    if (this.onTrackChangeCallback) {
      this.onTrackChangeCallback(track);
    }
    this.notifyQueueChange();
  }

  static togglePlay(): void {
    if (!this.currentTrack && this.queue.length > 0) {
      this.playTrack(this.queue[0]);
      return;
    }
    if (this.audio.paused) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.audio.play().catch(e => console.error('Play error:', e));
    } else {
      this.audio.pause();
    }
  }

  static pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  static isPlaying(): boolean {
    return !!this.audio && !this.audio.paused;
  }

  static seek(time: number): void {
    if (this.audio) {
      this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration || 0));
    }
  }

  static setVolume(volume: number): void {
    if (this.audio) {
      this.audio.volume = Math.max(0, Math.min(1, volume));
    }
  }

  static getVolume(): number {
    return this.audio ? this.audio.volume : 1;
  }

  // Next Track Resolution: checks priorityQueue (Play Next) first, then contextQueue
  static next(): void {
    if (this.priorityQueue.length > 0) {
      const nextPriorityTrack = this.priorityQueue.shift()!;
      this.playTrack(nextPriorityTrack);
      this.notifyQueueChange();
      return;
    }

    if (this.queue.length === 0) return;

    if (this.isShuffle) {
      this.queueIndex = Math.floor(Math.random() * this.queue.length);
    } else {
      this.queueIndex = (this.queueIndex + 1) % this.queue.length;
    }

    const nextTrack = this.queue[this.queueIndex];
    if (nextTrack) {
      this.playTrack(nextTrack);
    }
  }

  static prev(): void {
    if (this.queue.length === 0) return;

    // If played more than 3 seconds, restart current track
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
    const prevTrack = this.queue[this.queueIndex];
    if (prevTrack) {
      this.playTrack(prevTrack);
    }
  }

  private static handleTrackEnded(): void {
    this.finishTrackTelemetry(this.currentTrack, 'completed');

    // If repeat one is on, replay same track
    if (this.repeatMode === 'one' && this.currentTrack) {
      this.currentTrackAccumulatedSeconds = 0;
      this.currentTrackLogged = false;
      this.lastPlayTime = Date.now();
      this.audio.currentTime = 0;
      this.audio.play().catch(console.error);
      return;
    }

    // Check Sleep Timer "End of Track" mode
    if (this.sleepTimerMode === 'end_of_track') {
      this.audio.pause();
      this.setSleepTimer(null);
      return;
    }

    this.next();
  }

  private static finishTrackTelemetry(track: Track | null, status: 'completed' | 'skipped'): void {
    if (!track || this.currentTrackLogged) return;
    this.currentTrackLogged = true;
    const listened = this.currentTrackAccumulatedSeconds;
    if (listened >= 1) {
      RatingAndStatsService.reportPlaybackEvent(track, listened, status);
    }
  }

  // Prebuffering for Gapless playback
  private static prebufferedTrackId: string | null = null;
  private static prebufferAudio: HTMLAudioElement | null = null;

  static peekNextTrack(): Track | null {
    if (this.priorityQueue.length > 0) {
      return this.priorityQueue[0];
    }
    if (this.queue.length === 0) return null;
    const nextIdx = (this.queueIndex + 1) % this.queue.length;
    return this.queue[nextIdx] || null;
  }

  private static checkPrebuffer(): void {
    if (!this.isGapless || !this.audio.duration) return;
    const timeLeft = this.audio.duration - this.audio.currentTime;
    if (timeLeft > 5) return;

    const nextTrack = this.peekNextTrack();
    if (nextTrack && nextTrack.id !== this.prebufferedTrackId) {
      this.prebufferedTrackId = nextTrack.id;
      if (!this.prebufferAudio) {
        this.prebufferAudio = new Audio();
        this.prebufferAudio.preload = 'auto';
      }
      this.prebufferAudio.src = nextTrack.streamUrl;
    }
  }

  private static checkCrossfade(currentTime: number, duration: number): void {
    if (this.crossfadeSeconds <= 0 || !duration || this.isCrossfading) return;
    const timeLeft = duration - currentTime;
    if (timeLeft <= this.crossfadeSeconds && timeLeft > 0.3) {
      this.isCrossfading = true;
      if (this.masterGainNode && this.ctx) {
        const now = this.ctx.currentTime;
        this.masterGainNode.gain.cancelScheduledValues(now);
        this.masterGainNode.gain.setValueAtTime(1.0, now);
        this.masterGainNode.gain.linearRampToValueAtTime(0.01, now + timeLeft);
      }
    }
  }

  // ==========================================
  // PLAY QUEUE MANAGEMENT (SPOTIFY GRADE)
  // ==========================================

  static playNext(track: Track): void {
    this.priorityQueue.unshift(track);
    this.notifyQueueChange();
  }

  static addToQueue(track: Track): void {
    this.priorityQueue.push(track);
    this.notifyQueueChange();
  }

  static reorderPriorityQueue(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.priorityQueue.length || toIndex < 0 || toIndex >= this.priorityQueue.length) return;
    const [moved] = this.priorityQueue.splice(fromIndex, 1);
    this.priorityQueue.splice(toIndex, 0, moved);
    this.notifyQueueChange();
  }

  static removeFromPriorityQueue(index: number): void {
    if (index >= 0 && index < this.priorityQueue.length) {
      this.priorityQueue.splice(index, 1);
      this.notifyQueueChange();
    }
  }

  static removeFromUpcomingContext(index: number): void {
    const actualIndex = this.queueIndex + 1 + index;
    if (actualIndex > this.queueIndex && actualIndex < this.queue.length) {
      this.queue.splice(actualIndex, 1);
      this.notifyQueueChange();
    }
  }

  static clearUpcomingQueue(): void {
    this.priorityQueue = [];
    if (this.queue.length > 0 && this.queueIndex >= 0) {
      this.queue = this.queue.slice(0, this.queueIndex + 1);
    }
    this.notifyQueueChange();
  }

  static getPriorityQueue(): Track[] {
    return [...this.priorityQueue];
  }

  static getUpcomingContextQueue(): Track[] {
    if (this.queueIndex < 0 || this.queueIndex >= this.queue.length - 1) return [];
    return this.queue.slice(this.queueIndex + 1);
  }

  static onQueueChange(callback: () => void): () => void {
    this.queueListeners.push(callback);
    return () => {
      this.queueListeners = this.queueListeners.filter(cb => cb !== callback);
    };
  }

  private static notifyQueueChange(): void {
    this.queueListeners.forEach(cb => cb());
  }

  // ==========================================
  // TRANSITIONS & AUDIO TUNING SETTINGS
  // ==========================================

  static setCrossfade(seconds: number): void {
    this.crossfadeSeconds = Math.max(0, Math.min(12, seconds));
  }

  static getCrossfade(): number {
    return this.crossfadeSeconds;
  }

  static setGapless(enabled: boolean): void {
    this.isGapless = enabled;
  }

  static getGapless(): boolean {
    return this.isGapless;
  }

  static setAutomix(enabled: boolean): void {
    this.isAutomix = enabled;
  }

  static getAutomix(): boolean {
    return this.isAutomix;
  }

  static setNormalisation(enabled: boolean): void {
    this.isNormalized = enabled;
    if (this.compressorNode) {
      this.compressorNode.ratio.value = enabled ? 4 : 1;
    }
  }

  static getNormalisation(): boolean {
    return this.isNormalized;
  }

  // ==========================================
  // SLEEP TIMER
  // ==========================================

  static setSleepTimer(minutes: number | null): void {
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
      this.sleepTimerTimeout = null;
    }

    if (minutes === null || minutes === 0) {
      this.sleepTimerMode = 'off';
      this.sleepTimerEndsAt = null;
      return;
    }

    if (minutes === -1) {
      // End of song mode
      this.sleepTimerMode = 'end_of_track';
      this.sleepTimerEndsAt = null;
      return;
    }

    this.sleepTimerMode = 'duration';
    this.sleepTimerEndsAt = Date.now() + minutes * 60 * 1000;

    this.sleepTimerTimeout = setTimeout(() => {
      // Gentle fade out over 3 seconds
      if (this.masterGainNode && this.ctx) {
        const now = this.ctx.currentTime;
        this.masterGainNode.gain.cancelScheduledValues(now);
        this.masterGainNode.gain.linearRampToValueAtTime(0.001, now + 3);
      }
      setTimeout(() => {
        this.audio.pause();
        this.setSleepTimer(null);
      }, 3100);
    }, minutes * 60 * 1000);
  }

  static getSleepTimerState(): { mode: 'off' | 'duration' | 'end_of_track', endsAt: number | null } {
    return {
      mode: this.sleepTimerMode,
      endsAt: this.sleepTimerEndsAt
    };
  }

  // ==========================================
  // SHUFFLE & REPEAT
  // ==========================================

  static setShuffle(shuffle: boolean): void {
    this.isShuffle = shuffle;
  }

  static toggleShuffle(): boolean {
    this.isShuffle = !this.isShuffle;
    return this.isShuffle;
  }

  static toggleRepeat(): 'off' | 'all' | 'one' {
    if (this.repeatMode === 'off') this.repeatMode = 'all';
    else if (this.repeatMode === 'all') this.repeatMode = 'one';
    else this.repeatMode = 'off';
    return this.repeatMode;
  }

  static getRepeatMode(): 'off' | 'all' | 'one' {
    return this.repeatMode;
  }

  static getQueue(): Track[] {
    return this.queue;
  }

  static getCurrentTrack(): Track | null {
    return this.currentTrack;
  }

  // Equalizer Control
  static setEQGains(gains: number[]): void {
    if (!this.eqFilters.length) return;
    gains.forEach((gain, index) => {
      if (this.eqFilters[index]) {
        this.eqFilters[index].gain.value = Math.max(-12, Math.min(12, gain));
      }
    });
  }

  static setEQPreset(presetName: EQPresetName): number[] {
    const gains = EQ_PRESETS[presetName] || EQ_PRESETS.Flat;
    this.setEQGains(gains);
    return gains;
  }

  // Visualizer Data Access
  static getFrequencyData(array: Uint8Array): void {
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(array as any);
    }
  }

  static getTimeDomainData(array: Uint8Array): void {
    if (this.analyserNode) {
      this.analyserNode.getByteTimeDomainData(array as any);
    }
  }

  // Callbacks
  static onTimeUpdate(callback: (time: number, duration: number) => void): void {
    this.onTimeUpdateCallback = callback;
  }

  static onTrackChange(callback: (track: Track | null) => void): void {
    this.onTrackChangeCallback = callback;
  }

  static onPlayStateChange(callback: (isPlaying: boolean) => void): void {
    this.onPlayStateChangeCallback = callback;
  }

  // MediaSession API
  private static setupMediaSession(track: Track): void {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'LUMEN Hi-Fi',
      artwork: track.artworkUrl ? [
        { src: track.artworkUrl, sizes: '512x512', type: 'image/jpeg' },
        { src: track.artworkUrl, sizes: '1024x1024', type: 'image/jpeg' }
      ] : []
    });

    navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) this.seek(details.seekTime);
    });
  }

  private static updateMediaSessionState(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = this.audio && !this.audio.paused ? 'playing' : 'paused';
  }
}
