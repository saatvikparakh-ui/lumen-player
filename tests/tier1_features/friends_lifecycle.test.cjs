'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  createFriendsService
} = require('../fixtures/testDb.cjs');

test('Tier 1: Friends Lifecycle - Lookup by unique username and send friend request', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const friendsService = createFriendsService(db);
  const now = 1000;

  const req = friendsService.sendFriendRequest('u_alice', 'bob', now);
  assert.strictEqual(req.requester_id, 'u_alice');
  assert.strictEqual(req.recipient_id, 'u_bob');
  assert.strictEqual(req.status, 'pending');

  const row = db.prepare('SELECT * FROM friendships WHERE requester_id = ? AND recipient_id = ?').get('u_alice', 'u_bob');
  assert.ok(row);
  assert.strictEqual(row.status, 'pending');
});

test('Tier 1: Friends Lifecycle - Non-existent username throws descriptive error', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });

  const friendsService = createFriendsService(db);

  assert.throws(
    () => {
      friendsService.sendFriendRequest('u_alice', 'charlie_nonexistent');
    },
    /User not found/i
  );
});

test('Tier 1: Friends Lifecycle - Cannot friend self', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });

  const friendsService = createFriendsService(db);

  assert.throws(
    () => {
      friendsService.sendFriendRequest('u_alice', 'alice');
    },
    /Cannot friend self/i
  );
});

test('Tier 1: Friends Lifecycle - State machine: pending -> accepted', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const friendsService = createFriendsService(db);
  friendsService.sendFriendRequest('u_alice', 'bob', 1000);

  // Bob accepts Alice's request
  const acceptRes = friendsService.respondFriendRequest('u_bob', 'u_alice', 'accepted', 2000);
  assert.strictEqual(acceptRes.success, true);
  assert.strictEqual(acceptRes.status, 'accepted');

  // Both should see each other in getFriends
  const aliceFriends = friendsService.getFriends('u_alice');
  assert.strictEqual(aliceFriends.length, 1);
  assert.strictEqual(aliceFriends[0].user_id, 'u_bob');
  assert.strictEqual(aliceFriends[0].username, 'bob');

  const bobFriends = friendsService.getFriends('u_bob');
  assert.strictEqual(bobFriends.length, 1);
  assert.strictEqual(bobFriends[0].user_id, 'u_alice');
  assert.strictEqual(bobFriends[0].username, 'alice');
});

test('Tier 1: Friends Lifecycle - State machine: pending -> declined', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const friendsService = createFriendsService(db);
  friendsService.sendFriendRequest('u_alice', 'bob', 1000);

  // Bob declines Alice's request
  const declineRes = friendsService.respondFriendRequest('u_bob', 'u_alice', 'declined', 2000);
  assert.strictEqual(declineRes.success, true);
  assert.strictEqual(declineRes.status, 'declined');

  // Neither should have friends
  assert.strictEqual(friendsService.getFriends('u_alice').length, 0);
  assert.strictEqual(friendsService.getFriends('u_bob').length, 0);

  const row = db.prepare('SELECT status FROM friendships WHERE requester_id = ? AND recipient_id = ?').get('u_alice', 'u_bob');
  assert.strictEqual(row.status, 'declined');
});

test('Tier 1: Friends Lifecycle - State machine: accepted -> removed', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const friendsService = createFriendsService(db);
  friendsService.sendFriendRequest('u_alice', 'bob', 1000);
  friendsService.respondFriendRequest('u_bob', 'u_alice', 'accepted', 2000);

  // Confirm friends before removal
  assert.strictEqual(friendsService.getFriends('u_alice').length, 1);

  // Alice removes Bob
  const removed = friendsService.removeFriend('u_alice', 'u_bob', 3000);
  assert.strictEqual(removed, true);

  // Confirm neither has accepted friends now
  assert.strictEqual(friendsService.getFriends('u_alice').length, 0);
  assert.strictEqual(friendsService.getFriends('u_bob').length, 0);

  const row = db.prepare('SELECT status FROM friendships WHERE user_low = ? AND user_high = ?').get('u_alice', 'u_bob');
  assert.strictEqual(row.status, 'removed');
});

test('Tier 1: Friends Lifecycle - Preventing duplicate request when already friends or pending', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const friendsService = createFriendsService(db);
  friendsService.sendFriendRequest('u_alice', 'bob', 1000);

  // Duplicate attempt while pending
  assert.throws(
    () => {
      friendsService.sendFriendRequest('u_alice', 'bob', 2000);
    },
    /already pending/i
  );

  // Also reverse direction while pending
  assert.throws(
    () => {
      friendsService.sendFriendRequest('u_bob', 'alice', 2000);
    },
    /already pending/i
  );
});

test('Tier 1: Friends Lifecycle - Accepting and removing with composite friendship_id', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const friendsService = createFriendsService(db);
  friendsService.sendFriendRequest('u_alice', 'bob', 1000);

  const pending = friendsService.getPendingRequests('u_bob');
  assert.strictEqual(pending.incoming.length, 1);
  const compositeId = pending.incoming[0].friendship_id;
  assert.strictEqual(compositeId, 'u_alice_u_bob');

  // Bob accepts using the composite friendship_id
  const acceptRes = friendsService.respondFriendRequest('u_bob', compositeId, 'accepted', 2000);
  assert.strictEqual(acceptRes.success, true);
  assert.strictEqual(acceptRes.status, 'accepted');

  assert.strictEqual(friendsService.getFriends('u_alice').length, 1);
  assert.strictEqual(friendsService.getFriends('u_bob').length, 1);

  // Bob removes Alice using the composite friendship_id
  const removed = friendsService.removeFriend('u_bob', compositeId, 3000);
  assert.strictEqual(removed, true);
  assert.strictEqual(friendsService.getFriends('u_alice').length, 0);
  assert.strictEqual(friendsService.getFriends('u_bob').length, 0);
});

