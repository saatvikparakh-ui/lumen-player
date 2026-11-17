import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  X, 
  Plus, 
  Check, 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronRight, 
  Disc3, 
  Search, 
  RotateCcw, 
  Loader2,
  Sparkles,
  Music
} from 'lucide-react';
import { Track } from '../../../types/music';
import { PlaylistService } from '../../../services/playlistService';
import { LikedService } from '../../../services/likedService';
import { StreamingService } from '../../../services/streamingService';
import { ClientStreamResolver } from '../../../services/clientStreamResolver';
import { ApiClient } from '../../../services/apiClient';
import { WatchSoundService } from '../../../services/watchSoundService';
import { AudioEngine } from '../../../services/audioEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAddTrack: (track: Track) => void;
  existingQueueTracks?: Track[];
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const AuxCarouselModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onAddTrack,
  existingQueueTracks = []
}) => {
  const [suggestions, setSuggestions] = useState<Track[]>([]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Search mode state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);

  // 30s audio sample preview
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<number | null>(null);

  // Drag-to-scroll tracking
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);

  // Set of existing queued track IDs for quick lookup
  const queuedIds = useMemo(() => {
    return new Set(existingQueueTracks.map(t => t.id));
  }, [existingQueueTracks]);

  // Aggregate user's library suggestions: all playlists + liked tracks + listening history + fallback catalog
  const loadUserLibrarySuggestions = async () => {
    setIsLoading(true);
    try {
      const playlists = PlaylistService.getPlaylists();
      const allPlaylistTracks = playlists.flatMap(p => p.tracks || []);
      const likedTracks = LikedService.getLikedTracks();
      
      let recentTracks: Track[] = [];
      try {
        const raw = localStorage.getItem('lumen_recent_tracks');
        if (raw) recentTracks = JSON.parse(raw);
      } catch (_) {}

      let lastPlayed: Track[] = [];
      try {
        const rawLast = localStorage.getItem('lumen_last_played_track');
        if (rawLast) lastPlayed = [JSON.parse(rawLast)];
      } catch (_) {}

      const combined: Track[] = [...recentTracks, ...lastPlayed, ...likedTracks, ...allPlaylistTracks];
      const seen = new Set<string>();
      const deduped: Track[] = [];

      for (const t of combined) {
        if (!t || !t.title) continue;
        const key = `${t.title.toLowerCase().trim()}:::${(t.artist || '').toLowerCase().trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(t);
        }
      }

      // If library has fewer than 10 tracks, seed with verified popular tracks
      if (deduped.length < 10) {
        try {
          const popular = await StreamingService.searchVerifiedTracks('hits');
          for (const t of popular) {
            const key = `${t.title.toLowerCase().trim()}:::${(t.artist || '').toLowerCase().trim()}`;
            if (!seen.has(key)) {
              seen.add(key);
              deduped.push(t);
            }
          }
        } catch (_) {}
      }

      setSuggestions(deduped);
      setActiveCardIndex(0);
    } catch (err) {
      console.warn('[AuxCarouselModal] Error loading suggestions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopPreview();
      return;
    }
    setSearchQuery('');
    setIsSearchMode(false);
    loadUserLibrarySuggestions();

    return () => {
      stopPreview();
    };
  }, [isOpen]);

  const stopPreview = () => {
    if (previewAudioRef.current) {
      try {
        previewAudioRef.current.pause();
        previewAudioRef.current.ontimeupdate = null;
        previewAudioRef.current.onended = null;
        previewAudioRef.current.src = '';
      } catch (_) {}
      previewAudioRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setPreviewTrackId(null);
    setPreviewLoadingId(null);
    setPreviewProgress(0);
  };

  const togglePreview = async (track: Track) => {
    if (previewTrackId === track.id) {
      stopPreview();
      return;
    }

    stopPreview();
    AudioEngine.pause();
    setPreviewLoadingId(track.id);

    try {
      let previewUrl = (track as any).previewUrl || null;

      if (!previewUrl) {
        try {
          const q = `${track.artist} ${track.title}`.trim();
          const itunesRes = await fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1`,
            { signal: AbortSignal.timeout(4000) }
          );
          if (itunesRes.ok) {
            const itunesData = await itunesRes.json();
            if (itunesData.results?.[0]?.previewUrl) {
              previewUrl = itunesData.results[0].previewUrl;
              (track as any).previewUrl = previewUrl;
            }
          }
        } catch (_) {}
      }

      if (!previewUrl) {
        try {
          const direct = await ClientStreamResolver.resolveDirectStream(track.title, track.artist, track.duration, track.album);
          if (direct && direct.streamUrl) previewUrl = direct.streamUrl;
        } catch (_) {}
      }

      if (!previewUrl) {
        previewUrl = ApiClient.resolveUrl(`/api/stream/resolve?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`);
      }

      if (!previewUrl) {
        stopPreview();
        return;
      }

      const audio = new Audio();
      previewAudioRef.current = audio;
      audio.src = previewUrl;
      audio.volume = 0.85;

      setPreviewTrackId(track.id);
      setPreviewLoadingId(null);

      await audio.play();

      const startTime = Date.now();
      const maxDurationSec = 30;

      audio.ontimeupdate = () => {
        if (audio.currentTime >= maxDurationSec) {
          stopPreview();
        }
      };

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
    } catch (_) {
      stopPreview();
    }
  };

  // Perform search across music catalog
  const handleSearch = async (query: string) => {
    const q = query.trim();
    if (!q) {
      handleResetToLibrary();
      return;
    }

    stopPreview();
    setIsSearching(true);
    setIsLoading(true);
    try {
      const results = await StreamingService.searchVerifiedTracks(q);
      if (results && results.length > 0) {
        setSuggestions(results);
        setActiveCardIndex(0);
        setIsSearchMode(true);
        WatchSoundService.playTick(1.2);
      }
    } catch (err) {
      console.warn('[AuxCarouselModal] Search error:', err);
    } finally {
      setIsSearching(false);
      setIsLoading(false);
    }
  };

  const handleResetToLibrary = () => {
    stopPreview();
    setSearchQuery('');
    setIsSearchMode(false);
    loadUserLibrarySuggestions();
  };

  const handleAddSong = (track: Track) => {
    WatchSoundService.playTick(1.2);
    setAddedIds(prev => new Set(prev).add(track.id));
    onAddTrack(track);

    // Auto-advance to next card after adding
    setTimeout(() => {
      setActiveCardIndex(prev => Math.min(suggestions.length - 1, prev + 1));
    }, 250);
  };

  const handleScrollToCard = (index: number) => {
    if (index < 0 || index >= suggestions.length) return;
    WatchSoundService.playTick(1.0);
    stopPreview();
    setActiveCardIndex(index);
  };

  // Drag / touch gesture handling
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    setDragStartX(clientX);
    setDragOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const diff = clientX - dragStartX;
    setDragOffset(diff);
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragOffset < -50 && activeCardIndex < suggestions.length - 1) {
      handleScrollToCard(activeCardIndex + 1);
    } else if (dragOffset > 50 && activeCardIndex > 0) {
      handleScrollToCard(activeCardIndex - 1);
    }
    setDragOffset(0);
  };

  if (!isOpen) return null;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex items-center justify-center p-3 sm:p-6 select-none animate-fadeIn"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-[92vh] max-h-[720px] rounded-3xl backdrop-blur-3xl border border-white/20 shadow-2xl flex flex-col overflow-hidden relative"
        style={{
          background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12) 0%, rgba(14, 28, 54, 0.40) 45%, rgba(4, 10, 24, 0.65) 100%)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(6, 182, 212, 0.35)'
        }}
      >
        {/* Glow Accent */}
        <div className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full filter blur-3xl opacity-20 bg-cyan-400" />

        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-2xl apple-glass-icon flex items-center justify-center text-cyan-300">
              <Music className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
                Add to Aux
              </h3>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {isSearchMode ? 'Catalog Search' : 'Your Playlists & Likes'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 sm:p-4 border-b border-white/10 relative z-10">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
              placeholder="Search any song, artist, or album..."
              className="w-full pl-9 pr-24 py-2.5 rounded-2xl bg-white/5 border border-white/15 text-white text-xs placeholder-white/35 focus:outline-none focus:border-cyan-400/80 transition-colors"
            />
            <Search className="w-4 h-4 text-white/40 absolute left-3 top-3" />
            <div className="absolute right-2 top-2 flex items-center gap-1">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => handleSearch(searchQuery)}
                  disabled={isSearching}
                  className="px-3 py-1 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1"
                >
                  {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
                </button>
              )}
              {isSearchMode && (
                <button
                  type="button"
                  onClick={handleResetToLibrary}
                  className="px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white/70 text-[10px] flex items-center gap-1 cursor-pointer transition-all"
                  title="Return to library suggestions"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Carousel Cover Flow Stage */}
        <div 
          className="flex-1 flex flex-col items-center justify-center p-3 relative overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseMove={handleTouchMove}
          onMouseUp={handleTouchEnd}
        >
          {/* Top Indicator */}
          <div className="w-full flex items-center justify-between px-4 text-xs font-mono text-white/40 mb-2">
            <span>
              {isSearchMode ? 'Search Result' : 'Suggested Track'}
            </span>
            <span>
              {suggestions.length > 0 ? `${activeCardIndex + 1} of ${suggestions.length}` : '0 of 0'}
            </span>
          </div>

          {/* 3D Stage Reel */}
          <div className="w-full flex-1 flex items-center justify-center relative perspective-[1000px] my-2">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center text-white/50 gap-2">
                <Disc3 className="w-8 h-8 animate-spin text-cyan-400" />
                <span className="text-xs font-mono">Loading tracks...</span>
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
                  const isAdded = addedIds.has(track.id) || queuedIds.has(track.id);

                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      onClick={() => !isCurrent && handleScrollToCard(idx)}
                      className={`absolute w-64 rounded-3xl p-4 bg-gradient-to-br from-white/[0.14] via-white/[0.04] to-black/90 border border-white/20 backdrop-blur-2xl shadow-2xl transition-all duration-300 flex flex-col items-center select-none ${
                        isCurrent ? 'cursor-default ring-2 ring-cyan-400/50' : 'cursor-pointer hover:border-white/40'
                      }`}
                      style={{
                        transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                        opacity,
                        zIndex: 30 - Math.abs(offset),
                        boxShadow: isCurrent 
                          ? '0 20px 50px rgba(0, 0, 0, 0.9), 0 0 30px -5px rgba(6, 182, 212, 0.5)' 
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

                        {/* 30s Sample Audio Preview */}
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
                              {previewLoadingId === track.id ? (
                                <Loader2 className="w-5 h-5 animate-spin text-black" />
                              ) : isPreviewing ? (
                                <Pause className="w-5 h-5 fill-current" />
                              ) : (
                                <Play className="w-5 h-5 fill-current ml-0.5" />
                              )}
                            </div>
                            <span className="text-[10px] font-mono tracking-wider uppercase font-semibold text-white/90">
                              {previewLoadingId === track.id ? 'Loading...' : isPreviewing ? 'Stop' : 'Sample (30s)'}
                            </span>
                          </button>
                        )}

                        {/* 30s Audio Progress Bar */}
                        {isPreviewing && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50 overflow-hidden">
                            <div 
                              className="h-full bg-cyan-400 transition-all duration-150"
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

                      {/* Duration */}
                      <div className="flex items-center gap-2 text-[10px] font-mono text-white/40 mt-1">
                        <span className="truncate max-w-[120px]">{track.album || 'Single'}</span>
                        <span>•</span>
                        <span>{formatDuration(track.duration)}</span>
                      </div>

                      {/* Add to Aux Button */}
                      {isCurrent && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddSong(track);
                          }}
                          className={`w-full mt-3.5 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all duration-200 shadow-lg cursor-pointer ${
                            isAdded
                              ? 'bg-emerald-500/25 border border-emerald-400/50 text-emerald-200 backdrop-blur-xl shadow-[0_0_20px_rgba(16,185,129,0.35)]'
                              : 'bg-white hover:bg-white/90 text-black hover:scale-102 active:scale-95'
                          }`}
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-300 stroke-[2.5]" />
                              <span>Added</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4" />
                              <span>Add to Aux</span>
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
                <Music className="w-8 h-8 mb-2 opacity-30 text-cyan-400" />
                <span>No tracks found</span>
              </div>
            )}
          </div>

          {/* Stepper controls */}
          <div className="w-full flex items-center justify-between pt-2.5 border-t border-white/10 gap-2">
            <button
              type="button"
              onClick={() => handleScrollToCard(activeCardIndex - 1)}
              disabled={activeCardIndex <= 0}
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-all flex items-center gap-1 text-xs font-mono cursor-pointer flex-shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Prev</span>
            </button>

            <span className="text-[11px] font-mono text-white/40">
              Swipe or use arrows
            </span>

            <button
              type="button"
              onClick={() => handleScrollToCard(activeCardIndex + 1)}
              disabled={activeCardIndex >= suggestions.length - 1}
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-all flex items-center gap-1 text-xs font-mono cursor-pointer flex-shrink-0"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
