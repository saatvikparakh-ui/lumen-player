import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, UserPlus, X, Music } from 'lucide-react';
import { Track, CustomPlaylist } from './types/music';
import { AudioEngine } from './services/audioEngine';
import { StreamingService, RecommendationShelves } from './services/streamingService';
import { PlaylistService } from './services/playlistService';
import { extractDominantColor, extractDominantColorSync, DEFAULT_PALETTE } from './services/colorSampler';
import { PerimeterLedFrame } from './components/layout/PerimeterLedFrame';
import { useDeviceMode } from './hooks/useDeviceMode';
import { useTvMode } from './hooks/useTvMode';
import { useTvVirtualCursor } from './hooks/useTvVirtualCursor';
import { TvVirtualCursor } from './components/tv/TvVirtualCursor';
import { TvPlaylistBeamModal } from './components/tv/TvPlaylistBeamModal';
import { MobileBeamSenderModal } from './components/views/MobileBeamSenderModal';
import { TvNavigationRail } from './components/tv/TvNavigationRail';
import { TvNowPlayingStage } from './components/tv/TvNowPlayingStage';
import { TopDynamicIsland } from './components/layout/TopDynamicIsland';
import { BottomTransportDock } from './components/layout/BottomTransportDock';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { MobileMiniPlayer } from './components/layout/MobileMiniPlayer';
import { CenterStageView } from './components/views/CenterStageView';
import { HomeCarouselView } from './components/views/HomeCarouselView';
import { PlaylistView } from './components/views/PlaylistView';
import { ArtistHubView } from './components/views/ArtistHubView';
import { TuneTasteModal } from './components/views/TuneTasteModal';
import { HolographicAudioLabHUD } from './components/views/HolographicAudioLabHUD';
import { TopProfileButton } from './components/layout/TopProfileButton';
import { TopFriendsButton } from './components/layout/TopFriendsButton';
import { SettingsHubModal } from './components/views/SettingsHubModal';
import { QueueDrawer } from './components/views/QueueDrawer';
import { AddToPlaylistModal } from './components/views/AddToPlaylistModal';
import { FirebaseAuthService, AppUser } from './services/firebaseAuthService';
import { AuthModal } from './components/auth/AuthModal';
import { TasteOnboardingModal } from './components/auth/TasteOnboardingModal';
import { UsernameSetupModal } from './components/auth/UsernameSetupModal';
import { FriendsPageView } from './components/views/friends/FriendsPageView';
import { AccountSwitcherModal } from './components/auth/AccountSwitcherModal';
import { FirestoreService } from './services/firestoreService';
import { PreferenceService } from './services/preferenceService';
import { MobileSearchView } from './components/views/MobileSearchView';
import { AlbumDetailModal } from './components/common/AlbumDetailModal';
import { AlbumMetadata } from './services/artistService';
import { PipService } from './services/pipService';
import { RatingAndStatsService } from './services/ratingAndStatsService';
import { ApiClient } from './services/apiClient';
import { fetchItunesCover } from './utils/artwork';
import { SocialService } from './services/socialService';
import { SupabaseService } from './services/supabaseService';
import { AlbumClubService } from './services/albumClubService';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);
  const [isBottomNavVisible, setIsBottomNavVisible] = useState(true);
  const [hasUnreadShares, setHasUnreadShares] = useState(false);
  const [isUsernameSetupOpen, setIsUsernameSetupOpen] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>('');
  const [isFriendsHubOpen, setIsFriendsHubOpen] = useState(false);
  const [socialUnreadCount, setSocialUnreadCount] = useState(0);
  const [currentView, setCurrentView] = useState<'home' | 'player' | 'playlist' | 'search' | 'friends'>('home');
  const [previousView, setPreviousView] = useState<'home' | 'player' | 'playlist' | 'search'>('home');

  const handleOpenFriends = () => {
    if (currentView === 'friends') {
      setCurrentView(previousView);
    } else {
      if (currentView !== 'player') {
        setPreviousView(currentView);
      }
      setCurrentView('friends');
    }
  };
  const [activeStage, setActiveStage] = useState<'album' | 'lyrics'>('album');
  const [isTasteModalOpen, setIsTasteModalOpen] = useState(false);
  const [isAudioLabOpen, setIsAudioLabOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'playback' | 'taste' | 'eq' | 'stats' | 'account'>('playback');
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);
  const [isPlaylistSubModalOpen, setIsPlaylistSubModalOpen] = useState(false);
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumMetadata | null>(null);
  const [searchInitialQuery, setSearchInitialQuery] = useState<string>('');
  const [searchedArtist, setSearchedArtist] = useState<{ name: string; avatarUrl?: string | null; genre?: string } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchToast, setSearchToast] = useState<string | null>(null);
  const [dominantColor, setDominantColor] = useState('#FF2E93'); // Neon Magenta default
  const [colorPalette, setColorPalette] = useState<[string, string, string, string]>(DEFAULT_PALETTE);

  // Spotify-Style Shareable Profile Follow Invite state
  const [invitedProfile, setInvitedProfile] = useState<any | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteToast, setInviteToast] = useState<string | null>(null);

  // Restore only the user's own last played song from previous session (never pre-fill random songs)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => {
    try {
      const userKey = FirebaseAuthService.getCurrentUser()?.uid || 'local';
      const saved = localStorage.getItem(`lumen_last_played_${userKey}`) || localStorage.getItem('lumen_last_played_track');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return null;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [bassScale, setBassScale] = useState(1);
  const [spectrumBars, setSpectrumBars] = useState<number[]>([40, 60, 80, 50, 70, 90, 60, 40]);
  const bgImgRef = useRef<HTMLImageElement>(null);
  const { deviceMode, isPhone, isTablet, isDesktop } = useDeviceMode();
  const { 
    isTvMode, 
    toggleTvMode, 
    isUltraSmooth, 
    toggleGraphicsMode, 
    isVirtualCursorEnabled, 
    toggleVirtualCursor 
  } = useTvMode();

  const [isTvBeamModalOpen, setIsTvBeamModalOpen] = useState(false);
  const [activeBeamPin, setActiveBeamPin] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('beam');
    }
    return null;
  });

  const { pos: cursorPosition, isHoveringClickable, ripples: cursorRipples, isCursorActive, toggleCursor } = useTvVirtualCursor({
    enabled: isTvMode && isVirtualCursorEnabled,
    dominantColor
  });

  // Recommendation Shelves & Playlists
  const [shelves, setShelves] = useState<RecommendationShelves>({
    madeForYou: [],
    trending: [],
    genreMixes: []
  });
  const [playlists, setPlaylists] = useState<CustomPlaylist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);

  // Recently played tracks history
  const [recentTracks, setRecentTracks] = useState<Track[]>(() => {
    try {
      const saved = localStorage.getItem('lumen_recent_tracks');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });

  const addRecentTrack = (track: Track) => {
    setRecentTracks(prev => {
      const filtered = prev.filter(t => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, 20);
      try {
        localStorage.setItem('lumen_recent_tracks', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };


  // Custom Album Cover Backdrop State (e.g. Pink Floyd Album Cover Search & Sync)
  const [customBackdropUrl, setCustomBackdropUrl] = useState<string | null>(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_custom_backdrop_url') : null;
  });
  const [backdropMode, setBackdropMode] = useState<'persistent' | 'dynamic'>(() => {
    return (typeof localStorage !== 'undefined' ? (localStorage.getItem('lumen_backdrop_mode') as any) : null) || 'persistent';
  });

  useEffect(() => {
    const handleBackdropEvent = () => {
      const u = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_custom_backdrop_url') : null;
      const m = (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_backdrop_mode') : null) as any || 'persistent';
      setCustomBackdropUrl(u);
      setBackdropMode(m);
    };
    window.addEventListener('lumen:backdrop_changed', handleBackdropEvent);
    window.addEventListener('storage', handleBackdropEvent);
    return () => {
      window.removeEventListener('lumen:backdrop_changed', handleBackdropEvent);
      window.removeEventListener('storage', handleBackdropEvent);
    };
  }, []);

  // Handle direct notification tap navigation (e.g. open Friends tab from push notification)
  useEffect(() => {
    const handleNavEvent = (e: any) => {
      const targetView = e.detail?.view;
      if (targetView && ['home', 'player', 'playlist', 'search', 'friends'].includes(targetView)) {
        setCurrentView(targetView);
      }
    };
    window.addEventListener('lumen:navigate', handleNavEvent);
    return () => {
      window.removeEventListener('lumen:navigate', handleNavEvent);
    };
  }, []);

  useEffect(() => {
    if (customBackdropUrl && (!currentTrack?.artworkUrl || backdropMode === 'persistent')) {
      extractDominantColor(customBackdropUrl).then(s => {
        if (s.dominant) setDominantColor(s.dominant);
        if (s.palette && s.palette.length > 0) setColorPalette(s.palette);
      }).catch(() => {});
    }
  }, [customBackdropUrl, backdropMode]);

  // Load playlists and personalized recommendations on Mount
  useEffect(() => {
    const loadedPlaylists = PlaylistService.getPlaylists();
    setPlaylists(loadedPlaylists);
    if (loadedPlaylists.length > 0) {
      setActivePlaylistId(loadedPlaylists[0].id);
    }

    // Subscribe to live cloud & local playlist changes across all active devices
    const unsubPlaylists = PlaylistService.onPlaylistsChange((updated) => {
      setPlaylists(updated);
      setActivePlaylistId(prev => {
        if (!prev && updated.length > 0) return updated[0].id;
        if (prev && !updated.some(p => p.id === prev)) return updated[0]?.id || null;
        return prev;
      });
    });

    // Restore persistent queue and last played track across app launches (paused state)
    const restored = AudioEngine.restoreSavedSession();
    if (restored.track) {
      setCurrentTrack(restored.track);
    }

    // Auto-heal playlists in the background (resolves "Unknown Artist" and missing/broken artwork)
    PlaylistService.healPlaylists(() => {
      setPlaylists(PlaylistService.getPlaylists());
    });

    // Extract dominant color from user's last played track if restored, or eagerly heal missing artwork on boot
    const trackForColor = restored.track || currentTrack;
    if (trackForColor?.artworkUrl) {
      extractDominantColor(trackForColor.artworkUrl).then((s) => {
        setDominantColor(s.dominant);
        if (s.palette) setColorPalette(s.palette);
      });
    } else if (currentTrack?.title) {
      fetchItunesCover(currentTrack.title, currentTrack.artist).then((healed) => {
        if (healed) {
          setCurrentTrack(prev => prev ? { ...prev, artworkUrl: healed, hasArtwork: true } : prev);
          AudioEngine.updateCurrentTrackArtwork(healed);
          extractDominantColor(healed).then((s) => {
            setDominantColor(s.dominant);
            if (s.palette) setColorPalette(s.palette);
          });
          try {
            const userKey = FirebaseAuthService.getCurrentUser()?.uid || 'local';
            const updated = { ...currentTrack, artworkUrl: healed, hasArtwork: true };
            localStorage.setItem(`lumen_last_played_${userKey}`, JSON.stringify(updated));
            localStorage.setItem('lumen_last_played_track', JSON.stringify(updated));
          } catch (_) {}
        }
      }).catch(() => {});
    }

    // Fetch initial recommendations (never pre-fill madeForYou[0] on the user)
    StreamingService.getRecommendations().then((data) => {
      setShelves(data);
    });

    AudioEngine.init();
    if (currentTrack) {
      AudioEngine.setInitialTrack(currentTrack);
    }
    AudioEngine.onTrackChange((track) => {
      setCurrentTrack(track);
      if (track?.artworkUrl) {
        const immediate = extractDominantColorSync(track.artworkUrl);
        setDominantColor(immediate.dominant);
        if (immediate.palette) setColorPalette(immediate.palette);

        extractDominantColor(track.artworkUrl).then((s) => {
          setDominantColor(s.dominant);
          if (s.palette) setColorPalette(s.palette);
        });
      } else if (track?.title) {
        const immediate = extractDominantColorSync(`${track.title} ${track.artist || ''}`);
        setDominantColor(immediate.dominant);
        if (immediate.palette) setColorPalette(immediate.palette);
      }
    });
    AudioEngine.onPlayStateChange((playing) => {
      setIsPlaying(playing);
    });

    // Global Album Club Listen Tracking: strictly mark as Heard when >= 50% played
    AudioEngine.onTimeUpdate((currentTime, dur) => {
      if (dur <= 0) return;
      if ((currentTime / dur) >= 0.5) {
        const cur = AudioEngine.getCurrentTrack();
        if (cur?.id) {
          try {
            const myUid = FirebaseAuthService.getCurrentUser()?.uid || localStorage.getItem('lumen_persistent_uid');
            if (myUid) {
              const activeClub = AlbumClubService.getActiveClub(myUid);
              if (activeClub?.currentCycle?.nomination?.tracks) {
                const match = activeClub.currentCycle.nomination.tracks.find((t: any) =>
                  t.id === cur.id ||
                  (t.title && cur.title && t.title.toLowerCase().trim() === cur.title.toLowerCase().trim())
                );
                if (match) {
                  const set = new Set(activeClub.currentCycle.memberProgress?.[myUid]?.listenedTrackIds || []);
                  if (!set.has(match.id)) {
                    AlbumClubService.toggleTrackListened(activeClub.id, myUid, match.id, true);
                  }
                }
              }
            }
          } catch (_) {}
        }
      }
    });

    return () => {
      unsubPlaylists();
    };
  }, []);

  // Audio-reactive perimeter LED loop: ONLY runs while actively playing in Player view and visible!
  // Zero CPU/GPU cost and ZERO root <App /> re-renders on Home, Friends, Search, Playlists, or when paused.
  useEffect(() => {
    if (!isPlaying || currentView !== 'player') {
      setBassScale(1);
      return;
    }

    let animId = 0;
    let lastRenderTime = 0;
    const freqData = new Uint8Array(32);
    let lastBars = [0, 0, 0, 0, 0, 0, 0, 0];

    const checkBass = (now: number) => {
      if (document.hidden) {
        animId = requestAnimationFrame(checkBass);
        return;
      }

      const renderInterval = isPhone ? 180 : isTvMode ? 120 : 95;
      if (now - lastRenderTime >= renderInterval) {
        lastRenderTime = now;
        AudioEngine.getFrequencyData(freqData);
        const avg = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / 4;
        const currentScale = 1 + (avg / 255) * 0.32;

        // Direct GPU transform on desktop backdrop only (skip per-frame re-blur scale on mobile WebView for 60fps!)
        if (!isPhone && bgImgRef.current) {
          bgImgRef.current.style.transform = `scale(${1.15 + (currentScale - 1) * 0.08}) translate3d(0, 0, 0)`;
        }

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

        const changed = bars.some((v, i) => Math.abs(v - lastBars[i]) > 3.5);
        if (changed) {
          lastBars = bars;
          setBassScale(prev => (Math.abs(prev - currentScale) > 0.035 ? currentScale : prev));
          setSpectrumBars(bars);
        }
      }

      animId = requestAnimationFrame(checkBass);
    };

    animId = requestAnimationFrame(checkBass);
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, currentView, isPhone, isTvMode]);

  // User ID & authoritative username sync for listening stats + per-account Autoplay isolation
  useEffect(() => {
    AudioEngine.setActiveUser(currentUser?.uid || null);
    if (currentUser?.uid) {
      const validHandle = (currentUsername && currentUsername.toLowerCase() !== 'listener' ? currentUsername : null) ||
        (currentUser.username && currentUser.username.toLowerCase() !== 'listener' ? currentUser.username : null) ||
        currentUser.displayName ||
        currentUser.email?.split('@')[0];
      RatingAndStatsService.setUserId(currentUser.uid, validHandle);
    }
  }, [currentUser, currentUsername]);

  const handleTogglePip = () => {
    PipService.toggle(
      currentTrack,
      isPlaying,
      handleTogglePlay,
      handleNextTrack,
      handlePrevTrack,
      dominantColor
    );
  };

  useEffect(() => {
    if (PipService.isOpen()) {
      PipService.update(
        currentTrack,
        isPlaying,
        handleTogglePlay,
        handleNextTrack,
        handlePrevTrack,
        dominantColor
      );
    }
  }, [currentTrack, isPlaying, dominantColor]);

  // Real-time Firestore presence sync (Now Listening To)
  useEffect(() => {
    if (currentUser && !currentUser.isGuest) {
      FirestoreService.updatePresence(currentUser, currentTrack, isPlaying);
    }
  }, [currentUser, currentTrack, isPlaying]);

  // Real-time Firestore social shares subscription for unread indicator
  useEffect(() => {
    if (!currentUser) return;
    const username = (currentUser as any).username || (currentUser.displayName && !currentUser.displayName.includes('@') ? currentUser.displayName : null);
    const unsub = FirestoreService.subscribeToReceivedShares(currentUser.uid, (shares) => {
      const hasUnread = shares.some(s => !s.read);
      setHasUnreadShares(hasUnread);
    }, username);
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    // Global Hotkeys: Space (Play/Pause), M (Flip Stage), Esc / Backspace (Close HUD / TV Remote Back)
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        AudioEngine.togglePlay();
      } else if (e.key.toLowerCase() === 'm') {
        handleTogglePip();
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        if (isAudioLabOpen || isTasteModalOpen || isFriendsHubOpen || isSettingsOpen || isAccountSwitcherOpen || isQueueOpen || isTvBeamModalOpen) {
          setIsAudioLabOpen(false);
          setIsTasteModalOpen(false);
          setIsFriendsHubOpen(false);
          setIsSettingsOpen(false);
          setIsAccountSwitcherOpen(false);
          setIsQueueOpen(false);
          setIsTvBeamModalOpen(false);
          setSelectedArtistName(null);
          return;
        }
        if (currentView === 'player') {
          e.preventDefault();
          setCurrentView(activePlaylistId ? 'playlist' : 'home');
          return;
        }
        if (currentView === 'playlist' || currentView === 'search') {
          e.preventDefault();
          setCurrentView('home');
          return;
        }
      } else if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey)) {
        AudioEngine.next();
      } else if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey)) {
        AudioEngine.prev();
      } else if (e.key.toLowerCase() === 'c' && isTvMode) {
        toggleCursor();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isAudioLabOpen, isTasteModalOpen, isFriendsHubOpen, isSettingsOpen, isAccountSwitcherOpen, isQueueOpen, isTvBeamModalOpen, currentView, activePlaylistId, isTvMode, toggleCursor]);

  // Listen to authoritative Firebase authentication state
  useEffect(() => {
    const unsubscribe = FirebaseAuthService.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setAuthReady(true);
      if (user) {
        setIsAuthModalOpen(false);
        if (user.username) {
          setCurrentUsername(user.username);
        }
      } else {
        setIsAuthModalOpen(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Global persistent social listeners (friend requests, shares, real-time unread badges)
  useEffect(() => {
    const baseUser = currentUser || FirebaseAuthService.getCurrentUser();
    const effective: AppUser = baseUser
      ? {
          ...baseUser,
          username: baseUser.username || currentUsername || null
        }
      : {
          uid: localStorage.getItem('lumen_persistent_uid') || 'usr_guest',
          username: currentUsername || localStorage.getItem('lumen_user_handle') || 'listener',
          displayName: currentUsername || localStorage.getItem('lumen_user_handle') || 'Listener',
          email: null,
          photoURL: null,
          isGuest: true,
          emailVerified: false,
          hasCompletedOnboarding: true
        };

    SocialService.init(effective);
    SupabaseService.autoMigrateLocalData().catch(() => {});
    const unsub = SocialService.subscribe(() => {
      const count = SocialService.getUnreadCount();
      setSocialUnreadCount(count);
      setHasUnreadShares(count > 0);
    });
    const unsubAlert = SocialService.onAlert((alert) => {
      setSearchToast(`${alert.title}: ${alert.message}`);
      setTimeout(() => setSearchToast(null), 5000);
    });
    const initialCount = SocialService.getUnreadCount();
    setSocialUnreadCount(initialCount);
    setHasUnreadShares(initialCount > 0);
    return () => {
      unsub();
      unsubAlert();
    };
  }, [currentUser, currentUsername]);

  // Inspect URL & native Deep Links for profile share link (/u/xxx, ?user=xxx, lumen://friend/xxx)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resolveIncomingFriendLink = (rawUrl: string) => {
      try {
        let targetUser: string | null = null;
        if (rawUrl.startsWith('lumen://')) {
          const match = rawUrl.match(/^lumen:\/\/(?:friend|u|user)\/([^/?#]+)/i);
          if (match && match[1]) targetUser = decodeURIComponent(match[1]);
        } else {
          const parsed = new URL(rawUrl, window.location.origin);
          targetUser = parsed.searchParams.get('user') || parsed.searchParams.get('u');
          if (!targetUser) {
            const pathMatch = parsed.pathname.match(/^\/(?:u|user|friend)\/([^/?#]+)/i);
            if (pathMatch && pathMatch[1]) targetUser = decodeURIComponent(pathMatch[1]);
          }
        }

        if (targetUser) {
          const cleanU = targetUser.replace(/^@/, '').trim().toLowerCase();
          if (!cleanU || cleanU === 'listener') return;
          FirestoreService.getUserByUsername(cleanU).then((prof) => {
            if (prof && prof.userId) {
              setInvitedProfile(prof);
              setIsInviteModalOpen(true);
            } else {
              // Fallback: open Friends view even if profile is still hydrating
              setCurrentView('friends');
            }
          }).catch(() => {});
        }
      } catch (_) {}
    };

    resolveIncomingFriendLink(window.location.href);

    const onDeepLink = (e: any) => {
      const url = e?.detail?.url || e?.url;
      if (typeof url === 'string') resolveIncomingFriendLink(url);
    };
    window.addEventListener('lumen-deep-link', onDeepLink);
    return () => window.removeEventListener('lumen-deep-link', onDeepLink);
  }, []);

  // Check if authenticated user needs to pick a unique @username
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) {
      setCurrentUsername('');
      return;
    }
    const isRealUsername = (u?: string | null) => {
      const c = (u || '').replace(/^@/, '').trim().toLowerCase();
      return c.length >= 2 && c !== 'listener' && c !== 'you' && c !== 'guest' && !c.startsWith('user_') && !c.startsWith('usr_');
    };
    const checkUsernameStatus = async () => {
      // 1. Authoritative username already attached to authenticated AppUser (ignoring generic 'listener')
      if (isRealUsername(currentUser.username)) {
        const cleanU = currentUser.username!.replace(/^@/, '').trim().toLowerCase();
        setCurrentUsername(cleanU);
        try {
          localStorage.setItem('lumen_user_handle', cleanU);
          localStorage.setItem(`lumen_user_handle_${uid}`, cleanU);
        } catch (_) {}
        return;
      }

      // 2. Authoritative check in Cloud Firestore for non-guest accounts
      if (!currentUser.isGuest) {
        try {
          const fProf = await FirestoreService.getUserProfile(uid);
          if (fProf && isRealUsername(fProf.username)) {
            const cleanU = fProf.username.replace(/^@/, '').trim().toLowerCase();
            setCurrentUsername(cleanU);
            setCurrentUser(prev => prev ? { ...prev, username: cleanU } : prev);
            FirebaseAuthService.updateUsername(cleanU);
            try {
              localStorage.setItem('lumen_user_handle', cleanU);
              localStorage.setItem(`lumen_user_handle_${uid}`, cleanU);
            } catch (_) {}
            return;
          }
        } catch (_) {}
      }

      // 3. Per-UID local handle fallback
      try {
        const perUidHandle = localStorage.getItem(`lumen_user_handle_${uid}`);
        if (perUidHandle && !perUidHandle.startsWith('usr_') && !perUidHandle.startsWith('guest')) {
          setCurrentUsername(perUidHandle);
          return;
        }
      } catch (_) {}

      // 4. DisplayName handle fallback
      if (currentUser.displayName) {
        const handle = currentUser.displayName.replace(/^@/, '').trim();
        if (handle && !handle.startsWith('usr_') && !handle.startsWith('guest') && !handle.startsWith('gst_')) {
          setCurrentUsername(handle);
          try {
            localStorage.setItem('lumen_user_handle', handle);
            localStorage.setItem(`lumen_user_handle_${uid}`, handle);
          } catch (_) {}
          return;
        }
      }

      // 5. Fallback from email
      if (currentUser.email) {
        const emailHandle = currentUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (emailHandle && emailHandle.length >= 3) {
          setCurrentUsername(emailHandle);
          try {
            localStorage.setItem('lumen_user_handle', emailHandle);
            localStorage.setItem(`lumen_user_handle_${uid}`, emailHandle);
          } catch (_) {}
          return;
        }
      }

      // 6. Prompt only if user is logged in without any handle
      if (!currentUser.isGuest) {
        setIsUsernameSetupOpen(true);
      }
    };
    checkUsernameStatus();
  }, [currentUser?.uid, currentUser?.username, currentUser?.displayName, currentUser?.email, currentUser?.isGuest]);

  const handlePlayTrack = (track: Track, queue?: Track[]) => {
    addRecentTrack(track);
    try {
      const userKey = FirebaseAuthService.getCurrentUser()?.uid || 'local';
      localStorage.setItem(`lumen_last_played_${userKey}`, JSON.stringify(track));
      localStorage.setItem('lumen_last_played_track', JSON.stringify(track));
    } catch (_) {}
    AudioEngine.playTrack(track, queue);
    setCurrentView('player');
  };

  const handleSetDominantColor = useCallback((color: string, pal?: [string, string, string, string]) => {
    setDominantColor(color);
    if (pal) {
      setColorPalette(pal);
    } else {
      setColorPalette([color, color, color, color]);
    }
  }, []);

  const handlePlayAll = (tracks: Track[]) => {
    if (tracks.length > 0) {
      AudioEngine.playTrack(tracks[0], tracks);
      setCurrentView('player');
    }
  };

  const handleTogglePlay = () => {
    AudioEngine.togglePlay(currentTrack);
  };

  const handleNextTrack = () => {
    AudioEngine.next();
  };

  const handlePrevTrack = () => {
    AudioEngine.prev();
  };

  const handleCreatePlaylist = (name?: string) => {
    const newPl = PlaylistService.createPlaylist(name || `My Playlist #${playlists.length + 1}`);
    const updated = PlaylistService.getPlaylists();
    setPlaylists(updated);
    setActivePlaylistId(newPl.id);
    return newPl;
  };

  const handleImportPlaylist = (importedPlaylist: CustomPlaylist) => {
    const created = PlaylistService.createPlaylistWithTracks(
      importedPlaylist.name,
      importedPlaylist.description,
      importedPlaylist.coverUrl,
      importedPlaylist.tracks,
      importedPlaylist.coverColor
    );
    const updated = PlaylistService.getPlaylists();
    setPlaylists(updated);
    setActivePlaylistId(created.id);
  };

  const handleUpdatePlaylist = (id: string, updates: Partial<CustomPlaylist>) => {
    PlaylistService.updatePlaylist(id, updates);
    setPlaylists(PlaylistService.getPlaylists());
  };

  const handleDeletePlaylist = (id: string) => {
    PlaylistService.deletePlaylist(id);
    const updated = PlaylistService.getPlaylists();
    setPlaylists(updated);
    if (activePlaylistId === id) {
      setActivePlaylistId(updated.length > 0 ? updated[0].id : null);
    }
  };

  const handleAddTrackToPlaylist = (playlistId: string, track: Track) => {
    const success = PlaylistService.addTrackToPlaylist(playlistId, track);
    setPlaylists(PlaylistService.getPlaylists());
    return success;
  };

  const handleRemoveTrackFromPlaylist = (
    playlistId: string, 
    trackId: string, 
    trackIndex?: number,
    trackTitle?: string,
    trackArtist?: string
  ) => {
    PlaylistService.removeTrackFromPlaylist(playlistId, trackId, trackIndex, trackTitle, trackArtist);
    setPlaylists(PlaylistService.getPlaylists());
  };

  const handleSearch = async (query: string) => {
    if (!query || !query.trim()) return;
    const cleanQuery = query.trim();
    setIsSearching(true);
    setSelectedArtistName(null);
    setSelectedAlbum(null);
    setSearchInitialQuery(cleanQuery);
    setCurrentView('search');
    setIsSearching(false);
    return;

    try {
      let results = await StreamingService.searchVerifiedTracks(cleanQuery);

      // If 0 tracks returned, try direct artist lookup fallback
      if (results.length === 0) {
        try {
          const res = await fetch(ApiClient.resolveUrl(`/api/artist?name=${encodeURIComponent(cleanQuery)}`));
          if (res.ok) {
            const artistData = await ApiClient.safeJson(res);
            if (artistData && artistData.success && (artistData.topTracks?.length > 0 || artistData.albums?.length > 0)) {
              results = (artistData.topTracks || []).map((t: any) => ({
                ...t,
                addedAt: Date.now(),
                path: '',
                filename: ''
              }));
              if (artistData.artist) {
                setSearchedArtist({
                  name: artistData.artist,
                  avatarUrl: results[0]?.artworkUrl || null,
                  genre: results[0]?.genre || 'Verified Artist'
                });
              }
            }
          }
        } catch (artErr) {
          console.warn('Artist fallback failed during search:', artErr);
        }
      }

      if (results.length > 0) {
        setShelves(prev => ({
          ...prev,
          madeForYou: results
        }));

        // Detect if query is an artist or matches top search results
        const normQuery = cleanQuery.toLowerCase().replace(/[^a-z0-9]/g, '');
        const topArtist = results[0]?.artist;
        const normTop = (topArtist || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        if (!searchedArtist && topArtist && (normTop.includes(normQuery) || normQuery.includes(normTop) || results.filter(r => (r.artist || '').toLowerCase() === (topArtist || '').toLowerCase()).length >= 2)) {
          setSearchedArtist({
            name: topArtist,
            avatarUrl: results[0]?.artworkUrl,
            genre: results[0]?.genre
          });
        }
      } else {
        setSearchedArtist(null);
        setSearchToast(`No songs found for "${cleanQuery}". Showing your recommended mix.`);
        setTimeout(() => setSearchToast(null), 4000);
      }
    } catch (err) {
      console.warn('Search execution error:', err);
      setSearchToast('Search encountered an error. Please try again.');
      setTimeout(() => setSearchToast(null), 4000);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRefreshPreferences = () => {
    StreamingService.clearCache();
    StreamingService.getRecommendations(true).then((data) => {
      setShelves(data);
    });
  };

  const handleSelectView = (view: 'home' | 'player' | 'playlist' | 'search' | 'friends') => {
    setSelectedArtistName(null);
    setIsQueueOpen(false);
    setIsFriendsHubOpen(false);
    
    if (view === 'player') {
      if (!currentTrack) {
        const restored = AudioEngine.restoreSavedSession();
        if (restored.track) {
          setCurrentTrack(restored.track);
        } else if (shelves.madeForYou && shelves.madeForYou.length > 0) {
          setCurrentTrack(shelves.madeForYou[0]);
        }
      }
    } else if (view === 'playlist') {
      const currentPlaylists = PlaylistService.getPlaylists();
      if (currentPlaylists.length > 0) {
        setPlaylists(currentPlaylists);
        if (!activePlaylistId || !currentPlaylists.some(p => p.id === activePlaylistId)) {
          setActivePlaylistId(currentPlaylists[0].id);
        }
      }
    }
    
    setPreviousView(currentView === 'player' ? 'home' : (currentView as any));
    setCurrentView(view);
  };

  const handleOpenPlaylist = (id: string) => {
    setActivePlaylistId(id);
    setCurrentView('playlist');
  };

  const handleOpenSettings = (tab: 'playback' | 'taste' | 'eq' | 'stats' | 'account' = 'playback') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  const handleSaveQueueAsPlaylist = (tracks: Track[], customName?: string) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pl = PlaylistService.createPlaylist(customName?.trim() || `Queue Mix (${timeStr})`);
    tracks.forEach(t => PlaylistService.addTrackToPlaylist(pl.id, t));
    const updated = PlaylistService.getPlaylists();
    setPlaylists(updated);
    if (!customName) {
      setActivePlaylistId(pl.id);
      setCurrentView('playlist');
    }
  };

  if (!authReady) {
    return (
      <div className="fixed inset-0 bg-[#000000] flex flex-col items-center justify-center select-none z-[999]">
        <div 
          className="w-16 h-16 rounded-3xl bg-lumen-cyan/15 border border-lumen-cyan/30 flex items-center justify-center text-lumen-cyan shadow-2xl animate-pulse mb-4"
          style={{ boxShadow: '0 0 50px rgba(99, 232, 255, 0.25)' }}
        >
          <Music className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-black text-white tracking-widest uppercase font-syne">LUMEN</h1>
        <p className="text-xs text-white/40 font-mono mt-1">Connecting session...</p>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen bg-[#000000] text-[#F1F4FC] overflow-hidden select-none font-sans">
      {/* Top Frameless Window Drag Gutters for Desktop Electron (never overlap TopDynamicIsland, corner buttons, or window controls) */}
      <div 
        className="hidden sm:block fixed top-0 left-20 w-36 h-8 z-20 pointer-events-auto"
        style={{ WebkitAppRegion: 'drag' } as any}
      />
      <div 
        className="hidden sm:block fixed top-0 right-48 w-36 h-8 z-20 pointer-events-auto"
        style={{ WebkitAppRegion: 'drag' } as any}
      />
      {/* 
        UNIVERSAL LIVING BLURRED ARTWORK BACKDROP (EDGE-TO-EDGE)
        Surfaces the authentic blurred album artwork of whatever song is playing, or custom album backdrop (e.g. Pink Floyd).
        Supports Dual Mode: 'persistent' (always visible) vs 'dynamic' (visible when paused/idle/home, switching to active song art).
      */}
      {(() => {
        const activeBackdropUrl = customBackdropUrl
          ? (backdropMode === 'persistent' ? customBackdropUrl : (!isPlaying || !currentTrack?.artworkUrl ? customBackdropUrl : currentTrack.artworkUrl))
          : currentTrack?.artworkUrl;

        return (
          <div 
            className={`pointer-events-none fixed inset-0 overflow-hidden z-0 transition-opacity duration-1000 ${
              activeBackdropUrl ? (isPlaying ? 'opacity-90' : 'opacity-55') : 'opacity-0'
            }`}
            style={{
              transform: 'translate3d(0, 0, 0)',
              WebkitTransform: 'translate3d(0, 0, 0)',
              willChange: 'opacity, transform'
            }}
          >
            {activeBackdropUrl && (
              <>
                <img
                  ref={bgImgRef}
                  src={activeBackdropUrl}
                  alt=""
                  className="w-full h-full object-cover filter blur-[28px] sm:blur-[64px] saturate-150 scale-115 select-none"
                  style={{
                    transform: isPhone ? 'scale(1.15) translate3d(0, 0, 0)' : `scale(${1.15 + (bassScale - 1) * 0.08}) translate3d(0, 0, 0)`,
                    WebkitTransform: isPhone ? 'scale(1.15) translate3d(0, 0, 0)' : `scale(${1.15 + (bassScale - 1) * 0.08}) translate3d(0, 0, 0)`,
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden'
                  }}
                />
                {/* Ambient vignette and subtle color enhancement - optimized for mobile & desktop contrast */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/65" />
                <div 
                  className="absolute inset-0 opacity-25 mix-blend-color-dodge transition-colors duration-1000"
                  style={{ backgroundColor: dominantColor }}
                />
              </>
            )}
          </div>
        );
      })()}

      {/* 
        PERIMETER LED LIGHT FRAME (ONLY IN PLAYER VIEW)
        Borders and covers the entire screen all around (top, right, bottom, left)
        Combines 4-side undulating wave glow + dual-side surging vertical soundwaves
      */}
      {currentView === 'player' && (
        <PerimeterLedFrame
          palette={colorPalette}
          bassScale={bassScale}
          isPlaying={isPlaying}
          spectrumBars={spectrumBars}
          isPhone={isPhone}
        />
      )}

      {/* TOP DYNAMIC ISLAND (DESKTOP & TV DUAL-PANE NAVIGATION — HIDE ON PHONE) */}
      {!isPhone && (
        <TopDynamicIsland
          currentView={currentView}
          onSelectView={handleSelectView}
          onOpenTasteModal={() => handleOpenSettings('taste')}
          onOpenAudioLab={() => handleOpenSettings('eq')}
          onSearch={handleSearch}
          currentTrack={currentTrack}
          dominantColor={dominantColor}
          isSearching={isSearching}
          onSelectArtist={(artist) => {
            setSelectedArtistName(artist);
          }}
          onSelectAlbum={(album) => {
            setSelectedAlbum(album);
          }}
          onPlayTrack={handlePlayTrack}
          onAddToQueue={(track) => AudioEngine.addToQueue(track)}
          onPlayNext={(track) => AudioEngine.playNext(track)}
          onAddToPlaylist={(track) => setAddToPlaylistTrack(track)}
          onOpenTvBeam={() => setIsTvBeamModalOpen(true)}
        />
      )}

      {/* MINIMALIST SLEEK MOBILE HEADER (LOGO + PROFILE/FRIENDS — ONLY ON HOME/FRIENDS/SEARCH) */}
      {isPhone && !isTvMode && currentView !== 'player' && currentView !== 'playlist' && (
        <div className="fixed top-0 left-0 right-0 z-30 px-5 pt-10 pb-3 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <span 
              className="text-lg font-black tracking-widest font-syne uppercase"
              style={{
                color: dominantColor,
                textShadow: `0 0 16px ${dominantColor}80`
              }}
            >
              LUMEN
            </span>
          </div>
          <div className="flex items-center gap-2.5 pointer-events-auto">
            <TopFriendsButton
              className="relative z-10"
              dominantColor={dominantColor}
              onClick={handleOpenFriends}
              isOpen={currentView === 'friends'}
              unreadCount={socialUnreadCount}
            />
            <TopProfileButton
              className="relative z-10"
              onOpenSettings={handleOpenSettings}
              onOpenFriendsHub={handleOpenFriends}
              dominantColor={dominantColor}
              currentUser={currentUser}
              onOpenAuthModal={() => setIsAccountSwitcherOpen(true)}
              onSignOut={async () => {
                await FirebaseAuthService.signOut();
                setCurrentUser(null);
                setIsAuthModalOpen(true);
              }}
            />
          </div>
        </div>
      )}

      {/* FLOATING ROUNDED LIQUID-GLASS BOTTOM SEARCH BAR (MOBILE ONLY — CLEAN ERGONOMIC HUD) */}


      {/* Floating Search Alert Toast */}
      {searchToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/90 border border-white/20 backdrop-blur-2xl text-xs text-white/90 shadow-2xl flex items-center gap-2 animate-fadeIn pointer-events-auto">
          <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
          <span>{searchToast}</span>
        </div>
      )}

      {/* TOP-LEFT FRIENDS & SOCIAL LISTENING BUTTON (DESKTOP & TV) */}
      {!isPhone && (
        <TopFriendsButton
          dominantColor={dominantColor}
          onClick={handleOpenFriends}
          isOpen={currentView === 'friends'}
          unreadCount={socialUnreadCount}
        />
      )}

      {/* TOP-RIGHT PROFILE & SETTINGS BUTTON (DESKTOP & TV) */}
      {!isPhone && currentView === 'home' && (
        <TopProfileButton
          onOpenSettings={handleOpenSettings}
          onOpenFriendsHub={handleOpenFriends}
          dominantColor={dominantColor}
          currentUser={currentUser}
          onOpenAuthModal={() => setIsAccountSwitcherOpen(true)}
          onSignOut={async () => {
            await FirebaseAuthService.signOut();
            setCurrentUser(null);
            setIsAuthModalOpen(true);
          }}
        />
      )}

      {/* MAIN VIEW CONTENT CONTAINER */}
      <main className={`w-full h-full ${currentView === 'player' ? '' : isPhone && currentView === 'playlist' ? 'pt-12 pb-3 px-2' : isTvMode ? 'pt-20 pb-10' : 'pt-20 pb-24'}`}>
        {/* VIEW 1: HOME (HORIZONTAL MAGNIFYING CAROUSEL WITH AMBIENT LED HALO) */}
        {currentView === 'home' && (
          <HomeCarouselView
            suggestedTracks={shelves.madeForYou}
            trendingTracks={shelves.trending}
            recentTracks={recentTracks}
            genreMixTracks={shelves.genreMixes}
            playlists={playlists}
            onPlayTrack={handlePlayTrack}
            onOpenPlaylist={handleOpenPlaylist}
            onOpenTasteModal={() => handleOpenSettings('taste')}
            onSelectArtist={setSelectedArtistName}
            dominantColor={dominantColor}
            searchedArtist={searchedArtist}
            onClearSearchedArtist={() => setSearchedArtist(null)}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            bassScale={bassScale}
            spectrumBars={spectrumBars}
            onOpenPlayerView={() => setCurrentView('player')}
            onToggleLyrics={() => {
              setActiveStage('lyrics');
              setCurrentView('player');
            }}
            onRefreshMix={handleRefreshPreferences}
          />
        )}

        {/* VIEW 2: NOW PLAYING & SINGLE SUNG LINE KINETIC GLOWING LYRICS */}
        {currentView === 'player' && (
          isTvMode ? (
            <TvNowPlayingStage
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              dominantColor={dominantColor}
              onTogglePlay={handleTogglePlay}
              onNextTrack={handleNextTrack}
              onPrevTrack={handlePrevTrack}
              onSelectArtist={setSelectedArtistName}
              onCollapse={() => setCurrentView(activePlaylistId ? 'playlist' : 'home')}
            />
          ) : (
          <CenterStageView
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            activeStage={activeStage}
            onToggleStage={() => setActiveStage(prev => prev === 'album' ? 'lyrics' : 'album')}
            dominantColor={dominantColor}
            onSetDominantColor={handleSetDominantColor}
            onSelectArtist={setSelectedArtistName}
            onTogglePlay={handleTogglePlay}
            onNextTrack={handleNextTrack}
            onPrevTrack={handlePrevTrack}
            onOpenQueue={() => setIsQueueOpen(true)}
            onOpenAddToPlaylist={(t) => setAddToPlaylistTrack(t)}
            onCollapse={() => setCurrentView(previousView || 'home')}
          />
          )
        )}

        {/* VIEW 3: PLAYLIST (SPLIT VIEW WITH SUGGESTIONS & MATCHING 3D GLASS PLAYER) */}
        {currentView === 'playlist' && (
          <PlaylistView
            playlists={playlists}
            activePlaylistId={activePlaylistId}
            onSelectPlaylist={setActivePlaylistId}
            onCreatePlaylist={handleCreatePlaylist}
            onImportPlaylist={handleImportPlaylist}
            onUpdatePlaylist={handleUpdatePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onAddTrack={handleAddTrackToPlaylist}
            onRemoveTrack={handleRemoveTrackFromPlaylist}
            onPlayTrack={handlePlayTrack}
            onPlayAll={handlePlayAll}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            dominantColor={dominantColor}
            onClose={() => setCurrentView('home')}
            onToggleLyrics={() => {
              setActiveStage('lyrics');
              setCurrentView('player');
            }}
            onSelectArtist={setSelectedArtistName}
            onOpenQueue={() => setIsQueueOpen(true)}
            onOpenAddToPlaylist={(t) => setAddToPlaylistTrack(t)}
            tasteTracks={[...shelves.madeForYou, ...shelves.genreMixes]}
            onOpenTvBeam={() => setIsTvBeamModalOpen(true)}
            onModalChange={setIsPlaylistSubModalOpen}
          />
        )}

        {/* VIEW 4: UNIFIED SPOTIFY-GRADE SEARCH (SONGS, ALBUMS & ARTISTS — MOBILE & DESKTOP) */}
        {currentView === 'search' && (
          <MobileSearchView
            dominantColor={dominantColor}
            initialQuery={searchInitialQuery}
            onPlayTrack={(track, queue) => {
              handlePlayTrack(track, queue);
              setCurrentView('player');
            }}
            onAddToQueue={(track) => {
              AudioEngine.addToQueue(track);
            }}
            onPlayNext={(track) => {
              AudioEngine.playNext(track);
            }}
            onAddToPlaylist={(track) => {
              setAddToPlaylistTrack(track);
            }}
            onSelectArtist={(artist) => {
              setSelectedArtistName(artist);
            }}
            onSelectAlbum={(album) => {
              setSelectedAlbum(album);
            }}
            onClose={() => {
              setSearchInitialQuery('');
              setCurrentView('home');
            }}
            suggestedTracks={[...shelves.madeForYou, ...shelves.trending]}
          />
        )}

        {/* VIEW 5: DEDICATED FRIENDS & MORE MUSIC-SOCIAL DASHBOARD */}
        {currentView === 'friends' && (
          <FriendsPageView
            currentUser={
              currentUser
                ? { ...currentUser, username: currentUser.username || currentUsername || null }
                : null
            }
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlayTrack={handlePlayTrack}
            onAddToQueue={(t) => AudioEngine.addToQueue(t)}
            dominantColor={dominantColor}
            onClose={() => setCurrentView(previousView || 'home')}
            playlists={playlists}
            onOpenPlaylist={(pl: CustomPlaylist) => {
              if (!playlists.some(p => p.id === pl.id)) {
                setPlaylists(prev => [pl, ...prev]);
              }
              setActivePlaylistId(pl.id);
              setCurrentView('playlist');
            }}
          />
        )}
      </main>

      {/* FULL ARTIST HUB VIEW (DISCOGRAPHY & ALBUMS ORGANIZED ACCORDINGLY) */}
      {selectedArtistName && (
        <ArtistHubView
          artistName={selectedArtistName}
          onClose={() => setSelectedArtistName(null)}
          onPlayTrack={handlePlayTrack}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          dominantColor={dominantColor}
          playlists={playlists}
          onSelectArtist={(name) => setSelectedArtistName(name)}
        />
      )}

      {/* LIQUID GLASS ALBUM DETAIL SHEET / MODAL (DESKTOP & ANDROID APK) */}
      <AlbumDetailModal
        album={selectedAlbum}
        dominantColor={dominantColor}
        currentTrack={currentTrack}
        onClose={() => setSelectedAlbum(null)}
        onPlayTrack={(track, queue) => handlePlayTrack(track, queue)}
        onAddToQueue={(tracks) => AudioEngine.addToQueue(tracks)}
        onSelectArtist={(artistName) => setSelectedArtistName(artistName)}
        onSaveAsPlaylist={(name, tracks) => {
          handleSaveQueueAsPlaylist(tracks, name);
        }}
      />

      {/* SETTINGS & AUDIO TUNING HUB (WITH LIVE ARTIST AUTOCOMPLETE TASTE PROFILE) */}
      <SettingsHubModal
        isOpen={isSettingsOpen}
        initialTab={settingsTab}
        onClose={() => setIsSettingsOpen(false)}
        onPreferencesUpdated={handleRefreshPreferences}
        dominantColor={dominantColor}
        onOpenAccountSwitcher={() => setIsAccountSwitcherOpen(true)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onOpenTvBeam={() => setIsTvBeamModalOpen(true)}
      />

      {/* 3D SLIDE-OUT PLAY QUEUE DRAWER */}
      <QueueDrawer
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        currentTrack={currentTrack}
        dominantColor={dominantColor}
        onPlayTrack={handlePlayTrack}
        onSaveQueueAsPlaylist={handleSaveQueueAsPlaylist}
      />

      {/* ADD TO PLAYLIST MODAL */}
      <AddToPlaylistModal
        isOpen={!!addToPlaylistTrack}
        track={addToPlaylistTrack}
        onClose={() => setAddToPlaylistTrack(null)}
        playlists={playlists}
        onAddTrackToPlaylist={handleAddTrackToPlaylist}
        onCreatePlaylist={handleCreatePlaylist}
        dominantColor={dominantColor}
      />



      {/* TUNE TASTE PREFERENCES MODAL (LEGACY FALLBACK) */}
      <TuneTasteModal
        isOpen={isTasteModalOpen}
        onClose={() => setIsTasteModalOpen(false)}
        onPreferencesUpdated={handleRefreshPreferences}
        dominantColor={dominantColor}
      />

      {/* HOLOGRAPHIC 10-BAND AUDIO LAB HUD (LEGACY FALLBACK) */}
      <HolographicAudioLabHUD
        isOpen={isAudioLabOpen}
        onClose={() => setIsAudioLabOpen(false)}
        dominantColor={dominantColor}
      />

      {/* FIREBASE AUTHENTICATION MODAL */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        dominantColor={dominantColor}
        onSuccess={() => {
          setIsAuthModalOpen(false);
          const user = FirebaseAuthService.getCurrentUser();
          setCurrentUser(user);
          handleRefreshPreferences();
        }}
      />

      {/* FIRST-TIME NEW ACCOUNT TASTE ONBOARDING MODAL */}
      <TasteOnboardingModal
        isOpen={Boolean(
          currentUser && 
          !currentUser.isGuest && 
          !currentUser.hasCompletedOnboarding && 
          (PreferenceService.getPreferences()?.favoriteArtists?.length || 0) < 3
        )}
        onComplete={() => {
          if (currentUser) {
            FirebaseAuthService.setOnboardingComplete(currentUser.uid, true);
          } else {
            FirebaseAuthService.setOnboardingComplete();
          }
          setCurrentUser(FirebaseAuthService.getCurrentUser());
          handleRefreshPreferences();
        }}
        dominantColor={dominantColor}
        userName={currentUser?.displayName || currentUser?.email?.split('@')[0] || undefined}
      />

      {/* UNIQUE @USERNAME CLAIM MODAL */}
      {currentUser && (
        <UsernameSetupModal
          isOpen={isUsernameSetupOpen && !isAuthModalOpen && !!currentUser?.hasCompletedOnboarding}
          userId={currentUser.uid}
          currentUsername={currentUsername}
          onComplete={(newHandle) => {
            const clean = newHandle.replace(/^@/, '').trim();
            setCurrentUsername(clean);
            try { localStorage.setItem('lumen_user_handle', clean); } catch (_) {}
            if (currentUser) {
              const updated = {
                ...currentUser,
                displayName: `@${clean}`
              };
              setCurrentUser(updated);
            }
            setIsUsernameSetupOpen(false);
          }}
          dominantColor={dominantColor}
          canDismiss={true}
          onDismiss={() => setIsUsernameSetupOpen(false)}
        />
      )}

      {/* SPOTIFY-STYLE PROFILE INVITE & AUTO-FOLLOW MODAL */}
      {isInviteModalOpen && invitedProfile && (
        <div 
          onClick={() => setIsInviteModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4 select-none animate-fadeIn"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-gradient-to-br from-white/[0.14] via-white/[0.05] to-black/95 border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-3xl shadow-2xl p-6 relative text-center space-y-5 animate-scaleUp"
            style={{
              boxShadow: `0 30px 80px rgba(0, 0, 0, 0.95), 0 0 50px -10px ${dominantColor}50`
            }}
          >
            <button
              onClick={() => setIsInviteModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-3 pt-2">
              <div 
                className="w-20 h-20 rounded-full mx-auto p-0.5 border-2 border-white/40 shadow-xl overflow-hidden"
                style={{ background: `radial-gradient(circle at 30% 30%, ${dominantColor}, #080A10)` }}
              >
                {invitedProfile.photoURL ? (
                  <img src={invitedProfile.photoURL} alt="" className="w-full h-full object-cover rounded-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-2xl font-bold font-syne">
                    {(invitedProfile.username || 'L')[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-lg font-black text-white font-syne">
                  {invitedProfile.displayName || `@${invitedProfile.username}`}
                </h4>
                <p className="text-xs font-mono text-lumen-cyan">@{invitedProfile.username}</p>
                <p className="text-xs text-white/60 mt-1">Shared listener profile via Lumen</p>
              </div>
            </div>

            {inviteToast ? (
              <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold animate-fadeIn">
                {inviteToast}
              </div>
            ) : (
              <button
                onClick={async () => {
                  if (!currentUser || currentUser.isGuest) {
                    setIsInviteModalOpen(false);
                    setIsAuthModalOpen(true);
                    return;
                  }
                  await FirestoreService.sendFriendRequest(currentUser, invitedProfile.userId);
                  setInviteToast(`Follow request sent to @${invitedProfile.username}!`);
                  setTimeout(() => {
                    setIsInviteModalOpen(false);
                    setInviteToast(null);
                  }, 2500);
                }}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-lumen-cyan to-cyan-400 text-black font-extrabold text-xs hover:scale-105 active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>Follow & Connect</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3D APPLE VISIONOS FROSTED GLASS TRANSPORT DOCK (Desktop / Tablet / TV viewports) */}
      {!isPhone && currentView !== 'player' && currentView !== 'playlist' && (
        <BottomTransportDock
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          activeStage={activeStage}
          onToggleStage={() => {
            setActiveStage(prev => prev === 'album' ? 'lyrics' : 'album');
            setCurrentView('player');
          }}
          dominantColor={dominantColor}
          onOpenQueue={() => setIsQueueOpen(true)}
        />
      )}


      {/* MOBILE FLOATING LIQUID-GLASS MINI PLAYER (PHONES ONLY) */}
      {!isTvMode && isPhone && currentView !== 'player' && currentTrack && 
       !isQueueOpen && !addToPlaylistTrack && !isPlaylistSubModalOpen && 
       !isSettingsOpen && !isTasteModalOpen && !isAudioLabOpen && 
       !isAccountSwitcherOpen && !isAuthModalOpen && !selectedArtistName && (
        <MobileMiniPlayer
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onOpenPlayer={() => setCurrentView('player')}
          dominantColor={dominantColor}
          isNavVisible={
            isBottomNavVisible &&
            !isAuthModalOpen && 
            !isUsernameSetupOpen && 
            !isAccountSwitcherOpen && 
            !isSettingsOpen && 
            !isTasteModalOpen &&
            !isInviteModalOpen &&
            !isQueueOpen &&
            !addToPlaylistTrack &&
            !isPlaylistSubModalOpen
          }
        />
      )}

      {/* MOBILE BOTTOM NAVIGATION BAR (FIXED & STABLE WITH SAFE-AREA PADDING — PHONE VIEWPORTS ONLY) */}
      {!isTvMode && isPhone && (
        <MobileBottomNav
          currentView={currentView}
          onSelectView={handleSelectView}
          onOpenSearch={() => {
            setCurrentView('search');
          }}
          onOpenFriendsHub={handleOpenFriends}
          dominantColor={dominantColor}
          hasUnreadShares={hasUnreadShares}
          isVisible={
            currentView !== 'player' &&
            isBottomNavVisible &&
            !isAuthModalOpen && 
            !isUsernameSetupOpen && 
            !isAccountSwitcherOpen && 
            !isSettingsOpen && 
            !isTasteModalOpen &&
            !isInviteModalOpen &&
            !isQueueOpen &&
            !addToPlaylistTrack &&
            !isPlaylistSubModalOpen
          }
        />
      )}

      {/* MULTI-ACCOUNT SWITCHER MODAL */}
      <AccountSwitcherModal
        isOpen={isAccountSwitcherOpen}
        onClose={() => setIsAccountSwitcherOpen(false)}
        currentUser={currentUser}
        dominantColor={dominantColor}
        onOpenSignIn={() => setIsAuthModalOpen(true)}
        onAccountSwitched={(user) => {
          setCurrentUser(user);
          handleRefreshPreferences();
        }}
      />

      {/* 10-FOOT ANDROID TV & LEANBACK VIRTUAL MOUSE CURSOR */}
      {isTvMode && isVirtualCursorEnabled && (
        <TvVirtualCursor
          pos={cursorPosition}
          isHoveringClickable={isHoveringClickable}
          ripples={cursorRipples}
          dominantColor={dominantColor}
          isCursorActive={isCursorActive}
        />
      )}

      {/* TV QR CODE PLAYLIST BEAM RECEIVER MODAL */}
      <TvPlaylistBeamModal
        isOpen={isTvBeamModalOpen}
        onClose={() => setIsTvBeamModalOpen(false)}
        onPlaylistImported={(playlistId) => {
          const updated = PlaylistService.getPlaylists();
          setPlaylists(updated);
          setActivePlaylistId(playlistId);
          setCurrentView('playlist');
        }}
        dominantColor={dominantColor}
      />

      {/* COMPANION MOBILE BEAM SENDER PORTAL (WHEN SCANNED ON PHONE VIA ?beam=...) */}
      {activeBeamPin && (
        <MobileBeamSenderModal
          pin={activeBeamPin}
          onClose={() => {
            setActiveBeamPin(null);
            if (typeof window !== 'undefined' && window.history?.replaceState) {
              const cleanUrl = window.location.pathname + window.location.hash;
              window.history.replaceState({}, '', cleanUrl);
            }
          }}
          dominantColor={dominantColor}
        />
      )}
    </div>
  );
};
