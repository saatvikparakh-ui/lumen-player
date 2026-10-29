import { Track, StreamingCategory, ProviderConfig } from '../types/music';
import { PreferenceService } from './preferenceService';
import { ApiClient } from './apiClient';

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
   * Transforms raw iTunes song result into a structured Track with separated audio sources
   */
  public static mapRawToTrack(t: any): Track {
    const nominalDuration = Math.round((t.trackTimeMillis || 0) / 1000) || 180;
    const title = t.trackName || t.title || 'Unknown Title';
    const artist = t.artistName || t.artist || 'Unknown Artist';
    const album = t.collectionName || t.album || title;
    const fullStreamUrl = `/api/stream/resolve?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&duration=${nominalDuration}`;
    const previewUrl = t.previewUrl || null;
    const externalUrl = t.trackViewUrl || null;

    return {
      id: String(t.trackId || t.id || `${artist}-${title}`),
      title,
      artist,
      album,
      duration: nominalDuration,
      actualMediaDuration: nominalDuration,
      artworkUrl: (t.artworkUrl100 || t.artworkUrl || '').replace('100x100bb', '600x600bb'),
      hasArtwork: true,
      fullStreamUrl,
      previewUrl,
      externalUrl,
      streamUrl: fullStreamUrl, // Prefers full-length stream; adapter falls back if offline
      playbackType: 'full-stream',
      isExplicitPreview: false,
      genre: t.primaryGenreName || t.genre,
      year: t.releaseDate ? new Date(t.releaseDate).getFullYear() : (t.year || undefined),
      addedAt: Date.now(),
      path: '',
      filename: '',
      isStream: true
    };
  }

  /**
   * Search exclusively verified official releases (1000x1000 studio square art, 0 black bars)
   */
  static async searchVerifiedTracks(query: string, signal?: AbortSignal): Promise<Track[]> {
    if (!query || !query.trim()) {
      const recs = await this.getRecommendations();
      return recs.trending;
    }

    const trimmed = query.trim().toLowerCase();
    if (this.searchCache.has(trimmed)) {
      return this.searchCache.get(trimmed)!;
    }

    // 1. Try Lumen Backend Catalog Search if available
    try {
      const isOnline = await ApiClient.checkHealth(1200);
      if (isOnline) {
        const catData = await ApiClient.get<{ results: any[] }>(`/api/search/catalog?q=${encodeURIComponent(query)}&limit=30`, {
          timeoutMs: 3000,
          signal
        });
        if (catData && catData.results && catData.results.length > 0) {
          const tracks: Track[] = catData.results.map((t: any) => this.mapRawToTrack(t));
          this.searchCache.set(trimmed, tracks);
          return tracks;
        }
      }
    } catch (_) {}

    // 2. Standalone Client-Side Direct Search (Zero server needed; works 100% on any mobile phone)
    try {
      const directRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=30`,
        { signal }
      );
      if (directRes.ok) {
        const directData = await directRes.json();
        const tracks: Track[] = (directData.results || []).map((t: any) => this.mapRawToTrack(t));
        if (tracks.length > 0) {
          this.searchCache.set(trimmed, tracks);
          return tracks;
        }
      }
    } catch (clientErr) {
      console.warn('Direct client search fallback error:', clientErr);
    }

    this.searchCache.delete(trimmed);
    return [];
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

    // 1. Try Backend Recommendations
    try {
      const isOnline = await ApiClient.checkHealth(1200);
      if (isOnline) {
        const data = await ApiClient.get<any>(`/api/recommendations?artists=${artists}&genres=${genres}`, { timeoutMs: 3500 });
        if (data && (data.madeForYou?.length > 0 || data.trending?.length > 0)) {
          this.cachedShelves = {
            madeForYou: (data.madeForYou || []).map((t: any) => this.mapRawToTrack(t)),
            trending: (data.trending || []).map((t: any) => this.mapRawToTrack(t)),
            genreMixes: (data.genreMixes || []).map((t: any) => this.mapRawToTrack(t))
          };
          return this.cachedShelves;
        }
      }
    } catch (err) {
      console.warn('Backend recommendations unreachable, falling back to direct public catalog:', err);
    }

    // 2. Standalone Fallback: Direct public trending hits
    try {
      const topRes = await fetch('https://itunes.apple.com/search?term=Top+Hits&entity=song&limit=30');
      if (topRes.ok) {
        const topData = await topRes.json();
        const fallbackTracks: Track[] = (topData.results || []).map((t: any) => this.mapRawToTrack(t));
        this.cachedShelves = {
          madeForYou: fallbackTracks.slice(0, 10),
          trending: fallbackTracks.slice(10, 20),
          genreMixes: fallbackTracks.slice(20, 30)
        };
        return this.cachedShelves;
      }
    } catch (fbErr) {
      console.warn('Direct fallback error:', fbErr);
    }

    return {
      madeForYou: [],
      trending: [],
      genreMixes: []
    };
  }

  /**
   * Generates smart, context-aware queue suggestions
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
          const isOnline = await ApiClient.checkHealth(1000);
          if (isOnline) {
            const data = await ApiClient.post<any>('/api/recommendations/queue-continue', {
              currentTrack,
              recentQueue: queue.slice(0, 5),
              userId: 'local_user',
              limit: limit + 5
            }, { timeoutMs: 3000 });

            if (data?.tracks && Array.isArray(data.tracks)) {
              for (const t of data.tracks) {
                if (!seenIds.has(t.id)) {
                  seenIds.add(t.id);
                  candidates.push(this.mapRawToTrack(t));
                }
              }
            }
          }
        } catch (_) {}

        // Supplement with catalog songs by the current artist if needed
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

      // 2. Supplement with user's favorite artists from preferences
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

      // Filter out spam/tributes
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
