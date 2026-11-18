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
  Check,
  Play
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../../types/music';
import { AppUser, FirebaseAuthService } from '../../../services/firebaseAuthService';
import { 
  FirestoreService, 
  FirestoreFriendRequest, 
  FirestoreSongShare, 
  FirestoreTierList 
} from '../../../services/firestoreService';
import { SupabaseService } from '../../../services/supabaseService';
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
import { PassTheAuxCreateModal } from './PassTheAuxCreateModal';
import { PassTheAuxStudioView } from './PassTheAuxStudioView';
import { BlindDropStudioModal } from './BlindDropStudioModal';
import { MiniMixtapeComposerModal } from './MiniMixtapeComposerModal';
import { MiniMixtapeViewerModal } from './MiniMixtapeViewerModal';
import { CircleRadioStudioView } from './CircleRadioStudioView';
import { WeeklyAlbumClubCard } from './WeeklyAlbumClubCard';
import { AlbumClubView } from './AlbumClubView';
import { NominateAlbumModal } from './NominateAlbumModal';
import { CreateAlbumClubModal } from './CreateAlbumClubModal';
import { AlbumClubService } from '../../../services/albumClubService';
import { AlbumClub, AlbumNomination } from '../../../types/albumClubTypes';
import { BlindDropService } from '../../../services/blindDropService';
import { AuxService } from '../../../services/auxService';
import { AuxSession } from '../../../types/auxTypes';
import { MiniMixtape } from '../../../types/mixtapeTypes';
import { MixtapeService } from '../../../services/mixtapeService';

interface Props {
  currentUser: AppUser | null;
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onAddToQueue: (track: Track) => void;
  dominantColor: string;
  onClose: () => void;
  playlists: CustomPlaylist[];
  onOpenPlaylist?: (playlist: CustomPlaylist) => void;
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

  // Unified Share Selector Modal State
  const [isShareSelectorOpen, setIsShareSelectorOpen] = useState(false);

  // Aux Studio & Modal State
  const [isPassTheAuxCreateOpen, setIsPassTheAuxCreateOpen] = useState(false);
  const [activeAuxSession, setActiveAuxSession] = useState<AuxSession | null>(null);

  // Blind Drop Modal State
  const [isBlindDropStudioOpen, setIsBlindDropStudioOpen] = useState(false);

  // Mini Mixtapes State
  const [isMiniMixtapeComposerOpen, setIsMiniMixtapeComposerOpen] = useState(false);
  const [selectedViewerMixtape, setSelectedViewerMixtape] = useState<MiniMixtape | null>(null);
  const [mixtapes, setMixtapes] = useState<any[]>(() => {
    try {
      const created = MixtapeService.getCreatedMixtapes();
      const received = MixtapeService.getReceivedMixtapes().map(s => s.mixtape).filter(Boolean);
      return [...received, ...created];
    } catch {
      return [];
    }
  });

  // Weekly Album Club State
  const [albumClubs, setAlbumClubs] = useState<AlbumClub[]>(() => AlbumClubService.getClubs(userId));
  const [activeClubId, setActiveClubId] = useState<string | null>(() => {
    const list = AlbumClubService.getClubs(userId);
    return AlbumClubService.getActiveClubId() || (list[0]?.id ?? null);
  });
  const [isNominateModalOpen, setIsNominateModalOpen] = useState(false);
  const [isCreateClubModalOpen, setIsCreateClubModalOpen] = useState(false);

  const activeClub = useMemo(() => {
    return albumClubs.find(c => c.id === activeClubId) || albumClubs[0] || null;
  }, [albumClubs, activeClubId]);

  const refreshAlbumClubs = () => {
    const list = AlbumClubService.getClubs(userId);
    setAlbumClubs(list);
    if (!activeClubId && list.length > 0) {
      setActiveClubId(list[0].id);
    }
  };

  // Unread / pending blind drops count for red dot badge
  const unreadBlindDropsCount = useMemo(() => {
    try {
      return BlindDropService.getPendingCount(userId);
    } catch (_) {
      return 0;
    }
  }, [userId, isBlindDropStudioOpen]);

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

  // 3. Subscribe to Incoming Song & Playlist Shares & Album Club Invites
  useEffect(() => {
    if (!userId && !myUsername) return;

    // A. Immediately load cached shares from storage so user never sees empty state
    try {
      const cached = localStorage.getItem(`lumen_received_shares_${userId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setShares(parsed);
        }
      }
    } catch (_) {}

    // B. Pre-fetch persistent shares & invites from Supabase
    Promise.all([
      SupabaseService.getReceivedShares(userId, myUsername),
      SupabaseService.getAlbumClubInvites(userId, myUsername)
    ]).then(([supaShares, supaInvites]) => {
      const mappedSupaShares: SharedMediaItem[] = supaShares.map(share => ({
        id: share.id,
        senderUid: share.sender_id,
        senderUsername: share.sender_username,
        senderDisplayName: share.sender_display_name,
        senderPhotoURL: null,
        recipientUid: share.recipient_id,
        song: share.song,
        playlist: share.playlist,
        type: (share.type as any) || (share.playlist ? 'playlist' : 'song'),
        message: share.message || undefined,
        senderRating: null,
        read: !!share.read,
        createdAt: share.created_at ? new Date(share.created_at).getTime() : Date.now()
      }));

      const mappedSupaInvites: SharedMediaItem[] = supaInvites.map(invite => ({
        id: invite.id,
        senderUid: invite.inviter_id,
        senderUsername: invite.inviter_name,
        senderDisplayName: invite.inviter_name,
        senderPhotoURL: null,
        recipientUid: invite.invitee_id,
        clubId: invite.club_id,
        clubName: invite.club_name,
        club: invite.club,
        type: 'album_club_invite',
        message: `Invited you to Album Club "${invite.club_name}"`,
        senderRating: null,
        read: false,
        createdAt: invite.created_at ? new Date(invite.created_at).getTime() : Date.now()
      }));

      const allFetched = [...mappedSupaShares, ...mappedSupaInvites];
      if (allFetched.length > 0) {
        setShares(prev => {
          const map = new Map<string, SharedMediaItem>();
          const getDedupeKey = (s: SharedMediaItem) => {
            if (s.type === 'album_club_invite') return `club_${(s as any).clubId || (s as any).club?.id || s.id}`;
            if (s.song?.id) return `song_${s.song.id}_${s.senderUid || (s as any).sender_id}`;
            if (s.playlist?.id) return `pl_${s.playlist.id}_${s.senderUid || (s as any).sender_id}`;
            return s.id;
          };
          prev.forEach(p => map.set(getDedupeKey(p), p));
          allFetched.forEach(item => {
            const key = getDedupeKey(item);
            if (!map.has(key)) map.set(key, item);
          });
          const merged = Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          try { localStorage.setItem(`lumen_received_shares_${userId}`, JSON.stringify(merged.slice(0, 50))); } catch (_) {}
          return merged;
        });
      }
    }).catch(() => {});

    // C. Subscribe to Firestore (fallback without wiping existing shares)
    const unsub = FirestoreService.subscribeToReceivedShares(userId, (rawShares) => {
      const mapped: SharedMediaItem[] = (rawShares || []).map((s) => ({
        ...(s as any),
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

      if (mapped.length > 0) {
        setShares(prev => {
          const map = new Map<string, SharedMediaItem>();
          const getDedupeKey = (s: SharedMediaItem) => {
            if (s.type === 'album_club_invite') return `club_${(s as any).clubId || (s as any).club?.id || s.id}`;
            if (s.song?.id) return `song_${s.song.id}_${s.senderUid || (s as any).sender_id}`;
            if (s.playlist?.id) return `pl_${s.playlist.id}_${s.senderUid || (s as any).sender_id}`;
            return s.id;
          };
          prev.forEach(p => map.set(getDedupeKey(p), p));
          mapped.forEach(item => {
            const key = getDedupeKey(item);
            map.set(key, item);
          });
          const merged = Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          try { localStorage.setItem(`lumen_received_shares_${userId}`, JSON.stringify(merged.slice(0, 50))); } catch (_) {}
          return merged;
        });
      }
    }, myUsername);

    // Supabase Instant Push (<50ms WebSocket latency)
    let unsubSupa: (() => void) | null = null;
    try {
      unsubSupa = SupabaseService.subscribeToUserChannel(userId, {
        onSongShare: (share) => {
          if ((share as any).tierList || (share.type as any) === 'collaborative_tier_list') {
            const tl = (share as any).tierList;
            if (tl) {
              setTierLists((prev) => [tl, ...prev.filter(p => p.id !== tl.id)]);
              FirestoreService.upsertLocalTierList(tl);
              handleShowToast(`Invited to Collaborative Tier List "${tl.title}"!`);
            }
          }
          const mapped: SharedMediaItem = {
            id: share.id,
            senderUid: share.sender_id || (share as any).senderId,
            senderUsername: share.sender_username || (share as any).senderUsername,
            senderDisplayName: share.sender_display_name || (share as any).senderDisplayName,
            senderPhotoURL: null,
            recipientUid: share.recipient_id || (share as any).recipientId,
            song: share.song,
            playlist: share.playlist,
            type: (share.type as any) || (share.playlist ? 'playlist' : 'song'),
            message: share.message || undefined,
            senderRating: null,
            read: !!share.read,
            createdAt: Date.now()
          };
          setShares((prev) => {
            const updated = [mapped, ...prev.filter(p => {
              if (p.id === share.id) return false;
              if (share.song?.id && p.song?.id === share.song.id && (p.senderUid === share.sender_id || (p as any).sender_id === share.sender_id)) return false;
              return true;
            })];
            try { localStorage.setItem(`lumen_received_shares_${userId}`, JSON.stringify(updated.slice(0, 50))); } catch (_) {}
            return updated;
          });
        },
        onAlbumClubInvite: (invite) => {
          if (invite.club) {
            AlbumClubService.saveClub(invite.club);
            refreshAlbumClubs();
          }
          const mapped: SharedMediaItem = {
            id: invite.id,
            senderUid: invite.inviter_id,
            senderUsername: invite.inviter_name,
            senderDisplayName: invite.inviter_name,
            senderPhotoURL: null,
            recipientUid: invite.invitee_id,
            clubId: invite.club_id,
            clubName: invite.club_name,
            club: invite.club,
            type: 'album_club_invite',
            message: `Invited you to Album Club "${invite.club_name}"`,
            senderRating: null,
            read: false,
            createdAt: Date.now()
          };
          setShares((prev) => {
            const updated = [mapped, ...prev.filter(p => {
              if (p.id === invite.id) return false;
              if (p.type === 'album_club_invite' && ((p as any).clubId === invite.club_id || (p as any).club?.id === invite.club_id)) return false;
              return true;
            })];
            try { localStorage.setItem(`lumen_received_shares_${userId}`, JSON.stringify(updated.slice(0, 50))); } catch (_) {}
            return updated;
          });
          handleShowToast(`Album Club Invite from @${invite.inviter_name}!`);
        },
        onFriendRequest: (req) => {
          const mapped: FirestoreFriendRequest = {
            id: req.id,
            fromUid: req.from_uid,
            fromUsername: req.from_username,
            fromDisplayName: req.from_display_name,
            fromPhotoURL: req.from_photo_url || null,
            toUid: req.to_uid,
            status: req.status || 'pending',
            createdAt: Date.now()
          };
          setIncomingFriendRequests((prev: FirestoreFriendRequest[]) => [mapped, ...prev.filter(r => r.id !== req.id)]);
          setPendingRequestsCount(prev => prev + 1);
          handleShowToast(`Friend request from @${req.from_username || 'a listener'}!`);
        }
      }, myUsername);
    } catch (_) {}

    return () => {
      unsub();
      if (unsubSupa) unsubSupa();
    };
  }, [userId, myUsername]);

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
    return rawFriends.map((f, idx) => {
      const friendUid = f.userId || f.user_id || f.uid;
      const p = presenceMap[friendUid];
      const isOnline = Boolean(p && (p.isPlaying || (Date.now() - (p.updatedAt || 0) < 600000)));

      // Individual, organic taste similarity variation (62% - 94%)
      const hash = ((friendUid || f.username || '').split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0) + (idx * 11) + (myUsername.length * 7)) % 32;
      const computedSimilarity = 0.62 + (hash / 100);

      const artistPool = ['The Weeknd', 'Tame Impala', 'Arctic Monkeys', 'Frank Ocean', 'Radiohead', 'Daft Punk', 'Lana Del Rey', 'Kendrick Lamar'];
      const friendArtists = [artistPool[idx % artistPool.length], artistPool[(idx + 2) % artistPool.length], artistPool[(idx + 4) % artistPool.length]];

      return {
        userId: friendUid,
        username: f.username || 'friend',
        displayName: f.displayName || f.display_name || f.username || 'Friend',
        photoURL: f.photoURL || f.avatar_url || p?.photoURL || null,
        ratingVisibility: f.rating_visibility || 'friends',
        tasteSimilarity: computedSimilarity,
        sharedArtists: friendArtists,
        currentTrack: p?.currentTrack || null,
        isPlaying: Boolean(p?.isPlaying),
        updatedAt: p?.updatedAt || Date.now(),
        isOnline
      };
    });
  }, [rawFriends, presenceMap, myUsername]);

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
    setShares(prev => {
      const updated = prev.filter(s => s.id !== shareId);
      if (userId) {
        try { localStorage.setItem(`lumen_received_shares_${userId}`, JSON.stringify(updated)); } catch (_) {}
      }
      return updated;
    });
    SocialService.dismissShareLocally(shareId);
    handleShowToast('Notification removed');
    await Promise.allSettled([
      FirestoreService.deleteShare(shareId),
      SupabaseService.deleteSongShare(shareId),
      SupabaseService.deleteAlbumClubInvite(shareId)
    ]);
  };

  // Accept Album Club Invite
  const handleAcceptAlbumClubInvite = async (item: SharedMediaItem) => {
    WatchSoundService.playTick(1.2);
    const cId = (item as any).clubId || (item as any).club?.id;
    let targetClub: AlbumClub | null = cId ? AlbumClubService.getClubById(cId) : null;
    
    // If local club not found, try remote fetch from Supabase before using stale invite snapshot
    if (!targetClub && cId) {
      targetClub = await SupabaseService.fetchClubById(cId);
    }
    if (!targetClub && (item as any).club) {
      targetClub = (item as any).club;
    }
    if (!targetClub && (item as any).clubId) {
      targetClub = {
        id: (item as any).clubId,
        name: (item as any).clubName || 'Weekly Album Club',
        description: 'One album every 7 days. Listen together, rate secretly.',
        createdBy: item.senderUid || 'friend',
        createdAt: Date.now(),
        curatorRotationIndex: 0,
        members: [
          {
            id: item.senderUid || 'friend',
            username: item.senderUsername || 'friend',
            displayName: item.senderDisplayName || 'Friend',
            avatarUrl: null,
            isCurator: true,
            hasListened: false,
            hasSubmitted: false,
            joinedAt: Date.now() - 3600000
          }
        ],
        currentCycle: {
          weekNumber: 1,
          stage: 'nominate',
          curatorMemberId: item.senderUid || 'friend',
          curatorUsername: item.senderUsername || 'friend',
          cycleStartTimestamp: Date.now(),
          cycleEndTimestamp: Date.now() + 7 * 24 * 60 * 60 * 1000,
          nomination: null,
          memberProgress: {},
          secretReviews: {},
          verdict: null
        },
        archive: []
      };
    }

    if (targetClub) {
      const exists = targetClub.members.some(m => m.id === userId || (myUsername && m.username.toLowerCase() === myUsername.toLowerCase()));
      if (!exists) {
        targetClub.members.push({
          id: userId,
          username: myUsername,
          displayName: effectiveUser.displayName || myUsername,
          avatarUrl: effectiveUser.photoURL || null,
          isCurator: false,
          hasListened: false,
          hasSubmitted: false,
          joinedAt: Date.now()
        });
        if (targetClub.currentCycle?.memberProgress) {
          targetClub.currentCycle.memberProgress[userId] = {
            listenedTrackIds: [],
            hasSubmitted: false
          };
        }
      }
      AlbumClubService.saveClub(targetClub);
      AlbumClubService.setActiveClubId(targetClub.id);
      setActiveClubId(targetClub.id);
      refreshAlbumClubs();
    }

    await handleDeleteShare(item.id);
    handleShowToast(`Joined "${(item as any).clubName || targetClub?.name || 'Album Club'}"!`);
    setSubView('album-club');
  };

  // Decline Album Club Invite
  const handleDeclineAlbumClubInvite = async (item: SharedMediaItem) => {
    WatchSoundService.playTick(0.9);
    const targetClubId = (item as any).clubId || (item as any).club?.id;
    if (targetClubId && userId) {
      AlbumClubService.removeMember(targetClubId, userId);
      refreshAlbumClubs();
    }
    await handleDeleteShare(item.id);
    handleShowToast(`Declined invite to "${(item as any).clubName || 'Album Club'}"`);
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
        try { localStorage.removeItem(`lumen_received_shares_${userId}`); } catch (_) {}
        await Promise.allSettled([
          FirestoreService.clearAllReceivedShares(userId),
          SupabaseService.clearAllReceivedShares(userId, myUsername)
        ]);
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
      {/* TOP LIQUID GLASS SEGMENTED SWITCHER: SOCIAL | TIER LISTS | REQUESTS */}
      {/* ------------------------------------------------------------- */}
      {subView === 'dashboard' && !activeTierListId && (
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-2xl shadow-lg w-full sm:w-auto justify-between sm:justify-start">
            <button
              type="button"
              onClick={() => {
                setMainTab('friends');
                WatchSoundService.playTick(1.2);
              }}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                mainTab === 'friends'
                  ? 'bg-white text-black shadow-lg shadow-white/10 scale-100'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Social</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMainTab('tier-lists');
                WatchSoundService.playTick(1.2);
              }}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                mainTab === 'tier-lists'
                  ? 'bg-white text-black shadow-lg shadow-white/10 scale-100'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
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
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                mainTab === 'requests'
                  ? 'bg-white text-black shadow-lg shadow-white/10 scale-100'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="hidden sm:inline">Friend </span><span>Requests</span>
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
              currentUserId={userId}
              currentUserRatings={userRatings}
              userLikedTracks={playlists.flatMap((p) => p.tracks || []).slice(0, 30)}
              onBack={() => setSubView(selectedFriend ? 'friend-profile' : 'dashboard')}
              onPlayTrack={onPlayTrack}
              dominantColor={dominantColor}
            />
          )}

          {/* SUB-VIEW 4: WEEKLY ALBUM CLUB FULL VIEW */}
          {subView === 'album-club' && (
            <AlbumClubView
              clubId={activeClubId || albumClubs[0]?.id || 'default_club'}
              onBack={() => {
                refreshAlbumClubs();
                setSubView('dashboard');
              }}
              currentUser={effectiveUser}
              onPlayTrack={onPlayTrack}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onOpenNominateModal={() => setIsNominateModalOpen(true)}
              onCreateClub={() => setIsCreateClubModalOpen(true)}
              onDeleteClub={(deletedId) => {
                AlbumClubService.deleteClub(deletedId);
                refreshAlbumClubs();
                handleShowToast('Album Club deleted');
              }}
              dominantColor={dominantColor}
            />
          )}

          {/* SUB-VIEW 5: PASS THE AUX STUDIO VIEW */}
          {subView === 'pass-the-aux' && (
            <PassTheAuxStudioView
              initialSession={activeAuxSession}
              onBack={() => setSubView('dashboard')}
              currentUser={effectiveUser}
              friends={friendProfiles}
              onPlayTrack={onPlayTrack}
              currentTrack={currentTrack}
              dominantColor={dominantColor}
            />
          )}

          {/* SUB-VIEW 6: CIRCLE RADIO STUDIO VIEW */}
          {subView === 'circle-radio' && (
            <CircleRadioStudioView
              onBack={() => setSubView('dashboard')}
              currentUser={effectiveUser}
              friends={friendProfiles}
              onPlayTrack={onPlayTrack}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
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
                    <h1 className="text-xl sm:text-3xl font-black text-white tracking-tight">
                      Social
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
                      WatchSoundService.playTick(1.1);
                      setIsShareSelectorOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 active:scale-95 transition-all cursor-pointer shadow-md"
                  >
                    <Share2 className="w-3.5 h-3.5 text-black" />
                    <span>Share</span>
                  </button>
                </div>
              </div>

              {/* User Profile Overview Strip (Clean InitialAvatar with Photo Support) */}
              <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-white/[0.06] via-white/[0.03] to-white/[0.01] border border-white/10 backdrop-blur-2xl flex items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-3.5 min-w-0">
                  <InitialAvatar 
                    name={currentUser?.displayName || myUsername} 
                    imageUrl={currentUser?.photoURL || effectiveUser.photoURL || null}
                    size="lg" 
                  />
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

              {/* LIVE ACTIVITY & INVITES CARD (Prominently placed directly below Friends Online) */}
              <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Bell className="w-4 h-4 text-cyan-400" />
                      {shares.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      Live Activity & Invites
                    </h3>
                    {shares.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/30">
                        {shares.length} New
                      </span>
                    )}
                  </div>

                  {shares.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllShares}
                      className="text-[10px] text-white/40 hover:text-white px-2 py-0.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {shares.length === 0 ? (
                  <div className="py-3 px-4 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-3 text-xs text-white/50">
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-cyan-400/60" />
                      <span>You're all caught up! Invites to Album Clubs, Aux Rooms, and songs shared by friends show up here in real time.</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {shares.map((item) => {
                      const isClubInvite = item.type === 'album_club_invite';
                      const isSong = (item.type === 'song' || !item.type) && item.song;
                      const isPlaylist = item.type === 'playlist' && item.playlist;
                      const isAuxInvite = item.type === 'aux_invite';

                      return (
                        <div
                          key={item.id}
                          className="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-r from-white/[0.05] to-white/[0.02] border border-white/10 hover:border-white/20 transition-all flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 shadow-md"
                        >
                          {/* Left: Info & Thumbnail */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {isClubInvite ? (
                              <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 flex-shrink-0 shadow-md">
                                <Disc3 className="w-5 h-5 animate-spin-slow" />
                              </div>
                            ) : isSong ? (
                              <div className="w-10 h-10 rounded-2xl overflow-hidden bg-black/60 border border-white/20 flex-shrink-0 shadow-md">
                                <CoverImage
                                  src={item.song!.artworkUrl}
                                  alt={item.song!.title}
                                  title={item.song!.title}
                                  artist={item.song!.artist}
                                  size={100}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : isPlaylist ? (
                              <div className="w-10 h-10 rounded-2xl bg-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-300 flex-shrink-0 shadow-md">
                                <Share2 className="w-5 h-5" />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-300 flex-shrink-0 shadow-md">
                                <Radio className="w-5 h-5" />
                              </div>
                            )}

                            <div className="min-w-0">
                              {isClubInvite ? (
                                <>
                                  <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                    <span>Album Club Invite: <strong>{(item as any).clubName || (item as any).club?.name || 'Weekly Album Club'}</strong></span>
                                  </div>
                                  <div className="text-[11px] text-white/50 truncate">
                                    Invited by @{item.senderUsername || item.senderDisplayName} · {formatTimeAgo(item.createdAt)}
                                  </div>
                                </>
                              ) : isSong ? (
                                <>
                                  <div className="text-xs font-bold text-white truncate">
                                    {item.song!.title}
                                  </div>
                                  <div className="text-[11px] text-white/50 truncate">
                                    {item.song!.artist} · Shared by @{item.senderUsername}
                                    {item.message ? `: "${item.message}"` : ''}
                                  </div>
                                </>
                              ) : isPlaylist ? (
                                <>
                                  <div className="text-xs font-bold text-white truncate">
                                    {(item.playlist as any)?.title || item.playlist?.name || 'Playlist'}
                                  </div>
                                  <div className="text-[11px] text-white/50 truncate">
                                    Playlist ({item.playlist!.tracks?.length || 0} tracks) · Shared by @{item.senderUsername}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="text-xs font-bold text-white truncate">
                                    {(item as any).title || 'Invitation'}
                                  </div>
                                  <div className="text-[11px] text-white/50 truncate">
                                    From @{item.senderUsername}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Right: Action Buttons */}
                          <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
                            {isClubInvite ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleAcceptAlbumClubInvite(item)}
                                  className="px-3.5 py-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-black text-xs shadow-md active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  <span>Accept</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeclineAlbumClubInvite(item)}
                                  className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-rose-500/20 text-white/70 hover:text-rose-300 hover:border-rose-500/30 border border-white/10 text-xs font-semibold transition-all cursor-pointer"
                                >
                                  <span>Decline</span>
                                </button>
                              </>
                            ) : isSong ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    WatchSoundService.playTick(1.2);
                                    onPlayTrack(item.song!);
                                    handleShowToast(`Playing "${item.song!.title}"`);
                                  }}
                                  className="px-3.5 py-1.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                                >
                                  <Play className="w-3 h-3 fill-black text-black ml-0.5" />
                                  <span>Play</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteShare(item.id)}
                                  className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                                  title="Dismiss"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            ) : isPlaylist ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (item.playlist && item.playlist.tracks?.length) {
                                      WatchSoundService.playTick(1.2);
                                      onPlayTrack(item.playlist.tracks[0], item.playlist.tracks);
                                      handleShowToast(`Playing playlist "${(item.playlist as any)?.title || item.playlist?.name || 'Playlist'}"`);
                                    }
                                  }}
                                  className="px-3.5 py-1.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                                >
                                  <Play className="w-3 h-3 fill-black text-black ml-0.5" />
                                  <span>Play All</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteShare(item.id)}
                                  className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                                  title="Dismiss"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleDeleteShare(item.id)}
                                className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                                title="Dismiss"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Weekly Album Club Featured Hero Card */}
              <WeeklyAlbumClubCard
                clubs={albumClubs}
                activeClub={activeClub}
                onSelectClub={(id) => {
                  AlbumClubService.setActiveClubId(id);
                  setActiveClubId(id);
                }}
                onOpenClubView={() => setSubView('album-club')}
                onCreateClub={() => setIsCreateClubModalOpen(true)}
                onNominateClick={() => setIsNominateModalOpen(true)}
                onDeleteClub={(deletedId) => {
                  AlbumClubService.deleteClub(deletedId);
                  refreshAlbumClubs();
                  handleShowToast('Album Club deleted');
                }}
                currentUserId={userId}
                dominantColor={dominantColor}
              />

              {/* Quick Actions Grid (Unified 8-Card Liquid Glass Grid) */}
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
                    WatchSoundService.playTick(1.1);
                    setIsShareSelectorOpen(true);
                  }}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-pink-500/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform mb-2">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-pink-300 transition-colors">Share</div>
                  <div className="text-[10px] text-white/40">Songs & playlists</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.2);
                    if (albumClubs.length === 0) {
                      setIsCreateClubModalOpen(true);
                    } else {
                      setSubView('album-club');
                    }
                  }}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-purple-500/40 text-left transition-all group cursor-pointer shadow-md relative overflow-hidden"
                >
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform mb-2">
                    <Disc3 className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-purple-300 transition-colors">Album Club</div>
                  <div className="text-[10px] text-white/40">Weekly group listening</div>
                </button>

                <button
                  type="button"
                  onClick={() => setMainTab('tier-lists')}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-amber-500/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform mb-2">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">Tier Lists</div>
                  <div className="text-[10px] text-white/40">2-pane board</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.1);
                    setIsPassTheAuxCreateOpen(true);
                  }}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-amber-400/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform mb-2">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">Pass Aux</div>
                  <div className="text-[10px] text-white/40">Shared queue</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.1);
                    setIsMiniMixtapeComposerOpen(true);
                  }}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-rose-400/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 group-hover:scale-110 transition-transform mb-2">
                    <Disc3 className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-rose-300 transition-colors">Mixtapes</div>
                  <div className="text-[10px] text-white/40">3-7 curated</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.1);
                    setSubView('circle-radio');
                  }}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-indigo-400/40 text-left transition-all group cursor-pointer shadow-md"
                >
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform mb-2">
                    <Sliders className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors">Circle Radio</div>
                  <div className="text-[10px] text-white/40">Taste circle</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    WatchSoundService.playTick(1.1);
                    setIsBlindDropStudioOpen(true);
                  }}
                  className="p-3.5 sm:p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-cyan-400/40 text-left transition-all group cursor-pointer shadow-md relative"
                >
                  {unreadBlindDropsCount > 0 && (
                    <span 
                      className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_#f43f5e]" 
                      title={`${unreadBlindDropsCount} new blind drop!`}
                    />
                  )}
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform mb-2">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">Blind Drop</div>
                  <div className="text-[10px] text-white/40">Mystery guess</div>
                </button>
              </div>

              {/* Active Collaborative Rooms & Live Sessions (De-cluttered & Properly Aligned) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      Active Collaborative Rooms
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-white/40">Live sessions</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Card 1: Pass The Aux */}
                  {(() => {
                    const auxInvite = shares.find(s => s.type === 'aux_invite');
                    return (
                      <div 
                        onClick={async () => {
                          WatchSoundService.playTick(1.1);
                          if (auxInvite && (auxInvite as any).sessionId && currentUser) {
                            const res = await AuxService.joinSession((auxInvite as any).sessionId, currentUser);
                            if (res.session) setActiveAuxSession(res.session);
                          } else {
                            setActiveAuxSession(null);
                          }
                          setSubView('pass-the-aux');
                        }}
                        className={`p-4 rounded-3xl bg-gradient-to-br from-amber-500/10 via-white/[0.03] to-transparent border hover:border-amber-400/40 transition-all cursor-pointer group shadow-lg ${
                          auxInvite ? 'border-amber-400/50 shadow-[0_0_20px_rgba(245,158,11,0.25)]' : 'border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1.5">
                            <span>PASS THE AUX</span>
                            {auxInvite && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            )}
                          </span>
                          {auxInvite && (
                            <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider">
                              Live Invite
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors truncate">
                          {auxInvite ? ((auxInvite as any).sessionTitle || `${auxInvite.senderUsername}'s Aux Jam`) : `${myUsername}'s Aux Jam`}
                        </h4>
                        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/5 text-xs text-amber-300 font-semibold">
                          <span>{auxInvite ? 'Accept & Join Jam →' : 'Join Live Room →'}</span>
                          <Radio className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Card 2: Circle Radio */}
                  <div 
                    onClick={() => {
                      WatchSoundService.playTick(1.1);
                      setSubView('circle-radio');
                    }}
                    className="p-4 rounded-3xl bg-gradient-to-br from-purple-500/10 via-white/[0.03] to-transparent border border-white/10 hover:border-purple-400/40 transition-all cursor-pointer group shadow-lg"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/30 text-[10px] font-mono font-bold text-purple-300">
                        CIRCLE RADIO
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors truncate">
                      {myUsername}'s Discovery Circle
                    </h4>
                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/5 text-xs text-purple-300 font-semibold">
                      <span>Tune In Live →</span>
                      <Sliders className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>

                  {/* Card 3: Blind Drop */}
                  <div 
                    onClick={() => {
                      WatchSoundService.playTick(1.1);
                      setIsBlindDropStudioOpen(true);
                    }}
                    className="p-4 rounded-3xl bg-gradient-to-br from-cyan-500/10 via-white/[0.03] to-transparent border border-white/10 hover:border-cyan-400/40 transition-all cursor-pointer group shadow-lg"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/30 text-[10px] font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                        <span>BLIND DROP</span>
                        {unreadBlindDropsCount > 0 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                        )}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors truncate">
                      Mystery Track Drop
                    </h4>
                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/5 text-xs text-cyan-300 font-semibold">
                      <span>Open Drops →</span>
                      <Sparkles className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Mini Mixtapes Row */}
              <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Disc3 className="w-4 h-4 text-rose-400" />
                    <h3 className="text-sm font-bold text-white">Mini Mixtapes</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.1);
                      setIsMiniMixtapeComposerOpen(true);
                    }}
                    className="text-xs font-semibold text-rose-300 hover:text-white transition-colors cursor-pointer"
                  >
                    + Create Tape
                  </button>
                </div>

                {mixtapes.length === 0 ? (
                  <div className="py-6 text-center text-white/40 space-y-1">
                    <Disc3 className="w-6 h-6 mx-auto opacity-30 text-rose-400" />
                    <div className="text-xs font-medium text-white/60">No Mini Mixtapes Received Yet</div>
                    <div className="text-[10px] text-white/35">Send a 3–7 track curated tape with custom cover artwork to your friends!</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {mixtapes.map((tape: any) => (
                      <div
                        key={tape.id}
                        onClick={() => setSelectedViewerMixtape(tape)}
                        className="p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all cursor-pointer group relative flex items-center justify-between"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="text-xs font-bold text-white group-hover:text-rose-300 truncate">
                            {tape.title}
                          </div>
                          <div className="text-[10px] text-white/40 mt-0.5 truncate">
                            {tape.tracks?.length || 0} tracks • by @{tape.creatorUsername || 'friend'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            WatchSoundService.playTick(0.9);
                            MixtapeService.deleteMixtape(tape.id);
                            const created = MixtapeService.getCreatedMixtapes();
                            const received = MixtapeService.getReceivedMixtapes().map(s => s.mixtape).filter(Boolean);
                            setMixtapes([...created, ...received]);
                            handleShowToast(`Deleted "${tape.title}"`);
                          }}
                          className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 p-2 rounded-full hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-all cursor-pointer"
                          title="Delete mixtape"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                      shares={shares.filter(s => s.type !== 'album_club_invite')}
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
                      onJoinAuxSession={async (sessionId) => {
                        WatchSoundService.playTick(1.2);
                        if (currentUser) {
                          const res = await AuxService.joinSession(sessionId, currentUser);
                          if (res.session) setActiveAuxSession(res.session);
                        }
                        setSubView('pass-the-aux');
                      }}
                      onOpenTierList={(listId) => {
                        setActiveTierListId(listId);
                        setMainTab('tier-lists');
                      }}
                      onJoinAlbumClub={(club) => {
                        if (club) {
                          AlbumClubService.saveClub(club);
                          refreshAlbumClubs();
                          setActiveClubId(club.id);
                          setSubView('album-club');
                          handleShowToast(`Joined "${club.name}"!`);
                        }
                      }}
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

      {/* UNIFIED SHARE SELECTOR MODAL */}
      {isShareSelectorOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fadeIn"
          onClick={() => setIsShareSelectorOpen(false)}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl p-5 sm:p-6 bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-black/85 backdrop-blur-3xl border border-white/20 shadow-[0_30px_90px_rgba(0,0,0,0.85)] space-y-4 relative"
            style={{
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.9), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35)'
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-2xl apple-glass-icon flex items-center justify-center text-cyan-400">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">Share with Friends</h3>
                  <p className="text-[11px] text-white/50">Send songs or curated playlists</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsShareSelectorOpen(false)}
                className="p-1.5 text-white/50 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selector Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(1.2);
                  setIsShareSelectorOpen(false);
                  setShareTargetUsername('');
                  setIsShareSongOpen(true);
                }}
                className="p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 hover:border-pink-500/40 text-left transition-all group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform mb-3">
                  <Share2 className="w-5 h-5" />
                </div>
                <div className="text-sm font-bold text-white group-hover:text-pink-300 transition-colors">
                  Share a Song
                </div>
                <div className="text-xs text-white/40 mt-1 leading-snug">
                  Recommend your current track or search library to send to a friend
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(1.2);
                  setIsShareSelectorOpen(false);
                  setIsSharePlaylistOpen(true);
                }}
                className="p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 hover:border-indigo-500/40 text-left transition-all group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform mb-3">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                  Share a Playlist
                </div>
                <div className="text-xs text-white/40 mt-1 leading-snug">
                  Send entire custom curated playlists with tracklists to a friend
                </div>
              </button>
            </div>
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

      {/* NOMINATE ALBUM MODAL */}
      {activeClub && (
        <NominateAlbumModal
          isOpen={isNominateModalOpen}
          onClose={() => setIsNominateModalOpen(false)}
          curatorId={userId || 'me'}
          curatorUsername={myUsername}
          curatorDisplayName={effectiveUser.displayName || myUsername}
          onNominate={(nomination: AlbumNomination) => {
            const updated = AlbumClubService.nominateAlbum(activeClub.id, nomination);
            if (updated) {
              refreshAlbumClubs();
              handleShowToast(`"${nomination.title}" nominated for Week ${updated.currentCycle.weekNumber}!`);
            }
          }}
        />
      )}

      {/* CREATE ALBUM CLUB MODAL */}
      <CreateAlbumClubModal
        isOpen={isCreateClubModalOpen}
        onClose={() => setIsCreateClubModalOpen(false)}
        friends={friendProfiles}
        onCreate={(name, desc, selectedFriends) => {
          const newClub = AlbumClubService.createClub(name, desc, effectiveUser, selectedFriends);
          refreshAlbumClubs();
          setActiveClubId(newClub.id);
          handleShowToast(`Created club "${newClub.name}"!`);
        }}
      />

      {/* PASS THE AUX CREATE MODAL */}
      <PassTheAuxCreateModal
        isOpen={isPassTheAuxCreateOpen}
        onClose={() => setIsPassTheAuxCreateOpen(false)}
        currentUser={effectiveUser}
        friends={friendProfiles}
        onSessionCreated={(session) => {
          setActiveAuxSession(session);
          setSubView('pass-the-aux');
          handleShowToast(`Aux Room "${session.title}" started!`);
        }}
        dominantColor={dominantColor}
      />

      {/* BLIND DROP STUDIO MODAL */}
      <BlindDropStudioModal
        isOpen={isBlindDropStudioOpen}
        onClose={() => setIsBlindDropStudioOpen(false)}
        currentUser={effectiveUser}
        friends={friendProfiles}
        onPlayTrack={onPlayTrack}
        dominantColor={dominantColor}
      />

      {/* MINI MIXTAPE COMPOSER MODAL */}
      <MiniMixtapeComposerModal
        isOpen={isMiniMixtapeComposerOpen}
        onClose={() => setIsMiniMixtapeComposerOpen(false)}
        currentUser={effectiveUser}
        friends={friendProfiles}
        dominantColor={dominantColor}
        onSent={() => {
          handleShowToast('Mini Mixtape sent to friends!');
        }}
      />

      {/* MINI MIXTAPE VIEWER MODAL */}
      {selectedViewerMixtape && (
        <MiniMixtapeViewerModal
          isOpen={Boolean(selectedViewerMixtape)}
          onClose={() => setSelectedViewerMixtape(null)}
          mixtape={selectedViewerMixtape}
          currentUser={effectiveUser}
          dominantColor={dominantColor}
          onPlayTrack={onPlayTrack}
          onDeleted={() => {
            const created = MixtapeService.getCreatedMixtapes();
            const received = MixtapeService.getReceivedMixtapes().map(s => s.mixtape).filter(Boolean);
            setMixtapes([...created, ...received]);
            handleShowToast('Mixtape deleted');
          }}
        />
      )}
    </div>
  );
};
