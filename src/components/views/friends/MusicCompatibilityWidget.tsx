import React from 'react';
import { Sparkles, Heart, Disc3, TrendingUp, Users } from 'lucide-react';
import { FriendProfileData } from './friendsTypes';
import { Track } from '../../../types/music';

interface Props {
  friends: FriendProfileData[];
  onSelectFriend: (friend: FriendProfileData) => void;
  userLikedTracks?: Track[];
  dominantColor: string;
}

export const MusicCompatibilityWidget: React.FC<Props> = ({
  friends,
  onSelectFriend,
  userLikedTracks = [],
  dominantColor
}) => {
  // Find friend with highest real taste similarity or shared artists
  const topMatch = friends.length > 0
    ? [...friends].sort((a, b) => (b.tasteSimilarity || 0) - (a.tasteSimilarity || 0))[0]
    : null;

  const score = topMatch?.tasteSimilarity ? Math.round(topMatch.tasteSimilarity * 100) : 0;
  const initial = (topMatch?.displayName || topMatch?.username || 'U').charAt(0).toUpperCase();

  return (
    <div 
      className="w-full rounded-2xl sm:rounded-3xl p-4 sm:p-5 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-white/[0.01] border border-white/10 relative overflow-hidden backdrop-blur-2xl shadow-xl"
    >
      {/* Background Accent Glow */}
      <div 
        className="pointer-events-none absolute -left-6 -bottom-6 w-32 h-32 rounded-full filter blur-2xl opacity-20"
        style={{ backgroundColor: dominantColor }}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-3.5 relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
            Music Compatibility
          </h4>
        </div>

        <span className="text-[10px] font-mono text-white/40">Real Data Match</span>
      </div>

      {!topMatch ? (
        <div className="text-center py-4 text-white/40">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30 text-lumen-cyan" />
          <p className="text-xs font-medium text-white/60">Connect with friends to see taste compatibility</p>
          <p className="text-[10px] text-white/40 mt-0.5">Calculated from shared artists, genres, and ratings</p>
        </div>
      ) : (
        <div className="relative z-10">
          {/* Top Match Profile Strip */}
          <div 
            onClick={() => onSelectFriend(topMatch)}
            className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all cursor-pointer group mb-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-black/60 border border-white/20 flex items-center justify-center flex-shrink-0">
                {topMatch.photoURL ? (
                  <img src={topMatch.photoURL} alt={topMatch.displayName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-white/80">{initial}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white group-hover:text-lumen-cyan transition-colors truncate">
                  {topMatch.displayName || topMatch.username}
                </div>
                <div className="text-[10px] text-white/40 truncate">Highest taste match</div>
              </div>
            </div>

            {/* Score Ring / Pill */}
            <div 
              className="px-2.5 py-1 rounded-full text-xs font-mono font-bold flex items-center gap-1 border shadow-sm"
              style={{
                backgroundColor: `${dominantColor}15`,
                borderColor: `${dominantColor}40`,
                color: dominantColor
              }}
            >
              <span>{score > 0 ? `${score}%` : 'High'}</span>
            </div>
          </div>

          {/* Shared Breakdown metrics */}
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-0.5">Shared Artists</div>
              <div className="text-xs font-bold text-white truncate">
                {topMatch.sharedArtists && topMatch.sharedArtists.length > 0 
                  ? topMatch.sharedArtists.slice(0, 2).join(', ') 
                  : 'Analyzing...'}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-0.5">Overlap</div>
              <div className="text-xs font-bold text-lumen-cyan">
                {score > 0 ? `${score}% Shared Taste` : 'Mutual Favorites'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
