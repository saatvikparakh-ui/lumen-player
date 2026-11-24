import assert from 'node:assert/strict';
import {
  buildArtistRanking,
  buildPlayQueueFromRanking,
  classifyArtistCredit,
  disambiguateArtistCandidate,
  parseCompactPlayCount,
  purgeLegacyArtistCaches,
  resolveRankedTracksPreservingOrder
} from '../src/services/artistRankingLogic.ts';

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    throw err;
  }
}

console.log('Running Artist Ranking & Disambiguation tests...');

await runTest('deduplicates identical single/album/deluxe recordings while keeping distinct remixes & live versions', () => {
  const res = buildArtistRanking({
    artistName: 'The Weeknd',
    provider: 'youtube_music',
    rawTracks: [
      { id: '1', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200, playCountDisplay: '3.7B plays', sourcePosition: 1, rawProvider: 'youtube_music' },
      { id: '2', title: 'Blinding Lights (Deluxe Edition)', artist: 'The Weeknd', album: 'After Hours (Deluxe)', duration: 201, playCountDisplay: '420M plays', sourcePosition: 2, rawProvider: 'youtube_music' },
      { id: '3', title: 'Save Your Tears', artist: 'The Weeknd', album: 'After Hours', duration: 216, playCountDisplay: '3.4B plays', sourcePosition: 3, rawProvider: 'youtube_music' },
      { id: '4', title: 'Save Your Tears (Remix)', artist: 'The Weeknd & Ariana Grande', album: 'Save Your Tears (Remix)', duration: 191, playCountDisplay: '1.9B plays', sourcePosition: 4, rawProvider: 'youtube_music' },
      { id: '5', title: 'Save Your Tears (Live)', artist: 'The Weeknd', album: 'Live at SoFi', duration: 225, playCountDisplay: '120M plays', sourcePosition: 5, rawProvider: 'youtube_music' }
    ]
  });

  const titles = res.rankedTracks.map(t => t.title);
  assert.equal(titles.filter(t => t.startsWith('Blinding Lights')).length, 1, 'Second Blinding Lights copy should be merged');
  assert.ok(titles.includes('Save Your Tears'), 'Studio Save Your Tears kept');
  assert.ok(titles.includes('Save Your Tears (Remix)'), 'Distinct Remix kept');
  assert.ok(titles.includes('Save Your Tears (Live)'), 'Distinct Live recording kept');
  assert.equal(res.meta.deduplicatedCount, 1);
  assert.equal(res.meta.heading, 'Most streamed on YouTube Music');
  assert.equal(res.meta.scope, 'Worldwide · All time');
  assert.deepEqual(res.rankedTracks.map(t => t.displayRank), [1, 2, 3, 4]);
});

await runTest('deduplicates by authoritative ISRC even when titles differ slightly', () => {
  const res = buildArtistRanking({
    artistName: 'The Weeknd',
    provider: 'youtube_music',
    rawTracks: [
      { id: 'a', title: 'Starboy (feat. Daft Punk)', artist: 'The Weeknd', isrc: 'USUG11600976', playCountDisplay: '4.1B plays', sourcePosition: 1, rawProvider: 'youtube_music' },
      { id: 'b', title: 'Starboy - Album Version', artist: 'The Weeknd', isrc: 'usug11600976', playCountDisplay: '900M plays', sourcePosition: 2, rawProvider: 'youtube_music' }
    ]
  });
  assert.equal(res.rankedTracks.length, 1);
  assert.equal(res.rankedTracks[0].id, 'a');
});

await runTest('keeps co-primary collaborations in main collection and moves featured-only credits to Appears on with explanation', () => {
  assert.equal(classifyArtistCredit('The Weeknd', 'The Weeknd & Ariana Grande', 'Die For You (Remix)'), 'primary');
  assert.equal(classifyArtistCredit('The Weeknd', 'Swedish House Mafia & The Weeknd', 'Moth To A Flame'), 'co_primary');
  assert.equal(classifyArtistCredit('The Weeknd', 'Travis Scott feat. The Weeknd', 'WAKE UP'), 'featured_only');
  assert.equal(classifyArtistCredit('The Weeknd', 'Metro Boomin', "Creepin' (feat. The Weeknd)"), 'featured_only');

  const res = buildArtistRanking({
    artistName: 'The Weeknd',
    provider: 'youtube_music',
    rawTracks: [
      { id: 'p1', title: 'Moth To A Flame', artist: 'Swedish House Mafia & The Weeknd', playCountDisplay: '462M plays', sourcePosition: 1, rawProvider: 'youtube_music' },
      { id: 'f1', title: 'WAKE UP', artist: 'Travis Scott feat. The Weeknd', playCountDisplay: '520M plays', sourcePosition: 2, rawProvider: 'youtube_music' },
      { id: 'p2', title: 'The Hills', artist: 'The Weeknd', playCountDisplay: '2.8B plays', sourcePosition: 3, rawProvider: 'youtube_music' }
    ]
  });

  assert.deepEqual(res.rankedTracks.map(t => t.id), ['p2', 'p1']);
  assert.equal(res.rankedTracks[0].sourcePosition, 3);
  assert.equal(res.rankedTracks[0].displayRank, 1);
  assert.deepEqual(res.appearsOnTracks.map(t => t.id), ['f1']);
  assert.ok(res.meta.filterExplanation?.includes('featured-only'));
});

await runTest('disambiguates same-name artists via carried provider ID and track/album hints', () => {
  const candidates = [
    { id: 'artist_111', name: 'Aurora', subscriberCount: 10000, sampleTracks: ['Ambient Sleep'], sampleAlbums: ['Sleep Vol 1'] },
    { id: 'artist_222', name: 'AURORA', subscriberCount: 4500000, sampleTracks: ['Runaway', 'Cure For Me'], sampleAlbums: ['All My Demons Greeting Me as a Friend'] }
  ];

  // Track hint disambiguates cleanly even without ID
  const byTrack = disambiguateArtistCandidate(candidates, { name: 'Aurora', trackTitle: 'Runaway' });
  assert.equal(byTrack?.id, 'artist_222');

  // Carried provider artist ID wins unconditionally even if smaller artist
  const byId = disambiguateArtistCandidate(candidates, { name: 'Aurora', artistId: 'artist_111', trackTitle: 'Runaway' });
  assert.equal(byId?.id, 'artist_111');
});

await runTest('preserves provider ordering when ranking provider has no numeric global play counts (JioSaavn)', () => {
  const res = buildArtistRanking({
    artistName: 'Arijit Singh',
    provider: 'jiosaavn',
    rawTracks: [
      { id: 'j1', title: 'Tum Hi Ho', artist: 'Arijit Singh', sourcePosition: 1, rawProvider: 'jiosaavn' },
      { id: 'j2', title: 'Kesariya', artist: 'Arijit Singh', sourcePosition: 2, rawProvider: 'jiosaavn' },
      { id: 'j3', title: 'Apna Bana Le', artist: 'Arijit Singh', sourcePosition: 3, rawProvider: 'jiosaavn' }
    ]
  });
  assert.equal(res.meta.heading, 'Popular on JioSaavn');
  assert.equal(res.meta.isRanked, true);
  assert.deepEqual(res.rankedTracks.map(t => t.id), ['j1', 'j2', 'j3']);
  assert.equal(res.rankedTracks[0].playCountDisplay, null, 'Must never fabricate stream counts');
});

await runTest('missing ranking data falls back honestly to catalog-only view with rank numbers omitted', () => {
  const res = buildArtistRanking({
    artistName: 'Indie Local Band',
    provider: 'itunes_catalog',
    rawTracks: [
      { id: 'c1', title: 'Opening Song', artist: 'Indie Local Band', sourcePosition: 1, rawProvider: 'itunes_catalog' },
      { id: 'c2', title: 'Second Song', artist: 'Indie Local Band', sourcePosition: 2, rawProvider: 'itunes_catalog' }
    ]
  });
  assert.equal(res.meta.heading, 'Songs by Indie Local Band');
  assert.equal(res.meta.isRanked, false);
  assert.deepEqual(res.rankedTracks.map(t => t.displayRank), [null, null]);
});

await runTest('async playable resolution preserves chart order, marks unavailable without cover substitution, and supports rapid A->B abort', async () => {
  const res = buildArtistRanking({
    artistName: 'The Weeknd',
    provider: 'youtube_music',
    rawTracks: [
      { id: 'r1', title: 'Starboy', artist: 'The Weeknd', playCountDisplay: '4.1B plays', sourcePosition: 1, rawProvider: 'youtube_music' },
      { id: 'r2', title: 'Blinding Lights', artist: 'The Weeknd', playCountDisplay: '3.7B plays', sourcePosition: 2, rawProvider: 'youtube_music' },
      { id: 'r3', title: 'Rare Demo', artist: 'The Weeknd', playCountDisplay: '10M plays', sourcePosition: 3, rawProvider: 'youtube_music' }
    ]
  });

  // Intentionally finish #2 BEFORE #1 to verify order is strictly preserved
  const resolved = await resolveRankedTracksPreservingOrder(res.rankedTracks, async (entry) => {
    await new Promise(r => setTimeout(r, entry.id === 'r1' ? 30 : 5));
    if (entry.id === 'r3') return { playable: false, unavailableReason: 'Region restricted' };
    return { playable: true, streamUrl: `/stream/${entry.id}` };
  });

  assert.deepEqual(resolved.map(t => t.id), ['r1', 'r2', 'r3']);
  assert.equal(resolved[2].isPlayable, false);

  // Verify Play follows exact displayed order & Shuffle uses exact same eligible playable set
  const playQ = buildPlayQueueFromRanking(resolved, { shuffle: false });
  assert.deepEqual(playQ.map(t => t.id), ['r1', 'r2']);
  const shuffleQ = buildPlayQueueFromRanking(resolved, { shuffle: true, randomFn: () => 0.1 });
  assert.deepEqual(new Set(shuffleQ.map(t => t.id)), new Set(['r1', 'r2']));
  assert.equal(shuffleQ.length, playQ.length);

  // Rapid A -> B abort test
  const ac = new AbortController();
  ac.abort();
  const aborted = await resolveRankedTracksPreservingOrder(res.rankedTracks, async () => {
    throw new Error('Should not resolve when aborted');
  }, ac.signal);
  assert.equal(aborted.length, 3);
});

await runTest('purges legacy pre-v2 artist cache keys while keeping v2 keys intact', () => {
  const store = new Map<string, string>([
    ['lumen_artist_discog_theweeknd', '{}'],
    ['lumen_artist_ranking_v1:theweeknd', '{}'],
    ['lumen_artist_ranking_v2:ytm:theweeknd:GLOBAL:all_time', '{"schemaVersion":2}']
  ]);
  const mockStorage = {
    get length() { return store.size; },
    key(i: number) { return Array.from(store.keys())[i] ?? null; },
    removeItem(k: string) { store.delete(k); }
  };
  const purged = purgeLegacyArtistCaches(mockStorage);
  assert.equal(purged, 2);
  assert.equal(store.size, 1);
  assert.ok(store.has('lumen_artist_ranking_v2:ytm:theweeknd:GLOBAL:all_time'));
});

await runTest('parseCompactPlayCount parses B/M/K/comma numbers accurately', () => {
  assert.equal(parseCompactPlayCount('4.1B plays'), 4_100_000_000);
  assert.equal(parseCompactPlayCount('684M plays'), 684_000_000);
  assert.equal(parseCompactPlayCount('12.5K plays'), 12_500);
  assert.equal(parseCompactPlayCount('unranked'), null);
});

console.log('ALL ARTIST RANKING TESTS PASSED!');
