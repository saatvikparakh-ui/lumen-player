import React, { useState, useEffect, useRef } from 'react';
import { CoverImage } from '../common/CoverImage';
import { ApiClient } from '../../services/apiClient';
import { 
  X, 
  Settings, 
  Sparkles, 
  Sliders, 
  User, 
  Check, 
  Search, 
  Moon, 
  Volume2, 
  Radio, 
  Zap, 
  Disc3, 
  Music2, 
  UserCheck, 
  Download, 
  Trash2,
  Clock,
  ShieldCheck,
  BarChart2,
  Users,
  Star,
  ArrowRightLeft,
  Share2,
  Send,
  Inbox,
  Play,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  AtSign,
  Copy,
  Camera,
  Image as ImageIcon,
  Upload,
  Edit3,
  LogOut,
  QrCode,
  Link2,
  Tv,
  MousePointer2
} from 'lucide-react';
import { OtaUpdateService, type OtaSnapshot } from '../../services/otaUpdateService';
import { useTvMode } from '../../hooks/useTvMode';
import { FirebaseAuthService } from '../../services/firebaseAuthService';
import { FirestoreService } from '../../services/firestoreService';
import { AudioEngine, EQ_FREQUENCIES, EQ_PRESETS } from '../../services/audioEngine';
import { PreferenceService, POPULAR_GENRES, POPULAR_VERIFIED_ARTISTS } from '../../services/preferenceService';
import { ArtistService, AlbumMetadata } from '../../services/artistService';
import { StreamingService } from '../../services/streamingService';
import { LikedService } from '../../services/likedService';
import { PlaylistService } from '../../services/playlistService';
import { RatingAndStatsService } from '../../services/ratingAndStatsService';
import { isNativeAndroid, LumenAudio } from '../../services/nativeAudioBridge';
import { useDeviceMode } from '../../hooks/useDeviceMode';
import { EQPresetName, UserPreferences, ListeningStats, FriendUser, CatalogComparison, SongShare } from '../../types/music';
import { UsernameSetupModal } from '../auth/UsernameSetupModal';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  isOpen: boolean;
  initialTab?: 'playback' | 'taste' | 'eq' | 'stats' | 'account';
  onClose: () => void;
  onPreferencesUpdated: () => void;
  dominantColor: string;
  onOpenAccountSwitcher?: () => void;
  onOpenAuthModal?: () => void;
  onOpenTvBeam?: () => void;
}

interface SearchedArtist {
  id: string;
  name: string;
  genre: string;
  avatarUrl: string | null;
}

export const SettingsHubModal: React.FC<Props> = ({
  isOpen,
  initialTab = 'playback',
  onClose,
  onPreferencesUpdated,
  dominantColor,
  onOpenAccountSwitcher,
  onOpenAuthModal,
  onOpenTvBeam
}) => {
  if (!isOpen) return null;

  const { 
    isTvMode, 
    toggleTvMode, 
    isUltraSmooth, 
    toggleGraphicsMode, 
    isVirtualCursorEnabled, 
    toggleVirtualCursor 
  } = useTvMode();
  const [activeTab, setActiveTab] = useState<'playback' | 'taste' | 'eq' | 'stats' | 'account'>(initialTab);

  // Listening Stats State
  const [statsWindow, setStatsWindow] = useState<'30d' | '90d' | 'all'>('30d');
  const [statsData, setStatsData] = useState<ListeningStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Friends & Ratings State
  const [friendsList, setFriendsList] = useState<FriendUser[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [ratingVisibility, setRatingVisibility] = useState<'public' | 'friends' | 'private'>('friends');
  const [friendSearchInput, setFriendSearchInput] = useState('');
  const [friendSearchStatus, setFriendSearchStatus] = useState<string | null>(null);
  const [selectedFriendForCompare, setSelectedFriendForCompare] = useState<FriendUser | null>(null);
  const [comparisonData, setComparisonData] = useState<CatalogComparison | null>(null);
  const [isLoadingComparison, setIsLoadingComparison] = useState(false);

  // Social Music & Song Sharing State
  const [socialSubTab, setSocialSubTab] = useState<'inbox' | 'send' | 'friends' | 'compare' | 'settings'>('inbox');
  const [receivedShares, setReceivedShares] = useState<SongShare[]>([]);
  const [sentShares, setSentShares] = useState<SongShare[]>([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [shareRecipientId, setShareRecipientId] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [shareStatusMsg, setShareStatusMsg] = useState<string | null>(null);

  // Device Layout Mode
  const { deviceMode, deviceModeSetting, setDeviceModeSetting } = useDeviceMode();

  // Over-the-Air Updates & Storage Cache State
  const [otaSnap, setOtaSnap] = useState<OtaSnapshot>(() => OtaUpdateService.getSnapshot());
  const [cacheClearStatus, setCacheClearStatus] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);

  const handleClearAppCache = async () => {
    setIsClearingCache(true);
    setCacheClearStatus(null);
    try {
      let freedLabel = '';
      if (isNativeAndroid()) {
        const res = await LumenAudio.clearAppCache();
        freedLabel = res?.freedMb > 0 ? `Freed ${res.freedMb} MB + WebView image cache.` : 'Cleared WebView & temp cache.';
      } else {
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        freedLabel = 'Cleared temporary app cache.';
      }
      setCacheClearStatus(freedLabel);
    } catch {
      setCacheClearStatus('Cleared temporary cache.');
    } finally {
      setIsClearingCache(false);
    }
  };

  useEffect(() => {
    return OtaUpdateService.subscribe(setOtaSnap);
  }, []);

  // Playback Settings State
  const [crossfade, setCrossfade] = useState<number>(() => AudioEngine.getCrossfade());
  const [isGapless, setIsGapless] = useState<boolean>(() => AudioEngine.getGapless());
  const [isAutomix, setIsAutomix] = useState<boolean>(() => AudioEngine.getAutomix());
  const [isNormalized, setIsNormalized] = useState<boolean>(() => AudioEngine.getNormalisation());
  const [isAutoplayEnabled, setIsAutoplayEnabled] = useState<boolean>(() => AudioEngine.isAutoplayEnabled());
  const [sleepTimerOption, setSleepTimerOption] = useState<number | 'end_of_track' | 'off'>('off');
  const [audioQuality, setAudioQuality] = useState<'opus' | 'lossless' | 'balanced'>('opus');

  // Custom Backdrop State & Album Search Modal (Pink Floyd etc.)
  const [customBackdropUrl, setCustomBackdropUrl] = useState<string | null>(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_custom_backdrop_url') : null;
  });
  const [customBackdropTitle, setCustomBackdropTitle] = useState<string | null>(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_custom_backdrop_title') : null;
  });
  const [backdropMode, setBackdropMode] = useState<'persistent' | 'dynamic'>(() => {
    return (typeof localStorage !== 'undefined' ? (localStorage.getItem('lumen_backdrop_mode') as any) : null) || 'persistent';
  });
  const [showAlbumSearchModal, setShowAlbumSearchModal] = useState(false);
  const [albumSearchQuery, setAlbumSearchQuery] = useState('');
  const [albumSearchResults, setAlbumSearchResults] = useState<AlbumMetadata[]>([]);
  const [isSearchingAlbums, setIsSearchingAlbums] = useState(false);

  // Artist sort mode for listening analytics (Most Plays vs Most Time)
  const [artistSortMode, setArtistSortMode] = useState<'plays' | 'time'>('plays');

  // Background Audio Battery Optimization State (Mobile Android)
  const [isBatteryExempt, setIsBatteryExempt] = useState<boolean | null>(null);
  useEffect(() => {
    if (isNativeAndroid()) {
      LumenAudio.isIgnoringBatteryOptimizations().then(res => {
        setIsBatteryExempt(res?.isIgnoring ?? false);
      }).catch(() => {});
    }
  }, []);

  const handleRequestBackgroundPermission = async () => {
    if (!isNativeAndroid()) return;
    try {
      await LumenAudio.requestBackgroundPermission();
      setTimeout(async () => {
        try {
          const res = await LumenAudio.isIgnoringBatteryOptimizations();
          setIsBatteryExempt(res?.isIgnoring ?? false);
        } catch (_) {}
      }, 2000);
    } catch (e) {
      console.warn('Error requesting background permission:', e);
    }
  };

  const albumSearchTimeoutRef = useRef<number | null>(null);
  const albumAbortCtrlRef = useRef<AbortController | null>(null);

  const handleSearchAlbums = (q: string) => {
    setAlbumSearchQuery(q);
    if (albumSearchTimeoutRef.current) {
      window.clearTimeout(albumSearchTimeoutRef.current);
    }
    if (albumAbortCtrlRef.current) {
      albumAbortCtrlRef.current.abort();
    }

    if (!q.trim()) {
      setAlbumSearchResults([]);
      setIsSearchingAlbums(false);
      return;
    }

    setIsSearchingAlbums(true);
    albumSearchTimeoutRef.current = window.setTimeout(async () => {
      const ctrl = new AbortController();
      albumAbortCtrlRef.current = ctrl;
      try {
        const res = await ArtistService.searchAlbums(q, ctrl.signal);
        setAlbumSearchResults(res);
      } catch (_) {
        setAlbumSearchResults([]);
      } finally {
        setIsSearchingAlbums(false);
      }
    }, 280);
  };

  const handleSelectBackdropAlbum = (album: AlbumMetadata) => {
    if (!album.artworkUrl) return;
    setCustomBackdropUrl(album.artworkUrl);
    setCustomBackdropTitle(`${album.title} — ${album.artist}`);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lumen_custom_backdrop_url', album.artworkUrl);
      localStorage.setItem('lumen_custom_backdrop_title', `${album.title} — ${album.artist}`);
      localStorage.setItem('lumen_backdrop_mode', backdropMode);
    }
    window.dispatchEvent(new Event('lumen:backdrop_changed'));
    setShowAlbumSearchModal(false);
  };

  const handleToggleBackdropMode = (mode: 'persistent' | 'dynamic') => {
    setBackdropMode(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lumen_backdrop_mode', mode);
    }
    window.dispatchEvent(new Event('lumen:backdrop_changed'));
  };

  const handleResetBackdrop = () => {
    setCustomBackdropUrl(null);
    setCustomBackdropTitle(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('lumen_custom_backdrop_url');
      localStorage.removeItem('lumen_custom_backdrop_title');
    }
    window.dispatchEvent(new Event('lumen:backdrop_changed'));
  };

  // Equalizer State
  const [eqGains, setEqGains] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [activePreset, setActivePreset] = useState<EQPresetName>('Flat');

  // Taste Profile State
  const [prefs, setPrefs] = useState<UserPreferences>(() => PreferenceService.getPreferences());
  const [artistSearchQuery, setArtistSearchQuery] = useState('');
  const [searchedArtists, setSearchedArtists] = useState<SearchedArtist[]>([]);
  const [isSearchingArtists, setIsSearchingArtists] = useState(false);
  const searchDebounceRef = useRef<any>(null);

  // Spotify Web API Integration Credentials
  const [spotifyClientId, setSpotifyClientId] = useState<string>(() => localStorage.getItem('lumen_spotify_client_id') || '');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState<string>(() => localStorage.getItem('lumen_spotify_client_secret') || '');
  const [showSecret, setShowSecret] = useState(false);
  const [isSpotifySaved, setIsSpotifySaved] = useState(false);

  // User Profile & Unique Username State
  const [accountUsername, setAccountUsername] = useState<string>(() => {
    const cur = FirebaseAuthService.getCurrentUser()?.username;
    if (cur && cur.toLowerCase() !== 'listener') return cur;
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_user_handle') : null;
    if (stored && stored.toLowerCase() !== 'listener') return stored;
    return '';
  });
  const [copiedAccountTag, setCopiedAccountTag] = useState(false);
  const [isEditUsernameModalOpen, setIsEditUsernameModalOpen] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(() => localStorage.getItem('lumen_user_avatar') || FirebaseAuthService.getCurrentUser()?.photoURL || null);
  const [profileCoverUrl, setProfileCoverUrl] = useState<string | null>(() => localStorage.getItem('lumen_user_cover') || null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const coverFileRef = useRef<HTMLInputElement | null>(null);

  // Synchronize on open & load user profile
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const fetchAccountProfile = async () => {
      try {
        const curUser = FirebaseAuthService.getCurrentUser();
        if (curUser?.photoURL) {
          setProfileAvatarUrl(curUser.photoURL);
        }
        if (curUser?.username && curUser.username.toLowerCase() !== 'listener') {
          setAccountUsername(curUser.username);
        }
        if (curUser?.uid) {
          const prof = await FirestoreService.getUserProfile(curUser.uid);
          if (prof?.username && prof.username.toLowerCase() !== 'listener') {
            setAccountUsername(prof.username);
            try { localStorage.setItem('lumen_user_handle', prof.username.toLowerCase()); } catch (_) {}
          }
          if (prof?.photoURL) {
            setProfileAvatarUrl(prof.photoURL);
            localStorage.setItem('lumen_user_avatar', prof.photoURL);
          }
          if (prof?.coverUrl) {
            setProfileCoverUrl(prof.coverUrl);
            localStorage.setItem('lumen_user_cover', prof.coverUrl);
          }
        }
      } catch (_) {}
    };
    if (isOpen) {
      fetchAccountProfile();
    }
  }, [isOpen]);

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = img.width;
        let height = img.height;
        const maxDim = type === 'avatar' ? 360 : 1000;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

        if (type === 'avatar') {
          setProfileAvatarUrl(dataUrl);
          try {
            localStorage.setItem('lumen_user_avatar', dataUrl);
            window.dispatchEvent(new Event('lumen-avatar-updated'));
          } catch (_) {}
          FirebaseAuthService.updateAvatarAndCover(dataUrl, undefined);
        } else {
          setProfileCoverUrl(dataUrl);
          try {
            localStorage.setItem('lumen_user_cover', dataUrl);
          } catch (_) {}
          FirebaseAuthService.updateAvatarAndCover(undefined, dataUrl);
        }
        WatchSoundService.playTick(1.2);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Live Autocomplete Artist Search Effect (Debounced 150ms with instant local preview)
  useEffect(() => {
    const q = artistSearchQuery.trim();
    if (!q) {
      setSearchedArtists([]);
      setIsSearchingArtists(false);
      return;
    }

    const lower = q.toLowerCase();
    // 1. Instant local matching for letter-by-letter responsiveness
    const localMatches: SearchedArtist[] = POPULAR_VERIFIED_ARTISTS
      .filter(a => a.name.toLowerCase().includes(lower))
      .map((a, i) => ({
        id: `pop_${i}_${a.name}`,
        name: a.name,
        genre: 'Verified Artist',
        avatarUrl: a.avatarUrl
      }));

    const formatted = q.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const initialList = [...localMatches];
    if (!initialList.some(a => a.name.toLowerCase() === lower)) {
      initialList.unshift({
        id: `custom_${q}`,
        name: formatted,
        genre: 'Add as Favorite Artist',
        avatarUrl: null
      });
    }
    setSearchedArtists(initialList);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setIsSearchingArtists(true);

    searchDebounceRef.current = setTimeout(async () => {
      try {
        const [remote, remoteTracks] = await Promise.all([
          ArtistService.searchArtists(q).catch(() => []),
          StreamingService.searchVerifiedTracks(q).catch(() => [])
        ]);

        const names = new Set(initialList.map(a => a.name.toLowerCase()));
        const combined = [...initialList];

        if (remote && remote.length > 0) {
          for (const r of remote) {
            if (!names.has(r.name.toLowerCase())) {
              combined.push({
                id: r.id || `remote_${r.name}`,
                name: r.name,
                genre: r.genre || 'Artist',
                avatarUrl: r.avatarUrl || null
              });
              names.add(r.name.toLowerCase());
            }
          }
        }

        if (remoteTracks && remoteTracks.length > 0) {
          for (const rt of remoteTracks) {
            if (rt.artist && !names.has(rt.artist.toLowerCase())) {
              combined.push({
                id: `track_art_${rt.id || rt.title}`,
                name: rt.artist,
                genre: `Artist of "${rt.title}"`,
                avatarUrl: rt.artworkUrl || null
              });
              names.add(rt.artist.toLowerCase());
            }
          }
        }

        setSearchedArtists(combined);
      } catch (err) {
        console.warn('Artist/Song search failed:', err);
      } finally {
        setIsSearchingArtists(false);
      }
    }, 150);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [artistSearchQuery]);

  // Load listening stats when Stats tab active or window changes
  useEffect(() => {
    if (activeTab === 'stats') {
      setIsLoadingStats(true);
      RatingAndStatsService.fetchListeningStats(statsWindow).then(data => {
        setStatsData(data);
        setIsLoadingStats(false);
      });
    }
  }, [activeTab, statsWindow]);

  // Handlers for Playback Settings
  const handleCrossfadeChange = (val: number) => {
    setCrossfade(val);
    AudioEngine.setCrossfade(val);
  };

  const handleToggleGapless = () => {
    const next = !isGapless;
    setIsGapless(next);
    AudioEngine.setGapless(next);
  };

  const handleToggleAutomix = () => {
    const next = !isAutomix;
    setIsAutomix(next);
    AudioEngine.setAutomix(next);
  };

  const handleToggleNormalized = () => {
    const next = !isNormalized;
    setIsNormalized(next);
    AudioEngine.setNormalisation(next);
  };

  const handleToggleAutoplay = () => {
    const next = !isAutoplayEnabled;
    setIsAutoplayEnabled(next);
    AudioEngine.setAutoplayEnabled(next);
  };

  const handleSetSleepTimer = (val: number | 'end_of_track' | 'off') => {
    setSleepTimerOption(val);
    if (val === 'off') {
      AudioEngine.setSleepTimer(null);
    } else if (val === 'end_of_track') {
      AudioEngine.setSleepTimer(-1);
    } else {
      AudioEngine.setSleepTimer(val);
    }
  };

  // Handlers for EQ
  const handleGainChange = (bandIndex: number, gain: number) => {
    const updated = [...eqGains];
    updated[bandIndex] = gain;
    setEqGains(updated);
    AudioEngine.setEQGains(updated);
    setActivePreset('Flat');
  };

  const handleApplyPreset = (name: EQPresetName) => {
    setActivePreset(name);
    const gains = AudioEngine.setEQPreset(name);
    setEqGains([...gains]);
  };

  // Handlers for Taste Profile
  const handleToggleGenre = (genre: string) => {
    const updated = PreferenceService.toggleGenre(genre);
    setPrefs({ ...updated });
    onPreferencesUpdated();
  };

  const handleToggleArtist = (artistName: string) => {
    const updated = PreferenceService.toggleArtist(artistName);
    setPrefs({ ...updated });
    onPreferencesUpdated();
  };

  const handleExportBackup = () => {
    const playlists = PlaylistService.getPlaylists();
    const liked = LikedService.getLikedTracks();
    const data = {
      exportDate: new Date().toISOString(),
      playlists,
      likedTracks: liked,
      preferences: prefs
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LUMEN_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const likedCount = LikedService.getLikedTracks().length;
  const playlistCount = PlaylistService.getPlaylists().length;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-2xl flex items-center justify-center p-3 sm:p-6 select-none animate-fadeIn"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[86vh] bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-black/85 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-[0_30px_90px_rgba(0,0,0,0.85)] flex flex-col md:flex-row overflow-hidden relative"
        style={{
          boxShadow: `0 30px 80px -20px rgba(0, 0, 0, 0.98), 0 0 50px -10px ${dominantColor}50`
        }}
      >
        {/* LEFT NAVIGATION SIDEBAR */}
        <div className="w-full md:w-64 bg-white/[0.03] backdrop-blur-2xl border-b md:border-b-0 md:border-r border-white/10 p-5 flex flex-col justify-between flex-shrink-0">
          <div>
            {/* Header Title */}
            <div className="flex items-center gap-2.5 pb-4 border-b border-white/10 mb-4">
              <div 
                className="w-8 h-8 rounded-xl flex items-center justify-center shadow-lg"
                style={{ backgroundColor: dominantColor }}
              >
                <Settings className="w-4 h-4 text-black stroke-[2.5]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">LUMEN Settings</h3>
                <span className="text-[10px] text-white/40 font-mono">Hi-Fi Audio Suite</span>
              </div>
            </div>

            {/* Sidebar Tab Buttons (Apple VisionOS Liquid Glass) */}
            <nav className="flex flex-col gap-1.5">
              <button
                onClick={() => setActiveTab('playback')}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left ${
                  activeTab === 'playback'
                    ? 'bg-white/15 text-white border border-white/25 backdrop-blur-2xl shadow-[0_4px_18px_rgba(6,182,212,0.25),inset_0_1px_1px_rgba(255,255,255,0.4)] font-bold'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Zap className={`w-4 h-4 ${activeTab === 'playback' ? 'text-lumen-cyan' : 'text-lumen-cyan/70'}`} />
                <span>Playback & Tuning</span>
              </button>

              <button
                onClick={() => setActiveTab('taste')}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left ${
                  activeTab === 'taste'
                    ? 'bg-white/15 text-white border border-white/25 backdrop-blur-2xl shadow-[0_4px_18px_rgba(168,85,247,0.25),inset_0_1px_1px_rgba(255,255,255,0.4)] font-bold'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Sparkles className={`w-4 h-4 ${activeTab === 'taste' ? 'text-lumen-violet' : 'text-lumen-violet/70'}`} />
                <span>Taste Profile</span>
              </button>

              <button
                onClick={() => setActiveTab('eq')}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left ${
                  activeTab === 'eq'
                    ? 'bg-white/15 text-white border border-white/25 backdrop-blur-2xl shadow-[0_4px_18px_rgba(16,185,129,0.25),inset_0_1px_1px_rgba(255,255,255,0.4)] font-bold'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Sliders className={`w-4 h-4 ${activeTab === 'eq' ? 'text-emerald-400' : 'text-emerald-400/70'}`} />
                <span>Audio Lab (EQ)</span>
              </button>

              <button
                onClick={() => setActiveTab('stats')}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left ${
                  activeTab === 'stats'
                    ? 'bg-white/15 text-white border border-white/25 backdrop-blur-2xl shadow-[0_4px_18px_rgba(56,189,248,0.25),inset_0_1px_1px_rgba(255,255,255,0.4)] font-bold'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <BarChart2 className={`w-4 h-4 ${activeTab === 'stats' ? 'text-cyan-400' : 'text-cyan-400/70'}`} />
                <span>Listening Stats</span>
              </button>

              <button
                onClick={() => setActiveTab('account')}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left ${
                  activeTab === 'account'
                    ? 'bg-white/15 text-white border border-white/25 backdrop-blur-2xl shadow-[0_4px_18px_rgba(251,191,36,0.25),inset_0_1px_1px_rgba(255,255,255,0.4)] font-bold'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <User className={`w-4 h-4 ${activeTab === 'account' ? 'text-amber-400' : 'text-amber-400/70'}`} />
                <span>Account & Data</span>
              </button>
            </nav>
          </div>

          {/* Quick Version Tag */}
          <div className="pt-4 border-t border-white/10 hidden md:block">
            <span className="text-[10px] font-mono text-white/30">LUMEN v2.5 Universal</span>
          </div>
        </div>

        {/* RIGHT CONTENT PANE */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white/[0.01] backdrop-blur-2xl">
          {/* Top Bar with Close Button */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              {activeTab === 'playback' && 'Audio Playback & Seamless Transitions'}
              {activeTab === 'taste' && 'Personalized Music Taste Profile'}
              {activeTab === 'eq' && '10-Band Graphic Equalizer'}
              {activeTab === 'stats' && 'Hi-Fi Listening Analytics & Ratings'}
              {activeTab === 'account' && 'User Account & Library Management'}
            </h4>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Tab Views */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">

            {/* TAB 1: PLAYBACK & TRANSITIONS */}
            {activeTab === 'playback' && (
              <div className="space-y-6 animate-fadeIn">
                {/* 0.0 Universal Album Backdrop & Appearance */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h5 className="text-xs font-bold text-white flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-lumen-cyan" />
                        <span>Universal Album Backdrop</span>
                      </h5>
                      <p className="text-[11px] text-white/50 mt-0.5">
                        Set a custom album cover (e.g. Pink Floyd) as your universal living ambient background across the entire app
                      </p>
                    </div>
                    {customBackdropUrl && (
                      <button
                        onClick={handleResetBackdrop}
                        className="text-[11px] text-red-400 hover:text-red-300 font-semibold px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 transition-colors"
                      >
                        Reset to Default
                      </button>
                    )}
                  </div>

                  {/* Backdrop Preview & Search Action */}
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-black/80 border border-white/15 flex-shrink-0 relative group">
                      {customBackdropUrl ? (
                        <img src={customBackdropUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-white/30 text-[10px] text-center p-1">
                          <Disc3 className="w-5 h-5 mb-0.5" />
                          <span>Default</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 text-center sm:text-left">
                      <div className="text-xs font-bold text-white truncate">
                        {customBackdropTitle || 'Dynamic Living Song Artwork'}
                      </div>
                      <div className="text-[11px] text-white/45 mt-0.5">
                        {customBackdropUrl ? 'Custom backdrop active' : 'Adapts automatically to the song you are currently listening to'}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAlbumSearchModal(true)}
                      className="px-4 py-2 rounded-xl bg-lumen-cyan/15 hover:bg-lumen-cyan/25 border border-lumen-cyan/35 text-lumen-cyan text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer flex-shrink-0"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>{customBackdropUrl ? 'Change Album' : 'Search Album Cover'}</span>
                    </button>
                  </div>

                  {/* Dual Mode Selector */}
                  {customBackdropUrl && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-bold text-white/70 uppercase tracking-wider">
                        Display Behavior
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleBackdropMode('persistent')}
                          className={`p-3 rounded-xl text-left border transition-all ${
                            backdropMode === 'persistent'
                              ? 'bg-lumen-cyan/15 border-lumen-cyan/40 text-white shadow-md'
                              : 'bg-white/[0.02] border-white/5 text-white/50 hover:text-white hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="text-xs font-bold">Always Persistent</div>
                          <div className="text-[10px] text-white/45 mt-0.5">
                            Keep this album art blurred across all views even while playing other songs
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleBackdropMode('dynamic')}
                          className={`p-3 rounded-xl text-left border transition-all ${
                            backdropMode === 'dynamic'
                              ? 'bg-lumen-cyan/15 border-lumen-cyan/40 text-white shadow-md'
                              : 'bg-white/[0.02] border-white/5 text-white/50 hover:text-white hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="text-xs font-bold">Dynamic Ambient</div>
                          <div className="text-[10px] text-white/45 mt-0.5">
                            Show when idle/home; switch to active song art during playback
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 0. Device Layout Mode Switcher */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-white">Device Layout Mode</h5>
                      <p className="text-[11px] text-white/50">Adapt UI for Phones, Tablets, or Desktop computers</p>
                    </div>
                    <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-lumen-cyan/15 text-lumen-cyan border border-lumen-cyan/30 capitalize">
                      Active: {deviceMode}
                    </span>
                  </div>

                {/* 0.1 10-Foot Android TV & Leanback Mode Toggle */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-lumen-cyan/10 border border-lumen-cyan/20 flex items-center justify-center text-lumen-cyan flex-shrink-0">
                      <Tv className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-white flex items-center gap-2">
                        <span>10-Foot TV & Leanback Mode</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-lumen-cyan/20 text-lumen-cyan border border-lumen-cyan/30">D-PAD & REMOTE</span>
                      </h5>
                      <p className="text-[11px] text-white/50">Large split-screen stage with kinetic lyrics and real-time karaoke</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleTvMode}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isTvMode 
                        ? 'bg-lumen-cyan text-black shadow-lg shadow-lumen-cyan/30' 
                        : 'bg-white/10 text-white/70 hover:text-white hover:bg-white/15'
                    }`}
                  >
                    {isTvMode ? 'Enabled' : 'Enable TV UI'}
                  </button>
                </div>

                {/* 0.2 TV Performance Profile (Smooth 60 FPS vs Full Effects) */}
                {isTvMode && (
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-white flex items-center gap-2">
                          <span>TV Graphics Performance</span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                            isUltraSmooth ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/10 text-white/60'
                          }`}>
                            {isUltraSmooth ? '60 FPS LOCKED' : 'DESKTOP EFFECTS'}
                          </span>
                        </h5>
                        <p className="text-[11px] text-white/50">
                          {isUltraSmooth 
                            ? 'High-performance dark glass mode (Zero lag & GPU stuttering on TV)' 
                            : 'Full multi-pass CSS blur shaders enabled'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={toggleGraphicsMode}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isUltraSmooth
                          ? 'bg-emerald-400 text-black shadow-lg shadow-emerald-400/30'
                          : 'bg-white/10 text-white/70 hover:text-white'
                      }`}
                    >
                      {isUltraSmooth ? 'Smooth 60 FPS' : 'Full Effects'}
                    </button>
                  </div>
                )}

                {/* 0.3 TV Remote Virtual Mouse Pointer Mode */}
                {isTvMode && (
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 flex-shrink-0">
                        <MousePointer2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-white flex items-center gap-2">
                          <span>TV Virtual Mouse Cursor</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">KEY 'C' TO TOGGLE</span>
                        </h5>
                        <p className="text-[11px] text-white/50">Control a smooth gliding pointer with your remote D-pad to select cards & buttons</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={toggleVirtualCursor}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isVirtualCursorEnabled
                          ? 'bg-purple-400 text-black shadow-lg shadow-purple-400/30'
                          : 'bg-white/10 text-white/70 hover:text-white'
                      }`}
                    >
                      {isVirtualCursorEnabled ? 'Cursor Active' : 'Classic D-Pad'}
                    </button>
                  </div>
                )}

                {/* 0.4 Beam Playlist to TV (QR Code) */}
                {onOpenTvBeam && (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-lumen-cyan/15 via-white/[0.03] to-transparent border border-lumen-cyan/30 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-lumen-cyan/20 border border-lumen-cyan/40 flex items-center justify-center text-lumen-cyan flex-shrink-0">
                        <QrCode className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-white flex items-center gap-2">
                          <span>Beam Playlist from Phone</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-lumen-cyan/20 text-lumen-cyan border border-lumen-cyan/30">QR CODE</span>
                        </h5>
                        <p className="text-[11px] text-white/50">Scan QR code on your phone to upload CSV tracklists or Spotify links to TV</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenTvBeam();
                      }}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-lumen-cyan text-black shadow-lg shadow-lumen-cyan/30 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                    >
                      Open QR Code
                    </button>
                  </div>
                )}

                  <div className="grid grid-cols-4 gap-2 pt-1">
                    {(['auto', 'phone', 'tablet', 'desktop'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setDeviceModeSetting(mode)}
                        className={`py-2 rounded-xl text-xs font-semibold capitalize transition-all text-center ${
                          deviceModeSetting === mode
                            ? 'bg-white text-black font-bold shadow-md'
                            : 'bg-white/5 text-white/70 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {mode === 'auto' ? 'Auto' : mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Native App Downloads Card (Android APK + Windows Desktop) */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-lumen-cyan/10 via-purple-500/10 to-transparent border border-lumen-cyan/30 space-y-3 relative overflow-hidden">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/20 shadow-md flex-shrink-0 bg-black/60">
                      <img 
                        src="./logo.png" 
                        alt="Lumen" 
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (!target.src.endsWith('icon.png')) {
                            target.src = './icon.png';
                          }
                        }}
                        className="w-full h-full object-cover" 
                      />
                    </div>
                    <div className="min-w-0">
                      <h5 className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                        <span>Download Lumen Native Apps</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Latest Build</span>
                      </h5>
                      <p className="text-[11px] text-white/60">Always serves the newest Android APK & Windows Desktop installer</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <a
                      href={`${ApiClient.resolveUrl('/download/apk')}?v=${Date.now()}`}
                      download="Lumen.apk"
                      className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-lumen-cyan to-blue-500 text-black font-bold text-xs shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Android App (.apk)</span>
                    </a>
                    <a
                      href={`${ApiClient.resolveUrl('/download/windows')}?v=${Date.now()}`}
                      download="Lumen-Setup.exe"
                      className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white font-bold text-xs shadow-lg active:scale-95 transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-lumen-cyan" />
                      <span>Windows App (.exe)</span>
                    </a>
                  </div>

                  <div className="text-[10px] text-white/50 flex items-center justify-between pt-2 border-t border-white/10">
                    <span className="truncate max-w-[220px] sm:max-w-xs">Download Portal: {typeof window !== 'undefined' ? `${window.location.origin}/download` : '/download'}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                          navigator.clipboard.writeText(`${window.location.origin}/download`);
                          alert('Download portal link copied to clipboard!');
                        }
                      }}
                      className="text-lumen-cyan hover:underline flex items-center gap-1 flex-shrink-0"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy Portal Link</span>
                    </button>
                  </div>
                </div>

                {/* 0.5 Unrestricted Background Playback (Mobile Android) */}
                {isNativeAndroid() && (
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                        isBatteryExempt ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                      }`}>
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-white flex items-center gap-2">
                          <span>Unrestricted Background Playback</span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            isBatteryExempt 
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                              : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          }`}>
                            {isBatteryExempt ? 'UNRESTRICTED' : 'BATTERY RESTRICTED'}
                          </span>
                        </h5>
                        <p className="text-[11px] text-white/50">
                          {isBatteryExempt
                            ? 'Screen-off streaming enabled. Music will play continuously when phone is locked or in your bag.'
                            : 'Exempt Lumen from battery saver so next songs stream without stopping when screen is off.'}
                        </p>
                      </div>
                    </div>
                    {!isBatteryExempt && (
                      <button
                        type="button"
                        onClick={handleRequestBackgroundPermission}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-400 text-black shadow-lg shadow-amber-400/20 hover:scale-105 active:scale-95 transition-all cursor-pointer flex-shrink-0 self-end sm:self-center"
                      >
                        Grant Permission
                      </button>
                    )}
                  </div>
                )}

                {/* 1. Crossfade Slider */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-white">Crossfade</h5>
                      <p className="text-[11px] text-white/50">Seamlessly fade out the ending song into the next</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-lumen-cyan/20 border border-lumen-cyan/40 text-lumen-cyan font-mono text-xs font-bold">
                      {crossfade === 0 ? 'Off' : `${crossfade}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="12"
                    step="1"
                    value={crossfade}
                    onChange={(e) => handleCrossfadeChange(Number(e.target.value))}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-lumen-cyan"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-white/40">
                    <span>0s (Off)</span>
                    <span>3s (Default)</span>
                    <span>6s</span>
                    <span>9s</span>
                    <span>12s</span>
                  </div>
                </div>

                {/* 1b. Personalized Autoplay */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-3">
                  <div>
                    <h5 className="text-xs font-bold text-white">Personalized Autoplay</h5>
                    <p className="text-[10px] text-white/50 mt-0.5">
                      Continues after your queue ends using your taste, playlists, and current session
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleAutoplay}
                    className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-1 flex-shrink-0 cursor-pointer ${
                      isAutoplayEnabled ? 'bg-lumen-cyan' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-black shadow-md transition-transform ${
                        isAutoplayEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* 1d. Over-the-Air (OTA) App Updates */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h5 className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                        <span>Over-the-Air Updates</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/15">
                          v{otaSnap.currentVersion}
                          {otaSnap.platform === 'android' && otaSnap.nativeVersionCode ? ` (build ${otaSnap.nativeVersionCode})` : ''}
                        </span>
                      </h5>
                      <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed">
                        {otaSnap.message ||
                          (otaSnap.platform === 'android'
                            ? 'UI updates apply automatically in the background; native updates install with one tap.'
                            : otaSnap.platform === 'windows'
                              ? 'Windows updates download automatically from GitHub Releases and install on restart.'
                              : 'Web version stays up to date automatically.')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {otaSnap.state === 'web_ready_to_apply' ? (
                        <button
                          type="button"
                          onClick={() => OtaUpdateService.applyWebUpdateNow()}
                          className="px-3.5 py-1.5 rounded-xl bg-lumen-cyan text-black text-xs font-extrabold shadow-md cursor-pointer"
                        >
                          Apply Now
                        </button>
                      ) : otaSnap.state === 'apk_available' || otaSnap.state === 'apk_needs_permission' ? (
                        <button
                          type="button"
                          onClick={() => OtaUpdateService.startApkInstall()}
                          className="px-3.5 py-1.5 rounded-xl bg-lumen-cyan text-black text-xs font-extrabold shadow-md cursor-pointer"
                        >
                          Download & Install
                        </button>
                      ) : otaSnap.state === 'windows_ready_to_restart' ? (
                        <button
                          type="button"
                          onClick={() => OtaUpdateService.installWindowsUpdateNow()}
                          className="px-3.5 py-1.5 rounded-xl bg-lumen-cyan text-black text-xs font-extrabold shadow-md cursor-pointer"
                        >
                          Restart to Update
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={
                            otaSnap.state === 'checking' ||
                            otaSnap.state === 'web_downloading' ||
                            otaSnap.state === 'apk_downloading' ||
                            otaSnap.state === 'windows_downloading'
                          }
                          onClick={() => OtaUpdateService.checkForUpdates({ silent: false })}
                          className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-lumen-cyan cursor-pointer disabled:opacity-50"
                        >
                          {otaSnap.state === 'checking'
                            ? 'Checking...'
                            : otaSnap.state === 'web_downloading' ||
                                otaSnap.state === 'apk_downloading' ||
                                otaSnap.state === 'windows_downloading'
                              ? `${otaSnap.percent}%`
                              : 'Check for Updates'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 1e. Storage & Cache Cleanup */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h5 className="text-xs font-bold text-white">Storage &amp; Image Cache</h5>
                    <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed">
                      {cacheClearStatus ||
                        'Clear cached album artwork and leftover temporary files without signing out or losing playlists.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isClearingCache}
                    onClick={handleClearAppCache}
                    className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isClearingCache ? 'Clearing...' : 'Clear Cache'}
                  </button>
                </div>

                {/* 2. Seamless Automix & Gapless Playback */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-white">Automix</h5>
                      <p className="text-[10px] text-white/50 mt-0.5">Smooth beat-matched track transitions</p>
                    </div>
                    <button
                      onClick={handleToggleAutomix}
                      className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-1 ${
                        isAutomix ? 'bg-lumen-cyan' : 'bg-white/15'
                      }`}
                    >
                      <div 
                        className={`w-4 h-4 rounded-full bg-black shadow-md transition-transform ${
                          isAutomix ? 'translate-x-5' : 'translate-x-0'
                        }`} 
                      />
                    </button>
                  </div>

                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-white">Gapless Playback</h5>
                      <p className="text-[10px] text-white/50 mt-0.5">Zero silence between consecutive tracks</p>
                    </div>
                    <button
                      onClick={handleToggleGapless}
                      className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-1 ${
                        isGapless ? 'bg-lumen-cyan' : 'bg-white/15'
                      }`}
                    >
                      <div 
                        className={`w-4 h-4 rounded-full bg-black shadow-md transition-transform ${
                          isGapless ? 'translate-x-5' : 'translate-x-0'
                        }`} 
                      />
                    </button>
                  </div>
                </div>

                {/* 3. Volume Normalization */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Volume2 className="w-5 h-5 text-lumen-cyan flex-shrink-0" />
                    <div>
                      <h5 className="text-xs font-bold text-white">Normalize Volume</h5>
                      <p className="text-[11px] text-white/50">Maintain consistent audio levels across all verified tracks (EBU R128)</p>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleNormalized}
                    className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-1 ${
                      isNormalized ? 'bg-lumen-cyan' : 'bg-white/15'
                    }`}
                  >
                    <div 
                      className={`w-4 h-4 rounded-full bg-black shadow-md transition-transform ${
                        isNormalized ? 'translate-x-5' : 'translate-x-0'
                      }`} 
                    />
                  </button>
                </div>

                {/* 4. Sleep Timer */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center gap-2">
                    <Moon className="w-4 h-4 text-lumen-violet" />
                    <h5 className="text-xs font-bold text-white">Sleep Timer</h5>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['off', 15, 30, 45, 60, 'end_of_track'] as const).map((opt) => (
                      <button
                        key={String(opt)}
                        onClick={() => handleSetSleepTimer(opt)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          sleepTimerOption === opt
                            ? 'bg-lumen-violet text-white font-bold shadow-md'
                            : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10'
                        }`}
                      >
                        {opt === 'off' && 'Off'}
                        {typeof opt === 'number' && `${opt} mins`}
                        {opt === 'end_of_track' && 'End of Song'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 5. Audio Streaming Quality */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2.5">
                  <h5 className="text-xs font-bold text-white">Streaming Quality</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      onClick={() => setAudioQuality('opus')}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        audioQuality === 'opus'
                          ? 'border-lumen-cyan bg-lumen-cyan/10 text-white shadow-lg'
                          : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">Opus 48kHz Hi-Fi</div>
                      <div className="text-[10px] text-white/50 mt-0.5">Studio Dynamic Range (Recommended)</div>
                    </button>

                    <button
                      onClick={() => setAudioQuality('lossless')}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        audioQuality === 'lossless'
                          ? 'border-lumen-cyan bg-lumen-cyan/10 text-white shadow-lg'
                          : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">320kbps Studio</div>
                      <div className="text-[10px] text-white/50 mt-0.5">High Bitrate Audio</div>
                    </button>

                    <button
                      onClick={() => setAudioQuality('balanced')}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        audioQuality === 'balanced'
                          ? 'border-lumen-cyan bg-lumen-cyan/10 text-white shadow-lg'
                          : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">Balanced 160kbps</div>
                      <div className="text-[10px] text-white/50 mt-0.5">Data-Saving Profile</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: TASTE PROFILE (WITH LIVE AUTOCOMPLETE REAL ARTIST SEARCH) */}
            {activeTab === 'taste' && (
              <div className="space-y-6 animate-fadeIn">
                {/* 1. Live Autocomplete Artist Search (As user types, real photos appear!) */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-lumen-cyan" />
                      <h5 className="text-xs font-bold text-white">Search Any Artist or Song</h5>
                    </div>
                    {isSearchingArtists && (
                      <span className="text-[10px] font-mono text-lumen-cyan animate-pulse">Predicting artists & songs...</span>
                    )}
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={artistSearchQuery}
                      onChange={(e) => setArtistSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && artistSearchQuery.trim()) {
                          handleToggleArtist(artistSearchQuery.trim());
                          setArtistSearchQuery('');
                        }
                      }}
                      placeholder="Type artist name or song title (e.g. Drake, Starboy, Taylor Swift, Billie Eilish)..."
                      className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan transition-colors"
                      autoFocus
                    />
                    {artistSearchQuery && (
                      <button
                        onClick={() => setArtistSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Autocomplete Results Grid (Real Artist Photos) */}
                  {searchedArtists.length > 0 && (
                    <div className="pt-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-white/50 mb-2 block font-bold">
                        Matching Verified Artists (Click to Select)
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto no-scrollbar p-1">
                        {searchedArtists.map((artist) => {
                          const isSelected = prefs.favoriteArtists.includes(artist.name);
                          return (
                            <button
                              key={artist.id}
                              onClick={() => handleToggleArtist(artist.name)}
                              className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
                                isSelected
                                  ? 'bg-lumen-cyan/20 border-lumen-cyan text-white shadow-md scale-105'
                                  : 'bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {artist.avatarUrl ? (
                                <img
                                  src={artist.avatarUrl}
                                  alt={artist.name}
                                  className="w-8 h-8 rounded-full object-cover border border-white/20 flex-shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-white/50 text-[10px] font-bold">
                                  {artist.name.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-bold truncate block">{artist.name}</span>
                                <span className="text-[9px] text-white/40 truncate block">{artist.genre}</span>
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-lumen-cyan stroke-[3] ml-auto" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Active Selected Artists Chips */}
                {prefs.favoriteArtists.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-mono uppercase tracking-wider text-white/70 font-bold block">
                      Selected Favorite Artists ({prefs.favoriteArtists.length})
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {prefs.favoriteArtists.map((name) => (
                        <div
                          key={name}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-xs text-white shadow-sm"
                        >
                          <span>{name}</span>
                          <button
                            onClick={() => handleToggleArtist(name)}
                            className="text-white/50 hover:text-red-400 ml-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Popular Artists Catalog */}
                <div className="space-y-2.5">
                  <span className="text-xs font-mono uppercase tracking-wider text-white/70 font-bold block">
                    Popular Verified Artists
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {POPULAR_VERIFIED_ARTISTS.map((artist) => {
                      const isSelected = prefs.favoriteArtists.includes(artist.name);
                      return (
                        <button
                          key={artist.name}
                          onClick={() => handleToggleArtist(artist.name)}
                          className={`flex items-center gap-2.5 p-2 rounded-2xl border transition-all text-left ${
                            isSelected
                              ? 'bg-white/20 border-white/40 text-white shadow-lg scale-102'
                              : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          <img
                            src={artist.avatarUrl}
                            alt={artist.name}
                            className="w-8 h-8 rounded-full object-cover border border-white/20"
                          />
                          <span className="text-xs font-medium truncate flex-1">{artist.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-lumen-cyan stroke-[3] ml-auto mr-1" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Favorite Genres */}
                <div className="space-y-2.5 pt-2 border-t border-white/10">
                  <span className="text-xs font-mono uppercase tracking-wider text-white/70 font-bold block">
                    Favorite Genres ({prefs.favoriteGenres.length} selected)
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {POPULAR_GENRES.map((genre) => {
                      const isSelected = prefs.favoriteGenres.includes(genre);
                      return (
                        <button
                          key={genre}
                          onClick={() => handleToggleGenre(genre)}
                          className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-white text-black font-bold shadow-md scale-105'
                              : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/15 border border-white/10'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          <span>{genre}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: AUDIO LAB (10-BAND GRAPHIC EQUALIZER) */}
            {activeTab === 'eq' && (
              <div className="space-y-6 animate-fadeIn">
                {/* Acoustic Presets */}
                <div className="space-y-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-white/60 font-bold block">
                    Acoustic Tuning Presets
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(['Flat', 'Bass Boost', 'Rock', 'Electronic', 'Vocal', 'Jazz'] as EQPresetName[]).map((name) => (
                      <button
                        key={name}
                        onClick={() => handleApplyPreset(name)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                          activePreset === name
                            ? 'bg-emerald-400 text-black font-bold shadow-md scale-105'
                            : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 10-Band Sliders */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10">
                  <div className="flex items-center justify-between gap-2 overflow-x-auto py-2 no-scrollbar">
                    {EQ_FREQUENCIES.map((freq, idx) => {
                      const gain = eqGains[idx] || 0;
                      return (
                        <div key={freq} className="flex flex-col items-center gap-3 min-w-[3rem]">
                          <span className="text-[10px] font-mono text-white/60">
                            {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)} dB
                          </span>
                          <div className="h-40 flex items-center justify-center">
                            <input
                              type="range"
                              min="-12"
                              max="12"
                              step="0.5"
                              value={gain}
                              onChange={(e) => handleGainChange(idx, Number(e.target.value))}
                              className="h-32 -rotate-90 appearance-none bg-white/15 rounded-full cursor-pointer accent-emerald-400"
                            />
                          </div>
                          <span className="text-[10px] font-mono font-bold text-white/70">
                            {freq >= 1000 ? `${freq / 1000}k` : `${freq}Hz`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ACCOUNT & STATS */}
            {activeTab === 'account' && (
              <div className="space-y-6 animate-fadeIn">
                {/* 3D Apple Liquid Glass Profile Banner & Avatar Upload Card */}
                <div className="relative rounded-3xl overflow-hidden border border-white/15 bg-white/[0.04] shadow-2xl backdrop-blur-2xl">
                  {/* Hidden file upload inputs */}
                  <input
                    type="file"
                    ref={coverFileRef}
                    onChange={(e) => handleUploadImage(e, 'cover')}
                    accept="image/*"
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={avatarFileRef}
                    onChange={(e) => handleUploadImage(e, 'avatar')}
                    accept="image/*"
                    className="hidden"
                  />

                  {/* Top Cover Banner */}
                  <div className="relative h-32 sm:h-40 w-full overflow-hidden bg-gradient-to-r from-purple-900/40 via-indigo-900/30 to-black/60 group">
                    {profileCoverUrl ? (
                      <img
                        src={profileCoverUrl}
                        alt="Profile Banner"
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <div 
                        className="w-full h-full opacity-60"
                        style={{
                          background: `radial-gradient(ellipse at top right, ${dominantColor}50, transparent 70%), linear-gradient(to bottom, #151828, #070913)`
                        }}
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />

                    {/* Change Cover Button */}
                    <button
                      type="button"
                      onClick={() => coverFileRef.current?.click()}
                      className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white/90 hover:text-white border border-white/20 backdrop-blur-xl text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-lg cursor-pointer"
                      title="Upload custom cover banner"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-lumen-cyan" />
                      <span>Change Cover</span>
                    </button>
                  </div>

                  {/* Profile Info & Avatar */}
                  <div className="px-5 pb-5 pt-0 -mt-10 sm:-mt-12 flex flex-col sm:flex-row sm:items-end justify-between gap-4 relative z-10">
                    <div className="flex items-end gap-3.5">
                      {/* Avatar with Camera badge */}
                      <div className="relative group cursor-pointer" onClick={() => avatarFileRef.current?.click()}>
                        <div 
                          className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-4 border-black/90 shadow-2xl flex items-center justify-center bg-black/80"
                          style={{
                            boxShadow: `0 10px 30px rgba(0,0,0,0.9), 0 0 25px -4px ${dominantColor}60`
                          }}
                        >
                          {profileAvatarUrl ? (
                            <img src={profileAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <div 
                              className="w-full h-full flex items-center justify-center text-2xl font-black text-white"
                              style={{ background: `radial-gradient(circle at 30% 30%, ${dominantColor}, #111521)` }}
                            >
                              {(accountUsername || 'U').charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        {/* Camera upload badge */}
                        <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                          <Camera className="w-5 h-5 text-lumen-cyan" />
                        </div>
                        <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-lumen-cyan border-2 border-black flex items-center justify-center shadow-md">
                          <Camera className="w-3 h-3 text-black stroke-[2.5]" />
                        </div>
                      </div>

                      <div className="mb-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-lg sm:text-xl font-black text-white">
                            @{accountUsername || RatingAndStatsService.getUsername()}
                          </h4>
                          <ShieldCheck className="w-4 h-4 text-lumen-cyan" />
                        </div>
                        <p className="text-xs text-white/60">
                          {ApiClient.isCapacitor() ? 'Hi-Fi Mobile Tier • Cloud Engine' : 'Hi-Fi Audiophile Tier • Local & Cloud'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          if (onOpenAccountSwitcher) onOpenAccountSwitcher();
                          else if (onOpenAuthModal) onOpenAuthModal();
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        <Users className="w-3.5 h-3.5 text-lumen-cyan" />
                        <span>Switch Account</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          FirebaseAuthService.signOut();
                          onClose();
                          if (onOpenAuthModal) onOpenAuthModal();
                        }}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Unique Username & Tag Section */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <AtSign className="w-3.5 h-3.5 text-lumen-cyan" />
                        <span>Your Unique Username</span>
                      </h5>
                      <p className="text-[11px] text-white/50">Your identifier for friends to find, connect, and share music with you.</p>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Unique & Active
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-black/40 border border-white/15">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold font-mono text-white">
                        @{accountUsername || RatingAndStatsService.getUsername()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const tag = accountUsername || RatingAndStatsService.getUsername();
                          navigator.clipboard?.writeText(`@${tag}`);
                          setCopiedAccountTag(true);
                          setTimeout(() => setCopiedAccountTag(false), 2000);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedAccountTag ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedAccountTag ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button
                        onClick={() => setIsEditUsernameModalOpen(true)}
                        className="px-3.5 py-1.5 rounded-xl bg-lumen-cyan/20 hover:bg-lumen-cyan/30 text-lumen-cyan border border-lumen-cyan/40 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Change Username</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Listening Metrics & Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-center">
                    <span className="text-2xl font-black text-white block">{playlistCount}</span>
                    <span className="text-[11px] font-mono text-white/50 uppercase">Custom Playlists</span>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-center">
                    <span className="text-2xl font-black text-white block">{likedCount}</span>
                    <span className="text-[11px] font-mono text-white/50 uppercase">Liked Songs</span>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-center col-span-2 sm:col-span-1">
                    <span className="text-2xl font-black text-white block">{prefs.favoriteArtists.length}</span>
                    <span className="text-[11px] font-mono text-white/50 uppercase">Favorite Artists</span>
                  </div>
                </div>

                {/* Download Native App (Mobile APK & Windows Desktop Installer) */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-lumen-cyan/10 via-blue-500/10 to-transparent border border-lumen-cyan/25 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h5 className="text-xs font-bold text-white flex items-center gap-2">
                        <Download className="w-3.5 h-3.5 text-lumen-cyan" />
                        <span>Download Lumen Native App</span>
                      </h5>
                      <p className="text-[11px] text-white/55 mt-0.5">Always serves the latest compiled Mobile & Windows builds</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <a
                      href={`${ApiClient.resolveUrl('/download/apk')}?v=${Date.now()}`}
                      download="Lumen.apk"
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-lumen-cyan to-blue-500 text-black font-bold text-xs shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Android (.apk)</span>
                    </a>
                    <a
                      href={`${ApiClient.resolveUrl('/download/windows')}?v=${Date.now()}`}
                      download="Lumen-Setup.exe"
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white font-bold text-xs shadow-lg active:scale-95 transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-lumen-cyan" />
                      <span>Download Windows (.exe)</span>
                    </a>
                  </div>
                </div>

                {/* Spotify Web API Integration (100+ Song Direct Pagination) */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-400" />
                      <h5 className="text-xs font-bold text-white">Spotify Web API Integration (100+ Songs)</h5>
                    </div>
                    {spotifyClientId && spotifyClientSecret ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono border border-emerald-500/30 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Configured
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/50 text-[10px] font-mono">
                        Optional
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/50 leading-relaxed">
                    Allows LUMEN to paginate directly through Spotify's Web API to automatically import full playlists with 100+ tracks from links. Get your free Client ID & Secret from{' '}
                    <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="text-lumen-cyan underline">
                      developer.spotify.com
                    </a>.
                  </p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-mono text-white/60 mb-1">Spotify Client ID</label>
                      <input
                        type="text"
                        value={spotifyClientId}
                        onChange={(e) => setSpotifyClientId(e.target.value)}
                        placeholder="Paste Client ID..."
                        className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-white/60 mb-1">Spotify Client Secret</label>
                      <div className="relative">
                        <input
                          type={showSecret ? "text" : "password"}
                          value={spotifyClientSecret}
                          onChange={(e) => setSpotifyClientSecret(e.target.value)}
                          placeholder="Paste Client Secret..."
                          className="w-full px-3 py-2 pr-16 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret(prev => !prev)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-white/50 hover:text-white px-1.5 py-0.5 rounded"
                        >
                          {showSecret ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-white/40">
                      Credentials are saved safely in your local browser profile.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.setItem('lumen_spotify_client_id', spotifyClientId.trim());
                        localStorage.setItem('lumen_spotify_client_secret', spotifyClientSecret.trim());
                        setIsSpotifySaved(true);
                        setTimeout(() => setIsSpotifySaved(false), 2000);
                      }}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all"
                    >
                      {isSpotifySaved ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Saved!</span>
                        </>
                      ) : (
                        <span>Save Credentials</span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Backup & Export Controls */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <h5 className="text-xs font-bold text-white">Backup & Data Portability</h5>
                  <p className="text-[11px] text-white/50">Export your playlists, liked songs, and listening preferences to a local JSON file.</p>
                  <button
                    onClick={handleExportBackup}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:scale-105 transition-transform shadow-lg"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Library Backup</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 5: LISTENING STATISTICS */}
            {activeTab === 'stats' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                {/* Header & Window Filter */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                  <div>
                    <h4 className="text-base font-bold text-white tracking-tight">Listening Statistics</h4>
                    <p className="text-xs text-white/50">Playback telemetry calculated with 80% qualified play threshold.</p>
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl">
                    {(['30d', '90d', 'all'] as const).map(w => (
                      <button
                        key={w}
                        onClick={() => setStatsWindow(w)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                          statsWindow === w
                            ? 'bg-white text-black shadow-md font-bold'
                            : 'text-white/60 hover:text-white'
                        }`}
                      >
                        {w === '30d' ? '30 Days' : w === '90d' ? '90 Days' : 'All Time'}
                      </button>
                    ))}
                  </div>
                </div>

                {isLoadingStats ? (
                  <div className="py-12 text-center text-xs text-white/50">Calculating listening statistics...</div>
                ) : (
                  <>
                    {/* Metric Cards Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                        <span className="text-[10px] uppercase font-mono text-white/40 tracking-wider">Total Plays</span>
                        <div className="text-2xl font-bold font-mono text-white mt-1">
                          {statsData?.summary?.total_plays ?? statsData?.chronological_log?.length ?? 0}
                        </div>
                        <span className="text-[10px] text-white/40">
                          {statsData?.summary?.qualified_plays ?? 0} qualified
                        </span>
                      </div>

                      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                        <span className="text-[10px] uppercase font-mono text-white/40 tracking-wider">Listening Time</span>
                        <div className="text-2xl font-bold font-mono text-lumen-cyan mt-1">
                          {statsData?.summary?.total_listening_duration_formatted ?? '0m'}
                        </div>
                        <span className="text-[10px] text-white/40">cumulative</span>
                      </div>

                      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                        <span className="text-[10px] uppercase font-mono text-white/40 tracking-wider">Completion Rate</span>
                        <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                          {statsData?.summary?.completion_rate_percent ?? 100}%
                        </div>
                        <span className="text-[10px] text-white/40">≥80% duration</span>
                      </div>

                      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                        <span className="text-[10px] uppercase font-mono text-white/40 tracking-wider">Rated Tracks</span>
                        <div className="text-2xl font-bold font-mono text-amber-400 mt-1">
                          {statsData?.rating_stats?.highest_rated?.length ?? 0}
                        </div>
                        <span className="text-[10px] text-white/40">0.1 - 10.0 scale</span>
                      </div>
                    </div>

                    {/* Top Played Artists */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-bold text-white uppercase tracking-wider text-white/70">Top Played Artists</h5>
                        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/5 border border-white/10 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setArtistSortMode('plays')}
                            className={`px-2 py-0.5 rounded font-semibold transition-all ${
                              artistSortMode === 'plays' ? 'bg-white text-black font-bold' : 'text-white/60 hover:text-white'
                            }`}
                          >
                            Most Plays
                          </button>
                          <button
                            type="button"
                            onClick={() => setArtistSortMode('time')}
                            className={`px-2 py-0.5 rounded font-semibold transition-all ${
                              artistSortMode === 'time' ? 'bg-white text-black font-bold' : 'text-white/60 hover:text-white'
                            }`}
                          >
                            Most Time
                          </button>
                        </div>
                      </div>

                      {statsData?.top_artists && statsData.top_artists.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[...statsData.top_artists]
                            .sort((a, b) => artistSortMode === 'plays' 
                              ? b.play_count - a.play_count 
                              : b.total_duration_seconds - a.total_duration_seconds)
                            .slice(0, 6)
                            .map((art, idx) => (
                              <div key={art.artist || idx} className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/10 flex items-center justify-center font-bold text-xs text-white flex-shrink-0">
                                    {idx + 1}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-white truncate">{art.artist}</div>
                                    <div className="text-[11px] text-white/45">
                                      {artistSortMode === 'time' ? `${art.play_count} plays recorded` : `${art.total_duration_formatted} listened`}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  {artistSortMode === 'time' ? (
                                    <>
                                      <span className="text-xs font-mono font-bold text-amber-300">{art.total_duration_formatted}</span>
                                      <span className="text-[10px] text-white/40 ml-1">total</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-xs font-mono font-bold text-lumen-cyan">{art.play_count}</span>
                                      <span className="text-[10px] text-white/40 ml-1">plays</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="p-6 text-center rounded-2xl bg-white/[0.02] border border-white/10 text-white/40 text-xs">
                          No artist listening history accumulated for this timeframe yet.
                        </div>
                      )}
                    </div>

                    {/* Top Played Tracks */}
                    <div className="space-y-3">
                      <h5 className="text-xs font-bold text-white uppercase tracking-wider text-white/70">Top Played Tracks</h5>
                      {statsData?.top_songs && statsData.top_songs.length > 0 ? (
                        <div className="divide-y divide-white/5 rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
                          {statsData.top_songs.slice(0, 8).map((song, idx) => (
                            <div key={song.song_id || idx} className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-5 text-center font-mono text-xs text-white/40 font-bold">{idx + 1}</span>
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-white truncate">{song.title}</div>
                                  <div className="text-[11px] text-white/50 truncate">{song.artist}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 flex-shrink-0">
                                <div className="text-right">
                                  <span className="text-xs font-mono font-bold text-white">{song.play_count}</span>
                                  <span className="text-[10px] text-white/40 ml-1">plays</span>
                                </div>
                                {song.rating_formatted ? (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-[11px] font-bold">
                                    ★ {song.rating_formatted}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-mono text-white/30 px-2 py-0.5 rounded bg-white/5">Unrated</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center rounded-2xl bg-white/[0.02] border border-white/10 text-white/40 text-xs">
                          No playback activity recorded in this period yet. Plays count when hearing at least 80% of a track.
                        </div>
                      )}
                    </div>

                    {/* Top Duration Tracks & Highest Rated Tracks */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <h5 className="text-xs font-bold text-white/70 uppercase tracking-wider">Most Listened By Duration</h5>
                        <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-3 space-y-2">
                          {statsData?.top_duration_songs && statsData.top_duration_songs.length > 0 ? (
                            statsData.top_duration_songs.slice(0, 5).map((song, i) => (
                              <div key={song.song_id || i} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-none">
                                <div className="truncate min-w-0 pr-2">
                                  <span className="font-semibold text-white">{song.title}</span>
                                  <span className="text-white/40 text-[10px] ml-1.5">— {song.artist}{(song as any).play_count > 0 ? ` (${(song as any).play_count} plays)` : ''}</span>
                                </div>
                                <span className="font-mono text-xs text-lumen-cyan font-semibold flex-shrink-0">
                                  {song.total_duration_formatted || `${Math.round(song.total_duration_seconds / 60)}m`}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="text-white/30 text-xs text-center py-4">No data</div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h5 className="text-xs font-bold text-white/70 uppercase tracking-wider">Highest Rated Songs</h5>
                        <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-3 space-y-2">
                          {statsData?.rating_stats?.highest_rated && statsData.rating_stats.highest_rated.length > 0 ? (
                            statsData.rating_stats.highest_rated.slice(0, 5).map((song, i) => (
                              <div key={song.song_id || i} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-none">
                                <div className="truncate min-w-0 pr-2">
                                  <span className="font-semibold text-white">{song.title}</span>
                                  <span className="text-white/40 text-[10px] ml-1.5">— {song.artist}</span>
                                </div>
                                <span className="font-mono text-xs text-amber-300 font-bold flex-shrink-0">
                                  ★ {(song as any).rating_formatted || song.formatted || (song as any).rating_value || ''}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="text-white/30 text-xs text-center py-4">No rated tracks yet</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}


          </div>
        </div>
      </div>

      {/* Album Search Modal for Custom Backdrop (Pink Floyd etc.) */}
      {showAlbumSearchModal && (
        <div 
          onClick={() => setShowAlbumSearchModal(false)}
          className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-3xl bg-[#0c0f17] border border-white/20 p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col animate-scaleUp"
          >
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">Search Album Cover</h4>
                <p className="text-xs text-white/50">Find any studio album cover (e.g. Pink Floyd, Daft Punk, Radiohead)</p>
              </div>
              <button
                onClick={() => setShowAlbumSearchModal(false)}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-white/40" />
              <input
                type="text"
                autoFocus
                value={albumSearchQuery}
                onChange={(e) => handleSearchAlbums(e.target.value)}
                placeholder="Search by album title or artist (e.g. Pink Floyd)..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
              />
            </div>

            {/* Album results grid */}
            <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[520px] no-scrollbar pr-1">
              {isSearchingAlbums ? (
                <div className="h-40 flex items-center justify-center text-xs text-white/40 gap-2">
                  <Sparkles className="w-4 h-4 text-lumen-cyan animate-spin" />
                  <span>Searching verified high-res album art...</span>
                </div>
              ) : albumSearchResults.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {albumSearchResults.map((alb) => (
                    <div
                      key={alb.id}
                      onClick={() => handleSelectBackdropAlbum(alb)}
                      className="group p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-lumen-cyan/50 cursor-pointer transition-all space-y-2 text-center"
                    >
                      <div className="aspect-square w-full rounded-xl overflow-hidden bg-black/80 relative shadow-lg">
                        <CoverImage 
                          src={alb.artworkUrl || null} 
                          alt={alb.title} 
                          title={alb.title}
                          artist={alb.artist}
                          size={600}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{alb.title}</div>
                          <div className="text-[11px] text-white/50 truncate">{alb.artist}</div>
                          {alb.year && (
                            <div className="text-[10px] text-white/30 font-mono mt-0.5">{alb.year}</div>
                          )}
                        </div>
                    </div>
                  ))}
                </div>
              ) : albumSearchQuery.trim() ? (
                <div className="h-40 flex items-center justify-center text-xs text-white/40">
                  No albums found matching "{albumSearchQuery}".
                </div>
              ) : (
                <div className="h-40 flex flex-col items-center justify-center text-xs text-white/40 text-center space-y-1">
                  <Disc3 className="w-8 h-8 text-white/20 mb-1" />
                  <p>Type an artist or album name above</p>
                  <p className="text-[10px] text-white/30">e.g. "Pink Floyd", "The Dark Side of the Moon", "Abbey Road"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Username Setup / Edit Modal */}
      <UsernameSetupModal
        isOpen={isEditUsernameModalOpen}
        userId={RatingAndStatsService.getUserId()}
        currentUsername={accountUsername || RatingAndStatsService.getUsername()}
        onComplete={(newU) => {
          setAccountUsername(newU);
          setIsEditUsernameModalOpen(false);
          onPreferencesUpdated();
        }}
        canDismiss={true}
        onDismiss={() => setIsEditUsernameModalOpen(false)}
        dominantColor={dominantColor}
      />
    </div>
  );
};
