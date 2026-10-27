'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedPlaybackEvent,
  createRatingsService,
  formatRatingTenths,
  normalizeAndValidateRating
} = require('../fixtures/testDb.cjs');

test('Tier 1: Ratings CRUD - Save rating on 0.1 to 10.0 scale and store as integer tenths', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  const ratingsService = createRatingsService(db);

  // Rate 8.5
  const res = ratingsService.setRating('u1', 's1', 8.5);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.rating_tenths, 85);
  assert.strictEqual(res.formatted, '8.5');

  // Verify internal storage in database
  const row = db.prepare('SELECT rating_tenths, rated_at FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.ok(row, 'Rating row should exist');
  assert.strictEqual(row.rating_tenths, 85, 'Internal storage must be integer 85');
});

test('Tier 1: Ratings CRUD - Save rating via direct integer tenths (1 to 100)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  const ratingsService = createRatingsService(db);

  // Rate 94 tenths
  const res = ratingsService.setRating('u1', 's1', 94);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.rating_tenths, 94);
  assert.strictEqual(res.formatted, '9.4');

  const row = db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.strictEqual(row.rating_tenths, 94);
});

test('Tier 1: Ratings CRUD - Zero floating-point drift across all 100 tenths (1-100)', (t) => {
  for (let tenths = 1; tenths <= 100; tenths++) {
    const formatted = formatRatingTenths(tenths);
    const expected = (tenths / 10).toFixed(1);
    assert.strictEqual(formatted, expected, `Tenths ${tenths} must format exactly without float drift`);
    
    // Check specific float edge cases
    if (tenths === 1) assert.strictEqual(formatted, '0.1');
    if (tenths === 3) assert.strictEqual(formatted, '0.3'); // (0.1+0.2 != 0.3)
    if (tenths === 7) assert.strictEqual(formatted, '0.7');
    if (tenths === 10) assert.strictEqual(formatted, '1.0');
    if (tenths === 55) assert.strictEqual(formatted, '5.5');
    if (tenths === 99) assert.strictEqual(formatted, '9.9');
    if (tenths === 100) assert.strictEqual(formatted, '10.0');
  }
});

test('Tier 1: Ratings CRUD - Update existing rating (upsert preserves 1 row per user+song)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  const ratingsService = createRatingsService(db);

  // Initial rating: 7.2
  ratingsService.setRating('u1', 's1', 7.2, 1000);
  let initial = ratingsService.getRating('u1', 's1');
  assert.strictEqual(initial.rating_tenths, 72);
  assert.strictEqual(initial.formatted, '7.2');

  // Update rating: 9.8
  ratingsService.setRating('u1', 's1', 9.8, 2000);
  let updated = ratingsService.getRating('u1', 's1');
  assert.strictEqual(updated.rating_tenths, 98);
  assert.strictEqual(updated.formatted, '9.8');

  // Verify only 1 row exists
  const rows = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND song_id = ?').all('u1', 's1');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].rating_tenths, 98);
  assert.strictEqual(rows[0].rated_at, 2000);
});

test('Tier 1: Ratings CRUD - Remove rating returns song to unrated state (null)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  const ratingsService = createRatingsService(db);

  ratingsService.setRating('u1', 's1', 8.0);
  const deleteRes = ratingsService.deleteRating('u1', 's1');
  assert.strictEqual(deleteRes.success, true);
  assert.strictEqual(deleteRes.unrated, true);

  const current = ratingsService.getRating('u1', 's1');
  assert.strictEqual(current.rating_tenths, null);
  assert.strictEqual(current.formatted, null);

  const row = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND song_id = ?').get('u1', 's1');
  assert.strictEqual(row, undefined);
});

test('Tier 1: Ratings CRUD - Unrated songs must strictly remain null and never evaluate as 0.0', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  const ratingsService = createRatingsService(db);

  const rating = ratingsService.getRating('u1', 's1');
  assert.strictEqual(rating.rating_tenths, null);
  assert.strictEqual(rating.formatted, null);
  assert.notStrictEqual(rating.rating_tenths, 0);
  assert.notStrictEqual(rating.formatted, '0.0');
  assert.notStrictEqual(rating.formatted, '0');
});

test('Tier 1: Ratings CRUD - Rating mutations never alter playback events or listening duration', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  // Seed playback events
  seedPlaybackEvent(db, {
    eventId: 'e1',
    userId: 'u1',
    songId: 's1',
    startedAt: 1000,
    listenedDurationSeconds: 180.0,
    completionStatus: 'completed'
  });
  seedPlaybackEvent(db, {
    eventId: 'e2',
    userId: 'u1',
    songId: 's1',
    startedAt: 10000,
    listenedDurationSeconds: 195.0,
    completionStatus: 'completed'
  });

  const getStats = () => {
    const playCount = db.prepare('SELECT COUNT(*) as cnt FROM playback_events WHERE user_id = ? AND song_id = ?').get('u1', 's1').cnt;
    const totalDuration = db.prepare('SELECT SUM(listened_duration_seconds) as total FROM playback_events WHERE user_id = ? AND song_id = ?').get('u1', 's1').total;
    return { playCount, totalDuration };
  };

  const initialStats = getStats();
  assert.strictEqual(initialStats.playCount, 2);
  assert.strictEqual(initialStats.totalDuration, 375.0);

  const ratingsService = createRatingsService(db);

  // 1. Add rating
  ratingsService.setRating('u1', 's1', 9.1);
  let afterAdd = getStats();
  assert.strictEqual(afterAdd.playCount, 2);
  assert.strictEqual(afterAdd.totalDuration, 375.0);

  // 2. Update rating
  ratingsService.setRating('u1', 's1', 4.5);
  let afterUpdate = getStats();
  assert.strictEqual(afterUpdate.playCount, 2);
  assert.strictEqual(afterUpdate.totalDuration, 375.0);

  // 3. Delete rating
  ratingsService.deleteRating('u1', 's1');
  let afterDelete = getStats();
  assert.strictEqual(afterDelete.playCount, 2);
  assert.strictEqual(afterDelete.totalDuration, 375.0);
});

test('Tier 1: Ratings CRUD - Database PRIMARY KEY constraint on (user_id, song_id)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  // Raw insert without ON CONFLICT
  const stmt = db.prepare('INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)');
  stmt.run('u1', 's1', 80, 100);

  assert.throws(
    () => {
      stmt.run('u1', 's1', 90, 200);
    },
    /UNIQUE constraint failed/i,
    'Duplicate (user_id, song_id) raw insertion must fail primary key constraint'
  );
});
