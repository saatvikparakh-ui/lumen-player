/**
 * LUMEN ARTIST & CATALOG SERVICE
 * High-reliability artist search, discography resolution, and public metadata fallback.
 * Implements genuine artist discovery with stable IDs, genre metadata, studio portraits, and album tracklists.
 */

import { Track } from '../types/music';
import { ApiClient } from './apiClient';
import { StreamingService } from './streamingService';

export interface ArtistMetadata {
  id: string;
  name: string;
  genre: string;
  avatarUrl: string | null;
  artistLinkUrl?: string;
  trackCount?: number;
}

export interface AlbumMetadata {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  trackCount: number;
  artworkUrl: string | null;
  primaryGenreName?: string;
}

export interface CategorizedSearchResults {
  artists: ArtistMetadata[];
  tracks: Track[];
  albums: AlbumMetadata[];
}

export class ArtistService {
  private static artistCache: Map<string, ArtistMetadata[]> = new Map();
  private static discographyCache: Map<string, { topTracks: Track[]; albums: AlbumMetadata[] }> = new Map();
  private static albumTracksCache: Map<string, Track[]> = new Map();
  private static portraitCache: Map<string, string> = new Map();

  /**
   * Searches artists across backend and public music metadata catalog
   */
  public static async searchArtists(query: string, signal?: AbortSignal): Promise<ArtistMetadata[]> {
    const q = (query || '').trim();
    if (!q) return [];

    const cacheKey = q.toLowerCase();
    if (this.artistCache.has(cacheKey)) {
      return this.artistCache.get(cacheKey)!;
    }

    // 1. Try backend /api/artists/search
    try {
      const isOnline = await ApiClient.checkHealth(1000);
      if (isOnline) {
        const res = await ApiClient.get<{ artists: ArtistMetadata[] }>(
          `/api/artists/search?q=${encodeURIComponent(q)}`,
          { timeoutMs: 3000, signal }
        );
        if (res?.artists && Array.isArray(res.artists) && res.artists.length > 0) {
          this.artistCache.set(cacheKey, res.artists);
          return res.artists;
        }
      }
    } catch (_) {}

    // 2. Direct public Apple Music Artist Catalog Fallback
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=8`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        const rawResults = data.results || [];
        if (rawResults.length > 0) {
          const artists: ArtistMetadata[] = await Promise.all(
            rawResults.map(async (art: any, idx: number) => {
              const name = art.artistName || 'Unknown Artist';
              const id = String(art.artistId || Math.random());
              let avatarUrl = this.portraitCache.get(name.toLowerCase()) || null;

              // Resolve portrait for top 2 artists if not cached
              if (!avatarUrl && idx < 3) {
                try {
                  const songRes = await fetch(
                    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=song&limit=1`,
                    { signal }
                  );
                  if (songRes.ok) {
                    const songData = await songRes.json();
                    if (songData.results?.[0]?.artworkUrl100) {
                      avatarUrl = songData.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
                      if (avatarUrl) {
                        this.portraitCache.set(name.toLowerCase(), avatarUrl);
                      }
                    }
                  }
                } catch (_) {}
              }

              return {
                id: `artist_${id}`,
                name,
                genre: art.primaryGenreName || 'Music',
                avatarUrl,
                artistLinkUrl: art.artistLinkUrl
              };
            })
          );

          this.artistCache.set(cacheKey, artists);
          return artists;
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Artist catalog fallback error:', err);
      }
    }

    return [];
  }

  /**
   * Searches albums across public music metadata catalog
   */
  public static async searchAlbums(query: string, signal?: AbortSignal): Promise<AlbumMetadata[]> {
    const q = (query || '').trim();
    if (!q) return [];

    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=8`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        return (data.results || []).map((alb: any) => ({
          id: String(alb.collectionId),
          title: alb.collectionName || 'Unknown Album',
          artist: alb.artistName || 'Unknown Artist',
          year: alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : null,
          trackCount: alb.trackCount || 0,
          artworkUrl: (alb.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
          primaryGenreName: alb.primaryGenreName
        }));
      }
    } catch (_) {}

    return [];
  }

  /**
   * Multi-category search: songs, artists, albums with unified cancellation & debounce support
   */
  public static async searchAll(query: string, signal?: AbortSignal): Promise<CategorizedSearchResults> {
    const [tracks, artists, albums] = await Promise.all([
      StreamingService.searchVerifiedTracks(query, signal).catch(() => []),
      this.searchArtists(query, signal).catch(() => []),
      this.searchAlbums(query, signal).catch(() => [])
    ]);

    return { tracks, artists, albums };
  }

  /**
   * Retrieves artist discography (top tracks + full studio albums)
   */
  public static async getArtistDiscography(
    artistName: string
  ): Promise<{ topTracks: Track[]; albums: AlbumMetadata[] }> {
    const cleanName = (artistName || '').trim();
    if (!cleanName) return { topTracks: [], albums: [] };

    const cacheKey = cleanName.toLowerCase();
    if (this.discographyCache.has(cacheKey)) {
      return this.discographyCache.get(cacheKey)!;
    }

    // 1. Try backend /api/artist?name=...
    try {
      const isOnline = await ApiClient.checkHealth(1000);
      if (isOnline) {
        const res = await ApiClient.get<{
          success: boolean;
          topTracks: any[];
          albums: any[];
        }>(`/api/artist?name=${encodeURIComponent(cleanName)}`, { timeoutMs: 4000 });

        if (res && res.success && (res.topTracks?.length > 0 || res.albums?.length > 0)) {
          const topTracks: Track[] = (res.topTracks || []).map(t => StreamingService.mapRawToTrack(t));
          const albums: AlbumMetadata[] = (res.albums || []).map(a => ({
            id: String(a.id || a.collectionId),
            title: a.title || a.collectionName,
            artist: a.artist || cleanName,
            year: a.year || (a.releaseDate ? new Date(a.releaseDate).getFullYear() : null),
            trackCount: a.trackCount || 0,
            artworkUrl: a.artworkUrl || (a.artworkUrl100 ? a.artworkUrl100.replace('100x100bb', '600x600bb') : null),
            primaryGenreName: a.primaryGenreName
          }));

          const payload = { topTracks, albums };
          this.discographyCache.set(cacheKey, payload);
          return payload;
        }
      }
    } catch (_) {}

    // 2. Direct public fallback: parallel query top tracks and albums
    try {
      const [songsRes, albumsRes] = await Promise.all([
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=song&limit=25`),
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=25`)
      ]);

      let topTracks: Track[] = [];
      if (songsRes.ok) {
        const sData = await songsRes.json();
        // Filter songs strictly to match artist
        topTracks = (sData.results || [])
          .filter((t: any) => (t.artistName || '').toLowerCase().includes(cleanName.toLowerCase()))
          .map((t: any) => StreamingService.mapRawToTrack(t));
      }

      let albums: AlbumMetadata[] = [];
      if (albumsRes.ok) {
        const aData = await albumsRes.json();
        albums = (aData.results || [])
          .filter((a: any) => (a.artistName || '').toLowerCase().includes(cleanName.toLowerCase()))
          .map((alb: any) => ({
            id: String(alb.collectionId),
            title: alb.collectionName || 'Unknown Album',
            artist: alb.artistName || cleanName,
            year: alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : null,
            trackCount: alb.trackCount || 0,
            artworkUrl: (alb.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
            primaryGenreName: alb.primaryGenreName
          }));
      }

      const payload = { topTracks, albums };
      if (topTracks.length > 0 || albums.length > 0) {
        this.discographyCache.set(cacheKey, payload);
      }
      return payload;
    } catch (fbErr) {
      console.warn('Artist discography fallback error:', fbErr);
    }

    return { topTracks: [], albums: [] };
  }

  /**
   * Retrieves tracks for a specific album
   */
  public static async getAlbumTracks(
    albumId: string, 
    albumTitle?: string, 
    artistName?: string
  ): Promise<Track[]> {
    if (!albumId) return [];

    if (this.albumTracksCache.has(albumId)) {
      return this.albumTracksCache.get(albumId)!;
    }

    // 1. Try backend /api/album
    try {
      const isOnline = await ApiClient.checkHealth(1000);
      if (isOnline) {
        const titleHint = encodeURIComponent(albumTitle || '');
        const artistHint = encodeURIComponent(artistName || '');
        const res = await ApiClient.get<{
          success: boolean;
          album?: { tracks: any[] };
        }>(`/api/album?id=${albumId}&title=${titleHint}&artist=${artistHint}`, { timeoutMs: 4000 });

        if (res && res.success && res.album?.tracks && res.album.tracks.length > 0) {
          const tracks = res.album.tracks.map(t => StreamingService.mapRawToTrack(t));
          this.albumTracksCache.set(albumId, tracks);
          return tracks;
        }
      }
    } catch (_) {}

    // 2. Direct public fallback: iTunes collection lookup
    try {
      const cleanId = albumId.replace(/\D/g, '');
      if (cleanId) {
        const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${cleanId}&entity=song&limit=50`);
        if (lookupRes.ok) {
          const data = await lookupRes.json();
          const tracks: Track[] = (data.results || [])
            .filter((item: any) => item.wrapperType === 'track')
            .map((t: any) => StreamingService.mapRawToTrack(t));

          if (tracks.length > 0) {
            this.albumTracksCache.set(albumId, tracks);
            return tracks;
          }
        }
      }
    } catch (err) {
      console.warn('Album track lookup fallback error:', err);
    }

    return [];
  }
}
