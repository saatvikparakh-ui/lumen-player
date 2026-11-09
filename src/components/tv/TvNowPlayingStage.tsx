import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Mic2, 
  Music, 
  ArrowLeft,
  Disc3,
  AlignLeft,
  ChevronRight,
  ChevronLeft
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
  onCollapse?: () => void;
}

export const TvNowPlayingStage: React.FC<TvNowPlayingStageProps> = ({
  currentTrack,
  isPlaying,
  dominantColor,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  onSelectArtist,
  onCollapse
}) => {
  const [activeTab, setActiveTab] = useState<'showcase' | 'lyrics'>('showcase');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);
  const [isKaraokeActive, setIsKaraokeActive] = useState<boolean>(() => AudioEngine.isKaraokeEnabled());

  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus play button on mount
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

  // Fetch lyrics when track changes
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

    let foundIdx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        foundIdx = i;
      } else {
        break;
      }
    }

    setActiveLineIndex(foundIdx);

    if (foundIdx >= 0 && lyricsContainerRef.current) {
      const activeEl = document.getElementById(`tv-lyric-${foundIdx}`);
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }, [currentTime, lyrics]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      switch (e.key) {
        case 'Escape':
        case 'Backspace':
          if (onCollapse) {
            e.preventDefault();
            onCollapse();
          }
          break;
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
        case 'l':
        case 'L':
          e.preventDefault();
          setActiveTab(prev => prev === 'showcase' ? 'lyrics' : 'showcase');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTogglePlay, onNextTrack, onPrevTrack, onCollapse]);

  const handleToggleKaraoke = () => {
    const next = AudioEngine.toggleKaraoke();
    setIsKaraokeActive(next);
  };

  const handleSeek = (newTime: number) => {
    AudioEngine.seek(newTime);
    setCurrentTime(newTime);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="relative w-full h-full max-h-screen flex flex-col justify-between px-6 sm:px-10 py-5 select-none overflow-hidden bg-gradient-to-br from-[#06080E] via-[#090C15] to-[#04060A]">
      {/* Background Ambient Glow */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20 filter blur-[90px] transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 40% 40%, ${dominantColor}, transparent 70%)`
        }}
      />

      {/* TOP HEADER: Back Button, Segmented View Switcher, and Vocal Cut Button */}
      <header className="relative z-30 flex items-center justify-between w-full flex-shrink-0">
        {/* Back to Library */}
        {onCollapse && (
          <button
            tabIndex={0}
            onClick={onCollapse}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-syne text-xs uppercase tracking-wider border border-white/20 transition-all cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan active:scale-95 shadow-lg"
            title="Back to Desktop Stage (Esc)"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-lumen-cyan" />
            <span>Library</span>
          </button>
        )}

        {/* Center: Stage Switcher (Showcase vs Karaoke Lyrics) */}
        <div className="flex items-center bg-white/10 p-1 rounded-full border border-white/20 shadow-xl backdrop-blur-md">
          <button
            tabIndex={0}
            onClick={() => setActiveTab('showcase')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-syne font-bold transition-all cursor-pointer ${
              activeTab === 'showcase'
                ? 'bg-white text-black shadow-lg scale-102'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Disc3 className="w-3.5 h-3.5" />
            <span>Showcase</span>
          </button>

          <button
            tabIndex={0}
            onClick={() => setActiveTab('lyrics')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-syne font-bold transition-all cursor-pointer ${
              activeTab === 'lyrics'
                ? 'bg-lumen-cyan text-black shadow-lg shadow-lumen-cyan/40 scale-102'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>Karaoke Lyrics</span>
          </button>
        </div>

        {/* Right: Quick Vocal Cut DSP Toggle */}
        <button
          tabIndex={0}
          onClick={handleToggleKaraoke}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold transition-all cursor-pointer border ${
            isKaraokeActive
              ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/80 shadow-[0_0_20px_rgba(52,211,153,0.4)]'
              : 'bg-white/10 text-white/70 hover:text-white border-white/15'
          }`}
          title="Toggle TV Karaoke vocal attenuation (Press 'K')"
        >
          <Mic2 className={`w-3.5 h-3.5 ${isKaraokeActive ? 'text-emerald-300 animate-pulse' : 'text-white/60'}`} />
          <span>VOCALS: {isKaraokeActive ? 'MUTED' : 'NORMAL'}</span>
        </button>
      </header>

      {/* MAIN VIEW AREA: PANE A (SHOWCASE) OR PANE B (KARAOKE LYRICS) */}
      <main className="relative z-20 flex-1 w-full max-w-5xl mx-auto flex items-center justify-center min-h-0 py-2">
        {/* PANE A: SHOWCASE (CENTERED ARTWORK & TRANSPORT) */}
        {activeTab === 'showcase' && (
          <div className="w-full h-full flex flex-col items-center justify-center animate-fadeIn max-w-lg mx-auto">
            {/* Square Album Cover with LED Backlight */}
            <div 
              onClick={() => setActiveTab('lyrics')}
              className="relative group w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 rounded-3xl overflow-hidden shadow-2xl mb-4 flex-shrink-0 cursor-pointer transition-transform duration-300 hover:scale-105"
              title="Click to view Karaoke Lyrics"
            >
              <div 
                className="absolute -inset-3 rounded-3xl opacity-75 blur-2xl transition-all duration-500"
                style={{
                  background: `radial-gradient(circle, ${dominantColor}90, transparent 75%)`
                }}
              />
              <div className="relative w-full h-full rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black/60">
                <CoverImage
                  src={currentTrack?.artworkUrl}
                  title={currentTrack?.title}
                  artist={currentTrack?.artist}
                  size={500}
                  className="w-full h-full object-cover"
                  loading="eager"
                />
              </div>
            </div>

            {/* Track Info */}
            <div className="text-center w-full mb-3 px-4">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-white font-syne tracking-tight truncate drop-shadow-md">
                {currentTrack?.title || 'No Track Playing'}
              </h1>
              <p 
                onClick={() => currentTrack && onSelectArtist && onSelectArtist(currentTrack.artist)}
                className="text-xs sm:text-sm md:text-base text-white/70 font-syne font-medium mt-0.5 truncate hover:text-white cursor-pointer"
              >
                {currentTrack?.artist || 'Ready to play'}
              </p>
            </div>

            {/* Seek Bar */}
            <div className="w-full px-4 mb-3">
              <div 
                className="w-full h-1.5 rounded-full bg-white/10 relative cursor-pointer overflow-hidden group focus-within:ring-2 focus-within:ring-lumen-cyan"
                tabIndex={0}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                  handleSeek(ratio * duration);
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
              <div className="flex justify-between text-[11px] font-mono text-white/50 mt-1">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Transport Controls */}
            <div className="flex items-center justify-center gap-5 mb-2">
              <button
                tabIndex={0}
                onClick={onPrevTrack}
                className="p-3 rounded-full bg-white/5 hover:bg-white/15 text-white/80 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan"
                title="Previous Track"
              >
                <SkipBack className="w-5 h-5 fill-current" />
              </button>

              <button
                ref={playButtonRef}
                tabIndex={0}
                onClick={onTogglePlay}
                className="p-4 rounded-full text-black font-extrabold shadow-2xl transition-all cursor-pointer transform hover:scale-110 active:scale-95 focus:outline-none focus:ring-4 focus:ring-lumen-cyan"
                style={{
                  background: `linear-gradient(135deg, ${dominantColor}, #63E8FF)`,
                  boxShadow: `0 0 25px ${dominantColor}80`
                }}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-7 h-7 fill-black" />
                ) : (
                  <Play className="w-7 h-7 fill-black ml-0.5" />
                )}
              </button>

              <button
                tabIndex={0}
                onClick={onNextTrack}
                className="p-3 rounded-full bg-white/5 hover:bg-white/15 text-white/80 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan"
                title="Next Track"
              >
                <SkipForward className="w-5 h-5 fill-current" />
              </button>
            </div>

            {/* Quick Switch to Lyrics Pill */}
            <button
              tabIndex={0}
              onClick={() => setActiveTab('lyrics')}
              className="flex items-center gap-2 mt-1 px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 text-xs font-syne transition-all cursor-pointer"
            >
              <span>View Fullscreen Karaoke Lyrics</span>
              <ChevronRight className="w-3.5 h-3.5 text-lumen-cyan" />
            </button>
          </div>
        )}

        {/* PANE B: KARAOKE FULLSCREEN LYRICS */}
        {activeTab === 'lyrics' && (
          <div className="w-full h-full flex flex-col items-center justify-between animate-fadeIn max-w-4xl mx-auto">
            {/* Scrolling Kinetic Lyrics */}
            <div 
              ref={lyricsContainerRef}
              className="w-full flex-1 overflow-y-auto no-scrollbar scroll-smooth flex flex-col items-center justify-start space-y-6 py-12 px-6 text-center select-none"
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
                      className={`max-w-3xl px-6 py-2.5 rounded-2xl transition-all duration-300 cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan ${
                        isActive
                          ? 'scale-110 font-black opacity-100'
                          : isNearby
                          ? 'opacity-40 hover:opacity-80 scale-95 font-semibold'
                          : 'opacity-20 hover:opacity-50 scale-90 font-medium'
                      }`}
                      style={
                        isActive
                          ? {
                              color: dominantColor || '#63E8FF',
                              textShadow: `0 0 30px ${dominantColor}bb, 0 0 60px ${dominantColor}50`
                            }
                          : undefined
                      }
                    >
                      <p className="font-syne text-2xl sm:text-3xl md:text-4xl lg:text-5xl leading-tight tracking-tight">
                        {line.text}
                      </p>
                      {line.translation && (
                        <p className="font-outfit text-sm sm:text-base text-white/60 mt-1 italic">
                          {line.translation}
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-center my-auto space-y-3">
                  <div 
                    className="w-16 h-16 rounded-full flex items-center justify-center mb-1 animate-pulse border border-white/20"
                    style={{
                      background: `radial-gradient(circle, ${dominantColor}40, transparent 70%)`
                    }}
                  >
                    <Music className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-bold font-syne text-white tracking-wide">
                    {currentTrack ? 'Instrumental or Syncing Lyrics...' : 'No Track Selected'}
                  </h3>
                  <p className="text-xs text-white/50 font-outfit max-w-sm">
                    {currentTrack 
                      ? 'Sing along with real-time instrumental vocal cut active!' 
                      : 'Choose a song from your library or playlists to start sing-along.'}
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Floating Minimal Dock */}
            <div className="w-full max-w-xl mx-auto flex items-center justify-between px-5 py-2.5 bg-black/70 border border-white/15 rounded-full shadow-2xl backdrop-blur-xl flex-shrink-0 mt-2">
              <button
                tabIndex={0}
                onClick={() => setActiveTab('showcase')}
                className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white font-syne cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Showcase</span>
              </button>

              <div className="flex items-center gap-4">
                <button
                  tabIndex={0}
                  onClick={onPrevTrack}
                  className="p-1.5 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <SkipBack className="w-4 h-4 fill-current" />
                </button>

                <button
                  tabIndex={0}
                  onClick={onTogglePlay}
                  className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 active:scale-90 transition-transform cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black ml-0.5" />}
                </button>

                <button
                  tabIndex={0}
                  onClick={onNextTrack}
                  className="p-1.5 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <SkipForward className="w-4 h-4 fill-current" />
                </button>
              </div>

              <span className="text-[11px] font-mono text-white/50">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
