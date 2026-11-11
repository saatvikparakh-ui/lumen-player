import React from 'react';
import { Heart, Share2, ListPlus, Disc3, Clock, Sparkles } from 'lucide-react';
import { FriendActivityEvent } from './friendsTypes';
import { Track } from '../../../types/music';

interface Props {
  events: FriendActivityEvent[];
  onPlayTrack?: (track: Track) => void;
  onSelectFriend: (userId: string, username: string) => void;
  dominantColor: string;
}

const formatRelativeTime = (timestamp: number): string => {
  if (!timestamp) return 'Recent';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const FriendsActivityFeed: React.FC<Props> = ({
  events,
  onPlayTrack,
  onSelectFriend,
  dominantColor
}) => {
  if (events.length === 0) {
    return (
      <div className="w-full rounded-2xl sm:rounded-3xl p-4 sm:p-5 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-white/[0.01] border border-white/10 text-center py-6 text-white/40">
        <Sparkles className="w-5 h-5 mx-auto mb-2 opacity-30 text-lumen-cyan" />
        <p className="text-xs font-medium text-white/60">No recent activity</p>
        <p className="text-[10px] text-white/40 mt-0.5">Friends' likes, shares, and tier lists will stream here</p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl sm:rounded-3xl p-4 sm:p-5 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-white/[0.01] border border-white/10 backdrop-blur-2xl shadow-xl">
      <div className="flex items-center justify-between mb-3.5">
        <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
          Friends Activity
        </h4>
        <span className="text-[10px] font-mono text-white/40">Live stream</span>
      </div>

      <div className="space-y-3">
        {events.slice(0, 5).map((evt) => {
          const initial = (evt.displayName || evt.username || 'U').charAt(0).toUpperCase();

          return (
            <div 
              key={evt.id} 
              className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 transition-all text-xs"
            >
              {/* Avatar */}
              <button
                type="button"
                onClick={() => onSelectFriend(evt.userId, evt.username)}
                className="w-7 h-7 rounded-full overflow-hidden bg-black/60 border border-white/15 flex-shrink-0 flex items-center justify-center cursor-pointer focus:outline-none"
              >
                {evt.photoURL ? (
                  <img src={evt.photoURL} alt={evt.displayName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] font-bold text-white/80">{initial}</span>
                )}
              </button>

              {/* Event Text */}
              <div className="min-w-0 flex-1">
                <div className="text-white/80 leading-snug">
                  <span 
                    onClick={() => onSelectFriend(evt.userId, evt.username)}
                    className="font-bold text-white hover:text-lumen-cyan cursor-pointer transition-colors"
                  >
                    {evt.displayName || evt.username}
                  </span>{' '}
                  {evt.type === 'liked' && 'liked a song'}
                  {evt.type === 'shared_song' && 'shared a new track'}
                  {evt.type === 'shared_playlist' && 'shared a playlist'}
                  {evt.type === 'ranked_tier' && 'updated their Tier List'}
                  {evt.type === 'listening' && 'started listening to'}
                </div>

                {/* Subtitle / Track details */}
                {evt.track && (
                  <button
                    type="button"
                    onClick={() => onPlayTrack && onPlayTrack(evt.track!)}
                    className="flex items-center gap-1.5 mt-1 text-[11px] text-lumen-cyan/90 hover:text-lumen-cyan transition-colors truncate max-w-full text-left cursor-pointer"
                  >
                    <Disc3 className="w-3 h-3 flex-shrink-0" />
                    <span className="font-semibold truncate">{evt.track.title}</span>
                    <span className="text-white/40 truncate">• {evt.track.artist}</span>
                  </button>
                )}

                {evt.playlistName && (
                  <div className="text-[11px] text-white/50 truncate mt-0.5">
                    📁 {evt.playlistName}
                  </div>
                )}

                <div className="text-[9px] font-mono text-white/35 mt-1 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{formatRelativeTime(evt.timestamp)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
