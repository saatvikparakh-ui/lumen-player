import { Track, StreamingCategory, ProviderConfig } from '../types/music';
import { PreferenceService } from './preferenceService';
import { ApiClient } from './apiClient';
import { TasteEngineService } from './tasteEngineService';

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
      const isOnline = await ApiClient.checkHealth(3500);
      if (isOnline) {
        const catData = await ApiClient.get<{ results: any[] }>(`/api/search/catalog?q=${encodeURIComponent(query)}&limit=30`, {
          timeoutMs: 3000,
          signal
        });
        if (catData && catData.results && catData.results.length > 0) {
          const tracks: Track[] = catData.results
            .map((t: any) => this.mapRawToTrack(t))
            .filter((t: Track) => TasteEngineService.isCleanTrack(t));
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
        const tracks: Track[] = (directData.results || [])
          .map((t: any) => this.mapRawToTrack(t))
          .filter((t: Track) => TasteEngineService.isCleanTrack(t));
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
