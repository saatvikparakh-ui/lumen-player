import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  Play, 
  Pause, 
  Plus, 
  Trash2, 
  ThumbsUp, 
  ChevronUp, 
  ChevronDown, 
  Search, 
  Users, 
  UserPlus, 
  Radio, 
  Settings, 
  Sliders, 
  Sparkles, 
  Clock, 
  Check, 
  X, 
  AlertCircle,
  Disc3,
  Loader2,
  Volume2,
  ListMusic,
  Heart
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../../types/music';
import { AppUser } from '../../../services/firebaseAuthService';
import { 
  AuxSession, 
  AuxQueueItem, 
  AuxParticipant, 
  AuxSessionMode, 
  AuxSettings 
} from '../../../types/auxTypes';
import { AuxService } from '../../../services/auxService';
import { FirestoreService } from '../../../services/firestoreService';
import { LikedService } from '../../../services/likedService';
import { StreamingService } from '../../../services/streamingService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';
import { FriendProfileData } from './friendsTypes';
import { AuxCarouselModal } from './AuxCarouselModal';

interface Props {
  sessionId?: string;
  initialSession?: AuxSession | null;
  onBack: () => void;
  currentUser: AppUser | null;
  friends: FriendProfileData[];
  playlists?: CustomPlaylist[];
  onPlayTrack: (track: Track) => void;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  dominantColor: string;
}

export const PassTheAuxStudioView: React.FC<Props> = ({
  sessionId,
  initialSession,
  onBack,
  currentUser,
  friends,
  playlists = [],
  onPlayTrack,
  currentTrack,
  isPlaying = false,
  onTogglePlay,
  dominantColor
}) => {
  const [session, setSession] = useState<AuxSession | null>(() => {
    if (initialSession) return initialSession;
    const activeId = sessionId;
    if (activeId) {
      const local = AuxService.getLocalSessions().find(s => s.id === activeId);
      if (local) return local;
      try {
        const raw = localStorage.getItem(`lumen_active_aux_session_${activeId}`);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
    }
    const latest = AuxService.getLocalSessions()[0];
    if (latest) return latest;
    if (currentUser) {
      const now = Date.now();
      const sessId = activeId || `aux_${now}`;
      return {
        id: sessId,
        title: `${currentUser.displayName || currentUser.username || 'My'}'s Aux Jam`,
        hostUserId: currentUser.uid,
        hostUsername: currentUser.username || 'host',
        hostDisplayName: currentUser.displayName || currentUser.username || 'Host',
        status: 'active',
        mode: 'open_queue',
        settings: AuxService.getDefaultSettings(),
        participants: [{
          id: `part_${currentUser.uid}`,
          sessionId: sessId,
          userId: currentUser.uid,
          username: currentUser.username || 'host',
          displayName: currentUser.displayName || currentUser.username || 'Host',
          photoURL: currentUser.photoURL || null,
          role: 'host',
          invitationStatus: 'accepted',
          joinedAt: now,
          lastSeenAt: now
        }],
        queue: [],
        currentQueueItemId: null,
        events: [],
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 3600000,
        version: 1
      };
    }
    return null;
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [inviteHandleInput, setInviteHandleInput] = useState('');
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [addingPlaylistId, setAddingPlaylistId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<Track | null>(null);
  const [addedTrackIds, setAddedTrackIds] = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Subscribe to real-time session updates
  useEffect(() => {
    const activeId = sessionId || session?.id || initialSession?.id;
    if (!activeId) return;

    const unsub = AuxService.subscribeToSession(activeId, (live) => {
      if (live) setSession(live);
    });

    return () => unsub();
  }, [sessionId, session?.id, initialSession?.id]);

  // Auto-resolve or create session if none provided or still null (instant zero-delay room entry)
  useEffect(() => {
    if (session) return;
    
    const activeId = sessionId || initialSession?.id;
    if (activeId) {
      const local = AuxService.getLocalSessions().find(s => s.id === activeId);
      if (local) {
        setSession(local);
        return;
      }
      try {
        const raw = localStorage.getItem(`lumen_active_aux_session_${activeId}`);
        if (raw) {
          setSession(JSON.parse(raw));
          return;
        }
      } catch (_) {}
    } else {
      const latest = AuxService.getLocalSessions()[0];
      if (latest) {
        setSession(latest);
        return;
      }
    }

    // Auto-create/restore room after short grace period if still unresolved
    const timer = setTimeout(() => {
      if (!session && currentUser) {
        AuxService.createSession(currentUser, `${currentUser.username || 'My'}'s Aux Jam`).then(res => {
          if (res.success && res.session) {
            setSession(res.session);
          }
        });
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [sessionId, initialSession?.id, session, currentUser]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await StreamingService.searchTracks(q);
      setSearchResults(results.slice(0, 15));
    } catch (_) {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddTrack = async (track: Track, force = false) => {
    if (!session || !currentUser) return;
    WatchSoundService.playTick(1.1);
    // Instant optimistic added state
    setAddedTrackIds(prev => new Set(prev).add(track.id));
    const res = await AuxService.addTrack(session, track, currentUser, force);
    if (res.isDuplicate && !force) {
      setDuplicateWarning(track);
      setAddedTrackIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
      return;
    }
    if (!res.success) {
      setAddedTrackIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
      showToast(res.error || 'Failed to add track');
      return;
    }
    if (res.session) setSession(res.session);
    setDuplicateWarning(null);
    showToast(`Added "${track.title}" to AUX Queue!`);
    // Keep search open so user sees green 'Added' feedback and can add more songs
  };

  const handleVote = async (itemId: string) => {
    if (!session || !currentUser) return;
    WatchSoundService.playTick(1.2);
    const res = await AuxService.voteTrack(session, itemId, currentUser);
    if (res.success && res.session) setSession(res.session);
  };

  const handleRemove = async (itemId: string) => {
    if (!session || !currentUser) return;
    WatchSoundService.playTick(0.9);
    const res = await AuxService.removeTrack(session, itemId, currentUser);
    if (res.success && res.session) {
      setSession(res.session);
      showToast('Track removed from queue');
    }
  };

  const handleMove = async (fromIdx: number, direction: 'up' | 'down') => {
    if (!session || !currentUser) return;
    const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1;
    const res = await AuxService.reorderQueue(session, fromIdx, toIdx, currentUser);
    if (res.success && res.session) setSession(res.session);
  };

  const handlePlayQueueItem = async (item: AuxQueueItem) => {
    if (!session) return;
    WatchSoundService.playTick(1.0);
    await AuxService.setCurrentItem(session, item.id);
    onPlayTrack(item.track);
  };

  const handleAddPlaylist = async (playlistId: string, playlistName: string, tracks: Track[]) => {
    if (!session || !currentUser) return;
    if (session.mode !== 'open_queue' && session.mode !== 'free_queue') {
      showToast('Playlists can only be added in Open Queue or Free Queue mode');
      return;
    }
    setAddingPlaylistId(playlistId);
    WatchSoundService.playTick(1.2);
    try {
      const res = await AuxService.addPlaylistTracks(session, playlistName, tracks, currentUser);
      if (res.success && res.session) {
        setSession(res.session);
        const skippedNote = res.skippedCount ? ` (${res.skippedCount} duplicate${res.skippedCount === 1 ? '' : 's'} skipped)` : '';
        showToast(`Added ${res.addedCount} songs from "${playlistName}"${skippedNote}!`);
        setIsPlaylistModalOpen(false);
      } else {
        showToast(res.error || 'Could not add playlist');
      }
    } catch (_) {
      showToast('Failed to add playlist to AUX');
    } finally {
      setAddingPlaylistId(null);
    }
  };

  const handleInviteByUsername = async () => {
    if (!session || !currentUser) return;
    const clean = inviteHandleInput.trim().replace(/^@/, '').toLowerCase();
    if (!clean) return;
    setInvitingUserId(`handle_${clean}`);
    try {
      // Match connected friend first, otherwise resolve via Firestore/Supabase user search
      const existingFriend = friends.find(f => f.username?.toLowerCase() === clean);
      let target: { uid: string; username: string; displayName: string; photoURL?: string | null } | null = existingFriend
        ? { uid: existingFriend.userId, username: existingFriend.username, displayName: existingFriend.displayName || existingFriend.username, photoURL: existingFriend.photoURL }
        : null;

      if (!target) {
        const matches = await FirestoreService.searchUsersByUsername(clean);
        const exact = matches.find(m => m.username?.toLowerCase() === clean) || matches[0];
        if (exact) {
          target = {
            uid: exact.uid,
            username: exact.username,
            displayName: exact.displayName || exact.username,
            photoURL: exact.photoURL || null
          };
        }
      }

      if (!target) {
        showToast(`No user found for @${clean}`);
        return;
      }

      const res = await AuxService.inviteFriendToSession(session, target, currentUser);
      if (res.success && res.session) {
        setSession(res.session);
        setInviteHandleInput('');
        showToast(`Invited @${target.username} to "${session.title}"!`);
      } else {
        showToast(res.error || 'Could not invite user');
      }
    } catch (_) {
      showToast('Failed to send invite');
    } finally {
      setInvitingUserId(null);
    }
  };

  const canAddPlaylist = session ? (session.mode === 'open_queue' || session.mode === 'free_queue') : false;

  const isHost = session ? session.hostUserId === currentUser?.uid : false;
  const pendingItems = session?.queue.filter(q => q.status === 'pending') || [];
  const activeItem = session?.queue.find(q => q.id === session.currentQueueItemId) || session?.queue.find(q => q.status === 'playing');

  const modeBadges: Record<AuxSessionMode, { label: string; desc: string; color: string }> = {
    open_queue: { label: 'Open Queue', desc: 'Everyone can add, reorder & vote', color: 'text-lumen-cyan border-lumen-cyan/40 bg-cyan-500/10' },
    free_queue: { label: 'Free Queue', desc: 'Everyone adds; Host orders', color: 'text-amber-400 border-amber-400/40 bg-amber-500/10' },
    vote_next: { label: 'Vote Next', desc: 'Highest voted track plays next', color: 'text-emerald-400 border-emerald-400/40 bg-emerald-500/10' },
    round_robin: { label: 'Round Robin', desc: 'Turns rotate across friends', color: 'text-violet-400 border-violet-400/40 bg-violet-500/10' }
  };

  if (!session) {
    return (
      <div className="w-full max-w-4xl mx-auto py-16 text-center text-white/50 animate-fadeIn">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-lumen-cyan mb-3" />
        <p className="text-sm">Connecting to Pass The Aux room...</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs text-white font-semibold transition-all inline-flex items-center gap-2 cursor-pointer shadow-md"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Friends Hub</span>
        </button>
      </div>
    );
  }

  const currentModeInfo = modeBadges[session.mode] || modeBadges.open_queue;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 animate-fadeIn pb-16 px-3 sm:px-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/90 border border-white/20 text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-fadeIn backdrop-blur-xl">
          <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* TOP HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-white/[0.08] via-white/[0.04] to-transparent border border-white/15 backdrop-blur-3xl shadow-2xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
            title="Return to Friends"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">{session.title}</h2>
              <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${currentModeInfo.color}`}>
                {currentModeInfo.label}
              </span>
              {session.status === 'paused' && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  PAUSED
                </span>
              )}
            </div>
            <p className="text-xs text-white/50 mt-0.5">
              Host: <span className="text-white/80 font-semibold">@{session.hostUsername}</span> • {session.participants.length} participants
            </p>
          </div>
        </div>

        {/* Action Buttons (Mobile & Desktop responsive flex-wrap) */}
        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto justify-end">
          <button
            type="button"
            onClick={() => setIsInviteModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition-all active:scale-95 cursor-pointer shadow-md"
          >
            <UserPlus className="w-3.5 h-3.5 text-lumen-cyan" />
            <span>Invite</span>
          </button>

          {canAddPlaylist && (
            <button
              type="button"
              onClick={() => {
                WatchSoundService.playTick(1.1);
                setIsPlaylistModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-xs font-bold text-purple-200 transition-all active:scale-95 cursor-pointer shadow-md"
              title="Add an entire playlist to this Aux Jam"
            >
              <ListMusic className="w-3.5 h-3.5 text-purple-300" />
              <span>Add Playlist</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-lumen-cyan text-black text-xs font-bold shadow-lg shadow-lumen-cyan/25 hover:scale-105 active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 text-black stroke-[2.5]" />
            <span>Add Track</span>
          </button>

          {isHost ? (
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition-all active:scale-95 cursor-pointer"
              title="Room Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (!session || !currentUser) return;
                WatchSoundService.playTick(0.9);
                await AuxService.leaveSession(session, currentUser);
                showToast('Left AUX Room');
                onBack();
              }}
              className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/70 hover:text-rose-300 border border-white/10 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
              title="Leave Room"
            >
              Leave
            </button>
          )}
        </div>
      </div>

      {/* PARTICIPANTS STRIP */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 scrollbar-none">
        <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider mr-1 flex-shrink-0">In Room:</span>
        {session.participants
          .filter(p => p.invitationStatus !== 'declined')
          .map((p) => {
            const isJoined = p.userId === session.hostUserId || p.invitationStatus === 'accepted';
            return (
              <div 
                key={p.userId}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs flex-shrink-0 transition-all ${
                  p.userId === session.hostUserId 
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' 
                    : isJoined
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-white/90'
                      : 'bg-white/5 border-white/10 text-white/60 border-dashed'
                }`}
              >
                <InitialAvatar name={p.displayName || p.username} size="sm" isOnline={isJoined} />
                <span className="font-medium">@{p.username}</span>
                {p.userId === session.hostUserId ? (
                  <span className="text-[9px] font-bold text-amber-400 ml-0.5">HOST</span>
                ) : !isJoined ? (
                  <span className="text-[9px] font-mono text-cyan-300/80 ml-0.5">INVITED</span>
                ) : null}
              </div>
            );
          })}
      </div>

      {/* NOW PLAYING HERO / ACTIVE AUX ITEM */}
      {activeItem ? (
        <div className="p-4 sm:p-6 rounded-3xl bg-gradient-to-br from-white/[0.08] via-black/60 to-black/90 border border-white/20 backdrop-blur-3xl shadow-2xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10">
            <div className="flex items-center gap-4 min-w-0 w-full sm:w-auto">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-black/60 border border-white/20 shadow-xl flex-shrink-0">
                <CoverImage
                  src={activeItem.track.artworkUrl || null}
                  alt={activeItem.track.title}
                  title={activeItem.track.title}
                  artist={activeItem.track.artist}
                  size={160}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 animate-pulse">
                    ON THE AUX NOW
                  </span>
                  <span className="text-[10px] font-mono text-white/40">
                    Added by @{activeItem.addedByUsername}
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white truncate mt-1">{activeItem.track.title}</h3>
                <p className="text-xs text-white/60 truncate">{activeItem.track.artist}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (currentTrack?.id === activeItem.track.id && onTogglePlay) {
                    onTogglePlay();
                  } else {
                    onPlayTrack(activeItem.track);
                  }
                }}
                className="w-12 h-12 rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center shadow-2xl cursor-pointer"
                title={isPlaying && currentTrack?.id === activeItem.track.id ? 'Pause track' : 'Play track'}
              >
                {isPlaying && currentTrack?.id === activeItem.track.id ? (
                  <Pause className="w-5 h-5 fill-black" />
                ) : (
                  <Play className="w-5 h-5 fill-black ml-0.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center text-white/40">
          <Disc3 className="w-10 h-10 mx-auto mb-2 opacity-30 text-lumen-cyan" />
          <h4 className="text-sm font-bold text-white/70">The Aux is Empty</h4>
          <p className="text-xs text-white/40 mt-1 max-w-sm mx-auto">
            Search songs{canAddPlaylist ? ' or drop in one of your playlists' : ''} to start the shared ordered queue.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="px-4 py-2 rounded-full bg-lumen-cyan text-black text-xs font-bold shadow-lg active:scale-95 transition-all cursor-pointer inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add Song</span>
            </button>
            {canAddPlaylist && (
              <button
                type="button"
                onClick={() => setIsPlaylistModalOpen(true)}
                className="px-4 py-2 rounded-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-xs font-bold border border-purple-400/40 transition-all active:scale-95 cursor-pointer inline-flex items-center gap-1.5"
              >
                <ListMusic className="w-3.5 h-3.5" />
                <span>Add Playlist</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* SHARED QUEUE LIST */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-lumen-cyan" />
            <h3 className="text-sm font-bold text-white tracking-wide">
              Shared Queue ({pendingItems.length})
            </h3>
          </div>
          <span className="text-[11px] font-mono text-white/40">
            {session.mode === 'vote_next' ? 'Ranked by Votes' : 'Ordered by Room'}
          </span>
        </div>

        {pendingItems.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 text-center text-xs text-white/40">
            No upcoming songs queued. Tap <span className="text-lumen-cyan font-bold">+ Add Track</span> to nominate a song!
          </div>
        ) : (
          <div className="space-y-2">
            {pendingItems.map((item, idx) => {
              const hasVoted = currentUser ? Boolean(item.votes?.[currentUser.uid]) : false;
              const canDelete = isHost || item.addedByUserId === currentUser?.uid;

              return (
                <div
                  key={item.id}
                  className="p-3 sm:p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 transition-all flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Position */}
                    <span className="font-mono text-xs font-bold text-white/40 w-5 text-center flex-shrink-0">
                      #{idx + 1}
                    </span>

                    {/* Artwork */}
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                      <CoverImage
                        src={item.track.artworkUrl || null}
                        alt={item.track.title}
                        title={item.track.title}
                        artist={item.track.artist}
                        size={80}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Metadata */}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs sm:text-sm font-bold text-white truncate">{item.track.title}</h4>
                      <p className="text-[11px] text-white/60 truncate mt-0.5">{item.track.artist}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-white/40">
                          by @{item.addedByUsername}
                        </span>
                        {(item.track as any).provider && (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/5 text-white/40 border border-white/10">
                            {(item.track as any).provider}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Voting */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Reorder Buttons (Open Queue / Host) */}
                    {(session.settings.canReorder || isHost) && session.mode !== 'vote_next' && (
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMove(idx, 'up')}
                          className="p-1 rounded text-white/30 hover:text-white disabled:opacity-20 transition-colors cursor-pointer"
                          title="Move up"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === pendingItems.length - 1}
                          onClick={() => handleMove(idx, 'down')}
                          className="p-1 rounded text-white/30 hover:text-white disabled:opacity-20 transition-colors cursor-pointer"
                          title="Move down"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Upvote Button (Vote Next mode) */}
                    {session.mode === 'vote_next' && (
                      <button
                        type="button"
                        onClick={() => handleVote(item.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold transition-all active:scale-95 cursor-pointer ${
                          hasVoted 
                            ? 'bg-emerald-500 text-black border-emerald-400 shadow-md shadow-emerald-500/20' 
                            : 'bg-white/5 hover:bg-white/10 text-white/70 border-white/10'
                        }`}
                        title={hasVoted ? "Remove vote" : "Vote to play next"}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span>{item.voteCount || 0}</span>
                      </button>
                    )}

                    {/* Play item */}
                    <button
                      type="button"
                      onClick={() => handlePlayQueueItem(item)}
                      className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all active:scale-95 cursor-pointer"
                      title="Play track now"
                    >
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    </button>

                    {/* Delete item */}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleRemove(item.id)}
                        className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/40 hover:text-rose-400 border border-white/10 hover:border-rose-500/30 transition-all active:scale-95 cursor-pointer"
                        title="Remove from queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ADD TRACK COVER FLOW CAROUSEL MODAL (Suggestions from playlists, likes, + live catalog search) */}
      <AuxCarouselModal
        isOpen={isSearchOpen}
        onClose={() => {
          setIsSearchOpen(false);
          setDuplicateWarning(null);
        }}
        onAddTrack={(track) => handleAddTrack(track)}
        existingQueueTracks={session?.queue?.map(q => q.track) || []}
      />

      {/* INVITE FRIENDS MODAL */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fadeIn">
          <div 
            className="w-full max-w-md rounded-3xl p-5 border border-white/20 shadow-2xl space-y-4 overflow-hidden backdrop-blur-3xl relative"
            style={{
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.14) 0%, rgba(14, 28, 54, 0.72) 45%, rgba(4, 8, 18, 0.88) 100%)',
              boxShadow: '0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(6, 182, 212, 0.35)'
            }}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-cyan-300" />
                <h3 className="text-sm font-bold text-white">Invite Friends to AUX</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="p-1 rounded-full text-white/50 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Invite by @username */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inviteHandleInput}
                onChange={(e) => setInviteHandleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleInviteByUsername();
                }}
                placeholder="Invite by @username..."
                className="flex-1 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan/60"
              />
              <button
                type="button"
                disabled={!inviteHandleInput.trim() || Boolean(invitingUserId)}
                onClick={handleInviteByUsername}
                className="px-3.5 py-2 rounded-xl bg-lumen-cyan text-black text-xs font-bold disabled:opacity-40 active:scale-95 transition-all cursor-pointer"
              >
                {invitingUserId?.startsWith('handle_') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Send'}
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {friends.length === 0 ? (
                <p className="text-xs text-white/40 text-center py-6">No connected friends yet — invite by @username above</p>
              ) : (
                friends.map((f) => {
                  const participant = session.participants.find(
                    p => p.userId === f.userId || (f.username && p.username?.toLowerCase() === f.username.toLowerCase())
                  );
                  const isJoined = participant && (participant.userId === session.hostUserId || participant.invitationStatus === 'accepted');
                  const isInvited = participant && participant.invitationStatus === 'invited';
                  const isBusy = invitingUserId === f.userId;

                  return (
                    <div 
                      key={f.userId}
                      className="flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.03] border border-white/10"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <InitialAvatar name={f.displayName || f.username} size="sm" isOnline={f.isOnline} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{f.displayName || f.username}</div>
                          <div className="text-[10px] text-white/40 truncate">@{f.username}</div>
                        </div>
                      </div>
                      {isJoined ? (
                        <span className="text-[10px] text-emerald-400 font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex-shrink-0">
                          In Room
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={async () => {
                            if (!session || !currentUser) return;
                            setInvitingUserId(f.userId);
                            WatchSoundService.playTick(1.2);
                            try {
                              const res = await AuxService.inviteFriendToSession(
                                session,
                                { uid: f.userId, username: f.username, displayName: f.displayName || f.username, photoURL: f.photoURL },
                                currentUser
                              );
                              if (res.success && res.session) {
                                setSession(res.session);
                                showToast(isInvited ? `Resent invite to @${f.username}!` : `Invite sent to @${f.username}!`);
                              } else {
                                showToast(res.error || 'Could not invite friend');
                              }
                            } finally {
                              setInvitingUserId(null);
                            }
                          }}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all active:scale-95 cursor-pointer flex-shrink-0 ${
                            isInvited
                              ? 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-400/40'
                              : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                          }`}
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (isInvited ? 'Resend' : 'Invite')}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADD PLAYLIST TO AUX MODAL (Available ONLY in Open Queue & Free Queue modes) */}
      {isPlaylistModalOpen && canAddPlaylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fadeIn">
          <div
            className="w-full max-w-md rounded-3xl p-5 border border-white/20 shadow-2xl space-y-4 overflow-hidden relative"
            style={{
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.16) 0%, rgba(14, 24, 48, 0.84) 45%, rgba(6, 9, 18, 0.94) 100%)',
              boxShadow: '0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(168, 85, 247, 0.35)'
            }}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <ListMusic className="w-4 h-4 text-purple-300" />
                <div>
                  <h3 className="text-sm font-bold text-white">Add Playlist to AUX</h3>
                  <p className="text-[10px] text-white/50">Appends up to 50 tracks • Skips duplicates</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPlaylistModalOpen(false)}
                className="p-1.5 rounded-full text-white/50 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {/* Liked Songs option */}
              {(() => {
                const likedTracks = LikedService.getLikedTracks();
                if (likedTracks.length === 0) return null;
                const isBusy = addingPlaylistId === '__liked__';
                return (
                  <button
                    type="button"
                    disabled={Boolean(addingPlaylistId)}
                    onClick={() => handleAddPlaylist('__liked__', 'Liked Songs', likedTracks)}
                    className="w-full flex items-center justify-between p-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/25 transition-all active:scale-[0.98] cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-md">
                        <Heart className="w-5 h-5 text-white fill-white" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">Liked Songs</div>
                        <div className="text-[10px] text-white/50">{likedTracks.length} songs</div>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-white/10 text-white text-[11px] font-bold flex-shrink-0">
                      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '+ Add All'}
                    </span>
                  </button>
                );
              })()}

              {/* Custom Playlists */}
              {playlists.length === 0 ? (
                <p className="text-xs text-white/40 text-center py-6">
                  No custom playlists found yet. Create a playlist in the Playlists tab first!
                </p>
              ) : (
                playlists.map((pl) => {
                  const plTracks = pl.tracks || [];
                  const isBusy = addingPlaylistId === pl.id;
                  const coverUrl = pl.coverUrl || plTracks[0]?.artworkUrl || null;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      disabled={plTracks.length === 0 || Boolean(addingPlaylistId)}
                      onClick={() => handleAddPlaylist(pl.id, pl.name, plTracks)}
                      className="w-full flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/50 border border-white/15 flex-shrink-0 flex items-center justify-center">
                          {coverUrl ? (
                            <img src={coverUrl} alt={pl.name} className="w-full h-full object-cover" />
                          ) : (
                            <ListMusic className="w-5 h-5 text-purple-300/70" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{pl.name}</div>
                          <div className="text-[10px] text-white/50">{plTracks.length} {plTracks.length === 1 ? 'track' : 'tracks'}</div>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full bg-purple-500/25 border border-purple-400/40 text-purple-200 text-[11px] font-bold flex-shrink-0">
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '+ Add'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* HOST SETTINGS MODAL */}
      {isSettingsOpen && isHost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fadeIn">
          <div 
            className="w-full max-w-md rounded-3xl p-5 border border-white/20 shadow-2xl space-y-4 overflow-hidden backdrop-blur-3xl relative"
            style={{
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.14) 0%, rgba(14, 28, 54, 0.72) 45%, rgba(4, 8, 18, 0.88) 100%)',
              boxShadow: '0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(6, 182, 212, 0.35)'
            }}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-cyan-300" />
                <h3 className="text-sm font-bold text-white">Preset Settings & Modes</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-full text-white/50 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-white/70 block mb-1.5 font-mono uppercase tracking-wide">
                  Queue Presets
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['open_queue', 'free_queue', 'vote_next', 'round_robin'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={async () => {
                        if (!currentUser) return;
                        WatchSoundService.playTick(1.1);
                        const res = await AuxService.changeMode(session, m, currentUser);
                        if (res.success && res.session) {
                          setSession(res.session);
                          showToast(`Switched mode to ${modeBadges[m].label}`);
                        }
                      }}
                      className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer ${
                        session.mode === m 
                          ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-md' 
                          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold">{modeBadges[m].label}</div>
                      <div className="text-[10px] text-white/40 mt-0.5">{modeBadges[m].desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Room Permissions & Policy */}
              <div className="pt-2 border-t border-white/10 space-y-2">
                <label className="text-xs font-semibold text-white/70 block font-mono uppercase tracking-wide">
                  Room Rules
                </label>
                <div className="flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-white">
                  <span>Allow participants to reorder queue</span>
                  <input
                    type="checkbox"
                    checked={session.settings.canReorder}
                    onChange={async (e) => {
                      if (!currentUser) return;
                      const res = await AuxService.updateSettings(session, { canReorder: e.target.checked }, currentUser);
                      if (res.success && res.session) setSession(res.session);
                    }}
                    className="accent-cyan-400 cursor-pointer"
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-white">
                  <span>Prevent duplicate songs in queue</span>
                  <input
                    type="checkbox"
                    checked={session.settings.duplicatePolicy === 'disallow'}
                    onChange={async (e) => {
                      if (!currentUser) return;
                      const res = await AuxService.updateSettings(
                        session, 
                        { duplicatePolicy: e.target.checked ? 'disallow' : 'warn_allow' }, 
                        currentUser
                      );
                      if (res.success && res.session) setSession(res.session);
                    }}
                    className="accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Transfer Host Role */}
              {session.participants.filter(p => p.userId !== currentUser?.uid && p.invitationStatus === 'accepted').length > 0 && (
                <div className="pt-2 border-t border-white/10 space-y-2">
                  <label className="text-xs font-semibold text-white/70 block">Transfer Host Privileges</label>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {session.participants
                      .filter(p => p.userId !== currentUser?.uid && p.invitationStatus === 'accepted')
                      .map(p => (
                        <div key={p.userId} className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/10">
                          <span className="text-xs font-medium text-white">@{p.username}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!currentUser) return;
                              WatchSoundService.playTick(1.2);
                              const res = await AuxService.transferHost(session, p.userId, currentUser);
                              if (res.success && res.session) {
                                setSession(res.session);
                                showToast(`Transferred host role to @${p.username}`);
                                setIsSettingsOpen(false);
                              }
                            }}
                            className="px-2.5 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[10px] font-bold cursor-pointer"
                          >
                            Make Host
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                <button
                  type="button"
                  onClick={async () => {
                    if (!currentUser) return;
                    await AuxService.togglePauseSession(session, currentUser);
                    showToast(session.status === 'paused' ? 'Session resumed' : 'Session paused');
                    setIsSettingsOpen(false);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-all cursor-pointer"
                >
                  {session.status === 'paused' ? 'Resume Session' : 'Pause Session'}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (!currentUser) return;
                    await AuxService.endSession(session, currentUser);
                    showToast('AUX Session ended');
                    setIsSettingsOpen(false);
                    onBack();
                  }}
                  className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold border border-rose-500/40 transition-all cursor-pointer"
                >
                  End Session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
