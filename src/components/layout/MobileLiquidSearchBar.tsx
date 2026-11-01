import React, { useState, useRef, useEffect } from 'react';
import { Search, X, Mic, Music2, Disc3, UserCheck, Play, Sparkles, Loader2 } from 'lucide-react';
import { Track } from '../../types/music';
import { ArtistService, ArtistMetadata, AlbumMetadata } from '../../services/artistService';

interface Props {
  dominantColor: string;
  onSearch: (query: string) => void;
  onPlayTrack?: (track: Track, queue?: Track[]) => void;
  onSelectArtist?: (artist: string) => void;
  onOpenVoiceAssistant?: () => void;
}

export const MobileLiquidSearchBar: React.FC<Props> = ({
  dominantColor,
  onSearch,
  onPlayTrack,
  onSelectArtist,
  onOpenVoiceAssistant
}) => {
  const [query, setQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<{
    tracks: Track[];
    artists: ArtistMetadata[];
    albums: AlbumMetadata[];
  }>({ tracks: [], artists: [], albums: [] });
  const [activeTab, setActiveTab] = useState<'all' | 'songs' | 'artists' | 'albums'>('all');

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Live debounced search across artists, tracks & albums
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ tracks: [], artists: [], albums: [] });
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
          artists: (res.artists || []).slice(0, 4),
          tracks: (res.tracks || []).slice(0, 8),
          albums: (res.albums || []).slice(0, 4)
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

  const handleOpenSearch = () => {
    setIsExpanded(true);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 120);
  };

  const handleCloseSearch = () => {
    setIsExpanded(false);
    setQuery('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
      setIsExpanded(false);
    }
  };

  return (
    <>
      {/* 
        1. FLOATING LIQUID GLASS SEARCH PILL (DOWNSIDE MOBILE HUD)
        Docked cleanly above the mobile bottom navigation bar with Apple liquid glass aesthetics
      */}
      {!isExpanded && (
        <div className="fixed bottom-[84px] left-4 right-4 z-30 pointer-events-auto">
          <div
            onClick={handleOpenSearch}
            className="w-full flex items-center justify-between px-4 py-3 rounded-full cursor-pointer transition-all duration-300 active:scale-[0.98]"
            style={{
              backdropFilter: 'blur(28px) saturate(190%)',
              WebkitBackdropFilter: 'blur(28px) saturate(190%)',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              boxShadow: `0 10px 30px -5px rgba(0, 0, 0, 0.6), inset 0 1px 1px 0 rgba(255, 255, 255, 0.3), 0 0 20px -8px ${dominantColor}50`
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div 
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${dominantColor}25` }}
              >
                <Search className="w-3.5 h-3.5" style={{ color: dominantColor }} />
              </div>
              <span className="text-xs sm:text-sm text-white/60 font-medium truncate">
                Search songs, artists, albums...
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onOpenVoiceAssistant && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenVoiceAssistant();
                  }}
                  className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
                  title="Voice Command"
                >
                  <Mic className="w-3.5 h-3.5 text-lumen-cyan" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 
        2. EXPANDED LIQUID GLASS SEARCH EXPERIENCE (FULL SCREEN SHEET)
      */}
      {isExpanded && (
        <div 
          className="fixed inset-0 z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200"
          style={{
            backdropFilter: 'blur(36px) saturate(200%)',
            WebkitBackdropFilter: 'blur(36px) saturate(200%)',
            backgroundColor: 'rgba(10, 10, 15, 0.94)'
          }}
        >
          {/* Top Search Input Bar */}
          <div className="p-4 pt-12 border-b border-white/10">
            <form onSubmit={handleSubmit} className="flex items-center gap-3">
              <div 
                className="flex-1 flex items-center gap-3 px-4 py-3 rounded-full"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  boxShadow: `inset 0 1px 1px rgba(255, 255, 255, 0.2), 0 0 15px -5px ${dominantColor}60`
                }}
              >
                <Search className="w-4 h-4 shrink-0" style={{ color: dominantColor }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search music, artists, albums..."
                  className="w-full bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
                  autoFocus
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="p-1 rounded-full text-white/40 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                {isSearching && (
                  <Loader2 className="w-4 h-4 text-lumen-cyan animate-spin shrink-0" />
                )}
              </div>

              <button
                type="button"
                onClick={handleCloseSearch}
                className="px-3 py-2 text-xs font-semibold text-white/70 hover:text-white uppercase tracking-wider shrink-0"
              >
                Cancel
              </button>
            </form>

            {/* Quick Filter Tabs */}
            {query.trim().length > 0 && (
              <div className="flex items-center gap-2 mt-3 overflow-x-auto no-scrollbar pt-1">
                {(['all', 'songs', 'artists', 'albums'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-all ${
                      activeTab === tab
                        ? 'bg-white text-black font-bold shadow-md'
                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Results Container */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
            {/* If empty query, show quick vibes & suggestions */}
            {!query.trim() && (
              <div className="space-y-6 pt-2">
                <div>
                  <h4 className="text-xs font-mono uppercase tracking-wider text-white/40 mb-3">Trending Searches</h4>
                  <div className="flex flex-wrap gap-2">
                    {['The Weeknd', 'Taylor Swift', 'Dua Lipa', 'Kendrick Lamar', 'Billie Eilish', 'Coldplay'].map(artist => (
                      <button
                        key={artist}
                        onClick={() => {
                          setQuery(artist);
                        }}
                        className="px-3.5 py-1.5 rounded-full text-xs bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 transition-colors"
                      >
                        {artist}
                      </button>
                    ))}
                  </div>
                </div>

                {onOpenVoiceAssistant && (
                  <div 
                    onClick={() => {
                      handleCloseSearch();
                      onOpenVoiceAssistant();
                    }}
                    className="p-4 rounded-2xl flex items-center gap-4 cursor-pointer active:scale-98 transition-all"
                    style={{
                      background: `linear-gradient(135deg, ${dominantColor}20, rgba(255,255,255,0.05))`,
                      border: '1px solid rgba(255, 255, 255, 0.15)'
                    }}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-lumen-cyan/20 text-lumen-cyan">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Ask Lumen AI DJ</h4>
                      <p className="text-xs text-white/50">Say "Hey Lumen" or tap to command playback hands-free</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Artists Matches */}
            {(activeTab === 'all' || activeTab === 'artists') && results.artists.length > 0 && (
              <div>
                <h4 className="text-xs font-mono uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Artists</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {results.artists.map(art => (
                    <div
                      key={art.name}
                      onClick={() => {
                        if (onSelectArtist) {
                          onSelectArtist(art.name);
                          handleCloseSearch();
                        }
                      }}
                      className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-3 cursor-pointer transition-colors"
                    >
                      {art.avatarUrl ? (
                        <img src={art.avatarUrl} alt={art.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                          <UserCheck className="w-5 h-5 text-white/60" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{art.name}</div>
                        <div className="text-[10px] text-white/40 font-mono">Artist</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tracks Matches */}
            {(activeTab === 'all' || activeTab === 'songs') && results.tracks.length > 0 && (
              <div>
                <h4 className="text-xs font-mono uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
                  <Music2 className="w-3.5 h-3.5" />
                  <span>Songs ({results.tracks.length})</span>
                </h4>
                <div className="space-y-1.5">
                  {results.tracks.map(t => (
                    <div
                      key={t.id}
                      onClick={() => {
                        if (onPlayTrack) {
                          onPlayTrack(t, results.tracks);
                          handleCloseSearch();
                        }
                      }}
                      className="p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-between cursor-pointer transition-colors active:scale-99"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {t.artworkUrl ? (
                          <img src={t.artworkUrl} alt={t.title} className="w-11 h-11 rounded-xl object-cover shrink-0 shadow" />
                        ) : (
                          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                            <Music2 className="w-5 h-5 text-white/50" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{t.title}</div>
                          <div className="text-[11px] text-white/50 truncate">{t.artist}</div>
                        </div>
                      </div>

                      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 text-white/80 shrink-0">
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Albums Matches */}
            {(activeTab === 'all' || activeTab === 'albums') && results.albums.length > 0 && (
              <div>
                <h4 className="text-xs font-mono uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
                  <Disc3 className="w-3.5 h-3.5" />
                  <span>Albums</span>
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {results.albums.map(alb => (
                    <div
                      key={alb.id}
                      onClick={() => {
                        if (onSelectArtist) {
                          onSelectArtist(alb.artist);
                          handleCloseSearch();
                        }
                      }}
                      className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-3 cursor-pointer transition-colors"
                    >
                      {alb.artworkUrl ? (
                        <img src={alb.artworkUrl} alt={alb.title} className="w-10 h-10 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                          <Disc3 className="w-5 h-5 text-white/60" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{alb.title}</div>
                        <div className="text-[10px] text-white/40 truncate">{alb.artist}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No matches state */}
            {query.trim().length > 1 && !isSearching && results.tracks.length === 0 && results.artists.length === 0 && (
              <div className="text-center py-12 text-white/50 text-xs">
                No songs or artists found matching "{query}".
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
