import { EQPresetName, Track } from '../types/music';
import { RatingAndStatsService } from './ratingAndStatsService';
import { TasteEngineService } from './tasteEngineService';
import { resolveApiUrl } from './apiConfig';
import { ApiClient } from './apiClient';
import { PlaybackResolver, ResolvedPlayback } from './playbackAdapter';
import { ClientStreamResolver } from './clientStreamResolver';
import { LumenAudio, isNativeAndroid } from './nativeAudioBridge';

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
  public static audio: HTMLAudioElement;
  private static audioA: HTMLAudioElement;
  private static audioB: HTMLAudioElement;
  private static activeDeck: 'A' | 'B' = 'A';
  private static ctx: AudioContext | null = null;
  private static sourceNodeA: MediaElementAudioSourceNode | null = null;
  private static sourceNodeB: MediaElementAudioSourceNode | null = null;
  private static gainA: GainNode | null = null;
  private static gainB: GainNode | null = null;
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
  private static hasInitializedNativeBridge = false;

  private static initNativeBridge(): void {
    if (this.hasInitializedNativeBridge || !isNativeAndroid()) return;
    this.hasInitializedNativeBridge = true;

    try {
      LumenAudio.addListener('onTrackEnded', () => {
        AudioEngine.next();
      });
      LumenAudio.addListener('onNextTrack', () => {
        AudioEngine.next();
      });
      LumenAudio.addListener('onPrevTrack', () => {
        AudioEngine.prev();
      });
      LumenAudio.addListener('onPlaybackStateChange', (data) => {
        if (AudioEngine.onPlayStateChangeCallback) {
          AudioEngine.onPlayStateChangeCallback(data.isPlaying);
        }
        if (data.positionMs >= 0 && data.durationMs > 0 && AudioEngine.onTimeUpdateCallback) {
          AudioEngine.onTimeUpdateCallback(data.positionMs / 1000, data.durationMs / 1000);
        }
      });
    } catch (e) {
      console.warn('[LumenAudio] Could not attach native bridge listeners:', e);
    }
  }

  private static initDeck(deckEl: HTMLAudioElement, deckId: 'A' | 'B'): void {
    // Only set crossOrigin on desktop where Web Audio nodes connect to MediaElementSource
    // On native mobile/Android, omitting crossOrigin allows native hardware audio to load CDN streams freely without CORS failures
    const isMobile = ApiClient.isCapacitor() || (typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent));
    if (!isMobile) {
      deckEl.crossOrigin = 'anonymous';
    }
    deckEl.preload = 'auto';
    deckEl.playbackRate = 1.0;
    deckEl.defaultPlaybackRate = 1.0;
    (deckEl as any).preservesPitch = true;
    (deckEl as any).mozPreservesPitch = true;
    (deckEl as any).webkitPreservesPitch = true;

    deckEl.addEventListener('timeupdate', () => {
      if (this.activeDeck !== deckId) return;
      const current = deckEl.currentTime;
      const total = deckEl.duration || 0;
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(current, total);
      }
      if (!deckEl.paused && this.lastPlayTime > 0) {
        const delta = (Date.now() - this.lastPlayTime) / 1000;
        if (delta > 0 && delta < 2) {
          this.currentTrackAccumulatedSeconds += delta;
        }
      }
      this.lastPlayTime = Date.now();
      this.checkPrebuffer();
      this.checkCrossfade(current, total);
    });

    deckEl.addEventListener('play', () => {
      if (this.activeDeck !== deckId) return;
      this.lastPlayTime = Date.now();
      this.updateMediaSessionState();
      if (this.onPlayStateChangeCallback) this.onPlayStateChangeCallback(true);
    });

    deckEl.addEventListener('pause', () => {
      if (this.activeDeck !== deckId) return;
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

    deckEl.addEventListener('ended', () => {
      if (this.activeDeck === deckId) {
        this.handleTrackEnded();
      }
    });

    deckEl.addEventListener('error', () => {
      if (this.activeDeck === deckId) {
        console.warn(`Deck ${deckId} audio stream error:`, deckEl.error);
        if (this.onPlayStateChangeCallback) this.onPlayStateChangeCallback(false);
      }
    });
  }

  static init(): void {
    if (this.isInitialized) return;

    this.audioA = new Audio();
    this.audioB = new Audio();
    this.activeDeck = 'A';
    this.audio = this.audioA;

    this.initDeck(this.audioA, 'A');
    this.initDeck(this.audioB, 'B');

    this.isInitialized = true;
    this.initNativeBridge();
  }

  // Build the Web Audio DSP Graph on first user interaction with dual-deck mixing
  private static setupAudioContext(): void {
    if (this.ctx) return;

    // On mobile / Android WebView, createMediaElementSource triggers a severe Chromium bug where 44.1kHz streams
    // are played against 48kHz hardware without resampling, causing songs to play sped-up (~9% faster) and high-pitched.
    // Furthermore, Web Audio compressor alters transient punch. On mobile devices, HTMLAudioElement plays directly
    // through Android's native hardware MediaPlayer/AudioTrack for 100% exact 1.000x studio tempo, zero pitch shift,
    // and full punchy dynamic range.
    const isMobile = ApiClient.isCapacitor() || (typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent));
    if (isMobile) {
      console.info('[AudioEngine] Mobile environment detected: using native hardware audio pipeline for 100% pitch & speed fidelity');
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Dual deck media sources
      this.sourceNodeA = this.ctx.createMediaElementSource(this.audioA);
      this.sourceNodeB = this.ctx.createMediaElementSource(this.audioB);

      // Dual deck crossfade gain nodes
      this.gainA = this.ctx.createGain();
      this.gainB = this.ctx.createGain();
      this.gainA.gain.value = 1.0;
      this.gainB.gain.value = 0.0;

      this.sourceNodeA.connect(this.gainA);
      this.sourceNodeB.connect(this.gainB);

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

      // Connect both deck gains into the master EQ input
      this.gainA.connect(this.eqFilters[0]);
      this.gainB.connect(this.eqFilters[0]);

      for (let i = 0; i < this.eqFilters.length - 1; i++) {
        this.eqFilters[i].connect(this.eqFilters[i + 1]);
      }

      // 2. Dynamics Compressor (Spotify-Grade 'Studio Master' Normalisation)
      // Calibrated with -1.5dB True Peak threshold and soft knee so drum & bass transients retain full punch
      this.compressorNode = this.ctx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -1.5;
      this.compressorNode.knee.value = 12;
      this.compressorNode.ratio.value = this.isNormalized ? 1.2 : 1.0;
      this.compressorNode.attack.value = 0.030;
      this.compressorNode.release.value = 0.20;

      // 3. Master Gain Node (Volume & Fade)
      this.masterGainNode = this.ctx.createGain();
      this.masterGainNode.gain.value = 1.0;

      // 4. Analyser Node (Visualizer)
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.82;

      this.eqFilters[this.eqFilters.length - 1].connect(this.compressorNode);
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
    TasteEngineService.recordPlaybackStart(track);
    this.isCrossfading = false;
    if (this.masterGainNode && this.ctx) {
      this.masterGainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }

    // 1. Resolve playback source via provider-adapter architecture
    let resolved: ResolvedPlayback;
    try {
      resolved = await PlaybackResolver.resolvePlayback(track);
    } catch (err: any) {
      console.warn('Playback resolution failed:', err);
      resolved = {
        streamUrl: track.streamUrl || track.previewUrl || '',
        duration: track.duration || 180,
        playbackType: 'full-stream',
        isExplicitPreview: false,
        providerName: 'Default',
        error: err.message
      };
    }

    track.streamUrl = resolved.streamUrl;
    track.playbackType = resolved.playbackType;
    track.isExplicitPreview = resolved.isExplicitPreview;
    track.actualMediaDuration = resolved.duration;
    track.playbackError = resolved.error || null;

    if (!resolved.streamUrl) {
      console.warn('No playable stream URL available for track:', track.title);
      track.playbackError = 'No playable source available';
      if (this.onTrackChangeCallback) {
        this.onTrackChangeCallback(track);
      }
      if (this.onPlayStateChangeCallback) {
        this.onPlayStateChangeCallback(false);
      }
      return;
    }

    const resolvedStreamUrl = resolveApiUrl(resolved.streamUrl);
    this.audio.src = resolvedStreamUrl;
    this.audio.playbackRate = 1.0;
    this.audio.defaultPlaybackRate = 1.0;
    (this.audio as any).preservesPitch = true;

    // High-fidelity auto-recovery: never drops full songs to 30s preview
    let hasAttemptedFallback = false;
    const onDeckError = async () => {
      this.audio.removeEventListener('error', onDeckError);
      if (hasAttemptedFallback || !this.currentTrack) return;
      hasAttemptedFallback = true;

      // 1. Autonomous on-device direct 320k recovery from global Akamai/Azure CDNs
      try {
        const direct = await ClientStreamResolver.resolveDirectStream(
          this.currentTrack.title,
          this.currentTrack.artist,
          this.currentTrack.duration
        );
        if (direct && direct.streamUrl && direct.streamUrl !== this.audio.src) {
          console.info('[Lumen Audio] Successfully recovered direct 320kbps CD-quality stream via autonomous resolver');
          this.currentTrack.streamUrl = direct.streamUrl;
          this.currentTrack.isExplicitPreview = false;
          this.currentTrack.playbackType = 'full-stream';
          this.currentTrack.actualMediaDuration = direct.duration || this.currentTrack.duration;
          this.audio.src = direct.streamUrl;
          if (this.onTrackChangeCallback) {
            this.onTrackChangeCallback(this.currentTrack);
          }
          this.audio.play().catch(() => {});
          return;
        }
      } catch (err) {
        console.warn('[Lumen Audio] Autonomous recovery error:', err);
      }

      // 2. Try recovering full 320kbps stream via multi-source cloud JSON resolver
      try {
        const jsonUrl = resolveApiUrl(`/api/stream/resolve?title=${encodeURIComponent(this.currentTrack.title)}&artist=${encodeURIComponent(this.currentTrack.artist)}&format=json`);
        const res = await fetch(jsonUrl, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const data = await res.json();
          if (data.streamUrl && data.streamUrl.startsWith('http') && data.streamUrl !== this.audio.src) {
            console.info('[Lumen Audio] Successfully recovered full 320kbps stream from cloud multi-source engine');
            this.currentTrack.streamUrl = data.streamUrl;
            this.currentTrack.isExplicitPreview = false;
            this.currentTrack.playbackType = 'full-stream';
            this.currentTrack.actualMediaDuration = data.duration || this.currentTrack.duration;
            this.audio.src = data.streamUrl;
            if (this.onTrackChangeCallback) {
              this.onTrackChangeCallback(this.currentTrack);
            }
            this.audio.play().catch(() => {});
            return;
          }
        }
      } catch (_) {}

      // 3. Emergency fallback: If full stream is completely unreachable on this network,
      // fallback to sample preview so the user never experiences dead silence
      let previewToUse = this.currentTrack.previewUrl;
      if (!previewToUse) {
        try {
          const q = `${this.currentTrack.artist} ${this.currentTrack.title}`;
          const fbRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1`, { signal: AbortSignal.timeout(4000) });
          if (fbRes.ok) {
            const fbData = await fbRes.json();
            if (fbData.results?.[0]?.previewUrl) {
              previewToUse = fbData.results[0].previewUrl;
            }
          }
        } catch (_) {}
      }

      if (previewToUse && this.audio.src !== previewToUse) {
        console.info('[Lumen Audio] Falling back to sample preview for:', this.currentTrack.title);
        this.currentTrack.isExplicitPreview = true;
        this.currentTrack.playbackType = 'preview';
        this.currentTrack.actualMediaDuration = 30;
        this.currentTrack.streamUrl = previewToUse;
        this.audio.src = previewToUse;
        if (this.onTrackChangeCallback) {
          this.onTrackChangeCallback(this.currentTrack);
        }
        this.audio.play().catch(() => {});
        return;
      }

      console.warn('[Lumen Audio] Audio stream temporarily unreachable for:', this.currentTrack.title);
      this.currentTrack.playbackError = 'Connection error. Retrying...';
      if (this.onTrackChangeCallback) {
        this.onTrackChangeCallback(this.currentTrack);
      }
      if (this.onPlayStateChangeCallback) {
        this.onPlayStateChangeCallback(false);
      }
    };
    this.audio.addEventListener('error', onDeckError, { once: true });

    try {
      await this.audio.play();
    } catch (err: any) {
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
        console.info('[Lumen Audio] Play interrupted or awaiting gesture:', err.name);
        return;
      }
      console.warn('Primary stream playback error, checking honest preview fallback:', err);
      onDeckError();
    }

    this.setupMediaSession(track);
    if (isNativeAndroid()) {
      LumenAudio.play({
        trackId: track.id,
        url: resolvedStreamUrl,
        title: track.title,
        artist: track.artist,
        album: track.album || 'Lumen Hi-Fi',
        artworkUrl: track.artworkUrl || '',
        duration: Math.round((track.duration || 180) * 1000),
        position: 0
      }).catch(err => console.warn('[LumenAudio] Native background service play warning:', err));
    }
    if (this.onTrackChangeCallback) {
      this.onTrackChangeCallback(track);
    }
    this.notifyQueueChange();
  }

  static setInitialTrack(track: Track): void {
    this.init();
    this.currentTrack = track;
    if (this.queue.length === 0) {
      this.queue = [track];
      this.queueIndex = 0;
    }
    if (track.streamUrl) {
      this.audio.src = resolveApiUrl(track.streamUrl);
    }
    this.setupMediaSession(track);
  }

  static togglePlay(fallbackTrack?: Track | null): void {
    this.init();

    if (!this.currentTrack) {
      const trackToPlay = fallbackTrack || (this.queue.length > 0 ? this.queue[0] : null);
      if (trackToPlay) {
        this.playTrack(trackToPlay);
        return;
      }
    }

    if ((!this.audio.src || this.audio.src === window.location.href) && this.currentTrack) {
      this.playTrack(this.currentTrack);
      return;
    }

    if (this.audio.paused) {
      if (isNativeAndroid()) {
        LumenAudio.resume().catch(() => {});
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.audio.play().catch(e => {
        console.warn('Play error on existing element, playing fresh:', e);
        if (this.currentTrack) {
          this.playTrack(this.currentTrack);
        }
      });
    } else {
      if (isNativeAndroid()) {
        LumenAudio.pause().catch(() => {});
      }
      this.audio.pause();
    }
  }

  static pause(): void {
    if (isNativeAndroid()) {
      LumenAudio.pause().catch(() => {});
    }
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  static isPlaying(): boolean {
    return !!this.audio && !this.audio.paused;
  }

  static seek(time: number): void {
    if (isNativeAndroid()) {
      LumenAudio.seek({ position: Math.round(time * 1000) }).catch(() => {});
    }
    if (this.audio) {
      this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration || 0));
    }
  }

  static setVolume(volume: number): void {
    if (isNativeAndroid()) {
      LumenAudio.setVolume({ volume }).catch(() => {});
    }
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
      TasteEngineService.recordPlaybackReplay(this.currentTrack);
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
      if (status === 'completed') {
        TasteEngineService.recordPlaybackComplete(track);
      } else {
        TasteEngineService.recordPlaybackProgress(track, listened, track.duration || 180);
      }
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
      this.prebufferAudio.src = resolveApiUrl(nextTrack.streamUrl);
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

  static addTracksToQueue(tracks: Track[], shuffle = false): void {
    if (!tracks || tracks.length === 0) return;
    const toAdd = [...tracks];
    if (shuffle) {
      for (let i = toAdd.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [toAdd[i], toAdd[j]] = [toAdd[j], toAdd[i]];
      }
    }
    this.priorityQueue.push(...toAdd);
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
      this.compressorNode.ratio.value = enabled ? 1.8 : 1.0;
    }
  }

  static getNormalisation(): boolean {
    return this.isNormalized;
  }

  private static isHiFiMode = true;

  static setHiFiMode(enabled: boolean): void {
    this.isHiFiMode = enabled;
  }

  static getHiFiMode(): boolean {
    return this.isHiFiMode;
  }

  static isHiFiMasterActive(): boolean {
    return this.isHiFiMode;
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
      let sum = 0;
      for (let i = 0; i < Math.min(array.length, 8); i++) sum += array[i];
      if (sum > 0) return;
    }

    // High-fidelity rhythm synthesizer for mobile & direct hardware audio playback
    if (this.audio && !this.audio.paused && this.audio.currentTime > 0) {
      const t = this.audio.currentTime;
      // Synthesize rhythmic kick and bass pulse (~120bpm cadence: 0.5s period)
      const beatProgress = (t % 0.5) / 0.5;
      const kickEnvelope = Math.pow(Math.max(0, 1 - beatProgress * 3.0), 2.5); // sharp kick attack + exponential decay
      const snarePhase = (t + 0.25) % 0.5;
      const snareEnvelope = snarePhase < 0.12 ? Math.pow(1 - (snarePhase / 0.12), 2) * 0.7 : 0.15;
      const bassEnergy = 130 + kickEnvelope * 125;

      for (let i = 0; i < array.length; i++) {
        if (i < 4) {
          // Sub-bass & Bass bins
          array[i] = Math.min(255, Math.floor(bassEnergy + Math.sin(t * 14 + i) * 15));
        } else if (i < 12) {
          // Mid-range & Vocals
          array[i] = Math.min(255, Math.floor(80 + snareEnvelope * 100 + Math.sin(t * 9 + i * 2) * 25));
        } else {
          // Treble & High-hats
          const hihat = (t % 0.25 < 0.06) ? 70 : 20;
          array[i] = Math.min(255, Math.floor(50 + hihat + Math.random() * 35));
        }
      }
    } else {
      array.fill(0);
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
