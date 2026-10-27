import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Plus, 
  Check, 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Disc3, 
  Volume2, 
  Music,
  Clock
} from 'lucide-react';
import { CustomPlaylist, Track } from '../../types/music';
import { WatchSoundService } from '../../services/watchSoundService';
import { AudioEngine } from '../../services/audioEngine';
import { PlaylistRecommendationService } from '../../services/playlistRecommendationService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  playlist: CustomPlaylist;
  dominantColor: string;
  onAddTrack: (playlistId: string, track: Track) => boolean;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const PlaylistCarouselModal: React.FC<Props> = ({
  isOpen,
  onClose,
  playlist,
  dominantColor,
  onAddTrack
}) => {
  const [suggestions, setSuggestions] = useState<Track[]>([]);
  const [pool, setPool] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [addedConfirmIds, setAddedConfirmIds] = useState<Set<string>>(new Set());

  // 30-second Spotify-style preview audio player
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<number | null>(null);

  // Drag-to-scroll tracking
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);

  // Load playlist-specific recommendations when modal opens or playlist changes
  useEffect(() => {
    if (!isOpen) {
      stopPreview();
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    PlaylistRecommendationService.getRecommendationsForPlaylist(playlist, 16)
      .then(res => {
        if (!isMounted) return;
        setSuggestions(res.suggestions);
        setPool(res.pool);
        setActiveCardIndex(0);
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
      stopPreview();
    };
  }, [isOpen, playlist.id]);

  // Cleanup audio preview on unmount
  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, []);

  const stopPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setPreviewTrackId(null);
    setPreviewProgress(0);
  };

  const togglePreview = (track: Track) => {
    if (previewTrackId === track.id) {
      stopPreview();
      return;
    }

    // Stop current preview
    stopPreview();

    // Automatically pause main player if running
    AudioEngine.pause();

    const audio = new Audio();
    previewAudioRef.current = audio;

    // Use previewUrl if available, otherwise resolve stream
    const src = (track as any).previewUrl || 
      `/api/stream/resolve?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`;
    audio.src = src;
    audio.volume = 0.85;

    setPreviewTrackId(track.id);

    audio.play().catch(() => {
      stopPreview();
    });

    const startTime = Date.now();
    const maxDurationSec = 30;

    progressIntervalRef.current = window.setInterval(() => {
      if (!audio || audio.paused || audio.ended) {
        stopPreview();
        return;
      }
      const elapsed = (Date.now() - startTime) / 1000;
      setPreviewProgress(Math.min(100, (elapsed / maxDurationSec) * 100));

      if (elapsed >= maxDurationSec) {
        stopPreview();
      }
    }, 150);

    audio.onended = () => {
      stopPreview();
    };
  };

  const handleScrollToCard = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= suggestions.length) return;
    if (newIndex !== activeCardIndex) {
      WatchSoundService.playTick(1.0);
      setActiveCardIndex(newIndex);
      // Stop preview when changing cards
      stopPreview();
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > 12 || Math.abs(e.deltaY) > 12) {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta > 0 && activeCardIndex < suggestions.length - 1) {
        handleScrollToCard(activeCardIndex + 1);
      } else if (delta < 0 && activeCardIndex > 0) {
        handleScrollToCard(activeCardIndex - 1);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStartX(e.clientX);
    setDragOffset(0);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const currentOffset = e.clientX - dragStartX;
    setDragOffset(currentOffset);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragOffset < -45 && activeCardIndex < suggestions.length - 1) {
      handleScrollToCard(activeCardIndex + 1);
    } else if (dragOffset > 45 && activeCardIndex > 0) {
      handleScrollToCard(activeCardIndex - 1);
    }
    setDragOffset(0);
  };

  const handleAddTrack = (track: Track) => {
    const success = onAddTrack(playlist.id, track);
    if (success) {
      WatchSoundService.playTick(1.2);
      setAddedConfirmIds(prev => new Set(prev).add(track.id));

      // Remove from suggestions and replenish with a fresh track from pool
      setTimeout(() => {
        setSuggestions(prev => {
          const remaining = prev.filter(t => t.id !== track.id);
          const { nextTrack, updatedPool } = PlaylistRecommendationService.getNextReplacement(
            playlist,
            remaining,
            pool
          );
          setPool(updatedPool);
          return nextTrack ? [...remaining, nextTrack] : remaining;
        });

        if (activeCardIndex >= suggestions.length - 1 && activeCardIndex > 0) {
          setActiveCardIndex(prev => prev - 1);
        }
      }, 300);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6 select-none animate-fadeIn"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-[92vh] max-h-[720px] rounded-3xl bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-black/90 border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-3xl shadow-2xl flex flex-col overflow-hidden relative"
        style={{
          boxShadow: `0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px ${dominantColor}50`
        }}
      >
        {/* Ambient Top Glow */}
        <div 
          className="pointer-events-none absolute w-96 h-96 -top-24 -right-24 rounded-full blur-[110px] opacity-25"
          style={{ backgroundColor: dominantColor }}
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 relative z-10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-lumen-cyan/15 text-lumen-cyan border border-lumen-cyan/25">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>Add Songs to "{playlist.name}"</span>
              </h3>
              <p className="text-[11px] font-mono text-white/50">
                Curated specifically for this playlist • Tactile watch wheel scroll
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 3D Cover Flow Carousel Reel */}
        <div 
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="flex-1 flex flex-col items-center justify-between p-4 sm:p-6 relative z-10 overflow-hidden cursor-grab active:cursor-grabbing"
        >
          {/* Reel Indicator Bar */}
          <div className="flex items-center justify-between w-full text-xs font-mono text-white/50 px-3">
            <span className="flex items-center gap-1.5 text-lumen-cyan">
              <Music className="w-3.5 h-3.5" />
              <span>Playlist Match Reel</span>
            </span>
            <span>
              {suggestions.length > 0 ? `${activeCardIndex + 1} of ${suggestions.length}` : '0 of 0'}
            </span>
          </div>

          {/* 3D Stage Reel */}
          <div className="w-full flex-1 flex items-center justify-center relative perspective-[1000px] my-2">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center text-white/50 gap-2">
                <Disc3 className="w-8 h-8 animate-spin text-lumen-cyan" />
                <span className="text-xs font-mono">Analyzing playlist artists & vibes...</span>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="relative w-64 h-84 flex items-center justify-center">
                {suggestions.map((track, idx) => {
                  const offset = idx - activeCardIndex;
                  if (Math.abs(offset) > 2) return null;

                  const isCurrent = offset === 0;
                  const rotateY = offset * -25;
                  const translateX = offset * 95 + (isCurrent ? dragOffset * 0.4 : 0);
                  const translateZ = -Math.abs(offset) * 110;
                  const scale = isCurrent ? 1 : 0.82;
                  const opacity = isCurrent ? 1 : Math.max(0.2, 0.65 - Math.abs(offset) * 0.25);
                  const isPreviewing = previewTrackId === track.id;
                  const isAdded = addedConfirmIds.has(track.id);

                  return (
                    <div
                      key={track.id}
                      onClick={() => !isCurrent && handleScrollToCard(idx)}
                      className={`absolute w-64 rounded-3xl p-4.5 bg-gradient-to-br from-white/[0.14] via-white/[0.04] to-black/90 border border-white/20 backdrop-blur-2xl shadow-2xl transition-all duration-300 flex flex-col items-center select-none ${
                        isCurrent ? 'cursor-default ring-2 ring-lumen-cyan/50' : 'cursor-pointer hover:border-white/40'
                      }`}
                      style={{
                        transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                        opacity,
                        zIndex: 30 - Math.abs(offset),
                        boxShadow: isCurrent 
                          ? `0 20px 50px rgba(0, 0, 0, 0.9), 0 0 30px -5px ${dominantColor}60` 
                          : '0 10px 30px rgba(0, 0, 0, 0.6)'
                      }}
                    >
                      {/* Album Artwork */}
                      <div className="relative w-48 h-48 rounded-2xl overflow-hidden bg-black/80 shadow-2xl border border-white/20 mb-3.5 group">
                        {track.artworkUrl ? (
                          <img 
                            src={track.artworkUrl} 
                            alt={track.title} 
                            className="w-full h-full object-cover" 
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/30">
                            <Disc3 className="w-12 h-12" />
                          </div>
                        )}

                        {/* Preview Audio Play/Pause Button on Card */}
                        {isCurrent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePreview(track);
                            }}
                            className="absolute inset-0 bg-black/40 hover:bg-black/60 flex flex-col items-center justify-center gap-1.5 transition-all text-white"
                            title={isPreviewing ? 'Stop Sample' : 'Listen 30s Sample'}
                          >
                            <div className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-transform">
                              {isPreviewing ? (
                                <Pause className="w-5 h-5 fill-current" />
                              ) : (
                                <Play className="w-5 h-5 fill-current ml-0.5" />
                              )}
                            </div>
                            <span className="text-[10px] font-mono tracking-wider uppercase font-semibold text-white/90">
                              {isPreviewing ? 'Stop Sample' : 'Sample Song'}
                            </span>
                          </button>
                        )}

                        {/* 30s Audio Progress Bar */}
                        {isPreviewing && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50 overflow-hidden">
                            <div 
                              className="h-full bg-lumen-cyan transition-all duration-150"
                              style={{ width: `${previewProgress}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Song Title & Artist */}
                      <h4 className="text-sm font-bold text-white text-center truncate w-full px-1" title={track.title}>
                        {track.title}
                      </h4>
                      <p className="text-xs text-white/60 text-center truncate w-full px-1 mt-0.5">
                        {track.artist}
                      </p>

                      {/* Duration & Album info */}
                      <div className="flex items-center gap-2 text-[10px] font-mono text-white/40 mt-1">
                        <span className="truncate max-w-[120px]">{track.album || 'Single'}</span>
                        <span>•</span>
                        <span>{formatDuration(track.duration)}</span>
                      </div>

                      {/* Add to Playlist Action Button */}
                      {isCurrent && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddTrack(track);
                          }}
                          className={`w-full mt-3.5 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all duration-200 shadow-lg ${
                            isAdded
                              ? 'bg-emerald-500 text-black'
                              : 'bg-white hover:bg-white/90 text-black hover:scale-102 active:scale-95'
                          }`}
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-4 h-4" />
                              <span>Added to Playlist</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4" />
                              <span>Add to Playlist</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-white/40 text-xs">
                <Music className="w-8 h-8 mb-2 opacity-30 text-lumen-cyan" />
                <span>No more suggestions available for this playlist.</span>
              </div>
            )}
          </div>

          {/* Stepper controls & Tactile Hint */}
          <div className="w-full flex items-center justify-between pt-2 border-t border-white/10">
            <button
              onClick={() => handleScrollToCard(activeCardIndex - 1)}
              disabled={activeCardIndex <= 0}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-all flex items-center gap-1 text-xs font-mono cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Prev</span>
            </button>

            <span className="text-[10px] font-mono text-white/40 text-center">
              Scroll wheel or drag for watch crown tick sound
            </span>

            <button
              onClick={() => handleScrollToCard(activeCardIndex + 1)}
              disabled={activeCardIndex >= suggestions.length - 1}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-all flex items-center gap-1 text-xs font-mono cursor-pointer"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full mt-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all text-center cursor-pointer"
          >
            Done Adding Songs
          </button>
        </div>
      </div>
    </div>
  );
};
