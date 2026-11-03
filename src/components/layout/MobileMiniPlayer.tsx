import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Disc3 } from 'lucide-react';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onOpenPlayer: () => void;
  dominantColor: string;
  isNavVisible?: boolean;
}

export const MobileMiniPlayer: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  onTogglePlay,
  onOpenPlayer,
  dominantColor,
  isNavVisible = true
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    AudioEngine.onTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
    });
  }, []);

  if (!currentTrack) return null;

  const actualDur = currentTrack.actualMediaDuration || duration || currentTrack.duration || 100;
  const progressPercent = Math.min(100, Math.max(0, (currentTime / actualDur) * 100));

  return (
    <div
      onClick={onOpenPlayer}
      role="button"
      tabIndex={0}
      aria-label="Open Playlist / Player Deck"
      className="fixed left-3 right-3 z-40 sm:hidden rounded-2xl bg-[#0c0f17]/95 backdrop-blur-3xl border border-white/20 px-3.5 py-2.5 shadow-2xl flex items-center justify-between cursor-pointer active:scale-[0.99] overflow-hidden select-none bottom-[calc(64px+env(safe-area-inset-bottom))] transition-all duration-300 ease-out"
      style={{
        boxShadow: `0 14px 40px rgba(0, 0, 0, 0.9), 0 0 24px -4px ${dominantColor}50`
      }}
    >
      {/* Top Scrubber Line */}
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-white/10">
        <div 
          className="h-full transition-all duration-200"
          style={{ 
            width: `${progressPercent}%`, 
            backgroundColor: dominantColor,
            boxShadow: `0 0 8px ${dominantColor}`
          }}
        />
      </div>

      {/* Left: Track Title & Artist */}
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center gap-1.5">
          <h4 className="text-xs font-bold text-white truncate tracking-wide">
            {currentTrack.title}
          </h4>
          {currentTrack.isExplicitPreview && (
            <span className="text-[7.5px] font-mono px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold uppercase flex-shrink-0">
              30s
            </span>
          )}
        </div>
        <p className="text-[10px] text-white/60 truncate font-medium mt-0.5">
          {currentTrack.artist}
        </p>
      </div>

      {/* Middle: Controls (SkipBack, Play/Pause, SkipForward) */}
      <div 
        className="flex items-center gap-1.5 flex-shrink-0 px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => AudioEngine.prev()}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 hover:text-white active:scale-90 transition-all cursor-pointer"
          title="Previous Track"
        >
          <SkipBack className="w-4 h-4 fill-current" />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold transition-all active:scale-90 shadow-md cursor-pointer"
          style={{
            backgroundColor: dominantColor,
            boxShadow: `0 0 14px ${dominantColor}90`
          }}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => AudioEngine.next()}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 hover:text-white active:scale-90 transition-all cursor-pointer"
          title="Next Track"
        >
          <SkipForward className="w-4 h-4 fill-current" />
        </button>
      </div>

      {/* Right: Small Album Cover */}
      <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-black/60 border border-white/20 flex-shrink-0 shadow-md">
        {currentTrack.artworkUrl ? (
          <img 
            src={currentTrack.artworkUrl} 
            alt={currentTrack.title} 
            className="w-full h-full object-cover" 
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-5 h-5 text-white/40" />
          </div>
        )}
        {isPlaying && (
          <div 
            className="absolute inset-0 border-2 rounded-xl pointer-events-none animate-pulse"
            style={{ borderColor: dominantColor }}
          />
        )}
      </div>
    </div>
  );
};
