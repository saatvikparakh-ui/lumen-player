import React, { useState, useEffect } from 'react';
import { ArrowLeft, Play, Sparkles, Disc3, Split, User, Users, Star } from 'lucide-react';
import { Track } from '../../../types/music';
import { FriendProfileData } from './friendsTypes';
import { FirestoreService } from '../../../services/firestoreService';
import { CoverImage } from '../../common/CoverImage';

interface Props {
  friend: FriendProfileData | null;
  currentUserRatings: Record<string, string | null>;
  userLikedTracks: Track[];
  onBack: () => void;
  onPlayTrack: (track: Track) => void;
  dominantColor: string;
}

interface TierGroup {
  s: Track[];
  a: Track[];
  b: Track[];
  c: Track[];
}

export const TierListComparisonStage: React.FC<Props> = ({
  friend,
  currentUserRatings,
  userLikedTracks,
  onBack,
  onPlayTrack,
  dominantColor
}) => {
  const [friendRatings, setFriendRatings] = useState<Record<string, string | null>>({});
  const [friendRatedTracks, setFriendRatedTracks] = useState<Track[]>([]);
  const [isCompareSplit, setIsCompareSplit] = useState(false);
  const [showCommonOnly, setShowCommonOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!friend) return;
    setIsLoading(true);
    FirestoreService.getUserRatedTracks(friend.userId)
      .then((res) => {
        setFriendRatings(res.ratings || {});
        setFriendRatedTracks(res.tracks || []);
      })
      .catch(() => {
        setFriendRatings({});
        setFriendRatedTracks([]);
      })
      .finally(() => setIsLoading(false));
  }, [friend?.userId]);

  // Unified catalog of all unique tracks known across both users
  const tracksMap = React.useMemo(() => {
    const map = new Map<string, Track>();
    (userLikedTracks || []).forEach(t => {
      if (t?.id) map.set(t.id, t);
    });
    (friendRatedTracks || []).forEach(t => {
      if (t?.id && !map.has(t.id)) map.set(t.id, t);
    });
    return map;
  }, [userLikedTracks, friendRatedTracks]);

  // Group tracks into S, A, B, C tiers based on numeric ratings
  const buildTiers = (
    ratingsMap: Record<string, string | null>,
    isFriend: boolean
  ): TierGroup => {
    const s: Track[] = [];
    const a: Track[] = [];
    const b: Track[] = [];
    const c: Track[] = [];

    tracksMap.forEach((t) => {
      const r = ratingsMap[t.id];
      if (!r) return; // Strictly only include songs that have been rated
      const val = parseFloat(r);
      if (isNaN(val)) return;

      // Filter to common tracks if toggle is active
      if (showCommonOnly) {
        const otherRating = isFriend ? currentUserRatings[t.id] : friendRatings[t.id];
        if (!otherRating) return;
      }

      if (val >= 9.0) s.push(t);
      else if (val >= 8.0) a.push(t);
      else if (val >= 7.0) b.push(t);
      else c.push(t);
    });

    return { s, a, b, c };
  };

  const userTiers = buildTiers(currentUserRatings, false);
  const friendTiers = buildTiers(friendRatings, true);

  const tierMeta = [
    { key: 's' as const, label: 'S TIER', sub: 'God Tier • 9.0+', bg: 'from-rose-500/20 to-red-600/10', border: 'border-rose-500/40', badge: 'bg-rose-500 text-white' },
    { key: 'a' as const, label: 'A TIER', sub: 'Essential • 8.0+', bg: 'from-amber-500/20 to-orange-600/10', border: 'border-amber-500/40', badge: 'bg-amber-500 text-black' },
    { key: 'b' as const, label: 'B TIER', sub: 'Great • 7.0+', bg: 'from-emerald-500/20 to-teal-600/10', border: 'border-emerald-500/40', badge: 'bg-emerald-500 text-black' },
    { key: 'c' as const, label: 'C TIER', sub: 'Good • 6.0+', bg: 'from-cyan-500/20 to-blue-600/10', border: 'border-cyan-500/40', badge: 'bg-cyan-500 text-black' },
  ];

  const totalFriendRated = Object.keys(friendRatings).length;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/80 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <div className="text-center">
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
            Song Rating Comparison Stage
          </h2>
          <p className="text-xs text-white/50">
            {friend ? (
              <span>
                Comparing rankings with <span className="text-white font-semibold">@{friend.username}</span>
                {totalFriendRated > 0 && <span className="ml-1 text-white/40">({totalFriendRated} rated)</span>}
              </span>
            ) : 'Your Music Rankings'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {friend && (
            <>
              <button
                type="button"
                onClick={() => setShowCommonOnly(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border active:scale-95 transition-all cursor-pointer ${
                  showCommonOnly 
                    ? 'bg-amber-400 text-black border-amber-400 shadow-md shadow-amber-400/20' 
                    : 'bg-white/10 text-white/70 hover:text-white hover:bg-white/15 border-white/15'
                }`}
                title="Toggle between all rated songs and only mutually rated tracks"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{showCommonOnly ? 'Common Only' : 'All Rated'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCompareSplit(prev => !prev)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border active:scale-95 transition-all cursor-pointer ${
                  isCompareSplit 
                    ? 'bg-lumen-cyan text-black border-lumen-cyan shadow-lg shadow-lumen-cyan/20' 
                    : 'bg-white/10 text-white hover:bg-white/20 border-white/20'
                }`}
              >
                <Split className="w-3.5 h-3.5" />
                <span>{isCompareSplit ? 'Side-by-Side' : 'Compare with Mine'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-white/50 animate-pulse">
          Syncing @{friend?.username}'s rated songs from Cloud Firestore...
        </div>
      )}

      {/* Tier Board Container */}
      <div className="space-y-4">
        {tierMeta.map((tier) => {
          const friendTracks = friendTiers[tier.key];
          const myTracks = userTiers[tier.key];

          return (
            <div 
              key={tier.key}
              className={`rounded-3xl p-4 sm:p-5 bg-gradient-to-r ${tier.bg} border ${tier.border} backdrop-blur-2xl transition-all shadow-xl`}
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {/* Tier Badge Column */}
                <div className="flex sm:flex-col items-center justify-between w-full sm:w-28 flex-shrink-0">
                  <span className={`px-3 py-1 rounded-xl text-xs font-black tracking-wider ${tier.badge}`}>
                    {tier.label}
                  </span>
                  <span className="text-[10px] font-mono text-white/50 mt-1">
                    {tier.sub}
                  </span>
                </div>

                {/* Content: Single view or Split comparison */}
                {!isCompareSplit ? (
                  /* Standard / Friend Tier list */
                  <div className="flex-1 flex items-center gap-3 overflow-x-auto no-scrollbar py-1 w-full">
                    {friendTracks.length === 0 ? (
                      <span className="text-xs text-white/35 italic py-2">
                        {isLoading ? 'Checking cloud ratings...' : 'No ranked tracks in this tier'}
                      </span>
                    ) : (
                      friendTracks.map((tr) => {
                        const scoreVal = friendRatings[tr.id];
                        return (
                          <div 
                            key={tr.id}
                            onClick={() => onPlayTrack(tr)}
                            className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-black/60 border border-white/20 flex-shrink-0 relative group cursor-pointer shadow-md hover:scale-105 transition-all"
                            title={`${tr.title} • ${tr.artist} (Rated: ${scoreVal || ''})`}
                          >
                            <CoverImage
                              src={tr.artworkUrl || null}
                              alt={tr.title}
                              title={tr.title}
                              artist={tr.artist}
                              size={160}
                              className="w-full h-full object-cover"
                            />
                            {scoreVal && (
                              <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-white/20 text-[9px] font-bold text-amber-300 font-mono shadow-sm">
                                {scoreVal} ★
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Play className="w-5 h-5 fill-white text-white drop-shadow-md" />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : (
                  /* Side-by-Side Comparison Columns */
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                    {/* User side */}
                    <div className="p-2.5 rounded-2xl bg-black/30 border border-white/10">
                      <div className="text-[10px] font-mono font-bold text-white/60 mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3 text-lumen-cyan" />
                          <span>You ({myTracks.length})</span>
                        </div>
                        <span className="text-white/30 text-[9px]">click to play</span>
                      </div>
                      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                        {myTracks.length === 0 ? (
                          <span className="text-[11px] text-white/30 italic py-1">No songs</span>
                        ) : (
                          myTracks.map((tr) => {
                            const scoreVal = currentUserRatings[tr.id];
                            return (
                              <div 
                                key={`my_${tr.id}`}
                                onClick={() => onPlayTrack(tr)}
                                className="w-12 h-12 rounded-lg overflow-hidden bg-black/60 border border-white/20 flex-shrink-0 relative group cursor-pointer hover:scale-105 transition-transform"
                                title={`${tr.title} • ${tr.artist} (Rated: ${scoreVal || ''})`}
                              >
                                <CoverImage src={tr.artworkUrl || null} alt={tr.title} size={100} className="w-full h-full object-cover" />
                                {scoreVal && (
                                  <div className="absolute top-0.5 right-0.5 px-1 py-0.2 rounded bg-black/80 text-[8px] font-bold text-amber-300 font-mono">
                                    {scoreVal}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Friend side */}
                    <div className="p-2.5 rounded-2xl bg-black/30 border border-white/10">
                      <div className="text-[10px] font-mono font-bold text-white/60 mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-pink-400" />
                          <span>@{friend?.username} ({friendTracks.length})</span>
                        </div>
                        <span className="text-white/30 text-[9px]">click to play</span>
                      </div>
                      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                        {friendTracks.length === 0 ? (
                          <span className="text-[11px] text-white/30 italic py-1">No songs</span>
                        ) : (
                          friendTracks.map((tr) => {
                            const scoreVal = friendRatings[tr.id];
                            return (
                              <div 
                                key={`fr_${tr.id}`}
                                onClick={() => onPlayTrack(tr)}
                                className="w-12 h-12 rounded-lg overflow-hidden bg-black/60 border border-white/20 flex-shrink-0 relative group cursor-pointer hover:scale-105 transition-transform"
                                title={`${tr.title} • ${tr.artist} (Rated: ${scoreVal || ''})`}
                              >
                                <CoverImage src={tr.artworkUrl || null} alt={tr.title} size={100} className="w-full h-full object-cover" />
                                {scoreVal && (
                                  <div className="absolute top-0.5 right-0.5 px-1 py-0.2 rounded bg-black/80 text-[8px] font-bold text-pink-300 font-mono">
                                    {scoreVal}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
