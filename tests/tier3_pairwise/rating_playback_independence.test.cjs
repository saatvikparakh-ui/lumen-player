'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  createRatingsService,
  createAnalyticsService
} = require('../fixtures/testDb.cjs');

test('Tier 3: Pairwise - Rating deletion preserves exact play counts, cumulative duration, and chronological log', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Independent Track', duration: 200.0 });

  const ratingsService = createRatingsService(db);
  const analyticsService = createAnalyticsService(db);

  // 1. Play song 3 times (all qualified)
  analyticsService.recordPlaybackEvent({ eventId: 'e1', userId: 'u1', songId: 's1', startedAt: 10000, listenedDurationSeconds: 180.0, completionStatus: 'completed' });
  analyticsService.recordPlaybackEvent({ eventId: 'e2', userId: 'u1', songId: 's1', startedAt: 20000, listenedDurationSeconds: 190.0, completionStatus: 'completed' });
  analyticsService.recordPlaybackEvent({ eventId: 'e3', userId: 'u1', songId: 's1', startedAt: 30000, listenedDurationSeconds: 200.0, completionStatus: 'completed' });

  // Verify baseline analytics
  const baseStats = analyticsService.getListeningStats('u1', 'all');
  assert.strictEqual(baseStats.top_songs[0].play_count, 3);
  assert.strictEqual(baseStats.top_duration_songs[0].total_duration_seconds, 570.0);
  assert.strictEqual(baseStats.chronological_log.length, 3);
  assert.strictEqual(baseStats.rating_stats.highest_rated.length, 0, 'Initially unrated');

  // 2. Add rating 9.5
  ratingsService.setRating('u1', 's1', 9.5);
  const ratedStats = analyticsService.getListeningStats('u1', 'all');
  assert.strictEqual(ratedStats.top_songs[0].play_count, 3, 'Play count must not mutate when rated');
  assert.strictEqual(ratedStats.top_duration_songs[0].total_duration_seconds, 570.0, 'Duration must not mutate when rated');
  assert.strictEqual(ratedStats.rating_stats.highest_rated.length, 1);
  assert.strictEqual(ratedStats.rating_stats.highest_rated[0].formatted, '9.5');

  // 3. Mutate rating to 3.2
  ratingsService.setRating('u1', 's1', 3.2);
  const updatedStats = analyticsService.getListeningStats('u1', 'all');
  assert.strictEqual(updatedStats.top_songs[0].play_count, 3);
  assert.strictEqual(updatedStats.top_duration_songs[0].total_duration_seconds, 570.0);
  assert.strictEqual(updatedStats.rating_stats.lowest_rated[0].formatted, '3.2');

  // 4. Delete rating completely
  const del = ratingsService.deleteRating('u1', 's1');
  assert.strictEqual(del.success, true);
  assert.strictEqual(del.unrated, true);

  const finalStats = analyticsService.getListeningStats('u1', 'all');
  // Strict decoupling verification: play counts, cumulative duration, and chronological log MUST BE IDENTICAL to baseline
  assert.strictEqual(finalStats.top_songs[0].play_count, 3);
  assert.strictEqual(finalStats.top_duration_songs[0].total_duration_seconds, 570.0);
  assert.strictEqual(finalStats.chronological_log.length, 3);
  assert.strictEqual(finalStats.rating_stats.highest_rated.length, 0);
  assert.strictEqual(finalStats.rating_stats.lowest_rated.length, 0);
});

test('Tier 3: Pairwise - Unrated songs in top-played statistics never show phantom 0.0 rating', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's_unrated', title: 'Unrated Hit', duration: 180.0 });

  const analyticsService = createAnalyticsService(db);
  analyticsService.recordPlaybackEvent({ eventId: 'e1', userId: 'u1', songId: 's_unrated', startedAt: 10000, listenedDurationSeconds: 180.0, completionStatus: 'completed' });

  const stats = analyticsService.getListeningStats('u1', 'all');
  assert.strictEqual(stats.top_songs.length, 1);
  assert.strictEqual(stats.top_songs[0].play_count, 1);
  assert.strictEqual(stats.rating_stats.highest_rated.length, 0);
  assert.strictEqual(stats.rating_stats.lowest_rated.length, 0);
});
