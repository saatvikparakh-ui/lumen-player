import React, { useState, useRef, useEffect } from 'react';
import { 
  Home, 
  FolderHeart, 
  Sparkles, 
  Sliders, 
  Search, 
  X,
  Disc3,
  Play,
  UserCheck,
  ChevronRight,
  Mic,
  MicOff,
  Menu,
  ChevronDown,
  ChevronUp,
  Disc,
  Music2
} from 'lucide-react';
import { Track } from '../../types/music';
import { ArtistService, ArtistMetadata, AlbumMetadata } from '../../services/artistService';

interface Props {
  currentView: 'home' | 'player' | 'playlist';
  onSelectView: (view: 'home' | 'player' | 'playlist') => void;
  onOpenTasteModal: () => void;
  onOpenAudioLab: () => void;
  onSearch: (query: string) => void;
  currentTrack: Track | null;
  dominantColor: string;
  isSearching?: boolean;
  onSelectArtist?: (artist: string) => void;
  onPlayTrack?: (track: Track, queue?: Track[]) => void;
}

interface QuickArtist {
  name: string;
  avatarUrl?: string;
  genre?: string;
}

export const TopDynamicIsland: React.FC<Props> = ({
  currentView,
  onSelectView,
  onOpenTasteModal,
  onOpenAudioLab,
  onSearch,
  currentTrack,
  dominantColor,
  isSearching = false,
  onSelectArtist,
  onPlayTrack
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isHoverRevealed, setIsHoverRevealed] = useState(false);
  const [liveResults, setLiveResults] = useState<{
    artists: ArtistMetadata[];
    tracks: Track[];
    albums: AlbumMetadata[];
  }>({ artists: [], tracks: [], albums: [] });
  const [searchCategoryTab, setSearchCategoryTab] = useState<'all' | 'songs' | 'artists' | 'albums'>('all');
  const [isLiveSearching, setIsLiveSearching] = useState(false);
  const [showLiveDropdown, setShowLiveDropdown] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startVoiceSearch = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setIsSearchOpen(true);
      };

      recognition.onresult = (event: any) => {
        const spoken = event.results?.[0]?.[0]?.transcript;
        if (spoken) {
          setSearchQuery(spoken);
          executeSearch(spoken);
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (_) {
      setIsListening(false);
    }
  };

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const islandContainerRef = useRef<HTMLDivElement | null>(null);

  const isPlayerView = currentView === 'player';

  // In non-player views, island is always visible; in player view, starts collapsed
  useEffect(() => {
    if (!isPlayerView) {
      setIsHoverRevealed(true);
    } else {
      setIsHoverRevealed(false);
    }
  }, [isPlayerView]);

  // Click outside to close live dropdown or collapse island in player view
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLiveDropdown(false);
      }
      if (isPlayerView && isHoverRevealed && islandContainerRef.current && !islandContainerRef.current.contains(e.target as Node)) {
        if (!searchQuery.trim() && !isSearchOpen) {
          setIsHoverRevealed(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPlayerView, isHoverRevealed, searchQuery, isSearchOpen]);

  // Live search debounce with AbortController cancellation & multi-category resolution
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setLiveResults({ artists: [], tracks: [], albums: [] });
      setIsLiveSearching(false);
      setShowLiveDropdown(false);
      return;
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    setIsLiveSearching(true);
    setShowLiveDropdown(true);

    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const results = await ArtistService.searchAll(q, controller.signal);
        setLiveResults({
          artists: results.artists.slice(0, 4),
          tracks: results.tracks.slice(0, 6),
          albums: results.albums.slice(0, 4)
        });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Live search preview error:', err);
        }
      } finally {
        setIsLiveSearching(false);
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [searchQuery]);

  const executeSearch = (targetQuery?: string) => {
    const q = (targetQuery !== undefined ? targetQuery : searchQuery).trim();
    if (!q) return;
    setShowLiveDropdown(false);
    onSearch(q);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch();
  };

  return (
    <div 
      className={`fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none transition-all duration-500 ${
        isPlayerView ? 'h-24 pt-4' : 'h-auto pt-5'
      }`}
    >
      {/* Click-to-reveal button when hidden in player view (No 2-second hover delay; instant tap for phones & desktop) */}
      {isPlayerView && !isHoverRevealed && (
        <button 
          type="button"
          onClick={() => setIsHoverRevealed(true)}
          className="absolute top-2.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/80 hover:bg-black/95 border border-white/25 hover:border-white/50 backdrop-blur-2xl text-[11px] text-white/90 hover:text-white font-mono tracking-wider transition-all duration-300 pointer-events-auto cursor-pointer shadow-xl flex items-center gap-1.5 active:scale-95"
          style={{
            boxShadow: `0 8px 24px -4px rgba(0,0,0,0.8), 0 0 16px -2px ${dominantColor}50`
          }}
          title="Click to show navigation and search"
        >
          <Menu className="w-3.5 h-3.5 text-lumen-cyan" />
          <span>Show Menu</span>
          <ChevronDown className="w-3 h-3 text-white/50" />
        </button>
      )}

      {/* The 3D Apple VisionOS Glass Island Capsule & Attached Live Search Dropdown */}
      <div ref={islandContainerRef} className="relative flex flex-col items-center">
        <div 
          className={`flex items-center gap-3 px-4 py-2 rounded-full bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-white/[0.01] border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-3xl shadow-2xl transition-all duration-500 ${
            isPlayerView && !isHoverRevealed
              ? 'opacity-0 -translate-y-12 pointer-events-none scale-95'
              : 'opacity-100 translate-y-0 pointer-events-auto scale-100'
          }`}
          style={{
            boxShadow: `0 25px 60px -10px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.4), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4), 0 0 25px -5px ${dominantColor}50`
          }}
        >
          {/* Brand Logo & Logotype with Liquid Glass Styling */}
          <div className="flex items-center gap-2 pl-1 pr-2.5 py-0.5 border-r border-white/10 select-none">
            <div className="relative w-6 h-6 rounded-lg overflow-hidden border border-white/30 shadow-md flex-shrink-0 bg-black/60">
              <img 
                src="/logo.png" 
                alt="Lumen" 
                className="w-full h-full object-cover" 
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/20 to-transparent pointer-events-none" />
            </div>
            <span className="text-xs font-bold tracking-widest uppercase bg-gradient-to-r from-white via-white/90 to-cyan-300 bg-clip-text text-transparent font-outfit hidden sm:inline">
              Lumen
            </span>
          </div>

          {/* Navigation Tabs: Home vs Player vs Playlists */}
          <div className="flex items-center bg-white/5 border border-white/10 rounded-full p-0.5 gap-1">
            <button
              onClick={() => onSelectView('home')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                currentView === 'home'
                  ? 'bg-white text-black font-bold shadow-md'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </button>

            <button
              onClick={() => onSelectView('player')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                currentView === 'player'
                  ? 'bg-white text-black font-bold shadow-md'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <Disc3 className="w-3.5 h-3.5" />
              <span>Player</span>
            </button>

            <button
              onClick={() => onSelectView('playlist')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                currentView === 'playlist'
                  ? 'bg-white text-black font-bold shadow-md'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <FolderHeart className="w-3.5 h-3.5" />
              <span>Playlists</span>
            </button>
          </div>

          {/* Vertical Divider */}
          <div className="w-[1px] h-4 bg-white/15" />

          {/* Integrated Quick Search */}
          {isSearchOpen ? (
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  if (searchQuery.trim().length >= 2) setShowLiveDropdown(true);
                }}
                placeholder="Search songs or artists..."
                className="w-44 sm:w-60 px-3 py-1 bg-white/10 border border-white/20 rounded-full text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan/50"
                autoFocus
              />

              {/* Voice Search Button */}
              <button
                type="button"
                onClick={startVoiceSearch}
                className={`p-1.5 rounded-full transition-all flex items-center justify-center cursor-pointer ${
                  isListening ? 'bg-rose-500 text-white animate-pulse shadow-lg' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
                title={isListening ? 'Listening...' : 'Voice Search (Speak song/artist)'}
              >
                {isListening ? <MicOff className="w-3.5 h-3.5 text-white" /> : <Mic className="w-3.5 h-3.5 text-lumen-cyan" />}
              </button>

              {/* Clickable Search Action Button */}
              <button
                type="submit"
                onClick={(e) => {
                  e.preventDefault();
                  executeSearch();
                }}
                disabled={isSearching}
                className="p-1.5 rounded-full bg-lumen-cyan/20 hover:bg-lumen-cyan text-lumen-cyan hover:text-black transition-all flex items-center justify-center shadow-md active:scale-90 disabled:opacity-50 cursor-pointer"
                title="Search (Enter)"
              >
                {isSearching ? (
                  <Disc3 className="w-3.5 h-3.5 animate-spin text-lumen-cyan" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Clear / Close Button */}
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchOpen(false);
                  setShowLiveDropdown(false);
                }}
                className="p-1.5 rounded-full text-white/50 hover:text-white transition-colors cursor-pointer"
                title="Close Search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setIsSearchOpen(true);
                }}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 text-xs text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Search songs...</span>
              </button>
              <button
                type="button"
                onClick={startVoiceSearch}
                className={`p-1.5 rounded-full transition-all flex items-center justify-center cursor-pointer ${
                  isListening ? 'bg-rose-500 text-white animate-pulse shadow-lg' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
                title="Voice Search"
              >
                <Mic className="w-3.5 h-3.5 text-lumen-cyan" />
              </button>
            </div>
          )}

          {/* In player view: quick collapse button */}
          {isPlayerView && (
            <button
              type="button"
              onClick={() => setIsHoverRevealed(false)}
              className="p-1 rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-pointer"
              title="Hide Menu"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Live Instant Categorized Search Dropdown (Apple VisionOS Glass) */}
        {isSearchOpen && showLiveDropdown && searchQuery.trim().length >= 2 && (
          <div 
            ref={dropdownRef}
            className="absolute top-full mt-3 w-80 sm:w-[420px] max-w-[92vw] rounded-2xl bg-black/92 backdrop-blur-3xl border border-white/20 p-3 shadow-2xl z-50 pointer-events-auto space-y-2.5 animate-fadeIn max-h-[75vh] overflow-y-auto"
            style={{
              boxShadow: `0 20px 50px rgba(0, 0, 0, 0.9), 0 0 30px -5px ${dominantColor}40`
            }}
          >
            {/* Category Filter Tabs: All, Songs, Artists, Albums */}
            <div className="flex items-center gap-1 p-0.5 bg-white/5 border border-white/10 rounded-xl">
              {(['all', 'songs', 'artists', 'albums'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSearchCategoryTab(tab)}
                  className={`flex-1 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider transition-all capitalize ${
                    searchCategoryTab === tab
                      ? 'bg-white text-black font-bold shadow'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {isLiveSearching ? (
              <div className="flex items-center justify-center py-6 text-white/50 gap-2">
                <Disc3 className="w-4 h-4 animate-spin text-lumen-cyan" />
                <span className="text-[11px] font-mono">Searching verified catalog...</span>
              </div>
            ) : (
              <>
                {/* 1. ARTISTS SECTION */}
                {(searchCategoryTab === 'all' || searchCategoryTab === 'artists') && liveResults.artists.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-lumen-cyan px-1 flex items-center gap-1">
                      <UserCheck className="w-3 h-3" /> Artists
                    </span>
                    {liveResults.artists.map(art => (
                      <div 
                        key={art.id}
                        onClick={() => {
                          if (onSelectArtist) {
                            onSelectArtist(art.name);
                            setShowLiveDropdown(false);
                            setIsSearchOpen(false);
                          }
                        }}
                        className="flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-all group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {art.avatarUrl ? (
                            <img 
                              src={art.avatarUrl} 
                              alt={art.name} 
                              className="w-8 h-8 rounded-full object-cover border border-white/20 flex-shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-lumen-cyan/20 border border-lumen-cyan/40 flex items-center justify-center text-lumen-cyan flex-shrink-0">
                              <UserCheck className="w-3.5 h-3.5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white truncate group-hover:text-lumen-cyan transition-colors">
                                {art.name}
                              </span>
                              <span className="text-[8px] font-mono px-1.5 py-0.2 rounded-full bg-lumen-cyan/20 text-lumen-cyan uppercase font-bold">
                                Artist
                              </span>
                            </div>
                            <p className="text-[10px] text-white/50 truncate">
                              {art.genre || 'Verified Official Artist'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center text-[10px] text-white/60 group-hover:text-white font-mono gap-1">
                          <span>Discography</span>
                          <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. SONGS SECTION */}
                {(searchCategoryTab === 'all' || searchCategoryTab === 'songs') && liveResults.tracks.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-lumen-cyan px-1 flex items-center gap-1">
                      <Music2 className="w-3 h-3" /> Songs
                    </span>
                    {liveResults.tracks.map((track) => (
                      <div
                        key={track.id}
                        onClick={() => {
                          if (onPlayTrack) {
                            onPlayTrack(track, liveResults.tracks);
                            setShowLiveDropdown(false);
                          }
                        }}
                        className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {track.artworkUrl && (
                            <img 
                              src={track.artworkUrl} 
                              alt={track.title} 
                              className="w-7 h-7 rounded-md object-cover border border-white/10 flex-shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white truncate group-hover:text-lumen-cyan transition-colors">
                              {track.title}
                            </p>
                            <p className="text-[10px] text-white/50 truncate">
                              {track.artist}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onPlayTrack) {
                              onPlayTrack(track, liveResults.tracks);
                              setShowLiveDropdown(false);
                            }
                          }}
                          className="w-6 h-6 rounded-full bg-white/10 hover:bg-lumen-cyan hover:text-black text-white/80 flex items-center justify-center transition-all flex-shrink-0 ml-2"
                          title="Play"
                        >
                          <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 3. ALBUMS SECTION */}
                {(searchCategoryTab === 'all' || searchCategoryTab === 'albums') && liveResults.albums.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-lumen-cyan px-1 flex items-center gap-1">
                      <Disc className="w-3 h-3" /> Albums
                    </span>
                    {liveResults.albums.map((album) => (
                      <div
                        key={album.id}
                        onClick={() => {
                          if (onSelectArtist) {
                            onSelectArtist(album.artist);
                            setShowLiveDropdown(false);
                            setIsSearchOpen(false);
                          }
                        }}
                        className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {album.artworkUrl && (
                            <img 
                              src={album.artworkUrl} 
                              alt={album.title} 
                              className="w-7 h-7 rounded-md object-cover border border-white/10 flex-shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white truncate group-hover:text-lumen-cyan transition-colors">
                              {album.title}
                            </p>
                            <p className="text-[10px] text-white/50 truncate">
                              {album.artist} {album.year ? `• ${album.year}` : ''}
                            </p>
                          </div>
                        </div>
                        <span className="text-[9px] font-mono text-white/40 flex-shrink-0">
                          {album.trackCount ? `${album.trackCount} tracks` : 'Album'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* EMPTY STATE */}
                {liveResults.artists.length === 0 && liveResults.tracks.length === 0 && liveResults.albums.length === 0 && (
                  <div className="py-4 text-center text-xs text-white/40 font-outfit">
                    No verified results for "{searchQuery.trim()}"
                  </div>
                )}

                {/* 4. Search Full Catalog Button */}
                <button
                  type="button"
                  onClick={() => executeSearch()}
                  className="w-full mt-1 py-1.5 rounded-xl bg-lumen-cyan/15 hover:bg-lumen-cyan text-lumen-cyan hover:text-black text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5"
                >
                  <Search className="w-3 h-3" />
                  <span>Search full library for "{searchQuery.trim()}"</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
