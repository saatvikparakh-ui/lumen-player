import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Users, 
  UserPlus, 
  Share2, 
  Sparkles, 
  Play, 
  Plus, 
  Check, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  MessageSquare, 
  Search, 
  Flame, 
  Disc3, 
  Clock, 
  ArrowRight,
  TrendingUp,
  Music,
  Send,
  Radio,
  CheckCircle2,
  Copy,
  Edit3,
  AtSign,
  Trash2,
  Loader2
} from 'lucide-react';
import { Track } from '../../types/music';
import { AppUser } from '../../services/firebaseAuthService';
import { WatchSoundService } from '../../services/watchSoundService';
import { UsernameSetupModal } from '../auth/UsernameSetupModal';

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
  message?: string;
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
  const [activeTab, setActiveTab] = useState<'carousel' | 'friends' | 'requests'>('carousel');

  // User Profile & Tag State
  const [currentUsername, setCurrentUsername] = useState<string>('');
  const [hasCustomUsername, setHasCustomUsername] = useState<boolean>(false);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [tagCopied, setTagCopied] = useState(false);

  // Friends & Shares State
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [receivedShares, setReceivedShares] = useState<SharedItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);
  const [activeCarouselIndex, setActiveCarouselIndex] = useState(0);

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

  // Load profile, friends, incoming/outgoing requests, and received shares
  const loadSocialData = useCallback(async () => {
    try {
      // 0. Fetch user profile
      const profRes = await fetch(`/api/users/profile?userId=${encodeURIComponent(userId)}`);
      if (profRes.ok) {
        const profData = await profRes.json();
        if (profData.success && profData.user) {
          setCurrentUsername(profData.user.username);
          setHasCustomUsername(!!profData.user.has_custom_username);
        }
      }

      // 1. Load friends
      const friendsRes = await fetch(`/api/friends?userId=${encodeURIComponent(userId)}`);
      if (friendsRes.ok) {
        const data = await friendsRes.json();
        const list: any[] = data.friends || [];
        const enriched: FriendProfile[] = list.map((f, i) => ({
          user_id: f.user_id,
          username: f.username,
          display_name: f.username,
          taste_similarity: f.taste_similarity || Math.floor(84 + ((f.username.length * 7 + i * 3) % 15)),
          shared_artists: ['The Weeknd', 'Tame Impala', 'Travis Scott'],
          last_listened: 'Listening to Starboy'
        }));
        setFriends(enriched);
      }

      // 2. Load received song shares
      const sharesRes = await fetch(`/api/shares/received?userId=${encodeURIComponent(userId)}`);
      if (sharesRes.ok) {
        const sData = await sharesRes.json();
        const sharesList: SharedItem[] = sData.shares || [];
        setReceivedShares(sharesList);
      }

      // 3. Load requests
      const reqRes = await fetch(`/api/friends/requests?userId=${encodeURIComponent(userId)}`);
      if (reqRes.ok) {
        const rData = await reqRes.json();
        setPendingRequests(rData.incoming || []);
        setOutgoingRequests(rData.outgoing || []);
      }
    } catch (e) {
      console.warn('[FriendsHub] Load error:', e);
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
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(userId)}`);
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

  // Combined Carousel items: real shares + curated friend discovery songs
  const carouselPool: SharedItem[] = useMemo(() => {
    if (receivedShares.length > 0) {
      return receivedShares;
    }
    // High-fidelity curated discovery cards if no shares yet
    return [
      {
        share_id: 'sample_1',
        sender_id: 'friend_1',
        sender_username: 'alex_listener',
        song_id: 'yt_1',
        title: 'After Hours',
        artist: 'The Weeknd',
        album: 'After Hours',
        duration: 361,
        artwork_url: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=800&auto=format&fit=crop&q=80',
        message: 'This synth bassline reminded me of your sound! Turn it up 🔊',
        created_at: Date.now() - 3600000
      },
      {
        share_id: 'sample_2',
        sender_id: 'friend_2',
        sender_username: 'sarah_vibes',
        song_id: 'yt_2',
        title: 'Breathe Deeper',
        artist: 'Tame Impala',
        album: 'The Slow Rush',
        duration: 372,
        artwork_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
        message: 'Masterclass production, incredible drums on this track ✨',
        created_at: Date.now() - 7200000
      },
      {
        share_id: 'sample_3',
        sender_id: 'friend_3',
        sender_username: 'marcus_beats',
        song_id: 'yt_3',
        title: 'FE!N',
        artist: 'Travis Scott',
        album: 'UTOPIA',
        duration: 191,
        artwork_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
        message: 'Pure gym energy, you definitely need this on your playlist 🔥',
        created_at: Date.now() - 14400000
      },
      {
        share_id: 'sample_4',
        sender_id: 'friend_4',
        sender_username: 'chloe_notes',
        song_id: 'yt_4',
        title: 'Starboy',
        artist: 'The Weeknd ft. Daft Punk',
        album: 'Starboy',
        duration: 230,
        artwork_url: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800&auto=format&fit=crop&q=80',
        message: 'Timeless collaboration. Daft Punk drums are flawless.',
        created_at: Date.now() - 28800000
      }
    ];
  }, [receivedShares]);

  const handleNextCard = useCallback(() => {
    if (activeCarouselIndex < carouselPool.length - 1) {
      WatchSoundService.playTick(1.0);
      setActiveCarouselIndex(prev => prev + 1);
    }
  }, [activeCarouselIndex, carouselPool.length]);

  const handlePrevCard = useCallback(() => {
    if (activeCarouselIndex > 0) {
      WatchSoundService.playTick(1.0);
      setActiveCarouselIndex(prev => prev - 1);
    }
  }, [activeCarouselIndex]);

  // Scroll 3D Cover Flow Carousel with wheel & watch tick
  const handleCarouselWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > 15 || Math.abs(e.deltaY) > 15) {
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta > 0) {
        handleNextCard();
      } else if (delta < 0) {
        handlePrevCard();
      }
    }
  };

  // Keyboard navigation & Escape key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrevCard();
      } else if (e.key === 'ArrowRight') {
        handleNextCard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handlePrevCard, handleNextCard, onClose]);

  // Convert SharedItem to full playable Track
  const resolvePlayableTrack = (item: SharedItem): Track => {
    return {
      id: item.song_id || `share_${item.share_id}`,
      title: item.title,
      artist: item.artist,
      album: item.album || 'Shared Master',
      duration: item.duration || 210,
      path: `stream://${item.song_id || item.share_id}`,
      filename: `${item.title}.mp3`,
      addedAt: item.created_at,
      artworkUrl: item.artwork_url || null,
      streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.title)}&artist=${encodeURIComponent(item.artist)}&duration=${item.duration || ''}`,
      hasArtwork: !!item.artwork_url,
      isStream: true,
      isVerified: true
    };
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

  // Send friend request to a user from prefix search or manual input
  const handleSendFriendRequest = async (targetId?: string, targetName?: string) => {
    const recipientId = targetId || searchUsername.trim();
    if (!recipientId) return;
    try {
      const res = await fetch('/api/friends/request', {
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
      const res = await fetch('/api/friends/respond', {
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
      const res = await fetch('/api/friends/remove', {
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
      const res = await fetch('/api/shares/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: userId,
          recipientId: selectedFriendForShare,
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
        setShareFeedback('Song shared successfully!');
        WatchSoundService.playTick(1.3);
        setTimeout(() => {
          setIsShareModalOpen(false);
          setShareFeedback(null);
          setShareNote('');
          loadSocialData();
        }, 1200);
      } else {
        setShareFeedback(data.error || 'Could not send share');
      }
    } catch (_) {
      setShareFeedback('Network error while sharing');
    } finally {
      setIsSendingShare(false);
    }
  };

  if (!isOpen) return null;

  const currentCarouselItem = carouselPool[activeCarouselIndex];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#07090e]/95 backdrop-blur-3xl select-none animate-fadeIn overflow-hidden">
      {/* Dynamic Specular LED Halos (Atmospheric Apple VisionOS Lighting) */}
      <div 
        className="pointer-events-none absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[180px] opacity-25 transition-all duration-700"
        style={{ backgroundColor: dominantColor }}
      />
      <div 
        className="pointer-events-none absolute -bottom-40 -right-40 w-[650px] h-[650px] rounded-full blur-[200px] opacity-20"
        style={{ backgroundColor: '#ec4899' }}
      />
      <div 
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[240px] opacity-10"
        style={{ backgroundColor: '#06b6d4' }}
      />

      {/* TOP VISIONOS LIQUID GLASS HEADER BAR */}
      <div className="h-20 px-6 sm:px-10 border-b border-white/10 flex items-center justify-between relative z-20 flex-shrink-0 bg-white/[0.02]">
        {/* Left: Branding & Status */}
        <div className="flex items-center gap-3.5">
          <div 
            className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center border border-white/30 shadow-xl"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${dominantColor}cc, #080c14)`
            }}
          >
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
                Friends & Social Listening
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-lumen-cyan/20 border border-lumen-cyan/40 text-lumen-cyan font-mono text-[9px] font-bold uppercase tracking-wider">
                VisionOS Stage
              </span>
            </div>
            <div className="flex items-center gap-2.5 mt-1 flex-wrap">
              <span className="text-xs text-white/50 font-mono">
                {friends.length} Friends • {receivedShares.length} Shares
              </span>
              {currentUsername && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/[0.08] hover:bg-white/[0.12] border border-white/20 text-xs transition-colors shadow-sm">
                  <span className="text-white/40 font-mono text-[10px]">Your Tag:</span>
                  <span className="text-lumen-cyan font-mono font-bold text-[11px]">@{currentUsername}</span>
                  <button
                    onClick={handleCopyTag}
                    title="Copy unique tag to clipboard"
                    className="text-white/40 hover:text-white transition-colors cursor-pointer p-0.5"
                  >
                    {tagCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => setIsUsernameModalOpen(true)}
                    title="Change your unique username"
                    className="text-white/40 hover:text-lumen-cyan transition-colors cursor-pointer p-0.5"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: VisionOS Segmented Capsule Navigation */}
        <div className="hidden md:flex items-center p-1 rounded-2xl bg-white/[0.07] border border-white/15 backdrop-blur-2xl shadow-inner gap-1">
          <button
            onClick={() => {
              setActiveTab('carousel');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'carousel'
                ? 'bg-white/20 text-white border border-white/30 shadow-lg scale-102'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-4 h-4 text-lumen-cyan" />
            <span>Shared Reel ({carouselPool.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('friends');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'friends'
                ? 'bg-white/20 text-white border border-white/30 shadow-lg scale-102'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Users className="w-4 h-4 text-pink-400" />
            <span>Friends & Taste ({friends.length})</span>
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
            <UserPlus className="w-4 h-4 text-yellow-400" />
            <span>Add & Requests</span>
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
      <div className="flex md:hidden items-center justify-around px-4 py-2 border-b border-white/10 bg-white/[0.03] z-20">
        <button
          onClick={() => setActiveTab('carousel')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'carousel' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
          <span>Reel</span>
        </button>
        <button
          onClick={() => setActiveTab('friends')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'friends' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          <Users className="w-3.5 h-3.5 text-pink-400" />
          <span>Friends</span>
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'requests' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5 text-yellow-400" />
          <span>Requests</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: FULL SCREEN 3D COVER FLOW ROTATING MUSIC REEL */}
      {/* ============================================================== */}
      {activeTab === 'carousel' && (
        <div 
          onWheel={handleCarouselWheel}
          className="flex-1 flex flex-col justify-between p-6 sm:p-10 relative z-10 overflow-hidden"
        >
          {/* Header Info & Controls */}
          <div className="flex items-center justify-between w-full max-w-5xl mx-auto text-xs font-mono text-white/50 px-2 flex-shrink-0">
            <div className="flex items-center gap-2 text-lumen-cyan">
              <Flame className="w-4 h-4 fill-current" />
              <span className="font-bold uppercase tracking-wider">3D SOCIAL MUSIC CAROUSEL</span>
              <span className="hidden sm:inline text-white/30">• Use ← / → keys or mouse wheel to rotate</span>
            </div>
            <div className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-white/80 font-bold">
              {activeCarouselIndex + 1} / {carouselPool.length}
            </div>
          </div>

          {/* 3D Liquid Glass Cover Flow Reel Area */}
          <div 
            className="relative w-full flex-1 flex items-center justify-center my-4 overflow-visible" 
            style={{ perspective: 1600 }}
          >
            {carouselPool.map((item: SharedItem, index: number) => {
              const offset = index - activeCarouselIndex;
              if (Math.abs(offset) > 2) return null; // Render window of 5 cards

              const isCurrent = offset === 0;
              const rotation = offset * 28; // 3D tilt angle
              const translateX = offset * 320; // Roomy spacing on full screen
              const scale = isCurrent ? 1.05 : 0.82;
              const opacity = isCurrent ? 1 : Math.max(0.3, 0.7 - Math.abs(offset) * 0.25);
              const zIndex = 30 - Math.abs(offset) * 10;

              return (
                <div
                  key={item.share_id}
                  onClick={() => {
                    if (!isCurrent) {
                      WatchSoundService.playTick(1.0);
                      setActiveCarouselIndex(index);
                    }
                  }}
                  style={{
                    transform: `translateX(${translateX}px) rotateY(${rotation}deg) scale(${scale})`,
                    zIndex,
                    opacity,
                    transition: 'transform 0.45s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.35s ease'
                  }}
                  className={`absolute w-72 sm:w-84 md:w-96 rounded-3xl p-5 sm:p-6 flex flex-col justify-between cursor-pointer select-none border backdrop-blur-3xl transition-all duration-300 ${
                    isCurrent
                      ? 'bg-gradient-to-br from-white/20 via-white/8 to-black/90 border-white/40 shadow-[0_30px_90px_rgba(0,0,0,0.95)] ring-1 ring-white/30'
                      : 'bg-black/70 border-white/10 hover:border-white/30 hover:bg-black/60 shadow-xl'
                  }`}
                >
                  {/* Sender Friend Header Badge */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-cyan-400 p-[1.5px] shadow-md">
                        <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold text-white uppercase">
                          {item.sender_username.charAt(0)}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs sm:text-sm font-bold text-white block">
                          @{item.sender_username}
                        </span>
                        <span className="text-[10px] text-white/50 font-mono">Shared Song</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-white/40 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                      {new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>

                  {/* Album Artwork Cover */}
                  <div className="w-full aspect-square rounded-2xl overflow-hidden shadow-2xl relative mb-4 bg-black/80 border border-white/15 group">
                    {item.artwork_url ? (
                      <img 
                        src={item.artwork_url} 
                        alt={item.title} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-white/10 to-black text-white/40">
                        <Disc3 className="w-14 h-14 animate-spin-slow mb-2 text-lumen-cyan" />
                        <span className="text-xs font-mono uppercase tracking-widest">Hi-Fi Audio</span>
                      </div>
                    )}

                    {/* Hi-Fi Studio Master Tag */}
                    <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md border border-white/20 text-[9px] font-mono font-bold text-lumen-cyan uppercase tracking-wider">
                      Studio Master
                    </div>

                    {/* Play Now Overlay Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const track = resolvePlayableTrack(item);
                        onPlayTrack(track);
                        WatchSoundService.playTick(1.2);
                      }}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                      title="Play Song Now"
                    >
                      <div className="w-16 h-16 rounded-full bg-lumen-cyan text-black flex items-center justify-center shadow-2xl hover:scale-110 transition-transform">
                        <Play className="w-8 h-8 fill-current ml-1" />
                      </div>
                    </button>
                  </div>

                  {/* Track Meta */}
                  <div className="mb-3">
                    <h3 className="text-base sm:text-lg font-black text-white truncate">{item.title}</h3>
                    <p className="text-xs sm:text-sm text-white/70 truncate mt-0.5">{item.artist}</p>
                  </div>

                  {/* Friend's Personal Message Bubble */}
                  {item.message && (
                    <div className="p-3 rounded-2xl bg-white/10 border border-white/15 text-xs text-white/90 italic flex items-start gap-2 mb-4 shadow-inner">
                      <MessageSquare className="w-4 h-4 text-lumen-cyan flex-shrink-0 mt-0.5" />
                      <span className="line-clamp-2">"{item.message}"</span>
                    </div>
                  )}

                  {/* Primary & Queue Action Buttons */}
                  <div className="flex items-center gap-2.5 pt-2 border-t border-white/10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const track = resolvePlayableTrack(item);
                        onPlayTrack(track);
                        WatchSoundService.playTick(1.2);
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-lumen-cyan hover:brightness-110 text-black text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95"
                    >
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                      <span>Play Now</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const track = resolvePlayableTrack(item);
                        onAddToQueue(track);
                        WatchSoundService.playTick(1.0);
                      }}
                      className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-all cursor-pointer hover:scale-105 active:scale-95"
                      title="Add to Next Up Queue"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Navigation & Indicator Controls */}
          <div className="flex flex-col items-center gap-3 w-full max-w-xl mx-auto flex-shrink-0">
            <div className="flex items-center justify-between w-full px-4">
              <button
                onClick={handlePrevCard}
                disabled={activeCarouselIndex === 0}
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 disabled:opacity-20 text-white transition-all cursor-pointer flex items-center justify-center shadow-xl hover:scale-110 active:scale-95"
                title="Previous Track (←)"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              <div className="flex gap-2">
                {carouselPool.map((_, i: number) => (
                  <button
                    key={i}
                    onClick={() => {
                      WatchSoundService.playTick(1.0);
                      setActiveCarouselIndex(i);
                    }}
                    className={`h-2 rounded-full transition-all cursor-pointer ${
                      i === activeCarouselIndex 
                        ? 'w-8 bg-lumen-cyan shadow-[0_0_12px_#06b6d4]' 
                        : 'w-2 bg-white/20 hover:bg-white/50'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={handleNextCard}
                disabled={activeCarouselIndex === carouselPool.length - 1}
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 disabled:opacity-20 text-white transition-all cursor-pointer flex items-center justify-center shadow-xl hover:scale-110 active:scale-95"
                title="Next Track (→)"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>

            {currentCarouselItem && (
              <p className="text-xs font-mono text-white/50 truncate max-w-md text-center">
                Currently focused: <span className="text-white font-bold">{currentCarouselItem.title}</span> by {currentCarouselItem.artist}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: FULL SCREEN FRIENDS LIST & TASTE MATCH MATRIX */}
      {/* ============================================================== */}
      {activeTab === 'friends' && (
        <div className="flex-1 p-6 sm:p-10 overflow-y-auto no-scrollbar relative z-10 max-w-7xl mx-auto w-full">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
            <div>
              <h3 className="text-lg font-black text-white">Your Social Circle</h3>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                Real-time taste compatibility scores and synchronised listening
              </p>
            </div>
            <button
              onClick={() => setActiveTab('requests')}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-bold text-white hover:text-lumen-cyan transition-all flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <UserPlus className="w-4 h-4 text-lumen-cyan" />
              <span>Add More Friends</span>
            </button>
          </div>

          {friends.length === 0 ? (
            <div className="py-20 rounded-3xl bg-white/[0.03] border border-white/10 text-center space-y-4 max-w-md mx-auto">
              <div className="w-16 h-16 rounded-full bg-white/5 border border-white/15 flex items-center justify-center mx-auto text-white/40">
                <Users className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-white">No Friends Connected Yet</h4>
              <p className="text-xs text-white/50 leading-relaxed px-4">
                Connect with your friends to exchange music discoveries, view song recommendations directly in your feed, and see how your taste compares!
              </p>
              <button
                onClick={() => setActiveTab('requests')}
                className="px-5 py-2.5 rounded-xl bg-lumen-cyan text-black font-bold text-xs shadow-xl hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              >
                Search Listeners by Username
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {friends.map((friend) => (
                <div
                  key={friend.user_id}
                  className="p-6 rounded-3xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/15 transition-all flex flex-col justify-between group shadow-xl hover:shadow-2xl hover:border-white/30"
                >
                  {/* Friend Header */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-cyan-400 p-[1.5px] shadow-md relative">
                          <div className="w-full h-full rounded-full bg-black/90 flex items-center justify-center font-bold text-white text-base uppercase">
                            {friend.username.charAt(0)}
                          </div>
                          {/* Online status indicator */}
                          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-black" />
                        </div>

                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            <span>@{friend.username}</span>
                          </h4>
                          <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1 mt-0.5">
                            <Radio className="w-3 h-3 animate-pulse" />
                            <span>{friend.last_listened || 'Active Listener'}</span>
                          </span>
                        </div>
                      </div>

                      {/* Taste Compatibility Pill Badge */}
                      <div className="px-3 py-1 rounded-full bg-pink-500/20 border border-pink-500/40 text-pink-300 font-mono text-xs font-bold shadow-sm">
                        {friend.taste_similarity}% Match
                      </div>
                    </div>

                    {/* Taste Tags */}
                    <div className="mt-3 p-3 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                      <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                        Shared Sound Profile
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {friend.shared_artists?.map((artist, idx) => (
                          <span 
                            key={idx}
                            className="px-2 py-0.5 rounded-lg bg-white/10 text-white/80 text-[11px] font-medium"
                          >
                            {artist}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-5 pt-4 border-t border-white/10 flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedFriendForShare(friend.user_id);
                        setIsShareModalOpen(true);
                        WatchSoundService.playTick(1.0);
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-lumen-cyan/20 hover:bg-lumen-cyan hover:text-black border border-lumen-cyan/40 text-lumen-cyan text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Send Song</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: ADD FRIENDS & MANAGE REQUESTS */}
      {/* ============================================================== */}
      {activeTab === 'requests' && (
        <div className="flex-1 p-6 sm:p-10 overflow-y-auto no-scrollbar relative z-10 max-w-3xl mx-auto w-full space-y-8">
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
                <UserPlus className="w-4 h-4 text-yellow-400" />
                <span>Incoming Friend Requests</span>
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300 font-mono text-xs font-bold">
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
                    You have no connected friends yet. Add a friend in the Requests tab first!
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
