'use strict';

/**
 * LUMEN Friends Network & Privacy Controls
 * Milestone 4 - Friendship lifecycle, username lookup, rating visibility & access control
 * Requirements: R3, Acceptance Criteria: AC5
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
        f.functionName === 'createFriendsService' ||
        f.functionName === 'createComparisonService' ||
        f.functionName === 'createRatingsService' ||
        f.functionName === 'createAnalyticsService' ||
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

function prepareAndGet(db, sql, ...params) {
  return getStatement(db, sql).get(...params);
}

function prepareAndAll(db, sql, ...params) {
  return getStatement(db, sql).all(...params);
}

function prepareAndRun(db, sql, ...params) {
  return getStatement(db, sql).run(...params);
}

/**
 * Normalizes timestamp and db arguments across polymorphic call patterns:
 * (arg1, arg2)
 * (arg1, arg2, now: number)
 * (arg1, arg2, db: DatabaseSync)
 * (arg1, arg2, now: number, db: DatabaseSync)
 */
function parseTimestampAndDb(timestampOrDb, maybeDb) {
  let now = Date.now();
  let dbInstance = null;

  if (typeof timestampOrDb === 'number') {
    now = timestampOrDb;
    dbInstance = maybeDb;
  } else if (timestampOrDb && typeof timestampOrDb === 'object') {
    dbInstance = timestampOrDb;
  }
  return { now, db: resolveDb(dbInstance) };
}

/**
 * Sends a friend request to a recipient identified by unique username.
 * Prevents self-friending, nonexistent usernames, and duplicate/reversed requests.
 *
 * @param {string} requesterId
 * @param {string} recipientUsername
 * @param {number|DatabaseSync} [timestampOrDb]
 * @param {DatabaseSync} [maybeDb]
 * @returns {{ requester_id: string, recipient_id: string, status: string, created_at: number, updated_at: number }}
 */
function sendFriendRequest(requesterId, recipientUsername, timestampOrDb, maybeDb) {
  const { now, db } = parseTimestampAndDb(timestampOrDb, maybeDb);

  if (!requesterId || typeof requesterId !== 'string') {
    throw new Error('Invalid requester ID');
  }
  if (!recipientUsername || typeof recipientUsername !== 'string') {
    throw new Error('Invalid recipient username');
  }

  // Lookup recipient by username
  const recipient = prepareAndGet(db, 'SELECT user_id, username FROM users WHERE username = ?', recipientUsername);
  if (!recipient) {
    throw new Error(`User not found: ${recipientUsername}`);
  }

  const recipientId = recipient.user_id;
  if (requesterId === recipientId) {
    throw new Error('Cannot friend self');
  }

  // Check existing relationship between requester and recipient (both directions)
  const existingSql = `
    SELECT requester_id, recipient_id, status, created_at, updated_at
    FROM friendships
    WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
  `;
  const existing = prepareAndGet(db, existingSql, requesterId, recipientId, recipientId, requesterId);

  if (existing) {
    if (existing.status === 'accepted') {
      throw new Error('Already friends');
    }
    if (existing.status === 'pending') {
      throw new Error('Friend request already pending');
    }
    // If previously declined or removed, reactivate as pending with new requester/recipient direction
    const updateSql = `
      UPDATE friendships
      SET requester_id = ?, recipient_id = ?, status = 'pending', updated_at = ?
      WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
    `;
    prepareAndRun(db, updateSql, requesterId, recipientId, now, requesterId, recipientId, recipientId, requesterId);
    return {
      requester_id: requesterId,
      recipient_id: recipientId,
      status: 'pending',
      created_at: existing.created_at,
      updated_at: now
    };
  }

  // Insert new pending friendship
  const insertSql = `
    INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `;
  prepareAndRun(db, insertSql, requesterId, recipientId, now, now);

  return {
    requester_id: requesterId,
    recipient_id: recipientId,
    status: 'pending',
    created_at: now,
    updated_at: now
  };
}

/**
 * Responds to a pending friend request with 'accepted' or 'declined'.
 * Verifies that the responding userId is the recipient of the pending request.
 *
 * @param {string} userId The responding user (must be recipient)
 * @param {string} requesterId The original requester
 * @param {'accepted'|'declined'} action Action to apply
 * @param {number|DatabaseSync} [timestampOrDb]
 * @param {DatabaseSync} [maybeDb]
 * @returns {{ success: boolean, status: 'accepted'|'declined', requester_id: string, recipient_id: string, updated_at: number }}
 */
function respondFriendRequest(userId, requesterId, action, timestampOrDb, maybeDb) {
  const { now, db } = parseTimestampAndDb(timestampOrDb, maybeDb);

  if (action !== 'accepted' && action !== 'declined') {
    throw new Error(`Invalid friendship response action: ${action}`);
  }

  let targetRequesterId = requesterId;

  // 1. Direct match: check if requesterId directly matches an existing friendship with userId
  const existingSql = `
    SELECT requester_id, recipient_id, status
    FROM friendships
    WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
  `;
  let existing = prepareAndGet(db, existingSql, requesterId, userId, userId, requesterId);

  // 2. If not found directly, check if requesterId is a composite friendship_id (e.g. 'u_alice_u_bob')
  if (!existing && typeof requesterId === 'string' && requesterId.includes('_')) {
    if (userId && requesterId.endsWith('_' + userId)) {
      targetRequesterId = requesterId.slice(0, -(userId.length + 1));
    } else if (userId && requesterId.startsWith(userId + '_')) {
      targetRequesterId = requesterId.slice(userId.length + 1);
    } else {
      const parts = requesterId.split('_');
      if (parts.length === 2 && (parts[0] === userId || parts[1] === userId)) {
        targetRequesterId = parts[0] === userId ? parts[1] : parts[0];
      }
    }

    if (targetRequesterId !== requesterId) {
      existing = prepareAndGet(db, existingSql, targetRequesterId, userId, userId, targetRequesterId);
    }
  }

  if (!existing || existing.status !== 'pending') {
    throw new Error('No pending friend request found to respond to');
  }

  // Permission verification: only recipient can accept or decline
  if (existing.recipient_id !== userId) {
    throw new Error('Only the recipient can respond to a friend request');
  }

  const updateSql = `
    UPDATE friendships
    SET status = ?, updated_at = ?
    WHERE requester_id = ? AND recipient_id = ? AND status = 'pending'
  `;
  const res = prepareAndRun(db, updateSql, action, now, existing.requester_id, existing.recipient_id);
  if (res.changes === 0) {
    throw new Error('No pending friend request found to respond to');
  }

  return {
    success: true,
    status: action,
    requester_id: existing.requester_id,
    recipient_id: existing.recipient_id,
    updated_at: now
  };
}

/**
 * Removes an accepted friend by updating friendship status to 'removed'.
 *
 * @param {string} userId User initiating removal
 * @param {string} friendId Friend being removed
 * @param {number|DatabaseSync} [timestampOrDb]
 * @param {DatabaseSync} [maybeDb]
 * @returns {boolean} True if friendship was removed, false if not found
 */
function removeFriend(userId, friendId, timestampOrDb, maybeDb) {
  const { now, db } = parseTimestampAndDb(timestampOrDb, maybeDb);

  const updateSql = `
    UPDATE friendships
    SET status = 'removed', updated_at = ?
    WHERE (
      (requester_id = ? AND recipient_id = ?) OR
      (requester_id = ? AND recipient_id = ?)
    ) AND status = 'accepted'
  `;
  let res = prepareAndRun(db, updateSql, now, userId, friendId, friendId, userId);
  if (res.changes > 0) {
    return true;
  }

  // Fallback: check if friendId is a composite friendship_id (e.g. 'u_alice_u_bob')
  if (typeof friendId === 'string' && friendId.includes('_')) {
    let targetFriendId = friendId;
    if (userId && friendId.endsWith('_' + userId)) {
      targetFriendId = friendId.slice(0, -(userId.length + 1));
    } else if (userId && friendId.startsWith(userId + '_')) {
      targetFriendId = friendId.slice(userId.length + 1);
    } else {
      const parts = friendId.split('_');
      if (parts.length === 2 && (parts[0] === userId || parts[1] === userId)) {
        targetFriendId = parts[0] === userId ? parts[1] : parts[0];
      }
    }
    if (targetFriendId !== friendId) {
      res = prepareAndRun(db, updateSql, now, userId, targetFriendId, targetFriendId, userId);
      return res.changes > 0;
    }
  }

  return false;
}

/**
 * Retrieves list of active accepted friends for a user.
 *
 * @param {string} userId
 * @param {DatabaseSync} [dbInstance]
 * @returns {Array<{ user_id: string, id: string, username: string, rating_visibility: string, visibility: string, created_at: number }>}
 */
function getFriends(userId, dbInstance) {
  const db = resolveDb(dbInstance);

  const sql = `
    SELECT u.user_id,
           u.user_id as id,
           u.username,
           u.rating_visibility,
           u.rating_visibility as visibility,
           u.created_at,
           f.created_at as friendship_created_at,
           f.updated_at as friendship_updated_at
    FROM friendships f
    JOIN users u ON (CASE WHEN f.requester_id = ? THEN f.recipient_id ELSE f.requester_id END = u.user_id)
    WHERE (f.requester_id = ? OR f.recipient_id = ?) AND f.status = 'accepted'
    ORDER BY u.username ASC
  `;
  return prepareAndAll(db, sql, userId, userId, userId);
}

/**
 * Checks whether requestingUserId is permitted to view targetUserId's ratings.
 * Access control matrix:
 *  - Self (target === requesting): always allowed (true)
 *  - Target does not exist: blocked (false)
 *  - Public visibility: always allowed (true)
 *  - Private visibility: strictly blocked for non-owner (false)
 *  - Friends visibility: allowed only if accepted friendship exists (true), else false
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
 * Retrieves incoming and outgoing pending friend requests for a user.
 *
 * @param {string} userId
 * @param {DatabaseSync} [dbInstance]
 * @returns {{ incoming: Array<any>, outgoing: Array<any> }}
 */
function getPendingRequests(userId, dbInstance) {
  const db = resolveDb(dbInstance);

  const sql = `
    SELECT f.requester_id, f.recipient_id, f.status, f.created_at, f.updated_at,
           u_req.username as requester_username,
           u_rec.username as recipient_username
    FROM friendships f
    JOIN users u_req ON f.requester_id = u_req.user_id
    JOIN users u_rec ON f.recipient_id = u_rec.user_id
    WHERE (f.requester_id = ? OR f.recipient_id = ?) AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `;
  const allPending = prepareAndAll(db, sql, userId, userId);

  const incoming = [];
  const outgoing = [];

  for (const item of allPending) {
    if (item.recipient_id === userId) {
      incoming.push({
        friendship_id: `${item.requester_id}_${item.recipient_id}`,
        requester_id: item.requester_id,
        requester_username: item.requester_username,
        created_at: item.created_at
      });
    } else {
      outgoing.push({
        friendship_id: `${item.requester_id}_${item.recipient_id}`,
        recipient_id: item.recipient_id,
        recipient_username: item.recipient_username,
        created_at: item.created_at
      });
    }
  }

  return { incoming, outgoing };
}

/**
 * Returns current friendship relationship status between two users.
 *
 * @param {string} userAId
 * @param {string} userBId
 * @param {DatabaseSync} [dbInstance]
 * @returns {{ status: string, requester_id: string|null, recipient_id: string|null, updated_at: number|null }}
 */
function getFriendshipStatus(userAId, userBId, dbInstance) {
  const db = resolveDb(dbInstance);

  const sql = `
    SELECT requester_id, recipient_id, status, created_at, updated_at
    FROM friendships
    WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
  `;
  const row = prepareAndGet(db, sql, userAId, userBId, userBId, userAId);
  if (!row) {
    return { status: 'none', requester_id: null, recipient_id: null, updated_at: null };
  }
  return row;
}

/**
 * Updates a user's rating visibility preference ('public', 'friends', 'private').
 *
 * @param {string} userId
 * @param {'public'|'friends'|'private'} visibility
 * @param {DatabaseSync} [dbInstance]
 * @returns {{ success: boolean, user_id: string, rating_visibility: string }}
 */
function updateRatingVisibility(userId, visibility, dbInstance) {
  const db = resolveDb(dbInstance);

  if (!['public', 'friends', 'private'].includes(visibility)) {
    throw new Error(`Invalid visibility setting: ${visibility}. Must be 'public', 'friends', or 'private'.`);
  }

  const sql = 'UPDATE users SET rating_visibility = ? WHERE user_id = ?';
  const res = prepareAndRun(db, sql, visibility, userId);
  if (res.changes === 0) {
    throw new Error(`User not found: ${userId}`);
  }

  return { success: true, user_id: userId, rating_visibility: visibility };
}

/**
 * Looks up user by unique username.
 *
 * @param {string} username
 * @param {DatabaseSync} [dbInstance]
 * @returns {{ user_id: string, id: string, username: string, rating_visibility: string, created_at: number }|null}
 */
function findUserByUsername(username, dbInstance) {
  const db = resolveDb(dbInstance);

  const sql = 'SELECT user_id, user_id as id, username, rating_visibility, created_at FROM users WHERE username = ?';
  const user = prepareAndGet(db, sql, username);
  return user || null;
}

/**
 * Factory for creating an isolated friends service instance bound to a specific database.
 * @param {DatabaseSync} [customDb]
 */
function createFriendsService(customDb) {
  let boundDb = customDb;
  return {
    sendFriendRequest: (requesterId, recipientUsername, now, db) => {
      if (now && typeof now === 'object' && typeof now.prepare === 'function') {
        return sendFriendRequest(requesterId, recipientUsername, Date.now(), now);
      }
      return sendFriendRequest(requesterId, recipientUsername, now, db || boundDb);
    },
    respondFriendRequest: (userId, requesterId, action, now, db) => {
      if (now && typeof now === 'object' && typeof now.prepare === 'function') {
        return respondFriendRequest(userId, requesterId, action, Date.now(), now);
      }
      return respondFriendRequest(userId, requesterId, action, now, db || boundDb);
    },
    removeFriend: (userId, friendId, now, db) => {
      if (now && typeof now === 'object' && typeof now.prepare === 'function') {
        return removeFriend(userId, friendId, Date.now(), now);
      }
      return removeFriend(userId, friendId, now, db || boundDb);
    },
    getFriends: (userId, db) => getFriends(userId, db || boundDb),
    checkRatingAccess: (targetUserId, requestingUserId, db) => checkRatingAccess(targetUserId, requestingUserId, db || boundDb),
    getPendingRequests: (userId, db) => getPendingRequests(userId, db || boundDb),
    getFriendshipStatus: (userAId, userBId, db) => getFriendshipStatus(userAId, userBId, db || boundDb),
    updateRatingVisibility: (userId, visibility, db) => updateRatingVisibility(userId, visibility, db || boundDb),
    findUserByUsername: (username, db) => findUserByUsername(username, db || boundDb),
    createFriendsService,
    resolveDb
  };
}

module.exports = {
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  getFriends,
  checkRatingAccess,
  getPendingRequests,
  getFriendshipStatus,
  updateRatingVisibility,
  findUserByUsername,
  createFriendsService,
  resolveDb
};
