import { Track } from '../types/music';
import { StreamingService } from './streamingService';
import { ApiClient } from './apiClient';
import { LikedService } from './likedService';
import { PlaylistService } from './playlistService';
import {
  ArtistIdentityContext,
  ArtistRankingProvider,
  RankedTrackEntry,
  RawProviderTrack,
  StructuredArtistRankingResult,
  buildArtistRanking,
  buildArtistRankingCacheKey,
  classifyArtistCredit,
  disambiguateArtistCandidate,
  purgeLegacyArtistCaches
} from './artistRankingLogic';

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
  ranking: StructuredArtistRankingResult;
  artistPortraitUrl?: string | null;
  verifiedBySource?: boolean;
  artistId?: string | null;
  subscriberCountText?: string | null;
  monthlyAudienceText?: string | null;
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
  private static albumSearchCache: Map<string, AlbumMetadata[]> = new Map();
  private static discographyCache: Map<string, DiscographyResult> = new Map();
  private static albumTracksCache: Map<string, Track[]> = new Map();
  private static portraitCache: Map<string, string> = new Map();

  /**
   * Ultra-fast parallel artist search (<150ms): skips slow backend health checks on keystroke,
   * races iTunes + JioSaavn artist autocomplete in parallel, and caches immediately.
   */
  public static async searchArtists(query: string, signal?: AbortSignal): Promise<ArtistMetadata[]> {
    const q = (query || '').trim();
    if (!q) return [];

    const cacheKey = q.toLowerCase();
    if (this.artistCache.has(cacheKey)) {
      return this.artistCache.get(cacheKey)!;
    }

    const byName = new Map<string, ArtistMetadata>();
    const addArtist = (art: ArtistMetadata) => {
      const k = art.name.toLowerCase().trim();
      if (!k) return;
      const existing = byName.get(k);
      if (!existing) {
        byName.set(k, art);
      } else if (!existing.avatarUrl && art.avatarUrl) {
        byName.set(k, { ...existing, avatarUrl: art.avatarUrl });
      }
    };

    const country = (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_itunes_country') : null) || 'IN';

    await Promise.allSettled([
      // 1. Direct iTunes Artist Search (fast, no nested blocking portrait lookups!)
      fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=8&country=${country}`,
        { signal }
      )
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          for (const art of (data?.results || [])) {
            const name = art.artistName || '';
            if (!name) continue;
            const cachedPortrait = this.portraitCache.get(name.toLowerCase()) || null;
            addArtist({
              id: `artist_${art.artistId || name}`,
              name,
              genre: art.primaryGenreName || 'Artist',
              avatarUrl: cachedPortrait,
              artistLinkUrl: art.artistLinkUrl
            });
          }
        })
        .catch(() => {}),

      // 2. JioSaavn Autocomplete (returns artist portraits in a single fast request!)
      fetch(
        `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&query=${encodeURIComponent(q)}`,
        { signal }
      )
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          for (const art of (data?.artists?.data || [])) {
            const name = decodeHtml(art.title || '');
            if (!name) continue;
            const img = art.image && !String(art.image).includes('default')
              ? String(art.image).replace(/50x50\.jpg/g, '500x500.jpg')
              : null;
            if (img) this.portraitCache.set(name.toLowerCase(), img);
            addArtist({
              id: `artist_saavn_${art.id}`,
              name,
              genre: art.description || 'Artist',
              avatarUrl: img,
              artistLinkUrl: art.url
            });
          }
        })
        .catch(() => {})
    ]);

    const qLower = cacheKey;
    const artists = Array.from(byName.values()).sort((a, b) => {
      const aL = a.name.toLowerCase();
      const bL = b.name.toLowerCase();
      const aScore = (aL === qLower ? 120 : aL.startsWith(qLower) ? 80 : aL.includes(qLower) ? 40 : 10) + (a.avatarUrl ? 10 : 0);
      const bScore = (bL === qLower ? 120 : bL.startsWith(qLower) ? 80 : bL.includes(qLower) ? 40 : 10) + (b.avatarUrl ? 10 : 0);
      return bScore - aScore;
    });

    if (artists.length > 0) {
      this.artistCache.set(cacheKey, artists);
    }
    return artists;
  }

  /**
   * Fast Spotify-grade album search: runs iTunes direct album search + JioSaavn albums in parallel,
   * ranks by exact/prefix title & artist relevance, and caches results.
   */
  public static async searchAlbums(query: string, signal?: AbortSignal): Promise<AlbumMetadata[]> {
    const q = (query || '').trim();
    if (!q) return [];

    const cacheKey = q.toLowerCase();
    if (this.albumSearchCache.has(cacheKey)) {
      return this.albumSearchCache.get(cacheKey)!;
    }

    const albums: AlbumMetadata[] = [];
    const seenKeys = new Set<string>();
    const qLower = q.toLowerCase();
    const qNorm = qLower.replace(/[^a-z0-9]/g, '');

    const addAlbum = (alb: any, isSaavn = false) => {
      const title = isSaavn ? decodeHtml(alb.title || '') : (alb.collectionName || alb.title || '');
      const artist = isSaavn ? decodeHtml(alb.music || 'Various Artists') : (alb.artistName || alb.artist || 'Unknown Artist');
      const rawArt = isSaavn
        ? (alb.image || '').replace(/50x50\.jpg/g, '500x500.jpg')
        : (alb.artworkUrl100 || alb.artworkUrl || alb.image || '');
      if (!title || !rawArt) return;

      const isTribute = /\b(tribute|karaoke|lullaby|piano version|string quartet|in the style of|tribute band)\b/i.test(title);
      if (isTribute && !qLower.includes('tribute') && !qLower.includes('karaoke')) return;

      const normTitle = title.toLowerCase().replace(/\[.+?\]|\(.+?\)/g, '').replace(/[^a-z0-9]/g, '');
      const normArtist = artist.toLowerCase().replace(/[^a-z0-9]/g, '');
      const dedupeKey = `${normTitle}__${normArtist}`;
      if (!normTitle || seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);

      const highResArt = isSaavn
        ? rawArt
        : rawArt.replace(/\/\d+x\d+(bb|-\d+)?(?=\.(jpg|png|webp)$)/i, '/600x600bb.jpg');

      albums.push({
        id: isSaavn ? `album_saavn_${alb.id}` : String(alb.collectionId || alb.id),
        title,
        artist,
        year: isSaavn
          ? (alb.more_info?.year ? parseInt(alb.more_info.year, 10) : null)
          : (alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : (alb.year || null)),
        trackCount: isSaavn
          ? (alb.more_info?.song_pids ? alb.more_info.song_pids.split(',').length : 0)
          : (alb.trackCount || 0),
        artworkUrl: highResArt,
        primaryGenreName: isSaavn ? (alb.more_info?.language || 'Music') : alb.primaryGenreName
      });
    };

    // Run iTunes direct album search & JioSaavn album autocomplete IN PARALLEL for ultra-fast response
    await Promise.allSettled([
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=35`, { signal })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          for (const item of (data?.results || [])) addAlbum(item, false);
        })
        .catch(() => {}),
      fetch(`https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&query=${encodeURIComponent(q)}`, { signal })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          for (const item of (data?.albums?.data || [])) addAlbum(item, true);
        })
        .catch(() => {})
    ]);

    // If user searched an artist name and we have few albums, fetch their core discography quickly
    if (albums.length < 4 && !signal?.aborted) {
      try {
        const artRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=2`,
          { signal }
        );
        if (artRes.ok) {
          const artData = await artRes.json();
          const matchedArtist = (artData.results || []).find((a: any) =>
            a.artistName?.toLowerCase() === qLower || a.artistName?.toLowerCase().includes(qLower)
          );
          if (matchedArtist?.artistId) {
            const discRes = await fetch(
              `https://itunes.apple.com/lookup?id=${matchedArtist.artistId}&entity=album&limit=40`,
              { signal }
            );
            if (discRes.ok) {
              const discData = await discRes.json();
              for (const item of (discData.results?.slice(1) || [])) addAlbum(item, false);
            }
          }
        }
      } catch (_) {}
    }

    if (albums.length > 0) {
      const scoreAlbum = (a: AlbumMetadata): number => {
        const t = a.title.toLowerCase();
        const tNorm = t.replace(/[^a-z0-9]/g, '');
        const ar = a.artist.toLowerCase();
        const arNorm = ar.replace(/[^a-z0-9]/g, '');
        let score = 0;
        if (t === qLower || tNorm === qNorm) score += 120;
        else if (t.startsWith(qLower) || tNorm.startsWith(qNorm)) score += 75;
        else if (t.includes(qLower) || (qNorm.length >= 3 && tNorm.includes(qNorm))) score += 45;
        if (ar === qLower || arNorm === qNorm) score += 55;
        else if (ar.includes(qLower)) score += 25;
        if ((a.trackCount || 0) >= 6) score += 22;
        else if ((a.trackCount || 0) >= 4) score += 10;
        return score;
      };

      albums.sort((a, b) => {
        const diff = scoreAlbum(b) - scoreAlbum(a);
        if (diff !== 0) return diff;
        return (b.trackCount || 0) - (a.trackCount || 0);
      });

      const trimmed = albums.slice(0, 30);
      this.albumSearchCache.set(cacheKey, trimmed);
      return trimmed;
    }

    return [];
  }

  /**
   * 0ms Synchronous Local Instant Search Index:
   * Immediately matches user's Liked Songs, Playlists, and in-memory cached results
   * so results pop up on the very first millisecond of typing (Spotify instant-answer feel).
   */
  public static searchInstantLocal(query: string): CategorizedSearchResults {
    const q = (query || '').trim().toLowerCase();
    if (!q) return { tracks: [], artists: [], albums: [] };
    const qTokens = q.split(/\s+/).filter(Boolean);

    const matchesQuery = (text: string) => {
      const low = (text || '').toLowerCase();
      if (!low) return false;
      if (low.includes(q)) return true;
      return qTokens.length > 1 && qTokens.every(tok => low.includes(tok));
    };

    const trackMap = new Map<string, Track>();
    const artistMap = new Map<string, ArtistMetadata>();
    const albumMap = new Map<string, AlbumMetadata>();

    const ingestTrack = (t: Track) => {
      if (!t?.title) return;
      const key = `${(t.artist || '').toLowerCase().trim()}::${t.title.toLowerCase().trim()}`;
      if (matchesQuery(t.title) || matchesQuery(t.artist) || matchesQuery(t.album || '')) {
        if (!trackMap.has(key)) trackMap.set(key, t);
      }
      if (t.artist && matchesQuery(t.artist)) {
        const aKey = t.artist.toLowerCase().trim();
        if (!artistMap.has(aKey)) {
          artistMap.set(aKey, {
            id: `local_artist_${aKey}`,
            name: t.artist,
            genre: t.genre || 'Artist',
            avatarUrl: this.portraitCache.get(aKey) || t.artworkUrl || null
          });
        }
      }
      if (t.album && t.album !== t.title && matchesQuery(t.album)) {
        const albKey = `${t.album.toLowerCase().trim()}::${(t.artist || '').toLowerCase().trim()}`;
        if (!albumMap.has(albKey)) {
          albumMap.set(albKey, {
            id: `local_alb_${albKey}`,
            title: t.album,
            artist: t.artist || 'Unknown Artist',
            year: t.year || null,
            trackCount: 0,
            artworkUrl: t.artworkUrl || null
          });
        }
      }
    };

    // 1. User's Liked Songs & Playlists (highest personal affinity!)
    try {
      LikedService.getLikedTracks().forEach(ingestTrack);
    } catch (_) {}
    try {
      PlaylistService.getPlaylists().forEach(pl => (pl.tracks || []).forEach(ingestTrack));
    } catch (_) {}

    // 2. Prefix hit in in-memory artist & album caches (instant for backspaces & continuations)
    for (const [k, list] of this.artistCache.entries()) {
      if (k === q || k.startsWith(q) || q.startsWith(k)) {
        list.forEach(art => {
          if (matchesQuery(art.name)) {
            const aKey = art.name.toLowerCase().trim();
            if (!artistMap.has(aKey)) artistMap.set(aKey, art);
          }
        });
      }
    }
    for (const [k, list] of this.albumSearchCache.entries()) {
      if (k === q || k.startsWith(q) || q.startsWith(k)) {
        list.forEach(alb => {
          if (matchesQuery(alb.title) || matchesQuery(alb.artist)) {
            const albKey = `${alb.title.toLowerCase().trim()}::${alb.artist.toLowerCase().trim()}`;
            if (!albumMap.has(albKey)) albumMap.set(albKey, alb);
          }
        });
      }
    }

    return this.rankSearchResults(q, {
      tracks: Array.from(trackMap.values()),
      artists: Array.from(artistMap.values()),
      albums: Array.from(albumMap.values())
    });
  }

  /**
   * Spotify-style multi-signal relevance ranking:
   * Combines exact/prefix/token matching, personal library/like affinity, and anti-clutter penalties.
   */
  public static rankSearchResults(query: string, raw: CategorizedSearchResults): CategorizedSearchResults {
    const q = (query || '').trim().toLowerCase();
    const qNorm = q.replace(/[^a-z0-9]/g, '');
    const qTokens = q.split(/\s+/).filter(Boolean);

    // Gather user personal affinity sets in <0.5ms for Spotify-like personalization
    const likedArtistSet = new Set<string>();
    const likedTrackKeys = new Set<string>();
    try {
      for (const t of LikedService.getLikedTracks()) {
        if (t.artist) likedArtistSet.add(t.artist.toLowerCase().trim());
        if (t.title) likedTrackKeys.add(`${(t.artist || '').toLowerCase().trim()}::${t.title.toLowerCase().trim()}`);
      }
      for (const pl of PlaylistService.getPlaylists()) {
        for (const t of (pl.tracks || [])) {
          if (t.artist) likedArtistSet.add(t.artist.toLowerCase().trim());
          if (t.title) likedTrackKeys.add(`${(t.artist || '').toLowerCase().trim()}::${t.title.toLowerCase().trim()}`);
        }
      }
    } catch (_) {}

    const scoreTextMatch = (text: string): number => {
      const low = (text || '').toLowerCase().trim();
      const norm = low.replace(/[^a-z0-9]/g, '');
      if (!low) return 0;
      if (low === q || (qNorm && norm === qNorm)) return 150;
      if (low.startsWith(q) || (qNorm && norm.startsWith(qNorm))) return 105;
      // Word-boundary prefix match (e.g. "lights" in "Blinding Lights")
      const words = low.split(/[\s\-()]+/).filter(Boolean);
      if (words.some(w => w.startsWith(q))) return 80;
      if (low.includes(q)) return 60;
      if (qTokens.length > 1 && qTokens.every(tok => low.includes(tok))) return 52;
      return 0;
    };

    // Deduplicate & score tracks
    const dedupTracks = new Map<string, Track>();
    for (const t of raw.tracks) {
      const k = `${(t.artist || '').toLowerCase().trim()}::${(t.title || '').toLowerCase().trim()}`;
      if (!dedupTracks.has(k)) dedupTracks.set(k, t);
    }
    const rankedTracks = Array.from(dedupTracks.values()).sort((a, b) => {
      const scoreTrack = (t: Track): number => {
        const titleScore = scoreTextMatch(t.title);
        const artistScore = scoreTextMatch(t.artist) * 0.82;
        const comboScore = scoreTextMatch(`${t.title} ${t.artist}`) * 0.65;
        let s = Math.max(titleScore, artistScore, comboScore);
        // Personal affinity boost (user already likes/saved this song or artist)
        const tk = `${(t.artist || '').toLowerCase().trim()}::${(t.title || '').toLowerCase().trim()}`;
        if (likedTrackKeys.has(tk)) s += 38;
        else if (likedArtistSet.has((t.artist || '').toLowerCase().trim())) s += 20;
        // Penalize covers / karaoke / slowed / sped-up clutter unless explicitly searched
        if (/\b(karaoke|tribute|sped up|slowed|8d audio|cover version)\b/i.test(t.title) && !/\b(karaoke|tribute|sped|slowed|cover)\b/i.test(q)) {
          s -= 65;
        }
        if (t.artworkUrl) s += 5;
        return s;
      };
      return scoreTrack(b) - scoreTrack(a);
    });

    // Enrich artist portraits from top matched tracks/albums (zero extra network requests!)
    for (const t of rankedTracks) {
      if (t.artist && t.artworkUrl && !this.portraitCache.has(t.artist.toLowerCase())) {
        this.portraitCache.set(t.artist.toLowerCase(), t.artworkUrl);
      }
    }
    for (const alb of raw.albums) {
      if (alb.artist && alb.artworkUrl && !this.portraitCache.has(alb.artist.toLowerCase())) {
        this.portraitCache.set(alb.artist.toLowerCase(), alb.artworkUrl);
      }
    }

    // Deduplicate & score artists
    const dedupArtists = new Map<string, ArtistMetadata>();
    for (const art of raw.artists) {
      const k = art.name.toLowerCase().trim();
      if (!k) continue;
      const portrait = art.avatarUrl || this.portraitCache.get(k) || null;
      const existing = dedupArtists.get(k);
      if (!existing || (!existing.avatarUrl && portrait)) {
        dedupArtists.set(k, { ...art, avatarUrl: portrait });
      }
    }
    const rankedArtists = Array.from(dedupArtists.values()).sort((a, b) => {
      const scoreArt = (ar: ArtistMetadata): number => {
        let s = scoreTextMatch(ar.name);
        if (likedArtistSet.has(ar.name.toLowerCase().trim())) s += 32;
        if (ar.avatarUrl) s += 8;
        return s;
      };
      return scoreArt(b) - scoreArt(a);
    });

    // Deduplicate & score albums
    const dedupAlbums = new Map<string, AlbumMetadata>();
    for (const alb of raw.albums) {
      const k = `${alb.title.toLowerCase().replace(/[^a-z0-9]/g, '')}::${alb.artist.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (!dedupAlbums.has(k)) dedupAlbums.set(k, alb);
    }
    const rankedAlbums = Array.from(dedupAlbums.values()).sort((a, b) => {
      const scoreAlb = (al: AlbumMetadata): number => {
        let s = Math.max(scoreTextMatch(al.title), scoreTextMatch(al.artist) * 0.72);
        if (likedArtistSet.has(al.artist.toLowerCase().trim())) s += 18;
        if ((al.trackCount || 0) >= 6) s += 16;
        return s;
      };
      return scoreAlb(b) - scoreAlb(a);
    });

    return {
      tracks: rankedTracks,
      artists: rankedArtists,
      albums: rankedAlbums
    };
  }

  /**
   * Progressive Streaming Search:
   * 1) Delivers 0ms local hits immediately
   * 2) Streams Songs, Artists, and Albums progressively the moment EACH parallel provider finishes
   *    (never blocks the entire UI waiting for the slowest request!)
   */
  public static async searchProgressive(
    query: string,
    onPartial: (results: CategorizedSearchResults, isFinal: boolean) => void,
    signal?: AbortSignal
  ): Promise<CategorizedSearchResults> {
    const q = (query || '').trim();
    if (!q) {
      const empty = { tracks: [], artists: [], albums: [] };
      onPartial(empty, true);
      return empty;
    }

    // 1. 0ms Local Instant Hits
    const acc: CategorizedSearchResults = this.searchInstantLocal(q);
    if (acc.tracks.length > 0 || acc.artists.length > 0 || acc.albums.length > 0) {
      onPartial(acc, false);
    }

    let remaining = 3;
    const emit = () => {
      if (signal?.aborted) return;
      const ranked = this.rankSearchResults(q, acc);
      onPartial(ranked, remaining <= 0);
    };

    // 2. Fire Songs, Artists, and Albums concurrently; emit immediately as EACH one resolves!
    const pTracks = StreamingService.searchVerifiedTracks(q, signal)
      .then((list) => {
        if (list.length > 0) acc.tracks = [...list, ...acc.tracks];
      })
      .catch(() => {})
      .finally(() => {
        remaining--;
        emit();
      });

    const pArtists = this.searchArtists(q, signal)
      .then((list) => {
        if (list.length > 0) acc.artists = [...list, ...acc.artists];
      })
      .catch(() => {})
      .finally(() => {
        remaining--;
        emit();
      });

    const pAlbums = this.searchAlbums(q, signal)
      .then((list) => {
        if (list.length > 0) acc.albums = [...list, ...acc.albums];
      })
      .catch(() => {})
      .finally(() => {
        remaining--;
        emit();
      });

    await Promise.allSettled([pTracks, pArtists, pAlbums]);
    return this.rankSearchResults(q, acc);
  }

  /**
   * Multi-category search: songs, artists, albums with unified cancellation & debounce support
   */
  public static async searchAll(query: string, signal?: AbortSignal): Promise<CategorizedSearchResults> {
    const local = this.searchInstantLocal(query);
    const [tracks, artists, albums] = await Promise.all([
      StreamingService.searchVerifiedTracks(query, signal).catch(() => []),
      this.searchArtists(query, signal).catch(() => []),
      this.searchAlbums(query, signal).catch(() => [])
    ]);

    return this.rankSearchResults(query, {
      tracks: [...tracks, ...local.tracks],
      artists: [...artists, ...local.artists],
      albums: [...albums, ...local.albums]
    });
  }

  private static hasPurgedLegacyCache = false;
  private static readonly DISCOGRAPHY_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h fresh TTL

  private static rankedEntryToTrack(entry: RankedTrackEntry): Track {
    return {
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      album: entry.album || 'Single',
      duration: entry.duration || 180,
      artworkUrl: entry.artworkUrl || null,
      hasArtwork: Boolean(entry.artworkUrl),
      streamUrl: entry.streamUrl || (entry.videoId ? `/api/yt/stream?videoId=${encodeURIComponent(entry.videoId)}` : ''),
      provider: entry.rawProvider === 'jiosaavn' ? 'saavn' : (entry.videoId ? 'youtube' : undefined),
      providerTrackId: entry.videoId || entry.id,
      isUnavailable: entry.isPlayable === false
    } as any;
  }

  private static readV2Cache(cacheKey: string): { result: DiscographyResult; isFresh: boolean } | null {
    const mem = this.discographyCache.get(cacheKey);
    if (mem) {
      const age = Date.now() - (mem.ranking?.meta?.updatedAt || 0);
      return { result: mem, isFresh: age < this.DISCOGRAPHY_CACHE_TTL_MS };
    }
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DiscographyResult;
      if (parsed?.ranking?.meta?.schemaVersion !== 2) {
        localStorage.removeItem(cacheKey);
        return null;
      }
      this.discographyCache.set(cacheKey, parsed);
      const age = Date.now() - (parsed.ranking.meta.updatedAt || 0);
      return { result: parsed, isFresh: age < this.DISCOGRAPHY_CACHE_TTL_MS };
    } catch (_) {
      return null;
    }
  }

  private static writeV2Cache(cacheKey: string, payload: DiscographyResult): void {
    this.discographyCache.set(cacheKey, payload);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(cacheKey, JSON.stringify(payload));
      }
    } catch (_) {}
  }

  /**
   * Retrieves artist popularity ranking + segmented discography (albums, singles & EPs, appears on).
   * Strictly separates popularity ranking from catalog discovery, disambiguates same-name artists,
   * cancels stale requests via AbortSignal, and falls back gracefully on temporary errors.
   */
  public static async getArtistDiscography(
    artistName: string,
    options: {
      artistId?: string | null;
      provider?: string | null;
      trackTitle?: string | null;
      album?: string | null;
      signal?: AbortSignal;
      forceRefresh?: boolean;
    } = {}
  ): Promise<DiscographyResult> {
    if (!this.hasPurgedLegacyCache && typeof localStorage !== 'undefined') {
      this.hasPurgedLegacyCache = true;
      purgeLegacyArtistCaches(localStorage);
    }

    const cleanName = (artistName || '').trim();
    const emptyRanking = buildArtistRanking({
      artistName: cleanName || 'Artist',
      provider: 'none',
      rawTracks: []
    });
    if (!cleanName) {
      return { topTracks: [], albums: [], singles: [], collabs: [], ranking: emptyRanking };
    }

    const identityContext: ArtistIdentityContext = {
      name: cleanName,
      artistId: options.artistId || null,
      provider: options.provider || null,
      trackTitle: options.trackTitle || null,
      album: options.album || null
    };

    const cacheKey = buildArtistRankingCacheKey({
      provider: options.provider || 'auto',
      artistId: options.artistId,
      artistName: cleanName,
      market: 'GLOBAL',
      period: 'all_time'
    });

    const cachedEntry = this.readV2Cache(cacheKey);
    if (!options.forceRefresh && cachedEntry?.isFresh) {
      return cachedEntry.result;
    }

    const signal = options.signal;

    // 1. Fetch Popularity Ranking (Backend YouTube Music -> JioSaavn direct fallback) in parallel with
    // 2. Catalog Discovery (Disambiguated Apple Music / iTunes releases)
    const fetchRankingPromise = (async (): Promise<{
      provider: ArtistRankingProvider;
      rawTracks: RawProviderTrack[];
      artistId: string | null;
      portraitUrl: string | null;
      verifiedBySource: boolean;
      subscriberCountText: string | null;
      monthlyAudienceText: string | null;
      market: string;
      updatedAt: number;
    } | null> => {
      // 1a. Primary: Lumen backend /api/artist/ranking (YouTube Music global all-time play counts + JioSaavn fallback)
      try {
        const params = new URLSearchParams();
        params.set('name', cleanName);
        if (options.artistId) params.set('artistId', options.artistId);
        if (options.trackTitle) params.set('trackTitle', options.trackTitle);
        if (options.album) params.set('album', options.album);

        const url = ApiClient.resolveUrl(`/api/artist/ranking?${params.toString()}`);
        const res = await fetch(url, { signal });
        if (res.ok) {
          const data = await res.json();
          if (data?.success && Array.isArray(data.tracks) && data.tracks.length > 0) {
            return {
              provider: (data.provider as ArtistRankingProvider) || 'youtube_music',
              rawTracks: data.tracks,
              artistId: data.artistId || null,
              portraitUrl: data.portraitUrl || null,
              verifiedBySource: Boolean(data.verifiedBySource),
              subscriberCountText: data.subscriberCountText || null,
              monthlyAudienceText: data.monthlyAudienceText || null,
              market: data.market || 'GLOBAL',
              updatedAt: data.updatedAt || Date.now()
            };
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
      }

      if (signal?.aborted) return null;

      // 1b. Direct fallback when backend is unreachable: JioSaavn Official Artist Page (popular songs order)
      try {
        const saSearchRes = await fetch(
          `https://www.jiosaavn.com/api.php?__call=search.getArtistResults&_format=json&n=6&p=1&q=${encodeURIComponent(cleanName)}`,
          { signal }
        );
        if (saSearchRes.ok) {
          const saSearch = await saSearchRes.json();
          const saCandidates = (saSearch?.results || []).map((a: any) => ({
            id: `artist_saavn_${a.id}`,
            name: decodeHtml(a.name || ''),
            provider: 'jiosaavn',
            portraitUrl: a.image ? String(a.image).replace(/150x150|50x50/g, '500x500') : null,
            verified: Boolean(a.isVerified),
            subscriberCount: Number(a.ctr || 0)
          }));
          const bestSa = disambiguateArtistCandidate(saCandidates, identityContext);
          const rawMatch = (saSearch?.results || []).find((a: any) => `artist_saavn_${a.id}` === bestSa?.id);
          if (rawMatch?.perma_url) {
            const token = String(rawMatch.perma_url).split('/').pop() || '';
            const apRes = await fetch(
              `https://www.jiosaavn.com/api.php?__call=webapi.get&token=${encodeURIComponent(token)}&type=artist&p=&n_song=30&n_album=15&sub_type=&category=&sort_order=&includeMetaTags=0&ctx=web6dot0&api_version=4&_format=json&_marker=0`,
              { signal }
            );
            if (apRes.ok) {
              const ap = await apRes.json();
              const topSongs = ap?.topSongs || [];
              if (topSongs.length > 0) {
                const saTracks: RawProviderTrack[] = topSongs.map((s: any, idx: number) => {
                  const primaryArtists = (s?.more_info?.artistMap?.primary_artists || []).map((x: any) => x.name).filter(Boolean);
                  const featuredArtists = (s?.more_info?.artistMap?.featured_artists || []).map((x: any) => x.name).filter(Boolean);
                  const artistStr = primaryArtists.length > 0
                    ? (featuredArtists.length > 0 ? `${primaryArtists.join(', ')} (feat. ${featuredArtists.join(', ')})` : primaryArtists.join(', '))
                    : decodeHtml(s.subtitle || cleanName);
                  return {
                    id: `saavn_${s.id}`,
                    title: decodeHtml(s.title || ''),
                    artist: artistStr,
                    album: decodeHtml(s?.more_info?.album || ''),
                    duration: parseInt(s?.more_info?.duration || '0', 10) || 0,
                    artworkUrl: s.image ? String(s.image).replace(/150x150|50x50/g, '500x500') : null,
                    playCount: null,
                    playCountDisplay: null,
                    sourcePosition: idx + 1,
                    rawProvider: 'jiosaavn',
                    isPlayable: true
                  };
                });
                return {
                  provider: 'jiosaavn',
                  rawTracks: saTracks,
                  artistId: `saavn_${ap.artistId || rawMatch.id}`,
                  portraitUrl: ap.image ? String(ap.image).replace(/150x150|50x50/g, '500x500') : null,
                  verifiedBySource: Boolean(ap.isVerified),
                  subscriberCountText: ap.fan_count ? `${ap.fan_count} fans` : null,
                  monthlyAudienceText: null,
                  market: 'IN',
                  updatedAt: Date.now()
                };
              }
            }
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
      }

      return null;
    })();

    const fetchCatalogPromise = (async (): Promise<{
      albums: AlbumMetadata[];
      singles: AlbumMetadata[];
      collabs: AlbumMetadata[];
      catalogTracks: RawProviderTrack[];
      itunesArtistId: string | null;
    }> => {
      const albums: AlbumMetadata[] = [];
      const singles: AlbumMetadata[] = [];
      const collabs: AlbumMetadata[] = [];
      const catalogTracks: RawProviderTrack[] = [];
      let itunesArtistId: string | null = null;

      try {
        // Carry numeric iTunes artistId directly if provided (e.g. artist_479756766)
        const numericCarried = (options.artistId || '').match(/^(?:artist_itunes_|artist_)?(\d{5,})$/)?.[1] || null;
        let resolvedItunesId = numericCarried;

        if (!resolvedItunesId) {
          const artistSearchRes = await fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=musicArtist&limit=6`,
            { signal }
          );
          if (artistSearchRes.ok) {
            const artistData = await artistSearchRes.json();
            const candidates = (artistData.results || []).map((a: any) => ({
              id: String(a.artistId),
              name: a.artistName || '',
              provider: 'itunes'
            }));
            const picked = disambiguateArtistCandidate(candidates, identityContext);
            if (picked?.id) resolvedItunesId = picked.id;
          }
        }

        if (resolvedItunesId) {
          itunesArtistId = `itunes_${resolvedItunesId}`;
          const [albumsLookupRes, songsLookupRes] = await Promise.all([
            fetch(`https://itunes.apple.com/lookup?id=${resolvedItunesId}&entity=album&limit=100`, { signal }),
            fetch(`https://itunes.apple.com/lookup?id=${resolvedItunesId}&entity=song&limit=50`, { signal })
          ]);

          if (albumsLookupRes.ok) {
            const aData = await albumsLookupRes.json();
            const rawCollections = (aData.results || []).filter((r: any) => r.wrapperType === 'collection');
            const seenTitles = new Set<string>();

            for (const alb of rawCollections) {
              const rawTitle = alb.collectionName || 'Unknown Release';
              const normTitle = rawTitle.toLowerCase().replace(/\[.+?\]|\(.+?\)/g, '').trim();
              const artistOfAlbum = alb.artistName || cleanName;
              const trackCount = alb.trackCount || 1;
              const year = alb.releaseDate ? new Date(alb.releaseDate).getFullYear() : null;
              const art = alb.artworkUrl100 ? alb.artworkUrl100.replace('100x100bb', '600x600bb') : null;

              const creditRole = classifyArtistCredit(cleanName, artistOfAlbum, rawTitle);
              const isAppearsOn =
                creditRole === 'featured_only' ||
                artistOfAlbum.toLowerCase().includes('various artists');

              const isSingleOrEp =
                trackCount < 6 ||
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
                releaseType: isAppearsOn ? 'collab' : (isSingleOrEp ? 'single' : 'album')
              };

              const dedupeKey = `${item.releaseType}_${normTitle}`;
              if (seenTitles.has(dedupeKey)) continue;
              seenTitles.add(dedupeKey);

              if (item.releaseType === 'collab') collabs.push(item);
              else if (item.releaseType === 'single') singles.push(item);
              else albums.push(item);
            }

            albums.sort((a, b) => (b.year || 0) - (a.year || 0));
            singles.sort((a, b) => (b.year || 0) - (a.year || 0));
            collabs.sort((a, b) => (b.year || 0) - (a.year || 0));
          }

          if (songsLookupRes.ok) {
            const sData = await songsLookupRes.json();
            const tracks = (sData.results || [])
              .filter((r: any) => r.wrapperType === 'track')
              .map((t: any, idx: number): RawProviderTrack => {
                const mapped = StreamingService.mapRawToTrack(t);
                return {
                  id: mapped.id,
                  title: mapped.title,
                  artist: mapped.artist,
                  album: mapped.album,
                  duration: mapped.duration,
                  artworkUrl: mapped.artworkUrl,
                  streamUrl: mapped.streamUrl,
                  playCount: null,
                  playCountDisplay: null,
                  sourcePosition: idx + 1,
                  rawProvider: 'itunes_catalog',
                  isPlayable: true
                };
              });
            catalogTracks.push(...tracks);
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        console.warn('[ArtistService] Apple Music catalog lookup notice:', e?.message || e);
      }

      return { albums, singles, collabs, catalogTracks, itunesArtistId };
    })();

    const [rankingSettled, catalogSettled] = await Promise.allSettled([fetchRankingPromise, fetchCatalogPromise]);

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const rankingRaw = rankingSettled.status === 'fulfilled' ? rankingSettled.value : null;
    const catalogRaw = catalogSettled.status === 'fulfilled'
      ? catalogSettled.value
      : { albums: [], singles: [], collabs: [], catalogTracks: [], itunesArtistId: null };

    // Build honest ranking model
    let structuredRanking: StructuredArtistRankingResult;
    if (rankingRaw && rankingRaw.rawTracks.length > 0) {
      structuredRanking = buildArtistRanking({
        artistName: cleanName,
        provider: rankingRaw.provider,
        rawTracks: rankingRaw.rawTracks,
        artistId: rankingRaw.artistId,
        portraitUrl: rankingRaw.portraitUrl,
        verifiedBySource: rankingRaw.verifiedBySource,
        subscriberCountText: rankingRaw.subscriberCountText,
        monthlyAudienceText: rankingRaw.monthlyAudienceText,
        market: rankingRaw.market,
        updatedAt: rankingRaw.updatedAt,
        isStaleCache: false
      });
    } else if (cachedEntry?.result && cachedEntry.result.ranking?.rankedTracks?.length > 0) {
      // On temporary ranking error, show last successful ranking with its original update timestamp!
      return {
        ...cachedEntry.result,
        albums: catalogRaw.albums.length > 0 ? catalogRaw.albums : cachedEntry.result.albums,
        singles: catalogRaw.singles.length > 0 ? catalogRaw.singles : cachedEntry.result.singles,
        collabs: catalogRaw.collabs.length > 0 ? catalogRaw.collabs : cachedEntry.result.collabs,
        ranking: {
          ...cachedEntry.result.ranking,
          meta: {
            ...cachedEntry.result.ranking.meta,
            isStaleCache: true
          }
        }
      };
    } else {
      // Honest catalog-only fallback: "Songs by [artist]" with rank numbers omitted!
      structuredRanking = buildArtistRanking({
        artistName: cleanName,
        provider: catalogRaw.catalogTracks.length > 0 ? 'itunes_catalog' : 'none',
        rawTracks: catalogRaw.catalogTracks,
        artistId: catalogRaw.itunesArtistId,
        portraitUrl: this.portraitCache.get(cleanName.toLowerCase()) || null,
        verifiedBySource: false,
        market: 'GLOBAL',
        updatedAt: Date.now(),
        isStaleCache: false
      });
    }

    const portraitUrl =
      structuredRanking.meta.portraitUrl ||
      this.portraitCache.get(cleanName.toLowerCase()) ||
      catalogRaw.albums[0]?.artworkUrl ||
      structuredRanking.rankedTracks[0]?.artworkUrl ||
      null;

    if (portraitUrl) {
      this.portraitCache.set(cleanName.toLowerCase(), portraitUrl);
    }

    const topTracks: Track[] = structuredRanking.rankedTracks.map(e => this.rankedEntryToTrack(e));

    const payload: DiscographyResult = {
      topTracks,
      albums: catalogRaw.albums,
      singles: catalogRaw.singles,
      collabs: catalogRaw.collabs,
      ranking: {
        ...structuredRanking,
        meta: {
          ...structuredRanking.meta,
          portraitUrl
        }
      },
      artistPortraitUrl: portraitUrl,
      verifiedBySource: structuredRanking.meta.verifiedBySource,
      artistId: structuredRanking.meta.artistId,
      subscriberCountText: structuredRanking.meta.subscriberCountText,
      monthlyAudienceText: structuredRanking.meta.monthlyAudienceText
    };

    if (topTracks.length > 0 || catalogRaw.albums.length > 0 || catalogRaw.singles.length > 0) {
      this.writeV2Cache(cacheKey, payload);
    }
    return payload;
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
