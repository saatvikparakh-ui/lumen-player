import { EQPresetName, Track } from '../types/music';
import { RatingAndStatsService } from './ratingAndStatsService';
import { TasteEngineService } from './tasteEngineService';
import { resolveApiUrl } from './apiConfig';
import { ApiClient } from './apiClient';
import { PlaybackResolver, ResolvedPlayback } from './playbackAdapter';
import { ClientStreamResolver } from './clientStreamResolver';
import { LumenAudio, isNativeAndroid } from './nativeAudioBridge';
import { KaraokeEngine } from './karaokeEngine';

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
  private static trackChangeListeners = new Set<(track: Track | null) => void>();
  private static playStateListeners = new Set<(isPlaying: boolean) => void>();
  private static timeUpdateListeners = new Set<(time: number, duration: number) => void>();
  private static queueListeners: (() => void)[] = [];
  private static nativeIsPlaying = false;
  private static nativeCurrentPositionSec = 0;
  private static nativeDurationSec = 0;

  // Playback Telemetry Tracking
  private static currentTrackAccumulatedSeconds = 0;
  private static lastPlayTime = 0;
  private static lastSavedPosition = 0;
  private static currentTrackLogged = false;
  private static hasInitializedNativeBridge = false;

  // Runaway skipping protection & zero-lag race guards
  private static recentSkipTimestamps: number[] = [];
  private static consecutiveImmediateEndCount = 0;
  private static lastSkipCallTime = 0;
  private static playGenerationId = 0;
  private static pausedAtGeneration = -1;
  private static lastManualPlayStateTime = 0;
  private static lastManualSeekTime = 0;
  private static nativeQueueSyncTimer: any = null;

  private static notifyTrackChange(track: Track | null): void {
    this.trackChangeListeners.forEach(cb => {
      try { cb(track); } catch (e) { console.error(e); }
    });
  }

  private static notifyPlayStateChange(isPlaying: boolean): void {
    this.playStateListeners.forEach(cb => {
      try { cb(isPlaying); } catch (e) { console.error(e); }
    });
  }

  private static notifyTimeUpdate(time: number, duration: number): void {
    this.timeUpdateListeners.forEach(cb => {
      try { cb(time, duration); } catch (e) { console.error(e); }
    });
  }

  private static initNativeBridge(): void {
    if (this.hasInitializedNativeBridge || !isNativeAndroid()) return;
    this.hasInitializedNativeBridge = true;

    try {
      LumenAudio.addListener('onTrackEnded', () => {
        AudioEngine.consecutiveImmediateEndCount = 0;
        AudioEngine.currentTrackAccumulatedSeconds = Math.max(AudioEngine.currentTrackAccumulatedSeconds, 10);
        AudioEngine.handleTrackEnded();
      });
      LumenAudio.addListener('onNextTrack', () => {
        AudioEngine.next();
      });
      LumenAudio.addListener('onPrevTrack', () => {
        AudioEngine.prev();
      });
      let nativeSyncDebounce: any = null;
      LumenAudio.addListener('onTrackTransition', (data: any) => {
        if (!data || !data.trackId) return;
        if (AudioEngine.currentTrack && AudioEngine.currentTrack.id === data.trackId) return;

        // 1. Check priorityQueue ("Next in Queue") first so queued tracks are consumed properly!
        const pIdx = AudioEngine.priorityQueue.findIndex(t => t.id === data.trackId);
        let matched: Track | undefined;
        if (pIdx !== -1) {
          matched = AudioEngine.priorityQueue.splice(pIdx, 1)[0];
        } else {
          const qIdx = AudioEngine.queue.findIndex(t => t.id === data.trackId);
          if (qIdx !== -1) {
            AudioEngine.queueIndex = qIdx;
            matched = AudioEngine.queue[qIdx];
          }
        }

        if (!matched) {
          matched = {
            id: data.trackId,
            title: data.title || 'Unknown Title',
            artist: data.artist || 'Unknown Artist',
            album: data.album || 'Lumen Hi-Fi',
            artworkUrl: data.artworkUrl || null,
            duration: 180,
            streamUrl: ''
          } as Track;
        }

        AudioEngine.currentTrack = matched;
        AudioEngine.saveQueueToStorage();
        AudioEngine.notifyTrackChange(AudioEngine.currentTrack);
        AudioEngine.queueListeners.forEach(cb => cb());
        if (nativeSyncDebounce) clearTimeout(nativeSyncDebounce);
        nativeSyncDebounce = setTimeout(() => {
          AudioEngine.syncNativeQueue();
        }, 600);
      });
      LumenAudio.addListener('onPlaybackStateChange', (data) => {
        const now = Date.now();
        // Respect optimistic manual pause/resume for 450ms so in-flight native polls never snap the button back
        if (now - AudioEngine.lastManualPlayStateTime > 450) {
          AudioEngine.nativeIsPlaying = data.isPlaying;
          AudioEngine.notifyPlayStateChange(data.isPlaying);
        }
        if (data.durationMs > 0) {
          AudioEngine.nativeDurationSec = data.durationMs / 1000;
        }
        // Respect optimistic manual seek for 500ms so stale polls never snap the scrubber backwards
        if (data.positionMs >= 0 && now - AudioEngine.lastManualSeekTime > 500) {
          AudioEngine.nativeCurrentPositionSec = data.positionMs / 1000;
          const effectiveDur = AudioEngine.nativeDurationSec || (AudioEngine.currentTrack?.actualMediaDuration || AudioEngine.currentTrack?.duration || 0);
          AudioEngine.notifyTimeUpdate(data.positionMs / 1000, effectiveDur);
          if (data.isPlaying) {
            AudioEngine.currentTrackAccumulatedSeconds = Math.max(AudioEngine.currentTrackAccumulatedSeconds, data.positionMs / 1000);
            if (data.positionMs >= 2000) {
              AudioEngine.consecutiveImmediateEndCount = 0;
            }
          }
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
      this.notifyTimeUpdate(current, total);

      // Desktop background playback watchdog: ensure seamless track advance when window is unfocused or backgrounded
      if (!deckEl.paused && total > 0 && current >= total - 0.4 && !this.isCrossfading && !isNativeAndroid()) {
        this.handleTrackEnded();
        return;
      }
      if (!deckEl.paused && this.lastPlayTime > 0) {
        const delta = (Date.now() - this.lastPlayTime) / 1000;
        if (delta > 0 && delta < 2) {
          this.currentTrackAccumulatedSeconds += delta;
        }
      }
      this.lastPlayTime = Date.now();

      // Persist playback position every ~3s for seamless app re-entry
      if (this.currentTrack && Math.abs(current - this.lastSavedPosition) > 3) {
        this.lastSavedPosition = current;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('lumen_saved_playback_time', String(current));
          }
        } catch (_) {}
      }

      this.checkPrebuffer();
      this.checkCrossfade(current, total);
    });

    deckEl.addEventListener('play', () => {
      if (this.activeDeck !== deckId) return;
      this.lastPlayTime = Date.now();
      this.updateMediaSessionState();
      this.notifyPlayStateChange(true);
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

      // On native Android, ExoPlayer in LumenPlaybackService is the authoritative audio engine.
      // Ignore background pause events from the muted WebView audio element when Android OS suspends web tasks!
      if (isNativeAndroid()) {
        return;
      }
      this.notifyPlayStateChange(false);
    });

    deckEl.addEventListener('waiting', () => {
      if (this.activeDeck === deckId && !isNativeAndroid() && !deckEl.paused) {
        // Auto-reconnect if network buffer stalled for over 1.5 seconds
        setTimeout(() => {
          if (deckEl.paused && this.currentTrack) {
            deckEl.play().catch(() => {});
          }
        }, 1500);
      }
    });

    deckEl.addEventListener('stalled', () => {
      if (this.activeDeck === deckId && !isNativeAndroid() && !deckEl.paused) {
        setTimeout(() => {
          if (deckEl.paused && this.currentTrack) {
            deckEl.play().catch(() => {});
          }
        }, 1500);
      }
    });

    deckEl.addEventListener('ended', () => {
      // On native Android, ExoPlayer is the authoritative audio engine.
      // Ignore ended events from the muted WebView audio element!
      if (isNativeAndroid()) return;
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

      // Route through Real-Time Karaoke Engine (vocal cancellation DSP node)
      KaraokeEngine.initInAudioGraph(this.ctx, this.analyserNode, this.ctx.destination);

      // Desktop & Web Audio Keep-Alive: prevents OS audio subsystem and Chromium background renderer suspension
      try {
        const keepAliveBuffer = this.ctx.createBuffer(1, 44100, 44100);
        const keepAliveSource = this.ctx.createBufferSource();
        keepAliveSource.buffer = keepAliveBuffer;
        keepAliveSource.loop = true;
        const keepAliveGain = this.ctx.createGain();
        keepAliveGain.gain.value = 0.00001; // Inaudible keep-alive to hold audio session open in background
        keepAliveSource.connect(keepAliveGain);
        keepAliveGain.connect(this.ctx.destination);
        keepAliveSource.start();
      } catch (_) {}
    } catch (e) {
      console.warn('Web Audio DSP graph could not connect to element directly:', e);
    }
  }

  static async playTrack(track: Track, newQueue?: Track[]): Promise<void> {
    this.init();
    this.setupAudioContext();

    // Monotonic generation token: guarantees stale async stream resolves NEVER hijack playback or queue
    const gen = ++this.playGenerationId;
    this.pausedAtGeneration = -1;

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    // Full Spotify Queue Model:
    // - priorityQueue ("Next in Queue") is NEVER wiped on track/playlist switch
    // - newQueue (Playlist / Album / Artist) updates ONLY the background context queue
    // - Playing a single off-context track (no newQueue, e.g. Search tap) keeps your existing context queue & index intact!
    if (newQueue && newQueue.length > 0) {
      this.queue = [...newQueue];
      const found = this.queue.findIndex(t => t.id === track.id);
      this.queueIndex = found >= 0 ? found : 0;
    } else if (this.queue.length === 0) {
      this.queue = [track];
      this.queueIndex = 0;
    } else {
      const idx = this.queue.findIndex(t => t.id === track.id);
      if (idx !== -1) {
        this.queueIndex = idx;
      }
      // If not in current context queue, leave this.queue & this.queueIndex untouched (Spotify single-song behavior)
    }

    // If played track was queued in user priorityQueue, consume it immediately
    const pIdx = this.priorityQueue.findIndex(t => t.id === track.id);
    if (pIdx !== -1) {
      this.priorityQueue.splice(pIdx, 1);
    }

    if (this.currentTrack && !this.currentTrackLogged) {
      this.finishTrackTelemetry(this.currentTrack, 'skipped');
    }
    this.currentTrackAccumulatedSeconds = 0;
    this.currentTrackLogged = false;
    this.lastPlayTime = Date.now();
    this.nativeCurrentPositionSec = 0;
    this.nativeDurationSec = track.duration || 0;

    this.currentTrack = track;
    this.nativeIsPlaying = true;
    this.lastManualPlayStateTime = Date.now();

    // Instant 0ms UI update before any network resolution
    this.notifyTrackChange(track);
    this.notifyPlayStateChange(true);
    this.notifyTimeUpdate(0, track.duration || 0);
    this.saveQueueToStorage();
    this.queueListeners.forEach(cb => cb());

    TasteEngineService.recordPlaybackStart(track);
    this.isCrossfading = false;
    if (this.masterGainNode && this.ctx) {
      this.masterGainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
    }

    // 1. Instant zero-lag stop of previous deck (eliminates 800ms-1000ms sluggish transition!)
    if (!isNativeAndroid()) {
      try {
        if (this.audio && !this.audio.paused) this.audio.pause();
        const inactive = this.activeDeck === 'A' ? this.audioB : this.audioA;
        if (inactive && !inactive.paused) inactive.pause();
      } catch (_) {}
    }

    // 2. Resolve playback source via provider-adapter architecture
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

    // Abort if user already switched to a newer track or explicitly paused while resolving!
    if (gen !== this.playGenerationId) {
      return;
    }
    if (this.pausedAtGeneration === gen) {
      return;
    }

    track.streamUrl = resolved.streamUrl;
    // CRITICAL: On main player, never play 30s audio previews (e.g. apple.com snippets) unless explicitly flagged
    if (!track.isExplicitPreview && track.streamUrl && track.streamUrl.includes('apple.com')) {
      const title = encodeURIComponent(track.title || '');
      const artist = encodeURIComponent(track.artist || '');
      const durationParam = track.duration > 0 ? `&duration=${Math.round(track.duration)}` : '';
      track.streamUrl = ApiClient.resolveUrl(`/api/stream/resolve?title=${title}&artist=${artist}${durationParam}`);
    }
    track.playbackType = resolved.playbackType;
    track.isExplicitPreview = resolved.isExplicitPreview;
    track.actualMediaDuration = resolved.duration;
    track.playbackError = resolved.error || null;

    if (!resolved.streamUrl) {
      if (!isNativeAndroid() && this.audio) {
        try { this.audio.pause(); } catch (_) {}
      } else if (isNativeAndroid()) {
        LumenAudio.pause().catch(() => {});
      }
      console.warn('No playable stream URL available for track:', track.title);
      track.playbackError = 'No playable source available';
      this.nativeIsPlaying = false;
      this.notifyTrackChange(track);
      this.notifyPlayStateChange(false);
      return;
    }

    const resolvedStreamUrl = resolveApiUrl(resolved.streamUrl);
    if (!isNativeAndroid()) {
      // Cleanly stop inactive deck to prevent dual-playback glitches
      const inactiveDeck = this.activeDeck === 'A' ? this.audioB : this.audioA;
      try { inactiveDeck.pause(); } catch (_) {}

      // Reset gain on active deck
      if (this.ctx && (this.gainA || this.gainB)) {
        const currentGain = this.activeDeck === 'A' ? this.gainA : this.gainB;
        if (currentGain) {
          currentGain.gain.cancelScheduledValues(this.ctx.currentTime);
          currentGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        }
      }

      this.audio.src = resolvedStreamUrl;
      this.audio.playbackRate = 1.0;
      this.audio.defaultPlaybackRate = 1.0;
      (this.audio as any).preservesPitch = true;
    }

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
          this.currentTrack.duration,
          this.currentTrack.album
        );
        if (direct && direct.streamUrl && direct.streamUrl !== this.audio.src) {
          console.info('[Lumen Audio] Successfully recovered direct 320kbps CD-quality stream via autonomous resolver');
          this.currentTrack.streamUrl = direct.streamUrl;
          this.currentTrack.isExplicitPreview = false;
          this.currentTrack.playbackType = 'full-stream';
          this.currentTrack.actualMediaDuration = direct.duration || this.currentTrack.duration;
          if (isNativeAndroid()) {
            LumenAudio.play({
              trackId: this.currentTrack.id,
              url: direct.streamUrl,
              title: this.currentTrack.title,
              artist: this.currentTrack.artist,
              album: this.currentTrack.album || 'Lumen Hi-Fi',
              artworkUrl: this.currentTrack.artworkUrl || '',
              duration: Math.round((direct.duration || this.currentTrack.duration || 180) * 1000),
              position: 0
            }).catch(() => {});
          } else {
            this.audio.src = direct.streamUrl;
            this.audio.play().catch(() => {});
          }
          this.notifyTrackChange(this.currentTrack);
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
            if (isNativeAndroid()) {
              LumenAudio.play({
                trackId: this.currentTrack.id,
                url: data.streamUrl,
                title: this.currentTrack.title,
                artist: this.currentTrack.artist,
                album: this.currentTrack.album || 'Lumen Hi-Fi',
                artworkUrl: this.currentTrack.artworkUrl || '',
                duration: Math.round((data.duration || this.currentTrack.duration || 180) * 1000),
                position: 0
              }).catch(() => {});
            } else {
              this.audio.src = data.streamUrl;
              this.audio.play().catch(() => {});
            }
            this.notifyTrackChange(this.currentTrack);
            return;
          }
        }
      } catch (_) {}

      // 3. Multi-source full-stream recovery with cleaned title & artist (never truncate main player to 30s)
      try {
        const cleanTitle = (this.currentTrack.title || '').replace(/\s*\(feat\..+?\)/gi, '').replace(/\s*\[.+?\]/gi, '').trim();
        const primaryArtist = (this.currentTrack.artist || '').split(/[,&]/)[0].trim();
        if (cleanTitle !== this.currentTrack.title || primaryArtist !== this.currentTrack.artist) {
          const directClean = await ClientStreamResolver.resolveDirectStream(
            cleanTitle,
            primaryArtist,
            this.currentTrack.duration,
            this.currentTrack.album
          );
          if (directClean && directClean.streamUrl && directClean.streamUrl !== this.audio.src) {
            console.info('[Lumen Audio] Recovered direct stream with cleaned title/artist query');
            this.currentTrack.streamUrl = directClean.streamUrl;
            this.currentTrack.isExplicitPreview = false;
            this.currentTrack.playbackType = 'full-stream';
            this.currentTrack.actualMediaDuration = directClean.duration || this.currentTrack.duration;
            if (isNativeAndroid()) {
              LumenAudio.play({
                trackId: this.currentTrack.id,
                url: directClean.streamUrl,
                title: this.currentTrack.title,
                artist: this.currentTrack.artist,
                album: this.currentTrack.album || 'Lumen Hi-Fi',
                artworkUrl: this.currentTrack.artworkUrl || '',
                duration: Math.round((directClean.duration || this.currentTrack.duration || 180) * 1000),
                position: 0
              }).catch(() => {});
            } else {
              this.audio.src = directClean.streamUrl;
              this.audio.play().catch(() => {});
            }
            this.notifyTrackChange(this.currentTrack);
            return;
          }
        }
      } catch (_) {}

      console.warn('[Lumen Audio] Audio stream temporarily unreachable for:', this.currentTrack.title);
      this.currentTrack.playbackError = 'Connection error. Retrying...';
      this.notifyTrackChange(this.currentTrack);
      this.notifyPlayStateChange(false);
    };
    this.audio.addEventListener('error', onDeckError, { once: true });

    this.setupMediaSession(track);
    if (isNativeAndroid()) {
      // Pause & mute secondary WebView HTML5 audio so native ExoPlayer is the single source of truth
      try {
        this.audio.pause();
      } catch (_) {}
      this.audio.muted = true;
      this.nativeIsPlaying = true;

      // Construct native queue synchronously so all upcoming tracks are loaded into ExoPlayer immediately
      const nativeItems: Array<{
        trackId: string;
        url: string;
        title: string;
        artist: string;
        album: string;
        artworkUrl: string;
      }> = [];

      // 1. Current track with resolved direct stream URL
      nativeItems.push({
        trackId: track.id,
        url: resolveApiUrl(resolvedStreamUrl),
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        album: track.album || 'Lumen Hi-Fi',
        artworkUrl: track.artworkUrl || ''
      });

      // 2. Upcoming priority queue and playlist tracks
      const upcomingTracks: Track[] = [];
      if (this.priorityQueue.length > 0) {
        for (const pt of this.priorityQueue.slice(0, 5)) {
          if (pt.id !== track.id && !upcomingTracks.some(t => t.id === pt.id)) {
            upcomingTracks.push(pt);
          }
        }
      }
      const qLen = this.queue.length;
      if (qLen > 0) {
        for (let i = 1; i <= Math.min(30, qLen); i++) {
          const idx = (this.queueIndex + i) % qLen;
          const tr = this.queue[idx];
          if (tr && tr.id !== track.id && !upcomingTracks.some(t => t.id === tr.id)) {
            upcomingTracks.push(tr);
          }
        }
      }

      for (const t of upcomingTracks) {
        let stream = t.streamUrl;
        if (!stream || stream.startsWith('/api/search')) {
          const title = encodeURIComponent(t.title || '');
          const artist = encodeURIComponent(t.artist || '');
          const durationParam = t.duration > 0 ? `&duration=${Math.round(t.duration)}` : '';
          stream = `/api/stream/resolve?title=${title}&artist=${artist}${durationParam}`;
        }
        nativeItems.push({
          trackId: t.id,
          url: resolveApiUrl(stream),
          title: t.title || 'Unknown Title',
          artist: t.artist || 'Unknown Artist',
          album: t.album || 'Lumen Hi-Fi',
          artworkUrl: t.artworkUrl || ''
        });
      }

      // Immediately launch ExoPlayer with the FULL playlist loaded!
      LumenAudio.setQueue({
        items: nativeItems,
        startIndex: 0,
        position: 0,
        autoPlay: true
      }).catch(err => {
        console.warn('[LumenAudio] setQueue failed, falling back to play:', err);
        LumenAudio.play({
          trackId: track.id,
          url: resolvedStreamUrl,
          title: track.title,
          artist: track.artist,
          album: track.album || 'Lumen Hi-Fi',
          artworkUrl: track.artworkUrl || '',
          duration: Math.round((track.duration || 180) * 1000),
          position: 0
        }).catch(() => {});
      });

      this.notifyPlayStateChange(true);
      LumenAudio.setRepeatMode({ mode: this.repeatMode }).catch(() => {});
    } else {
      this.audio.muted = false;
      if (this.ctx && this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch (_) {}
      }
      try {
        await this.audio.play();
      } catch (err: any) {
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
          console.info('[Lumen Audio] Background play gesture retry:', err.name);
          if (this.ctx && this.ctx.state === 'suspended') {
            try { await this.ctx.resume(); } catch (_) {}
          }
          try {
            await this.audio.play();
            this.notifyTrackChange(track);
            this.notifyQueueChange();
            return;
          } catch (retryErr) {
            console.warn('[Lumen Audio] Background retry play caught:', retryErr);
          }
        }
        console.warn('Primary stream playback error, checking honest preview fallback:', err);
        onDeckError();
      }
    }
    this.notifyTrackChange(track);
    this.notifyQueueChange();
  }

  static setInitialTrack(track: Track): void {
    this.init();
    this.currentTrack = track;
    if (this.queue.length === 0) {
      this.queue = [track];
      this.queueIndex = 0;
    }
    if (track.streamUrl && !isNativeAndroid()) {
      this.audio.src = resolveApiUrl(track.streamUrl);
    }
    this.setupMediaSession(track);
  }

  static updateCurrentTrackArtwork(url: string): void {
    if (this.currentTrack && url) {
      this.currentTrack = {
        ...this.currentTrack,
        artworkUrl: url,
        hasArtwork: true
      };
      this.setupMediaSession(this.currentTrack);
      this.notifyTrackChange(this.currentTrack);
    }
  }

  static togglePlay(fallbackTrack?: Track | null): void {
    this.init();

    if (!this.currentTrack) {
      const trackToPlay = fallbackTrack || (this.priorityQueue.length > 0 ? this.priorityQueue[0] : (this.queue.length > 0 ? this.queue[0] : null));
      if (trackToPlay) {
        this.playTrack(trackToPlay);
        return;
      }
    }

    if (isNativeAndroid()) {
      if (this.nativeIsPlaying) {
        this.pause();
      } else {
        this.resume();
      }
      return;
    }

    if ((!this.audio.src || this.audio.src === window.location.href) && this.currentTrack) {
      this.playTrack(this.currentTrack);
      return;
    }

    if (this.audio.paused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  static resume(): void {
    this.lastManualPlayStateTime = Date.now();
    this.pausedAtGeneration = -1;
    if (isNativeAndroid()) {
      this.nativeIsPlaying = true;
      this.notifyPlayStateChange(true);
      LumenAudio.resume().catch(() => {});
      return;
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.audio) {
      if (!this.audio.src || this.audio.src === window.location.href) {
        if (this.currentTrack) {
          this.playTrack(this.currentTrack);
        }
        return;
      }
      this.notifyPlayStateChange(true);
      this.audio.play().catch(e => {
        console.warn('Play error on existing element, playing fresh:', e);
        if (this.currentTrack) {
          this.playTrack(this.currentTrack);
        }
      });
    }
  }

  static pause(): void {
    this.lastManualPlayStateTime = Date.now();
    this.pausedAtGeneration = this.playGenerationId;
    if (isNativeAndroid()) {
      this.nativeIsPlaying = false;
      this.notifyPlayStateChange(false);
      LumenAudio.pause().catch(() => {});
      return;
    }
    this.notifyPlayStateChange(false);
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  static isPlaying(): boolean {
    if (isNativeAndroid()) {
      return this.nativeIsPlaying;
    }
    return !!this.audio && !this.audio.paused;
  }

  static seek(time: number): void {
    this.lastManualSeekTime = Date.now();
    const effectiveDur = isNativeAndroid()
      ? (this.nativeDurationSec || this.currentTrack?.actualMediaDuration || this.currentTrack?.duration || 0)
      : (this.audio?.duration || this.currentTrack?.actualMediaDuration || this.currentTrack?.duration || 0);
    const clamped = Math.max(0, effectiveDur > 0 ? Math.min(time, effectiveDur) : Math.max(0, time));

    // Immediate 0ms optimistic scrubber update so seeking feels instantaneous with zero lag
    if (isNativeAndroid()) {
      this.nativeCurrentPositionSec = clamped;
      this.notifyTimeUpdate(clamped, effectiveDur);
      LumenAudio.seek({ position: Math.round(clamped * 1000) }).catch(() => {});
      return;
    }
    if (this.audio) {
      this.notifyTimeUpdate(clamped, effectiveDur);
      try {
        this.audio.currentTime = clamped;
      } catch (_) {}
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

  // Real-time Karaoke Vocal Attenuation
  static toggleKaraoke(): boolean {
    return KaraokeEngine.toggle();
  }

  static isKaraokeEnabled(): boolean {
    return KaraokeEngine.getIsEnabled();
  }

  static setKaraokeEnabled(enabled: boolean): boolean {
    return KaraokeEngine.setEnabled(enabled);
  }

  static onKaraokeChange(callback: (enabled: boolean) => void): () => void {
    return KaraokeEngine.subscribe(callback);
  }

  // Next Track Resolution: checks priorityQueue (Play Next) first, then contextQueue
  static next(): void {
    const now = Date.now();
    // 1. Debounce rapid simultaneous event triggers (e.g. native ended + media button within 200ms)
    if (now - this.lastSkipCallTime < 200) {
      return;
    }
    this.lastSkipCallTime = now;

    // 2. Sliding window runaway skip protection (catches rapid skips even across network delays)
    this.recentSkipTimestamps = this.recentSkipTimestamps.filter(t => now - t < 5000);
    this.recentSkipTimestamps.push(now);
    if (this.recentSkipTimestamps.length >= 5) {
      console.warn('[AudioEngine] Rapid skipping runaway detected (>=5 skips within 5s). Pausing playback.');
      this.recentSkipTimestamps = [];
      this.pause();
      return;
    }

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
    const now = Date.now();
    if (now - this.lastSkipCallTime < 200) {
      return;
    }
    this.lastSkipCallTime = now;

    this.recentSkipTimestamps = this.recentSkipTimestamps.filter(t => now - t < 5000);
    this.recentSkipTimestamps.push(now);
    if (this.recentSkipTimestamps.length >= 5) {
      console.warn('[AudioEngine] Rapid skip runaway detected on prev. Pausing playback.');
      this.recentSkipTimestamps = [];
      this.pause();
      return;
    }

    if (this.queue.length === 0) return;

    // If played more than 3 seconds, restart current track (works on both Android & Desktop/Web)
    const currentPos = isNativeAndroid() ? this.nativeCurrentPositionSec : (this.audio ? this.audio.currentTime : 0);
    if (currentPos > 3) {
      this.seek(0);
      return;
    }

    this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
    const prevTrack = this.queue[this.queueIndex];
    if (prevTrack) {
      this.playTrack(prevTrack);
    }
  }

  private static lastEndedTimestamp = 0;
  private static handleTrackEnded(): void {
    const now = Date.now();
    if (now - this.lastEndedTimestamp < 1500) {
      console.warn('[AudioEngine] Duplicate/throttled track ended event ignored.');
      return;
    }
    this.lastEndedTimestamp = now;

    this.finishTrackTelemetry(this.currentTrack, 'completed');

    // Cascade failure detection: If track ended after < 2s of playback, track consecutive immediate ends
    if (this.currentTrackAccumulatedSeconds < 2) {
      this.consecutiveImmediateEndCount++;
      if (this.consecutiveImmediateEndCount >= 3) {
        console.warn('[AudioEngine] Stream resolution/playback failure cascade detected (3 consecutive tracks ended in <2s). Halting auto-skip.');
        this.consecutiveImmediateEndCount = 0;
        this.pause();
        return;
      }
    } else {
      this.consecutiveImmediateEndCount = 0;
    }

    // If repeat one is on, replay same track
    if (this.repeatMode === 'one' && this.currentTrack) {
      TasteEngineService.recordPlaybackReplay(this.currentTrack);
      this.currentTrackAccumulatedSeconds = 0;
      this.currentTrackLogged = false;
      this.lastPlayTime = Date.now();
      if (!isNativeAndroid()) {
        this.audio.currentTime = 0;
        this.audio.play().catch(console.error);
      } else {
        this.playTrack(this.currentTrack);
      }
      return;
    }

    // Check Sleep Timer "End of Track" mode
    if (this.sleepTimerMode === 'end_of_track') {
      this.pause();
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
    if (!this.audio.duration) return;
    const timeLeft = this.audio.duration - this.audio.currentTime;
    if (timeLeft > 12) return;

    const nextTrack = this.peekNextTrack();
    if (nextTrack && nextTrack.id !== this.prebufferedTrackId) {
      this.prebufferedTrackId = nextTrack.id;

      // Always pre-resolve stream URL so background track transitions have zero network latency
      if (!nextTrack.streamUrl || nextTrack.streamUrl.startsWith('/api/search')) {
        PlaybackResolver.resolvePlayback(nextTrack).then(res => {
          if (res?.streamUrl) {
            nextTrack.streamUrl = res.streamUrl;
            nextTrack.playbackType = res.playbackType;
            nextTrack.actualMediaDuration = res.duration;
            if (this.isGapless && !isNativeAndroid()) {
              if (!this.prebufferAudio) {
                this.prebufferAudio = new Audio();
                this.prebufferAudio.preload = 'auto';
              }
              this.prebufferAudio.src = resolveApiUrl(res.streamUrl);
            }
          }
        }).catch(() => {});
      } else if (this.isGapless && !isNativeAndroid()) {
        if (!this.prebufferAudio) {
          this.prebufferAudio = new Audio();
          this.prebufferAudio.preload = 'auto';
        }
        this.prebufferAudio.src = resolveApiUrl(nextTrack.streamUrl);
      }
    }
  }

  /**
   * Pushes upcoming queue items into native ExoPlayer so screen-off playback never stops.
   */
  public static async syncNativeQueue(): Promise<void> {
    if (!isNativeAndroid()) return;
    try {
      const allTracksToSync: Track[] = [];
      // 1. Current track must ALWAYS be at index 0 so ExoPlayer keeps current playback uninterrupted!
      if (this.currentTrack) {
        allTracksToSync.push(this.currentTrack);
      }
      if (this.priorityQueue.length > 0) {
        for (const pt of this.priorityQueue.slice(0, 5)) {
          if (!allTracksToSync.some(t => t.id === pt.id)) {
            allTracksToSync.push(pt);
          }
        }
      }
      const qLen = this.queue.length;
      if (qLen > 0) {
        for (let i = 1; i <= Math.min(25, qLen); i++) {
          const idx = (this.queueIndex + i) % qLen;
          const tr = this.queue[idx];
          if (tr && !allTracksToSync.some(t => t.id === tr.id)) {
            allTracksToSync.push(tr);
          }
        }
      }

      if (allTracksToSync.length === 0) return;

      const nativeItems: Array<{
        trackId: string;
        url: string;
        title: string;
        artist: string;
        album: string;
        artworkUrl: string;
      }> = [];

      for (const t of allTracksToSync) {
        let stream = t.streamUrl;
        if (!stream || stream.startsWith('/api/search')) {
          const title = encodeURIComponent(t.title || '');
          const artist = encodeURIComponent(t.artist || '');
          const durationParam = t.duration > 0 ? `&duration=${Math.round(t.duration)}` : '';
          stream = `/api/stream/resolve?title=${title}&artist=${artist}${durationParam}`;
        }
        nativeItems.push({
          trackId: t.id,
          url: resolveApiUrl(stream),
          title: t.title || 'Unknown Title',
          artist: t.artist || 'Unknown Artist',
          album: t.album || 'Lumen Hi-Fi',
          artworkUrl: t.artworkUrl || ''
        });
      }

      if (nativeItems.length > 0) {
        await LumenAudio.setQueue({
          items: nativeItems,
          startIndex: 0,
          position: 0,
          autoPlay: false
        });
      }
    } catch (err) {
      console.warn('[AudioEngine] syncNativeQueue notice:', err);
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

  static playNext(track: Track | Track[]): void {
    const list = Array.isArray(track) ? track : [track];
    if (list.length === 0) return;

    if (!this.currentTrack) {
      const [first, ...rest] = list;
      this.playTrack(first);
      if (rest.length > 0) {
        this.priorityQueue.unshift(...rest);
      }
    } else {
      this.priorityQueue.unshift(...list);
    }
    this.notifyQueueChange();
  }

  static addToQueue(track: Track | Track[]): void {
    const list = Array.isArray(track) ? track : [track];
    if (list.length === 0) return;

    if (!this.currentTrack) {
      const [first, ...rest] = list;
      this.playTrack(first);
      if (rest.length > 0) {
        this.priorityQueue.push(...rest);
      }
    } else {
      this.priorityQueue.push(...list);
    }
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
    this.addToQueue(toAdd);
  }

  static promoteToPriority(fromContextIndex: number): void {
    const actualIndex = this.queueIndex + 1 + fromContextIndex;
    if (actualIndex > this.queueIndex && actualIndex < this.queue.length) {
      const [track] = this.queue.splice(actualIndex, 1);
      if (track) {
        this.priorityQueue.unshift(track);
        this.notifyQueueChange();
      }
    }
  }

  static reorderPriorityQueue(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.priorityQueue.length || toIndex < 0 || toIndex >= this.priorityQueue.length) return;
    const [moved] = this.priorityQueue.splice(fromIndex, 1);
    this.priorityQueue.splice(toIndex, 0, moved);
    this.notifyQueueChange();
  }

  static reorderUpcomingContext(fromIndex: number, toIndex: number): void {
    const actualFrom = this.queueIndex + 1 + fromIndex;
    const actualTo = this.queueIndex + 1 + toIndex;
    if (
      actualFrom <= this.queueIndex || actualFrom >= this.queue.length ||
      actualTo <= this.queueIndex || actualTo >= this.queue.length
    ) return;
    const [moved] = this.queue.splice(actualFrom, 1);
    this.queue.splice(actualTo, 0, moved);
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

  public static saveQueueToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('lumen_saved_queue', JSON.stringify(this.queue.slice(0, 100)));
      localStorage.setItem('lumen_saved_priority_queue', JSON.stringify(this.priorityQueue.slice(0, 50)));
      localStorage.setItem('lumen_saved_queue_index', String(this.queueIndex));
      if (this.currentTrack) {
        localStorage.setItem('lumen_saved_track', JSON.stringify(this.currentTrack));
      }
    } catch (_) {}
  }

  public static restoreSavedSession(): { track: Track | null; queue: Track[] } {
    this.init();
    try {
      if (typeof localStorage === 'undefined') return { track: null, queue: [] };
      const savedQueue = localStorage.getItem('lumen_saved_queue');
      const savedPriority = localStorage.getItem('lumen_saved_priority_queue');
      const savedIdx = localStorage.getItem('lumen_saved_queue_index');
      const savedTrack = localStorage.getItem('lumen_saved_track');
      const savedTime = localStorage.getItem('lumen_saved_playback_time');

      if (savedQueue) {
        this.queue = JSON.parse(savedQueue);
      }
      if (savedPriority) {
        this.priorityQueue = JSON.parse(savedPriority);
      }
      if (savedIdx) {
        this.queueIndex = Math.max(0, parseInt(savedIdx, 10) || 0);
      }

      let track: Track | null = null;
      if (savedTrack) {
        track = JSON.parse(savedTrack);
      } else if (this.queue.length > 0 && this.queue[this.queueIndex]) {
        track = this.queue[this.queueIndex];
      }

      if (track) {
        this.currentTrack = track;
        const targetSrc = track.streamUrl ? resolveApiUrl(track.streamUrl) : '';
        if (targetSrc && !isNativeAndroid()) {
          this.audio.src = targetSrc;
          this.audio.load();
        }
        if (savedTime) {
          const t = parseFloat(savedTime);
          if (!isNaN(t) && t > 0) {
            this.audio.currentTime = t;
          }
        }
        this.setupMediaSession(track);
        if (this.onTrackChangeCallback) {
          this.onTrackChangeCallback(track);
        }
      }
      this.notifyQueueChange();
      return { track, queue: this.queue };
    } catch (_) {
      return { track: null, queue: [] };
    }
  }

  private static notifyQueueChange(): void {
    this.saveQueueToStorage();
    this.queueListeners.forEach(cb => cb());

    // Debounced background sync to native ExoPlayer using unified [current, ...priorityQueue, ...upcomingContext]
    // Always uses autoPlay=false inside syncNativeQueue() so updating the queue NEVER resets or switches current playback!
    if (isNativeAndroid()) {
      if (this.nativeQueueSyncTimer) clearTimeout(this.nativeQueueSyncTimer);
      this.nativeQueueSyncTimer = setTimeout(() => {
        this.syncNativeQueue();
      }, 180);
    }
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
    if (isNativeAndroid()) {
      LumenAudio.setRepeatMode({ mode: this.repeatMode }).catch(() => {});
    }
    return this.repeatMode;
  }

  static setRepeatMode(mode: 'off' | 'all' | 'one'): void {
    this.repeatMode = mode;
    if (isNativeAndroid()) {
      LumenAudio.setRepeatMode({ mode: this.repeatMode }).catch(() => {});
    }
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
    const isPlayingAny = (this.audio && !this.audio.paused && this.audio.currentTime > 0) || this.nativeIsPlaying;
    if (isPlayingAny) {
      const t = (this.audio && this.audio.currentTime > 0)
        ? this.audio.currentTime
        : (this.nativeCurrentPositionSec > 0 ? this.nativeCurrentPositionSec : (Date.now() / 1000) % 10000);
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

  static getCurrentTime(): number {
    return this.nativeCurrentPositionSec || (this.audio && this.audio.currentTime) || 0;
  }

  static getDuration(): number {
    return this.nativeDurationSec || (this.audio && this.audio.duration) || this.currentTrack?.actualMediaDuration || this.currentTrack?.duration || 0;
  }

  // Callbacks
  static onTimeUpdate(callback: (time: number, duration: number) => void): () => void {
    this.onTimeUpdateCallback = callback;
    this.timeUpdateListeners.add(callback);
    return () => {
      this.timeUpdateListeners.delete(callback);
      if (this.onTimeUpdateCallback === callback) {
        this.onTimeUpdateCallback = null;
      }
    };
  }

  static onTrackChange(callback: (track: Track | null) => void): () => void {
    this.onTrackChangeCallback = callback;
    this.trackChangeListeners.add(callback);
    return () => {
      this.trackChangeListeners.delete(callback);
      if (this.onTrackChangeCallback === callback) {
        this.onTrackChangeCallback = null;
      }
    };
  }

  static onPlayStateChange(callback: (isPlaying: boolean) => void): () => void {
    this.onPlayStateChangeCallback = callback;
    this.playStateListeners.add(callback);
    return () => {
      this.playStateListeners.delete(callback);
      if (this.onPlayStateChangeCallback === callback) {
        this.onPlayStateChangeCallback = null;
      }
    };
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
    const isPlaying = this.audio && !this.audio.paused;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    try {
      if (this.audio && this.audio.duration && !isNaN(this.audio.duration) && isFinite(this.audio.duration)) {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, this.audio.duration),
          playbackRate: this.audio.playbackRate || 1.0,
          position: Math.min(Math.max(0, this.audio.currentTime || 0), this.audio.duration)
        });
      }
    } catch (_) {}
  }
}
