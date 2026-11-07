import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Shuffle, 
  Repeat, 
  Mic2, 
  Volume2, 
  VolumeX, 
  Music, 
  Sparkles,
  Disc3
} from 'lucide-react';
import { Track, LyricLine } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { CoverImage } from '../common/CoverImage';
import { fetchUniversalLyrics } from '../../services/lyricsService';

interface TvNowPlayingStageProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  dominantColor: string;
  onTogglePlay: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onSelectArtist?: (artist: string) => void;
}

export const TvNowPlayingStage: React.FC<TvNowPlayingStageProps> = ({
  currentTrack,
  isPlaying,
  dominantColor,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  onSelectArtist
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);
  const [isKaraokeActive, setIsKaraokeActive] = useState<boolean>(() => AudioEngine.isKaraokeEnabled());
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(() => AudioEngine.getVolume());

  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus play button on mount for instant TV remote readiness
  useEffect(() => {
    if (playButtonRef.current) {
      playButtonRef.current.focus();
    }
  }, []);

  // Listen for audio engine time updates
  useEffect(() => {
    const unsubTime = AudioEngine.onTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
    });
    const unsubKaraoke = AudioEngine.onKaraokeChange((enabled) => {
      setIsKaraokeActive(enabled);
    });
    return () => {
      unsubTime();
      unsubKaraoke();
    };
  }, []);

  // Fetch multi-language synchronized lyrics when track changes
  useEffect(() => {
    if (!currentTrack) {
      setLyrics(null);
      return;
    }
    let isCancelled = false;

    fetchUniversalLyrics(currentTrack.artist, currentTrack.title, (currentTrack as any).videoId)
      .then((res) => {
        if (!isCancelled) {
          setLyrics(res);
        }
      })
      .catch((err) => {
        console.warn('[TV Stage] Lyrics lookup error:', err);
        if (!isCancelled) setLyrics(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

  // Compute active lyric line and auto-scroll
  useEffect(() => {
    if (!lyrics || lyrics.length === 0) {
      setActiveLineIndex(-1);
      return;
    }

    let found = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        found = i;
      } else {
        break;
      }
    }

    if (found !== activeLineIndex) {
      setActiveLineIndex(found);
      if (found >= 0 && lyricsContainerRef.current) {
        const lineEl = document.getElementById(`tv-lyric-${found}`);
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [currentTime, lyrics, activeLineIndex]);

  // TV Remote Media Keys & Spatial Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting when user is in an input field
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.key) {
        case ' ':
        case 'MediaPlayPause':
          e.preventDefault();
          onTogglePlay();
          break;
        case 'MediaTrackNext':
          e.preventDefault();
          onNextTrack();
          break;
        case 'MediaTrackPrevious':
          e.preventDefault();
          onPrevTrack();
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          handleToggleKaraoke();
          break;
        case 'ArrowLeft':
          if (e.altKey) {
            e.preventDefault();
            AudioEngine.seek(Math.max(0, currentTime - 10));
          }
          break;
        case 'ArrowRight':
          if (e.altKey) {
            e.preventDefault();
            AudioEngine.seek(Math.min(duration, currentTime + 10));
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTogglePlay, onNextTrack, onPrevTrack, currentTime, duration]);

  const handleToggleKaraoke = () => {
    const next = AudioEngine.toggleKaraoke();
    setIsKaraokeActive(next);
  };

  const handleSeek = (newTime: number) => {
    AudioEngine.seek(newTime);
    setCurrentTime(newTime);
  };

  const handleToggleMute = () => {
    if (isMuted) {
      AudioEngine.setVolume(volume || 0.8);
      setIsMuted(false);
    } else {
      AudioEngine.setVolume(0);
      setIsMuted(true);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="relative w-full h-full min-h-screen pl-24 md:pl-28 pr-6 py-8 flex flex-col lg:flex-row items-center gap-8 lg:gap-12 select-none overflow-hidden bg-gradient-to-br from-[#06080E] via-[#090C15] to-[#04060A]">
      {/* Background Ambient Glow */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-25 filter blur-[120px] transition-all duration-1000"
        style={{
          background: `radial-gradient(circle at 30% 40%, ${dominantColor}, transparent 70%)`
        }}
      />

      {/* LEFT SECTION (42% WIDTH): HERO ARTWORK & TRANSPORT CONTROLS */}
      <section 
        className="w-full lg:w-[42%] h-full flex flex-col justify-center items-center lg:items-start z-10 px-4 md:px-8 max-w-xl mx-auto lg:mx-0"
        aria-label="Album & Transport Stage"
      >
        {/* Large Album Artwork with LED Backlight Glow */}
        <div className="relative group w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 rounded-3xl overflow-hidden shadow-2xl mb-8 flex-shrink-0 transition-transform duration-300 hover:scale-[1.02]">
          <div 
            className="absolute -inset-4 rounded-3xl opacity-75 blur-2xl transition-all duration-500"
            style={{
              background: `radial-gradient(circle, ${dominantColor}90, transparent 75%)`
            }}
          />
          <div className="relative w-full h-full rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black/60">
            <CoverImage
              src={currentTrack?.artworkUrl}
              title={currentTrack?.title}
              artist={currentTrack?.artist}
              size={800}
              className="w-full h-full object-cover"
              loading="eager"
            />
          </div>
        </div>

        {/* Track Title & Artist Metadata */}
        <div className="w-full text-center lg:text-left mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white font-syne tracking-tight truncate drop-shadow-md">
            {currentTrack?.title || 'No Track Playing'}
          </h1>
          <p 
            onClick={() => currentTrack && onSelectArtist && onSelectArtist(currentTrack.artist)}
            className="text-base sm:text-lg md:text-xl text-white/70 font-syne font-medium mt-1 truncate hover:text-white transition-colors cursor-pointer"
          >
            {currentTrack?.artist || 'Select a song from Home or Playlists'}
          </p>
          {currentTrack?.album && (
            <p className="text-xs sm:text-sm text-white/40 font-mono mt-0.5 truncate">
              {currentTrack.album}
            </p>
          )}
        </div>

        {/* Scrub Bar & Timestamp Display */}
        <div className="w-full mb-6">
          <div 
            className="w-full h-2 rounded-full bg-white/10 relative cursor-pointer overflow-hidden group focus-within:ring-2 focus-within:ring-lumen-cyan"
            tabIndex={0}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, clickX / rect.width));
              handleSeek(ratio * duration);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                handleSeek(Math.max(0, currentTime - 5));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                handleSeek(Math.min(duration, currentTime + 5));
              }
            }}
            role="slider"
            aria-valuenow={currentTime}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-label="Track progress"
          >
            <div 
              className="h-full rounded-full transition-all duration-150"
              style={{
                width: `${progressPercent}%`,
                background: `linear-gradient(to right, ${dominantColor}, #63E8FF)`
              }}
            />
          </div>
          <div className="flex justify-between text-xs font-mono text-white/50 mt-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Transport Buttons (Large D-Pad Friendly) */}
        <div className="w-full flex items-center justify-between sm:justify-center sm:gap-6 mb-6">
          <button
            tabIndex={0}
            onClick={onPrevTrack}
            className="p-3.5 rounded-2xl bg-white/5 hover:bg-white/15 text-white/80 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-110 focus:shadow-[0_0_25px_#63E8FF]"
            title="Previous Track"
          >
            <SkipBack className="w-7 h-7" />
          </button>

          <button
            ref={playButtonRef}
            tabIndex={0}
            onClick={onTogglePlay}
            className="p-5 rounded-3xl text-black font-extrabold shadow-2xl transition-all cursor-pointer transform hover:scale-110 active:scale-95 focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-115 focus:shadow-[0_0_35px_#63E8FF]"
            style={{
              background: `linear-gradient(135deg, ${dominantColor}, #63E8FF)`
            }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-9 h-9 fill-black" />
            ) : (
              <Play className="w-9 h-9 fill-black ml-1" />
            )}
          </button>

          <button
            tabIndex={0}
            onClick={onNextTrack}
            className="p-3.5 rounded-2xl bg-white/5 hover:bg-white/15 text-white/80 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-110 focus:shadow-[0_0_25px_#63E8FF]"
            title="Next Track"
          >
            <SkipForward className="w-7 h-7" />
          </button>
        </div>

        {/* Dedicated Karaoke Control Banner */}
        <div className="w-full pt-2">
          <button
            tabIndex={0}
            onClick={handleToggleKaraoke}
            className={`w-full py-3.5 px-4 rounded-2xl flex items-center justify-between transition-all duration-200 cursor-pointer border focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-105 focus:shadow-[0_0_30px_#63E8FF] ${
              isKaraokeActive
                ? 'bg-gradient-to-r from-emerald-600/30 to-teal-500/20 border-emerald-400/80 text-emerald-200 shadow-lg'
                : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/70 hover:text-white'
            }`}
            title="Toggle TV Karaoke vocal attenuation"
          >
            <div className="flex items-center gap-3">
              <div 
                className={`p-2 rounded-xl ${
                  isKaraokeActive ? 'bg-emerald-400 text-black animate-pulse' : 'bg-white/10 text-white'
                }`}
              >
                <Mic2 className="w-5 h-5" />
              </div>
              <div className="text-left">
                <p className="text-sm font-syne font-bold">
                  {isKaraokeActive ? 'Karaoke Vocal Cut Active' : 'Real-Time Karaoke Mode'}
                </p>
                <p className="text-[11px] text-white/50">
                  {isKaraokeActive ? 'Lead vocals attenuated • Instrumental boost' : 'Press OK to reduce vocals and sing along'}
                </p>
              </div>
            </div>
            <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full uppercase ${
              isKaraokeActive ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40' : 'bg-white/10 text-white/60'
            }`}>
              {isKaraokeActive ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      </section>

      {/* RIGHT SECTION (58% WIDTH): KINETIC SYNCHRONIZED LYRICS STAGE */}
      <section 
        className="w-full lg:w-[58%] h-full flex flex-col justify-center items-center z-10 px-4 md:px-8 py-6 relative"
        aria-label="Synchronized Lyrics Stage"
      >
        <div 
          ref={lyricsContainerRef}
          className="w-full h-[65vh] sm:h-[75vh] overflow-y-auto no-scrollbar scroll-smooth flex flex-col items-center justify-start space-y-8 py-24 px-4 text-center select-none"
        >
          {lyrics && lyrics.length > 0 ? (
            lyrics.map((line, index) => {
              const isActive = index === activeLineIndex;
              const isPast = index < activeLineIndex;
              const isNearby = Math.abs(index - activeLineIndex) <= 2;

              return (
                <div
                  key={`${index}-${line.time}`}
                  id={`tv-lyric-${index}`}
                  tabIndex={0}
                  onClick={() => handleSeek(line.time)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSeek(line.time);
                    }
                  }}
                  className={`max-w-2xl px-6 py-2 rounded-2xl transition-all duration-300 cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-105 ${
                    isActive
                      ? 'scale-105 md:scale-110 font-black opacity-100'
                      : isNearby
                      ? 'opacity-40 hover:opacity-80 scale-95 font-semibold'
                      : 'opacity-20 hover:opacity-60 scale-90 font-medium'
                  }`}
                  style={
                    isActive
                      ? {
                          color: dominantColor || '#63E8FF',
                          textShadow: `0 0 35px ${dominantColor}bb, 0 0 65px ${dominantColor}50`
                        }
                      : undefined
                  }
                >
                  <p className="font-syne text-2xl sm:text-3xl md:text-4xl lg:text-5xl leading-tight tracking-tight">
                    {line.text}
                  </p>
                </div>
              );
            })
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center my-auto space-y-4">
              <div 
                className="w-20 h-20 rounded-full flex items-center justify-center mb-2 animate-pulse border border-white/20"
                style={{
                  background: `radial-gradient(circle, ${dominantColor}40, transparent 70%)`
                }}
              >
                <Music className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold font-syne text-white tracking-wide">
                {currentTrack ? 'Instrumental or Syncing Lyrics...' : 'No Track Selected'}
              </h3>
              <p className="text-sm font-mono text-white/50 max-w-md">
                Multi-language synced lyrics automatically load from LRCLIB & regional catalogs in native script.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
