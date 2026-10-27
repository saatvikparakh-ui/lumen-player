'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dbMod = require('../server/db.cjs');
const friendsMod = require('../server/friends.cjs');
const syncMod = require('../server/sync.cjs');

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function randomUsername() {
  return `user_${crypto.randomBytes(6).toString('hex')}`;
}

function runAdversarialAudit() {
  console.log('--- STARTING ADVERSARIAL INTEGRITY VERIFICATION ---');

  // Test 1: Fresh in-memory DB with dynamic random entities
  const db = dbMod.createTestDb();
  const friends = friendsMod.createFriendsService(db);
  const sync = syncMod.createSyncService(db);

  // Generate 10 random users
  const users = [];
  for (let i = 0; i < 10; i++) {
    const u = {
      user_id: randomId('u'),
      username: randomUsername(),
      rating_visibility: 'friends',
      created_at: 1700000000000 + i * 1000
    };
    db.run(
      'INSERT INTO users (user_id, username, rating_visibility, created_at) VALUES (?, ?, ?, ?)',
      u.user_id, u.username, u.rating_visibility, u.created_at
    );
    users.push(u);
  }

  // 1. Dynamic Friendship Lifecycle Verification
  console.log('[Check 1] Dynamic Friendship Lifecycle with Random Users');
  const u1 = users[0];
  const u2 = users[1];
  const u3 = users[2];

  // Send request
  const reqRes = friends.sendFriendRequest(u1.user_id, u2.username);
  assert.equal(reqRes.requester_id, u1.user_id);
  assert.equal(reqRes.recipient_id, u2.user_id);
  assert.equal(reqRes.status, 'pending');

  // Verify directly from SQLite table
  const rowInDb = db.get(
    'SELECT * FROM friendships WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)',
    u1.user_id, u2.user_id, u2.user_id, u1.user_id
  );
  assert.ok(rowInDb, 'Friendship row must exist in SQLite database');
  assert.equal(rowInDb.status, 'pending');

  // Bidirectional constraint verification: Cannot insert duplicate reversed pair directly
  assert.throws(() => {
    db.run(
      'INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      u2.user_id, u1.user_id, 'pending', Date.now(), Date.now()
    );
  }, /UNIQUE constraint failed/);

  // Self-friendship rejection verification
  assert.throws(() => {
    friends.sendFriendRequest(u1.user_id, u1.username);
  }, /Cannot friend self/);

  // Non-existent username rejection verification
  const fakeUsername = randomUsername() + '_nonexistent';
  assert.throws(() => {
    friends.sendFriendRequest(u1.user_id, fakeUsername);
  }, /User not found/);

  // Non-existent relationship cannot respond
  assert.throws(() => {
    friends.respondFriendRequest(u3.user_id, u1.user_id, 'accepted');
  }, /No pending friend request found to respond to/);

  // Requester cannot accept their own request
  assert.throws(() => {
    friends.respondFriendRequest(u1.user_id, u2.user_id, 'accepted');
  }, /Only the recipient can respond to a friend request/);

  // Recipient accepts request
  const acceptRes = friends.respondFriendRequest(u2.user_id, u1.user_id, 'accepted');
  assert.equal(acceptRes.status, 'accepted');

  const acceptedRow = db.get(
    'SELECT * FROM friendships WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)',
    u1.user_id, u2.user_id, u2.user_id, u1.user_id
  );
  assert.equal(acceptedRow.status, 'accepted');

  // Verify getFriends
  const u1Friends = friends.getFriends(u1.user_id);
  assert.equal(u1Friends.length, 1);
  assert.equal(u1Friends[0].user_id, u2.user_id);

  const u2Friends = friends.getFriends(u2.user_id);
  assert.equal(u2Friends.length, 1);
  assert.equal(u2Friends[0].user_id, u1.user_id);

  console.log('[Check 1] PASSED');

  // 2. Privacy & Access Control Matrix Verification
  console.log('[Check 2] Privacy & Access Control Verification');
  // u2 has rating_visibility = 'friends'. u1 is friend -> true, u3 is not friend -> false
  assert.equal(friends.checkRatingAccess(u2.user_id, u1.user_id), true);
  assert.equal(friends.checkRatingAccess(u2.user_id, u3.user_id), false);
  assert.equal(friends.checkRatingAccess(u2.user_id, u2.user_id), true); // self

  // Change u2 visibility to 'private'
  friends.updateRatingVisibility(u2.user_id, 'private');
  const u2DbRow = db.get('SELECT rating_visibility FROM users WHERE user_id = ?', u2.user_id);
  assert.equal(u2DbRow.rating_visibility, 'private');
  assert.equal(friends.checkRatingAccess(u2.user_id, u1.user_id), false, 'Friend must be blocked under private visibility');
  assert.equal(friends.checkRatingAccess(u2.user_id, u3.user_id), false);
  assert.equal(friends.checkRatingAccess(u2.user_id, u2.user_id), true, 'Owner always has access');

  // Change u2 visibility to 'public'
  friends.updateRatingVisibility(u2.user_id, 'public');
  assert.equal(friends.checkRatingAccess(u2.user_id, u1.user_id), true);
  assert.equal(friends.checkRatingAccess(u2.user_id, u3.user_id), true);

  console.log('[Check 2] PASSED');

  // 3. Dynamic LWW Conflict Resolution on Ratings
  console.log('[Check 3] Dynamic LWW Conflict Resolution on Ratings');
  const testUser = users[3].user_id;

  // Generate 50 songs
  const songs = [];
  for (let i = 0; i < 50; i++) {
    const s = {
      song_id: randomId('s'),
      title: `Song ${i} ${crypto.randomBytes(4).toString('hex')}`,
      artist: `Artist ${i % 5}`,
      duration: 180.0
    };
    db.run(
      'INSERT INTO songs (song_id, title, artist, duration) VALUES (?, ?, ?, ?)',
      s.song_id, s.title, s.artist, s.duration
    );
    songs.push(s);
  }

  // Initial local ratings at t = 1000
  const baseTimestamp = 1700001000000;
  for (let i = 0; i < 50; i++) {
    db.run(
      'INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)',
      testUser, songs[i].song_id, 50, baseTimestamp
    );
  }

  // Construct sync payload:
  // First 25: older timestamp (t = 500) with rating 80 -> SHOULD BE IGNORED
  // Next 25: newer timestamp (t = 2000) with rating 90 -> SHOULD OVERWRITE
  const syncRatings = [];
  for (let i = 0; i < 25; i++) {
    syncRatings.push({
      user_id: testUser,
      song_id: songs[i].song_id,
      rating_tenths: 80,
      rated_at: baseTimestamp - 50000,
      deleted: false
    });
  }
  for (let i = 25; i < 50; i++) {
    syncRatings.push({
      user_id: testUser,
      song_id: songs[i].song_id,
      rating_tenths: 90,
      rated_at: baseTimestamp + 50000,
      deleted: false
    });
  }

  const syncResult = sync.applySyncBatch(testUser, { ratings: syncRatings });
  assert.equal(syncResult.details.ratingsApplied, 25, 'Expected exactly 25 newer ratings applied');
  assert.equal(syncResult.details.ratingsIgnored, 25, 'Expected exactly 25 older ratings ignored');

  // Empirically inspect every single row in SQLite
  for (let i = 0; i < 25; i++) {
    const r = db.get('SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?', testUser, songs[i].song_id);
    assert.equal(r.rating_tenths, 50, `Row ${i} should have remained 50`);
    assert.equal(r.rated_at, baseTimestamp);
  }
  for (let i = 25; i < 50; i++) {
    const r = db.get('SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?', testUser, songs[i].song_id);
    assert.equal(r.rating_tenths, 90, `Row ${i} should have been updated to 90`);
    assert.equal(r.rated_at, baseTimestamp + 50000);
  }

  // Test LWW Deletions:
  // Deletion with older timestamp -> ignored
  const delOlder = sync.applySyncBatch(testUser, {
    ratings: [{
      user_id: testUser,
      song_id: songs[25].song_id,
      rated_at: baseTimestamp + 10000, // older than current 50000
      deleted: true
    }]
  });
  assert.equal(delOlder.conflictsIgnored, 1);
  const stillExists = db.get('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?', testUser, songs[25].song_id);
  assert.ok(stillExists, 'Song 25 must still exist after stale deletion');

  // Deletion with newer timestamp -> applied
  const delNewer = sync.applySyncBatch(testUser, {
    ratings: [{
      user_id: testUser,
      song_id: songs[25].song_id,
      rated_at: baseTimestamp + 999999, // newer
      deleted: true
    }]
  });
  assert.equal(delNewer.applied, 1);
  const gone = db.get('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?', testUser, songs[25].song_id);
  assert.equal(gone, undefined, 'Song 25 must be deleted from database');

  console.log('[Check 3] PASSED');

  // 4. Telemetry Isolation & Security Boundary
  console.log('[Check 4] Telemetry Isolation & Security Boundary');
  // Populate 20 playback events for testUser
  for (let i = 0; i < 20; i++) {
    db.run(
      'INSERT INTO playback_events (event_id, user_id, song_id, started_at, listened_duration_seconds, completion_status) VALUES (?, ?, ?, ?, ?, ?)',
      randomId('evt'), testUser, songs[i].song_id, baseTimestamp + i * 1000, 150.0, 'completed'
    );
  }

  const initialEvtCount = db.get('SELECT count(*) as cnt FROM playback_events WHERE user_id = ?', testUser).cnt;
  assert.equal(initialEvtCount, 20);

  // Call exportSyncPayload
  const exported = sync.exportSyncPayload(testUser, 0);
  assert.equal(exported.user_id, testUser);
  assert.ok(Array.isArray(exported.ratings));
  assert.ok(Array.isArray(exported.friendships));
  assert.equal(exported.playback_events, undefined, 'Export payload MUST NEVER contain playback_events key');

  // Verify payload stringified does not contain playback_events
  const payloadStr = JSON.stringify(exported);
  assert.equal(payloadStr.includes('playback_events'), false);
  assert.equal(payloadStr.includes('listened_duration_seconds'), false);

  // Call applySyncBatch with attempt to tamper or inject playback_events
  sync.applySyncBatch(testUser, {
    ratings: [{
      user_id: testUser,
      song_id: songs[0].song_id,
      rating_tenths: 75,
      rated_at: baseTimestamp + 200000
    }],
    playback_events: [
      { event_id: 'fake_evt', user_id: testUser, song_id: songs[0].song_id, listened_duration_seconds: 999 }
    ]
  });

  const finalEvtCount = db.get('SELECT count(*) as cnt FROM playback_events WHERE user_id = ?', testUser).cnt;
  assert.equal(finalEvtCount, 20, 'playback_events count must never be changed by sync batch');

  // Verify unauthorized user payload injection is blocked
  assert.throws(() => {
    sync.applySyncBatch(testUser, {
      userId: users[4].user_id,
      ratings: []
    });
  }, /Sync user mismatch/);

  console.log('[Check 4] PASSED');

  // 5. OfflineSyncQueue verification
  console.log('[Check 5] OfflineSyncQueue verification');
  const queue = syncMod.createOfflineQueue();
  const qSong1 = songs[30].song_id;
  const qSong2 = songs[31].song_id;

  queue.enqueueRating(testUser, qSong1, 8.8, baseTimestamp + 300000);
  queue.enqueueRatingDeletion(testUser, qSong2, baseTimestamp + 300000);
  queue.enqueueSettings(testUser, 'public', baseTimestamp + 300000);

  const pending = queue.getPending();
  assert.equal(pending.length, 3);

  const flushRes = queue.flush(sync, testUser);
  assert.equal(flushRes.success, true);
  assert.equal(queue.getPending().length, 0);

  const q1InDb = db.get('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?', testUser, qSong1);
  assert.equal(q1InDb.rating_tenths, 88);

  const q2InDb = db.get('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?', testUser, qSong2);
  assert.equal(q2InDb, undefined);

  const userVisInDb = db.get('SELECT rating_visibility FROM users WHERE user_id = ?', testUser);
  assert.equal(userVisInDb.rating_visibility, 'public');

  console.log('[Check 5] PASSED');

  console.log('--- ALL ADVERSARIAL INTEGRITY VERIFICATIONS PASSED CLEANLY ---');
}

runAdversarialAudit();
