import React, { useState, useEffect, useRef, useCallback } from 'react';
import { resolveApiUrl } from '../../services/apiConfig';
import { 
  Disc3, 
  AlignLeft, 
  Music, 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Shuffle, 
  Repeat,
  Repeat1,
  Heart,
  ListMusic,
  FolderPlus,
  Sparkles,
  ChevronDown,
  Mic,
  Square
} from 'lucide-react';
import { VoiceRuntimeService } from '../../services/voiceRuntimeService';
import type { VoiceControllerSnapshot } from '../../services/voiceCommandController';
import { Track, LyricLine } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { fetchUniversalLyrics } from '../../services/lyricsService';
import { extractDominantColor, extractDominantColorSync, toAccessibleAccentColor, withAlpha } from '../../services/colorSampler';
import { LikedService } from '../../services/likedService';
import { FirebaseAuthService } from '../../services/firebaseAuthService';
import { CoverImage } from '../common/CoverImage';
import { ArtistLinks } from '../common/ArtistLinks';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  activeStage: 'album' | 'lyrics';
  onToggleStage: () => void;
  dominantColor: string;
  onSetDominantColor: (color: string, palette?: [string, string, string, string]) => void;
  onSelectArtist: (artist: string) => void;
  onTogglePlay?: () => void;
  onNextTrack?: () => void;
  onPrevTrack?: () => void;
  onOpenQueue?: () => void;
  onOpenAddToPlaylist?: (track: Track) => void;
  onCollapse?: () => void;
}

function formatTime(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const CenterStageView: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  activeStage,
  onToggleStage,
  dominantColor,
  onSetDominantColor,
  onSelectArtist,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  onOpenQueue,
  onOpenAddToPlaylist,
  onCollapse
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>(() => AudioEngine.getRepeatMode());
  const [, setLikeTick] = useState(0);
  const [voiceSnap, setVoiceSnap] = useState<VoiceControllerSnapshot>(() => VoiceRuntimeService.getSnapshot());

  useEffect(() => {
    return VoiceRuntimeService.subscribe(setVoiceSnap);
  }, []);

  const ambientHaloRef = useRef<HTMLDivElement>(null);
  const albumCardRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Desktop 5-Second Inactivity Idle Mode: Centers album cover and hides controls when idle
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const isControlsVisibleRef = useRef(isControlsVisible);
  const idleTimerRef = useRef<any>(null);

  useEffect(() => {
    isControlsVisibleRef.current = isControlsVisible;
  }, [isControlsVisible]);

  useEffect(() => {
    const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isMobile) {
      setIsControlsVisible(true);
      return;
    }

    const resetIdle = () => {
      setIsControlsVisible(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setIsControlsVisible(false);
      }, 5000);
    };

    resetIdle();
    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    window.addEventListener('mousedown', resetIdle);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
      window.removeEventListener('mousedown', resetIdle);
    };
  }, []);

  // 1a. Audio time listener with proper cleanup (zero listener leaks)
  useEffect(() => {
    const unsub = AudioEngine.onTimeUpdate((time) => {
      setCurrentTime(prev => (Math.abs(prev - time) >= 0.2 || time === 0 ? time : prev));
    });
    return () => unsub();
  }, []);

  // 1b. Bass pulse GPU transform — ONLY runs while actively playing & visible
  useEffect(() => {
    if (!isPlaying) {
      if (ambientHaloRef.current) ambientHaloRef.current.style.transform = 'scale3d(1, 1, 1)';
      if (albumCardRef.current) albumCardRef.current.style.transform = 'scale3d(1, 1, 1)';
      return;
    }

    let animId = 0;
    let lastPulseTime = 0;
    const freqData = new Uint8Array(32);

    const checkBassPulse = (timestamp: number) => {
      if (!document.hidden && timestamp - lastPulseTime > 32) {
        lastPulseTime = timestamp;
        AudioEngine.getFrequencyData(freqData);
        const bassAvg = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / 4;
        const normalizedBass = 1 + (bassAvg / 255) * 0.18;

        const isIdle = !isControlsVisibleRef.current;
        const haloScale = normalizedBass * (isIdle ? 1.15 : 1.0);
        if (ambientHaloRef.current) {
          ambientHaloRef.current.style.transform = `scale3d(${haloScale}, ${haloScale}, 1)`;
        }
        if (albumCardRef.current) {
          const beatPulse = (normalizedBass - 1) * 0.22;
          const finalScale = 1.0 + beatPulse;
          albumCardRef.current.style.transform = `scale3d(${finalScale}, ${finalScale}, 1)`;
        }
      }

      animId = requestAnimationFrame(checkBassPulse);
    };

    animId = requestAnimationFrame(checkBassPulse);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  // 2. Color extraction & universal lyrics fetch on track or artwork change
  useEffect(() => {
    if (!currentTrack?.id) return;

    // Reset lyrics immediately on track change to prevent showing previous song lyrics
    setLyrics(null);

    const art = currentTrack.artworkUrl;
    if (art) {
      const immediate = extractDominantColorSync(art);
      onSetDominantColor(immediate.dominant, immediate.palette);

      extractDominantColor(art).then((sample) => {
        onSetDominantColor(sample.dominant, sample.palette);
      });
    } else if (currentTrack.title) {
      const immediate = extractDominantColorSync(`${currentTrack.title} ${currentTrack.artist || ''}`);
      onSetDominantColor(immediate.dominant, immediate.palette);
    }

    fetchUniversalLyrics(currentTrack.artist, currentTrack.title, (currentTrack as any).videoId).then((res) => {
      setLyrics(res);
    });
  }, [currentTrack?.id, currentTrack?.artworkUrl, currentTrack?.title]);

  // 3. Find current, previous, and upcoming sung lines for kinetic typography
  let currentSungIndex = -1;
  let currentSungLine: string | null = null;
  let prevSungLine: string | null = null;
  let nextSungLine: string | null = null;

  if (lyrics && lyrics.length > 0) {
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        currentSungIndex = i;
        currentSungLine = lyrics[i].text;
      } else {
        break;
      }
    }
    if (currentSungIndex > 0) {
      prevSungLine = lyrics[currentSungIndex - 1]?.text || null;
    }
    if (currentSungIndex >= 0 && currentSungIndex < lyrics.length - 1) {
      nextSungLine = lyrics[currentSungIndex + 1]?.text || null;
    }
  }

  const duration = currentTrack?.actualMediaDuration || currentTrack?.duration || 0;
  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const lyricColor = toAccessibleAccentColor(dominantColor);

  const computeTimeFromClientX = (clientX: number): number => {
    if (!duration || !scrubberRef.current) return 0;
    const rect = scrubberRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const handleScrubStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!duration) return;
    isDraggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    const t = computeTimeFromClientX(e.clientX);
    setScrubTime(t);
  };

  const handleScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !duration) return;
    const t = computeTimeFromClientX(e.clientX);
    setScrubTime(t);
  };

  const handleScrubEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    const t = computeTimeFromClientX(e.clientX);
    setScrubTime(null);
    setCurrentTime(t);
    AudioEngine.seek(t);
  };

  const displayTime = scrubTime !== null ? scrubTime : currentTime;
  const displayProgress = duration > 0 ? Math.max(0, Math.min(1, displayTime / duration)) : 0;

  return (
    <div 
      className="relative w-full h-full bg-transparent text-[#F1F4FC] overflow-hidden select-none flex flex-col items-center justify-center transition-colors duration-700"
    >
      {/* Mobile & Desktop Collapse Down Button */}
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className={`absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-50 p-2.5 rounded-full bg-black/45 hover:bg-black/75 border border-white/15 text-white/80 hover:text-white backdrop-blur-xl shadow-xl transition-all duration-300 active:scale-90 flex items-center justify-center min-w-[42px] min-h-[42px] cursor-pointer ${
            isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          title="Collapse Player"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}

      {/* Compact Hands-Free "Hey Lumen" Listening Indicator Pill (shown only when voice control is active) */}
      {voiceSnap.enabled && (
        <div
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-50 max-w-[calc(100vw-5.5rem)] flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-black/55 border border-white/20 backdrop-blur-2xl shadow-xl animate-fadeIn"
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              voiceSnap.mode === 'listening' || voiceSnap.mode === 'clarifying'
                ? 'bg-lumen-cyan animate-ping'
                : voiceSnap.mode === 'processing'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
            }`}
          />
          <Mic className="w-3.5 h-3.5 text-lumen-cyan shrink-0" />
          <span className="text-[11px] font-semibold text-white/95 truncate max-w-[200px]">
            {voiceSnap.clarificationPrompt || voiceSnap.feedbackText || voiceSnap.statusLabel}
          </span>
          <button
            type="button"
            onClick={() => VoiceRuntimeService.disableHandsFree()}
            className="ml-0.5 p-1 rounded-full bg-white/10 hover:bg-rose-500/30 text-white/80 hover:text-white transition-colors shrink-0 cursor-pointer"
            title="Stop Hey Lumen"
            aria-label="Stop Hey Lumen"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
          </button>
        </div>
      )}
      {/* Lightweight atmospheric vignette over App's unified living artwork backdrop (no double full-screen blur!) */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-black/35 via-black/25 to-black/70" />

      {/* Subtle Ambient Radial Bloom directly behind artwork */}
      <div 
        ref={ambientHaloRef}
        className="pointer-events-none absolute w-[280px] h-[280px] sm:w-[560px] sm:h-[560px] rounded-full blur-[64px] sm:blur-[160px] opacity-30 transition-colors duration-700 -z-10"
        style={{
          backgroundColor: dominantColor,
          transform: 'scale(1)'
        }}
      />

      {/* 
        2. LIVING CENTER STAGE (MATCHING SCREEN RECORDING AZ_RECORDER)
      */}
      <div className={`w-full max-w-4xl h-full min-h-[85vh] flex items-center justify-center relative z-20 px-4 sm:px-6 transition-all duration-700 ease-out ${
        isControlsVisible 
          ? 'pt-4 pb-[calc(76px+env(safe-area-inset-bottom))] sm:pb-6' 
          : 'pt-0 pb-0'
      }`}>
        {/* STAGE 0: NO TRACK SELECTED LIVING RETRO STAGE */}
        {!currentTrack && (
          <div className="flex flex-col items-center justify-center text-center animate-fadeIn select-none w-full max-w-lg my-auto py-10 px-8 rounded-3xl bg-white/[0.04] border border-white/15 backdrop-blur-2xl shadow-2xl">
            {/* Spinning Neon Vinyl Disc */}
            <div 
              className="relative w-44 h-44 sm:w-52 sm:h-52 rounded-full overflow-hidden bg-black/80 border-2 border-white/20 shadow-2xl flex items-center justify-center mb-6"
              style={{
                boxShadow: `0 20px 60px -10px ${dominantColor}70, 0 0 35px ${dominantColor}50`
              }}
            >
              <Disc3 className="w-24 h-24 text-white/40 animate-spin-slow stroke-[1.2]" />
              <div 
                className="absolute w-10 h-10 rounded-full border border-white/30 flex items-center justify-center"
                style={{ backgroundColor: dominantColor }}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-black" />
              </div>
            </div>

            <span className="text-[10px] font-mono uppercase tracking-widest text-lumen-cyan font-bold mb-1">
              NOW PLAYING PLAYER
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mb-2">
              No Track Selected
            </h2>
            <p className="text-xs text-white/60 max-w-xs mb-6 font-outfit">
              Select any song from your personalized Home feed or Playlists to launch high-fidelity playback.
            </p>

            <button
              type="button"
              onClick={() => {
                WatchSoundService.playTick(1.0);
                if (onCollapse) onCollapse();
              }}
              className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <Music className="w-4 h-4 text-black" />
              <span>Explore Songs & Mixes</span>
            </button>
          </div>
        )}

        {/* STAGE 1: CENTERED ALBUM ART + CONTROLS + LYRICS PILL (SCREEN RECORDING 00:00 & 00:11) */}
        {activeStage === 'album' && currentTrack && (
          <div className="flex flex-col items-center justify-center text-center animate-fadeIn select-none w-full max-w-lg my-auto">
            {/* 100% Studio Square Artwork with Rounded Corners & Dynamic Bloom */}
            <div 
              ref={albumCardRef}
              className={`relative rounded-3xl overflow-hidden bg-black border border-white/20 shadow-2xl flex items-center justify-center flex-shrink-0 will-change-transform transition-[width,height,box-shadow] duration-700 ease-out z-10 ${
                !isControlsVisible
                  ? 'w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 shadow-[0_30px_90px_rgba(0,0,0,0.9)]'
                  : 'w-52 h-52 sm:w-60 sm:h-60 md:w-72 md:h-72'
              }`}
              style={{
                boxShadow: `0 25px 70px -10px ${dominantColor}80, 0 0 45px ${dominantColor}60`
              }}
            >
              <CoverImage 
                src={currentTrack.artworkUrl || null} 
                alt={currentTrack.title} 
                title={currentTrack.title}
                artist={currentTrack.artist}
                album={currentTrack.album}
                size={800}
                className="w-full h-full object-cover" 
                onResolved={(healedUrl) => {
                  if (currentTrack && (!currentTrack.artworkUrl || currentTrack.artworkUrl !== healedUrl)) {
                    currentTrack.artworkUrl = healedUrl;
                    currentTrack.hasArtwork = true;
                    AudioEngine.updateCurrentTrackArtwork(healedUrl);
                    const immediate = extractDominantColorSync(healedUrl);
                    onSetDominantColor(immediate.dominant, immediate.palette);
                    extractDominantColor(healedUrl).then((sample) => {
                      onSetDominantColor(sample.dominant, sample.palette);
                    });
                    try {
                      const userKey = FirebaseAuthService.getCurrentUser()?.uid || 'local';
                      localStorage.setItem(`lumen_last_played_${userKey}`, JSON.stringify(currentTrack));
                      localStorage.setItem('lumen_last_played_track', JSON.stringify(currentTrack));
                    } catch (_) {}
                  }
                }}
              />
            </div>

            {/* Song Title & Artist (Clean floating typography with zero black box in desktop idle mode) */}
            <div className={`w-full max-w-md text-center transition-all duration-700 ease-out relative z-20 ${
              !isControlsVisible 
                ? 'mt-8 sm:mt-10 py-1 px-2 bg-transparent opacity-100 scale-105' 
                : 'mt-5 py-1 px-2 bg-transparent opacity-100 scale-100'
            }`}>
              <div className="flex items-center justify-center gap-2 max-w-full">
                <h2 className="font-black tracking-tight text-white truncate text-2xl sm:text-3xl" title={currentTrack.title}>
                  {currentTrack.title}
                </h2>
                {currentTrack.isExplicitPreview && (
                  <span 
                    className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-300 font-bold uppercase tracking-wider flex-shrink-0"
                    title="30-second official sample preview. Full master is offline."
                  >
                    Preview (30s)
                  </span>
                )}
              </div>
              <div 
                className="font-medium text-white/70 truncate text-sm sm:text-base mt-1" 
                title={currentTrack.artist}
              >
                <ArtistLinks 
                  artist={currentTrack.artist} 
                  onSelectArtist={onSelectArtist} 
                  linkClassName="hover:text-white hover:underline cursor-pointer transition-colors"
                />
              </div>
            </div>

            {/* PLAYBACK CONTROLS (COLLAPSES AND FADES OUT AFTER 5s IDLE ON DESKTOP, INSTANT ON INTERACTION) */}
            <div className={`w-full flex flex-col items-center overflow-hidden transition-all duration-700 ease-out ${
              isControlsVisible 
                ? 'max-h-[380px] opacity-100 mt-2 pointer-events-auto translate-y-0' 
                : 'max-h-0 opacity-0 mt-0 pointer-events-none translate-y-4'
            }`}>
              {/* Tactile Draggable Timeline Scrubber Bar */}
              <div className="w-full max-w-md mt-5 px-2">
                <div
                  ref={scrubberRef}
                  onPointerDown={handleScrubStart}
                  onPointerMove={handleScrubMove}
                  onPointerUp={handleScrubEnd}
                  onPointerCancel={handleScrubEnd}
                  className="group relative w-full py-3 cursor-pointer flex items-center touch-none"
                >
                  <div className="relative w-full h-1.5 group-hover:h-2 bg-white/15 rounded-full transition-all flex items-center">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${displayProgress * 100}%`,
                        backgroundColor: dominantColor,
                        boxShadow: `0 0 12px ${dominantColor}`
                      }}
                    />
                    <div
                      className="absolute w-3.5 h-3.5 rounded-full bg-white shadow-lg -translate-x-1/2 group-hover:scale-125 transition-transform"
                      style={{
                        left: `${displayProgress * 100}%`,
                        boxShadow: `0 0 10px ${dominantColor}`
                      }}
                    />
                  </div>
                </div>

                {/* Timestamps */}
                <div className="flex justify-between items-center text-[11px] font-mono text-white/55 -mt-1 px-0.5">
                  <span>{formatTime(displayTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Bold Primary Transport Controls (Real Shuffle, Prev, Play/Pause, Next, Real 3-State Repeat) */}
              <div className="flex items-center justify-center gap-5 sm:gap-7 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.0);
                    setIsShuffle(AudioEngine.toggleShuffle());
                  }}
                  className={`p-2.5 rounded-full transition-all active:scale-90 cursor-pointer ${
                    isShuffle ? 'text-lumen-cyan bg-lumen-cyan/15' : 'text-white/45 hover:text-white hover:bg-white/5'
                  }`}
                  title={isShuffle ? 'Shuffle On' : 'Shuffle Off'}
                >
                  <Shuffle className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                </button>

                <button
                  type="button"
                  onClick={onPrevTrack}
                  className="p-2.5 rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-all hover:scale-110 active:scale-90 cursor-pointer"
                  title="Previous Track"
                >
                  <SkipBack className="w-6 h-6 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  style={{
                    boxShadow: `0 10px 30px ${dominantColor}60`
                  }}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-7 h-7 fill-black" />
                  ) : (
                    <Play className="w-7 h-7 fill-black translate-x-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onNextTrack}
                  className="p-2.5 rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-all hover:scale-110 active:scale-90 cursor-pointer"
                  title="Next Track"
                >
                  <SkipForward className="w-6 h-6 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.0);
                    setRepeatMode(AudioEngine.toggleRepeat());
                  }}
                  className={`p-2.5 rounded-full transition-all active:scale-90 cursor-pointer ${
                    repeatMode !== 'off' ? 'text-lumen-cyan bg-lumen-cyan/15' : 'text-white/45 hover:text-white hover:bg-white/5'
                  }`}
                  title={`Repeat: ${repeatMode === 'off' ? 'Off' : repeatMode === 'all' ? 'All' : 'One'}`}
                >
                  {repeatMode === 'one' ? (
                    <Repeat1 className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                  ) : (
                    <Repeat className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                  )}
                </button>
              </div>

              {/* Tidy Single Liquid Glass Bottom Action Bar */}
              <div className="mt-5 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/[0.06] border border-white/15 backdrop-blur-xl shadow-xl">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentTrack) {
                      WatchSoundService.playTick(1.1);
                      LikedService.toggleLike(currentTrack);
                      setLikeTick(t => t + 1);
                    }
                  }}
                  className="p-2.5 rounded-full hover:bg-white/10 text-white/75 hover:text-rose-400 transition-all active:scale-90 cursor-pointer"
                  title={currentTrack && LikedService.isLiked(currentTrack.id) ? 'Unlike Song' : 'Like Song'}
                >
                  <Heart className={`w-4 h-4 ${currentTrack && LikedService.isLiked(currentTrack.id) ? 'text-rose-500 fill-rose-500' : ''}`} />
                </button>

                <div className="w-[1px] h-4 bg-white/10" />

                <button
                  type="button"
                  onClick={onToggleStage}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full hover:bg-white/10 text-xs font-semibold text-white/90 hover:text-white transition-all active:scale-95 cursor-pointer"
                >
                  <AlignLeft className="w-3.5 h-3.5 text-lumen-cyan" />
                  <span>Lyrics</span>
                </button>

                {onOpenAddToPlaylist && currentTrack && (
                  <>
                    <div className="w-[1px] h-4 bg-white/10" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAddToPlaylist(currentTrack);
                      }}
                      className="p-2.5 rounded-full hover:bg-white/10 text-white/75 hover:text-white transition-all active:scale-90 cursor-pointer"
                      title="Add to Playlist"
                    >
                      <FolderPlus className="w-4 h-4" />
                    </button>
                  </>
                )}

                {onOpenQueue && (
                  <>
                    <div className="w-[1px] h-4 bg-white/10" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenQueue();
                      }}
                      className="p-2.5 rounded-full hover:bg-white/10 text-white/75 hover:text-lumen-cyan transition-all active:scale-90 cursor-pointer"
                      title="Play Queue & Autoplay"
                    >
                      <ListMusic className="w-4 h-4 text-lumen-cyan" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STAGE 2: CLEAN APPLE MUSIC STYLE KARAOKE (CLICK ANYWHERE TO TOGGLE BACK TO ARTWORK) */}
        {activeStage === 'lyrics' && (
          <div 
            onClick={onToggleStage}
            className="w-full h-full flex flex-col items-center justify-center text-center px-4 sm:px-12 animate-fadeIn select-none relative z-10 cursor-pointer"
            title="Click anywhere to return to Album Cover"
          >
            {currentSungLine ? (
              <div key={currentSungLine} className="relative z-10 flex flex-col items-center justify-center max-w-4xl px-4 animate-fadeIn transition-all duration-300">
                {/* Previous Sung Line (Softly Dimmed Floating Context) */}
                {prevSungLine && (
                  <p className="font-syne text-sm sm:text-base md:text-lg font-semibold text-white/40 tracking-tight mb-3 transition-all duration-300 max-w-2xl line-clamp-2">
                    {prevSungLine}
                  </p>
                )}

                {/* ACTIVE SUNG LINE (CRISP HIGH-CONTRAST APPLE MUSIC KARAOKE WITH ATMOSPHERIC GLOW) */}
                <div className="py-2 sm:py-3">
                  <h1 
                    className={`font-syne font-black tracking-tight leading-snug select-none text-white max-w-3xl ${
                      currentSungLine.length > 50
                        ? 'text-xl sm:text-2xl md:text-3xl lg:text-4xl'
                        : currentSungLine.length > 25
                        ? 'text-2xl sm:text-3xl md:text-4xl lg:text-5xl'
                        : 'text-3xl sm:text-4xl md:text-5xl lg:text-6xl'
                    }`}
                    style={{
                      textShadow: `0 0 24px rgba(255, 255, 255, 0.5), 0 0 50px ${withAlpha(dominantColor, 0.55)}`
                    }}
                  >
                    {currentSungLine}
                  </h1>
                </div>

                {/* Next Upcoming Line (Softly Dimmed Floating Context) */}
                {nextSungLine && (
                  <p className="font-syne text-sm sm:text-base md:text-lg font-semibold text-white/40 tracking-tight mt-3 transition-all duration-300 max-w-2xl line-clamp-2">
                    {nextSungLine}
                  </p>
                )}
              </div>
            ) : lyrics && lyrics.length > 0 ? (
              <div className="relative z-10 flex flex-col items-center justify-center animate-pulse">
                <Music 
                  className="w-14 h-14 mb-3" 
                  style={{ color: dominantColor, filter: `drop-shadow(0 0 15px ${withAlpha(dominantColor, 0.7)})` }} 
                />
                <span 
                  className="text-xl sm:text-2xl font-black tracking-wider font-syne uppercase text-white"
                  style={{ textShadow: `0 0 20px ${withAlpha(dominantColor, 0.6)}` }}
                >
                  Listening...
                </span>
              </div>
            ) : (
              <div className="relative z-10 flex flex-col items-center justify-center text-white/40">
                <Music className="w-12 h-12 mb-2.5 opacity-30 text-lumen-cyan" />
                <span className="text-sm font-medium font-syne">Instrumental or Syncing Lyrics...</span>
              </div>
            )}

            {/* Back to Artwork Pill Button */}
            <div className="relative z-10 mt-10" onClick={(e) => { e.stopPropagation(); onToggleStage(); }}>
              <button
                type="button"
                className="flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white/90 hover:text-white transition-all shadow-lg hover:scale-105 active:scale-95 cursor-pointer"
                style={{
                  boxShadow: `0 0 16px ${withAlpha(dominantColor, 0.35)}`
                }}
              >
                <Disc3 className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Show Artwork</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
