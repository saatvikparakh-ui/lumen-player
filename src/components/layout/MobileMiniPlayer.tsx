import React, { useState, useEffect } from 'react';
import { Play, Pause, Disc3, Heart, AlertCircle } from 'lucide-react';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { LikedService } from '../../services/likedService';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onOpenPlayer: () => void;
  dominantColor: string;
}

export const MobileMiniPlayer: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  onTogglePlay,
  onOpenPlayer,
  dominantColor
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    AudioEngine.onTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
    });
  }, []);

  useEffect(() => {
    if (currentTrack) {
      setIsFavorite(LikedService.isLiked(currentTrack.id));
    }
  }, [currentTrack]);

  if (!currentTrack) return null;

  const actualDur = currentTrack.actualMediaDuration || duration || currentTrack.duration || 100;
  const progressPercent = Math.min(100, Math.max(0, (currentTime / actualDur) * 100));

  const toggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack) return;
    const next = !isFavorite;
    setIsFavorite(next);
    LikedService.toggleLike(currentTrack);
  };

  return (
    <div
      onClick={onOpenPlayer}
      role="button"
      tabIndex={0}
      aria-label="Expand Now Playing"
      className="fixed bottom-[calc(56px+max(0.5rem,env(safe-area-inset-bottom))+6px)] left-2 right-2 z-40 sm:hidden rounded-2xl bg-black/85 backdrop-blur-3xl border border-white/20 p-2 shadow-2xl flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all overflow-hidden"
      style={{
        boxShadow: `0 12px 35px rgba(0, 0, 0, 0.9), 0 0 20px -4px ${dominantColor}50`
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

      {/* Left Artwork & Track Info */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2 pt-0.5">
        <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-black/60 border border-white/20 flex-shrink-0">
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
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
              <div 
                className="w-2.5 h-2.5 rounded-full animate-ping"
                style={{ backgroundColor: dominantColor }}
              />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h4 className="text-xs font-bold text-white truncate">
              {currentTrack.title}
            </h4>
            {currentTrack.isExplicitPreview && (
              <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold uppercase flex-shrink-0">
                Preview (30s)
              </span>
            )}
          </div>
          <p className="text-[10px] text-white/60 truncate">
            {currentTrack.artist}
          </p>
        </div>
      </div>

      {/* Right Action Controls (Min 44x44px touch targets) */}
      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Heart button */}
        <button
          type="button"
          onClick={toggleFavorite}
          className={`w-11 h-11 flex items-center justify-center rounded-full transition-all active:scale-90 ${
            isFavorite ? 'text-pink-500' : 'text-white/40 hover:text-white'
          }`}
          title={isFavorite ? 'Favorited' : 'Add to Favorites'}
        >
          <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
        </button>

        {/* Play / Pause Toggle Button */}
        <button
          type="button"
          onClick={onTogglePlay}
          className="w-11 h-11 rounded-full flex items-center justify-center text-black font-bold transition-all active:scale-90 shadow-md"
          style={{
            backgroundColor: dominantColor,
            boxShadow: `0 0 12px ${dominantColor}80`
          }}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>
      </div>
    </div>
  );
};
