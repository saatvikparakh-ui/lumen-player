'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedRating,
  seedFriendship,
  seedPlaybackEvent,
  createFriendsService,
  createRecommendationsService
} = require('../fixtures/testDb.cjs');

test('Tier 1: Recommendations - Boost artists and tracks rated >= 8.5 in recommendations', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });

  // Alice rates Radiohead 9.0 (90 tenths) and Coldplay 6.0 (60 tenths)
  seedSong(db, { songId: 's_radio1', title: 'Karma Police', artist: 'Radiohead', duration: 260 });
  seedSong(db, { songId: 's_cold1', title: 'Yellow', artist: 'Coldplay', duration: 260 });
  seedRating(db, { userId: 'u_alice', songId: 's_radio1', ratingTenths: 90 });
  seedRating(db, { userId: 'u_alice', songId: 's_cold1', ratingTenths: 60 });

  const friendsService = createFriendsService(db);
  const recService = createRecommendationsService(db, friendsService);

  const baseRecommendations = [
    { song_id: 'rec_cold2', title: 'Fix You', artist: 'Coldplay' },
    { song_id: 'rec_radio2', title: 'Paranoid Android', artist: 'Radiohead' },
    { song_id: 'rec_other', title: 'Random Track', artist: 'Other Artist' }
  ];

  const result = recService.getRecommendedTracks('u_alice', baseRecommendations);
  assert.ok(result.boostedArtists.includes('Radiohead'), 'Radiohead (rated 9.0) should be boosted');
  assert.strictEqual(result.boostedArtists.includes('Coldplay'), false, 'Coldplay (rated 6.0 < 8.5) should NOT be boosted');

  // Radiohead should be sorted to top of recommendations
  assert.strictEqual(result.recommendations[0].artist, 'Radiohead');
});

test('Tier 1: Recommendations - Friend recommendations shelf (friend rated >= 8.5, user unheard and unrated)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  seedSong(db, { songId: 's_bob_gem', title: 'Bob Gem', artist: 'Great Band', duration: 200 });
  seedSong(db, { songId: 's_heard', title: 'Already Heard', artist: 'Great Band', duration: 200 });
  seedSong(db, { songId: 's_rated', title: 'Already Rated', artist: 'Great Band', duration: 200 });

  // Bob rates all three >= 8.5
  seedRating(db, { userId: 'u_bob', songId: 's_bob_gem', ratingTenths: 95 });
  seedRating(db, { userId: 'u_bob', songId: 's_heard', ratingTenths: 90 });
  seedRating(db, { userId: 'u_bob', songId: 's_rated', ratingTenths: 92 });

  // Alice already listened to s_heard
  seedPlaybackEvent(db, { eventId: 'e_alice', userId: 'u_alice', songId: 's_heard' });

  // Alice already rated s_rated
  seedRating(db, { userId: 'u_alice', songId: 's_rated', ratingTenths: 80 });

  const friendsService = createFriendsService(db);
  const recService = createRecommendationsService(db, friendsService);

  const result = recService.getRecommendedTracks('u_alice', []);
  assert.strictEqual(result.friendRecommendations.length, 1);
  assert.strictEqual(result.friendRecommendations[0].song_id, 's_bob_gem');
  assert.strictEqual(result.friendRecommendations[0].friend_rating, '9.5');
  assert.strictEqual(result.friendRecommendations[0].friend_username, 'bob');
});

test('Tier 1: Recommendations - Explicit ratings weighted significantly higher than single plays', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });

  // Artist A has 1 single play but unrated
  seedSong(db, { songId: 's_a', title: 'Track A', artist: 'Artist A', duration: 180 });
  seedPlaybackEvent(db, { eventId: 'e_a', userId: 'u_alice', songId: 's_a' });

  // Artist B has rating 9.0 (explicit preference)
  seedSong(db, { songId: 's_b', title: 'Track B', artist: 'Artist B', duration: 180 });
  seedRating(db, { userId: 'u_alice', songId: 's_b', ratingTenths: 90 });

  const friendsService = createFriendsService(db);
  const recService = createRecommendationsService(db, friendsService);

  const baseRecommendations = [
    { song_id: 'rec_a', title: 'New A', artist: 'Artist A' },
    { song_id: 'rec_b', title: 'New B', artist: 'Artist B' }
  ];

  const result = recService.getRecommendedTracks('u_alice', baseRecommendations);
  // Artist B (rated 9.0) must be ranked ahead of Artist A (single play)
  assert.strictEqual(result.recommendations[0].artist, 'Artist B');
});

test('Tier 1: Recommendations - Immutability: AI pipeline never alters or overwrites user ratings', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });
  seedRating(db, { userId: 'u_alice', songId: 's1', ratingTenths: 88, ratedAt: 12345 });

  const friendsService = createFriendsService(db);
  const recService = createRecommendationsService(db, friendsService);

  // Invoke recommendation pipeline multiple times
  for (let i = 0; i < 5; i++) {
    recService.getRecommendedTracks('u_alice', [
      { song_id: 's1', title: 'Song 1', artist: 'Unknown' }
    ]);
  }

  // Verify ratings table is 100% untouched
  const row = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND song_id = ?').get('u_alice', 's1');
  assert.ok(row);
  assert.strictEqual(row.rating_tenths, 88, 'Rating tenths must remain strictly 88');
  assert.strictEqual(row.rated_at, 12345, 'Timestamp must remain strictly unchanged');

  const count = db.prepare('SELECT COUNT(*) as cnt FROM ratings').get().cnt;
  assert.strictEqual(count, 1, 'Total ratings count must not change');
});
