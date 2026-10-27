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
  createRatingsService,
  createComparisonService,
  createAnalyticsService
} = require('../fixtures/testDb.cjs');

test('Tier 2: Privacy Boundaries - Private visibility strictly blocks non-owner even if accepted friend', (t) => {
  const db = createTestDb();
  // Alice sets visibility to 'private'
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'private' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });
  seedSong(db, { songId: 's1', title: 'Private Song', duration: 180 });
  seedRating(db, { userId: 'u_alice', songId: 's1', ratingTenths: 95 });

  const friendsService = createFriendsService(db);
  const ratingsService = createRatingsService(db);
  const comparison = createComparisonService(db, friendsService, ratingsService);

  // Alice viewing her own rating -> allowed
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_alice'), true);

  // Bob viewing Alice's rating -> BLOCKED
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_bob'), false);

  // Comparison engine with Alice's private rating -> friend rating redacted (null)
  const cmp = comparison.compareSong('u_bob', 'u_alice', 's1');
  assert.strictEqual(cmp.user_b_rating, null, 'Private rating must be redacted to null');
  assert.strictEqual(cmp.difference, null);

  // Catalog comparison -> access denied
  const catalogCmp = comparison.compareCatalogs('u_bob', 'u_alice');
  assert.strictEqual(catalogCmp.access_denied, true);
  assert.strictEqual(catalogCmp.shared_favorites.length, 0);
});

test('Tier 2: Privacy Boundaries - Friends visibility requires accepted status (pending and declined blocked)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_stranger', username: 'stranger', ratingVisibility: 'friends' });

  const friendsService = createFriendsService(db);

  // 1. Stranger (no relationship) -> BLOCKED
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_stranger'), false);

  // 2. Pending request -> BLOCKED
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'pending' });
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_bob'), false);

  // 3. Accepted request -> ALLOWED
  db.prepare('UPDATE friendships SET status = ? WHERE requester_id = ?').run('accepted', 'u_alice');
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_bob'), true);

  // 4. Declined request -> BLOCKED
  db.prepare('UPDATE friendships SET status = ? WHERE requester_id = ?').run('declined', 'u_alice');
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_bob'), false);

  // 5. Removed friendship -> BLOCKED
  db.prepare('UPDATE friendships SET status = ? WHERE requester_id = ?').run('removed', 'u_alice');
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_bob'), false);
});

test('Tier 2: Privacy Boundaries - Public visibility allows permitted users', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'public' });
  seedUser(db, { userId: 'u_stranger', username: 'stranger' });

  const friendsService = createFriendsService(db);
  assert.strictEqual(friendsService.checkRatingAccess('u_alice', 'u_stranger'), true);
});

test('Tier 2: Privacy Boundaries - Telemetry Security Boundary: Friends never gain access to raw playback events', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice', ratingVisibility: 'friends' });
  seedUser(db, { userId: 'u_bob', username: 'bob', ratingVisibility: 'friends' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });
  seedSong(db, { songId: 's1', title: 'Song 1', duration: 180 });

  // Alice listens to secret track 5 times
  for (let i = 1; i <= 5; i++) {
    seedPlaybackEvent(db, {
      eventId: `e_alice_${i}`,
      userId: 'u_alice',
      songId: 's1',
      startedAt: 1000 * i,
      listenedDurationSeconds: 180.0
    });
  }

  const analytics = createAnalyticsService(db);

  // Bob requests listening stats with his own userId -> gets 0 plays for Alice's events
  const bobStats = analytics.getListeningStats('u_bob', 'all');
  assert.strictEqual(bobStats.top_songs.length, 0);
  assert.strictEqual(bobStats.chronological_log.length, 0);

  // Raw playback_events table must only be scoped to the querying user's user_id
  const eventsVisibleToBob = db.prepare('SELECT * FROM playback_events WHERE user_id = ?').all('u_bob');
  assert.strictEqual(eventsVisibleToBob.length, 0, 'No raw playback events of Alice should be visible to Bob');
});
