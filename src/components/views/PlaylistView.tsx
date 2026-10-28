import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  Edit3, 
  Upload, 
  Palette, 
  Plus, 
  Music, 
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
  SkipForward
} from 'lucide-react';
import { CustomPlaylist, Track } from '../../types/music';
import { StreamingService } from '../../services/streamingService';
import { AudioEngine } from '../../services/audioEngine';
import { LikedService } from '../../services/likedService';
import { extractDominantColor } from '../../services/colorSampler';
import { useDeviceMode } from '../../hooks/useDeviceMode';
import { SongRatingWidget } from './SongRatingWidget';
import { ImportPlaylistModal } from './ImportPlaylistModal';
import { PlaylistCarouselModal } from './PlaylistCarouselModal';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  playlists: CustomPlaylist[];
  activePlaylistId: string | null;
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: (name?: string) => CustomPlaylist;
  onImportPlaylist?: (playlist: CustomPlaylist) => void;
  onUpdatePlaylist: (id: string, updates: Partial<CustomPlaylist>) => void;
  onDeletePlaylist: (id: string) => void;
  onAddTrack: (playlistId: string, track: Track) => boolean;
  onRemoveTrack: (playlistId: string, trackId: string, trackIndex?: number) => void;
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
  tasteTracks = []
}) => {
  const activePlaylist = playlists.find(p => p.id === activePlaylistId) || playlists[0] || null;

  const { isPhone, isTablet } = useDeviceMode();
  const isCompactLayout = isPhone || isTablet;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

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
  const [aiPrompt, setAiPrompt] = useState('');
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
  const [bassScale, setBassScale] = useState(1);
  const [spectrumBars, setSpectrumBars] = useState<number[]>([40, 60, 80, 50, 70, 90, 60, 40]);

  // In-Playlist Search & Sort
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [sortMode, setSortMode] = useState<'custom' | 'title' | 'artist' | 'duration'>('custom');
  const [, setLikedTick] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsScrollRef = useRef<HTMLDivElement | null>(null);

  // Audio reactive bass pulse & spectral flow for the right-side player widget
  useEffect(() => {
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
  }, []);

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

  // Fetch or sync suggested songs based on taste profile recommendations
  useEffect(() => {
    if (tasteTracks && tasteTracks.length > 0) {
      setSuggestedSongs(tasteTracks.slice(0, 10));
      setSuggestionPool(tasteTracks.slice(10));
    } else {
      StreamingService.getRecommendations().then((res) => {
        const combined = [...res.madeForYou, ...res.genreMixes];
        setSuggestedSongs(combined.slice(0, 10));
        setSuggestionPool(combined.slice(10));
      });
    }
  }, [tasteTracks]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (playlistDropdownRef.current && !playlistDropdownRef.current.contains(e.target as Node)) {
        setIsPlaylistDropdownOpen(false);
      }
      if (addPlaylistDropdownRef.current && !addPlaylistDropdownRef.current.contains(e.target as Node)) {
        setIsAddPlaylistDropdownOpen(false);
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

  // Silent Progressive Artwork Healer
  // Automatically repairs missing album covers in the background without UI clutter
  useEffect(() => {
    if (!activePlaylist || !activePlaylist.tracks || activePlaylist.tracks.length === 0) return;

    const missingTracks = activePlaylist.tracks.filter(t => !t.artworkUrl || t.artworkUrl.trim() === '');
    if (missingTracks.length === 0) return;

    let isMounted = true;

    async function healMissingCovers() {
      // Chunk into batches of 15 tracks
      const chunkSize = 15;
      for (let i = 0; i < missingTracks.length; i += chunkSize) {
        if (!isMounted) break;
        const chunk = missingTracks.slice(i, i + chunkSize);
        try {
          const res = await fetch('/api/tracks/heal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: chunk })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.healed && data.healed.length > 0) {
              const healedMap = new Map<string, string>();
              for (const h of data.healed) {
                if (h.artworkUrl) healedMap.set(h.id, h.artworkUrl);
              }

              if (healedMap.size > 0 && isMounted) {
                const updatedTracks = activePlaylist!.tracks.map(t => {
                  if (healedMap.has(t.id)) {
                    return { ...t, artworkUrl: healedMap.get(t.id)!, hasArtwork: true };
                  }
                  return t;
                });
                onUpdatePlaylist(activePlaylist!.id, { tracks: updatedTracks });
              }
            }
          }
        } catch (err) {
          console.warn('[PlaylistHealer] Background heal paused:', err);
        }
        // Polite delay between batches
        await new Promise(r => setTimeout(r, 600));
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

  const handleAddTrackToCurrent = (track: Track) => {
    if (!activePlaylist) return;
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

  return (
    <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-2xl flex flex-col p-4 sm:p-8 select-none animate-fadeIn">
      {/* 3D Glass Top Bar: Navigation, Search & Controls */}
      <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5 relative z-30">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono uppercase tracking-widest text-white/50 font-bold hidden sm:inline">
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
                              {coverImg ? (
                                <img src={coverImg} alt={pl.name} className="w-full h-full object-cover" />
                              ) : (
                                <Music className="w-4 h-4 text-white/70" />
                              )}
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
                  </div>
                )}
              </div>
            )}

            {/* Consolidated Add/New Playlist Glass Dropdown */}
            <div className="relative" ref={addPlaylistDropdownRef}>
              <button
                type="button"
                onClick={() => setIsAddPlaylistDropdownOpen(prev => !prev)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-lumen-cyan text-black font-bold text-xs shadow-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                title="Create, generate with AI, or import a playlist"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Add Playlist</span>
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

        <div className="flex items-center gap-2">
          {onOpenQueue && (
            <button
              onClick={onOpenQueue}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs text-white/80 hover:text-white transition-all"
              title="Open Play Queue"
            >
              <ListMusic className="w-3.5 h-3.5 text-lumen-cyan" />
              <span className="hidden sm:inline">Queue</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {activePlaylist ? (
        <div className={`flex-1 flex ${isCompactLayout ? 'flex-col gap-3' : 'flex-col lg:flex-row gap-6'} overflow-hidden`}>
          {/* TOP 3/4 PANE (COMPACT) OR LEFT PANE (DESKTOP) (APPLE VISIONOS LIQUID GLASS) */}
          <div 
            className={`${isCompactLayout ? 'h-[74%]' : 'flex-1'} flex flex-col overflow-hidden bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-white/[0.01] border-t border-l border-white/40 border-r border-b border-black/60 rounded-2xl sm:rounded-3xl ${isCompactLayout ? 'p-3.5 sm:p-5' : 'p-5 sm:p-7'} backdrop-blur-3xl shadow-2xl`}
            style={{
              boxShadow: '0 30px 70px rgba(0, 0, 0, 0.8), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4)'
            }}
          >
            {/* Header: Cover, Title, Stats & Actions */}
            <div className={`flex ${isCompactLayout ? 'flex-row items-center gap-3.5 pb-3' : 'flex-col sm:flex-row items-center sm:items-end gap-5 pb-5'} border-b border-white/10 flex-shrink-0`}>
              {/* Editable Cover Art */}
              <div 
                className={`relative ${isCompactLayout ? 'w-20 h-20 sm:w-28 sm:h-28' : 'w-32 h-32 sm:w-40 sm:h-40'} rounded-2xl overflow-hidden flex-shrink-0 group cursor-pointer border border-white/20 shadow-2xl transition-transform duration-300 hover:scale-105`}
                style={{
                  backgroundColor: activePlaylist.coverColor || dominantColor,
                  boxShadow: `0 20px 40px -10px ${activePlaylist.coverColor || dominantColor}60`
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                {activePlaylist.coverUrl || activePlaylist.tracks.find(t => t.artworkUrl)?.artworkUrl ? (
                  <img 
                    src={activePlaylist.coverUrl || activePlaylist.tracks.find(t => t.artworkUrl)!.artworkUrl!} 
                    alt={activePlaylist.name} 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-white/80 p-4 text-center">
                    <Music className="w-9 h-9 mb-1.5 stroke-[1.5]" />
                    <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Custom Cover</span>
                  </div>
                )}

                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1.5 transition-opacity text-white text-xs">
                  <Upload className="w-4 h-4 mb-0.5" />
                  <span className="font-mono text-[9px] uppercase tracking-wider">Change Cover</span>
                </div>

                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleCoverUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>

              {/* Title & Info */}
              <div className="flex-1 text-center sm:text-left min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-widest text-lumen-cyan font-bold">
                  PLAYLIST
                </span>

                {isEditingTitle ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                      className="text-2xl sm:text-3xl font-black bg-white/10 border border-white/30 rounded-xl px-3 py-1 text-white focus:outline-none w-full"
                      autoFocus
                    />
                    <button 
                      onClick={handleSaveTitle} 
                      className="p-2 rounded-xl bg-white text-black font-bold"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div 
                    onClick={handleStartEditTitle}
                    className="flex items-center justify-center sm:justify-start gap-2.5 group cursor-pointer mt-1"
                  >
                    <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight group-hover:text-lumen-cyan transition-colors truncate">
                      {activePlaylist.name}
                    </h2>
                    <Edit3 className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
                  </div>
                )}

                {isEditingDesc ? (
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      type="text"
                      value={editedDesc}
                      onChange={(e) => setEditedDesc(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveDesc()}
                      placeholder="Add an optional description..."
                      className="text-xs bg-white/10 border border-white/30 rounded-xl px-3 py-1 text-white focus:outline-none w-full"
                      autoFocus
                    />
                    <button onClick={handleSaveDesc} className="p-1.5 rounded-xl bg-white text-black">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <p 
                    onClick={handleStartEditDesc}
                    className="text-xs text-white/60 mt-1 cursor-pointer hover:text-white transition-colors max-w-lg truncate"
                  >
                    {activePlaylist.description || 'Click to add description...'}
                  </p>
                )}

                {/* Stats */}
                <div className="flex items-center justify-center sm:justify-start gap-3 mt-2 text-xs font-mono text-white/50">
                  <span>{activePlaylist.tracks.length} tracks</span>
                  <span>•</span>
                  <span>{totalMinutes} mins</span>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-center sm:justify-start flex-wrap gap-2.5 mt-3">
                  <button
                    onClick={() => onPlayAll(displayedTracks)}
                    disabled={activePlaylist.tracks.length === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-black font-bold text-xs shadow-lg transition-transform hover:scale-105 disabled:opacity-40"
                    style={{ backgroundColor: activePlaylist.coverColor || dominantColor }}
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                    <span>Play All</span>
                  </button>

                  {/* Shuffle Playback Button */}
                  <button
                    onClick={handleShufflePlay}
                    disabled={activePlaylist.tracks.length === 0}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs shadow-lg transition-transform hover:scale-105 disabled:opacity-40"
                    title="Shuffle Play Playlist"
                  >
                    <Shuffle className="w-3.5 h-3.5 text-lumen-cyan" />
                    <span>Shuffle</span>
                  </button>

                  {/* Pick Color Preset */}
                  <div className="relative">
                    <button
                      onClick={() => setShowColorPicker(!showColorPicker)}
                      className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                      title="Set LED Aura Color"
                    >
                      <Palette className="w-3.5 h-3.5" />
                    </button>

                    {showColorPicker && (
                      <div className="absolute left-0 mt-2 p-2 bg-black/90 border border-white/20 rounded-2xl flex gap-1.5 z-30 shadow-xl">
                        {PRESET_GRADIENTS.map(color => (
                          <div
                            key={color}
                            onClick={() => handleSetCoverColor(color)}
                            className="w-5 h-5 rounded-full cursor-pointer border border-white/30 hover:scale-110 transition-transform"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Duplicate Playlist */}
                  <button
                    onClick={handleDuplicatePlaylist}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                    title="Duplicate Playlist (Make a Copy)"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  {/* Add Songs '+' Button */}
                  <button
                    onClick={() => setIsCarouselModalOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-lumen-cyan text-black font-bold text-xs shadow-lg transition-transform hover:scale-105 cursor-pointer"
                    title="Add Songs via 3D Cover Flow Carousel"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Add Songs</span>
                  </button>

                  {/* Delete Playlist Trash Bin */}
                  <button
                    onClick={() => {
                      if (confirm(`Delete playlist "${activePlaylist.name}"?`)) {
                        onDeletePlaylist(activePlaylist.id);
                      }
                    }}
                    className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-colors"
                    title="Delete Playlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* IN-PLAYLIST SEARCH & SORT BAR */}
            <div className="flex items-center justify-between gap-3 pt-3 pb-2 flex-shrink-0">
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={playlistSearch}
                  onChange={(e) => setPlaylistSearch(e.target.value)}
                  placeholder="Search in this playlist..."
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
                        className={`group flex items-center justify-between p-2 rounded-xl transition-all duration-200 border ${
                          isTrackPlaying
                            ? 'bg-white/10 border-white/20'
                            : 'hover:bg-white/5 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Play Button */}
                          <button
                            onClick={() => onPlayTrack(track, displayedTracks)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white group-hover:bg-white/10 transition-colors"
                          >
                            {isTrackPlaying ? (
                              <Pause className="w-3.5 h-3.5 fill-current text-lumen-cyan" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            )}
                          </button>

                          {/* Mini Album Cover */}
                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-black/60 flex-shrink-0 relative">
                            {(track.artworkUrl || activePlaylist?.coverUrl) ? (
                              <img 
                                src={track.artworkUrl || activePlaylist?.coverUrl || ''} 
                                alt={track.title} 
                                className="w-full h-full object-cover" 
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fb = e.currentTarget.nextElementSibling as HTMLElement;
                                  if (fb) fb.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div 
                              className={`w-full h-full items-center justify-center bg-black/80 text-white/30 ${(track.artworkUrl || activePlaylist?.coverUrl) ? 'hidden' : 'flex'}`}
                            >
                              <Disc3 className="w-4 h-4 text-white/40" />
                            </div>
                          </div>

                          {/* Title & Artist */}
                          <div className="min-w-0 flex-1 pr-2">
                            <h4 className={`text-xs font-bold truncate ${isTrackPlaying ? 'text-lumen-cyan' : 'text-white'}`}>
                              {track.title}
                            </h4>
                            <p 
                              onClick={() => onSelectArtist(track.artist)}
                              className="text-[10px] text-white/50 truncate hover:text-white cursor-pointer"
                            >
                              {track.artist}
                            </p>
                          </div>
                        </div>

                        {/* Actions: Reorder, Like, Add to Playlist, Duration, Remove */}
                        <div className="flex items-center gap-2">
                          {/* Reorder Buttons (only in Custom Order) */}
                          {sortMode === 'custom' && (
                            <div className="hidden group-hover:flex items-center gap-0.5">
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

                          {/* Like Heart Button */}
                          <button
                            onClick={() => handleToggleLikeTrack(track)}
                            className="p-1 text-white/40 hover:text-rose-400 transition-colors"
                            title={isLiked ? "Unlike Song" : "Like Song"}
                          >
                            <Heart className={`w-3.5 h-3.5 ${isLiked ? 'text-rose-500 fill-rose-500' : ''}`} />
                          </button>

                          {/* Add to another playlist */}
                          {onOpenAddToPlaylist && (
                            <button
                              onClick={() => onOpenAddToPlaylist(track)}
                              className="p-1 text-white/30 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Add to another playlist"
                            >
                              <FolderPlus className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Duration */}
                          <span className="text-[11px] font-mono text-white/40 w-10 text-right">
                            {formatDuration(track.duration)}
                          </span>

                          {/* Remove */}
                          <button
                            onClick={() => onRemoveTrack(activePlaylist.id, track.id, idx)}
                            className="p-1 rounded-full text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove from playlist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* PLAYER COMPONENT: 1/4 BOTTOM LIQUID GLASS FOR PHONES/TABLETS, OR RIGHT PANE FOR DESKTOP */}
          {isCompactLayout ? (
            <div 
              className="h-[25%] min-h-[92px] max-h-36 flex flex-col justify-between bg-gradient-to-br from-white/[0.1] via-white/[0.04] to-white/[0.01] border-t border-l border-white/40 border-r border-b border-black/60 rounded-2xl p-3 backdrop-blur-3xl shadow-2xl relative overflow-hidden select-none flex-shrink-0"
              style={{
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4)'
              }}
            >
              {/* Dynamic LED perimeter frame synchronized to the beat */}
              <div 
                className="absolute inset-0 rounded-2xl pointer-events-none transition-all duration-150"
                style={{
                  border: `2px solid ${dominantColor}`,
                  boxShadow: `inset 0 0 ${Math.round(18 * bassScale)}px ${dominantColor}50, 0 0 ${Math.round(24 * bassScale)}px ${dominantColor}40`,
                  opacity: 0.85
                }}
              />

              {/* Top: Micro Scrubber Bar */}
              <div className="w-full flex items-center gap-2 font-mono text-[9px] text-white/60 z-10">
                <span className="w-7 text-right">{formatDuration(currentTime)}</span>
                <div className="relative flex-1 h-1 bg-white/20 rounded-full overflow-hidden flex items-center group cursor-pointer">
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <div 
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                      backgroundColor: dominantColor,
                      boxShadow: `0 0 6px ${dominantColor}`
                    }}
                  />
                </div>
                <span className="w-7">{formatDuration(duration)}</span>
              </div>

              {/* Bottom Row: Artwork + Info + Controls + Rating */}
              <div className="flex items-center justify-between gap-2 w-full z-10">
                {/* Left: Thumbnail & Info */}
                <div className="flex items-center gap-2.5 min-w-0 max-w-[42%] sm:max-w-[48%]">
                  <div 
                    onClick={onToggleLyrics}
                    className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden bg-black/60 flex-shrink-0 relative border border-white/20 cursor-pointer shadow-md"
                    title="Tap to view kinetic lyrics"
                  >
                    {currentTrack?.artworkUrl ? (
                      <img src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-black/80 text-white/30">
                        <Disc3 className="w-5 h-5 animate-spin-slow text-white/40" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-white truncate" title={currentTrack?.title || 'No Track Playing'}>
                      {currentTrack?.title || 'No Track'}
                    </h4>
                    <p 
                      onClick={() => currentTrack && onSelectArtist(currentTrack.artist)}
                      className="text-[10px] text-white/50 truncate hover:text-white cursor-pointer"
                    >
                      {currentTrack?.artist || 'Select a song'}
                    </p>
                  </div>
                </div>

                {/* Center: Prev, Play/Pause, Next */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    onClick={() => AudioEngine.prev()}
                    className="p-1 text-white/70 hover:text-white hover:scale-110 active:scale-95 transition-all"
                    title="Previous"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => AudioEngine.togglePlay()}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-black font-bold transition-all hover:scale-110 active:scale-95 shadow-lg"
                    style={{
                      backgroundColor: dominantColor,
                      boxShadow: `0 0 16px ${dominantColor}`
                    }}
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>
                  <button
                    onClick={() => AudioEngine.next()}
                    className="p-1 text-white/70 hover:text-white hover:scale-110 active:scale-95 transition-all"
                    title="Next"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Right: Rating Pill, Lyrics Button, Queue */}
                <div className="flex items-center gap-1 sm:gap-1.5">
                  {currentTrack && (
                    <SongRatingWidget track={currentTrack} dominantColor={dominantColor} compact />
                  )}
                  <button
                    onClick={onToggleLyrics}
                    className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all"
                    title="Lyrics"
                  >
                    <AlignLeft className="w-3.5 h-3.5 text-lumen-cyan" />
                  </button>
                  {onOpenQueue && (
                    <button
                      onClick={onOpenQueue}
                      className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all hidden sm:flex"
                      title="Queue"
                    >
                      <ListMusic className="w-3.5 h-3.5 text-lumen-cyan" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* RIGHT PANE: MATCHING APPLE VISIONOS LIQUID GLASS PLAYER WIDGET */
            <div 
              className="w-full lg:w-96 flex flex-col items-center justify-center bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-white/[0.01] border-t border-l border-white/40 border-r border-b border-black/60 rounded-3xl p-6 sm:p-8 backdrop-blur-3xl shadow-2xl relative overflow-hidden select-none"
              style={{
                boxShadow: '0 30px 70px rgba(0, 0, 0, 0.8), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4)'
              }}
            >
              {/* Dynamic LED perimeter frame synchronized to the beat & album cover */}
              <div 
                className="absolute inset-0 rounded-3xl pointer-events-none transition-all duration-150"
                style={{
                  border: `3.5px solid ${dominantColor}`,
                  boxShadow: `inset 0 0 ${Math.round(28 * bassScale)}px ${dominantColor}60, 0 0 ${Math.round(42 * bassScale)}px ${dominantColor}50`,
                  opacity: 0.9 + (bassScale - 1) * 0.4
                }}
              />

              {/* Vertical Spectral Flow Columns on Left & Right edges of the widget */}
              <div 
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-2 z-20 rounded-r-full transition-all duration-75 blur-[1px]"
                style={{
                  height: `${Math.max(16, avgLeftFlow * 0.72)}%`,
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 22px 5px ${dominantColor}`
                }}
              />
              <div 
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-2 z-20 rounded-l-full transition-all duration-75 blur-[1px]"
                style={{
                  height: `${Math.max(16, avgRightFlow * 0.72)}%`,
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 22px 5px ${dominantColor}`
                }}
              />

              {/* Ambient Blurred Artwork Backdrop in the widget */}
              {currentTrack?.artworkUrl && (
                <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-25">
                  <img 
                    src={currentTrack.artworkUrl} 
                    alt="" 
                    className="w-full h-full object-cover filter blur-2xl scale-125 transition-transform duration-700"
                    style={{
                      transform: `scale(${1.15 + (bassScale - 1) * 0.1})`
                    }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" />
                </div>
              )}

              <div 
                className="absolute w-56 h-56 rounded-full blur-3xl opacity-30 pointer-events-none -z-10"
                style={{
                  backgroundColor: dominantColor,
                  transform: `scale(${bassScale})`
                }}
              />

              {currentTrack ? (
                <div className="flex flex-col items-center text-center w-full z-10">
                  <div 
                    className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl overflow-hidden shadow-2xl border border-white/20 mb-4 relative group cursor-pointer transition-transform duration-300"
                    style={{
                      boxShadow: `0 20px 50px -10px ${dominantColor}70`,
                      transform: `scale(${1 + (bassScale - 1) * 0.04})`
                    }}
                    onClick={onToggleLyrics}
                    title="Click to view glowing kinetic lyrics"
                  >
                    {currentTrack.artworkUrl ? (
                      <img 
                        src={currentTrack.artworkUrl} 
                        alt={currentTrack.title} 
                        className="w-full h-full object-cover" 
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fb = e.currentTarget.parentElement?.querySelector('.mini-artwork-fallback') as HTMLElement;
                          if (fb) fb.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div 
                      className={`mini-artwork-fallback w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-white/10 via-black/80 to-black text-white/30 ${currentTrack.artworkUrl ? 'hidden' : 'flex'}`}
                    >
                      <Disc3 className="w-16 h-16 animate-spin-slow text-white/40 mb-1" />
                      <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Hi-Fi Audio</span>
                    </div>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs gap-1.5 font-medium">
                      <AlignLeft className="w-4 h-4 text-lumen-cyan" />
                      <span>View Lyrics</span>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-white tracking-tight truncate max-w-full px-2" title={currentTrack.title}>
                    {currentTrack.title}
                  </h3>
                  <p 
                    onClick={() => onSelectArtist(currentTrack.artist)}
                    className="text-xs text-white/60 mt-0.5 truncate max-w-full px-2 hover:text-white hover:underline cursor-pointer" 
                    title={currentTrack.artist}
                  >
                    {currentTrack.artist}
                  </p>

                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={() => AudioEngine.togglePlay()}
                      className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all"
                      style={{
                        boxShadow: `0 0 20px ${dominantColor}80`
                      }}
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5 fill-black" />
                      ) : (
                        <Play className="w-5 h-5 fill-black ml-0.5" />
                      )}
                    </button>

                    <button
                      onClick={onToggleLyrics}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white/80 hover:text-white border border-white/15 transition-all"
                    >
                      <AlignLeft className="w-3.5 h-3.5 text-lumen-cyan" />
                      <span>Lyrics</span>
                    </button>

                    {onOpenQueue && (
                      <button
                        onClick={onOpenQueue}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-white/15 transition-all"
                        title="Open Queue"
                      >
                        <ListMusic className="w-4 h-4 text-lumen-cyan" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-white/30 text-xs text-center p-6">
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
    </div>
  );
};
