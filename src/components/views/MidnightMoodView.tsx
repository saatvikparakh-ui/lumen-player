import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  X, 
  Disc3, 
  AlignLeft, 
  Sparkles,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { Track, LyricLine } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { fetchOnlineLyrics } from '../../services/lyricsService';
import { extractDominantColor, ColorSample } from '../../services/colorSampler';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const MidnightMoodView: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  onClose,
  onTogglePlay
}) => {
  const [activeStage, setActiveStage] = useState<'album' | 'lyrics'>('album');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [volume, setVolumeState] = useState(AudioEngine.getVolume());
  const [isMuted, setIsMuted] = useState(false);
  const [colorSample, setColorSample] = useState<ColorSample>({
    dominant: '#FF2E93', // Vibrant neon magenta default like Spider-Verse / Graduation
    glowRgba: 'rgba(255, 46, 147, 0.45)',
    secondaryGlow: 'rgba(154, 118, 255, 0.3)'
  });
  const [bassScale, setBassScale] = useState(1);

  const hideTimerRef = useRef<number | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);

  // 1. Audio time & bass pulse listener
  useEffect(() => {
    AudioEngine.onTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
    });

    let animId: number;
    const freqData = new Uint8Array(32);

    const checkBassPulse = () => {
      AudioEngine.getFrequencyData(freqData);
      // Average the lowest 4 frequency bins (32Hz - 125Hz)
      const bassAvg = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / 4;
      const normalizedBass = 1 + (bassAvg / 255) * 0.25; // 1.0 to 1.25 scale
      setBassScale(normalizedBass);

      animId = requestAnimationFrame(checkBassPulse);
    };

    animId = requestAnimationFrame(checkBassPulse);
    return () => cancelAnimationFrame(animId);
  }, []);

  // 2. Color extraction & lyrics fetch on track change
  useEffect(() => {
    if (!currentTrack) return;

    extractDominantColor(currentTrack.artworkUrl).then((sample) => {
      setColorSample(sample);
    });

    fetchOnlineLyrics(currentTrack.artist, currentTrack.title, currentTrack.duration).then((res) => {
      setLyrics(res);
    });
  }, [currentTrack]);

  // 3. Active lyric auto-scroll
  let activeLyricIdx = -1;
  if (lyrics && lyrics.length > 0) {
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        activeLyricIdx = i;
      } else {
        break;
      }
    }
  }

  useEffect(() => {
    if (activeStage === 'lyrics' && activeLyricIdx >= 0 && lyricsContainerRef.current) {
      const activeEl = lyricsContainerRef.current.children[activeLyricIdx] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeLyricIdx, activeStage]);

  // 4. Auto-hide bottom dock on inactivity (3 seconds)
  const handleUserActivity = () => {
    setIsControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setIsControlsVisible(false);
    }, 3000);
  };

  useEffect(() => {
    handleUserActivity();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // 5. Global Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'm') {
        onClose();
      } else if (e.code === 'Space') {
        e.preventDefault();
        onTogglePlay();
      } else if (e.key === 'ArrowRight') {
        AudioEngine.next();
      } else if (e.key === 'ArrowLeft') {
        AudioEngine.prev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onTogglePlay]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    AudioEngine.seek(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolumeState(val);
    setIsMuted(val === 0);
    AudioEngine.setVolume(val);
  };

  const toggleMute = () => {
    if (isMuted) {
      AudioEngine.setVolume(volume || 0.8);
      setIsMuted(false);
    } else {
      AudioEngine.setVolume(0);
      setIsMuted(true);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div 
      onMouseMove={handleUserActivity}
      onClick={() => {
        // Tap screen to flip between Centered Album and Kinetic Lyrics
        setActiveStage(prev => prev === 'album' ? 'lyrics' : 'album');
        handleUserActivity();
      }}
      className="fixed inset-0 z-50 bg-[#000000] text-[#F1F4FC] overflow-hidden select-none flex flex-col items-center justify-center cursor-pointer transition-colors duration-1000"
    >
      {/* 
        1. THE NEON EDGE-GLOW CONTOUR
        Traces the exact perimeter of the window/screen with audio-reactive bass glow
      */}
      <div 
        className="pointer-events-none absolute inset-0 z-40 transition-all duration-150"
        style={{
          boxShadow: `inset 0 0 ${Math.round(20 * bassScale)}px ${Math.round(6 * bassScale)}px ${colorSample.dominant}, 0 0 ${Math.round(40 * bassScale)}px ${colorSample.dominant}`,
          border: `2px solid ${colorSample.dominant}`,
          opacity: 0.85 + (bassScale - 1) * 0.6
        }}
      />

      {/* Subtle Ambient Backlight Glow behind active stage */}
      <div 
        className="pointer-events-none absolute w-[600px] h-[600px] rounded-full blur-[160px] opacity-25 transition-all duration-1000 -z-10"
        style={{
          backgroundColor: colorSample.dominant,
          transform: `scale(${bassScale})`
        }}
      />

      {/* Top Subtle Mode Pill & Exit Hint */}
      <div 
        className={`absolute top-6 left-1/2 -translate-x-1/2 z-30 transition-opacity duration-500 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/60 border border-white/10 backdrop-blur-md ${
          isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
        <span className="text-[11px] font-mono tracking-widest text-lumen-textMuted uppercase">
          Midnight Mood • Click Screen to Flip ({activeStage.toUpperCase()})
        </span>
        <button
          onClick={onClose}
          className="ml-2 p-1 rounded-full text-lumen-textMuted hover:text-white hover:bg-white/10 transition-colors"
          title="Exit Midnight Mood (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 
        2. CENTER STAGE (CLICK TO FLIP)
      */}
      <div className="w-full max-w-4xl h-[70vh] flex items-center justify-center relative z-20 px-6">
        {/* STAGE 1: CENTERED FLOATING ALBUM CARD (IMAGE 4) */}
        {activeStage === 'album' && currentTrack && (
          <div className="flex flex-col items-center text-center animate-fadeIn select-none">
            {/* Floating Square Artwork */}
            <div 
              className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 rounded-3xl overflow-hidden bg-black/80 border border-white/15 transition-transform duration-500 shadow-2xl"
              style={{
                boxShadow: `0 25px 60px -15px ${colorSample.glowRgba}, 0 0 30px ${colorSample.glowRgba}`,
                transform: `scale(${1 + (bassScale - 1) * 0.05})`
              }}
            >
              {currentTrack.artworkUrl ? (
                <img 
                  src={currentTrack.artworkUrl} 
                  alt={currentTrack.title} 
                  className="w-full h-full object-cover" 
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-black/90 text-lumen-textDim">
                  <Disc3 className="w-20 h-20 text-lumen-cyan mb-2" />
                  <span className="text-xs font-mono uppercase tracking-widest">No Artwork</span>
                </div>
              )}
            </div>

            {/* Track Title & Artist */}
            <div className="mt-6 max-w-md">
              <h2 className="text-2xl font-bold tracking-tight text-white truncate" title={currentTrack.title}>
                {currentTrack.title}
              </h2>
              <p className="text-sm font-medium text-lumen-textMuted mt-1 truncate">
                {currentTrack.artist} {currentTrack.album ? `• ${currentTrack.album}` : ''}
              </p>
            </div>

            {/* Click to view lyrics prompt */}
            <div className="mt-4 flex items-center gap-1.5 text-[11px] font-mono text-lumen-cyan/70 hover:text-lumen-cyan transition-colors">
              <AlignLeft className="w-3.5 h-3.5" />
              <span>Click anywhere for kinetic lyrics</span>
            </div>
          </div>
        )}

        {/* STAGE 2: HUGE KINETIC TYPOGRAPHY LYRICS (IMAGES 2 & 3) */}
        {activeStage === 'lyrics' && (
          <div 
            ref={lyricsContainerRef}
            className="w-full h-full overflow-y-auto space-y-8 flex flex-col items-center justify-center text-center scroll-smooth py-16 animate-fadeIn no-scrollbar"
            onClick={(e) => {
              // Clicking lyric line seeks; clicking empty space flips
              e.stopPropagation();
              setActiveStage('album');
            }}
          >
            {lyrics && lyrics.length > 0 ? (
              lyrics.map((line, idx) => {
                const isActive = idx === activeLyricIdx;
                const isUpcoming = idx > activeLyricIdx;
                const isPast = idx < activeLyricIdx;

                return (
                  <p
                    key={`${line.time}_${idx}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      AudioEngine.seek(line.time);
                    }}
                    className={`font-sans tracking-tight transition-all duration-500 cursor-pointer max-w-3xl px-4 ${
                      isActive
                        ? 'text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-white scale-105'
                        : isUpcoming
                        ? 'text-xl sm:text-2xl md:text-3xl font-bold text-white/30 hover:text-white/60'
                        : 'text-xl sm:text-2xl md:text-3xl font-bold text-white/20'
                    }`}
                    style={{
                      textShadow: isActive 
                        ? `0 0 25px ${colorSample.dominant}, 0 0 50px ${colorSample.dominant}` 
                        : 'none'
                    }}
                  >
                    {line.text}
                  </p>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-8 text-white/40">
                <AlignLeft className="w-16 h-16 mb-4 opacity-30 text-lumen-cyan" />
                <h3 className="text-xl font-bold text-white">Instrumental or No Synced Lyrics</h3>
                <p className="text-xs text-white/50 mt-1 max-w-sm">
                  Click anywhere to return to the centered album artwork card.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 
        3. AUTO-HIDING FLOATING FROSTED BOTTOM DOCK (IMAGES 1 & 4)
      */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-out flex items-center gap-4 px-6 py-3 rounded-full bg-black/60 border border-white/15 backdrop-blur-2xl shadow-2xl ${
          isControlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
        }`}
        style={{
          boxShadow: `0 15px 40px -10px rgba(0, 0, 0, 0.9), 0 0 20px -5px ${colorSample.glowRgba}`
        }}
      >
        {/* Previous Track */}
        <button
          onClick={() => AudioEngine.prev()}
          className="p-1.5 text-white/70 hover:text-white hover:scale-110 active:scale-95 transition-all"
          title="Previous (Left Arrow)"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        {/* Play / Pause with dynamic neon aura */}
        <button
          onClick={onTogglePlay}
          className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold transition-all hover:scale-110 active:scale-95"
          style={{
            backgroundColor: colorSample.dominant,
            boxShadow: `0 0 15px ${colorSample.dominant}`
          }}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        {/* Next Track */}
        <button
          onClick={() => AudioEngine.next()}
          className="p-1.5 text-white/70 hover:text-white hover:scale-110 active:scale-95 transition-all"
          title="Next (Right Arrow)"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Micro Scrubber Bar */}
        <div className="flex items-center gap-2.5 font-mono text-[10px] text-white/60 ml-2">
          <span>{formatDuration(currentTime)}</span>
          <div className="relative w-28 h-1 bg-white/20 rounded-full overflow-hidden flex items-center group cursor-pointer">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div 
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: colorSample.dominant,
                boxShadow: `0 0 8px ${colorSample.dominant}`
              }}
            />
          </div>
          <span>{formatDuration(duration)}</span>
        </div>

        {/* Divider */}
        <div className="w-[1px] h-4 bg-white/20 mx-1" />

        {/* Flip Stage Toggle Button (Album <-> Lyrics) */}
        <button
          onClick={() => setActiveStage(prev => prev === 'album' ? 'lyrics' : 'album')}
          className={`p-1.5 rounded-full transition-colors ${
            activeStage === 'lyrics' ? 'text-lumen-cyan bg-white/10' : 'text-white/70 hover:text-white'
          }`}
          title={activeStage === 'album' ? 'Show Kinetic Lyrics' : 'Show Album Card'}
        >
          {activeStage === 'album' ? <AlignLeft className="w-4 h-4" /> : <Disc3 className="w-4 h-4" />}
        </button>

        {/* Volume Mute & Slider */}
        <div className="flex items-center gap-1.5 group">
          <button onClick={toggleMute} className="text-white/70 hover:text-white">
            {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-white/20 rounded-full appearance-none cursor-pointer"
          />
        </div>

        {/* Exit Full-Screen Button */}
        <button
          onClick={onClose}
          className="p-1.5 text-white/70 hover:text-white hover:scale-110 active:scale-95 transition-all ml-1"
          title="Exit Midnight Mood (Esc)"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
