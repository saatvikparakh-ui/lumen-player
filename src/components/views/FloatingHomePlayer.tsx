import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Disc3, 
  AlignLeft, 
  Maximize2, 
  Minimize2, 
  Move, 
  X,
  Volume2
} from 'lucide-react';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { SongRatingWidget } from './SongRatingWidget';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  dominantColor: string;
  bassScale: number;
  spectrumBars: number[];
  onSelectArtist: (artist: string) => void;
  onOpenPlayerView: () => void;
  onToggleLyrics: () => void;
}

type WidgetSize = 'compact' | 'standard' | 'expanded';

export const FloatingHomePlayer: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  dominantColor,
  bassScale,
  spectrumBars,
  onSelectArtist,
  onOpenPlayerView,
  onToggleLyrics
}) => {
  // Saved size preference
  const [size, setSize] = useState<WidgetSize>(() => {
    try {
      const saved = localStorage.getItem('lumen_home_player_size');
      if (saved === 'compact' || saved === 'standard' || saved === 'expanded') return saved;
    } catch (_) {}
    return 'standard';
  });

  const [isMinimized, setIsMinimized] = useState(false);
  const [isDjActive, setIsDjActive] = useState(false);
  const [djProgress, setDjProgress] = useState(0);

  useEffect(() => {
    return AudioEngine.onDjTransition((transitioning, progress) => {
      setIsDjActive(transitioning);
      setDjProgress(progress);
    });
  }, []);

  // Position state (clamped to window boundaries)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('lumen_home_player_pos');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    // Default position: bottom-right
    return {
      x: typeof window !== 'undefined' ? Math.max(20, window.innerWidth - 380) : 40,
      y: typeof window !== 'undefined' ? Math.max(80, window.innerHeight - 440) : 100
    };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const avgLeftFlow = (spectrumBars[0] + spectrumBars[1] + spectrumBars[2] + spectrumBars[3]) / 4;
  const avgRightFlow = (spectrumBars[4] + spectrumBars[5] + spectrumBars[6] + spectrumBars[7]) / 4;

  const handleSizeChange = (newSize: WidgetSize) => {
    setSize(newSize);
    try {
      localStorage.setItem('lumen_home_player_size', newSize);
    } catch (_) {}
  };

  // Start dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) {
      return;
    }
    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const widgetWidth = size === 'compact' ? 300 : size === 'standard' ? 340 : 400;
      const widgetHeight = size === 'compact' ? 70 : size === 'standard' ? 380 : 450;

      const maxX = Math.max(10, window.innerWidth - widgetWidth - 10);
      const maxY = Math.max(70, window.innerHeight - widgetHeight - 10);

      const newX = Math.min(Math.max(10, e.clientX - dragOffsetRef.current.x), maxX);
      const newY = Math.min(Math.max(70, e.clientY - dragOffsetRef.current.y), maxY);

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        try {
          localStorage.setItem('lumen_home_player_pos', JSON.stringify(position));
        } catch (_) {}
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position, size]);

  if (!currentTrack || isMinimized) {
    if (!currentTrack) return null;
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-24 right-8 z-40 px-3.5 py-2 rounded-full bg-black/80 hover:bg-black border border-white/20 backdrop-blur-2xl text-xs font-mono text-white flex items-center gap-2 shadow-2xl hover:scale-105 active:scale-95 transition-all"
        style={{ boxShadow: `0 10px 30px -5px ${dominantColor}50` }}
      >
        <Disc3 className={`w-4 h-4 text-lumen-cyan ${isPlaying ? 'animate-spin' : ''}`} />
        <span className="max-w-[140px] truncate">{currentTrack.title}</span>
        <Maximize2 className="w-3 h-3 text-white/50" />
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        boxShadow: `0 25px 60px rgba(0, 0, 0, 0.9), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4), 0 0 35px -5px ${dominantColor}50`
      }}
      className={`fixed z-40 rounded-3xl bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-white/[0.01] border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-3xl select-none transition-all duration-300 ${
        isDragging ? 'cursor-grabbing opacity-95 scale-[1.02]' : 'cursor-grab'
      } ${
        size === 'compact'
          ? 'w-72 sm:w-80 p-3'
          : size === 'standard'
          ? 'w-80 sm:w-88 p-5'
          : 'w-88 sm:w-96 p-6'
      }`}
    >
      {/* Dynamic LED perimeter frame synchronized with bass pulse */}
      <div 
        className="absolute inset-0 rounded-3xl pointer-events-none transition-all duration-150"
        style={{
          border: `2px solid ${dominantColor}`,
          boxShadow: `inset 0 0 ${Math.round(20 * bassScale)}px ${dominantColor}50, 0 0 ${Math.round(28 * bassScale)}px ${dominantColor}40`,
          opacity: 0.85 + (bassScale - 1) * 0.4
        }}
      />

      {/* Top Drag & Sizing Bar */}
      <div 
        onMouseDown={handleMouseDown}
        className="flex items-center justify-between pb-2 mb-2 border-b border-white/10"
      >
        <div className="flex items-center gap-1.5 text-white/50 text-[10px] font-mono tracking-widest uppercase">
          <Move className="w-3 h-3 text-lumen-cyan" />
          <span>LUMEN PLAYER</span>
        </div>

        {/* Size Selector & Minimize */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleSizeChange('compact')}
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${
              size === 'compact' ? 'bg-white text-black font-bold' : 'text-white/40 hover:text-white'
            }`}
            title="Compact Pill"
          >
            S
          </button>
          <button
            onClick={() => handleSizeChange('standard')}
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${
              size === 'standard' ? 'bg-white text-black font-bold' : 'text-white/40 hover:text-white'
            }`}
            title="Standard Widget"
          >
            M
          </button>
          <button
            onClick={() => handleSizeChange('expanded')}
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${
              size === 'expanded' ? 'bg-white text-black font-bold' : 'text-white/40 hover:text-white'
            }`}
            title="Expanded Card"
          >
            L
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 text-white/40 hover:text-white transition-colors ml-1"
            title="Minimize"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* COMPACT MODE */}
      {size === 'compact' && (
        <div className="flex items-center gap-3 relative z-10">
          <div 
            onClick={onOpenPlayerView}
            className="w-12 h-12 rounded-xl overflow-hidden border border-white/20 flex-shrink-0 cursor-pointer shadow-md group relative"
          >
            {currentTrack.artworkUrl ? (
              <img src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <Disc3 className="w-full h-full p-2 text-white/40" />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Maximize2 className="w-3.5 h-3.5 text-white" />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <h4 
              onClick={onOpenPlayerView}
              className="text-xs font-bold text-white truncate cursor-pointer hover:text-lumen-cyan transition-colors"
              title={currentTrack.title}
            >
              {currentTrack.title}
            </h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p 
                onClick={() => onSelectArtist(currentTrack.artist)}
                className="text-[10px] text-white/50 truncate cursor-pointer hover:text-white transition-colors"
              >
                {currentTrack.artist}
              </p>
              <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-lumen-cyan/20 text-lumen-cyan border border-lumen-cyan/40 font-bold uppercase tracking-wider flex-shrink-0">
                Hi-Fi
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <SongRatingWidget track={currentTrack} dominantColor={dominantColor} compact />
            <button
              onClick={() => AudioEngine.prev()}
              className="p-1 text-white/60 hover:text-white transition-colors"
              title="Previous"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => AudioEngine.togglePlay(currentTrack)}
              className="p-2 rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-md"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-black" /> : <Play className="w-3.5 h-3.5 fill-black ml-0.5" />}
            </button>
            <button
              onClick={() => AudioEngine.next()}
              className="p-1 text-white/60 hover:text-white transition-colors"
              title="Next"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => AudioEngine.triggerDjTransition()}
              className={`p-1 rounded-full transition-all flex items-center justify-center ${
                isDjActive
                  ? 'bg-gradient-to-r from-pink-500 to-cyan-400 text-white shadow-lg animate-pulse scale-105'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
              title={isDjActive ? `DJ Transitioning (${Math.round(djProgress * 100)}%)` : "Mid-Track DJ Transition (Mix Next Track)"}
            >
              <Disc3 className={`w-3.5 h-3.5 ${isDjActive ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* STANDARD & EXPANDED MODES */}
      {size !== 'compact' && (
        <div className="flex flex-col items-center text-center relative z-10">
          {/* Vertical Spectral Flow Bars on sides for Expanded size */}
          {size === 'expanded' && (
            <>
              <div 
                className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 z-20 rounded-r-full transition-all duration-75 blur-[1px]"
                style={{
                  height: `${Math.max(20, avgLeftFlow * 0.7)}%`,
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 16px 3px ${dominantColor}`
                }}
              />
              <div 
                className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 w-1.5 z-20 rounded-l-full transition-all duration-75 blur-[1px]"
                style={{
                  height: `${Math.max(20, avgRightFlow * 0.7)}%`,
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 16px 3px ${dominantColor}`
                }}
              />
            </>
          )}

          {/* Artwork */}
          <div 
            onClick={onOpenPlayerView}
            className={`rounded-2xl overflow-hidden shadow-2xl border border-white/20 mb-3 relative group cursor-pointer transition-transform duration-300 ${
              size === 'expanded' ? 'w-48 h-48 sm:w-56 sm:h-56' : 'w-36 h-36 sm:w-44 sm:h-44'
            }`}
            style={{
              boxShadow: `0 16px 40px -10px ${dominantColor}60`,
              transform: `scale(${1 + (bassScale - 1) * 0.03})`
            }}
            title="Click to view full player stage"
          >
            {currentTrack.artworkUrl ? (
              <img src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-black/60 text-white/30">
                <Disc3 className="w-12 h-12 animate-spin text-white/40" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs gap-1.5 font-medium">
              <Maximize2 className="w-4 h-4 text-lumen-cyan" />
              <span>Full Stage</span>
            </div>
          </div>

          <h3 
            onClick={onOpenPlayerView}
            className="text-sm font-bold text-white tracking-tight truncate max-w-full px-2 cursor-pointer hover:text-lumen-cyan transition-colors" 
            title={currentTrack.title}
          >
            {currentTrack.title}
          </h3>
          <div className="flex items-center justify-center gap-1.5 mt-0.5 max-w-full px-2">
            <p 
              onClick={() => onSelectArtist(currentTrack.artist)}
              className="text-xs text-white/50 truncate hover:text-white hover:underline cursor-pointer" 
              title={currentTrack.artist}
            >
              {currentTrack.artist}
            </p>
            <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-lumen-cyan/20 text-lumen-cyan border border-lumen-cyan/40 font-bold uppercase tracking-wider flex-shrink-0">
              Hi-Fi
            </span>
          </div>

          <div className="mt-2">
            <SongRatingWidget track={currentTrack} dominantColor={dominantColor} compact />
          </div>

          {/* Controls Bar */}
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={onToggleLyrics}
              className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Toggle Lyrics"
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => AudioEngine.prev()}
              className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title="Previous Track"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={() => AudioEngine.togglePlay(currentTrack)}
              className="p-3 rounded-full text-black transition-all hover:scale-105 active:scale-95 shadow-lg flex items-center justify-center"
              style={{
                backgroundColor: dominantColor || '#FFFFFF',
                boxShadow: `0 8px 24px -4px ${dominantColor || '#FFFFFF'}60`
              }}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-black" />
              ) : (
                <Play className="w-4 h-4 fill-black ml-0.5" />
              )}
            </button>

            <button
              onClick={() => AudioEngine.next()}
              className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title="Next Track"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              onClick={() => AudioEngine.triggerDjTransition()}
              className={`p-2 rounded-full transition-all flex items-center justify-center ${
                isDjActive
                  ? 'bg-gradient-to-r from-pink-500 to-cyan-400 text-white shadow-lg animate-pulse scale-110'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
              title={isDjActive ? `DJ Transitioning (${Math.round(djProgress * 100)}%)` : "Mid-Track DJ Transition (Mix Next Track)"}
            >
              <Disc3 className={`w-4 h-4 ${isDjActive ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onOpenPlayerView}
              className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Open Stage"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
