import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  Disc3,
  Check,
  Plus,
  X,
  FolderPlus,
  ListPlus,
  MoreVertical,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Shuffle,
  Loader2,
  Bookmark,
  BookmarkCheck,
  Search,
  Info,
  LayoutGrid,
  List,
  Share2,
  ListStart,
  AlertCircle,
  RefreshCw,
  BadgeCheck
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../types/music';
import { PlaylistService } from '../../services/playlistService';
import { AudioEngine } from '../../services/audioEngine';
import { ArtistService, AlbumMetadata, DiscographyResult } from '../../services/artistService';
import {
  RankedTrackEntry,
  StructuredArtistRankingResult,
  buildPlayQueueFromRanking
} from '../../services/artistRankingLogic';
import { PinnedDiscographyService } from '../../services/pinnedDiscographyService';
import { toAccessibleAccentColor, withAlpha } from '../../services/colorSampler';
import { CoverImage } from '../common/CoverImage';
import { ArtistLinks } from '../common/ArtistLinks';

interface ArtistAlbum extends AlbumMetadata {
  tracks?: Track[];
}

export interface ArtistSelectionContext {
  name: string;
  artistId?: string | null;
  provider?: string | null;
  trackTitle?: string | null;
  album?: string | null;
}

interface Props {
  artistName: string;
  artistContext?: ArtistSelectionContext | null;
  onClose: () => void;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  dominantColor: string;
  playlists: CustomPlaylist[];
  onSelectArtist?: (artist: string) => void;
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatUpdatedAt(ts?: number): string {
  if (!ts) return 'Just now';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function rankedEntryToPlayableTrack(entry: RankedTrackEntry): Track {
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album || 'Single',
    duration: entry.duration || 180,
    artworkUrl: entry.artworkUrl || null,
    hasArtwork: Boolean(entry.artworkUrl),
    streamUrl: entry.streamUrl || (entry.videoId ? `/api/yt/stream?videoId=${encodeURIComponent(entry.videoId)}` : ''),
    provider: entry.rawProvider === 'jiosaavn' ? 'saavn' : (entry.videoId ? 'youtube' : undefined),
    providerTrackId: entry.videoId || entry.id
  } as any;
}

export const ArtistHubView: React.FC<Props> = ({
  artistName,
  artistContext,
  onClose,
  onPlayTrack,
  currentTrack,
  isPlaying,
  dominantColor,
  playlists,
  onSelectArtist
}) => {
  const [ranking, setRanking] = useState<StructuredArtistRankingResult | null>(null);
  const [albums, setAlbums] = useState<ArtistAlbum[]>([]);
  const [singles, setSingles] = useState<ArtistAlbum[]>([]);
  const [collabs, setCollabs] = useState<ArtistAlbum[]>([]);
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);

  const [showAllRankedTracks, setShowAllRankedTracks] = useState(false);
  const [showSourceDetails, setShowSourceDetails] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [showHeaderMoreMenu, setShowHeaderMoreMenu] = useState(false);
  const [discographyQuery, setDiscographyQuery] = useState('');
  const [activeDiscographyTab, setActiveDiscographyTab] = useState<'albums' | 'singles' | 'appears_on'>('albums');
  const [discographyLayout, setDiscographyLayout] = useState<'featured' | 'grid' | 'list'>('featured');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  const [albumTracksLoading, setAlbumTracksLoading] = useState<string | null>(null);
  const [loadedAlbumTracks, setLoadedAlbumTracks] = useState<Record<string, Track[]>>({});
  const [albumTracksError, setAlbumTracksError] = useState<Record<string, string>>({});
  const [playlistMenuTrack, setPlaylistMenuTrack] = useState<Track | null>(null);
  const [activeMenuTrackId, setActiveMenuTrackId] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(() => PinnedDiscographyService.isPinned(artistName));
  const [savedAlbumId, setSavedAlbumId] = useState<string | null>(null);
  const [albumForPlaylistPicker, setAlbumForPlaylistPicker] = useState<ArtistAlbum | null>(null);

  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const accent = useMemo(
    () => toAccessibleAccentColor(dominantColor || '#f43f5e'),
    [dominantColor]
  );

  const showToast = useCallback((msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(prev => (prev === msg ? null : prev)), 2400);
  }, []);

  useEffect(() => {
    setIsPinned(PinnedDiscographyService.isPinned(artistName));
  }, [artistName]);

  // Fetch verified artist ranking + discography with strict stale-response cancellation
  const loadArtist = useCallback(async (forceRefresh = false) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;

    setIsLoading(true);
    setLoadError(null);
    setShowAllRankedTracks(false);
    setShowSourceDetails(false);
    setExpandedAlbumId(null);
    setActiveMenuTrackId(null);
    setShowHeaderMoreMenu(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    try {
      const data: DiscographyResult = await ArtistService.getArtistDiscography(artistName, {
        artistId: artistContext?.artistId || null,
        provider: artistContext?.provider || null,
        trackTitle: artistContext?.trackTitle || null,
        album: artistContext?.album || null,
        signal: controller.signal,
        forceRefresh
      });

      if (controller.signal.aborted || requestSeqRef.current !== seq) return;

      setRanking(data.ranking);
      setAlbums((data.albums || []) as ArtistAlbum[]);
      setSingles((data.singles || []) as ArtistAlbum[]);
      setCollabs((data.collabs || []) as ArtistAlbum[]);
      setPortraitUrl(data.artistPortraitUrl || data.ranking?.meta?.portraitUrl || data.albums?.[0]?.artworkUrl || null);

      const hasAny =
        (data.ranking?.rankedTracks?.length || 0) > 0 ||
        (data.albums?.length || 0) > 0 ||
        (data.singles?.length || 0) > 0 ||
        (data.collabs?.length || 0) > 0;
      if (!hasAny) {
        setLoadError('No songs or releases found for this artist.');
      }
      setIsLoading(false);
    } catch (err: any) {
      if (err?.name === 'AbortError' || requestSeqRef.current !== seq) return;
      setLoadError(err?.message || 'Unable to connect to music catalog.');
      setIsLoading(false);
    }
  }, [artistName, artistContext?.artistId, artistContext?.provider, artistContext?.trackTitle, artistContext?.album]);

  useEffect(() => {
    loadArtist(false);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [loadArtist]);

  const rankedEntries = ranking?.rankedTracks || [];
  const appearsOnEntries = ranking?.appearsOnTracks || [];
  const meta = ranking?.meta || null;

  // Real-time search filter over displayed popular/ranked tracks
  const filteredRankedEntries = useMemo(() => {
    const q = discographyQuery.trim().toLowerCase();
    if (!q) return rankedEntries;
    return rankedEntries.filter(
      t =>
        t.title.toLowerCase().includes(q) ||
        (t.album && t.album.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q))
    );
  }, [rankedEntries, discographyQuery]);

  const visibleRankedEntries = useMemo(
    () => (showAllRankedTracks ? filteredRankedEntries : filteredRankedEntries.slice(0, 5)),
    [filteredRankedEntries, showAllRankedTracks]
  );

  // Filtered releases per tab
  const activeReleasePool = useMemo(() => {
    const pool =
      activeDiscographyTab === 'albums'
        ? albums
        : activeDiscographyTab === 'singles'
          ? singles
          : collabs;
    const q = discographyQuery.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      r => r.title.toLowerCase().includes(q) || (r.artist && r.artist.toLowerCase().includes(q))
    );
  }, [activeDiscographyTab, albums, singles, collabs, discographyQuery]);

  // Hero collage background artworks (2 side-cards from top albums/singles, matching Image 3)
  const heroSideCovers = useMemo(() => {
    const urls: string[] = [];
    const seen = new Set<string>();
    if (portraitUrl) seen.add(portraitUrl);
    for (const item of [...albums, ...singles, ...rankedEntries]) {
      const u = (item as any).artworkUrl;
      if (u && !seen.has(u)) {
        seen.add(u);
        urls.push(u);
        if (urls.length >= 2) break;
      }
    }
    return urls;
  }, [portraitUrl, albums, singles, rankedEntries]);

  const primaryGenre = useMemo(() => {
    return (
      albums.find(a => a.primaryGenreName)?.primaryGenreName ||
      singles.find(s => s.primaryGenreName)?.primaryGenreName ||
      null
    );
  }, [albums, singles]);

  // Play follows EXACT displayed order of playable entries; Shuffle uses the exact same eligible set
  const handlePlayAll = (shuffle = false) => {
    const orderedPlayable = buildPlayQueueFromRanking(filteredRankedEntries, { shuffle });
    if (orderedPlayable.length === 0) {
      showToast('No playable recordings available');
      return;
    }
    const queue = orderedPlayable.map(rankedEntryToPlayableTrack);
    onPlayTrack(queue[0], queue);
  };

  const handlePlayRankedEntry = (entry: RankedTrackEntry) => {
    if (entry.isPlayable === false) {
      showToast(entry.unavailableReason || 'This recording is currently unavailable');
      return;
    }
    const eligible = buildPlayQueueFromRanking(filteredRankedEntries, { shuffle: false });
    const startIdx = eligible.findIndex(e => e.id === entry.id);
    const ordered = startIdx >= 0
      ? [...eligible.slice(startIdx), ...eligible.slice(0, startIdx)]
      : [entry, ...eligible.filter(e => e.id !== entry.id)];
    const queue = ordered.map(rankedEntryToPlayableTrack);
    onPlayTrack(queue[0], queue);
  };

  const handleTogglePin = () => {
    const cover = portraitUrl || albums[0]?.artworkUrl || singles[0]?.artworkUrl || null;
    const nowPinned = PinnedDiscographyService.togglePin(artistName, cover, albums.length + singles.length);
    setIsPinned(nowPinned);
    showToast(nowPinned ? 'Pinned to Library' : 'Removed from Pinned Discographies');
  };

  const handleShareArtist = async () => {
    const summary = `${artistName} on Lumen — ${meta?.heading || 'Discography'}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: artistName, text: summary });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
        showToast('Artist link copied');
        return;
      }
    } catch (_) {}
    showToast(`Sharing ${artistName}`);
  };

  const handleToggleAlbum = async (album: ArtistAlbum) => {
    if (expandedAlbumId === album.id) {
      setExpandedAlbumId(null);
      return;
    }
    setExpandedAlbumId(album.id);
    if (loadedAlbumTracks[album.id]?.length) return;
    setAlbumTracksLoading(album.id);
    setAlbumTracksError(prev => {
      const next = { ...prev };
      delete next[album.id];
      return next;
    });
    try {
      const tracks = await ArtistService.getAlbumTracks(album.id, album.title, album.artist || artistName);
      if (tracks.length > 0) {
        setLoadedAlbumTracks(prev => ({ ...prev, [album.id]: tracks }));
      } else {
        setAlbumTracksError(prev => ({ ...prev, [album.id]: 'No tracks found for this release.' }));
      }
    } catch {
      setAlbumTracksError(prev => ({ ...prev, [album.id]: 'Failed to load tracklist.' }));
    } finally {
      setAlbumTracksLoading(null);
    }
  };

  const handlePlayAlbum = async (album: ArtistAlbum, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    let tracks = loadedAlbumTracks[album.id];
    if (!tracks || tracks.length === 0) {
      setAlbumTracksLoading(album.id);
      try {
        tracks = await ArtistService.getAlbumTracks(album.id, album.title, album.artist || artistName);
        if (tracks.length > 0) {
          setLoadedAlbumTracks(prev => ({ ...prev, [album.id]: tracks }));
        }
      } catch {
        tracks = [];
      } finally {
        setAlbumTracksLoading(null);
      }
    }
    if (tracks && tracks.length > 0) {
      onPlayTrack(tracks[0], tracks);
    } else {
      showToast('Could not load tracks for this release');
    }
  };

  const handleSaveAlbumAsPlaylist = async (album: ArtistAlbum, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    let tracks = loadedAlbumTracks[album.id];
    if (!tracks || tracks.length === 0) {
      tracks = await ArtistService.getAlbumTracks(album.id, album.title, album.artist || artistName).catch(() => []);
    }
    if (tracks && tracks.length > 0) {
      PlaylistService.createPlaylistWithTracks(
        album.title,
        `${album.artist || artistName}${album.year ? ` • ${album.year}` : ''}`,
        album.artworkUrl || tracks[0]?.artworkUrl || null,
        tracks,
        accent
      );
      setSavedAlbumId(album.id);
      showToast(`Saved "${album.title}" as playlist`);
      setTimeout(() => setSavedAlbumId(null), 2200);
    }
  };

  const handleAddTrackToPlaylist = (playlistId: string, track: Track) => {
    PlaylistService.addTrackToPlaylist(playlistId, track);
    const pl = playlists.find(p => p.id === playlistId);
    setPlaylistMenuTrack(null);
    showToast(`Added to ${pl?.name || 'Playlist'}`);
  };

  const handleAddAlbumToPlaylist = async (playlistId: string, album: ArtistAlbum) => {
    let tracks = loadedAlbumTracks[album.id];
    if (!tracks || tracks.length === 0) {
      tracks = await ArtistService.getAlbumTracks(album.id, album.title, album.artist || artistName).catch(() => []);
    }
    if (tracks.length > 0) {
      PlaylistService.addTracksToPlaylist(playlistId, tracks);
      const pl = playlists.find(p => p.id === playlistId);
      showToast(`Added ${tracks.length} songs to ${pl?.name || 'Playlist'}`);
    }
    setAlbumForPlaylistPicker(null);
  };

  const totalReleaseCount = albums.length + singles.length;
  const statsSummaryParts = [
    totalReleaseCount > 0 ? `${totalReleaseCount} Albums & EPs` : null,
    rankedEntries.length > 0 ? `${rankedEntries.length} Songs` : null,
    primaryGenre
  ].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-[#080A10] text-white overflow-hidden animate-fadeIn"
      role="region"
      aria-label={`${artistName} Artist Page`}
    >
      {/* Dynamic Artwork-Driven Ambient Background (hidden automatically in Pure Dark Mode) */}
      <div
        data-lumen-ambient-backdrop="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: `radial-gradient(ellipse 95% 45% at 50% 0%, ${withAlpha(accent, 0.34)} 0%, ${withAlpha(accent, 0.12)} 42%, #080A10 78%)`
        }}
      />

      {/* Scrollable Page Surface — reserves generous bottom space for MobileMiniPlayer / BottomTransportDock */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto overscroll-contain pb-48 md:pb-32"
      >
        {/* =============================================================== */}
        {/* HERO: Mobile untouched (< md) + Seamless Widescreen Desktop (md+) */}
        {/* =============================================================== */}
        <div className="relative pt-[max(14px,env(safe-area-inset-top))] md:pt-24 px-4 md:px-10 pb-5 md:pb-10 overflow-hidden">
          {/* Mobile Layered Background Collage (< md — untouched!) */}
          <div className="md:hidden pointer-events-none absolute inset-x-0 top-0 h-[270px] overflow-hidden">
            {heroSideCovers[0] && (
              <img
                src={heroSideCovers[0]}
                alt=""
                aria-hidden="true"
                className="absolute -left-6 top-8 w-36 h-36 rounded-3xl object-cover opacity-30 -rotate-12 scale-105"
                style={{ filter: 'blur(2px) saturate(1.15)' }}
              />
            )}
            {heroSideCovers[1] && (
              <img
                src={heroSideCovers[1]}
                alt=""
                aria-hidden="true"
                className="absolute -right-6 top-10 w-36 h-36 rounded-3xl object-cover opacity-30 rotate-12 scale-105"
                style={{ filter: 'blur(2px) saturate(1.15)' }}
              />
            )}
            {portraitUrl && (
              <div className="absolute inset-x-0 top-0 h-[265px] flex justify-center">
                <img
                  src={portraitUrl}
                  alt=""
                  aria-hidden="true"
                  className="w-full max-w-[440px] h-full object-cover object-top opacity-75"
                  style={{
                    maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.92) 38%, rgba(0,0,0,0) 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.92) 38%, rgba(0,0,0,0) 100%)'
                  }}
                />
              </div>
            )}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(8,10,16,0.38) 0%, rgba(8,10,16,0.22) 35%, rgba(8,10,16,0.88) 82%, #080A10 100%)'
              }}
            />
          </div>

          {/* Desktop Seamless Blended Atmospheric Banner (md+ — zero hard rectangular edges!) */}
          <div className="hidden md:block pointer-events-none absolute inset-x-0 top-0 h-[440px] overflow-hidden">
            {portraitUrl && (
              <>
                {/* Ambient blurred color fill across full width (hidden in Pure Dark Mode) */}
                <img
                  data-lumen-ambient-backdrop="true"
                  src={portraitUrl}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover object-center scale-125 opacity-40"
                  style={{ filter: 'blur(64px) saturate(1.45)' }}
                />
                {/* Crisp portrait anchored smoothly on right side, softly feathered on all 4 edges */}
                <div
                  className="absolute right-[6%] top-0 w-[56%] max-w-[740px] h-full"
                  style={{
                    maskImage:
                      'radial-gradient(ellipse 76% 82% at 62% 36%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.68) 46%, rgba(0,0,0,0.16) 74%, rgba(0,0,0,0) 100%)',
                    WebkitMaskImage:
                      'radial-gradient(ellipse 76% 82% at 62% 36%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.68) 46%, rgba(0,0,0,0.16) 74%, rgba(0,0,0,0) 100%)'
                  }}
                >
                  <img
                    src={portraitUrl}
                    alt=""
                    aria-hidden="true"
                    className="w-full h-full object-cover object-top opacity-85"
                  />
                </div>
              </>
            )}
            {/* Multi-stop seamless dissolve into #080A10 */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, rgba(8,10,16,0.92) 0%, rgba(8,10,16,0.68) 38%, rgba(8,10,16,0.18) 72%, rgba(8,10,16,0.55) 100%)'
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(8,10,16,0.42) 0%, rgba(8,10,16,0.08) 38%, rgba(8,10,16,0.78) 80%, #080A10 100%)'
              }}
            />
          </div>

          {/* Top Navigation Bar */}
          <div className="relative z-20 flex items-center justify-between gap-2 max-w-4xl md:max-w-6xl mx-auto">
            <button
              type="button"
              onClick={onClose}
              aria-label="Go back"
              className="w-10 h-10 rounded-full bg-black/45 hover:bg-black/65 border border-white/15 flex items-center justify-center text-white active:scale-95 transition-transform cursor-pointer backdrop-blur-xl"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 relative">
              <button
                type="button"
                onClick={() => setShowSearchBar(v => !v)}
                aria-label="Search artist catalog"
                className={`hidden min-[385px]:flex w-10 h-10 rounded-full border items-center justify-center active:scale-95 transition-all cursor-pointer backdrop-blur-xl ${
                  showSearchBar
                    ? 'bg-white text-black border-white'
                    : 'bg-black/45 hover:bg-black/65 border-white/15 text-white'
                }`}
              >
                <Search className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleShareArtist}
                aria-label={`Share ${artistName}`}
                className="hidden min-[375px]:flex h-10 px-4 rounded-full bg-white text-black font-bold text-xs items-center gap-1.5 shadow-md active:scale-95 transition-transform cursor-pointer"
              >
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={() => setShowHeaderMoreMenu(v => !v)}
                aria-label="More artist options"
                className="w-10 h-10 rounded-full bg-black/45 hover:bg-black/65 border border-white/15 flex items-center justify-center text-white active:scale-95 transition-transform cursor-pointer backdrop-blur-xl"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {/* Compact Overflow Menu */}
              {showHeaderMoreMenu && (
                <div className="absolute right-0 top-12 w-52 rounded-2xl bg-[#141722] border border-white/15 shadow-2xl py-1.5 z-50">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSearchBar(v => !v);
                      setShowHeaderMoreMenu(false);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-white/90 hover:bg-white/10 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Search className="w-4 h-4 text-white/60" />
                    <span>{showSearchBar ? 'Hide Catalog Search' : 'Search Catalog'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleTogglePin();
                      setShowHeaderMoreMenu(false);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-white/90 hover:bg-white/10 flex items-center gap-2.5 cursor-pointer"
                  >
                    {isPinned ? <BookmarkCheck className="w-4 h-4 text-emerald-400" /> : <Bookmark className="w-4 h-4 text-white/60" />}
                    <span>{isPinned ? 'Unpin Discography' : 'Pin Discography'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleShareArtist();
                      setShowHeaderMoreMenu(false);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-white/90 hover:bg-white/10 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Share2 className="w-4 h-4 text-white/60" />
                    <span>Share Artist</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowHeaderMoreMenu(false);
                      loadArtist(true);
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-white/90 hover:bg-white/10 flex items-center gap-2.5 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4 text-white/60" />
                    <span>Refresh Discography</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Hero Identity Block */}
          <div className="relative z-10 max-w-4xl md:max-w-6xl mx-auto mt-20 sm:mt-24 md:mt-16 md:flex md:items-end md:gap-7">
            {/* Desktop Liquid Glass Artist Portrait Medallion */}
            {portraitUrl && (
              <div
                className="hidden md:block w-36 h-36 lg:w-44 lg:h-44 rounded-[28px] overflow-hidden flex-shrink-0 border border-white/20 shadow-2xl"
                style={{
                  boxShadow: `0 24px 50px rgba(0,0,0,0.65), 0 0 40px -10px ${withAlpha(accent, 0.45)}`
                }}
              >
                <img
                  src={portraitUrl}
                  alt={artistName}
                  className="w-full h-full object-cover object-top"
                />
              </div>
            )}

            <div className="space-y-2.5 min-w-0 flex-1">
              {/* Fallback Portrait Avatar only when no hero banner portrait exists */}
              {!portraitUrl && (
                <div className="w-20 h-20 md:w-28 md:h-28 rounded-3xl bg-white/[0.06] border border-white/15 flex items-center justify-center shadow-xl mb-2">
                  <Disc3 className="w-9 h-9 text-white/40" />
                </div>
              )}

              {/* Single Source-Backed Verified Badge */}
              {meta?.verifiedBySource && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 border border-white/15 text-[11px] font-semibold text-white/90 backdrop-blur-md">
                  <BadgeCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent }} />
                  <span>Verified Artist</span>
                </div>
              )}

              <h1 className="text-[28px] sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-[1.06] text-white break-words line-clamp-2 drop-shadow-[0_4px_20px_rgba(0,0,0,0.75)]">
                {artistName}
              </h1>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs md:text-sm text-white/65 font-medium">
                {statsSummaryParts.length > 0 ? (
                  <span>{statsSummaryParts.join(' • ')}</span>
                ) : (
                  <span>{meta?.monthlyAudienceText || 'Artist Discography'}</span>
                )}
                {meta?.monthlyAudienceText && statsSummaryParts.length > 0 && (
                  <>
                    <span className="text-white/30">•</span>
                    <span className="text-white/55">{meta.monthlyAudienceText}</span>
                  </>
                )}
              </div>

              {/* Primary Controls Row: Play, Shuffle, Pin Discography */}
              <div className="flex items-center gap-2.5 pt-2 md:pt-3">
                <button
                  type="button"
                  onClick={() => handlePlayAll(false)}
                  disabled={isLoading || filteredRankedEntries.length === 0}
                  className="flex-1 sm:flex-none sm:min-w-[136px] h-11 px-6 rounded-full font-bold text-sm flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform cursor-pointer disabled:opacity-40"
                  style={{ backgroundColor: accent, color: '#05070B' }}
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Play</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePlayAll(true)}
                  disabled={isLoading || filteredRankedEntries.length === 0}
                  className="flex-1 sm:flex-none sm:min-w-[136px] h-11 px-6 rounded-full bg-white/[0.1] hover:bg-white/[0.16] border border-white/15 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform cursor-pointer disabled:opacity-40 backdrop-blur-md"
                >
                  <Shuffle className="w-4 h-4" />
                  <span>Shuffle</span>
                </button>

                <button
                  type="button"
                  onClick={handleTogglePin}
                  aria-label={isPinned ? 'Unpin discography' : 'Pin discography'}
                  title={isPinned ? 'Pinned to Library' : 'Pin discography'}
                  className={`h-11 px-3.5 md:px-4 rounded-full border flex items-center justify-center gap-2 flex-shrink-0 active:scale-95 transition-all cursor-pointer backdrop-blur-md ${
                    isPinned
                      ? 'bg-white/20 border-white/35 text-white'
                      : 'bg-white/[0.08] hover:bg-white/[0.14] border-white/15 text-white/80'
                  }`}
                >
                  {isPinned ? <BookmarkCheck className="w-4 h-4" style={{ color: accent }} /> : <Bookmark className="w-4 h-4" />}
                  <span className="hidden md:inline text-xs font-semibold">{isPinned ? 'Pinned' : 'Pin Artist'}</span>
                </button>
              </div>

              {/* Expandable Inline Search */}
              {showSearchBar && (
                <div className="pt-2 max-w-md">
                  <div className="relative">
                    <Search className="w-4 h-4 text-white/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={discographyQuery}
                      onChange={(e) => setDiscographyQuery(e.target.value)}
                      placeholder={`Search ${artistName} songs & albums...`}
                      className="w-full h-10 pl-10 pr-9 rounded-full bg-white/[0.08] border border-white/15 text-xs text-white placeholder-white/45 focus:outline-none focus:border-white/35 backdrop-blur-md"
                      autoFocus
                    />
                    {discographyQuery && (
                      <button
                        type="button"
                        onClick={() => setDiscographyQuery('')}
                        aria-label="Clear search"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* =============================================================== */}
        {/* MAIN CONTENT CONTAINER                                          */}
        {/* =============================================================== */}
        <div className="max-w-4xl md:max-w-6xl mx-auto px-4 md:px-10 space-y-7 md:space-y-9">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-white/60">
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: accent }} />
              <p className="text-xs font-medium">Loading artist discography...</p>
            </div>
          ) : loadError && rankedEntries.length === 0 && albums.length === 0 && singles.length === 0 ? (
            <div className="p-6 rounded-3xl bg-white/[0.04] border border-white/10 text-center space-y-3">
              <AlertCircle className="w-8 h-8 mx-auto text-white/40" />
              <p className="text-sm font-semibold text-white/80">{loadError}</p>
              <button
                type="button"
                onClick={() => loadArtist(true)}
                className="px-4 py-2 rounded-full bg-white text-black text-xs font-bold active:scale-95 transition-transform cursor-pointer"
              >
                Try Again
              </button>
            </div>
          ) : (
            <>
              {/* ========================================================= */}
              {/* 1. POPULAR SONGS (Clean heading on both mobile & desktop) */}
              {/* ========================================================= */}
              {rankedEntries.length > 0 && (
                <section className="space-y-2.5" aria-label="Popular Songs">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base sm:text-xl font-extrabold text-white tracking-tight truncate">
                      Popular Songs
                    </h2>
                  </div>

                  {/* First 5 Tracks (or full list when "See all" expanded) */}
                  <div className="space-y-1">
                    {visibleRankedEntries.map((entry) => {
                      const isCurrent =
                        currentTrack &&
                        (currentTrack.id === entry.id ||
                          (currentTrack.title?.toLowerCase() === entry.title.toLowerCase() &&
                            currentTrack.artist?.toLowerCase().includes(artistName.toLowerCase())));
                      const unavailable = entry.isPlayable === false;
                      const playableTrack = rankedEntryToPlayableTrack(entry);

                      return (
                        <div
                          key={entry.id}
                          onClick={() => handlePlayRankedEntry(entry)}
                          className={`group relative flex items-center gap-3 px-2.5 py-2 rounded-2xl transition-colors ${
                            unavailable
                              ? 'opacity-50 cursor-not-allowed'
                              : isCurrent
                                ? 'bg-white/[0.11] cursor-pointer'
                                : 'hover:bg-white/[0.06] active:bg-white/[0.09] cursor-pointer'
                          }`}
                        >
                          {/* Rank Number — strictly omitted when catalog-only! */}
                          {meta?.isRanked && entry.displayRank !== null && (
                            <span
                              className="w-5 text-center text-xs font-bold tabular-nums flex-shrink-0"
                              style={{ color: isCurrent ? accent : 'rgba(255,255,255,0.48)' }}
                            >
                              {entry.displayRank}
                            </span>
                          )}

                          {/* Small Curved Cover */}
                          <div className="w-11 h-11 rounded-xl overflow-hidden bg-white/[0.06] flex-shrink-0 relative">
                            <CoverImage
                              src={entry.artworkUrl || portraitUrl}
                              alt={entry.title}
                              title={entry.title}
                              artist={entry.artist}
                              size={88}
                              className="w-full h-full object-cover"
                            />
                            {isCurrent && isPlaying && (
                              <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                <Pause className="w-4 h-4 text-white fill-white" />
                              </div>
                            )}
                          </div>

                          {/* Title + Play Count / Artist Subtitle */}
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-[13px] font-bold truncate"
                              style={{ color: isCurrent ? accent : '#FFFFFF' }}
                            >
                              {entry.title}
                            </div>
                            <div className="text-[11px] text-white/50 truncate flex items-center gap-1.5">
                              {unavailable ? (
                                <span className="text-amber-300/80">Unavailable</span>
                              ) : (
                                <>
                                  {entry.playCountDisplay && <span>{entry.playCountDisplay}</span>}
                                  {entry.playCountDisplay && entry.artist && (
                                    <span className="text-white/25">•</span>
                                  )}
                                  <span className="truncate">{entry.artist}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Duration */}
                          <span className="text-[11px] font-mono text-white/40 flex-shrink-0 tabular-nums">
                            {formatDuration(entry.duration)}
                          </span>

                          {/* Track Context Menu Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuTrackId(prev => (prev === entry.id ? null : entry.id));
                            }}
                            aria-label={`More options for ${entry.title}`}
                            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/55 hover:text-white flex-shrink-0 cursor-pointer"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {/* Inline Track Menu */}
                          {activeMenuTrackId === entry.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-2 top-12 w-44 rounded-2xl bg-[#161925] border border-white/15 shadow-2xl py-1 z-40"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  AudioEngine.playNext(playableTrack);
                                  setActiveMenuTrackId(null);
                                  showToast('Playing next');
                                }}
                                className="w-full px-3.5 py-2 text-left text-xs text-white/90 hover:bg-white/10 flex items-center gap-2 cursor-pointer"
                              >
                                <ListStart className="w-3.5 h-3.5 text-white/60" />
                                <span>Play Next</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  AudioEngine.addToQueue(playableTrack);
                                  setActiveMenuTrackId(null);
                                  showToast('Added to Queue');
                                }}
                                className="w-full px-3.5 py-2 text-left text-xs text-white/90 hover:bg-white/10 flex items-center gap-2 cursor-pointer"
                              >
                                <ListPlus className="w-3.5 h-3.5 text-white/60" />
                                <span>Add to Queue</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuTrackId(null);
                                  setPlaylistMenuTrack(playableTrack);
                                }}
                                className="w-full px-3.5 py-2 text-left text-xs text-white/90 hover:bg-white/10 flex items-center gap-2 cursor-pointer"
                              >
                                <FolderPlus className="w-3.5 h-3.5 text-white/60" />
                                <span>Add to Playlist</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {filteredRankedEntries.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setShowAllRankedTracks(v => !v)}
                      className="text-xs font-bold text-white/75 hover:text-white px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 transition-colors cursor-pointer"
                    >
                      {showAllRankedTracks ? 'Show less' : `See all (${filteredRankedEntries.length})`}
                    </button>
                  )}
                </section>
              )}

              {/* ========================================================= */}
              {/* 2. DISCOGRAPHY SECTION (Inspired Directly by Image 3)     */}
              {/* ========================================================= */}
              <section className="space-y-3.5" aria-label="Artist Discography">
                {/* Header + Grid/List View Toggle (Image 3 layout) */}
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-extrabold text-white tracking-tight">
                    {activeDiscographyTab === 'albums'
                      ? 'Albums'
                      : activeDiscographyTab === 'singles'
                        ? 'Singles & EPs'
                        : 'Appears on'}
                  </h2>

                  <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.06] border border-white/12">
                    <button
                      type="button"
                      onClick={() => setDiscographyLayout(prev => (prev === 'grid' ? 'featured' : 'grid'))}
                      aria-label="Grid view"
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        discographyLayout === 'grid' || discographyLayout === 'featured'
                          ? 'bg-white/15 text-white'
                          : 'text-white/50 hover:text-white'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscographyLayout('list')}
                      aria-label="List view"
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        discographyLayout === 'list'
                          ? 'bg-white/15 text-white'
                          : 'text-white/50 hover:text-white'
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Category Filter Pills */}
                <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar">
                  {(
                    [
                      { key: 'albums', label: `Albums (${albums.length})` },
                      { key: 'singles', label: `Singles & EPs (${singles.length})` },
                      { key: 'appears_on', label: `Appears on (${collabs.length + appearsOnEntries.length})` }
                    ] as const
                  ).map((tab) => {
                    const active = activeDiscographyTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveDiscographyTab(tab.key)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-all cursor-pointer ${
                          active
                            ? 'text-black border-transparent shadow-sm'
                            : 'bg-white/[0.06] text-white/70 border-white/10 hover:text-white'
                        }`}
                        style={active ? { backgroundColor: accent } : undefined}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Mobile Featured Horizontal 3D Card Row (< md — untouched!) */}
                {discographyLayout === 'featured' && activeReleasePool.length > 0 && (
                  <div className="md:hidden flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x snap-mandatory no-scrollbar">
                    {activeReleasePool.slice(0, 8).map((alb) => (
                      <div
                        key={`card_${alb.id}`}
                        onClick={() => handleToggleAlbum(alb)}
                        className="snap-start flex-shrink-0 w-[132px] p-2 rounded-[20px] bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 transition-transform active:scale-[0.98] cursor-pointer"
                        style={{
                          boxShadow: '0 10px 24px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.12)'
                        }}
                      >
                        <div className="relative w-full aspect-square rounded-[14px] overflow-hidden bg-black/50 mb-2">
                          <CoverImage
                            src={alb.artworkUrl}
                            alt={alb.title}
                            title={alb.title}
                            artist={alb.artist}
                            size={240}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={(e) => handlePlayAlbum(alb, e)}
                            aria-label={`Play ${alb.title}`}
                            className="absolute right-1.5 bottom-1.5 w-8 h-8 rounded-full bg-black/70 hover:bg-black/85 border border-white/25 flex items-center justify-center text-white shadow-lg active:scale-90 transition-transform cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                          </button>
                        </div>
                        <div className="text-xs font-bold text-white truncate">{alb.title}</div>
                        <div className="text-[11px] text-white/45 truncate mt-0.5">
                          {alb.trackCount > 0 ? `${alb.trackCount} songs` : (alb.year || 'Release')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Desktop Widescreen Liquid Glass Album Grid (md+ when in featured or grid mode — zero clipped cards, zero duplicate list!) */}
                {(discographyLayout === 'featured' || discographyLayout === 'grid') && activeReleasePool.length > 0 && (
                  <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {activeReleasePool.map((alb) => {
                      const isExpanded = expandedAlbumId === alb.id;
                      return (
                        <div
                          key={`desk_grid_${alb.id}`}
                          onClick={() => handleToggleAlbum(alb)}
                          className={`group p-3 rounded-[22px] border transition-all duration-200 cursor-pointer hover:-translate-y-0.5 ${
                            isExpanded
                              ? 'bg-white/[0.12] border-white/30'
                              : 'bg-white/[0.045] hover:bg-white/[0.09] border-white/10'
                          }`}
                          style={{
                            boxShadow: isExpanded
                              ? `0 16px 34px rgba(0,0,0,0.5), 0 0 0 1px ${withAlpha(accent, 0.45)}`
                              : '0 12px 26px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)'
                          }}
                        >
                          <div className="relative w-full aspect-square rounded-[15px] overflow-hidden bg-black/50 mb-2.5">
                            <CoverImage
                              src={alb.artworkUrl}
                              alt={alb.title}
                              title={alb.title}
                              artist={alb.artist}
                              size={280}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <button
                              type="button"
                              onClick={(e) => handlePlayAlbum(alb, e)}
                              aria-label={`Play ${alb.title}`}
                              className="absolute right-2 bottom-2 w-9 h-9 rounded-full flex items-center justify-center shadow-xl opacity-95 group-hover:scale-105 active:scale-95 transition-all cursor-pointer"
                              style={{ backgroundColor: accent, color: '#05070B' }}
                            >
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </button>
                          </div>
                          <div className="text-[13px] font-bold text-white truncate">{alb.title}</div>
                          <div className="text-[11px] text-white/50 truncate mt-0.5">
                            {[alb.year, alb.trackCount > 0 ? `${alb.trackCount} songs` : null].filter(Boolean).join(' • ')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Desktop Inline Expanded Release Panel (opens cleanly below the grid when clicking an album card) */}
                {(discographyLayout === 'featured' || discographyLayout === 'grid') && expandedAlbumId && (() => {
                  const selAlb = activeReleasePool.find(a => a.id === expandedAlbumId);
                  if (!selAlb) return null;
                  const tracks = loadedAlbumTracks[selAlb.id] || [];
                  const isLoadingAlb = albumTracksLoading === selAlb.id;
                  const errAlb = albumTracksError[selAlb.id];
                  return (
                    <div className="hidden md:block rounded-3xl bg-white/[0.06] border border-white/15 p-5 space-y-4 backdrop-blur-xl shadow-2xl">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-black/50 flex-shrink-0 border border-white/15">
                            <CoverImage
                              src={selAlb.artworkUrl}
                              alt={selAlb.title}
                              title={selAlb.title}
                              artist={selAlb.artist}
                              size={128}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-base font-extrabold text-white truncate">{selAlb.title}</h3>
                            <p className="text-xs text-white/55 truncate mt-0.5">
                              {[selAlb.year, selAlb.trackCount > 0 ? `${selAlb.trackCount} songs` : null].filter(Boolean).join(' • ')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handlePlayAlbum(selAlb, e)}
                            className="px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                            style={{ backgroundColor: accent, color: '#05070B' }}
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play Release</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleSaveAlbumAsPlaylist(selAlb, e)}
                            className="px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                          >
                            {savedAlbumId === selAlb.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Plus className="w-3.5 h-3.5" />}
                            <span>{savedAlbumId === selAlb.id ? 'Saved' : 'Save as Playlist'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setAlbumForPlaylistPicker(selAlb)}
                            className="px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                          >
                            <FolderPlus className="w-3.5 h-3.5" />
                            <span>Add to Playlist</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedAlbumId(null)}
                            aria-label="Close album tracklist"
                            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isLoadingAlb ? (
                        <div className="py-6 flex items-center justify-center gap-2 text-xs text-white/55">
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: accent }} />
                          <span>Loading tracklist...</span>
                        </div>
                      ) : errAlb ? (
                        <div className="py-4 text-center text-xs text-white/45">{errAlb}</div>
                      ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                          {tracks.map((tr, ti) => (
                            <div
                              key={tr.id || ti}
                              onClick={() => onPlayTrack(tr, tracks)}
                              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.08] cursor-pointer transition-colors"
                            >
                              <span className="w-5 text-center text-xs font-mono text-white/35">{ti + 1}</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-white truncate">{tr.title}</div>
                                {tr.artist && onSelectArtist && (
                                  <div className="text-[11px] text-white/45 truncate" onClick={(e) => e.stopPropagation()}>
                                    <ArtistLinks artist={tr.artist} onSelectArtist={onSelectArtist} />
                                  </div>
                                )}
                              </div>
                              <span className="text-[11px] font-mono text-white/40">{formatDuration(tr.duration)}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  AudioEngine.addToQueue(tr);
                                  showToast('Added to Queue');
                                }}
                                aria-label={`Add ${tr.title} to queue`}
                                className="p-1.5 rounded-full text-white/45 hover:text-white hover:bg-white/10 cursor-pointer"
                              >
                                <ListPlus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPlaylistMenuTrack(tr);
                                }}
                                aria-label={`Add ${tr.title} to playlist`}
                                className="p-1.5 rounded-full text-white/45 hover:text-white hover:bg-white/10 cursor-pointer"
                              >
                                <FolderPlus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Mobile Grid View Mode (< md) */}
                {discographyLayout === 'grid' && activeReleasePool.length > 0 && (
                  <div className="md:hidden grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {activeReleasePool.map((alb) => (
                      <div
                        key={`grid_${alb.id}`}
                        onClick={() => handleToggleAlbum(alb)}
                        className="p-2.5 rounded-[20px] bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 transition-transform active:scale-[0.98] cursor-pointer"
                        style={{
                          boxShadow: '0 10px 24px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.12)'
                        }}
                      >
                        <div className="relative w-full aspect-square rounded-[14px] overflow-hidden bg-black/50 mb-2">
                          <CoverImage
                            src={alb.artworkUrl}
                            alt={alb.title}
                            title={alb.title}
                            artist={alb.artist}
                            size={260}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={(e) => handlePlayAlbum(alb, e)}
                            aria-label={`Play ${alb.title}`}
                            className="absolute right-2 bottom-2 w-8 h-8 rounded-full bg-black/70 border border-white/25 flex items-center justify-center text-white shadow-lg cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                          </button>
                        </div>
                        <div className="text-xs font-bold text-white truncate">{alb.title}</div>
                        <div className="text-[11px] text-white/45 truncate mt-0.5">
                          {[alb.year, alb.trackCount > 0 ? `${alb.trackCount} songs` : null].filter(Boolean).join(' • ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sleek Stacked Release Rows (always shown on mobile, shown on desktop ONLY in List mode!) */}
                {activeReleasePool.length > 0 && (
                  <div className={`${discographyLayout === 'list' ? 'space-y-2' : 'md:hidden space-y-2'}`}>
                    {activeReleasePool.map((alb) => {
                      const isExpanded = expandedAlbumId === alb.id;
                      const tracks = loadedAlbumTracks[alb.id] || [];
                      const isLoadingAlb = albumTracksLoading === alb.id;
                      const errAlb = albumTracksError[alb.id];

                      return (
                        <div
                          key={`row_${alb.id}`}
                          className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden"
                        >
                          <div
                            onClick={() => handleToggleAlbum(alb)}
                            className="flex items-center gap-3 p-2.5 hover:bg-white/[0.05] transition-colors cursor-pointer"
                          >
                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/50 flex-shrink-0">
                              <CoverImage
                                src={alb.artworkUrl}
                                alt={alb.title}
                                title={alb.title}
                                artist={alb.artist}
                                size={96}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-bold text-white truncate">{alb.title}</div>
                              <div className="text-[11px] text-white/50 truncate mt-0.5">
                                {[alb.year, alb.trackCount > 0 ? `${alb.trackCount} songs` : null].filter(Boolean).join(' • ')}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                type="button"
                                onClick={(e) => handlePlayAlbum(alb, e)}
                                aria-label={`Play ${alb.title}`}
                                className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.16] flex items-center justify-center text-white cursor-pointer"
                              >
                                <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                              </button>
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-white/50" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-white/40" />
                              )}
                            </div>
                          </div>

                          {/* Inline Expanded Album Tracklist */}
                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1.5 border-t border-white/10 bg-black/25 space-y-2">
                              <div className="flex flex-wrap items-center gap-2 pb-1">
                                <button
                                  type="button"
                                  onClick={(e) => handlePlayAlbum(alb, e)}
                                  className="px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                  style={{ backgroundColor: accent, color: '#05070B' }}
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>Play Release</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleSaveAlbumAsPlaylist(alb, e)}
                                  className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-semibold text-white flex items-center gap-1 cursor-pointer"
                                >
                                  {savedAlbumId === alb.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Plus className="w-3 h-3" />}
                                  <span>{savedAlbumId === alb.id ? 'Saved' : 'Save as Playlist'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAlbumForPlaylistPicker(alb)}
                                  className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-semibold text-white flex items-center gap-1 cursor-pointer"
                                >
                                  <FolderPlus className="w-3 h-3" />
                                  <span>Add to Playlist</span>
                                </button>
                              </div>

                              {isLoadingAlb ? (
                                <div className="py-4 flex items-center justify-center gap-2 text-xs text-white/50">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span>Loading tracklist...</span>
                                </div>
                              ) : errAlb ? (
                                <div className="py-3 text-center text-xs text-white/45">{errAlb}</div>
                              ) : (
                                <div className="space-y-0.5">
                                  {tracks.map((tr, ti) => (
                                    <div
                                      key={tr.id || ti}
                                      onClick={() => onPlayTrack(tr, tracks)}
                                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-white/[0.07] cursor-pointer"
                                    >
                                      <span className="w-5 text-center text-[11px] font-mono text-white/35">{ti + 1}</span>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold text-white truncate">{tr.title}</div>
                                        {tr.artist && onSelectArtist && (
                                          <div className="text-[10px] text-white/45 truncate" onClick={(e) => e.stopPropagation()}>
                                            <ArtistLinks artist={tr.artist} onSelectArtist={onSelectArtist} />
                                          </div>
                                        )}
                                      </div>
                                      <span className="text-[10px] font-mono text-white/40">{formatDuration(tr.duration)}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          AudioEngine.addToQueue(tr);
                                          showToast('Added to Queue');
                                        }}
                                        aria-label={`Add ${tr.title} to queue`}
                                        className="p-1.5 rounded-full text-white/45 hover:text-white hover:bg-white/10 cursor-pointer"
                                      >
                                        <ListPlus className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPlaylistMenuTrack(tr);
                                        }}
                                        aria-label={`Add ${tr.title} to playlist`}
                                        className="p-1.5 rounded-full text-white/45 hover:text-white hover:bg-white/10 cursor-pointer"
                                      >
                                        <FolderPlus className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Featured-Only Tracks inside "Appears on" tab */}
                {activeDiscographyTab === 'appears_on' && appearsOnEntries.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <div className="text-xs font-bold text-white/60 uppercase tracking-wider px-1">
                      Featured Tracks
                    </div>
                    {appearsOnEntries.map((entry) => {
                      const playable = rankedEntryToPlayableTrack(entry);
                      return (
                        <div
                          key={`feat_${entry.id}`}
                          onClick={() => onPlayTrack(playable, appearsOnEntries.map(rankedEntryToPlayableTrack))}
                          className="flex items-center gap-3 px-2.5 py-2 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] cursor-pointer"
                        >
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/50 flex-shrink-0">
                            <CoverImage
                              src={entry.artworkUrl}
                              alt={entry.title}
                              title={entry.title}
                              artist={entry.artist}
                              size={80}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-white truncate">{entry.title}</div>
                            <div className="text-[11px] text-white/50 truncate">{entry.artist}</div>
                          </div>
                          <span className="text-[11px] font-mono text-white/40">{formatDuration(entry.duration)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeReleasePool.length === 0 && !(activeDiscographyTab === 'appears_on' && appearsOnEntries.length > 0) && (
                  <div className="py-8 text-center text-xs text-white/40 rounded-2xl bg-white/[0.03] border border-white/10">
                    No releases found in this category.
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {/* Add Track to Playlist Sheet */}
      {playlistMenuTrack && (
        <div
          onClick={() => setPlaylistMenuTrack(null)}
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-[#141722] border border-white/15 p-4 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">Add to Playlist</div>
                <div className="text-xs text-white/50 truncate">{playlistMenuTrack.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setPlaylistMenuTrack(null)}
                aria-label="Close playlist picker"
                className="p-1.5 rounded-full text-white/60 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => handleAddTrackToPlaylist(pl.id, playlistMenuTrack)}
                  className="w-full p-2.5 rounded-2xl bg-white/[0.05] hover:bg-white/[0.11] flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="text-xs font-bold text-white truncate">{pl.name}</span>
                  <span className="text-[11px] text-white/45 flex-shrink-0 ml-2">{pl.tracks.length} tracks</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Entire Album to Playlist Sheet */}
      {albumForPlaylistPicker && (
        <div
          onClick={() => setAlbumForPlaylistPicker(null)}
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-[#141722] border border-white/15 p-4 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">Add Release to Playlist</div>
                <div className="text-xs text-white/50 truncate">{albumForPlaylistPicker.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setAlbumForPlaylistPicker(null)}
                aria-label="Close release playlist picker"
                className="p-1.5 rounded-full text-white/60 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => handleAddAlbumToPlaylist(pl.id, albumForPlaylistPicker)}
                  className="w-full p-2.5 rounded-2xl bg-white/[0.05] hover:bg-white/[0.11] flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="text-xs font-bold text-white truncate">{pl.name}</span>
                  <span className="text-[11px] text-white/45 flex-shrink-0 ml-2">{pl.tracks.length} tracks</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Feedback Toast */}
      {feedbackToast && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-white text-black text-xs font-bold shadow-2xl">
          {feedbackToast}
        </div>
      )}
    </div>
  );
};
