'use strict';

/**
 * EMPIRICAL STRESS HARNESS
 * Adversarial Challenger M2.4
 * Stress-testing:
 * 1. Concurrency & Isolation across distinct SQLite instances & interleaved pairs
 * 2. Telemetry Non-Mutation during rating insertions, updates, and deletions
 * 3. Scale stress (hundreds/thousands of songs, sorting, limits, latency < 50ms)
 */

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const dbMod = require('../server/db.cjs');
const ratingsMod = require('../server/ratings.cjs');
const comparisonMod = require('../server/comparison.cjs');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedRating,
  seedFriendship,
  seedPlaybackEvent,
  createRatingsService,
  createFriendsService,
  createComparisonService,
  createAnalyticsService
} = require('./fixtures/testDb.cjs');

async function runAllStressTests() {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    errors: [],
    benchmarks: {}
  };

  function subtest(name, fn) {
    results.total++;
    process.stdout.write(`  [RUN] ${name}... `);
    const start = performance.now();
    try {
      fn();
      const duration = (performance.now() - start).toFixed(2);
      process.stdout.write(`PASSED (${duration}ms)\n`);
      results.passed++;
    } catch (err) {
      const duration = (performance.now() - start).toFixed(2);
      process.stdout.write(`FAILED (${duration}ms)\n`);
      console.error(`    Error: ${err.message}`);
      console.error(err.stack);
      results.failed++;
      results.errors.push({ name, error: err.message, stack: err.stack });
    }
  }

  console.log('================================================================');
  console.log('SUITE 1: Concurrency & Database Isolation');
  console.log('================================================================');

  subtest('1.1 Multiple in-memory SQLite instances maintain strict isolation with bound services', () => {
    // Create 3 distinct databases
    const db1 = createTestDb();
    const db2 = createTestDb();
    const db3 = createTestDb();

    // Seed users and friendships in each
    seedUser(db1, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
    seedUser(db1, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
    seedFriendship(db1, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

    seedUser(db2, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
    seedUser(db2, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
    seedFriendship(db2, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

    seedUser(db3, { userId: 'u_charlie', username: 'charlie', ratingVisibility: 'friends' });
    seedUser(db3, { userId: 'u_dave', username: 'dave', ratingVisibility: 'friends' });
    seedFriendship(db3, { requesterId: 'u_charlie', recipientId: 'u_dave', status: 'accepted' });

    // Seed songs in each
    for (let i = 1; i <= 20; i++) {
      const s = { songId: `s_${i}`, title: `Song ${i}`, duration: 200 };
      seedSong(db1, s);
      seedSong(db2, s);
      seedSong(db3, s);
    }

    // In DB1:
    // s_1 is a shared favorite (Alice: 9.0, Bob: 9.5)
    seedRating(db1, { userId: 'u_alice', songId: 's_1', ratingTenths: 90 });
    seedRating(db1, { userId: 'u_bob', songId: 's_1', ratingTenths: 95 });
    // s_2 has large divergence (Alice: 9.0, Bob: 3.0 -> diff 6.0)
    seedRating(db1, { userId: 'u_alice', songId: 's_2', ratingTenths: 90 });
    seedRating(db1, { userId: 'u_bob', songId: 's_2', ratingTenths: 30 });

    // In DB2: s_1 has extreme divergence (Alice: 1.0, Bob: 10.0 -> diff 9.0), NOT a shared favorite
    seedRating(db2, { userId: 'u_alice', songId: 's_1', ratingTenths: 10 });
    seedRating(db2, { userId: 'u_bob', songId: 's_1', ratingTenths: 100 });

    // In DB3: s_1 is rated only by Charlie (Charlie: 8.5, Dave unrated -> discovery for Dave)
    seedRating(db3, { userId: 'u_charlie', songId: 's_1', ratingTenths: 85 });

    const friends1 = createFriendsService(db1);
    const ratings1 = ratingsMod.createRatingsService(db1);
    const comp1 = comparisonMod.createComparisonService(db1, friends1, ratings1);

    const friends2 = createFriendsService(db2);
    const ratings2 = ratingsMod.createRatingsService(db2);
    const comp2 = comparisonMod.createComparisonService(db2, friends2, ratings2);

    const friends3 = createFriendsService(db3);
    const ratings3 = ratingsMod.createRatingsService(db3);
    const comp3 = comparisonMod.createComparisonService(db3, friends3, ratings3);

    // Rapidly interleave calls between db1, db2, db3
    for (let cycle = 0; cycle < 50; cycle++) {
      // DB1 queries
      const cmp1 = comp1.compareSong('u_alice', 'u_bob', 's_1');
      assert.strictEqual(cmp1.user_a_rating, '9.0');
      assert.strictEqual(cmp1.user_b_rating, '9.5');
      assert.strictEqual(cmp1.difference, '0.5');

      const cat1 = comp1.compareCatalogs('u_alice', 'u_bob');
      assert.strictEqual(cat1.shared_favorites.length, 1);
      assert.strictEqual(cat1.shared_favorites[0].song_id, 's_1');
      assert.strictEqual(cat1.divergence.length, 1);
      assert.strictEqual(cat1.divergence[0].song_id, 's_2');
      assert.strictEqual(cat1.divergence[0].difference, '6.0');
      assert.strictEqual(cat1.discovery.length, 0);

      // DB2 queries
      const cmp2 = comp2.compareSong('u_alice', 'u_bob', 's_1');
      assert.strictEqual(cmp2.user_a_rating, '1.0');
      assert.strictEqual(cmp2.user_b_rating, '10.0');
      assert.strictEqual(cmp2.difference, '9.0');

      const cat2 = comp2.compareCatalogs('u_alice', 'u_bob');
      assert.strictEqual(cat2.shared_favorites.length, 0, 'DB2 must have 0 shared favorites');
      assert.strictEqual(cat2.divergence.length, 1);
      assert.strictEqual(cat2.divergence[0].difference, '9.0');
      assert.strictEqual(cat2.discovery.length, 0);

      // DB3 queries
      const cmp3 = comp3.compareSong('u_dave', 'u_charlie', 's_1');
      assert.strictEqual(cmp3.user_a_rating, null, 'Dave is unrated');
      assert.strictEqual(cmp3.user_b_rating, '8.5');
      assert.strictEqual(cmp3.difference, null);

      const cat3 = comp3.compareCatalogs('u_dave', 'u_charlie');
      assert.strictEqual(cat3.shared_favorites.length, 0);
      assert.strictEqual(cat3.divergence.length, 0);
      assert.strictEqual(cat3.discovery.length, 1);
      assert.strictEqual(cat3.discovery[0].song_id, 's_1');
      assert.strictEqual(cat3.discovery[0].friend_formatted, '8.5');
    }
  });

  subtest('1.2 Empirical Challenge: compareCatalogs defaultMinDivergence behavioral divergence bug', () => {
    // In comparison.cjs line 306:
    // const defaultMinDivergence = (dbInstanceOrOptions !== undefined) ? 10 : 0;
    // When called via module (compareCatalogs(uA, uB)), defaultMinDivergence is 0 (returns all differences).
    // When called via bound service (createComparisonService(db).compareCatalogs(uA, uB)),
    // dbInstance is passed as 3rd arg, causing defaultMinDivergence to be 10 (filters out diff < 1.0).
    const db = createTestDb();
    seedUser(db, { userId: 'u1', username: 'u1', ratingVisibility: 'friends' });
    seedUser(db, { userId: 'u2', username: 'u2', ratingVisibility: 'friends' });
    seedFriendship(db, { requesterId: 'u1', recipientId: 'u2', status: 'accepted' });
    seedSong(db, { songId: 's_subtle', title: 'Subtle Diff', duration: 180 });
    seedRating(db, { userId: 'u1', songId: 's_subtle', ratingTenths: 80 });
    seedRating(db, { userId: 'u2', songId: 's_subtle', ratingTenths: 85 }); // diff 0.5 (5 tenths)

    const unboundResult = comparisonMod.compareCatalogs('u1', 'u2');
    const boundService = comparisonMod.createComparisonService(db);
    const boundResult = boundService.compareCatalogs('u1', 'u2');

    // Unbound returns 1 item; bound returns 0 items!
    assert.strictEqual(unboundResult.divergence.length, 1);
    assert.strictEqual(boundResult.divergence.length, 0);
    console.log('\n    [BEHAVIORAL INCONSISTENCY CONFIRMED] compareCatalogs returns divergence count 1 without db arg, but count 0 with bound db arg for the exact same dataset due to line 306!');
  });

  subtest('1.2 Empirical Challenge: globalThis.__lumenActiveDb leakage when passing unbound ratingsMod to compareSong', () => {
    // This subtest demonstrates the exact concurrency/isolation vulnerability:
    // If compareSong is called with ratingsService = ratingsMod, compareSong fails to pass `db` to ratingsService.getRating(userId, sid).
    // As a result, ratingsMod falls back to globalThis.__lumenActiveDb, which points to whatever DB ran a query last!
    const dbA = createTestDb();
    const dbB = createTestDb();

    seedUser(dbA, { userId: 'uA', username: 'uA' });
    seedSong(dbA, { songId: 'sA', title: 'Song A', duration: 180 });
    seedRating(dbA, { userId: 'uA', songId: 'sA', ratingTenths: 88 });

    seedUser(dbB, { userId: 'uB', username: 'uB' });
    seedSong(dbB, { songId: 'sB', title: 'Song B', duration: 180 });
    seedRating(dbB, { userId: 'uB', songId: 'sB', ratingTenths: 44 });

    // At this point, globalThis.__lumenActiveDb is dbB!
    assert.strictEqual(globalThis.__lumenActiveDb, dbB);

    // Call compareSong on dbA passing ratingsMod as ratingsService:
    const leakedResult = comparisonMod.compareSong('uA', 'uA', 'sA', dbA, null, ratingsMod);
    // VULNERABILITY REVEALED:
    // Because compareSong did not forward dbA to ratingsService.getRating, ratingsMod looked inside dbB instead of dbA!
    // In dbB, uA does not exist, so user_a_rating is null!
    const isVulnerable = (leakedResult.user_a_rating === null);
    if (isVulnerable) {
      console.log('\n    [VULNERABILITY CONFIRMED] compareSong ignores dbInstance when forwarding to ratingsService.getRating, causing cross-database state leakage via globalThis.__lumenActiveDb!');
    }
    // We assert that the vulnerability exists and is empirically reproducible
    assert.strictEqual(isVulnerable, true, 'Empirical proof of isolation leak in compareSong');
  });

  subtest('1.2 Interleaved comparisons across multiple pairs in the same DB never cross-contaminate', () => {
    const db = createTestDb();

    // 4 users
    const users = ['u1', 'u2', 'u3', 'u4'];
    users.forEach(u => seedUser(db, { userId: u, username: `user_${u}`, ratingVisibility: 'friends' }));

    // Friendships: (u1, u2), (u2, u3), (u3, u4), (u1, u4)
    seedFriendship(db, { requesterId: 'u1', recipientId: 'u2', status: 'accepted' });
    seedFriendship(db, { requesterId: 'u2', recipientId: 'u3', status: 'accepted' });
    seedFriendship(db, { requesterId: 'u3', recipientId: 'u4', status: 'accepted' });
    seedFriendship(db, { requesterId: 'u1', recipientId: 'u4', status: 'accepted' });
    // Note: u1 and u3 are NOT friends!

    for (let i = 1; i <= 10; i++) {
      seedSong(db, { songId: `trk_${i}`, title: `Track ${i}`, duration: 180 });
    }

    // Assign ratings:
    // u1: trk_1 = 9.0 (90), trk_2 = 8.0 (80)
    seedRating(db, { userId: 'u1', songId: 'trk_1', ratingTenths: 90 });
    seedRating(db, { userId: 'u1', songId: 'trk_2', ratingTenths: 80 });

    // u2: trk_1 = 9.2 (92), trk_2 = 4.0 (40)
    seedRating(db, { userId: 'u2', songId: 'trk_1', ratingTenths: 92 });
    seedRating(db, { userId: 'u2', songId: 'trk_2', ratingTenths: 40 });

    // u3: trk_1 = 3.0 (30), trk_2 = 4.5 (45), trk_3 = 9.5 (95)
    seedRating(db, { userId: 'u3', songId: 'trk_1', ratingTenths: 30 });
    seedRating(db, { userId: 'u3', songId: 'trk_2', ratingTenths: 45 });
    seedRating(db, { userId: 'u3', songId: 'trk_3', ratingTenths: 95 });

    // u4: trk_1 = 9.0 (90), trk_3 = 9.5 (95)
    seedRating(db, { userId: 'u4', songId: 'trk_1', ratingTenths: 90 });
    seedRating(db, { userId: 'u4', songId: 'trk_3', ratingTenths: 95 });

    const friends = createFriendsService(db);
    const ratings = createRatingsService(db);
    const comp = createComparisonService(db, friends, ratings);

    // Repeated randomized interleaved access
    for (let iter = 0; iter < 100; iter++) {
      // Pair (u1, u2): trk_1 is shared favorite (9.0 & 9.2), trk_2 has divergence |8.0 - 4.0| = 4.0
      const c12 = comp.compareCatalogs('u1', 'u2');
      assert.strictEqual(c12.access_denied, false);
      assert.strictEqual(c12.shared_favorites.length, 1);
      assert.strictEqual(c12.shared_favorites[0].song_id, 'trk_1');
      assert.strictEqual(c12.divergence[0].song_id, 'trk_2');
      assert.strictEqual(c12.divergence[0].difference, '4.0');

      // Pair (u1, u3): NOT friends -> access_denied = true!
      const c13 = comp.compareCatalogs('u1', 'u3');
      assert.strictEqual(c13.access_denied, true, 'u1 and u3 are not friends; access must be denied');
      assert.strictEqual(c13.shared_favorites.length, 0);

      // Pair (u3, u4): trk_3 is shared favorite (9.5 & 9.5)
      const c34 = comp.compareCatalogs('u3', 'u4');
      assert.strictEqual(c34.access_denied, false);
      assert.strictEqual(c34.shared_favorites.length, 1);
      assert.strictEqual(c34.shared_favorites[0].song_id, 'trk_3');

      // Pair (u1, u4): trk_1 is shared favorite (9.0 & 9.0), trk_3 is discovery for u1 (u4 has 9.5, u1 unrated)
      const c14 = comp.compareCatalogs('u1', 'u4');
      assert.strictEqual(c14.access_denied, false);
      assert.strictEqual(c14.shared_favorites.length, 1);
      assert.strictEqual(c14.shared_favorites[0].song_id, 'trk_1');
      assert.strictEqual(c14.discovery.length, 1);
      assert.strictEqual(c14.discovery[0].song_id, 'trk_3');
      assert.strictEqual(c14.discovery[0].friend_formatted, '9.5');
    }
  });

  console.log('\n================================================================');
  console.log('SUITE 2: Telemetry Non-Mutation Verification');
  console.log('================================================================');

  subtest('2.1 Modifying, inserting, or deleting ratings NEVER alters playback events or stats', () => {
    const db = createTestDb();
    const userId = 'u_telemetry_test';
    seedUser(db, { userId, username: 'telemetry_user', ratingVisibility: 'friends' });

    // Seed 10 songs
    for (let i = 1; i <= 10; i++) {
      seedSong(db, { songId: `s_${i}`, title: `Song Title ${i}`, duration: 100 + i * 20 });
    }

    const analytics = createAnalyticsService(db);
    const ratings = createRatingsService(db);

    // Seed 200 playback events across all songs
    const now = Date.now();
    for (let e = 1; e <= 200; e++) {
      const songId = `s_${(e % 10) + 1}`;
      const startedAt = now - (e * 60 * 1000); // spread across the last 3.3 hours
      const listenedDuration = 30 + (e % 150);
      const completionStatus = (e % 3 === 0) ? 'completed' : ((e % 3 === 1) ? 'uncompleted' : 'skipped');

      analytics.recordPlaybackEvent({
        eventId: `ev_${e}`,
        userId,
        songId,
        startedAt,
        listenedDurationSeconds: listenedDuration,
        completionStatus
      });
    }

    // Capture complete snapshot of playback data BEFORE rating mutations
    const countBeforeStmt = db.prepare('SELECT COUNT(*) as cnt, SUM(listened_duration_seconds) as total_dur FROM playback_events WHERE user_id = ?');
    const snapshotBefore = countBeforeStmt.get(userId);
    const allEventsBeforeStmt = db.prepare('SELECT * FROM playback_events WHERE user_id = ? ORDER BY event_id ASC');
    const rawEventsBefore = allEventsBeforeStmt.all(userId);

    const stats30dBefore = analytics.getListeningStats(userId, '30d');
    const statsAllBefore = analytics.getListeningStats(userId, 'all');

    assert.strictEqual(snapshotBefore.cnt, 200);

    // Perform intensive storm of rating mutations:
    // Step A: Insert ratings for all 10 songs
    for (let i = 1; i <= 10; i++) {
      ratings.setRating(userId, `s_${i}`, 5.0 + (i * 0.4));
    }

    // Step B: Update ratings multiple times (e.g. 10 revisions each)
    for (let round = 1; round <= 10; round++) {
      for (let i = 1; i <= 10; i++) {
        const newRating = Number(((1.0 + (round * 0.8) + (i * 0.1)) % 9.9 + 0.1).toFixed(1));
        ratings.setRating(userId, `s_${i}`, newRating);
      }
    }

    // Step C: Delete half the ratings (s_1 to s_5)
    for (let i = 1; i <= 5; i++) {
      ratings.deleteRating(userId, `s_${i}`);
    }

    // Step D: Re-insert deleted ratings with extreme values (0.1 and 10.0)
    ratings.setRating(userId, 's_1', 0.1);
    ratings.setRating(userId, 's_2', 10.0);
    ratings.setRating(userId, 's_3', 9.9);
    ratings.setRating(userId, 's_4', 1.0);
    ratings.deleteRating(userId, 's_5'); // leave unrated

    // Capture complete snapshot of playback data AFTER rating mutations
    const snapshotAfter = countBeforeStmt.get(userId);
    const rawEventsAfter = allEventsBeforeStmt.all(userId);

    // Exact count check
    assert.strictEqual(snapshotAfter.cnt, snapshotBefore.cnt, 'Playback event count must NOT change');

    // Exact duration sum check
    assert.strictEqual(
      Math.abs(snapshotAfter.total_dur - snapshotBefore.total_dur) < 1e-9,
      true,
      'Total playback duration must NOT change'
    );

    // Exact row-by-row deep equality check
    assert.strictEqual(rawEventsAfter.length, rawEventsBefore.length);
    for (let i = 0; i < rawEventsBefore.length; i++) {
      const b = rawEventsBefore[i];
      const a = rawEventsAfter[i];
      assert.strictEqual(a.event_id, b.event_id);
      assert.strictEqual(a.song_id, b.song_id);
      assert.strictEqual(a.started_at, b.started_at);
      assert.strictEqual(a.listened_duration_seconds, b.listened_duration_seconds);
      assert.strictEqual(a.completion_status, b.completion_status);
    }

    // Playback stats queries verification (top_songs, top_duration_songs, chronological_log)
    const stats30dAfter = analytics.getListeningStats(userId, '30d');
    const statsAllAfter = analytics.getListeningStats(userId, 'all');

    assert.deepStrictEqual(stats30dAfter.top_songs, stats30dBefore.top_songs, 'top_songs must remain identical');
    assert.deepStrictEqual(stats30dAfter.top_duration_songs, stats30dBefore.top_duration_songs, 'top_duration_songs must remain identical');
    assert.deepStrictEqual(stats30dAfter.chronological_log, stats30dBefore.chronological_log, 'chronological_log must remain identical');
    assert.deepStrictEqual(statsAllAfter.top_songs, statsAllBefore.top_songs, 'all-time top_songs must remain identical');
  });

  console.log('\n================================================================');
  console.log('SUITE 3: Scale Stress, Latency & Sorting Invariants (<50ms)');
  console.log('================================================================');

  subtest('3.1 Large-scale catalog comparison with 1000 songs and 500 ratings per user', () => {
    const db = createTestDb();
    seedUser(db, { userId: 'u_scale_a', username: 'scale_alice', ratingVisibility: 'friends' });
    seedUser(db, { userId: 'u_scale_b', username: 'scale_bob', ratingVisibility: 'friends' });
    seedFriendship(db, { requesterId: 'u_scale_a', recipientId: 'u_scale_b', status: 'accepted' });

    // Seed 1,000 songs
    const TOTAL_SONGS = 1000;
    const insertSongStmt = db.prepare('INSERT INTO songs (song_id, title, artist, album, duration) VALUES (?, ?, ?, ?, ?)');
    db.exec('BEGIN TRANSACTION;');
    for (let i = 1; i <= TOTAL_SONGS; i++) {
      insertSongStmt.run(`song_${i}`, `Scale Title ${i}`, `Artist ${i % 50}`, `Album ${i % 25}`, 210.0);
    }
    db.exec('COMMIT;');

    // User A rates songs 1..500
    // User B rates songs 251..750 (so 250 common songs, 250 songs only rated by A, 250 only rated by B)
    const insertRatingStmt = db.prepare('INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN TRANSACTION;');
    const baseTime = Date.now();
    for (let i = 1; i <= 500; i++) {
      // Vary ratings deterministically: tenths between 10 and 100
      const ratingA = ((i * 7) % 91) + 10;
      insertRatingStmt.run('u_scale_a', `song_${i}`, ratingA, baseTime + i);
    }
    for (let i = 251; i <= 750; i++) {
      const ratingB = ((i * 13) % 91) + 10;
      insertRatingStmt.run('u_scale_b', `song_${i}`, ratingB, baseTime + i);
    }
    db.exec('COMMIT;');

    const friends = createFriendsService(db);
    const ratings = createRatingsService(db);
    const comp = createComparisonService(db, friends, ratings);

    // Warm-up run
    comp.compareCatalogs('u_scale_a', 'u_scale_b');

    // Benchmark 30 consecutive comparison queries
    const latencies = [];
    let lastResult = null;
    for (let run = 0; run < 30; run++) {
      const t0 = performance.now();
      lastResult = comp.compareCatalogs('u_scale_a', 'u_scale_b');
      const t1 = performance.now();
      latencies.push(t1 - t0);
    }

    const minLat = Math.min(...latencies);
    const maxLat = Math.max(...latencies);
    const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    latencies.sort((a, b) => a - b);
    const p95Lat = latencies[Math.floor(latencies.length * 0.95)];

    results.benchmarks.comparisonScale = {
      runs: 30,
      minMs: minLat.toFixed(3),
      maxMs: maxLat.toFixed(3),
      avgMs: avgLat.toFixed(3),
      p95Ms: p95Lat.toFixed(3)
    };

    console.log(`\n    -> Benchmark Latencies: Min=${minLat.toFixed(2)}ms, Avg=${avgLat.toFixed(2)}ms, P95=${p95Lat.toFixed(2)}ms, Max=${maxLat.toFixed(2)}ms`);

    // Latency Requirement: strictly < 50ms
    assert.strictEqual(avgLat < 50.0, true, `Average latency (${avgLat.toFixed(2)}ms) must be < 50ms`);
    assert.strictEqual(maxLat < 50.0, true, `Max latency (${maxLat.toFixed(2)}ms) must be < 50ms`);

    // Verify Sorting Invariant 1: Shared Favorites
    // - Every item must have both tenths >= 80
    // - Must be sorted strictly descending by (user_a_tenths + user_b_tenths)
    assert.strictEqual(lastResult.shared_favorites.length > 0, true);
    for (let i = 0; i < lastResult.shared_favorites.length; i++) {
      const item = lastResult.shared_favorites[i];
      assert.strictEqual(item.user_a_tenths >= 80, true);
      assert.strictEqual(item.user_b_tenths >= 80, true);
      if (i > 0) {
        const prev = lastResult.shared_favorites[i - 1];
        const prevSum = prev.user_a_tenths + prev.user_b_tenths;
        const curSum = item.user_a_tenths + item.user_b_tenths;
        assert.strictEqual(prevSum >= curSum, true, `Shared favorites must be sorted descending by sum: prev ${prevSum} >= cur ${curSum}`);
      }
    }

    // Verify Sorting Invariant 2: Divergence
    // - Must be sorted strictly descending by difference_tenths
    assert.strictEqual(lastResult.divergence.length > 0, true);
    for (let i = 0; i < lastResult.divergence.length; i++) {
      const item = lastResult.divergence[i];
      const expectedDiff = Math.abs(item.user_a_tenths - item.user_b_tenths);
      assert.strictEqual(item.difference_tenths, expectedDiff);
      if (i > 0) {
        const prev = lastResult.divergence[i - 1];
        assert.strictEqual(prev.difference_tenths >= item.difference_tenths, true, 'Divergence must be sorted descending');
      }
    }

    // Verify Sorting Invariant 3: Discovery Opportunities
    // - Rated highly by friend B (>= 70 tenths by default), NOT rated by user A
    assert.strictEqual(lastResult.discovery.length > 0, true);
    for (let i = 0; i < lastResult.discovery.length; i++) {
      const item = lastResult.discovery[i];
      assert.strictEqual(item.friend_tenths >= 70, true);
      // Ensure user A has NOT rated this song
      const songIdNum = parseInt(item.song_id.replace('song_', ''), 10);
      assert.strictEqual(songIdNum > 500, true, `Discovery song ${item.song_id} should not be in user A's rated set (1..500)`);
      if (i > 0) {
        const prev = lastResult.discovery[i - 1];
        assert.strictEqual(prev.friend_tenths >= item.friend_tenths, true, 'Discovery must be sorted descending by friend rating');
      }
    }
  });

  subtest('3.2 Custom options filtering: minDivergenceTenths and minDiscoveryTenths', () => {
    const db = createTestDb();
    seedUser(db, { userId: 'u_opt_a', username: 'opt_a', ratingVisibility: 'friends' });
    seedUser(db, { userId: 'u_opt_b', username: 'opt_b', ratingVisibility: 'friends' });
    seedFriendship(db, { requesterId: 'u_opt_a', recipientId: 'u_opt_b', status: 'accepted' });

    for (let i = 1; i <= 20; i++) {
      seedSong(db, { songId: `s_${i}`, title: `Song ${i}`, duration: 200 });
    }

    // Common songs with varying divergence:
    // s_1: diff 5.0 (90 vs 40) -> 50 tenths
    // s_2: diff 2.0 (80 vs 60) -> 20 tenths
    // s_3: diff 0.5 (75 vs 70) -> 5 tenths
    seedRating(db, { userId: 'u_opt_a', songId: 's_1', ratingTenths: 90 });
    seedRating(db, { userId: 'u_opt_b', songId: 's_1', ratingTenths: 40 });

    seedRating(db, { userId: 'u_opt_a', songId: 's_2', ratingTenths: 80 });
    seedRating(db, { userId: 'u_opt_b', songId: 's_2', ratingTenths: 60 });

    seedRating(db, { userId: 'u_opt_a', songId: 's_3', ratingTenths: 75 });
    seedRating(db, { userId: 'u_opt_b', songId: 's_3', ratingTenths: 70 });

    // Discovery candidates:
    // s_4: friend rated 9.5 (95)
    // s_5: friend rated 7.5 (75)
    // s_6: friend rated 6.0 (60)
    seedRating(db, { userId: 'u_opt_b', songId: 's_4', ratingTenths: 95 });
    seedRating(db, { userId: 'u_opt_b', songId: 's_5', ratingTenths: 75 });
    seedRating(db, { userId: 'u_opt_b', songId: 's_6', ratingTenths: 60 });

    const friends = createFriendsService(db);
    const ratings = createRatingsService(db);
    const comp = createComparisonService(db, friends, ratings);

    // Option: minDivergenceTenths = 20 (>= 2.0 difference)
    // Option: minDiscoveryTenths = 80 (>= 8.0 rating)
    const filtered = comp.compareCatalogs('u_opt_a', 'u_opt_b', {
      minDivergenceTenths: 20,
      minDiscoveryTenths: 80
    });

    assert.strictEqual(filtered.divergence.length, 2, 'Only s_1 (5.0) and s_2 (2.0) should pass >= 20 tenths filter');
    assert.strictEqual(filtered.divergence[0].song_id, 's_1');
    assert.strictEqual(filtered.divergence[1].song_id, 's_2');

    assert.strictEqual(filtered.discovery.length, 1, 'Only s_4 (9.5) should pass >= 80 tenths discovery filter');
    assert.strictEqual(filtered.discovery[0].song_id, 's_4');
  });

  console.log('\n================================================================');
  console.log(`STRESS TEST SUMMARY: ${results.passed}/${results.total} PASSED (${results.failed} FAILED)`);
  console.log('================================================================');

  if (results.failed > 0) {
    process.exit(1);
  }
}

runAllStressTests().catch(err => {
  console.error('Fatal stress harness failure:', err);
  process.exit(1);
});
