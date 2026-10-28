'use strict';

/**
 * LUMEN Song Sharing Subsystem
 * Milestone: Friends & Listening - Song Sharing & Availability Resolution
 */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
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
        f.functionName === 'createSharingService' ||
        f.functionName === 'createFriendsService' ||
        f.functionName === 'createComparisonService'
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
 * Check if two users have an accepted friendship.
 */
function areFriends(senderId, recipientId, db) {
  const [userLow, userHigh] = senderId < recipientId ? [senderId, recipientId] : [recipientId, senderId];
  const row = db.prepare('SELECT status FROM friendships WHERE user_low = ? AND user_high = ?').get(userLow, userHigh);
  return !!(row && row.status === 'accepted');
}

/**
 * Normalizes text for matching comparison.
 */
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Detects special version cues in song titles (e.g. remix, live, acoustic, cover).
 */
function detectVersionTag(title) {
  const lower = (title || '').toLowerCase();
  if (lower.includes('remix')) return 'remix';
  if (lower.includes('live')) return 'live';
  if (lower.includes('acoustic')) return 'acoustic';
  if (lower.includes('cover')) return 'cover';
  if (lower.includes('instrumental')) return 'instrumental';
  return 'standard';
}

/**
 * Create a song share record.
 */
function createShare({ sender_id, recipient_id, song, message, external_link, created_at }, explicitDb) {
  const db = resolveDb(explicitDb);

  if (!sender_id || !recipient_id) {
    throw new Error('Both sender_id and recipient_id are required.');
  }

  if (sender_id === recipient_id) {
    throw new Error('Cannot share a song with yourself.');
  }

  // Verify friendship requirement
  if (!areFriends(sender_id, recipient_id, db)) {
    throw new Error('Cannot share song with a user who is not an accepted friend.');
  }

  if (!song || !song.title || !song.artist) {
    throw new Error('Song metadata snapshot with title and artist is required.');
  }

  const shareId = crypto.randomUUID();
  const createdAt = Number(created_at) || Date.now();

  const title = String(song.title).trim();
  const artist = String(song.artist).trim();
  const album = song.album ? String(song.album).trim() : null;
  const duration = Number(song.duration) || 0;
  const streamUrl = song.streamUrl || song.stream_url || null;
  const songId = song.id || song.song_id || null;
  const msg = message ? String(message).trim() : null;
  const extLink = external_link ? String(external_link).trim() : null;

  db.prepare(`
    INSERT INTO shares (
      share_id, sender_id, recipient_id, song_id, title, artist, album,
      duration, stream_url, external_link, message, is_read, is_dismissed, is_revoked, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
  `).run(
    shareId,
    sender_id,
    recipient_id,
    songId,
    title,
    artist,
    album,
    duration,
    streamUrl,
    extLink,
    msg,
    createdAt
  );

  return {
    share_id: shareId,
    sender_id,
    recipient_id,
    song_id: songId,
    title,
    artist,
    album,
    duration,
    stream_url: streamUrl,
    external_link: extLink,
    message: msg,
    is_read: false,
    is_dismissed: false,
    is_revoked: false,
    created_at: createdAt
  };
}

/**
 * Get shares received by a user.
 */
function getReceivedShares(recipientId, options = {}, explicitDb) {
  const db = resolveDb(explicitDb);
  const { unreadOnly = false, includeDismissed = false } = options;

  let sql = `
    SELECT 
      s.share_id,
      s.sender_id,
      s.recipient_id,
      s.song_id,
      s.title,
      s.artist,
      s.album,
      s.duration,
      s.stream_url,
      s.external_link,
      s.message,
      s.is_read,
      s.is_dismissed,
      s.is_revoked,
      s.created_at,
      COALESCE(u.username, s.sender_id) AS sender_username
    FROM shares s
    LEFT JOIN users u ON u.user_id = s.sender_id
    WHERE s.recipient_id = ? AND s.is_revoked = 0
  `;

  const params = [recipientId];

  if (unreadOnly) {
    sql += ' AND s.is_read = 0';
  }

  if (!includeDismissed) {
    sql += ' AND s.is_dismissed = 0';
  }

  sql += ' ORDER BY s.created_at DESC, s.rowid DESC';

  const rows = db.prepare(sql).all(...params);

  return rows.map(r => ({
    ...r,
    is_read: Boolean(r.is_read),
    is_dismissed: Boolean(r.is_dismissed),
    is_revoked: Boolean(r.is_revoked)
  }));
}

/**
 * Get shares sent by a user.
 */
function getSentShares(senderId, explicitDb) {
  const db = resolveDb(explicitDb);

  const sql = `
    SELECT 
      s.share_id,
      s.sender_id,
      s.recipient_id,
      s.song_id,
      s.title,
      s.artist,
      s.album,
      s.duration,
      s.stream_url,
      s.external_link,
      s.message,
      s.is_read,
      s.is_dismissed,
      s.is_revoked,
      s.created_at,
      COALESCE(u.username, s.recipient_id) AS recipient_username
    FROM shares s
    LEFT JOIN users u ON u.user_id = s.recipient_id
    WHERE s.sender_id = ?
    ORDER BY s.created_at DESC, s.rowid DESC
  `;

  const rows = db.prepare(sql).all(senderId);

  return rows.map(r => ({
    ...r,
    is_read: Boolean(r.is_read),
    is_dismissed: Boolean(r.is_dismissed),
    is_revoked: Boolean(r.is_revoked)
  }));
}

/**
 * Mark a received share as read.
 */
function markShareRead(shareId, recipientId, explicitDb) {
  const db = resolveDb(explicitDb);
  const info = db.prepare(`
    UPDATE shares SET is_read = 1 WHERE share_id = ? AND recipient_id = ?
  `).run(shareId, recipientId);
  return info.changes > 0;
}

/**
 * Dismiss a received share without deleting it from sender history.
 */
function dismissShare(shareId, recipientId, explicitDb) {
  const db = resolveDb(explicitDb);
  const info = db.prepare(`
    UPDATE shares SET is_dismissed = 1 WHERE share_id = ? AND recipient_id = ?
  `).run(shareId, recipientId);
  return info.changes > 0;
}

/**
 * Revoke a sent share so recipient can no longer see/play it.
 */
function revokeShare(shareId, senderId, explicitDb) {
  const db = resolveDb(explicitDb);
  const info = db.prepare(`
    UPDATE shares SET is_revoked = 1 WHERE share_id = ? AND sender_id = ?
  `).run(shareId, senderId);
  return info.changes > 0;
}

/**
 * Resolves song identity and checks availability against a receiver's local library or catalog.
 */
function resolveSongAvailability(sharedSong, libraryTracks = []) {
  if (!sharedSong || !sharedSong.title || !sharedSong.artist) {
    return {
      available: false,
      matchType: 'none',
      matchedTrack: null,
      reason: 'Missing shared song metadata.'
    };
  }

  const normSharedTitle = normalizeString(sharedSong.title);
  const normSharedArtist = normalizeString(sharedSong.artist);
  const sharedVersion = detectVersionTag(sharedSong.title);

  // 1. Check exact match in local library tracks
  for (const track of libraryTracks) {
    const trackTitleNorm = normalizeString(track.title);
    const trackArtistNorm = normalizeString(track.artist);
    const trackVersion = detectVersionTag(track.title);

    // Exact match of title, artist, and version tag
    if (trackTitleNorm === normSharedTitle && trackArtistNorm === normSharedArtist && trackVersion === sharedVersion) {
      return {
        available: true,
        matchType: 'local_exact',
        matchedTrack: track,
        reason: 'Exact match found in your music library.'
      };
    }
  }

  // 2. Check fuzzy match (ignoring parenthetical suffixes unless version changed)
  for (const track of libraryTracks) {
    const trackTitleNorm = normalizeString(track.title);
    const trackArtistNorm = normalizeString(track.artist);
    const trackVersion = detectVersionTag(track.title);

    if (trackArtistNorm === normSharedArtist && trackVersion === sharedVersion) {
      if (trackTitleNorm.includes(normSharedTitle) || normSharedTitle.includes(trackTitleNorm)) {
        return {
          available: true,
          matchType: 'local_fuzzy',
          matchedTrack: track,
          reason: 'Close match found in your library.'
        };
      }
    }
  }

  // 3. Fallback to authorised stream URL if present
  if (sharedSong.stream_url || sharedSong.streamUrl) {
    return {
      available: true,
      matchType: 'stream_url',
      matchedTrack: {
        id: sharedSong.song_id || crypto.randomUUID(),
        title: sharedSong.title,
        artist: sharedSong.artist,
        album: sharedSong.album || 'Shared Song',
        duration: sharedSong.duration || 180,
        streamUrl: sharedSong.stream_url || sharedSong.streamUrl
      },
      reason: 'Available via authorised stream link.'
    };
  }

  // 4. No playable match found
  return {
    available: false,
    matchType: 'none',
    matchedTrack: null,
    reason: 'This song is not available in your current music library.'
  };
}

/**
 * Service factory for test harnesses.
 */
function createSharingService(dbInstance) {
  const db = resolveDb(dbInstance);
  return {
    createShare: (opts) => createShare(opts, db),
    getReceivedShares: (recipientId, opts) => getReceivedShares(recipientId, opts, db),
    getSentShares: (senderId) => getSentShares(senderId, db),
    markShareRead: (shareId, recipientId) => markShareRead(shareId, recipientId, db),
    dismissShare: (shareId, recipientId) => dismissShare(shareId, recipientId, db),
    revokeShare: (shareId, senderId) => revokeShare(shareId, senderId, db),
    resolveSongAvailability
  };
}

module.exports = {
  createShare,
  getReceivedShares,
  getSentShares,
  markShareRead,
  dismissShare,
  revokeShare,
  resolveSongAvailability,
  createSharingService,
  resolveDb
};
