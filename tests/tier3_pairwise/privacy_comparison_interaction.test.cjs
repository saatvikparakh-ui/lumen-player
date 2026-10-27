'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedSong,
  seedRating,
  seedFriendship,
  createFriendsService,
  createRatingsService,
  createComparisonService
} = require('../fixtures/testDb.cjs');

test('Tier 3: Pairwise - Dynamic privacy toggle: switching to private instantly redacts comparisons', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });
  seedSong(db, { songId: 's1', title: 'Shared Song', duration: 200 });

  seedRating(db, { userId: 'u_alice', songId: 's1', ratingTenths: 90 });
  seedRating(db, { userId: 'u_bob', songId: 's1', ratingTenths: 80 });

  const friendsService = createFriendsService(db);
  const ratingsService = createRatingsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  // 1. Initial state: friends visibility -> Bob sees Alice's rating (9.0) and diff (1.0)
  let cmp = comparison.compareSong('u_bob', 'u_alice', 's1');
  assert.strictEqual(cmp.user_a_rating, '8.0');
  assert.strictEqual(cmp.user_b_rating, '9.0');
  assert.strictEqual(cmp.difference, '1.0');

  // 2. Alice toggles visibility to 'private'
  db.prepare('UPDATE users SET rating_visibility = ? WHERE user_id = ?').run('private', 'u_alice');

  // Bob compares again -> Alice's rating is instantly redacted to null, difference null
  cmp = comparison.compareSong('u_bob', 'u_alice', 's1');
  assert.strictEqual(cmp.user_a_rating, '8.0');
  assert.strictEqual(cmp.user_b_rating, null, 'Private rating must be redacted to null');
  assert.strictEqual(cmp.difference, null);

  // Catalog comparison must now be access_denied
  const catalog = comparison.compareCatalogs('u_bob', 'u_alice');
  assert.strictEqual(catalog.access_denied, true);

  // 3. Alice toggles back to 'friends'
  db.prepare('UPDATE users SET rating_visibility = ? WHERE user_id = ?').run('friends', 'u_alice');
  cmp = comparison.compareSong('u_bob', 'u_alice', 's1');
  assert.strictEqual(cmp.user_b_rating, '9.0');
  assert.strictEqual(cmp.difference, '1.0');
});

test('Tier 3: Pairwise - Removing friendship instantly revokes rating comparison access', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  seedRating(db, { userId: 'u_alice', songId: 's1', ratingTenths: 92 });
  seedRating(db, { userId: 'u_bob', songId: 's1', ratingTenths: 84 });

  const friendsService = createFriendsService(db);
  const ratingsService = createRatingsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  // Initially friends
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_bob'), true);

  // Bob removes Alice as a friend
  friendsService.removeFriend('u_bob', 'u_alice');

  // Now access must be revoked
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_bob'), false);
  const cmp = comparison.compareSong('u_bob', 'u_alice', 's1');
  assert.strictEqual(cmp.user_b_rating, null);
  assert.strictEqual(cmp.difference, null);
});
