import { Track } from '../types/music';
import { StreamingService } from './streamingService';
import { ApiClient } from './apiClient';

/**
 * High-reliability artist search, discography resolution, and public metadata fallback.
 */

export interface ArtistMetadata {
  id: string;
  name: string;
  genre: string;
  avatarUrl?: string | null;
  artistLinkUrl?: string;
  bio?: string;
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
  releaseType?: 'album' | 'single' | 'collab';
}

export interface DiscographyResult {
  topTracks: Track[];
  albums: AlbumMetadata[];
  singles: AlbumMetadata[];
  collabs: AlbumMetadata[];
}

export interface CategorizedSearchResults {
  tracks: Track[];
  artists: ArtistMetadata[];
  albums: AlbumMetadata[];
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

export class ArtistService {
  private static artistCache: Map<string, ArtistMetadata[]> = new Map();
  private static discographyCache: Map<string, DiscographyResult> = new Map();
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

              // Resolve portrait for top 3 artists if not cached (A8: lookup?id=<artistId>&entity=album)
              if (!avatarUrl && idx < 3 && art.artistId) {
                try {
                  const albumLookupRes = await fetch(
                    `https://itunes.apple.com/lookup?id=${art.artistId}&entity=album&limit=2&country=IN`,
                    { signal }
                  );
                  if (albumLookupRes.ok) {
                    const lookupData = await albumLookupRes.json();
                    const topAlbum = lookupData.results?.find((r: any) => r.wrapperType === 'collection' && r.artworkUrl100);
                    if (topAlbum?.artworkUrl100) {
                      avatarUrl = topAlbum.artworkUrl100.replace('100x100bb', '600x600bb');
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

    // 3. Resilient Universal Catalog Fallback (JioSaavn Autocomplete - Zero Rate Limit)
    try {
      const res = await fetch(
        `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&query=${encodeURIComponent(q)}`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        const rawArtists = data.artists?.data || [];
        if (rawArtists.length > 0) {
          const artists: ArtistMetadata[] = rawArtists.map((art: any) => ({
            id: `artist_saavn_${art.id}`,
            name: decodeHtml(art.title),
            genre: art.description || 'Verified Artist',
            avatarUrl: art.image && !art.image.includes('default') ? art.image.replace(/50x50\.jpg/g, '500x500.jpg') : null,
            artistLinkUrl: art.url
          }));
          this.artistCache.set(cacheKey, artists);
          return artists;
        }
      }
    } catch (_) {}

    return [];
  }

  /**
   * Searches albums across public music metadata catalog
   */
  public static async searchAlbums(query: string, signal?: AbortSignal): Promise<AlbumMetadata[]> {
    const q = (query || '').trim();
    if (!q) return [];

    const albums: AlbumMetadata[] = [];
    const seenTitles = new Set<string>();

    const addAlbum = (alb: any) => {
      const title = alb.collectionName || alb.title;
      if (!title || (!alb.artworkUrl100 && !alb.artworkUrl && !alb.image)) return;
      
      // Filter out obvious tribute/karaoke albums unless specifically searching for them
      const isTribute = /\b(tribute|karaoke|lullaby|piano version|string quartet|in the style of|tribute band)\b/i.test(title);
      if (isTribute && !q.toLowerCase().includes('tribute') && !q.toLowerCase().includes('karaoke')) return;

      const norm = title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (norm && !seenTitles.has(norm)) {
        seenTitles.add(norm);
        const rawArt = alb.artworkUrl100 || alb.artworkUrl || alb.image || '';
        const highResArt = rawArt.replace(/\/\d+x\d+(bb|-\d+)?(?=\.(jpg|png|webp)$)/i, '/600x600bb.jpg');

        albums.push({
          id: String(alb.collectionId || alb.id),
          title: title,
          artist: alb.artistName || alb.artist || 'Unknown Artist',
          year: alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : (alb.year || null),
          trackCount: alb.trackCount || 0,
          artworkUrl: highResArt,
          primaryGenreName: alb.primaryGenreName
        });
      }
    };

    // 1. Deep Discography Artist Lookup (Pink Floyd, The Beatles, Radiohead, Led Zeppelin, etc.)
    try {
      const artRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=1`,
        { signal }
      );
      if (artRes.ok) {
        const artData = await artRes.json();
        const artist = artData.results?.[0];
        if (artist && artist.artistId) {
          // Increase limit to 200 to capture the full catalog for prolific discographies
          const discRes = await fetch(
            `https://itunes.apple.com/lookup?id=${artist.artistId}&entity=album&limit=200`,
            { signal }
          );
          if (discRes.ok) {
            const discData = await discRes.json();
            // First item in lookup is the artist record; subsequent items are albums
            for (const item of (discData.results?.slice(1) || [])) {
              addAlbum(item);
            }
          }
        }
      }
    } catch (_) {}

    // 2. Direct Apple iTunes Album Search (up to 50 albums)
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=50`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        for (const item of (data.results || [])) {
          addAlbum(item);
        }
      }
    } catch (_) {}

    if (albums.length > 0) {
      // Prioritize full-length studio albums (5+ tracks) over 1-song singles and EPs,
      // placing the core discography at the forefront of the search view
      albums.sort((a, b) => {
        const aIsStudio = (a.trackCount || 0) >= 5;
        const bIsStudio = (b.trackCount || 0) >= 5;
        if (aIsStudio && !bIsStudio) return -1;
        if (!aIsStudio && bIsStudio) return 1;
        return (b.trackCount || 0) - (a.trackCount || 0);
      });
      return albums;
    }

    // 3. Resilient Universal Catalog Fallback (JioSaavn Autocomplete Albums)
    try {
      const res = await fetch(
        `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&query=${encodeURIComponent(q)}`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        const rawAlbums = data.albums?.data || [];
        if (rawAlbums.length > 0) {
          return rawAlbums.map((alb: any) => ({
            id: `album_saavn_${alb.id}`,
            title: decodeHtml(alb.title),
            artist: decodeHtml(alb.music || 'Various Artists'),
            year: alb.more_info?.year ? parseInt(alb.more_info.year, 10) : null,
            trackCount: alb.more_info?.song_pids ? alb.more_info.song_pids.split(',').length : 0,
            artworkUrl: (alb.image || '').replace(/50x50\.jpg/g, '500x500.jpg'),
            primaryGenreName: alb.more_info?.language || 'Music'
          }));
        }
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
   * Retrieves artist discography (top tracks + segmented studio albums, singles & EPs, collabs)
   * Resolves up to 100 releases via Apple Music Lookup API.
   */
  public static async getArtistDiscography(
    artistName: string
  ): Promise<DiscographyResult> {
    const cleanName = (artistName || '').trim();
    if (!cleanName) return { topTracks: [], albums: [], singles: [], collabs: [] };

    const cacheKey = cleanName.toLowerCase();
    if (this.discographyCache.has(cacheKey)) {
      return this.discographyCache.get(cacheKey)!;
    }

    // 1. Authoritative Apple Music Artist ID Lookup (Limit 100 Releases)
    try {
      const artistSearchRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=musicArtist&limit=1`
      );
      if (artistSearchRes.ok) {
        const artistData = await artistSearchRes.json();
        const artist = artistData.results?.[0];
        if (artist && artist.artistId) {
          const artistId = artist.artistId;
          const [albumsLookupRes, songsLookupRes] = await Promise.all([
            fetch(`https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=100`),
            fetch(`https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=50`)
          ]);

          if (albumsLookupRes.ok) {
            const aData = await albumsLookupRes.json();
            const rawCollections = (aData.results || []).filter((r: any) => r.wrapperType === 'collection');

            const albums: AlbumMetadata[] = [];
            const singles: AlbumMetadata[] = [];
            const collabs: AlbumMetadata[] = [];
            const seenTitles = new Set<string>();

            for (const alb of rawCollections) {
              const rawTitle = alb.collectionName || 'Unknown Release';
              const normTitle = rawTitle.toLowerCase().replace(/\[.+?\]|\(.+?\)/g, '').trim();
              const artistOfAlbum = alb.artistName || cleanName;
              const artistLower = artistOfAlbum.toLowerCase();
              const cleanLower = cleanName.toLowerCase();
              const trackCount = alb.trackCount || 1;
              const year = alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : null;
              const art = alb.artworkUrl100 ? alb.artworkUrl100.replace('100x100bb', '600x600bb') : null;

              // Check if release is a collaboration / appears on
              const isCollab = !artistLower.startsWith(cleanLower) ||
                artistLower.includes('feat.') ||
                artistLower.includes('ft.') ||
                artistLower.includes('with') ||
                artistLower.includes('various artists');

              const isSingleOrEp = trackCount < 6 ||
                rawTitle.toLowerCase().includes(' - single') ||
                rawTitle.toLowerCase().includes(' - ep') ||
                rawTitle.toLowerCase().endsWith(' single') ||
                rawTitle.toLowerCase().endsWith(' ep');

              const item: AlbumMetadata = {
                id: String(alb.collectionId),
                title: rawTitle,
                artist: artistOfAlbum,
                year,
                trackCount,
                artworkUrl: art,
                primaryGenreName: alb.primaryGenreName,
                releaseType: isCollab ? 'collab' : (isSingleOrEp ? 'single' : 'album')
              };

              // De-duplicate duplicate editions (e.g. clean vs explicit) within same category
              const dedupeKey = `${item.releaseType}_${normTitle}`;
              if (seenTitles.has(dedupeKey)) continue;
              seenTitles.add(dedupeKey);

              if (item.releaseType === 'collab') {
                collabs.push(item);
              } else if (item.releaseType === 'single') {
                singles.push(item);
              } else {
                albums.push(item);
              }
            }

            // Sort newest first
            albums.sort((a, b) => (b.year || 0) - (a.year || 0));
            singles.sort((a, b) => (b.year || 0) - (a.year || 0));
            collabs.sort((a, b) => (b.year || 0) - (a.year || 0));

            let topTracks: Track[] = [];
            if (songsLookupRes.ok) {
              const sData = await songsLookupRes.json();
              topTracks = (sData.results || [])
                .filter((r: any) => r.wrapperType === 'track')
                .map((t: any) => StreamingService.mapRawToTrack(t));
            }

            if (albums.length > 0 || singles.length > 0 || topTracks.length > 0) {
              const payload: DiscographyResult = { topTracks, albums, singles, collabs };
              this.discographyCache.set(cacheKey, payload);
              return payload;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('[ArtistService] Apple Music lookup error:', e);
    }

    // 2. Direct public fallback: parallel query top tracks and albums
    try {
      const [songsRes, albumsRes] = await Promise.all([
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=song&limit=50`),
        fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=50`)
      ]);

      let topTracks: Track[] = [];
      if (songsRes.ok) {
        const sData = await songsRes.json();
        topTracks = (sData.results || [])
          .filter((t: any) => (t.artistName || '').toLowerCase().includes(cleanName.toLowerCase()))
          .map((t: any) => StreamingService.mapRawToTrack(t));
      }

      let allReleases: AlbumMetadata[] = [];
      if (albumsRes.ok) {
        const aData = await albumsRes.json();
        allReleases = (aData.results || [])
          .map((alb: any) => ({
            id: String(alb.collectionId),
            title: alb.collectionName || 'Unknown Album',
            artist: alb.artistName || cleanName,
            year: alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : null,
            trackCount: alb.trackCount || 0,
            artworkUrl: (alb.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
            primaryGenreName: alb.primaryGenreName,
            releaseType: (alb.trackCount < 6 || (alb.collectionName || '').toLowerCase().includes('single')) ? 'single' as const : 'album' as const
          }));
      }

      const albums = allReleases.filter(r => r.releaseType === 'album');
      const singles = allReleases.filter(r => r.releaseType === 'single');
      const collabs: AlbumMetadata[] = [];

      if (topTracks.length > 0 || albums.length > 0 || singles.length > 0) {
        const payload: DiscographyResult = { topTracks, albums, singles, collabs };
        this.discographyCache.set(cacheKey, payload);
        return payload;
      }
    } catch (e: any) {
      console.warn('Apple music discography fallback failed:', e.message);
    }

    // 3. Resilient Universal Catalog Fallback (JioSaavn search for artist tracks)
    try {
      const saavnRes = await fetch(
        `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=30&p=1&q=${encodeURIComponent(cleanName)}`
      );
      if (saavnRes.ok) {
        const data = await saavnRes.json();
        if (data && Array.isArray(data.results) && data.results.length > 0) {
          const topTracks: Track[] = data.results.map((item: any) => StreamingService.mapSaavnToTrack(item));
          const payload: DiscographyResult = { topTracks, albums: [], singles: [], collabs: [] };
          this.discographyCache.set(cacheKey, payload);
          return payload;
        }
      }
    } catch (_) {}

    return { topTracks: [], albums: [], singles: [], collabs: [] };
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

    // 3. Fallback: Search iTunes for the album and lookup all its songs in original track order
    if (albumTitle) {
      try {
        const queryTerm = encodeURIComponent(`${albumTitle} ${artistName || ''}`.trim());
        const searchRes = await fetch(`https://itunes.apple.com/search?term=${queryTerm}&entity=album&limit=5`);
        if (searchRes.ok) {
          const sData = await searchRes.json();
          const firstAlbum = (sData.results || []).find((a: any) => 
            a.collectionName?.toLowerCase().includes(albumTitle.toLowerCase()) || 
            albumTitle.toLowerCase().includes(a.collectionName?.toLowerCase() || '')
          ) || sData.results?.[0];

          if (firstAlbum?.collectionId) {
            const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${firstAlbum.collectionId}&entity=song&limit=100`);
            if (lookupRes.ok) {
              const lData = await lookupRes.json();
              const tracks: Track[] = (lData.results || [])
                .filter((item: any) => item.wrapperType === 'track')
                .map((t: any) => StreamingService.mapRawToTrack(t));

              if (tracks.length > 0) {
                this.albumTracksCache.set(albumId, tracks);
                return tracks;
              }
            }
          }
        }
      } catch (err) {
        console.warn('iTunes album collection lookup error:', err);
      }

      // 4. Ultimate fallback: Search verified tracks by title + artist
      try {
        const tracks = await StreamingService.searchVerifiedTracks(`${albumTitle} ${artistName || ''}`);
        if (tracks.length > 0) {
          this.albumTracksCache.set(albumId, tracks);
          return tracks;
        }
      } catch (_) {}
    }

    return [];
  }
}
