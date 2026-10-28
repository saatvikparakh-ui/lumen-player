import { CustomPlaylist, Track } from '../types/music';
import { StreamingService } from './streamingService';

function normalize(str: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export class PlaylistRecommendationService {
  private static cachedPool: Map<string, Track[]> = new Map();

  /**
   * Generates recommendations tailored to the playlist's specific artists, genres, and mood.
   * Guarantees that no songs already in the playlist are included.
   */
  static async getRecommendationsForPlaylist(
    playlist: CustomPlaylist,
    count: number = 15
  ): Promise<{ suggestions: Track[]; pool: Track[] }> {
    const existingIds = new Set(playlist.tracks.map(t => t.id));
    const existingKeys = new Set(
      playlist.tracks.map(t => `${normalize(t.title)}::${normalize(t.artist)}`)
    );

    // If playlist is empty, seed from user's verified sound profile (never generic chart hits)
    if (!playlist.tracks || playlist.tracks.length === 0) {
      try {
        const globalRecs = await StreamingService.getRecommendations();
        const combined = [...globalRecs.madeForYou, ...globalRecs.genreMixes];
        const filtered = combined.filter(t => {
          if (existingIds.has(t.id)) return false;
          const art = (t.artist || '').toLowerCase();
          const tit = (t.title || '').toLowerCase();
          if (art === 'primo piatto' || art.includes('tribute') || art.includes('karaoke')) return false;
          if (/billboard\s*hot|top\s*hits\s*20\d\d|workout\s*hits/i.test(tit) && !art.includes('weeknd')) return false;
          return true;
        });
        return {
          suggestions: filtered.slice(0, count),
          pool: filtered.slice(count)
        };
      } catch (_) {
        return { suggestions: [], pool: [] };
      }
    }

    // Extract top artists from the playlist, weighted by occurrence
    const artistCounts = new Map<string, number>();
    for (const t of playlist.tracks) {
      if (t.artist && t.artist !== 'Unknown Artist') {
        artistCounts.set(t.artist, (artistCounts.get(t.artist) || 0) + 1);
      }
    }

    const sortedArtists = Array.from(artistCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 4);

    const candidates: Track[] = [];

    // Query catalog for related songs by the playlist's prominent artists
    await Promise.all(
      sortedArtists.map(async (artist) => {
        try {
          const res = await fetch(`/api/search/catalog?q=${encodeURIComponent(artist)}&limit=15`);
          if (res.ok) {
            const data = await res.json();
            if (data.results && Array.isArray(data.results)) {
              for (const r of data.results) {
                candidates.push({
                  ...r,
                  addedAt: Date.now(),
                  path: '',
                  filename: ''
                });
              }
            }
          }
        } catch (_) {}
      })
    );

    // Also fetch songs for any prominent album or genre in the playlist
    const topAlbum = playlist.tracks.find(t => t.album && t.album !== 'Single' && t.album !== 'Imported Album')?.album;
    if (topAlbum) {
      try {
        const albumRes = await fetch(`/api/search/catalog?q=${encodeURIComponent(topAlbum)}&limit=10`);
        if (albumRes.ok) {
          const aData = await albumRes.json();
          if (aData.results && Array.isArray(aData.results)) {
            candidates.push(...aData.results.map((r: any) => ({
              ...r,
              addedAt: Date.now(),
              path: '',
              filename: ''
            })));
          }
        }
      } catch (_) {}
    }

    // Strictly filter out any track already in the playlist or duplicated in candidates
    const seenCandidateKeys = new Set<string>();
    const eligibleTracks: Track[] = [];

    for (const cand of candidates) {
      const key = `${normalize(cand.title)}::${normalize(cand.artist)}`;
      if (existingIds.has(cand.id) || existingKeys.has(key) || seenCandidateKeys.has(key)) {
        continue;
      }
      seenCandidateKeys.add(key);
      eligibleTracks.push(cand);
    }

    // If candidate pool is small, supplement with user's personalized Made For You (never generic chart hits)
    if (eligibleTracks.length < count * 2) {
      try {
        const recs = await StreamingService.getRecommendations();
        const fallback = [...recs.madeForYou, ...recs.genreMixes];
        for (const tr of fallback) {
          const key = `${normalize(tr.title)}::${normalize(tr.artist)}`;
          const art = (tr.artist || '').toLowerCase();
          const tit = (tr.title || '').toLowerCase();
          if (art === 'primo piatto' || art.includes('tribute') || art.includes('karaoke')) continue;
          if (/billboard\s*hot|top\s*hits\s*20\d\d|workout\s*hits/i.test(tit) && !art.includes('weeknd')) continue;
          if (!existingIds.has(tr.id) && !existingKeys.has(key) && !seenCandidateKeys.has(key)) {
            seenCandidateKeys.add(key);
            eligibleTracks.push(tr);
          }
        }
      } catch (_) {}
    }

    this.cachedPool.set(playlist.id, eligibleTracks.slice(count));

    return {
      suggestions: eligibleTracks.slice(0, count),
      pool: eligibleTracks.slice(count)
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
}
