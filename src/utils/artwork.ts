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

// Throttled request queue to avoid Apple 20/min rate limits
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
    // Respect rate limits: 300ms pause between external calls
    await new Promise(r => setTimeout(r, 300));
  }
  isProcessingQueue = false;
}

export async function fetchItunesCover(title: string, artist: string, country = 'IN'): Promise<string | null> {
  const cleanTitle = (title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
  const cleanArtist = (artist || '').trim();
  if (!cleanTitle && !cleanArtist) return null;

  const cacheKey = `${cleanArtist.toLowerCase()}_${cleanTitle.toLowerCase()}_${country}`.replace(/[^a-z0-9_]/g, '');
  const cached = await getCachedCover(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        const queryTerm = `${cleanArtist} ${cleanTitle}`.trim();
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryTerm)}&entity=song&limit=1&country=${country}`;
        const res = await fetch(url);
        if (!res.ok) {
          await setCachedCover(cacheKey, null);
          return resolve(null);
        }
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const raw = data.results[0].artworkUrl100;
          const highRes = getArtworkUrl(raw, 600);
          await setCachedCover(cacheKey, highRes);
          return resolve(highRes);
        }
        await setCachedCover(cacheKey, null);
        resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    processQueue();
  });
}
