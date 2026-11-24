import assert from 'node:assert/strict';
import {
  mergePlaylistTracksWithPending,
  pickFeaturedMostListenedPlaylist,
  pickTopPlayedTracksInPlaylist,
  pickTopPlayedTracksOverall
} from '../src/services/libraryRankingLogic.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    throw err;
  }
}

console.log('Running Library Ranking & Add-to-Playlist Sync tests...');

runTest('Featured Playlist picks user most-listened playlist over larger unplayed playlist', () => {
  const playlists = [
    {
      id: 'pl_big',
      name: 'Huge Archive',
      tracks: Array.from({ length: 10 }, (_, i) => ({ id: `big_${i}`, title: `Song ${i}`, artist: 'Artist A', artworkUrl: `https://a/${i}.jpg` }))
    },
    {
      id: 'pl_fav',
      name: 'Vaarav Night Drive',
      tracks: [
        { id: 't1', title: 'After Hours', artist: 'The Weeknd', artworkUrl: 'https://a/ah.jpg' },
        { id: 't2', title: 'Nangs', artist: 'Tame Impala', artworkUrl: 'https://a/nangs.jpg' }
      ]
    }
  ];
  const events = [
    { trackId: 't1', title: 'After Hours', artist: 'The Weeknd', listenDurationSec: 200, eventType: 'complete' },
    { trackId: 't1', title: 'After Hours', artist: 'The Weeknd', listenDurationSec: 180, eventType: 'complete' },
    { trackId: 't2', title: 'Nangs', artist: 'Tame Impala', listenDurationSec: 105, eventType: 'complete' }
  ];

  const picked = pickFeaturedMostListenedPlaylist(playlists, events);
  assert.equal(picked.playlist?.id, 'pl_fav');
  assert.equal(picked.totalPlays, 3);
  assert.equal(picked.isFromListeningHistory, true);
});

runTest('Top-Played Easter Egg carousels deduplicate album covers and prioritize most-listened tracks', () => {
  const tracks = [
    { id: 'a1', title: 'Heartless', artist: 'The Weeknd', artworkUrl: 'https://img/afterhours.jpg' },
    { id: 'a2', title: 'Blinding Lights', artist: 'The Weeknd', artworkUrl: 'https://img/afterhours.jpg' },
    { id: 'b1', title: 'Starboy', artist: 'The Weeknd', artworkUrl: 'https://img/starboy.jpg' },
    { id: 'c1', title: 'Nangs', artist: 'Tame Impala', artworkUrl: 'https://img/currents.jpg' }
  ];
  const events = [
    { trackId: 'c1', title: 'Nangs', artist: 'Tame Impala', listenDurationSec: 100, eventType: 'complete' },
    { trackId: 'c1', title: 'Nangs', artist: 'Tame Impala', listenDurationSec: 100, eventType: 'complete' },
    { trackId: 'b1', title: 'Starboy', artist: 'The Weeknd', listenDurationSec: 220, eventType: 'complete' }
  ];

  const inPl = pickTopPlayedTracksInPlaylist(tracks, events, 5);
  assert.equal(inPl.length, 3, 'Duplicate After Hours artwork must only appear once');
  assert.equal(inPl[0].id, 'c1');
  assert.equal(inPl[1].id, 'b1');

  const overall = pickTopPlayedTracksOverall([{ tracks }], [], events, 5);
  assert.equal(overall[0].id, 'c1');
  assert.equal(overall.length, 3);
});

runTest('add-to-playlist pending guard prevents stale Firestore snapshots from wiping freshly added tracks', () => {
  const cloudBeforeWrite = [
    { id: 't1', title: 'Old Song', artist: 'Artist 1' }
  ];
  const freshlyAdded = [
    { id: 't2', title: 'Just Added Song', artist: 'Artist 2' }
  ];

  const afterStaleSnapshot = mergePlaylistTracksWithPending(cloudBeforeWrite, freshlyAdded, new Set());
  assert.deepEqual(afterStaleSnapshot.mergedTracks.map(t => t.id), ['t1', 't2']);
  assert.equal(afterStaleSnapshot.remainingAdds.length, 1, 'Pending guard remains until cloud catches up');

  // Once cloud snapshot includes t2, pending guard clears cleanly without duplicating t2
  const cloudAfterWrite = [
    { id: 't1', title: 'Old Song', artist: 'Artist 1' },
    { id: 't2', title: 'Just Added Song', artist: 'Artist 2' }
  ];
  const afterFreshSnapshot = mergePlaylistTracksWithPending(cloudAfterWrite, freshlyAdded, new Set());
  assert.deepEqual(afterFreshSnapshot.mergedTracks.map(t => t.id), ['t1', 't2']);
  assert.equal(afterFreshSnapshot.remainingAdds.length, 0);
});

runTest('pending removal guard prevents stale Firestore snapshots from resurrecting deleted tracks', () => {
  const staleCloud = [
    { id: 't1', title: 'Keep Me', artist: 'A' },
    { id: 't2', title: 'Deleted Song', artist: 'B' }
  ];
  const res = mergePlaylistTracksWithPending(staleCloud, [], new Set(['t2']));
  assert.deepEqual(res.mergedTracks.map(t => t.id), ['t1']);
  assert.ok(res.remainingRemovalIds.has('t2'));
});

console.log('ALL LIBRARY RANKING & SYNC TESTS PASSED!');
