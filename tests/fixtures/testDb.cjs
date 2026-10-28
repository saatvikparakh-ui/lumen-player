'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Exact Relational DDL Schema matching PROJECT.md M1 specification
 */
const SCHEMA_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  rating_visibility TEXT CHECK(rating_visibility IN ('public', 'friends', 'private')) DEFAULT 'friends',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  song_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  duration REAL NOT NULL,
  metadata_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  rating_tenths INTEGER NOT NULL CHECK(rating_tenths BETWEEN 1 AND 100),
  rated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, song_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(song_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friendships (
  requester_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending', 'accepted', 'declined', 'removed')) NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  user_low TEXT GENERATED ALWAYS AS (CASE WHEN requester_id < recipient_id THEN requester_id ELSE recipient_id END) STORED,
  user_high TEXT GENERATED ALWAYS AS (CASE WHEN requester_id < recipient_id THEN recipient_id ELSE requester_id END) STORED,
  UNIQUE(user_low, user_high),
  CHECK(requester_id <> recipient_id),
  FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playback_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  listened_duration_seconds REAL NOT NULL,
  completion_status TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(song_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ratings_user ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_song ON ratings(song_id);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_recipient ON friendships(recipient_id);
CREATE INDEX IF NOT EXISTS idx_playback_user_time ON playback_events(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_playback_song ON playback_events(song_id);

CREATE TABLE IF NOT EXISTS shares (
  share_id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  song_id TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration REAL,
  stream_url TEXT,
  external_link TEXT,
  message TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_dismissed INTEGER NOT NULL DEFAULT 0,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_recipient ON shares(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shares_sender ON shares(sender_id, created_at DESC);
`;

/**
 * Creates an isolated in-memory SQLite database instance with full schema applied.
 */
function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_DDL);
  return db;
}

/**
 * Seed Helpers
 */
function seedUser(db, { userId, username, ratingVisibility = 'friends', createdAt = Date.now() }) {
  const stmt = db.prepare(
    'INSERT INTO users (user_id, username, rating_visibility, created_at) VALUES (?, ?, ?, ?)'
  );
  stmt.run(userId, username, ratingVisibility, createdAt);
  return { userId, username, ratingVisibility, createdAt };
}

function seedSong(db, { songId, title, artist = 'Unknown', album = 'Unknown', duration = 180.0, metadataFingerprint = null }) {
  const stmt = db.prepare(
    'INSERT INTO songs (song_id, title, artist, album, duration, metadata_fingerprint) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(songId, title, artist, album, duration, metadataFingerprint);
  return { songId, title, artist, album, duration, metadataFingerprint };
}

function seedRating(db, { userId, songId, ratingTenths, ratedAt = Date.now() }) {
  const stmt = db.prepare(
    'INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, song_id) DO UPDATE SET rating_tenths = excluded.rating_tenths, rated_at = excluded.rated_at'
  );
  stmt.run(userId, songId, ratingTenths, ratedAt);
  return { userId, songId, ratingTenths, ratedAt };
}

function seedFriendship(db, { requesterId, recipientId, status = 'pending', createdAt = Date.now(), updatedAt = Date.now() }) {
  const stmt = db.prepare(
    'INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run(requesterId, recipientId, status, createdAt, updatedAt);
  return { requesterId, recipientId, status, createdAt, updatedAt };
}

function seedPlaybackEvent(db, { eventId, userId, songId, startedAt = Date.now(), listenedDurationSeconds = 180.0, completionStatus = 'completed' }) {
  const stmt = db.prepare(
    'INSERT INTO playback_events (event_id, user_id, song_id, started_at, listened_duration_seconds, completion_status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(eventId, userId, songId, startedAt, listenedDurationSeconds, completionStatus);
  return { eventId, userId, songId, startedAt, listenedDurationSeconds, completionStatus };
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
 *  - non-numbers, NaN, null
 */
function normalizeAndValidateRating(input, options = {}) {
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
 * Exact display formatting: (tenths / 10).toFixed(1)
 */
function formatRatingTenths(ratingTenths) {
  if (ratingTenths === null || ratingTenths === undefined) {
    return null;
  }
  return (ratingTenths / 10).toFixed(1);
}

/**
 * Service Factories
 */
function createRatingsService(db) {
  // Check if server module exists
  let serverMod = null;
  try {
    const serverPath = path.resolve(__dirname, '../../server/ratings.cjs');
    if (fs.existsSync(serverPath)) {
      serverMod = require(serverPath);
    }
  } catch (e) {}

  if (serverMod && typeof serverMod.setRating === 'function') {
    return serverMod;
  }

  return {
    setRating(userId, songId, ratingInput, timestamp = Date.now()) {
      const tenths = normalizeAndValidateRating(ratingInput);
      const stmt = db.prepare(`
        INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, song_id)
        DO UPDATE SET rating_tenths = excluded.rating_tenths, rated_at = excluded.rated_at
      `);
      stmt.run(userId, songId, tenths, timestamp);
      return {
        success: true,
        rating_tenths: tenths,
        formatted: formatRatingTenths(tenths)
      };
    },

    deleteRating(userId, songId) {
      const stmt = db.prepare('DELETE FROM ratings WHERE user_id = ? AND song_id = ?');
      stmt.run(userId, songId);
      return {
        success: true,
        unrated: true
      };
    },

    getRating(userId, songId) {
      const stmt = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?');
      const row = stmt.get(userId, songId);
      if (!row || row.rating_tenths === null || row.rating_tenths === undefined) {
        return { rating_tenths: null, formatted: null };
      }
      return {
        rating_tenths: row.rating_tenths,
        formatted: formatRatingTenths(row.rating_tenths)
      };
    },

    getAllRatingsForUser(userId) {
      const stmt = db.prepare(`
        SELECT r.song_id, r.rating_tenths, r.rated_at, s.title, s.artist, s.album
        FROM ratings r
        JOIN songs s ON r.song_id = s.song_id
        WHERE r.user_id = ?
        ORDER BY r.rated_at DESC
      `);
      return stmt.all(userId).map(row => ({
        song_id: row.song_id,
        title: row.title,
        artist: row.artist,
        album: row.album,
        rating_tenths: row.rating_tenths,
        formatted: formatRatingTenths(row.rating_tenths),
        rated_at: row.rated_at
      }));
    }
  };
}

function createAnalyticsService(db) {
  let serverMod = null;
  try {
    const serverPath = path.resolve(__dirname, '../../server/analytics.cjs');
    if (fs.existsSync(serverPath)) {
      serverMod = require(serverPath);
    }
  } catch (e) {}

  if (serverMod) {
    if (typeof serverMod.createAnalyticsService === 'function') {
      return serverMod.createAnalyticsService(db);
    }
    if (typeof serverMod.recordPlaybackEvent === 'function') {
      return serverMod;
    }
  }

  function isQualifiedPlay(duration, listenedDurationSeconds, completionStatus) {
    if (duration < 30) {
      return completionStatus === 'completed' || listenedDurationSeconds >= duration;
    }
    return listenedDurationSeconds >= (duration * 0.8);
  }

  return {
    isQualifiedPlay,

    recordPlaybackEvent(event) {
      const {
        eventId,
        userId,
        songId,
        startedAt = Date.now(),
        listenedDurationSeconds,
        completionStatus
      } = event;

      // 5-second debounce window check for duplicate trigger events
      const debounceStmt = db.prepare(`
        SELECT event_id, started_at
        FROM playback_events
        WHERE user_id = ? AND song_id = ? AND ABS(started_at - ?) < 5000
        LIMIT 1
      `);
      const existing = debounceStmt.get(userId, songId, startedAt);
      if (existing) {
        return {
          recorded: false,
          qualified: false,
          debounced: true,
          event_id: existing.event_id
        };
      }

      // Look up song duration
      const songStmt = db.prepare('SELECT duration FROM songs WHERE song_id = ?');
      const song = songStmt.get(songId);
      const songDuration = song ? song.duration : 180.0;

      const qualified = isQualifiedPlay(songDuration, listenedDurationSeconds, completionStatus);

      const insertStmt = db.prepare(`
        INSERT INTO playback_events (event_id, user_id, song_id, started_at, listened_duration_seconds, completion_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(eventId, userId, songId, startedAt, listenedDurationSeconds, completionStatus);

      return {
        recorded: true,
        qualified,
        debounced: false,
        event_id: eventId
      };
    },

    getListeningStats(userId, window = 'all', now = Date.now()) {
      let timeThreshold = 0;
      if (window === '30d') {
        timeThreshold = now - (30 * 24 * 60 * 60 * 1000);
      } else if (window === '90d') {
        timeThreshold = now - (90 * 24 * 60 * 60 * 1000);
      }

      // Top played songs by qualified play count
      const topSongsStmt = db.prepare(`
        SELECT p.song_id, s.title, s.artist, COUNT(*) as play_count
        FROM playback_events p
        JOIN songs s ON p.song_id = s.song_id
        WHERE p.user_id = ? AND p.started_at >= ?
          AND (
            (s.duration < 30 AND (p.completion_status = 'completed' OR p.listened_duration_seconds >= s.duration))
            OR (s.duration >= 30 AND p.listened_duration_seconds >= (s.duration * 0.8))
          )
        GROUP BY p.song_id, s.title, s.artist
        ORDER BY play_count DESC, p.song_id ASC
      `);
      const top_songs = topSongsStmt.all(userId, timeThreshold);

      // Songs with highest cumulative listening duration
      const topDurationStmt = db.prepare(`
        SELECT p.song_id, s.title, s.artist, SUM(p.listened_duration_seconds) as total_duration_seconds
        FROM playback_events p
        JOIN songs s ON p.song_id = s.song_id
        WHERE p.user_id = ? AND p.started_at >= ?
        GROUP BY p.song_id, s.title, s.artist
        ORDER BY total_duration_seconds DESC, p.song_id ASC
      `);
      const top_duration_songs = topDurationStmt.all(userId, timeThreshold);

      // Chronological playback log
      const logStmt = db.prepare(`
        SELECT p.event_id, p.song_id, s.title, s.artist, p.started_at, p.listened_duration_seconds, p.completion_status,
          CASE WHEN (
            (s.duration < 30 AND (p.completion_status = 'completed' OR p.listened_duration_seconds >= s.duration))
            OR (s.duration >= 30 AND p.listened_duration_seconds >= (s.duration * 0.8))
          ) THEN 1 ELSE 0 END as qualified
        FROM playback_events p
        JOIN songs s ON p.song_id = s.song_id
        WHERE p.user_id = ? AND p.started_at >= ?
        ORDER BY p.started_at DESC
      `);
      const chronological_log = logStmt.all(userId, timeThreshold);

      // Highest and lowest rated songs (strictly separated from playback duration/counts)
      const highestRatedStmt = db.prepare(`
        SELECT r.song_id, s.title, s.artist, r.rating_tenths, (r.rating_tenths / 10.0) as rating, printf('%.1f', r.rating_tenths / 10.0) as formatted
        FROM ratings r
        JOIN songs s ON r.song_id = s.song_id
        WHERE r.user_id = ?
        ORDER BY r.rating_tenths DESC, r.rated_at DESC
        LIMIT 10
      `);
      const lowestRatedStmt = db.prepare(`
        SELECT r.song_id, s.title, s.artist, r.rating_tenths, (r.rating_tenths / 10.0) as rating, printf('%.1f', r.rating_tenths / 10.0) as formatted
        FROM ratings r
        JOIN songs s ON r.song_id = s.song_id
        WHERE r.user_id = ?
        ORDER BY r.rating_tenths ASC, r.rated_at DESC
        LIMIT 10
      `);

      return {
        top_songs,
        top_duration_songs,
        chronological_log,
        rating_stats: {
          highest_rated: highestRatedStmt.all(userId),
          lowest_rated: lowestRatedStmt.all(userId)
        }
      };
    }
  };
}

function createFriendsService(db) {
  let serverMod = null;
  try {
    const serverPath = path.resolve(__dirname, '../../server/friends.cjs');
    if (fs.existsSync(serverPath)) {
      serverMod = require(serverPath);
    }
  } catch (e) {}

  if (serverMod) {
    if (typeof serverMod.createFriendsService === 'function') {
      return serverMod.createFriendsService(db);
    }
    if (typeof serverMod.sendFriendRequest === 'function') {
      return serverMod;
    }
  }

  return {
    sendFriendRequest(requesterId, recipientUsername, now = Date.now()) {
      const userStmt = db.prepare('SELECT user_id FROM users WHERE username = ?');
      const recipient = userStmt.get(recipientUsername);
      if (!recipient) {
        throw new Error(`User not found: ${recipientUsername}`);
      }

      const recipientId = recipient.user_id;
      if (requesterId === recipientId) {
        throw new Error('Cannot friend self');
      }

      // Check existing relationship
      const existingStmt = db.prepare(`
        SELECT requester_id, recipient_id, status
        FROM friendships
        WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
      `);
      const existing = existingStmt.get(requesterId, recipientId, recipientId, requesterId);

      if (existing) {
        if (existing.status === 'accepted') {
          throw new Error('Already friends');
        }
        if (existing.status === 'pending') {
          throw new Error('Friend request already pending');
        }
        // If previously declined or removed, reactivate as pending
        const updateStmt = db.prepare(`
          UPDATE friendships
          SET requester_id = ?, recipient_id = ?, status = 'pending', updated_at = ?
          WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
        `);
        updateStmt.run(requesterId, recipientId, now, requesterId, recipientId, recipientId, requesterId);
        return { requester_id: requesterId, recipient_id: recipientId, status: 'pending', updated_at: now };
      }

      const insertStmt = db.prepare(`
        INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?)
      `);
      insertStmt.run(requesterId, recipientId, now, now);
      return { requester_id: requesterId, recipient_id: recipientId, status: 'pending', created_at: now, updated_at: now };
    },

    respondFriendRequest(userId, requesterOrOtherId, action, now = Date.now()) {
      if (action !== 'accepted' && action !== 'declined') {
        throw new Error(`Invalid friendship response action: ${action}`);
      }

      const updateStmt = db.prepare(`
        UPDATE friendships
        SET status = ?, updated_at = ?
        WHERE (
          (requester_id = ? AND recipient_id = ?) OR
          (requester_id = ? AND recipient_id = ?)
        ) AND status = 'pending'
      `);
      const result = updateStmt.run(action, now, requesterOrOtherId, userId, userId, requesterOrOtherId);
      if (result.changes === 0) {
        throw new Error('No pending friend request found to respond to');
      }
      return { success: true, status: action };
    },

    removeFriend(userId, friendId, now = Date.now()) {
      const updateStmt = db.prepare(`
        UPDATE friendships
        SET status = 'removed', updated_at = ?
        WHERE (
          (requester_id = ? AND recipient_id = ?) OR
          (requester_id = ? AND recipient_id = ?)
        ) AND status = 'accepted'
      `);
      const result = updateStmt.run(now, userId, friendId, friendId, userId);
      return result.changes > 0;
    },

    getFriends(userId) {
      const stmt = db.prepare(`
        SELECT u.user_id, u.username, u.rating_visibility
        FROM friendships f
        JOIN users u ON (CASE WHEN f.requester_id = ? THEN f.recipient_id ELSE f.requester_id END = u.user_id)
        WHERE (f.requester_id = ? OR f.recipient_id = ?) AND f.status = 'accepted'
        ORDER BY u.username ASC
      `);
      return stmt.all(userId, userId, userId);
    },

    checkRatingAccess(targetUserId, requestingUserId) {
      if (targetUserId === requestingUserId) {
        return true;
      }

      const userStmt = db.prepare('SELECT rating_visibility FROM users WHERE user_id = ?');
      const user = userStmt.get(targetUserId);
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
        const friendStmt = db.prepare(`
          SELECT 1 FROM friendships
          WHERE status = 'accepted' AND (
            (requester_id = ? AND recipient_id = ?) OR
            (requester_id = ? AND recipient_id = ?)
          )
        `);
        const friendship = friendStmt.get(targetUserId, requestingUserId, requestingUserId, targetUserId);
        return !!friendship;
      }

      return false;
    }
  };
}

function createComparisonService(db, friendsService, ratingsService) {
  let serverMod = null;
  try {
    const serverPath = path.resolve(__dirname, '../../server/comparison.cjs');
    if (fs.existsSync(serverPath)) {
      serverMod = require(serverPath);
    }
  } catch (e) {}

  if (serverMod && typeof serverMod.compareSong === 'function') {
    return serverMod;
  }

  return {
    compareSong(userAId, userBId, songId) {
      const hasAccess = friendsService.checkRatingAccess(userBId, userAId);
      const rA = ratingsService.getRating(userAId, songId);
      const rB = hasAccess ? ratingsService.getRating(userBId, songId) : { rating_tenths: null, formatted: null };

      if (rA.rating_tenths === null || rB.rating_tenths === null) {
        return {
          user_a_rating: rA.formatted,
          user_b_rating: rB.formatted,
          difference: null
        };
      }

      const diffTenths = Math.abs(rA.rating_tenths - rB.rating_tenths);
      return {
        user_a_rating: rA.formatted,
        user_b_rating: rB.formatted,
        difference: (diffTenths / 10).toFixed(1)
      };
    },

    compareCatalogs(userAId, userBId) {
      const hasAccess = friendsService.checkRatingAccess(userBId, userAId);
      if (!hasAccess) {
        return {
          shared_favorites: [],
          divergence: [],
          discovery: [],
          access_denied: true
        };
      }

      // Shared favorites: both rated >= 8.0 (rating_tenths >= 80)
      const sharedStmt = db.prepare(`
        SELECT s.song_id, s.title, s.artist,
               rA.rating_tenths as user_a_tenths,
               rB.rating_tenths as user_b_tenths,
               printf('%.1f', rA.rating_tenths / 10.0) as user_a_formatted,
               printf('%.1f', rB.rating_tenths / 10.0) as user_b_formatted
        FROM ratings rA
        JOIN ratings rB ON rA.song_id = rB.song_id
        JOIN songs s ON rA.song_id = s.song_id
        WHERE rA.user_id = ? AND rB.user_id = ?
          AND rA.rating_tenths >= 80 AND rB.rating_tenths >= 80
        ORDER BY (rA.rating_tenths + rB.rating_tenths) DESC
      `);
      const shared_favorites = sharedStmt.all(userAId, userBId);

      // Divergence: both rated, sorted by absolute difference DESC
      const divStmt = db.prepare(`
        SELECT s.song_id, s.title, s.artist,
               rA.rating_tenths as user_a_tenths,
               rB.rating_tenths as user_b_tenths,
               printf('%.1f', rA.rating_tenths / 10.0) as user_a_formatted,
               printf('%.1f', rB.rating_tenths / 10.0) as user_b_formatted,
               printf('%.1f', ABS(rA.rating_tenths - rB.rating_tenths) / 10.0) as difference
        FROM ratings rA
        JOIN ratings rB ON rA.song_id = rB.song_id
        JOIN songs s ON rA.song_id = s.song_id
        WHERE rA.user_id = ? AND rB.user_id = ?
        ORDER BY ABS(rA.rating_tenths - rB.rating_tenths) DESC
      `);
      const divergence = divStmt.all(userAId, userBId);

      // Discovery: rated highly by friend (>= 8.0) but unrated by current user
      const discStmt = db.prepare(`
        SELECT s.song_id, s.title, s.artist,
               rB.rating_tenths as friend_tenths,
               printf('%.1f', rB.rating_tenths / 10.0) as friend_formatted
        FROM ratings rB
        JOIN songs s ON rB.song_id = s.song_id
        WHERE rB.user_id = ? AND rB.rating_tenths >= 80
          AND s.song_id NOT IN (SELECT song_id FROM ratings WHERE user_id = ?)
        ORDER BY rB.rating_tenths DESC
      `);
      const discovery = discStmt.all(userBId, userAId);

      return {
        shared_favorites,
        divergence,
        discovery,
        access_denied: false
      };
    }
  };
}

function createSyncService(db) {
  let serverMod = null;
  try {
    const serverPath = path.resolve(__dirname, '../../server/sync.cjs');
    if (fs.existsSync(serverPath)) {
      serverMod = require(serverPath);
    }
  } catch (e) {}

  if (serverMod) {
    if (typeof serverMod.createSyncService === 'function') {
      return serverMod.createSyncService(db);
    }
    if (typeof serverMod.applySyncBatch === 'function') {
      return serverMod;
    }
  }

  return {
    applySyncBatch(targetUserId, payload) {
      if (!payload || !Array.isArray(payload.ratings)) {
        throw new Error('Invalid sync payload: ratings array required');
      }

      let applied = 0;
      let conflictsIgnored = 0;

      for (const item of payload.ratings) {
        const { user_id, song_id, rating_tenths, rated_at, deleted = false } = item;

        // Security check
        if (user_id !== targetUserId) {
          throw new Error(`Sync user mismatch: payload user ${user_id} does not match authenticated user ${targetUserId}`);
        }

        const existingStmt = db.prepare('SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?');
        const existing = existingStmt.get(user_id, song_id);

        if (deleted) {
          if (existing) {
            if (rated_at > existing.rated_at) {
              const delStmt = db.prepare('DELETE FROM ratings WHERE user_id = ? AND song_id = ?');
              delStmt.run(user_id, song_id);
              applied++;
            } else {
              conflictsIgnored++;
            }
          }
        } else {
          const tenths = normalizeAndValidateRating(rating_tenths);
          if (!existing) {
            const insertStmt = db.prepare(`
              INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at)
              VALUES (?, ?, ?, ?)
            `);
            insertStmt.run(user_id, song_id, tenths, rated_at);
            applied++;
          } else {
            // LWW (Last-Write-Wins)
            if (rated_at > existing.rated_at) {
              const updateStmt = db.prepare(`
                UPDATE ratings SET rating_tenths = ?, rated_at = ? WHERE user_id = ? AND song_id = ?
              `);
              updateStmt.run(tenths, rated_at, user_id, song_id);
              applied++;
            } else {
              conflictsIgnored++;
            }
          }
        }
      }

      return {
        success: true,
        applied,
        conflictsIgnored
      };
    }
  };
}

function createRecommendationsService(db, friendsService) {
  let serverMod = null;
  try {
    const serverPath = path.resolve(__dirname, '../../server/recommendations.cjs');
    if (fs.existsSync(serverPath)) {
      serverMod = require(serverPath);
    }
  } catch (e) {}

  if (serverMod && typeof serverMod.createRecommendationsService === 'function') {
    return serverMod.createRecommendationsService(db, friendsService);
  }
  if (serverMod && typeof serverMod.getRecommendedTracks === 'function') {
    return serverMod;
  }

  return {
    getRecommendedTracks(userId, baseRecommendations = []) {
      // 1. High-rating boost: find artists user rated >= 8.5 (rating_tenths >= 85)
      const highRatedStmt = db.prepare(`
        SELECT DISTINCT s.artist, MAX(r.rating_tenths) as max_tenths
        FROM ratings r
        JOIN songs s ON r.song_id = s.song_id
        WHERE r.user_id = ? AND r.rating_tenths >= 85
        GROUP BY s.artist
        ORDER BY max_tenths DESC
      `);
      const boostedArtists = highRatedStmt.all(userId).map(r => r.artist);

      // 2. Friend recommendations shelf: tracks rated >= 8.5 by accepted friends that user has not heard
      const friends = friendsService.getFriends(userId);
      const friendIds = friends.map(f => f.user_id);

      let friendRecommendations = [];
      if (friendIds.length > 0) {
        const placeholders = friendIds.map(() => '?').join(',');
        const friendRecsStmt = db.prepare(`
          SELECT DISTINCT s.song_id, s.title, s.artist, s.album,
                 r.rating_tenths as friend_tenths,
                 printf('%.1f', r.rating_tenths / 10.0) as friend_rating,
                 u.username as friend_username
          FROM ratings r
          JOIN songs s ON r.song_id = s.song_id
          JOIN users u ON r.user_id = u.user_id
          WHERE r.user_id IN (${placeholders})
            AND r.rating_tenths >= 85
            AND s.song_id NOT IN (SELECT song_id FROM ratings WHERE user_id = ?)
            AND s.song_id NOT IN (SELECT song_id FROM playback_events WHERE user_id = ?)
          ORDER BY r.rating_tenths DESC
          LIMIT 20
        `);
        friendRecommendations = friendRecsStmt.all(...friendIds, userId, userId);
      }

      // Re-rank base recommendations: boost boostedArtists to top
      const boostedRecommendations = [...baseRecommendations].sort((a, b) => {
        const aBoost = boostedArtists.includes(a.artist) ? 1 : 0;
        const bBoost = boostedArtists.includes(b.artist) ? 1 : 0;
        return bBoost - aBoost;
      });

      return {
        boostedArtists,
        recommendations: boostedRecommendations,
        friendRecommendations
      };
    }
  };
}

module.exports = {
  SCHEMA_DDL,
  createTestDb,
  normalizeAndValidateRating,
  formatRatingTenths,
  seedUser,
  seedSong,
  seedRating,
  seedFriendship,
  seedPlaybackEvent,
  createRatingsService,
  createAnalyticsService,
  createFriendsService,
  createComparisonService,
  createSyncService,
  createRecommendationsService,
  createSharingService: (db) => require('../../server/sharing.cjs').createSharingService(db)
};
