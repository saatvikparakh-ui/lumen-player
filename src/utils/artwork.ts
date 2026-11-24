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

  // Reject Amel Larrieux cover contamination and map to authentic The Neighbourhood artwork
  if (rawUrl.includes('0881100000042') || rawUrl.includes('7913807c') || rawUrl.includes('Ice_Cream_Everyday')) {
    return 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/28/71/00/287100fb-5c31-0195-5343-e6b3625886d0/886443969834.jpg/1000x1000bb.jpg';
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

const BANNED_COVER_REGEX = /\b(piano dreamers|tribute band|tribute|karaoke|lullaby|in the style of|string quartet|cover band|acoustic guitar cover|instrumental cover|instrumental version|remake|backing track|backing business|sound-alike|originally performed by|pristine karaoke|peaceful noise|club madness|wub machine|dj roblox)\b/i;
const COMPILATION_REGEX = /\b(compilation|greatest hits|the best of|best of|various artists|top hits|hit collection|essentials|anniversary edition|super hits|anthology|party hits|club hits|summer hits|now that's what i call|internacionais|mais tocadas|coastal vibes|201\d vibes|202\d vibes|vibes|pov\b|driving on a|road trip|late night|tiktok|feel good|sunny summers|aesthetic|chill out|workout|study beats|mood booster)\b/i;
const UNREQUESTED_VARIANT_REGEX = /\b(slowed|sped up|speed up|nightcore|8d audio|club edit|remix|reverb|karaoke|instrumental|cover|memo|acoustic version|live at|live from)\b/i;
const SUSPECT_URL_REGEX = /(0881100000042|7913807c|Ice_Cream_Everyday|Coastal-Vibes|2017-vibes|2016-again|driving-on-a-sunny|pov-its-2016|Internacionais|Mais-Tocadas|Slowed-Down|Sped-Up|Karaoke|Tribute|Dom-Dolla-Remix|b-sides)/i;

// Verified official studio album covers for tracks frequently mis-indexed by iTunes/JioSaavn compilations
const NBHD_I_LOVE_YOU_ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/28/71/00/287100fb-5c31-0195-5343-e6b3625886d0/886443969834.jpg/1000x1000bb.jpg';
const NBHD_WIPED_OUT_ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/77/db/68/77db6860-5e0f-08ef-47e3-eb5915771dab/886445447897.jpg/1000x1000bb.jpg';
const NBHD_HARD_TO_IMAGINE_ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/fc/d0/89/fcd0899c-2236-a726-9ce2-ebb110e2204d/886447414545.jpg/1000x1000bb.jpg';
const TAME_IMPALA_CURRENTS_ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/a8/2e/b4/a82eb490-f30a-a321-461a-0383c88fec95/15UMGIM23316.rgb.jpg/1000x1000bb.jpg';
const GORILLAZ_CRACKER_ISLAND_ART = 'https://c.saavncdn.com/582/Cracker-Island-English-2023-20230221122920-500x500.jpg';

const NBHD_I_LOVE_YOU_TRACKS = new Set([
  'how', 'afraid', 'everybodys watching me', 'sweater weather', 'let it go',
  'alleyways', 'w d y w f m', 'wdywfm', 'flawless', 'female robbery', 'staying up', 'float'
]);
const NBHD_WIPED_OUT_TRACKS = new Set([
  'a moment of silence', 'prey', 'cry baby', 'wiped out', 'the beach',
  'daddy issues', 'baby came home 2 valentines', 'baby came home 2',
  'greetings from califournia', 'ferrari', 'single', 'r i p 2 my youth', 'rip 2 my youth'
]);
const NBHD_HARD_TO_IMAGINE_TRACKS = new Set([
  'dust', 'kill us all', '24 7', 'scary love', 'softcore', 'void', 'roll call',
  'you get me so high', 'reflections', 'blue', 'paradise', 'beat take 1',
  'stuck with me', 'flowers', 'compass', 'noise', 'heaven', 'nervous',
  'sadderdaze', 'beautiful oblivion', 'too serious'
]);
const TAME_IMPALA_CURRENTS_TRACKS = new Set([
  'let it happen', 'nangs', 'the moment', 'yes im changing', 'eventually',
  'gossip', 'the less i know the better', 'past life', 'disciples',
  'cause im a man', 'reality in motion', 'love paranoia', 'new person same old mistakes'
]);

export function isSuspectArtworkUrl(url?: string | null): boolean {
  if (!url) return false;
  return SUSPECT_URL_REGEX.test(url);
}

/**
 * Returns verified official studio album artwork for tracks that streaming catalogs
 * routinely mis-serve with karaoke/compilation/remix art.
 */
export function getVerifiedCanonicalCover(
  title?: string | null,
  artist?: string | null,
  album?: string | null,
  size: number = 600
): string | null {
  if (!title && !artist) return null;
  const { cleanTitle } = cleanSearchTerms(title || '', artist || '');
  const tNorm = normalizeText(cleanTitle);
  const fullTNorm = normalizeText(title || '');
  const aNorm = normalizeText(artist || '');
  const albNorm = normalizeText(album || '');

  // Never override intentional remix/live/slowed/sped-up versions if explicitly requested in the track title
  if (/\b(remix|slowed|sped up|live|acoustic|instrumental|demo|memo)\b/.test(fullTNorm)) {
    return null;
  }

  // 1. Gorillaz feat. Tame Impala & Bootie Brown — "New Gold" (Cracker Island)
  if (
    tNorm === 'new gold' &&
    (aNorm.includes('gorillaz') || aNorm.includes('tame impala') || aNorm.includes('bootie brown') || fullTNorm.includes('tame impala'))
  ) {
    return GORILLAZ_CRACKER_ISLAND_ART;
  }

  // 2. Tame Impala — Currents studio tracks (incl. "The Less I Know The Better")
  if (aNorm.includes('tame impala') && (TAME_IMPALA_CURRENTS_TRACKS.has(tNorm) || albNorm === 'currents')) {
    return getArtworkUrl(TAME_IMPALA_CURRENTS_ART, size);
  }

  // 3. The Neighbourhood — authentic studio album covers (prevents compilation / wrong-artist covers)
  if (aNorm.includes('neighbourhood') || aNorm.includes('neighborhood') || aNorm === 'the nbhd') {
    if (NBHD_I_LOVE_YOU_TRACKS.has(tNorm) || albNorm === 'i love you') {
      return getArtworkUrl(NBHD_I_LOVE_YOU_ART, size);
    }
    if (NBHD_WIPED_OUT_TRACKS.has(tNorm) || albNorm === 'wiped out') {
      return getArtworkUrl(NBHD_WIPED_OUT_ART, size);
    }
    if (NBHD_HARD_TO_IMAGINE_TRACKS.has(tNorm) || albNorm.includes('hard to imagine')) {
      return getArtworkUrl(NBHD_HARD_TO_IMAGINE_ART, size);
    }
  }

  return null;
}

export function cleanSearchTerms(rawTitle: string, rawArtist: string): { cleanTitle: string; primaryArtist: string; allArtists: string[] } {
  // Strip parentheticals like (feat. ...), (with ...), (Remastered ...), [Deluxe ...], (Original)
  let cleanTitle = (rawTitle || '')
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|with|remastered|deluxe|original|anniversary|live|explicit|mono|stereo|bonus)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:original|remastered|radio edit|deluxe|live|mono|stereo).*$/i, '')
    .trim();
  if (!cleanTitle) cleanTitle = (rawTitle || '').trim();

  // Extract all artist names from multi-artist strings (including featured credits in title!)
  const artistParts = (rawArtist || '')
    .split(/[;,/]|(?:\s+(?:feat\.?|ft\.?|&|and|with|x)\s+)/i)
    .map(s => s.trim())
    .filter(s => s.length > 1);

  const featMatch = (rawTitle || '').match(/[\(\[]\s*(?:feat\.?|ft\.?|with)\s+([^\)\]]+)[\)\]]/i);
  if (featMatch && featMatch[1]) {
    const featParts = featMatch[1]
      .split(/[;,/]|(?:\s+(?:&|and)\s+)/i)
      .map(s => s.trim())
      .filter(s => s.length > 1);
    for (const fp of featParts) {
      if (!artistParts.some(p => p.toLowerCase() === fp.toLowerCase())) {
        artistParts.push(fp);
      }
    }
  }

  const primaryArtist = artistParts[0] || (rawArtist || '').trim();
  return { cleanTitle, primaryArtist, allArtists: artistParts };
}

export function findBestMatch(results: any[], targetTitle: string, targetArtist: string, targetAlbum?: string): any | null {
  if (!results || results.length === 0) return null;

  const { cleanTitle, allArtists } = cleanSearchTerms(targetTitle, targetArtist);
  const targetTitleNorm = normalizeText(cleanTitle || targetTitle);
  const targetFullTitleNorm = normalizeText(targetTitle);
  const targetArtistNorm = normalizeText(targetArtist);
  const targetAlbumNorm = targetAlbum ? normalizeText(targetAlbum) : '';
  const titleTokens = targetTitleNorm.split(' ').filter(t => t.length > 1);
  const artistTokens = targetArtistNorm.split(' ').filter(t => t.length > 1);
  const wantsVariant = UNREQUESTED_VARIANT_REGEX.test(targetFullTitleNorm);

  let bestCandidate = null;
  let bestScore = -1;

  for (const item of results) {
    const candTitle = item.trackName || item.title || item.song || '';
    const candArtist = item.artistName || item.singers || item.artist || '';
    const candAlbum = item.collectionName || item.album || '';

    // Discard tribute / karaoke / lullaby / sound-alike covers
    if (BANNED_COVER_REGEX.test(candTitle) || BANNED_COVER_REGEX.test(candArtist) || BANNED_COVER_REGEX.test(candAlbum)) {
      continue;
    }

    const candTitleNorm = normalizeText(candTitle);
    const candCleanTitleNorm = normalizeText(cleanSearchTerms(candTitle, candArtist).cleanTitle);
    const candArtistNorm = normalizeText(candArtist);
    const candAlbumNorm = normalizeText(candAlbum);
    const candArtistAndTitle = `${candArtistNorm} ${candTitleNorm}`;

    let score = 0;

    // Check title token overlap
    const matchedTitleTokens = titleTokens.filter(t => candTitleNorm.includes(t));
    if (titleTokens.length > 0 && matchedTitleTokens.length === 0) {
      continue; // completely different song
    }
    const titleCoverage = titleTokens.length > 0 ? matchedTitleTokens.length / titleTokens.length : 1;
    if (titleTokens.length >= 3 && titleCoverage < 0.6) {
      continue; // reject loose partial-word matches like "The Less..." matching unrelated songs
    }
    score += titleCoverage * 55;

    // Check artist match across primary artist AND featured credits in candidate title (e.g. "New Gold (feat. Tame Impala)")
    if (artistTokens.length > 0) {
      const matchedPrimary = artistTokens.filter(t => candArtistNorm.includes(t));
      const matchedWithFeat = artistTokens.filter(t => candArtistAndTitle.includes(t));
      const anyArtistPhraseMatch = allArtists.some((a) => {
        const an = normalizeText(a);
        return an.length > 2 && (candArtistNorm.includes(an) || candTitleNorm.includes(an));
      });
      if (matchedPrimary.length > 0) {
        score += (matchedPrimary.length / artistTokens.length) * 50;
      } else if (anyArtistPhraseMatch || matchedWithFeat.length >= Math.min(2, artistTokens.length)) {
        score += 36;
      } else {
        // Strict artist isolation: candidate matches ZERO requested artist tokens
        continue;
      }
    } else {
      score += 25;
    }

    // Exact title bonus (comparing both raw and stripped titles)
    if (candCleanTitleNorm === targetTitleNorm || candTitleNorm === targetTitleNorm) {
      score += 25;
    }

    // Penalize unrequested remixes / slowed / sped up / club edits / covers / live recordings
    if (!wantsVariant && (UNREQUESTED_VARIANT_REGEX.test(candTitle) || UNREQUESTED_VARIANT_REGEX.test(candAlbum))) {
      score -= 75;
    }

    // Studio Album matching & strong compilation rejection
    if (targetAlbumNorm && !COMPILATION_REGEX.test(targetAlbumNorm)) {
      if (candAlbumNorm === targetAlbumNorm) {
        score += 60; // Exact studio album match!
      } else if (candAlbumNorm.includes(targetAlbumNorm) || targetAlbumNorm.includes(candAlbumNorm)) {
        score += 42;
      } else if (candAlbumNorm.length > 0) {
        score -= 15;
      }
    }

    const isTargetCompilation = targetAlbumNorm && COMPILATION_REGEX.test(targetAlbumNorm);
    if (!isTargetCompilation && COMPILATION_REGEX.test(candAlbum)) {
      score -= 85;
    }

    // Penalize singles slightly when studio LP exists (e.g., trackCount >= 6)
    const trackCount = Number(item.trackCount) || 0;
    if (trackCount >= 7 && trackCount <= 26 && !COMPILATION_REGEX.test(candAlbum)) {
      score += 12; // Authentic full-length studio album bonus!
    } else if (trackCount > 30 && !isTargetCompilation) {
      score -= 40; // Giant compilation box/playlist
    }
    if (candAlbumNorm.endsWith('single') || candAlbumNorm.includes(' single')) {
      score -= 18;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = item;
    }
  }

  // Minimum threshold to prevent assigning totally wrong songs or mood compilations
  if (bestScore >= 40) {
    return bestCandidate;
  }
  return null;
}

export async function fetchItunesCover(title: string, artist: string, album?: string): Promise<string | null> {
  const canonical = getVerifiedCanonicalCover(title, artist, album, 600);
  if (canonical) return canonical;

  const { cleanTitle, primaryArtist } = cleanSearchTerms(title, artist);
  if (!cleanTitle && !primaryArtist) return null;

  const normAlbum = album ? normalizeText(album) : '';
  const cacheKey = normAlbum 
    ? `art_v6_${normalizeText(primaryArtist)}_${normalizeText(cleanTitle)}_${normAlbum}`.replace(/\s+/g, '_')
    : `art_v6_${normalizeText(primaryArtist)}_${normalizeText(cleanTitle)}`.replace(/\s+/g, '_');

  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey) || null;
  }

  const cached = await getCachedCover(cacheKey);
  if (cached !== undefined && cached !== null && !isSuspectArtworkUrl(cached)) {
    sessionCache.set(cacheKey, cached);
    return cached;
  }

  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        const queryTerm = primaryArtist ? `${primaryArtist} ${cleanTitle}` : cleanTitle;
        // 1. Search global iTunes US catalog with limit=25 to find authentic studio releases
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryTerm)}&country=US&media=music&entity=song&limit=25`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
        if (res.ok) {
          const data = await res.json();
          const best = findBestMatch(data.results || [], cleanTitle, artist || primaryArtist, album);
          if (best && best.artworkUrl100 && !isSuspectArtworkUrl(best.artworkUrl100)) {
            const highRes = getArtworkUrl(best.artworkUrl100, 600);
            sessionCache.set(cacheKey, highRes);
            await setCachedCover(cacheKey, highRes);
            return resolve(highRes);
          }
        }

        // 2. Artist Catalog Deep-Lookup: lookup artist's verified discography
        if (primaryArtist && primaryArtist.length > 2) {
          try {
            const artRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(primaryArtist)}&country=US&entity=musicArtist&limit=1`, { signal: AbortSignal.timeout(3500) });
            if (artRes.ok) {
              const artData = await artRes.json();
              if (artData.results && artData.results[0]?.artistId) {
                const artistId = artData.results[0].artistId;
                const discRes = await fetch(`https://itunes.apple.com/lookup?id=${artistId}&country=US&entity=song&limit=100`, { signal: AbortSignal.timeout(4000) });
                if (discRes.ok) {
                  const discData = await discRes.json();
                  const discBest = findBestMatch(discData.results?.slice(1) || [], cleanTitle, artist || primaryArtist, album);
                  if (discBest && discBest.artworkUrl100 && !isSuspectArtworkUrl(discBest.artworkUrl100)) {
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

        // 3. Direct Album Search Fallback: if track specifies a non-compilation studio album
        if (primaryArtist && album && album.length > 2 && !COMPILATION_REGEX.test(album)) {
          const albumQueryUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(`${primaryArtist} ${album}`)}&country=US&entity=album&limit=8`;
          const albRes = await fetch(albumQueryUrl, { signal: AbortSignal.timeout(4500) }).catch(() => null);
          if (albRes && albRes.ok) {
            const albData = await albRes.json();
            const albNorm = normalizeText(album);
            const primaryNorm = normalizeText(primaryArtist);
            const matchingAlb = (albData.results || []).find((a: any) => {
              const ca = normalizeText(a.collectionName || '');
              const cart = normalizeText(a.artistName || '');
              if (BANNED_COVER_REGEX.test(ca) || BANNED_COVER_REGEX.test(cart)) return false;
              if (primaryNorm && !cart.includes(primaryNorm)) return false;
              return ca === albNorm || ca.includes(albNorm) || albNorm.includes(ca);
            });
            if (matchingAlb && matchingAlb.artworkUrl100 && !isSuspectArtworkUrl(matchingAlb.artworkUrl100)) {
              const highRes = getArtworkUrl(matchingAlb.artworkUrl100, 600);
              sessionCache.set(cacheKey, highRes);
              await setCachedCover(cacheKey, highRes);
              return resolve(highRes);
            }
          }
        }

        // 4. Verified JioSaavn Backup (scored through findBestMatch so mood compilations & mismatches are rejected!)
        const saavnQuery = primaryArtist ? `${cleanTitle} ${primaryArtist}` : cleanTitle;
        const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=8&p=1&q=${encodeURIComponent(saavnQuery)}`;
        const saavnRes = await fetch(saavnUrl, { signal: AbortSignal.timeout(4000) }).catch(() => null);
        if (saavnRes && saavnRes.ok) {
          const saavnData = await saavnRes.json();
          const saavnCandidates = (saavnData?.results || []).map((item: any) => ({
            trackName: item.song || item.title || '',
            artistName: item.singers || item.more_info?.music || item.primary_artists || '',
            collectionName: item.album || item.more_info?.album || '',
            artworkUrl100: item.image || ''
          }));
          const bestSaavn = findBestMatch(saavnCandidates, cleanTitle, artist || primaryArtist, album);
          if (bestSaavn && bestSaavn.artworkUrl100 && !isSuspectArtworkUrl(bestSaavn.artworkUrl100)) {
            const highRes = bestSaavn.artworkUrl100.replace(/150x150\.jpg/g, '500x500.jpg').replace(/50x50\.jpg/g, '500x500.jpg');
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
