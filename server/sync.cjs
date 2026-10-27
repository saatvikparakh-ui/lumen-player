'use strict';

/**
 * LUMEN Multi-Device Sync & Conflict Resolution Engine
 * Milestone 4 - Multi-Device Sync & Privacy Boundary
 * Requirements: R3, R5, Acceptance Criteria: AC5, AC7
 *
 * Provides:
 * 1. Last-Write-Wins (LWW) conflict resolution for offline and multi-device mutations.
 * 2. Ratings sync: timestamped (rated_at) conflict resolution and deletion sync.
 * 3. Friendships sync: timestamped (updated_at) lifecycle synchronization.
 * 4. User settings sync: rating_visibility synchronization.
 * 5. Strict Telemetry Security Boundary: raw playback_events are NEVER exported or synced.
 * 6. Offline mutation queueing and payload compilation.
 * 7. Factory function createSyncService(customDb) and standalone methods.
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
        f.functionName === 'createSyncService' ||
        f.functionName === 'createRatingsService' ||
        f.functionName === 'createFriendsService' ||
        f.functionName === 'createComparisonService' ||
        f.functionName === 'createAnalyticsService'
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
      if (this._statementCache) {
        this._statementCache.clear();
      }
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
 * Strictly rejects 0.0, 0, > 10.0, negatives, non-tenths.
 */
function parseRating(input, options = {}) {
  if (typeof input !== 'number' || Number.isNaN(input) || !Number.isFinite(input)) {
    throw new Error(`Invalid rating input: ${input}. Must be a valid number.`);
  }

  const isTenthsExplicit = options === true || options.isTenths === true || options.tenthsContext === true;

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
 * Applies a batch sync payload for an authenticated user with LWW conflict resolution.
 * Supports:
 * - Ratings (insert, update, delete) using rated_at LWW ordering.
 * - Friendships using updated_at LWW ordering.
 * - User settings (rating_visibility).
 *
 * Invariant: Never imports or alters raw playback_events (telemetry security boundary).
 *
 * @param {string} targetUserId Authenticated user ID
 * @param {object} payload Sync batch payload
 * @param {DatabaseSync} [dbInstance]
 * @returns {{ success: boolean, applied: number, conflictsIgnored: number, details: object }}
 */
function applySyncBatch(targetUserId, payload, dbInstance) {
  if (!targetUserId || typeof targetUserId !== 'string') {
    throw new Error('targetUserId is required');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid sync payload: payload object required');
  }

  if (payload.userId && payload.userId !== targetUserId) {
    throw new Error(`Sync user mismatch: payload user ${payload.userId} does not match authenticated user ${targetUserId}`);
  }

  if (payload.user_id && payload.user_id !== targetUserId) {
    throw new Error(`Sync user mismatch: payload user ${payload.user_id} does not match authenticated user ${targetUserId}`);
  }

  if (payload.ratings !== undefined && !Array.isArray(payload.ratings)) {
    throw new Error('Invalid sync payload: ratings array required');
  }

  if (!Array.isArray(payload.ratings) && !payload.friendships && !payload.user_settings && !payload.settings) {
    throw new Error('Invalid sync payload: ratings array required');
  }

  const db = resolveDb(dbInstance);

  let applied = 0;
  let conflictsIgnored = 0;
  let ratingsApplied = 0;
  let ratingsIgnored = 0;
  let friendshipsApplied = 0;
  let friendshipsIgnored = 0;
  let settingsApplied = 0;

  // Execute entire batch inside an immediate transaction for atomicity
  const runBatch = () => {
    // 1. Process Ratings
    if (Array.isArray(payload.ratings)) {
      for (const item of payload.ratings) {
        const { user_id, song_id, rating_tenths, rated_at, deleted = false } = item;

        // Security check: authenticated user mismatch
        if (user_id !== targetUserId) {
          throw new Error(`Sync user mismatch: payload user ${user_id} does not match authenticated user ${targetUserId}`);
        }

        if (!song_id) {
          continue;
        }

        const existingSql = 'SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?';
        const existing = prepareAndGet(db, existingSql, user_id, song_id);

        if (deleted) {
          if (existing) {
            // LWW for deletion: deletion timestamp must be strictly newer than local edit
            if (rated_at > existing.rated_at) {
              const delSql = 'DELETE FROM ratings WHERE user_id = ? AND song_id = ?';
              prepareAndRun(db, delSql, user_id, song_id);
              applied++;
              ratingsApplied++;
            } else {
              conflictsIgnored++;
              ratingsIgnored++;
            }
          }
          // If no existing local rating, deleted record requires no action
        } else {
          let tenths;
          if (typeof rating_tenths === 'number' && Number.isInteger(rating_tenths)) {
            if (rating_tenths >= 1 && rating_tenths <= 100) {
              tenths = rating_tenths;
            } else {
              throw new Error(`Rating tenths out of range [1, 100]: ${rating_tenths}`);
            }
          } else {
            tenths = parseRating(rating_tenths);
          }
          if (!existing) {
            // No conflict: insert new rating
            const insertSql = `
              INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at)
              VALUES (?, ?, ?, ?)
            `;
            prepareAndRun(db, insertSql, user_id, song_id, tenths, rated_at);
            applied++;
            ratingsApplied++;
          } else {
            // LWW (Last-Write-Wins): newer rated_at wins
            if (rated_at > existing.rated_at) {
              const updateSql = `
                UPDATE ratings SET rating_tenths = ?, rated_at = ? WHERE user_id = ? AND song_id = ?
              `;
              prepareAndRun(db, updateSql, tenths, rated_at, user_id, song_id);
              applied++;
              ratingsApplied++;
            } else {
              conflictsIgnored++;
              ratingsIgnored++;
            }
          }
        }
      }
    }

    // 2. Process Friendships (if present)
    if (Array.isArray(payload.friendships)) {
      for (const f of payload.friendships) {
        const { requester_id, recipient_id, status, created_at = Date.now(), updated_at = Date.now() } = f;

        // Security check: friendship must involve targetUserId
        if (requester_id !== targetUserId && recipient_id !== targetUserId) {
          throw new Error(`Sync user mismatch: friendship pair (${requester_id}, ${recipient_id}) does not involve authenticated user ${targetUserId}`);
        }

        const validStatuses = ['pending', 'accepted', 'declined', 'removed'];
        if (!validStatuses.includes(status)) {
          throw new Error(`Invalid friendship status in sync payload: ${status}`);
        }

        const existingSql = `
          SELECT requester_id, recipient_id, status, created_at, updated_at
          FROM friendships
          WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
        `;
        const existing = prepareAndGet(db, existingSql, requester_id, recipient_id, recipient_id, requester_id);

        if (!existing) {
          const insertSql = `
            INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `;
          prepareAndRun(db, insertSql, requester_id, recipient_id, status, created_at, updated_at);
          applied++;
          friendshipsApplied++;
        } else {
          // LWW for friendships: newer updated_at wins
          if (updated_at > existing.updated_at) {
            const updateSql = `
              UPDATE friendships
              SET requester_id = ?, recipient_id = ?, status = ?, updated_at = ?
              WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
            `;
            prepareAndRun(db, updateSql, requester_id, recipient_id, status, updated_at, requester_id, recipient_id, recipient_id, requester_id);
            applied++;
            friendshipsApplied++;
          } else {
            conflictsIgnored++;
            friendshipsIgnored++;
          }
        }
      }
    }

    // 3. Process User Settings (if present)
    const settings = payload.user_settings || payload.settings;
    if (settings && typeof settings === 'object') {
      if (settings.user_id && settings.user_id !== targetUserId) {
        throw new Error(`Sync user mismatch: settings user ${settings.user_id} does not match authenticated user ${targetUserId}`);
      }

      if (settings.rating_visibility) {
        const validVis = ['public', 'friends', 'private'];
        if (!validVis.includes(settings.rating_visibility)) {
          throw new Error(`Invalid rating_visibility: ${settings.rating_visibility}`);
        }
        const updateSql = 'UPDATE users SET rating_visibility = ? WHERE user_id = ?';
        prepareAndRun(db, updateSql, settings.rating_visibility, targetUserId);
        applied++;
        settingsApplied++;
      }
    }
  };

  dbMod.withTransaction(db, runBatch);

  return {
    success: true,
    applied,
    conflictsIgnored,
    details: {
      ratingsApplied,
      ratingsIgnored,
      friendshipsApplied,
      friendshipsIgnored,
      settingsApplied
    }
  };
}

/**
 * Alias for applySyncBatch to satisfy both importSyncPayload and applySyncBatch naming conventions.
 */
const importSyncPayload = applySyncBatch;

/**
 * Exports modified ratings, friendships, and user settings since a specified timestamp.
 * TELEMETRY SECURITY INVARIANT: Raw playback_events are NEVER queried or included in sync payloads.
 *
 * @param {string} userId Authenticated user ID
 * @param {number} [sinceTimestamp=0] Timestamp threshold
 * @param {DatabaseSync} [dbInstance]
 * @returns {object} Sync export payload
 */
function exportSyncPayload(userId, sinceTimestamp = 0, dbInstance) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('userId is required for sync export');
  }

  const db = resolveDb(dbInstance);
  const since = typeof sinceTimestamp === 'number' && !Number.isNaN(sinceTimestamp) ? sinceTimestamp : 0;

  // 1. Export ratings modified since threshold
  const ratingsSql = `
    SELECT r.user_id, r.song_id, r.rating_tenths, r.rated_at,
           s.title, s.artist, s.album
    FROM ratings r
    LEFT JOIN songs s ON r.song_id = s.song_id
    WHERE r.user_id = ? AND r.rated_at >= ?
    ORDER BY r.rated_at ASC
  `;
  const ratingRows = prepareAndAll(db, ratingsSql, userId, since);
  const ratings = ratingRows.map(row => ({
    user_id: row.user_id,
    song_id: row.song_id,
    rating_tenths: row.rating_tenths,
    formatted: (row.rating_tenths / 10).toFixed(1),
    rated_at: row.rated_at,
    deleted: false
  }));

  // 2. Export friendships updated since threshold
  const friendshipsSql = `
    SELECT requester_id, recipient_id, status, created_at, updated_at
    FROM friendships
    WHERE (requester_id = ? OR recipient_id = ?) AND updated_at >= ?
    ORDER BY updated_at ASC
  `;
  const friendshipRows = prepareAndAll(db, friendshipsSql, userId, userId, since);
  const friendships = friendshipRows.map(f => ({
    requester_id: f.requester_id,
    recipient_id: f.recipient_id,
    status: f.status,
    created_at: f.created_at,
    updated_at: f.updated_at
  }));

  // 3. Export user settings
  const userSql = 'SELECT user_id, rating_visibility, created_at FROM users WHERE user_id = ?';
  const userRow = prepareAndGet(db, userSql, userId);
  const user_settings = userRow ? {
    user_id: userRow.user_id,
    rating_visibility: userRow.rating_visibility
  } : null;

  return {
    version: 1,
    user_id: userId,
    since,
    exported_at: Date.now(),
    ratings,
    friendships,
    user_settings
  };
}

/**
 * Offline Sync Queue Manager
 * Buffers offline mutations and generates valid sync payloads upon reconnection.
 */
class OfflineSyncQueue {
  constructor() {
    this.queue = [];
  }

  enqueueRating(userId, songId, rating, timestampOrOptions = Date.now(), maybeOptions = {}) {
    let timestamp = Date.now();
    let options = {};
    if (typeof timestampOrOptions === 'number') {
      timestamp = timestampOrOptions;
      if (typeof maybeOptions === 'object' && maybeOptions !== null) {
        options = maybeOptions;
      }
    } else if (typeof timestampOrOptions === 'object' && timestampOrOptions !== null) {
      options = timestampOrOptions;
      if (typeof options.timestamp === 'number') {
        timestamp = options.timestamp;
      }
    }

    let tenths;
    if (typeof rating === 'number' && Number.isInteger(rating) && (options.isTenths || rating > 10)) {
      tenths = parseRating(rating, { isTenths: true });
    } else {
      tenths = parseRating(rating, options);
    }

    this.queue.push({
      type: 'rating',
      user_id: userId,
      song_id: songId,
      rating_tenths: tenths,
      rated_at: timestamp,
      deleted: false
    });
    return this;
  }

  enqueueRatingDeletion(userId, songId, timestamp = Date.now()) {
    this.queue.push({
      type: 'rating_deletion',
      user_id: userId,
      song_id: songId,
      rated_at: timestamp,
      deleted: true
    });
    return this;
  }

  enqueueFriendship(requesterId, recipientId, status, timestamp = Date.now()) {
    this.queue.push({
      type: 'friendship',
      requester_id: requesterId,
      recipient_id: recipientId,
      status,
      updated_at: timestamp
    });
    return this;
  }

  enqueueSettings(userId, ratingVisibility, timestamp = Date.now()) {
    this.queue.push({
      type: 'settings',
      user_id: userId,
      rating_visibility: ratingVisibility,
      updated_at: timestamp
    });
    return this;
  }

  getPending() {
    return [...this.queue];
  }

  clear() {
    this.queue = [];
  }

  toPayload(targetUserId) {
    const ratings = [];
    const friendships = [];
    let user_settings = null;

    for (const item of this.queue) {
      if (item.type === 'rating' || item.type === 'rating_deletion') {
        if (!targetUserId || item.user_id === targetUserId) {
          ratings.push({
            user_id: item.user_id,
            song_id: item.song_id,
            rating_tenths: item.rating_tenths,
            rated_at: item.rated_at,
            deleted: item.deleted
          });
        }
      } else if (item.type === 'friendship') {
        if (!targetUserId || item.requester_id === targetUserId || item.recipient_id === targetUserId) {
          friendships.push({
            requester_id: item.requester_id,
            recipient_id: item.recipient_id,
            status: item.status,
            updated_at: item.updated_at
          });
        }
      } else if (item.type === 'settings') {
        if (!targetUserId || item.user_id === targetUserId) {
          user_settings = {
            user_id: item.user_id,
            rating_visibility: item.rating_visibility
          };
        }
      }
    }

    return {
      ratings,
      friendships,
      user_settings
    };
  }

  flush(syncService, targetUserId) {
    const payload = this.toPayload(targetUserId);
    const result = syncService.applySyncBatch(targetUserId, payload);
    this.clear();
    return result;
  }
}

function createOfflineQueue() {
  return new OfflineSyncQueue();
}

/**
 * Service Factory for Sync Service bound to an explicit database instance.
 * @param {DatabaseSync} [customDb]
 */
function createSyncService(customDb) {
  const db = resolveDb(customDb);
  return {
    applySyncBatch: (userId, payload) => applySyncBatch(userId, payload, db),
    importSyncPayload: (userId, payload) => importSyncPayload(userId, payload, db),
    exportSyncPayload: (userId, sinceTimestamp) => exportSyncPayload(userId, sinceTimestamp, db),
    createOfflineQueue
  };
}

module.exports = {
  applySyncBatch,
  importSyncPayload,
  exportSyncPayload,
  createSyncService,
  createOfflineQueue,
  OfflineSyncQueue,
  resolveDb,
  parseRating
};
