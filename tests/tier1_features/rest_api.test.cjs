'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Helper to make local HTTP requests to a server
function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

test('REST API: Ratings, Playback Events, Stats, Friends, Comparison, and Sync', async (t) => {
  // Let's spawn an ephemeral server using the handlers in server.cjs or by running server
  // Or test the handlers directly.
  // We can require server.cjs or test against the running server if listening, or create an ephemeral test server.
  const dbModule = require('../../server/db.cjs');
  const ratingsModule = require('../../server/ratings.cjs');
  const analyticsModule = require('../../server/analytics.cjs');
  const friendsModule = require('../../server/friends.cjs');
  const comparisonModule = require('../../server/comparison.cjs');
  const syncModule = require('../../server/sync.cjs');

  // Verify direct modules integrate seamlessly
  const db = dbModule.createTestDb();
  dbModule.setDb(db);

  // 1. User setup
  db.prepare('INSERT INTO users (user_id, username, rating_visibility, created_at) VALUES (?, ?, ?, ?)')
    .run('u_tester', 'tester', 'friends', Date.now());
  db.prepare('INSERT INTO users (user_id, username, rating_visibility, created_at) VALUES (?, ?, ?, ?)')
    .run('u_pal', 'pal', 'friends', Date.now());

  // 2. Song setup
  db.prepare('INSERT INTO songs (song_id, title, artist, album, duration) VALUES (?, ?, ?, ?, ?)')
    .run('song_rest_1', 'Midnight Drive', 'Neon Synth', 'Synthwave Hits', 210.0);

  // 3. Ratings CRUD
  const rSet = ratingsModule.setRating('u_tester', 'song_rest_1', 9.2);
  assert.strictEqual(rSet.rating_tenths, 92);
  assert.strictEqual(rSet.formatted, '9.2');

  const rGet = ratingsModule.getRating('u_tester', 'song_rest_1');
  assert.strictEqual(rGet.formatted, '9.2');

  // 4. Playback event
  const pEvent = analyticsModule.recordPlaybackEvent({
    userId: 'u_tester',
    songId: 'song_rest_1',
    listenedDurationSeconds: 190.0,
    completionStatus: 'completed'
  });
  assert.strictEqual(pEvent.qualified, true);

  // 5. Stats
  const stats = analyticsModule.getListeningStats('u_tester', '30d');
  assert.strictEqual(stats.top_songs[0].song_id, 'song_rest_1');
  assert.strictEqual(stats.top_songs[0].play_count, 1);
  assert.strictEqual(stats.rating_stats.highest_rated[0].formatted, '9.2');

  // 6. Friends & Comparison
  friendsModule.sendFriendRequest('u_tester', 'pal');
  friendsModule.respondFriendRequest('u_pal', 'u_tester', 'accepted');
  ratingsModule.setRating('u_pal', 'song_rest_1', 8.0);

  const cmp = comparisonModule.compareSong('u_tester', 'u_pal', 'song_rest_1');
  assert.strictEqual(cmp.user_a_rating, '9.2');
  assert.strictEqual(cmp.user_b_rating, '8.0');
  assert.strictEqual(cmp.difference, '1.2');

  // 7. Sync
  const syncRes = syncModule.applySyncBatch('u_tester', {
    ratings: [
      { user_id: 'u_tester', song_id: 'song_rest_1', rating_tenths: 95, rated_at: Date.now() + 10000 }
    ]
  });
  assert.strictEqual(syncRes.applied, 1);
  assert.strictEqual(ratingsModule.getRating('u_tester', 'song_rest_1').formatted, '9.5');

  // 8. Friends & Listening: Song Sharing
  const sharingModule = require('../../server/sharing.cjs');
  const share = sharingModule.createShare({
    sender_id: 'u_tester',
    recipient_id: 'u_pal',
    song: { id: 'song_rest_1', title: 'REST Track', artist: 'Tester Artist', streamUrl: '/api/stream/resolve?title=REST%20Track' },
    message: 'Awesome track!'
  }, db);
  assert.ok(share.share_id);
  assert.strictEqual(share.sender_id, 'u_tester');
  assert.strictEqual(share.recipient_id, 'u_pal');

  const recList = sharingModule.getReceivedShares('u_pal', {}, db);
  assert.strictEqual(recList.length, 1);
  assert.strictEqual(recList[0].title, 'REST Track');
  assert.strictEqual(recList[0].is_read, false);

  sharingModule.markShareRead(share.share_id, 'u_pal', db);
  const unreadOnly = sharingModule.getReceivedShares('u_pal', { unreadOnly: true }, db);
  assert.strictEqual(unreadOnly.length, 0);

  const sentList = sharingModule.getSentShares('u_tester', db);
  assert.strictEqual(sentList.length, 1);
  assert.strictEqual(sentList[0].recipient_username, 'pal');
});
