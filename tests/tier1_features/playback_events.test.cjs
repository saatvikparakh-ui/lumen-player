'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedRating,
  createAnalyticsService
} = require('../fixtures/testDb.cjs');

test('Tier 1: Playback Events - Ingestion records event with all required fields', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  const analytics = createAnalyticsService(db);
  const now = 1700000000000;

  const res = analytics.recordPlaybackEvent({
    eventId: 'e1',
    userId: 'u1',
    songId: 's1',
    startedAt: now,
    listenedDurationSeconds: 150.5,
    completionStatus: 'completed'
  });

  assert.strictEqual(res.recorded, true);
  assert.strictEqual(res.debounced, false);
  assert.strictEqual(res.qualified, true);

  const row = db.prepare('SELECT * FROM playback_events WHERE event_id = ?').get('e1');
  assert.ok(row);
  assert.strictEqual(row.user_id, 'u1');
  assert.strictEqual(row.song_id, 's1');
  assert.strictEqual(row.started_at, now);
  assert.strictEqual(row.listened_duration_seconds, 150.5);
  assert.strictEqual(row.completion_status, 'completed');
});

test('Tier 1: Playback Events - 80% qualified play threshold for standard tracks (>= 30s)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  // 100-second song -> 80% is 80.0s
  seedSong(db, { songId: 's100', title: 'Track 100', duration: 100.0 });

  const analytics = createAnalyticsService(db);

  // Case 1: 80.0s listened -> qualified
  const res1 = analytics.recordPlaybackEvent({
    eventId: 'e-qual',
    userId: 'u1',
    songId: 's100',
    startedAt: 100000,
    listenedDurationSeconds: 80.0,
    completionStatus: 'paused'
  });
  assert.strictEqual(res1.qualified, true);

  // Case 2: 79.9s listened -> unqualified
  const res2 = analytics.recordPlaybackEvent({
    eventId: 'e-unqual',
    userId: 'u1',
    songId: 's100',
    startedAt: 200000, // outside debounce window
    listenedDurationSeconds: 79.9,
    completionStatus: 'skipped'
  });
  assert.strictEqual(res2.qualified, false);
});

test('Tier 1: Playback Events - Short tracks (< 30s) qualified on completion vs skipped', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  // 20-second short track
  seedSong(db, { songId: 's20', title: 'Short Track', duration: 20.0 });

  const analytics = createAnalyticsService(db);

  // Case 1: Completed short track -> qualified
  const resCompleted = analytics.recordPlaybackEvent({
    eventId: 'e-short-comp',
    userId: 'u1',
    songId: 's20',
    startedAt: 100000,
    listenedDurationSeconds: 20.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(resCompleted.qualified, true);

  // Case 2: Skipped short track at 10s -> unqualified
  const resSkipped = analytics.recordPlaybackEvent({
    eventId: 'e-short-skip',
    userId: 'u1',
    songId: 's20',
    startedAt: 200000,
    listenedDurationSeconds: 10.0,
    completionStatus: 'skipped'
  });
  assert.strictEqual(resSkipped.qualified, false);
});

test('Tier 1: Playback Events - Debounce duplicate trigger events within 5s window', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200.0 });

  const analytics = createAnalyticsService(db);
  const baseTime = 1000000;

  // 1. Initial event at baseTime
  const res1 = analytics.recordPlaybackEvent({
    eventId: 'e1',
    userId: 'u1',
    songId: 's1',
    startedAt: baseTime,
    listenedDurationSeconds: 180.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(res1.recorded, true);
  assert.strictEqual(res1.debounced, false);

  // 2. Duplicate trigger at baseTime + 2500ms (within 5s window) -> debounced
  const res2 = analytics.recordPlaybackEvent({
    eventId: 'e2',
    userId: 'u1',
    songId: 's1',
    startedAt: baseTime + 2500,
    listenedDurationSeconds: 180.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(res2.recorded, false);
  assert.strictEqual(res2.debounced, true);

  // 3. Trigger at baseTime + 6000ms (> 5s window) -> recorded
  const res3 = analytics.recordPlaybackEvent({
    eventId: 'e3',
    userId: 'u1',
    songId: 's1',
    startedAt: baseTime + 6000,
    listenedDurationSeconds: 180.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(res3.recorded, true);
  assert.strictEqual(res3.debounced, false);

  // Confirm only 2 rows in DB
  const count = db.prepare('SELECT COUNT(*) as cnt FROM playback_events WHERE user_id = ?').get('u1').cnt;
  assert.strictEqual(count, 2);
});

test('Tier 1: Playback Events - Time-window filtering (30d, 90d, all)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 100.0 });

  const analytics = createAnalyticsService(db);
  const now = 1000000000000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  // Event 1: 5 days ago (in 30d, 90d, all)
  analytics.recordPlaybackEvent({
    eventId: 'e-recent',
    userId: 'u1',
    songId: 's1',
    startedAt: now - (5 * ONE_DAY),
    listenedDurationSeconds: 90.0,
    completionStatus: 'completed'
  });

  // Event 2: 45 days ago (in 90d, all; NOT in 30d)
  analytics.recordPlaybackEvent({
    eventId: 'e-medium',
    userId: 'u1',
    songId: 's1',
    startedAt: now - (45 * ONE_DAY),
    listenedDurationSeconds: 90.0,
    completionStatus: 'completed'
  });

  // Event 3: 120 days ago (in all; NOT in 30d or 90d)
  analytics.recordPlaybackEvent({
    eventId: 'e-old',
    userId: 'u1',
    songId: 's1',
    startedAt: now - (120 * ONE_DAY),
    listenedDurationSeconds: 90.0,
    completionStatus: 'completed'
  });

  const stats30 = analytics.getListeningStats('u1', '30d', now);
  assert.strictEqual(stats30.top_songs[0].play_count, 1);
  assert.strictEqual(stats30.chronological_log.length, 1);
  assert.strictEqual(stats30.top_duration_songs[0].total_duration_seconds, 90.0);

  const stats90 = analytics.getListeningStats('u1', '90d', now);
  assert.strictEqual(stats90.top_songs[0].play_count, 2);
  assert.strictEqual(stats90.chronological_log.length, 2);
  assert.strictEqual(stats90.top_duration_songs[0].total_duration_seconds, 180.0);

  const statsAll = analytics.getListeningStats('u1', 'all', now);
  assert.strictEqual(statsAll.top_songs[0].play_count, 3);
  assert.strictEqual(statsAll.chronological_log.length, 3);
  assert.strictEqual(statsAll.top_duration_songs[0].total_duration_seconds, 270.0);
});

test('Tier 1: Playback Events - Aggregations (Top played songs, highest duration, chronological log)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 'sA', title: 'Song Alpha', duration: 100.0 });
  seedSong(db, { songId: 'sB', title: 'Song Beta', duration: 300.0 });

  const analytics = createAnalyticsService(db);
  const now = 2000000;

  // Song A: 3 qualified plays of 85s each (total 255s)
  analytics.recordPlaybackEvent({ eventId: 'ea1', userId: 'u1', songId: 'sA', startedAt: now - 30000, listenedDurationSeconds: 85.0, completionStatus: 'completed' });
  analytics.recordPlaybackEvent({ eventId: 'ea2', userId: 'u1', songId: 'sA', startedAt: now - 20000, listenedDurationSeconds: 85.0, completionStatus: 'completed' });
  analytics.recordPlaybackEvent({ eventId: 'ea3', userId: 'u1', songId: 'sA', startedAt: now - 10000, listenedDurationSeconds: 85.0, completionStatus: 'completed' });

  // Song B: 1 qualified play of 300s (total 300s)
  analytics.recordPlaybackEvent({ eventId: 'eb1', userId: 'u1', songId: 'sB', startedAt: now - 5000, listenedDurationSeconds: 300.0, completionStatus: 'completed' });

  const stats = analytics.getListeningStats('u1', 'all', now);

  // Top played: sA has 3 plays, sB has 1 play
  assert.strictEqual(stats.top_songs[0].song_id, 'sA');
  assert.strictEqual(stats.top_songs[0].play_count, 3);
  assert.strictEqual(stats.top_songs[1].song_id, 'sB');
  assert.strictEqual(stats.top_songs[1].play_count, 1);

  // Top duration: sB has 300s, sA has 255s
  assert.strictEqual(stats.top_duration_songs[0].song_id, 'sB');
  assert.strictEqual(stats.top_duration_songs[0].total_duration_seconds, 300.0);
  assert.strictEqual(stats.top_duration_songs[1].song_id, 'sA');
  assert.strictEqual(stats.top_duration_songs[1].total_duration_seconds, 255.0);

  // Chronological log: most recent first (eb1, ea3, ea2, ea1)
  assert.strictEqual(stats.chronological_log[0].event_id, 'eb1');
  assert.strictEqual(stats.chronological_log[1].event_id, 'ea3');
});

test('Tier 1: Playback Events - Highest and lowest rated songs aggregation strictly separated from play duration', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 'sA', title: 'Song Alpha', duration: 100.0 });
  seedSong(db, { songId: 'sB', title: 'Song Beta', duration: 100.0 });

  // Seed ratings: Alpha = 9.5 (95), Beta = 2.0 (20)
  seedRating(db, { userId: 'u1', songId: 'sA', ratingTenths: 95 });
  seedRating(db, { userId: 'u1', songId: 'sB', ratingTenths: 20 });

  const analytics = createAnalyticsService(db);
  const stats = analytics.getListeningStats('u1', 'all');

  assert.strictEqual(stats.rating_stats.highest_rated[0].song_id, 'sA');
  assert.strictEqual(stats.rating_stats.highest_rated[0].rating_tenths, 95);
  assert.strictEqual(stats.rating_stats.highest_rated[0].formatted, '9.5');

  assert.strictEqual(stats.rating_stats.lowest_rated[0].song_id, 'sB');
  assert.strictEqual(stats.rating_stats.lowest_rated[0].rating_tenths, 20);
  assert.strictEqual(stats.rating_stats.lowest_rated[0].formatted, '2.0');
});
