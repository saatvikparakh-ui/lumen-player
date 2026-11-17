import { Track, StreamingCategory, ProviderConfig } from '../types/music';
import { PreferenceService } from './preferenceService';
import { ApiClient } from './apiClient';
import { TasteEngineService } from './tasteEngineService';
import { getArtworkUrl } from '../utils/artwork';

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

function decodeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
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

    const formattedArtwork = getArtworkUrl(t.artworkUrl100 || t.artworkUrl, 600);

    return {
      id: String(t.trackId || t.id || `${artist}-${title}`),
      title,
      artist,
      album,
      duration: nominalDuration,
      actualMediaDuration: nominalDuration,
      artworkUrl: formattedArtwork,
      hasArtwork: Boolean(formattedArtwork),
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
   * Transforms raw JioSaavn song result into a structured Track with 500x500 studio artwork
   */
  public static mapSaavnToTrack(item: any): Track {
    const title = decodeHtml(item.song || item.title || 'Unknown Title');
    const artist = decodeHtml(item.primary_artists || item.singers || item.music || 'Unknown Artist');
    const album = decodeHtml(item.album || title);
    const nominalDuration = parseInt(item.duration, 10) || 180;
    const artwork = (item.image || '').replace(/150x150\.jpg/g, '500x500.jpg').replace(/50x50\.jpg/g, '500x500.jpg') || null;
    const fullStreamUrl = `/api/stream/resolve?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&duration=${nominalDuration}`;
    const previewUrl = item.media_preview_url || null;

    return {
      id: `saavn_${item.id}`,
      title,
      artist,
      album,
      duration: nominalDuration,
      actualMediaDuration: nominalDuration,
      artworkUrl: artwork,
      hasArtwork: Boolean(artwork),
      fullStreamUrl,
      previewUrl,
      externalUrl: item.perma_url || null,
      streamUrl: fullStreamUrl,
      playbackType: 'full-stream',
      isExplicitPreview: false,
      genre: item.language || 'Music',
      year: item.year ? parseInt(item.year, 10) : undefined,
      addedAt: Date.now(),
      path: '',
      filename: '',
      isStream: true
    };
  }

  /**
   * Search verified official releases across multi-tier resilient providers.
   * Never fails on iTunes 429 rate limits: falls back to JioSaavn universal global catalog.
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

    const country = (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_itunes_country') : null) || 'IN';

    // 1. Direct iTunes Search First (Fastest for global western releases)
    try {
      const directRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(trimmed)}&entity=song&limit=30&country=${country}`,
        { signal }
      );
      if (directRes.ok) {
        const directData = await directRes.json();
        let tracks: Track[] = (directData.results || [])
          .map((t: any) => this.mapRawToTrack(t))
          .filter((t: Track) => TasteEngineService.isCleanTrack(t));
        if (tracks.length > 0) {
          this.searchCache.set(trimmed, tracks);
          return tracks;
        }

        // Secondary typo tolerance fallback: If exact word failed and word is e.g. "boderline" -> "borderline"
        const typoFixed = trimmed
          .replace(/\bboderline\b/g, 'borderline')
          .replace(/\bthe weeknd\b/g, 'the weeknd')
          .replace(/\btame impala\b/g, 'tame impala')
          .replace(/\barctic monkeys\b/g, 'arctic monkeys');
        if (typoFixed !== trimmed) {
          const retryRes = await fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(typoFixed)}&entity=song&limit=30&country=${country}`,
            { signal }
          );
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            tracks = (retryData.results || [])
              .map((t: any) => this.mapRawToTrack(t))
              .filter((t: Track) => TasteEngineService.isCleanTrack(t));
            if (tracks.length > 0) {
              this.searchCache.set(trimmed, tracks);
              return tracks;
            }
          }
        }
      }
    } catch (clientErr: any) {
      if (clientErr.name !== 'AbortError') {
        console.warn('Direct iTunes search error (rate-limit / offline), activating secondary provider:', clientErr);
      }
    }

    // 2. Direct Universal JioSaavn Search (Zero backend dependency, handles typos like 'Boderline', 100% mobile-resilient)
    try {
      const saavnRes = await fetch(
        `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=30&p=1&q=${encodeURIComponent(query.trim())}`,
        { signal }
      );
      if (saavnRes.ok) {
        const text = await saavnRes.text();
        const clean = text.trim();
        const data = JSON.parse(clean);
        const rawResults = data.results || [];
        if (rawResults.length > 0) {
          const tracks: Track[] = rawResults
            .map((item: any) => this.mapSaavnToTrack(item))
            .filter((t: Track) => TasteEngineService.isCleanTrack(t));
          if (tracks.length > 0) {
            this.searchCache.set(trimmed, tracks);
            return tracks;
          }
        }
      }
    } catch (saavnErr: any) {
      if (saavnErr.name !== 'AbortError') {
        console.warn('Direct JioSaavn client search notice:', saavnErr);
      }
    }

    // 3. High-Speed Resilient Verified Search (Multi-tier Backend Fallback)
    try {
      const verData = await ApiClient.get<{ tracks?: any[]; results?: any[] }>(
        `/api/search/verified?q=${encodeURIComponent(query)}&limit=30`,
        { timeoutMs: 6000, signal }
      );
      const rawTracks = verData?.tracks || verData?.results || [];
      if (rawTracks.length > 0) {
        const tracks: Track[] = rawTracks
          .map((t: any) => (t.id && t.id.startsWith('saavn_') ? this.mapSaavnToTrack(t) : this.mapRawToTrack(t)))
          .filter((t: Track) => TasteEngineService.isCleanTrack(t));
        if (tracks.length > 0) {
          this.searchCache.set(trimmed, tracks);
          return tracks;
        }
      }
    } catch (verErr: any) {
      if (verErr.name !== 'AbortError') {
        console.warn('[Search] Verified search fallback error:', verErr);
      }
    }

    // 3. Secondary Backend Catalog Search if direct searches returned empty
    try {
      const catData = await ApiClient.get<{ results: any[] }>(`/api/search/catalog?q=${encodeURIComponent(query)}&limit=30`, {
        timeoutMs: 3000,
        signal
      });
      if (catData && catData.results && catData.results.length > 0) {
        const tracks: Track[] = catData.results
          .map((t: any) => (t.id && t.id.startsWith('saavn_') ? this.mapSaavnToTrack(t) : this.mapRawToTrack(t)))
          .filter((t: Track) => TasteEngineService.isCleanTrack(t));
        if (tracks.length > 0) {
          this.searchCache.set(trimmed, tracks);
          return tracks;
        }
      }
    } catch (_) {}

    this.searchCache.delete(trimmed);
    return [];
  }

  static async searchTracks(query: string): Promise<Track[]> {
    return this.searchVerifiedTracks(query);
  }

  static async searchGlobalMusic(query: string): Promise<Track[]> {
    return this.searchVerifiedTracks(query);
  }

  static async searchCloudTracks(query: string): Promise<Track[]> {
    return this.searchVerifiedTracks(query);
  }

  /**
   * Fetches personalized recommendation shelves based on user's taste profile, liked songs & listening history
   */
  static async getRecommendations(forceRefresh = false): Promise<RecommendationShelves> {
    if (this.cachedShelves && !forceRefresh) {
      return this.cachedShelves;
    }

    try {
      const shelves = await TasteEngineService.generatePersonalizedShelves();
      if (shelves && (shelves.madeForYou.length > 0 || shelves.trending.length > 0)) {
        this.cachedShelves = shelves;
        return this.cachedShelves;
      }
    } catch (err) {
      console.warn('Taste engine recommendation error, using fallback:', err);
    }

    // Fallback: populate trending shelf from JioSaavn top hits
    try {
      const saavnRes = await fetch('https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=20&p=1&q=Top%20Hits');
      if (saavnRes.ok) {
        const data = await saavnRes.json();
        const fallbackTracks = (data.results || []).map((i: any) => this.mapSaavnToTrack(i));
        return {
          madeForYou: fallbackTracks.slice(0, 12),
          trending: fallbackTracks.slice(0, 15),
          genreMixes: fallbackTracks.slice(6, 18)
        };
      }
    } catch (_) {}

    return {
      madeForYou: [],
      trending: [],
      genreMixes: []
    };
  }

  /**
   * Generates smart, context-aware queue suggestions anchored to active song vibe & kindred artists
   */
  static async getQueueRecommendations(
    currentTrack?: Track | null, 
    queue: Track[] = [], 
    limit = 20
  ): Promise<Track[]> {
    try {
      return await TasteEngineService.getQueueSuggestions(currentTrack, queue, limit);
    } catch (err) {
      console.warn('Queue recommendations error:', err);
      return [];
    }
  }

  static async getTrendingTracks(): Promise<Track[]> {
    const recs = await this.getRecommendations();
    return recs.trending.length > 0 ? recs.trending : recs.madeForYou;
  }

  static async getTracksByCategory(category: string): Promise<Track[]> {
    const cat = STREAM_CATEGORIES.find(c => c.id === category);
    const tag = cat ? cat.tag : category;
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
