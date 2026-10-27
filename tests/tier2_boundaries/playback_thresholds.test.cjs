'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  createAnalyticsService
} = require('../fixtures/testDb.cjs');

test('Tier 2: Playback Thresholds - Strict 79.9% vs 80.0% boundary across track durations', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's100', title: '100s Track', duration: 100.0 });
  seedSong(db, { songId: 's250', title: '250s Track', duration: 250.0 });
  seedSong(db, { songId: 's1000', title: '1000s Track', duration: 1000.0 });

  const analytics = createAnalyticsService(db);

  // 100s track: 80% = 80.0s
  assert.strictEqual(analytics.isQualifiedPlay(100.0, 79.9, 'paused'), false, '79.9s on 100s track must be unqualified');
  assert.strictEqual(analytics.isQualifiedPlay(100.0, 80.0, 'paused'), true, '80.0s on 100s track must be qualified');

  // 250s track: 80% = 200.0s
  assert.strictEqual(analytics.isQualifiedPlay(250.0, 199.7, 'paused'), false, '199.7s on 250s track must be unqualified');
  assert.strictEqual(analytics.isQualifiedPlay(250.0, 200.0, 'paused'), true, '200.0s on 250s track must be qualified');

  // 1000s track: 80% = 800.0s
  assert.strictEqual(analytics.isQualifiedPlay(1000.0, 799.9, 'paused'), false, '799.9s on 1000s track must be unqualified');
  assert.strictEqual(analytics.isQualifiedPlay(1000.0, 800.0, 'paused'), true, '800.0s on 1000s track must be qualified');
});

test('Tier 2: Playback Thresholds - Short track (<30s) boundary (29.9s vs 30.0s)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's_short', title: '29.9s Short Track', duration: 29.9 });
  seedSong(db, { songId: 's_std', title: '30.0s Standard Track', duration: 30.0 });

  const analytics = createAnalyticsService(db);

  // For 29.9s (< 30s): completion_status === 'completed' is qualified
  assert.strictEqual(analytics.isQualifiedPlay(29.9, 29.9, 'completed'), true);
  // Skipped at 25s (83.6% duration) but skipped: unqualified because <30s requires completion
  assert.strictEqual(analytics.isQualifiedPlay(29.9, 25.0, 'skipped'), false);

  // For 30.0s (>= 30s): 80% rule applies (80% of 30.0s = 24.0s)
  // Skipped at 24.0s: qualified because 24.0 >= 80% of 30.0s
  assert.strictEqual(analytics.isQualifiedPlay(30.0, 24.0, 'skipped'), true);
  // Skipped at 23.9s: unqualified
  assert.strictEqual(analytics.isQualifiedPlay(30.0, 23.9, 'skipped'), false);
});

test('Tier 2: Playback Thresholds - Debounce timing boundary (4.9s vs 5.1s)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u1', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Track 1', duration: 180.0 });

  const analytics = createAnalyticsService(db);
  const baseTime = 5000000;

  // Base event at t = 5000000
  const ev1 = analytics.recordPlaybackEvent({
    eventId: 'e_base',
    userId: 'u1',
    songId: 's1',
    startedAt: baseTime,
    listenedDurationSeconds: 150.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(ev1.recorded, true);

  // Event at baseTime + 4900ms (4.9s later, within 5s window) -> debounced
  const evDebounced = analytics.recordPlaybackEvent({
    eventId: 'e_4900',
    userId: 'u1',
    songId: 's1',
    startedAt: baseTime + 4900,
    listenedDurationSeconds: 150.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(evDebounced.recorded, false);
  assert.strictEqual(evDebounced.debounced, true);

  // Event at baseTime + 5100ms (5.1s later, beyond 5s window) -> recorded
  const evRecorded = analytics.recordPlaybackEvent({
    eventId: 'e_5100',
    userId: 'u1',
    songId: 's1',
    startedAt: baseTime + 5100,
    listenedDurationSeconds: 150.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(evRecorded.recorded, true);
  assert.strictEqual(evRecorded.debounced, false);

  const rowCount = db.prepare('SELECT COUNT(*) as cnt FROM playback_events WHERE user_id = ?').get('u1').cnt;
  assert.strictEqual(rowCount, 2);
});

test('Tier 2: Playback Thresholds - Debounce scoping: independent across different users and songs', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });
  seedSong(db, { songId: 's1', title: 'Track 1', duration: 180.0 });
  seedSong(db, { songId: 's2', title: 'Track 2', duration: 180.0 });

  const analytics = createAnalyticsService(db);
  const timestamp = 1000000;

  // Alice plays Track 1
  const a1 = analytics.recordPlaybackEvent({ eventId: 'ea1', userId: 'u_alice', songId: 's1', startedAt: timestamp, listenedDurationSeconds: 160.0, completionStatus: 'completed' });
  assert.strictEqual(a1.recorded, true);

  // Bob plays Track 1 at the EXACT same timestamp -> MUST NOT be debounced
  const b1 = analytics.recordPlaybackEvent({ eventId: 'eb1', userId: 'u_bob', songId: 's1', startedAt: timestamp, listenedDurationSeconds: 160.0, completionStatus: 'completed' });
  assert.strictEqual(b1.recorded, true);

  // Alice plays Track 2 at the EXACT same timestamp -> MUST NOT be debounced
  const a2 = analytics.recordPlaybackEvent({ eventId: 'ea2', userId: 'u_alice', songId: 's2', startedAt: timestamp, listenedDurationSeconds: 160.0, completionStatus: 'completed' });
  assert.strictEqual(a2.recorded, true);
});
