import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Sparkles
} from 'lucide-react';
import { Track, LyricLine } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { fetchUniversalLyrics } from '../../services/lyricsService';
import { extractDominantColor } from '../../services/colorSampler';
import { LikedService } from '../../services/likedService';

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
  onOpenAddToPlaylist
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [bassScale, setBassScale] = useState(1);
  const [spectrumBars, setSpectrumBars] = useState<number[]>([40, 60, 80, 50, 70, 90, 60, 40]);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [, setLikeTick] = useState(0);

  // Inactivity detection for auto-hiding controls (3 seconds)
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetInactivityTimer = useCallback(() => {
    setIsControlsVisible(true);
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      setIsControlsVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    resetInactivityTimer();

    const handleActivity = () => {
      resetInactivityTimer();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);

    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
    };
  }, [resetInactivityTimer]);

  // 1. Audio time & vertical spectral flow listener
  useEffect(() => {
    AudioEngine.onTimeUpdate((time) => {
      setCurrentTime(time);
    });

    let animId: number;
    const freqData = new Uint8Array(32);

    const checkBassPulse = () => {
      AudioEngine.getFrequencyData(freqData);
      const bassAvg = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / 4;
      const normalizedBass = 1 + (bassAvg / 255) * 0.32; // 1.0 to 1.32 scale
      setBassScale(normalizedBass);

      // Sample 8 frequency points for the vertical LED flow columns on the sides
      const bars = [
        Math.min(100, (freqData[0] / 255) * 100),
        Math.min(100, (freqData[1] / 255) * 100),
        Math.min(100, (freqData[2] / 255) * 100),
        Math.min(100, (freqData[3] / 255) * 100),
        Math.min(100, (freqData[4] / 255) * 100),
        Math.min(100, (freqData[6] / 255) * 100),
        Math.min(100, (freqData[8] / 255) * 100),
        Math.min(100, (freqData[12] / 255) * 100)
      ];
      setSpectrumBars(bars);

      animId = requestAnimationFrame(checkBassPulse);
    };

    animId = requestAnimationFrame(checkBassPulse);
    return () => cancelAnimationFrame(animId);
  }, []);

  // 2. Color extraction & universal lyrics fetch on track change
  useEffect(() => {
    if (!currentTrack) return;

    extractDominantColor(currentTrack.artworkUrl).then((sample) => {
      onSetDominantColor(sample.dominant, sample.palette);
    });

    fetchUniversalLyrics(currentTrack.artist, currentTrack.title, (currentTrack as any).videoId).then((res) => {
      setLyrics(res);
    });
  }, [currentTrack, onSetDominantColor]);

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

  const avgLeftFlow = (spectrumBars[0] + spectrumBars[1] + spectrumBars[2] + spectrumBars[3]) / 4;
  const avgRightFlow = (spectrumBars[4] + spectrumBars[5] + spectrumBars[6] + spectrumBars[7]) / 4;

  const duration = currentTrack?.duration || 0;
  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

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
      {/* 
        IMMERSIVE FULL-SCREEN LIVING ALBUM COVER BACKDROP
        fixed inset-0 covers 100% of the entire screen from edge to edge with ZERO black bars above or below
      */}
      {currentTrack?.artworkUrl && (
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          <img
            src={currentTrack.artworkUrl}
            alt=""
            className="w-full h-full object-cover filter blur-[50px] scale-125 opacity-60 transition-all duration-700 select-none"
            style={{
              transform: `scale(${1.15 + (bassScale - 1) * 0.08})`
            }}
          />
          {/* Subtle translucent dark wash so rich album colors shine through cleanly */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        </div>
      )}

      {/* Massive Ambient Radial Bloom directly behind the center */}
      <div 
        className="pointer-events-none absolute w-[720px] h-[720px] rounded-full blur-[190px] opacity-35 transition-all duration-700 -z-10"
        style={{
          backgroundColor: dominantColor,
          transform: `scale(${bassScale})`
        }}
      />

      {/* 
        2. LIVING CENTER STAGE (MATCHING SCREEN RECORDING AZ_RECORDER)
      */}
      <div className="w-full max-w-4xl min-h-[75vh] flex items-center justify-center relative z-20 px-6 py-8">
        {/* STAGE 1: CENTERED ALBUM ART + CONTROLS + LYRICS PILL (SCREEN RECORDING 00:00 & 00:11) */}
        {activeStage === 'album' && currentTrack && (
          <div className="flex flex-col items-center text-center animate-fadeIn select-none w-full max-w-md">
            {/* 100% Studio Square Artwork with Rounded Corners & Dynamic Bloom */}
            <div 
              className={`relative w-56 h-56 sm:w-68 sm:h-68 md:w-80 md:h-80 rounded-3xl overflow-hidden bg-black border border-white/20 transition-all duration-700 shadow-2xl flex items-center justify-center flex-shrink-0 ${
                !isControlsVisible ? 'scale-105 sm:scale-110' : ''
              }`}
              style={{
                boxShadow: `0 25px 70px -10px ${dominantColor}80, 0 0 40px ${dominantColor}50`,
                transform: `scale(${(!isControlsVisible ? 1.06 : 1) * (1 + (bassScale - 1) * 0.05)})`
              }}
            >
              {currentTrack.artworkUrl ? (
                <img 
                  src={currentTrack.artworkUrl} 
                  alt={currentTrack.title} 
                  className="w-full h-full object-cover" 
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fb = e.currentTarget.parentElement?.querySelector('.stage-artwork-fallback') as HTMLElement;
                    if (fb) fb.style.display = 'flex';
                  }}
                />
              ) : null}
              <div 
                className={`stage-artwork-fallback w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-white/10 via-black/80 to-black text-white/30 ${currentTrack.artworkUrl ? 'hidden' : 'flex'}`}
              >
                <Disc3 className="w-20 h-20 text-white/50 mb-2 animate-spin-slow" />
                <span className="text-xs font-mono uppercase tracking-widest text-white/50">Hi-Fi Audio</span>
              </div>
            </div>

            {/* Song Title & Artist (Directly under artwork) */}
            <div className="mt-6 w-full px-2 text-center">
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white truncate" title={currentTrack.title}>
                {currentTrack.title}
              </h2>
              <p 
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectArtist(currentTrack.artist);
                }}
                className="text-sm sm:text-base font-medium text-white/70 mt-1 truncate hover:text-white hover:underline cursor-pointer" 
                title={currentTrack.artist}
              >
                {currentTrack.artist}
              </p>
            </div>

            {/* AUTO-HIDING PLAYBACK CONTROLS (FADES OUT AFTER 3 SECONDS OF INACTIVITY) */}
            <div 
              onMouseEnter={() => {
                if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
                setIsControlsVisible(true);
              }}
              onMouseLeave={() => resetInactivityTimer()}
              className={`w-full flex flex-col items-center transition-all duration-700 ease-in-out ${
                isControlsVisible 
                  ? 'opacity-100 pointer-events-auto translate-y-0' 
                  : 'opacity-0 pointer-events-none translate-y-3'
              }`}
            >
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
            className="w-full h-full flex flex-col items-center justify-center text-center px-4 sm:px-12 animate-fadeIn select-none relative cursor-pointer"
            title="Click anywhere to return to Album Cover"
          >
            {currentSungLine ? (
              <div key={currentSungLine} className="flex flex-col items-center justify-center max-w-4xl animate-fadeIn transition-all duration-300">
                {/* Previous Sung Line (Softly Dimmed Floating) */}
                {prevSungLine && (
                  <p className="font-syne text-lg sm:text-2xl font-bold text-white/30 tracking-tight mb-4 transition-all duration-300 max-w-2xl truncate scale-95">
                    {prevSungLine}
                  </p>
                )}

                {/* ACTIVE SUNG LINE (CLEAN BOLD APPLE MUSIC KARAOKE WITH SOFT AURA) */}
                <div 
                  className="transition-transform duration-150 py-2"
                  style={{
                    transform: `scale(${1 + (bassScale - 1) * 0.08})`
                  }}
                >
                  <h1 
                    className="font-syne font-black tracking-tight leading-tight text-4xl sm:text-6xl md:text-7xl lg:text-8xl select-none"
                    style={{
                      color: dominantColor,
                      textShadow: `0 0 25px ${dominantColor}cc, 0 0 55px ${dominantColor}50`
                    }}
                  >
                    {currentSungLine}
                  </h1>
                </div>

                {/* Next Upcoming Line (Softly Dimmed Floating) */}
                {nextSungLine && (
                  <p className="font-syne text-lg sm:text-2xl font-bold text-white/30 tracking-tight mt-4 transition-all duration-300 max-w-2xl truncate scale-95">
                    {nextSungLine}
                  </p>
                )}
              </div>
            ) : lyrics && lyrics.length > 0 ? (
              <div className="flex flex-col items-center justify-center animate-pulse">
                <Music 
                  className="w-14 h-14 mb-3" 
                  style={{ color: dominantColor, filter: `drop-shadow(0 0 15px ${dominantColor})` }} 
                />
                <span 
                  className="text-xl sm:text-2xl font-black tracking-wider font-syne uppercase"
                  style={{ color: dominantColor, textShadow: `0 0 20px ${dominantColor}` }}
                >
                  Listening...
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-white/40">
                <Music className="w-12 h-12 mb-2.5 opacity-30 text-lumen-cyan" />
                <span className="text-sm font-medium font-syne">Instrumental or Syncing Lyrics...</span>
              </div>
            )}

            {/* Back to Artwork Pill Button */}
            <div className="mt-10" onClick={(e) => { e.stopPropagation(); onToggleStage(); }}>
              <button
                className="flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white/90 hover:text-white transition-all shadow-lg hover:scale-105 active:scale-95"
                style={{
                  boxShadow: `0 0 16px ${dominantColor}40`
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
