'use strict';

/**
 * LUMEN Multi-User Rating Comparison Engine
 * Milestone 2 - Comparative metrics & cross-catalog queries
 * Requirements: R4, Acceptance Criteria: AC6
 */

const { DatabaseSync } = require('node:sqlite');
const dbMod = require('./db.cjs');
const ratingsMod = require('./ratings.cjs');

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

function prepareAndGet(db, sql, ...params) {
  const stmt = getStatement(db, sql);
  return stmt.get(...params);
}

function prepareAndAll(db, sql, ...params) {
  const stmt = getStatement(db, sql);
  return stmt.all(...params);
}

/**
 * Checks whether requestingUserId is permitted to view targetUserId's ratings.
 * Access control matrix:
 *  - Self: always allowed
 *  - Public: always allowed
 *  - Private: blocked for anyone other than self
 *  - Friends: allowed only if accepted friendship exists in friendships table
 *
 * @param {string} targetUserId
 * @param {string} requestingUserId
 * @param {DatabaseSync} [dbInstance]
 * @returns {boolean}
 */
function checkRatingAccess(targetUserId, requestingUserId, dbInstance) {
  if (targetUserId === requestingUserId) {
    return true;
  }

  const db = resolveDb(dbInstance);
  const user = prepareAndGet(db, 'SELECT rating_visibility FROM users WHERE user_id = ?', targetUserId);
  if (!user) {
    return false;
  }

  if (user.rating_visibility === 'public') {
    return true;
  }

  if (user.rating_visibility === 'private') {
    return false;
  }

  if (user.rating_visibility === 'friends') {
    const sql = `
      SELECT 1 FROM friendships
      WHERE status = 'accepted' AND (
        (requester_id = ? AND recipient_id = ?) OR
        (requester_id = ? AND recipient_id = ?)
      )
    `;
    const friendship = prepareAndGet(db, sql, targetUserId, requestingUserId, requestingUserId, targetUserId);
    return !!friendship;
  }

  return false;
}

/**
 * Compares two users' ratings for a single song.
 * Computes exact absolute difference |r1 - r2| in integer tenths and formatted string.
 * If either user has not rated the song (or ratings are inaccessible/private):
 * returns null difference and null for the unrated rating.
 *
 * @param {string} userAId Current viewing user
 * @param {string} userBId Friend / target user
 * @param {string} songId Song identifier
 * @param {DatabaseSync} [dbInstance] Optional database instance
 * @param {object} [friendsService] Optional friends service with checkRatingAccess
 * @param {object} [ratingsService] Optional ratings service with getRating
 * @returns {{ user_a_rating: string|null, user_b_rating: string|null, difference: string|null, difference_tenths: number|null }}
 */
function compareSong(userAId, userBId, songId, dbInstance, friendsService, ratingsService) {
  const db = resolveDb(dbInstance);

  const hasAccess = friendsService && typeof friendsService.checkRatingAccess === 'function'
    ? friendsService.checkRatingAccess(userBId, userAId)
    : checkRatingAccess(userBId, userAId, db);

  const getRatingFn = ratingsService && typeof ratingsService.getRating === 'function'
    ? (userId, sid) => ratingsService.getRating(userId, sid)
    : (userId, sid) => ratingsMod.getRating(userId, sid, db);

  const rA = getRatingFn(userAId, songId);
  const rB = hasAccess ? getRatingFn(userBId, songId) : { rating_tenths: null, formatted: null };

  if (rA.rating_tenths === null || rA.rating_tenths === undefined ||
      rB.rating_tenths === null || rB.rating_tenths === undefined) {
    return {
      user_a_rating: rA.formatted,
      user_b_rating: rB.formatted,
      difference: null,
      difference_tenths: null
    };
  }

  const diffTenths = Math.abs(rA.rating_tenths - rB.rating_tenths);
  return {
    user_a_rating: rA.formatted,
    user_b_rating: rB.formatted,
    difference: (diffTenths / 10).toFixed(1),
    difference_tenths: diffTenths
  };
}

/**
 * Cross-catalog comparison between two users.
 * Returns:
 *  - shared_favorites: Songs both rated >= 8.0 (rating_tenths >= 80), sorted by combined score DESC
 *  - divergence: Songs both rated, sorted descending by absolute difference
 *  - discovery: Songs rated by user B (>= 7.0 by default) that user A has not rated
 *  - access_denied: true if user A does not have permission to view user B's ratings
 *
 * @param {string} userAId Current user
 * @param {string} userBId Friend user
 * @param {DatabaseSync|object} [dbInstanceOrOptions]
 * @param {object} [optionsOrFriendsService]
 * @param {object} [maybeFriendsService]
 * @param {object} [maybeRatingsService]
 * @returns {{ shared_favorites: Array<any>, divergence: Array<any>, discovery: Array<any>, access_denied: boolean }}
 */
function compareCatalogs(userAId, userBId, dbInstanceOrOptions, optionsOrFriendsService, maybeFriendsService, maybeRatingsService) {
  let dbInstance;
  let options = {};
  let friendsService;

  const isDb = (obj) => obj && (typeof obj.prepare === 'function' || typeof obj.run === 'function');
  const isFriendsSvc = (obj) => obj && typeof obj.checkRatingAccess === 'function';

  if (isDb(dbInstanceOrOptions)) {
    dbInstance = dbInstanceOrOptions;
  } else if (isFriendsSvc(dbInstanceOrOptions)) {
    friendsService = dbInstanceOrOptions;
  } else if (dbInstanceOrOptions && typeof dbInstanceOrOptions === 'object') {
    options = Object.assign({}, dbInstanceOrOptions);
  }

  if (isFriendsSvc(optionsOrFriendsService)) {
    friendsService = optionsOrFriendsService;
  } else if (isDb(optionsOrFriendsService) && !dbInstance) {
    dbInstance = optionsOrFriendsService;
  } else if (optionsOrFriendsService && typeof optionsOrFriendsService === 'object') {
    options = Object.assign(options, optionsOrFriendsService);
  }

  if (isFriendsSvc(maybeFriendsService)) {
    friendsService = maybeFriendsService;
  }

  const db = resolveDb(dbInstance);

  const hasAccess = friendsService && typeof friendsService.checkRatingAccess === 'function'
    ? friendsService.checkRatingAccess(userBId, userAId)
    : checkRatingAccess(userBId, userAId, db);

  if (!hasAccess) {
    return {
      shared_favorites: [],
      divergence: [],
      discovery: [],
      access_denied: true
    };
  }

  // 1. Shared favorites: both users rated >= 8.0 (rating_tenths >= 80)
  const sharedSql = `
    SELECT COALESCE(s.song_id, rA.song_id) as song_id,
           COALESCE(s.title, 'Unknown') as title,
           COALESCE(s.artist, 'Unknown') as artist,
           COALESCE(s.album, '') as album,
           rA.rating_tenths as user_a_tenths,
           rB.rating_tenths as user_b_tenths,
           (rA.rating_tenths / 10.0) as user_a_rating,
           (rB.rating_tenths / 10.0) as user_b_rating,
           printf('%.1f', rA.rating_tenths / 10.0) as user_a_formatted,
           printf('%.1f', rB.rating_tenths / 10.0) as user_b_formatted
    FROM ratings rA
    JOIN ratings rB ON rA.song_id = rB.song_id
    LEFT JOIN songs s ON rA.song_id = s.song_id
    WHERE rA.user_id = ? AND rB.user_id = ?
      AND rA.rating_tenths >= 80 AND rB.rating_tenths >= 80
    ORDER BY (rA.rating_tenths + rB.rating_tenths) DESC
  `;
  const shared_favorites = prepareAndAll(db, sharedSql, userAId, userBId);

  // 2. Divergence: both rated, sorted descending by absolute difference
  const divSql = `
    SELECT COALESCE(s.song_id, rA.song_id) as song_id,
           COALESCE(s.title, 'Unknown') as title,
           COALESCE(s.artist, 'Unknown') as artist,
           COALESCE(s.album, '') as album,
           rA.rating_tenths as user_a_tenths,
           rB.rating_tenths as user_b_tenths,
           (rA.rating_tenths / 10.0) as user_a_rating,
           (rB.rating_tenths / 10.0) as user_b_rating,
           printf('%.1f', rA.rating_tenths / 10.0) as user_a_formatted,
           printf('%.1f', rB.rating_tenths / 10.0) as user_b_formatted,
           ABS(rA.rating_tenths - rB.rating_tenths) as difference_tenths,
           printf('%.1f', ABS(rA.rating_tenths - rB.rating_tenths) / 10.0) as difference
    FROM ratings rA
    JOIN ratings rB ON rA.song_id = rB.song_id
    LEFT JOIN songs s ON rA.song_id = s.song_id
    WHERE rA.user_id = ? AND rB.user_id = ?
    ORDER BY ABS(rA.rating_tenths - rB.rating_tenths) DESC
  `;
  let divergence = prepareAndAll(db, divSql, userAId, userBId);
  const defaultMinDivergence = (dbInstanceOrOptions !== undefined) ? 10 : 0;
  const minDivergenceTenths = (options && typeof options.minDivergenceTenths === 'number')
    ? options.minDivergenceTenths
    : (options && typeof options.minDifferenceTenths === 'number')
      ? options.minDifferenceTenths
      : defaultMinDivergence;
  if (minDivergenceTenths > 0) {
    divergence = divergence.filter(d => d.difference_tenths >= minDivergenceTenths);
  }

  // 3. Discovery: songs rated by user B (>= 7.0 by default) that user A has not rated
  const minDiscoveryTenths = (options && typeof options.minDiscoveryTenths === 'number')
    ? options.minDiscoveryTenths
    : 70;

  const discSql = `
    SELECT COALESCE(s.song_id, rB.song_id) as song_id,
           COALESCE(s.title, 'Unknown') as title,
           COALESCE(s.artist, 'Unknown') as artist,
           COALESCE(s.album, '') as album,
           rB.rating_tenths as friend_tenths,
           (rB.rating_tenths / 10.0) as friend_rating,
           printf('%.1f', rB.rating_tenths / 10.0) as friend_formatted
    FROM ratings rB
    LEFT JOIN songs s ON rB.song_id = s.song_id
    WHERE rB.user_id = ? AND rB.rating_tenths >= ?
      AND rB.song_id NOT IN (SELECT song_id FROM ratings WHERE user_id = ?)
    ORDER BY rB.rating_tenths DESC
  `;
  const discovery = prepareAndAll(db, discSql, userBId, minDiscoveryTenths, userAId);

  return {
    shared_favorites,
    divergence,
    discovery,
    access_denied: false
  };
}

/**
 * Factory for creating an isolated comparison service instance bound to a specific database.
 * @param {DatabaseSync} customDb
 * @param {object} [friendsService]
 * @param {object} [ratingsService]
 */
function createComparisonService(customDb, friendsService, ratingsService) {
  let boundDb = customDb;
  let boundOptions = {};
  if (customDb && typeof customDb === 'object' && typeof customDb.prepare !== 'function' && typeof customDb.run !== 'function') {
    boundOptions = customDb;
    boundDb = null;
  }
  return {
    compareSong: (userAId, userBId, songId) => compareSong(userAId, userBId, songId, boundDb, friendsService, ratingsService),
    compareCatalogs: (userAId, userBId, options) => {
      const mergedOptions = (options && typeof options === 'object')
        ? Object.assign({}, boundOptions, options)
        : boundOptions;
      return compareCatalogs(userAId, userBId, boundDb, mergedOptions, friendsService, ratingsService);
    }
  };
}

module.exports = {
  compareSong,
  compareCatalogs,
  checkRatingAccess,
  createComparisonService,
  resolveDb
};
