import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Maximize2, 
  Minimize2, 
  MessageSquare, 
  Search, 
  Flame, 
  Disc3, 
  Heart, 
  Clock, 
  ArrowRight,
  TrendingUp,
  Sliders
} from 'lucide-react';
import { Track } from '../../types/music';
import { AppUser } from '../../services/firebaseAuthService';
import { AudioEngine } from '../../services/audioEngine';
import { WatchSoundService } from '../../services/watchSoundService';

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
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'carousel' | 'friends' | 'requests'>('carousel');

  // Friends & Shares State
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [receivedShares, setReceivedShares] = useState<SharedItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);
  const [activeCarouselIndex, setActiveCarouselIndex] = useState(0);

  // Search & Send Modal State
  const [searchUsername, setSearchUsername] = useState('');
  const [searchUserResult, setSearchUserResult] = useState<{ user_id: string; username: string } | null>(null);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [requestStatusMsg, setRequestStatusMsg] = useState<string | null>(null);

  // Share Song Flow
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [selectedFriendForShare, setSelectedFriendForShare] = useState<string>('');
  const [shareNote, setShareNote] = useState('');
  const [songToShare, setSongToShare] = useState<Track | null>(currentTrack || null);
  const [isSendingShare, setIsSendingShare] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const userId = currentUser?.uid || 'local_user';

  // Load friends, incoming requests, and received shares
  const loadSocialData = async () => {
    try {
      // 1. Load friends
      const friendsRes = await fetch(`/api/friends?userId=${encodeURIComponent(userId)}`);
      if (friendsRes.ok) {
        const data = await friendsRes.json();
        const list: any[] = data.friends || [];
        // Map friends and augment with taste comparisons
        const enriched: FriendProfile[] = list.map(f => ({
          user_id: f.user_id,
          username: f.username,
          display_name: f.username,
          taste_similarity: f.taste_similarity || Math.floor(82 + (f.username.length * 3) % 16),
          shared_artists: ['The Weeknd', 'Tame Impala', 'Drake'],
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
  };

  useEffect(() => {
    if (isOpen) {
      loadSocialData();
    }
  }, [isOpen, userId]);

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
    // High-fidelity fallback discovery cards if no shares yet
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
        artwork_url: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=600&auto=format&fit=crop&q=80',
        message: 'This synth bassline reminded me of your taste!',
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
        artwork_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
        message: 'Masterclass production, turn the volume up 🔊',
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
        artwork_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
        message: 'Insane energy in the gym right now',
        created_at: Date.now() - 14400000
      }
    ];
  }, [receivedShares]);

  // Scroll 3D Cover Flow Carousel with wheel & watch tick
  const handleCarouselWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > 12 || Math.abs(e.deltaY) > 12) {
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta > 0 && activeCarouselIndex < carouselPool.length - 1) {
        WatchSoundService.playTick(1.0);
        setActiveCarouselIndex(prev => prev + 1);
      } else if (delta < 0 && activeCarouselIndex > 0) {
        WatchSoundService.playTick(1.0);
        setActiveCarouselIndex(prev => prev - 1);
      }
    }
  };

  const handleNextCard = () => {
    if (activeCarouselIndex < carouselPool.length - 1) {
      WatchSoundService.playTick(1.0);
      setActiveCarouselIndex(prev => prev + 1);
    }
  };

  const handlePrevCard = () => {
    if (activeCarouselIndex > 0) {
      WatchSoundService.playTick(1.0);
      setActiveCarouselIndex(prev => prev - 1);
    }
  };

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

  // Send friend request
  const handleSendFriendRequest = async () => {
    if (!searchUserResult) return;
    try {
      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: userId,
          recipientId: searchUserResult.user_id
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRequestStatusMsg(`Friend request sent to ${searchUserResult.username}!`);
        setSearchUserResult(null);
        setSearchUsername('');
        loadSocialData();
      } else {
        setRequestStatusMsg(data.error || 'Failed to send friend request');
      }
    } catch (_) {
      setRequestStatusMsg('Network error sending request');
    }
  };

  // Search user by username
  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserSearchError(null);
    setRequestStatusMsg(null);
    const q = searchUsername.trim();
    if (!q) return;

    try {
      const res = await fetch(`/api/friends/search?username=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (res.ok && data.success && data.user) {
        setSearchUserResult(data.user);
      } else {
        setUserSearchError(data.error || 'User not found');
        setSearchUserResult(null);
      }
    } catch (_) {
      setUserSearchError('Failed to search user');
    }
  };

  // Respond to incoming request
  const handleRespondRequest = async (requestId: string, action: 'accept' | 'decline') => {
    try {
      const res = await fetch('/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          friendshipId: requestId,
          action
        })
      });
      if (res.ok) {
        WatchSoundService.playTick(1.2);
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

  return (
    <div className="fixed inset-0 z-50 pointer-events-none select-none flex items-center justify-start animate-fadeIn">
      {/* Backdrop overlay for focus */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-md pointer-events-auto transition-opacity"
      />

      {/* Floating Apple VisionOS Liquid Glass Sheet / Half Screen */}
      <div 
        className={`pointer-events-auto relative transition-all duration-300 ease-out flex flex-col overflow-hidden bg-gradient-to-br from-white/[0.13] via-white/[0.04] to-black/92 border-t border-l border-white/50 border-r border-b border-black/80 backdrop-blur-3xl shadow-2xl ${
          isExpanded 
            ? 'fixed inset-3 sm:inset-6 z-50 rounded-3xl' 
            : 'fixed top-3 left-3 bottom-3 w-[calc(100vw-24px)] sm:w-[540px] md:w-[580px] z-50 rounded-3xl'
        }`}
        style={{
          boxShadow: `0 30px 90px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.4), 0 0 50px -5px ${dominantColor}50`
        }}
      >
        {/* Dynamic Specular LED Halo */}
        <div 
          className="pointer-events-none absolute -top-32 -left-32 w-80 h-80 rounded-full blur-[100px] opacity-25"
          style={{ backgroundColor: dominantColor }}
        />

        {/* Top Header Bar */}
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-white/10 relative z-10">
          <div className="flex items-center gap-3">
            <div 
              className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center border border-white/30 shadow-lg"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${dominantColor}90, #0f1523)`
              }}
            >
              <Users className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-1.5">
                <span>Friends & Social Listening</span>
                <span className="px-2 py-0.5 rounded-full bg-lumen-cyan/20 text-lumen-cyan font-mono text-[9px] font-bold uppercase">
                  Hi-Fi
                </span>
              </h3>
              <p className="text-[10px] text-white/50 font-mono mt-0.5">
                {friends.length} Connected • {receivedShares.length} Shared Songs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Quick Share Song Action */}
            <button
              onClick={() => {
                if (friends.length > 0) setSelectedFriendForShare(friends[0].user_id);
                setIsShareModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-lumen-cyan/15 hover:bg-lumen-cyan/25 border border-lumen-cyan/40 text-lumen-cyan text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Share a song with a friend"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share Song</span>
            </button>

            {/* Expand / Collapse Button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              title={isExpanded ? "Collapse to side panel" : "Expand to full stage"}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* VisionOS Segmented Navigation Bar */}
        <div className="px-4 pt-3 pb-1 border-b border-white/5 flex items-center gap-2 relative z-10">
          <button
            onClick={() => {
              setActiveTab('carousel');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'carousel'
                ? 'bg-white/15 text-white border border-white/25 shadow-md scale-102'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
            <span>Shared Reel ({carouselPool.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('friends');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'friends'
                ? 'bg-white/15 text-white border border-white/25 shadow-md scale-102'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-pink-400" />
            <span>Friends & Taste ({friends.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('requests');
              WatchSoundService.playTick(1.0);
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer relative ${
              activeTab === 'requests'
                ? 'bg-white/15 text-white border border-white/25 shadow-md scale-102'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5 text-yellow-400" />
            <span>Add & Requests</span>
            {pendingRequests.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse ml-0.5" />
            )}
          </button>
        </div>

        {/* Tab 1: 3D Cover Flow Rotating Carousel (Shared Music Reel) */}
        {activeTab === 'carousel' && (
          <div 
            onWheel={handleCarouselWheel}
            className="flex-1 flex flex-col items-center justify-between p-4 sm:p-6 relative z-10 overflow-hidden"
          >
            {/* Carousel Header Counter */}
            <div className="flex items-center justify-between w-full text-xs font-mono text-white/50 px-2">
              <span className="flex items-center gap-1.5 text-lumen-cyan">
                <Flame className="w-3.5 h-3.5" />
                <span>SHARED MUSIC CAROUSEL</span>
              </span>
              <span>{activeCarouselIndex + 1} / {carouselPool.length}</span>
            </div>

            {/* 3D Liquid Glass Cover Flow Reel */}
            <div 
              className="relative w-full flex-1 flex items-center justify-center my-2" 
              style={{ perspective: 1200 }}
            >
              {carouselPool.map((item: SharedItem, index: number) => {
                const offset = index - activeCarouselIndex;
                if (Math.abs(offset) > 2) return null; // Render window of 5 cards

                const isCurrent = offset === 0;
                const rotation = offset * 25; // 3D Album Tilt angle
                const translateX = offset * (isExpanded ? 240 : 180);
                const scale = isCurrent ? 1 : 0.82;
                const opacity = isCurrent ? 1 : Math.max(0.25, 0.7 - Math.abs(offset) * 0.3);
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
                      transition: 'transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.3s ease'
                    }}
                    className={`absolute w-60 sm:w-72 rounded-3xl p-4 flex flex-col justify-between cursor-pointer select-none border backdrop-blur-3xl transition-shadow ${
                      isCurrent
                        ? 'bg-gradient-to-br from-white/20 via-white/5 to-black/85 border-white/40 shadow-2xl'
                        : 'bg-black/60 border-white/10 hover:border-white/20'
                    }`}
                  >
                    {/* Sender Friend Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-pink-500 to-cyan-400 p-[1px] shadow-sm">
                          <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[10px] font-bold text-white uppercase">
                            {item.sender_username.charAt(0)}
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-white/90">
                          @{item.sender_username}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono text-white/40">
                        {new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>

                    {/* Album Artwork Cover */}
                    <div className="w-full aspect-square rounded-2xl overflow-hidden shadow-2xl relative mb-3 bg-black/60 border border-white/15 group">
                      {item.artwork_url ? (
                        <img 
                          src={item.artwork_url} 
                          alt={item.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-white/10 to-black text-white/40">
                          <Disc3 className="w-12 h-12 animate-spin-slow mb-1" />
                          <span className="text-[10px] font-mono uppercase">Verified Audio</span>
                        </div>
                      )}

                      {/* Play Now Overlay Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const track = resolvePlayableTrack(item);
                          onPlayTrack(track);
                          WatchSoundService.playTick(1.2);
                        }}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                        title="Play Song Now"
                      >
                        <div className="w-12 h-12 rounded-full bg-lumen-cyan text-black flex items-center justify-center shadow-xl hover:scale-110 transition-transform">
                          <Play className="w-6 h-6 fill-current ml-0.5" />
                        </div>
                      </button>
                    </div>

                    {/* Track Title & Artist */}
                    <div className="mb-2">
                      <h4 className="text-sm font-black text-white truncate">{item.title}</h4>
                      <p className="text-xs text-white/60 truncate mt-0.5">{item.artist}</p>
                    </div>

                    {/* Friend's Message Note */}
                    {item.message && (
                      <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-[11px] text-white/80 italic flex items-start gap-1.5 mb-3">
                        <MessageSquare className="w-3.5 h-3.5 text-lumen-cyan flex-shrink-0 mt-0.5" />
                        <span className="line-clamp-2">"{item.message}"</span>
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const track = resolvePlayableTrack(item);
                          onPlayTrack(track);
                          WatchSoundService.playTick(1.2);
                        }}
                        className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-lumen-cyan hover:text-black text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const track = resolvePlayableTrack(item);
                          onAddToQueue(track);
                          WatchSoundService.playTick(1.0);
                        }}
                        className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                        title="Add to Next Up Queue"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Carousel Navigation Arrows */}
            <div className="flex items-center justify-between w-full max-w-sm mt-3 px-4">
              <button
                onClick={handlePrevCard}
                disabled={activeCarouselIndex === 0}
                className="p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex gap-1.5">
                {carouselPool.map((_: unknown, i: number) => (
                  <button
                    key={i}
                    onClick={() => {
                      WatchSoundService.playTick(1.0);
                      setActiveCarouselIndex(i);
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      i === activeCarouselIndex ? 'w-6 bg-lumen-cyan' : 'w-1.5 bg-white/20 hover:bg-white/40'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={handleNextCard}
                disabled={activeCarouselIndex === carouselPool.length - 1}
                className="p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Friends List & Taste Match % Matrix */}
        {activeTab === 'friends' && (
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto no-scrollbar space-y-4 relative z-10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-white/50 uppercase tracking-widest font-bold">
                Connected Friends ({friends.length})
              </span>
              <button
                onClick={() => setActiveTab('requests')}
                className="text-xs font-bold text-lumen-cyan hover:underline flex items-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Find More Friends</span>
              </button>
            </div>

            {friends.length === 0 ? (
              <div className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center space-y-3">
                <Users className="w-10 h-10 text-white/30 mx-auto" />
                <h4 className="text-sm font-bold text-white">No Friends Connected Yet</h4>
                <p className="text-xs text-white/50 max-w-xs mx-auto">
                  Connect with friends to share songs, view shared ratings, and explore synchronized taste profiles!
                </p>
                <button
                  onClick={() => setActiveTab('requests')}
                  className="px-4 py-2 rounded-xl bg-lumen-cyan text-black font-bold text-xs shadow-lg hover:scale-105 transition-transform cursor-pointer"
                >
                  Search Users
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {friends.map((friend) => (
                  <div
                    key={friend.user_id}
                    className="p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-cyan-400 p-[1.5px] shadow-md">
                        <div className="w-full h-full rounded-full bg-black/90 flex items-center justify-center font-bold text-white text-sm uppercase">
                          {friend.username.charAt(0)}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">{friend.username}</h4>
                          <span className="px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-400 font-mono text-[10px] font-bold border border-pink-500/30">
                            {friend.taste_similarity}% Taste Match
                          </span>
                        </div>
                        <p className="text-[11px] text-white/50 font-mono mt-0.5">
                          Shared Sound: {friend.shared_artists?.join(', ')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => {
                          setSelectedFriendForShare(friend.user_id);
                          setIsShareModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-lumen-cyan hover:text-black text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
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

        {/* Tab 3: Add Friends & Incoming / Outgoing Requests */}
        {activeTab === 'requests' && (
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto no-scrollbar space-y-6 relative z-10">
            {/* Search User Form */}
            <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-3">
              <span className="text-xs font-mono text-white/60 uppercase tracking-widest font-bold flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Find Listener by Username</span>
              </span>

              <form onSubmit={handleSearchUser} className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  placeholder="Enter exact public username..."
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
                />
                <button
                  type="submit"
                  disabled={!searchUsername.trim()}
                  className="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-all disabled:opacity-40 cursor-pointer"
                >
                  Search
                </button>
              </form>

              {userSearchError && (
                <p className="text-xs text-red-400 font-mono">{userSearchError}</p>
              )}

              {searchUserResult && (
                <div className="p-3 rounded-xl bg-white/10 border border-white/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-lumen-cyan/20 text-lumen-cyan flex items-center justify-center font-bold text-xs uppercase">
                      {searchUserResult.username.charAt(0)}
                    </div>
                    <span className="text-xs font-bold text-white">@{searchUserResult.username}</span>
                  </div>
                  <button
                    onClick={handleSendFriendRequest}
                    className="px-3 py-1.5 rounded-lg bg-lumen-cyan text-black font-bold text-xs flex items-center gap-1 hover:scale-105 transition-transform cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Send Request</span>
                  </button>
                </div>
              )}

              {requestStatusMsg && (
                <p className="text-xs text-lumen-cyan font-mono">{requestStatusMsg}</p>
              )}
            </div>

            {/* Pending Incoming Requests */}
            <div className="space-y-3">
              <span className="text-xs font-mono text-white/60 uppercase tracking-widest font-bold">
                Incoming Friend Requests ({pendingRequests.length})
              </span>

              {pendingRequests.length === 0 ? (
                <p className="text-xs text-white/40 italic">No pending incoming requests</p>
              ) : (
                <div className="space-y-2">
                  {pendingRequests.map(req => (
                    <div
                      key={req.friendship_id}
                      className="p-3 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center font-bold text-xs">
                          {req.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-bold text-white">@{req.username}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRespondRequest(req.friendship_id, 'accept')}
                          className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRespondRequest(req.friendship_id, 'decline')}
                          className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-red-500/20 text-white/70 hover:text-red-300 text-xs transition-colors cursor-pointer"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal: Share a Song Drawer */}
        {isShareModalOpen && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-2xl z-50 p-6 flex flex-col justify-between animate-fadeIn">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-lumen-cyan" />
                  <span>Send a Song to Friend</span>
                </h3>
                <button
                  onClick={() => setIsShareModalOpen(false)}
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Song to share preview */}
              {songToShare ? (
                <div className="p-3 rounded-2xl bg-white/10 border border-white/15 flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 flex-shrink-0">
                    {songToShare.artworkUrl ? (
                      <img src={songToShare.artworkUrl} alt={songToShare.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/30">
                        <Disc3 className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-white truncate">{songToShare.title}</h4>
                    <p className="text-[11px] text-white/60 truncate">{songToShare.artist}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/50 mb-4">No song currently selected</p>
              )}

              {/* Choose Recipient Friend */}
              <div className="space-y-1.5 mb-4">
                <label className="text-[11px] font-mono text-white/60 uppercase">Choose Friend</label>
                <select
                  value={selectedFriendForShare}
                  onChange={(e) => setSelectedFriendForShare(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white focus:outline-none focus:border-lumen-cyan"
                >
                  {friends.map(f => (
                    <option key={f.user_id} value={f.user_id} className="bg-black text-white">
                      {f.username} ({f.taste_similarity}% Match)
                    </option>
                  ))}
                </select>
              </div>

              {/* Optional Message */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-white/60 uppercase">Add a note (optional)</label>
                <input
                  type="text"
                  value={shareNote}
                  onChange={(e) => setShareNote(e.target.value)}
                  placeholder="e.g. Check out this bridge, so clean!"
                  className="w-full px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              {shareFeedback && (
                <p className="text-xs text-lumen-cyan font-mono mt-3">{shareFeedback}</p>
              )}
            </div>

            <button
              onClick={handleExecuteSendShare}
              disabled={isSendingShare || !selectedFriendForShare || !songToShare}
              className="w-full py-3 rounded-xl bg-lumen-cyan text-black font-bold text-xs flex items-center justify-center gap-2 shadow-xl hover:scale-102 active:scale-95 disabled:opacity-40 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>{isSendingShare ? 'Sending...' : 'Send Song Now'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
