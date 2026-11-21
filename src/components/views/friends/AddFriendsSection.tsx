import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Search, 
  UserPlus, 
  Check, 
  X, 
  Link2, 
  QrCode, 
  Copy, 
  CheckCircle2, 
  Loader2, 
  Sparkles, 
  Users,
  ChevronRight,
  Music2
} from 'lucide-react';
import { FirestoreService, FirestoreFriendRequest } from '../../../services/firestoreService';
import { SupabaseService } from '../../../services/supabaseService';
import { AppUser } from '../../../services/firebaseAuthService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  currentUser: AppUser | null;
  onBack: () => void;
  dominantColor: string;
}

interface MutualSuggestion {
  userId: string;
  username: string;
  displayName: string;
  mutualCount: number;
  mutualFriendName: string;
}

export const AddFriendsSection: React.FC<Props> = ({
  currentUser,
  onBack,
  dominantColor
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{
    user_id: string;
    username: string;
    display_name?: string;
    photo_url?: string | null;
    is_friend?: boolean;
    is_pending?: boolean;
    is_incoming?: boolean;
    incoming_req?: FirestoreFriendRequest;
    is_self?: boolean;
  }>>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Requests state
  const [pendingReceived, setPendingReceived] = useState<FirestoreFriendRequest[]>([]);
  const [pendingSent, setPendingSent] = useState<FirestoreFriendRequest[]>([]);
  const [myFriends, setMyFriends] = useState<any[]>([]);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [sendingMap, setSendingMap] = useState<Record<string, boolean>>({});

  // Real Mutual Friends Calculation (no static unrelated suggestions)
  const [mutualSuggestions, setMutualSuggestions] = useState<MutualSuggestion[]>([]);
  const [loadingMutuals, setLoadingMutuals] = useState(false);

  // Profile share link / QR state
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  const userId = currentUser?.uid || '';
  const storedHandle = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_user_handle') : null;
  const cleanStored = storedHandle && storedHandle.toLowerCase() !== 'listener' ? storedHandle : '';
  const myUsername = (currentUser?.username && currentUser.username.toLowerCase() !== 'listener' ? currentUser.username : '') ||
    cleanStored ||
    currentUser?.displayName?.replace(/^@/, '') ||
    currentUser?.email?.split('@')[0] ||
    'you';

  // 1. Subscribe to received friend requests (Supabase Realtime Primary + Firestore Fallback)
  useEffect(() => {
    if (!userId && !myUsername) return;
    let active = true;

    const mergeReq = (incoming: FirestoreFriendRequest[]) => {
      if (!active) return;
      setPendingReceived(prev => {
        const map = new Map<string, FirestoreFriendRequest>();
        [...prev, ...incoming].forEach(r => {
          if (r.status === 'pending') {
            const key = (r.fromUid || r.fromUsername || r.id).toLowerCase();
            map.set(key, r);
          }
        });
        return Array.from(map.values());
      });
    };

    // Instant Supabase DB load
    SupabaseService.getPendingFriendRequests(userId, myUsername).then(supaReqs => {
      const mapped: FirestoreFriendRequest[] = supaReqs.map(sr => ({
        id: sr.id,
        fromUid: sr.from_uid,
        fromUsername: sr.from_username,
        fromDisplayName: sr.from_display_name,
        toUid: sr.to_uid,
        toUsername: sr.to_username || myUsername,
        status: 'pending',
        createdAt: sr.created_at ? new Date(sr.created_at).getTime() : Date.now()
      }));
      mergeReq(mapped);
    }).catch(() => {});

    // Instant Supabase WebSocket subscription
    const unsubSupa = SupabaseService.subscribeToUserChannel(userId, {
      onFriendRequest: (sr) => {
        mergeReq([{
          id: sr.id,
          fromUid: sr.from_uid,
          fromUsername: sr.from_username,
          fromDisplayName: sr.from_display_name,
          toUid: sr.to_uid,
          toUsername: sr.to_username || myUsername,
          status: 'pending',
          createdAt: sr.created_at ? new Date(sr.created_at).getTime() : Date.now()
        }]);
      }
    }, myUsername);

    // Async Firestore fallback subscription
    const unsubFs = FirestoreService.subscribeToFriendRequests(userId, (requests) => {
      mergeReq(requests.filter(r => r.status === 'pending'));
    }, myUsername);

    return () => {
      active = false;
      unsubSupa();
      unsubFs();
    };
  }, [userId, myUsername]);

  // 2. Subscribe to outgoing sent friend requests
  useEffect(() => {
    if (!userId && !myUsername) return;
    const unsub = FirestoreService.subscribeToOutgoingFriendRequests(userId, (requests) => {
      setPendingSent(requests.filter(r => r.status === 'pending'));
    }, myUsername);
    return () => unsub();
  }, [userId, myUsername]);

  // 3. Keep my friends list updated in real time for accurate status detection
  useEffect(() => {
    if (!userId) return;
    const unsub = FirestoreService.subscribeToFriends(userId, (list) => {
      setMyFriends(list || []);
    });
    return () => unsub();
  }, [userId]);

  // Compute real mutual friends
  useEffect(() => {
    if (!userId) {
      setMutualSuggestions([]);
      return;
    }

    let isMounted = true;
    const computeMutuals = async () => {
      setLoadingMutuals(true);
      try {
        const myFriends = await FirestoreService.getFriends(userId);
        if (!myFriends || myFriends.length === 0) {
          if (isMounted) {
            setMutualSuggestions([]);
            setLoadingMutuals(false);
          }
          return;
        }

        const myFriendIds = new Set(myFriends.map((f: any) => f.user_id));
        const candidateMap = new Map<string, { username: string; displayName: string; mutuals: string[] }>();

        // Query friends of each friend (sample top 5 friends to respect Firestore usage)
        for (const friend of myFriends.slice(0, 5)) {
          const friendOfFriends = await FirestoreService.getFriends(friend.user_id);
          for (const fof of friendOfFriends) {
            if (fof.user_id === userId || myFriendIds.has(fof.user_id)) continue;
            
            const existing = candidateMap.get(fof.user_id);
            if (existing) {
              if (!existing.mutuals.includes(friend.display_name || friend.username)) {
                existing.mutuals.push(friend.display_name || friend.username);
              }
            } else {
              candidateMap.set(fof.user_id, {
                username: fof.username,
                displayName: fof.display_name || fof.username,
                mutuals: [friend.display_name || friend.username]
              });
            }
          }
        }

        if (isMounted) {
          const suggestions: MutualSuggestion[] = [];
          candidateMap.forEach((val, cid) => {
            suggestions.push({
              userId: cid,
              username: val.username,
              displayName: val.displayName,
              mutualCount: val.mutuals.length,
              mutualFriendName: val.mutuals[0]
            });
          });
          suggestions.sort((a, b) => b.mutualCount - a.mutualCount);
          setMutualSuggestions(suggestions.slice(0, 5));
        }
      } catch (e) {
        console.warn('[AddFriends] mutual computation error:', e);
      } finally {
        if (isMounted) setLoadingMutuals(false);
      }
    };

    computeMutuals();
    return () => { isMounted = false; };
  }, [userId]);

  // Live search debounced
  useEffect(() => {
    const q = searchQuery.trim().replace(/^@/, '');
    if (!q || q.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const results = await FirestoreService.searchUsersByUsername(q);
        const myFriendIds = new Set(myFriends.map((f: any) => f.userId || f.user_id || f.uid));
        const myFriendHandles = new Set(myFriends.map((f: any) => (f.username || '').toLowerCase()));
        const sentTargetIds = new Set(pendingSent.map(r => r.toUid));
        const sentTargetUsernames = new Set(pendingSent.map(r => (r.toUsername || '').toLowerCase()));

        const mapped = results.map(r => {
          const rUid = r.uid || (r as any).userId || (r as any).user_id;
          const rHandle = (r.username || '').toLowerCase();
          const isSelf = rUid === currentUser?.uid || rHandle === myUsername.toLowerCase();
          const isFriend = myFriendIds.has(rUid) || myFriendHandles.has(rHandle);
          const isPending = sentTargetIds.has(rUid) || sentTargetUsernames.has(rHandle);
          const incomingReq = pendingReceived.find(rec => rec.fromUid === rUid || (rec.fromUsername && rec.fromUsername.toLowerCase() === rHandle));

          return {
            user_id: rUid,
            username: r.username,
            display_name: r.displayName || r.username,
            photo_url: (r as any).photoURL || (r as any).photo_url || null,
            is_friend: isFriend,
            is_pending: isPending,
            is_incoming: Boolean(incomingReq),
            incoming_req: incomingReq,
            is_self: isSelf
          };
        });
        setSearchResults(mapped);
      } catch (err: any) {
        setSearchError('Search failed. Please try again.');
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, currentUser?.uid, myUsername, myFriends, pendingSent, pendingReceived]);

  const handleCancelRequest = async (targetId: string, targetUsername?: string) => {
    if (!currentUser?.uid) return;
    try {
      await FirestoreService.cancelFriendRequest(currentUser.uid, targetId);
      WatchSoundService.playTick(1.0);
      setActionStatus(targetUsername ? `Cancelled friend request to @${targetUsername}.` : 'Friend request cancelled.');
      setPendingSent(prev => prev.filter(r => r.toUid !== targetId && (!targetUsername || !r.toUsername || r.toUsername.toLowerCase() !== targetUsername.toLowerCase())));
      setSearchResults(prev => prev.map(u => 
        (u.user_id === targetId || (targetUsername && u.username.toLowerCase() === targetUsername.toLowerCase()))
          ? { ...u, is_pending: false }
          : u
      ));
    } catch (e: any) {
      setActionStatus('Could not cancel request. Try again.');
    } finally {
      setTimeout(() => setActionStatus(null), 3000);
    }
  };

  const handleRemoveFriend = async (targetId: string, targetUsername?: string) => {
    if (!currentUser?.uid) return;
    try {
      const ok = await FirestoreService.removeFriend(currentUser.uid, targetId);
      if (ok) {
        WatchSoundService.playTick(0.9);
        setActionStatus(targetUsername ? `Removed @${targetUsername} from friends.` : 'Friend removed.');
        setMyFriends(prev => prev.filter(f => (f.userId || f.user_id || f.uid) !== targetId && (!targetUsername || (f.username || '').toLowerCase() !== targetUsername.toLowerCase())));
        setSearchResults(prev => prev.map(u => 
          (u.user_id === targetId || (targetUsername && u.username.toLowerCase() === targetUsername.toLowerCase()))
            ? { ...u, is_friend: false, is_pending: false }
            : u
        ));
      } else {
        setActionStatus('Failed to remove friend from database. Check connection or sign-in state.');
      }
    } catch (e: any) {
      setActionStatus('Could not remove friend. Try again.');
    } finally {
      setTimeout(() => setActionStatus(null), 3500);
    }
  };

  const handleSendRequest = async (targetUsername: string, targetId?: string) => {
    if (!currentUser) return;
    const key = targetId || targetUsername;
    const cleanTarget = targetUsername.replace(/^@/, '').trim();

    // 1. Instant 0ms optimistic UI feedback
    WatchSoundService.playTick(1.2);
    setActionStatus(`Friend request sent to @${cleanTarget}!`);
    setSearchResults(prev => prev.map(u => 
      (u.username.toLowerCase() === cleanTarget.toLowerCase() || (targetId && u.user_id === targetId))
        ? { ...u, is_pending: true }
        : u
    ));
    setPendingSent(prev => {
      if (prev.some(r => r.toUsername?.toLowerCase() === cleanTarget.toLowerCase())) return prev;
      return [{
        id: `req_local_${Date.now()}`,
        fromUid: currentUser.uid,
        fromUsername: myUsername,
        fromDisplayName: currentUser.displayName || myUsername,
        toUid: targetId || cleanTarget,
        toUsername: cleanTarget,
        status: 'pending',
        createdAt: Date.now()
      }, ...prev];
    });

    // 2. Primary instant delivery via Supabase Realtime WebSockets (<30ms)
    SupabaseService.sendFriendRequest({
      fromUid: currentUser.uid,
      fromUsername: myUsername,
      fromDisplayName: currentUser.displayName || myUsername,
      fromPhotoURL: currentUser.photoURL || null,
      toUid: targetId || cleanTarget,
      toUsername: cleanTarget
    }).catch(err => console.warn('[AddFriends] Supabase realtime send notice:', err));

    // 3. Background async Firestore mirror (never blocks the user UI)
    FirestoreService.sendFriendRequest(
      currentUser,
      cleanTarget,
      targetId
    ).then((res) => {
      if (res.success && res.autoAccepted) {
        setActionStatus(`Connected with @${cleanTarget}!`);
        setSearchResults(prev => prev.map(u => 
          (u.username.toLowerCase() === cleanTarget.toLowerCase() || (targetId && u.user_id === targetId))
            ? { ...u, is_friend: true, is_pending: false, is_incoming: false }
            : u
        ));
      } else if (!res.success && res.error?.includes('already connected friends')) {
        setActionStatus(`You and @${cleanTarget} are already connected friends!`);
        setSearchResults(prev => prev.map(u => 
          (u.username.toLowerCase() === cleanTarget.toLowerCase() || (targetId && u.user_id === targetId))
            ? { ...u, is_friend: true, is_pending: false }
            : u
        ));
      }
    }).catch(err => console.warn('[AddFriends] Background Firestore mirror warning:', err))
      .finally(() => {
        setSendingMap(prev => ({ ...prev, [key]: false }));
        setTimeout(() => setActionStatus(null), 3500);
      });
  };

  const handleRespond = async (request: FirestoreFriendRequest, action: 'accepted' | 'declined') => {
    // 1. Instant optimistic UI update
    WatchSoundService.playTick(1.2);
    setPendingReceived(prev => prev.filter(r => r.id !== request.id && r.fromUid !== request.fromUid));
    setActionStatus(action === 'accepted' ? `Connected with @${request.fromUsername}!` : 'Request declined');

    // 2. Instant Supabase Realtime notify & update (<30ms)
    if (action === 'accepted' && currentUser) {
      SupabaseService.broadcastFriendAccepted({
        requestId: request.id,
        toUid: request.fromUid,
        toUsername: request.fromUsername,
        acceptedByUid: currentUser.uid,
        acceptedByUsername: myUsername,
        acceptedByDisplayName: currentUser.displayName || myUsername,
        acceptedByPhotoURL: currentUser.photoURL || null
      }).catch(() => {});
    } else {
      SupabaseService.deleteFriendRequest(request.id).catch(() => {});
    }

    // 3. Background Firestore persistence
    try {
      await FirestoreService.respondToFriendRequest(request, action === 'accepted');
    } catch (err: any) {
      console.warn('[AddFriends] Firestore respond sync notice:', err);
    } finally {
      setTimeout(() => setActionStatus(null), 3500);
    }
  };

  const handleCopyProfileLink = () => {
    const link = `https://lumen-player.web.app/u/${encodeURIComponent(myUsername)}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    WatchSoundService.playTick(1.2);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 animate-fadeIn">
      {/* Top Bar with Back Arrow */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/80 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
          Add Friends
        </h2>

        <div className="w-16" />
      </div>

      {/* Action Toast Alert */}
      {actionStatus && (
        <div className="p-3 rounded-2xl bg-black/90 border border-white/20 backdrop-blur-2xl text-xs text-white shadow-2xl flex items-center justify-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-lumen-cyan" />
          <span>{actionStatus}</span>
        </div>
      )}

      {/* 1. Username Search Input Bar */}
      <div className="relative w-full">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/40">
          <Search className="w-4 h-4" />
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by username..."
          className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-white/[0.05] border border-white/15 focus:border-lumen-cyan text-white text-xs sm:text-sm placeholder-white/40 focus:outline-none transition-all shadow-lg"
        />

        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute inset-y-0 right-3.5 flex items-center text-white/40 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 2. Search Results List (if query active) */}
      {searchQuery.trim().length >= 2 && (
        <div className="p-4 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
          <div className="text-[11px] font-mono text-white/50 uppercase tracking-wider">
            Search Results
          </div>

          {isSearching ? (
            <div className="py-6 flex items-center justify-center text-white/50 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-lumen-cyan" />
              <span>Searching users...</span>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="py-6 text-center text-white/40 text-xs">
              No listeners found matching "@{searchQuery.replace(/^@/, '')}".
            </div>
          ) : (
            searchResults.map((user) => {
              const isSending = Boolean(sendingMap[user.user_id] || sendingMap[user.username]);

              return (
                <div 
                  key={user.user_id} 
                  className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <InitialAvatar name={user.display_name || user.username} size="sm" />
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-bold text-white truncate">{user.display_name}</div>
                      <div className="text-[11px] text-white/50 truncate">@{user.username}</div>
                    </div>
                  </div>

                  {user.is_self ? (
                    <span className="text-[11px] font-medium text-white/40 px-3 py-1 rounded-full bg-white/5">
                      You
                    </span>
                  ) : user.is_friend ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>Friends</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveFriend(user.user_id, user.username)}
                        className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/50 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 text-[11px] font-medium active:scale-95 transition-all cursor-pointer"
                        title="Remove friend to re-test friend request"
                      >
                        Remove
                      </button>
                    </div>
                  ) : user.is_incoming ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => user.incoming_req && handleRespond(user.incoming_req, 'declined')}
                        className="px-3 py-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 hover:text-white border border-rose-400/50 backdrop-blur-xl shadow-[0_4px_16px_rgba(244,63,94,0.25)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                        title="Decline request"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Decline</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => user.incoming_req && handleRespond(user.incoming_req, 'accepted')}
                        className="px-3.5 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 hover:text-white border border-emerald-400/50 backdrop-blur-xl shadow-[0_4px_16px_rgba(16,185,129,0.25)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Accept</span>
                      </button>
                    </div>
                  ) : user.is_pending ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-cyan-400 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span>Requested</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCancelRequest(user.user_id, user.username)}
                        className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/60 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 text-[11px] font-semibold active:scale-95 transition-all cursor-pointer"
                        title="Cancel friend request"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => handleSendRequest(user.username, user.user_id)}
                      className="px-4 py-1.5 rounded-full bg-lumen-cyan text-black font-bold text-xs hover:bg-lumen-cyan/90 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                      <span>Add</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 3. Received Pending Requests (if any) */}
      {pendingReceived.length > 0 && (
        <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
              <h4 className="text-xs sm:text-sm font-bold text-white">Friend Requests</h4>
            </div>
            <span className="text-[10px] font-mono text-white/40">{pendingReceived.length} pending</span>
          </div>

          <div className="space-y-2">
            {pendingReceived.map((req) => (
              <div 
                key={req.id} 
                className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <InitialAvatar name={req.fromDisplayName || req.fromUsername} size="sm" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{req.fromDisplayName || req.fromUsername}</div>
                    <div className="text-[10px] text-white/50 truncate">@{req.fromUsername}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRespond(req, 'declined')}
                    className="px-3 py-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 hover:text-white border border-rose-400/50 backdrop-blur-xl shadow-[0_4px_16px_rgba(244,63,94,0.25)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                    title="Decline request"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Decline</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRespond(req, 'accepted')}
                    className="px-3.5 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 hover:text-white border border-emerald-400/50 backdrop-blur-xl shadow-[0_4px_16px_rgba(16,185,129,0.25)] font-bold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Accept</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3b. Sent Pending Requests (if any) */}
      {pendingSent.length > 0 && (
        <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <h4 className="text-xs sm:text-sm font-bold text-white">Sent Requests (Pending)</h4>
            </div>
            <span className="text-[10px] font-mono text-white/40">{pendingSent.length} pending</span>
          </div>

          <div className="space-y-2">
            {pendingSent.map((req) => (
              <div 
                key={req.id} 
                className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <InitialAvatar name={req.toUsername || 'Listener'} size="sm" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">@{req.toUsername}</div>
                    <div className="text-[10px] text-white/40 truncate">
                      Awaiting response
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-white/40 font-mono hidden sm:inline">Requested</span>
                  <button
                    type="button"
                    onClick={() => handleCancelRequest(req.toUid, req.toUsername)}
                    className="px-3 py-1 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/60 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                  >
                    Cancel Request
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Quick Sharing & Connect Cards (Profile Link, QR) */}
      <div className="space-y-2.5">

        {/* Share Profile Link */}
        <div 
          onClick={handleCopyProfileLink}
          className="flex items-center justify-between gap-3 p-4 rounded-2xl sm:rounded-3xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 transition-all cursor-pointer group"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform flex-shrink-0">
              <Link2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-bold text-white group-hover:text-lumen-cyan transition-colors truncate">
                Share Your Profile Link
              </div>
              <div className="text-[11px] text-white/40 truncate">@{myUsername}</div>
            </div>
          </div>
          <button 
            type="button" 
            className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium text-xs flex items-center gap-1.5 transition-all flex-shrink-0 whitespace-nowrap"
          >
            {copiedLink ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
          </button>
        </div>

        {/* Scan / Show QR Code */}
        <div 
          onClick={() => setShowQrModal(true)}
          className="flex items-center justify-between gap-3 p-4 rounded-2xl sm:rounded-3xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 transition-all cursor-pointer group"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform flex-shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-bold text-white group-hover:text-lumen-cyan transition-colors truncate">
                Scan QR Code
              </div>
              <div className="text-[11px] text-white/40 truncate">Opens directly in Lumen</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
        </div>
      </div>

      {/* 5. Suggested Friends (Calculated Mutual Friends Only) */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-lumen-cyan" />
          <h4 className="text-xs sm:text-sm font-bold text-white">Suggested Friends</h4>
        </div>

        {loadingMutuals ? (
          <div className="py-6 flex items-center justify-center text-white/40 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-lumen-cyan" />
            <span>Finding mutual connections...</span>
          </div>
        ) : mutualSuggestions.length === 0 ? (
          <div className="py-6 text-center text-white/40 text-xs flex flex-col items-center gap-1.5">
            <Users className="w-5 h-5 text-white/25" />
            <span className="font-medium text-white/60">No mutual friend suggestions right now</span>
            <span className="text-[11px] text-white/30 max-w-xs">
              Search by username above or share your profile invite link to add friends.
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {mutualSuggestions.map((sug) => {
              const isSending = Boolean(sendingMap[sug.username]);
              return (
                <div 
                  key={sug.userId}
                  className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <InitialAvatar name={sug.displayName || sug.username} size="sm" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{sug.displayName}</div>
                      <div className="text-[10px] text-white/40 truncate">
                        Mutual with @{sug.mutualFriendName} • {sug.mutualCount} mutual friend{sug.mutualCount > 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSending}
                    onClick={() => handleSendRequest(sug.username, sug.userId)}
                    className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-white text-white hover:text-black font-semibold text-xs active:scale-95 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  >
                    {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                    <span>Add</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Bottom Banner: Share Songs with Friends */}
      <div 
        onClick={handleCopyProfileLink}
        className="p-4 rounded-3xl bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-pink-600/20 border border-white/15 backdrop-blur-xl flex items-center justify-between cursor-pointer hover:border-white/30 transition-all group shadow-xl"
      >
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white group-hover:scale-105 transition-transform">
            <Music2 className="w-5 h-5 text-lumen-cyan" />
          </div>
          <div>
            <div className="text-xs sm:text-sm font-bold text-white">
              Share Songs with Friends
            </div>
            <div className="text-[11px] text-white/50">
              Send your favourite tracks instantly to any friend
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
      </div>

      {/* QR Code Modal Dialog */}
      {showQrModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn"
          onClick={() => setShowQrModal(false)}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-6 bg-[#0a0e17] border border-white/20 text-center space-y-4 shadow-2xl relative"
          >
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 text-white/50 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-14 h-14 rounded-2xl bg-lumen-cyan/10 border border-lumen-cyan/30 flex items-center justify-center mx-auto text-lumen-cyan">
              <QrCode className="w-7 h-7" />
            </div>

            <div>
              <h3 className="text-base font-bold text-white">@{myUsername}</h3>
              <p className="text-xs text-white/50 mt-1">Scan this QR code from any camera to connect on Lumen</p>
            </div>

            <div className="p-4 rounded-2xl bg-white mx-auto inline-block shadow-lg">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`https://lumen-player.web.app/u/${encodeURIComponent(myUsername)}`)}`} 
                alt="Profile QR"
                className="w-40 h-40 object-contain"
              />
            </div>

            <button
              onClick={handleCopyProfileLink}
              className="w-full py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition-all flex items-center justify-center gap-2"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedLink ? 'Copied to Clipboard!' : 'Copy Direct Link'}</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
};