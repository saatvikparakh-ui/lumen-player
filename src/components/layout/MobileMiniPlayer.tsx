import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, Star, X, Check } from 'lucide-react';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { CoverImage } from '../common/CoverImage';
import { WatchSoundService } from '../../services/watchSoundService';
import { RatingAndStatsService } from '../../services/ratingAndStatsService';

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

  // Floating Rating Panel State
  const [isRatingOpen, setIsRatingOpen] = useState(false);
  const [ratingScore, setRatingScore] = useState<number>(8.0);
  const [currentSongRating, setCurrentSongRating] = useState<string | null>(null);

  useEffect(() => {
    const unsub = AudioEngine.onTimeUpdate((time, dur) => {
      setCurrentTime(prev => (Math.abs(prev - time) >= 0.35 || time === 0 ? time : prev));
      setDuration(prev => (prev !== dur ? dur : prev));
    });
    return () => unsub();
  }, []);

  // Sync rating for current track
  useEffect(() => {
    if (!currentTrack?.id) {
      setCurrentSongRating(null);
      setIsRatingOpen(false);
      return;
    }

    const cached = RatingAndStatsService.getCachedRating(currentTrack.id);
    if (cached !== null) {
      setCurrentSongRating(cached);
      setRatingScore(parseFloat(cached) || 8.0);
    } else {
      RatingAndStatsService.getRating(currentTrack.id).then(r => {
        setCurrentSongRating(r);
        if (r) setRatingScore(parseFloat(r) || 8.0);
      });
    }

    const unsub = RatingAndStatsService.onRatingChange((songId, r) => {
      if (songId === currentTrack.id) {
        setCurrentSongRating(r);
        if (r) setRatingScore(parseFloat(r) || 8.0);
      }
    });

    return () => unsub();
  }, [currentTrack?.id]);

  if (!currentTrack) return null;

  const actualDur = currentTrack.actualMediaDuration || duration || currentTrack.duration || 100;
  const progressPercent = Math.min(100, Math.max(0, (currentTime / actualDur) * 100));

  const handleStepChange = (delta: number) => {
    WatchSoundService.playTick(1.0);
    setRatingScore(prev => Math.max(0.1, Math.min(10.0, Math.round((prev + delta) * 10) / 10)));
  };

  const handleApplyRating = async () => {
    WatchSoundService.playTick(1.3);
    const clean = Math.max(0.1, Math.min(10.0, Math.round(ratingScore * 10) / 10));
    await RatingAndStatsService.setRating(currentTrack, clean);
    setCurrentSongRating(clean.toFixed(1));
    setIsRatingOpen(false);
  };

  const handleClearRating = async () => {
    WatchSoundService.playTick(0.9);
    await RatingAndStatsService.deleteRating(currentTrack.id);
    setCurrentSongRating(null);
    setIsRatingOpen(false);
  };

  const ratingLabel =
    ratingScore >= 9.5 ? 'Masterpiece ✨' :
    ratingScore >= 8.5 ? 'Essential 🔥' :
    ratingScore >= 7.0 ? 'Great track 👍' :
    ratingScore >= 5.0 ? 'Average' : 'Skipped';

  return (
    <>
      {/* Tap-outside Backdrop to dismiss rating panel */}
      {isRatingOpen && (
        <div
          className="fixed inset-0 z-[65] bg-black/30 backdrop-blur-[2px] animate-fadeIn"
          onClick={(e) => {
            e.stopPropagation();
            setIsRatingOpen(false);
          }}
        />
      )}

      {/* Floating Liquid-Glass Rating Panel docked directly ABOVE MobileMiniPlayer */}
      {isRatingOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed left-3.5 right-3.5 max-w-sm mx-auto z-[70] rounded-[26px] bg-gradient-to-b from-neutral-900/98 via-neutral-950/98 to-black/98 backdrop-blur-3xl border border-white/25 p-4 select-none shadow-2xl transition-all duration-200"
          style={{
            bottom: isNavVisible
              ? 'calc(152px + env(safe-area-inset-bottom, 8px))'
              : 'calc(86px + env(safe-area-inset-bottom, 8px))',
            boxShadow: `0 25px 60px rgba(0,0,0,0.95), 0 0 35px -8px ${dominantColor}50, inset 0 1px 1.5px rgba(255,255,255,0.3)`
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{currentTrack.title}</div>
                <div className="text-[10px] text-white/50 truncate">{currentTrack.artist}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {currentSongRating !== null && (
                <button
                  type="button"
                  onClick={handleClearRating}
                  className="text-[10px] text-rose-400/80 hover:text-rose-300 px-2 py-0.5 rounded-lg hover:bg-rose-500/10 transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsRatingOpen(false)}
                className="p-1 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                title="Close rating panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Big Score Readout */}
          <div className="text-center my-2">
            <div className="flex items-baseline justify-center gap-1.5">
              <span className="text-3xl font-black font-mono text-amber-300 tracking-tight drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]">
                {ratingScore.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-white/40">/ 10.0</span>
            </div>
            <div className="text-[10.5px] text-white/60 font-medium mt-0.5">
              {ratingLabel}
            </div>
          </div>

          {/* Steppers & Precision Slider */}
          <div className="flex items-center gap-2 my-2.5">
            <button
              type="button"
              onClick={() => handleStepChange(-0.1)}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs font-bold transition-all active:scale-95"
              title="-0.1"
            >
              -0.1
            </button>

            <input
              type="range"
              min="0.1"
              max="10.0"
              step="0.1"
              value={ratingScore}
              onChange={(e) => setRatingScore(parseFloat(e.target.value))}
              className="flex-1 accent-amber-400 h-2 bg-white/10 rounded-full cursor-pointer"
            />

            <button
              type="button"
              onClick={() => handleStepChange(0.1)}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs font-bold transition-all active:scale-95"
              title="+0.1"
            >
              +0.1
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-white/5 mb-3">
            {[5.0, 7.0, 8.5, 9.5, 10.0].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(1.0);
                  setRatingScore(preset);
                }}
                className={`flex-1 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                  Math.abs(ratingScore - preset) < 0.05
                    ? 'bg-amber-400 text-black shadow-[0_0_10px_rgba(251,191,36,0.6)]'
                    : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {preset.toFixed(1)}
              </button>
            ))}
          </div>

          {/* Confirm Button */}
          <button
            type="button"
            onClick={handleApplyRating}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 text-black font-black text-xs shadow-lg shadow-amber-500/25 flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>Confirm Rating ({ratingScore.toFixed(1)} ★)</span>
          </button>
        </div>
      )}

      {/* Mobile Mini Player Bar */}
      <div
        onClick={onOpenPlayer}
        role="button"
        tabIndex={0}
        aria-label="Open Playlist / Player Deck"
        className="fixed left-3.5 right-3.5 max-w-sm mx-auto z-50 rounded-[26px] bg-gradient-to-b from-white/[0.18] via-white/[0.07] to-black/80 backdrop-blur-3xl border-t border-l border-white/35 border-r border-b border-white/15 px-3.5 py-2.5 shadow-2xl flex items-center justify-between cursor-pointer active:scale-[0.98] overflow-hidden select-none transition-all duration-300 ease-out"
        style={{
          bottom: isNavVisible
            ? 'calc(84px + env(safe-area-inset-bottom, 8px))'
            : 'calc(18px + env(safe-area-inset-bottom, 8px))',
          boxShadow: `0 18px 45px -6px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.45), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.4), 0 0 28px -4px ${dominantColor}45`
        }}
      >
        {/* Specular Liquid Glass Top Refraction Sheen */}
        <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-white/20 via-white/[0.05] to-transparent pointer-events-none" />

        {/* Top Scrubber Line */}
        <div className="absolute top-0 left-3 right-3 h-[2px] bg-white/10 rounded-full overflow-hidden">
          <div 
            className="h-full transition-all duration-200 rounded-full"
            style={{ 
              width: `${progressPercent}%`, 
              backgroundColor: dominantColor,
              boxShadow: `0 0 10px ${dominantColor}`
            }}
          />
        </div>

        {/* Left: Album Cover Art with dynamic glow */}
        <div className="relative w-11 h-11 rounded-2xl overflow-hidden bg-black/60 border border-white/25 flex-shrink-0 shadow-lg mr-3">
          <CoverImage 
            src={currentTrack.artworkUrl} 
            alt={currentTrack.title} 
            title={currentTrack.title}
            artist={currentTrack.artist}
            album={currentTrack.album}
            size={150}
            className="w-full h-full object-cover" 
          />
          {isPlaying && (
            <div 
              className="absolute inset-0 border-2 rounded-2xl pointer-events-none animate-pulse"
              style={{ borderColor: dominantColor }}
            />
          )}
        </div>

        {/* Middle: Track Title & Artist */}
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-1.5">
            <h4 className="text-xs font-bold text-white truncate tracking-tight">
              {currentTrack.title}
            </h4>
            {currentTrack.isExplicitPreview && (
              <span className="text-[7.5px] font-mono px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold uppercase flex-shrink-0 border border-amber-500/30">
                30s
              </span>
            )}
          </div>
          <p className="text-[10.5px] text-white/60 truncate font-medium mt-0.5">
            {currentTrack.artist}
          </p>
        </div>

        {/* Right: Controls (Rate, Play/Pause, SkipForward) */}
        <div 
          className="flex items-center gap-1.5 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile Dedicated Song Rating Trigger Button */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              WatchSoundService.playTick(1.1);
              setIsRatingOpen(prev => !prev);
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-mono flex items-center gap-1 border transition-all active:scale-95 cursor-pointer ${
              currentSongRating !== null
                ? 'bg-amber-500/20 text-amber-300 border-amber-400/40 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                : 'bg-white/10 text-white/70 border-white/15 hover:bg-white/15'
            }`}
            title={currentSongRating !== null ? `Rated ${currentSongRating} ★` : 'Rate Song'}
          >
            <Star className={`w-3.5 h-3.5 ${currentSongRating !== null ? 'fill-amber-400 text-amber-400' : 'text-white/60'}`} />
            <span>{currentSongRating !== null ? currentSongRating : 'Rate'}</span>
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            className="w-9 h-9 rounded-full flex items-center justify-center text-black font-bold transition-all active:scale-90 shadow-md cursor-pointer"
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
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/75 hover:text-white active:scale-90 transition-all cursor-pointer bg-white/[0.06] hover:bg-white/[0.12] border border-white/10"
            title="Next Track"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>
    </>
  );
};
