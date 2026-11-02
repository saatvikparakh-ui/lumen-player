import React, { useState, useRef, useEffect } from 'react';
import { Search, X, Music2, User, Play, Sparkles, Loader2, ArrowLeft } from 'lucide-react';
import { Track } from '../../types/music';
import { ArtistService, ArtistMetadata } from '../../services/artistService';

interface Props {
  dominantColor: string;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onSelectArtist: (artist: string) => void;
  onClose: () => void;
  suggestedTracks?: Track[];
}

export const MobileSearchView: React.FC<Props> = ({
  dominantColor,
  onPlayTrack,
  onSelectArtist,
  onClose,
  suggestedTracks = []
}) => {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'songs' | 'artists'>('songs');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<{
    tracks: Track[];
    artists: ArtistMetadata[];
  }>({ tracks: [], artists: [] });

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-focus the search input when the view opens
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 150);
    return () => clearTimeout(t);
  }, []);

  // Live debounced search across songs and artists
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ tracks: [], artists: [] });
      setIsSearching(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await ArtistService.searchAll(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        setResults({
          tracks: res.tracks || [],
          artists: res.artists || []
        });
      } catch (_) {
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const currentSongs = hasQuery ? results.tracks : suggestedTracks;

  return (
    <div className="fixed inset-0 z-40 bg-[#07090E] flex flex-col select-none pt-[max(0.75rem,env(safe-area-inset-top))] pb-20 px-4 overflow-hidden">
      {/* 1. TOP LIQUID-GLASS SEARCH BAR */}
      <div className="pt-2 pb-2">
        <div 
          className="relative rounded-2xl bg-white/[0.06] backdrop-blur-2xl border border-white/15 px-3.5 py-2.5 flex items-center gap-3 transition-all shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          style={{
            boxShadow: `0 0 24px ${dominantColor}25, inset 0 1px 1px rgba(255,255,255,0.2)`
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 hover:text-white active:scale-90 transition-transform -ml-1"
            title="Back to Home"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <Search className="w-4 h-4 text-white/50 shrink-0" />

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs or artists..."
            className="flex-1 bg-transparent text-white placeholder-white/40 text-sm font-medium outline-none"
          />

          {isSearching && (
            <Loader2 className="w-4 h-4 text-white/60 animate-spin shrink-0" />
          )}

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults({ tracks: [], artists: [] });
                inputRef.current?.focus();
              }}
              className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 active:scale-90 transition-all shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. ROUNDED SUB-BAR PILL TOGGLE (SONGS vs ARTISTS) */}
      <div className="flex items-center justify-center py-2">
        <div className="inline-flex p-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setActiveTab('songs')}
            className={`px-6 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'songs'
                ? 'text-white shadow-lg scale-102'
                : 'text-white/50 hover:text-white/80'
            }`}
            style={{
              backgroundColor: activeTab === 'songs' ? dominantColor : 'transparent',
              boxShadow: activeTab === 'songs' ? `0 0 16px ${dominantColor}60` : 'none'
            }}
          >
            <Music2 className="w-3.5 h-3.5" />
            <span>Songs ({hasQuery ? results.tracks.length : currentSongs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('artists')}
            className={`px-6 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'artists'
                ? 'text-white shadow-lg scale-102'
                : 'text-white/50 hover:text-white/80'
            }`}
            style={{
              backgroundColor: activeTab === 'artists' ? dominantColor : 'transparent',
              boxShadow: activeTab === 'artists' ? `0 0 16px ${dominantColor}60` : 'none'
            }}
          >
            <User className="w-3.5 h-3.5" />
            <span>Artists ({hasQuery ? results.artists.length : 0})</span>
          </button>
        </div>
      </div>

      {/* 3. SCROLLABLE RESULTS LIST */}
      <div className="flex-1 overflow-y-auto px-1 pt-2 pb-6 space-y-2">
        {/* A. SONGS TAB */}
        {activeTab === 'songs' && (
          <div className="space-y-1.5">
            {!hasQuery && (
              <div className="text-[11px] font-mono uppercase tracking-wider text-white/40 px-2 py-1 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>Trending Hits & Suggestions</span>
              </div>
            )}

            {currentSongs.map((track) => (
              <div
                key={track.id}
                onClick={() => {
                  onPlayTrack(track, currentSongs);
                }}
                className="p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-between cursor-pointer transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {track.artworkUrl ? (
                    <img 
                      src={track.artworkUrl} 
                      alt={track.title} 
                      className="w-12 h-12 rounded-xl object-cover shrink-0 shadow-md border border-white/10" 
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/10">
                      <Music2 className="w-5 h-5 text-white/50" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{track.title}</div>
                    <div className="text-[11px] text-white/50 truncate mt-0.5">{track.artist}</div>
                  </div>
                </div>

                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white transition-transform active:scale-90"
                  style={{ backgroundColor: `${dominantColor}30`, border: `1px solid ${dominantColor}60` }}
                >
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                </div>
              </div>
            ))}

            {hasQuery && results.tracks.length === 0 && !isSearching && (
              <div className="text-center py-16 text-white/40 text-xs">
                No songs found matching "{query}"
              </div>
            )}
          </div>
        )}

        {/* B. ARTISTS TAB */}
        {activeTab === 'artists' && (
          <div className="space-y-1.5">
            {results.artists.map((artist) => (
              <div
                key={artist.name}
                onClick={() => {
                  onSelectArtist(artist.name);
                }}
                className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-between cursor-pointer transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  {artist.avatarUrl ? (
                    <img 
                      src={artist.avatarUrl} 
                      alt={artist.name} 
                      className="w-13 h-13 rounded-full object-cover shrink-0 border border-white/20 shadow-md" 
                    />
                  ) : (
                    <div 
                      className="w-13 h-13 rounded-full flex items-center justify-center shrink-0 border border-white/20"
                      style={{ backgroundColor: `${dominantColor}25` }}
                    >
                      <User className="w-6 h-6 text-white/80" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">{artist.name}</div>
                    <div className="text-[11px] text-white/50 truncate mt-0.5">
                      {artist.genre || 'Artist'} {artist.trackCount ? `• ${artist.trackCount} tracks` : ''}
                    </div>
                  </div>
                </div>

                <div className="text-xs font-semibold px-3 py-1 rounded-full bg-white/10 text-white/80 border border-white/10">
                  View
                </div>
              </div>
            ))}

            {hasQuery && results.artists.length === 0 && !isSearching && (
              <div className="text-center py-16 text-white/40 text-xs">
                No artists found matching "{query}"
              </div>
            )}

            {!hasQuery && (
              <div className="text-center py-16 text-white/40 text-xs">
                Type an artist name in the top bar to explore their discography
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
