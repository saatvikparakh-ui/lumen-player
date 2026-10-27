'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  createRatingsService,
  normalizeAndValidateRating
} = require('../fixtures/testDb.cjs');

test('Tier 2: Rating Boundaries - Valid minimum and maximum boundary values (0.1, 1.0, 9.9, 10.0)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's_min', title: 'Min Song', duration: 180 });
  seedSong(db, { songId: 's_one', title: 'One Song', duration: 180 });
  seedSong(db, { songId: 's_near_max', title: 'Near Max Song', duration: 180 });
  seedSong(db, { songId: 's_max', title: 'Max Song', duration: 180 });

  const ratingsService = createRatingsService(db);

  // 0.1 boundary (tenths: 1)
  const rMin = ratingsService.setRating('u1', 's_min', 0.1);
  assert.strictEqual(rMin.rating_tenths, 1);
  assert.strictEqual(rMin.formatted, '0.1');

  // 1.0 boundary (tenths: 10)
  const rOne = ratingsService.setRating('u1', 's_one', 1.0);
  assert.strictEqual(rOne.rating_tenths, 10);
  assert.strictEqual(rOne.formatted, '1.0');

  // 9.9 boundary (tenths: 99)
  const rNearMax = ratingsService.setRating('u1', 's_near_max', 9.9);
  assert.strictEqual(rNearMax.rating_tenths, 99);
  assert.strictEqual(rNearMax.formatted, '9.9');

  // 10.0 boundary (tenths: 100)
  const rMax = ratingsService.setRating('u1', 's_max', 10.0);
  assert.strictEqual(rMax.rating_tenths, 100);
  assert.strictEqual(rMax.formatted, '10.0');

  // Integer tenths directly: 1 and 100
  assert.strictEqual(normalizeAndValidateRating(1, { isTenths: true }), 1);
  assert.strictEqual(normalizeAndValidateRating(100, { isTenths: true }), 100);
});

test('Tier 2: Rating Boundaries - Rejection of 0.0 and 0', (t) => {
  assert.throws(() => normalizeAndValidateRating(0.0), /out of range/i);
  assert.throws(() => normalizeAndValidateRating(0), /out of range/i);

  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song', duration: 180 });
  const ratingsService = createRatingsService(db);

  assert.throws(() => ratingsService.setRating('u1', 's1', 0.0), /out of range/i);
  assert.throws(() => ratingsService.setRating('u1', 's1', 0), /out of range/i);
});

test('Tier 2: Rating Boundaries - Rejection of 10.1 and 101', (t) => {
  assert.throws(() => normalizeAndValidateRating(10.1), /out of range/i);
  assert.throws(() => normalizeAndValidateRating(101), /out of range/i);

  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song', duration: 180 });
  const ratingsService = createRatingsService(db);

  assert.throws(() => ratingsService.setRating('u1', 's1', 10.1), /out of range/i);
  assert.throws(() => ratingsService.setRating('u1', 's1', 101), /out of range/i);
});

test('Tier 2: Rating Boundaries - Rejection of negative numbers', (t) => {
  assert.throws(() => normalizeAndValidateRating(-0.1), /out of range/i);
  assert.throws(() => normalizeAndValidateRating(-1), /out of range/i);
  assert.throws(() => normalizeAndValidateRating(-10.0), /out of range/i);
  assert.throws(() => normalizeAndValidateRating(-100), /out of range/i);
});

test('Tier 2: Rating Boundaries - Rejection of non-tenths decimal precision', (t) => {
  // Values with hundredths or thousandths
  assert.throws(() => normalizeAndValidateRating(7.85), /exact 0.1 increments/i);
  assert.throws(() => normalizeAndValidateRating(0.05), /out of range/i);
  assert.throws(() => normalizeAndValidateRating(9.99), /exact 0.1 increments/i);
  assert.throws(() => normalizeAndValidateRating(3.14159), /exact 0.1 increments/i);
});

test('Tier 2: Rating Boundaries - Rejection of invalid types (null, undefined, NaN, string, Infinity)', (t) => {
  assert.throws(() => normalizeAndValidateRating(null), /valid number/i);
  assert.throws(() => normalizeAndValidateRating(undefined), /valid number/i);
  assert.throws(() => normalizeAndValidateRating(NaN), /valid number/i);
  assert.throws(() => normalizeAndValidateRating('8.5'), /valid number/i);
  assert.throws(() => normalizeAndValidateRating(Infinity), /valid number/i);
  assert.throws(() => normalizeAndValidateRating(-Infinity), /valid number/i);
});

test('Tier 2: Rating Boundaries - SQLite CHECK constraint CHECK(rating_tenths BETWEEN 1 AND 100)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song', duration: 180 });

  const stmt = db.prepare('INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)');

  // 0 should fail SQLite CHECK
  assert.throws(
    () => stmt.run('u1', 's1', 0, 1000),
    /CHECK constraint failed/i
  );

  // 101 should fail SQLite CHECK
  assert.throws(
    () => stmt.run('u1', 's1', 101, 1000),
    /CHECK constraint failed/i
  );

  // -5 should fail SQLite CHECK
  assert.throws(
    () => stmt.run('u1', 's1', -5, 1000),
    /CHECK constraint failed/i
  );

  // 1 and 100 must succeed
  stmt.run('u1', 's1', 1, 1000);
  assert.strictEqual(db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ?').get('u1').rating_tenths, 1);

  db.prepare('DELETE FROM ratings WHERE user_id = ?').run('u1');
  stmt.run('u1', 's1', 100, 2000);
  assert.strictEqual(db.prepare('SELECT rating_tenths FROM ratings WHERE user_id = ?').get('u1').rating_tenths, 100);
});
