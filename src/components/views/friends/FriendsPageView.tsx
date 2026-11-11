import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  UserPlus, 
  Share2, 
  FolderPlus, 
  Sparkles, 
  Search, 
  Bell, 
  ChevronRight, 
  Sliders, 
  Disc3, 
  Star, 
  Layers, 
  ArrowLeft,
  X,
  Plus,
  Trash2,
  Clock,
  Radio,
  Loader2,
  Check
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../../types/music';
import { AppUser, FirebaseAuthService } from '../../../services/firebaseAuthService';
import { 
  FirestoreService, 
  FirestoreFriendRequest, 
  FirestoreSongShare, 
  FirestoreTierList 
} from '../../../services/firestoreService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { LikedService } from '../../../services/likedService';
import { SocialService } from '../../../services/socialService';
import { 
  FriendProfileData, 
  SharedMediaItem, 
  FriendActivityEvent, 
  FriendsSubView 
} from './friendsTypes';
import { FriendsOnlineBar } from './FriendsOnlineBar';
import { ListeningActivityCard } from './ListeningActivityCard';
import { SharedWithYouPanel } from './SharedWithYouPanel';
import { MusicCompatibilityWidget } from './MusicCompatibilityWidget';
import { FriendsActivityFeed } from './FriendsActivityFeed';
import { AddFriendsSection } from './AddFriendsSection';
import { FriendProfileSection } from './FriendProfileSection';
import { TierListComparisonStage } from './TierListComparisonStage';
import { TierListStudioView } from './TierListStudioView';
import { ShareSongModal } from './ShareSongModal';
import { SharePlaylistModal } from './SharePlaylistModal';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  currentUser: AppUser | null;
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onAddToQueue: (track: Track) => void;
  dominantColor: string;
  onClose: () => void;
  playlists: CustomPlaylist[];
}

export const FriendsPageView: React.FC<Props> = ({
  currentUser,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onAddToQueue,
  dominantColor,
  onClose,
  playlists
}) => {
  // Top Level Navigation Tab: Friends vs Tier Lists vs Friend Requests
  const [mainTab, setMainTab] = useState<'friends' | 'tier-lists' | 'requests'>('friends');

  // Friends Sub-View State
  const [subView, setSubView] = useState<FriendsSubView>('dashboard');
  const [selectedFriend, setSelectedFriend] = useState<FriendProfileData | null>(null);

  // Tier Lists Studio State
  const [tierLists, setTierLists] = useState<FirestoreTierList[]>([]);
  const [activeTierListId, setActiveTierListId] = useState<string | null>(null);
  const [showNewTierModal, setShowNewTierModal] = useState(false);
  const [newTierTitle, setNewTierTitle] = useState('My Definitive Tier List');
  const [isNewTierCollab, setIsNewTierCollab] = useState(false);
  const [selectedCollabFriends, setSelectedCollabFriends] = useState<string[]>([]);
  const [isCreatingTier, setIsCreatingTier] = useState(false);

  // Modals & Quick Request Input State
  const [isShareSongOpen, setIsShareSongOpen] = useState(false);
  const [isSharePlaylistOpen, setIsSharePlaylistOpen] = useState(false);
  const [shareTargetUsername, setShareTargetUsername] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [quickAddHandle, setQuickAddHandle] = useState('');
  const [isSendingQuickReq, setIsSendingQuickReq] = useState(false);
  const [busyRequestIds, setBusyRequestIds] = useState<Record<string, boolean>>({});
  const [busyFriendIds, setBusyFriendIds] = useState<Record<string, boolean>>({});

  // Real Social Data State
  const [rawFriends, setRawFriends] = useState<any[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, any>>({});
  const [shares, setShares] = useState<SharedMediaItem[]>([]);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FirestoreFriendRequest[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<FirestoreFriendRequest[]>([]);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [userRatings, setUserRatings] = useState<Record<string, string | null>>({});

  // Resolve stable authenticated or persistent local user
  const effectiveUser: AppUser = useMemo(() => {
    if (currentUser) return currentUser;
    const authUser = FirebaseAuthService.getCurrentUser();
    if (authUser) return authUser;

    let fallbackUid = localStorage.getItem('lumen_persistent_uid');
    if (!fallbackUid) {
      fallbackUid = 'usr_' + Math.random().toString(36).slice(2, 9);
      try { localStorage.setItem('lumen_persistent_uid', fallbackUid); } catch (_) {}
    }
    const fallbackHandle = localStorage.getItem('lumen_user_handle') || 'listener';
    return {
      uid: fallbackUid,
      email: null,
      displayName: fallbackHandle.charAt(0).toUpperCase() + fallbackHandle.slice(1),
      photoURL: null,
      username: fallbackHandle,
      isGuest: true,
      emailVerified: false,
      hasCompletedOnboarding: true
    };
  }, [currentUser]);

  const userId = effectiveUser.uid;
  const myUsername = (
    effectiveUser.username ||
    profileUsername ||
    effectiveUser.email?.split('@')[0] ||
    effectiveUser.displayName?.replace(/^@/, '') ||
    'listener'
  ).toLowerCase().trim();

  // Fetch authoritative Firestore username if missing from effectiveUser
  useEffect(() => {
    if (!userId || effectiveUser.username || effectiveUser.isGuest) return;
    FirestoreService.getUserProfile(userId)
      .then((prof) => {
        if (prof?.username) {
          setProfileUsername(String(prof.username).toLowerCase());
        }
      })
      .catch(() => {});
  }, [userId, effectiveUser.username, effectiveUser.isGuest]);

  // 1. Subscribe to Real Friends List
  useEffect(() => {
    if (!userId) return;
    const unsub = FirestoreService.subscribeToFriends(userId, (list) => {
      setRawFriends(list || []);
    });
    return () => unsub();
  }, [userId]);

  // 2. Subscribe to Friends' Live Presence (Now Listening)
  useEffect(() => {
    if (!userId || rawFriends.length === 0) return;
    const friendUids = rawFriends.map((f: any) => f.userId || f.user_id || f.uid).filter(Boolean);
    if (friendUids.length === 0) return;

    const unsub = FirestoreService.subscribeToFriendsPresence(friendUids, (presences) => {
      setPresenceMap(presences || {});
    });
    return () => unsub();
  }, [userId, rawFriends]);

  // 3. Subscribe to Incoming Song & Playlist Shares (Fixing playlist shares support)
  useEffect(() => {
    if (!userId) return;
    const unsub = FirestoreService.subscribeToReceivedShares(userId, (rawShares) => {
      const mapped: SharedMediaItem[] = (rawShares || []).map((s) => ({
        id: s.id,
        senderUid: s.senderId,
        senderUsername: s.senderUsername,
        senderDisplayName: s.senderDisplayName,
        senderPhotoURL: null,
        recipientUid: s.recipientId,
        song: s.song,
        playlist: s.playlist,
        type: s.type || (s.playlist ? 'playlist' : 'song'),
        message: s.message || undefined,
        senderRating: null,
        read: !!s.read,
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now() - 3600000
      }));
      setShares(mapped);
    });
    return () => unsub();
  }, [userId]);

  // 4. Subscribe to Pending Friend Requests (Incoming + Outgoing)
  useEffect(() => {
    if (!userId && !myUsername) return;
    const unsubIn = FirestoreService.subscribeToFriendRequests(userId, (reqs) => {
      const pending = (reqs || []).filter((r) => r.status === 'pending');
      setIncomingFriendRequests(pending);
      setPendingRequestsCount(pending.length);
    }, myUsername);

    const unsubOut = FirestoreService.subscribeToOutgoingFriendRequests(userId, (reqs) => {
      const pendingOut = (reqs || []).filter((r) => r.status === 'pending');
      setOutgoingFriendRequests(pendingOut);
    }, myUsername);

    return () => {
      unsubIn();
      unsubOut();
    };
  }, [userId, myUsername]);

  // 5. Load Current User's Ratings for Tier Lists and Compatibility
  useEffect(() => {
    if (!userId) return;
    FirestoreService.getUserRatings(userId).then((r) => {
      setUserRatings(r || {});
    }).catch(() => {});
  }, [userId]);

  // 6. Subscribe to User's Personal & Collaborative Tier Lists
  useEffect(() => {
    if (!userId) return;
    const unsub = FirestoreService.subscribeUserTierLists(userId, (lists) => {
      setTierLists(lists || []);
    }, myUsername);
    return () => unsub();
  }, [userId, myUsername]);

  // Format Merged Friends with Live Presence Data
  const friendProfiles: FriendProfileData[] = useMemo(() => {
    return rawFriends.map((f) => {
      const p = presenceMap[f.userId || f.user_id || f.uid];
      const isOnline = Boolean(p && (p.isPlaying || (Date.now() - (p.updatedAt || 0) < 600000)));

      return {
        userId: f.userId || f.user_id || f.uid,
        username: f.username || 'friend',
        displayName: f.displayName || f.display_name || f.username || 'Friend',
        photoURL: null,
        ratingVisibility: f.rating_visibility || 'friends',
        tasteSimilarity: 0.85,
        sharedArtists: ['The Weeknd', 'Tame Impala', 'Arctic Monkeys'],
        currentTrack: p?.currentTrack || null,
        isPlaying: Boolean(p?.isPlaying),
        updatedAt: p?.updatedAt || Date.now(),
        isOnline
      };
    });
  }, [rawFriends, presenceMap]);

  // Generate Activity Stream from real events
  const activityEvents: FriendActivityEvent[] = useMemo(() => {
    const list: FriendActivityEvent[] = [];

    friendProfiles.forEach((f) => {
      if (f.currentTrack) {
        list.push({
          id: `listen_${f.userId}`,
          userId: f.userId,
          username: f.username,
          displayName: f.displayName,
          photoURL: null,
          type: 'listening',
          track: f.currentTrack,
          timestamp: f.updatedAt || Date.now() - 300000
        });
      }
    });

    shares.forEach((s) => {
      list.push({
        id: `share_${s.id}`,
        userId: s.senderUid,
        username: s.senderUsername,
        displayName: s.senderDisplayName || s.senderUsername,
        photoURL: null,
        type: s.type === 'playlist' ? 'shared_playlist' : 'shared_song',
        track: s.song || undefined,
        playlistName: s.playlist?.name,
        timestamp: s.createdAt
      });
    });

    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [friendProfiles, shares]);

  const handleOpenProfile = (friend: FriendProfileData) => {
    setSelectedFriend(friend);
    setSubView('friend-profile');
  };

  const handleOpenShareSongForFriend = (username: string) => {
    setShareTargetUsername(username);
    setIsShareSongOpen(true);
  };

  const handleShowToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Create a new Tier List and immediately open it
  const handleCreateNewTierList = async () => {
    if (!currentUser) {
      handleShowToast('Please sign in to create tier lists');
      return;
    }
    setIsCreatingTier(true);
    try {
      const collabFriends = friendProfiles.filter(f => selectedCollabFriends.includes(f.username));
      const collaboratorUids = collabFriends.map(f => f.userId);
      const collaboratorUsernames = collabFriends.map(f => f.username);

      const res = await FirestoreService.createTierList(
        effectiveUser,
        newTierTitle.trim() || 'My Definitive Tier List',
        isNewTierCollab,
        collaboratorUids,
        collaboratorUsernames
      );

      if (res.success && res.id) {
        WatchSoundService.playTick(1.2);
        setShowNewTierModal(false);
        setActiveTierListId(res.id);
        setMainTab('tier-lists');
        handleShowToast('Tier List Studio created!');
      } else {
        handleShowToast(res.error || 'Failed to create tier list');
      }
    } catch (e: any) {
      handleShowToast(e.message || 'Error creating tier list');
    } finally {
      setIsCreatingTier(false);
    }
  };

  // Delete Tier List
  const handleDeleteTierList = async (id: string, name?: string) => {
    if (confirm(`Delete tier list "${name || 'Untitled'}"? This cannot be undone.`)) {
      WatchSoundService.playTick(1.0);
      setTierLists(prev => prev.filter(t => t.id !== id));
      if (activeTierListId === id) {
        setActiveTierListId(null);
      }
      handleShowToast('Tier list deleted');
      await FirestoreService.deleteTierList(id);
    }
  };

  // Delete Individual Shared Notification
  const handleDeleteShare = async (shareId: string) => {
    WatchSoundService.playTick(1.0);
    setShares(prev => prev.filter(s => s.id !== shareId));
    SocialService.dismissShareLocally(shareId);
    handleShowToast('Notification removed');
    await FirestoreService.deleteShare(shareId);
  };

  // Clear All Shared Notifications
  const handleClearAllShares = async () => {
    if (shares.length === 0) return;
    if (confirm(`Clear all ${shares.length} shared notifications?`)) {
      WatchSoundService.playTick(1.0);
      setShares([]);
      SocialService.clearAllSharesLocally();
      handleShowToast('All shared notifications cleared');
      if (userId) {
        await FirestoreService.clearAllReceivedShares(userId);
      }
    }
  };

  // Helper for human-readable timestamps
  const formatTimeAgo = (timestamp?: number): string => {
    if (!timestamp) return 'recently';
    const diff = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Respond to incoming friend request (Dashboard Hero Banner or Friend Requests Tab)
  const handleRespondToFriendRequest = async (request: FirestoreFriendRequest, accept: boolean) => {
    setBusyRequestIds(prev => ({ ...prev, [request.id]: true }));
    try {
      WatchSoundService.playTick(accept ? 1.3 : 0.8);
      const ok = await FirestoreService.respondToFriendRequest(request, accept);
      if (ok) {
        setIncomingFriendRequests(prev => prev.filter(r => r.id !== request.id));
        setPendingRequestsCount(prev => Math.max(0, prev - 1));
        handleShowToast(accept ? `Connected with @${request.fromUsername || 'friend'}!` : 'Request declined');
      } else {
        handleShowToast('Could not process friend request. Check sign-in or connection.');
      }
    } catch (err: any) {
      console.warn('[Friends] respondToFriendRequest error:', err);
      handleShowToast('Could not process friend request');
    } finally {
      setBusyRequestIds(prev => ({ ...prev, [request.id]: false }));
    }
  };

  // Cancel an outgoing pending friend request
  const handleCancelOutgoingRequest = async (req: FirestoreFriendRequest) => {
    if (!userId) return;
    setBusyRequestIds(prev => ({ ...prev, [req.id]: true }));
    try {
      const ok = await FirestoreService.cancelFriendRequest(userId, req.toUid);
      if (ok) {
        WatchSoundService.playTick(1.0);
        setOutgoingFriendRequests(prev => prev.filter(r => r.id !== req.id));
        handleShowToast(`Cancelled request to @${req.toUsername || 'listener'}`);
      } else {
        handleShowToast('Could not cancel friend request');
      }
    } catch (_) {
      handleShowToast('Could not cancel friend request');
    } finally {
      setBusyRequestIds(prev => ({ ...prev, [req.id]: false }));
    }
  };

  // Remove a connected friend cleanly from Firestore
  const handleRemoveFriendAction = async (friendUid: string, friendUsername?: string): Promise<boolean> => {
    if (!userId) return false;
    setBusyFriendIds(prev => ({ ...prev, [friendUid]: true }));
    try {
      const ok = await FirestoreService.removeFriend(userId, friendUid);
      if (ok) {
        WatchSoundService.playTick(0.9);
        setRawFriends(prev => prev.filter(f => (f.userId || f.user_id || f.uid) !== friendUid));
        handleShowToast(friendUsername ? `Removed @${friendUsername} from friends` : 'Friend removed');
        return true;
      } else {
        handleShowToast('Failed to remove friend from cloud. Check your sign-in state.');
        return false;
      }
    } catch (_) {
      handleShowToast('Could not remove friend');
      return false;
    } finally {
      setBusyFriendIds(prev => ({ ...prev, [friendUid]: false }));
    }
  };

  // Send a friend request directly by @username handle
  const handleQuickSendFriendRequest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const target = quickAddHandle.trim();
    if (!target || isSendingQuickReq) return;

    setIsSendingQuickReq(true);
    try {
      const res = await FirestoreService.sendFriendRequest(effectiveUser, target);
      if (res.success) {
        WatchSoundService.playTick(1.25);
        setQuickAddHandle('');
        handleShowToast(
          res.autoAccepted
            ? `Connected with @${target.replace(/^@/, '')}!`
            : `Friend request sent to @${target.replace(/^@/, '')}!`
        );
      } else {
        handleShowToast(res.error || 'Could not send friend request');
      }
    } catch (err: any) {
      handleShowToast(err?.message || 'Failed to send request');
    } finally {
      setIsSendingQuickReq(false);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto px-4 sm:px-8 py-4 sm:py-6 select-none relative pb-32">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-black/90 border border-white/20 backdrop-blur-2xl text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-fadeIn pointer-events-auto">
          <Sparkles className="w-4 h-4 text-lumen-cyan" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TOP LIQUID GLASS SEGMENTED SWITCHER: FRIENDS | TIER LISTS | REQUESTS */}
      {/* ------------------------------------------------------------- */}
      {subView === 'dashboard' && !activeTierListId && (
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-2xl shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMainTab('friends');
                WatchSoundService.playTick(1.2);
              }}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                mainTab === 'friends'
                  ? 'bg-white text-black shadow-lg shadow-white/10 scale-100'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Friends & Social</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMainTab('tier-lists');
                WatchSoundService.playTick(1.2);
              }}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                mainTab === 'tier-lists'
                  ? 'bg-white text-black shadow-lg shadow-white/10 scale-100'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Tier Lists</span>
              {tierLists.length > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  mainTab === 'tier-lists' ? 'bg-black/20 text-black' : 'bg-white/10 text-white/70'
                }`}>
                  {tierLists.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setMainTab('requests');
                WatchSoundService.playTick(1.2);
              }}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                mainTab === 'requests'
                  ? 'bg-white text-black shadow-lg shadow-white/10 scale-100'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Friend Requests</span>
              {incomingFriendRequests.length > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full font-bold ${
                  mainTab === 'requests'
                    ? 'bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                    : 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40 animate-pulse'
                }`}>
                  {incomingFriendRequests.length}
                </span>
              )}
            </button>
          </div>

          {/* Action button on right of top switcher */}
          {mainTab === 'tier-lists' && (
            <button
              type="button"
              onClick={() => {
                setNewTierTitle('My Definitive Tier List');
                setIsNewTierCollab(false);
                setSelectedCollabFriends([]);
                setShowNewTierModal(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all shadow-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Tier List</span>
            </button>
          )}

          {mainTab === 'requests' && (
            <button
              type="button"
              onClick={() => setSubView('add-friends')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 backdrop-blur-xl active:scale-95 transition-all shadow-lg cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-lumen-cyan" />
              <span>Find Friends</span>
            </button>
          )}
        </div>
      )}

      {/* ============================================================= */}
      {/* SECTION A: TIER LISTS DIRECTORY OR ACTIVE TIER LIST STUDIO    */}
      {/* ============================================================= */}
      {mainTab === 'tier-lists' && subView === 'dashboard' && (
        <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
          {activeTierListId ? (
            <TierListStudioView
              tierListId={activeTierListId}
              initialTierList={tierLists.find(t => t.id === activeTierListId) || null}
              onBack={() => setActiveTierListId(null)}
              currentUser={currentUser}
              currentUserRatings={userRatings}
              userLikedTracks={playlists.flatMap((p) => p.tracks || [])}
              friends={friendProfiles}
              onPlayTrack={onPlayTrack}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              dominantColor={dominantColor}
            />
          ) : (
            <div className="space-y-6">
              {/* Directory Hero */}
              <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-purple-500/10 border border-white/15 backdrop-blur-3xl relative overflow-hidden shadow-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_10px_#f59e0b]" />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-amber-300 font-bold">
                      Interactive 2-Region Ranking Studio
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    Your Tier Lists & Collaborative Boards
                  </h2>
                  <p className="text-xs sm:text-sm text-white/50 mt-1 max-w-xl">
                    Rank songs and full albums across S, A, B, C, D tiers with drag-and-drop. Work together with friends in real-time or build personal lists strictly from your rated tracks.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setNewTierTitle('My Definitive Tier List');
                    setIsNewTierCollab(false);
                    setSelectedCollabFriends([]);
                    setShowNewTierModal(true);
                  }}
                  className="px-5 py-3 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all shadow-xl flex items-center gap-2 cursor-pointer flex-shrink-0"
                >
                  <Plus className="w-4 h-4 text-black" />
                  <span>Create New Tier List</span>
                </button>
              </div>

              {/* Tier Lists Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-bold text-white tracking-wide">
                    Your Created & Collaborative Lists
                  </h3>
                  <span className="text-[11px] font-mono text-white/40">{tierLists.length} boards</span>
                </div>

                {tierLists.length === 0 ? (
                  <div className="p-10 rounded-3xl bg-white/[0.03] border border-white/10 text-center space-y-3">
                    <Layers className="w-10 h-10 mx-auto text-white/20" />
                    <div>
                      <h4 className="text-sm font-bold text-white/70">No Tier Lists Yet</h4>
                      <p className="text-xs text-white/40 mt-1 max-w-md mx-auto">
                        Create your first personal ranking board or invite a friend to collaborate in real-time!
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNewTierModal(true)}
                      className="px-4 py-2 rounded-full bg-white/10 hover:bg-white text-white hover:text-black font-bold text-xs transition-all cursor-pointer"
                    >
                      + Start First Tier List
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {tierLists.map((tl) => {
                      const totalRanked = 
                        (tl.tiers?.s?.length || 0) + 
                        (tl.tiers?.a?.length || 0) + 
                        (tl.tiers?.b?.length || 0) + 
                        (tl.tiers?.c?.length || 0) + 
                        (tl.tiers?.d?.length || 0);

                      const sampleCovers = [
                        ...(tl.tiers?.s || []),
                        ...(tl.tiers?.a || []),
                        ...(tl.tiers?.b || [])
                      ].map(t => t.artworkUrl).filter(Boolean).slice(0, 4);

                      return (
                        <div
                          key={tl.id}
                          onClick={() => setActiveTierListId(tl.id)}
                          className="p-5 rounded-3xl bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-white/[0.01] hover:from-white/[0.08] hover:via-white/[0.04] border border-white/10 hover:border-white/25 backdrop-blur-2xl transition-all cursor-pointer group shadow-xl relative"
                        >
                          {/* Header badge & title */}
                          <div className="flex items-center justify-between gap-2 mb-2">
                            {tl.isCollaborative ? (
                              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-pink-500/15 border border-pink-500/30 text-[10px] font-bold text-pink-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
                                <span>Collaborative</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-white/50">
                                Personal
                              </span>
                            )}

                            <div className="flex items-center gap-1.5">
                              {tl.collaboratorUsernames && tl.collaboratorUsernames.length > 0 && (
                                <div className="flex items-center -space-x-1">
                                  {tl.collaboratorUsernames.slice(0, 3).map((u) => (
                                    <InitialAvatar key={u} name={u} size="xs" />
                                  ))}
                                </div>
                              )}

                              {/* Delete Tier List Button on Card */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTierList(tl.id, tl.title);
                                }}
                                className="p-1.5 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/40 hover:text-rose-300 border border-white/5 hover:border-rose-500/30 transition-all cursor-pointer"
                                title="Delete Tier List"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <h4 className="text-base font-bold text-white truncate group-hover:text-lumen-cyan transition-colors">
                            {tl.title}
                          </h4>
                          <p className="text-xs text-white/40 mt-0.5">
                            {totalRanked} tracks ranked • by @{tl.ownerUsername}
                          </p>

                          {/* Preview Thumbnail Grid */}
                          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/5">
                            {sampleCovers.length > 0 ? (
                              sampleCovers.map((cov, idx) => (
                                <div key={idx} className="w-10 h-10 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                                  <CoverImage
                                    src={cov || null}
                                    alt="Cover"
                                    title="Track"
                                    size={80}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))
                            ) : (
                              <div className="text-[11px] text-white/30 italic">
                                Empty board ready to fill
                              </div>
                            )}

                            <div className="ml-auto">
                              <span className="text-xs font-bold text-lumen-cyan group-hover:translate-x-1 transition-transform inline-block">
                                Open Studio →
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Friends' Tier Lists for Comparison */}
              <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-bold text-white">Friends' Music Rankings</h3>
                  </div>
                  <span className="text-xs text-white/40">Compare your taste</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {friendProfiles.slice(0, 3).map((friend) => (
                    <div
                      key={friend.userId}
                      onClick={() => {
                        setSelectedFriend(friend);
                        setSubView('tier-list-stage');
                      }}
                      className="p-4 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 hover:border-white/20 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <InitialAvatar name={friend.displayName || friend.username} size="sm" isOnline={friend.isOnline} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{friend.displayName}</div>
                          <div className="text-[10px] text-white/40 truncate">@{friend.username}</div>
                        </div>
                      </div>
                      <div className="text-[11px] text-white/50 mb-3">View and compare S, A, B, C tier rankings</div>
                      <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 font-bold text-[10px] group-hover:bg-amber-500 group-hover:text-black transition-colors">
                        Compare with Mine
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================= */}
      {/* SHARED SUB-VIEWS (ADD FRIENDS, PROFILE, COMPARE STAGE)        */}
      {/* ============================================================= */}
      {!activeTierListId && subView !== 'dashboard' && (
        <>
          {/* SUB-VIEW 1: ADD FRIENDS SCREEN */}
          {subView === 'add-friends' && (
            <AddFriendsSection
              currentUser={effectiveUser}
              onBack={() => setSubView('dashboard')}
              dominantColor={dominantColor}
            />
          )}

          {/* SUB-VIEW 2: FRIEND PROFILE SCREEN */}
          {subView === 'friend-profile' && selectedFriend && (
            <FriendProfileSection
              friend={selectedFriend}
              onBack={() => setSubView('dashboard')}
              onPlayTrack={onPlayTrack}
              onPlayPlaylist={(pl) => {
                if (pl.tracks && pl.tracks.length > 0) {
                  onPlayTrack(pl.tracks[0], pl.tracks);
                }
              }}
              onOpenShareSong={handleOpenShareSongForFriend}
              onOpenTierListCompare={() => setSubView('tier-list-stage')}
              onRemoveFriend={async (friendId) => {
                const removed = await handleRemoveFriendAction(friendId, selectedFriend.username);
                if (removed) {
                  setSubView('dashboard');
                }
              }}
              dominantColor={dominantColor}
            />
          )}

          {/* SUB-VIEW 3: TIER LIST & COMPARISON STAGE */}
          {subView === 'tier-list-stage' && (
            <TierListComparisonStage
              friend={selectedFriend}
              currentUserRatings={userRatings}
              userLikedTracks={playlists.flatMap((p) => p.tracks || []).slice(0, 30)}
              onBack={() => setSubView(selectedFriend ? 'friend-profile' : 'dashboard')}
              onPlayTrack={onPlayTrack}
              dominantColor={dominantColor}
            />
          )}
        </>
      )}

      {/* ============================================================= */}
      {/* SECTION B: FRIENDS & SOCIAL MAIN DASHBOARD                    */}
      {/* ============================================================= */}
      {mainTab === 'friends' && subView === 'dashboard' && (
            <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
              {/* Header Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                      Friends and More
                    </h1>
                    {pendingRequestsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setMainTab('requests')}
                        className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-mono text-[11px] font-bold animate-pulse cursor-pointer"
                      >
                        <span>{pendingRequestsCount} new request</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-white/50 mt-1 font-medium">
                    Connect • Share • Discover
                  </p>
                </div>

                {/* Quick Actions Header Pills */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => setSubView('add-friends')}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/15 backdrop-blur-md active:scale-95 transition-all cursor-pointer shadow-md"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-lumen-cyan" />
                    <span>Add Friends</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShareTargetUsername('');
                      setIsShareSongOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 active:scale-95 transition-all cursor-pointer shadow-md"
                  >
                    <Share2 className="w-3.5 h-3.5 text-black" />
                    <span>Share Song</span>
                  </button>
                </div>
              </div>

              {/* User Profile Overview Strip (Clean InitialAvatar) */}
              <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-white/[0.06] via-white/[0.03] to-white/[0.01] border border-white/10 backdrop-blur-2xl flex items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-3.5 min-w-0">
                  <InitialAvatar name={currentUser?.displayName || myUsername} size="lg" />
                  <div className="min-w-0">
                    <div className="text-sm sm:text-base font-bold text-white truncate">
                      {currentUser?.displayName || myUsername}
                    </div>
                    <div className="text-xs text-white/50 truncate">@{myUsername}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                  <div className="px-3 py-1.5 rounded-2xl bg-white/[0.05] border border-white/10 text-center">
                    <div className="text-xs sm:text-sm font-bold text-white">{friendProfiles.length}</div>
                    <div className="text-[10px] text-white/40">Friends</div>
                  </div>
                  <div className="px-3 py-1.5 rounded-2xl bg-white/[0.05] border border-white/10 text-center">
                    <div className="text-xs sm:text-sm font-bold text-white">{shares.length}</div>
                    <div className="text-[10px] text-white/40">Shared</div>
                  </div>
                </div>
              </div>

              {/* HERO BANNER: INCOMING FRIEND REQUESTS (Liquid Glass Accept/Decline) */}
              {incomingFriendRequests.length > 0 && (
                <div className="relative overflow-hidden p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-emerald-500/10 via-white/[0.04] to-rose-500/10 border border-white/15 backdrop-blur-2xl shadow-2xl space-y-3.5 animate-fadeIn">
                  {/* Glass Ambient Highlights */}
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

                  {/* Header Row */}
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
                      </span>
                      <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                        <span>Friend Requests</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold border border-emerald-400/35">
                          {incomingFriendRequests.length}
                        </span>
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMainTab('requests')}
                      className="text-[11px] font-semibold text-white/60 hover:text-white transition-colors cursor-pointer"
                    >
                      Open Requests Tab →
                    </button>
                  </div>

                  {/* Requests Cards Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 relative z-10">
                    {incomingFriendRequests.map((req) => {
                      const isBusy = Boolean(busyRequestIds[req.id]);
                      return (
                        <div
                          key={req.id}
                          className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-black/40 hover:bg-black/55 border border-white/15 hover:border-white/25 backdrop-blur-xl transition-all shadow-lg group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <InitialAvatar name={req.fromDisplayName || req.fromUsername || 'Listener'} size="md" />
                            <div className="min-w-0">
                              <div className="text-xs sm:text-sm font-bold text-white truncate">
                                {req.fromDisplayName || req.fromUsername}
                              </div>
                              <div className="text-[11px] text-white/50 truncate flex items-center gap-1.5">
                                <span>@{req.fromUsername || 'listener'}</span>
                                <span className="text-white/20">•</span>
                                <span className="text-white/40">{formatTimeAgo(req.createdAt)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRespondToFriendRequest(req, false)}
                              className="px-3.5 py-2 rounded-full bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 hover:text-white border border-rose-400/50 backdrop-blur-xl shadow-[0_4px_18px_rgba(244,63,94,0.28),inset_0_1px_0_rgba(255,255,255,0.2)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                              title="Decline request"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Decline</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRespondToFriendRequest(req, true)}
                              className="px-4 py-2 rounded-full bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 hover:text-white border border-emerald-400/50 backdrop-blur-xl shadow-[0_4px_18px_rgba(16,185,129,0.28),inset_0_1px_0_rgba(255,255,255,0.25)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                            >
                              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              <span>Accept</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Friends Online Horizontal Carousel */}
              <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl shadow-xl">
                <FriendsOnlineBar
                  friends={friendProfiles}
                  onSelectFriend={handleOpenProfile}
                  onOpenAddFriends={() => setSubView('add-friends')}
                  dominantColor={dominantColor}
                />
              </div>

              {/* Quick Actions Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setSubView('add-friends')}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-lumen-cyan/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform mb-2">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-lumen-cyan transition-colors">Add Friends</div>
                  <div className="text-[10px] text-white/40">Find & connect</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShareTargetUsername('');
                    setIsShareSongOpen(true);
                  }}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-pink-500/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform mb-2">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-pink-300 transition-colors">Share Song</div>
                  <div className="text-[10px] text-white/40">Send track recommendations</div>
                </button>

                <button
                  type="button"
                  onClick={() => setIsSharePlaylistOpen(true)}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-indigo-500/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform mb-2">
                    <FolderPlus className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors">Share Playlist</div>
                  <div className="text-[10px] text-white/40">Send curated collections</div>
                </button>

                <button
                  type="button"
                  onClick={() => setMainTab('tier-lists')}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-amber-500/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform mb-2">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">Tier List Studio</div>
                  <div className="text-[10px] text-white/40">Interactive 2-pane board</div>
                </button>
              </div>

              {/* TWO-COLUMN DASHBOARD GRID */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* MAIN COLUMN */}
                <div className="lg:col-span-7 space-y-6">
                  {/* 1. Listening Activity */}
                  <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h3 className="text-sm font-bold text-white tracking-wide">
                        Listening Activity
                      </h3>
                      <span className="text-[11px] font-mono text-white/40">Live friend feeds</span>
                    </div>

                    {friendProfiles.filter(f => Boolean(f.currentTrack)).length === 0 ? (
                      <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/10 text-center text-white/40">
                        <Disc3 className="w-8 h-8 mx-auto mb-2 opacity-30 text-lumen-cyan" />
                        <p className="text-xs font-medium text-white/60">No friends listening right now</p>
                        <p className="text-[10px] text-white/40 mt-0.5">When friends hit play, their live tracks stream here with dynamic lighting</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {friendProfiles
                          .filter(f => Boolean(f.currentTrack))
                          .map((friend) => (
                            <ListeningActivityCard
                              key={friend.userId}
                              friend={friend}
                              onPlayTrack={onPlayTrack}
                              onAddToQueue={onAddToQueue}
                              onSelectFriend={handleOpenProfile}
                              isCurrentlyPlayingTrack={isPlaying && currentTrack?.id === friend.currentTrack?.id}
                            />
                          ))}
                      </div>
                    )}
                  </div>

                  {/* 2. Shared With You */}
                  <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h3 className="text-sm font-bold text-white tracking-wide">
                        Shared With You
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-white/40">{shares.length} recommendations</span>
                        {shares.length > 0 && (
                          <button
                            type="button"
                            onClick={handleClearAllShares}
                            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/50 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 text-[10px] font-semibold transition-all active:scale-95 cursor-pointer"
                            title="Clear all shared song notifications"
                          >
                            <Trash2 className="w-3 h-3 text-rose-400" />
                            <span>Clear All</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <SharedWithYouPanel
                      shares={shares}
                      onPlaySong={onPlayTrack}
                      onPlayPlaylist={(pl) => {
                        if (pl.tracks && pl.tracks.length > 0) {
                          onPlayTrack(pl.tracks[0], pl.tracks);
                        }
                      }}
                      onSaveToLibrary={(item) => {
                        handleShowToast('Saved to your Library!');
                      }}
                      onSelectSender={(senderUid, senderUsername) => {
                        const match = friendProfiles.find(f => f.userId === senderUid);
                        if (match) handleOpenProfile(match);
                      }}
                      onDeleteShare={handleDeleteShare}
                      onClearAllShares={handleClearAllShares}
                      dominantColor={dominantColor}
                    />
                  </div>
                </div>

                {/* SECONDARY COLUMN */}
                <div className="lg:col-span-5 space-y-6">
                  {/* 1. Music Compatibility Widget */}
                  <MusicCompatibilityWidget
                    friends={friendProfiles}
                    onSelectFriend={handleOpenProfile}
                    userLikedTracks={playlists.flatMap(p => p.tracks || []).slice(0, 20)}
                    dominantColor={dominantColor}
                  />

                  {/* 2. Friends Activity Feed */}
                  <FriendsActivityFeed
                    events={activityEvents}
                    onPlayTrack={onPlayTrack}
                    onSelectFriend={(uId) => {
                      const match = friendProfiles.find(f => f.userId === uId);
                      if (match) handleOpenProfile(match);
                    }}
                    dominantColor={dominantColor}
                  />
                </div>
              </div>
            </div>
      )}

      {/* ============================================================= */}
      {/* SECTION C: FRIEND REQUESTS & CONNECTED FRIENDS LIST           */}
      {/* ============================================================= */}
      {mainTab === 'requests' && subView === 'dashboard' && (
        <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn">
          {/* Guest Session Warning if needed */}
          {effectiveUser.isGuest && (
            <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-400/40 backdrop-blur-xl text-xs text-amber-200 flex items-center justify-between gap-3 shadow-lg">
              <span>
                You are using a Guest session (<span className="font-mono font-bold">@{myUsername}</span>). Sign in with a registered account to send or receive cloud friend requests.
              </span>
            </div>
          )}

          {/* Header & Quick Send Friend Request Card */}
          <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-white/[0.01] border border-white/15 backdrop-blur-3xl shadow-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  Friend Requests & Connections
                </h2>
                <p className="text-xs text-white/50 mt-0.5">
                  Your handle is <span className="text-lumen-cyan font-mono font-bold">@{myUsername}</span> • Accept or decline incoming invites, or manage your friends below
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubView('add-friends')}
                className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/15 backdrop-blur-xl active:scale-95 transition-all cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Search Username Directory</span>
              </button>
            </div>

            {/* Direct @username Send Form */}
            <form onSubmit={handleQuickSendFriendRequest} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={quickAddHandle}
                  onChange={(e) => setQuickAddHandle(e.target.value)}
                  placeholder="Enter exact @username to send a friend request..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-black/40 border border-white/15 focus:border-lumen-cyan text-white text-xs sm:text-sm placeholder-white/40 focus:outline-none transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isSendingQuickReq || !quickAddHandle.trim()}
                className="px-5 py-2.5 rounded-2xl bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-100 hover:text-white border border-cyan-400/50 backdrop-blur-xl shadow-[0_4px_16px_rgba(34,211,238,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer disabled:opacity-40"
              >
                {isSendingQuickReq ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                <span>Send Request</span>
              </button>
            </form>
          </div>

          {/* 1. INCOMING FRIEND REQUESTS */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] border border-white/12 backdrop-blur-2xl shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${incomingFriendRequests.length > 0 ? 'bg-emerald-400 animate-pulse shadow-[0_0_10px_#10b981]' : 'bg-white/25'}`} />
                <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                  Incoming Requests
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/80 font-mono text-[11px] font-bold">
                  {incomingFriendRequests.length}
                </span>
              </div>
              <span className="text-[11px] font-mono text-white/40">Real-time sync</span>
            </div>

            {incomingFriendRequests.length === 0 ? (
              <div className="p-8 rounded-2xl bg-black/25 border border-white/10 text-center space-y-2">
                <Bell className="w-8 h-8 mx-auto text-white/25" />
                <div className="text-xs sm:text-sm font-bold text-white/70">No Incoming Friend Requests</div>
                <p className="text-[11px] text-white/40 max-w-md mx-auto">
                  When another listener sends a request to <span className="text-lumen-cyan font-mono">@{myUsername}</span>, it will appear right here with Accept & Decline controls.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {incomingFriendRequests.map((req) => {
                  const isBusy = Boolean(busyRequestIds[req.id]);
                  return (
                    <div
                      key={req.id}
                      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-4 rounded-2xl bg-white/[0.05] hover:bg-white/[0.08] border border-white/15 backdrop-blur-xl transition-all shadow-lg"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <InitialAvatar name={req.fromDisplayName || req.fromUsername || 'Listener'} size="md" />
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white truncate">
                            {req.fromDisplayName || req.fromUsername}
                          </div>
                          <div className="text-xs text-white/50 truncate flex items-center gap-1.5">
                            <span>@{req.fromUsername || 'listener'}</span>
                            <span className="text-white/20">•</span>
                            <span className="text-white/40">{formatTimeAgo(req.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Liquid Glass Green Accept / Red Decline Buttons */}
                      <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRespondToFriendRequest(req, true)}
                          className="px-4 py-2 rounded-full bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 hover:text-white border border-emerald-400/50 backdrop-blur-xl shadow-[0_4px_18px_rgba(16,185,129,0.3),inset_0_1px_0_rgba(255,255,255,0.28)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          <span>Accept</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRespondToFriendRequest(req, false)}
                          className="px-4 py-2 rounded-full bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 hover:text-white border border-rose-400/50 backdrop-blur-xl shadow-[0_4px_18px_rgba(244,63,94,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. OUTGOING / SENT REQUESTS */}
          {outgoingFriendRequests.length > 0 && (
            <div className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-white">Sent Requests (Pending)</h3>
                </div>
                <span className="text-[11px] font-mono text-white/40">{outgoingFriendRequests.length} awaiting approval</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {outgoingFriendRequests.map((req) => {
                  const isBusy = Boolean(busyRequestIds[req.id]);
                  return (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <InitialAvatar name={req.toUsername || 'Listener'} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs sm:text-sm font-bold text-white truncate">
                            @{req.toUsername || 'listener'}
                          </div>
                          <div className="text-[11px] text-white/45 truncate">
                            Sent {formatTimeAgo(req.createdAt)} • Awaiting response
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleCancelOutgoingRequest(req)}
                        className="px-3.5 py-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 hover:text-white border border-rose-400/50 backdrop-blur-xl shadow-[0_4px_14px_rgba(244,63,94,0.22),inset_0_1px_0_rgba(255,255,255,0.18)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        <span>Cancel</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. CONNECTED FRIENDS LIST */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] border border-white/12 backdrop-blur-2xl shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-lumen-cyan" />
                <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                  Your Friends List
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/80 font-mono text-[11px] font-bold">
                  {friendProfiles.length}
                </span>
              </div>
              <span className="text-[11px] font-mono text-white/40">Connected accounts</span>
            </div>

            {friendProfiles.length === 0 ? (
              <div className="p-8 rounded-2xl bg-black/25 border border-white/10 text-center space-y-2">
                <Users className="w-8 h-8 mx-auto text-white/25" />
                <div className="text-xs sm:text-sm font-bold text-white/70">No Friends Connected Yet</div>
                <p className="text-[11px] text-white/40 max-w-md mx-auto">
                  Send a friend request above or search the directory to add listeners to your friends list.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {friendProfiles.map((friend) => {
                  const isBusy = Boolean(busyFriendIds[friend.userId]);
                  return (
                    <div
                      key={friend.userId}
                      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 backdrop-blur-xl transition-all"
                    >
                      <div
                        onClick={() => handleOpenProfile(friend)}
                        className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                      >
                        <InitialAvatar name={friend.displayName || friend.username} size="md" isOnline={friend.isOnline} />
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white truncate">{friend.displayName}</div>
                          <div className="text-[11px] text-white/50 truncate">
                            @{friend.username}
                            {friend.currentTrack ? ` • Playing ${friend.currentTrack.title}` : friend.isOnline ? ' • Online' : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
                        <button
                          type="button"
                          onClick={() => handleOpenShareSongForFriend(friend.username)}
                          className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/85 hover:text-white border border-white/15 backdrop-blur-md text-[11px] font-semibold active:scale-95 transition-all cursor-pointer"
                          title="Share song"
                        >
                          Share
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenProfile(friend)}
                          className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/85 hover:text-white border border-white/15 backdrop-blur-md text-[11px] font-semibold active:scale-95 transition-all cursor-pointer"
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRemoveFriendAction(friend.userId, friend.username)}
                          className="px-3 py-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 hover:text-white border border-rose-400/50 backdrop-blur-xl shadow-[0_4px_14px_rgba(244,63,94,0.22),inset_0_1px_0_rgba(255,255,255,0.18)] text-[11px] font-bold active:scale-95 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                          title="Remove friend"
                        >
                          {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL: CREATE NEW TIER LIST (PERSONAL vs COLLABORATIVE)        */}
      {/* ------------------------------------------------------------- */}
      {showNewTierModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn"
          onClick={() => setShowNewTierModal(false)}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl p-5 sm:p-6 bg-[#0a0e17] border border-white/20 shadow-2xl space-y-4 relative"
          >
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Layers className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Create Tier List Studio</h3>
              </div>
              <button
                onClick={() => setShowNewTierModal(false)}
                className="p-1.5 text-white/50 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Title Input */}
            <div>
              <label className="text-[11px] font-semibold text-white/60 block mb-1.5">
                Tier List Title
              </label>
              <input
                type="text"
                value={newTierTitle}
                onChange={(e) => setNewTierTitle(e.target.value)}
                placeholder="e.g. 2026 Hip-Hop Album Rankings"
                className="w-full px-3.5 py-2.5 rounded-2xl bg-white/[0.05] border border-white/15 text-white text-xs placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
              />
            </div>

            {/* Personal vs Collaborative Toggle */}
            <div>
              <label className="text-[11px] font-semibold text-white/60 block mb-1.5">
                Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewTierCollab(false)}
                  className={`p-3 rounded-2xl text-left border transition-all ${
                    !isNewTierCollab 
                      ? 'bg-white/15 border-white/40 text-white shadow-md' 
                      : 'bg-white/[0.03] border-white/10 text-white/50 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="text-xs font-bold text-white">Personal</div>
                  <div className="text-[10px] text-white/40 mt-0.5">Your private studio</div>
                </button>

                <button
                  type="button"
                  onClick={() => setIsNewTierCollab(true)}
                  className={`p-3 rounded-2xl text-left border transition-all ${
                    isNewTierCollab 
                      ? 'bg-pink-500/20 border-pink-500/50 text-white shadow-md' 
                      : 'bg-white/[0.03] border-white/10 text-white/50 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="text-xs font-bold text-pink-300">Collaborative</div>
                  <div className="text-[10px] text-white/40 mt-0.5">Sync in real time</div>
                </button>
              </div>
            </div>

            {/* Friend Picker (if Collaborative) */}
            {isNewTierCollab && (
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-white/60 block">
                  Select Friends to Collaborate With
                </label>
                {friendProfiles.length === 0 ? (
                  <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-white/40">
                    Add friends first to invite them to collaborative tier lists!
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto no-scrollbar">
                    {friendProfiles.map((f) => {
                      const isSelected = selectedCollabFriends.includes(f.username);
                      return (
                        <div
                          key={f.userId}
                          onClick={() => {
                            setSelectedCollabFriends(prev => 
                              isSelected ? prev.filter(u => u !== f.username) : [...prev, f.username]
                            );
                          }}
                          className={`p-2.5 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                            isSelected ? 'bg-pink-500/15 border-pink-500/40 text-white' : 'bg-white/[0.03] border-white/5 text-white/70'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <InitialAvatar name={f.displayName || f.username} size="xs" />
                            <div className="min-w-0 text-xs font-bold truncate">
                              {f.displayName} (@{f.username})
                            </div>
                          </div>
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'bg-pink-500 border-pink-400 text-white' : 'border-white/20'
                          }`}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Create Action Button */}
            <button
              type="button"
              disabled={isCreatingTier || !newTierTitle.trim()}
              onClick={handleCreateNewTierList}
              className="w-full py-3 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 cursor-pointer"
            >
              {isCreatingTier ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-black" />
              )}
              <span>Create Tier List Studio</span>
            </button>
          </div>
        </div>
      )}

      {/* SHARE SONG MODAL */}
      <ShareSongModal
        isOpen={isShareSongOpen}
        onClose={() => setIsShareSongOpen(false)}
        defaultTrack={currentTrack}
        friends={friendProfiles}
        preselectedFriendUsername={shareTargetUsername}
        recentTracks={playlists.flatMap(p => p.tracks || []).slice(0, 10)}
        currentUser={currentUser}
        dominantColor={dominantColor}
        onShareSent={handleShowToast}
      />

      {/* SHARE PLAYLIST MODAL */}
      <SharePlaylistModal
        isOpen={isSharePlaylistOpen}
        onClose={() => setIsSharePlaylistOpen(false)}
        playlists={playlists}
        friends={friendProfiles}
        currentUser={currentUser}
        dominantColor={dominantColor}
        onShareSent={handleShowToast}
      />
    </div>
  );
};
