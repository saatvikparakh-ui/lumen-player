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
 * Universal multi-tiered lyrics fetcher:
 * 1. Checks backend `/api/lyrics/yt` which queries LRCLIB (line-by-line millisecond timestamps)
 *    and falls back to YouTube synchronized captions.
 * 2. Falls back to direct LRCLIB endpoint.
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

  try {
    const params = new URLSearchParams({
      title: title,
      artist: artist,
      ...(videoId ? { id: videoId } : {})
    });

    const res = await fetch(`/api/lyrics/yt?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.synced && data.lrcText) {
        const parsed = parseLrc(data.lrcText);
        lyricsCache.set(cacheKey, parsed);
        return parsed;
      } else if (data.plainLyrics) {
        const plainLines: LyricLine[] = data.plainLyrics
          .split('\n')
          .filter((l: string) => l.trim().length > 0)
          .map((text: string, idx: number) => ({ time: idx * 4, text }));
        lyricsCache.set(cacheKey, plainLines);
        return plainLines;
      }
    }
  } catch (e) {
    console.warn('Backend lyrics fetch error, attempting direct fallback:', e);
  }

  return fetchOnlineLyrics(artist, title);
}

export async function fetchOnlineLyrics(artist: string, title: string, duration?: number): Promise<LyricLine[] | null> {
  const cacheKey = `${artist.toLowerCase()} - ${title.toLowerCase()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  try {
    const cleanTitle = title.replace(/\s*\(feat\..+?\)/gi, '').trim();
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: cleanTitle,
    });
    if (duration && duration > 0) {
      params.append('duration', Math.round(duration).toString());
    }

    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.syncedLyrics) {
      const parsed = parseLrc(data.syncedLyrics);
      lyricsCache.set(cacheKey, parsed);
      return parsed;
    } else if (data.plainLyrics) {
      const plainLines: LyricLine[] = data.plainLyrics
        .split('\n')
        .filter((l: string) => l.trim().length > 0)
        .map((text: string, idx: number) => ({ time: idx * 4, text }));
      lyricsCache.set(cacheKey, plainLines);
      return plainLines;
    }
  } catch (err) {
    console.warn('LRCLIB direct fetch error:', err);
  }

  return null;
}
