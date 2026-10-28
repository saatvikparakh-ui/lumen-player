import React, { useState, useEffect, useRef } from 'react';
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
  RotateCcw
} from 'lucide-react';
import { AudioEngine, EQ_FREQUENCIES, EQ_PRESETS } from '../../services/audioEngine';
import { PreferenceService, POPULAR_GENRES, POPULAR_VERIFIED_ARTISTS } from '../../services/preferenceService';
import { LikedService } from '../../services/likedService';
import { PlaylistService } from '../../services/playlistService';
import { RatingAndStatsService } from '../../services/ratingAndStatsService';
import { useDeviceMode } from '../../hooks/useDeviceMode';
import { EQPresetName, UserPreferences, ListeningStats, FriendUser, CatalogComparison, SongShare } from '../../types/music';

interface Props {
  isOpen: boolean;
  initialTab?: 'playback' | 'taste' | 'eq' | 'stats' | 'friends' | 'account';
  onClose: () => void;
  onPreferencesUpdated: () => void;
  dominantColor: string;
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
  dominantColor
}) => {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'playback' | 'taste' | 'eq' | 'stats' | 'friends' | 'account'>(initialTab);

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

  // Playback Settings State
  const [crossfade, setCrossfade] = useState<number>(() => AudioEngine.getCrossfade());
  const [isGapless, setIsGapless] = useState<boolean>(() => AudioEngine.getGapless());
  const [isAutomix, setIsAutomix] = useState<boolean>(() => AudioEngine.getAutomix());
  const [isNormalized, setIsNormalized] = useState<boolean>(() => AudioEngine.getNormalisation());
  const [sleepTimerOption, setSleepTimerOption] = useState<number | 'end_of_track' | 'off'>('off');
  const [audioQuality, setAudioQuality] = useState<'opus' | 'lossless' | 'balanced'>('opus');

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

  // Synchronize on open
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Live Autocomplete Artist Search Effect (Debounced 250ms)
  useEffect(() => {
    const q = artistSearchQuery.trim();
    if (!q) {
      setSearchedArtists([]);
      setIsSearchingArtists(false);
      return;
    }

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setIsSearchingArtists(true);

    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/artists/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSearchedArtists(data.artists || []);
      } catch (err) {
        console.warn('Artist search failed:', err);
        setSearchedArtists([]);
      } finally {
        setIsSearchingArtists(false);
      }
    }, 250);

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

  // Load friends, pending requests, and shared songs when Friends & Listening tab active
  useEffect(() => {
    if (activeTab === 'friends') {
      RatingAndStatsService.fetchFriends().then(res => {
        setFriendsList(res.friends || []);
        setPendingRequests(res.pending || []);
        setRatingVisibility((res.visibility as any) || 'friends');
      });
      setIsLoadingShares(true);
      Promise.all([
        RatingAndStatsService.fetchReceivedShares(),
        RatingAndStatsService.fetchSentShares()
      ]).then(([received, sent]) => {
        setReceivedShares(received);
        setSentShares(sent);
        setIsLoadingShares(false);
      }).catch(() => {
        setIsLoadingShares(false);
      });
    }
  }, [activeTab]);

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
        className="w-full max-w-4xl h-[86vh] bg-[#0c0f17]/95 border-t border-l border-white/25 border-r border-b border-black/60 rounded-3xl shadow-2xl flex flex-col md:flex-row overflow-hidden relative"
        style={{
          boxShadow: `0 30px 80px -20px rgba(0, 0, 0, 0.98), 0 0 50px -10px ${dominantColor}50`
        }}
      >
        {/* LEFT NAVIGATION SIDEBAR */}
        <div className="w-full md:w-64 bg-white/[0.02] border-b md:border-b-0 md:border-r border-white/10 p-5 flex flex-col justify-between flex-shrink-0">
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

            {/* Sidebar Tab Buttons */}
            <nav className="flex flex-col gap-1">
              <button
                onClick={() => setActiveTab('playback')}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                  activeTab === 'playback'
                    ? 'bg-white text-black shadow-lg font-bold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Zap className={`w-4 h-4 ${activeTab === 'playback' ? 'text-black' : 'text-lumen-cyan'}`} />
                <span>Playback & Tuning</span>
              </button>

              <button
                onClick={() => setActiveTab('taste')}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                  activeTab === 'taste'
                    ? 'bg-white text-black shadow-lg font-bold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Sparkles className={`w-4 h-4 ${activeTab === 'taste' ? 'text-black' : 'text-lumen-violet'}`} />
                <span>Taste Profile</span>
              </button>

              <button
                onClick={() => setActiveTab('eq')}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                  activeTab === 'eq'
                    ? 'bg-white text-black shadow-lg font-bold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Sliders className={`w-4 h-4 ${activeTab === 'eq' ? 'text-black' : 'text-emerald-400'}`} />
                <span>Audio Lab (EQ)</span>
              </button>

              <button
                onClick={() => setActiveTab('stats')}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                  activeTab === 'stats'
                    ? 'bg-white text-black shadow-lg font-bold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <BarChart2 className={`w-4 h-4 ${activeTab === 'stats' ? 'text-black' : 'text-cyan-400'}`} />
                <span>Listening Stats</span>
              </button>

              <button
                onClick={() => setActiveTab('friends')}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                  activeTab === 'friends'
                    ? 'bg-white text-black shadow-lg font-bold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Users className={`w-4 h-4 ${activeTab === 'friends' ? 'text-black' : 'text-pink-400'}`} />
                <span>Friends & Listening</span>
              </button>

              <button
                onClick={() => setActiveTab('account')}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                  activeTab === 'account'
                    ? 'bg-white text-black shadow-lg font-bold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <User className={`w-4 h-4 ${activeTab === 'account' ? 'text-black' : 'text-amber-400'}`} />
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
        <div className="flex-1 flex flex-col overflow-hidden bg-black/40">
          {/* Top Bar with Close Button */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              {activeTab === 'playback' && 'Audio Playback & Seamless Transitions'}
              {activeTab === 'taste' && 'Personalized Music Taste Profile'}
              {activeTab === 'eq' && '10-Band Graphic Equalizer'}
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
                      <h5 className="text-xs font-bold text-white">Search Any Artist</h5>
                    </div>
                    {isSearchingArtists && (
                      <span className="text-[10px] font-mono text-lumen-cyan animate-pulse">Searching official artists...</span>
                    )}
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={artistSearchQuery}
                      onChange={(e) => setArtistSearchQuery(e.target.value)}
                      placeholder="Type artist name (e.g. Drake, Taylor Swift, Billie Eilish, Travis Scott)..."
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
                {/* Profile Banner */}
                <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-4">
                  <div 
                    className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center border-2 border-white/30 shadow-xl"
                    style={{ background: `radial-gradient(circle at 30% 30%, ${dominantColor}, #111521)` }}
                  >
                    <User className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-lg font-black text-white">Saatvik</h4>
                      <ShieldCheck className="w-4 h-4 text-lumen-cyan" />
                    </div>
                    <p className="text-xs text-white/60">Hi-Fi Audiophile Tier • Local Universal Server</p>
                    <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-mono text-lumen-cyan">
                      Active: http://localhost:3847
                    </span>
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
                                  <span className="text-white/40 text-[10px] ml-1.5">— {song.artist}</span>
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
                                  ★ {song.formatted}
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

            {/* TAB 6: FRIENDS & LISTENING SOCIAL MUSIC SYSTEM */}
            {activeTab === 'friends' && (
              <div className="space-y-5 animate-in fade-in duration-200">
                {/* Header & Sub-Navigation */}
                <div className="pb-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                      <Users className="w-5 h-5 text-emerald-400" />
                      Friends & Listening
                    </h4>
                    <p className="text-xs text-white/50">Share songs directly, see friends' verified ratings, and compare music taste.</p>
                  </div>

                  {/* Sub-Navigation Pills */}
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl">
                    <button
                      onClick={() => setSocialSubTab('inbox')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        socialSubTab === 'inbox'
                          ? 'bg-white text-black shadow-md font-bold'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <Inbox className="w-3.5 h-3.5" />
                      <span>Received</span>
                      {receivedShares.filter(s => !s.is_read).length > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-black text-[10px] font-bold">
                          {receivedShares.filter(s => !s.is_read).length}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => setSocialSubTab('send')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        socialSubTab === 'send'
                          ? 'bg-white text-black shadow-md font-bold'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Song</span>
                    </button>

                    <button
                      onClick={() => setSocialSubTab('friends')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        socialSubTab === 'friends'
                          ? 'bg-white text-black shadow-md font-bold'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Friends</span>
                      {friendsList.length > 0 && (
                        <span className="text-[10px] text-white/40">({friendsList.length})</span>
                      )}
                    </button>

                    <button
                      onClick={() => setSocialSubTab('compare')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        socialSubTab === 'compare'
                          ? 'bg-white text-black shadow-md font-bold'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <Star className="w-3.5 h-3.5 text-amber-400" />
                      <span>Ratings & Taste</span>
                    </button>

                    <button
                      onClick={() => setSocialSubTab('settings')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        socialSubTab === 'settings'
                          ? 'bg-white text-black shadow-md font-bold'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-lumen-cyan" />
                      <span>Privacy</span>
                    </button>
                  </div>
                </div>

                {/* 1. SONGS RECEIVED FROM FRIENDS (INBOX) */}
                {socialSubTab === 'inbox' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono uppercase tracking-wider text-white/60 font-bold block">
                        Songs Received From Friends ({receivedShares.length})
                      </span>
                      <button
                        onClick={async () => {
                          setIsLoadingShares(true);
                          const shares = await RatingAndStatsService.fetchReceivedShares();
                          setReceivedShares(shares);
                          setIsLoadingShares(false);
                        }}
                        className="text-xs text-white/50 hover:text-white flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> Refresh
                      </button>
                    </div>

                    {isLoadingShares ? (
                      <div className="py-12 text-center text-xs text-white/50">Loading shared songs...</div>
                    ) : receivedShares.length > 0 ? (
                      <div className="space-y-2.5">
                        {receivedShares.map((share) => (
                          <div
                            key={share.share_id}
                            className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                              !share.is_read
                                ? 'bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                                : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-center gap-3.5 min-w-0">
                              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/10 border border-white/10 flex items-center justify-center flex-shrink-0">
                                <Music2 className="w-5 h-5 text-emerald-400" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <h5 className="text-xs font-bold text-white truncate">{share.title}</h5>
                                  {!share.is_read && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-400 text-black text-[9px] font-bold uppercase tracking-wider">
                                      New
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-white/60 truncate">{share.artist} {share.album ? `• ${share.album}` : ''}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-emerald-400 font-mono">From @{share.sender_username || share.sender_id}</span>
                                  {share.message && (
                                    <span className="text-[10px] text-white/40 italic truncate">"{share.message}"</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                              <button
                                onClick={async () => {
                                  const likedTracks = LikedService.getLikedTracks();
                                  const res = await RatingAndStatsService.resolveSongAvailability(share, likedTracks);
                                  if (res.available && res.matchedTrack) {
                                    AudioEngine.playTrack(res.matchedTrack);
                                    await RatingAndStatsService.markShareRead(share.share_id);
                                    setReceivedShares(prev => prev.map(s => s.share_id === share.share_id ? { ...s, is_read: true } : s));
                                  } else {
                                    alert(res.reason || 'This song is not available in your current library.');
                                  }
                                }}
                                className="px-3 py-1.5 rounded-xl bg-emerald-400 text-black font-bold text-xs hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 shadow-md"
                              >
                                <Play className="w-3.5 h-3.5 fill-black" />
                                <span>Play</span>
                              </button>

                              <button
                                onClick={async () => {
                                  const likedTracks = LikedService.getLikedTracks();
                                  const res = await RatingAndStatsService.resolveSongAvailability(share, likedTracks);
                                  if (res.available && res.matchedTrack) {
                                    AudioEngine.addToQueue(res.matchedTrack);
                                    await RatingAndStatsService.markShareRead(share.share_id);
                                    setReceivedShares(prev => prev.map(s => s.share_id === share.share_id ? { ...s, is_read: true } : s));
                                    alert(`Added "${share.title}" to playback queue!`);
                                  } else {
                                    alert(res.reason || 'This song is not available in your current library.');
                                  }
                                }}
                                className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
                                title="Add to Queue"
                              >
                                + Queue
                              </button>

                              <button
                                onClick={async () => {
                                  await RatingAndStatsService.dismissShare(share.share_id);
                                  setReceivedShares(prev => prev.filter(s => s.share_id !== share.share_id));
                                }}
                                className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                                title="Dismiss Share"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center rounded-2xl bg-white/[0.02] border border-white/10 text-white/40 text-xs space-y-2">
                        <Inbox className="w-8 h-8 mx-auto text-white/20 mb-2" />
                        <p>No songs received yet.</p>
                        <p className="text-[10px] text-white/30">When friends share music with you, tracks appear here with instant play and queue options.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. SEND A SONG TO A FRIEND */}
                {socialSubTab === 'send' && (
                  <div className="space-y-4">
                    <span className="text-xs font-mono uppercase tracking-wider text-white/60 font-bold block">
                      Send a Song to an Accepted Friend
                    </span>

                    {friendsList.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl bg-white/[0.02] border border-white/10 text-white/40 text-xs">
                        You have not connected with any friends yet. Add a friend by username in the Friends tab first!
                      </div>
                    ) : (
                      <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
                        {/* Select Friend */}
                        <div>
                          <label className="block text-xs font-mono text-white/70 mb-1.5 font-bold">1. Select Recipient Friend</label>
                          <select
                            value={shareRecipientId}
                            onChange={(e) => setShareRecipientId(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-emerald-400"
                          >
                            <option value="">-- Choose a friend --</option>
                            {friendsList.map(f => (
                              <option key={f.user_id} value={f.user_id}>@{f.username}</option>
                            ))}
                          </select>
                        </div>

                        {/* Song Selection */}
                        <div>
                          <label className="block text-xs font-mono text-white/70 mb-1.5 font-bold">2. Track to Share</label>
                          {(() => {
                            const cur = AudioEngine.getCurrentTrack();
                            return (
                              <div className="p-3 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between">
                                {cur ? (
                                  <div className="min-w-0 pr-2">
                                    <span className="text-xs font-bold text-white block truncate">{cur.title}</span>
                                    <span className="text-[10px] text-white/50 block truncate">— {cur.artist}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-white/40">No track currently playing</span>
                                )}
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                                  Currently Playing Track
                                </span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Optional Message */}
                        <div>
                          <label className="block text-xs font-mono text-white/70 mb-1.5 font-bold">3. Add a Personal Note (Optional)</label>
                          <input
                            type="text"
                            value={shareMessage}
                            onChange={(e) => setShareMessage(e.target.value)}
                            placeholder="e.g. Check out this bass drop, you'll love it!"
                            className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400"
                          />
                        </div>

                        {/* Send Action */}
                        <div className="pt-2 flex items-center justify-between">
                          <button
                            onClick={async () => {
                              const cur = AudioEngine.getCurrentTrack();
                              if (!cur) {
                                alert('Please play or select a track first before sharing.');
                                return;
                              }
                              if (!shareRecipientId) {
                                alert('Please select a recipient friend.');
                                return;
                              }
                              setShareStatusMsg('Sending share...');
                              const res = await RatingAndStatsService.sendSongShare({
                                recipientId: shareRecipientId,
                                song: cur,
                                message: shareMessage.trim() || undefined
                              });
                              if (res.success) {
                                setShareStatusMsg('Song sent successfully!');
                                setShareMessage('');
                                const sent = await RatingAndStatsService.fetchSentShares();
                                setSentShares(sent);
                              } else {
                                setShareStatusMsg(res.message || 'Failed to send share');
                              }
                              setTimeout(() => setShareStatusMsg(null), 3000);
                            }}
                            className="px-5 py-2 rounded-xl bg-emerald-400 text-black font-bold text-xs hover:scale-105 active:scale-95 transition-all shadow-md flex items-center gap-2"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Send Song Share</span>
                          </button>

                          {shareStatusMsg && (
                            <span className="text-xs font-mono text-emerald-400">{shareStatusMsg}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Previously Sent Shares */}
                    <div className="pt-4 space-y-2">
                      <h5 className="text-xs font-bold text-white/70 uppercase tracking-wider">Previously Sent Songs ({sentShares.length})</h5>
                      {sentShares.length > 0 ? (
                        <div className="divide-y divide-white/5 rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
                          {sentShares.map((sent) => (
                            <div key={sent.share_id} className="flex items-center justify-between p-3 text-xs">
                              <div className="min-w-0 pr-2">
                                <span className="font-semibold text-white block truncate">{sent.title}</span>
                                <span className="text-[10px] text-white/40 block truncate">
                                  {sent.artist} • Sent to @{sent.recipient_username || sent.recipient_id}
                                </span>
                              </div>
                              <button
                                onClick={async () => {
                                  if (confirm(`Revoke share for "${sent.title}"?`)) {
                                    await RatingAndStatsService.revokeShare(sent.share_id);
                                    setSentShares(prev => prev.filter(s => s.share_id !== sent.share_id));
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-semibold hover:bg-red-500/20 transition-all flex-shrink-0"
                              >
                                Revoke
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-white/30 text-xs py-3 text-center">No sent shares yet.</div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. FRIENDS & REQUESTS */}
                {socialSubTab === 'friends' && (
                  <div className="space-y-4">
                    {/* Add Friend Form */}
                    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                      <h5 className="text-xs font-bold text-white">Add a Friend by Unique Username</h5>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={friendSearchInput}
                          onChange={(e) => setFriendSearchInput(e.target.value)}
                          placeholder="Enter exact username (e.g. alice, bob)..."
                          className="flex-1 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400 font-mono"
                        />
                        <button
                          onClick={async () => {
                            if (!friendSearchInput.trim()) return;
                            setFriendSearchStatus('Sending request...');
                            const res = await RatingAndStatsService.sendFriendRequest(friendSearchInput.trim());
                            if (res.success) {
                              setFriendSearchStatus('Request sent successfully!');
                              setFriendSearchInput('');
                              const updated = await RatingAndStatsService.fetchFriends();
                              setFriendsList(updated.friends);
                              setPendingRequests(updated.pending);
                            } else {
                              setFriendSearchStatus(res.message || 'Error sending request');
                            }
                            setTimeout(() => setFriendSearchStatus(null), 3000);
                          }}
                          className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:scale-105 active:scale-95 transition-all shadow-md flex-shrink-0"
                        >
                          Send Request
                        </button>
                      </div>
                      {friendSearchStatus && (
                        <span className="text-[11px] font-mono text-emerald-400">{friendSearchStatus}</span>
                      )}
                    </div>

                    {/* Pending Requests */}
                    {(() => {
                      const incomingList = Array.isArray(pendingRequests) ? pendingRequests : ((pendingRequests as any)?.incoming || []);
                      if (incomingList.length === 0) return null;
                      return (
                        <div className="space-y-2">
                          <h5 className="text-xs font-bold text-white/70 uppercase tracking-wider">Pending Friend Requests ({incomingList.length})</h5>
                          <div className="divide-y divide-white/5 rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
                            {incomingList.map((req: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between px-4 py-3">
                                <span className="text-xs font-semibold text-white">@{req.requester_username || req.requester_id}</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={async () => {
                                      await RatingAndStatsService.respondFriendRequest(req.requester_id, 'accepted');
                                      const updated = await RatingAndStatsService.fetchFriends();
                                      setFriendsList(updated.friends);
                                      setPendingRequests(updated.pending);
                                    }}
                                    className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-500/30 transition-all"
                                  >
                                    Accept
                                  </button>
                                  <button
                                    onClick={async () => {
                                      await RatingAndStatsService.respondFriendRequest(req.requester_id, 'declined');
                                      const updated = await RatingAndStatsService.fetchFriends();
                                      setFriendsList(updated.friends);
                                      setPendingRequests(updated.pending);
                                    }}
                                    className="px-3 py-1 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold hover:bg-red-500/30 transition-all"
                                  >
                                    Decline
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Accepted Friends List */}
                    <div className="space-y-3">
                      <h5 className="text-xs font-bold text-white/70 uppercase tracking-wider">Accepted Friends ({friendsList.length})</h5>
                      {friendsList && friendsList.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {friendsList.map((friend) => (
                            <div
                              key={friend.user_id}
                              className="p-3.5 rounded-2xl border bg-white/[0.02] border-white/10 hover:border-white/20 hover:bg-white/[0.04] transition-all flex items-center justify-between"
                            >
                              <div>
                                <h6 className="text-xs font-bold text-white">@{friend.username}</h6>
                                <span className="text-[10px] text-white/40 font-mono">Rating Visibility: {friend.rating_visibility}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={async () => {
                                    setSocialSubTab('compare');
                                    setSelectedFriendForCompare(friend);
                                    setIsLoadingComparison(true);
                                    const data = await RatingAndStatsService.compareWithFriend(friend.user_id);
                                    setComparisonData(data);
                                    setIsLoadingComparison(false);
                                  }}
                                  className="text-[10px] font-semibold text-emerald-400 px-2.5 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                                >
                                  Compare Taste
                                </button>
                                <button
                                  onClick={async () => {
                                    if (confirm(`Remove @${friend.username} from friends?`)) {
                                      await RatingAndStatsService.removeFriend(friend.user_id);
                                      const updated = await RatingAndStatsService.fetchFriends();
                                      setFriendsList(updated.friends);
                                    }
                                  }}
                                  className="p-1 text-white/30 hover:text-red-400 transition-colors"
                                  title="Remove Friend"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-6 text-center rounded-2xl bg-white/[0.02] border border-white/10 text-white/40 text-xs">
                          No friends added yet. Add a friend by username above to share songs and compare music taste.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. SHARED RATINGS & TASTE COMPARISON */}
                {socialSubTab === 'compare' && (
                  <div className="space-y-4">
                    {/* Friend Selector */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-2">
                      <span className="text-xs font-mono text-white/50 flex-shrink-0">Compare with:</span>
                      {friendsList.map(friend => (
                        <button
                          key={friend.user_id}
                          onClick={async () => {
                            setSelectedFriendForCompare(friend);
                            setIsLoadingComparison(true);
                            const data = await RatingAndStatsService.compareWithFriend(friend.user_id);
                            setComparisonData(data);
                            setIsLoadingComparison(false);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                            selectedFriendForCompare?.user_id === friend.user_id
                              ? 'bg-emerald-400 text-black font-bold shadow-md'
                              : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10'
                          }`}
                        >
                          @{friend.username}
                        </button>
                      ))}
                    </div>

                    {selectedFriendForCompare ? (
                      <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/15 space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-white/10">
                          <div>
                            <span className="text-[10px] font-mono uppercase text-emerald-400">Taste Matrix</span>
                            <h5 className="text-sm font-bold text-white">Comparing with @{selectedFriendForCompare.username}</h5>
                          </div>
                          <span className="text-xs font-mono text-white/40">
                            Scale: 0.1 – 10.0
                          </span>
                        </div>

                        {isLoadingComparison ? (
                          <div className="py-8 text-center text-xs text-white/50">Analyzing comparative ratings...</div>
                        ) : (
                          <div className="space-y-4">
                            {/* Shared Favorites */}
                            <div>
                              <h6 className="text-xs font-bold text-amber-300 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                                Shared Favorites (Both Rated ≥ 8.0)
                              </h6>
                              {comparisonData?.shared_favorites && comparisonData.shared_favorites.length > 0 ? (
                                <div className="divide-y divide-white/5 rounded-xl bg-black/40 border border-white/10 overflow-hidden">
                                  {comparisonData.shared_favorites.map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-xs">
                                      <div className="min-w-0 pr-2">
                                        <span className="font-semibold text-white">{item.title}</span>
                                        <span className="text-white/40 text-[10px] ml-1.5">— {item.artist}</span>
                                      </div>
                                      <div className="flex items-center gap-3 font-mono text-xs flex-shrink-0">
                                        <span className="text-white/80">You: <b className="text-amber-300">{item.user_a_rating}</b></span>
                                        <span className="text-white/80">@{selectedFriendForCompare.username}: <b className="text-amber-300">{item.user_b_rating}</b></span>
                                        <span className="text-[10px] text-white/40">Δ {item.difference}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-white/30 text-xs py-2 px-3 bg-black/20 rounded-xl">No shared favorites ≥ 8.0 yet</div>
                              )}
                            </div>

                            {/* Rating Divergence */}
                            <div>
                              <h6 className="text-xs font-bold text-lumen-violet uppercase tracking-wide flex items-center gap-1.5 mb-2">
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                Taste Divergence (Largest Rating Gaps)
                              </h6>
                              {comparisonData?.divergence && comparisonData.divergence.length > 0 ? (
                                <div className="divide-y divide-white/5 rounded-xl bg-black/40 border border-white/10 overflow-hidden">
                                  {comparisonData.divergence.slice(0, 5).map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-xs">
                                      <div className="min-w-0 pr-2">
                                        <span className="font-semibold text-white">{item.title}</span>
                                        <span className="text-white/40 text-[10px] ml-1.5">— {item.artist}</span>
                                      </div>
                                      <div className="flex items-center gap-3 font-mono text-xs flex-shrink-0">
                                        <span className="text-white/80">You: <b className="text-white">{item.user_a_rating}</b></span>
                                        <span className="text-white/80">@{selectedFriendForCompare.username}: <b className="text-white">{item.user_b_rating}</b></span>
                                        <span className="text-xs font-bold text-pink-400">Δ {item.difference}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-white/30 text-xs py-2 px-3 bg-black/20 rounded-xl">No divergent ratings found</div>
                              )}
                            </div>

                            {/* Discovery Opportunities */}
                            <div>
                              <h6 className="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                                <Sparkles className="w-3.5 h-3.5" />
                                Discovery Recommendations (Friend Rated ≥ 8.0, You Haven't Heard)
                              </h6>
                              {comparisonData?.discovery && comparisonData.discovery.length > 0 ? (
                                <div className="divide-y divide-white/5 rounded-xl bg-black/40 border border-white/10 overflow-hidden">
                                  {comparisonData.discovery.slice(0, 5).map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-xs">
                                      <div className="min-w-0 pr-2">
                                        <span className="font-semibold text-white">{item.title}</span>
                                        <span className="text-white/40 text-[10px] ml-1.5">— {item.artist}</span>
                                      </div>
                                      <div className="flex items-center gap-2 font-mono text-xs flex-shrink-0">
                                        <span className="text-white/60">@{selectedFriendForCompare.username} rated:</span>
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                                          ★ {item.friend_formatted}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-white/30 text-xs py-2 px-3 bg-black/20 rounded-xl">No new recommendations from this friend right now</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-8 text-center rounded-2xl bg-white/[0.02] border border-white/10 text-white/40 text-xs">
                        Select an accepted friend above to inspect your comparative music taste matrix.
                      </div>
                    )}
                  </div>
                )}

                {/* 5. PRIVACY & PERMISSIONS SETTINGS */}
                {socialSubTab === 'settings' && (
                  <div className="space-y-4">
                    <span className="text-xs font-mono uppercase tracking-wider text-white/60 font-bold block">
                      Social Sharing & Privacy Permissions
                    </span>

                    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
                      <div>
                        <span className="text-[10px] font-mono uppercase text-white/40">Authenticated Account ID</span>
                        <div className="text-xs font-mono font-bold text-white mt-0.5">
                          {RatingAndStatsService.getUsername()} <span className="text-white/40 font-normal">({RatingAndStatsService.getUserId()})</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/10">
                        <span className="text-xs font-bold text-white block mb-1">Song Rating Visibility</span>
                        <p className="text-[11px] text-white/50 mb-3">Controls who can view your 0.1–10.0 ratings and include you in taste comparisons.</p>
                        <div className="flex items-center gap-1.5 p-1 bg-white/[0.04] border border-white/10 rounded-xl max-w-sm">
                          {(['public', 'friends', 'private'] as const).map(vis => (
                            <button
                              key={vis}
                              onClick={async () => {
                                setRatingVisibility(vis);
                                await RatingAndStatsService.setRatingVisibility(vis);
                              }}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                                ratingVisibility === vis
                                  ? 'bg-white text-black shadow-md font-bold'
                                  : 'text-white/60 hover:text-white'
                              }`}
                            >
                              {vis}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-black/40 border border-white/10 text-[11px] text-white/60 space-y-1.5">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          Security & Privacy Assurance
                        </div>
                        <p>• Only accepted friends can view your ratings when set to "Friends".</p>
                        <p>• Raw listening history, skip logs, and local file paths are strictly private and never exposed to other accounts.</p>
                        <p>• Setting visibility to "Private" immediately redacts you from all friend taste matrices.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
