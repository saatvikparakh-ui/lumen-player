import { CustomPlaylist, Track } from '../types/music';
import { StreamingService } from './streamingService';
import { RatingAndStatsService } from './ratingAndStatsService';
import { LikedService } from './likedService';
import { PreferenceService } from './preferenceService';

function normalize(str: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isBanned(t: Track): boolean {
  const art = (t.artist || '').toLowerCase();
  const tit = (t.title || '').toLowerCase();
  if (art === 'primo piatto' || art.includes('tribute') || art.includes('karaoke') || art.includes('soundalike') || art.includes('cover band')) return true;
  if (/billboard\s*hot|top\s*hits\s*20\d\d|workout\s*hits/i.test(tit) && !art.includes('weeknd')) return true;
  return false;
}

export class PlaylistRecommendationService {
  private static cachedPool: Map<string, Track[]> = new Map();

  /**
   * Generates Spotify-grade recommendations tailored to the playlist's specific artists,
   * listening statistics, liked songs, and user taste profile.
   */
  static async getRecommendationsForPlaylist(
    playlist: CustomPlaylist,
    count: number = 20
  ): Promise<{ suggestions: Track[]; pool: Track[] }> {
    const existingIds = new Set(playlist.tracks.map(t => t.id));
    const existingKeys = new Set(
      playlist.tracks.map(t => `${normalize(t.title)}::${normalize(t.artist)}`)
    );

    const candidates: Track[] = [];
    const seenCandidateKeys = new Set<string>();

    const pushCandidate = (track: Track, reason: string) => {
      const key = `${normalize(track.title)}::${normalize(track.artist)}`;
      if (existingIds.has(track.id) || existingKeys.has(key) || seenCandidateKeys.has(key) || isBanned(track)) {
        return;
      }
      seenCandidateKeys.add(key);
      (track as any).recommendationReason = reason;
      candidates.push(track);
    };

    // 1. Gather playlist's prominent artists
    const artistCounts = new Map<string, number>();
    for (const t of playlist.tracks) {
      if (t.artist && t.artist !== 'Unknown Artist') {
        artistCounts.set(t.artist, (artistCounts.get(t.artist) || 0) + 1);
      }
    }
    const playlistTopArtists = Array.from(artistCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 5);

    // 2. Gather user's top listened artists & favorite artists
    let statsTopArtists: string[] = [];
    try {
      const stats = await RatingAndStatsService.fetchListeningStats('all');
      if (stats?.top_artists && Array.isArray(stats.top_artists)) {
        statsTopArtists = stats.top_artists
          .map((a: any) => a.artist)
          .filter((a: string) => a && a !== 'Unknown Artist')
          .slice(0, 5);
      }
    } catch (_) {}

    const favoriteArtists = (PreferenceService.getPreferences()?.favoriteArtists || []).slice(0, 5);

    // 3. Search verified tracks for playlist artists (Primary Vibe)
    await Promise.all(
      playlistTopArtists.map(async (art) => {
        try {
          const res = await StreamingService.searchVerifiedTracks(art);
          for (const tr of res.slice(0, 8)) {
            pushCandidate(tr, `Matches playlist artist: ${art}`);
          }
        } catch (_) {}
      })
    );

    // 4. Incorporate user's liked tracks not already in the playlist
    try {
      const liked = LikedService.getLikedTracks();
      for (const tr of liked) {
        pushCandidate(tr, 'From your Liked Songs');
      }
    } catch (_) {}

    // 5. Query verified tracks for user's top listened artists
    await Promise.all(
      statsTopArtists.map(async (art) => {
        try {
          const res = await StreamingService.searchVerifiedTracks(art);
          for (const tr of res.slice(0, 6)) {
            pushCandidate(tr, `Based on your top played: ${art}`);
          }
        } catch (_) {}
      })
    );

    // 6. Query verified tracks for user's favorite artists from taste profile
    await Promise.all(
      favoriteArtists.map(async (art) => {
        try {
          const res = await StreamingService.searchVerifiedTracks(art);
          for (const tr of res.slice(0, 6)) {
            pushCandidate(tr, `From your taste profile: ${art}`);
          }
        } catch (_) {}
      })
    );

    // 7. Supplement with personalized Made For You & genre mixes
    try {
      const recs = await StreamingService.getRecommendations();
      for (const tr of (recs.madeForYou || [])) {
        pushCandidate(tr, 'Curated for you');
      }
      for (const tr of (recs.genreMixes || [])) {
        pushCandidate(tr, 'Recommended for this vibe');
      }
    } catch (_) {}

    this.cachedPool.set(playlist.id, candidates.slice(count));

    return {
      suggestions: candidates.slice(0, count),
      pool: candidates.slice(count)
    };
  }

  /**
   * Retrieves a new replacement song when a song is added to the playlist.
   */
  static getNextReplacement(
    playlist: CustomPlaylist,
    currentDisplayed: Track[],
    pool: Track[]
  ): { nextTrack: Track | null; updatedPool: Track[] } {
    const existingIds = new Set(playlist.tracks.map(t => t.id));
    const displayedIds = new Set(currentDisplayed.map(t => t.id));

    const remainingPool = [...pool];

    while (remainingPool.length > 0) {
      const candidate = remainingPool.shift()!;
      if (!existingIds.has(candidate.id) && !displayedIds.has(candidate.id)) {
        return { nextTrack: candidate, updatedPool: remainingPool };
      }
    }

    return { nextTrack: null, updatedPool: [] };
  }

  /**
   * Asynchronously fetches dynamic replenishments whenever a song is added.
   * Keeps the candidate pool fresh and endless!
   */
  static async fetchDynamicReplenishments(
    playlist: CustomPlaylist,
    addedTrack: Track,
    currentDisplayed: Track[],
    currentPool: Track[]
  ): Promise<Track[]> {
    const existingIds = new Set(playlist.tracks.map(t => t.id));
    existingIds.add(addedTrack.id);
    const displayedIds = new Set(currentDisplayed.map(t => t.id));
    const poolIds = new Set(currentPool.map(t => t.id));
    const existingKeys = new Set(
      [...playlist.tracks, addedTrack, ...currentDisplayed, ...currentPool].map(
        t => `${normalize(t.title)}::${normalize(t.artist)}`
      )
    );

    const freshCandidates: Track[] = [];
    const addedArtist = (addedTrack.artist || '').trim();

    if (addedArtist && addedArtist !== 'Unknown Artist') {
      try {
        const results = await StreamingService.searchVerifiedTracks(addedArtist);
        for (const cand of results) {
          const key = `${normalize(cand.title)}::${normalize(cand.artist)}`;
          if (!existingIds.has(cand.id) && !displayedIds.has(cand.id) && !poolIds.has(cand.id) && !existingKeys.has(key) && !isBanned(cand)) {
            existingKeys.add(key);
            poolIds.add(cand.id);
            (cand as any).recommendationReason = `Because you added ${addedArtist}`;
            freshCandidates.push(cand);
            if (freshCandidates.length >= 8) break;
          }
        }
      } catch (_) {}
    }

    return freshCandidates;
  }
}
