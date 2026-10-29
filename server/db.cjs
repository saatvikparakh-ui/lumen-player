'use strict';

/**
 * LUMEN SQLite Datastore & Data Access Layer
 * Milestone 1 - Native node:sqlite DatabaseSync implementation
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'lumen.db');

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  rating_visibility TEXT NOT NULL DEFAULT 'friends' CHECK(rating_visibility IN ('public', 'friends', 'private')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  song_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration REAL NOT NULL,
  metadata_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  rating_tenths INTEGER NOT NULL CHECK(rating_tenths BETWEEN 1 AND 100),
  rated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, song_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  requester_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  user_low TEXT GENERATED ALWAYS AS (CASE WHEN requester_id < recipient_id THEN requester_id ELSE recipient_id END) STORED,
  user_high TEXT GENERATED ALWAYS AS (CASE WHEN requester_id < recipient_id THEN recipient_id ELSE requester_id END) STORED,
  CHECK (requester_id <> recipient_id),
  UNIQUE (user_low, user_high)
);

CREATE TABLE IF NOT EXISTS playback_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  listened_duration_seconds REAL NOT NULL,
  completion_status TEXT NOT NULL CHECK(completion_status IN ('completed', 'uncompleted', 'skipped', 'paused'))
);

CREATE INDEX IF NOT EXISTS idx_playback_user_time ON playback_events(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_playback_user_song_time ON playback_events(user_id, song_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_playback_song ON playback_events(song_id);
CREATE INDEX IF NOT EXISTS idx_ratings_song ON ratings(song_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_tenths ON ratings(user_id, rating_tenths DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_user_time ON ratings(user_id, rated_at DESC);
CREATE INDEX IF NOT EXISTS idx_friendships_user_status ON friendships(user_low, user_high, status);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_recipient ON friendships(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_fingerprint ON songs(metadata_fingerprint);

CREATE TABLE IF NOT EXISTS search_cache (
  query_key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artwork_cache (
  cache_key TEXT PRIMARY KEY,
  artwork_url TEXT NOT NULL,
  source TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_discography_cache (
  artist_norm TEXT PRIMARY KEY,
  discography_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS album_cache (
  album_id TEXT PRIMARY KEY,
  album_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS user_exclusions (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('artist', 'song')),
  entity_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, entity_type, entity_name)
);
CREATE INDEX IF NOT EXISTS idx_exclusions_user ON user_exclusions(user_id);
`;

let dbInstance = null;
let currentDbPath = null;
const statementCache = new Map();

/**
 * Universal parameter extraction helper.
 * Handles:
 * - Empty args: []
 * - Single array: ['u1', 'alice'] -> positional spread
 * - Varargs: ('u1', 'alice') -> positional spread
 * - Named object: ({ id: 'u1', name: 'alice' }) -> named object passed directly
 * - Scalar values: (42), ('text'), (null)
 */
function extractParams(args) {
  if (args.length === 0) {
    return { isNamed: false, params: [] };
  }
  if (args.length === 1) {
    const first = args[0];
    if (first === undefined) {
      return { isNamed: false, params: [] };
    }
    if (Array.isArray(first)) {
      return { isNamed: false, params: first };
    }
    if (
      first !== null &&
      typeof first === 'object' &&
      !(first instanceof Date) &&
      !(first instanceof Uint8Array) &&
      !Buffer.isBuffer(first)
    ) {
      return { isNamed: true, params: first };
    }
    return { isNamed: false, params: [first] };
  }
  return { isNamed: false, params: args };
}

/**
 * Executes a write statement on a specific database instance.
 * @param {DatabaseSync} db
 * @param {string} sql
 * @param {...any} params
 * @returns {{ changes: number, lastInsertRowid: number | bigint }}
 */
function runOnDb(db, sql, ...params) {
  let stmt = db._statementCache ? db._statementCache.get(sql) : null;
  if (!stmt) {
    stmt = db.prepare(sql);
    if (!db._statementCache) {
      db._statementCache = new Map();
    }
    db._statementCache.set(sql, stmt);
  }
  const { isNamed, params: p } = extractParams(params);
  try {
    return isNamed ? stmt.run(p) : stmt.run(...p);
  } catch (err) {
    err.sql = sql;
    err.params = params;
    throw err;
  }
}

/**
 * Queries a single row on a specific database instance.
 * @param {DatabaseSync} db
 * @param {string} sql
 * @param {...any} params
 * @returns {any | undefined}
 */
function getOnDb(db, sql, ...params) {
  let stmt = db._statementCache ? db._statementCache.get(sql) : null;
  if (!stmt) {
    stmt = db.prepare(sql);
    if (!db._statementCache) {
      db._statementCache = new Map();
    }
    db._statementCache.set(sql, stmt);
  }
  const { isNamed, params: p } = extractParams(params);
  try {
    return isNamed ? stmt.get(p) : stmt.get(...p);
  } catch (err) {
    err.sql = sql;
    err.params = params;
    throw err;
  }
}

/**
 * Queries all matching rows on a specific database instance.
 * @param {DatabaseSync} db
 * @param {string} sql
 * @param {...any} params
 * @returns {Array<any>}
 */
function allOnDb(db, sql, ...params) {
  let stmt = db._statementCache ? db._statementCache.get(sql) : null;
  if (!stmt) {
    stmt = db.prepare(sql);
    if (!db._statementCache) {
      db._statementCache = new Map();
    }
    db._statementCache.set(sql, stmt);
  }
  const { isNamed, params: p } = extractParams(params);
  try {
    return isNamed ? stmt.all(p) : stmt.all(...p);
  } catch (err) {
    err.sql = sql;
    err.params = params;
    throw err;
  }
}

/**
 * Initializes the SQLite database connection, applies Pragmas, creates directory if needed, and executes DDL.
 * @param {string} [filePath] Optional custom file path or ':memory:'
 * @returns {DatabaseSync} Connected database singleton instance
 */
function initDb(filePath) {
  const targetPath = filePath || process.env.LUMEN_DB_PATH || DEFAULT_DB_PATH;

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    closeDb();
  }

  const isMemory = targetPath === ':memory:' || targetPath.startsWith('file::memory:');
  if (!isMemory) {
    const resolvedPath = path.resolve(targetPath);
    const dbDir = path.dirname(resolvedPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);

  // Critical SQLite Pragmas
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  if (!isMemory) {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }

  // Run full relational schema DDL and indexes
  db.exec(SCHEMA_DDL);

  // Schema migration: ensure playback_events supports 'paused'
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='playback_events'").get();
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'paused'") && tableInfo.sql.includes("CHECK(completion_status")) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS playback_events_new (
          event_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
          song_id TEXT NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
          started_at INTEGER NOT NULL,
          listened_duration_seconds REAL NOT NULL,
          completion_status TEXT NOT NULL CHECK(completion_status IN ('completed', 'uncompleted', 'skipped', 'paused'))
        );
        INSERT INTO playback_events_new SELECT * FROM playback_events;
        DROP TABLE playback_events;
        ALTER TABLE playback_events_new RENAME TO playback_events;
        CREATE INDEX IF NOT EXISTS idx_playback_user_time ON playback_events(user_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_playback_user_song_time ON playback_events(user_id, song_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_playback_song ON playback_events(song_id);
      `);
    }
  } catch (_) {}

  db._statementCache = statementCache;
  dbInstance = db;
  currentDbPath = targetPath;
  return dbInstance;
}

/**
 * Returns the current database singleton instance, initializing default if needed.
 * @returns {DatabaseSync}
 */
function getDb() {
  if (!dbInstance) {
    initDb();
  }
  return dbInstance;
}

/**
 * Safely closes the database connection and resets singleton state.
 */
function closeDb() {
  if (dbInstance) {
    if (dbInstance._statementCache) {
      dbInstance._statementCache.clear();
    }
    statementCache.clear();
    try {
      dbInstance.close();
    } catch (_) {}
    dbInstance = null;
    currentDbPath = null;
  }
}

/**
 * Resets the database connection (closes current and initializes fresh path).
 * @param {string} [filePath=':memory:']
 * @returns {DatabaseSync}
 */
function resetDb(filePath = ':memory:') {
  closeDb();
  return initDb(filePath);
}

/**
 * Injects an existing or mock database instance into the singleton.
 * @param {DatabaseSync} customDb
 * @returns {DatabaseSync}
 */
function setDb(customDb) {
  if (dbInstance && dbInstance !== customDb) {
    closeDb();
  }
  dbInstance = customDb;
  return dbInstance;
}

/**
 * Executes a write query (INSERT, UPDATE, DELETE) against the database singleton.
 * Supports array of params or varargs.
 * @param {string} sql
 * @param {...any} params
 * @returns {{ changes: number, lastInsertRowid: number | bigint }}
 */
function run(sql, ...params) {
  return runOnDb(getDb(), sql, ...params);
}

/**
 * Executes a query and returns a single row or undefined.
 * Supports array of params or varargs.
 * @param {string} sql
 * @param {...any} params
 * @returns {any | undefined}
 */
function get(sql, ...params) {
  return getOnDb(getDb(), sql, ...params);
}

/**
 * Executes a query and returns all matching rows as an array.
 * Supports array of params or varargs.
 * @param {string} sql
 * @param {...any} params
 * @returns {Array<any>}
 */
function all(sql, ...params) {
  return allOnDb(getDb(), sql, ...params);
}

/**
 * Executes callback inside an immediate transaction with savepoint nesting for child transactions.
 * Supports both withTransaction(fn) and withTransaction(db, fn).
 * @param {DatabaseSync | Function} targetDbOrFn
 * @param {Function} [maybeFn]
 * @returns {any} Result of callback function
 */
function withTransaction(targetDbOrFn, maybeFn) {
  let db;
  let fn;
  if (typeof targetDbOrFn === 'function') {
    db = getDb();
    fn = targetDbOrFn;
  } else if (typeof maybeFn === 'function') {
    db = targetDbOrFn || getDb();
    fn = maybeFn;
  } else {
    throw new TypeError('withTransaction requires a callback function');
  }

  if (!db._txnDepth) {
    db._txnDepth = 0;
  }

  const isTop = db._txnDepth === 0;
  const savepointName = 'sp_' + db._txnDepth;
  db._txnDepth++;

  if (isTop) {
    db.exec('BEGIN IMMEDIATE');
  } else {
    db.exec('SAVEPOINT ' + savepointName);
  }

  try {
    const result = fn(db);
    if (isTop) {
      db.exec('COMMIT');
    } else {
      db.exec('RELEASE SAVEPOINT ' + savepointName);
    }
    return result;
  } catch (err) {
    if (isTop) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {}
    } else {
      try {
        db.exec('ROLLBACK TO SAVEPOINT ' + savepointName);
      } catch (_) {}
      try {
        db.exec('RELEASE SAVEPOINT ' + savepointName);
      } catch (_) {}
    }
    throw err;
  } finally {
    db._txnDepth--;
  }
}

/**
 * Creates an independent, fully migrated in-memory database (:memory:) for isolated unit testing.
 * @returns {DatabaseSync}
 */
function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA_DDL);

  db.run = (sql, ...params) => runOnDb(db, sql, ...params);
  db.get = (sql, ...params) => getOnDb(db, sql, ...params);
  db.all = (sql, ...params) => allOnDb(db, sql, ...params);
  db.withTransaction = (fnOrTarget, maybeFn) => {
    if (typeof fnOrTarget === 'function') {
      return withTransaction(db, fnOrTarget);
    }
    return withTransaction(fnOrTarget, maybeFn);
  };

  return db;
}

/**
 * Translates raw SQLite errors into categorized domain structures with HTTP status codes.
 * @param {Error} err
 * @returns {{ type: string, statusCode: number, message: string, retryable: boolean }}
 */
function categorizeDbError(err) {
  if (!err) return { type: 'NONE', statusCode: 200, message: '', retryable: false };
  const errcode = typeof err.errcode === 'number' ? err.errcode : 0;
  const primaryCode = errcode & 0xff;
  const msg = err.message || '';

  if (primaryCode === 5 || primaryCode === 6 || msg.includes('database is locked')) {
    return {
      type: 'BUSY_LOCK',
      statusCode: 503,
      message: 'Database is currently busy; please retry.',
      retryable: true
    };
  }

  if (primaryCode === 19 || msg.includes('constraint failed')) {
    if (errcode === 275 || msg.includes('CHECK constraint failed')) {
      return {
        type: 'CHECK_VIOLATION',
        statusCode: 400,
        message: 'Invalid input: constraint violation: ' + msg,
        retryable: false
      };
    }
    if (errcode === 2067 || errcode === 1555 || msg.includes('UNIQUE constraint failed')) {
      return {
        type: 'UNIQUE_VIOLATION',
        statusCode: 409,
        message: 'Conflict: unique constraint failed: ' + msg,
        retryable: false
      };
    }
    if (errcode === 787 || msg.includes('FOREIGN KEY constraint failed')) {
      return {
        type: 'FOREIGN_KEY_VIOLATION',
        statusCode: 404,
        message: 'Not found: referenced entity does not exist.',
        retryable: false
      };
    }
    return {
      type: 'CONSTRAINT_VIOLATION',
      statusCode: 400,
      message: msg,
      retryable: false
    };
  }

  return {
    type: 'UNKNOWN_DB_ERROR',
    statusCode: 500,
    message: 'An unexpected database error occurred.',
    retryable: false
  };
}

function getCachedSearch(key) {
  try {
    const row = get('SELECT result_json FROM search_cache WHERE query_key = ?', key);
    return row ? JSON.parse(row.result_json) : null;
  } catch (_) {
    return null;
  }
}

function setCachedSearch(key, data) {
  try {
    run(
      'INSERT INTO search_cache (query_key, result_json, created_at) VALUES (?, ?, ?) ON CONFLICT(query_key) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at',
      key,
      JSON.stringify(data),
      Date.now()
    );
  } catch (_) {}
}

function getCachedArtwork(key) {
  try {
    const row = get('SELECT artwork_url FROM artwork_cache WHERE cache_key = ?', key);
    return row ? row.artwork_url : null;
  } catch (_) {
    return null;
  }
}

function setCachedArtwork(key, url, source = 'apple') {
  if (!url) return;
  try {
    run(
      'INSERT INTO artwork_cache (cache_key, artwork_url, source, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET artwork_url = excluded.artwork_url, source = excluded.source, created_at = excluded.created_at',
      key,
      url,
      source,
      Date.now()
    );
  } catch (_) {}
}

function getCachedArtist(normName) {
  try {
    const row = get('SELECT discography_json FROM artist_discography_cache WHERE artist_norm = ?', normName);
    return row ? JSON.parse(row.discography_json) : null;
  } catch (_) {
    return null;
  }
}

function setCachedArtist(normName, discography) {
  if (!normName || !discography) return;
  try {
    run(
      'INSERT INTO artist_discography_cache (artist_norm, discography_json, created_at) VALUES (?, ?, ?) ON CONFLICT(artist_norm) DO UPDATE SET discography_json = excluded.discography_json, created_at = excluded.created_at',
      normName,
      JSON.stringify(discography),
      Date.now()
    );
  } catch (_) {}
}

function getCachedAlbum(albumId) {
  if (!albumId) return null;
  try {
    const row = get('SELECT album_json FROM album_cache WHERE album_id = ?', String(albumId));
    return row ? JSON.parse(row.album_json) : null;
  } catch (_) {
    return null;
  }
}

function setCachedAlbum(albumId, albumData) {
  if (!albumId || !albumData) return;
  try {
    run(
      'INSERT INTO album_cache (album_id, album_json, created_at) VALUES (?, ?, ?) ON CONFLICT(album_id) DO UPDATE SET album_json = excluded.album_json, created_at = excluded.created_at',
      String(albumId),
      JSON.stringify(albumData),
      Date.now()
    );
  } catch (_) {}
}

function addExclusion(userId, entityType, entityName, db = null) {
  if (!userId || !entityType || !entityName) return false;
  const activeDb = db || getDb();
  try {
    // Ensure user row exists to satisfy foreign key
    activeDb.prepare(`INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)`).run(userId, userId, Date.now());
    activeDb.prepare(`
      INSERT INTO user_exclusions (user_id, entity_type, entity_name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, entity_type, entity_name) DO NOTHING
    `).run(userId, entityType, entityName.trim(), Date.now());
    return true;
  } catch (_) {
    return false;
  }
}

function removeExclusion(userId, entityType, entityName, db = null) {
  if (!userId || !entityType || !entityName) return false;
  const activeDb = db || getDb();
  try {
    activeDb.prepare(`
      DELETE FROM user_exclusions
      WHERE user_id = ? AND entity_type = ? AND entity_name = ?
    `).run(userId, entityType, entityName.trim());
    return true;
  } catch (_) {
    return false;
  }
}

function getExclusions(userId, db = null) {
  if (!userId) return [];
  const activeDb = db || getDb();
  try {
    return activeDb.prepare(`
      SELECT entity_type, entity_name, created_at
      FROM user_exclusions
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);
  } catch (_) {
    return [];
  }
}

function isExcluded(userId, artist, title, db = null) {
  if (!userId) return false;
  const activeDb = db || getDb();
  try {
    const art = (artist || '').toLowerCase().trim();
    const tit = (title || '').toLowerCase().trim();
    const rows = activeDb.prepare(`
      SELECT entity_type, LOWER(entity_name) as entity_name
      FROM user_exclusions
      WHERE user_id = ?
    `).all(userId);
    for (const r of rows) {
      if (r.entity_type === 'artist' && art && art === r.entity_name) return true;
      if (r.entity_type === 'song' && tit && tit === r.entity_name) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

// =========================================================================
// USER PROFILES & UNIQUE USERNAME MANAGEMENT
// =========================================================================

function getUserByUserId(userId, db = null) {
  if (!userId) return null;
  const activeDb = db || getDb();
  try {
    return activeDb.prepare(`
      SELECT user_id, username, rating_visibility, created_at
      FROM users
      WHERE user_id = ?
    `).get(userId);
  } catch (_) {
    return null;
  }
}

function getUserByUsername(username, db = null) {
  if (!username) return null;
  const clean = username.replace(/^@/, '').trim();
  const activeDb = db || getDb();
  try {
    return activeDb.prepare(`
      SELECT user_id, username, rating_visibility, created_at
      FROM users
      WHERE username = ? COLLATE NOCASE
    `).get(clean);
  } catch (_) {
    return null;
  }
}

function isUsernameAvailable(username, excludeUserId = null, db = null) {
  if (!username) return false;
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) return false;

  const activeDb = db || getDb();
  try {
    if (excludeUserId) {
      const existing = activeDb.prepare(`
        SELECT user_id FROM users
        WHERE username = ? COLLATE NOCASE AND user_id != ?
      `).get(clean, excludeUserId);
      return !existing;
    } else {
      const existing = activeDb.prepare(`
        SELECT user_id FROM users
        WHERE username = ? COLLATE NOCASE
      `).get(clean);
      return !existing;
    }
  } catch (_) {
    return false;
  }
}

function updateUserUsername(userId, newUsername, db = null) {
  if (!userId) return { success: false, error: 'User ID is required' };
  const clean = (newUsername || '').replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
    return { success: false, error: 'Username must be 3-20 characters and contain only lowercase letters, numbers, and underscores.' };
  }

  const activeDb = db || getDb();
  try {
    // Check if taken by someone else
    const existing = activeDb.prepare(`
      SELECT user_id FROM users
      WHERE username = ? COLLATE NOCASE AND user_id != ?
    `).get(clean, userId);

    if (existing) {
      return { success: false, error: `Username @${clean} is already taken by another listener.` };
    }

    const user = activeDb.prepare(`SELECT user_id FROM users WHERE user_id = ?`).get(userId);
    if (user) {
      activeDb.prepare(`
        UPDATE users
        SET username = ?
        WHERE user_id = ?
      `).run(clean, userId);
    } else {
      activeDb.prepare(`
        INSERT INTO users (user_id, username, rating_visibility, created_at)
        VALUES (?, ?, 'friends', ?)
      `).run(userId, clean, Date.now());
    }

    return { success: true, username: clean };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function searchUsersByPrefix(query, excludeUserId = null, limit = 10, db = null) {
  if (!query) return [];
  const clean = query.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return [];

  const activeDb = db || getDb();
  try {
    const pattern = `${clean}%`;
    if (excludeUserId) {
      return activeDb.prepare(`
        SELECT user_id, username, rating_visibility, created_at
        FROM users
        WHERE username LIKE ? AND user_id != ?
        ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, username ASC
        LIMIT ?
      `).all(pattern, excludeUserId, clean, limit);
    } else {
      return activeDb.prepare(`
        SELECT user_id, username, rating_visibility, created_at
        FROM users
        WHERE username LIKE ?
        ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, username ASC
        LIMIT ?
      `).all(pattern, clean, limit);
    }
  } catch (_) {
    return [];
  }
}

module.exports = {
  // Connection & Singleton management
  initDb,
  getDb,
  closeDb,
  resetDb,
  setDb,

  // Cache API
  getCachedSearch,
  setCachedSearch,
  getCachedArtwork,
  setCachedArtwork,
  getCachedArtist,
  setCachedArtist,
  getCachedAlbum,
  setCachedAlbum,

  // Exclusions API
  addExclusion,
  removeExclusion,
  getExclusions,
  isExcluded,

  // User Profiles & Unique Usernames API
  getUserByUserId,
  getUserByUsername,
  isUsernameAvailable,
  updateUserUsername,
  searchUsersByPrefix,

  // Query Execution API
  run,
  get,
  all,
  execute: run,
  query: all,
  queryRow: get,

  // Transactions & Testing
  withTransaction,
  createTestDb,

  // Error categorization & constants
  categorizeDbError,
  DEFAULT_DB_PATH,
  SCHEMA_DDL
};
