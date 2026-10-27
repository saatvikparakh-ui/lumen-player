'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedRating,
  seedFriendship,
  createRatingsService,
  createFriendsService,
  createComparisonService
} = require('../fixtures/testDb.cjs');

test('Tier 1: Comparisons - Single song exact absolute difference formula |r1 - r2|', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });

  // Alice rates 9.4 (94 tenths), Bob rates 7.8 (78 tenths)
  seedRating(db, { userId: 'u_alice', songId: 's1', ratingTenths: 94 });
  seedRating(db, { userId: 'u_bob', songId: 's1', ratingTenths: 78 });

  const ratingsService = createRatingsService(db);
  const friendsService = createFriendsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  const cmp = comparison.compareSong('u_alice', 'u_bob', 's1');
  assert.strictEqual(cmp.user_a_rating, '9.4');
  assert.strictEqual(cmp.user_b_rating, '7.8');
  assert.strictEqual(cmp.difference, '1.6', 'Absolute difference must be exactly 1.6');

  // Reverse direction: Bob comparing with Alice -> difference is symmetric
  const cmpReverse = comparison.compareSong('u_bob', 'u_alice', 's1');
  assert.strictEqual(cmpReverse.user_a_rating, '7.8');
  assert.strictEqual(cmpReverse.user_b_rating, '9.4');
  assert.strictEqual(cmpReverse.difference, '1.6');
});

test('Tier 1: Comparisons - Unrated song represented as unrated/null, never 0.0', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 200 });
  seedSong(db, { songId: 's2', title: 'Song 2', duration: 200 });

  // Alice rated s1 (8.0), Bob has NOT rated s1
  seedRating(db, { userId: 'u_alice', songId: 's1', ratingTenths: 80 });

  const ratingsService = createRatingsService(db);
  const friendsService = createFriendsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  const cmp1 = comparison.compareSong('u_alice', 'u_bob', 's1');
  assert.strictEqual(cmp1.user_a_rating, '8.0');
  assert.strictEqual(cmp1.user_b_rating, null, 'Unrated friend rating must be null');
  assert.strictEqual(cmp1.difference, null, 'Difference must be null when one user is unrated');
  assert.notStrictEqual(cmp1.user_b_rating, '0.0');
  assert.notStrictEqual(cmp1.difference, '8.0');

  // Neither rated s2
  const cmp2 = comparison.compareSong('u_alice', 'u_bob', 's2');
  assert.strictEqual(cmp2.user_a_rating, null);
  assert.strictEqual(cmp2.user_b_rating, null);
  assert.strictEqual(cmp2.difference, null);
});

test('Tier 1: Comparisons - Cross-catalog queries: Shared Favorites (both >= 8.0)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  seedSong(db, { songId: 's_fav1', title: 'Great Track 1', duration: 200 });
  seedSong(db, { songId: 's_fav2', title: 'Great Track 2', duration: 200 });
  seedSong(db, { songId: 's_mixed', title: 'Mixed Track', duration: 200 });

  // Both rate s_fav1 >= 8.0 (9.0 and 8.5)
  seedRating(db, { userId: 'u_alice', songId: 's_fav1', ratingTenths: 90 });
  seedRating(db, { userId: 'u_bob', songId: 's_fav1', ratingTenths: 85 });

  // Both rate s_fav2 >= 8.0 (8.0 and 8.0)
  seedRating(db, { userId: 'u_alice', songId: 's_fav2', ratingTenths: 80 });
  seedRating(db, { userId: 'u_bob', songId: 's_fav2', ratingTenths: 80 });

  // Alice rates s_mixed 9.0, but Bob rates 6.5 (not a shared favorite)
  seedRating(db, { userId: 'u_alice', songId: 's_mixed', ratingTenths: 90 });
  seedRating(db, { userId: 'u_bob', songId: 's_mixed', ratingTenths: 65 });

  const ratingsService = createRatingsService(db);
  const friendsService = createFriendsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  const res = comparison.compareCatalogs('u_alice', 'u_bob');
  assert.strictEqual(res.access_denied, false);
  assert.strictEqual(res.shared_favorites.length, 2);
  assert.strictEqual(res.shared_favorites[0].song_id, 's_fav1');
  assert.strictEqual(res.shared_favorites[1].song_id, 's_fav2');
});

test('Tier 1: Comparisons - Cross-catalog queries: Divergence (sorted by difference DESC)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  seedSong(db, { songId: 's_polarizing', title: 'Polarizing', duration: 200 });
  seedSong(db, { songId: 's_similar', title: 'Similar', duration: 200 });

  // Polarizing: Alice 9.5 (95), Bob 2.0 (20) -> diff 7.5
  seedRating(db, { userId: 'u_alice', songId: 's_polarizing', ratingTenths: 95 });
  seedRating(db, { userId: 'u_bob', songId: 's_polarizing', ratingTenths: 20 });

  // Similar: Alice 8.0 (80), Bob 8.2 (82) -> diff 0.2
  seedRating(db, { userId: 'u_alice', songId: 's_similar', ratingTenths: 80 });
  seedRating(db, { userId: 'u_bob', songId: 's_similar', ratingTenths: 82 });

  const ratingsService = createRatingsService(db);
  const friendsService = createFriendsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  const res = comparison.compareCatalogs('u_alice', 'u_bob');
  assert.strictEqual(res.divergence.length, 2);
  assert.strictEqual(res.divergence[0].song_id, 's_polarizing');
  assert.strictEqual(res.divergence[0].difference, '7.5');
  assert.strictEqual(res.divergence[1].song_id, 's_similar');
  assert.strictEqual(res.divergence[1].difference, '0.2');
});

test('Tier 1: Comparisons - Cross-catalog queries: Discovery opportunities (friend >= 8.0, current user unrated)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  seedSong(db, { songId: 's_gem', title: 'Hidden Gem', duration: 200 });
  seedSong(db, { songId: 's_known', title: 'Known Song', duration: 200 });

  // Bob rated s_gem 9.2 (92), Alice hasn't rated it
  seedRating(db, { userId: 'u_bob', songId: 's_gem', ratingTenths: 92 });

  // Bob rated s_known 9.0, but Alice has also rated it (8.8) -> not discovery
  seedRating(db, { userId: 'u_bob', songId: 's_known', ratingTenths: 90 });
  seedRating(db, { userId: 'u_alice', songId: 's_known', ratingTenths: 88 });

  const ratingsService = createRatingsService(db);
  const friendsService = createFriendsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  const res = comparison.compareCatalogs('u_alice', 'u_bob');
  assert.strictEqual(res.discovery.length, 1);
  assert.strictEqual(res.discovery[0].song_id, 's_gem');
  assert.strictEqual(res.discovery[0].friend_formatted, '9.2');
});
