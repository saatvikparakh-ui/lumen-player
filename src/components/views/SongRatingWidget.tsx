import React, { useState, useEffect, useRef } from 'react';
import { Star, X, Minus, Plus, Check } from 'lucide-react';
import { Track } from '../../types/music';
import { RatingAndStatsService } from '../../services/ratingAndStatsService';

interface Props {
  track: Track | null;
  dominantColor?: string;
  compact?: boolean;
}

export const SongRatingWidget: React.FC<Props> = ({
  track,
  dominantColor = '#06b6d4',
  compact = false
}) => {
  const [currentRating, setCurrentRating] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(8.0);
  const [isHovered, setIsHovered] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Load and subscribe to ratings
  useEffect(() => {
    if (!track?.id) {
      setCurrentRating(null);
      return;
    }

    const cached = RatingAndStatsService.getCachedRating(track.id);
    if (cached !== null) {
      setCurrentRating(cached);
      setSliderValue(parseFloat(cached) || 8.0);
    } else {
      RatingAndStatsService.getRating(track.id).then(r => {
        setCurrentRating(r);
        if (r) setSliderValue(parseFloat(r) || 8.0);
      });
    }

    const unsub = RatingAndStatsService.onRatingChange((songId, r) => {
      if (songId === track.id) {
        setCurrentRating(r);
        if (r) setSliderValue(parseFloat(r) || 8.0);
      }
    });

    return () => unsub();
  }, [track?.id]);

  // Click outside listener
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  if (!track) return null;

  const handleApplyRating = async (val: number) => {
    const clean = Math.max(0.1, Math.min(10.0, Math.round(val * 10) / 10));
    setSliderValue(clean);
    await RatingAndStatsService.setRating(track, clean);
  };

  const handleClearRating = async () => {
    await RatingAndStatsService.deleteRating(track.id);
    setIsOpen(false);
  };

  const stepChange = (delta: number) => {
    const next = Math.max(0.1, Math.min(10.0, Math.round((sliderValue + delta) * 10) / 10));
    handleApplyRating(next);
  };

  const isRated = currentRating !== null && currentRating !== undefined;

  return (
    <div className="relative inline-flex items-center" ref={popoverRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`group relative flex items-center gap-1.5 transition-all select-none rounded-full ${
          compact
            ? 'px-2 py-0.5 text-xs font-mono'
            : 'px-2.5 py-1 text-xs font-medium'
        } ${
          isRated
            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:border-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
            : 'bg-white/[0.04] text-white/50 border border-white/10 hover:border-white/30 hover:text-white/80'
        }`}
        title={isRated ? `Rated ${currentRating} / 10.0 (Click to change)` : 'Rate this song (0.1 - 10.0)'}
      >
        <Star
          className={`transition-transform duration-200 group-hover:scale-110 ${
            compact ? 'w-3 h-3' : 'w-3.5 h-3.5'
          } ${
            isRated
              ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.6)]'
              : 'text-white/40'
          }`}
        />
        <span>{isRated ? currentRating : 'Rate'}</span>
      </button>

      {/* Liquid Glass Rating Popover */}
      {isOpen && (
        <div
          className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 w-64 p-4 rounded-2xl bg-black/80 border border-white/20 backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.2)] select-none animate-in fade-in zoom-in-95 duration-150"
          style={{
            boxShadow: `0 20px 50px rgba(0,0,0,0.9), 0 0 30px -10px ${dominantColor}40, inset 0 1px 0 rgba(255,255,255,0.2)`
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
            <div className="flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="text-xs font-semibold text-white tracking-wide">Song Rating</span>
            </div>
            {isRated && (
              <button
                onClick={handleClearRating}
                className="text-[10px] text-red-400/80 hover:text-red-300 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10"
                title="Remove rating (return to unrated)"
              >
                Unrate
              </button>
            )}
          </div>

          {/* Rating Big Number Readout */}
          <div className="text-center my-2">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-3xl font-bold font-mono text-amber-300 tracking-tight drop-shadow-[0_0_10px_rgba(245,158,11,0.4)]">
                {sliderValue.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-white/40">/ 10.0</span>
            </div>
            <p className="text-[10px] text-white/40 mt-0.5">
              {sliderValue >= 9.0 ? 'Masterpiece' : sliderValue >= 8.0 ? 'Great' : sliderValue >= 6.5 ? 'Good' : sliderValue >= 4.0 ? 'Average' : 'Skipped'}
            </p>
          </div>

          {/* Slider with Precision Steppers */}
          <div className="flex items-center gap-2 my-3">
            <button
              onClick={() => stepChange(-0.1)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white transition-all active:scale-95"
              title="-0.1"
            >
              <Minus className="w-3 h-3" />
            </button>

            <input
              type="range"
              min="0.1"
              max="10.0"
              step="0.1"
              value={sliderValue}
              onChange={(e) => handleApplyRating(parseFloat(e.target.value))}
              className="w-full accent-amber-400 cursor-pointer h-1.5 bg-white/10 rounded-full"
            />

            <button
              onClick={() => stepChange(0.1)}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white transition-all active:scale-95"
              title="+0.1"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-white/5">
            {[5.0, 7.0, 8.5, 9.5, 10.0].map((preset) => (
              <button
                key={preset}
                onClick={() => handleApplyRating(preset)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                  Math.abs(sliderValue - preset) < 0.05
                    ? 'bg-amber-400 text-black font-bold shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                    : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {preset.toFixed(1)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
