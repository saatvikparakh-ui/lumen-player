import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  Edit3, 
  Upload, 
  Palette, 
  Plus, 
  ListPlus,
  Music,
  Mic2, 
  Clock, 
  Disc3, 
  Check, 
  X,
  Shuffle,
  AlignLeft,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Heart,
  ListMusic,
  FolderPlus,
  FolderDown,
  SkipBack,
  SkipForward,
  BookmarkCheck,
  MoreHorizontal,
  RotateCcw,
  ListStart,
  QrCode,
  Radio,
  Repeat,
  Globe,
  Lock,
  Users,
  UserPlus,
  AlertTriangle,
  Pin
} from 'lucide-react';
import { CustomPlaylist, Track, LyricLine } from '../../types/music';
import { StreamingService } from '../../services/streamingService';
import { AudioEngine } from '../../services/audioEngine';
import { fetchUniversalLyrics } from '../../services/lyricsService';
import { PinnedDiscography, PinnedDiscographyService } from '../../services/pinnedDiscographyService';
import { LikedService } from '../../services/likedService';
import { RatingAndStatsService } from '../../services/ratingAndStatsService';
import { extractDominantColor, toAccessibleAccentColor, withAlpha } from '../../services/colorSampler';
import { useDeviceMode } from '../../hooks/useDeviceMode';
import { isTvEnvironment } from '../../hooks/useTvMode';
import { SongRatingWidget } from './SongRatingWidget';
import { ImportPlaylistModal } from './ImportPlaylistModal';
import { PlaylistCarouselModal } from './PlaylistCarouselModal';
import { AlbumModal } from './AlbumModal';
import { WatchSoundService } from '../../services/watchSoundService';
import { CoverImage } from '../common/CoverImage';
import { InitialAvatar } from '../common/InitialAvatar';
import { ArtistLinks } from '../common/ArtistLinks';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import {
  pickFeaturedMostListenedPlaylist,
  pickTopPlayedTracksOverall,
  pickTopPlayedTracksInPlaylist
} from '../../services/libraryRankingLogic';
import {
  isLikedSongsPlaylistId,
  withPinnedLikedSongs
} from '../../services/likedPlaylistHelper';
import {
  fetchItunesCover,
  getArtworkUrl,
  getVerifiedCanonicalCover,
  isSuspectArtworkUrl
} from '../../utils/artwork';
import { FirebaseAuthService } from '../../services/firebaseAuthService';
import { SocialService } from '../../services/socialService';
import { FirestoreService } from '../../services/firestoreService';

interface Props {
  playlists: CustomPlaylist[];
  activePlaylistId: string | null;
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: (name?: string) => CustomPlaylist;
  onImportPlaylist?: (playlist: CustomPlaylist) => void;
  onUpdatePlaylist: (id: string, updates: Partial<CustomPlaylist>) => void;
  onDeletePlaylist: (id: string) => void;
  onAddTrack: (playlistId: string, track: Track) => boolean;
  onRemoveTrack: (playlistId: string, trackId: string, trackIndex?: number, trackTitle?: string, trackArtist?: string) => void;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onPlayAll: (tracks: Track[]) => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  dominantColor: string;
  onClose: () => void;
  onToggleLyrics: () => void;
  onSelectArtist: (artist: string) => void;
  onOpenQueue?: () => void;
  onOpenAddToPlaylist?: (track: Track) => void;
  tasteTracks?: Track[];
  onOpenTvBeam?: () => void;
  onModalChange?: (isOpen: boolean) => void;
  initialMobileView?: 'hub' | 'detail';
}

const PRESET_GRADIENTS = [
  '#63E8FF',
  '#9A76FF',
  '#FF2E93',
  '#FF8A00',
  '#00F59B',
  '#E02424'
];

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatTotalDuration(sec: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '0m';
  const totalMins = Math.round(sec / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const PINNED_PLAYLISTS_KEY = 'lumen_pinned_playlist_ids_v1';

function loadPinnedPlaylistIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export const PlaylistView: React.FC<Props> = ({
  playlists,
  activePlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onImportPlaylist,
  onUpdatePlaylist,
  onDeletePlaylist,
  onAddTrack,
  onRemoveTrack,
  onPlayTrack,
  onPlayAll,
  currentTrack,
  isPlaying,
  dominantColor,
  onClose,
  onToggleLyrics,
  onSelectArtist,
  onOpenQueue,
  onOpenAddToPlaylist,
  tasteTracks = [],
  onOpenTvBeam,
  onModalChange,
  initialMobileView = 'hub'
}) => {
  const [likedTracksList, setLikedTracksList] = useState<Track[]>(() => LikedService.getLikedTracks());
  useEffect(() => {
    setLikedTracksList(LikedService.getLikedTracks());
    return LikedService.onLikedChange((next) => setLikedTracksList(next));
  }, []);

  const allPlaylists = React.useMemo(
    () => withPinnedLikedSongs(playlists, likedTracksList),
    [playlists, likedTracksList]
  );

  const activePlaylist = allPlaylists.find(p => p.id === activePlaylistId) || allPlaylists[0] || null;
  const isActiveLikedSongs = isLikedSongsPlaylistId(activePlaylist?.id);

  const { isPhone, isTablet } = useDeviceMode();
  const isTv = isTvEnvironment();
  const isCompactLayout = !isTv && (isPhone || isTablet);
  const [isMobilePlayerCollapsed, setIsMobilePlayerCollapsed] = useState(true);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>(() => AudioEngine.getRepeatMode());
  const [isLiked, setIsLiked] = useState(false);
  const [queueToast, setQueueToast] = useState<string | null>(null);
  const [openTrackMenuId, setOpenTrackMenuId] = useState<string | null>(null);
  const trackMenuRef = useRef<HTMLDivElement | null>(null);

  // In-Card Kinetic Lyrics State & Sync
  const [showCardLyrics, setShowCardLyrics] = useState(false);
  const [cardLyrics, setCardLyrics] = useState<LyricLine[] | null>(null);
  const [isLoadingCardLyrics, setIsLoadingCardLyrics] = useState(false);
  const lyricsCardScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!currentTrack) {
      setCardLyrics(null);
      setIsLoadingCardLyrics(false);
      return;
    }
    let isCancelled = false;
    setIsLoadingCardLyrics(true);
    fetchUniversalLyrics(currentTrack.artist, currentTrack.title, (currentTrack as any).videoId)
      .then((lyrics) => {
        if (!isCancelled) {
          setCardLyrics(lyrics);
          setIsLoadingCardLyrics(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setCardLyrics(null);
          setIsLoadingCardLyrics(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

  // Compute active lyric line index for in-card synced lyrics
  let activeCardLyricIdx = -1;
  if (cardLyrics && cardLyrics.length > 0) {
    for (let i = 0; i < cardLyrics.length; i++) {
      if (currentTime >= cardLyrics[i].time) {
        activeCardLyricIdx = i;
      } else {
        break;
      }
    }
  }

  // Smoothly center the active singing line in the in-card lyrics viewport
  useEffect(() => {
    if (showCardLyrics && activeCardLyricIdx >= 0 && lyricsCardScrollRef.current) {
      const activeEl = lyricsCardScrollRef.current.children[activeCardLyricIdx] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeCardLyricIdx, showCardLyrics]);

  const handleToggleLiked = () => {
    if (!currentTrack) return;
    LikedService.toggleLike(currentTrack);
    setIsLiked(LikedService.isLiked(currentTrack.id));
  };

  const handlePlayNextTrack = (track: Track, e?: React.MouseEvent) => {
    e?.stopPropagation();
    AudioEngine.playNext(track);
    WatchSoundService.playTick(1.2);
    setQueueToast(`"${track.title}" will play next!`);
    setTimeout(() => setQueueToast(null), 2500);
    setOpenTrackMenuId(null);
  };

  const handleAddTrackToQueue = (track: Track, e?: React.MouseEvent) => {
    e?.stopPropagation();
    AudioEngine.addToQueue(track);
    WatchSoundService.playTick(1.2);
    setQueueToast(`Added "${track.title}" to Queue!`);
    setTimeout(() => setQueueToast(null), 2500);
    setOpenTrackMenuId(null);
  };

  const handleAddPlaylistToQueue = (shuffle = false) => {
    if (!activePlaylist || activePlaylist.tracks.length === 0) return;
    AudioEngine.addTracksToQueue(activePlaylist.tracks, shuffle);
    WatchSoundService.playTick(1.2);
    setQueueToast(shuffle 
      ? `Shuffled ${activePlaylist.tracks.length} songs into Queue!` 
      : `Added ${activePlaylist.tracks.length} songs to Queue!`
    );
    setTimeout(() => setQueueToast(null), 2500);
  };

  const handlePlayNextPlaylist = () => {
    if (!activePlaylist || activePlaylist.tracks.length === 0) return;
    AudioEngine.playNext(activePlaylist.tracks);
    WatchSoundService.playTick(1.2);
    setQueueToast(`"${activePlaylist.name}" queued to play next!`);
    setTimeout(() => setQueueToast(null), 2500);
  };

  useEffect(() => {
    if (currentTrack) {
      setIsLiked(LikedService.isLiked(currentTrack.id));
    }
  }, [currentTrack]);

  useEffect(() => {
    AudioEngine.onTimeUpdate((time, dur) => {
      setCurrentTime(time);
      setDuration(dur);
    });
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    AudioEngine.seek(time);
  };

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editedDesc, setEditedDesc] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAddSuggestions, setShowAddSuggestions] = useState(true);
  const [isCarouselModalOpen, setIsCarouselModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAiPlaylistModalOpen, setIsAiPlaylistModalOpen] = useState(false);
  const [selectedAlbumModal, setSelectedAlbumModal] = useState<{
    albumTitle: string;
    artistName: string;
    coverUrl?: string | null;
  } | null>(null);

  const handleOpenAlbumModal = (albumTitle: string, artistName: string, coverUrl?: string | null) => {
    WatchSoundService.playTick(1.1);
    setSelectedAlbumModal({ albumTitle, artistName, coverUrl });
  };

  const [aiPrompt, setAiPrompt] = useState('');
  const [pinnedDiscographies, setPinnedDiscographies] = useState<PinnedDiscography[]>(() => PinnedDiscographyService.getPinned());
  const [pinnedPlaylistIds, setPinnedPlaylistIds] = useState<string[]>(() => loadPinnedPlaylistIds());
  const [isMobilePlaylistMenuOpen, setIsMobilePlaylistMenuOpen] = useState(false);
  const [isMobileAddSheetOpen, setIsMobileAddSheetOpen] = useState(false);
  const [isMobileSortSheetOpen, setIsMobileSortSheetOpen] = useState(false);
  // Two-screen Spotify-style mobile navigation: Library Hub (grid) -> Full-Screen Playlist Detail
  const [mobileSubView, setMobileSubView] = useState<'hub' | 'detail'>(() => initialMobileView);
  useEffect(() => {
    if (initialMobileView === 'detail' && activePlaylistId) {
      setMobileSubView('detail');
    }
  }, [initialMobileView, activePlaylistId]);
  // Easter Egg Carousel indices (Slide 0 = Featured Playlist / Playlist Cover; Slides 1..N = Top-Played Song Covers)
  const [hubCarouselIdx, setHubCarouselIdx] = useState(0);
  const [detailCoverIdx, setDetailCoverIdx] = useState(0);
  const [visibleTrackLimit, setVisibleTrackLimit] = useState(60);
  const hubCarouselRef = useRef<HTMLDivElement | null>(null);
  const detailCoverTouchStartX = useRef<number | null>(null);

  // Cached listening events for Featured Playlist & Top-Played Easter Egg carousels
  const listeningEventsSnapshot = React.useMemo(() => {
    try {
      const raw = localStorage.getItem('lumen_listening_events_log');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, [playlists.length, currentTrack?.id, mobileSubView]);

  const featuredEntry = React.useMemo(
    () => pickFeaturedMostListenedPlaylist(allPlaylists, listeningEventsSnapshot),
    [allPlaylists, listeningEventsSnapshot]
  );

  const hubTopPlayedTracks = React.useMemo(
    () => pickTopPlayedTracksOverall(allPlaylists, likedTracksList, listeningEventsSnapshot, 5),
    [allPlaylists, likedTracksList, listeningEventsSnapshot]
  );

  const activePlaylistTopTracks = React.useMemo(
    () => pickTopPlayedTracksInPlaylist(activePlaylist?.tracks || [], listeningEventsSnapshot, 5),
    [activePlaylist?.id, activePlaylist?.tracks?.length, listeningEventsSnapshot]
  );
  const [librarySearch, setLibrarySearch] = useState('');
  const [librarySortMode, setLibrarySortMode] = useState<'pinned' | 'az' | 'tracks' | 'recent'>('pinned');

  useEffect(() => {
    const handleOpenDetail = () => {
      setMobileSubView('detail');
    };
    window.addEventListener('lumen:open_playlist_detail', handleOpenDetail);
    return () => window.removeEventListener('lumen:open_playlist_detail', handleOpenDetail);
  }, []);

  const togglePinPlaylist = (playlistId: string) => {
    setPinnedPlaylistIds(prev => {
      const exists = prev.includes(playlistId);
      const next = exists ? prev.filter(id => id !== playlistId) : [...prev, playlistId];
      try {
        localStorage.setItem(PINNED_PLAYLISTS_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event('lumen_pinned_playlists_changed'));
      } catch {
        // Ignore storage quota errors
      }
      WatchSoundService.playTick(1.15);
      setQueueToast(exists ? 'Unpinned playlist' : 'Pinned playlist to front');
      setTimeout(() => setQueueToast(null), 2000);
      return next;
    });
  };

  // Ordered playlists: Liked Songs ALWAYS pinned first, then user-pinned playlists, then all other playlists
  const orderedPlaylists = React.useMemo(() => {
    const likedPl = allPlaylists.find(p => isLikedSongsPlaylistId(p.id));
    const userOnly = allPlaylists.filter(p => !isLikedSongsPlaylistId(p.id));
    const pinnedSet = new Set(pinnedPlaylistIds);
    const pinned = pinnedPlaylistIds
      .map(id => userOnly.find(p => p.id === id))
      .filter((p): p is CustomPlaylist => Boolean(p));
    const unpinned = userOnly.filter(p => !pinnedSet.has(p.id));
    return likedPl ? [likedPl, ...pinned, ...unpinned] : [...pinned, ...unpinned];
  }, [allPlaylists, pinnedPlaylistIds]);

  useEffect(() => {
    const handleUpdate = () => {
      setPinnedDiscographies(PinnedDiscographyService.getPinned());
    };
    window.addEventListener('lumen_pinned_discographies_changed', handleUpdate);
    return () => window.removeEventListener('lumen_pinned_discographies_changed', handleUpdate);
  }, []);
  const [isGeneratingAiPlaylist, setIsGeneratingAiPlaylist] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isPlaylistDropdownOpen, setIsPlaylistDropdownOpen] = useState(false);
  const playlistDropdownRef = useRef<HTMLDivElement | null>(null);
  const [isAddPlaylistDropdownOpen, setIsAddPlaylistDropdownOpen] = useState(false);
  const addPlaylistDropdownRef = useRef<HTMLDivElement | null>(null);
  const [suggestedSongs, setSuggestedSongs] = useState<Track[]>([]);
  const [suggestionPool, setSuggestionPool] = useState<Track[]>([]);
  const [songColors, setSongColors] = useState<Record<string, string>>({});
  const [hoveredSuggestId, setHoveredSuggestId] = useState<string | null>(null);
  const [addedConfirmId, setAddedConfirmId] = useState<string | null>(null);
  const [pendingDuplicateTrack, setPendingDuplicateTrack] = useState<Track | null>(null);
  const [bassScale, setBassScale] = useState(1);
  const [spectrumBars, setSpectrumBars] = useState<number[]>([40, 60, 80, 50, 70, 90, 60, 40]);

  // Real-time Collaborative Friends State
  const [showCollaborateModal, setShowCollaborateModal] = useState(false);
  const [availableFriends, setAvailableFriends] = useState<any[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);

  // Active track options 3-dots popup state
  const [trackMenuTarget, setTrackMenuTarget] = useState<{ track: Track; index: number } | null>(null);

  useEffect(() => {
    const isAnyOpen = Boolean(
      isCarouselModalOpen ||
      isImportModalOpen ||
      isAiPlaylistModalOpen ||
      selectedAlbumModal ||
      isMobilePlaylistMenuOpen ||
      isMobileAddSheetOpen ||
      isMobileSortSheetOpen ||
      (isCompactLayout && trackMenuTarget)
    );
    onModalChange?.(isAnyOpen);
  }, [
    isCarouselModalOpen,
    isImportModalOpen,
    isAiPlaylistModalOpen,
    selectedAlbumModal,
    isMobilePlaylistMenuOpen,
    isMobileAddSheetOpen,
    isMobileSortSheetOpen,
    isCompactLayout,
    trackMenuTarget,
    onModalChange
  ]);

  useEffect(() => {
    if (showCollaborateModal) {
      setIsLoadingFriends(true);
      // 1. Immediately read cached social friends
      const cached = SocialService.getFriends();
      if (cached && cached.length > 0) {
        setAvailableFriends(cached);
        setIsLoadingFriends(false);
      }
      // 2. Real-time subscription to authoritative Firestore friends list
      const currentUid = FirebaseAuthService.getCurrentUser()?.uid || localStorage.getItem('lumen_persistent_uid') || '';
      if (currentUid) {
        const unsub = FirestoreService.subscribeToFriends(currentUid, (friends) => {
          setAvailableFriends(friends || []);
          setIsLoadingFriends(false);
        });
        return () => unsub();
      } else {
        setIsLoadingFriends(false);
      }
    }
  }, [showCollaborateModal]);

  const handleToggleCollaborator = (friendUserId: string, friendUsername: string) => {
    if (!activePlaylist) return;
    const currentUids = activePlaylist.collaboratorUids || [];
    const currentUsernames = activePlaylist.collaboratorUsernames || [];
    const isAlready = currentUids.includes(friendUserId);

    let updatedUids: string[];
    let updatedUsernames: string[];
    if (isAlready) {
      updatedUids = currentUids.filter(u => u !== friendUserId);
      updatedUsernames = currentUsernames.filter(u => u !== friendUsername);
    } else {
      updatedUids = [...currentUids, friendUserId];
      updatedUsernames = [...currentUsernames, friendUsername];
    }

    onUpdatePlaylist(activePlaylist.id, {
      isCollaborative: updatedUids.length > 0,
      collaboratorUids: updatedUids,
      collaboratorUsernames: updatedUsernames
    });
    WatchSoundService.playTick(1.2);
  };

  // Dynamic Playlist Cover & LED Glow Sampling
  const [extractedPlaylistColor, setExtractedPlaylistColor] = useState<string | null>(null);

  useEffect(() => {
    if (!activePlaylist) return;

    // Self-healing: repair wrongly inherited playlist covers and misidentified artwork (e.g. The Neighbourhood "Afraid")
    let hasRepairs = false;
    const repairedTracks = activePlaylist.tracks.map(t => {
      let updatedTrack = { ...t };
      const art = (t.artist || '').toLowerCase();
      const tit = (t.title || '').toLowerCase();

      if (art.includes('neighbourhood') && tit.includes('afraid')) {
        const correctArt = 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/28/71/00/287100fb-5c31-0195-5343-e6b3625886d0/886443969834.jpg/1000x1000bb.jpg';
        if (updatedTrack.artworkUrl !== correctArt) {
          updatedTrack.artworkUrl = correctArt;
          updatedTrack.hasArtwork = true;
          hasRepairs = true;
        }
      }

      if (activePlaylist.coverUrl && updatedTrack.artworkUrl === activePlaylist.coverUrl) {
        updatedTrack.artworkUrl = null;
        updatedTrack.hasArtwork = false;
        hasRepairs = true;
      }

      return updatedTrack;
    });

    if (hasRepairs) {
      onUpdatePlaylist(activePlaylist.id, { tracks: repairedTracks });
    }

    const coverToSample = currentTrack?.artworkUrl || activePlaylist.coverUrl || activePlaylist.tracks.find(t => Boolean(t.artworkUrl))?.artworkUrl;
    if (coverToSample) {
      extractDominantColor(coverToSample).then(sample => {
        if (sample?.dominant) {
          setExtractedPlaylistColor(sample.dominant);
        }
      }).catch(() => {});
    } else {
      setExtractedPlaylistColor(null);
    }
  }, [activePlaylist?.id, activePlaylist?.coverUrl, activePlaylist?.tracks?.length, currentTrack?.artworkUrl]);

  // Dynamically adapt to currently playing song's artwork when playing/paused, and playlist cover when idle
  const effectiveCoverGlowColor = (currentTrack && currentTrack.artworkUrl && dominantColor)
    ? dominantColor
    : (extractedPlaylistColor || activePlaylist?.coverColor || dominantColor || '#63E8FF');

  // Dedicated real-time color extraction for the currently playing song/album
  const [playingSongColor, setPlayingSongColor] = useState<string>(() => dominantColor || '#06b6d4');

  useEffect(() => {
    if (currentTrack?.artworkUrl) {
      extractDominantColor(currentTrack.artworkUrl)
        .then(sample => {
          if (sample?.dominant) {
            setPlayingSongColor(sample.dominant);
          }
        })
        .catch(() => {
          if (dominantColor) setPlayingSongColor(dominantColor);
        });
    } else if (dominantColor) {
      setPlayingSongColor(dominantColor);
    }
  }, [currentTrack?.artworkUrl, currentTrack?.id, dominantColor]);

  const activeSongColor = playingSongColor || dominantColor || '#06b6d4';

  // In-Playlist Search & Sort
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [sortMode, setSortMode] = useState<'custom' | 'title' | 'artist' | 'duration'>('custom');
  const [, setLikedTick] = useState(0);

  // Reset progressive track limit & cover carousel slide when switching playlists or filters
  useEffect(() => {
    setVisibleTrackLimit(60);
    setDetailCoverIdx(0);
  }, [activePlaylistId, playlistSearch, sortMode]);

  // Consolidated Header Menus
  const [showQueueMenu, setShowQueueMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const queueMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (queueMenuRef.current && !queueMenuRef.current.contains(e.target as Node)) {
        setShowQueueMenu(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsScrollRef = useRef<HTMLDivElement | null>(null);

  // Audio reactive bass pulse & spectral flow for the right-side player widget (desktop/TV only)
  useEffect(() => {
    if (isCompactLayout) return;
    let animId: number;
    const freqData = new Uint8Array(32);
    const checkBass = () => {
      AudioEngine.getFrequencyData(freqData);
      const avg = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / 4;
      setBassScale(1 + (avg / 255) * 0.28);
      const bars = [
        Math.min(100, (freqData[0] / 255) * 100),
        Math.min(100, (freqData[1] / 255) * 100),
        Math.min(100, (freqData[2] / 255) * 100),
        Math.min(100, (freqData[3] / 255) * 100),
        Math.min(100, (freqData[4] / 255) * 100),
        Math.min(100, (freqData[6] / 255) * 100),
        Math.min(100, (freqData[8] / 255) * 100),
        Math.min(100, (freqData[12] / 255) * 100)
      ];
      setSpectrumBars(bars);
      animId = requestAnimationFrame(checkBass);
    };
    animId = requestAnimationFrame(checkBass);
    return () => cancelAnimationFrame(animId);
  }, [isCompactLayout]);

  // On-the-fly artwork and artist repair for currently playing track
  useEffect(() => {
    if (currentTrack && (!currentTrack.artist || currentTrack.artist === 'Unknown Artist' || !currentTrack.artworkUrl)) {
      const cleanTitle = (currentTrack.title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
      fetch(`/api/search/verified?q=${encodeURIComponent(cleanTitle)}&limit=1`)
        .then(r => r.json())
        .then(d => {
          if (d.tracks && d.tracks.length > 0) {
            const match = d.tracks[0];
            if (!currentTrack.artist || currentTrack.artist === 'Unknown Artist') {
              currentTrack.artist = match.artist;
            }
            if (!currentTrack.artworkUrl || currentTrack.artworkUrl.includes('image-cdn')) {
              currentTrack.artworkUrl = match.artworkUrl;
            }
          }
        })
        .catch(() => {});
    }
  }, [currentTrack]);

  // Fetch or sync suggested songs based on taste profile recommendations, strictly filtering out tracks already in playlist
  useEffect(() => {
    const existingIds = new Set((activePlaylist?.tracks || []).map(t => t.id));
    const existingKeys = new Set((activePlaylist?.tracks || []).map(t => `${t.title.toLowerCase()}::${(t.artist || '').toLowerCase()}`));
    const filterOut = (list: Track[]) => list.filter(t => !existingIds.has(t.id) && !existingKeys.has(`${t.title.toLowerCase()}::${(t.artist || '').toLowerCase()}`));

    if (tasteTracks && tasteTracks.length > 0) {
      const filtered = filterOut(tasteTracks);
      setSuggestedSongs(filtered.slice(0, 10));
      setSuggestionPool(filtered.slice(10));
    } else {
      StreamingService.getRecommendations().then((res) => {
        const combined = [...res.madeForYou, ...res.genreMixes];
        const filtered = filterOut(combined);
        setSuggestedSongs(filtered.slice(0, 10));
        setSuggestionPool(filtered.slice(10));
      });
    }
  }, [tasteTracks, activePlaylist?.id, activePlaylist?.tracks?.length]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (playlistDropdownRef.current && !playlistDropdownRef.current.contains(e.target as Node)) {
        setIsPlaylistDropdownOpen(false);
      }
      if (addPlaylistDropdownRef.current && !addPlaylistDropdownRef.current.contains(e.target as Node)) {
        setIsAddPlaylistDropdownOpen(false);
      }
      if (trackMenuRef.current && !trackMenuRef.current.contains(e.target as Node)) {
        setTrackMenuTarget(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  useEffect(() => {
    if (suggestedSongs.length === 0) return;

    suggestedSongs.forEach((song) => {
      if (song.artworkUrl && !songColors[song.id]) {
        extractDominantColor(song.artworkUrl).then((sample) => {
          setSongColors(prev => ({
            ...prev,
            [song.id]: sample.dominant
          }));
        });
      }
    });
  }, [suggestedSongs]);

  // Progressive Studio Album Artwork Healer & Verifier
  // Automatically repairs missing or non-original album covers in the background without UI clutter
  useEffect(() => {
    if (!activePlaylist || !activePlaylist.tracks || activePlaylist.tracks.length === 0) return;

    // Target tracks that either lack artwork or haven't been verified with authentic studio covers
    const tracksToHeal = activePlaylist.tracks.filter(t => 
      !t.artworkUrl || t.artworkUrl.trim() === '' || !(t as any).isStudioCoverVerified
    );
    if (tracksToHeal.length === 0) return;

    let isMounted = true;

    async function healMissingCovers() {
      // Chunk into batches of 6 tracks to resolve smoothly via IndexedDB cache & throttled iTunes/Saavn fallback
      const chunkSize = 6;
      for (let i = 0; i < tracksToHeal.length; i += chunkSize) {
        if (!isMounted) break;
        const chunk = tracksToHeal.slice(i, i + chunkSize);
        try {
          const healedResults = await Promise.all(
            chunk.map(async (t) => {
              if (!t.title || t.title === 'Unknown Title') return { id: t.id, url: null };
              const url = await fetchItunesCover(t.title, t.artist, t.album);
              return { id: t.id, url };
            })
          );

          if (!isMounted) break;

          const healedMap = new Map<string, string>();
          for (const h of healedResults) {
            if (h.url) healedMap.set(h.id, h.url);
          }

          if (healedMap.size > 0 && isMounted) {
            let hasChanges = false;
            const updatedTracks = activePlaylist!.tracks.map(t => {
              if (healedMap.has(t.id)) {
                const freshUrl = healedMap.get(t.id)!;
                if (freshUrl !== t.artworkUrl || !(t as any).isStudioCoverVerified) {
                  hasChanges = true;
                  return { ...t, artworkUrl: freshUrl, hasArtwork: true, isStudioCoverVerified: true };
                }
              }
              return t;
            });
            if (hasChanges) {
              onUpdatePlaylist(activePlaylist!.id, { tracks: updatedTracks });
            }
          }
        } catch (err) {
          console.warn('[PlaylistHealer] Background heal paused:', err);
        }
        // Polite delay between batches
        await new Promise(r => setTimeout(r, 350));
      }
    }

    const timer = setTimeout(() => {
      healMissingCovers();
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [activePlaylist?.id, activePlaylist?.tracks?.length]);

  const getTrackProminentColor = (song: Track): string => {
    if (songColors[song.id]) return songColors[song.id];
    const colors = ['#63E8FF', '#9A76FF', '#FF2E93', '#FF8A00', '#00F59B', '#38BDF8'];
    let hash = 0;
    const str = song.title + song.artist;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const handleStartEditTitle = () => {
    if (!activePlaylist) return;
    setEditedTitle(activePlaylist.name);
    setIsEditingTitle(true);
  };

  const handleSaveTitle = () => {
    if (!activePlaylist) return;
    if (editedTitle.trim()) {
      onUpdatePlaylist(activePlaylist.id, { name: editedTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleStartEditDesc = () => {
    if (!activePlaylist) return;
    setEditedDesc(activePlaylist.description || '');
    setIsEditingDesc(true);
  };

  const handleSaveDesc = () => {
    if (!activePlaylist) return;
    onUpdatePlaylist(activePlaylist.id, { description: editedDesc.trim() });
    setIsEditingDesc(false);
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activePlaylist) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      onUpdatePlaylist(activePlaylist.id, { coverUrl: dataUrl });
      extractDominantColor(dataUrl).then(sample => {
        onUpdatePlaylist(activePlaylist.id, { coverColor: sample.dominant });
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSetCoverColor = (color: string) => {
    if (!activePlaylist) return;
    onUpdatePlaylist(activePlaylist.id, { coverColor: color });
    setShowColorPicker(false);
  };

  const handleCreateNewPlaylist = () => {
    const newPl = onCreatePlaylist();
    onSelectPlaylist(newPl.id);
    setShowAddSuggestions(true);
    setMobileSubView('detail');
  };

  const handleDuplicatePlaylist = () => {
    if (!activePlaylist) return;
    const newPl = onCreatePlaylist(`${activePlaylist.name} (Copy)`);
    activePlaylist.tracks.forEach(t => onAddTrack(newPl.id, t));
    onSelectPlaylist(newPl.id);
  };

  const handleGenerateAiPlaylist = async (customPrompt?: string) => {
    const finalPrompt = customPrompt || aiPrompt.trim();
    if (!finalPrompt) return;
    setIsGeneratingAiPlaylist(true);
    setAiError(null);
    try {
      const res = await fetch('/api/recommendations/generate-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          targetDuration: 2400
        })
      });
      const data = await res.json();
      if (res.ok && data.success && data.playlist) {
        const { title, description, tracks } = data.playlist;
        const newPl = onCreatePlaylist(title);
        onUpdatePlaylist(newPl.id, { description });
        if (Array.isArray(tracks)) {
          tracks.forEach((t: Track) => onAddTrack(newPl.id, t));
        }
        onSelectPlaylist(newPl.id);
        setIsAiPlaylistModalOpen(false);
        setAiPrompt('');
      } else {
        setAiError(data.error || 'Failed to generate playlist');
      }
    } catch (_) {
      setAiError('Network error while generating playlist');
    } finally {
      setIsGeneratingAiPlaylist(false);
    }
  };

  const handleAddTrackToCurrent = (track: Track, force = false) => {
    if (!activePlaylist) return;
    const isDuplicate = !force && activePlaylist.tracks.some(
      t => t.id === track.id || (t.title.toLowerCase() === track.title.toLowerCase() && (t.artist || '').toLowerCase() === (track.artist || '').toLowerCase())
    );
    if (isDuplicate) {
      setPendingDuplicateTrack(track);
      return;
    }
    const added = onAddTrack(activePlaylist.id, track);
    if (added) {
      setAddedConfirmId(track.id);
      setTimeout(() => setAddedConfirmId(null), 1200);

      // User requested: "when a song is added, remove it from the horizontal selection bar and add a new suggested song"
      setSuggestedSongs(prev => {
        const remaining = prev.filter(t => t.id !== track.id);
        
        let nextSong: Track | null = null;
        let nextPool = [...suggestionPool];
        while (nextPool.length > 0) {
          const candidate = nextPool.shift()!;
          const inRemaining = remaining.some(rt => rt.id === candidate.id);
          if (!inRemaining) {
            nextSong = candidate;
            break;
          }
        }
        setSuggestionPool(nextPool);

        // If pool is running low, replenish in background
        if (nextPool.length < 5) {
          StreamingService.getRecommendations(true).then(res => {
            const more = [...res.madeForYou, ...res.genreMixes];
            setSuggestionPool(sp => [...sp, ...more]);
          });
        }

        return nextSong ? [...remaining, nextSong] : remaining;
      });
    }
  };

  const handleToggleLikeTrack = (track: Track) => {
    LikedService.toggleLike(track);
    setLikedTick(t => t + 1);
  };

  const avgLeftFlow = (spectrumBars[0] + spectrumBars[1] + spectrumBars[2] + spectrumBars[3]) / 4;
  const avgRightFlow = (spectrumBars[4] + spectrumBars[5] + spectrumBars[6] + spectrumBars[7]) / 4;

  const handleShufflePlay = () => {
    if (!activePlaylist || activePlaylist.tracks.length === 0) return;
    const shuffled = [...activePlaylist.tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    AudioEngine.setShuffle(true);
    onPlayAll(shuffled);
  };

  // Reorder Tracks in Custom Order Mode
  const handleMoveTrack = (index: number, direction: 'up' | 'down') => {
    if (!activePlaylist) return;
    const tracks = [...activePlaylist.tracks];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= tracks.length) return;

    const [moved] = tracks.splice(index, 1);
    tracks.splice(target, 0, moved);
    onUpdatePlaylist(activePlaylist.id, { tracks });
  };

  const scrollSuggestions = (offset: number) => {
    if (suggestionsScrollRef.current) {
      suggestionsScrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  // Filtered & Sorted Tracks
  let displayedTracks = activePlaylist ? [...activePlaylist.tracks] : [];
  if (playlistSearch.trim()) {
    const q = playlistSearch.toLowerCase();
    displayedTracks = displayedTracks.filter(t => 
      t.title.toLowerCase().includes(q) || 
      t.artist.toLowerCase().includes(q) ||
      (t.album && t.album.toLowerCase().includes(q))
    );
  }

  if (sortMode === 'title') {
    displayedTracks.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode === 'artist') {
    displayedTracks.sort((a, b) => a.artist.localeCompare(b.artist));
  } else if (sortMode === 'duration') {
    displayedTracks.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }

  const totalDurationSec = (activePlaylist?.tracks || []).reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalMinutes = Math.round(totalDurationSec / 60);

  // Reliably resolve currently playing song artwork for seamless Library & Playlist backdrop
  const [healedPlayingBackdrop, setHealedPlayingBackdrop] = useState<string | null>(null);
  const [backdropLoadFailed, setBackdropLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBackdropLoadFailed(false);
    if (!currentTrack) {
      setHealedPlayingBackdrop(null);
      return;
    }
    const canonical = getVerifiedCanonicalCover(currentTrack.title, currentTrack.artist, currentTrack.album, 600);
    if (canonical) {
      setHealedPlayingBackdrop(canonical);
      return;
    }
    const direct = getArtworkUrl(currentTrack.artworkUrl, 600);
    if (direct && !isSuspectArtworkUrl(direct)) {
      setHealedPlayingBackdrop(direct);
      return;
    }
    setHealedPlayingBackdrop(direct || null);
    if (currentTrack.title && currentTrack.artist && currentTrack.title !== 'Unknown Title') {
      fetchItunesCover(currentTrack.title, currentTrack.artist, currentTrack.album)
        .then((url) => {
          if (!cancelled && url) {
            setHealedPlayingBackdrop(url);
            setBackdropLoadFailed(false);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.artworkUrl, currentTrack?.title, currentTrack?.artist, currentTrack?.album]);

  const safePlaylistCover =
    activePlaylist?.coverUrl &&
    activePlaylist.coverUrl !== 'mosaic' &&
    activePlaylist.coverUrl !== 'emoji'
      ? activePlaylist.coverUrl
      : null;
  const firstTrackArt = activePlaylist?.tracks?.find((t) => Boolean(t.artworkUrl))?.artworkUrl || null;
  const backdropArt = (!backdropLoadFailed ? healedPlayingBackdrop : null) || safePlaylistCover || firstTrackArt;

  const sortLabel =
    sortMode === 'custom'
      ? 'Custom Order'
      : sortMode === 'title'
        ? 'Title'
        : sortMode === 'artist'
          ? 'Artist'
          : 'Duration';

  const isActivePlaylistPinned = activePlaylist ? pinnedPlaylistIds.includes(activePlaylist.id) : false;
  const playAllColor = toAccessibleAccentColor(
    (currentTrack?.artworkUrl ? activeSongColor : effectiveCoverGlowColor) || '#63E8FF'
  );

  // Filtered & sorted playlists for the Mobile Library Hub (Screen 1)
  // Always keeps "Liked Songs" pinned at the top unless excluded by search filter
  const filteredLibraryPlaylists = React.useMemo(() => {
    let list = [...orderedPlaylists];
    if (librarySearch.trim()) {
      const q = librarySearch.toLowerCase();
      list = list.filter(pl => pl.name.toLowerCase().includes(q));
    }
    const likedPl = list.find(pl => isLikedSongsPlaylistId(pl.id));
    const rest = list.filter(pl => !isLikedSongsPlaylistId(pl.id));
    if (librarySortMode === 'az') {
      rest.sort((a, b) => a.name.localeCompare(b.name));
    } else if (librarySortMode === 'tracks') {
      rest.sort((a, b) => (b.tracks?.length || 0) - (a.tracks?.length || 0));
    } else if (librarySortMode === 'recent') {
      rest.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    return likedPl ? [likedPl, ...rest] : rest;
  }, [orderedPlaylists, librarySearch, librarySortMode]);

  const isViewingActivePlayingPlaylist = Boolean(
    activePlaylist &&
      currentTrack &&
      isPlaying &&
      activePlaylist.tracks.some(
        t => t.id === currentTrack.id || (t.title === currentTrack.title && t.artist === currentTrack.artist)
      )
  );

  return (
    <div
      className={
        isCompactLayout
          ? `fixed inset-0 ${isImportModalOpen ? 'z-[75]' : 'z-40'} bg-[#080A10] flex flex-col select-none animate-fadeIn overflow-hidden`
          : `fixed inset-0 ${isImportModalOpen ? 'z-[75]' : 'z-40'} bg-[#080A10]/95 backdrop-blur-3xl flex flex-col pt-[calc(max(env(safe-area-inset-top,0px),16px)+46px)] px-3 pb-[calc(76px+env(safe-area-inset-bottom))] sm:px-8 sm:pb-8 sm:pt-20 select-none animate-fadeIn overflow-hidden`
      }
    >
      {/* Vivid, Seamless Full-Screen Artwork Backdrop (driven by currently playing song artwork across ENTIRE Library Hub & Playlist Detail!) */}
      {backdropArt && (
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <img
            src={backdropArt}
            alt=""
            onError={() => {
              if (currentTrack?.title && currentTrack?.artist && !backdropLoadFailed) {
                fetchItunesCover(currentTrack.title, currentTrack.artist, currentTrack.album)
                  .then((healed) => {
                    if (healed && healed !== backdropArt) {
                      setHealedPlayingBackdrop(healed);
                    } else {
                      setBackdropLoadFailed(true);
                    }
                  })
                  .catch(() => setBackdropLoadFailed(true));
              } else {
                setBackdropLoadFailed(true);
              }
            }}
            className={`w-full h-full object-cover filter ${isCompactLayout ? 'blur-[34px] opacity-[0.82]' : 'blur-[45px] sm:blur-[70px] opacity-60 will-change-transform'} saturate-[1.85] scale-125 transition-opacity duration-500 select-none`}
            style={
              isCompactLayout
                ? { transform: 'scale(1.22) translate3d(0, 0, 0)' }
                : {
                    transform: `scale(${1.15 + (bassScale - 1) * 0.08}) translate3d(0, 0, 0)`,
                    WebkitTransform: `scale(${1.15 + (bassScale - 1) * 0.08}) translate3d(0, 0, 0)`
                  }
            }
          />
          {/* Rich color-preserving ambient wash + gentle readability vignette (never dull, never cut off at top!) */}
          <div
            className="absolute inset-0"
            style={{
              background: isCompactLayout
                ? `linear-gradient(180deg, ${withAlpha(playAllColor, 0.14)} 0%, rgba(10,12,18,0.42) 45%, rgba(8,10,16,0.74) 100%)`
                : 'linear-gradient(to bottom, rgba(0,0,0,0.58), rgba(0,0,0,0.34), rgba(0,0,0,0.78))'
            }}
          />
        </div>
      )}

      {/* Hidden Cover Upload Input shared across mobile & desktop */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCoverUpload}
        accept="image/*"
        className="hidden"
      />

      {isCompactLayout ? (
        /* =====================================================================
           TWO-SCREEN MOBILE LIBRARY (IMAGE 1 HUB -> IMAGE 2 FULL-SCREEN DETAIL)
           GPU-optimized for 60fps across all Android devices (no nested scroll blur storms)
           ===================================================================== */
        <div className="relative z-10 flex-1 min-h-0 flex flex-col w-full max-w-[540px] mx-auto overflow-hidden">
          {mobileSubView === 'hub' || !activePlaylist ? (
            /* -----------------------------------------------------------------
               SCREEN 1: MOBILE LIBRARY HUB (Image 1 Layout + Swipeable Easter Egg)
               ----------------------------------------------------------------- */
            <div className="flex-1 min-h-0 flex flex-col px-4 pt-[max(env(safe-area-inset-top,14px),14px)] overflow-hidden">
              {/* Top Header: Lumen + Library + Queue + + Add */}
              <div className="flex items-start justify-between gap-2 pb-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-white/75 mb-0.5">
                    <Sparkles className="w-3.5 h-3.5" style={{ color: playAllColor }} />
                    <span>Lumen</span>
                  </div>
                  <h1 className="text-[27px] leading-[1.05] font-black tracking-tight text-white">
                    Library
                  </h1>
                </div>

                <div className="flex items-center gap-2 shrink-0 pt-2">
                  {onOpenQueue && (
                    <button
                      type="button"
                      onClick={() => {
                        WatchSoundService.playTick(1.0);
                        onOpenQueue();
                      }}
                      className="w-9 h-9 rounded-full bg-white/[0.12] active:scale-95 flex items-center justify-center text-white/90 shadow-[0_8px_20px_rgba(0,0,0,0.38),inset_0_1px_0.5px_rgba(255,255,255,0.26)] transition-transform"
                      aria-label="Open Play Queue"
                    >
                      <ListMusic className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.1);
                      setIsMobileAddSheetOpen(true);
                    }}
                    className="h-9 px-3.5 rounded-full active:scale-95 text-[#07090F] font-extrabold text-[13px] flex items-center gap-1 shadow-[0_6px_18px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.5)] transition-transform"
                    style={{ backgroundColor: playAllColor }}
                  >
                    <Plus className="w-4 h-4 stroke-[2.75]" />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Search Your Library Bar (Borderless Liquid Glass) */}
              <div className="shrink-0 pb-4">
                <div className="h-10 rounded-full bg-black/28 focus-within:bg-black/38 px-3.5 flex items-center gap-2 shadow-[0_8px_22px_rgba(0,0,0,0.3),inset_0_1px_0.5px_rgba(255,255,255,0.16)] transition-colors">
                  <Search className="w-4 h-4 text-white/55 shrink-0" />
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Search your library..."
                    className="w-full min-w-0 bg-transparent text-[13px] text-white placeholder-white/50 focus:outline-none"
                  />
                  {librarySearch && (
                    <button
                      type="button"
                      onClick={() => setLibrarySearch('')}
                      aria-label="Clear library search"
                      className="text-white/55 active:text-white shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Body: Featured Carousel + Playlists Grid + Pinned Discographies */}
              <div
                className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-[calc(176px+env(safe-area-inset-bottom))]"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {/* FEATURED PLAYLIST + SWIPEABLE TOP-PLAYED EASTER EGG CAROUSEL (Borderless Apple Liquid Glass) */}
                {!librarySearch.trim() && featuredEntry.playlist && (
                  <div className="mb-5">
                    <div
                      ref={hubCarouselRef}
                      onScroll={(e) => {
                        const el = e.currentTarget;
                        if (el.clientWidth > 0) {
                          const idx = Math.round(el.scrollLeft / el.clientWidth);
                          if (idx !== hubCarouselIdx) setHubCarouselIdx(idx);
                        }
                      }}
                      className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar rounded-[28px]"
                      style={{ WebkitOverflowScrolling: 'touch' }}
                    >
                      {/* Slide 0: Featured Playlist (User's Most-Listened Playlist!) */}
                      {(() => {
                        const featPl = featuredEntry.playlist!;
                        const featDur = (featPl.tracks || []).reduce((acc, t) => acc + (t.duration || 0), 0);
                        return (
                          <div
                            onClick={() => {
                              WatchSoundService.playTick(1.0);
                              onSelectPlaylist(featPl.id);
                              setPlaylistSearch('');
                              setIsEditingTitle(false);
                              setMobileSubView('detail');
                            }}
                            className="relative overflow-hidden snap-center shrink-0 w-full rounded-[28px] p-4 bg-gradient-to-br from-white/[0.15] via-white/[0.06] to-white/[0.02] flex items-center justify-between gap-3.5 cursor-pointer active:scale-[0.985] transition-transform"
                            style={{
                              boxShadow:
                                '0 20px 40px -12px rgba(0,0,0,0.62), inset 0 1px 1px rgba(255,255,255,0.28), inset 0 -1px 1.5px rgba(255,255,255,0.06)'
                            }}
                          >
                            {/* Apple Liquid Glass Specular Sheen */}
                            <div
                              className="pointer-events-none absolute inset-x-0 top-0 h-14 rounded-t-[28px]"
                              style={{
                                background:
                                  'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.02) 60%, transparent 100%)'
                              }}
                            />
                            <div className="min-w-0 flex-1 flex flex-col justify-between self-stretch py-0.5">
                              <div>
                                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/28 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/85 mb-2">
                                  <Sparkles className="w-2.5 h-2.5" style={{ color: playAllColor }} />
                                  <span>FEATURED PLAYLIST</span>
                                </div>
                                <h2 className="text-[20px] leading-tight font-black text-white break-words">
                                  {featPl.name}
                                </h2>
                                <p className="text-[11px] text-white/65 mt-1 truncate">
                                  {featPl.tracks.length} tracks • {featuredEntry.isFromListeningHistory ? 'Most listened' : formatTotalDuration(featDur)}
                                </p>
                              </div>

                              <div className="flex items-center gap-2.5 pt-3">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (featPl.tracks.length > 0) {
                                      WatchSoundService.playTick(1.15);
                                      onPlayAll(featPl.tracks);
                                    }
                                  }}
                                  aria-label={`Play ${featPl.name}`}
                                  className="w-9 h-9 rounded-full flex items-center justify-center text-[#07090F] shadow-md active:scale-90 transition-transform"
                                  style={{ backgroundColor: playAllColor }}
                                >
                                  <Play className="w-4 h-4 fill-current ml-0.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectPlaylist(featPl.id);
                                    setIsMobilePlaylistMenuOpen(true);
                                  }}
                                  aria-label={`Options for ${featPl.name}`}
                                  className="w-9 h-9 rounded-full bg-black/28 flex items-center justify-center text-white/80 active:scale-90 transition-transform"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* Curved 3D Playlist Artwork (NO LED glow, NO white border!) */}
                            <div
                              className="relative w-[114px] h-[114px] rounded-[24px] overflow-hidden shrink-0"
                              style={{
                                transform: 'perspective(650px) rotateY(-6deg) rotateX(3deg)',
                                boxShadow: '0 14px 26px -4px rgba(0,0,0,0.62)'
                              }}
                            >
                              <PlaylistArtwork
                                coverUrl={featPl.coverUrl}
                                name={featPl.name}
                                tracks={featPl.tracks}
                                size={240}
                                dominantColor={featPl.coverColor || playAllColor}
                                className="w-full h-full object-cover"
                              />
                              <div
                                className="pointer-events-none absolute inset-0 rounded-[24px]"
                                style={{
                                  background:
                                    'linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 42%, rgba(0,0,0,0.24) 100%)'
                                }}
                              />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Slides 1..N: Swipeable Easter Egg — Top-Played Songs (borderless Apple Liquid Glass) */}
                      {hubTopPlayedTracks.length > 0 && (
                        <div
                          className="relative overflow-hidden snap-center shrink-0 w-full rounded-[28px] p-3.5 bg-gradient-to-br from-white/[0.14] via-white/[0.06] to-white/[0.02] flex items-center justify-around gap-2.5"
                          style={{
                            boxShadow:
                              '0 20px 40px -12px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.26), inset 0 -1px 1.5px rgba(255,255,255,0.06)'
                          }}
                        >
                          <div
                            className="pointer-events-none absolute inset-x-0 top-0 h-12 rounded-t-[28px]"
                            style={{
                              background:
                                'linear-gradient(180deg, rgba(255,255,255,0.13) 0%, transparent 100%)'
                            }}
                          />
                          {hubTopPlayedTracks.slice(0, 3).map((tr, tIdx) => (
                            <button
                              key={`egg_hub_${tr.id}_${tIdx}`}
                              type="button"
                              onClick={() => {
                                WatchSoundService.playTick(1.15);
                                onPlayTrack(tr, hubTopPlayedTracks);
                              }}
                              aria-label={`Play ${tr.title}`}
                              className="relative w-[92px] h-[92px] rounded-[22px] overflow-hidden shrink-0 active:scale-95 transition-transform cursor-pointer group"
                              style={{
                                transform:
                                  tIdx === 0
                                    ? 'perspective(600px) rotateY(8deg) rotateZ(-2deg)'
                                    : tIdx === 2
                                      ? 'perspective(600px) rotateY(-8deg) rotateZ(2deg)'
                                      : 'perspective(600px) translateY(-2px)',
                                boxShadow: '0 12px 24px -4px rgba(0,0,0,0.62)'
                              }}
                            >
                              <CoverImage
                                src={tr.artworkUrl || null}
                                alt={tr.title}
                                title={tr.title}
                                artist={tr.artist}
                                size={200}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/15 group-active:bg-black/35 flex items-center justify-center">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center shadow-md opacity-90"
                                  style={{ backgroundColor: withAlpha(playAllColor, 0.92), color: '#07090F' }}
                                >
                                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {hubTopPlayedTracks.length > 3 && (
                        <div
                          className="relative overflow-hidden snap-center shrink-0 w-full rounded-[28px] p-3.5 bg-gradient-to-br from-white/[0.14] via-white/[0.06] to-white/[0.02] flex items-center justify-around gap-2.5"
                          style={{
                            boxShadow:
                              '0 20px 40px -12px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.26), inset 0 -1px 1.5px rgba(255,255,255,0.06)'
                          }}
                        >
                          {hubTopPlayedTracks.slice(3, 6).map((tr, tIdx) => (
                            <button
                              key={`egg_hub2_${tr.id}_${tIdx}`}
                              type="button"
                              onClick={() => {
                                WatchSoundService.playTick(1.15);
                                onPlayTrack(tr, hubTopPlayedTracks);
                              }}
                              aria-label={`Play ${tr.title}`}
                              className="relative w-[92px] h-[92px] rounded-[22px] overflow-hidden shrink-0 active:scale-95 transition-transform cursor-pointer group"
                              style={{
                                transform: 'perspective(600px) rotateX(4deg)',
                                boxShadow: '0 12px 24px -4px rgba(0,0,0,0.62)'
                              }}
                            >
                              <CoverImage
                                src={tr.artworkUrl || null}
                                alt={tr.title}
                                title={tr.title}
                                artist={tr.artist}
                                size={200}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/15 group-active:bg-black/35 flex items-center justify-center">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center shadow-md opacity-90"
                                  style={{ backgroundColor: withAlpha(playAllColor, 0.92), color: '#07090F' }}
                                >
                                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Subtle Carousel Indicator Dots */}
                    {hubTopPlayedTracks.length > 0 && (
                      <div className="flex items-center justify-center gap-1.5 mt-2.5">
                        {Array.from({ length: hubTopPlayedTracks.length > 3 ? 3 : 2 }).map((_, dIdx) => (
                          <button
                            key={dIdx}
                            type="button"
                            aria-label={`Slide ${dIdx + 1}`}
                            onClick={() => {
                              setHubCarouselIdx(dIdx);
                              if (hubCarouselRef.current) {
                                hubCarouselRef.current.scrollTo({
                                  left: dIdx * hubCarouselRef.current.clientWidth,
                                  behavior: 'smooth'
                                });
                              }
                            }}
                            className="h-1.5 rounded-full transition-all cursor-pointer"
                            style={{
                              width: hubCarouselIdx === dIdx ? '16px' : '6px',
                              backgroundColor: hubCarouselIdx === dIdx ? playAllColor : 'rgba(255,255,255,0.28)'
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* PLAYLISTS SECTION HEADER + BORDERLESS SORT PILL */}
                <div className="flex items-center justify-between pb-3.5">
                  <div className="flex items-center gap-1.5">
                    <ListMusic className="w-4 h-4 text-white/80" />
                    <h2 className="text-[17px] font-extrabold tracking-tight text-white">
                      Playlists
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.0);
                      setLibrarySortMode(prev =>
                        prev === 'pinned' ? 'az' : prev === 'az' ? 'tracks' : prev === 'tracks' ? 'recent' : 'pinned'
                      );
                    }}
                    className="h-8 px-3 rounded-full bg-white/[0.1] active:scale-95 flex items-center gap-1.5 text-[11px] font-semibold text-white/85 shadow-[0_6px_14px_rgba(0,0,0,0.3),inset_0_1px_0.5px_rgba(255,255,255,0.18)] transition-transform"
                  >
                    <ArrowUpDown className="w-3 h-3 text-white/75" />
                    <span>
                      {librarySortMode === 'pinned'
                        ? 'Custom Order'
                        : librarySortMode === 'az'
                          ? 'A–Z'
                          : librarySortMode === 'tracks'
                            ? 'Most Tracks'
                            : 'Recent'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-white/60" />
                  </button>
                </div>

                {/* Spacious 2-Column Vertical Borderless Liquid Glass Playlist Cards (Cover + Full Name Only!) */}
                {filteredLibraryPlaylists.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-12 px-4">
                    <Music className="w-10 h-10 mb-3 text-white/50" />
                    <h3 className="text-base font-black text-white">
                      {librarySearch ? 'No Matching Playlists' : 'No Playlists Yet'}
                    </h3>
                    <p className="text-xs text-white/55 mt-1 mb-4">
                      {librarySearch ? 'Try another playlist name' : 'Create a playlist or import one.'}
                    </p>
                    {!librarySearch && (
                      <button
                        type="button"
                        onClick={handleCreateNewPlaylist}
                        className="px-5 py-2.5 rounded-full text-black font-extrabold text-xs"
                        style={{ backgroundColor: playAllColor }}
                      >
                        Create First Playlist
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {filteredLibraryPlaylists.map((pl) => {
                      const isPinned = pinnedPlaylistIds.includes(pl.id);
                      const isPlayingThis = Boolean(
                        currentTrack &&
                          pl.tracks.some(
                            t => t.id === currentTrack.id || (t.title === currentTrack.title && t.artist === currentTrack.artist)
                          )
                      );

                      return (
                        <div
                          key={pl.id}
                          onClick={() => {
                            WatchSoundService.playTick(1.0);
                            onSelectPlaylist(pl.id);
                            setPlaylistSearch('');
                            setIsEditingTitle(false);
                            setMobileSubView('detail');
                          }}
                          className="relative overflow-hidden group rounded-[24px] bg-gradient-to-b from-white/[0.13] via-white/[0.06] to-white/[0.02] active:scale-[0.97] p-2.5 flex flex-col text-left transition-transform min-w-0 cursor-pointer"
                          style={{
                            boxShadow:
                              '0 16px 32px -10px rgba(0,0,0,0.58), inset 0 1px 0.75px rgba(255,255,255,0.26), inset 0 -1px 1px rgba(255,255,255,0.05)'
                          }}
                        >
                          <div
                            className="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-t-[24px]"
                            style={{
                              background:
                                'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 100%)'
                            }}
                          />

                          {/* Large Curved 3D Square Cover (Borderless!) */}
                          <div
                            className="relative aspect-square w-full rounded-[18px] overflow-hidden shrink-0"
                            style={{
                              transform: 'perspective(620px) rotateX(3deg)',
                              boxShadow: '0 12px 24px -6px rgba(0,0,0,0.65)'
                            }}
                          >
                            <PlaylistArtwork
                              coverUrl={pl.coverUrl}
                              name={pl.name}
                              tracks={pl.tracks}
                              size={300}
                              dominantColor={pl.coverColor || playAllColor}
                              className="w-full h-full object-cover"
                            />
                            <div
                              className="pointer-events-none absolute inset-0 rounded-[18px]"
                              style={{
                                background:
                                  'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 45%, rgba(0,0,0,0.22) 100%)'
                              }}
                            />
                            {isPinned && (
                              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-black/65 flex items-center justify-center">
                                <Pin className="w-2.5 h-2.5 text-white fill-white" />
                              </div>
                            )}
                          </div>

                          {/* Full Playlist Name Only (Zero Track Count, Zero Duration, Zero Cutoff!) */}
                          <div
                            className="px-1 pt-2.5 pb-0.5 text-[13.5px] font-extrabold leading-snug text-white break-words"
                            style={isPlayingThis ? { color: playAllColor } : undefined}
                          >
                            {pl.name}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* PINNED DISCOGRAPHIES AT BOTTOM OF LIBRARY HUB (Borderless Liquid Glass) */}
                {!librarySearch.trim() && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-3 px-0.5">
                      <div className="flex items-center gap-1.5">
                        <Disc3 className="w-4 h-4 text-white/80" />
                        <h3 className="text-[15px] font-extrabold text-white">
                          Pinned Discographies
                        </h3>
                      </div>
                      {pinnedDiscographies.length > 2 && (
                        <button
                          type="button"
                          onClick={() => onSelectArtist(pinnedDiscographies[0].artistName)}
                          className="text-[11px] font-semibold text-white/75 px-3 py-1 rounded-full bg-white/[0.1] shadow-[0_4px_12px_rgba(0,0,0,0.28),inset_0_1px_0.5px_rgba(255,255,255,0.18)]"
                        >
                          See All &gt;
                        </button>
                      )}
                    </div>

                    <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
                      {pinnedDiscographies.map((disc) => (
                        <button
                          key={`hub-disc-${disc.artistName}`}
                          type="button"
                          onClick={() => {
                            WatchSoundService.playTick(1.0);
                            onSelectArtist(disc.artistName);
                          }}
                          className="shrink-0 w-[124px] rounded-[22px] bg-gradient-to-b from-white/[0.12] via-white/[0.05] to-white/[0.02] active:scale-[0.97] p-2.5 flex flex-col items-center text-center transition-transform"
                          style={{
                            boxShadow: '0 12px 24px -6px rgba(0,0,0,0.48), inset 0 1px 0.5px rgba(255,255,255,0.22)'
                          }}
                        >
                          <div
                            className="relative w-[72px] h-[72px] rounded-[18px] overflow-hidden bg-[#12141E] mb-2"
                            style={{
                              transform: 'perspective(500px) rotateX(4deg)',
                              boxShadow: '0 10px 18px -4px rgba(0,0,0,0.65)'
                            }}
                          >
                            {disc.avatarUrl ? (
                              <img
                                src={disc.avatarUrl}
                                alt={disc.artistName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-white/[0.06]">
                                <Disc3 className="w-6 h-6 text-white/55" />
                              </div>
                            )}
                          </div>
                          <div className="text-[12px] font-bold text-white leading-tight break-words w-full">
                            {disc.artistName.replace(/\s*discography/i, '')}
                          </div>
                        </button>
                      ))}

                      {/* "+ Add Discography" quick card (Borderless Liquid Glass) */}
                      <button
                        type="button"
                        onClick={() => {
                          WatchSoundService.playTick(1.0);
                          setIsMobileAddSheetOpen(true);
                        }}
                        className="shrink-0 w-[108px] rounded-[22px] bg-gradient-to-b from-white/[0.1] via-white/[0.04] to-white/[0.02] active:scale-[0.97] p-2.5 flex flex-col items-center justify-center text-center gap-1.5 transition-transform"
                        style={{
                          boxShadow: '0 12px 24px -6px rgba(0,0,0,0.45), inset 0 1px 0.5px rgba(255,255,255,0.2)'
                        }}
                      >
                        <div className="w-10 h-10 rounded-full bg-white/[0.12] flex items-center justify-center text-white/85">
                          <Plus className="w-4 h-4" />
                        </div>
                        <span className="text-[11px] font-semibold text-white/70 leading-tight">
                          Add<br />Discography
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* -----------------------------------------------------------------
               SCREEN 2: FULL-SCREEN PLAYLIST DETAIL (Image 2 Layout)
               Fanned most-listened album covers behind 3D curved playlist art,
               seamless full-screen playing-song background, swipeable Easter Egg #2!
               ----------------------------------------------------------------- */
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Top Floating Navigation Bar (< Back on left, ... Three-Dots on right) */}
              <div className="shrink-0 relative z-20 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top,10px),10px)]">
                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.0);
                    setIsEditingTitle(false);
                    setMobileSubView('hub');
                  }}
                  className="w-9 h-9 rounded-full bg-black/35 active:scale-90 border border-white/20 flex items-center justify-center text-white shadow-[0_6px_16px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.28)] transition-transform"
                  aria-label="Back to Library"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.0);
                    setIsMobilePlaylistMenuOpen(true);
                  }}
                  className="w-9 h-9 rounded-full bg-black/35 active:scale-90 border border-white/20 flex items-center justify-center text-white shadow-[0_6px_16px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.28)] transition-transform"
                  aria-label="Playlist options"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>

              {/* Centered 3D Curved Cover shifted UP between top nav buttons (full 136px cover size preserved, more room for songs!) */}
              {(() => {
                const totalDetailSlides = 1 + activePlaylistTopTracks.length;
                const activeSlideTrack = detailCoverIdx > 0 ? activePlaylistTopTracks[detailCoverIdx - 1] : null;
                const fanCovers = activePlaylistTopTracks.slice(0, 4);

                return (
                  <div
                    className="shrink-0 relative z-10 flex flex-col items-center justify-center -mt-7 pb-1 px-4 select-none"
                    onTouchStart={(e) => {
                      detailCoverTouchStartX.current = e.touches[0]?.clientX ?? null;
                    }}
                    onTouchEnd={(e) => {
                      const startX = detailCoverTouchStartX.current;
                      detailCoverTouchStartX.current = null;
                      if (startX === null || totalDetailSlides <= 1) return;
                      const endX = e.changedTouches[0]?.clientX ?? startX;
                      const dx = endX - startX;
                      if (Math.abs(dx) >= 38) {
                        WatchSoundService.playTick(1.05);
                        setDetailCoverIdx(prev =>
                          dx < 0 ? (prev + 1) % totalDetailSlides : (prev - 1 + totalDetailSlides) % totalDetailSlides
                        );
                      }
                    }}
                  >
                    <div className="relative w-[270px] h-[138px] flex items-center justify-center">
                      {/* Faint Fanned Most-Listened Album Covers Behind Center Cover (Image 2!) */}
                      {fanCovers[0]?.artworkUrl && (
                        <img
                          src={fanCovers[0].artworkUrl}
                          alt=""
                          aria-hidden="true"
                          className="pointer-events-none absolute left-2 top-3 w-[94px] h-[94px] rounded-[22px] object-cover opacity-35 -rotate-[18deg] scale-95 shadow-xl"
                        />
                      )}
                      {fanCovers[1]?.artworkUrl && (
                        <img
                          src={fanCovers[1].artworkUrl}
                          alt=""
                          aria-hidden="true"
                          className="pointer-events-none absolute left-10 top-0 w-[96px] h-[96px] rounded-[22px] object-cover opacity-40 -rotate-[9deg] shadow-xl"
                        />
                      )}
                      {fanCovers[2]?.artworkUrl && (
                        <img
                          src={fanCovers[2].artworkUrl}
                          alt=""
                          aria-hidden="true"
                          className="pointer-events-none absolute right-10 top-0 w-[96px] h-[96px] rounded-[22px] object-cover opacity-40 rotate-[9deg] shadow-xl"
                        />
                      )}
                      {fanCovers[3]?.artworkUrl && (
                        <img
                          src={fanCovers[3].artworkUrl}
                          alt=""
                          aria-hidden="true"
                          className="pointer-events-none absolute right-2 top-3 w-[94px] h-[94px] rounded-[22px] object-cover opacity-35 rotate-[18deg] scale-95 shadow-xl"
                        />
                      )}

                      {/* Center Curved 3D Artwork (Slide 0 = Playlist Cover; Slides 1..N = Easter Egg Top-Played Song Cover, tap to play!) */}
                      <button
                        type="button"
                        onClick={() => {
                          if (activeSlideTrack) {
                            WatchSoundService.playTick(1.15);
                            onPlayTrack(activeSlideTrack, displayedTracks);
                          }
                        }}
                        aria-label={activeSlideTrack ? `Play ${activeSlideTrack.title}` : activePlaylist.name}
                        className="relative z-10 w-[136px] h-[136px] rounded-[28px] overflow-hidden active:scale-95 transition-transform cursor-pointer"
                        style={{
                          transform: 'perspective(680px) rotateX(4deg)',
                          boxShadow: '0 18px 34px -6px rgba(0,0,0,0.75), inset 0 1px 1px rgba(255,255,255,0.28)'
                        }}
                      >
                        {activeSlideTrack ? (
                          <>
                            <CoverImage
                              src={activeSlideTrack.artworkUrl || null}
                              alt={activeSlideTrack.title}
                              title={activeSlideTrack.title}
                              artist={activeSlideTrack.artist}
                              size={280}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute bottom-2 right-2 w-8 h-8 rounded-full flex items-center justify-center shadow-lg" style={{ backgroundColor: playAllColor, color: '#07090F' }}>
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            </div>
                          </>
                        ) : (
                          <PlaylistArtwork
                            coverUrl={activePlaylist.coverUrl}
                            name={activePlaylist.name}
                            tracks={activePlaylist.tracks}
                            size={280}
                            dominantColor={activePlaylist.coverColor || playAllColor}
                            className="w-full h-full object-cover"
                          />
                        )}
                        <div
                          className="pointer-events-none absolute inset-0 rounded-[28px]"
                          style={{
                            background:
                              'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, transparent 42%, rgba(0,0,0,0.25) 100%)'
                          }}
                        />
                      </button>
                    </div>

                    {/* Subtle tiny swipe dots only when Easter Egg slides exist */}
                    {totalDetailSlides > 1 && (
                      <div className="flex items-center justify-center gap-1 mt-1.5">
                        {Array.from({ length: totalDetailSlides }).map((_, idx) => (
                          <button
                            key={idx}
                            type="button"
                            aria-label={`Cover slide ${idx + 1}`}
                            onClick={() => setDetailCoverIdx(idx)}
                            className="h-1 rounded-full transition-all cursor-pointer"
                            style={{
                              width: detailCoverIdx === idx ? '12px' : '4px',
                              backgroundColor: detailCoverIdx === idx ? playAllColor : 'rgba(255,255,255,0.28)'
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Detail Header + Action Bar + Search/Sort + Progressive Tracklist */}
              <div className="flex-1 min-h-0 flex flex-col px-4 overflow-hidden">
                {/* Playlist Name + Edit Pencil + Metadata */}
                <div className="shrink-0 pb-1.5">
                  {isEditingTitle ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSaveTitle();
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="text"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        onBlur={handleSaveTitle}
                        className="w-full text-[18px] font-black bg-black/50 border border-white/30 rounded-xl px-3 py-1 text-white focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="submit"
                        onMouseDown={(e) => e.preventDefault()}
                        className="w-8 h-8 rounded-full text-black flex items-center justify-center shrink-0"
                        style={{ backgroundColor: playAllColor }}
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2
                        onClick={() => { if (!isActiveLikedSongs) handleStartEditTitle(); }}
                        className="text-[22px] leading-tight font-black tracking-tight text-white truncate drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]"
                      >
                        {activePlaylist.name}
                      </h2>
                      {!isActiveLikedSongs && (
                        <button
                          type="button"
                          onClick={() => {
                            WatchSoundService.playTick(1.0);
                            handleStartEditTitle();
                          }}
                          className="w-7 h-7 rounded-full bg-white/[0.12] active:scale-90 border border-white/15 flex items-center justify-center text-white/80 shrink-0"
                          aria-label="Rename playlist"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/75 font-medium flex-wrap">
                    <span>{activePlaylist.tracks.length} {activePlaylist.tracks.length === 1 ? 'track' : 'tracks'}</span>
                    <span className="text-white/35">•</span>
                    <span>{formatTotalDuration(totalDurationSec)}</span>
                    {!isActiveLikedSongs && (
                      <>
                        <span className="text-white/35">•</span>
                        <button
                          type="button"
                          onClick={() => {
                            WatchSoundService.playTick(1.0);
                            onUpdatePlaylist(activePlaylist.id, { isPublic: activePlaylist.isPublic === false });
                          }}
                          className="inline-flex items-center gap-1 font-semibold active:opacity-75"
                        >
                          {activePlaylist.isPublic !== false ? (
                            <>
                              <Globe className="w-3 h-3 text-[#63E8FF]" />
                              <span className="text-[#63E8FF]">Public</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3 h-3 text-white/60" />
                              <span className="text-white/75">Private</span>
                            </>
                          )}
                        </button>
                      </>
                    )}
                    {isActivePlaylistPinned && (
                      <>
                        <span className="text-white/35">•</span>
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#63E8FF]">
                          <Pin className="w-2.5 h-2.5 fill-[#63E8FF]" />
                          Pinned
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action Row: + Add + Shuffle on left, Dynamic Album-Color Circular Play Button on right */}
                <div className="shrink-0 flex items-center justify-between gap-2 pb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        WatchSoundService.playTick(1.05);
                        setIsCarouselModalOpen(true);
                      }}
                      className="h-9 px-3.5 rounded-full bg-white/[0.11] active:scale-95 border border-white/18 text-[12px] font-bold text-white flex items-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-transform"
                    >
                      <Plus className="w-3.5 h-3.5 text-white/90 stroke-[2.5]" />
                      <span>Add</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (activePlaylist.tracks.length === 0) return;
                        WatchSoundService.playTick(1.1);
                        handleShufflePlay();
                      }}
                      disabled={activePlaylist.tracks.length === 0}
                      className="h-9 px-3.5 rounded-full bg-white/[0.11] active:scale-95 border border-white/18 text-[12px] font-bold text-white flex items-center gap-1.5 disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-transform"
                    >
                      <Shuffle className="w-3.5 h-3.5" style={{ color: playAllColor }} />
                      <span>Shuffle</span>
                    </button>
                  </div>

                  {/* Dynamic Album-Color Circular Play/Pause Button (perfect phone proportion!) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (activePlaylist.tracks.length === 0) return;
                      WatchSoundService.playTick(1.15);
                      if (isViewingActivePlayingPlaylist) {
                        AudioEngine.togglePlay();
                      } else {
                        onPlayAll(activePlaylist.tracks);
                      }
                    }}
                    disabled={activePlaylist.tracks.length === 0}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-[#07090F] active:scale-90 disabled:opacity-40 transition-transform shrink-0"
                    style={{
                      backgroundColor: playAllColor,
                      boxShadow: '0 8px 20px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.45)'
                    }}
                    aria-label={isViewingActivePlayingPlaylist ? 'Pause playlist' : 'Play playlist'}
                  >
                    {isViewingActivePlayingPlaylist ? (
                      <Pause className="w-5 h-5 fill-[#07090F]" />
                    ) : (
                      <Play className="w-5 h-5 fill-[#07090F] ml-0.5" />
                    )}
                  </button>
                </div>

                {/* Search Tracks & Sort Bar */}
                <div className="shrink-0 flex items-center gap-2 pb-2">
                  <div className="flex-1 min-w-0 h-9 rounded-full bg-black/30 border border-white/16 px-3 flex items-center gap-1.5 focus-within:border-white/35 transition-colors">
                    <Search className="w-3.5 h-3.5 text-white/55 shrink-0" />
                    <input
                      type="text"
                      value={playlistSearch}
                      onChange={(e) => setPlaylistSearch(e.target.value)}
                      placeholder="Search tracks..."
                      className="w-full min-w-0 bg-transparent text-[12px] text-white placeholder-white/50 focus:outline-none"
                    />
                    {playlistSearch && (
                      <button
                        type="button"
                        onClick={() => setPlaylistSearch('')}
                        className="text-white/55 active:text-white shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.0);
                      setIsMobileSortSheetOpen(true);
                    }}
                    className="h-9 px-3 rounded-full bg-black/30 active:scale-95 border border-white/16 flex items-center gap-1 text-[11px] font-semibold text-white/90 shrink-0 transition-transform"
                  >
                    <ArrowUpDown className="w-3 h-3 text-white/75 shrink-0" />
                    <span className="whitespace-nowrap">{sortLabel}</span>
                    <ChevronDown className="w-3 h-3 text-white/60 shrink-0" />
                  </button>
                </div>

                {/* 60fps Progressive Scrollable Tracklist (auto-loads +60 rows on scroll so 366+ songs never lag!) */}
                <div
                  className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-[calc(176px+env(safe-area-inset-bottom))]"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (
                      visibleTrackLimit < displayedTracks.length &&
                      el.scrollHeight - el.scrollTop - el.clientHeight < 420
                    ) {
                      setVisibleTrackLimit(prev => Math.min(displayedTracks.length, prev + 60));
                    }
                  }}
                >
                  {displayedTracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
                      <div className="w-11 h-11 rounded-2xl bg-white/[0.08] border border-white/15 flex items-center justify-center mb-3">
                        <Music className="w-5 h-5 text-white/60" />
                      </div>
                      <p className="text-sm font-bold text-white/85">
                        {playlistSearch ? 'No matching tracks' : 'This playlist is empty'}
                      </p>
                      <p className="text-xs text-white/50 mt-1 mb-4">
                        {playlistSearch ? 'Try another title or artist name' : 'Tap + Add to add songs or import a playlist'}
                      </p>
                      {!playlistSearch && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setIsCarouselModalOpen(true)}
                            className="px-4 py-2 rounded-full text-black font-bold text-xs"
                            style={{ backgroundColor: playAllColor }}
                          >
                            Add Songs
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsImportModalOpen(true)}
                            className="px-4 py-2 rounded-full bg-white/10 border border-white/15 text-white font-semibold text-xs"
                          >
                            Import
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {displayedTracks.slice(0, visibleTrackLimit).map((track, idx) => {
                        const isCurrent = Boolean(
                          currentTrack &&
                            (currentTrack.id === track.id ||
                              (currentTrack.title === track.title && currentTrack.artist === track.artist))
                        );
                        const isTrackPlaying = isCurrent && isPlaying;
                        const trackIsLiked = LikedService.isLiked(track.id);

                        return (
                          <div
                            key={`${track.id}-${idx}`}
                            onClick={() => onPlayTrack(track, displayedTracks)}
                            className={`flex items-center gap-2.5 px-2 py-1.5 rounded-xl transition-colors cursor-pointer ${
                              isCurrent
                                ? 'bg-white/[0.15] border border-white/22'
                                : 'border border-transparent active:bg-white/[0.08]'
                            }`}
                            style={{ contentVisibility: 'auto', containIntrinsicSize: '54px' }}
                          >
                            {/* Clean Curved Cover (NO harsh LED glow!) */}
                            <div className="relative w-10 h-10 rounded-[11px] overflow-hidden bg-black/50 shrink-0 shadow-[0_4px_10px_rgba(0,0,0,0.45)]">
                              <CoverImage
                                src={track.artworkUrl || null}
                                alt={track.title}
                                title={track.title}
                                artist={track.artist}
                                album={track.album}
                                size={96}
                                className="w-full h-full object-cover"
                              />
                              {isTrackPlaying && (
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full animate-pulse"
                                    style={{ backgroundColor: playAllColor }}
                                  />
                                </div>
                              )}
                            </div>

                            {/* Title & Artist */}
                            <div className="min-w-0 flex-1">
                              <div
                                className={`text-[13px] leading-snug truncate ${
                                  isCurrent ? 'font-extrabold' : 'font-bold text-white'
                                }`}
                                style={isCurrent ? { color: playAllColor } : undefined}
                              >
                                {track.title}
                              </div>
                              <div className="text-[11px] leading-snug text-white/60 truncate">
                                {track.artist}
                              </div>
                            </div>

                            {/* Duration, Heart, 3-Dots */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              <span className="text-[11px] font-mono tabular-nums text-white/55 w-9 text-right">
                                {formatDuration(track.duration)}
                              </span>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  WatchSoundService.playTick(1.1);
                                  handleToggleLikeTrack(track);
                                }}
                                className="w-7 h-7 rounded-full flex items-center justify-center text-white/65 active:scale-90 transition-transform"
                                aria-label={trackIsLiked ? 'Unlike song' : 'Like song'}
                              >
                                <Heart
                                  className={`w-3.5 h-3.5 ${
                                    trackIsLiked ? 'text-rose-500 fill-rose-500' : 'text-white/65'
                                  }`}
                                />
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  WatchSoundService.playTick(1.0);
                                  setTrackMenuTarget({ track, index: idx });
                                }}
                                className="w-7 h-7 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 transition-colors"
                                aria-label="Track options"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {visibleTrackLimit < displayedTracks.length && (
                        <button
                          type="button"
                          onClick={() => setVisibleTrackLimit(prev => Math.min(displayedTracks.length, prev + 80))}
                          className="w-full py-2.5 mt-1 rounded-xl bg-white/[0.06] text-xs font-semibold text-white/70 active:bg-white/[0.12]"
                        >
                          Show more ({displayedTracks.length - visibleTrackLimit} remaining)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Mobile "+ Add" Bottom Sheet */}
          {isMobileAddSheetOpen && (
            <div
              className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md flex items-end justify-center p-3"
              onClick={() => setIsMobileAddSheetOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[460px] rounded-3xl bg-[#11131D]/95 border border-white/20 backdrop-blur-3xl p-4 pb-[calc(18px+env(safe-area-inset-bottom))] space-y-2 shadow-2xl"
              >
                <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-2" />
                <div className="px-2 pb-1 text-xs font-mono uppercase tracking-wider text-white/50 font-bold">
                  Add to Library
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileAddSheetOpen(false);
                    handleCreateNewPlaylist();
                  }}
                  className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl bg-white/[0.06] active:bg-white/[0.12] text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#63E8FF]/15 border border-[#63E8FF]/35 flex items-center justify-center text-[#63E8FF]">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">New Blank Playlist</div>
                    <div className="text-[11px] text-white/50">Start fresh and add your tracks</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileAddSheetOpen(false);
                    setIsAiPlaylistModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl bg-white/[0.06] active:bg-white/[0.12] text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-400/35 flex items-center justify-center text-pink-300">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Create with AI</div>
                    <div className="text-[11px] text-white/50">Describe any mood or vibe</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileAddSheetOpen(false);
                    setIsImportModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-2xl bg-white/[0.06] active:bg-white/[0.12] text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/35 flex items-center justify-center text-emerald-300">
                    <FolderDown className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Import Playlist</div>
                    <div className="text-[11px] text-white/50">From Spotify, Apple Music, or CSV</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Mobile Sort Bottom Sheet */}
          {isMobileSortSheetOpen && (
            <div
              className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md flex items-end justify-center p-3"
              onClick={() => setIsMobileSortSheetOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[460px] rounded-3xl bg-[#11131D]/95 border border-white/20 backdrop-blur-3xl p-4 pb-[calc(18px+env(safe-area-inset-bottom))] space-y-1.5 shadow-2xl"
              >
                <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-2" />
                <div className="px-2 pb-1 text-xs font-mono uppercase tracking-wider text-white/50 font-bold">
                  Sort Tracks
                </div>
                {(
                  [
                    { id: 'custom', label: 'Custom Order' },
                    { id: 'title', label: 'Title (A–Z)' },
                    { id: 'artist', label: 'Artist (A–Z)' },
                    { id: 'duration', label: 'Duration (Longest)' }
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.0);
                      setSortMode(opt.id);
                      setIsMobileSortSheetOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold ${
                      sortMode === opt.id
                        ? 'bg-[#63E8FF]/15 border border-[#63E8FF]/40 text-[#63E8FF]'
                        : 'bg-white/[0.04] text-white/85'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {sortMode === opt.id && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mobile Playlist Options Bottom Sheet (Pin/Unpin, Cover, Queue, Collaborate, Delete) */}
          {isMobilePlaylistMenuOpen && activePlaylist && (
            <div
              className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md flex items-end justify-center p-3"
              onClick={() => setIsMobilePlaylistMenuOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[460px] rounded-3xl bg-[#11131D]/95 border border-white/20 backdrop-blur-3xl p-4 pb-[calc(18px+env(safe-area-inset-bottom))] space-y-1.5 shadow-2xl max-h-[82vh] overflow-y-auto no-scrollbar"
              >
                <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-2" />
                <div className="px-2 pb-1.5 flex items-center gap-3 border-b border-white/10 mb-1.5">
                  <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0">
                    <PlaylistArtwork
                      coverUrl={activePlaylist.coverUrl}
                      name={activePlaylist.name}
                      tracks={activePlaylist.tracks}
                      size={100}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-white truncate">{activePlaylist.name}</div>
                    <div className="text-[11px] text-white/50">
                      {activePlaylist.tracks.length} tracks • {formatTotalDuration(totalDurationSec)}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    togglePinPlaylist(activePlaylist.id);
                    setIsMobilePlaylistMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.06] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <Pin className={`w-4 h-4 ${isActivePlaylistPinned ? 'text-[#63E8FF] fill-[#63E8FF]' : 'text-[#63E8FF]'}`} />
                  <span>{isActivePlaylistPinned ? 'Unpin Playlist' : 'Pin Playlist to Front'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMobilePlaylistMenuOpen(false);
                    setIsCarouselModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <Plus className="w-4 h-4 text-[#63E8FF]" />
                  <span>Add Songs to Playlist</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMobilePlaylistMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <Upload className="w-4 h-4 text-purple-300" />
                  <span>Change Cover Image</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handlePlayNextPlaylist();
                    setIsMobilePlaylistMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <ListStart className="w-4 h-4 text-[#63E8FF]" />
                  <span>Play Playlist Next</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleAddPlaylistToQueue(false);
                    setIsMobilePlaylistMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <ListPlus className="w-4 h-4 text-purple-300" />
                  <span>Add Playlist to Queue</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMobilePlaylistMenuOpen(false);
                    setShowCollaborateModal(true);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <Users className="w-4 h-4 text-purple-300" />
                  <span>Collaborate with Friends</span>
                </button>

                {!isActiveLikedSongs && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobilePlaylistMenuOpen(false);
                      handleStartEditTitle();
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                  >
                    <Edit3 className="w-4 h-4 text-[#63E8FF]" />
                    <span>Rename Playlist</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    handleDuplicatePlaylist();
                    setIsMobilePlaylistMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <Copy className="w-4 h-4 text-white/70" />
                  <span>Duplicate Playlist</span>
                </button>

                {!isActiveLikedSongs && (
                  <button
                    type="button"
                    onClick={() => {
                      const idToDelete = activePlaylist.id;
                      setIsMobilePlaylistMenuOpen(false);
                      setMobileSubView('hub');
                      onDeletePlaylist(idToDelete);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-rose-500/10 active:bg-rose-500/20 text-sm font-bold text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Playlist</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Mobile Track Action Bottom Sheet */}
          {trackMenuTarget && activePlaylist && (
            <div
              className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-md flex items-end justify-center p-3"
              onClick={() => setTrackMenuTarget(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[460px] rounded-3xl bg-[#11131D]/95 border border-white/20 backdrop-blur-3xl p-4 pb-[calc(18px+env(safe-area-inset-bottom))] space-y-1.5 shadow-2xl"
              >
                <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-2" />
                <div className="px-2 pb-2 flex items-center gap-3 border-b border-white/10 mb-1">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/60 shrink-0">
                    <CoverImage
                      src={trackMenuTarget.track.artworkUrl || null}
                      alt={trackMenuTarget.track.title}
                      title={trackMenuTarget.track.title}
                      artist={trackMenuTarget.track.artist}
                      size={100}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-white truncate">{trackMenuTarget.track.title}</div>
                    <div className="text-xs text-white/55 truncate">{trackMenuTarget.track.artist}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    handlePlayNextTrack(trackMenuTarget.track, e);
                    setTrackMenuTarget(null);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <ListStart className="w-4 h-4 text-[#63E8FF]" />
                  <span>Play Next</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    handleAddTrackToQueue(trackMenuTarget.track, e);
                    setTrackMenuTarget(null);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <ListPlus className="w-4 h-4 text-purple-300" />
                  <span>Add to Queue</span>
                </button>

                {onOpenAddToPlaylist && (
                  <button
                    type="button"
                    onClick={() => {
                      const t = trackMenuTarget.track;
                      setTrackMenuTarget(null);
                      onOpenAddToPlaylist(t);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                  >
                    <FolderPlus className="w-4 h-4 text-emerald-400" />
                    <span>Add to Another Playlist...</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const artistName = trackMenuTarget.track.artist;
                    setTrackMenuTarget(null);
                    onSelectArtist(artistName);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.05] active:bg-white/[0.12] text-sm font-semibold text-white"
                >
                  <Disc3 className="w-4 h-4 text-amber-300" />
                  <span>View Artist</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const targetTrack = trackMenuTarget.track;
                    const realIndex = activePlaylist.tracks.findIndex(
                      (t) =>
                        (targetTrack.id && String(t.id) === String(targetTrack.id)) ||
                        (t.title === targetTrack.title && t.artist === targetTrack.artist)
                    );
                    onRemoveTrack(
                      activePlaylist.id,
                      targetTrack.id,
                      realIndex !== -1 ? realIndex : undefined,
                      targetTrack.title,
                      targetTrack.artist
                    );
                    setTrackMenuTarget(null);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-rose-500/10 active:bg-rose-500/20 text-sm font-bold text-rose-400"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Remove from Playlist</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 3D Glass Top Bar: Navigation, Search & Controls (Desktop & TV) */}
          <div 
            className="w-full flex items-center justify-between pb-4 border-b border-white/10 mb-5 relative z-30"
          >
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <span className="text-xs font-mono uppercase tracking-widest text-white/50 font-bold hidden xl:inline">
            PLAYLISTS
          </span>
          
          <div className="flex items-center gap-2">
            {/* Pure 3D Apple VisionOS Liquid Glass Playlist Switcher with LED Glow */}
            {playlists.length > 1 && (
              <div className="relative" ref={playlistDropdownRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaylistDropdownOpen(prev => !prev);
                    WatchSoundService.playTick(1.0);
                  }}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-br from-white/[0.14] via-white/[0.05] to-white/[0.01] border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-2xl text-xs text-white transition-all shadow-md cursor-pointer ${
                    isPlaylistDropdownOpen ? 'scale-105 ring-2 ring-lumen-cyan/50' : 'hover:scale-105'
                  }`}
                  style={{
                    boxShadow: `0 10px 25px -5px rgba(0,0,0,0.8), inset 0 1px 1px 0 rgba(255,255,255,0.3), 0 0 15px -3px ${activePlaylist?.coverColor || dominantColor}40`
                  }}
                  title="Switch between your playlists"
                >
                  <ListMusic className="w-3.5 h-3.5 text-lumen-cyan" />
                  <span className="font-semibold">Switch Playlist</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-white/70 transition-transform duration-300 ${isPlaylistDropdownOpen ? 'rotate-180 text-lumen-cyan' : ''}`} />
                </button>

                {isPlaylistDropdownOpen && (
                  <div 
                    className="absolute top-full left-0 mt-3 w-72 sm:w-80 rounded-3xl bg-gradient-to-br from-white/[0.18] via-white/[0.06] to-black/95 border-t border-l border-white/50 border-r border-b border-black/80 backdrop-blur-3xl shadow-2xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
                    style={{
                      boxShadow: `0 30px 80px rgba(0,0,0,0.95), inset 0 1.5px 1.5px 0 rgba(255,255,255,0.4), inset 0 -1.5px 1.5px 0 rgba(0,0,0,0.5), 0 0 40px -5px ${activePlaylist?.coverColor || dominantColor}60`
                    }}
                  >
                    {/* Atmospheric LED Glow Halo */}
                    <div 
                      className="pointer-events-none absolute -top-12 -left-12 w-36 h-36 rounded-full blur-[45px] opacity-35"
                      style={{ backgroundColor: activePlaylist?.coverColor || dominantColor }}
                    />

                    {/* Dropdown Header */}
                    <div className="px-3 py-2 flex items-center justify-between border-b border-white/10 mb-2 relative z-10">
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-2 h-2 rounded-full" 
                          style={{ 
                            backgroundColor: activePlaylist?.coverColor || dominantColor,
                            boxShadow: `0 0 8px ${activePlaylist?.coverColor || dominantColor}`
                          }} 
                        />
                        <span className="text-[10px] font-mono uppercase tracking-wider text-white/70 font-bold">
                          YOUR PLAYLISTS
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-white/40 font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                        {playlists.length} Total
                      </span>
                    </div>

                    {/* Playlist Items */}
                    <div className="space-y-1.5 max-h-64 overflow-y-auto no-scrollbar py-0.5 relative z-10">
                      {playlists.map(pl => {
                        const isSelected = pl.id === activePlaylist?.id;
                        const coverImg = pl.coverUrl || pl.tracks.find(t => t.artworkUrl)?.artworkUrl;
                        const totalDurationMins = Math.round(pl.tracks.reduce((acc, t) => acc + (t.duration || 180), 0) / 60);

                        return (
                          <button
                            key={pl.id}
                            type="button"
                            onClick={() => {
                              WatchSoundService.playTick(1.0);
                              onSelectPlaylist(pl.id);
                              setIsPlaylistDropdownOpen(false);
                            }}
                            className={`w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-all cursor-pointer group relative ${
                              isSelected
                                ? 'bg-gradient-to-r from-white/20 via-white/10 to-transparent border border-white/30 shadow-lg scale-[1.01]'
                                : 'hover:bg-white/10 border border-transparent hover:border-white/15'
                            }`}
                          >
                            {/* 3D Mini Artwork Thumbnail */}
                            <div 
                              className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-black/60 border border-white/20 shadow-md flex items-center justify-center relative"
                              style={{
                                backgroundColor: pl.coverColor || '#121212'
                              }}
                            >
                              <PlaylistArtwork 
                                coverUrl={pl.coverUrl} 
                                name={pl.name} 
                                tracks={pl.tracks} 
                                size={80} 
                                className="w-full h-full" 
                              />
                            </div>

                            {/* Title & Metadata */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs truncate block ${isSelected ? 'font-black text-white' : 'font-semibold text-white/80 group-hover:text-white'}`}>
                                  {pl.name}
                                </span>
                                {isSelected && (
                                  <span 
                                    className="w-1.5 h-1.5 rounded-full shrink-0" 
                                    style={{ 
                                      backgroundColor: activePlaylist?.coverColor || dominantColor,
                                      boxShadow: `0 0 6px ${activePlaylist?.coverColor || dominantColor}`
                                    }}
                                  />
                                )}
                              </div>
                              <span className="text-[10px] font-mono text-white/45 block mt-0.5">
                                {pl.tracks.length} tracks • {totalDurationMins}m
                              </span>
                            </div>

                            {/* Checkmark icon for active item */}
                            {isSelected && (
                              <div 
                                className="w-5 h-5 rounded-full flex items-center justify-center text-black shrink-0 shadow-sm"
                                style={{ backgroundColor: activePlaylist?.coverColor || dominantColor }}
                              >
                                <Check className="w-3 h-3 stroke-[3]" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Bottom Pinned Discographies section inside Switch Playlist drawer */}
                    {pinnedDiscographies.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-white/10 relative z-10">
                        <div className="flex items-center gap-1.5 px-2.5 mb-1.5 text-[10px] font-mono text-white/50 uppercase tracking-wider font-bold">
                          <Disc3 className="w-3 h-3 text-amber-400" />
                          <span>Pinned Discographies</span>
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-1 py-1">
                          {pinnedDiscographies.map(item => (
                            <button
                              key={item.artistName}
                              type="button"
                              onClick={() => {
                                WatchSoundService.playTick(1.0);
                                setIsPlaylistDropdownOpen(false);
                                onSelectArtist(item.artistName);
                              }}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#141724]/95 hover:bg-[#1e2336] border border-white/20 hover:border-amber-400/70 transition-all flex-shrink-0 group cursor-pointer shadow-md"
                            >
                              <div className="w-5 h-5 rounded-full overflow-hidden bg-black/60 border border-white/20 flex-shrink-0 flex items-center justify-center">
                                {item.avatarUrl ? (
                                  <img src={item.avatarUrl} alt={item.artistName} className="w-full h-full object-cover" />
                                ) : (
                                  <Disc3 className="w-3 h-3 text-amber-300" />
                                )}
                              </div>
                              <span className="text-[11px] font-bold text-white group-hover:text-amber-200 truncate max-w-[110px]">
                                {item.artistName.replace(/\s*discography/i, '')}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Consolidated Add/New Playlist Glass Dropdown */}
            <div className="relative" ref={addPlaylistDropdownRef}>
              <button
                type="button"
                onClick={() => setIsAddPlaylistDropdownOpen(prev => !prev)}
                className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full bg-lumen-cyan text-black font-bold text-xs shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                title="Create, generate with AI, or import a playlist"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">Add Playlist</span>
                <span className="sm:hidden">Add</span>
                <ChevronDown className={`w-3 h-3 text-black/70 transition-transform ${isAddPlaylistDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isAddPlaylistDropdownOpen && (
                <div 
                  className="absolute top-full left-0 mt-2 w-64 rounded-2xl bg-neutral-900/95 border border-white/20 backdrop-blur-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150"
                  style={{
                    boxShadow: '0 20px 50px rgba(0,0,0,0.85), inset 0 1px 1px 0 rgba(255,255,255,0.2)'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      handleCreateNewPlaylist();
                      setIsAddPlaylistDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-white/90 hover:text-white hover:bg-white/10 transition-all text-left cursor-pointer"
                  >
                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white shrink-0">
                      <Plus className="w-4 h-4 text-lumen-cyan" />
                    </div>
                    <div>
                      <div className="font-bold text-white">New Blank Playlist</div>
                      <div className="text-[10px] text-white/50">Start fresh and add your tracks</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsAiPlaylistModalOpen(true);
                      setIsAddPlaylistDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-white/90 hover:text-white hover:bg-purple-500/15 transition-all text-left group cursor-pointer"
                  >
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-500/30 to-pink-500/30 border border-purple-500/40 flex items-center justify-center text-pink-300 shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-purple-200 group-hover:text-white flex items-center gap-1.5">
                        <span>Create with AI</span>
                        <span className="px-1.5 py-0.2 rounded-full bg-purple-500/30 text-[9px] font-mono font-bold text-purple-300">Smart</span>
                      </div>
                      <div className="text-[10px] text-white/50">Describe any vibe or genre mix</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsImportModalOpen(true);
                      setIsAddPlaylistDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-white/90 hover:text-white hover:bg-emerald-500/15 transition-all text-left group cursor-pointer"
                  >
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                      <FolderDown className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-emerald-300 group-hover:text-emerald-200">Import Playlist</div>
                      <div className="text-[10px] text-white/50">From Spotify, Apple Music, CSV</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pr-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {onOpenQueue && (
            <button
              onClick={onOpenQueue}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs text-white/80 hover:text-white transition-all cursor-pointer"
              title="Open Play Queue"
            >
              <ListMusic className="w-3.5 h-3.5 text-lumen-cyan" />
              <span className="hidden sm:inline">Queue</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Pinned Discographies Shelf (Desktop Only) - Crisp, Solid, High-Contrast */}
      {!isCompactLayout && pinnedDiscographies.length > 0 && (
        <div className="mb-3.5 flex-shrink-0 animate-fadeIn relative z-20">
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar pb-1">
            {pinnedDiscographies.map(item => (
              <button
                key={item.artistName}
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(1.0);
                  onSelectArtist(item.artistName);
                }}
                className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[#141724]/95 hover:bg-[#1e2336] border border-white/25 hover:border-amber-400/80 transition-all shadow-[0_4px_16px_rgba(0,0,0,0.6)] group cursor-pointer flex-shrink-0"
              >
                <div className="w-6 h-6 rounded-full overflow-hidden bg-black/80 ring-1 ring-white/30 flex-shrink-0 flex items-center justify-center">
                  {item.avatarUrl ? (
                    <img src={item.avatarUrl} alt={item.artistName} className="w-full h-full object-cover" />
                  ) : (
                    <Disc3 className="w-3.5 h-3.5 text-amber-400" />
                  )}
                </div>
                <span className="text-xs font-extrabold text-white group-hover:text-amber-300 transition-colors">
                  {item.artistName.replace(/\s*discography/i, '')}
                </span>
                <span className="text-[10px] font-mono text-amber-400/80 uppercase tracking-wider font-semibold">
                  Discography
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activePlaylist ? (
        <div className={`flex-1 flex ${isCompactLayout ? 'flex-col gap-3' : isTv ? 'flex-row gap-6' : 'flex-col lg:flex-row gap-6'} overflow-hidden`}>
          {/* TOP SPLIT PANE (COMPACT) OR LEFT PANE (DESKTOP) (APPLE VISIONOS LIQUID GLASS) */}
          <div 
            className="flex-1 min-h-0 flex flex-col overflow-hidden bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-white/[0.01] border-t border-l border-white/40 border-r border-b border-black/60 rounded-2xl sm:rounded-3xl p-3 sm:p-7 backdrop-blur-3xl shadow-2xl"
            style={{
              boxShadow: '0 30px 70px rgba(0, 0, 0, 0.8), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4)'
            }}
          >
            {/* Header: Cover, Title, Stats & Actions */}
            <div className={`flex ${isCompactLayout ? 'flex-row items-start gap-3.5 pb-3' : 'flex-col sm:flex-row items-start sm:items-end gap-5 pb-5'} border-b border-white/10 flex-shrink-0`}>
              {/* Editable Cover Art with Dynamic Dynamic Album LED Halo */}
              <div 
                className={`relative ${isCompactLayout ? 'w-20 h-20 sm:w-24 sm:h-24' : 'w-40 h-40 sm:w-48 sm:h-48'} rounded-2xl sm:rounded-3xl overflow-hidden flex-shrink-0 group cursor-pointer border shadow-2xl transition-all duration-500 hover:scale-105`}
                style={{
                  backgroundColor: effectiveCoverGlowColor,
                  borderColor: `${effectiveCoverGlowColor}80`,
                  boxShadow: `0 20px 50px -10px ${effectiveCoverGlowColor}90, 0 0 25px ${effectiveCoverGlowColor}60, inset 0 0 15px ${effectiveCoverGlowColor}40`
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <PlaylistArtwork 
                  coverUrl={activePlaylist.coverUrl} 
                  name={activePlaylist.name} 
                  tracks={activePlaylist.tracks} 
                  size={600} 
                  dominantColor={effectiveCoverGlowColor}
                  className="w-full h-full object-cover" 
                />

                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1.5 transition-opacity text-white text-xs">
                  <Upload className="w-4 h-4 mb-0.5" />
                  <span className="font-mono text-[9px] uppercase tracking-wider">Change Cover</span>
                </div>
              </div>

              {/* Title & Info */}
              <div className="flex-1 text-left min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-widest text-lumen-cyan font-bold">
                  PLAYLIST
                </span>

                {isEditingTitle ? (
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      type="text"
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                      className="text-base sm:text-2xl font-black bg-white/10 border border-white/30 rounded-xl px-2.5 py-0.5 text-white focus:outline-none w-full"
                      autoFocus
                    />
                    <button 
                      onClick={handleSaveTitle} 
                      className="p-1.5 rounded-xl bg-white text-black font-bold"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div 
                    onClick={handleStartEditTitle}
                    className="flex items-center justify-start gap-2 group cursor-pointer mt-0.5"
                  >
                    <h2 className="text-base sm:text-2xl font-black text-white tracking-tight group-hover:text-lumen-cyan transition-colors truncate">
                      {activePlaylist.name}
                    </h2>
                    <Edit3 className="w-3.5 h-3.5 text-white/40 group-hover:text-white transition-colors" />
                  </div>
                )}

                {isEditingDesc ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      value={editedDesc}
                      onChange={(e) => setEditedDesc(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveDesc()}
                      placeholder="Add an optional description..."
                      className="text-[11px] sm:text-xs bg-white/10 border border-white/30 rounded-xl px-2.5 py-0.5 text-white focus:outline-none w-full"
                      autoFocus
                    />
                    <button onClick={handleSaveDesc} className="p-1 rounded-xl bg-white text-black">
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <p 
                    onClick={handleStartEditDesc}
                    className="text-[11px] sm:text-xs text-white/60 mt-0.5 cursor-pointer hover:text-white transition-colors max-w-lg truncate line-clamp-1"
                  >
                    {activePlaylist.description || 'Click to add description...'}
                  </p>
                )}

                {/* Compact Stats Row */}
                <div className="flex items-center justify-start flex-wrap gap-2 mt-1.5 text-[11px] font-mono text-white/50">
                  <span>{activePlaylist.tracks.length} tracks</span>
                  <span>•</span>
                  <span>{totalMinutes} mins</span>
                  {activePlaylist.isCollaborative && (
                    <span className="inline-flex items-center gap-1 text-purple-300">
                      <span>•</span>
                      <Users className="w-3 h-3 text-purple-400" />
                      <span>Collab</span>
                    </span>
                  )}
                  {activePlaylist.isPublic !== false && (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <span>•</span>
                      <Globe className="w-3 h-3 text-emerald-400" />
                      <span>Public</span>
                    </span>
                  )}
                </div>

                {/* Action Buttons: Play All & Shuffle primary on mobile; Play Next & Add to Queue secondary */}
                <div className="flex items-center justify-start gap-2 mt-1.5 flex-nowrap">
                  <button
                    onClick={() => onPlayAll(displayedTracks)}
                    disabled={activePlaylist.tracks.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-black font-bold text-xs shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    style={{ backgroundColor: effectiveCoverGlowColor }}
                  >
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    <span>Play All</span>
                  </button>

                  {/* Shuffle Playback Button */}
                  <button
                    onClick={handleShufflePlay}
                    disabled={activePlaylist.tracks.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    title="Shuffle Play Playlist"
                  >
                    <Shuffle className="w-3.5 h-3.5 text-lumen-cyan" />
                    <span>Shuffle</span>
                  </button>

                  {/* One-Click Save to Library for Shared/Friend Playlists */}
                  {activePlaylist.ownerUid && activePlaylist.ownerUid !== (FirebaseAuthService.getCurrentUser()?.uid || localStorage.getItem('lumen_persistent_uid')) && (
                    <button
                      onClick={() => {
                        WatchSoundService.playTick(1.2);
                        const created = onCreatePlaylist(activePlaylist.name);
                        onUpdatePlaylist(created.id, {
                          description: `Saved from @${activePlaylist.ownerUsername || 'friend'} • ${activePlaylist.description || ''}`,
                          coverUrl: activePlaylist.coverUrl,
                          coverColor: activePlaylist.coverColor
                        });
                        activePlaylist.tracks.forEach(t => onAddTrack(created.id, t));
                        onSelectPlaylist(created.id);
                        setQueueToast('Saved to your Library!');
                        setTimeout(() => setQueueToast(null), 2500);
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-pink-500/20 hover:bg-pink-500/35 border border-pink-400/50 text-pink-200 hover:text-white font-bold text-xs shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                      title="Save this playlist to your personal Library"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-pink-400" />
                      <span>Save to Library</span>
                    </button>
                  )}

                  {/* Play Next (Queue to Front) - Desktop only, on mobile inside 3-dots */}
                  <button
                    onClick={handlePlayNextPlaylist}
                    disabled={activePlaylist.tracks.length === 0}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 cursor-pointer"
                    title="Play Entire Playlist Next in Queue"
                  >
                    <ListStart className="w-3.5 h-3.5 text-lumen-cyan" />
                    <span>Play Next</span>
                  </button>

                  {/* Add to Queue ▾ (Sleek Popup Menu) - Desktop only, on mobile inside 3-dots */}
                  <div className="hidden sm:block relative" ref={queueMenuRef}>
                    <button
                      onClick={() => setShowQueueMenu(prev => !prev)}
                      disabled={activePlaylist.tracks.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 cursor-pointer"
                      title="Queue Options"
                    >
                      <ListPlus className="w-3.5 h-3.5 text-lumen-cyan" />
                      <span>Add to Queue</span>
                      <ChevronDown className={`w-3 h-3 text-white/60 transition-transform ${showQueueMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showQueueMenu && (
                      <div className="absolute left-0 mt-2 w-48 p-1.5 bg-[#0e131f]/95 border border-white/20 rounded-2xl shadow-2xl backdrop-blur-2xl z-40 animate-in fade-in-50 zoom-in-95 duration-150">
                        <button
                          onClick={() => {
                            handleAddPlaylistToQueue(false);
                            setShowQueueMenu(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-semibold text-white/90 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <ListPlus className="w-3.5 h-3.5 text-lumen-cyan" />
                          <span>Add in Order</span>
                        </button>
                        <button
                          onClick={() => {
                            handleAddPlaylistToQueue(true);
                            setShowQueueMenu(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-semibold text-purple-200 hover:text-purple-100 hover:bg-purple-500/20 transition-colors"
                        >
                          <Shuffle className="w-3.5 h-3.5 text-purple-300" />
                          <span>Shuffle into Queue</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* More Options ••• */}
                  <div className="relative" ref={moreMenuRef}>
                    <button
                      onClick={() => setShowMoreMenu(prev => !prev)}
                      className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white border border-white/15 transition-transform hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
                      title="More Options"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {showMoreMenu && (
                      <div 
                        className="absolute right-0 sm:left-0 mt-2 w-56 max-h-[min(260px,calc(100vh-340px))] overflow-y-auto p-1.5 bg-[#0b0e14] border border-white/25 rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.98)] z-50 animate-in fade-in-50 zoom-in-95 duration-150 space-y-0.5"
                        style={{
                          boxShadow: '0 30px 70px rgba(0, 0, 0, 0.98), inset 0 1px 1px 0 rgba(255, 255, 255, 0.35), 0 0 25px -4px rgba(6, 182, 212, 0.3)'
                        }}
                      >
                        {/* Mobile Only: Play Next & Add to Queue */}
                        <div className="sm:hidden border-b border-white/10 pb-1 mb-1 space-y-0.5">
                          <button
                            onClick={() => {
                              handlePlayNextPlaylist();
                              setShowMoreMenu(false);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <ListStart className="w-3.5 h-3.5 text-lumen-cyan" />
                            <span>Play Next in Queue</span>
                          </button>
                          <button
                            onClick={() => {
                              handleAddPlaylistToQueue(false);
                              setShowMoreMenu(false);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <ListPlus className="w-3.5 h-3.5 text-lumen-cyan" />
                            <span>Add Playlist to Queue</span>
                          </button>
                        </div>

                        {/* Visibility (Public / Private) Toggle */}
                        <button
                          type="button"
                          onClick={() => {
                            const nextPublic = activePlaylist.isPublic === false ? true : false;
                            onUpdatePlaylist(activePlaylist.id, { isPublic: nextPublic });
                            WatchSoundService.playTick(1.2);
                            setShowMoreMenu(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            {activePlaylist.isPublic !== false ? (
                              <Globe className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Lock className="w-3.5 h-3.5 text-white/50" />
                            )}
                            <span className="text-white">Visibility</span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            activePlaylist.isPublic !== false ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/60'
                          }`}>
                            {activePlaylist.isPublic !== false ? 'Public' : 'Private'}
                          </span>
                        </button>

                        {/* Collaborate with Friends */}
                        <button
                          type="button"
                          onClick={() => {
                            setShowCollaborateModal(true);
                            WatchSoundService.playTick(1.2);
                            setShowMoreMenu(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-white">Collaborate</span>
                          </div>
                          {activePlaylist.isCollaborative && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-500/20 text-purple-300">
                              {(activePlaylist.collaboratorUids?.length || 0) + 1}
                            </span>
                          )}
                        </button>
                        {/* 1. Add Songs */}
                        <button
                          onClick={() => {
                            setIsCarouselModalOpen(true);
                            setShowMoreMenu(false);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold text-lumen-cyan hover:bg-lumen-cyan/15 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>Add Songs (Carousel)</span>
                        </button>

                        {/* Cover Art Styling */}
                        <div className="px-2.5 py-1.5 border-t border-white/10 space-y-1">
                          <div className="text-[10px] font-mono text-white/50 uppercase tracking-wider mb-0.5">
                            Cover Style
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              fileInputRef.current?.click();
                              setShowMoreMenu(false);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <Upload className="w-3.5 h-3.5 text-lumen-cyan" />
                            <span>Upload Custom Image</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onUpdatePlaylist(activePlaylist.id, { coverUrl: 'mosaic' });
                              setShowMoreMenu(false);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                            <span>4-Song Mosaic Grid</span>
                          </button>
                          {activePlaylist.coverUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                onUpdatePlaylist(activePlaylist.id, { coverUrl: null });
                                setShowMoreMenu(false);
                              }}
                              className="w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-xs text-amber-300 hover:bg-amber-500/15 transition-colors cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reset to Auto / Emoji</span>
                            </button>
                          )}
                        </div>

                        {/* Duplicate Playlist */}
                        <button
                          onClick={() => {
                            handleDuplicatePlaylist();
                            setShowMoreMenu(false);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5 text-white/60" />
                          <span>Duplicate Playlist</span>
                        </button>

                        {/* Delete Playlist */}
                        {!isActiveLikedSongs && (
                          <button
                            onClick={() => {
                              setShowMoreMenu(false);
                              if (confirm(`Delete playlist "${activePlaylist.name}"?`)) {
                                onDeletePlaylist(activePlaylist.id);
                              }
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            <span>Delete Playlist</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* IN-PLAYLIST SEARCH & SORT BAR */}
            <div className="flex items-center justify-between gap-3 pt-3 pb-2 flex-shrink-0">
              <div className="relative flex-1 max-w-[180px] sm:max-w-xs min-w-[120px]">
                <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={playlistSearch}
                  onChange={(e) => setPlaylistSearch(e.target.value)}
                  placeholder="Search tracks..."
                  className="w-full pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/30"
                />
                {playlistSearch && (
                  <button
                    onClick={() => setPlaylistSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Sort Selector */}
              <div className="flex items-center gap-1.5 text-xs">
                <ArrowUpDown className="w-3.5 h-3.5 text-white/40" />
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as any)}
                  className="bg-white/5 border border-white/10 rounded-xl px-2.5 py-1 text-xs text-white/80 focus:outline-none cursor-pointer"
                >
                  <option value="custom" className="bg-black text-white">Custom Order</option>
                  <option value="title" className="bg-black text-white">Title (A-Z)</option>
                  <option value="artist" className="bg-black text-white">Artist</option>
                  <option value="duration" className="bg-black text-white">Duration</option>
                </select>
              </div>
            </div>

            {/* TRACKS LIST TABLE */}
            <div className="flex-1 overflow-y-auto pr-1 no-scrollbar">
              {displayedTracks.length === 0 ? (
                <div className="h-44 flex flex-col items-center justify-center text-white/40 text-xs">
                  <Music className="w-8 h-8 mb-2 opacity-30 text-lumen-cyan" />
                  <span className="font-semibold text-white/70">
                    {playlistSearch ? 'No matching tracks found.' : 'This playlist is empty.'}
                  </span>
                  <span className="text-[11px] mt-1 text-white/40">
                    {playlistSearch ? 'Try a different search term.' : 'Select songs from the taste carousel above, or import your playlist.'}
                  </span>
                  {!playlistSearch && (
                    <button
                      onClick={() => setIsImportModalOpen(true)}
                      className="mt-3 flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs text-emerald-300 transition-all shadow-sm"
                    >
                      <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Import from Spotify / Apple Music</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {displayedTracks.map((track, idx) => {
                    const isTrackPlaying = currentTrack?.id === track.id && isPlaying;
                    const isLiked = LikedService.isLiked(track.id);

                    return (
                      <div
                        key={`${track.id}-${idx}`}
                        className={`group flex items-center justify-between p-2 rounded-xl transition-all duration-200 border relative ${
                          isTrackPlaying
                            ? 'bg-white/10 border-white/20'
                            : 'hover:bg-white/5 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {/* Desktop-only Play Button on the left side of the album cover (hidden on mobile) */}
                          <button
                            onClick={() => onPlayTrack(track, displayedTracks)}
                            className="hidden sm:flex w-7 h-7 rounded-full items-center justify-center text-white/60 hover:text-white group-hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
                            title={isTrackPlaying ? 'Pause' : 'Play'}
                          >
                            {isTrackPlaying ? (
                              <Pause className="w-3.5 h-3.5 fill-current text-lumen-cyan" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            )}
                          </button>

                          {/* Mini Album Cover - First item on mobile, adjacent to play button on desktop */}
                          <div 
                            onClick={() => onPlayTrack(track, displayedTracks)}
                            className="w-9 h-9 sm:w-9 sm:h-9 rounded-lg overflow-hidden bg-black/60 flex-shrink-0 relative cursor-pointer active:scale-95 transition-transform"
                          >
                            <CoverImage 
                              src={track.artworkUrl || null} 
                              alt={track.title}
                              title={track.title}
                              artist={track.artist}
                              album={track.album}
                              size={100}
                              className="w-full h-full object-cover" 
                              onResolved={(healedUrl) => {
                                if (healedUrl && track.artworkUrl !== healedUrl) {
                                  track.artworkUrl = healedUrl;
                                  track.hasArtwork = true;
                                  (track as any).isStudioCoverVerified = true;
                                  onUpdatePlaylist(activePlaylist.id, { tracks: [...activePlaylist.tracks] });
                                }
                              }}
                            />
                            {isTrackPlaying && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <div className="w-2.5 h-2.5 rounded-full bg-lumen-cyan animate-pulse shadow-[0_0_8px_#06b6d4]" />
                              </div>
                            )}
                          </div>

                          {/* Title & Artist - Strictly single line with ellipsis on mobile */}
                          <div 
                            className="min-w-0 flex-1 pr-1 cursor-pointer"
                            onClick={() => onPlayTrack(track, displayedTracks)}
                          >
                            <h4 className={`text-xs font-semibold truncate ${isTrackPlaying ? 'text-lumen-cyan' : 'text-white'}`}>
                              {track.title}
                            </h4>
                            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                              <p className="text-[10px] text-white/50 truncate whitespace-nowrap overflow-hidden text-ellipsis min-w-0 flex-1" title={track.artist}>
                                {track.artist}
                              </p>
                              {track.addedByUsername && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-purple-500/15 border border-purple-500/30 text-[9px] text-purple-300 shrink-0" title={`Added by @${track.addedByUsername}`}>
                                  <InitialAvatar username={track.addedByUsername} size="xs" />
                                  <span className="hidden sm:inline">@{track.addedByUsername}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions: Reorder, Desktop quick actions, Duration, Heart, 3-dots Menu */}
                        <div className="flex items-center gap-1 shrink-0 pl-1">
                          {/* Reorder Buttons (only in Custom Order on desktop hover) */}
                          {sortMode === 'custom' && (
                            <div className="hidden sm:group-hover:flex items-center gap-0.5">
                              {idx > 0 && (
                                <button
                                  onClick={() => handleMoveTrack(idx, 'up')}
                                  className="p-1 text-white/40 hover:text-white"
                                  title="Move Up"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                              )}
                              {idx < activePlaylist.tracks.length - 1 && (
                                <button
                                  onClick={() => handleMoveTrack(idx, 'down')}
                                  className="p-1 text-white/40 hover:text-white"
                                  title="Move Down"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}

                          {/* Desktop Quick Shortcuts (Hover only, hidden on mobile) */}
                          <button
                            onClick={(e) => handlePlayNextTrack(track, e)}
                            className="hidden sm:group-hover:block p-1 text-white/40 hover:text-lumen-cyan transition-colors"
                            title="Play Next"
                          >
                            <ListStart className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => handleAddTrackToQueue(track, e)}
                            className="hidden sm:group-hover:block p-1 text-white/40 hover:text-lumen-cyan transition-colors"
                            title="Add to Queue"
                          >
                            <ListPlus className="w-3.5 h-3.5" />
                          </button>

                          {/* Duration (Formatted time) */}
                          <span className="text-[11px] font-mono text-white/40 shrink-0 w-8 sm:w-9 text-right">
                            {formatDuration(track.duration)}
                          </span>

                          {/* Heart (Like) button immediately on the right side of the time */}
                          <button
                            onClick={() => handleToggleLikeTrack(track)}
                            className="p-1 text-white/40 hover:text-rose-400 transition-colors shrink-0"
                            title={isLiked ? "Unlike Song" : "Like Song"}
                          >
                            <Heart className={`w-3.5 h-3.5 ${isLiked ? 'text-rose-500 fill-rose-500' : ''}`} />
                          </button>

                          {/* 3-dots Menu Button */}
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTrackMenuTarget(prev => (prev?.index === idx ? null : { track, index: idx }));
                              }}
                              className="p-1 text-white/40 hover:text-white rounded-lg hover:bg-white/10 transition-colors shrink-0"
                              title="More options"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>

                            {/* 3-dots Track Menu Dropdown */}
                            {trackMenuTarget?.index === idx && (
                              <div
                                ref={trackMenuRef}
                                className="absolute right-0 bottom-full mb-1 sm:bottom-auto sm:top-full sm:mt-1 w-44 bg-[#14151b]/95 backdrop-blur-2xl border border-white/20 rounded-xl shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-150"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={(e) => {
                                    handlePlayNextTrack(track, e);
                                    setTrackMenuTarget(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                                >
                                  <ListStart className="w-3.5 h-3.5 text-lumen-cyan" />
                                  <span>Play Next</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    handleAddTrackToQueue(track, e);
                                    setTrackMenuTarget(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                                >
                                  <ListPlus className="w-3.5 h-3.5 text-purple-400" />
                                  <span>Add to Queue</span>
                                </button>
                                {onOpenAddToPlaylist && (
                                  <button
                                    onClick={() => {
                                      onOpenAddToPlaylist(track);
                                      setTrackMenuTarget(null);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                                  >
                                    <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Add to Playlist...</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    const realIndex = activePlaylist.tracks.findIndex(t => 
                                      (track.id && String(t.id) === String(track.id)) ||
                                      (t.title === track.title && t.artist === track.artist)
                                    );
                                    onRemoveTrack(activePlaylist.id, track.id, realIndex !== -1 ? realIndex : undefined, track.title, track.artist);
                                    setTrackMenuTarget(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors text-left border-t border-white/5 mt-1 pt-1.5 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Remove from Playlist</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* PLAYER COMPONENT: DESKTOP ONLY RIGHT PANE (REMOVED FROM MOBILE FOR FULL-HEIGHT LIST) */}
          {!isCompactLayout && (
            /* RIGHT PANE: SLEEK OBSIDIAN LUXURY GLASS PLAYER WIDGET WITH DYNAMIC BEAT-SYNCED LEDS */
            <div 
              className={`w-full ${isTv ? 'w-80 md:w-96 lg:w-96 flex-shrink-0' : 'lg:w-96'} flex flex-col justify-between bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-white/[0.01] border border-white/10 rounded-3xl p-6 sm:p-7 backdrop-blur-3xl shadow-2xl relative overflow-hidden select-none`}
            >
              {/* Dynamic LED perimeter frame synchronized to the beat & album cover */}
              <div 
                className="absolute inset-0 rounded-3xl pointer-events-none transition-all duration-150 z-20"
                style={{
                  border: `3px solid ${activeSongColor}`,
                  boxShadow: `inset 0 0 ${Math.round(24 * bassScale)}px ${activeSongColor}50, 0 0 ${Math.round(36 * bassScale)}px ${activeSongColor}45`,
                  opacity: 0.9 + (bassScale - 1) * 0.4
                }}
              />

              {/* Vertical Spectral Flow Columns on Left & Right edges of the widget */}
              <div 
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-1.5 z-20 rounded-r-full transition-all duration-75 blur-[1px]"
                style={{
                  height: `${Math.max(16, avgLeftFlow * 0.72)}%`,
                  backgroundColor: activeSongColor,
                  boxShadow: `0 0 16px 3px ${activeSongColor}`
                }}
              />
              <div 
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-1.5 z-20 rounded-l-full transition-all duration-75 blur-[1px]"
                style={{
                  height: `${Math.max(16, avgRightFlow * 0.72)}%`,
                  backgroundColor: activeSongColor,
                  boxShadow: `0 0 16px 3px ${activeSongColor}`
                }}
              />

              {/* Subtle ambient blurred backdrop glow */}
              {currentTrack?.artworkUrl && (
                <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-20">
                  <img 
                    src={currentTrack.artworkUrl} 
                    alt="" 
                    className="w-full h-full object-cover filter blur-3xl scale-125"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" />
                </div>
              )}


              {currentTrack ? (
                <div className="flex flex-col items-center text-center w-full z-10 my-auto">
                  {/* Square Album Artwork or In-Card Synced Lyrics */}
                  <div className="w-52 h-52 sm:w-60 sm:h-60 rounded-2xl overflow-hidden shadow-2xl border border-white/15 relative group transition-all duration-300 bg-black/60 flex flex-col">
                    {!showCardLyrics ? (
                      /* Square Album Artwork with Floating Glass Lyrics Badge */
                      <div 
                        className="relative w-full h-full cursor-pointer group"
                        onClick={() => setShowCardLyrics(true)}
                        title="Click to view synced lyrics in player"
                      >
                        <CoverImage 
                          src={currentTrack.artworkUrl || null} 
                          alt={currentTrack.title} 
                          title={currentTrack.title}
                          artist={currentTrack.artist}
                          album={currentTrack.album}
                          size={600}
                          className="w-full h-full object-cover" 
                          onResolved={(healedUrl) => {
                            if (currentTrack && (!currentTrack.artworkUrl || currentTrack.artworkUrl !== healedUrl)) {
                              currentTrack.artworkUrl = healedUrl;
                              currentTrack.hasArtwork = true;
                              AudioEngine.updateCurrentTrackArtwork(healedUrl);
                              try {
                                const userKey = FirebaseAuthService.getCurrentUser()?.uid || 'local';
                                localStorage.setItem(`lumen_last_played_${userKey}`, JSON.stringify(currentTrack));
                                localStorage.setItem('lumen_last_played_track', JSON.stringify(currentTrack));
                              } catch (_) {}
                            }
                          }}
                        />

                        {/* Floating Glass Lyrics Toggle Badge (Hover Only) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowCardLyrics(true);
                          }}
                          className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/75 hover:bg-black/90 text-[11px] font-semibold text-white/90 border border-white/25 backdrop-blur-md shadow-xl transition-all duration-200 active:scale-95 cursor-pointer z-10"
                          title="Show Synced Lyrics"
                        >
                          <AlignLeft className="w-3 h-3 text-lumen-cyan" />
                          <span>Lyrics</span>
                        </button>
                      </div>
                    ) : (
                      /* In-Card Kinetic Synced Lyrics Display with Living Blurred Album Artwork Background */
                      <div className="relative w-full h-full flex flex-col p-3.5 text-center overflow-hidden rounded-2xl bg-black/40 backdrop-blur-2xl border border-white/15 shadow-2xl">
                        {/* Vibrant Ambient Blurred Album Cover Art Background */}
                        {currentTrack?.artworkUrl ? (
                          <div className="pointer-events-none absolute inset-0 overflow-hidden">
                            <img 
                              src={currentTrack.artworkUrl} 
                              alt="" 
                              className="w-full h-full object-cover filter blur-xl scale-125 opacity-70 brightness-90 saturate-150 transition-all duration-700" 
                            />
                            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/70" />
                          </div>
                        ) : (
                          <div 
                            className="pointer-events-none absolute inset-0 opacity-40 blur-2xl"
                            style={{ backgroundColor: activeSongColor }}
                          />
                        )}

                        {/* Top & Bottom Vignette Fades */}
                        <div className="absolute top-0 inset-x-0 h-8 bg-gradient-to-b from-[#0a0d14]/70 to-transparent pointer-events-none z-10" />
                        <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-[#0a0d14]/70 to-transparent pointer-events-none z-10" />

                        {/* Floating Glass Cover Flip Button */}
                        <button
                          type="button"
                          onClick={() => setShowCardLyrics(false)}
                          className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 hover:bg-black/80 text-[11px] font-semibold text-white/90 border border-white/20 backdrop-blur-md shadow-lg transition-all active:scale-95 cursor-pointer z-20"
                          title="Return to Album Artwork"
                        >
                          <Disc3 className="w-3 h-3 text-lumen-cyan" />
                          <span>Cover</span>
                        </button>

                        {/* Scrollable Kinetic Lyrics */}
                        <div 
                          ref={lyricsCardScrollRef}
                          className="flex-1 overflow-y-auto space-y-3 pt-7 pb-8 px-1 no-scrollbar select-none text-center"
                        >
                          {isLoadingCardLyrics ? (
                            <div className="h-full flex flex-col items-center justify-center text-white/50 text-xs py-10">
                              <Music className="w-6 h-6 text-lumen-cyan mb-2 animate-pulse" />
                              <span>Syncing lyrics...</span>
                            </div>
                          ) : cardLyrics && cardLyrics.length > 0 ? (
                            cardLyrics.map((line, idx) => {
                              const isActive = idx === activeCardLyricIdx;
                              return (
                                <p
                                  key={`${line.time}_${idx}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    AudioEngine.seek(line.time);
                                    setCurrentTime(line.time);
                                  }}
                                  className={`transition-all duration-300 cursor-pointer px-2 py-1 rounded-lg leading-snug ${
                                    isActive
                                      ? 'text-sm sm:text-base font-black scale-105'
                                      : 'text-xs text-white/40 hover:text-white/80 hover:bg-white/5'
                                  }`}
                                  style={{
                                    color: isActive ? toAccessibleAccentColor(activeSongColor) : undefined,
                                    textShadow: isActive ? `0 0 16px ${withAlpha(toAccessibleAccentColor(activeSongColor), 0.75)}` : undefined
                                  }}
                                  title={`Seek to ${formatDuration(line.time)}`}
                                >
                                  {line.text}
                                </p>
                              );
                            })
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center text-white/40 text-xs py-10">
                              <AlignLeft className="w-6 h-6 text-lumen-cyan/50 mb-2" />
                              <span className="font-semibold text-white/70">No Synced Lyrics</span>
                              <span className="text-[10px] text-white/40 mt-1">Instrumental or unavailable</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Title & Artist & Album */}
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight truncate max-w-full px-2 mt-4" title={currentTrack.title}>
                    {currentTrack.title}
                  </h3>
                  <div className="text-xs text-white/70 mt-0.5 truncate max-w-full px-2" title={currentTrack.artist}>
                    <ArtistLinks 
                      artist={currentTrack.artist} 
                      onSelectArtist={onSelectArtist} 
                      linkClassName="hover:text-white hover:underline cursor-pointer transition-colors"
                    />
                  </div>
                  {currentTrack.album && (
                    <button
                      type="button"
                      onClick={() => handleOpenAlbumModal(currentTrack.album!, currentTrack.artist, currentTrack.artworkUrl)}
                      className="text-[11px] text-white/50 hover:text-lumen-cyan hover:underline transition-colors mt-0.5 truncate max-w-full px-2 cursor-pointer flex items-center justify-center gap-1 group/alb mx-auto"
                      title={`View all songs in album "${currentTrack.album}"`}
                    >
                      <Disc3 className="w-3 h-3 text-lumen-cyan/70 group-hover/alb:text-lumen-cyan group-hover/alb:rotate-45 transition-transform" />
                      <span>{currentTrack.album}</span>
                    </button>
                  )}

                  {/* Scrubber Progress Bar */}
                  <div className="w-full flex items-center gap-2 font-mono text-[10px] text-white/50 my-3">
                    <span className="w-8 text-right">{formatDuration(currentTime)}</span>
                    <div className="relative flex-1 h-1.5 bg-white/15 rounded-full overflow-hidden flex items-center group cursor-pointer">
                      <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        step={0.1}
                        value={currentTime}
                        onChange={handleSeek}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                      />
                      <div 
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                          backgroundColor: activeSongColor,
                          boxShadow: `0 0 10px ${activeSongColor}`
                        }}
                      />
                    </div>
                    <span className="w-8">{formatDuration(duration)}</span>
                  </div>

                  {/* Transport Controls: Symmetrical Balanced Dock */}
                  <div className="flex items-center justify-between w-full px-2 my-2">
                    {/* Left: Like & Shuffle */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <button
                        onClick={() => {
                          LikedService.toggleLike(currentTrack);
                          setIsLiked(LikedService.isLiked(currentTrack.id));
                        }}
                        className="p-2 text-white/50 hover:text-rose-400 active:scale-90 transition-all cursor-pointer"
                        title={isLiked ? "Unlike Song" : "Like Song"}
                      >
                        <Heart className={`w-4 h-4 ${isLiked ? 'text-rose-500 fill-rose-500' : 'text-white/60'}`} />
                      </button>

                      <button
                        onClick={() => {
                          const next = AudioEngine.toggleShuffle();
                          setIsShuffle(next);
                        }}
                        className={`p-2 rounded-full transition-all active:scale-90 cursor-pointer ${
                          isShuffle ? 'text-lumen-cyan bg-white/10' : 'text-white/40 hover:text-white'
                        }`}
                        title="Shuffle"
                      >
                        <Shuffle className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Center: Prev, Play/Pause, Next */}
                    <div className="flex items-center gap-3 sm:gap-4">
                      <button
                        onClick={() => AudioEngine.prev()}
                        className="p-2 text-white/70 hover:text-white hover:scale-110 active:scale-90 transition-all cursor-pointer"
                        title="Previous Track"
                      >
                        <SkipBack className="w-5 h-5 fill-current" />
                      </button>

                      <button
                        onClick={() => AudioEngine.togglePlay()}
                        className="w-12 h-12 rounded-full text-white flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 hover:brightness-110 transition-all duration-300 cursor-pointer"
                        style={{
                          backgroundColor: activeSongColor,
                          boxShadow: `0 4px 22px ${activeSongColor}90, 0 0 16px ${activeSongColor}60`
                        }}
                        title={isPlaying ? "Pause" : "Play"}
                      >
                        {isPlaying ? (
                          <Pause className="w-5 h-5 fill-white" />
                        ) : (
                          <Play className="w-5 h-5 fill-white ml-0.5" />
                        )}
                      </button>

                      <button
                        onClick={() => AudioEngine.next()}
                        className="p-2 text-white/70 hover:text-white hover:scale-110 active:scale-90 transition-all cursor-pointer"
                        title="Next Track"
                      >
                        <SkipForward className="w-5 h-5 fill-current" />
                      </button>
                    </div>

                    {/* Right: Repeat & Queue (with spacing separating from center transport) */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <button
                        onClick={() => {
                          const next = AudioEngine.toggleRepeat();
                          setRepeatMode(next);
                        }}
                        className={`p-2 rounded-full transition-all active:scale-90 cursor-pointer ${
                          repeatMode !== 'off' ? 'text-lumen-cyan bg-white/10' : 'text-white/40 hover:text-white'
                        }`}
                        title={`Repeat: ${repeatMode}`}
                      >
                        <Repeat className="w-4 h-4" />
                      </button>

                      {onOpenQueue && (
                        <button
                          onClick={onOpenQueue}
                          className="p-2 text-white/60 hover:text-white active:scale-90 transition-all cursor-pointer"
                          title="Open Queue"
                        >
                          <ListMusic className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-white/30 text-xs text-center p-6 my-auto">
                  <Disc3 className="w-12 h-12 mb-3 stroke-[1.5]" />
                  <span className="font-semibold text-white/50">No Track Playing</span>
                  <span className="text-[11px] mt-1">Select any song to start playback</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-white/40">
          <Music className="w-12 h-12 mb-3 opacity-30 text-lumen-cyan" />
          <h3 className="text-lg font-bold text-white">No Playlists Created Yet</h3>
          <p className="text-xs text-white/50 mt-1 mb-4">Click below to start your personal playlist collection</p>
          <button
            onClick={handleCreateNewPlaylist}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs shadow-lg hover:scale-105 transition-transform"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Playlist</span>
          </button>
        </div>
      )}
        </>
      )}

      {/* IMPORT PLAYLIST MODAL (SPOTIFY / STREAMING URL / CSV / TEXT) */}
      <ImportPlaylistModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={(newPl) => {
          if (onImportPlaylist) {
            onImportPlaylist(newPl);
          } else {
            onSelectPlaylist(newPl.id);
          }
        }}
        dominantColor={activePlaylist?.coverColor || dominantColor}
      />

      {/* 3D PLAYLIST COVER FLOW CAROUSEL MODAL (SPOTIFY AUDIO PREVIEWS + WATCH SOUNDS) */}
      {activePlaylist && (
        <PlaylistCarouselModal
          isOpen={isCarouselModalOpen}
          onClose={() => setIsCarouselModalOpen(false)}
          playlist={activePlaylist}
          dominantColor={activePlaylist.coverColor || dominantColor}
          onAddTrack={onAddTrack}
        />
      )}

      {/* NATURAL LANGUAGE AI PLAYLIST GENERATION MODAL */}
      {isAiPlaylistModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6 select-none animate-fadeIn">
          <div 
            className="w-full max-w-lg rounded-3xl bg-gradient-to-br from-white/[0.13] via-white/[0.04] to-black/92 border-t border-l border-white/50 border-r border-b border-black/80 backdrop-blur-3xl shadow-2xl p-6 flex flex-col relative overflow-hidden"
            style={{
              boxShadow: `0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.4), 0 0 40px -5px ${dominantColor}50`
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center shadow-md">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white tracking-tight">Create with AI</h3>
                  <p className="text-[10px] text-white/50 font-mono">LUMEN Recommendation Engine</p>
                </div>
              </div>
              <button
                onClick={() => setIsAiPlaylistModalOpen(false)}
                className="p-1.5 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-white/70 mb-3">
              Describe the vibe, tempo, mood, or artists you want. LUMEN will construct, sequence, and verify an authentic playlist.
            </p>

            {/* Prompt Input Form */}
            <form onSubmit={(e) => { e.preventDefault(); handleGenerateAiPlaylist(); }} className="space-y-3 mb-2">
              <div className="relative">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. 40-minute night-driving playlist with energetic alternative rock..."
                  className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-2xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-pink-500 transition-colors"
                  autoFocus
                />
              </div>

              {aiError && (
                <p className="text-xs text-red-400 font-mono">{aiError}</p>
              )}

              {/* Inspiration Chips */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Ideas to try:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    '40-minute night-driving playlist with psychedelic rock',
                    'Chill late-night study session like Tame Impala',
                    'Energetic gym workout with rage trap and hip hop',
                    'Atmospheric synthwave and dreamy indie pop'
                  ].map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => {
                        setAiPrompt(idea);
                        handleGenerateAiPlaylist(idea);
                      }}
                      className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-pink-500/30 text-[10px] text-white/80 transition-colors text-left cursor-pointer"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={isGeneratingAiPlaylist || !aiPrompt.trim()}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xl hover:scale-102 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isGeneratingAiPlaylist ? 'Curating & Sequencing...' : 'Generate Playlist Now'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
      {/* REAL-TIME COLLABORATIVE PLAYLIST MODAL */}
      {showCollaborateModal && activePlaylist && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6 select-none animate-fadeIn"
          onClick={() => setShowCollaborateModal(false)}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl bg-gradient-to-br from-white/[0.14] via-white/[0.04] to-black/95 border-t border-l border-white/50 border-r border-b border-black/80 backdrop-blur-3xl shadow-2xl p-6 flex flex-col relative overflow-hidden"
            style={{
              boxShadow: `0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.4), 0 0 40px -5px ${effectiveCoverGlowColor}50`
            }}
          >
            {/* Atmospheric LED Glow */}
            <div 
              className="pointer-events-none absolute -top-16 -left-16 w-44 h-44 rounded-full blur-[60px] opacity-40"
              style={{ backgroundColor: effectiveCoverGlowColor }}
            />

            {/* Header */}
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Collaborate</h3>
                  <p className="text-xs text-white/50 truncate max-w-[200px]">{activePlaylist.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCollaborateModal(false)}
                className="p-1.5 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-white/70 mb-4 leading-relaxed relative z-10">
              Pick friends who can add and organize songs in this playlist in real-time.
            </p>

            {/* Friend Picker List */}
            <div className="max-h-60 overflow-y-auto space-y-2 no-scrollbar pr-1 mb-5 relative z-10">
              {isLoadingFriends ? (
                <div className="py-8 text-center text-xs text-white/40">Loading friends...</div>
              ) : availableFriends.length === 0 ? (
                <div className="py-6 text-center text-xs text-white/40 bg-white/5 rounded-2xl p-4">
                  No friends connected yet. Connect with friends in the Friends & More section to collaborate!
                </div>
              ) : (
                availableFriends.map(f => {
                  const fUid = f.userId || f.user_id || f.uid;
                  const isCollaborator = (activePlaylist.collaboratorUids || []).includes(fUid);
                  return (
                    <div
                      key={fUid}
                      onClick={() => handleToggleCollaborator(fUid, f.username || f.displayName || 'friend')}
                      className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${
                        isCollaborator
                          ? 'bg-purple-500/20 border-purple-400/60 shadow-md ring-1 ring-purple-400/30'
                          : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <InitialAvatar username={f.username} size="sm" />
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-white block truncate">
                            {f.displayName || f.username}
                          </span>
                          <span className="text-[10px] text-white/40 font-mono block truncate">
                            @{f.username}
                          </span>
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                        isCollaborator ? 'bg-purple-500 border-purple-400 text-white' : 'border-white/30 text-transparent'
                      }`}>
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowCollaborateModal(false)}
              className="w-full py-2.5 rounded-2xl bg-white text-black font-extrabold text-xs hover:bg-white/90 active:scale-95 transition-all shadow-xl cursor-pointer relative z-10"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* IMMERSIVE ALBUM MODAL */}
      {selectedAlbumModal && (
        <AlbumModal
          isOpen={!!selectedAlbumModal}
          onClose={() => setSelectedAlbumModal(null)}
          albumTitle={selectedAlbumModal.albumTitle}
          artistName={selectedAlbumModal.artistName}
          coverUrl={selectedAlbumModal.coverUrl}
          dominantColor={dominantColor}
          onPlayTrack={onPlayTrack}
          onSelectArtist={onSelectArtist}
        />
      )}

      {/* Top-Right Duplicate Track Add Confirmation Dialog */}
      {pendingDuplicateTrack && (
        <div className="fixed top-6 right-6 z-[80] max-w-sm p-4 rounded-2xl bg-gradient-to-br from-white/[0.14] via-white/[0.06] to-black/90 backdrop-blur-3xl border border-amber-400/40 shadow-2xl space-y-3 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-white">Song Already in Playlist</h4>
              <p className="text-[11px] text-white/70 mt-0.5">
                Do you really want to add <span className="text-white font-semibold">"{pendingDuplicateTrack.title}"</span>? It's already in this playlist.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPendingDuplicateTrack(null)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const track = pendingDuplicateTrack;
                setPendingDuplicateTrack(null);
                handleAddTrackToCurrent(track, true);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-bold cursor-pointer transition-colors shadow-md"
            >
              Yes, Add Song
            </button>
          </div>
        </div>
      )}

      {/* Queue Feedback Toast */}
      {queueToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/90 border border-purple-500/40 text-xs font-mono text-white shadow-2xl flex items-center gap-2 animate-fadeIn pointer-events-none">
          <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
          <span>{queueToast}</span>
        </div>
      )}
    </div>
  );
};
