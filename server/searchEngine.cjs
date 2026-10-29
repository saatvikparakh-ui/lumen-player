// server/searchEngine.cjs
// Advanced "Fridge" Search Engine for LUMEN
// Combines SQLite FTS5 full-text indexing, Natural Language query understanding,
// typo tolerance (Levenshtein), and transparent multi-factor ranking.

'use strict';

const dbModule = require('./db.cjs');

// Levenshtein distance for typo tolerance
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1).toLowerCase() === a.charAt(j - 1).toLowerCase()) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function stringSimilarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  return (longerLength - levenshteinDistance(longer, shorter)) / parseFloat(longerLength);
}

function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Natural language intent parsing:
 * Detects:
 * - Version requests (acoustic, live, remix, instrumental)
 * - Decade / Year specifications ("from the 2000s", "90s", "1985")
 * - Mood / Genre terms ("upbeat indie rock", "chill synthwave")
 * - Recommendation requests ("songs like ...", "similar to ...")
 */
function parseQueryIntent(rawQuery) {
  const raw = rawQuery.trim();
  const lower = raw.toLowerCase();

  const intent = {
    rawQuery: raw,
    cleanQuery: raw,
    versionModifier: null, // 'acoustic' | 'live' | 'remix' | 'instrumental'
    decade: null,          // e.g. 2000, 1990, 1980
    genre: null,
    isContextRecommendation: false,
    contextSeed: null
  };

  // 1. Context recommendation intent: "songs like X", "music like X", "similar to X"
  const likeMatch = raw.match(/^(?:songs|tracks|music)\s+like\s+(.+)$/i) ||
                    raw.match(/^(?:similar\s+to)\s+(.+)$/i);
  if (likeMatch) {
    intent.isContextRecommendation = true;
    intent.contextSeed = likeMatch[1].trim();
    intent.cleanQuery = likeMatch[1].trim();
    return intent;
  }

  // 2. Version modifiers
  if (/\b(?:the\s+)?acoustic(?:\s+version)?\b/i.test(lower)) {
    intent.versionModifier = 'acoustic';
    intent.cleanQuery = intent.cleanQuery.replace(/\b(?:the\s+)?acoustic(?:\s+version)?(?:\s+of)?\b/gi, '').trim();
  } else if (/\b(?:the\s+)?live(?:\s+version)?\b/i.test(lower)) {
    intent.versionModifier = 'live';
    intent.cleanQuery = intent.cleanQuery.replace(/\b(?:the\s+)?live(?:\s+version)?(?:\s+of)?\b/gi, '').trim();
  } else if (/\b(?:the\s+)?remix(?:\s+version)?\b/i.test(lower)) {
    intent.versionModifier = 'remix';
    intent.cleanQuery = intent.cleanQuery.replace(/\b(?:the\s+)?remix(?:\s+version)?(?:\s+of)?\b/gi, '').trim();
  } else if (/\binstrumental\b/i.test(lower)) {
    intent.versionModifier = 'instrumental';
    intent.cleanQuery = intent.cleanQuery.replace(/\binstrumental(?:\s+version)?(?:\s+of)?\b/gi, '').trim();
  }

  // 3. Era / Decade detection: "from the 2000s", "in the 90s", "80s music"
  const decadeMatch = intent.cleanQuery.match(/\b(?:from(?:\s+the)?|in(?:\s+the)?)\s+(19\d0|20\d0)s?\b/i) ||
                      intent.cleanQuery.match(/\b(19\d0|20\d0)s\b/i);
  if (decadeMatch) {
    intent.decade = parseInt(decadeMatch[1], 10);
    intent.cleanQuery = intent.cleanQuery.replace(decadeMatch[0], '').trim();
  } else {
    const shortDecadeMatch = intent.cleanQuery.match(/\b('?\d0)s\b/i);
    if (shortDecadeMatch) {
      const d = parseInt(shortDecadeMatch[1].replace("'", ''), 10);
      intent.decade = d >= 50 ? 1900 + d : 2000 + d;
      intent.cleanQuery = intent.cleanQuery.replace(shortDecadeMatch[0], '').trim();
    }
  }

  // 4. Common genre / mood words
  const genres = [
    'indie rock', 'indie pop', 'synthwave', 'hip hop', 'r&b', 'pop', 'rock',
    'electronic', 'classical', 'jazz', 'lo-fi', 'metal', 'folk', 'ambient', 'acoustic'
  ];
  for (const g of genres) {
    const gRegex = new RegExp(`\\b${g}\\b`, 'i');
    if (gRegex.test(intent.cleanQuery)) {
      intent.genre = g;
      intent.cleanQuery = intent.cleanQuery.replace(gRegex, '').trim();
      break;
    }
  }

  // Clean trailing "from", "of", "the", "by", etc.
  intent.cleanQuery = intent.cleanQuery.replace(/\b(from|of|the|in|by)\b\s*$/i, '').trim();
  if (!intent.cleanQuery) {
    intent.cleanQuery = raw;
  }

  return intent;
}

/**
 * Ensures FTS5 table is created and kept in sync with the songs table.
 */
function ensureFtsTable(db) {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
        song_id UNINDEXED,
        title,
        artist,
        album,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  } catch (err) {
    console.warn('[SearchEngine] FTS5 setup warning:', err.message);
  }
}

/**
 * Indexes a song into FTS5
 */
function indexSong(song) {
  const db = dbModule.getDb();
  if (!db) return;
  try {
    ensureFtsTable(db);
    db.prepare(`
      INSERT OR REPLACE INTO songs_fts(song_id, title, artist, album)
      VALUES (?, ?, ?, ?)
    `).run(
      song.song_id || song.id,
      song.title || '',
      song.artist || '',
      song.album || ''
    );
  } catch (_) {}
}

/**
 * Transparent Ranking Function
 * Evaluates candidate track against query intent and normalized tokens.
 */
function rankCandidate(candidate, intent, userSignals = {}) {
  const queryNorm = normalize(intent.cleanQuery);
  const titleNorm = normalize(candidate.title || '');
  const cleanTitleNorm = normalize((candidate.title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ''));
  const artistNorm = normalize(candidate.artist || '');
  const albumNorm = normalize(candidate.album || '');

  let score = 0;
  const matchDetails = [];

  let titleMatched = false;
  let artistMatched = false;

  // 1. EXACT TITLE MATCH (Highest Priority - 100 points)
  if (titleNorm === queryNorm || cleanTitleNorm === queryNorm) {
    score += 100;
    titleMatched = true;
    matchDetails.push('exact_title');
  } else if (queryNorm.includes(cleanTitleNorm) && cleanTitleNorm.length > 2) {
    // e.g. Query is "Starboy The Weeknd" and track title is "Starboy"
    score += 65;
    titleMatched = true;
    matchDetails.push('title_in_query');
  } else if (cleanTitleNorm.includes(queryNorm)) {
    score += 45;
    titleMatched = true;
    matchDetails.push('query_in_title');
  }

  // 2. ARTIST MATCHING (55 points)
  if (artistNorm && queryNorm) {
    if (artistNorm === queryNorm) {
      score += 55;
      artistMatched = true;
      matchDetails.push('exact_artist');
    } else if (queryNorm.includes(artistNorm)) {
      // e.g. Query is "Starboy The Weeknd" and track artist is "The Weeknd"
      score += 50;
      artistMatched = true;
      matchDetails.push('artist_in_query');
    } else if (artistNorm.includes(queryNorm)) {
      score += 35;
      artistMatched = true;
      matchDetails.push('query_in_artist');
    }
  }

  // Bonus when BOTH title and artist match the query!
  if (titleMatched && artistMatched) {
    score += 40;
    matchDetails.push('title_and_artist_combo');
  }

  // 3. ALBUM MATCH (25 points)
  if (albumNorm && (albumNorm === queryNorm || queryNorm.includes(albumNorm))) {
    score += 25;
    matchDetails.push('album_match');
  }

  // 4. TOKEN OVERLAP
  const queryTokens = queryNorm.split(' ').filter(Boolean);
  const trackTokens = (titleNorm + ' ' + artistNorm + ' ' + albumNorm).split(' ').filter(Boolean);
  const matchedTokens = queryTokens.filter(t => trackTokens.includes(t));
  if (matchedTokens.length > 0) {
    const tokenRatio = matchedTokens.length / Math.max(queryTokens.length, 1);
    score += Math.round(tokenRatio * 25);
  }

  // 5. FUZZY SIMILARITY / TYPO TOLERANCE
  const sim = Math.max(
    stringSimilarity(queryNorm, titleNorm),
    stringSimilarity(queryNorm, cleanTitleNorm),
    stringSimilarity(queryNorm, artistNorm)
  );
  if (sim >= 0.75 && !titleMatched) {
    score += Math.round(sim * 25);
    matchDetails.push(`fuzzy_${Math.round(sim * 100)}%`);
  }

  // 6. VERSION COMPATIBILITY
  const trackTitleLower = (candidate.title || '').toLowerCase();
  if (intent.versionModifier) {
    const hasModifier = trackTitleLower.includes(intent.versionModifier);
    if (hasModifier) {
      score += 50;
      matchDetails.push(`requested_${intent.versionModifier}`);
    } else {
      score -= 25;
    }
  }

  // 7. PERSONALIZED USER SIGNALS (Small boost: max 15 points, never overrides exact match)
  const songId = candidate.id || candidate.song_id;
  if (userSignals.ratings && userSignals.ratings[songId]) {
    const ratingTenths = userSignals.ratings[songId];
    score += Math.round((ratingTenths / 100) * 10);
    matchDetails.push('user_rated');
  }
  if (userSignals.recentPlays && userSignals.recentPlays[songId]) {
    score += 5;
    matchDetails.push('recently_played');
  }

  return { score, matchDetails };
}

/**
 * Searches the accessible catalog and local database.
 * Supports exact, typo/fuzzy, natural language intent, and transparent ranking.
 */
async function searchCatalog(query, options = {}) {
  const db = dbModule.getDb();
  const limit = options.limit || 20;
  const userId = options.userId || null;

  if (!query || !query.trim()) {
    return { results: [], intent: null, total: 0 };
  }

  const intent = parseQueryIntent(query);

  // Collect user signals if userId provided
  const userSignals = { ratings: {}, recentPlays: {} };
  if (db && userId) {
    try {
      const userRatings = db.prepare(`SELECT song_id, rating_tenths FROM ratings WHERE user_id = ?`).all(userId);
      for (const r of userRatings) {
        userSignals.ratings[r.song_id] = r.rating_tenths;
      }
      const recent = db.prepare(`
        SELECT song_id FROM playback_events 
        WHERE user_id = ? 
        ORDER BY started_at DESC LIMIT 50
      `).all(userId);
      for (const r of recent) {
        userSignals.recentPlays[r.song_id] = true;
      }
    } catch (_) {}
  }

  // 1. Search Local SQLite database via songs table & FTS5
  let localCandidates = [];
  if (db) {
    try {
      ensureFtsTable(db);
      const cleanTokens = normalize(intent.cleanQuery).split(' ').filter(Boolean);
      
      if (cleanTokens.length > 0) {
        const ftsQuery = cleanTokens.map(t => `${t}*`).join(' OR ');
        try {
          const ftsRows = db.prepare(`
            SELECT s.song_id, s.title, s.artist, s.album, s.duration, s.metadata_fingerprint
            FROM songs_fts f
            JOIN songs s ON s.song_id = f.song_id
            WHERE songs_fts MATCH ?
            LIMIT 30
          `).all(ftsQuery);
          localCandidates.push(...ftsRows.map(r => ({
            id: r.song_id,
            title: r.title,
            artist: r.artist,
            album: r.album,
            duration: r.duration,
            source: 'local_library',
            isStream: true
          })));
        } catch (_) {}
      }

      const likePattern = `%${intent.cleanQuery}%`;
      const likeRows = db.prepare(`
        SELECT song_id, title, artist, album, duration
        FROM songs
        WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
        LIMIT 25
      `).all(likePattern, likePattern, likePattern);

      for (const r of likeRows) {
        if (!localCandidates.some(c => c.id === r.song_id)) {
          localCandidates.push({
            id: r.song_id,
            title: r.title,
            artist: r.artist,
            album: r.album,
            duration: r.duration,
            source: 'local_library',
            isStream: true
          });
        }
      }
    } catch (e) {
      console.warn('[SearchEngine] Local query warning:', e.message);
    }
  }

  // 2. Query verified external music catalogue (iTunes search API)
  let catalogCandidates = [];
  try {
    const https = require('https');
    const term = encodeURIComponent(intent.cleanQuery + (intent.versionModifier ? ' ' + intent.versionModifier : ''));
    const itunesUrl = `https://itunes.apple.com/search?term=${term}&entity=song&limit=25`;
    
    const itunesData = await new Promise((resolve) => {
      const req = https.get(itunesUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 LUMEN Music Engine' },
        timeout: 4000
      }, res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch (_) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });

    if (itunesData && Array.isArray(itunesData.results)) {
      const BANNED_TRIBUTE_REGEX = /\b(piano dreamers|tribute band|tribute|karaoke|lullaby|in the style of|string quartet|cover band|acoustic guitar cover|instrumental cover|remake|backing track|sound-alike|soundalike|originally performed by)\b/i;
      const userWantsCover = BANNED_TRIBUTE_REGEX.test(intent.rawQuery);

      catalogCandidates = itunesData.results
        .filter(item => {
          if (userWantsCover) return true;
          return !BANNED_TRIBUTE_REGEX.test(item.artistName || '') &&
                 !BANNED_TRIBUTE_REGEX.test(item.collectionName || '') &&
                 !BANNED_TRIBUTE_REGEX.test(item.trackName || '');
        })
        .map(item => ({
          id: `itunes_${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: item.collectionName || 'Single',
          duration: Math.round((item.trackTimeMillis || 180000) / 1000),
          artworkUrl: item.artworkUrl100
            ? item.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png|webp)/i, '/600x600bb.$1')
            : null,
          streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName)}`,
          source: 'catalog',
          isStream: true,
          isVerified: true
        }));
    }
  } catch (_) {}

  // Combine candidates deduplicating by normalized title + artist
  const allCandidates = [];
  const seenKeys = new Set();

  for (const c of [...localCandidates, ...catalogCandidates]) {
    const key = `${normalize(c.title)}::${normalize(c.artist)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      allCandidates.push(c);
    }
  }

  // Rank every candidate
  const scored = allCandidates.map(c => {
    const { score, matchDetails } = rankCandidate(c, intent, userSignals);
    return {
      ...c,
      searchScore: score,
      matchDetails
    };
  });

  // Sort descending by score
  scored.sort((a, b) => b.searchScore - a.searchScore);

  const finalResults = scored.slice(0, limit);

  return {
    query,
    intent,
    total: finalResults.length,
    results: finalResults
  };
}

module.exports = {
  searchCatalog,
  parseQueryIntent,
  rankCandidate,
  indexSong,
  ensureFtsTable,
  stringSimilarity,
  levenshteinDistance
};
