import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  UserPlus, 
  Share2, 
  Play, 
  Plus, 
  Check, 
  X, 
  Search, 
  Disc3, 
  Clock, 
  Radio, 
  CheckCircle2, 
  Copy, 
  Edit3, 
  AtSign, 
  Loader2,
  Star,
  Crown,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  Send,
  Music
} from 'lucide-react';
import { Track } from '../../types/music';
import { AppUser } from '../../services/firebaseAuthService';
import { WatchSoundService } from '../../services/watchSoundService';
import { UsernameSetupModal } from '../auth/UsernameSetupModal';
import { FirestoreService } from '../../services/firestoreService';
import { ApiClient } from '../../services/apiClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  dominantColor: string;
  currentUser?: AppUser | null;
  currentTrack?: Track | null;
  onPlayTrack: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
}

interface SharedItem {
  share_id: string;
  sender_id: string;
  sender_username: string;
  recipient_id?: string;
  song_id: string | null;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  artwork_url?: string;
  artworkUrl?: string;
  song?: { artworkUrl?: string; artwork_url?: string };
  message?: string;
  sender_rating?: number | null;
  created_at: number;
  read_status?: number;
}

interface FriendProfile {
  user_id: string;
  username: string;
  display_name?: string;
  photo_url?: string;
  rating_visibility?: string;
  taste_similarity?: number;
  shared_artists?: string[];
  last_listened?: string;
}

interface RatedSongItem {
  song_id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  artwork_url?: string;
  rating: number;
  updated_at?: number;
}

interface FriendTasteProfile {
  user_id: string;
  username: string;
  rating_visibility?: string;
  ratings_hidden?: boolean;
  favorite_song?: RatedSongItem | null;
  top_rated_songs?: RatedSongItem[];
  lowest_rated_songs?: RatedSongItem[];
  total_rated?: number;
}

interface FriendRequestItem {
  friendship_id: string;
  user_id: string;
  username: string;
  created_at: number;
}

export const FriendsHubView: React.FC<Props> = ({
  isOpen,
  onClose,
  dominantColor,
  currentUser,
  currentTrack,
  onPlayTrack,
  onAddToQueue
}) => {
  const [activeTab, setActiveTab] = useState<'taste' | 'shared' | 'requests'>('taste');

  // User Profile & Tag State
  const [currentUsername, setCurrentUsername] = useState<string>('');
  const [hasCustomUsername, setHasCustomUsername] = useState<boolean>(false);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [tagCopied, setTagCopied] = useState(false);

  // Privacy State (whether current user shares ratings with friends)
  const [myRatingVisibility, setMyRatingVisibility] = useState<'friends' | 'private'>('friends');
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false);

  // Friends & Shares State
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [friendTastes, setFriendTastes] = useState<FriendTasteProfile[]>([]);
  const [isLoadingTaste, setIsLoadingTaste] = useState(false);
  const [receivedShares, setReceivedShares] = useState<SharedItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);

  // Search & Send State
  const [searchUsername, setSearchUsername] = useState('');
  const [liveSearchResults, setLiveSearchResults] = useState<Array<{
    user_id: string;
    username: string;
    is_friend?: boolean;
    is_pending?: boolean;
    is_self?: boolean;
  }>>([]);
  const [isSearchingLive, setIsSearchingLive] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [requestStatusMsg, setRequestStatusMsg] = useState<string | null>(null);

  // Share Song Flow Modal
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [selectedFriendForShare, setSelectedFriendForShare] = useState<string>('');
  const [shareNote, setShareNote] = useState('');
  const [songToShare, setSongToShare] = useState<Track | null>(currentTrack || null);
  const [isSendingShare, setIsSendingShare] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const userId = currentUser?.uid || 'local_user';

  // Load profile, friends, incoming/outgoing requests, shares, and friends taste
  const loadSocialData = useCallback(async () => {
    try {
      setIsLoadingTaste(true);

      // 0. Fetch user profile
      const profRes = await fetch(ApiClient.resolveUrl(`/api/users/profile?userId=${encodeURIComponent(userId)}`));
      if (profRes.ok) {
        const profData = await profRes.json();
        if (profData.success && profData.user) {
          setCurrentUsername(profData.user.username);
          setHasCustomUsername(!!profData.user.has_custom_username);
          if (profData.user.rating_visibility) {
            setMyRatingVisibility(profData.user.rating_visibility);
          }
        }
      }

      // 1. Load friends
      const friendsRes = await fetch(ApiClient.resolveUrl(`/api/friends?userId=${encodeURIComponent(userId)}`));
      if (friendsRes.ok) {
        const data = await friendsRes.json();
        const list: any[] = data.friends || [];
        const enriched: FriendProfile[] = list.map((f, i) => ({
          user_id: f.user_id,
          username: f.username,
          display_name: f.username,
          taste_similarity: f.taste_similarity || Math.floor(84 + ((f.username.length * 7 + i * 3) % 15)),
          shared_artists: ['The Weeknd', 'Tame Impala', 'Travis Scott'],
          last_listened: 'Listening to Studio Masters'
        }));
        setFriends(enriched);
      }

      // 2. Load friend taste & song ratings feed
      const tasteRes = await fetch(ApiClient.resolveUrl(`/api/friends/taste?userId=${encodeURIComponent(userId)}`));
      if (tasteRes.ok) {
        const tasteData = await tasteRes.json();
        if (tasteData.success && Array.isArray(tasteData.friends)) {
          setFriendTastes(tasteData.friends);
        }
      }

      // 3. Load received song shares with sender rating
      const sharesRes = await fetch(ApiClient.resolveUrl(`/api/shares/received?userId=${encodeURIComponent(userId)}`));
      if (sharesRes.ok) {
        const sData = await sharesRes.json();
        const sharesList: SharedItem[] = sData.shares || [];
        setReceivedShares(sharesList);
      }

      // 4. Load friend requests
      const reqRes = await fetch(ApiClient.resolveUrl(`/api/friends/requests?userId=${encodeURIComponent(userId)}`));
      if (reqRes.ok) {
        const rData = await reqRes.json();
        setPendingRequests(rData.incoming || []);
        setOutgoingRequests(rData.outgoing || []);
      }
    } catch (e) {
      console.warn('[FriendsHub] Load error:', e);
    } finally {
      setIsLoadingTaste(false);
    }
  }, [userId]);

  // Real-time debounced prefix search
  useEffect(() => {
    const q = searchUsername.trim();
    if (!q) {
      setLiveSearchResults([]);
      setIsSearchingLive(false);
      return;
    }
    setIsSearchingLive(true);
    setUserSearchError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(ApiClient.resolveUrl(`/api/friends/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(userId)}`));
        if (res.ok) {
          const data = await res.json();
          setLiveSearchResults(data.users || []);
          if ((!data.users || data.users.length === 0) && q.length >= 2) {
            setUserSearchError(`No listeners matching "${q}"`);
          } else {
            setUserSearchError(null);
          }
        }
      } catch (_) {
        setUserSearchError('Failed to search listeners');
      } finally {
        setIsSearchingLive(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchUsername, userId]);

  useEffect(() => {
    if (isOpen) {
      loadSocialData();
    }
  }, [isOpen, loadSocialData]);

  useEffect(() => {
    if (currentTrack) {
      setSongToShare(currentTrack);
    }
  }, [currentTrack]);

  // Keyboard navigation & Escape key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Convert SharedItem or RatedSongItem to full playable Track
  const resolvePlayableTrack = (item: {
    song_id?: string | null;
    share_id?: string;
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    artwork_url?: string;
    artworkUrl?: string;
    song?: any;
  }): Track => {
    const trackId = item.song_id || item.share_id || `item_${Date.now()}`;
    const art = item.artwork_url || item.artworkUrl || item.song?.artworkUrl || item.song?.artwork_url || null;
    return {
      id: trackId,
      title: item.title,
      artist: item.artist,
      album: item.album || 'Studio Master',
      duration: item.duration || 210,
      path: `stream://${trackId}`,
      filename: `${item.title}.mp3`,
      addedAt: Date.now(),
      artworkUrl: art,
      streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.title)}&artist=${encodeURIComponent(item.artist)}&duration=${item.duration || ''}`,
      hasArtwork: !!art,
      isStream: true,
      isVerified: true
    };
  };

  // Toggle user's own rating visibility
  const handleToggleRatingPrivacy = async () => {
    const nextVisibility = myRatingVisibility === 'friends' ? 'private' : 'friends';
    setMyRatingVisibility(nextVisibility);
    setIsUpdatingPrivacy(true);
    WatchSoundService.playTick(1.1);
    try {
      await fetch(ApiClient.resolveUrl('/api/users/privacy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          rating_visibility: nextVisibility
        })
      });
    } catch (e) {
      console.warn('Failed to update privacy:', e);
    } finally {
      setIsUpdatingPrivacy(false);
    }
  };

  // Copy user tag
  const handleCopyTag = () => {
    if (currentUsername) {
      navigator.clipboard?.writeText(`@${currentUsername}`);
      setTagCopied(true);
      WatchSoundService.playTick(1.1);
      setTimeout(() => setTagCopied(false), 2000);
    }
  };

  // Send friend request to a user
  const handleSendFriendRequest = async (targetId?: string, targetName?: string) => {
    const recipientId = targetId || searchUsername.trim();
    if (!recipientId) return;
    try {
      const res = await fetch(ApiClient.resolveUrl('/api/friends/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: userId,
          recipientId: recipientId
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRequestStatusMsg(`Friend request sent to @${targetName || recipientId}!`);
        WatchSoundService.playTick(1.2);
        setSearchUsername('');
        setLiveSearchResults([]);
        loadSocialData();
      } else {
        setRequestStatusMsg(data.error || 'Failed to send friend request');
      }
    } catch (_) {
      setRequestStatusMsg('Network error sending request');
    }
  };

  // Respond to incoming request
  const handleRespondRequest = async (requesterId: string, action: 'accepted' | 'declined') => {
    try {
      const res = await fetch(ApiClient.resolveUrl('/api/friends/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          requesterId,
          action
        })
      });
      if (res.ok) {
        WatchSoundService.playTick(1.2);
        loadSocialData();
      }
    } catch (_) {}
  };

  // Cancel outgoing friend request
  const handleCancelOutgoing = async (recipientId: string) => {
    try {
      const res = await fetch(ApiClient.resolveUrl('/api/friends/remove'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          friendId: recipientId
        })
      });
      if (res.ok) {
        WatchSoundService.playTick(1.1);
        loadSocialData();
      }
    } catch (_) {}
  };

  // Send a song share
  const handleExecuteSendShare = async () => {
    if (!selectedFriendForShare || !songToShare) return;
    setIsSendingShare(true);
    setShareFeedback(null);
    try {
      const res = await fetch(ApiClient.resolveUrl('/api/shares/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: userId,
          recipientId: selectedFriendForShare,
          song: {
            id: songToShare.id,
            title: songToShare.title,
            artist: songToShare.artist,
            album: songToShare.album,
            duration: songToShare.duration,
            artworkUrl: songToShare.artworkUrl
          },
          songId: songToShare.id,
          title: songToShare.title,
          artist: songToShare.artist,
          album: songToShare.album,
          duration: songToShare.duration,
          artworkUrl: songToShare.artworkUrl,
          message: shareNote.trim() || undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (currentUser && !currentUser.isGuest) {
          try {
            await FirestoreService.sendSongShare(
              currentUser,
              selectedFriendForShare,
              songToShare,
              shareNote.trim() || undefined
            );
          } catch (_) {}
        }

        WatchSoundService.playTick(1.3);
        setShareFeedback('Song shared successfully!');
        setShareNote('');
        setTimeout(() => {
          setIsShareModalOpen(false);
          setShareFeedback(null);
        }, 1200);
      } else {
        setShareFeedback(data.error || 'Failed to send share');
      }
    } catch (_) {
      setShareFeedback('Network error sharing song');
    } finally {
      setIsSendingShare(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-40 bg-black/95 backdrop-blur-3xl flex flex-col overflow-hidden animate-fadeIn select-none"
      style={{
        background: `radial-gradient(circle at 50% 10%, ${dominantColor}22 0%, rgba(5,5,8,0.98) 75%)`
      }}
    >
      {/* Top Header Bar */}
      <div className="h-16 px-4 sm:px-8 border-b border-white/10 flex items-center justify-between relative z-20 backdrop-blur-xl bg-black/30">
        {/* Left: User Tag & Identity Badge */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white font-black text-sm uppercase shadow-inner">
            {currentUsername ? currentUsername.charAt(0) : 'U'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-wide">
                @{currentUsername || 'listener'}
              </span>
              <button
                onClick={handleCopyTag}
                title="Copy your tag to share with friends"
                className="text-white/40 hover:text-white transition-colors cursor-pointer p-1"
              >
                {tagCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/50 font-mono">
                {hasCustomUsername ? 'Verified Tag' : 'Tap edit to customize'}
              </span>
              <button
                onClick={() => setIsUsernameModalOpen(true)}
                title="Change your unique username"
                className="text-white/40 hover:text-lumen-cyan transition-colors cursor-pointer p-0.5"
              >
                <Edit3 className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Center: VisionOS Segmented Capsule Navigation */}
        <div className="hidden md:flex items-center p-1 rounded-2xl bg-white/[0.07] border border-white/15 backdrop-blur-2xl shadow-inner gap-1">
          <button
            onClick={() => {
              setActiveTab('taste');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'taste'
                ? 'bg-white/20 text-white border border-white/30 shadow-lg scale-102'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            <span>Friend Taste & Ratings ({friendTastes.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('shared');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'shared'
                ? 'bg-white/20 text-white border border-white/30 shadow-lg scale-102'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-4 h-4 text-lumen-cyan" />
            <span>Shared With Me ({receivedShares.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('requests');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer relative ${
              activeTab === 'requests'
                ? 'bg-white/20 text-white border border-white/30 shadow-lg scale-102'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <UserPlus className="w-4 h-4 text-pink-400" />
            <span>Add Friends</span>
            {pendingRequests.length > 0 && (
              <span className="w-2.5 h-2.5 rounded-full bg-pink-500 animate-pulse ml-0.5" />
            )}
          </button>
        </div>

        {/* Right: Share Song Button + Close Button */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => {
              if (friends.length > 0) setSelectedFriendForShare(friends[0].user_id);
              setIsShareModalOpen(true);
              WatchSoundService.playTick(1.0);
            }}
            className="px-4 py-2 rounded-2xl bg-gradient-to-r from-lumen-cyan/20 to-cyan-500/20 hover:from-lumen-cyan/30 hover:to-cyan-500/30 border border-lumen-cyan/50 text-lumen-cyan font-bold text-xs transition-all flex items-center gap-2 shadow-lg cursor-pointer hover:scale-105 active:scale-95"
            title="Share a song with a friend"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Share Song</span>
          </button>

          <button
            onClick={onClose}
            className="p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 text-white/70 hover:text-white transition-all cursor-pointer hover:scale-105 active:scale-95"
            title="Close Stage (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile Sub-Navigation Bar */}
      <div className="flex md:hidden items-center justify-around px-2 py-1.5 border-b border-white/10 bg-white/[0.03] z-20">
        <button
          onClick={() => setActiveTab('taste')}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'taste' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
          <span>Taste</span>
        </button>
        <button
          onClick={() => setActiveTab('shared')}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'shared' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          <Sparkles className="w-3 h-3 text-lumen-cyan" />
          <span>Shared ({receivedShares.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'requests' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          <UserPlus className="w-3 h-3 text-pink-400" />
          <span>Friends</span>
          {pendingRequests.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
          )}
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: FRIEND TASTE & RATINGS FEED */}
      {/* ============================================================== */}
      {activeTab === 'taste' && (
        <div className="flex-1 p-4 sm:p-8 overflow-y-auto no-scrollbar relative z-10 max-w-6xl mx-auto w-full space-y-6">
          {/* Privacy Controls Banner */}
          <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/15 backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  {myRatingVisibility === 'friends' ? (
                    <Eye className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-amber-400" />
                  )}
                  <span>Share My Song Ratings With Friends</span>
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase font-bold ${
                  myRatingVisibility === 'friends'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {myRatingVisibility === 'friends' ? 'Shared with Friends' : 'Private'}
                </span>
              </div>
              <p className="text-xs text-white/50">
                {myRatingVisibility === 'friends'
                  ? 'Your connected friends can see your favorite songs, 5★ ratings, and least rated tracks.'
                  : 'Your song ratings are hidden from friends. They will see "Ratings kept private".'}
              </p>
            </div>

            <button
              onClick={handleToggleRatingPrivacy}
              disabled={isUpdatingPrivacy}
              className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md ${
                myRatingVisibility === 'friends'
                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300'
                  : 'bg-white/10 hover:bg-white/20 border border-white/20 text-white/80'
              }`}
            >
              {myRatingVisibility === 'friends' ? 'Hide Ratings (Make Private)' : 'Share With Friends'}
            </button>
          </div>

          {/* Friends Taste Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span>What Your Friends Are Rating</span>
              </h3>
              <span className="text-xs text-white/40 font-mono">
                {friendTastes.length} {friendTastes.length === 1 ? 'Friend' : 'Friends'}
              </span>
            </div>

            {isLoadingTaste ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-white/40">
                <Loader2 className="w-6 h-6 animate-spin text-lumen-cyan" />
                <span className="text-xs font-mono">Loading friend taste ratings...</span>
              </div>
            ) : friendTastes.length === 0 ? (
              <div className="py-16 rounded-3xl bg-white/[0.03] border border-white/10 text-center space-y-4 max-w-md mx-auto">
                <div className="w-14 h-14 rounded-full bg-white/5 border border-white/15 flex items-center justify-center mx-auto text-white/40">
                  <Users className="w-7 h-7" />
                </div>
                <h4 className="text-base font-bold text-white">No Friends Connected Yet</h4>
                <p className="text-xs text-white/50 leading-relaxed px-4">
                  Connect with friends by searching their username to see what they have rated, their all-time favorites, and explore their music taste!
                </p>
                <button
                  onClick={() => setActiveTab('requests')}
                  className="px-5 py-2.5 rounded-xl bg-lumen-cyan text-black font-bold text-xs shadow-xl hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                >
                  Search Listeners by Username
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {friendTastes.map((profile) => (
                  <div
                    key={profile.user_id}
                    className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] border border-white/15 hover:border-white/30 transition-all space-y-4 shadow-xl"
                  >
                    {/* Header: Avatar, Name, Rating Count */}
                    <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-cyan-400 p-[1.5px] shadow-md">
                          <div className="w-full h-full rounded-full bg-black/90 flex items-center justify-center font-bold text-white uppercase text-sm">
                            {profile.username.charAt(0)}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            <span>@{profile.username}</span>
                          </h4>
                          <span className="text-[11px] text-white/40 font-mono">
                            {profile.ratings_hidden 
                              ? 'Ratings Private' 
                              : `${profile.total_rated || 0} Rated Tracks`}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedFriendForShare(profile.user_id);
                          setIsShareModalOpen(true);
                          WatchSoundService.playTick(1.0);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-lumen-cyan hover:text-black text-xs font-bold text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Send song to friend"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Send Song</span>
                      </button>
                    </div>

                    {/* Ratings Content or Privacy Lock */}
                    {profile.ratings_hidden ? (
                      <div className="py-8 px-4 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col items-center justify-center text-center space-y-2">
                        <div className="w-10 h-10 rounded-full bg-white/5 border border-white/15 flex items-center justify-center text-amber-400">
                          <Lock className="w-5 h-5" />
                        </div>
                        <h5 className="text-xs font-bold text-white">Ratings Kept Private</h5>
                        <p className="text-[11px] text-white/40 max-w-xs leading-relaxed">
                          @{profile.username} has chosen to keep their song ratings and favorites private.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* 1. Favorite Song (Crown badge) */}
                        {profile.favorite_song ? (
                          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 flex items-center justify-between gap-3 shadow-inner">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-12 h-12 rounded-xl bg-black/60 overflow-hidden flex-shrink-0 border border-amber-500/30 relative">
                                {profile.favorite_song.artwork_url ? (
                                  <img 
                                    src={profile.favorite_song.artwork_url} 
                                    alt={profile.favorite_song.title} 
                                    className="w-full h-full object-cover" 
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-amber-400">
                                    <Disc3 className="w-6 h-6" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1 text-[10px] text-amber-400 font-bold uppercase tracking-wider mb-0.5">
                                  <Crown className="w-3 h-3 fill-amber-400" />
                                  <span>Favorite Song</span>
                                </div>
                                <h5 className="text-xs font-bold text-white truncate">
                                  {profile.favorite_song.title}
                                </h5>
                                <p className="text-[11px] text-white/60 truncate">
                                  {profile.favorite_song.artist}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <div className="px-2 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[11px] font-bold flex items-center gap-1">
                                <Star className="w-3 h-3 fill-amber-400" />
                                <span>{profile.favorite_song.rating.toFixed(1)}</span>
                              </div>
                              <button
                                onClick={() => {
                                  onPlayTrack(resolvePlayableTrack(profile.favorite_song!));
                                  WatchSoundService.playTick(1.2);
                                }}
                                className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer shadow-md"
                                title="Play favorite track"
                              >
                                <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {/* 2. Top-Rated Songs */}
                        {profile.top_rated_songs && profile.top_rated_songs.length > 0 ? (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider block">
                              ⭐ Highest Rated Songs
                            </span>
                            <div className="space-y-1.5">
                              {profile.top_rated_songs.map((song, idx) => (
                                <div
                                  key={idx}
                                  className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 flex items-center justify-between gap-2 transition-colors"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-black/60 overflow-hidden flex-shrink-0 border border-white/10">
                                      {song.artwork_url ? (
                                        <img src={song.artwork_url} alt={song.title} className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-white/30">
                                          <Disc3 className="w-4 h-4" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <h6 className="text-xs font-semibold text-white truncate">{song.title}</h6>
                                      <span className="text-[10px] text-white/50 truncate block">{song.artist}</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1">
                                      <Star className="w-2.5 h-2.5 fill-emerald-400" />
                                      <span>{song.rating.toFixed(1)}</span>
                                    </span>
                                    <button
                                      onClick={() => {
                                        onPlayTrack(resolvePlayableTrack(song));
                                        WatchSoundService.playTick(1.1);
                                      }}
                                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
                                      title="Play track"
                                    >
                                      <Play className="w-3 h-3 fill-white ml-0.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* 3. Lowest Rated Songs */}
                        {profile.lowest_rated_songs && profile.lowest_rated_songs.length > 0 ? (
                          <div className="space-y-1.5 pt-1">
                            <span className="text-[10px] font-mono text-pink-400 font-bold uppercase tracking-wider block">
                              📉 Lowest Rated Songs
                            </span>
                            <div className="space-y-1.5">
                              {profile.lowest_rated_songs.map((song, idx) => (
                                <div
                                  key={idx}
                                  className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 flex items-center justify-between gap-2 transition-colors"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-black/60 overflow-hidden flex-shrink-0 border border-white/10">
                                      {song.artwork_url ? (
                                        <img src={song.artwork_url} alt={song.title} className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-white/30">
                                          <Disc3 className="w-4 h-4" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <h6 className="text-xs font-semibold text-white truncate">{song.title}</h6>
                                      <span className="text-[10px] text-white/50 truncate block">{song.artist}</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="px-2 py-0.5 rounded-md bg-pink-500/15 border border-pink-500/30 text-pink-300 font-mono text-[10px] font-bold flex items-center gap-1">
                                      <Star className="w-2.5 h-2.5" />
                                      <span>{song.rating.toFixed(1)}</span>
                                    </span>
                                    <button
                                      onClick={() => {
                                        onPlayTrack(resolvePlayableTrack(song));
                                        WatchSoundService.playTick(1.1);
                                      }}
                                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
                                      title="Play track"
                                    >
                                      <Play className="w-3 h-3 fill-white ml-0.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* If friend has rated nothing */}
                        {!profile.favorite_song && (!profile.top_rated_songs || profile.top_rated_songs.length === 0) && (
                          <p className="text-xs text-white/40 italic py-2">
                            @{profile.username} hasn't rated any songs yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: SHARED WITH ME (WITH SENDER RATING BADGE) */}
      {/* ============================================================== */}
      {activeTab === 'shared' && (
        <div className="flex-1 p-4 sm:p-8 overflow-y-auto no-scrollbar relative z-10 max-w-4xl mx-auto w-full space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-lumen-cyan" />
                <span>Recommendations from Friends</span>
              </h3>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                Tracks sent to you by friends with their ratings and personalized notes
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-lumen-cyan/20 border border-lumen-cyan/40 text-lumen-cyan font-mono text-xs font-bold">
              {receivedShares.length} Shared
            </span>
          </div>

          {receivedShares.length === 0 ? (
            <div className="py-20 rounded-3xl bg-white/[0.03] border border-white/10 text-center space-y-4 max-w-md mx-auto">
              <div className="w-14 h-14 rounded-full bg-white/5 border border-white/15 flex items-center justify-center mx-auto text-white/40">
                <Share2 className="w-7 h-7" />
              </div>
              <h4 className="text-base font-bold text-white">No Shared Songs Yet</h4>
              <p className="text-xs text-white/50 leading-relaxed px-4">
                When friends send you song recommendations, they will appear here with their star rating and personal notes.
              </p>
              <button
                onClick={() => {
                  if (friends.length > 0) setSelectedFriendForShare(friends[0].user_id);
                  setIsShareModalOpen(true);
                }}
                className="px-5 py-2.5 rounded-xl bg-lumen-cyan text-black font-bold text-xs shadow-xl hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              >
                Send a Song to a Friend
              </button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {receivedShares.map((item) => {
                const playableTrack = resolvePlayableTrack(item);
                const hasSenderRating = typeof item.sender_rating === 'number' && item.sender_rating > 0;

                return (
                  <div
                    key={item.share_id}
                    className="p-4 sm:p-5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/15 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl"
                  >
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                      {/* Artwork */}
                      {(() => {
                        const art = item.artwork_url || item.artworkUrl || (item as any).song?.artworkUrl || (item as any).song?.artwork_url;
                        return (
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-black/60 overflow-hidden flex-shrink-0 border border-white/15 relative shadow-md">
                            {art ? (
                              <img src={art} alt={item.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white/30">
                                <Disc3 className="w-6 h-6 sm:w-7 sm:h-7" />
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Song Details & Friend's Rating */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-mono text-lumen-cyan font-semibold">
                            Shared by @{item.sender_username}
                          </span>
                          <span className="text-[10px] text-white/30 font-mono">
                            • {new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>

                          {/* Sender's exact rating badge */}
                          {hasSenderRating ? (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold flex items-center gap-1">
                              <Star className="w-3 h-3 fill-amber-400" />
                              <span>{item.sender_rating?.toFixed(1)} / 5.0 Rating</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-white/40 font-mono italic">
                              (Not rated yet)
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-bold text-white truncate">{item.title}</h4>
                        <p className="text-xs text-white/60 truncate">{item.artist}</p>

                        {/* Optional personal message from sender */}
                        {item.message && (
                          <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white/80 italic mt-1.5 flex items-center gap-2">
                            <span className="text-lumen-cyan not-italic">💬</span>
                            <span>"{item.message}"</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions: Play and Add to Queue */}
                    <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                      <button
                        onClick={() => {
                          onPlayTrack(playableTrack);
                          WatchSoundService.playTick(1.2);
                        }}
                        className="px-4 py-2 rounded-xl bg-lumen-cyan text-black font-bold text-xs flex items-center gap-1.5 shadow-md hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-black" />
                        <span>Play Now</span>
                      </button>

                      <button
                        onClick={() => {
                          onAddToQueue(playableTrack);
                          WatchSoundService.playTick(1.0);
                        }}
                        className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
                        title="Add to queue"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: ADD FRIENDS & MANAGE REQUESTS */}
      {/* ============================================================== */}
      {activeTab === 'requests' && (
        <div className="flex-1 p-4 sm:p-8 overflow-y-auto no-scrollbar relative z-10 max-w-3xl mx-auto w-full space-y-6">
          {/* Search Listener Box with Live Prefix Matching */}
          <div className="p-6 rounded-3xl bg-white/[0.04] border border-white/15 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Search className="w-4 h-4 text-lumen-cyan" />
                  <span>Find Listeners by Username</span>
                </h3>
                <p className="text-xs text-white/50 font-mono mt-0.5">
                  Type a username to discover listeners and connect in real time
                </p>
              </div>
              {isSearchingLive && (
                <div className="flex items-center gap-1.5 text-xs text-lumen-cyan font-mono animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Searching...</span>
                </div>
              )}
            </div>

            <div className="relative">
              <AtSign className="w-4 h-4 text-white/40 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                placeholder="Type username (e.g. saatvik, alex, sarah)..."
                className="w-full pl-11 pr-10 py-3 bg-white/5 border border-white/15 rounded-2xl text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan shadow-inner"
              />
              {searchUsername && (
                <button
                  onClick={() => setSearchUsername('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {userSearchError && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300 font-mono">
                {userSearchError}
              </div>
            )}

            {/* Live Matched Users Grid */}
            {liveSearchResults.length > 0 && (
              <div className="space-y-2 pt-1 animate-fadeIn">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider block">
                  Matched Listeners ({liveSearchResults.length})
                </span>
                <div className="space-y-2">
                  {liveSearchResults.map(match => (
                    <div
                      key={match.user_id}
                      className="p-3.5 rounded-2xl bg-white/[0.06] hover:bg-white/[0.09] border border-white/15 flex items-center justify-between transition-colors shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-400 to-purple-500 p-[1.5px] shadow-sm">
                          <div className="w-full h-full rounded-full bg-black flex items-center justify-center font-bold text-white uppercase text-sm">
                            {match.username.charAt(0)}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            <span>@{match.username}</span>
                            {match.is_self && (
                              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/60">
                                You
                              </span>
                            )}
                          </h4>
                          <span className="text-[10px] text-white/40 font-mono">Lumen Listener</span>
                        </div>
                      </div>

                      <div>
                        {match.is_self ? (
                          <span className="text-xs text-white/40 font-mono px-3 py-1">Your Account</span>
                        ) : match.is_friend ? (
                          <span className="px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>Friends</span>
                          </span>
                        ) : match.is_pending ? (
                          <span className="px-3 py-1.5 rounded-xl bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 text-xs font-bold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Pending</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSendFriendRequest(match.user_id, match.username)}
                            className="px-4 py-2 rounded-xl bg-lumen-cyan text-black font-bold text-xs flex items-center gap-1.5 hover:scale-105 active:scale-95 transition-transform cursor-pointer shadow-md"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Add Friend</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {requestStatusMsg && (
              <div className="p-3 rounded-xl bg-lumen-cyan/15 border border-lumen-cyan/30 text-xs text-lumen-cyan font-mono flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{requestStatusMsg}</span>
              </div>
            )}
          </div>

          {/* Pending Incoming Requests */}
          <div className="p-6 rounded-3xl bg-white/[0.04] border border-white/15 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-pink-400" />
                <span>Incoming Friend Requests</span>
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-mono text-xs font-bold">
                {pendingRequests.length} Pending
              </span>
            </div>

            {pendingRequests.length === 0 ? (
              <p className="text-xs text-white/40 italic py-4">No incoming friend requests right now.</p>
            ) : (
              <div className="space-y-2.5">
                {pendingRequests.map(req => {
                  const reqUsername = (req as any).requester_username || req.username;
                  const reqId = (req as any).requester_id || req.user_id;
                  return (
                    <div
                      key={req.friendship_id || reqId}
                      className="p-4 rounded-2xl bg-white/[0.06] border border-white/15 flex items-center justify-between shadow-md"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-pink-500/20 border border-pink-500/40 text-pink-400 flex items-center justify-center font-bold text-xs uppercase">
                          {reqUsername.charAt(0)}
                        </div>
                        <div>
                          <span className="text-sm font-bold text-white block">@{reqUsername}</span>
                          <span className="text-[10px] text-white/40 font-mono">
                            Sent {new Date(req.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRespondRequest(reqId, 'accepted')}
                          className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer shadow-md"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRespondRequest(reqId, 'declined')}
                          className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-red-500/20 text-white/70 hover:text-red-300 text-xs transition-colors cursor-pointer"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pending Outgoing Requests */}
          {outgoingRequests.length > 0 && (
            <div className="p-6 rounded-3xl bg-white/[0.04] border border-white/15 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-lumen-cyan" />
                  <span>Outgoing Friend Requests</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-white/60 font-mono text-xs font-bold">
                  {outgoingRequests.length} Sent
                </span>
              </div>

              <div className="space-y-2.5">
                {outgoingRequests.map(req => {
                  const targetUsername = (req as any).recipient_username || req.username;
                  const targetId = (req as any).recipient_id || req.user_id;
                  return (
                    <div
                      key={req.friendship_id || targetId}
                      className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/10 border border-white/20 text-white/60 flex items-center justify-center font-bold text-xs uppercase">
                          {targetUsername.charAt(0)}
                        </div>
                        <div>
                          <span className="text-sm font-bold text-white block">@{targetUsername}</span>
                          <span className="text-[10px] text-white/40 font-mono">
                            Awaiting response
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleCancelOutgoing(targetId)}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-red-500/20 text-white/60 hover:text-red-300 text-xs font-mono transition-colors cursor-pointer"
                        title="Cancel friend request"
                      >
                        Cancel
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: SHARE SONG DIALOG */}
      {/* ============================================================== */}
      {isShareModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-2xl z-50 p-6 flex items-center justify-center animate-fadeIn select-none">
          <div 
            className="w-full max-w-md rounded-3xl bg-gradient-to-br from-white/15 via-white/5 to-black/95 border border-white/20 p-6 shadow-2xl relative flex flex-col justify-between"
            style={{
              boxShadow: '0 30px 80px rgba(0,0,0,0.9), inset 0 1px 1px 0 rgba(255,255,255,0.3)'
            }}
          >
            <div>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-lumen-cyan" />
                  <span>Send Song to Friend</span>
                </h3>
                <button
                  onClick={() => setIsShareModalOpen(false)}
                  className="p-1.5 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Song to share preview */}
              {songToShare ? (
                <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15 flex items-center gap-3.5 mb-5 shadow-inner">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/60 flex-shrink-0 border border-white/10">
                    {songToShare.artworkUrl ? (
                      <img src={songToShare.artworkUrl} alt={songToShare.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/30">
                        <Disc3 className="w-7 h-7" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-white truncate">{songToShare.title}</h4>
                    <p className="text-xs text-white/60 truncate mt-0.5">{songToShare.artist}</p>
                    <span className="text-[10px] text-lumen-cyan font-mono mt-1 block">Studio Master</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/50 mb-4">No song currently selected</p>
              )}

              {/* Choose Recipient Friend */}
              <div className="space-y-1.5 mb-4">
                <label className="text-[11px] font-mono text-white/60 uppercase">Choose Recipient Friend</label>
                {friends.length === 0 ? (
                  <p className="text-xs text-yellow-300/80 italic p-2 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                    You have no connected friends yet. Add a friend in the Add Friends tab first!
                  </p>
                ) : (
                  <select
                    value={selectedFriendForShare}
                    onChange={(e) => setSelectedFriendForShare(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white/5 border border-white/15 rounded-xl text-xs text-white focus:outline-none focus:border-lumen-cyan cursor-pointer"
                  >
                    {friends.map(f => (
                      <option key={f.user_id} value={f.user_id} className="bg-black text-white">
                        @{f.username} ({f.taste_similarity}% Taste Match)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Optional Message */}
              <div className="space-y-1.5 mb-4">
                <label className="text-[11px] font-mono text-white/60 uppercase">Personal Note (optional)</label>
                <input
                  type="text"
                  value={shareNote}
                  onChange={(e) => setShareNote(e.target.value)}
                  placeholder="e.g. The bass drop at 1:45 is incredible!"
                  className="w-full px-3.5 py-2.5 bg-white/5 border border-white/15 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              {shareFeedback && (
                <div className="p-3 rounded-xl bg-lumen-cyan/15 border border-lumen-cyan/30 text-xs text-lumen-cyan font-mono flex items-center gap-2 mb-4">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{shareFeedback}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleExecuteSendShare}
              disabled={isSendingShare || !selectedFriendForShare || !songToShare || friends.length === 0}
              className="w-full py-3 rounded-2xl bg-lumen-cyan text-black font-bold text-xs flex items-center justify-center gap-2 shadow-xl hover:brightness-110 active:scale-95 disabled:opacity-40 cursor-pointer transition-all"
            >
              <Send className="w-4 h-4" />
              <span>{isSendingShare ? 'Sending...' : 'Send Recommendation Now'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Unique Username Setup & Change Modal */}
      <UsernameSetupModal
        isOpen={isUsernameModalOpen}
        userId={userId}
        currentUsername={currentUsername}
        onComplete={(newU) => {
          setCurrentUsername(newU);
          setIsUsernameModalOpen(false);
          loadSocialData();
        }}
        canDismiss={true}
        onDismiss={() => setIsUsernameModalOpen(false)}
        dominantColor={dominantColor}
      />
    </div>
  );
};
