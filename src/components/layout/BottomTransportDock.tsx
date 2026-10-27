import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  AlignLeft, 
  Disc3,
  ListMusic,
  Heart
} from 'lucide-react';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { LikedService } from '../../services/likedService';
import { SongRatingWidget } from '../views/SongRatingWidget';
import { useDeviceMode } from '../../hooks/useDeviceMode';

interface Props {
  currentTrack: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  activeStage: 'album' | 'lyrics';
  onToggleStage: () => void;
  dominantColor: string;
  onOpenQueue?: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const BottomTransportDock: React.FC<Props> = ({
  currentTrack,
  isPlaying,
  onTogglePlay,
  activeStage,
  onToggleStage,
  dominantColor,
  onOpenQueue
}) => {
  const { isPhone } = useDeviceMode();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(AudioEngine.getVolume());
  const [isMuted, setIsMuted] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);

  const hideTimerRef = useRef<number | null>(null);

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

  // Auto-hide bottom dock after 3s of mouse inactivity
  const handleUserActivity = () => {
    setIsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
    }, 3500);
  };

  useEffect(() => {
    window.addEventListener('mousemove', handleUserActivity);
    return () => {
      window.removeEventListener('mousemove', handleUserActivity);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

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

  const toggleFavorite = () => {
    if (!currentTrack) return;
    const newState = LikedService.toggleLike(currentTrack);
    setIsFavorite(newState);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div 
      onMouseEnter={() => {
        setIsVisible(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      }}
      className={`fixed ${isPhone ? 'bottom-4 left-3 right-3 justify-between px-3.5 py-2.5 rounded-2xl' : 'bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full'} z-50 select-none transition-all duration-500 ease-out flex items-center gap-2 sm:gap-4 bg-white/[0.06] border-t border-l border-white/30 border-r border-b border-black/50 backdrop-blur-3xl shadow-2xl ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
      }`}
      style={{
        boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 0 25px -5px ${dominantColor}50`
      }}
    >
      {/* If phone: show compact artwork + title tapable to open player */}
      {isPhone && currentTrack && (
        <div 
          onClick={onToggleStage}
          className="flex items-center gap-2 min-w-0 max-w-[38%] cursor-pointer"
          title="Tap to open stage"
        >
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-black/60 flex-shrink-0 relative border border-white/20">
            {currentTrack.artworkUrl ? (
              <img src={currentTrack.artworkUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <Disc3 className="w-4 h-4 text-white/40 m-auto mt-2" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h5 className="text-[11px] font-bold text-white truncate">{currentTrack.title}</h5>
            <p className="text-[9px] text-white/50 truncate">{currentTrack.artist}</p>
          </div>
        </div>
      )}

      {/* Favorite Heart & Song Rating */}
      {currentTrack && (
        <div className="flex items-center gap-1">
          <button
            onClick={toggleFavorite}
            className={`p-1.5 rounded-full transition-colors ${
              isFavorite ? 'text-pink-500 fill-pink-500' : 'text-white/40 hover:text-white'
            }`}
            title={isFavorite ? 'Favorited' : 'Add to Favorites'}
          >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
          </button>
          <SongRatingWidget track={currentTrack} dominantColor={dominantColor} compact />
        </div>
      )}

      {/* Transport buttons */}
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          onClick={() => AudioEngine.prev()}
          className="p-1.5 text-white/70 hover:text-white hover:scale-110 active:scale-95 transition-all"
          title="Previous (Left Arrow)"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={onTogglePlay}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-black font-bold transition-all hover:scale-110 active:scale-95 shadow-lg"
          style={{
            backgroundColor: dominantColor,
            boxShadow: `0 0 16px ${dominantColor}`
          }}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        <button
          onClick={() => AudioEngine.next()}
          className="p-1.5 text-white/70 hover:text-white hover:scale-110 active:scale-95 transition-all"
          title="Next (Right Arrow)"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Scrubber and Volume only on larger screens (hidden on phone) */}
      {!isPhone && (
        <>
          <div className="flex items-center gap-2.5 font-mono text-[10px] text-white/60 ml-2">
            <span className="w-8 text-right">{formatDuration(currentTime)}</span>
            <div className="relative w-28 sm:w-36 h-1 bg-white/20 rounded-full overflow-hidden flex items-center group cursor-pointer">
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
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 8px ${dominantColor}`
                }}
              />
            </div>
            <span className="w-8">{formatDuration(duration)}</span>
          </div>

          <div className="w-[1px] h-4 bg-white/20 mx-1" />

          <button
            onClick={onToggleStage}
            className={`p-1.5 rounded-full transition-all ${
              activeStage === 'lyrics' 
                ? 'text-white bg-white/20 shadow-sm' 
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
            title={activeStage === 'album' ? 'Flip to Kinetic Lyrics (M)' : 'Flip to Album Card (M)'}
          >
            {activeStage === 'album' ? <AlignLeft className="w-4 h-4" /> : <Disc3 className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-1.5 group">
            <button onClick={toggleMute} className="text-white/60 hover:text-white">
              {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-pink-400" /> : <Volume2 className="w-4 h-4" />}
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
        </>
      )}

      {/* Queue Drawer Toggle */}
      {onOpenQueue && (
        <button
          onClick={onOpenQueue}
          className="p-1.5 text-white/60 hover:text-lumen-cyan hover:scale-110 active:scale-95 transition-all"
          title="Open Queue"
        >
          <ListMusic className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
