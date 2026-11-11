import React, { useState, useEffect } from 'react';
import { Play, Pause, ListPlus, Radio, Music2, Disc3 } from 'lucide-react';
import { Track } from '../../../types/music';
import { FriendProfileData } from './friendsTypes';
import { extractDominantColor } from '../../../services/colorSampler';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  friend: FriendProfileData;
  onPlayTrack: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onSelectFriend: (friend: FriendProfileData) => void;
  isCurrentlyPlayingTrack?: boolean;
}

const colorCache = new Map<string, string>();

export const ListeningActivityCard: React.FC<Props> = ({
  friend,
  onPlayTrack,
  onAddToQueue,
  onSelectFriend,
  isCurrentlyPlayingTrack = false
}) => {
  const track = friend.currentTrack;
  const [accentColor, setAccentColor] = useState<string>('#06b6d4');

  useEffect(() => {
    if (!track?.artworkUrl) return;

    if (colorCache.has(track.artworkUrl)) {
      setAccentColor(colorCache.get(track.artworkUrl)!);
      return;
    }

    let isMounted = true;
    extractDominantColor(track.artworkUrl)
      .then((sample) => {
        if (isMounted && sample?.dominant) {
          colorCache.set(track.artworkUrl!, sample.dominant);
          setAccentColor(sample.dominant);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [track?.artworkUrl]);

  if (!track) return null;

  const initial = (friend.displayName || friend.username || 'U').charAt(0).toUpperCase();

  return (
    <div 
      className="relative rounded-2xl sm:rounded-3xl p-4 sm:p-5 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-white/[0.01] border border-white/10 hover:border-white/20 backdrop-blur-2xl transition-all duration-300 group overflow-hidden shadow-xl"
      style={{
        boxShadow: `0 12px 30px -10px rgba(0,0,0,0.7), inset 0 1px 1px 0 rgba(255,255,255,0.1), 0 0 24px -8px ${accentColor}30`
      }}
    >
      {/* Ambient Artwork Color Glow */}
      <div 
        className="pointer-events-none absolute -right-10 -bottom-10 w-44 h-44 rounded-full filter blur-3xl opacity-25 group-hover:opacity-40 transition-opacity duration-500"
        style={{ backgroundColor: accentColor }}
      />

      {/* Header: Friend Avatar, Display Name, Status Pill */}
      <div className="flex items-center justify-between gap-3 mb-3.5 relative z-10">
        <button
          type="button"
          onClick={() => onSelectFriend(friend)}
          className="flex items-center gap-2.5 min-w-0 text-left group/user cursor-pointer focus:outline-none"
        >
          <InitialAvatar 
            name={friend.displayName || friend.username} 
            size="sm" 
            isOnline={friend.isOnline}
            accentColor={accentColor}
          />
          <div className="min-w-0">
            <div className="text-xs font-bold text-white group-hover/user:text-lumen-cyan transition-colors truncate">
              {friend.displayName || friend.username}
            </div>
            <div className="text-[10px] text-white/40 truncate">@{friend.username}</div>
          </div>
        </button>

        {/* Status Pill */}
        <div 
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border backdrop-blur-md"
          style={{
            backgroundColor: `${accentColor}15`,
            borderColor: `${accentColor}35`,
            color: accentColor
          }}
        >
          <Radio className="w-3 h-3 animate-pulse" />
          <span>{friend.isPlaying ? 'Listening now' : 'Recent'}</span>
        </div>
      </div>

      {/* Track Body: Artwork + Details + Play Transport */}
      <div className="flex items-center gap-3.5 relative z-10">
        {/* Album Artwork */}
        <div 
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-black/60 border border-white/15 shadow-lg flex-shrink-0 relative group/art cursor-pointer"
          onClick={() => onPlayTrack(track)}
          title={`Play "${track.title}"`}
        >
          <CoverImage
            src={track.artworkUrl || null}
            alt={track.title}
            title={track.title}
            artist={track.artist}
            album={track.album}
            size={200}
            className="w-full h-full object-cover transition-transform duration-300 group-hover/art:scale-105"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/art:opacity-100 flex items-center justify-center transition-opacity">
            <Play className="w-6 h-6 fill-white text-white drop-shadow-md" />
          </div>
        </div>

        {/* Title, Artist, Album */}
        <div className="min-w-0 flex-1">
          <h4 
            className="text-sm font-bold text-white truncate tracking-tight group-hover:text-white transition-colors"
            title={track.title}
          >
            {track.title}
          </h4>
          <p className="text-xs text-white/60 truncate mt-0.5" title={track.artist}>
            {track.artist}
          </p>
          {track.album && (
            <p className="text-[11px] text-white/40 truncate mt-0.5" title={track.album}>
              {track.album}
            </p>
          )}
        </div>

        {/* Actions: Add to Queue & Play Button */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => onAddToQueue(track)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer"
            title="Add track to queue"
          >
            <ListPlus className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onPlayTrack(track)}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white shadow-lg active:scale-95 hover:scale-105 transition-all duration-300 cursor-pointer"
            style={{
              backgroundColor: accentColor,
              boxShadow: `0 4px 18px ${accentColor}60`
            }}
            title={isCurrentlyPlayingTrack ? 'Pause' : `Play "${track.title}"`}
          >
            {isCurrentlyPlayingTrack ? (
              <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-white" />
            ) : (
              <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-white ml-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
