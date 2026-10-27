// server/trackMatcher.cjs
// High-Precision Multi-Factor Track Matcher for LUMEN
// Resolves original studio versions over remixes/covers and ensures strict artist matching.

const http = require('http');
const https = require('https');

function normalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^\w\s]/g, ' ')       // replace punctuation with space
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str) {
  return normalize(str).split(' ').filter(t => t.length > 0);
}

// Check if a title indicates a special version (remix, live, acoustic, cover, edit, etc.)
function getVersionFlags(title) {
  const norm = (title || '').toLowerCase();
  return {
    isRemix: /\b(remix|rmx|club mix|extended mix|dub mix)\b/i.test(norm),
    isLive: /\b(live|concert|tour|recorded live)\b/i.test(norm),
    isAcoustic: /\b(acoustic|unplugged|piano version|stripped)\b/i.test(norm),
    isCover: /\b(cover|tribute|karaoke|in the style of)\b/i.test(norm),
    isInstrumental: /\b(instrumental|backing track)\b/i.test(norm),
    isClean: /\b(clean|radio edit|radio version)\b/i.test(norm)
  };
}

/**
 * Score an iTunes candidate against input track metadata.
 * Returns -999 if the candidate is fundamentally wrong (different song title or wrong artist).
 */
function scoreCandidate(input, candidate) {
  const inputTitleRaw = input.title || '';
  const candTitleRaw = candidate.trackName || '';
  const inputArtistRaw = input.artist || '';
  const candArtistRaw = candidate.artistName || '';
  const inputAlbumRaw = input.album || '';
  const candAlbumRaw = candidate.collectionName || '';

  const inputTitleNorm = normalize(inputTitleRaw);
  const candTitleNorm = normalize(candTitleRaw);
  const inputArtistNorm = normalize(inputArtistRaw);
  const candArtistNorm = normalize(candArtistRaw);
  const inputAlbumNorm = normalize(inputAlbumRaw);
  const candAlbumNorm = normalize(candAlbumRaw);

  const cleanInputTitle = normalize(inputTitleRaw.replace(/\([^)]*\)|\[[^\]]*\]/g, ''));
  const cleanCandTitle = normalize(candTitleRaw.replace(/\([^)]*\)|\[[^\]]*\]/g, ''));

  // 1. MANDATORY TITLE COMPATIBILITY CHECK
  const inputTitleTokens = tokenize(cleanInputTitle || inputTitleNorm);
  const candTitleTokens = tokenize(cleanCandTitle || candTitleNorm);
  const matchingTitleTokens = inputTitleTokens.filter(t => candTitleTokens.includes(t));

  // If there are zero matching title tokens, this is a completely different song! Reject immediately.
  if (inputTitleTokens.length > 0 && matchingTitleTokens.length === 0) {
    return -999;
  }

  // Fraction of input title tokens matched
  const titleMatchRatio = matchingTitleTokens.length / Math.max(inputTitleTokens.length, 1);
  if (titleMatchRatio < 0.4) {
    // Too little overlap in title words
    return -999;
  }

  // 2. MANDATORY ARTIST COMPATIBILITY CHECK
  if (inputArtistNorm) {
    const inputArtistTokens = tokenize(inputArtistNorm);
    const candArtistTokens = tokenize(candArtistNorm);
    const matchingArtistTokens = inputArtistTokens.filter(t => candArtistTokens.includes(t));
    
    // If input artist was specified and has 0 token overlap with candidate artist, reject.
    if (inputArtistTokens.length > 0 && matchingArtistTokens.length === 0) {
      return -999;
    }
  }

  let score = 0;

  // Title Scoring (Up to 55 points)
  if (inputTitleNorm === candTitleNorm) {
    score += 55;
  } else if (cleanInputTitle === cleanCandTitle && cleanInputTitle.length > 0) {
    score += 50;
  } else {
    score += Math.round(titleMatchRatio * 40);
  }

  // Artist Scoring (Up to 45 points)
  if (inputArtistNorm && candArtistNorm) {
    if (inputArtistNorm === candArtistNorm) {
      score += 45;
    } else if (candArtistNorm.includes(inputArtistNorm) || inputArtistNorm.includes(candArtistNorm)) {
      score += 40;
    } else {
      const inputArtistTokens = tokenize(inputArtistNorm);
      const candArtistTokens = tokenize(candArtistNorm);
      const matchingTokens = inputArtistTokens.filter(t => candArtistTokens.includes(t));
      score += Math.round((matchingTokens.length / Math.max(inputArtistTokens.length, 1)) * 30);
    }
  }

  // Album Bonus (Up to 25 points)
  if (inputAlbumNorm && candAlbumNorm && inputAlbumNorm !== 'unknown album') {
    if (inputAlbumNorm === candAlbumNorm) {
      score += 25;
    } else if (candAlbumNorm.includes(inputAlbumNorm) || inputAlbumNorm.includes(candAlbumNorm)) {
      score += 15;
    }
  }

  // Version flags and remix penalty
  const inputFlags = getVersionFlags(inputTitleRaw);
  const candFlags = getVersionFlags(candTitleRaw);
  const candAlbumFlags = getVersionFlags(candAlbumRaw);

  // If input was NOT a remix, but candidate IS a remix -> heavy penalty (-60)
  if (!inputFlags.isRemix && (candFlags.isRemix || candAlbumFlags.isRemix)) {
    score -= 60;
  }
  if (inputFlags.isRemix && (candFlags.isRemix || candAlbumFlags.isRemix)) {
    score += 30;
  }

  // Cover / Tribute / Karaoke penalty (-70)
  if (!inputFlags.isCover && (candFlags.isCover || candAlbumFlags.isCover)) {
    score -= 70;
  }

  // Live penalty if input was not live (-35)
  if (!inputFlags.isLive && (candFlags.isLive || candAlbumFlags.isLive)) {
    score -= 35;
  }

  // Studio original bonus
  if (!candFlags.isRemix && !candFlags.isLive && !candFlags.isCover && !candFlags.isInstrumental) {
    score += 15;
  }

  return score;
}

// Fetch JSON with timeout helper
function fetchJson(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });

    req.on('error', reject);
  });
}

/**
 * High-precision track matcher.
 * Given an input track { title, artist, album, duration, artworkUrl },
 * queries iTunes API with limit=15, evaluates each candidate using multi-factor scoring,
 * and returns the best matching verified studio track.
 * If no candidate meets minScoreThreshold (default 60), preserves original authentic track details.
 */
async function matchTrack(inputTrack, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const minScoreThreshold = options.minScoreThreshold || 60;

  const title = (inputTrack.title || '').trim();
  const artist = (inputTrack.artist || '').trim();
  const album = (inputTrack.album || '').trim();

  if (!title) {
    return null;
  }

  const cleanTitle = title.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
  const queryStr = artist ? `${cleanTitle} ${artist}` : cleanTitle;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryStr)}&entity=song&limit=15`;

  let candidates = [];
  try {
    const data = await fetchJson(url, timeoutMs);
    if (data && Array.isArray(data.results)) {
      candidates = data.results;
    }
  } catch (err) {
    if (artist && cleanTitle.length > 2) {
      try {
        const fallbackUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTitle)}&entity=song&limit=15`;
        const fbData = await fetchJson(fallbackUrl, timeoutMs);
        if (fbData && Array.isArray(fbData.results)) {
          candidates = fbData.results;
        }
      } catch (_) {}
    }
  }

  // Score each candidate
  const scored = candidates
    .map(cand => ({
      cand,
      score: scoreCandidate({ title, artist, album }, cand)
    }))
    .filter(item => item.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const best = scored.length > 0 ? scored[0] : null;

  // If the best match meets our threshold, return the enriched iTunes record
  if (best && best.score >= minScoreThreshold) {
    const match = best.cand;
    const hiResArt = match.artworkUrl100
      ? match.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg')
      : (inputTrack.artworkUrl || null);

    return {
      id: `itunes_${match.trackId}`,
      title: match.trackName || title,
      artist: match.artistName || artist || 'Unknown Artist',
      album: match.collectionName || album || 'Imported Album',
      duration: Math.round((match.trackTimeMillis || 180000) / 1000),
      artworkUrl: hiResArt,
      streamUrl: `/api/stream/resolve?title=${encodeURIComponent(match.trackName || title)}&artist=${encodeURIComponent(match.artistName || artist)}`,
      hasArtwork: !!hiResArt,
      isStream: true,
      isVerified: true,
      matchScore: best.score
    };
  }

  // If no iTunes candidate was accurate enough, retain the authentic track information!
  // Do NOT corrupt the track by picking an unrelated song or a remix!
  return {
    id: `lumen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title: inputTrack.title,
    artist: inputTrack.artist || 'Unknown Artist',
    album: inputTrack.album || 'Imported Album',
    duration: inputTrack.duration || 180,
    artworkUrl: inputTrack.artworkUrl || null,
    streamUrl: `/api/stream/resolve?title=${encodeURIComponent(inputTrack.title)}&artist=${encodeURIComponent(inputTrack.artist || '')}`,
    hasArtwork: !!inputTrack.artworkUrl,
    isStream: true,
    isVerified: false,
    matchScore: best ? best.score : 0
  };
}

/**
 * Concurrently matches an array of tracks with a concurrency limit
 */
async function batchMatchTracks(tracks, concurrency = 5) {
  const results = new Array(tracks.length);
  let index = 0;

  async function worker() {
    while (index < tracks.length) {
      const i = index++;
      results[i] = await matchTrack(tracks[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tracks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = {
  normalize,
  tokenize,
  getVersionFlags,
  scoreCandidate,
  matchTrack,
  batchMatchTracks
};
