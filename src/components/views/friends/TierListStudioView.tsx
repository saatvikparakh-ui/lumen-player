import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  Sparkles, 
  Search, 
  Play, 
  Pause, 
  SkipForward, 
  SkipBack, 
  Plus, 
  X, 
  Check, 
  Trash2, 
  Share2, 
  Users, 
  UserPlus, 
  Disc3, 
  Music, 
  Star, 
  Loader2, 
  GripVertical, 
  ChevronRight, 
  ChevronDown, 
  Layers,
  Radio
} from 'lucide-react';
import { Track } from '../../../types/music';
import { 
  FirestoreService, 
  FirestoreTierList, 
  TierListTrack 
} from '../../../services/firestoreService';
import { SupabaseService } from '../../../services/supabaseService';
import { AppUser } from '../../../services/firebaseAuthService';
import { StreamingService } from '../../../services/streamingService';
import { RatingAndStatsService } from '../../../services/ratingAndStatsService';
import { ArtistService, AlbumMetadata } from '../../../services/artistService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';
import { FriendProfileData } from './friendsTypes';

type TierKey = 's' | 'a' | 'b' | 'c' | 'd';

interface Props {
  tierListId?: string;
  initialTierList?: FirestoreTierList | null;
  onBack: () => void;
  onDelete?: (id: string) => void;
  currentUser: AppUser | null;
  currentUserRatings: Record<string, string | null>;
  userLikedTracks: Track[];
  friends: FriendProfileData[];
  onPlayTrack: (track: Track) => void;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onNextTrack?: () => void;
  onPrevTrack?: () => void;
  dominantColor: string;
}

const TIER_CONFIG: Array<{
  key: TierKey;
  label: string;
  scoreText: string;
  gradient: string;
  border: string;
  badgeBg: string;
  badgeText: string;
  glow: string;
}> = [
  {
    key: 's',
    label: 'S TIER',
    scoreText: 'God Tier • 9.0+',
    gradient: 'from-rose-500/20 via-rose-500/5 to-transparent',
    border: 'border-rose-500/30 hover:border-rose-500/50',
    badgeBg: 'bg-rose-500',
    badgeText: 'text-white',
    glow: 'rgba(244, 63, 94, 0.25)'
  },
  {
    key: 'a',
    label: 'A TIER',
    scoreText: 'Essential • 8.0+',
    gradient: 'from-amber-500/20 via-amber-500/5 to-transparent',
    border: 'border-amber-500/30 hover:border-amber-500/50',
    badgeBg: 'bg-amber-500',
    badgeText: 'text-black',
    glow: 'rgba(245, 158, 11, 0.25)'
  },
  {
    key: 'b',
    label: 'B TIER',
    scoreText: 'Great • 7.0+',
    gradient: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
    border: 'border-emerald-500/30 hover:border-emerald-500/50',
    badgeBg: 'bg-emerald-500',
    badgeText: 'text-black',
    glow: 'rgba(16, 185, 129, 0.25)'
  },
  {
    key: 'c',
    label: 'C TIER',
    scoreText: 'Good • 6.0+',
    gradient: 'from-cyan-500/20 via-cyan-500/5 to-transparent',
    border: 'border-cyan-500/30 hover:border-cyan-500/50',
    badgeBg: 'bg-cyan-500',
    badgeText: 'text-black',
    glow: 'rgba(6, 182, 212, 0.25)'
  },
  {
    key: 'd',
    label: 'D TIER',
    scoreText: 'Decent • 5.0+',
    gradient: 'from-purple-500/20 via-purple-500/5 to-transparent',
    border: 'border-purple-500/30 hover:border-purple-500/50',
    badgeBg: 'bg-purple-500',
    badgeText: 'text-white',
    glow: 'rgba(168, 85, 247, 0.25)'
  }
];

export const TierListStudioView: React.FC<Props> = ({
  tierListId,
  initialTierList,
  onBack,
  onDelete,
  currentUser,
  currentUserRatings,
  userLikedTracks,
  friends,
  onPlayTrack,
  currentTrack,
  isPlaying = false,
  onTogglePlay,
  onNextTrack,
  onPrevTrack,
  dominantColor
}) => {
  // Current Tier List State
  const [tierList, setTierList] = useState<FirestoreTierList | null>(() => {
    if (initialTierList) return initialTierList;
    if (tierListId) {
      const local = FirestoreService.getLocalTierLists().find(l => l.id === tierListId);
      if (local) return local;
    }
    return null;
  });
  const [title, setTitle] = useState<string>(() => {
    return initialTierList?.title || (tierListId ? FirestoreService.getLocalTierLists().find(l => l.id === tierListId)?.title : undefined) || 'My Definitive Tier List';
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tiers, setTiers] = useState<FirestoreTierList['tiers']>(() => {
    return initialTierList?.tiers || (tierListId ? FirestoreService.getLocalTierLists().find(l => l.id === tierListId)?.tiers : undefined) || { s: [], a: [], b: [], c: [], d: [] };
  });
  const [saveStatus, setSaveStatus] = useState<string>('Saved');
  const [dragOverTier, setDragOverTier] = useState<TierKey | null>(null);

  // Right Pane: Explorer Dock State
  const [activeTab, setActiveTab] = useState<'albums' | 'songs' | 'rated'>('rated');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [songResults, setSongResults] = useState<Track[]>([]);
  const [albumResults, setAlbumResults] = useState<AlbumMetadata[]>([]);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  const [albumTracksMap, setAlbumTracksMap] = useState<Record<string, Track[]>>({});
  const [loadingAlbumTracks, setLoadingAlbumTracks] = useState<string | null>(null);

  // Collaborator Modal
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [selectedCollabFriends, setSelectedCollabFriends] = useState<string[]>(
    initialTierList?.collaboratorUsernames || []
  );

  // Mobile active tab switcher (Tier Board vs Player/Dock)
  const [mobilePane, setMobilePane] = useState<'board' | 'dock'>('board');

  const myUsername = currentUser?.username || currentUser?.email?.split('@')[0] || 'me';

  const asTrack = (tr: TierListTrack | Track): Track => ({
    id: tr.id,
    title: tr.title,
    artist: tr.artist,
    album: tr.album || '',
    artworkUrl: tr.artworkUrl || undefined,
    duration: tr.duration || 0,
    path: (tr as any).path || '',
    filename: (tr as any).filename || '',
    hasArtwork: Boolean(tr.artworkUrl),
    streamUrl: (tr as any).streamUrl || '',
    addedAt: typeof tr.addedAt === 'number' ? tr.addedAt : Date.now()
  });

  // 1. Subscribe to Firestore Tier List for real-time collaborative syncing
  useEffect(() => {
    if (initialTierList) {
      setTierList(initialTierList);
      setTitle(initialTierList.title);
      setTiers(initialTierList.tiers || { s: [], a: [], b: [], c: [], d: [] });
      setSelectedCollabFriends(initialTierList.collaboratorUsernames || []);
    }
  }, [initialTierList]);

  useEffect(() => {
    if (!tierListId) return;

    // 1. Supabase Realtime synchronization (<30ms instant updates)
    const unsubSupa = SupabaseService.subscribeToTierRoom(tierListId, (remoteList) => {
      if (remoteList && remoteList.tiers) {
        setTiers(remoteList.tiers);
        if (remoteList.title) setTitle(remoteList.title);
      }
    });

    // 2. Firestore synchronization (fallback)
    const unsubFirestore = FirestoreService.subscribeTierList(tierListId, (remoteList) => {
      if (remoteList) {
        setTierList(remoteList);
        setTitle(remoteList.title);
        setTiers(remoteList.tiers || { s: [], a: [], b: [], c: [], d: [] });
        setSelectedCollabFriends(remoteList.collaboratorUsernames || []);
      }
    });

    return () => {
      unsubSupa();
      unsubFirestore();
    };
  }, [tierListId]);

  // Sync title changes
  const handleSaveTitle = async () => {
    setIsEditingTitle(false);
    const cleanTitle = title.trim() || 'Untitled Tier List';
    setTitle(cleanTitle);
    const targetId = tierListId || tierList?.id;
    if (targetId) {
      setSaveStatus('Saving...');
      SupabaseService.saveTierList({
        id: targetId,
        title: cleanTitle,
        ownerId: tierList?.ownerId || currentUser?.uid,
        ownerUsername: tierList?.ownerUsername || myUsername,
        isCollaborative: tierList?.isCollaborative,
        tiers,
        updatedAt: Date.now(),
        lastUpdatedBy: myUsername
      }).catch(() => {});
      await FirestoreService.updateTierListTitle(targetId, cleanTitle);
      setSaveStatus('Saved');
    }
  };

  // Helper to commit tiers locally, to Supabase Realtime (<30ms), and to Firestore
  const commitTiers = (newTiers: FirestoreTierList['tiers']) => {
    setTiers(newTiers);
    WatchSoundService.playTick(1.2);
    const targetId = tierListId || tierList?.id;
    if (targetId) {
      setSaveStatus('Live Synced');
      // 1. Ultra-fast Supabase Realtime broadcast (<30ms)
      SupabaseService.saveTierList({
        id: targetId,
        title,
        ownerId: tierList?.ownerId || currentUser?.uid,
        ownerUsername: tierList?.ownerUsername || myUsername,
        isCollaborative: tierList?.isCollaborative,
        tiers: newTiers,
        updatedAt: Date.now(),
        lastUpdatedBy: myUsername
      }).catch(() => {});

      // 2. Background Firestore update
      FirestoreService.updateTierListTiers(targetId, newTiers, myUsername)
        .then(ok => {
          if (!ok) setSaveStatus('Saved Locally');
        })
        .catch(() => setSaveStatus('Saved Locally'));
      setTimeout(() => setSaveStatus('Saved'), 2000);
    }
  };

  // Add a track to a specific tier
  const handleAddTrackToTier = (track: Track, tierKey: TierKey) => {
    const trackItem: TierListTrack = {
      id: String(track.id),
      title: track.title,
      artist: track.artist,
      album: track.album || null,
      artworkUrl: track.artworkUrl || null,
      duration: track.duration,
      rating: currentUserRatings[track.id] || null,
      addedBy: myUsername,
      addedAt: Date.now()
    };

    // Remove from existing tiers if already present to avoid duplicates
    const nextTiers = { ...tiers };
    (Object.keys(nextTiers) as TierKey[]).forEach((k) => {
      nextTiers[k] = nextTiers[k].filter(t => String(t.id) !== String(track.id));
    });

    nextTiers[tierKey] = [trackItem, ...nextTiers[tierKey]];
    commitTiers(nextTiers);
  };

  // Remove track from tier
  const handleRemoveTrack = (trackId: string, tierKey: TierKey) => {
    const nextTiers = { ...tiers };
    nextTiers[tierKey] = nextTiers[tierKey].filter(t => String(t.id) !== String(trackId));
    commitTiers(nextTiers);
  };

  // Move track from one tier to another
  const handleMoveTrack = (track: TierListTrack, fromTier: TierKey, toTier: TierKey) => {
    if (fromTier === toTier) return;
    const nextTiers = { ...tiers };
    nextTiers[fromTier] = nextTiers[fromTier].filter(t => String(t.id) !== String(track.id));
    nextTiers[toTier] = [track, ...nextTiers[toTier]];
    commitTiers(nextTiers);
  };

  // Drag and Drop Event Handlers
  const handleDragStart = (track: Track | TierListTrack, sourceTier?: TierKey, e?: React.DragEvent) => {
    if (!e) return;
    const payload = JSON.stringify({ track, sourceTier });
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDropOnTier = (targetTier: TierKey, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTier(null);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.track) {
        handleAddTrackToTier(data.track, targetTier);
      }
    } catch (_) {}
  };

  // Live Explorer Search (Albums or Songs)
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setSongResults([]);
      setAlbumResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (activeTab === 'songs') {
          let songs = await StreamingService.searchTracks(q);
          if (songs.length === 0) {
            // Local fallback match across library & rated tracks with fuzzy typo tolerance
            const qLower = q.toLowerCase();
            const localMatches = (strictlyRatedTracks || []).filter(t => {
              const tTitle = (t.title || '').toLowerCase();
              const tArtist = (t.artist || '').toLowerCase();
              return tTitle.includes(qLower) || tArtist.includes(qLower) ||
                (qLower.length >= 4 && (tTitle.includes(qLower.slice(0, 4)) || tTitle.replace(/[aeiour]/g, '').includes(qLower.replace(/[aeiour]/g, ''))));
            });
            if (localMatches.length > 0) {
              songs = localMatches as unknown as Track[];
            } else if (currentTrack) {
              const curTitle = (currentTrack.title || '').toLowerCase();
              const curArtist = (currentTrack.artist || '').toLowerCase();
              if (curTitle.includes(qLower) || curArtist.includes(qLower) || 
                  (qLower.length >= 4 && curTitle.replace(/[r]/g, '').includes(qLower.replace(/[r]/g, '')))) {
                songs = [currentTrack];
              }
            }
          }
          setSongResults(songs.slice(0, 20));
        } else if (activeTab === 'albums') {
          const albums = await ArtistService.searchAlbums(q);
          setAlbumResults(albums);
        }
      } catch (err) {
        console.warn('[TierListStudio] search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery, activeTab]);

  // Load Album Tracks when expanded
  const handleExpandAlbum = async (album: AlbumMetadata) => {
    if (expandedAlbumId === album.id) {
      setExpandedAlbumId(null);
      return;
    }

    setExpandedAlbumId(album.id);
    if (albumTracksMap[album.id]) return;

    setLoadingAlbumTracks(album.id);
    try {
      const tracks = await ArtistService.getAlbumTracks(album.id, album.title, album.artist);
      setAlbumTracksMap(prev => ({ ...prev, [album.id]: tracks }));
    } catch (e) {
      console.warn('[TierListStudio] load album tracks error:', e);
    } finally {
      setLoadingAlbumTracks(null);
    }
  };

  // Strictly rated songs list - pulls 100% of user rated tracks directly from RatingAndStatsService
  const [strictlyRatedTracks, setStrictlyRatedTracks] = useState<Track[]>([]);

  useEffect(() => {
    const loadRated = () => {
      const allRated = RatingAndStatsService.getRatedTracksWithMetadata();
      setStrictlyRatedTracks(allRated);
    };
    loadRated();

    RatingAndStatsService.loadUserRatings().then(() => {
      loadRated();
    });

    const unsub = RatingAndStatsService.onRatingChange(() => {
      loadRated();
    });
    return unsub;
  }, [currentUser]);

  const handleDeleteTierList = async () => {
    const targetId = tierList?.id || tierListId;
    if (!targetId) return;
    if (confirm(`Delete tier list "${title}"? This cannot be undone.`)) {
      WatchSoundService.playTick(1.0);
      await FirestoreService.deleteTierList(targetId);
      if (onDelete) {
        onDelete(targetId);
      }
      onBack();
    }
  };

  const handleSaveCollaborators = async () => {
    setShowCollabModal(false);
    const targetId = tierList?.id || tierListId;
    if (!targetId) return;

    const collabFriends = (friends || []).filter(f => selectedCollabFriends.includes(f.username));
    const collaboratorUids = collabFriends.map(f => f.userId || (f as any).user_id || (f as any).uid);
    const collaboratorUsernames = collabFriends.map(f => f.username);

    // 1. Broadcast invites via Supabase Realtime (<50ms delivery)
    for (const collabUid of collaboratorUids) {
      if (collabUid) {
        SupabaseService.sendTierListInvite(collabUid, {
          id: targetId,
          title,
          ownerId: tierList?.ownerId || currentUser?.uid,
          ownerUsername: tierList?.ownerUsername || myUsername,
          isCollaborative: true,
          tiers
        }, currentUser).catch(() => {});
      }
    }
    for (const collabUser of collaboratorUsernames) {
      if (collabUser) {
        SupabaseService.sendTierListInvite(collabUser, {
          id: targetId,
          title,
          ownerId: tierList?.ownerId || currentUser?.uid,
          ownerUsername: tierList?.ownerUsername || myUsername,
          isCollaborative: true,
          tiers
        }, currentUser).catch(() => {});
      }
    }

    setTierList(prev => prev ? {
      ...prev,
      isCollaborative: true,
      collaboratorUids,
      collaboratorUsernames
    } : null);

    await FirestoreService.updateTierListCollaborators(targetId, collaboratorUids, collaboratorUsernames);
  };

  const totalRankedTracks = 
    tiers.s.length + tiers.a.length + tiers.b.length + tiers.c.length + tiers.d.length;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 animate-fadeIn pb-16">
      {/* ------------------------------------------------------------- */}
      {/* 1. STUDIO HEADER BAR                                         */}
      {/* ------------------------------------------------------------- */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xl">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/80 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer text-xs font-semibold flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Tier Lists</span>
          </button>

          {/* Editable Title */}
          <div className="min-w-0 flex-1">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                  autoFocus
                  className="px-2.5 py-1 rounded-xl bg-white/10 border border-lumen-cyan text-white text-base font-bold focus:outline-none w-full max-w-sm"
                />
                <button
                  onClick={handleSaveTitle}
                  className="p-1 rounded-lg bg-lumen-cyan text-black"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div 
                onClick={() => setIsEditingTitle(true)}
                className="group flex items-center gap-2 cursor-pointer"
                title="Click to rename tier list"
              >
                <h1 className="text-base sm:text-xl font-bold text-white tracking-tight truncate group-hover:text-lumen-cyan transition-colors">
                  {title}
                </h1>
                <span className="text-[10px] text-white/30 group-hover:text-white/60">✎</span>
              </div>
            )}

            <div className="flex items-center gap-2 mt-0.5 text-xs text-white/40">
              <span>{totalRankedTracks} tracks ranked</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span>{saveStatus}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right Badges & Collab Invite Action */}
        <div className="flex items-center gap-2.5 self-end sm:self-auto flex-shrink-0">
          {tierList?.isCollaborative ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/25 text-pink-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-pink-400 animate-pulse" />
              <span>Real-Time Collaborative</span>
            </div>
          ) : (
            <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/50 text-xs font-semibold">
              Personal Studio
            </div>
          )}

          {/* Collaborator Avatars */}
          {tierList?.collaboratorUsernames && tierList.collaboratorUsernames.length > 0 && (
            <div className="flex items-center -space-x-1.5">
              {tierList.collaboratorUsernames.slice(0, 3).map((u) => (
                <InitialAvatar key={u} name={u} size="xs" />
              ))}
            </div>
          )}

          {/* Invite Collaborators Button */}
          <button
            type="button"
            onClick={() => setShowCollabModal(true)}
            className="p-1.5 sm:px-3 sm:py-1 rounded-full bg-white/5 hover:bg-white/15 text-white/80 hover:text-white border border-white/10 transition-all flex items-center gap-1.5 text-xs font-semibold active:scale-95 cursor-pointer shadow-sm"
            title="Invite collaborators to rank songs together"
          >
            <UserPlus className="w-3.5 h-3.5 text-lumen-cyan" />
            <span className="hidden sm:inline">Invite</span>
          </button>

          {/* Delete Tier List Button */}
          <button
            type="button"
            onClick={handleDeleteTierList}
            className="p-1.5 sm:px-3 sm:py-1 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-200 border border-rose-500/25 hover:border-rose-500/50 transition-all flex items-center gap-1.5 text-xs font-semibold active:scale-95 cursor-pointer shadow-sm"
            title="Delete this Tier List"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </button>
        </div>
      </div>

      {/* Mobile Switcher Tab (Visible on small screens) */}
      <div className="sm:hidden flex items-center p-1 rounded-2xl bg-white/[0.04] border border-white/10">
        <button
          type="button"
          onClick={() => setMobilePane('board')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
            mobilePane === 'board' ? 'bg-white text-black shadow-md' : 'text-white/50'
          }`}
        >
          Tier Board ({totalRankedTracks})
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('dock')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
            mobilePane === 'dock' ? 'bg-white text-black shadow-md' : 'text-white/50'
          }`}
        >
          Player & Song Dock
        </button>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. MAIN 2-REGION SPLIT STUDIO LAYOUT                          */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ============================================================ */}
        {/* LEFT REGION: INTERACTIVE TIER BOARD (7 cols on lg)           */}
        {/* ============================================================ */}
        <div className={`lg:col-span-7 space-y-3.5 ${mobilePane === 'dock' ? 'hidden sm:block' : 'block'}`}>
          {TIER_CONFIG.map((tier) => {
            const listTracks = tiers[tier.key] || [];
            const isTarget = dragOverTier === tier.key;

            return (
              <div
                key={tier.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setDragOverTier(tier.key);
                }}
                onDragLeave={() => setDragOverTier(null)}
                onDrop={(e) => handleDropOnTier(tier.key, e)}
                className={`rounded-3xl p-3.5 sm:p-4 bg-gradient-to-r ${tier.gradient} border ${
                  isTarget ? 'border-lumen-cyan ring-2 ring-lumen-cyan/40 scale-[1.01]' : tier.border
                } backdrop-blur-2xl transition-all duration-200 shadow-xl`}
                style={{
                  boxShadow: isTarget ? `0 0 25px ${tier.glow}` : undefined
                }}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  {/* Tier Label Column */}
                  <div className="flex sm:flex-col items-center justify-between w-full sm:w-24 flex-shrink-0">
                    <span className={`px-3 py-1 rounded-xl text-xs font-black tracking-wider ${tier.badgeBg} ${tier.badgeText} shadow-md`}>
                      {tier.label}
                    </span>
                    <span className="text-[10px] font-mono text-white/40 mt-1">
                      {listTracks.length} tracks
                    </span>
                  </div>

                  {/* Tier Cards Dropzone */}
                  <div className="flex-1 w-full min-h-[76px] flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1">
                    {listTracks.length === 0 ? (
                      <div className="w-full py-4 text-center border border-dashed border-white/10 rounded-2xl text-[11px] text-white/35">
                        Drag songs or albums here, or use '+' in the song dock
                      </div>
                    ) : (
                      listTracks.map((tr) => (
                        <div
                          key={tr.id}
                          draggable
                          onDragStart={(e) => handleDragStart(tr, tier.key, e)}
                          className="relative group/card flex-shrink-0 w-24 sm:w-28 rounded-2xl bg-black/60 border border-white/15 p-2 shadow-lg hover:border-white/35 transition-all cursor-grab active:cursor-grabbing"
                        >
                          {/* Artwork & Play Overlay */}
                          <div className="w-full aspect-square rounded-xl overflow-hidden bg-black/80 relative mb-1.5">
                            <CoverImage
                              src={tr.artworkUrl || null}
                              alt={tr.title}
                              title={tr.title}
                              size={120}
                              className="w-full h-full object-cover"
                            />

                            {/* Play Button Overlay */}
                            <button
                              type="button"
                              onClick={() => onPlayTrack(asTrack(tr))}
                              className="absolute inset-0 bg-black/50 opacity-0 group-hover/card:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                              title={`Play "${tr.title}"`}
                            >
                              <div className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
                                <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                              </div>
                            </button>

                            {/* Contributor Initial Badge if collaborative */}
                            {tr.addedBy && (
                              <div 
                                className="absolute bottom-1 right-1"
                                title={`Ranked by @${tr.addedBy}`}
                              >
                                <InitialAvatar name={tr.addedBy} size="xs" />
                              </div>
                            )}

                            {/* User Rating pill if rated */}
                            {tr.rating && (
                              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/80 border border-amber-400/30 text-[9px] font-mono font-bold text-amber-300">
                                ★ {tr.rating}
                              </div>
                            )}
                          </div>

                          {/* Track Details */}
                          <div className="text-[11px] font-bold text-white truncate">{tr.title}</div>
                          <div className="text-[9px] text-white/40 truncate">{tr.artist}</div>

                          {/* Quick Remove Button */}
                          <button
                            type="button"
                            onClick={() => handleRemoveTrack(tr.id, tier.key)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity shadow-md hover:scale-110 cursor-pointer"
                            title="Remove from tier"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ============================================================ */}
        {/* RIGHT REGION: UNIFIED OBSIDIAN PLAYER & DOCK (5 cols on lg)  */}
        {/* ============================================================ */}
        <div className={`lg:col-span-5 space-y-4 ${mobilePane === 'board' ? 'hidden sm:block' : 'block'}`}>
          {/* --------------------------------------------------------- */}
          {/* A. OBSIDIAN GLASS MUSIC PLAYER WIDGET                     */}
          {/* --------------------------------------------------------- */}
          <div 
            className="p-4 sm:p-5 rounded-3xl bg-[#090d14]/90 border border-white/15 backdrop-blur-3xl shadow-2xl relative overflow-hidden"
            style={{
              boxShadow: `0 15px 35px -10px rgba(0,0,0,0.8), 0 0 30px -10px ${dominantColor}30`
            }}
          >
            {/* Ambient LED glow ring */}
            <div 
              className="pointer-events-none absolute -right-12 -top-12 w-48 h-48 rounded-full filter blur-3xl opacity-25"
              style={{ backgroundColor: dominantColor || '#06b6d4' }}
            />

            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono tracking-wider uppercase text-white/40 flex items-center gap-1.5">
                  <Radio className="w-3 h-3 text-lumen-cyan animate-pulse" />
                  <span>Obsidian Studio Player</span>
                </span>
                <span className="text-[11px] font-bold text-white/70">Lumen LED</span>
              </div>

              {currentTrack ? (
                <div className="flex items-center gap-3.5 mb-3">
                  {/* Artwork with subtle spinning vinyl vibe */}
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden bg-black border border-white/20 shadow-md flex-shrink-0 relative">
                    <CoverImage
                      src={currentTrack.artworkUrl || null}
                      alt={currentTrack.title}
                      title={currentTrack.title}
                      size={140}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-white truncate">{currentTrack.title}</h3>
                    <p className="text-xs text-white/50 truncate mt-0.5">{currentTrack.artist}</p>
                    {currentTrack.album && (
                      <p className="text-[10px] text-white/30 truncate">{currentTrack.album}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 mb-3 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-white/40">
                  Select any track to listen while ranking
                </div>
              )}

              {/* Player Transport Controls */}
              <div className="flex items-center justify-center gap-4 pt-1 border-t border-white/10">
                <button
                  type="button"
                  onClick={onPrevTrack}
                  className="p-2 text-white/50 hover:text-white transition-colors cursor-pointer"
                  title="Previous track"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="w-10 h-10 rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center shadow-lg cursor-pointer"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-black" />
                  ) : (
                    <Play className="w-4 h-4 fill-black ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onNextTrack}
                  className="p-2 text-white/50 hover:text-white transition-colors cursor-pointer"
                  title="Next track"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------------- */}
          {/* B. SEARCH & DISCOVERY DOCK                                */}
          {/* --------------------------------------------------------- */}
          <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3.5 shadow-xl">
            {/* Dock Tabs Switcher */}
            <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-black/40 border border-white/10">
              <button
                type="button"
                onClick={() => { setActiveTab('rated'); setSearchQuery(''); }}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'rated' ? 'bg-white text-black shadow-md' : 'text-white/50 hover:text-white'
                }`}
              >
                ★ Rated ({strictlyRatedTracks.length})
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('albums'); setSearchQuery(''); }}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'albums' ? 'bg-white text-black shadow-md' : 'text-white/50 hover:text-white'
                }`}
              >
                Albums
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('songs'); setSearchQuery(''); }}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'songs' ? 'bg-white text-black shadow-md' : 'text-white/50 hover:text-white'
                }`}
              >
                Songs
              </button>
            </div>

            {/* Search Input (For Albums or Songs tabs) */}
            {activeTab !== 'rated' && (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    activeTab === 'albums' 
                      ? 'Search albums (e.g. After Hours, Blonde)...' 
                      : 'Search songs by title or artist...'
                  }
                  className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-black/50 border border-white/15 focus:border-lumen-cyan text-white text-xs placeholder-white/40 focus:outline-none transition-all shadow-inner"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-2.5 text-white/40 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* Search State Loader */}
            {isSearching && (
              <div className="py-8 flex items-center justify-center gap-2 text-xs text-white/40">
                <Loader2 className="w-4 h-4 animate-spin text-lumen-cyan" />
                <span>Searching {activeTab}...</span>
              </div>
            )}

            {/* DOCK CONTENT: TAB 1 - STRICTLY MY RATED SONGS */}
            {activeTab === 'rated' && (
              <div className="space-y-2 max-h-[380px] overflow-y-auto no-scrollbar pr-1">
                {strictlyRatedTracks.length === 0 ? (
                  <div className="py-8 text-center text-xs text-white/40 space-y-1">
                    <Star className="w-5 h-5 mx-auto text-white/20 mb-1" />
                    <p className="font-bold text-white/60">No Rated Songs Found</p>
                    <p className="text-[11px] text-white/35 max-w-xs mx-auto">
                      Rate songs from the Player or Library, and they will strictly appear here ready to rank!
                    </p>
                  </div>
                ) : (
                  strictlyRatedTracks.map((tr) => (
                    <div
                      key={tr.id}
                      draggable
                      onDragStart={(e) => handleDragStart(tr, undefined, e)}
                      className="p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 flex items-center justify-between gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-white/20 group-hover:text-white/60 flex-shrink-0" />
                        <div className="w-9 h-9 rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0">
                          <CoverImage
                            src={tr.artworkUrl || null}
                            alt={tr.title}
                            title={tr.title}
                            size={80}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{tr.title}</div>
                          <div className="text-[10px] text-white/40 truncate">{tr.artist}</div>
                        </div>
                      </div>

                      {/* Rating score badge & Quick-Add buttons */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono font-bold text-amber-300">
                          ★ {currentUserRatings[tr.id]}
                        </span>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {(['s', 'a', 'b', 'c', 'd'] as TierKey[]).map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => handleAddTrackToTier(tr, k)}
                              className="px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white text-white hover:text-black text-[9px] font-black uppercase transition-all"
                              title={`Add to ${k.toUpperCase()} Tier`}
                            >
                              +{k}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* DOCK CONTENT: TAB 2 - ALBUMS SEARCH & EXPAND */}
            {activeTab === 'albums' && (
              <div className="space-y-2.5 max-h-[380px] overflow-y-auto no-scrollbar pr-1">
                {!searchQuery ? (
                  <div className="py-8 text-center text-xs text-white/40">
                    Type an album name above to see all its tracks and drag them into your tiers.
                  </div>
                ) : albumResults.length === 0 && !isSearching ? (
                  <div className="py-8 text-center text-xs text-white/40">
                    No albums found matching "{searchQuery}".
                  </div>
                ) : (
                  albumResults.map((alb) => {
                    const isExpanded = expandedAlbumId === alb.id;
                    const albTracks = albumTracksMap[alb.id] || [];
                    const isLoadingThis = loadingAlbumTracks === alb.id;

                    return (
                      <div 
                        key={alb.id}
                        className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden transition-all"
                      >
                        {/* Album Row */}
                        <div 
                          onClick={() => handleExpandAlbum(alb)}
                          className="p-2.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.05] transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-10 h-10 rounded-xl overflow-hidden bg-black border border-white/15 flex-shrink-0">
                              <CoverImage
                                src={alb.artworkUrl || null}
                                alt={alb.title}
                                title={alb.title}
                                size={100}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate">{alb.title}</div>
                              <div className="text-[10px] text-white/40 truncate">
                                {alb.artist} • {alb.year || 'Album'}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {isLoadingThis ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-lumen-cyan" />
                            ) : isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-white/50" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-white/50" />
                            )}
                          </div>
                        </div>

                        {/* Expanded Album Tracks */}
                        {isExpanded && (
                          <div className="px-2.5 pb-2.5 pt-1 border-t border-white/5 space-y-1.5 bg-black/40">
                            {albTracks.length === 0 && !isLoadingThis ? (
                              <div className="py-2 text-center text-[11px] text-white/40">
                                No tracks available for this album.
                              </div>
                            ) : (
                              albTracks.map((tr) => (
                                <div
                                  key={tr.id}
                                  draggable
                                  onDragStart={(e) => handleDragStart(tr, undefined, e)}
                                  className="p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] flex items-center justify-between gap-2 text-xs transition-all group cursor-grab active:cursor-grabbing"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <GripVertical className="w-3 h-3 text-white/20 group-hover:text-white/60 flex-shrink-0" />
                                    <span className="text-[11px] font-bold text-white truncate">{tr.title}</span>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    {(['s', 'a', 'b', 'c', 'd'] as TierKey[]).map((k) => (
                                      <button
                                        key={k}
                                        type="button"
                                        onClick={() => handleAddTrackToTier(tr, k)}
                                        className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white text-white hover:text-black text-[9px] font-black uppercase transition-all"
                                        title={`Add to ${k.toUpperCase()}`}
                                      >
                                        +{k}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* DOCK CONTENT: TAB 3 - INDIVIDUAL SONGS SEARCH */}
            {activeTab === 'songs' && (
              <div className="space-y-2 max-h-[380px] overflow-y-auto no-scrollbar pr-1">
                {!searchQuery ? (
                  <div className="py-8 text-center text-xs text-white/40">
                    Search any song title or artist to drag directly into tiers.
                  </div>
                ) : songResults.length === 0 && !isSearching ? (
                  <div className="py-8 text-center text-xs text-white/40">
                    No songs found matching "{searchQuery}".
                  </div>
                ) : (
                  songResults.map((tr) => (
                    <div
                      key={tr.id}
                      draggable
                      onDragStart={(e) => handleDragStart(tr, undefined, e)}
                      className="p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 flex items-center justify-between gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-white/20 group-hover:text-white/60 flex-shrink-0" />
                        <div className="w-9 h-9 rounded-xl overflow-hidden bg-black border border-white/10 flex-shrink-0">
                          <CoverImage
                            src={tr.artworkUrl || null}
                            alt={tr.title}
                            title={tr.title}
                            size={80}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{tr.title}</div>
                          <div className="text-[10px] text-white/40 truncate">{tr.artist}</div>
                        </div>
                      </div>

                      {/* Quick Tier Add buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {(['s', 'a', 'b', 'c', 'd'] as TierKey[]).map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => handleAddTrackToTier(tr, k)}
                            className="px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white text-white hover:text-black text-[9px] font-black uppercase transition-all"
                            title={`Add to ${k.toUpperCase()} Tier`}
                          >
                            +{k}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Collaborator Invite Modal */}
      {showCollabModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 rounded-3xl bg-[#0c0f17] border border-white/10 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-lumen-cyan" />
                <h3 className="text-base font-bold text-white">Invite Collaborators</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCollabModal(false)}
                className="p-1 rounded-full bg-white/5 hover:bg-white/15 text-white/50 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-white/60">
              Select friends to co-rank and curate this tier list in real-time. Any changes they make sync live in &lt;50ms.
            </p>

            <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
              {(friends || []).length === 0 ? (
                <div className="py-6 text-center text-xs text-white/40">
                  No friends connected yet. Add friends from the Friends Hub to invite them!
                </div>
              ) : (
                (friends || []).map((f) => {
                  const isSelected = selectedCollabFriends.includes(f.username);
                  return (
                    <div
                      key={f.username}
                      onClick={() => {
                        setSelectedCollabFriends(prev => 
                          isSelected ? prev.filter(u => u !== f.username) : [...prev, f.username]
                        );
                      }}
                      className={`p-2.5 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-lumen-cyan/15 border-lumen-cyan/50 text-white shadow-sm'
                          : 'bg-white/[0.03] border-white/5 text-white/70 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <InitialAvatar name={f.displayName || f.username} size="sm" />
                        <div>
                          <div className="text-xs font-bold text-white">{f.displayName || f.username}</div>
                          <div className="text-[10px] text-white/40">@{f.username}</div>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                        isSelected ? 'bg-lumen-cyan border-lumen-cyan text-black' : 'border-white/20'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCollabModal(false)}
                className="flex-1 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCollaborators}
                className="flex-1 py-2.5 rounded-full bg-lumen-cyan text-black text-xs font-bold hover:bg-lumen-cyan/90 transition-all shadow-lg shadow-lumen-cyan/20 cursor-pointer"
              >
                Save & Invite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
