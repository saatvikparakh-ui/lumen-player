import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Users } from 'lucide-react';
import { FriendProfileData } from './friendsTypes';
import { Track } from '../../../types/music';
import { PlaylistService } from '../../../services/playlistService';
import { LikedService } from '../../../services/likedService';
import { FirestoreService } from '../../../services/firestoreService';
import { computeTasteCompatibility, TasteCompatibilityResult } from '../../../services/tasteCompatibility';

interface Props {
  friends: FriendProfileData[];
  onSelectFriend: (friend: FriendProfileData) => void;
  userLikedTracks?: Track[];
  myRatings?: Record<string, string | null>;
  dominantColor: string;
}

interface CachedFriendTaste {
  tracks: Track[];
  ratings: Record<string, string | null>;
  fetchedAt: number;
}

// Lightweight session cache (2 min TTL) so compatibility widget doesn't spam Firestore
const friendTasteCache = new Map<string, CachedFriendTaste>();
const CACHE_TTL_MS = 2 * 60 * 1000;

export const MusicCompatibilityWidget: React.FC<Props> = ({
  friends,
  onSelectFriend,
  userLikedTracks = [],
  myRatings = {},
  dominantColor
}) => {
  const [friendTasteMap, setFriendTasteMap] = useState<Record<string, CachedFriendTaste>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Fetch real public playlists & ratings for connected friends (capped to first 12 for speed)
  useEffect(() => {
    if (!friends || friends.length === 0) return;
    let cancelled = false;
    const now = Date.now();
    const toFetch = friends.slice(0, 12).filter(f => {
      const cached = friendTasteCache.get(f.userId);
      return !cached || (now - cached.fetchedAt > CACHE_TTL_MS);
    });

    // Hydrate immediately from any fresh cache entries
    const initialMap: Record<string, CachedFriendTaste> = {};
    friends.slice(0, 12).forEach(f => {
      const c = friendTasteCache.get(f.userId);
      if (c) initialMap[f.userId] = c;
    });
    if (Object.keys(initialMap).length > 0) {
      setFriendTasteMap(prev => ({ ...prev, ...initialMap }));
    }

    if (toFetch.length === 0) return;
    setIsLoading(true);

    Promise.allSettled(
      toFetch.map(async (f) => {
        const lookupId = f.userId || f.username;
        const [plRes, ratRes] = await Promise.allSettled([
          FirestoreService.getUserPlaylists(lookupId),
          FirestoreService.getUserRatings(lookupId)
        ]);
        const playlists = plRes.status === 'fulfilled' ? (plRes.value?.playlists || []) : [];
        const tracks = playlists.flatMap(p => p.tracks || []);
        const ratings = ratRes.status === 'fulfilled' ? (ratRes.value || {}) : {};
        const entry: CachedFriendTaste = { tracks, ratings, fetchedAt: Date.now() };
        friendTasteCache.set(f.userId, entry);
        return { uid: f.userId, entry };
      })
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, CachedFriendTaste> = {};
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) {
          next[r.value.uid] = r.value.entry;
        }
      });
      if (Object.keys(next).length > 0) {
        setFriendTasteMap(prev => ({ ...prev, ...next }));
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [friends]);

  // Compute REAL compatibility for every friend and pick the highest honest match
  const topMatchEntry = useMemo<{ friend: FriendProfileData; compat: TasteCompatibilityResult } | null>(() => {
    if (!friends || friends.length === 0) return null;

    const myPlaylists = PlaylistService.getPlaylists();
    const myLiked = LikedService.getLikedTracks();
    const allMyTracks = [...myLiked, ...userLikedTracks, ...myPlaylists.flatMap(p => p.tracks || [])];

    const ranked = friends.map(f => {
      const cached = friendTasteMap[f.userId];
      const friendTracks: Track[] = [...(cached?.tracks || [])];
      if (f.currentTrack) friendTracks.push(f.currentTrack);
      const compat = computeTasteCompatibility({
        myTracks: allMyTracks,
        myRatings,
        friendTracks,
        friendRatings: cached?.ratings || {}
      });
      return { friend: f, compat };
    });

    ranked.sort((a, b) => {
      if (b.compat.score !== a.compat.score) return b.compat.score - a.compat.score;
      if (b.compat.matchedSongCount !== a.compat.matchedSongCount) return b.compat.matchedSongCount - a.compat.matchedSongCount;
      return b.compat.sharedArtists.length - a.compat.sharedArtists.length;
    });

    return ranked[0] || null;
  }, [friends, friendTasteMap, userLikedTracks, myRatings]);

  const topMatch = topMatchEntry?.friend || null;
  const compat = topMatchEntry?.compat || null;
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

        <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
          {compat?.hasEnoughData ? compat.label : (isLoading ? 'Syncing...' : 'Song Match')}
        </span>
      </div>

      {!topMatch || !compat ? (
        <div className="text-center py-4 text-white/40">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30 text-lumen-cyan" />
          <p className="text-xs font-medium text-white/60">Connect with friends to see song compatibility</p>
          <p className="text-[10px] text-white/40 mt-0.5">Calculated from matching playlist songs, shared artists, and ratings</p>
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
                <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors truncate">
                  {topMatch.displayName || topMatch.username}
                </div>
                <div className="text-[10px] text-white/45 truncate">
                  {compat.hasEnoughData
                    ? (compat.score > 0 ? 'Highest real playlist & taste overlap' : 'No shared songs or ratings yet')
                    : (isLoading ? 'Loading friend playlists & ratings...' : 'Needs public playlists or ratings to compare')}
                </div>
              </div>
            </div>

            {/* Honest Score Pill */}
            <div
              className="px-2.5 py-1 rounded-full text-xs font-mono font-bold flex items-center gap-1 border shadow-sm"
              style={{
                backgroundColor: compat.score > 0 ? `${dominantColor}15` : 'rgba(255,255,255,0.05)',
                borderColor: compat.score > 0 ? `${dominantColor}40` : 'rgba(255,255,255,0.12)',
                color: compat.score > 0 ? dominantColor : 'rgba(255,255,255,0.6)'
              }}
            >
              <span>{compat.score}%</span>
            </div>
          </div>

          {/* Real Breakdown Metrics */}
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-0.5">Matching Songs</div>
              <div className="text-xs font-bold text-white truncate">
                {compat.matchedSongCount > 0
                  ? `${compat.matchedSongCount} ${compat.matchedSongCount === 1 ? 'Song' : 'Songs'}`
                  : '0 Songs'}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-0.5">Shared Artists</div>
              <div className="text-xs font-bold text-cyan-300 truncate">
                {compat.sharedArtists.length > 0
                  ? `${compat.sharedArtists.length} ${compat.sharedArtists.length === 1 ? 'Artist' : 'Artists'}`
                  : '0 Artists'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
