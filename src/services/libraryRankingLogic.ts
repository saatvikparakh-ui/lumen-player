/**
 * Pure Library Ranking & Pending Playlist Merge Helpers.
 * Powers:
 *  - Featured Playlist selection (user's most-listened playlist, falling back to largest)
 *  - Overall Top-Played Songs Easter Egg Carousel (deduplicated artwork covers)
 *  - Per-Playlist Most-Listened Fan Covers & Swipeable Top-Played Easter Egg
 *  - Race-free Firestore snapshot merge so freshly added/removed tracks NEVER glitch out
 */

export interface SimpleTrackLike {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  artworkUrl?: string | null;
}

export interface SimplePlaylistLike {
  id: string;
  name: string;
  tracks: SimpleTrackLike[];
  updatedAt?: number;
}

export interface ListeningEventLike {
  trackId?: string;
  title?: string;
  artist?: string;
  listenDurationSec?: number;
  eventType?: string;
}

const norm = (s?: string | null): string =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

const trackKey = (t: { id?: string; title?: string; artist?: string }): string =>
  `${norm(t.title)}::${norm(t.artist)}`;

/**
 * Computes play count maps by trackId AND normalized title::artist from listening logs.
 */
export function buildPlayCountIndex(events: ListeningEventLike[]): {
  byId: Map<string, number>;
  byKey: Map<string, number>;
} {
  const byId = new Map<string, number>();
  const byKey = new Map<string, number>();
  for (const ev of events || []) {
    if (!ev) continue;
    const dur = Number(ev.listenDurationSec || 0);
    const type = String(ev.eventType || 'play').toLowerCase();
    const meaningful = type === 'complete' || type === 'completed' || type === 'replay' || dur >= 10;
    if (!meaningful) continue;
    if (ev.trackId) {
      byId.set(ev.trackId, (byId.get(ev.trackId) || 0) + 1);
    }
    if (ev.title) {
      const k = trackKey(ev);
      if (k !== '::') byKey.set(k, (byKey.get(k) || 0) + 1);
    }
  }
  return { byId, byKey };
}

export function getTrackPlayScore(
  track: SimpleTrackLike,
  index: { byId: Map<string, number>; byKey: Map<string, number> }
): number {
  const idCount = track.id ? (index.byId.get(track.id) || 0) : 0;
  const keyCount = track.title ? (index.byKey.get(trackKey(track)) || 0) : 0;
  return Math.max(idCount, keyCount);
}

/**
 * Selects the user's most-listened playlist for the Featured Playlist card.
 * Falls back cleanly to the playlist with the most tracks if no listening history exists yet.
 */
export function pickFeaturedMostListenedPlaylist<T extends SimplePlaylistLike>(
  playlists: T[],
  events: ListeningEventLike[]
): { playlist: T | null; totalPlays: number; isFromListeningHistory: boolean } {
  if (!playlists || playlists.length === 0) {
    return { playlist: null, totalPlays: 0, isFromListeningHistory: false };
  }
  const idx = buildPlayCountIndex(events);

  let best: T | null = null;
  let bestPlays = -1;
  let bestTrackCount = -1;

  for (const pl of playlists) {
    const tracks = pl.tracks || [];
    let plPlays = 0;
    const counted = new Set<string>();
    for (const t of tracks) {
      const tk = trackKey(t);
      if (counted.has(tk)) continue;
      counted.add(tk);
      plPlays += getTrackPlayScore(t, idx);
    }
    if (
      plPlays > bestPlays ||
      (plPlays === bestPlays && tracks.length > bestTrackCount)
    ) {
      best = pl;
      bestPlays = plPlays;
      bestTrackCount = tracks.length;
    }
  }

  return {
    playlist: best,
    totalPlays: Math.max(0, bestPlays),
    isFromListeningHistory: bestPlays > 0
  };
}

/**
 * Extracts top-played unique-artwork tracks across the user's library (for Library Hub Easter Egg Carousel).
 */
export function pickTopPlayedTracksOverall<T extends SimpleTrackLike>(
  playlists: Array<{ tracks: T[] }>,
  likedTracks: T[],
  events: ListeningEventLike[],
  limit: number = 6
): T[] {
  const idx = buildPlayCountIndex(events);
  const allMap = new Map<string, { track: T; plays: number; order: number }>();
  let order = 0;

  const ingest = (t: T) => {
    if (!t || !t.title) return;
    const tk = trackKey(t);
    const plays = getTrackPlayScore(t, idx);
    const existing = allMap.get(tk);
    if (!existing) {
      allMap.set(tk, { track: t, plays, order: order++ });
    } else {
      if (plays > existing.plays) existing.plays = plays;
      if (!existing.track.artworkUrl && t.artworkUrl) existing.track = t;
    }
  };

  (likedTracks || []).forEach(ingest);
  (playlists || []).forEach(pl => (pl.tracks || []).forEach(ingest));

  const sorted = Array.from(allMap.values()).sort((a, b) => {
    if (b.plays !== a.plays) return b.plays - a.plays;
    // Prefer tracks that have artwork
    const artDiff = (b.track.artworkUrl ? 1 : 0) - (a.track.artworkUrl ? 1 : 0);
    if (artDiff !== 0) return artDiff;
    return a.order - b.order;
  });

  // Deduplicate by artwork URL so every carousel slide looks visually distinct!
  const result: T[] = [];
  const seenArt = new Set<string>();
  for (const item of sorted) {
    if (!item.track.artworkUrl) continue;
    const artKey = item.track.artworkUrl.trim().toLowerCase();
    if (seenArt.has(artKey)) continue;
    seenArt.add(artKey);
    result.push(item.track);
    if (result.length >= limit) break;
  }

  return result;
}

/**
 * Extracts a playlist's most-listened tracks with distinct album covers (for the faint fanned
 * background covers AND the swipeable Easter Egg carousel inside Playlist Detail).
 */
export function pickTopPlayedTracksInPlaylist<T extends SimpleTrackLike>(
  tracks: T[],
  events: ListeningEventLike[],
  limit: number = 5
): T[] {
  if (!tracks || tracks.length === 0) return [];
  const idx = buildPlayCountIndex(events);

  const scored = tracks.map((track, pos) => ({
    track,
    plays: getTrackPlayScore(track, idx),
    pos
  }));

  scored.sort((a, b) => {
    if (b.plays !== a.plays) return b.plays - a.plays;
    return a.pos - b.pos;
  });

  const picked: T[] = [];
  const seenArt = new Set<string>();
  for (const item of scored) {
    if (!item.track.artworkUrl) continue;
    const artKey = item.track.artworkUrl.trim().toLowerCase();
    if (seenArt.has(artKey)) continue;
    seenArt.add(artKey);
    picked.push(item.track);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * Race-free Firestore snapshot merge for a playlist:
 * Keeps freshly added tracks that haven't finished writing to Firestore yet
 * AND suppresses freshly removed tracks that a stale snapshot tried to restore.
 */
export function mergePlaylistTracksWithPending<T extends SimpleTrackLike>(
  cloudTracks: T[],
  pendingAdds: T[],
  pendingRemovalIds: Set<string>
): { mergedTracks: T[]; remainingAdds: T[]; remainingRemovalIds: Set<string> } {
  const cloudIdSet = new Set(cloudTracks.map(t => String(t.id)));
  const cloudKeySet = new Set(cloudTracks.map(t => trackKey(t)));

  // Filter out tracks we just deleted locally
  const filteredCloud = cloudTracks.filter(t => !pendingRemovalIds.has(String(t.id)));
  const remainingRemovalIds = new Set<string>();
  pendingRemovalIds.forEach(remId => {
    // Keep guard active as long as stale cloud snapshots still contain the removed ID
    if (cloudIdSet.has(remId)) {
      remainingRemovalIds.add(remId);
    }
  });

  // Re-append freshly added local tracks that aren't in the cloud snapshot yet
  const remainingAdds: T[] = [];
  const mergedTracks = [...filteredCloud];
  for (const added of pendingAdds) {
    const idStr = String(added.id);
    const tk = trackKey(added);
    const alreadyInCloud = cloudIdSet.has(idStr) || (tk !== '::' && cloudKeySet.has(tk));
    if (!alreadyInCloud) {
      remainingAdds.push(added);
      mergedTracks.push(added);
    }
  }

  return { mergedTracks, remainingAdds, remainingRemovalIds };
}
