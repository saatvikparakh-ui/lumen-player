const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const mm = require('music-metadata');

const PORT = process.env.PORT || 3847;
const DIST_DIR = path.join(__dirname, 'dist');
const ART_CACHE_DIR = path.join(__dirname, 'art_cache');

if (!fs.existsSync(ART_CACHE_DIR)) {
  fs.mkdirSync(ART_CACHE_DIR, { recursive: true });
}

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.wma']);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm'
};

// Domain modules for ratings, analytics, friends, comparisons, sync, recommendations, search & track matching
const dbModule = require('./server/db.cjs');
const ratingsModule = require('./server/ratings.cjs');
const comparisonModule = require('./server/comparison.cjs');
const analyticsModule = require('./server/analytics.cjs');
const friendsModule = require('./server/friends.cjs');
const syncModule = require('./server/sync.cjs');
const recommendationsModule = require('./server/recommendations.cjs');
const trackMatcherModule = require('./server/trackMatcher.cjs');
const searchEngineModule = require('./server/searchEngine.cjs');

try {
  dbModule.initDb();
  console.log('[LUMEN] SQLite database initialized successfully.');
} catch (dbInitErr) {
  console.error('[LUMEN] Error initializing SQLite database:', dbInitErr.message);
}

function ensureUser(userId = 'local_user', username = null) {
  const db = dbModule.getDb();
  let user = db.prepare('SELECT user_id, username, rating_visibility FROM users WHERE user_id = ?').get(userId);
  if (!user) {
    const uname = username || (userId === 'local_user' ? 'You' : userId);
    try {
      db.prepare('INSERT INTO users (user_id, username, rating_visibility, created_at) VALUES (?, ?, ?, ?)')
        .run(userId, uname, 'friends', Date.now());
    } catch (_) {
      const fallbackUname = `${uname}_${Date.now().toString(36)}`;
      db.prepare('INSERT INTO users (user_id, username, rating_visibility, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .run(userId, fallbackUname, 'friends', Date.now());
    }
    user = db.prepare('SELECT user_id, username, rating_visibility FROM users WHERE user_id = ?').get(userId);
  }
  return user;
}

function ensureSong(songIdOrTrack, maybeTrack) {
  let songId = null;
  let track = {};
  if (typeof songIdOrTrack === 'string') {
    songId = songIdOrTrack;
    track = maybeTrack || {};
  } else if (songIdOrTrack && typeof songIdOrTrack === 'object') {
    track = songIdOrTrack;
    songId = track.id || track.song_id || track.songId;
  }
  if (!songId) return null;
  const title = String(track.title || 'Unknown Title');
  const artist = String(track.artist || 'Unknown Artist');
  const album = String(track.album || 'Unknown Album');
  const duration = Number(track.duration) > 0 ? Number(track.duration) : 180.0;
  const db = dbModule.getDb();
  db.prepare(`
    INSERT INTO songs (song_id, title, artist, album, duration, metadata_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_id) DO UPDATE SET
      title = CASE WHEN excluded.title <> 'Unknown Title' THEN excluded.title ELSE songs.title END,
      artist = CASE WHEN excluded.artist <> 'Unknown Artist' THEN excluded.artist ELSE songs.artist END,
      album = CASE WHEN excluded.album <> 'Unknown Album' THEN excluded.album ELSE songs.album END,
      duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE songs.duration END
  `).run(songId, title, artist, album, duration, `${title}:::${artist}`);
  return songId;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON payload: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

// Lazy-loaded Ytdl instance
let ytdlClient = null;
async function getYtdl() {
  if (!ytdlClient) {
    const modPath = path.join(__dirname, 'node_modules/@distube/ytdl-core/dist/index.js');
    const { Ytdl } = await import(pathToFileURL(modPath));
    ytdlClient = new Ytdl();
  }
  return ytdlClient;
}

// In-memory cache for audio format metadata to avoid redundant getInfo calls on scrubbing
const formatCache = new Map();

// In-memory cache for title+artist -> videoId resolution
const trackVideoCache = new Map();

// Universal Browser-Grade Headers to avoid Akamai WAF 403 / rate-limit throttling
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9'
};

// In-memory cache for artist discographies (normalized artist name -> full discography object)
const artistDiscographyCache = new Map();

// Universal resilient JSON fetcher with automatic retry & exponential backoff for WAF 429/403 and transient network drops
async function safeFetchJson(url, options = {}, retries = 3) {
  const defaultHeaders = BROWSER_HEADERS;
  const mergedHeaders = options.headers ? { ...defaultHeaders, ...options.headers } : defaultHeaders;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers: mergedHeaders });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().startsWith('{')) {
          return JSON.parse(text);
        }
      }
      if (attempt < retries && (res.status === 429 || res.status === 403 || res.status >= 500)) {
        await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt)));
        continue;
      }
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  return null;
}

async function resolveVideoId(artist, title) {
  const cacheKey = `${(artist || '').toLowerCase().trim()} - ${(title || '').toLowerCase().trim()}`;
  if (trackVideoCache.has(cacheKey)) {
    return trackVideoCache.get(cacheKey);
  }

  try {
    const client = await getYtdl();
    const cleanTitle = (title || '').replace(/\s*\(feat\..+?\)/gi, '').replace(/\s*\[.+?\]/gi, '').trim();
    
    // 1. Studio Hi-Fi Master search: Target YouTube Music official auto-generated topic tracks
    const topicSearchStr = `${cleanTitle} ${artist || ''} Topic`;
    const topicRes = await client.search(topicSearchStr, { limit: 5 });
    const topicItems = topicRes.items || topicRes || [];
    
    // Prefer items from official Topic channels (uncompressed studio master encoding)
    const topicMatch = topicItems.find(item => {
      const chName = (item.author?.name || item.channelTitle || '').toLowerCase();
      return chName.includes('topic') || chName.includes((artist || '').toLowerCase());
    });

    if (topicMatch && topicMatch.id) {
      trackVideoCache.set(cacheKey, topicMatch.id);
      return topicMatch.id;
    }

    if (topicItems.length > 0 && topicItems[0].id) {
      trackVideoCache.set(cacheKey, topicItems[0].id);
      return topicItems[0].id;
    }
  } catch (err) {
    console.warn(`Resolve topic audio error for ${artist} - ${title}:`, err.message);
  }

  try {
    const client = await getYtdl();
    const cleanTitle = (title || '').replace(/\s*\(feat\..+?\)/gi, '').replace(/\s*\[.+?\]/gi, '').trim();
    const searchStr = `${artist || ''} - ${cleanTitle} official audio`;
    const searchRes = await client.search(searchStr, { limit: 3 });
    const items = searchRes.items || searchRes || [];
    if (items.length > 0 && items[0].id) {
      trackVideoCache.set(cacheKey, items[0].id);
      return items[0].id;
    }
  } catch (err) {
    console.warn(`Resolve audio error for ${artist} - ${title}:`, err.message);
  }

  try {
    const client = await getYtdl();
    const fallback = await client.search(`${artist} ${title}`, { limit: 1 });
    const items = fallback.items || fallback || [];
    if (items.length > 0 && items[0].id) {
      const vid = items[0].id;
      trackVideoCache.set(cacheKey, vid);
      return vid;
    }
  } catch (_) {}

  return null;
}

// Helper to clean YouTube title into { title, artist }
function parseTrackMetadata(rawTitle, defaultAuthor) {
  let artist = defaultAuthor || 'Various Artists';
  let title = rawTitle || 'Unknown Track';

  title = title
    .replace(/\s*\((?:official|music|video|audio|lyric|lyrics|4k|hd|visualizer|remastered).+?\)/gi, '')
    .replace(/\s*\[(?:official|music|video|audio|lyric|lyrics|4k|hd|visualizer|remastered).+?\]/gi, '')
    .replace(/\s*\|\s*.+$/g, '')
    .trim();

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  } else if (title.includes(' – ')) {
    const parts = title.split(' – ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' – ').trim();
  }

  title = title.replace(/^["']|["']$/g, '').trim();
  artist = artist.replace(/^["']|["']$/g, '').trim();

  return { title, artist };
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// Recursive audio directory scanner
async function scanDirectoryRecursive(dirPath, trackList = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await scanDirectoryRecursive(fullPath, trackList);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          try {
            const metadata = await mm.parseFile(fullPath, { skipCovers: false });
            const common = metadata.common || {};
            const format = metadata.format || {};

            let artworkId = null;
            if (common.picture && common.picture.length > 0) {
              const pic = common.picture[0];
              const cleanAlbum = (common.album || 'Unknown Album').toLowerCase().replace(/[^a-z0-9]/g, '');
              const cleanArtist = (common.artist || 'Unknown Artist').toLowerCase().replace(/[^a-z0-9]/g, '');
              artworkId = `art_${cleanArtist}_${cleanAlbum}`;

              const cachedArtPath = path.join(ART_CACHE_DIR, `${artworkId}.bin`);
              if (!fs.existsSync(cachedArtPath)) {
                fs.writeFileSync(cachedArtPath, pic.data);
                fs.writeFileSync(path.join(ART_CACHE_DIR, `${artworkId}.json`), JSON.stringify({ format: pic.format }));
              }
            }

            const track = {
              id: `track_${Buffer.from(fullPath).toString('base64').replace(/[/+=]/g, '_')}`,
              path: fullPath,
              filename: entry.name,
              title: common.title || path.basename(entry.name, ext),
              artist: common.artist || common.albumartist || 'Unknown Artist',
              album: common.album || 'Unknown Album',
              albumArtist: common.albumartist || common.artist || 'Unknown Artist',
              genre: common.genre && common.genre.length ? common.genre[0] : 'Music',
              year: common.year || null,
              duration: format.duration || 0,
              hasArtwork: !!artworkId,
              artworkId: artworkId,
              streamUrl: `/stream?path=${encodeURIComponent(fullPath)}`,
              artworkUrl: artworkId ? `/artwork?id=${artworkId}` : null,
              addedAt: Date.now()
            };

            trackList.push(track);
          } catch (e) {
            console.warn(`Tag read skip ${fullPath}:`, e.message);
          }
        }
      }
    }
  } catch (err) {
    console.error(`Cannot read ${dirPath}:`, err.message);
  }
  return trackList;
}

// In-memory recommendations cache
let cachedRecommendations = null;
let recsTimestamp = 0;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, x-user-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;

  // Cloud Container Health Check Endpoint
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() }));
    return;
  }

  // =========================================================================
  // 1. STREAM RESOLVER (/api/stream/resolve)
  // Resolves official verified tracks (Title + Artist) into audio stream
  // =========================================================================
  if (pathname === '/api/stream/resolve') {
    const artist = parsedUrl.searchParams.get('artist') || '';
    const title = parsedUrl.searchParams.get('title') || '';
    let videoId = parsedUrl.searchParams.get('id');

    if (!videoId) {
      videoId = await resolveVideoId(artist, title);
    }

    if (!videoId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Audio stream could not be resolved' }));
      return;
    }

    parsedUrl.searchParams.set('id', videoId);
    pathname = '/api/stream/yt';
  }

  // =========================================================================
  // 2. IN-MEMORY HIGH-FIDELITY STREAMING (/api/stream/yt)
  // Zero disk footprint, HTTP 206 Range streaming with highest Opus fidelity
  // =========================================================================
  if (pathname === '/api/stream/yt') {
    const videoId = parsedUrl.searchParams.get('id');
    if (!videoId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing video id' }));
      return;
    }

    try {
      const client = await getYtdl();
      let formatInfo = formatCache.get(videoId);

      if (!formatInfo || Date.now() - formatInfo.timestamp > 30 * 60 * 1000) {
        const info = await client.getInfo(videoId);
        const audioFormats = info.formats.filter(f => f.hasAudio && !f.hasVideo);
        // Prioritize Ultra Hi-Fi audio formats: 256kbps AAC (141) or 160kbps Opus (251)
        const bestAudio = audioFormats.find(f => f.itag === 141) || 
                          audioFormats.find(f => f.itag === 251) || 
                          audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || 
                          audioFormats[0];

        if (!bestAudio) {
          throw new Error('No compatible audio stream format found');
        }

        formatInfo = {
          format: bestAudio,
          contentLength: parseInt(bestAudio.contentLength || '0', 10),
          mimeType: bestAudio.mimeType ? bestAudio.mimeType.split(';')[0] : 'audio/webm',
          timestamp: Date.now()
        };
        formatCache.set(videoId, formatInfo);
      }

      const { format, contentLength, mimeType } = formatInfo;
      const range = req.headers.range;

      if (range && contentLength > 0) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : contentLength - 1;

        if (start >= contentLength || end >= contentLength) {
          res.writeHead(416, {
            'Content-Range': `bytes */${contentLength}`,
            'Content-Type': mimeType
          });
          res.end();
          return;
        }

        const chunksize = (end - start) + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${contentLength}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mimeType,
          'Cache-Control': 'no-cache'
        });

        const audioStream = await client.download(videoId, {
          format: format,
          range: { start, end }
        });

        audioStream.pipe(res);

        req.on('close', () => {
          if (audioStream && typeof audioStream.destroy === 'function') {
            audioStream.destroy();
          }
        });

      } else {
        const headers = {
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        };
        if (contentLength > 0) {
          headers['Content-Length'] = contentLength;
        }

        res.writeHead(200, headers);

        const audioStream = await client.download(videoId, {
          format: format
        });

        audioStream.pipe(res);

        req.on('close', () => {
          if (audioStream && typeof audioStream.destroy === 'function') {
            audioStream.destroy();
          }
        });
      }
      return;

    } catch (err) {
      console.error(`Stream error for ${videoId}:`, err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // =========================================================================
  // 3.0 ADVANCED FRIDGE CATALOG SEARCH ENDPOINT (/api/search/catalog)
  // Integrates SQLite FTS5, intent parser, typo tolerance, and transparent ranking
  // =========================================================================
  if (pathname === '/api/search/catalog') {
    const query = parsedUrl.searchParams.get('q') || '';
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '25', 10);
    const userId = parsedUrl.searchParams.get('userId') || 'local_user';

    try {
      const searchResult = await searchEngineModule.searchCatalog(query, { limit, userId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(searchResult));
    } catch (searchErr) {
      console.error('[SearchCatalog] Error:', searchErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: searchErr.message, results: [] }));
      }
    }
    return;
  }

  // =========================================================================
  // 3. VERIFIED ARTIST SEARCH ENDPOINT (/api/search/verified)
  // Queries official iTunes catalogue: 1000x1000 square covers with 0 black bars
  // =========================================================================
  if (pathname === '/api/search/verified') {
    const query = parsedUrl.searchParams.get('q');
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '30', 10);

    if (!query || !query.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Search query required' }));
      return;
    }

    const normQ = query.trim().toLowerCase();
    const cacheKey = `search_verified:${normQ}:${limit}`;
    const cached = dbModule ? dbModule.getCachedSearch(cacheKey) : null;
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
      return;
    }

    try {
      console.log(`[API/SEARCH CALL] query="${query}" limit=${limit}`);
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`;
      const apiData = await safeFetchJson(itunesUrl, { 
        signal: AbortSignal.timeout(8000) 
      });
      let results = apiData?.results || [];

      // Fallback: If 0 songs found directly, check if query matches an artist name
      if (results.length === 0) {
        try {
          const artistSearch = await safeFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=1`, {
            signal: AbortSignal.timeout(8000)
          });
          const artist = artistSearch?.results?.[0];
          if (artist?.artistId) {
            const lookupData = await safeFetchJson(`https://itunes.apple.com/lookup?id=${artist.artistId}&entity=song&limit=${limit}`, {
              signal: AbortSignal.timeout(8000)
            });
            results = (lookupData?.results || []).filter(r => r.wrapperType === 'track');
            console.log(`[API/SEARCH] Artist lookup fallback for "${query}": found ${results.length} tracks under artist "${artist.artistName}"`);
          }
        } catch (fbErr) {
          console.warn(`[API/SEARCH] Artist fallback error for "${query}":`, fbErr.message);
        }
      }

      const tracks = results.map(item => {
        const hdArtwork = item.artworkUrl100
          ? item.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg')
          : null;

        return {
          id: `itunes_${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: item.collectionName || 'Single',
          albumArtist: item.artistName,
          genre: item.primaryGenreName || 'Pop',
          year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : 2024,
          duration: Math.round((item.trackTimeMillis || 180000) / 1000),
          artworkUrl: hdArtwork,
          streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName)}`,
          hasArtwork: !!hdArtwork,
          isStream: true,
          isVerified: true
        };
      });

      const responsePayload = { success: true, count: tracks.length, tracks };
      if (dbModule && tracks.length > 0) {
        dbModule.setCachedSearch(cacheKey, responsePayload);
        for (const t of tracks) {
          if (t.artworkUrl && t.title && t.artist) {
            dbModule.setCachedArtwork(`track:${t.title.toLowerCase()}:::${t.artist.toLowerCase()}`, t.artworkUrl);
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responsePayload));
      return;
    } catch (err) {
      console.error(`Verified search failed for ${query}:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, tracks: [] }));
      return;
    }
  }

  // =========================================================================
  // 3.5. ARTIST DISCOGRAPHY & TOP TRACKS ENDPOINT (/api/artist)
  // Queries verified musicArtist ID first with Browser-Grade headers & caching
  // =========================================================================
  if (pathname === '/api/artist') {
    const artistName = parsedUrl.searchParams.get('name');
    if (!artistName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing artist name' }));
      return;
    }

    try {
      const cleanName = (artistName || '').replace(/\.+$/, '').trim();
      const normTarget = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
      console.log(`[API/ARTIST CALL] name="${artistName}" cleanName="${cleanName}" normTarget="${normTarget}" cached=${artistDiscographyCache.has(normTarget)}`);

      // Return from in-memory cache if available (0ms instant response)
      if (normTarget && artistDiscographyCache.has(normTarget)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(artistDiscographyCache.get(normTarget)));
        return;
      }

      // Check persistent SQLite cache
      if (normTarget && dbModule) {
        const dbCached = dbModule.getCachedArtist(normTarget);
        if (dbCached && ((dbCached.topTracks && dbCached.topTracks.length > 0) || (dbCached.albums && dbCached.albums.length > 0))) {
          artistDiscographyCache.set(normTarget, dbCached);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(dbCached));
          return;
        }
      }

      // Candidate terms to resolve: full name first, then split parts for collaborations/features (e.g. 'Daisy the Great & AJR')
      const candidates = [cleanName];
      const splitRegex = /\s+(?:&|feat\.?|ft\.?|with|\/)\s+|,\s*/i;
      if (splitRegex.test(cleanName)) {
        const parts = cleanName.split(splitRegex).map(p => p.trim()).filter(Boolean);
        for (const p of parts) {
          if (!candidates.includes(p)) candidates.push(p);
        }
      }

      let rawAlbums = [];
      let rawSongs = [];
      let resolvedArtistName = cleanName;

      for (const query of candidates) {
        const queryNorm = query.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. Search for official Apple Music artist ID
        try {
          const artistSearchData = await safeFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=5`, { 
            signal: AbortSignal.timeout(15000) 
          });

          if (artistSearchData) {
            const matchedArtist = (artistSearchData.results || []).find(r => (r.artistName || '').toLowerCase().replace(/[^a-z0-9]/g, '') === queryNorm) || (artistSearchData.results || [])[0];

            if (matchedArtist?.artistId) {
              const [albumData, songData] = await Promise.all([
                safeFetchJson(`https://itunes.apple.com/lookup?id=${matchedArtist.artistId}&entity=album&limit=200`, { 
                  signal: AbortSignal.timeout(15000) 
                }),
                safeFetchJson(`https://itunes.apple.com/lookup?id=${matchedArtist.artistId}&entity=song&limit=200`, { 
                  signal: AbortSignal.timeout(15000) 
                })
              ]);

              if (albumData) {
                rawAlbums = (albumData.results || []).filter(r => r.wrapperType === 'collection');
              }
              if (songData) {
                rawSongs = (songData.results || []).filter(r => r.wrapperType === 'track');
              }
              if (rawAlbums.length > 0 || rawSongs.length > 0) {
                resolvedArtistName = matchedArtist.artistName || query;
                console.log(`[Artist] ${query}: matchedArtist=${matchedArtist?.artistName} id=${matchedArtist?.artistId} rawAlbums=${rawAlbums.length} rawSongs=${rawSongs.length}`);
                break;
              }
            }
          }
        } catch (err) {
          console.warn(`Artist ID lookup failed for "${query}":`, err.message);
        }

        // 2. Fallback keyword search for this candidate if ID lookup returned empty
        if (rawAlbums.length === 0 || rawSongs.length === 0) {
          try {
            const [songData, albumData] = await Promise.all([
              safeFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=100`, { 
                signal: AbortSignal.timeout(15000) 
              }),
              safeFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=100`, { 
                signal: AbortSignal.timeout(15000) 
              })
            ]);
            if (songData && rawSongs.length === 0) {
              rawSongs = (songData.results || []).filter(r => r.wrapperType === 'track' || r.trackName);
            }
            if (albumData && rawAlbums.length === 0) {
              rawAlbums = (albumData.results || []).filter(r => r.wrapperType === 'collection' || r.collectionName);
            }
            if (rawAlbums.length > 0 || rawSongs.length > 0) {
              resolvedArtistName = query;
              break;
            }
          } catch (searchErr) {
            console.warn(`Fallback search error for "${query}":`, searchErr.message);
          }
        }
      }

      const topTracks = rawSongs.map(item => ({
        id: `itunes_${item.trackId}`,
        trackNumber: item.trackNumber || 1,
        title: item.trackName,
        artist: item.artistName || artistName,
        album: item.collectionName || 'Single',
        duration: Math.round((item.trackTimeMillis || 180000) / 1000),
        artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : null,
        streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName || artistName)}`,
        hasArtwork: true,
        isStream: true,
        isVerified: true
      }));

      const seenTitles = new Set();
      const albums = [];

      // Collect from dedicated album results
      for (const a of rawAlbums) {
        const normA = (a.artistName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const isMatch = !normTarget || candidates.some(c => {
          const normC = c.toLowerCase().replace(/[^a-z0-9]/g, '');
          return normA.includes(normC) || normC.includes(normA);
        });
        const titleKey = (a.collectionName || '').toLowerCase().trim();

        if (isMatch && titleKey && !seenTitles.has(titleKey)) {
          seenTitles.add(titleKey);
          albums.push({
            id: String(a.collectionId),
            title: a.collectionName,
            artist: a.artistName || resolvedArtistName || artistName,
            year: a.releaseDate ? new Date(a.releaseDate).getFullYear() : null,
            trackCount: a.trackCount || 1,
            artworkUrl: a.artworkUrl100 ? a.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : null,
            primaryGenreName: a.primaryGenreName
          });
        }
      }

      // Also harvest albums from top songs to ensure no hits albums are missing
      for (const s of rawSongs) {
        if (!s.collectionId || !s.collectionName) continue;
        const normA = (s.artistName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const isMatch = !normTarget || candidates.some(c => {
          const normC = c.toLowerCase().replace(/[^a-z0-9]/g, '');
          return normA.includes(normC) || normC.includes(normA);
        });
        const titleKey = s.collectionName.toLowerCase().trim();

        if (isMatch && !seenTitles.has(titleKey)) {
          seenTitles.add(titleKey);
          albums.push({
            id: String(s.collectionId),
            title: s.collectionName,
            artist: s.artistName || resolvedArtistName || artistName,
            year: s.releaseDate ? new Date(s.releaseDate).getFullYear() : null,
            trackCount: s.trackCount || 1,
            artworkUrl: s.artworkUrl100 ? s.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : null,
            primaryGenreName: s.primaryGenreName
          });
        }
      }

      // Sort chronologically descending
      albums.sort((a, b) => (b.year || 0) - (a.year || 0));

      const responsePayload = {
        success: true,
        artist: resolvedArtistName || artistName,
        topTracks,
        albums
      };

      if (albums.length > 0 || topTracks.length > 0) {
        if (normTarget) {
          artistDiscographyCache.set(normTarget, responsePayload);
          if (dbModule) dbModule.setCachedArtist(normTarget, responsePayload);
        }
        const resolvedNorm = (resolvedArtistName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (resolvedNorm) {
          artistDiscographyCache.set(resolvedNorm, responsePayload);
          if (dbModule) dbModule.setCachedArtist(resolvedNorm, responsePayload);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responsePayload));
      return;
    } catch (err) {
      console.error(`Artist query failed for ${artistName}:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, albums: [], topTracks: [] }));
      return;
    }
  }

  // =========================================================================
  // 3.6. ALBUM DETAILS & TRACKLIST ENDPOINT (/api/album)
  // =========================================================================
  if (pathname === '/api/album') {
    const collectionId = parsedUrl.searchParams.get('id');
    if (!collectionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing album id' }));
      return;
    }

    try {
      const data = await safeFetchJson(`https://itunes.apple.com/lookup?id=${collectionId}&entity=song&limit=200`, { 
        signal: AbortSignal.timeout(10000) 
      });
      const items = data?.results || [];
      const albumInfo = items.find(i => i.wrapperType === 'collection') || items[0];
      const songs = items.filter(i => i.wrapperType === 'track').map(s => ({
        id: `itunes_${s.trackId}`,
        trackNumber: s.trackNumber,
        title: s.trackName,
        artist: s.artistName,
        album: s.collectionName,
        duration: Math.round((s.trackTimeMillis || 180000) / 1000),
        artworkUrl: s.artworkUrl100 ? s.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : null,
        streamUrl: `/api/stream/resolve?title=${encodeURIComponent(s.trackName)}&artist=${encodeURIComponent(s.artistName)}`,
        hasArtwork: true,
        isStream: true,
        isVerified: true
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        album: {
          id: collectionId,
          title: albumInfo?.collectionName,
          artist: albumInfo?.artistName,
          year: albumInfo?.releaseDate ? new Date(albumInfo.releaseDate).getFullYear() : null,
          artworkUrl: albumInfo?.artworkUrl100 ? albumInfo.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : null,
          trackCount: songs.length,
          tracks: songs
        }
      }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // =========================================================================
  // 3.7. LIVE VERIFIED ARTIST SEARCH ENDPOINT (/api/artists/search?q=...)
  // Returns real matching artists with official portraits and genre info
  // =========================================================================
  if (pathname === '/api/artists/search') {
    const query = (parsedUrl.searchParams.get('q') || '').trim();
    if (!query) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ artists: [] }));
      return;
    }

    const normQ = query.toLowerCase();
    const cacheKey = `artist_search:${normQ}`;
    const cached = dbModule ? dbModule.getCachedSearch(cacheKey) : null;
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
      return;
    }

    try {
      const data = await safeFetchJson(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=6`,
        { signal: AbortSignal.timeout(6000) }
      );
      const rawArtists = data?.results || [];

      // Only fetch avatar for top 2 artists if not already in artwork cache (prevents rate limiting)
      const artists = await Promise.all(rawArtists.map(async (art, idx) => {
        const artKey = `artist:${art.artistName.toLowerCase()}`;
        let avatarUrl = dbModule ? dbModule.getCachedArtwork(artKey) : null;

        if (!avatarUrl && idx < 2) {
          try {
            const sData = await safeFetchJson(
              `https://itunes.apple.com/search?term=${encodeURIComponent(art.artistName)}&entity=song&limit=1`,
              { signal: AbortSignal.timeout(3000) }
            );
            if (sData?.results && sData.results.length > 0 && sData.results[0].artworkUrl100) {
              avatarUrl = sData.results[0].artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
              if (dbModule) dbModule.setCachedArtwork(artKey, avatarUrl);
            }
          } catch (_) {}
        }

        return {
          id: `artist_${art.artistId || Math.random()}`,
          name: art.artistName,
          genre: art.primaryGenreName || 'Music',
          avatarUrl: avatarUrl || null
        };
      }));

      const payload = { artists };
      if (dbModule && artists.length > 0) {
        dbModule.setCachedSearch(cacheKey, payload);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    } catch (e) {
      console.warn('Artist search query failed:', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ artists: [] }));
      return;
    }
  }

  // =========================================================================
  // 3.8. SILENT BATCH ARTWORK HEALER (/api/tracks/heal)
  // Progressive background repair for tracks with missing artwork
  // =========================================================================
  if (pathname === '/api/tracks/heal' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const tracksToHeal = Array.isArray(body.tracks) ? body.tracks : (body.track ? [body.track] : []);
      if (tracksToHeal.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, healed: [] }));
        return;
      }

      // Limit to 25 tracks per heal batch to prevent network bursts
      const batch = tracksToHeal.slice(0, 25);
      const healed = await trackMatcherModule.batchHealTracks(batch);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: healed.length, healed }));
      return;
    } catch (err) {
      console.warn('[HealArtwork] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message, healed: [] }));
      return;
    }
  }

  // =========================================================================
  // 4. PERSONALIZED RECOMMENDATIONS & HOME SHELVES (/api/recommendations)
  // Generates 'Made For You', 'Trending Worldwide', and 'Genre Mixes' in parallel
  // =========================================================================
  if (pathname === '/api/recommendations') {
    const artistsParam = parsedUrl.searchParams.get('artists') || 'The Weeknd,Drake,Taylor Swift,Kendrick Lamar,Post Malone,Billie Eilish';
    const genresParam = parsedUrl.searchParams.get('genres') || 'Pop,Hip-Hop,R&B';
    const forceRefresh = parsedUrl.searchParams.get('refresh') === 'true';

    const cacheKey = `${artistsParam}::${genresParam}`;
    const now = Date.now();

    // Serve from high-speed cache if fresh (< 15 mins)
    if (!forceRefresh && cachedRecommendations && cachedRecommendations.key === cacheKey && (now - recsTimestamp < 15 * 60 * 1000)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cachedRecommendations.data));
      return;
    }

    const artistsList = artistsParam.split(',').map(a => a.trim()).filter(Boolean);
    const genresList = genresParam.split(',').map(g => g.trim()).filter(Boolean);

    try {
      const seenKeys = new Set();
      const formatTrack = (item, customAlbum) => {
        if (!item || !item.trackId || !item.trackName) return null;
        const key = `${(item.trackName || '').toLowerCase().trim()}::${(item.artistName || '').toLowerCase().trim()}`;
        if (seenKeys.has(key)) return null;
        seenKeys.add(key);

        return {
          id: `itunes_${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: customAlbum || item.collectionName || 'Single',
          albumArtist: item.artistName,
          genre: item.primaryGenreName || 'Pop',
          duration: Math.round((item.trackTimeMillis || 180000) / 1000),
          artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : null,
          streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName)}`,
          hasArtwork: true,
          isStream: true,
          isVerified: true
        };
      };

      // 1. Parallel fetch for favorite artist tracks (Made For You)
      const artistFetches = artistsList.slice(0, 6).map(artist =>
        safeFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=song&limit=5`, { signal: AbortSignal.timeout(6000) })
          .catch(() => null)
      );

      // 2. Parallel fetch for Global Trending Hits
      const trendingFetch = safeFetchJson(`https://itunes.apple.com/search?term=billboard+hot+100+hits&entity=song&limit=25`, { signal: AbortSignal.timeout(6000) })
        .catch(() => null);

      // 3. Parallel fetch for Genre Mixes
      const genreFetches = genresList.slice(0, 4).map(genre =>
        safeFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(genre)}+hits&entity=song&limit=8`, { signal: AbortSignal.timeout(6000) })
          .catch(() => null)
      );

      const [artistResults, trendingResult, ...genreResults] = await Promise.all([
        Promise.all(artistFetches),
        trendingFetch,
        ...genreFetches
      ]);

      const madeForYou = [];
      for (const resData of (artistResults || [])) {
        for (const item of (resData?.results || [])) {
          const t = formatTrack(item);
          if (t) madeForYou.push(t);
        }
      }

      const trending = [];
      for (const item of (trendingResult?.results || [])) {
        const t = formatTrack(item);
        if (t) trending.push(t);
      }

      const genreMixes = [];
      for (let i = 0; i < genreResults.length; i++) {
        const gName = genresList[i] || 'Top Mix';
        for (const item of (genreResults[i]?.results || [])) {
          const t = formatTrack(item, `${gName} Mix`);
          if (t) genreMixes.push(t);
        }
      }

      const reqUserId = parsedUrl.searchParams.get('userId') || 'local_user';
      let friendRecommendations = [];
      let boostedArtists = [];
      try {
        const enhanced = recommendationsModule.getRecommendedTracks(reqUserId, madeForYou);
        boostedArtists = enhanced.boostedArtists || [];
        friendRecommendations = enhanced.friendRecommendations || [];
        if (enhanced.recommendations && enhanced.recommendations.length > 0) {
          madeForYou = enhanced.recommendations;
        }
      } catch (_) {}

      const responseData = {
        success: true,
        madeForYou,
        trending: trending.length > 0 ? trending : madeForYou.slice(0, 15),
        genreMixes,
        boostedArtists,
        friendRecommendations
      };

      cachedRecommendations = { key: cacheKey, data: responseData };
      recsTimestamp = Date.now();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
      return;
    } catch (err) {
      console.error('Recommendations error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, madeForYou: [], trending: [], genreMixes: [] }));
      return;
    }
  }

  // =========================================================================
  // 5. MULTI-TIERED SYNCED LYRICS ENDPOINT (/api/lyrics/yt)
  // =========================================================================
  if (pathname === '/api/lyrics/yt') {
    const title = parsedUrl.searchParams.get('title') || '';
    const artist = parsedUrl.searchParams.get('artist') || '';
    let videoId = parsedUrl.searchParams.get('id') || '';

    try {
      if (title) {
        const cleanTitle = title.replace(/\s*\(feat\..+?\)/gi, '').replace(/\s*\[.+?\]/gi, '').trim();
        const lrcUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(artist)}`;
        
        try {
          const lrcRes = await fetch(lrcUrl, {
            headers: { 'User-Agent': 'LUMEN-Music-Player/1.0.0' },
            signal: AbortSignal.timeout(3500)
          });
          if (lrcRes.ok) {
            const data = await lrcRes.json();
            if (data.syncedLyrics) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                source: 'lrclib_synced',
                synced: true,
                lrcText: data.syncedLyrics,
                plainLyrics: data.plainLyrics || null
              }));
              return;
            } else if (data.plainLyrics) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                source: 'lrclib_plain',
                synced: false,
                plainLyrics: data.plainLyrics
              }));
              return;
            }
          }
        } catch (_) {}
      }

      if (!videoId && artist && title) {
        videoId = await resolveVideoId(artist, title);
      }

      if (videoId) {
        try {
          const client = await getYtdl();
          const info = await client.getInfo(videoId);
          const captionTracks = info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          if (captionTracks.length > 0) {
            const firstTrack = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];
            const capRes = await fetch(firstTrack.baseUrl, { signal: AbortSignal.timeout(3000) });
            const xml = await capRes.text();
            
            const regex = /<text start="([\d\.]+)" dur="([\d\.]+)".*?>(.*?)<\/text>/g;
            let match;
            const lines = [];
            while ((match = regex.exec(xml)) !== null) {
              const startSec = parseFloat(match[1]);
              const text = match[3]
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/<[^>]+>/g, '')
                .trim();
              if (text) {
                const mins = Math.floor(startSec / 60);
                const secs = (startSec % 60).toFixed(2);
                const timeTag = `[${String(mins).padStart(2, '0')}:${secs.padStart(5, '0')}]`;
                lines.push(`${timeTag} ${text}`);
              }
            }

            if (lines.length > 0) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                source: 'youtube_captions',
                synced: true,
                lrcText: lines.join('\n')
              }));
              return;
            }
          }
        } catch (_) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, synced: false, message: 'Lyrics not found' }));
      return;

    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // =========================================================================
  // 5.5. EXTERNAL PLAYLIST IMPORT ENDPOINT (/api/playlist/import)
  // Imports Spotify links, Apple Music/other playlists, or raw text/CSV
  // Resolves every track to 1000x1000 artwork, metadata, and direct stream URLs
  // =========================================================================
  if (pathname === '/api/playlist/import') {
    let rawBody = '';
    req.on('data', chunk => {
      rawBody += chunk;
      if (rawBody.length > 5 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        let payload = {};
        if (req.method === 'POST') {
          try {
            payload = JSON.parse(rawBody || '{}');
          } catch (_) {
            payload = { text: rawBody };
          }
        } else {
          payload = {
            url: parsedUrl.searchParams.get('url') || '',
            text: parsedUrl.searchParams.get('text') || '',
            name: parsedUrl.searchParams.get('name') || ''
          };
        }

        const inputUrl = (payload.url || '').trim();
        const inputText = (payload.text || '').trim();
        const spotifyClientId = (payload.spotifyClientId || process.env.SPOTIFY_CLIENT_ID || '').trim();
        const spotifyClientSecret = (payload.spotifyClientSecret || process.env.SPOTIFY_CLIENT_SECRET || '').trim();
        let customName = (payload.name || '').trim();

        let playlistTitle = customName || 'Imported Playlist';
        let playlistDescription = '';
        let candidateTracks = [];

        // 1. If URL is provided, try extracting from Spotify
        if (inputUrl) {
          const spotifyMatch = inputUrl.match(/playlist[\/:]([a-zA-Z0-9]+)/);
          if (spotifyMatch) {
            const playlistId = spotifyMatch[1];
            let fetchedViaApi = false;

            // 1A. If Spotify Client ID & Secret provided, use official Spotify Web API to paginate ALL songs (100+)
            if (spotifyClientId && spotifyClientSecret) {
              try {
                const authHeader = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');
                const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${authHeader}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials',
                  signal: AbortSignal.timeout(8000)
                });

                if (tokenRes.ok) {
                  const tokenData = await tokenRes.json();
                  const token = tokenData.access_token;

                  // Get playlist metadata
                  const plRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: AbortSignal.timeout(8000)
                  });

                  if (plRes.ok) {
                    const plData = await plRes.json();
                    playlistTitle = plData.name || playlistTitle;
                    playlistDescription = plData.description || '';

                    // Paginate through all tracks in batches of 100
                    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
                    while (nextUrl) {
                      const pageRes = await fetch(nextUrl, {
                        headers: { 'Authorization': `Bearer ${token}` },
                        signal: AbortSignal.timeout(8000)
                      });
                      if (!pageRes.ok) break;
                      const pageData = await pageRes.json();
                      for (const item of (pageData.items || [])) {
                        if (item.track && item.track.name) {
                          candidateTracks.push({
                            title: item.track.name,
                            artist: (item.track.artists || []).map(a => a.name).join(', '),
                            duration: Math.round((item.track.duration_ms || 180000) / 1000),
                            artworkUrl: item.track.album?.images?.[0]?.url || null,
                            album: item.track.album?.name || 'Unknown Album'
                          });
                        }
                      }
                      nextUrl = pageData.next;
                    }
                    fetchedViaApi = candidateTracks.length > 0;
                  }
                }
              } catch (apiErr) {
                console.warn('[Import] Spotify API error, falling back to embed:', apiErr.message);
              }
            }

            // 1B. Fallback to public embed scraper (first 100 tracks)
            if (!fetchedViaApi) {
              try {
                const embedRes = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                  },
                  signal: AbortSignal.timeout(8000)
                });
                if (embedRes.ok) {
                  const html = await embedRes.text();
                  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
                  if (nextDataMatch) {
                    const nextData = JSON.parse(nextDataMatch[1]);
                    const entity = nextData.props?.pageProps?.state?.data?.entity;
                    if (entity) {
                      playlistTitle = entity.name || playlistTitle;
                      playlistDescription = entity.description || '';
                      if (Array.isArray(entity.trackList)) {
                        candidateTracks = entity.trackList.map(t => ({
                          title: t.title || '',
                          artist: t.subtitle || '',
                          duration: t.duration ? Math.round(t.duration / 1000) : null,
                          artworkUrl: null // song will get authentic song album art
                        })).filter(t => t.title);
                      }
                    }
                  }
                }
              } catch (spotErr) {
                console.warn('[Import] Spotify scraping error:', spotErr.message);
              }
            }
          }
        }

        // 2. If candidate tracks empty and text was provided, parse text/CSV lines
        if (candidateTracks.length === 0 && inputText) {
          function parseCsvLine(text) {
            const result = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < text.length; i++) {
              const c = text[i];
              if (c === '"') {
                if (inQuotes && text[i + 1] === '"') {
                  cur += '"';
                  i++;
                } else {
                  inQuotes = !inQuotes;
                }
              } else if (c === ',' && !inQuotes) {
                result.push(cur.trim());
                cur = '';
              } else {
                cur += c;
              }
            }
            result.push(cur.trim());
            return result;
          }

          const lines = inputText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

          // Check if lines[0] is an Exportify or standard CSV header row
          let headerDetected = false;
          let titleIdx = -1;
          let artistIdx = -1;
          let albumIdx = -1;
          let durationIdx = -1;

          if (lines.length > 0 && lines[0].includes(',')) {
            const firstRowCols = parseCsvLine(lines[0]).map(c => c.toLowerCase().trim());
            const hasHeaderWords = firstRowCols.some(c => 
              c === 'title' || c === 'track name' || c.includes('track name') || 
              c === 'artist' || c.startsWith('artist name') || c === 'artists' ||
              c === 'track uri'
            );
            if (hasHeaderWords && firstRowCols.length >= 2) {
              headerDetected = true;
              titleIdx = firstRowCols.findIndex(c => c === 'track name' || c.includes('track name') || c === 'title');
              artistIdx = firstRowCols.findIndex(c => c.includes('artist'));
              albumIdx = firstRowCols.findIndex(c => c.includes('album'));
              durationIdx = firstRowCols.findIndex(c => c.includes('duration'));
            }
          }

          const rowsToProcess = headerDetected ? lines.slice(1) : lines;

          for (const line of rowsToProcess) {
            // Case A: CSV with detected headers (Exportify / Spotify CSV exports)
            if (headerDetected && titleIdx !== -1) {
              const cols = parseCsvLine(line);
              const songTitle = cols[titleIdx]?.replace(/^["']|["']$/g, '').trim();
              const songArtist = artistIdx !== -1 ? cols[artistIdx]?.replace(/^["']|["']$/g, '').trim() : '';
              const songAlbum = albumIdx !== -1 ? cols[albumIdx]?.replace(/^["']|["']$/g, '').trim() : '';
              let durSec = null;
              if (durationIdx !== -1 && cols[durationIdx]) {
                const rawDur = Number(cols[durationIdx].replace(/[^0-9]/g, ''));
                if (rawDur > 0) {
                  durSec = rawDur > 1000 ? Math.round(rawDur / 1000) : rawDur;
                }
              }

              if (songTitle) {
                candidateTracks.push({
                  title: songTitle,
                  artist: songArtist || '',
                  album: songAlbum || '',
                  duration: durSec
                });
                continue;
              }
            }

            // Case B: CSV line without header but starts with spotify:track: (e.g. Exportify rows without header)
            if (line.includes(',')) {
              const cols = parseCsvLine(line);
              if (cols.length >= 2) {
                if (cols[0].toLowerCase().startsWith('spotify:track:')) {
                  const songTitle = cols[1]?.replace(/^["']|["']$/g, '').trim();
                  const songArtist = cols[2]?.replace(/^["']|["']$/g, '').trim();
                  const songAlbum = cols[3]?.replace(/^["']|["']$/g, '').trim();
                  if (songTitle) {
                    candidateTracks.push({
                      title: songTitle,
                      artist: songArtist || '',
                      album: songAlbum || ''
                    });
                    continue;
                  }
                } else {
                  const col1 = cols[0].replace(/^["']|["']$/g, '').trim();
                  const col2 = cols[1].replace(/^["']|["']$/g, '').trim();
                  if (col1.toLowerCase() !== 'title' && col1.toLowerCase() !== 'track name') {
                    candidateTracks.push({ title: col1, artist: col2 });
                    continue;
                  }
                }
              }
            }

            // Case C: Single Spotify track URL or URI: https://open.spotify.com/track/... or spotify:track:...
            const trackMatch = line.match(/track[\/:]([a-zA-Z0-9]+)/);
            if (trackMatch) {
              const trId = trackMatch[1];
              try {
                // Scrape embed HTML for full metadata including authentic artist name
                const embedRes = await fetch(`https://open.spotify.com/embed/track/${trId}`, {
                  headers: BROWSER_HEADERS,
                  signal: AbortSignal.timeout(3000)
                });
                if (embedRes.ok) {
                  const html = await embedRes.text();
                  const idx = html.indexOf('__NEXT_DATA__');
                  if (idx !== -1) {
                    const start = html.indexOf('>', idx) + 1;
                    const end = html.indexOf('</script>', start);
                    const json = JSON.parse(html.substring(start, end));
                    const entity = json.props?.pageProps?.state?.data?.entity;
                    if (entity?.name) {
                      candidateTracks.push({
                        title: entity.name,
                        artist: (entity.artists || []).map(a => a.name).join(', ') || '',
                        artworkUrl: entity.visualIdentity?.image?.[0]?.url || null,
                        album: entity.album?.name || ''
                      });
                      continue;
                    }
                  }
                }
              } catch (_) {}
            }

            // Case D: "Title - Artist"
            if (line.includes(' - ')) {
              const parts = line.split(' - ');
              candidateTracks.push({ title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim() });
              continue;
            }

            // Case E: "Title by Artist"
            if (line.toLowerCase().includes(' by ')) {
              const idx = line.toLowerCase().lastIndexOf(' by ');
              candidateTracks.push({
                title: line.substring(0, idx).trim(),
                artist: line.substring(idx + 4).trim()
              });
              continue;
            }

            // Fallback: whole line as title
            candidateTracks.push({ title: line, artist: '' });
          }
        }

        if (candidateTracks.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            message: 'No playable tracks could be identified. Please check the URL or paste song names.'
          }));
          return;
        }

        // Preserve all candidate tracks from import without deduplicating
        const tracksToResolve = candidateTracks;

        // Use high-precision multi-factor candidate scoring to resolve tracks
        // Evaluates up to 15 candidates per song, enforcing strict artist compatibility,
        // original studio album preference over remixes, and automatic audio stream fallback.
        const finalTracks = await trackMatcherModule.batchMatchTracks(tracksToResolve, 5);

        // Index resolved tracks into FTS5 for instant discovery
        for (const tr of finalTracks) {
          try { searchEngineModule.indexSong(tr); } catch (_) {}
        }

        // Pick playlist cover strictly from the first song with an authentic album cover
        const firstSongWithArt = finalTracks.find(t => t.artworkUrl);
        const songAlbumCover = firstSongWithArt ? firstSongWithArt.artworkUrl : null;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          playlist: {
            id: `playlist_import_${Date.now()}`,
            name: playlistTitle,
            description: playlistDescription || `Imported ${finalTracks.length} tracks with verified studio audio and individual album covers`,
            coverUrl: songAlbumCover,
            trackCount: finalTracks.length,
            tracks: finalTracks
          }
        }));
      } catch (err) {
        console.error('[Import] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // =========================================================================
  // 5.6. PLAYLIST AUTO-REPAIR ENDPOINT (/api/playlist/repair)
  // Resolves tracks with "Unknown Artist" or missing artwork to real artists & 1000x1000 covers
  // =========================================================================
  if (pathname === '/api/playlist/repair') {
    let rawBody = '';
    req.on('data', chunk => {
      rawBody += chunk;
      if (rawBody.length > 5 * 1024 * 1024) req.destroy();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(rawBody || '{}');
        const tracks = payload.tracks || [];
        if (!Array.isArray(tracks) || tracks.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, repairedTracks: [] }));
          return;
        }

        const repairedTracks = [];
        // Concurrently resolve in batches of 5 with 40ms pause
        const BATCH = 5;
        for (let i = 0; i < tracks.length; i += BATCH) {
          const slice = tracks.slice(i, i + BATCH);
          const batchResults = await Promise.all(slice.map(async (t) => {
            const hasUnknownArtist = !t.artist || t.artist === 'Unknown Artist' || t.artist.trim() === '';
            const needsArtwork = !t.artworkUrl || t.artworkUrl.includes('image-cdn') || t.artworkUrl.includes('broken');

            if (!hasUnknownArtist && !needsArtwork) {
              return t;
            }

            try {
              const cleanTitle = (t.title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
              const searchQ = hasUnknownArtist ? cleanTitle : `${cleanTitle} ${t.artist}`;
              const data = await safeFetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQ)}&entity=song&limit=1`, {
                signal: AbortSignal.timeout(8000)
              });
              if (data?.results && data.results.length > 0) {
                const match = data.results[0];
                return {
                  ...t,
                  title: t.title || match.trackName,
                  artist: match.artistName || t.artist,
                  album: match.collectionName || t.album || 'Imported Album',
                  duration: Math.round((match.trackTimeMillis || 180000) / 1000),
                  artworkUrl: match.artworkUrl100 ? match.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : t.artworkUrl,
                  hasArtwork: true,
                  streamUrl: `/api/stream/resolve?title=${encodeURIComponent(t.title || match.trackName)}&artist=${encodeURIComponent(match.artistName)}`
                };
              }
            } catch (_) {}
            return t;
          }));
          repairedTracks.push(...batchResults);
          if (i + BATCH < tracks.length) {
            await new Promise(r => setTimeout(r, 40));
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, repairedTracks }));
      } catch (err) {
        console.error('[Repair] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // =========================================================================
  // 6. RATINGS, LISTENING STATS, FRIENDS, & COMPARISON REST APIS
  // =========================================================================

  // --- Ratings CRUD ---
  if (pathname === '/api/ratings') {
    if (req.method === 'GET') {
      try {
        const userId = parsedUrl.searchParams.get('userId') || 'local_user';
        const songId = parsedUrl.searchParams.get('songId');
        ensureUser(userId);

        if (songId) {
          const rating = ratingsModule.getRating(userId, songId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, rating }));
        } else {
          const ratings = ratingsModule.getUserRatings(userId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ratings }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const userId = body.userId || 'local_user';
        const songId = body.songId || body.id;
        if (!songId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'songId is required' }));
          return;
        }

        ensureUser(userId);
        ensureSong(songId, body.track || body);

        const result = ratingsModule.setRating(userId, songId, body.rating);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, rating: result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'DELETE') {
      try {
        const userId = parsedUrl.searchParams.get('userId') || 'local_user';
        const songId = parsedUrl.searchParams.get('songId');
        if (!songId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'songId is required' }));
          return;
        }

        const result = ratingsModule.deleteRating(userId, songId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, unrated: true, result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // Support POST /api/ratings/delete as fallback for clients without DELETE method
  if (pathname === '/api/ratings/delete' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const userId = body.userId || 'local_user';
      const songId = body.songId || body.id;
      if (!songId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'songId is required' }));
        return;
      }
      const result = ratingsModule.deleteRating(userId, songId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, unrated: true, result }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Playback Telemetry & Listening Stats ---
  if (pathname === '/api/playback/event' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const userId = body.userId || 'local_user';
      const songId = body.songId || body.id;
      if (!songId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'songId is required' }));
        return;
      }

      ensureUser(userId);
      ensureSong(songId, body.track || body);

      const event = analyticsModule.recordPlaybackEvent({
        userId,
        songId,
        listenedDurationSeconds: Number(body.listenedDuration ?? body.listenedDurationSeconds) || 0,
        completionStatus: body.status || body.completionStatus || 'completed'
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, event }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    try {
      const userId = parsedUrl.searchParams.get('userId') || 'local_user';
      const window = parsedUrl.searchParams.get('window') || '30d';
      ensureUser(userId);

      const stats = analyticsModule.getListeningStats(userId, window);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, stats }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Friends Network & Privacy ---
  if (pathname === '/api/friends' && req.method === 'GET') {
    try {
      const userId = parsedUrl.searchParams.get('userId') || 'local_user';
      const user = ensureUser(userId);
      const friends = friendsModule.getFriends(userId);
      const pendingObj = friendsModule.getPendingRequests(userId);
      const pending = Array.isArray(pendingObj) ? pendingObj : (pendingObj?.incoming || []);

      const json = JSON.stringify({
        success: true,
        friends,
        pending,
        visibility: user?.rating_visibility || 'friends',
        userId: user?.user_id || userId,
        username: user?.username || userId
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(json);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  if (pathname === '/api/friends/search') {
    try {
      let username = parsedUrl.searchParams.get('username') || '';
      if (!username && req.method === 'POST') {
        const body = await readJsonBody(req);
        username = body.username || '';
      }
      const match = friendsModule.findUserByUsername(username);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, user: match }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/friends/request' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const requesterId = body.requesterId || 'local_user';
      const targetUsername = body.username;
      if (!targetUsername) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'target username is required' }));
        return;
      }

      ensureUser(requesterId);
      const request = friendsModule.sendFriendRequest(requesterId, targetUsername);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, request }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/friends/respond' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const userId = body.userId || 'local_user';
      const requesterId = body.requesterId || body.friendId;
      const action = body.action; // 'accepted' or 'declined'

      if (!requesterId || !action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'requesterId and action (accepted/declined) are required' }));
        return;
      }

      const result = friendsModule.respondFriendRequest(userId, requesterId, action);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, friendship: result }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/friends/remove' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const userId = body.userId || 'local_user';
      const friendId = body.friendId;
      if (!friendId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'friendId is required' }));
        return;
      }

      const result = friendsModule.removeFriend(userId, friendId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, removed: result }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/user/visibility' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const userId = body.userId || 'local_user';
      const visibility = body.visibility; // 'public' | 'friends' | 'private'
      if (!visibility) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'visibility is required' }));
        return;
      }

      ensureUser(userId);
      const result = friendsModule.updateRatingVisibility(userId, visibility);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, visibility: result.rating_visibility }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Taste Comparison Matrix ---
  if (pathname === '/api/friends/compare' && req.method === 'GET') {
    try {
      const userId = parsedUrl.searchParams.get('userId') || 'local_user';
      const friendId = parsedUrl.searchParams.get('friendId');
      const songId = parsedUrl.searchParams.get('songId');

      if (!friendId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'friendId is required' }));
        return;
      }

      ensureUser(userId);

      if (songId) {
        const comparison = comparisonModule.compareSong(userId, friendId, songId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, comparison }));
      } else {
        const comparison = comparisonModule.compareCatalogs(userId, friendId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, comparison }));
      }
    } catch (err) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Multi-Device Offline Sync ---
  if (pathname === '/api/sync' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const userId = body.userId || 'local_user';
      ensureUser(userId);

      const result = syncModule.applySyncBatch(userId, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // =========================================================================
  // 7. STATIC SPA ASSETS FROM dist/
  // =========================================================================
  if (pathname === '/') pathname = '/index.html';
  let filePath = path.join(DIST_DIR, pathname);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };
    if (filePath.endsWith('index.html')) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`  LUMEN Hi-Fi Audio Server (Universal Verified Catalog)`);
  console.log(`======================================================`);
  console.log(`> Local Engine:    http://localhost:${PORT}`);
  console.log(`> Official Covers: 1000x1000 Studio Squares (Zero Bars)`);
  console.log(`> Verified Artists: 100M+ Official Studio Releases`);
  console.log(`> In-Memory Audio: 0 MB Disk (Opus 48kHz Range Stream)`);
  console.log(`======================================================\n`);
});
