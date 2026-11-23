import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  X,
  Music2,
  User,
  Disc3,
  Play,
  Sparkles,
  Loader2,
  ArrowLeft,
  ListPlus,
  ListStart,
  FolderPlus,
  Download,
  MoreHorizontal,
  Check,
  Clock,
  ChevronRight
} from 'lucide-react';
import { Track } from '../../types/music';
import { ArtistService, ArtistMetadata, AlbumMetadata } from '../../services/artistService';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  dominantColor: string;
  initialQuery?: string;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onAddToQueue?: (track: Track) => void;
  onPlayNext?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onSaveOffline?: (track: Track) => void;
  onSelectArtist: (artist: string) => void;
  onSelectAlbum?: (album: AlbumMetadata) => void;
  onClose: () => void;
  suggestedTracks?: Track[];
}

const RECENT_SEARCHES_KEY = 'lumen_recent_searches_v1';

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, 8);
    }
  } catch (_) {}
  return [];
}

function saveRecentSearch(term: string): string[] {
  const clean = term.trim();
  if (!clean || clean.length < 2) return loadRecentSearches();
  const prev = loadRecentSearches().filter(s => s.toLowerCase() !== clean.toLowerCase());
  const next = [clean, ...prev].slice(0, 8);
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch (_) {}
  return next;
}

export const MobileSearchView: React.FC<Props> = ({
  dominantColor,
  initialQuery = '',
  onPlayTrack,
  onAddToQueue,
  onPlayNext,
  onAddToPlaylist,
  onSaveOffline,
  onSelectArtist,
  onSelectAlbum,
  onClose,
  suggestedTracks = []
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<'all' | 'songs' | 'artists' | 'albums'>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [actionMenuTrack, setActionMenuTrack] = useState<Track | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [results, setResults] = useState<{
    tracks: Track[];
    artists: ArtistMetadata[];
    albums: AlbumMetadata[];
  }>({ tracks: [], artists: [], albums: [] });

  const flashActionToast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 2200);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (initialQuery && initialQuery !== query) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  // Auto-focus the search input when the view opens
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, []);

  // 0ms Instant Local Hits + 75ms Progressive Streaming Search (Spotify-speed)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ tracks: [], artists: [], albums: [] });
      setIsSearching(false);
      return;
    }

    // 1. 0ms synchronous local index hit (Liked songs, Playlists, cached catalog)
    const instant = ArtistService.searchInstantLocal(trimmed);
    if (instant.tracks.length > 0 || instant.artists.length > 0 || instant.albums.length > 0) {
      setResults(instant);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    const timer = setTimeout(() => {
      ArtistService.searchProgressive(
        trimmed,
        (partial, isFinal) => {
          if (controller.signal.aborted) return;
          setResults(partial);
          if (isFinal) setIsSearching(false);
        },
        controller.signal
      ).catch(() => {
        if (!controller.signal.aborted) setIsSearching(false);
      });
    }, 75);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const currentSongs = hasQuery ? results.tracks : suggestedTracks;

  // Compute Spotify-style Top Result across Artist, Album, and Song
  const topResult = useMemo(() => {
    if (!hasQuery) return null;
    const q = query.trim().toLowerCase();
    const qNorm = q.replace(/[^a-z0-9]/g, '');

    const exactArtist = results.artists.find(a => a.name.toLowerCase() === q || a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === qNorm);
    if (exactArtist) return { kind: 'artist' as const, data: exactArtist };

    const exactAlbum = results.albums.find(a => a.title.toLowerCase() === q || a.title.toLowerCase().replace(/[^a-z0-9]/g, '') === qNorm);
    if (exactAlbum) return { kind: 'album' as const, data: exactAlbum };

    const exactTrack = results.tracks.find(t => t.title.toLowerCase() === q || t.title.toLowerCase().replace(/[^a-z0-9]/g, '') === qNorm);
    if (exactTrack) return { kind: 'track' as const, data: exactTrack };

    // Prefix preference: artist > album > track
    const prefixArtist = results.artists.find(a => a.name.toLowerCase().startsWith(q));
    if (prefixArtist) return { kind: 'artist' as const, data: prefixArtist };

    const prefixAlbum = results.albums.find(a => a.title.toLowerCase().startsWith(q));
    if (prefixAlbum) return { kind: 'album' as const, data: prefixAlbum };

    if (results.tracks[0]) return { kind: 'track' as const, data: results.tracks[0] };
    if (results.albums[0]) return { kind: 'album' as const, data: results.albums[0] };
    if (results.artists[0]) return { kind: 'artist' as const, data: results.artists[0] };
    return null;
  }, [hasQuery, query, results]);

  const commitRecentSearch = (term?: string) => {
    const val = (term ?? query).trim();
    if (val.length >= 2) {
      setRecentSearches(saveRecentSearch(val));
    }
  };

  const handlePlaySingleSong = (track: Track) => {
    commitRecentSearch();
    WatchSoundService.playTick(1.0);
    // Spotify behavior: playing a single song from Search does NOT wipe your active playlist queue!
    onPlayTrack(track);
  };

  const handleQueueSong = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    if (!onAddToQueue) return;
    WatchSoundService.playTick(1.1);
    onAddToQueue(track);
    setQueuedIds(prev => new Set(prev).add(track.id));
  };

  const handleOpenAlbum = (album: AlbumMetadata) => {
    commitRecentSearch();
    WatchSoundService.playTick(1.1);
    if (onSelectAlbum) {
      onSelectAlbum(album);
    } else {
      onSelectArtist(album.artist);
    }
  };

  const handleOpenArtist = (artistName: string) => {
    commitRecentSearch();
    WatchSoundService.playTick(1.0);
    onSelectArtist(artistName);
  };

  const isTv = typeof document !== 'undefined' && document.body.classList.contains('tv-mode');

  const tabs: Array<{ id: 'all' | 'songs' | 'artists' | 'albums'; label: string; count?: number }> = [
    { id: 'all', label: 'All' },
    { id: 'songs', label: 'Songs', count: hasQuery ? results.tracks.length : suggestedTracks.length },
    { id: 'albums', label: 'Albums', count: hasQuery ? results.albums.length : 0 },
    { id: 'artists', label: 'Artists', count: hasQuery ? results.artists.length : 0 }
  ];

  const renderSongRow = (track: Track, idx: number) => {
    const isQueued = queuedIds.has(track.id);
    return (
      <div
        key={`${track.id}_${idx}`}
        tabIndex={0}
        onClick={() => handlePlaySingleSong(track)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handlePlaySingleSong(track);
          }
        }}
        className="p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 flex items-center justify-between gap-2.5 cursor-pointer transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-lumen-cyan"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {track.artworkUrl ? (
            <img
              src={track.artworkUrl}
              alt={track.title}
              loading="lazy"
              className="w-12 h-12 rounded-xl object-cover shrink-0 shadow-md border border-white/10"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/10">
              <Music2 className="w-5 h-5 text-white/50" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-xs sm:text-sm font-bold text-white truncate">{track.title}</div>
            <div className="text-[11px] text-white/55 truncate mt-0.5">
              {track.artist}{track.album ? ` • ${track.album}` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onAddToQueue && (
            <button
              type="button"
              onClick={(e) => {
                handleQueueSong(e, track);
                flashActionToast(`Added "${track.title}" to Queue`);
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all active:scale-90 cursor-pointer ${
                isQueued
                  ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                  : 'bg-white/[0.06] hover:bg-white/15 border-white/10 text-white/70 hover:text-white'
              }`}
              title="Add to Queue"
            >
              {isQueued ? <Check className="w-3.5 h-3.5" /> : <ListPlus className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              WatchSoundService.playTick(1.0);
              setActionMenuTrack(track);
            }}
            className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/15 border border-white/10 flex items-center justify-center text-white/75 hover:text-white active:scale-90 transition-all cursor-pointer"
            title="More options (Play Next, Playlist, Queue, Save Offline)"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white"
            style={{ backgroundColor: `${dominantColor}35`, border: `1px solid ${dominantColor}65` }}
          >
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
          </div>
        </div>
      </div>
    );
  };

  const renderAlbumCard = (album: AlbumMetadata) => (
    <div
      key={album.id}
      tabIndex={0}
      onClick={() => handleOpenAlbum(album)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpenAlbum(album);
        }
      }}
      className="p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 flex flex-col cursor-pointer transition-all active:scale-[0.98] group focus:outline-none focus:ring-2 focus:ring-lumen-cyan"
    >
      <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-black/50 border border-white/10 mb-2.5 shadow-lg">
        {album.artworkUrl ? (
          <img
            src={album.artworkUrl}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/30">
            <Disc3 className="w-10 h-10" />
          </div>
        )}
        <div
          className="absolute bottom-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-black bg-white shadow-xl opacity-90 group-hover:scale-110 transition-transform"
        >
          <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
        </div>
      </div>
      <div className="text-xs font-bold text-white truncate">{album.title}</div>
      <div className="text-[11px] text-white/55 truncate mt-0.5">
        {album.artist}
      </div>
      <div className="text-[10px] font-mono text-white/40 mt-0.5 truncate">
        {album.year ? `${album.year}` : 'Album'}{album.trackCount ? ` • ${album.trackCount} tracks` : ''}
      </div>
    </div>
  );

  return (
    <div className={`fixed inset-0 z-40 bg-[#07090E]/92 backdrop-blur-lg flex flex-col select-none pt-[max(0.75rem,env(safe-area-inset-top))] px-4 sm:px-8 ${isTv ? 'pl-28 md:pl-32' : ''} overflow-hidden`}>
      <div className="w-full max-w-4xl mx-auto flex flex-col flex-1 min-h-0">
        {/* 1. TOP LIQUID-GLASS SEARCH BAR */}
        <div className="pt-2 pb-2 sm:pt-14">
          <div
            className="relative rounded-2xl bg-white/[0.07] border border-white/15 px-3.5 py-2.5 flex items-center gap-3 transition-all shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            style={{
              boxShadow: `0 0 24px ${dominantColor}22, inset 0 1px 1px rgba(255,255,255,0.2)`
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/75 hover:text-white active:scale-90 transition-transform -ml-1 cursor-pointer"
              title="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <Search className="w-4 h-4 text-white/50 shrink-0" />

            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRecentSearch();
              }}
              placeholder="Search songs, albums, or artists..."
              className="flex-1 bg-transparent text-white placeholder-white/40 text-sm font-medium outline-none"
            />

            {isSearching && (
              <Loader2 className="w-4 h-4 text-lumen-cyan animate-spin shrink-0" />
            )}

            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults({ tracks: [], artists: [], albums: [] });
                  inputRef.current?.focus();
                }}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/75 active:scale-90 transition-all shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 2. SPOTIFY-STYLE FILTER PILLS (ALL / SONGS / ALBUMS / ARTISTS) */}
        <div className="flex items-center gap-2 py-2 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(1.0);
                  setActiveTab(tab.id);
                }}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border ${
                  active
                    ? 'text-black bg-white border-white shadow-lg'
                    : 'text-white/70 bg-white/[0.06] hover:bg-white/10 border-white/10 hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                {hasQuery && typeof tab.count === 'number' && tab.count > 0 && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${active ? 'bg-black/15 text-black' : 'bg-white/10 text-white/60'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 3. SCROLLABLE RESULTS */}
        <div className="flex-1 overflow-y-auto px-0.5 pt-2 pb-[calc(150px+env(safe-area-inset-bottom))] space-y-5 no-scrollbar">
          {/* EMPTY QUERY: RECENT SEARCHES + SUGGESTED TRACKS */}
          {!hasQuery && (
            <>
              {recentSearches.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-white/45 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span>Recent Searches</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRecentSearches([]);
                        try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch (_) {}
                      }}
                      className="text-[11px] text-white/45 hover:text-white cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => setQuery(term)}
                        className="px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/15 border border-white/10 text-xs font-medium text-white/85 transition-all active:scale-95 cursor-pointer"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'albums' ? (
                <div className="text-center py-16 text-white/45 text-xs space-y-2">
                  <Disc3 className="w-8 h-8 mx-auto opacity-40" />
                  <p>Search any album title or artist to browse full albums</p>
                </div>
              ) : activeTab === 'artists' ? (
                <div className="text-center py-16 text-white/45 text-xs space-y-2">
                  <User className="w-8 h-8 mx-auto opacity-40" />
                  <p>Type an artist name above to explore their discography</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-white/45 px-1 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span>Trending Hits & Suggestions</span>
                  </div>
                  <div className="space-y-1.5">
                    {suggestedTracks.slice(0, 15).map((track, idx) => renderSongRow(track, idx))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ALL TAB (SPOTIFY-STYLE TOP RESULT + SONGS + ALBUMS + ARTISTS) */}
          {hasQuery && activeTab === 'all' && (
            <>
              {/* Top Result Card */}
              {topResult && (
                <div className="space-y-2">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-white/50 px-1">
                    Top Result
                  </div>
                  <div
                    onClick={() => {
                      if (topResult.kind === 'artist') handleOpenArtist(topResult.data.name);
                      else if (topResult.kind === 'album') handleOpenAlbum(topResult.data);
                      else handlePlaySingleSong(topResult.data);
                    }}
                    className="p-4 rounded-3xl bg-gradient-to-br from-white/[0.10] via-white/[0.04] to-transparent border border-white/15 hover:border-white/25 flex items-center justify-between gap-4 cursor-pointer transition-all active:scale-[0.99] shadow-xl"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      {topResult.kind === 'artist' ? (
                        topResult.data.avatarUrl ? (
                          <img src={topResult.data.avatarUrl} alt={topResult.data.name} className="w-16 h-16 rounded-full object-cover border border-white/20 shrink-0 shadow-lg" />
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                            <User className="w-7 h-7 text-white/75" />
                          </div>
                        )
                      ) : (
                        (topResult.data as any).artworkUrl ? (
                          <img src={(topResult.data as any).artworkUrl} alt={(topResult.data as any).title} className="w-16 h-16 rounded-2xl object-cover border border-white/20 shrink-0 shadow-lg" />
                        ) : (
                          <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                            <Disc3 className="w-7 h-7 text-white/75" />
                          </div>
                        )
                      )}

                      <div className="min-w-0">
                        <span className="inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/10 text-lumen-cyan font-bold mb-1">
                          {topResult.kind === 'artist' ? 'Artist' : topResult.kind === 'album' ? 'Album' : 'Song'}
                        </span>
                        <div className="text-base sm:text-lg font-black text-white truncate">
                          {topResult.kind === 'artist' ? topResult.data.name : topResult.data.title}
                        </div>
                        <div className="text-xs text-white/60 truncate">
                          {topResult.kind === 'artist'
                            ? (topResult.data.genre || 'Verified Artist')
                            : topResult.kind === 'album'
                              ? `${topResult.data.artist}${topResult.data.year ? ` • ${topResult.data.year}` : ''}`
                              : topResult.data.artist}
                        </div>
                      </div>
                    </div>

                    <div className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shrink-0 shadow-xl">
                      {topResult.kind === 'track' ? (
                        <Play className="w-5 h-5 fill-black ml-0.5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Songs Section */}
              {results.tracks.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Music2 className="w-3.5 h-3.5 text-lumen-cyan" />
                      <span>Songs</span>
                    </span>
                    {results.tracks.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('songs')}
                        className="text-[11px] font-semibold text-lumen-cyan hover:underline cursor-pointer"
                      >
                        See all ({results.tracks.length})
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {results.tracks.slice(0, 5).map((track, idx) => renderSongRow(track, idx))}
                  </div>
                </div>
              )}

              {/* Albums Section */}
              {results.albums.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Disc3 className="w-3.5 h-3.5 text-purple-300" />
                      <span>Albums</span>
                    </span>
                    {results.albums.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('albums')}
                        className="text-[11px] font-semibold text-lumen-cyan hover:underline cursor-pointer"
                      >
                        See all ({results.albums.length})
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {results.albums.slice(0, 4).map((album) => renderAlbumCard(album))}
                  </div>
                </div>
              )}

              {/* Artists Section */}
              {results.artists.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Artists</span>
                    </span>
                    {results.artists.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('artists')}
                        className="text-[11px] font-semibold text-lumen-cyan hover:underline cursor-pointer"
                      >
                        See all ({results.artists.length})
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {results.artists.slice(0, 4).map((artist) => (
                      <div
                        key={artist.id}
                        onClick={() => handleOpenArtist(artist.name)}
                        className="p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 flex items-center justify-between cursor-pointer transition-all active:scale-[0.98]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {artist.avatarUrl ? (
                            <img src={artist.avatarUrl} alt={artist.name} loading="lazy" className="w-11 h-11 rounded-full object-cover border border-white/20 shrink-0" />
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center border border-white/20 shrink-0">
                              <User className="w-5 h-5 text-white/75" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-bold text-white truncate">{artist.name}</div>
                            <div className="text-[11px] text-white/50 truncate">{artist.genre || 'Artist'}</div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isSearching && results.tracks.length === 0 && results.albums.length === 0 && results.artists.length === 0 && (
                <div className="text-center py-16 text-white/45 text-xs">
                  No results found matching "{query}"
                </div>
              )}
            </>
          )}

          {/* SONGS TAB */}
          {hasQuery && activeTab === 'songs' && (
            <div className="space-y-1.5">
              {currentSongs.map((track, idx) => renderSongRow(track, idx))}
              {results.tracks.length === 0 && !isSearching && (
                <div className="text-center py-16 text-white/45 text-xs">
                  No songs found matching "{query}"
                </div>
              )}
            </div>
          )}

          {/* ALBUMS TAB */}
          {hasQuery && activeTab === 'albums' && (
            <>
              {results.albums.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {results.albums.map((album) => renderAlbumCard(album))}
                </div>
              ) : !isSearching ? (
                <div className="text-center py-16 text-white/45 text-xs">
                  No albums found matching "{query}"
                </div>
              ) : null}
            </>
          )}

          {/* ARTISTS TAB */}
          {hasQuery && activeTab === 'artists' && (
            <div className="space-y-1.5">
              {results.artists.map((artist) => (
                <div
                  key={artist.id}
                  tabIndex={0}
                  onClick={() => handleOpenArtist(artist.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenArtist(artist.name);
                    }
                  }}
                  className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 flex items-center justify-between cursor-pointer transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-lumen-cyan"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {artist.avatarUrl ? (
                      <img
                        src={artist.avatarUrl}
                        alt={artist.name}
                        loading="lazy"
                        className="w-12 h-12 rounded-full object-cover shrink-0 border border-white/20 shadow-md"
                      />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 border border-white/20"
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

                  <div className="text-xs font-semibold px-3 py-1 rounded-full bg-white/10 text-white/80 border border-white/10 shrink-0">
                    View
                  </div>
                </div>
              ))}

              {results.artists.length === 0 && !isSearching && (
                <div className="text-center py-16 text-white/45 text-xs">
                  No artists found matching "{query}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ACTION FEEDBACK TOAST */}
      {actionToast && (
        <div className="fixed top-[max(1.25rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[140] px-4 py-2 rounded-full bg-black/92 border border-white/20 text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-fadeIn">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{actionToast}</span>
        </div>
      )}

      {/* LIQUID GLASS TRACK ACTION SHEET (Play Next, Add to Queue, Add to Playlist, Save Offline) */}
      {actionMenuTrack && (
        <div
          onClick={() => setActionMenuTrack(null)}
          className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4 animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl border border-white/20 p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-5 space-y-3 shadow-2xl"
            style={{
              background: 'linear-gradient(155deg, rgba(24, 30, 48, 0.96) 0%, rgba(8, 10, 18, 0.98) 100%)'
            }}
          >
            <div className="flex items-center gap-3 pb-3 border-b border-white/10">
              {actionMenuTrack.artworkUrl ? (
                <img src={actionMenuTrack.artworkUrl} alt={actionMenuTrack.title} className="w-12 h-12 rounded-xl object-cover border border-white/15 shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Music2 className="w-5 h-5 text-white/50" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white truncate">{actionMenuTrack.title}</div>
                <div className="text-xs text-white/55 truncate">{actionMenuTrack.artist}</div>
              </div>
              <button
                type="button"
                onClick={() => setActionMenuTrack(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  const t = actionMenuTrack;
                  setActionMenuTrack(null);
                  WatchSoundService.playTick(1.15);
                  onPlayNext?.(t);
                  flashActionToast(`Playing "${t.title}" next`);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-left text-xs sm:text-sm font-semibold text-white active:scale-[0.98] transition-all cursor-pointer"
              >
                <ListStart className="w-4 h-4 text-lumen-cyan shrink-0" />
                <span>Play Next</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const t = actionMenuTrack;
                  setActionMenuTrack(null);
                  WatchSoundService.playTick(1.1);
                  onAddToQueue?.(t);
                  setQueuedIds(prev => new Set(prev).add(t.id));
                  flashActionToast(`Added "${t.title}" to Queue`);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-left text-xs sm:text-sm font-semibold text-white active:scale-[0.98] transition-all cursor-pointer"
              >
                <ListPlus className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>Add to Queue</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const t = actionMenuTrack;
                  setActionMenuTrack(null);
                  WatchSoundService.playTick(1.1);
                  onAddToPlaylist?.(t);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-left text-xs sm:text-sm font-semibold text-white active:scale-[0.98] transition-all cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-purple-300 shrink-0" />
                <span>Add to Playlist</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const t = actionMenuTrack;
                  setActionMenuTrack(null);
                  WatchSoundService.playTick(1.0);
                  if (onSaveOffline) {
                    onSaveOffline(t);
                  } else {
                    flashActionToast('Offline Save arrives in Phase 2 — authorized storage ready');
                  }
                }}
                className="w-full flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-left text-xs sm:text-sm font-semibold text-white active:scale-[0.98] transition-all cursor-pointer"
              >
                <span className="flex items-center gap-3">
                  <Download className="w-4 h-4 text-amber-300 shrink-0" />
                  <span>Save Offline</span>
                </span>
                <span className="text-[10px] font-mono text-white/45">Phase 2</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
