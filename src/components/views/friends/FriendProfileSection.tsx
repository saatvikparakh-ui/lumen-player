import React, { useState, useEffect } from 'react';
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
  Shuffle
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../../types/music';
import { FriendProfileData } from './friendsTypes';
import { FirestoreService } from '../../../services/firestoreService';
import { PlaylistService } from '../../../services/playlistService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  friend: FriendProfileData;
  onBack: () => void;
  onPlayTrack: (track: Track) => void;
  onPlayPlaylist: (playlist: CustomPlaylist) => void;
  onOpenShareSong: (friendUsername: string) => void;
  onOpenTierListCompare: (friend: FriendProfileData) => void;
  onRemoveFriend: (friendId: string) => void;
  dominantColor: string;
}

export const FriendProfileSection: React.FC<Props> = ({
  friend,
  onBack,
  onPlayTrack,
  onPlayPlaylist,
  onOpenShareSong,
  onOpenTierListCompare,
  onRemoveFriend,
  dominantColor
}) => {
  const [playlists, setPlaylists] = useState<CustomPlaylist[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [ratings, setRatings] = useState<Record<string, string | null>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setIsLoadingPlaylists(true);
    FirestoreService.getUserPlaylists(friend.userId)
      .then((res) => {
        setPlaylists(res?.playlists || []);
      })
      .catch(() => setPlaylists([]))
      .finally(() => setIsLoadingPlaylists(false));

    FirestoreService.getUserRatings(friend.userId)
      .then((r) => setRatings(r || {}))
      .catch(() => setRatings({}));
  }, [friend.userId]);

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
                className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 transition-all group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                    <CoverImage
                      src={pl.coverUrl || null}
                      alt={pl.name}
                      title={pl.name}
                      size={100}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs sm:text-sm font-bold text-white truncate">{pl.name}</h5>
                    <p className="text-[11px] text-white/50 truncate mt-0.5">
                      {pl.tracks?.length || 0} tracks
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSavePlaylist(pl)}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer"
                    title="Save to My Library"
                  >
                    <FolderPlus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onPlayPlaylist(pl)}
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
