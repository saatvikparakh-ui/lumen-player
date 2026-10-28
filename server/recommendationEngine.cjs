'use strict';

const dbModule = require('./db.cjs');
const defaultFriendsModule = require('./friends.cjs');

function resolveDb(db) {
  if (db && typeof db.prepare === 'function') {
    return db;
  }
  return dbModule.getDb();
}

// Default interpretable scoring weights according to specification
const DEFAULT_WEIGHTS = {
  personalPreference: 0.30,
  sessionIntent: 0.25,
  contentSimilarity: 0.15,
  behavioralSequence: 0.10,
  freshnessNovelty: 0.10,
  socialSignals: 0.05,
  evidenceQuality: 0.05
};

// Artist relatedness knowledge graph
const ARTIST_AFFINITY_GRAPH = {
  'the weeknd': ['frank ocean', 'lana del rey', 'travis scott', 'future', 'daft punk', 'kavinsky', 'sza'],
  'tame impala': ['pond', 'mgmt', 'beach house', 'mac demarco', 'unknown mortal orchestra', 'thundercat'],
  'nettspend': ['osamason', 'ken carson', 'playboi carti', 'destroy lonely', 'yeat'],
  'drake': ['21 savage', 'future', 'travis scott', 'lil baby', 'j. cole', 'partynextdoor'],
  'taylor swift': ['gracie abrams', 'phoebe bridgers', 'olivia rodrigo', 'sabrina carpenter', 'bleachers'],
  'kendrick lamar': ['j. cole', 'baby keem', 'schoolboy q', 'isaiah rashad', 'sza', 'anderson .paak'],
  'arctic monkeys': ['the strokes', 'the neighbourhood', 'cage the elephant', 'miles kane', 'foals'],
  'daft punk': ['justice', 'kavinsky', 'gesaffelstein', 'phoenix', 'parcels', 'the chemical brothers'],
  'post malone': ['swae lee', 'ty dolla $ign', 'juice wrld', 'the kid laroi', 'khalid'],
  'billie eilish': ['finneas', 'lorde', 'clairo', 'girl in red', 'olivia rodrigo'],
  'travis scott': ['don toliver', 'sheck wes', 'quavo', 'asap rocky', 'young thug']
};

/**
 * Creates the LUMEN Advanced Personalized Recommendation Engine
 */
function createRecommendationEngine(db = null, friendsService = null) {
  const activeDb = resolveDb(db);
  const activeFriends = friendsService || defaultFriendsModule.createFriendsService(activeDb);

  /**
   * Builds the persistent long-term listener taste profile
   */
  function getTasteProfile(userId) {
    if (!userId) {
      return { topArtists: [], averageRating: 7.0, totalPlays: 0, ratedSongCount: 0 };
    }

    try {
      // 1. High ratings analysis
      const ratingsRows = activeDb.prepare(`
        SELECT s.artist, r.rating_tenths, s.song_id
        FROM ratings r
        JOIN songs s ON r.song_id = s.song_id
        WHERE r.user_id = ?
        ORDER BY r.rating_tenths DESC
      `).all(userId);

      const artistScores = new Map();
      let totalTenths = 0;
      for (const row of ratingsRows) {
        totalTenths += row.rating_tenths;
        const normArt = (row.artist || '').toLowerCase().trim();
        const cur = artistScores.get(normArt) || { score: 0, count: 0 };
        // Weight ratings >= 8.5 (85 tenths) heavily
        cur.score += row.rating_tenths >= 85 ? 1.5 : (row.rating_tenths >= 70 ? 1.0 : 0.4);
        cur.count += 1;
        artistScores.set(normArt, cur);
      }

      // 2. Playback completions analysis
      const playRows = activeDb.prepare(`
        SELECT s.artist, p.completion_status, COUNT(*) as play_count
        FROM playback_events p
        JOIN songs s ON p.song_id = s.song_id
        WHERE p.user_id = ?
        GROUP BY s.artist, p.completion_status
      `).all(userId);

      for (const row of playRows) {
        const normArt = (row.artist || '').toLowerCase().trim();
        const cur = artistScores.get(normArt) || { score: 0, count: 0 };
        if (row.completion_status === 'completed') {
          // Diminishing returns: log scaling on plays
          cur.score += Math.log1p(row.play_count) * 0.8;
        } else if (row.completion_status === 'skipped') {
          cur.score -= Math.min(0.8, row.play_count * 0.15);
        }
        cur.count += row.play_count;
        artistScores.set(normArt, cur);
      }

      const sortedArtists = Array.from(artistScores.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .map(([artist, data]) => ({ artist, affinity: Math.min(1.0, data.score / 3.0) }));

      const avgTenths = ratingsRows.length > 0 ? (totalTenths / ratingsRows.length) : 70;

      return {
        topArtists: sortedArtists,
        averageRating: avgTenths / 10.0,
        ratedSongCount: ratingsRows.length,
        totalPlays: playRows.reduce((acc, r) => acc + r.play_count, 0)
      };
    } catch (_) {
      return { topArtists: [], averageRating: 7.0, totalPlays: 0, ratedSongCount: 0 };
    }
  }

  /**
   * Stage A: Multi-source candidate generation with mandatory eligibility constraints
   */
  function generateCandidates(userId, context = {}) {
    const candidates = [];
    const seenSongKeys = new Set();
    const exclusions = dbModule.getExclusions(userId, activeDb);
    const excludedArtists = new Set(exclusions.filter(e => e.entity_type === 'artist').map(e => e.entity_name.toLowerCase()));
    const excludedSongs = new Set(exclusions.filter(e => e.entity_type === 'song').map(e => e.entity_name.toLowerCase()));

    const taste = getTasteProfile(userId);
    const topArtistNames = taste.topArtists.slice(0, 8).map(a => a.artist);

    // Seed artists from context or taste profile
    const seedArtists = new Set([
      ...(context.seedArtist ? [context.seedArtist.toLowerCase()] : []),
      ...topArtistNames
    ]);

    // Source 1: High-rated songs from the user's library
    try {
      const highRatedSongs = activeDb.prepare(`
        SELECT s.song_id, s.title, s.artist, s.album, s.duration,
               r.rating_tenths, 'high_rated' as source
        FROM ratings r
        JOIN songs s ON r.song_id = s.song_id
        WHERE r.user_id = ? AND r.rating_tenths >= 80
        ORDER BY r.rating_tenths DESC, r.rated_at DESC
        LIMIT 25
      `).all(userId);

      for (const s of highRatedSongs) {
        const key = `${s.artist.toLowerCase()} - ${s.title.toLowerCase()}`;
        if (!seenSongKeys.has(key)) {
          seenSongKeys.add(key);
          candidates.push(s);
        }
      }
    } catch (_) {}

    // Source 2: Catalog tracks matching seed and related artists
    for (const seed of seedArtists) {
      if (excludedArtists.has(seed)) continue;

      try {
        const catalogTracks = activeDb.prepare(`
          SELECT s.song_id, s.title, s.artist, s.album, s.duration,
                 'artist_affinity' as source
          FROM songs s
          WHERE LOWER(s.artist) = ?
          LIMIT 10
        `).all(seed);

        for (const t of catalogTracks) {
          const key = `${t.artist.toLowerCase()} - ${t.title.toLowerCase()}`;
          if (!seenSongKeys.has(key)) {
            seenSongKeys.add(key);
            candidates.push(t);
          }
        }
      } catch (_) {}

      // Related artists expansion
      const related = ARTIST_AFFINITY_GRAPH[seed] || [];
      for (const rel of related) {
        if (excludedArtists.has(rel)) continue;
        try {
          const relTracks = activeDb.prepare(`
            SELECT s.song_id, s.title, s.artist, s.album, s.duration,
                   'related_discovery' as source
            FROM songs s
            WHERE LOWER(s.artist) = ?
            LIMIT 5
          `).all(rel);

          for (const t of relTracks) {
            const key = `${t.artist.toLowerCase()} - ${t.title.toLowerCase()}`;
            if (!seenSongKeys.has(key)) {
              seenSongKeys.add(key);
              candidates.push(t);
            }
          }
        } catch (_) {}
      }
    }

    // Source 3: Consented Friend-rated recommendations (rated >= 8.5 by friends, unheard by user)
    try {
      const friends = activeFriends.getFriends(userId);
      const friendIds = friends.map(f => f.user_id);
      if (friendIds.length > 0) {
        const placeholders = friendIds.map(() => '?').join(',');
        const friendTracks = activeDb.prepare(`
          SELECT DISTINCT s.song_id, s.title, s.artist, s.album, s.duration,
                 r.rating_tenths as friend_rating_tenths,
                 'friend_signal' as source
          FROM ratings r
          JOIN songs s ON r.song_id = s.song_id
          WHERE r.user_id IN (${placeholders})
            AND r.rating_tenths >= 85
            AND s.song_id NOT IN (SELECT song_id FROM ratings WHERE user_id = ?)
            AND s.song_id NOT IN (SELECT song_id FROM playback_events WHERE user_id = ?)
          LIMIT 15
        `).all(...friendIds, userId, userId);

        for (const t of friendTracks) {
          const key = `${t.artist.toLowerCase()} - ${t.title.toLowerCase()}`;
          if (!seenSongKeys.has(key)) {
            seenSongKeys.add(key);
            candidates.push(t);
          }
        }
      }
    } catch (_) {}

    // Mandatory exclusions filtering
    return candidates.filter(cand => {
      const art = (cand.artist || '').toLowerCase().trim();
      const tit = (cand.title || '').toLowerCase().trim();
      if (excludedArtists.has(art)) return false;
      if (excludedSongs.has(tit)) return false;
      // Exclude tracks currently in active queue if requested
      if (context.recentQueueIds && context.recentQueueIds.includes(cand.song_id)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Stage B: Two-Stage Interpretable Ranking Model
   */
  function rankCandidates(candidates, userId, context = {}, customWeights = {}) {
    const weights = { ...DEFAULT_WEIGHTS, ...customWeights };
    const taste = getTasteProfile(userId);
    const artistAffinities = new Map(taste.topArtists.map(a => [a.artist, a.affinity]));

    // Check recent plays for repetition penalty
    const recentPlayRows = activeDb.prepare(`
      SELECT s.song_id, MAX(p.started_at) as last_played
      FROM playback_events p
      JOIN songs s ON p.song_id = s.song_id
      WHERE p.user_id = ?
      GROUP BY s.song_id
      ORDER BY last_played DESC
      LIMIT 40
    `).all(userId);
    const recentPlayMap = new Map(recentPlayRows.map(r => [r.song_id, r.last_played]));

    const now = Date.now();

    const scored = candidates.map(track => {
      const normArtist = (track.artist || '').toLowerCase().trim();
      const normTitle = (track.title || '').toLowerCase().trim();

      // 1. Personal Preference Score (0.0 to 1.0)
      let personalScore = artistAffinities.get(normArtist) || 0.3;
      if (track.rating_tenths) {
        personalScore = Math.max(personalScore, track.rating_tenths / 100.0);
      }

      // 2. Session Intent Match (0.0 to 1.0)
      let intentScore = 0.5;
      if (context.seedArtist && context.seedArtist.toLowerCase() === normArtist) {
        intentScore = 1.0;
      } else if (context.seedTrack && context.seedTrack.artist && context.seedTrack.artist.toLowerCase() === normArtist) {
        intentScore = 0.85;
      }

      // 3. Content & Audio Similarity (0.0 to 1.0)
      let contentScore = 0.5;
      if (context.seedTrack) {
        // Duration proximity matching
        const seedDur = context.seedTrack.duration || 210;
        const candDur = track.duration || 210;
        const durDiff = Math.abs(seedDur - candDur);
        contentScore = Math.max(0.2, 1.0 - (durDiff / 300.0));
      }

      // 4. Behavioral Sequence & Continuity (0.0 to 1.0)
      let sequenceScore = 0.6;
      if (context.previousTrack && context.previousTrack.artist === track.artist) {
        // Slight penalty for back-to-back same artist in continuous playlists
        sequenceScore = 0.35;
      }

      // 5. Freshness & Novelty (0.0 to 1.0)
      let freshnessScore = 0.8;
      const lastPlay = recentPlayMap.get(track.song_id);
      if (lastPlay) {
        const hoursAgo = (now - lastPlay) / (1000 * 60 * 60);
        // Exponential decay penalty for tracks played in last 24h
        if (hoursAgo < 2) freshnessScore = 0.1;
        else if (hoursAgo < 12) freshnessScore = 0.35;
        else if (hoursAgo < 48) freshnessScore = 0.6;
      }

      // 6. Permitted Social Signals (0.0 to 1.0)
      let socialScore = 0.5;
      if (track.friend_rating_tenths) {
        socialScore = Math.min(1.0, track.friend_rating_tenths / 90.0);
      }

      // 7. Evidence Quality & Metadata Completeness (0.0 to 1.0)
      let evidenceScore = 0.5;
      if (track.duration && track.duration > 30) evidenceScore += 0.3;
      if (track.album && track.album !== 'Unknown Album') evidenceScore += 0.2;

      // Weighted Composite Score
      const finalScore = (
        personalScore * weights.personalPreference +
        intentScore * weights.sessionIntent +
        contentScore * weights.contentSimilarity +
        sequenceScore * weights.behavioralSequence +
        freshnessScore * weights.freshnessNovelty +
        socialScore * weights.socialSignals +
        evidenceScore * weights.evidenceQuality
      );

      return {
        ...track,
        recommendationScore: Number(finalScore.toFixed(4)),
        scoringBreakdown: {
          personal: Number(personalScore.toFixed(2)),
          intent: Number(intentScore.toFixed(2)),
          content: Number(contentScore.toFixed(2)),
          sequence: Number(sequenceScore.toFixed(2)),
          freshness: Number(freshnessScore.toFixed(2)),
          social: Number(socialScore.toFixed(2))
        }
      };
    });

    return scored.sort((a, b) => b.recommendationScore - a.recommendationScore);
  }

  return {
    getTasteProfile,
    generateCandidates,
    rankCandidates,

    /**
     * Home recommendations: Made For You, Trending, Artist Radio, Fresh Discovery
     */
    getHomeRecommendations(userId) {
      const candidates = generateCandidates(userId, {});
      const ranked = rankCandidates(candidates, userId, {});

      const madeForYou = ranked.slice(0, 12);
      const freshDiscovery = rankCandidates(candidates, userId, {}, { freshnessNovelty: 0.35, personalPreference: 0.20 }).slice(0, 10);
      const trending = ranked.filter(t => !madeForYou.includes(t)).slice(0, 10);

      return {
        madeForYou,
        freshDiscovery,
        trending
      };
    },

    /**
     * Recommendations similar to a chosen seed song
     */
    getSimilarSongs(seedTrack, userId, limit = 10) {
      if (!seedTrack) return [];
      const context = { seedTrack, seedArtist: seedTrack.artist };
      const candidates = generateCandidates(userId, context);
      const ranked = rankCandidates(candidates, userId, context, {
        contentSimilarity: 0.35,
        sessionIntent: 0.30,
        personalPreference: 0.15
      });
      return ranked.slice(0, limit);
    },

    /**
     * Queue continuation: picks the next logical track preserving continuous flow
     */
    getQueueContinuation(currentTrack, recentQueue = [], userId, limit = 5) {
      const context = {
        seedTrack: currentTrack,
        recentQueueIds: recentQueue.map(t => t.id || t.song_id)
      };
      const candidates = generateCandidates(userId, context);
      const ranked = rankCandidates(candidates, userId, context, {
        behavioralSequence: 0.35,
        freshnessNovelty: 0.25,
        sessionIntent: 0.20
      });
      return ranked.slice(0, limit);
    },

    /**
     * Smart Shuffle: orders collection to reduce clustering while preserving all tracks
     */
    getSmartShuffle(tracks, userId) {
      if (!Array.isArray(tracks) || tracks.length <= 2) return tracks || [];
      const pool = [...tracks];
      const result = [];
      let lastArtist = null;

      while (pool.length > 0) {
        // Find next track with different artist from last if possible
        const diffIdx = pool.findIndex(t => (t.artist || '').toLowerCase() !== (lastArtist || '').toLowerCase());
        const pickIdx = diffIdx !== -1 ? diffIdx : 0;
        const [picked] = pool.splice(pickIdx, 1);
        result.push(picked);
        lastArtist = picked.artist;
      }
      return result;
    },

    /**
     * Natural Language Playlist Generator: parses ordinary language requests into structured playlists
     */
    async generateNaturalLanguagePlaylist(prompt, userId, targetDuration = 2400) {
      const p = (prompt || '').toLowerCase();

      // Extract constraints
      const isNightDriving = p.includes('night') || p.includes('drive') || p.includes('driving');
      const isChill = p.includes('chill') || p.includes('calm') || p.includes('relax') || p.includes('study');
      const isEnergetic = p.includes('energetic') || p.includes('gym') || p.includes('workout') || p.includes('hype');
      const isRock = p.includes('rock') || p.includes('alt') || p.includes('indie');
      const isRap = p.includes('rap') || p.includes('hip hop') || p.includes('trap');

      let targetArtist = null;
      if (p.includes('tame impala')) targetArtist = 'Tame Impala';
      else if (p.includes('the weeknd')) targetArtist = 'The Weeknd';
      else if (p.includes('drake')) targetArtist = 'Drake';
      else if (p.includes('nettspend')) targetArtist = 'Nettspend';

      const context = {
        seedArtist: targetArtist,
        mood: isChill ? 'chill' : (isEnergetic ? 'energetic' : 'flow'),
        genre: isRock ? 'rock' : (isRap ? 'rap' : null)
      };

      let candidates = generateCandidates(userId, context);

      // If library has fewer than 5 candidates, augment with verified catalog
      if (candidates.length < 5) {
        try {
          const catalogQuery = targetArtist || (context.genre ? `${context.genre}` : (isNightDriving ? 'night drive' : 'indie alternative'));
          const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(catalogQuery)}&entity=song&limit=15`, {
            signal: AbortSignal.timeout(3500)
          });
          if (itunesRes.ok) {
            const itunesData = await itunesRes.json();
            const remoteCandidates = (itunesData.results || []).map(r => ({
              song_id: `catalog_${r.trackId}`,
              title: r.trackName,
              artist: r.artistName,
              album: r.collectionName || 'Studio Master',
              duration: Math.round((r.trackTimeMillis || 210000) / 1000),
              artwork_url: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg') : null,
              source: 'catalog_discovery'
            }));
            candidates = [...candidates, ...remoteCandidates];
          }
        } catch (_) {}
      }

      const ranked = rankCandidates(candidates, userId, context, {
        sessionIntent: 0.35,
        contentSimilarity: 0.25,
        personalPreference: 0.20
      });

      // Select tracks up to target duration
      const playlistTracks = [];
      let accumulatedDuration = 0;

      for (const track of ranked) {
        const dur = track.duration || 210;
        if (accumulatedDuration + dur <= targetDuration + 120 || playlistTracks.length < 5) {
          playlistTracks.push({
            id: track.song_id || `nl_${track.title}`,
            title: track.title,
            artist: track.artist,
            album: track.album || 'AI Curated',
            duration: dur,
            artworkUrl: track.artwork_url || null,
            streamUrl: `/api/stream/resolve?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&duration=${dur}`,
            hasArtwork: !!track.artwork_url,
            isStream: true,
            isVerified: true
          });
          accumulatedDuration += dur;
        }
        if (accumulatedDuration >= targetDuration) break;
      }

      const generatedTitle = targetArtist 
        ? `${targetArtist} & Atmospheric Soundscape`
        : (isNightDriving ? 'Midnight Drive Session' : (isChill ? 'Pure Serenity Mix' : 'LUMEN Intelligent Curation'));

      return {
        title: generatedTitle,
        description: `Curated by LUMEN AI Recommendation Engine from request: "${prompt}"`,
        tracks: playlistTracks,
        totalDurationSeconds: accumulatedDuration,
        targetDurationSeconds: targetDuration
      };
    }
  };
}

module.exports = {
  createRecommendationEngine,
  DEFAULT_WEIGHTS,
  ARTIST_AFFINITY_GRAPH
};
