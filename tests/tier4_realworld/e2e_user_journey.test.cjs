'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  createRatingsService,
  createAnalyticsService,
  createFriendsService,
  createComparisonService,
  createRecommendationsService,
  createSyncService
} = require('../fixtures/testDb.cjs');

test('Tier 4: Real-World E2E User Journey - Complete Lifecycle Scenario (R1-R6, AC1-AC9)', (t) => {
  // 1. Setup isolated database and services
  const db = createTestDb();
  const ratings = createRatingsService(db);
  const analytics = createAnalyticsService(db);
  const friends = createFriendsService(db);
  const comparison = createComparisonService(db, friends, ratings);
  const recommendations = createRecommendationsService(db, friends);
  const sync = createSyncService(db);

  const baseTime = 1700000000000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  // 2. User onboarding: Alice and Bob join LUMEN
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends', createdAt: baseTime - (100 * ONE_DAY) });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends', createdAt: baseTime - (100 * ONE_DAY) });

  // 3. Populate song catalog
  const songs = [
    { songId: 's1', title: 'Solaris', artist: 'Astral Echoes', duration: 200.0 },
    { songId: 's2', title: 'Nebula Drift', artist: 'Astral Echoes', duration: 180.0 },
    { songId: 's3', title: 'Midnight City', artist: 'M83', duration: 240.0 },
    { songId: 's4', title: 'Starlight', artist: 'Muse', duration: 240.0 },
    { songId: 's5', title: 'Acoustic Intro', artist: 'Muse', duration: 25.0 }, // Short track (<30s)
    { songId: 's6', title: 'Deep Space', artist: 'Cosmic Sound', duration: 300.0 }
  ];
  for (const s of songs) {
    seedSong(db, s);
  }

  // 4. Playback telemetry session: Alice listens to music
  // s1: 2 qualified plays (180s each, 90% duration)
  const p1 = analytics.recordPlaybackEvent({
    eventId: 'e1',
    userId: 'u_alice',
    songId: 's1',
    startedAt: baseTime - (10 * ONE_DAY),
    listenedDurationSeconds: 180.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(p1.qualified, true);

  // Duplicate trigger attempt within 2s -> debounced
  const p1_dup = analytics.recordPlaybackEvent({
    eventId: 'e1_dup',
    userId: 'u_alice',
    songId: 's1',
    startedAt: baseTime - (10 * ONE_DAY) + 2000,
    listenedDurationSeconds: 180.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(p1_dup.debounced, true);

  // Second legitimate play of s1
  analytics.recordPlaybackEvent({
    eventId: 'e2',
    userId: 'u_alice',
    songId: 's1',
    startedAt: baseTime - (5 * ONE_DAY),
    listenedDurationSeconds: 190.0,
    completionStatus: 'completed'
  });

  // s3: 1 qualified play (200s out of 240s = 83.3%)
  analytics.recordPlaybackEvent({
    eventId: 'e3',
    userId: 'u_alice',
    songId: 's3',
    startedAt: baseTime - (2 * ONE_DAY),
    listenedDurationSeconds: 200.0,
    completionStatus: 'completed'
  });

  // s4: 1 unqualified skip (60s out of 240s = 25% < 80%)
  const p4 = analytics.recordPlaybackEvent({
    eventId: 'e4',
    userId: 'u_alice',
    songId: 's4',
    startedAt: baseTime - (1 * ONE_DAY),
    listenedDurationSeconds: 60.0,
    completionStatus: 'skipped'
  });
  assert.strictEqual(p4.qualified, false);

  // s5 (short 25s track): completed -> qualified
  const p5 = analytics.recordPlaybackEvent({
    eventId: 'e5',
    userId: 'u_alice',
    songId: 's5',
    startedAt: baseTime - (1 * ONE_DAY) + 50000,
    listenedDurationSeconds: 25.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(p5.qualified, true);

  // 5. Alice inspects her listening statistics
  const stats = analytics.getListeningStats('u_alice', '30d', baseTime);
  assert.strictEqual(stats.top_songs[0].song_id, 's1');
  assert.strictEqual(stats.top_songs[0].play_count, 2);
  assert.strictEqual(stats.top_duration_songs[0].song_id, 's1');
  assert.strictEqual(stats.top_duration_songs[0].total_duration_seconds, 370.0);
  assert.strictEqual(stats.chronological_log.length, 5); // e1, e2, e3, e4, e5 (e1_dup was debounced)

  // 6. Rating workflow: Alice rates songs
  // Rate s1: 9.5 (95 tenths)
  const r1 = ratings.setRating('u_alice', 's1', 9.5, baseTime);
  assert.strictEqual(r1.rating_tenths, 95);
  assert.strictEqual(r1.formatted, '9.5');

  // Rate s2: 9.0 (Astral Echoes artist)
  ratings.setRating('u_alice', 's2', 9.0, baseTime);

  // Rate s3: 7.2
  ratings.setRating('u_alice', 's3', 7.2, baseTime);

  // Rate s4: 3.5, then accidentally rate 5.0, then remove rating
  ratings.setRating('u_alice', 's4', 5.0, baseTime);
  const delRes = ratings.deleteRating('u_alice', 's4');
  assert.strictEqual(delRes.unrated, true);
  assert.strictEqual(ratings.getRating('u_alice', 's4').formatted, null);

  // Confirm rating mutations did not affect play counts
  const postRatingStats = analytics.getListeningStats('u_alice', '30d', baseTime);
  assert.strictEqual(postRatingStats.top_songs[0].play_count, 2);
  assert.strictEqual(postRatingStats.top_duration_songs[0].total_duration_seconds, 370.0);

  // 7. Friendship lifecycle: Alice finds Bob and sends friend request
  const req = friends.sendFriendRequest('u_alice', 'bob', baseTime);
  assert.strictEqual(req.status, 'pending');

  // Bob accepts friend request
  const accept = friends.respondFriendRequest('u_bob', 'u_alice', 'accepted', baseTime + 1000);
  assert.strictEqual(accept.status, 'accepted');

  const aliceFriends = friends.getFriends('u_alice');
  assert.strictEqual(aliceFriends.length, 1);
  assert.strictEqual(aliceFriends[0].username, 'bob');

  // 8. Bob rates tracks
  // s1: Bob rates 7.5 (Alice rated 9.5 -> diff 2.0)
  ratings.setRating('u_bob', 's1', 7.5);
  // s2: Bob rates 9.2 (Alice rated 9.0 -> shared favorite)
  ratings.setRating('u_bob', 's2', 9.2);
  // s6: Bob rates 9.8 (Alice hasn't heard or rated this track -> discovery)
  ratings.setRating('u_bob', 's6', 9.8);

  // 9. Comparative taste analysis
  // Single song comparison on s1
  const cmp_s1 = comparison.compareSong('u_alice', 'u_bob', 's1');
  assert.strictEqual(cmp_s1.user_a_rating, '9.5');
  assert.strictEqual(cmp_s1.user_b_rating, '7.5');
  assert.strictEqual(cmp_s1.difference, '2.0');

  // Single song comparison on s6 (Alice unrated)
  const cmp_s6 = comparison.compareSong('u_alice', 'u_bob', 's6');
  assert.strictEqual(cmp_s6.user_a_rating, null);
  assert.strictEqual(cmp_s6.user_b_rating, '9.8');
  assert.strictEqual(cmp_s6.difference, null);

  // Cross-catalog comparison
  const cross = comparison.compareCatalogs('u_alice', 'u_bob');
  // Shared favorite: s2 (Alice 9.0, Bob 9.2, both >= 8.0)
  assert.ok(cross.shared_favorites.some(f => f.song_id === 's2'));
  // Divergence: s1 has difference 2.0
  assert.ok(cross.divergence.some(d => d.song_id === 's1' && d.difference === '2.0'));
  // Discovery: s6 is rated 9.8 by Bob, unrated by Alice
  assert.ok(cross.discovery.some(d => d.song_id === 's6' && d.friend_formatted === '9.8'));

  // 10. AI Recommendation Signal Integration
  const recs = recommendations.getRecommendedTracks('u_alice', [
    { song_id: 'rec_muse', title: 'Hysteria', artist: 'Muse' },
    { song_id: 'rec_astral', title: 'Cosmic Bloom', artist: 'Astral Echoes' }
  ]);
  // Boosted artist: Astral Echoes (rated >= 8.5)
  assert.ok(recs.boostedArtists.includes('Astral Echoes'));
  assert.strictEqual(recs.recommendations[0].artist, 'Astral Echoes');

  // Friend recommendation shelf includes s6 from Bob
  assert.ok(recs.friendRecommendations.some(f => f.song_id === 's6'));

  // Immutability: Alice's ratings in SQLite remain completely untouched
  const finalRatingS1 = ratings.getRating('u_alice', 's1');
  assert.strictEqual(finalRatingS1.formatted, '9.5');

  // 11. Multi-device sync: Alice goes offline on mobile device and updates s3 to 8.8
  const offlinePayload = {
    ratings: [
      { user_id: 'u_alice', song_id: 's3', rating_tenths: 88, rated_at: baseTime + 50000 }
    ]
  };
  const syncResult = sync.applySyncBatch('u_alice', offlinePayload);
  assert.strictEqual(syncResult.applied, 1);
  assert.strictEqual(ratings.getRating('u_alice', 's3').formatted, '8.8');
});
