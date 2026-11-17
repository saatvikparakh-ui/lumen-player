/**
 * Unified Artwork Utility for LUMEN
 * Robust URL formatting, regex sizing, IndexedDB caching, and iTunes cover healing.
 */

const ITUNES_SIZE_REGEX = /\d+x\d+(bb|-\d+)?(?=\.(jpg|png|webp)$)/i;

/**
 * Returns a high-res artwork URL or null if invalid/missing.
 * Replaces size segment cleanly without hardcoded string assumptions.
 */
export function getArtworkUrl(source: any, size: number = 600): string | null {
  if (!source) return null;

  let rawUrl: string = '';
  if (typeof source === 'string') {
    rawUrl = source.trim();
  } else if (typeof source === 'object') {
    rawUrl = (source.artworkUrl || source.artworkUrl100 || source.artworkUrl60 || '').trim();
  }

  if (!rawUrl || rawUrl === '""' || rawUrl === "''" || rawUrl === 'null' || rawUrl === 'undefined') {
    return null;
  }

  // Format iTunes CDN URLs with requested dimension
  if (rawUrl.includes('mzstatic.com') || ITUNES_SIZE_REGEX.test(rawUrl)) {
    return rawUrl.replace(ITUNES_SIZE_REGEX, `${size}x${size}bb`);
  }

  return rawUrl;
}

/**
 * Computes initials for gradient placeholder fallback
 */
export function getInitials(title?: string, artist?: string): string {
  if (artist && artist !== 'Unknown Artist') {
    const parts = artist.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return artist.slice(0, 2).toUpperCase();
  }
  if (title && title !== 'Unknown Title') {
    return title.slice(0, 2).toUpperCase();
  }
  return 'LM';
}

/**
 * Deterministic gradient based on title + artist string
 */
export function getCoverGradient(title?: string, artist?: string): [string, string] {
  const seed = `${title || ''}_${artist || ''}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const palettes: [string, string][] = [
    ['#FF2E93', '#00F0FF'],
    ['#9A76FF', '#63E8FF'],
    ['#00F59B', '#0072FF'],
    ['#FF8A00', '#DA22FF'],
    ['#7928CA', '#FF0080'],
    ['#4facfe', '#00f2fe'],
    ['#43e97b', '#38f9d7'],
    ['#fa709a', '#fee140']
  ];

  const index = Math.abs(hash) % palettes.length;
  return palettes[index];
}

/* ==========================================================================
   CLIENT-SIDE ITUNES HEALING WITH INDEXEDDB CACHE & RATE LIMITING (A4)
   ========================================================================== */

const DB_NAME = 'lumen_artwork_v1';
const STORE_NAME = 'covers';
let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function getCachedCover(key: string): Promise<string | null | undefined> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } catch (_) {
    return undefined;
  }
}

export async function setCachedCover(key: string, url: string | null): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(url, key);
  } catch (_) {}
}

// In-memory session cache for fast instant lookups
const sessionCache = new Map<string, string | null>();

// Throttled request queue to prevent Apple rate limits
let queue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || queue.length === 0) return;
  isProcessingQueue = true;
  while (queue.length > 0) {
    const task = queue.shift();
    if (task) {
      try {
        await task();
      } catch (_) {}
    }
    // 150ms pause between calls to respect rate limits while remaining snappy
    await new Promise(r => setTimeout(r, 150));
  }
  isProcessingQueue = false;
}

export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BANNED_COVER_REGEX = /\b(piano dreamers|tribute band|tribute|karaoke|lullaby|in the style of|string quartet|cover band|acoustic guitar cover|instrumental cover|remake|backing track|sound-alike)\b/i;
const COMPILATION_REGEX = /\b(compilation|greatest hits|the best of|best of|various artists|top hits|hit collection|essentials|anniversary edition|super hits|anthology|party hits|club hits|summer hits|now that's what i call)\b/i;

export function cleanSearchTerms(rawTitle: string, rawArtist: string): { cleanTitle: string; primaryArtist: string } {
  // Strip parentheticals like (feat. ...), (with ...), (Remastered ...), [Deluxe ...], (Original)
  let cleanTitle = (rawTitle || '')
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|with|remastered|deluxe|original|anniversary|live|explicit|mono|stereo|bonus)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:original|remastered|radio edit|deluxe|live|mono|stereo).*$/i, '')
    .trim();
  if (!cleanTitle) cleanTitle = (rawTitle || '').trim();

  // Extract primary artist from multi-artist strings: "Calvin Harris;Rag'n'Bone Man" -> "Calvin Harris"
  let primaryArtist = (rawArtist || '').split(/[;,/]|(?:\s+(?:feat\.?|ft\.?|&|with)\s+)/i)[0].trim();
  if (!primaryArtist) primaryArtist = (rawArtist || '').trim();

  return { cleanTitle, primaryArtist };
}

export function findBestMatch(results: any[], targetTitle: string, targetArtist: string, targetAlbum?: string): any | null {
  if (!results || results.length === 0) return null;

  const targetTitleNorm = normalizeText(targetTitle);
  const targetArtistNorm = normalizeText(targetArtist);
  const targetAlbumNorm = targetAlbum ? normalizeText(targetAlbum) : '';
  const titleTokens = targetTitleNorm.split(' ').filter(t => t.length > 1);
  const artistTokens = targetArtistNorm.split(' ').filter(t => t.length > 1);

  let bestCandidate = null;
  let bestScore = -1;

  for (const item of results) {
    const candTitle = item.trackName || '';
    const candArtist = item.artistName || '';
    const candAlbum = item.collectionName || '';

    // Discard tribute / karaoke / lullaby covers
    if (BANNED_COVER_REGEX.test(candTitle) || BANNED_COVER_REGEX.test(candArtist) || BANNED_COVER_REGEX.test(candAlbum)) {
      continue;
    }

    const candTitleNorm = normalizeText(candTitle);
    const candArtistNorm = normalizeText(candArtist);
    const candAlbumNorm = normalizeText(candAlbum);

    let score = 0;

    // Check title token overlap
    const matchedTitleTokens = titleTokens.filter(t => candTitleNorm.includes(t));
    if (titleTokens.length > 0 && matchedTitleTokens.length === 0) {
      continue; // completely different song
    }
    score += (matchedTitleTokens.length / Math.max(titleTokens.length, 1)) * 50;

    // Check artist match
    if (artistTokens.length > 0) {
      const matchedArtistTokens = artistTokens.filter(t => candArtistNorm.includes(t));
      if (matchedArtistTokens.length > 0) {
        score += (matchedArtistTokens.length / artistTokens.length) * 45;
      } else {
        // Strict artist isolation: candidate artist matches ZERO requested artist tokens!
        // Never allow another artist (e.g. Amel Larrieux) to match when searching for The Neighbourhood.
        continue;
      }
    } else {
      score += 25;
    }

    // Exact title bonus
    if (candTitleNorm === targetTitleNorm) score += 20;

    // Studio Album matching & penalties
    if (targetAlbumNorm) {
      if (candAlbumNorm === targetAlbumNorm) {
        score += 60; // Exact album match!
      } else if (candAlbumNorm.includes(targetAlbumNorm) || targetAlbumNorm.includes(candAlbumNorm)) {
        score += 45; // Partial album match!
      } else if (candAlbumNorm.length > 0) {
        // Different album
        score -= 15;
      }
    }

    // Penalize compilations unless the target album is explicitly a compilation
    const isTargetCompilation = targetAlbumNorm && COMPILATION_REGEX.test(targetAlbumNorm);
    if (!isTargetCompilation && COMPILATION_REGEX.test(candAlbum)) {
      score -= 45;
    }

    // Penalize singles if looking for an album track
    if (targetAlbumNorm && !targetAlbumNorm.includes('single') && (candAlbumNorm.endsWith('single') || candAlbumNorm.includes('- single'))) {
      score -= 25;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = item;
    }
  }

  // Minimum threshold to prevent assigning totally wrong songs
  if (bestScore >= 35) {
    return bestCandidate;
  }
  return null;
}

export async function fetchItunesCover(title: string, artist: string, album?: string): Promise<string | null> {
  const { cleanTitle, primaryArtist } = cleanSearchTerms(title, artist);
  if (!cleanTitle && !primaryArtist) return null;

  const normAlbum = album ? normalizeText(album) : '';
  const cacheKey = normAlbum 
    ? `art_v4_${normalizeText(primaryArtist)}_${normalizeText(cleanTitle)}_${normAlbum}`.replace(/\s+/g, '_')
    : `art_v4_${normalizeText(primaryArtist)}_${normalizeText(cleanTitle)}`.replace(/\s+/g, '_');

  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey) || null;
  }

  const cached = await getCachedCover(cacheKey);
  if (cached !== undefined && cached !== null) {
    sessionCache.set(cacheKey, cached);
    return cached;
  }

  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        const queryTerm = primaryArtist ? `${primaryArtist} ${cleanTitle}` : cleanTitle;
        // Search global iTunes catalog with limit=25 to find deep-album releases
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryTerm)}&entity=song&limit=25`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
        if (res.ok) {
          const data = await res.json();
          const best = findBestMatch(data.results || [], cleanTitle, primaryArtist, album);
          if (best && best.artworkUrl100) {
            const highRes = getArtworkUrl(best.artworkUrl100, 600);
            sessionCache.set(cacheKey, highRes);
            await setCachedCover(cacheKey, highRes);
            return resolve(highRes);
          }
        }

        // Artist Catalog Deep-Lookup: If song search was crowded out by other top tracks,
        // lookup artist's verified discography (e.g. The Neighbourhood -> "Afraid" on "I Love You.")
        if (primaryArtist && primaryArtist.length > 2) {
          try {
            const artRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(primaryArtist)}&entity=musicArtist&limit=1`, { signal: AbortSignal.timeout(3500) });
            if (artRes.ok) {
              const artData = await artRes.json();
              if (artData.results && artData.results[0]?.artistId) {
                const artistId = artData.results[0].artistId;
                const discRes = await fetch(`https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=100`, { signal: AbortSignal.timeout(4000) });
                if (discRes.ok) {
                  const discData = await discRes.json();
                  const discBest = findBestMatch(discData.results?.slice(1) || [], cleanTitle, primaryArtist, album);
                  if (discBest && discBest.artworkUrl100) {
                    const highRes = getArtworkUrl(discBest.artworkUrl100, 600);
                    sessionCache.set(cacheKey, highRes);
                    await setCachedCover(cacheKey, highRes);
                    return resolve(highRes);
                  }
                }
              }
            }
          } catch (_) {}
        }

        // Direct Album Search Fallback: If song search didn't pinpoint the studio album, query entity=album
        if (primaryArtist && album && album.length > 2) {
          const albumQueryUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(`${primaryArtist} ${album}`)}&entity=album&limit=5`;
          const albRes = await fetch(albumQueryUrl, { signal: AbortSignal.timeout(4500) }).catch(() => null);
          if (albRes && albRes.ok) {
            const albData = await albRes.json();
            const albNorm = normalizeText(album);
            const matchingAlb = (albData.results || []).find((a: any) => {
              const ca = normalizeText(a.collectionName || '');
              return ca === albNorm || ca.includes(albNorm) || albNorm.includes(ca);
            });
            if (matchingAlb && matchingAlb.artworkUrl100) {
              const highRes = getArtworkUrl(matchingAlb.artworkUrl100, 600);
              sessionCache.set(cacheKey, highRes);
              await setCachedCover(cacheKey, highRes);
              return resolve(highRes);
            }
          }
        }

        // Fallback: search by title only if title is unique and long enough
        if (cleanTitle.length > 4) {
          const fallbackUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTitle)}&entity=song&limit=8`;
          const fbRes = await fetch(fallbackUrl, { signal: AbortSignal.timeout(4500) }).catch(() => null);
          if (fbRes && fbRes.ok) {
            const fbData = await fbRes.json();
            const fbBest = findBestMatch(fbData.results || [], cleanTitle, primaryArtist, album);
            if (fbBest && fbBest.artworkUrl100) {
              const highRes = getArtworkUrl(fbBest.artworkUrl100, 600);
              sessionCache.set(cacheKey, highRes);
              await setCachedCover(cacheKey, highRes);
              return resolve(highRes);
            }
          }
        }

        // JioSaavn Backup
        const saavnQuery = primaryArtist ? `${primaryArtist} ${cleanTitle}` : cleanTitle;
        const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=3&p=1&q=${encodeURIComponent(saavnQuery)}`;
        const saavnRes = await fetch(saavnUrl, { signal: AbortSignal.timeout(4000) }).catch(() => null);
        if (saavnRes && saavnRes.ok) {
          const saavnData = await saavnRes.json();
          const saavnItem = saavnData?.results?.[0];
          if (saavnItem && saavnItem.image) {
            const highRes = saavnItem.image.replace(/150x150\.jpg/g, '500x500.jpg').replace(/50x50\.jpg/g, '500x500.jpg');
            sessionCache.set(cacheKey, highRes);
            await setCachedCover(cacheKey, highRes);
            return resolve(highRes);
          }
        }

        // Only cache null if search successfully returned with no matching candidates
        sessionCache.set(cacheKey, null);
        await setCachedCover(cacheKey, null);
        resolve(null);
      } catch (_) {
        // Network timeout / offline -> do not cache null
        resolve(null);
      }
    });
    processQueue();
  });
}
