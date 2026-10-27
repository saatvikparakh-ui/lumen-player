'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, seedUser, seedSong, seedRating } = require('../fixtures/testDb.cjs');
const analyticsMod = require('../../server/analytics.cjs');

test('Analytics Engine - Direct module isQualifiedPlay edge cases & boundaries', (t) => {
  // Missing / invalid duration falls back to 180s
  // 180s * 0.8 = 144s
  assert.strictEqual(analyticsMod.isQualifiedPlay(null, 143.9, 'completed'), false);
  assert.strictEqual(analyticsMod.isQualifiedPlay(undefined, 144.0, 'completed'), true);
  assert.strictEqual(analyticsMod.isQualifiedPlay(NaN, 144.0, 'completed'), true);

  // Standard track (>= 30s) independent of completionStatus
  assert.strictEqual(analyticsMod.isQualifiedPlay(60.0, 48.0, 'paused'), true);
  assert.strictEqual(analyticsMod.isQualifiedPlay(60.0, 48.0, 'skipped'), true);
  assert.strictEqual(analyticsMod.isQualifiedPlay(60.0, 47.9, 'completed'), false);

  // Short track (< 30s) requires completionStatus === 'completed' OR listened >= duration
  assert.strictEqual(analyticsMod.isQualifiedPlay(25.0, 24.9, 'completed'), true);
  assert.strictEqual(analyticsMod.isQualifiedPlay(25.0, 25.0, 'skipped'), true);
  assert.strictEqual(analyticsMod.isQualifiedPlay(25.0, 24.5, 'skipped'), false);
  assert.strictEqual(analyticsMod.isQualifiedPlay(25.0, 20.0, 'paused'), false);
});

test('Analytics Engine - recordPlaybackEvent normalization, UUID generation, and validation', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_norm', username: 'norm' });
  seedSong(db, { songId: 's_norm', title: 'Norm Song', duration: 100.0 });

  const analytics = analyticsMod.createAnalyticsService(db);

  // Validation: missing payload
  assert.throws(() => analytics.recordPlaybackEvent(null), /must be an object/);
  assert.throws(() => analytics.recordPlaybackEvent({ userId: 'u_norm' }), /requires userId and songId/);
  assert.throws(() => analytics.recordPlaybackEvent({ songId: 's_norm' }), /requires userId and songId/);

  // Snake_case normalization and omitted eventId / startedAt
  const before = Date.now();
  const res = analytics.recordPlaybackEvent({
    user_id: 'u_norm',
    song_id: 's_norm',
    listened_duration_seconds: 85.0,
    completion_status: 'completed'
  });
  const after = Date.now();

  assert.strictEqual(res.recorded, true);
  assert.strictEqual(res.qualified, true);
  assert.strictEqual(res.debounced, false);
  assert.ok(res.event_id && res.event_id.length > 0);

  const row = db.prepare('SELECT * FROM playback_events WHERE event_id = ?').get(res.event_id);
  assert.ok(row);
  assert.strictEqual(row.user_id, 'u_norm');
  assert.strictEqual(row.song_id, 's_norm');
  assert.ok(row.started_at >= before && row.started_at <= after);
  assert.strictEqual(row.listened_duration_seconds, 85.0);
  assert.strictEqual(row.completion_status, 'completed');
});

test('Analytics Engine - Fallback duration 180s when song is missing in catalog', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_miss', username: 'miss' });
  // Disable foreign keys temporarily to test missing catalog song duration fallback
  db.exec('PRAGMA foreign_keys = OFF;');

  const analytics = analyticsMod.createAnalyticsService(db);
  // Default duration is 180s -> 80% is 144s
  const res1 = analytics.recordPlaybackEvent({
    eventId: 'ev_miss_1',
    userId: 'u_miss',
    songId: 's_nonexistent',
    startedAt: 10000,
    listenedDurationSeconds: 144.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(res1.qualified, true, '144.0s on 180s default should be qualified');

  const res2 = analytics.recordPlaybackEvent({
    eventId: 'ev_miss_2',
    userId: 'u_miss',
    songId: 's_nonexistent',
    startedAt: 50000,
    listenedDurationSeconds: 143.9,
    completionStatus: 'completed'
  });
  assert.strictEqual(res2.qualified, false, '143.9s on 180s default should be unqualified');
});

test('Analytics Engine - Factory createAnalyticsService vs Direct Module with explicit db', (t) => {
  const db1 = createTestDb();
  const db2 = createTestDb();
  seedUser(db1, { userId: 'u1', username: 'alice' });
  seedSong(db1, { songId: 's1', title: 'Song 1', duration: 100 });
  seedUser(db2, { userId: 'u2', username: 'bob' });
  seedSong(db2, { songId: 's2', title: 'Song 2', duration: 100 });

  const service1 = analyticsMod.createAnalyticsService(db1);
  const service2 = analyticsMod.createAnalyticsService(db2);

  service1.recordPlaybackEvent({ eventId: 'e1', userId: 'u1', songId: 's1', startedAt: 1000, listenedDurationSeconds: 80, completionStatus: 'completed' });
  service2.recordPlaybackEvent({ eventId: 'e2', userId: 'u2', songId: 's2', startedAt: 1000, listenedDurationSeconds: 80, completionStatus: 'completed' });

  // Direct module call passing explicit db parameter
  const stats1 = analyticsMod.getListeningStats('u1', 'all', 2000, db1);
  const stats2 = analyticsMod.getListeningStats('u2', 'all', 2000, db2);

  assert.strictEqual(stats1.top_songs.length, 1);
  assert.strictEqual(stats1.top_songs[0].song_id, 's1');
  assert.strictEqual(stats2.top_songs.length, 1);
  assert.strictEqual(stats2.top_songs[0].song_id, 's2');

  // Verify cross-isolation: db1 does not contain e2
  const countInDb1 = db1.prepare('SELECT COUNT(*) as cnt FROM playback_events WHERE event_id = ?').get('e2').cnt;
  assert.strictEqual(countInDb1, 0);
});
