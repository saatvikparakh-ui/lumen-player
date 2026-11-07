import { LyricLine } from '../types/music';

export function parseLrc(lrcText: string): LyricLine[] {
  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match;
    const timestamps: number[] = [];
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const millis = match[3] ? (match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10)) : 0;
      timestamps.push(minutes * 60 + seconds + millis / 1000);
    }

    const text = trimmed.replace(timeRegex, '').trim();
    if (timestamps.length > 0 && text) {
      for (const t of timestamps) {
        result.push({ time: t, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

const lyricsCache = new Map<string, LyricLine[]>();

/**
 * Strips bracketed movie/soundtrack tags and extracts primary artist
 * to enable reliable multi-language lyrics lookup.
 */
export function cleanLyricsSearchTerms(rawTitle: string, rawArtist: string): { cleanTitle: string; primaryArtist: string } {
  let cleanTitle = (rawTitle || '')
    .replace(/\s*[\(\[](?:from|feat\.?|ft\.?|with|ost|soundtrack|remastered|deluxe|original|anniversary|live|explicit|mono|stereo|bonus|lyrical|video|audio|full)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:from|soundtrack|ost|remastered|radio edit|deluxe|live|mono|stereo).*$/i, '')
    .trim();
  if (!cleanTitle) cleanTitle = (rawTitle || '').trim();

  let primaryArtist = (rawArtist || '').split(/[;,/]|(?:\s+(?:feat\.?|ft\.?|&|with)\s+)/i)[0].trim();
  if (!primaryArtist) primaryArtist = (rawArtist || '').trim();

  return { cleanTitle, primaryArtist };
}

/**
 * Checks whether text contains non-ASCII native characters (Devanagari, Hangul, Kana, Kanji, etc.)
 */
function hasNativeScript(text: string): boolean {
  if (!text) return false;
  // Matches characters above ASCII range (e.g. Hindi, Japanese, Korean, Chinese, Arabic, Cyrillic)
  return /[^\u0000-\u007F]/.test(text);
}

/**
 * Selects the best candidate from LRCLIB search results:
 * Prioritizes native script lyrics with synced timestamps per user choice,
 * falling back to Romanized/English alphabet synced lyrics.
 */
function selectBestLyricsCandidate(results: any[], targetTitle: string, targetArtist: string): any | null {
  if (!results || results.length === 0) return null;

  const syncedCandidates = results.filter((r: any) => Boolean(r.syncedLyrics && r.syncedLyrics.trim()));
  
  if (syncedCandidates.length > 0) {
    // 1. Look for native script synced lyrics (e.g. Devanagari, Hangul, Kana)
    const nativeSynced = syncedCandidates.find((r: any) => hasNativeScript(r.syncedLyrics));
    if (nativeSynced) return nativeSynced;

    // 2. Otherwise return first synced candidate
    return syncedCandidates[0];
  }

  // 3. Fallback to plain lyrics (prefer native script first)
  const plainCandidates = results.filter((r: any) => Boolean(r.plainLyrics && r.plainLyrics.trim()));
  if (plainCandidates.length > 0) {
    const nativePlain = plainCandidates.find((r: any) => hasNativeScript(r.plainLyrics));
    if (nativePlain) return nativePlain;
    return plainCandidates[0];
  }

  return results[0] || null;
}

/**
 * Universal multi-tiered lyrics fetcher:
 * 1. Checks backend `/api/lyrics/yt` which queries LRCLIB and YouTube multi-language captions.
 * 2. Falls back to direct LRCLIB search with multi-language native script support.
 */
export async function fetchUniversalLyrics(
  artist: string,
  title: string,
  videoId?: string
): Promise<LyricLine[] | null> {
  const cacheKey = `${artist.toLowerCase()} - ${title.toLowerCase()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  const { cleanTitle, primaryArtist } = cleanLyricsSearchTerms(title, artist);

  // 1. Try backend resolver with sanitized query terms
  try {
    const params = new URLSearchParams({
      title: cleanTitle || title,
      artist: primaryArtist || artist,
      ...(videoId ? { id: videoId } : {})
    });

    const res = await fetch(`/api/lyrics/yt?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.synced && data.lrcText) {
        const parsed = parseLrc(data.lrcText);
        if (parsed.length > 0) {
          lyricsCache.set(cacheKey, parsed);
          return parsed;
        }
      } else if (data.plainLyrics) {
        const plainLines: LyricLine[] = data.plainLyrics
          .split('\n')
          .filter((l: string) => l.trim().length > 0)
          .map((text: string, idx: number) => ({ time: idx * 4, text }));
        if (plainLines.length > 0) {
          lyricsCache.set(cacheKey, plainLines);
          return plainLines;
        }
      }
    }
  } catch (e) {
    console.warn('[Lyrics] Backend lyrics fetch error, attempting direct online fallback:', e);
  }

  // 2. Direct online multi-language fallback
  return fetchOnlineLyrics(artist, title);
}

/**
 * Resilient multi-language online lyrics fetcher:
 * Queries LRCLIB /api/get (exact) followed by /api/search (fuzzy) with title & artist,
 * and falls back to clean title-only search for soundtrack / regional songs.
 */
export async function fetchOnlineLyrics(artist: string, title: string, duration?: number): Promise<LyricLine[] | null> {
  const cacheKey = `${artist.toLowerCase()} - ${title.toLowerCase()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  const { cleanTitle, primaryArtist } = cleanLyricsSearchTerms(title, artist);

  // STEP 1: Exact LRCLIB lookup with cleaned title & primary artist
  try {
    const params = new URLSearchParams({
      artist_name: primaryArtist,
      track_name: cleanTitle,
    });
    if (duration && duration > 0) {
      params.append('duration', Math.round(duration).toString());
    }

    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: { 'User-Agent': 'LUMEN-Music-Player/1.0.0' },
      signal: AbortSignal.timeout(4000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) {
        const parsed = parseLrc(data.syncedLyrics);
        if (parsed.length > 0) {
          lyricsCache.set(cacheKey, parsed);
          return parsed;
        }
      } else if (data.plainLyrics) {
        const plainLines: LyricLine[] = data.plainLyrics
          .split('\n')
          .filter((l: string) => l.trim().length > 0)
          .map((text: string, idx: number) => ({ time: idx * 4, text }));
        if (plainLines.length > 0) {
          lyricsCache.set(cacheKey, plainLines);
          return plainLines;
        }
      }
    }
  } catch (_) {}

  // STEP 2: LRCLIB Fuzzy Search (Title + Artist) - Essential for non-English tracks
  try {
    const searchQuery = `${primaryArtist} ${cleanTitle}`.trim();
    const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`, {
      headers: { 'User-Agent': 'LUMEN-Music-Player/1.0.0' },
      signal: AbortSignal.timeout(4500)
    });

    if (searchRes.ok) {
      const results = await searchRes.json();
      const best = selectBestLyricsCandidate(results, cleanTitle, primaryArtist);
      if (best) {
        if (best.syncedLyrics) {
          const parsed = parseLrc(best.syncedLyrics);
          if (parsed.length > 0) {
            lyricsCache.set(cacheKey, parsed);
            return parsed;
          }
        } else if (best.plainLyrics) {
          const plainLines: LyricLine[] = best.plainLyrics
            .split('\n')
            .filter((l: string) => l.trim().length > 0)
            .map((text: string, idx: number) => ({ time: idx * 4, text }));
          if (plainLines.length > 0) {
            lyricsCache.set(cacheKey, plainLines);
            return plainLines;
          }
        }
      }
    }
  } catch (_) {}

  // STEP 3: LRCLIB Fuzzy Search (Title Only) - Matches regional / movie hits (e.g. Chaleya, Kesariya, Pasoori)
  if (cleanTitle.length > 3) {
    try {
      const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`, {
        headers: { 'User-Agent': 'LUMEN-Music-Player/1.0.0' },
        signal: AbortSignal.timeout(4500)
      });

      if (searchRes.ok) {
        const results = await searchRes.json();
        const best = selectBestLyricsCandidate(results, cleanTitle, primaryArtist);
        if (best) {
          if (best.syncedLyrics) {
            const parsed = parseLrc(best.syncedLyrics);
            if (parsed.length > 0) {
              lyricsCache.set(cacheKey, parsed);
              return parsed;
            }
          } else if (best.plainLyrics) {
            const plainLines: LyricLine[] = best.plainLyrics
              .split('\n')
              .filter((l: string) => l.trim().length > 0)
              .map((text: string, idx: number) => ({ time: idx * 4, text }));
            if (plainLines.length > 0) {
              lyricsCache.set(cacheKey, plainLines);
              return plainLines;
            }
          }
        }
      }
    } catch (_) {}
  }

  return null;
}
