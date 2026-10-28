'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser,
  seedFriendship,
  createSharingService
} = require('../fixtures/testDb.cjs');

test('Tier 1: Song Sharing - Create share between accepted friends with metadata snapshot', () => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  const sharingService = createSharingService(db);

  const share = sharingService.createShare({
    sender_id: 'u_alice',
    recipient_id: 'u_bob',
    song: {
      id: 'song_losers',
      title: 'Losers',
      artist: 'The Weeknd',
      album: 'Beauty Behind the Madness',
      duration: 281,
      streamUrl: '/api/stream/resolve?title=Losers&artist=The%20Weeknd'
    },
    message: 'Check out this song!'
  });

  assert.ok(share.share_id, 'Must generate unique share_id');
  assert.strictEqual(share.sender_id, 'u_alice');
  assert.strictEqual(share.recipient_id, 'u_bob');
  assert.strictEqual(share.title, 'Losers');
  assert.strictEqual(share.artist, 'The Weeknd');
  assert.strictEqual(share.album, 'Beauty Behind the Madness');
  assert.strictEqual(share.duration, 281);
  assert.strictEqual(share.message, 'Check out this song!');
  assert.strictEqual(share.is_read, false);
  assert.strictEqual(share.is_dismissed, false);
  assert.strictEqual(share.is_revoked, false);
});

test('Tier 1: Song Sharing - Strictly prevents sharing with non-friends or pending friendships', () => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_stranger', username: 'stranger' });
  seedUser(db, { userId: 'u_pending', username: 'pending_user' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_pending', status: 'pending' });

  const sharingService = createSharingService(db);

  // Attempt share with complete stranger
  assert.throws(
    () => {
      sharingService.createShare({
        sender_id: 'u_alice',
        recipient_id: 'u_stranger',
        song: { title: 'Starboy', artist: 'The Weeknd' }
      });
    },
    /accepted friend/i
  );

  // Attempt share with pending friend
  assert.throws(
    () => {
      sharingService.createShare({
        sender_id: 'u_alice',
        recipient_id: 'u_pending',
        song: { title: 'Starboy', artist: 'The Weeknd' }
      });
    },
    /accepted friend/i
  );
});

test('Tier 1: Song Sharing - Strictly prevents sharing song with oneself', () => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });

  const sharingService = createSharingService(db);

  assert.throws(
    () => {
      sharingService.createShare({
        sender_id: 'u_alice',
        recipient_id: 'u_alice',
        song: { title: 'Starboy', artist: 'The Weeknd' }
      });
    },
    /yourself/i
  );
});

test('Tier 1: Song Sharing - Retrieved received shares sorted newest first and supports unread filter', () => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  const sharingService = createSharingService(db);

  // Create two shares
  const s1 = sharingService.createShare({
    sender_id: 'u_alice',
    recipient_id: 'u_bob',
    song: { title: 'First Song', artist: 'Artist A' }
  });

  const s2 = sharingService.createShare({
    sender_id: 'u_alice',
    recipient_id: 'u_bob',
    song: { title: 'Second Song', artist: 'Artist B' }
  });

  const received = sharingService.getReceivedShares('u_bob');
  assert.strictEqual(received.length, 2);
  assert.strictEqual(received[0].title, 'Second Song', 'Newest share must appear first');
  assert.strictEqual(received[1].title, 'First Song');

  // Mark s2 as read
  sharingService.markShareRead(s2.share_id, 'u_bob');

  const unreadOnly = sharingService.getReceivedShares('u_bob', { unreadOnly: true });
  assert.strictEqual(unreadOnly.length, 1);
  assert.strictEqual(unreadOnly[0].share_id, s1.share_id);
});

test('Tier 1: Song Sharing - Dismiss share removes it from recipient inbox but preserves sender record', () => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  const sharingService = createSharingService(db);

  const share = sharingService.createShare({
    sender_id: 'u_alice',
    recipient_id: 'u_bob',
    song: { title: 'Blinding Lights', artist: 'The Weeknd' }
  });

  // Bob dismisses share
  sharingService.dismissShare(share.share_id, 'u_bob');

  // Bob no longer sees it in active inbox
  const activeReceived = sharingService.getReceivedShares('u_bob');
  assert.strictEqual(activeReceived.length, 0);

  // Alice still has it in sent history
  const sent = sharingService.getSentShares('u_alice');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].title, 'Blinding Lights');
});

test('Tier 1: Song Sharing - Revoking share hides it from recipient immediately', () => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });
  seedFriendship(db, { requesterId: 'u_alice', recipientId: 'u_bob', status: 'accepted' });

  const sharingService = createSharingService(db);

  const share = sharingService.createShare({
    sender_id: 'u_alice',
    recipient_id: 'u_bob',
    song: { title: 'Save Your Tears', artist: 'The Weeknd' }
  });

  // Alice revokes share
  sharingService.revokeShare(share.share_id, 'u_alice');

  // Bob cannot retrieve the revoked share even with includeDismissed
  const received = sharingService.getReceivedShares('u_bob', { includeDismissed: true });
  assert.strictEqual(received.length, 0);
});

test('Tier 1: Song Availability - Distinguishes local exact matches, versions/remixes, and stream links', () => {
  const sharingService = createSharingService();

  const mockLibrary = [
    {
      id: 'local_1',
      title: 'Die For You',
      artist: 'The Weeknd',
      album: 'Starboy',
      duration: 260,
      streamUrl: '/audio/local1.mp3'
    },
    {
      id: 'local_2',
      title: 'Die For You (Remix)',
      artist: 'The Weeknd',
      album: 'Starboy',
      duration: 232,
      streamUrl: '/audio/remix.mp3'
    }
  ];

  // 1. Exact match for original track
  const res1 = sharingService.resolveSongAvailability(
    { title: 'Die For You', artist: 'The Weeknd' },
    mockLibrary
  );
  assert.strictEqual(res1.available, true);
  assert.strictEqual(res1.matchType, 'local_exact');
  assert.strictEqual(res1.matchedTrack.id, 'local_1');

  // 2. Exact match for remix
  const res2 = sharingService.resolveSongAvailability(
    { title: 'Die For You (Remix)', artist: 'The Weeknd' },
    mockLibrary
  );
  assert.strictEqual(res2.available, true);
  assert.strictEqual(res2.matchType, 'local_exact');
  assert.strictEqual(res2.matchedTrack.id, 'local_2');

  // 3. Shared acoustic version when only standard/remix exist in local library
  const res3 = sharingService.resolveSongAvailability(
    { title: 'Die For You (Acoustic)', artist: 'The Weeknd', stream_url: 'https://example.com/acoustic.mp3' },
    mockLibrary
  );
  // Must NOT falsely match local_1 (standard) or local_2 (remix); must fall back to authorized stream_url!
  assert.strictEqual(res3.available, true);
  assert.strictEqual(res3.matchType, 'stream_url');

  // 4. Completely missing song with no stream link
  const res4 = sharingService.resolveSongAvailability(
    { title: 'Unreleased Gem', artist: 'Mystery Artist' },
    mockLibrary
  );
  assert.strictEqual(res4.available, false);
  assert.strictEqual(res4.matchType, 'none');
  assert.ok(res4.reason.includes('not available'));
});
