import assert from 'node:assert/strict';
import { computeTasteCompatibility } from '../src/services/tasteCompatibility.ts';
import { aggregateListeningEvents, formatListeningDuration } from '../src/services/listeningStatsLogic.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    throw err;
  }
}

console.log('Running Taste Compatibility & Listening Stats tests...');

// --- Taste Compatibility Tests ---

runTest('returns 0% and hasEnoughData=false when friend has 0 tracks and 0 ratings', () => {
  const res = computeTasteCompatibility({
    myTracks: [
      { id: '1', title: 'Nangs', artist: 'Tame Impala' },
      { id: '2', title: 'Starboy', artist: 'The Weeknd' }
    ],
    myRatings: { '1': '9.5' },
    friendTracks: [],
    friendRatings: {}
  });
  assert.equal(res.score, 0);
  assert.equal(res.hasEnoughData, false);
  assert.equal(res.matchedSongCount, 0);
  assert.deepEqual(res.matchedSongs, []);
  assert.deepEqual(res.sharedArtists, []);
});

runTest('returns 0% and NEVER injects own songs when both have tracks but zero overlap', () => {
  const res = computeTasteCompatibility({
    myTracks: [
      { id: '1', title: 'Nangs', artist: 'Tame Impala' },
      { id: '2', title: 'Starboy', artist: 'The Weeknd' }
    ],
    friendTracks: [
      { id: '3', title: 'Bohemian Rhapsody', artist: 'Queen' },
      { id: '4', title: 'Hotel California', artist: 'Eagles' }
    ]
  });
  assert.equal(res.score, 0);
  assert.equal(res.hasEnoughData, true);
  assert.equal(res.matchedSongCount, 0);
  assert.equal(res.matchedSongs.length, 0);
  assert.equal(res.sharedArtists.length, 0);
});

runTest('computes high honest score when libraries and ratings strongly overlap', () => {
  const shared = [
    { id: 't1', title: 'Let It Happen', artist: 'Tame Impala' },
    { id: 't2', title: 'Blinding Lights', artist: 'The Weeknd' },
    { id: 't3', title: 'Instant Crush', artist: 'Daft Punk' },
    { id: 't4', title: 'Borderline', artist: 'Tame Impala' },
    { id: 't5', title: 'Starboy (feat. Daft Punk)', artist: 'The Weeknd' }
  ];
  const res = computeTasteCompatibility({
    myTracks: shared,
    myRatings: { t1: '9.5', t2: '9.0' },
    friendTracks: shared,
    friendRatings: { t1: '9.2', t2: '8.8' }
  });
  assert.equal(res.hasEnoughData, true);
  assert.equal(res.matchedSongCount, 5);
  assert.ok(res.score >= 85, `Expected score >= 85, got ${res.score}`);
  assert.equal(res.mutualRatedCount, 2);
  assert.ok((res.ratingAgreementPercent || 0) >= 95);
});

runTest('handles partial artist overlap without fake 70%+ floor', () => {
  const res = computeTasteCompatibility({
    myTracks: [
      { id: 'a1', title: 'Nangs', artist: 'Tame Impala' },
      { id: 'a2', title: 'Starboy', artist: 'The Weeknd' },
      { id: 'a3', title: 'Creep', artist: 'Radiohead' },
      { id: 'a4', title: 'Do I Wanna Know', artist: 'Arctic Monkeys' }
    ],
    friendTracks: [
      { id: 'b1', title: 'Elephant', artist: 'Tame Impala' },
      { id: 'b2', title: 'Yellow', artist: 'Coldplay' },
      { id: 'b3', title: 'Dreams', artist: 'Fleetwood Mac' },
      { id: 'b4', title: 'Clocks', artist: 'Coldplay' }
    ]
  });
  assert.equal(res.matchedSongCount, 0);
  assert.deepEqual(res.sharedArtists, ['Tame Impala']);
  assert.ok(res.score > 0 && res.score < 35, `Expected realistic low-moderate score, got ${res.score}`);
});

// --- Listening Stats Tests ---

runTest('counts both completed and meaningful partial ("play") events without artificial duration inflation', () => {
  const now = Date.now();
  const res = aggregateListeningEvents({
    events: [
      { trackId: 's1', title: 'Nangs', artist: 'Tame Impala', eventType: 'complete', listenDurationSec: 108, totalDurationSec: 108, timestamp: now - 1000 },
      { trackId: 's2', title: 'Starboy', artist: 'The Weeknd', eventType: 'play', listenDurationSec: 45, totalDurationSec: 230, timestamp: now - 500 },
      { trackId: 's3', title: 'Accidental Tap', artist: 'Skip Artist', eventType: 'play', listenDurationSec: 2, totalDurationSec: 200, timestamp: now - 100 }
    ],
    window: '30d',
    nowMs: now
  });

  // Both s1 (complete) and s2 (45s 'play') count! s3 (2s accidental skip) is ignored.
  assert.equal(res.summary.total_plays, 2);
  assert.equal(res.summary.qualified_plays, 2);
  assert.equal(res.summary.total_listening_duration_seconds, 153); // Exact 108 + 45, NOT 2 * 200 = 400!
  assert.equal(res.summary.total_listening_duration_formatted, '2m');
  assert.equal(res.top_songs.length, 2);
  assert.equal(res.top_artists.length, 2);
});

runTest('empty listening log reports 0 plays, 0m duration, and 0% completion rate (not 100%)', () => {
  const res = aggregateListeningEvents({
    events: [],
    window: '30d'
  });
  assert.equal(res.summary.total_plays, 0);
  assert.equal(res.summary.qualified_plays, 0);
  assert.equal(res.summary.total_listening_duration_formatted, '0m');
  assert.equal(res.summary.completion_rate_percent, 0);
});

runTest('formatListeningDuration formats 0s, sub-minute, minutes, and hours cleanly', () => {
  assert.equal(formatListeningDuration(0), '0m');
  assert.equal(formatListeningDuration(35), '<1m');
  assert.equal(formatListeningDuration(180), '3m');
  assert.equal(formatListeningDuration(3720), '1h 2m');
});

console.log('All Taste Compatibility & Listening Stats tests passed!');
