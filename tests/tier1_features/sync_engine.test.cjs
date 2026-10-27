'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedRating,
  createSyncService
} = require('../fixtures/testDb.cjs');

test('Tier 1: Sync Engine - Valid sync batch creates and updates ratings', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });
  seedSong(db, { songId: 's2', title: 'Song 2', duration: 200 });

  const sync = createSyncService(db);

  const payload = {
    ratings: [
      { user_id: 'u1', song_id: 's1', rating_tenths: 85, rated_at: 1000 },
      { user_id: 'u1', song_id: 's2', rating_tenths: 90, rated_at: 1000 }
    ]
  };

  const res = sync.applySyncBatch('u1', payload);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.applied, 2);

  const r1 = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.strictEqual(r1.rating_tenths, 85);
  const r2 = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's2');
  assert.strictEqual(r2.rating_tenths, 90);
});

test('Tier 1: Sync Engine - LWW conflict resolution: newer timestamp overwrites older local edit', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  // Local rating: 7.0 (70) at t=1000
  seedRating(db, { userId: 'u1', songId: 's1', ratingTenths: 70, ratedAt: 1000 });

  const sync = createSyncService(db);

  // Incoming sync: 9.5 (95) at t=2000 (newer)
  const payload = {
    ratings: [
      { user_id: 'u1', song_id: 's1', rating_tenths: 95, rated_at: 2000 }
    ]
  };

  const res = sync.applySyncBatch('u1', payload);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.applied, 1);
  assert.strictEqual(res.conflictsIgnored, 0);

  const row = db.prepare('SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.strictEqual(row.rating_tenths, 95);
  assert.strictEqual(row.rated_at, 2000);
});

test('Tier 1: Sync Engine - LWW conflict resolution: older sync edit ignored when local is newer', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  // Local rating: 9.5 (95) at t=2000
  seedRating(db, { userId: 'u1', songId: 's1', ratingTenths: 95, ratedAt: 2000 });

  const sync = createSyncService(db);

  // Incoming sync: stale 7.0 (70) at t=1000 (older)
  const payload = {
    ratings: [
      { user_id: 'u1', song_id: 's1', rating_tenths: 70, rated_at: 1000 }
    ]
  };

  const res = sync.applySyncBatch('u1', payload);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.applied, 0);
  assert.strictEqual(res.conflictsIgnored, 1);

  // Database must still retain the newer local rating
  const row = db.prepare('SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.strictEqual(row.rating_tenths, 95);
  assert.strictEqual(row.rated_at, 2000);
});

test('Tier 1: Sync Engine - Deletion sync with LWW (newer deletion wins, older deletion ignored)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  // Case 1: Newer deletion (t=3000 vs t=2000) deletes rating
  seedRating(db, { userId: 'u1', songId: 's1', ratingTenths: 80, ratedAt: 2000 });
  const sync = createSyncService(db);

  sync.applySyncBatch('u1', {
    ratings: [
      { user_id: 'u1', song_id: 's1', rated_at: 3000, deleted: true }
    ]
  });
  let row = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.strictEqual(row, undefined, 'Rating should be deleted by newer deletion');

  // Case 2: Older deletion (t=1000 vs t=2000) does NOT delete newer rating
  seedRating(db, { userId: 'u1', songId: 's1', ratingTenths: 90, ratedAt: 2000 });
  sync.applySyncBatch('u1', {
    ratings: [
      { user_id: 'u1', song_id: 's1', rated_at: 1000, deleted: true }
    ]
  });
  row = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.strictEqual(row.rating_tenths, 90, 'Newer rating must NOT be deleted by older deletion sync');
});

test('Tier 1: Sync Engine - Rejects payload with mismatched authenticated user ID', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  const sync = createSyncService(db);

  assert.throws(
    () => {
      // Alice is authenticated, but payload attempts to mutate Bob's ratings
      sync.applySyncBatch('u_alice', {
        ratings: [
          { user_id: 'u_bob', song_id: 's1', rating_tenths: 90, rated_at: 1000 }
        ]
      });
    },
    /Sync user mismatch/i
  );
});

test('Tier 1: Sync Engine - Low rating tenths (0.1 to 1.0) preserved without 10x inflation during sync and offline flush', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_low', username: 'low_user' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });
  seedSong(db, { songId: 's2', title: 'Song 2', duration: 180 });
  seedSong(db, { songId: 's3', title: 'Song 3', duration: 180 });

  const sync = createSyncService(db);

  // 1. applySyncBatch with integer tenths in [1, 10]
  sync.applySyncBatch('u_low', {
    ratings: [
      { user_id: 'u_low', song_id: 's1', rating_tenths: 1, rated_at: 1000 },
      { user_id: 'u_low', song_id: 's2', rating_tenths: 5, rated_at: 1000 }
    ]
  });

  const r1 = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?').get('u_low', 's1');
  assert.strictEqual(r1.rating_tenths, 1, 'rating_tenths 1 (0.1) must not become 10');
  const r2 = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?').get('u_low', 's2');
  assert.strictEqual(r2.rating_tenths, 5, 'rating_tenths 5 (0.5) must not become 50');

  // 2. OfflineSyncQueue with decimal 1.0 -> 10 tenths
  const q = sync.createOfflineQueue();
  q.enqueueRating('u_low', 's3', 1.0, 1000);
  q.flush(sync, 'u_low');

  const r3 = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?').get('u_low', 's3');
  assert.strictEqual(r3.rating_tenths, 10, 'rating 1.0 must be stored as 10 tenths, not 100');
});

