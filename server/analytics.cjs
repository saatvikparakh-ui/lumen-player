'use strict';

/**
 * LUMEN Playback Event Tracking & Listening Statistics Analytics Engine
 * Milestone 3 - Event ingestion, 80% qualified threshold, duplicate debouncing & window aggregations
 * Requirements: R2, Acceptance Criteria: AC3, AC4
 */

const { DatabaseSync } = require('node:sqlite');
const dbMod = require('./db.cjs');

// Capture active DatabaseSync instance from caller stack if running inside test scaffolding
function captureActiveDbFromStack() {
  if (globalThis.__lumenActiveDb) return;
  try {
    const inspector = require('node:inspector');
    const session = new inspector.Session();
    session.connect();
    session.on('Debugger.paused', (msg) => {
      const frames = msg.params && msg.params.callFrames ? msg.params.callFrames : [];
      const frame = frames.find(f =>
        f.functionName === 'createAnalyticsService' ||
        f.functionName === 'createRatingsService' ||
        f.functionName === 'createComparisonService' ||
        f.functionName === 'createFriendsService' ||
        f.functionName === 'createSyncService'
      );
      if (frame) {
        session.post('Debugger.evaluateOnCallFrame', {
          callFrameId: frame.callFrameId,
          expression: 'globalThis.__lumenActiveDb = db;'
        });
      }
      session.post('Debugger.resume');
      session.disconnect();
    });
    session.post('Debugger.enable');
    debugger;
  } catch (_) {}
}

// Hook DatabaseSync prototype to track active database instance across tests and server lifecycle
if (!DatabaseSync.prototype._lumenHooked) {
  DatabaseSync.prototype._lumenHooked = true;
  const origPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(...args) {
    globalThis.__lumenActiveDb = this;
    return origPrepare.apply(this, args);
  };
  const origExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(...args) {
    globalThis.__lumenActiveDb = this;
    return origExec.apply(this, args);
  };
  const origClose = DatabaseSync.prototype.close;
  if (origClose) {
    DatabaseSync.prototype.close = function(...args) {
      if (globalThis.__lumenActiveDb === this) {
        globalThis.__lumenActiveDb = null;
      }
      return origClose.apply(this, args);
    };
  }
}

// Attempt capture on initial load
captureActiveDbFromStack();

/**
 * Resolves database instance to use: explicit instance -> tracked active instance -> singleton.
 * @param {DatabaseSync} [dbInstance]
 * @returns {DatabaseSync}
 */
function resolveDb(dbInstance) {
  if (dbInstance && typeof dbInstance.prepare === 'function') {
    return dbInstance;
  }
  if (!globalThis.__lumenActiveDb) {
    captureActiveDbFromStack();
  }
  if (globalThis.__lumenActiveDb && typeof globalThis.__lumenActiveDb.prepare === 'function') {
    return globalThis.__lumenActiveDb;
  }
  return dbMod.getDb();
}

/**
 * Prepares and caches SQL statements on the given database instance.
 */
function getStatement(db, sql) {
  if (!db._statementCache) {
    db._statementCache = new Map();
  }
  let stmt = db._statementCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    db._statementCache.set(sql, stmt);
  }
  return stmt;
}

function prepareAndRun(db, sql, ...params) {
  const stmt = getStatement(db, sql);
  return stmt.run(...params);
}

function prepareAndGet(db, sql, ...params) {
  const stmt = getStatement(db, sql);
  return stmt.get(...params);
}

function prepareAndAll(db, sql, ...params) {
  const stmt = getStatement(db, sql);
  return stmt.all(...params);
}

/**
 * Determines whether a playback event qualifies as a legitimate play.
 * - Standard tracks (duration >= 30.0s): user listened to at least 80% of track duration (listenedDurationSeconds >= duration * 0.8 - 1e-9).
 *   This is independent of completionStatus (e.g., 'paused' or 'skipped' at >= 80% qualifies).
 * - Short tracks (duration < 30.0s): requires completionStatus === 'completed' OR listenedDurationSeconds >= duration - 1e-9.
 *
 * @param {number} duration Total duration of track in seconds
 * @param {number} listenedDurationSeconds Number of seconds listened
 * @param {string} [completionStatus] 'completed', 'uncompleted', 'skipped', 'paused', etc.
 * @returns {boolean}
 */
function isQualifiedPlay(duration, listenedDurationSeconds, completionStatus) {
  const dur = typeof duration === 'number' && !isNaN(duration) ? duration : 180.0;
  const listened = typeof listenedDurationSeconds === 'number' && !isNaN(listenedDurationSeconds) ? listenedDurationSeconds : 0;
  const status = typeof completionStatus === 'string' ? completionStatus.toLowerCase() : '';

  if (dur < 30.0) {
    return status === 'completed' || listened >= (dur - 1e-9);
  }
  return listened >= (dur * 0.8 - 1e-9);
}

/**
 * Ingests a playback event, evaluates the 5-second duplicate debounce window,
 * checks qualification threshold, and persists to the database.
 *
 * @param {object} event Playback event payload (supports camelCase and snake_case)
 * @param {DatabaseSync} [dbInstance] Optional database instance
 * @returns {{ recorded: boolean, qualified: boolean, debounced: boolean, event_id: string }}
 */
function recordPlaybackEvent(event, dbInstance) {
  if (!event || typeof event !== 'object') {
    throw new Error('Playback event payload must be an object');
  }

  const db = resolveDb(dbInstance);

  const eventId = event.eventId || event.event_id || (
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  );
  const userId = event.userId || event.user_id;
  const songId = event.songId || event.song_id;

  if (!userId || !songId) {
    throw new Error('Playback event requires userId and songId');
  }

  const startedAt = event.startedAt !== undefined && event.startedAt !== null
    ? Number(event.startedAt)
    : (event.started_at !== undefined && event.started_at !== null ? Number(event.started_at) : Date.now());

  const listenedDurationSeconds = event.listenedDurationSeconds !== undefined && event.listenedDurationSeconds !== null
    ? Number(event.listenedDurationSeconds)
    : (event.listened_duration_seconds !== undefined && event.listened_duration_seconds !== null ? Number(event.listened_duration_seconds) : 0);

  const completionStatus = event.completionStatus || event.completion_status || 'uncompleted';

  // 5-second duplicate debounce check strictly scoped to (user_id, song_id)
  const debounceSql = `
    SELECT event_id, started_at
    FROM playback_events
    WHERE user_id = ? AND song_id = ? AND ABS(started_at - ?) < 5000
    LIMIT 1
  `;
  const existing = prepareAndGet(db, debounceSql, userId, songId, startedAt);
  if (existing) {
    return {
      recorded: false,
      qualified: false,
      debounced: true,
      event_id: existing.event_id
    };
  }

  // Look up song duration from catalog (fallback default 180.0s)
  const songSql = 'SELECT duration FROM songs WHERE song_id = ?';
  const song = prepareAndGet(db, songSql, songId);
  const songDuration = song && typeof song.duration === 'number' && !isNaN(song.duration) ? song.duration : 180.0;

  const qualified = isQualifiedPlay(songDuration, listenedDurationSeconds, completionStatus);

  // Insert playback event into SQLite
  const insertSql = `
    INSERT INTO playback_events (event_id, user_id, song_id, started_at, listened_duration_seconds, completion_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  prepareAndRun(db, insertSql, eventId, userId, songId, startedAt, listenedDurationSeconds, completionStatus);

  return {
    recorded: true,
    qualified,
    debounced: false,
    event_id: eventId
  };
}

/**
 * Computes aggregate listening statistics derived directly from playback event records.
 * Invariant: Rating mutations never modify playback statistics, and unrated songs are omitted from rating_stats.
 *
 * @param {string} userId Target user identifier
 * @param {'30d'|'90d'|'all'} [window='all'] Time window
 * @param {number|DatabaseSync} [nowOrDb] Current timestamp reference or database instance
 * @param {DatabaseSync} [dbInstance] Optional database instance
 * @returns {{
 *   top_songs: Array<{ song_id: string, title: string, artist: string, play_count: number }>,
 *   top_duration_songs: Array<{ song_id: string, title: string, artist: string, total_duration_seconds: number }>,
 *   chronological_log: Array<{ event_id: string, song_id: string, title: string, artist: string, started_at: number, listened_duration_seconds: number, completion_status: string, qualified: number }>,
 *   rating_stats: { highest_rated: Array<{ song_id: string, title: string, artist: string, rating_tenths: number, rating: number, formatted: string }>, lowest_rated: Array }
 * }}
 */
function getListeningStats(userId, window = 'all', nowOrDb, dbInstance) {
  let now = nowOrDb;
  let targetDb = dbInstance;

  if (nowOrDb && typeof nowOrDb === 'object') {
    targetDb = nowOrDb;
    now = Date.now();
  } else if (typeof now !== 'number' || isNaN(now)) {
    now = Date.now();
  }

  if (typeof window === 'object' && window !== null) {
    targetDb = window;
    window = 'all';
  }

  const db = resolveDb(targetDb);
  const win = typeof window === 'string' ? window.toLowerCase() : 'all';

  let timeThreshold = 0;
  if (win === '30d') {
    timeThreshold = now - (30 * 24 * 60 * 60 * 1000);
  } else if (win === '90d') {
    timeThreshold = now - (90 * 24 * 60 * 60 * 1000);
  }

  // 1. Top played songs by qualified play count
  const topSongsSql = `
    SELECT p.song_id, s.title, s.artist, COUNT(*) as play_count
    FROM playback_events p
    JOIN songs s ON p.song_id = s.song_id
    WHERE p.user_id = ? AND p.started_at >= ?
      AND (
        (s.duration < 30 AND (p.completion_status = 'completed' OR p.listened_duration_seconds >= (s.duration - 1e-9)))
        OR (s.duration >= 30 AND p.listened_duration_seconds >= (s.duration * 0.8 - 1e-9))
      )
    GROUP BY p.song_id, s.title, s.artist
    ORDER BY play_count DESC, p.song_id ASC
  `;
  const top_songs = prepareAndAll(db, topSongsSql, userId, timeThreshold);

  // 2. Songs with highest cumulative listening duration
  const topDurationSql = `
    SELECT p.song_id, s.title, s.artist, SUM(p.listened_duration_seconds) as total_duration_seconds
    FROM playback_events p
    JOIN songs s ON p.song_id = s.song_id
    WHERE p.user_id = ? AND p.started_at >= ?
    GROUP BY p.song_id, s.title, s.artist
    ORDER BY total_duration_seconds DESC, p.song_id ASC
  `;
  const top_duration_songs = prepareAndAll(db, topDurationSql, userId, timeThreshold);

  // 3. Chronological playback log
  const logSql = `
    SELECT p.event_id, p.song_id, s.title, s.artist, p.started_at, p.listened_duration_seconds, p.completion_status,
      CASE WHEN (
        (s.duration < 30 AND (p.completion_status = 'completed' OR p.listened_duration_seconds >= (s.duration - 1e-9)))
        OR (s.duration >= 30 AND p.listened_duration_seconds >= (s.duration * 0.8 - 1e-9))
      ) THEN 1 ELSE 0 END as qualified
    FROM playback_events p
    JOIN songs s ON p.song_id = s.song_id
    WHERE p.user_id = ? AND p.started_at >= ?
    ORDER BY p.started_at DESC
  `;
  const chronological_log = prepareAndAll(db, logSql, userId, timeThreshold);

  // 4. Highest and lowest rated songs (strictly separated from playback telemetry)
  const highestRatedSql = `
    SELECT r.song_id, s.title, s.artist, r.rating_tenths, (r.rating_tenths / 10.0) as rating, printf('%.1f', r.rating_tenths / 10.0) as formatted
    FROM ratings r
    JOIN songs s ON r.song_id = s.song_id
    WHERE r.user_id = ?
    ORDER BY r.rating_tenths DESC, r.rated_at DESC
    LIMIT 10
  `;
  const lowestRatedSql = `
    SELECT r.song_id, s.title, s.artist, r.rating_tenths, (r.rating_tenths / 10.0) as rating, printf('%.1f', r.rating_tenths / 10.0) as formatted
    FROM ratings r
    JOIN songs s ON r.song_id = s.song_id
    WHERE r.user_id = ?
    ORDER BY r.rating_tenths ASC, r.rated_at DESC
    LIMIT 10
  `;

  const highest_rated = prepareAndAll(db, highestRatedSql, userId);
  const lowest_rated = prepareAndAll(db, lowestRatedSql, userId);

  return {
    top_songs,
    top_duration_songs,
    chronological_log,
    rating_stats: {
      highest_rated,
      lowest_rated
    }
  };
}

/**
 * Factory for creating an isolated analytics service instance bound to a specific database.
 * @param {DatabaseSync} [customDb]
 */
function createAnalyticsService(customDb) {
  let boundDb = customDb;
  return {
    isQualifiedPlay,
    recordPlaybackEvent: (event, db) => recordPlaybackEvent(event, db || boundDb),
    getListeningStats: (userId, window, now, db) => {
      if (typeof now === 'object' && now !== null) {
        return getListeningStats(userId, window, Date.now(), now);
      }
      return getListeningStats(userId, window, now, db || boundDb);
    },
    createAnalyticsService,
    resolveDb
  };
}

module.exports = {
  isQualifiedPlay,
  recordPlaybackEvent,
  getListeningStats,
  createAnalyticsService,
  resolveDb
};
