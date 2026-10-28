import { Track, StreamingCategory, ProviderConfig } from '../types/music';
import { PreferenceService } from './preferenceService';

export const STREAM_CATEGORIES: StreamingCategory[] = [
  { id: 'trending', name: 'Global Hits', tag: 'trending', description: 'Top trending tracks and viral hits globally' },
  { id: 'lofi', name: 'Lo-Fi Chill', tag: 'lofi', description: 'Beats to study, relax, and code to' },
  { id: 'synthwave', name: 'Synthwave & Cyber', tag: 'synthwave', description: 'Retro 80s neon electronic synth' },
  { id: 'hiphop', name: 'Hip-Hop & R&B', tag: 'hiphop', description: 'Heavy 808 bass, trap, and melodic flows' }
];

export interface RecommendationShelves {
  madeForYou: Track[];
  trending: Track[];
  genreMixes: Track[];
}

export class StreamingService {
  private static cachedShelves: RecommendationShelves | null = null;
  private static searchCache: Map<string, Track[]> = new Map();

  /**
   * Search exclusively verified official releases (1000x1000 studio square art, 0 black bars)
   */
  static async searchVerifiedTracks(query: string): Promise<Track[]> {
    if (!query || !query.trim()) {
      const recs = await this.getRecommendations();
      return recs.trending;
    }

    const trimmed = query.trim().toLowerCase();
    if (this.searchCache.has(trimmed)) {
      return this.searchCache.get(trimmed)!;
    }

    try {
      // 1. Try Advanced Fridge Catalog Search (FTS5 + NLP intent + typo tolerance + ranking)
      try {
        const catRes = await fetch(`/api/search/catalog?q=${encodeURIComponent(query)}&limit=30`);
        if (catRes.ok) {
          const catData = await catRes.json();
          if (catData.results && catData.results.length > 0) {
            const tracks: Track[] = catData.results.map((t: any) => ({
              ...t,
              addedAt: Date.now(),
              path: '',
              filename: ''
            }));
            this.searchCache.set(trimmed, tracks);
            return tracks;
          }
        }
      } catch (_) {}

      // 2. Direct verified search fallback
      const res = await fetch(`/api/search/verified?q=${encodeURIComponent(query)}&limit=30`);
      if (!res.ok) throw new Error('Search API failed');
      const data = await res.json();
      const tracks: Track[] = (data.tracks || []).map((t: any) => ({
        ...t,
        addedAt: Date.now(),
        path: '',
        filename: ''
      }));
      if (tracks.length > 0) {
        this.searchCache.set(trimmed, tracks);
      } else {
        this.searchCache.delete(trimmed);
      }
      return tracks;
    } catch (err) {
      console.warn('Verified search failed, falling back:', err);
      this.searchCache.delete(trimmed);
      return [];
    }
  }

  static async searchGlobalMusic(query: string): Promise<Track[]> {
    return this.searchVerifiedTracks(query);
  }

  static async searchCloudTracks(query: string): Promise<Track[]> {
    return this.searchVerifiedTracks(query);
  }

  /**
   * Fetches personalized recommendation shelves based on user's preferred artists & genres
   */
  static async getRecommendations(forceRefresh = false): Promise<RecommendationShelves> {
    if (this.cachedShelves && !forceRefresh) {
      return this.cachedShelves;
    }

    const prefs = PreferenceService.getPreferences();
    const artists = encodeURIComponent(prefs.favoriteArtists.join(','));
    const genres = encodeURIComponent(prefs.favoriteGenres.join(','));

    try {
      const res = await fetch(`/api/recommendations?artists=${artists}&genres=${genres}`);
      if (!res.ok) throw new Error('Recommendations fetch failed');
      const data = await res.json();

      this.cachedShelves = {
        madeForYou: (data.madeForYou || []).map((t: any) => ({ ...t, addedAt: Date.now(), path: '', filename: '' })),
        trending: (data.trending || []).map((t: any) => ({ ...t, addedAt: Date.now(), path: '', filename: '' })),
        genreMixes: (data.genreMixes || []).map((t: any) => ({ ...t, addedAt: Date.now(), path: '', filename: '' }))
      };

      return this.cachedShelves;
    } catch (err) {
      console.warn('Recommendations error:', err);
      return {
        madeForYou: [],
        trending: [],
        genreMixes: []
      };
    }
  }

  /**
   * Generates smart, context-aware queue suggestions:
   * Anchors strictly on the currently playing track's artist & vibe first,
   * supplemented by user's verified taste profile and related songs.
   */
  static async getQueueRecommendations(
    currentTrack?: Track | null, 
    queue: Track[] = [], 
    limit = 20
  ): Promise<Track[]> {
    try {
      const candidates: Track[] = [];
      const seenIds = new Set<string>(queue.map(t => t.id));
      if (currentTrack) seenIds.add(currentTrack.id);

      // 1. Try LUMEN queue-continue endpoint with currentTrack context
      if (currentTrack && currentTrack.artist && currentTrack.artist !== 'Unknown Artist') {
        try {
          const res = await fetch('/api/recommendations/queue-continue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentTrack,
              recentQueue: queue.slice(0, 5),
              userId: 'local_user',
              limit: limit + 5
            })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.tracks && Array.isArray(data.tracks)) {
              for (const t of data.tracks) {
                if (!seenIds.has(t.id)) {
                  seenIds.add(t.id);
                  candidates.push({ ...t, addedAt: Date.now(), path: '', filename: '' });
                }
              }
            }
          }
        } catch (_) {}

        // Also fetch catalog songs by the current artist if we need more songs
        if (candidates.length < limit) {
          try {
            const artRes = await this.searchVerifiedTracks(currentTrack.artist);
            for (const t of artRes) {
              if (!seenIds.has(t.id)) {
                seenIds.add(t.id);
                candidates.push(t);
              }
            }
          } catch (_) {}
        }
      }

      // 2. Supplement strictly with user's favorite artists from preferences (NOT generic charts)
      if (candidates.length < limit) {
        const prefs = PreferenceService.getPreferences();
        for (const favArtist of (prefs.favoriteArtists || []).slice(0, 3)) {
          if (candidates.length >= limit) break;
          try {
            const favRes = await this.searchVerifiedTracks(favArtist);
            for (const t of favRes) {
              if (!seenIds.has(t.id) && candidates.length < limit) {
                seenIds.add(t.id);
                candidates.push(t);
              }
            }
          } catch (_) {}
        }
      }

      // Filter out any spam
      return candidates.filter(t => {
        const art = (t.artist || '').toLowerCase();
        const tit = (t.title || '').toLowerCase();
        if (art === 'primo piatto' || art.includes('tribute band') || art.includes('karaoke')) return false;
        if (/billboard\s*hot|top\s*hits\s*20\d\d|workout\s*hits/i.test(tit) && !art.includes('weeknd')) return false;
        return true;
      }).slice(0, limit);
    } catch (err) {
      console.warn('Queue recommendations error:', err);
      return [];
    }
  }

  static async getTrendingTracks(): Promise<Track[]> {
    const recs = await this.getRecommendations();
    return recs.trending.length > 0 ? recs.trending : recs.madeForYou;
  }

  static async getTracksByCategory(tag: string): Promise<Track[]> {
    return this.searchVerifiedTracks(tag);
  }

  static getProviderConfig(): ProviderConfig {
    return { activeSource: 'open-license' };
  }

  static saveProviderConfig(_config: ProviderConfig): void {}

  static purgeArtworkCache(): void {
    this.clearCache();
  }

  static clearCache(): void {
    this.cachedShelves = null;
    this.searchCache.clear();
  }
}
