/**
 * Pure, honest Taste Compatibility calculation engine.
 * Computes real musical overlap between two listeners using:
 *  - Shared songs (normalized title + primary artist)
 *  - Shared artists (normalized artist overlap)
 *  - Mutual track rating agreement (0.1–10.0 scale)
 *
 * Guarantees:
 *  - NEVER invents a baseline floor (no fake 72%/81%/84% when overlap is 0)
 *  - NEVER injects the current user's own tracks as "matched songs"
 *  - Returns score = 0 and hasEnoughData = false when either side has no real data
 */

export interface CompatibilityTrackLike {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string | null;
  duration?: number;
  streamUrl?: string;
}

export type RatingMapLike = Record<string, string | number | null | undefined>;

export interface TasteCompatibilityResult {
  score: number; // 0..100 integer
  hasEnoughData: boolean;
  matchedSongs: CompatibilityTrackLike[];
  matchedSongCount: number;
  sharedArtists: string[];
  mutualRatedCount: number;
  ratingAgreementPercent: number | null;
  label: string;
  description: string;
}

const cleanToken = (value?: string | null): string =>
  String(value || '')
    .toLowerCase()
    .replace(/\(feat\.?[^)]*\)|\[feat\.?[^\]]*\]|feat\.?.*$/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

const splitArtists = (artist?: string | null): string[] => {
  if (!artist) return [];
  return String(artist)
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b/i)
    .map(part => part.trim())
    .filter(part => part.length > 1 && part.toLowerCase() !== 'unknown artist' && part.toLowerCase() !== 'rated track');
};

const parseNumericRating = (val: string | number | null | undefined): number | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.min(10, Math.max(0.1, val)) : null;
  }
  const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) && num > 0 ? Math.min(10, Math.max(0.1, num)) : null;
};

const makeSongKey = (t: CompatibilityTrackLike): string | null => {
  const title = cleanToken(t?.title);
  if (!title) return null;
  const primaryArtist = splitArtists(t?.artist)[0] || t?.artist || '';
  const artist = cleanToken(primaryArtist);
  return `${title}:::${artist}`;
};

export function computeTasteCompatibility(params: {
  myTracks: CompatibilityTrackLike[];
  myRatings?: RatingMapLike;
  friendTracks: CompatibilityTrackLike[];
  friendRatings?: RatingMapLike;
}): TasteCompatibilityResult {
  const myTracks = Array.isArray(params.myTracks) ? params.myTracks.filter(t => Boolean(t?.title)) : [];
  const friendTracks = Array.isArray(params.friendTracks) ? params.friendTracks.filter(t => Boolean(t?.title)) : [];
  const myRatings = params.myRatings || {};
  const friendRatings = params.friendRatings || {};

  // Build normalized maps of songs and artists
  const mySongMap = new Map<string, CompatibilityTrackLike>();
  const myArtistMap = new Map<string, string>(); // clean -> display name

  for (const t of myTracks) {
    const key = makeSongKey(t);
    if (key && !mySongMap.has(key)) mySongMap.set(key, t);
    for (const art of splitArtists(t.artist)) {
      const ca = cleanToken(art);
      if (ca && !myArtistMap.has(ca)) myArtistMap.set(ca, art);
    }
  }

  const friendSongMap = new Map<string, CompatibilityTrackLike>();
  const friendArtistMap = new Map<string, string>();

  for (const t of friendTracks) {
    const key = makeSongKey(t);
    if (key && !friendSongMap.has(key)) friendSongMap.set(key, t);
    for (const art of splitArtists(t.artist)) {
      const ca = cleanToken(art);
      if (ca && !friendArtistMap.has(ca)) friendArtistMap.set(ca, art);
    }
  }

  // Parse valid numeric ratings on both sides
  const myParsedRatings = new Map<string, number>();
  for (const [songId, raw] of Object.entries(myRatings)) {
    const num = parseNumericRating(raw);
    if (num !== null) myParsedRatings.set(songId, num);
  }

  const friendParsedRatings = new Map<string, number>();
  for (const [songId, raw] of Object.entries(friendRatings)) {
    const num = parseNumericRating(raw);
    if (num !== null) friendParsedRatings.set(songId, num);
  }

  const myHasData = mySongMap.size > 0 || myParsedRatings.size > 0;
  const friendHasData = friendSongMap.size > 0 || friendParsedRatings.size > 0;

  if (!myHasData || !friendHasData) {
    return {
      score: 0,
      hasEnoughData: false,
      matchedSongs: [],
      matchedSongCount: 0,
      sharedArtists: [],
      mutualRatedCount: 0,
      ratingAgreementPercent: null,
      label: 'Not Enough Data Yet',
      description: 'Listen, build public playlists, or rate songs to calculate real compatibility'
    };
  }

  // 1. Real matched songs
  const matchedSongs: CompatibilityTrackLike[] = [];
  for (const [key, track] of friendSongMap.entries()) {
    if (mySongMap.has(key)) {
      matchedSongs.push(track);
    }
  }

  // 2. Real shared artists
  const sharedArtists: string[] = [];
  for (const [cleanArt, displayArt] of friendArtistMap.entries()) {
    if (myArtistMap.has(cleanArt)) {
      sharedArtists.push(myArtistMap.get(cleanArt) || displayArt);
    }
  }

  // 3. Real mutual rating agreement (tracks both users rated)
  let mutualRatedCount = 0;
  let agreementSum = 0;
  for (const [songId, myScore] of myParsedRatings.entries()) {
    const friendScore = friendParsedRatings.get(songId);
    if (friendScore !== undefined) {
      mutualRatedCount++;
      const diff = Math.abs(myScore - friendScore);
      const closeness = Math.max(0, 1 - diff / 9.9);
      agreementSum += closeness;
    }
  }

  const ratingAgreement = mutualRatedCount > 0 ? agreementSum / mutualRatedCount : null;
  const ratingAgreementPercent = ratingAgreement !== null ? Math.round(ratingAgreement * 100) : null;

  // If zero overlap across ALL three signals, score is honestly 0%
  if (matchedSongs.length === 0 && sharedArtists.length === 0 && mutualRatedCount === 0) {
    return {
      score: 0,
      hasEnoughData: true,
      matchedSongs: [],
      matchedSongCount: 0,
      sharedArtists: [],
      mutualRatedCount: 0,
      ratingAgreementPercent: null,
      label: 'Different Worlds',
      description: 'No shared songs, artists, or mutual ratings yet — great opportunity to swap tracks!'
    };
  }

  // Weighted similarity using only signals that actually exist
  // - Song overlap (Dice/overlap coefficient damped so 1 track out of 1 doesn't falsely hit 100%)
  // - Artist overlap (Dice coefficient on unique artists)
  // - Mutual rating agreement (closeness on mutually rated tracks)
  let weightedSum = 0;
  let totalWeight = 0;

  if (mySongMap.size > 0 && friendSongMap.size > 0) {
    const minPool = Math.min(mySongMap.size, friendSongMap.size);
    const maxPool = Math.max(mySongMap.size, friendSongMap.size);
    // Blend overlap ratio with Jaccard so giant vs tiny libraries stay realistic
    const overlapRatio = matchedSongs.length / Math.max(1, minPool);
    const diceRatio = (2 * matchedSongs.length) / Math.max(1, mySongMap.size + friendSongMap.size);
    const confidence = Math.min(1, minPool / 5);
    const songScore = (overlapRatio * 0.65 + diceRatio * 0.35) * (0.55 + 0.45 * confidence) * (maxPool > 0 ? 1 : 0);
    weightedSum += Math.min(1, songScore) * 0.5;
    totalWeight += 0.5;
  }

  if (myArtistMap.size > 0 && friendArtistMap.size > 0) {
    const minArtists = Math.min(myArtistMap.size, friendArtistMap.size);
    const overlapArt = sharedArtists.length / Math.max(1, minArtists);
    const diceArt = (2 * sharedArtists.length) / Math.max(1, myArtistMap.size + friendArtistMap.size);
    const artConfidence = Math.min(1, minArtists / 4);
    const artistScore = (overlapArt * 0.6 + diceArt * 0.4) * (0.6 + 0.4 * artConfidence);
    weightedSum += Math.min(1, artistScore) * 0.35;
    totalWeight += 0.35;
  }

  if (ratingAgreement !== null) {
    const ratingWeight = Math.min(0.3, 0.15 + mutualRatedCount * 0.03);
    weightedSum += ratingAgreement * ratingWeight;
    totalWeight += ratingWeight;
  }

  const rawScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;
  const score = Math.max(0, Math.min(100, rawScore));

  let label = 'Sound Explorers';
  let description = 'A few shared sparks with plenty of new music to swap';
  if (score >= 85) {
    label = 'Twin Wavelength';
    description = 'Deep overlap across shared songs, artists, and ratings';
  } else if (score >= 60) {
    label = 'Strong Taste Match';
    description = 'Clear mutual overlap across your playlists and favorite artists';
  } else if (score >= 30) {
    label = 'Eclectic Synergy';
    description = 'Shared favorite artists with distinct personal discoveries';
  } else if (score > 0) {
    label = 'Early Overlap';
    description = 'A handful of shared tracks or artists so far';
  }

  return {
    score,
    hasEnoughData: true,
    matchedSongs,
    matchedSongCount: matchedSongs.length,
    sharedArtists,
    mutualRatedCount,
    ratingAgreementPercent,
    label,
    description
  };
}
