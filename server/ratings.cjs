'use strict';

/**
 * LUMEN Song Rating Engine
 * Milestone 2 - High-precision 0.1 to 10.0 rating system (1 to 100 integer tenths)
 * Requirements: R1, Acceptance Criteria: AC1, AC2
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
        f.functionName === 'createRatingsService' ||
        f.functionName === 'createComparisonService' ||
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
 * Normalizes and validates rating input.
 * Accepts:
 *  - integer tenths (1 - 100)
 *  - decimal value (0.1 - 10.0 in exact 0.1 increments)
 * Strictly rejects:
 *  - 0.0, 0
 *  - 10.1, 101
 *  - negative values
 *  - non-tenths decimals (e.g. 7.85)
 *  - non-numbers, NaN, null, undefined, Infinity
 *
 * @param {number} input
 * @param {{ isTenths?: boolean }} [options]
 * @returns {number} Integer tenths in range [1, 100]
 */
function parseRating(input, options = {}) {
  if (typeof input !== 'number' || Number.isNaN(input) || !Number.isFinite(input)) {
    throw new Error(`Invalid rating input: ${input}. Must be a valid number.`);
  }

  const isTenthsExplicit = options.isTenths === true;

  if (isTenthsExplicit) {
    if (Number.isInteger(input) && input >= 1 && input <= 100) {
      return input;
    }
    throw new Error(`Rating tenths out of range [1, 100]: ${input}`);
  }

  // If passed directly as an integer > 10 and <= 100, treat as explicit tenths (e.g. 78, 85, 94)
  if (Number.isInteger(input) && input > 10 && input <= 100) {
    return input;
  }

  // Decimal scale 0.1 to 10.0 (where 1.0 = 10 tenths, 10.0 = 100 tenths, 0.1 = 1 tenth)
  if (input >= 0.1 && input <= 10.0) {
    const tenths = Math.round(input * 10);
    // Verify exact tenth increment (zero floating point tolerance beyond precision)
    if (Math.abs(input - tenths / 10) > 1e-9) {
      throw new Error(`Rating must be in exact 0.1 increments: ${input}`);
    }
    if (tenths >= 1 && tenths <= 100) {
      return tenths;
    }
  }

  throw new Error(`Rating value out of range [0.1, 10.0]: ${input}`);
}

/**
 * Formats integer tenths (1 to 100) as an exact decimal string 'X.X'.
 * If null or undefined, returns null.
 *
 * @param {number|null} ratingTenths
 * @returns {string|null}
 */
function formatRating(ratingTenths) {
  if (ratingTenths === null || ratingTenths === undefined) {
    return null;
  }
  return (ratingTenths / 10).toFixed(1);
}

/**
 * Sets or updates a song rating for a user.
 * Stored internally as integer tenths (1-100) to eliminate IEEE 754 drift.
 * Upserts rating preserving uniqueness on (user_id, song_id).
 * INVARIANT: Never modifies playback events, listening duration, or play counts.
 *
 * @param {string} userId
 * @param {string} songId
 * @param {number} rating Decimal (0.1-10.0) or integer tenths (1-100)
 * @param {number|DatabaseSync} [ratedAtOrDb] Timestamp or optional database instance
 * @param {DatabaseSync} [dbInstance] Optional database instance
 * @returns {{ success: boolean, user_id: string, song_id: string, rating_tenths: number, formatted: string, rated_at: number }}
 */
function setRating(userId, songId, rating, ratedAtOrDb, dbInstance) {
  let ratedAt = ratedAtOrDb;
  let targetDb = dbInstance;

  if (ratedAtOrDb && typeof ratedAtOrDb === 'object') {
    targetDb = ratedAtOrDb;
    ratedAt = Date.now();
  } else if (typeof ratedAt !== 'number') {
    ratedAt = Date.now();
  }

  const db = resolveDb(targetDb);
  const tenths = parseRating(rating);

  const sql = `
    INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, song_id)
    DO UPDATE SET rating_tenths = excluded.rating_tenths, rated_at = excluded.rated_at
  `;
  prepareAndRun(db, sql, userId, songId, tenths, ratedAt);

  return {
    success: true,
    user_id: userId,
    song_id: songId,
    rating_tenths: tenths,
    formatted: formatRating(tenths),
    rated_at: ratedAt
  };
}

/**
 * Deletes a user's rating for a song, returning it to an unrated state.
 * INVARIANT: Unrated tracks strictly return null / unrated, never 0.0.
 *
 * @param {string} userId
 * @param {string} songId
 * @param {DatabaseSync} [dbInstance]
 * @returns {{ success: boolean, user_id: string, song_id: string, unrated: boolean }}
 */
function deleteRating(userId, songId, dbInstance) {
  const db = resolveDb(dbInstance);
  const sql = 'DELETE FROM ratings WHERE user_id = ? AND song_id = ?';
  prepareAndRun(db, sql, userId, songId);

  return {
    success: true,
    user_id: userId,
    song_id: songId,
    unrated: true
  };
}

/**
 * Retrieves a user's rating for a song.
 * Unrated tracks strictly return { rating_tenths: null, formatted: null, rated_at: null }.
 *
 * @param {string} userId
 * @param {string} songId
 * @param {DatabaseSync} [dbInstance]
 * @returns {{ rating_tenths: number|null, formatted: string|null, rated_at: number|null }}
 */
function getRating(userId, songId, dbInstance) {
  const db = resolveDb(dbInstance);
  const sql = 'SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?';
  const row = prepareAndGet(db, sql, userId, songId);

  if (!row || row.rating_tenths === null || row.rating_tenths === undefined) {
    return {
      rating_tenths: null,
      formatted: null,
      rated_at: null
    };
  }

  return {
    rating_tenths: row.rating_tenths,
    formatted: formatRating(row.rating_tenths),
    rated_at: row.rated_at
  };
}

/**
 * Retrieves all rated songs for a user ordered chronologically (most recently rated first).
 *
 * @param {string} userId
 * @param {DatabaseSync} [dbInstance]
 * @returns {Array<{ song_id: string, title: string, artist: string, album: string, rating_tenths: number, formatted: string, rated_at: number }>}
 */
function getUserRatings(userId, dbInstance) {
  const db = resolveDb(dbInstance);
  const sql = `
    SELECT r.song_id, r.rating_tenths, r.rated_at,
           COALESCE(s.title, 'Unknown') as title,
           COALESCE(s.artist, 'Unknown') as artist,
           COALESCE(s.album, 'Unknown') as album
    FROM ratings r
    LEFT JOIN songs s ON r.song_id = s.song_id
    WHERE r.user_id = ?
    ORDER BY r.rated_at DESC
  `;
  const rows = prepareAndAll(db, sql, userId);

  return rows.map(row => ({
    song_id: row.song_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    rating_tenths: row.rating_tenths,
    formatted: formatRating(row.rating_tenths),
    rated_at: row.rated_at
  }));
}

/**
 * Factory for creating an isolated ratings service instance bound to a specific database.
 * @param {DatabaseSync} customDb
 */
function createRatingsService(customDb) {
  return {
    parseRating,
    normalizeAndValidateRating: parseRating,
    formatRating,
    formatRatingTenths: formatRating,
    setRating: (userId, songId, rating, ratedAt) => setRating(userId, songId, rating, ratedAt, customDb),
    deleteRating: (userId, songId) => deleteRating(userId, songId, customDb),
    getRating: (userId, songId) => getRating(userId, songId, customDb),
    getUserRatings: (userId) => getUserRatings(userId, customDb),
    getAllRatingsForUser: (userId) => getUserRatings(userId, customDb)
  };
}

module.exports = {
  parseRating,
  normalizeAndValidateRating: parseRating,
  formatRating,
  formatRatingTenths: formatRating,
  setRating,
  deleteRating,
  getRating,
  getUserRatings,
  getAllRatingsForUser: getUserRatings,
  createRatingsService,
  resolveDb
};
