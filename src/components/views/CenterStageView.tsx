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
  Heart,
  ListMusic,
  FolderPlus,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { Track, LyricLine } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { fetchUniversalLyrics } from '../../services/lyricsService';
import { extractDominantColor, extractDominantColorSync, toAccessibleAccentColor, withAlpha } from '../../services/colorSampler';
import { LikedService } from '../../services/likedService';
import { FirebaseAuthService } from '../../services/firebaseAuthService';
import { CoverImage } from '../common/CoverImage';
import { ArtistLinks } from '../common/ArtistLinks';

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
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [, setLikeTick] = useState(0);

  const ambientHaloRef = useRef<HTMLDivElement>(null);
  const albumCardRef = useRef<HTMLDivElement>(null);

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

  // 1. Audio time & vertical spectral flow listener
  useEffect(() => {
    AudioEngine.onTimeUpdate((time) => {
      setCurrentTime(time);
    });

    let animId: number;
    let lastPulseTime = 0;
    const freqData = new Uint8Array(32);

    const checkBassPulse = (timestamp: number) => {
      // Throttle to ~40fps with direct GPU translate3d/scale3d transforms — zero layout thrashing or visual jitter
      if (timestamp - lastPulseTime > 24) {
        lastPulseTime = timestamp;
        AudioEngine.getFrequencyData(freqData);
        const bassAvg = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / 4;
        const normalizedBass = 1 + (bassAvg / 255) * 0.18; // 1.0 to 1.18 smooth subtle scale

        const isIdle = !isControlsVisibleRef.current;
        const haloScale = normalizedBass * (isIdle ? 1.15 : 1.0);
        if (ambientHaloRef.current) {
          ambientHaloRef.current.style.transform = `scale3d(${haloScale}, ${haloScale}, 1)`;
        }
        if (albumCardRef.current) {
          // Dynamic beat pulse: subtle organic bounce that NEVER overflows layout boundaries
          const beatPulse = (normalizedBass - 1) * 0.22;
          const finalScale = 1.0 + beatPulse;
          albumCardRef.current.style.transform = `scale3d(${finalScale}, ${finalScale}, 1)`;
        }
      }

      animId = requestAnimationFrame(checkBassPulse);
    };

    animId = requestAnimationFrame(checkBassPulse);
    return () => cancelAnimationFrame(animId);
  }, []);

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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = ratio * duration;
    AudioEngine.seek(newTime);
    setCurrentTime(newTime);
  };

  return (
    <div 
      className="relative w-full h-full bg-[#000000] text-[#F1F4FC] overflow-hidden select-none flex flex-col items-center justify-center transition-colors duration-1000"
    >
      {/* Mobile & Desktop Collapse Down Button */}
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className={`absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-50 p-2.5 rounded-full bg-black/60 hover:bg-black/85 border border-white/20 text-white/80 hover:text-white backdrop-blur-2xl shadow-xl transition-all duration-500 active:scale-90 flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer ${
            isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          title="Collapse Player"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}
      {/* 
        IMMERSIVE FULL-SCREEN LIVING ALBUM COVER BACKDROP
        fixed inset-0 covers 100% of the entire screen from edge to edge with ZERO black bars above or below
      */}
      {currentTrack?.artworkUrl && (
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          <img
            src={currentTrack.artworkUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover filter blur-[50px] scale-125 opacity-60 transition-all duration-700 select-none"
          />
          {/* Subtle translucent dark wash so rich album colors shine through cleanly */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        </div>
      )}

      {/* Ambient Radial Bloom directly behind the center */}
      <div 
        ref={ambientHaloRef}
        className="pointer-events-none absolute w-[320px] h-[320px] sm:w-[720px] sm:h-[720px] rounded-full blur-[60px] sm:blur-[190px] opacity-35 transition-colors duration-700 -z-10"
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

            {/* Song Title & Artist (Protected with dedicated spacing & glass capsule so it NEVER overlaps) */}
            <div className={`w-full max-w-md text-center transition-all duration-700 ease-out relative z-20 ${
              !isControlsVisible 
                ? 'mt-8 sm:mt-10 py-3 px-5 rounded-2xl bg-black/50 backdrop-blur-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.8)] opacity-95 scale-105' 
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
              {/* Timeline Scrubber Bar */}
              <div className="w-full mt-5 px-3">
                <div 
                  onClick={handleSeek}
                  className="group relative w-full h-2 bg-white/15 hover:bg-white/25 rounded-full cursor-pointer flex items-center transition-all"
                >
                  <div 
                    className="h-full rounded-full transition-all duration-75"
                    style={{
                      width: `${progressRatio * 100}%`,
                      backgroundColor: dominantColor,
                      boxShadow: `0 0 10px ${dominantColor}`
                    }}
                  />
                  {/* Scrubber Knob */}
                  <div 
                    className="absolute w-3.5 h-3.5 rounded-full bg-white shadow-lg transition-transform -translate-x-1/2 group-hover:scale-125"
                    style={{
                      left: `${progressRatio * 100}%`,
                      boxShadow: `0 0 8px ${dominantColor}`
                    }}
                  />
                </div>

                {/* Timestamps */}
                <div className="flex justify-between items-center text-[11px] font-mono text-white/50 mt-1.5 px-0.5">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Playback Controls Row (Shuffle, Prev, Play/Pause Circle, Next, Repeat) */}
              <div className="flex items-center justify-center gap-5 sm:gap-6 mt-4">
                <button
                  onClick={() => setIsShuffle(!isShuffle)}
                  className={`p-2 rounded-full transition-colors ${
                    isShuffle ? 'text-lumen-cyan' : 'text-white/40 hover:text-white'
                  }`}
                  title="Shuffle"
                >
                  <Shuffle className="w-4 h-4" />
                </button>

                <button
                  onClick={onPrevTrack}
                  className="p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all hover:scale-110 active:scale-95"
                  title="Previous Track"
                >
                  <SkipBack className="w-5 h-5 fill-current" />
                </button>

                <button
                  onClick={onTogglePlay}
                  className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-all"
                  style={{
                    boxShadow: `0 0 25px ${dominantColor}70`
                  }}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6 fill-black" />
                  ) : (
                    <Play className="w-6 h-6 fill-black translate-x-0.5" />
                  )}
                </button>

                <button
                  onClick={onNextTrack}
                  className="p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all hover:scale-110 active:scale-95"
                  title="Next Track"
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>

                <button
                  onClick={() => setIsRepeat(!isRepeat)}
                  className={`p-2 rounded-full transition-colors ${
                    isRepeat ? 'text-lumen-violet' : 'text-white/40 hover:text-white'
                  }`}
                  title="Repeat"
                >
                  <Repeat className="w-4 h-4" />
                </button>
              </div>

              {/* Actions Row: Like Heart + Lyrics Pill + Add to Playlist + Queue */}
              <div className="mt-5 flex items-center justify-center gap-2.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentTrack) {
                      LikedService.toggleLike(currentTrack);
                      setLikeTick(t => t + 1);
                    }
                  }}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-rose-400 transition-all hover:scale-105 active:scale-95 shadow-md"
                  title={currentTrack && LikedService.isLiked(currentTrack.id) ? "Unlike Song" : "Like Song"}
                >
                  <Heart className={`w-4 h-4 ${currentTrack && LikedService.isLiked(currentTrack.id) ? 'text-rose-500 fill-rose-500' : ''}`} />
                </button>

                <button
                  onClick={onToggleStage}
                  className="flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white/90 hover:text-white transition-all shadow-lg hover:scale-105 active:scale-95"
                  style={{
                    boxShadow: `0 0 16px ${dominantColor}40`
                  }}
                >
                  <AlignLeft className="w-3.5 h-3.5 text-lumen-cyan" />
                  <span>Lyrics</span>
                </button>

                {onOpenAddToPlaylist && currentTrack && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenAddToPlaylist(currentTrack);
                    }}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                    title="Add to Playlist"
                  >
                    <FolderPlus className="w-4 h-4" />
                  </button>
                )}

                {onOpenQueue && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenQueue();
                    }}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                    title="Open Queue"
                  >
                    <ListMusic className="w-4 h-4 text-lumen-cyan" />
                  </button>
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
