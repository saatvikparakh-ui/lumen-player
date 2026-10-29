import React, { useState, useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { Track, CustomPlaylist } from './types/music';
import { AudioEngine } from './services/audioEngine';
import { StreamingService, RecommendationShelves } from './services/streamingService';
import { PlaylistService } from './services/playlistService';
import { extractDominantColor, DEFAULT_PALETTE } from './services/colorSampler';
import { PerimeterLedFrame } from './components/layout/PerimeterLedFrame';
import { useDeviceMode } from './hooks/useDeviceMode';
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
import { FriendsHubView } from './components/views/FriendsHubView';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => FirebaseAuthService.getCurrentUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(() => !FirebaseAuthService.getCurrentUser());
  const [isUsernameSetupOpen, setIsUsernameSetupOpen] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>('');
  const [isFriendsHubOpen, setIsFriendsHubOpen] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'player' | 'playlist'>('home');
  const [activeStage, setActiveStage] = useState<'album' | 'lyrics'>('album');
  const [isTasteModalOpen, setIsTasteModalOpen] = useState(false);
  const [isAudioLabOpen, setIsAudioLabOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'playback' | 'taste' | 'eq' | 'stats' | 'friends' | 'account'>('playback');
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [searchedArtist, setSearchedArtist] = useState<{ name: string; avatarUrl?: string | null; genre?: string } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchToast, setSearchToast] = useState<string | null>(null);
  const [dominantColor, setDominantColor] = useState('#FF2E93'); // Neon Magenta default
  const [colorPalette, setColorPalette] = useState<[string, string, string, string]>(DEFAULT_PALETTE);

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

  // Load playlists and personalized recommendations on Mount
  useEffect(() => {
    const loadedPlaylists = PlaylistService.getPlaylists();
    setPlaylists(loadedPlaylists);
    if (loadedPlaylists.length > 0) {
      setActivePlaylistId(loadedPlaylists[0].id);
    }

    // Auto-heal playlists in the background (resolves "Unknown Artist" and missing/broken artwork)
    PlaylistService.healPlaylists(() => {
      setPlaylists(PlaylistService.getPlaylists());
    });

    // Extract dominant color from user's last played track if restored
    if (currentTrack?.artworkUrl) {
      extractDominantColor(currentTrack.artworkUrl).then((s) => {
        setDominantColor(s.dominant);
        if (s.palette) setColorPalette(s.palette);
      });
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
        extractDominantColor(track.artworkUrl).then((s) => {
          setDominantColor(s.dominant);
          if (s.palette) setColorPalette(s.palette);
        });
      }
    });
    AudioEngine.onPlayStateChange((playing) => {
      setIsPlaying(playing);
    });

    // Single unified perimeter audio-reactive vertical spectral flow
    let animId: number;
    let lastRenderTime = 0;
    const freqData = new Uint8Array(32);
    const checkBass = (now: number) => {
      AudioEngine.getFrequencyData(freqData);
      const avg = (freqData[0] + freqData[1] + freqData[2] + freqData[3]) / 4;
      const currentScale = 1 + (avg / 255) * 0.32;

      // 60fps direct GPU transform on blurred background element without re-rendering root App
      if (bgImgRef.current) {
        bgImgRef.current.style.transform = `scale(${1.15 + (currentScale - 1) * 0.08})`;
      }

      // Throttle React state updates to 15fps (~66ms) to avoid layout thrashing and UI flickering
      if (now - lastRenderTime > 66) {
        lastRenderTime = now;
        setBassScale(currentScale);
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
      }

      animId = requestAnimationFrame(checkBass);
    };
    animId = requestAnimationFrame(checkBass);

    // Global Hotkeys: Space (Play/Pause), M (Flip Stage), Esc (Close HUD / Return)
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        AudioEngine.togglePlay();
      } else if (e.key.toLowerCase() === 'm') {
        setActiveStage(prev => prev === 'album' ? 'lyrics' : 'album');
        setCurrentView('player');
      } else if (e.key === 'Escape') {
        setIsTasteModalOpen(false);
        setIsAudioLabOpen(false);
        setSelectedArtistName(null);
      } else if (e.key === 'ArrowRight') {
        AudioEngine.next();
      } else if (e.key === 'ArrowLeft') {
        AudioEngine.prev();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      cancelAnimationFrame(animId);
    };
  }, []);

  // Listen to Firebase authentication state changes
  useEffect(() => {
    const unsubscribe = FirebaseAuthService.onAuthStateChanged((user) => {
      setCurrentUser(user);
      if (!user) {
        setIsAuthModalOpen(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Check if authenticated user needs to pick a unique @username
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) return;
    const checkUsernameStatus = async () => {
      try {
        const res = await fetch(`/api/users/profile?userId=${encodeURIComponent(uid)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.user) {
            setCurrentUsername(data.user.username);
            if (!data.user.has_custom_username) {
              setIsUsernameSetupOpen(true);
            }
          }
        }
      } catch (_) {}
    };
    checkUsernameStatus();
  }, [currentUser?.uid]);

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

  const handleSetDominantColor = (color: string, pal?: [string, string, string, string]) => {
    setDominantColor(color);
    if (pal) {
      setColorPalette(pal);
    } else {
      setColorPalette([color, color, color, color]);
    }
  };

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

  const handleRemoveTrackFromPlaylist = (playlistId: string, trackId: string, trackIndex?: number) => {
    PlaylistService.removeTrackFromPlaylist(playlistId, trackId, trackIndex);
    setPlaylists(PlaylistService.getPlaylists());
  };

  const handleSearch = async (query: string) => {
    if (!query || !query.trim()) return;
    const cleanQuery = query.trim();
    setIsSearching(true);
    setSelectedArtistName(null);
    setCurrentView('home');

    try {
      let results = await StreamingService.searchVerifiedTracks(cleanQuery);

      // If 0 tracks returned, try direct artist lookup fallback
      if (results.length === 0) {
        try {
          const res = await fetch(`/api/artist?name=${encodeURIComponent(cleanQuery)}`);
          if (res.ok) {
            const artistData = await res.json();
            if (artistData.success && (artistData.topTracks?.length > 0 || artistData.albums?.length > 0)) {
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

  const handleOpenPlaylist = (id: string) => {
    setActivePlaylistId(id);
    setCurrentView('playlist');
  };

  const handleOpenSettings = (tab: 'playback' | 'taste' | 'eq' | 'stats' | 'friends' | 'account' = 'playback') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  const handleSaveQueueAsPlaylist = (tracks: Track[]) => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pl = PlaylistService.createPlaylist(`Queue Mix (${timeStr})`);
    tracks.forEach(t => PlaylistService.addTrackToPlaylist(pl.id, t));
    const updated = PlaylistService.getPlaylists();
    setPlaylists(updated);
    setActivePlaylistId(pl.id);
    setCurrentView('playlist');
  };

  const avgLeftFlow = (spectrumBars[0] + spectrumBars[1] + spectrumBars[2] + spectrumBars[3]) / 4;
  const avgRightFlow = (spectrumBars[4] + spectrumBars[5] + spectrumBars[6] + spectrumBars[7]) / 4;

  return (
    <div className="relative w-screen h-screen bg-[#000000] text-[#F1F4FC] overflow-hidden select-none font-sans">
      {/* 
        UNIVERSAL LIVING BLURRED ARTWORK BACKDROP (EDGE-TO-EDGE)
        Surfaces the authentic blurred album artwork of whatever song is playing as the living background across Home and Playlists.
        When no song is playing or stopped, smoothly transitions to pure deep pitch black (#000000).
      */}
      <div 
        className={`pointer-events-none fixed inset-0 overflow-hidden z-0 transition-opacity duration-1000 ${
          currentTrack?.artworkUrl && isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {currentTrack?.artworkUrl && (
          <>
            <img
              ref={bgImgRef}
              src={currentTrack.artworkUrl}
              alt=""
              className="w-full h-full object-cover filter blur-[75px] saturate-150 scale-125 transition-transform duration-700 select-none will-change-transform"
              style={{
                transform: `scale(${1.15 + (bassScale - 1) * 0.08})`
              }}
            />
            {/* Ambient vignette and subtle color enhancement */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/75 backdrop-blur-[2px]" />
            <div 
              className="absolute inset-0 opacity-20 mix-blend-color-dodge transition-colors duration-1000"
              style={{ backgroundColor: dominantColor }}
            />
          </>
        )}
      </div>

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
        />
      )}

      {/* TOP DYNAMIC ISLAND (3D APPLE VISIONOS GLASS WITH LIVE INSTANT SEARCH) */}
      <TopDynamicIsland
        currentView={currentView}
        onSelectView={(view) => {
          setSelectedArtistName(null);
          setCurrentView(view);
        }}
        onOpenTasteModal={() => handleOpenSettings('taste')}
        onOpenAudioLab={() => handleOpenSettings('eq')}
        onSearch={handleSearch}
        currentTrack={currentTrack}
        dominantColor={dominantColor}
        isSearching={isSearching}
        onSelectArtist={(artist) => {
          setSelectedArtistName(artist);
        }}
        onPlayTrack={handlePlayTrack}
      />

      {/* Floating Search Alert Toast */}
      {searchToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/90 border border-white/20 backdrop-blur-2xl text-xs text-white/90 shadow-2xl flex items-center gap-2 animate-fadeIn pointer-events-auto">
          <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
          <span>{searchToast}</span>
        </div>
      )}

      {/* TOP-LEFT FRIENDS & SOCIAL LISTENING BUTTON (CIRCULAR 3D LIQUID GLASS) */}
      {currentView === 'home' && (
        <TopFriendsButton
          dominantColor={dominantColor}
          onClick={() => setIsFriendsHubOpen(prev => !prev)}
          isOpen={isFriendsHubOpen}
        />
      )}

      {/* TOP-RIGHT PROFILE & SETTINGS BUTTON (ONLY ON HOME VIEW) */}
      {currentView === 'home' && (
        <TopProfileButton
          onOpenSettings={handleOpenSettings}
          onOpenFriendsHub={() => setIsFriendsHubOpen(true)}
          dominantColor={dominantColor}
          currentUser={currentUser}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onSignOut={async () => {
            await FirebaseAuthService.signOut();
            setIsAuthModalOpen(true);
          }}
        />
      )}

      {/* MAIN VIEW CONTENT CONTAINER */}
      <main className={`w-full h-full ${currentView === 'player' ? '' : 'pt-20 pb-24'}`}>
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
          />
        )}

        {/* VIEW 2: NOW PLAYING & SINGLE SUNG LINE KINETIC GLOWING LYRICS */}
        {currentView === 'player' && (
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
            onCollapse={() => setCurrentView('home')}
          />
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
        />
      )}

      {/* SETTINGS & AUDIO TUNING HUB (WITH LIVE ARTIST AUTOCOMPLETE TASTE PROFILE) */}
      <SettingsHubModal
        isOpen={isSettingsOpen}
        initialTab={settingsTab}
        onClose={() => setIsSettingsOpen(false)}
        onPreferencesUpdated={handleRefreshPreferences}
        dominantColor={dominantColor}
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

      {/* DEDICATED APPLE VISIONOS FRIENDS & SOCIAL LISTENING HUB */}
      <FriendsHubView
        isOpen={isFriendsHubOpen}
        onClose={() => setIsFriendsHubOpen(false)}
        dominantColor={dominantColor}
        currentUser={currentUser}
        currentTrack={currentTrack}
        onPlayTrack={handlePlayTrack}
        onAddToQueue={(t) => AudioEngine.addToQueue(t)}
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
        isOpen={isAuthModalOpen || !currentUser}
        onClose={() => {
          if (currentUser) {
            setIsAuthModalOpen(false);
          }
        }}
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
        isOpen={!!(currentUser && !currentUser.hasCompletedOnboarding)}
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
            setCurrentUsername(newHandle);
            setIsUsernameSetupOpen(false);
          }}
          dominantColor={dominantColor}
          canDismiss={true}
          onDismiss={() => setIsUsernameSetupOpen(false)}
        />
      )}

      {/* 3D APPLE VISIONOS FROSTED GLASS TRANSPORT DOCK (Desktop / Tablet viewports) */}
      {currentView !== 'player' && currentView !== 'playlist' && (
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

      {/* MOBILE PERSISTENT MINI-PLAYER (DOCKED ABOVE BOTTOM NAV ON PHONE VIEWPORTS) */}
      {currentView !== 'player' && currentTrack && (
        <MobileMiniPlayer
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onOpenPlayer={() => setCurrentView('player')}
          dominantColor={dominantColor}
        />
      )}

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <MobileBottomNav
        currentView={currentView}
        onSelectView={setCurrentView}
        onOpenSearch={() => {
          setCurrentView('home');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenFriendsHub={() => setIsFriendsHubOpen(true)}
        onOpenSettings={() => handleOpenSettings('playback')}
        dominantColor={dominantColor}
      />
    </div>
  );
};
