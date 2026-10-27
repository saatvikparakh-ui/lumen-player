'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedRating,
  createSyncService,
  createRatingsService
} = require('../fixtures/testDb.cjs');

test('Tier 3: Pairwise - Multi-device offline rating mutations with LWW timestamp resolution', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Synced Song', duration: 180 });

  const sync = createSyncService(db);
  const ratings = createRatingsService(db);

  // Device B makes online edit at t = 2000: rating 9.0 (90 tenths)
  ratings.setRating('u1', 's1', 9.0, 2000);
  assert.strictEqual(ratings.getRating('u1', 's1').formatted, '9.0');

  // Device A was offline. At t = 1000, Device A rated the song 7.0 (70 tenths).
  // Device A reconnects and syncs its offline batch:
  const offlineBatchOld = {
    ratings: [
      { user_id: 'u1', song_id: 's1', rating_tenths: 70, rated_at: 1000 }
    ]
  };
  const res1 = sync.applySyncBatch('u1', offlineBatchOld);
  assert.strictEqual(res1.applied, 0, 'Older offline edit must NOT overwrite newer online edit');
  assert.strictEqual(res1.conflictsIgnored, 1);
  assert.strictEqual(ratings.getRating('u1', 's1').formatted, '9.0');

  // Device A was offline again. At t = 3000, Device A rated the song 9.8 (98 tenths).
  // Device A reconnects and syncs:
  const offlineBatchNew = {
    ratings: [
      { user_id: 'u1', song_id: 's1', rating_tenths: 98, rated_at: 3000 }
    ]
  };
  const res2 = sync.applySyncBatch('u1', offlineBatchNew);
  assert.strictEqual(res2.applied, 1, 'Newer offline edit must win via LWW');
  assert.strictEqual(res2.conflictsIgnored, 0);
  assert.strictEqual(ratings.getRating('u1', 's1').formatted, '9.8');
});

test('Tier 3: Pairwise - Sync deletion conflicts with LWW ordering', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  const sync = createSyncService(db);
  const ratings = createRatingsService(db);

  // Scenario 1: Rating created at t=2500. Stale deletion at t=2000 arriving via sync must be rejected.
  ratings.setRating('u1', 's1', 8.5, 2500);

  const staleDeletion = {
    ratings: [
      { user_id: 'u1', song_id: 's1', rated_at: 2000, deleted: true }
    ]
  };
  sync.applySyncBatch('u1', staleDeletion);
  assert.strictEqual(ratings.getRating('u1', 's1').formatted, '8.5', 'Stale deletion must NOT delete newer rating');

  // Scenario 2: Newer deletion at t=3000 arriving via sync must delete the rating.
  const newerDeletion = {
    ratings: [
      { user_id: 'u1', song_id: 's1', rated_at: 3000, deleted: true }
    ]
  };
  sync.applySyncBatch('u1', newerDeletion);
  assert.strictEqual(ratings.getRating('u1', 's1').formatted, null, 'Newer deletion must successfully delete rating');
});
