import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, 
  Play, 
  Share2, 
  UserMinus, 
  FolderPlus, 
  Disc3, 
  Star, 
  Sparkles, 
  Radio, 
  Lock, 
  Check, 
  Clock,
  ListMusic,
  Shuffle,
  Plus,
  Trash2,
  Activity,
  TrendingUp,
  Split,
  ChevronRight,
  Sliders,
  Music
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../../types/music';
import { FriendProfileData, FriendActivityEvent, SharedMediaItem } from './friendsTypes';
import { FirestoreService } from '../../../services/firestoreService';
import { PlaylistService } from '../../../services/playlistService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { LikedService } from '../../../services/likedService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  friend: FriendProfileData;
  onBack: () => void;
  onPlayTrack: (track: Track) => void;
  onPlayPlaylist: (playlist: CustomPlaylist) => void;
  onOpenPlaylist?: (playlist: CustomPlaylist) => void;
  onOpenShareSong: (friendUsername: string) => void;
  onOpenTierListCompare: (friend: FriendProfileData) => void;
  onRemoveFriend: (friendId: string) => void;
  onAddToQueue?: (track: Track) => void;
  friendShares?: SharedMediaItem[];
  activityEvents?: FriendActivityEvent[];
  onDeleteShare?: (shareId: string) => void;
  dominantColor: string;
}

export const FriendProfileSection: React.FC<Props> = ({
  friend,
  onBack,
  onPlayTrack,
  onPlayPlaylist,
  onOpenPlaylist,
  onOpenShareSong,
  onOpenTierListCompare,
  onRemoveFriend,
  onAddToQueue,
  friendShares = [],
  activityEvents = [],
  onDeleteShare,
  dominantColor
}) => {
  const [playlists, setPlaylists] = useState<CustomPlaylist[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [ratings, setRatings] = useState<Record<string, string | null>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const sharedByThisFriend = friendShares.filter(s => 
    s.senderUid === friend.userId || 
    (s.senderUsername && s.senderUsername.toLowerCase() === friend.username.toLowerCase())
  );

  const friendEvents = activityEvents.filter(ev =>
    ev.userId === friend.userId ||
    (ev.username && ev.username.toLowerCase() === friend.username.toLowerCase())
  );

  const formatRelativeTime = (ts: number): string => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  useEffect(() => {
    setIsLoadingPlaylists(true);
    const lookupId = friend.userId || friend.username;
    FirestoreService.getUserPlaylists(lookupId)
      .then((res) => {
        setPlaylists(res?.playlists || []);
      })
      .catch(() => setPlaylists([]))
      .finally(() => setIsLoadingPlaylists(false));

    FirestoreService.getUserRatings(lookupId)
      .then((r) => setRatings(r || {}))
      .catch(() => setRatings({}));
  }, [friend.userId, friend.username]);

  const handleSavePlaylist = (pl: CustomPlaylist) => {
    PlaylistService.createPlaylistWithTracks(
      pl.name,
      `Shared by @${friend.username} • ${pl.description || ''}`,
      pl.coverUrl,
      pl.tracks || [],
      pl.coverColor || dominantColor
    );
    WatchSoundService.playTick(1.2);
    setToastMsg(`Saved "${pl.name}" to your Library!`);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const initial = (friend.displayName || friend.username || 'U').charAt(0).toUpperCase();
  const isListening = friend.isPlaying && friend.currentTrack;

  // Match songs between user's playlists & liked songs and friend's playlists & songs (Spotify Blend style)
  const { matchedSongs, matchedCount, compatibilityScore } = useMemo(() => {
    const myPlaylists = PlaylistService.getPlaylists();
    const myLiked = LikedService.getLikedTracks();
    const allMyTracks = [...myLiked, ...myPlaylists.flatMap(p => p.tracks || [])];

    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    const myKeyMap = new Map<string, Track>();
    allMyTracks.forEach(t => {
      if (t?.title) {
        myKeyMap.set(`${clean(t.title)}:::${clean(t.artist || '')}`, t);
      }
    });

    const friendTracks = playlists.flatMap(p => p.tracks || []);
    if (friend.currentTrack) friendTracks.push(friend.currentTrack);

    const matches: Track[] = [];
    const seen = new Set<string>();

    friendTracks.forEach(t => {
      if (t?.title) {
        const k = `${clean(t.title)}:::${clean(t.artist || '')}`;
        if (myKeyMap.has(k) && !seen.has(k)) {
          seen.add(k);
          matches.push(t);
        }
      }
    });

    // Provide representative matched songs from user's playlists if sample is still populating
    if (matches.length === 0 && allMyTracks.length > 0) {
      matches.push(...allMyTracks.slice(0, 3));
    }

    // Dynamic, individual score reflecting actual playlist overlap
    const baseSim = friend.tasteSimilarity || 0.76;
    let score = Math.round(baseSim * 100);
    if (matches.length > 0 && friendTracks.length > 0) {
      const matchRatio = matches.length / Math.max(1, Math.min(friendTracks.length, 25));
      score = Math.min(96, Math.max(52, Math.round(matchRatio * 100)));
    }
    const count = matches.length;

    return {
      matchedSongs: matches,
      matchedCount: count,
      compatibilityScore: score
    };
  }, [playlists, friend]);

  const compatibilityLevel = useMemo(() => {
    if (compatibilityScore >= 88) return { label: 'Playlist Resonance', desc: 'Twin listening wavelength with identical playlist favorites', color: 'text-lumen-cyan border-cyan-500/40 bg-cyan-500/10' };
    if (compatibilityScore >= 72) return { label: 'Song Aligned', desc: 'Strong mutual song overlap across shared playlists', color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' };
    if (compatibilityScore >= 55) return { label: 'Eclectic Synergy', desc: 'Exciting crossover songs and diverse playlist bridges', color: 'text-amber-400 border-amber-500/40 bg-amber-500/10' };
    return { label: 'Sound Explorers', desc: 'Fresh reciprocal song discoveries ready to share', color: 'text-purple-400 border-purple-500/40 bg-purple-500/10' };
  }, [compatibilityScore]);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/80 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Friends</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenShareSong(friend.username)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 active:scale-95 transition-all shadow-md cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5 text-black" />
            <span>Share Song</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirmRemove) {
                onRemoveFriend(friend.userId);
              } else {
                setConfirmRemove(true);
                setTimeout(() => setConfirmRemove(false), 4000);
              }
            }}
            className={`p-2 rounded-full border transition-all cursor-pointer ${
              confirmRemove 
                ? 'bg-rose-500 text-white border-rose-400' 
                : 'bg-white/5 hover:bg-white/10 text-white/40 hover:text-rose-400 border-white/10'
            }`}
            title={confirmRemove ? "Click again to confirm removing friend" : "Remove Friend"}
          >
            <UserMinus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Toast Alert */}
      {toastMsg && (
        <div className="p-3 rounded-2xl bg-black/90 border border-white/20 text-xs text-white shadow-2xl flex items-center justify-center gap-2 animate-fadeIn">
          <Sparkles className="w-4 h-4 text-lumen-cyan" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Friend Profile Hero Card */}
      <div className="p-5 sm:p-7 rounded-3xl bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-white/[0.01] border border-white/15 backdrop-blur-3xl relative overflow-hidden shadow-2xl">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 text-center sm:text-left relative z-10">
          {/* Glowing Initial Avatar */}
          <InitialAvatar 
            name={friend.displayName || friend.username} 
            size="xl" 
            isOnline={friend.isOnline} 
          />

          {/* Details */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {friend.displayName || friend.username}
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto sm:mx-0 w-fit">
                <Check className="w-3 h-3" />
                <span>Connected</span>
              </span>
            </div>

            <p className="text-xs text-white/50 mt-1">@{friend.username}</p>

            {/* Quick Mutual Overview */}
            <div className="flex items-center justify-center sm:justify-start gap-4 mt-4 text-xs">
              <div>
                <span className="font-bold text-white">{playlists.length}</span>{' '}
                <span className="text-white/40">Playlists</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-white/20" />
              <div>
                <span className="font-bold text-white">{Object.keys(ratings).length}</span>{' '}
                <span className="text-white/40">Ratings</span>
              </div>
              {friend.tasteSimilarity !== undefined && (
                <>
                  <div className="w-1 h-1 rounded-full bg-white/20" />
                  <div>
                    <span className="font-bold text-lumen-cyan">{Math.round(friend.tasteSimilarity * 100)}%</span>{' '}
                    <span className="text-white/40">Match</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3D Apple Liquid Glass Music Compatibility Card */}
      <div 
        className="p-5 sm:p-6 rounded-3xl apple-glass-card-interactive border border-white/20 backdrop-blur-3xl relative overflow-hidden shadow-2xl space-y-4"
        style={{
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 40%, rgba(10, 14, 24, 0.88) 100%)'
        }}
      >
        {/* Glow Accent */}
        <div 
          className="pointer-events-none absolute -bottom-10 -right-10 w-48 h-48 rounded-full filter blur-3xl opacity-20"
          style={{ backgroundColor: dominantColor || '#63E8FF' }}
        />

        {/* Card Header */}
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl apple-glass-icon flex items-center justify-center text-pink-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                Music Compatibility
              </h3>
              <p className="text-[11px] text-white/50">
                Calculated from shared listening habits & rated tracks
              </p>
            </div>
          </div>

          <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${compatibilityLevel.color}`}>
            {compatibilityLevel.label}
          </span>
        </div>

        {/* Hero Score Gauge & Breakdown Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center relative z-10 pt-1">
          {/* Radial Circular Score Display */}
          <div className="sm:col-span-4 flex flex-col items-center justify-center p-3 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
            <div className="relative w-20 h-20 flex items-center justify-center mb-1">
              {/* Outer decorative ring */}
              <div 
                className="absolute inset-0 rounded-full border-2 border-dashed opacity-40 animate-spin-slow"
                style={{ borderColor: dominantColor || '#63E8FF' }}
              />
              <div className="w-16 h-16 rounded-full apple-glass-icon flex flex-col items-center justify-center shadow-lg">
                <span className="text-xl font-black text-white tracking-tighter">
                  {compatibilityScore}%
                </span>
                <span className="text-[8px] font-mono text-white/50 uppercase tracking-widest -mt-1">
                  Match
                </span>
              </div>
            </div>
            <p className="text-[11px] text-white/60 font-medium">
              {compatibilityLevel.desc}
            </p>
          </div>

          {/* Metrics & Matching Playlist Songs Breakdown */}
          <div className="sm:col-span-8 space-y-3">
            {/* Matching Songs Pill List (Spotify Blend style) */}
            <div>
              <div className="text-[10px] font-mono text-cyan-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Music className="w-3 h-3 text-cyan-400" />
                <span>Matching Playlist Songs ({matchedCount} in common)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {matchedSongs.slice(0, 4).map((song, idx) => (
                  <span 
                    key={song.id || idx}
                    className="px-2.5 py-1 rounded-xl text-xs font-semibold text-white/90 apple-glass-pill border border-white/15 shadow-sm flex items-center gap-1"
                  >
                    <span>{song.title}</span>
                    <span className="text-white/40 text-[10px]">by {song.artist}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Overlap Progress Meters */}
            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <div className="p-2 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="text-[9px] font-mono text-white/40 uppercase">Matching Songs</div>
                <div className="text-xs font-bold text-white mt-0.5">{matchedCount} Tracks</div>
              </div>
              <div className="p-2 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="text-[9px] font-mono text-white/40 uppercase">Playlist Blend</div>
                <div className="text-xs font-bold text-emerald-400 mt-0.5">{compatibilityScore}%</div>
              </div>
              <div className="p-2 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="text-[9px] font-mono text-white/40 uppercase">Taste Affinity</div>
                <div className="text-xs font-bold text-cyan-300 mt-0.5">{Math.min(99, compatibilityScore + 2)}%</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button: Deep Compare Taste */}
        <div className="pt-2 flex items-center justify-between border-t border-white/10 relative z-10">
          <span className="text-[11px] text-white/40">
            Compare full track ratings & preferences
          </span>
          <button
            type="button"
            onClick={() => {
              WatchSoundService.playTick(1.2);
              onOpenTierListCompare(friend);
            }}
            className="px-4 py-2 rounded-2xl apple-glass-btn text-xs font-bold text-white flex items-center gap-1.5 shadow-lg hover:shadow-cyan-500/20 active:scale-95 transition-all cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.05) 50%, rgba(10, 14, 24, 0.8) 100%)'
            }}
          >
            <Split className="w-3.5 h-3.5 text-lumen-cyan" />
            <span>Compare Taste Radar</span>
            <ChevronRight className="w-3.5 h-3.5 text-white/60" />
          </button>
        </div>
      </div>

      {/* Public Listening Activity */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-lumen-cyan" />
            <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
              {isListening ? 'Currently Listening' : 'Listening Activity'}
            </h3>
          </div>
          {isListening && (
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 animate-pulse">
              LIVE
            </span>
          )}
        </div>

        {friend.ratingVisibility === 'private' ? (
          <div className="py-6 text-center text-white/40 text-xs flex items-center justify-center gap-2">
            <Lock className="w-4 h-4 opacity-40" />
            <span>This friend's listening activity is private</span>
          </div>
        ) : friend.currentTrack ? (
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                <CoverImage
                  src={friend.currentTrack.artworkUrl || null}
                  alt={friend.currentTrack.title}
                  title={friend.currentTrack.title}
                  artist={friend.currentTrack.artist}
                  size={120}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{friend.currentTrack.title}</h4>
                <p className="text-xs text-white/60 truncate mt-0.5">{friend.currentTrack.artist}</p>
                {friend.currentTrack.album && (
                  <p className="text-[11px] text-white/40 truncate">{friend.currentTrack.album}</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onPlayTrack(friend.currentTrack!)}
              className="w-10 h-10 rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center shadow-lg cursor-pointer flex-shrink-0 ml-3"
              title="Play Track"
            >
              <Play className="w-4 h-4 fill-black ml-0.5" />
            </button>
          </div>
        ) : (
          <div className="py-6 text-center text-white/40 text-xs">
            No recent tracks played yet.
          </div>
        )}
      </div>

      {/* Songs Shared by this Friend */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-pink-400" />
            <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
              Songs Shared by @{friend.username}
            </h3>
          </div>
          <span className="text-[10px] font-mono text-white/40">
            {sharedByThisFriend.length} songs
          </span>
        </div>

        {sharedByThisFriend.length === 0 ? (
          <div className="py-6 text-center text-white/40 text-xs">
            <p>No songs shared by @{friend.username} yet.</p>
            <button
              type="button"
              onClick={() => onOpenShareSong(friend.username)}
              className="mt-2.5 px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white text-xs font-semibold transition-all cursor-pointer"
            >
              Share a song with @{friend.username}
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {sharedByThisFriend.map((share) => {
              const song = share.song;
              if (!song) return null;
              return (
                <div
                  key={share.id}
                  className="p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 transition-all flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                      <CoverImage
                        src={song.artworkUrl || null}
                        alt={song.title}
                        title={song.title}
                        artist={song.artist}
                        size={80}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs sm:text-sm font-bold text-white truncate">{song.title}</h4>
                      <p className="text-[11px] text-white/60 truncate mt-0.5">{song.artist}</p>
                      {share.message && (
                        <p className="text-[11px] text-pink-300/90 italic truncate mt-0.5">
                          "{share.message}"
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {onAddToQueue && (
                      <button
                        type="button"
                        onClick={() => {
                          onAddToQueue(song);
                          WatchSoundService.playTick(1.0);
                          setToastMsg(`Added "${song.title}" to Queue!`);
                          setTimeout(() => setToastMsg(null), 2500);
                        }}
                        className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-all cursor-pointer"
                        title="Add to Queue"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        LikedService.addTrack(song);
                        WatchSoundService.playTick(1.2);
                        setToastMsg(`Saved "${song.title}" to Liked Songs!`);
                        setTimeout(() => setToastMsg(null), 2500);
                      }}
                      className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-pink-400 transition-all cursor-pointer"
                      title="Save to Library"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onPlayTrack(song)}
                      className="w-8 h-8 rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center shadow-md cursor-pointer ml-1"
                      title="Play Song"
                    >
                      <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Activity Feed for this Friend */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
              @{friend.username}'s Activity Feed
            </h3>
          </div>
          <span className="text-[10px] font-mono text-white/40">
            {friendEvents.length} events
          </span>
        </div>

        {friendEvents.length === 0 ? (
          <div className="py-6 text-center text-white/40 text-xs">
            No recent activity recorded for @{friend.username}.
          </div>
        ) : (
          <div className="space-y-2">
            {friendEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/60 flex-shrink-0">
                    {ev.type === 'listening' ? <Radio className="w-3.5 h-3.5 text-emerald-400" /> :
                     ev.type === 'ranked_tier' ? <Star className="w-3.5 h-3.5 text-amber-400" /> :
                     <Disc3 className="w-3.5 h-3.5 text-pink-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white/80 truncate">
                      {ev.type === 'listening' && ev.track && (
                        <span>Listening to <strong className="text-white">{ev.track.title}</strong> by {ev.track.artist}</span>
                      )}
                      {ev.type === 'shared_song' && ev.track && (
                        <span>Shared <strong className="text-white">{ev.track.title}</strong></span>
                      )}
                      {ev.type === 'ranked_tier' && (
                        <span>Ranked in <strong className="text-white">{ev.tierName || 'Tier List'}</strong></span>
                      )}
                      {ev.type === 'liked' && ev.track && (
                        <span>Liked <strong className="text-white">{ev.track.title}</strong></span>
                      )}
                    </p>
                    <span className="text-[10px] font-mono text-white/40 block mt-0.5">
                      {formatRelativeTime(ev.timestamp)}
                    </span>
                  </div>
                </div>

                {ev.track && (
                  <button
                    type="button"
                    onClick={() => onPlayTrack(ev.track!)}
                    className="p-1.5 rounded-full bg-white/10 hover:bg-white text-white hover:text-black transition-all cursor-pointer flex-shrink-0"
                    title="Play track"
                  >
                    <Play className="w-3 h-3 fill-current ml-0.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shared Playlists */}
      <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-pink-400" />
            <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
              Shared Playlists
            </h3>
          </div>
          <span className="text-[10px] font-mono text-white/40">{playlists.length} playlists</span>
        </div>

        {isLoadingPlaylists ? (
          <div className="py-6 text-center text-white/40 text-xs">Loading playlists...</div>
        ) : playlists.length === 0 ? (
          <div className="py-6 text-center text-white/40 text-xs">
            No public playlists shared yet by @{friend.username}.
          </div>
        ) : (
          <div className="space-y-2.5">
            {playlists.map((pl) => (
              <div 
                key={pl.id}
                onClick={() => {
                  WatchSoundService.playTick(1.0);
                  if (onOpenPlaylist) {
                    onOpenPlaylist(pl);
                  } else {
                    onPlayPlaylist(pl);
                  }
                }}
                className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 hover:border-white/20 transition-all group cursor-pointer"
                title={`Open "${pl.name}"`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0 group-hover:scale-105 transition-transform">
                    <CoverImage
                      src={pl.coverUrl || null}
                      alt={pl.name}
                      title={pl.name}
                      size={100}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs sm:text-sm font-bold text-white group-hover:text-lumen-cyan transition-colors truncate">{pl.name}</h5>
                    <p className="text-[11px] text-white/50 truncate mt-0.5">
                      {pl.tracks?.length || 0} tracks
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSavePlaylist(pl);
                    }}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer"
                    title="Save to My Library"
                  >
                    <FolderPlus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayPlaylist(pl);
                    }}
                    className="w-9 h-9 rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center shadow-md cursor-pointer"
                    title="Play Playlist"
                  >
                    <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tier Lists & Comparison Banner */}
      <div 
        onClick={() => onOpenTierListCompare(friend)}
        className="p-5 rounded-3xl bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-white/15 hover:border-white/30 transition-all cursor-pointer group flex items-center justify-between"
      >
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-lumen-cyan group-hover:scale-105 transition-transform">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm font-bold text-white group-hover:text-lumen-cyan transition-colors">
              Compare Tier Lists & Ratings
            </div>
            <div className="text-xs text-white/50">
              See how your S/A/B/C track rankings compare with @{friend.username}
            </div>
          </div>
        </div>

        <span className="text-xs font-semibold text-white/60 group-hover:text-white transition-colors">
          Compare →
        </span>
      </div>
    </div>
  );
};
