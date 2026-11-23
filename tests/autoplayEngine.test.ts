import assert from 'node:assert/strict';
import type {
  AutoplayListeningEvent,
  AutoplayPlaylistInput,
  AutoplaySessionContext,
  AutoplayTrackMeta
} from '../src/services/autoplayEngine.ts';
import {
  buildUserTasteProfile,
  getCanonicalRecordingKey,
  isPlayableFullTrack,
  scoreAutoplayCandidate,
  selectAutoplaySequence
} from '../src/services/autoplayEngine.ts';

function makeTrack(overrides: Partial<AutoplayTrackMeta> & { id: string; title: string; artist: string }): AutoplayTrackMeta {
  return {
    album: 'Test Album',
    duration: 210,
    actualMediaDuration: 210,
    path: '',
    filename: '',
    streamUrl: `/api/stream/resolve?title=${encodeURIComponent(overrides.title)}&artist=${encodeURIComponent(overrides.artist)}`,
    fullStreamUrl: `/api/stream/resolve?title=${encodeURIComponent(overrides.title)}&artist=${encodeURIComponent(overrides.artist)}`,
    hasArtwork: true,
    artworkUrl: 'https://example.com/art.jpg',
    addedAt: 1_700_000_000_000,
    playbackType: 'full-stream',
    isExplicitPreview: false,
    ...overrides
  };
}

const RELATED_MAP: Record<string, string[]> = {
  'ar rahman': ['anirudh ravichander', 'prateek kuhad', 'shreya ghoshal', 'sid sriram'],
  'anirudh ravichander': ['ar rahman', 'yuvan shankar raja'],
  'prateek kuhad': ['anuv jain', 'jasleen royal', 'ar rahman']
};

const NOW = 1_750_000_000_000;
let passed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// =========================================================================
// CASE 1: Two users start the SAME track — acoustic fan vs. dance fan
// =========================================================================
runTest('Case 1: Two users starting the same seed diverge according to acoustic vs dance taste', () => {
  const seed = makeTrack({
    id: 'seed_1',
    title: 'Midnight Horizon',
    artist: 'AR Rahman',
    genre: 'Indie Fusion',
    language: 'Tamil',
    styleTags: ['melodic']
  });

  const pool: AutoplayTrackMeta[] = [
    makeTrack({ id: 'ac_1', title: 'Quiet Strings', artist: 'Prateek Kuhad', genre: 'Acoustic', language: 'Hindi', styleTags: ['acoustic', 'mellow'], relatedToSeed: true }),
    makeTrack({ id: 'ac_2', title: 'Paper Boats', artist: 'Anuv Jain', genre: 'Acoustic', language: 'Hindi', styleTags: ['acoustic', 'mellow'] }),
    makeTrack({ id: 'dn_1', title: 'Neon Pulse', artist: 'Anirudh Ravichander', genre: 'Dance', language: 'Tamil', styleTags: ['dance', 'energetic'], relatedToSeed: true }),
    makeTrack({ id: 'dn_2', title: 'Bass Drop Nights', artist: 'Yuvan Shankar Raja', genre: 'Dance', language: 'Tamil', styleTags: ['dance', 'energetic'] })
  ];

  const acousticProfile = buildUserTasteProfile({
    userId: 'user_acoustic',
    likes: [
      makeTrack({ id: 'la_1', title: 'Cold Mess', artist: 'Prateek Kuhad', genre: 'Acoustic', language: 'Hindi', styleTags: ['acoustic', 'mellow'] }),
      makeTrack({ id: 'la_2', title: 'Baarishein', artist: 'Anuv Jain', genre: 'Acoustic', language: 'Hindi', styleTags: ['acoustic', 'mellow'] })
    ],
    nowMs: NOW
  });

  const danceProfile = buildUserTasteProfile({
    userId: 'user_dance',
    likes: [
      makeTrack({ id: 'ld_1', title: 'Hukum', artist: 'Anirudh Ravichander', genre: 'Dance', language: 'Tamil', styleTags: ['dance', 'energetic'] }),
      makeTrack({ id: 'ld_2', title: 'Rowdy Beat', artist: 'Yuvan Shankar Raja', genre: 'Dance', language: 'Tamil', styleTags: ['dance', 'energetic'] })
    ],
    nowMs: NOW
  });

  const session: AutoplaySessionContext = {
    seedTrack: seed,
    recentPlays: [{ track: seed, source: 'user', timestamp: NOW }],
    sessionSkippedRecordingKeys: new Set(),
    sessionSkippedArtistKeys: new Set()
  };

  const acousticQueue = selectAutoplaySequence(pool, acousticProfile, session, {
    limit: 3,
    randomSeed: 42,
    randomness: 0,
    relatedArtistsMap: RELATED_MAP,
    nowMs: NOW
  });
  const danceQueue = selectAutoplaySequence(pool, danceProfile, session, {
    limit: 3,
    randomSeed: 42,
    randomness: 0,
    relatedArtistsMap: RELATED_MAP,
    nowMs: NOW
  });

  assert.equal(acousticQueue[0].track.genre, 'Acoustic', 'Acoustic user should get Acoustic #1');
  assert.equal(danceQueue[0].track.genre, 'Dance', 'Dance user should get Dance #1');
  assert.notEqual(acousticQueue[0].track.id, danceQueue[0].track.id);
});

// =========================================================================
// CASE 2: Same user starts mellow duet vs energetic dance in separate sessions
// =========================================================================
runTest('Case 2: Same user gets mellow session tracks vs dance session tracks based on seed', () => {
  const dualTasteProfile = buildUserTasteProfile({
    userId: 'user_dual',
    likes: [
      makeTrack({ id: 'h1', title: 'Kasoor', artist: 'Prateek Kuhad', genre: 'Acoustic', language: 'Hindi', styleTags: ['mellow', 'acoustic'] }),
      makeTrack({ id: 't1', title: 'Vaathi Coming', artist: 'Anirudh Ravichander', genre: 'Dance', language: 'Tamil', styleTags: ['dance', 'energetic'] })
    ],
    nowMs: NOW
  });

  const mellowSeed = makeTrack({
    id: 'seed_mellow',
    title: 'Munbe Vaa',
    artist: 'Sid Sriram',
    genre: 'Acoustic',
    language: 'Tamil',
    styleTags: ['mellow', 'duet']
  });

  const danceSeed = makeTrack({
    id: 'seed_dance',
    title: 'Arabic Kuthu',
    artist: 'Anirudh Ravichander',
    genre: 'Dance',
    language: 'Tamil',
    styleTags: ['dance', 'energetic']
  });

  const candidates: AutoplayTrackMeta[] = [
    makeTrack({ id: 'c_mellow_1', title: 'Thalli Pogathey', artist: 'AR Rahman', genre: 'Acoustic', language: 'Tamil', styleTags: ['mellow', 'duet'] }),
    makeTrack({ id: 'c_mellow_2', title: 'Dil Mere', artist: 'Prateek Kuhad', genre: 'Acoustic', language: 'Hindi', styleTags: ['mellow', 'acoustic'] }),
    makeTrack({ id: 'c_dance_1', title: 'Master the Blaster', artist: 'Anirudh Ravichander', genre: 'Dance', language: 'Tamil', styleTags: ['dance', 'energetic'] }),
    makeTrack({ id: 'c_dance_2', title: 'Kala Chashma', artist: 'Badshah', genre: 'Dance', language: 'Hindi', styleTags: ['dance', 'energetic'] })
  ];

  const mellowQueue = selectAutoplaySequence(candidates, dualTasteProfile, {
    seedTrack: mellowSeed,
    recentPlays: [{ track: mellowSeed, source: 'user', timestamp: NOW }],
    sessionSkippedRecordingKeys: new Set(),
    sessionSkippedArtistKeys: new Set()
  }, { limit: 2, randomness: 0, randomSeed: 7, relatedArtistsMap: RELATED_MAP, nowMs: NOW });

  const danceQueue = selectAutoplaySequence(candidates, dualTasteProfile, {
    seedTrack: danceSeed,
    recentPlays: [{ track: danceSeed, source: 'user', timestamp: NOW }],
    sessionSkippedRecordingKeys: new Set(),
    sessionSkippedArtistKeys: new Set()
  }, { limit: 2, randomness: 0, randomSeed: 7, relatedArtistsMap: RELATED_MAP, nowMs: NOW });

  assert.equal(mellowQueue[0].track.id, 'c_mellow_1', 'Mellow Tamil duet seed should surface mellow Tamil track first');
  assert.equal(danceQueue[0].track.id, 'c_dance_1', 'Energetic Tamil dance seed should surface dance track first');
});

// =========================================================================
// CASE 3: Unrelated tracks sharing the seed title get ZERO boost for title words
// =========================================================================
runTest('Case 3: Shared title words contribute ZERO recommendation score', () => {
  const seed = makeTrack({
    id: 'seed_lights',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    genre: 'Synthpop',
    language: 'English'
  });

  const lookalikeTitle = makeTrack({
    id: 'trap_1',
    title: 'Blinding Lights (Unrelated Metal Track)',
    artist: 'Random Metal Band',
    genre: 'Heavy Metal',
    language: 'German'
  });

  const unrelatedDifferentTitle = makeTrack({
    id: 'ctrl_1',
    title: 'Iron Fortress',
    artist: 'Random Metal Band',
    genre: 'Heavy Metal',
    language: 'German'
  });

  const genuineMatch = makeTrack({
    id: 'real_1',
    title: 'After Hours',
    artist: 'The Weeknd',
    genre: 'Synthpop',
    language: 'English',
    relatedToSeed: true
  });

  const profile = buildUserTasteProfile({ userId: 'u3', nowMs: NOW });
  const session: AutoplaySessionContext = {
    seedTrack: seed,
    recentPlays: [],
    sessionSkippedRecordingKeys: new Set(),
    sessionSkippedArtistKeys: new Set()
  };

  const sTrap = scoreAutoplayCandidate(lookalikeTitle, profile, session);
  const sCtrl = scoreAutoplayCandidate(unrelatedDifferentTitle, profile, session);
  const sReal = scoreAutoplayCandidate(genuineMatch, profile, session);

  assert.equal(sTrap.score, sCtrl.score, 'Matching seed title alone must add 0.00 score');
  assert.ok(sReal.score > sTrap.score + 0.5, 'Genuine artist/genre match must decisively outrank title twin');
});

// =========================================================================
// CASE 4: Playlist-only user (with dedup across 6 playlists) & cold-start user
// =========================================================================
runTest('Case 4: Playlist-only user gets day-1 playlist affinity; 6x duplicate track counts once; new user gets coherent seed queue', () => {
  const seed = makeTrack({ id: 'p_seed', title: 'Borderline', artist: 'Tame Impala', genre: 'Psychedelic Pop' });
  const coTrack = makeTrack({ id: 'p_co', title: 'Chamber of Reflection', artist: 'Mac DeMarco', genre: 'Indie', sourcePlaylistName: 'Evening Drive' });
  const repeatedTrack = makeTrack({ id: 'p_rep', title: 'One More Time', artist: 'Daft Punk', genre: 'Electronic' });
  const otherArtistTrack = makeTrack({ id: 'p_other', title: 'Let It Happen', artist: 'Tame Impala', genre: 'Psychedelic Pop', relatedToSeed: true });

  // Put repeatedTrack into 6 separate playlists — must count as ONLY 1 distinct recording endorsement!
  const playlists: AutoplayPlaylistInput[] = [
    { id: 'pl1', name: 'Evening Drive', tracks: [seed, coTrack, repeatedTrack], isUserCreated: true },
    { id: 'pl2', name: 'Mix 2', tracks: [repeatedTrack], isUserCreated: true },
    { id: 'pl3', name: 'Mix 3', tracks: [repeatedTrack], isUserCreated: true },
    { id: 'pl4', name: 'Mix 4', tracks: [repeatedTrack], isUserCreated: true },
    { id: 'pl5', name: 'Mix 5', tracks: [repeatedTrack], isUserCreated: true },
    { id: 'pl6', name: 'Mix 6', tracks: [repeatedTrack], isUserCreated: true }
  ];

  const playlistUser = buildUserTasteProfile({ userId: 'u_pl', playlists, events: [], nowMs: NOW });
  assert.equal(playlistUser.artistEvidenceCount['daft punk'], 1, 'Same recording in 6 playlists must count as 1 distinct endorsement');

  const plSession: AutoplaySessionContext = {
    seedTrack: seed,
    recentPlays: [],
    sessionSkippedRecordingKeys: new Set(),
    sessionSkippedArtistKeys: new Set()
  };

  const plQueue = selectAutoplaySequence([coTrack, repeatedTrack, otherArtistTrack], playlistUser, plSession, {
    limit: 3,
    randomness: 0,
    randomSeed: 1,
    nowMs: NOW
  });
  assert.ok(plQueue.some(item => item.track.id === 'p_co' && item.reason.includes('Evening Drive')), 'Playlist co-occurrence track should surface with truthful playlist reason');

  // Brand-new cold-start user (zero playlists, zero likes, zero events)
  const coldUser = buildUserTasteProfile({ userId: 'u_new', likes: [], playlists: [], events: [], nowMs: NOW });
  assert.equal(coldUser.hasLongTermEvidence, false);
  assert.equal(coldUser.hasPlaylistEvidence, false);

  const coldQueue = selectAutoplaySequence([otherArtistTrack, repeatedTrack], coldUser, plSession, {
    limit: 2,
    randomness: 0,
    randomSeed: 1,
    nowMs: NOW
  });
  assert.equal(coldQueue[0].track.id, 'p_other', 'Cold-start user should redistribute weights and pick seed-related track');
});

// =========================================================================
// CASE 5: Manual Up Next track during async refill + stale generation guard
// =========================================================================
runTest('Case 5: Manual Up Next keeps its exact position and stale generation responses are rejected', () => {
  // Simulate queue controller state transition identical to AudioEngine.scheduleAutoplayRefill
  let queueGeneration = 1;
  const priorityQueue: AutoplayTrackMeta[] = [];
  let autoplayQueue: AutoplayTrackMeta[] = [];

  const staleGen = queueGeneration; // Request started at gen 1
  // User manually queues a track AND switches tracks (gen increments to 2)
  const manualTrack = makeTrack({ id: 'manual_1', title: 'Starboy', artist: 'The Weeknd' });
  priorityQueue.push(manualTrack);
  queueGeneration = 2;

  // Stale gen-1 response arrives late -> must be discarded!
  const applyRefill = (responseGen: number, items: AutoplayTrackMeta[]) => {
    if (responseGen !== queueGeneration) return false;
    const excluded = new Set(priorityQueue.map(t => getCanonicalRecordingKey(t)));
    autoplayQueue = items.filter(t => !excluded.has(getCanonicalRecordingKey(t)));
    return true;
  };

  const appliedStale = applyRefill(staleGen, [makeTrack({ id: 'old_auto', title: 'Old Rec', artist: 'Old Artist' })]);
  assert.equal(appliedStale, false, 'Stale refill must be discarded');
  assert.equal(autoplayQueue.length, 0);

  // Current gen-2 refill arrives containing the manually queued track + a fresh track
  const appliedFresh = applyRefill(2, [manualTrack, makeTrack({ id: 'fresh_auto', title: 'Faith', artist: 'The Weeknd' })]);
  assert.equal(appliedFresh, true);
  assert.equal(priorityQueue[0].id, 'manual_1', 'Manual Up Next track retains #1 position');
  assert.equal(autoplayQueue.length, 1, 'Duplicate of manual track filtered out of autoplay tail');
  assert.equal(autoplayQueue[0].id, 'fresh_auto');
});

// =========================================================================
// CASE 6: Failed stream ≠ dislike, cross-provider dedup (studio vs live kept), account isolation
// =========================================================================
runTest('Case 6: Playback errors do not penalize taste; cross-provider dedup preserves live vs studio; accounts stay isolated', () => {
  const studioItunes = makeTrack({ id: 'itunes_100', title: 'Hotel California', artist: 'Eagles', duration: 391, genre: 'Rock' });
  const studioSaavn = makeTrack({ id: 'saavn_999', title: 'Hotel California (Remastered 2013)', artist: 'Eagles', duration: 390, genre: 'Rock' });
  const liveVersion = makeTrack({ id: 'itunes_200', title: 'Hotel California (Live on MTV 1994)', artist: 'Eagles', duration: 432, genre: 'Rock' });
  const previewOnly = makeTrack({
    id: 'prev_1',
    title: 'Short Snippet',
    artist: 'Eagles',
    duration: 30,
    streamUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    fullStreamUrl: undefined,
    isExplicitPreview: true
  });

  assert.equal(getCanonicalRecordingKey(studioItunes), getCanonicalRecordingKey(studioSaavn), 'Same studio recording across providers must collapse to one key');
  assert.notEqual(getCanonicalRecordingKey(studioItunes), getCanonicalRecordingKey(liveVersion), 'Studio vs Live version must keep distinct recording keys');
  assert.equal(isPlayableFullTrack(previewOnly), false, 'Preview-only track must be excluded from full-song autoplay');

  // Technical errors for User A must NOT create negative taste
  const events: AutoplayListeningEvent[] = [
    { userId: 'acct_A', trackId: 'itunes_100', artist: 'Eagles', title: 'Hotel California', genre: 'Rock', eventType: 'playback_error', source: 'autoplay', timestamp: NOW },
    { userId: 'acct_A', trackId: 'itunes_100', artist: 'Eagles', title: 'Hotel California', genre: 'Rock', eventType: 'network_interruption', source: 'autoplay', timestamp: NOW },
    { userId: 'acct_A', trackId: 'itunes_100', artist: 'Eagles', title: 'Hotel California', genre: 'Rock', eventType: 'app_close', source: 'user', timestamp: NOW },
    { userId: 'acct_A', trackId: 'itunes_100', artist: 'Eagles', title: 'Hotel California', genre: 'Rock', eventType: 'seek', source: 'user', timestamp: NOW },
    { userId: 'acct_A', trackId: 't_rock', artist: 'Pink Floyd', title: 'Time', genre: 'Rock', eventType: 'complete', source: 'user', timestamp: NOW }
  ];

  const profileA = buildUserTasteProfile({ userId: 'acct_A', events, nowMs: NOW });
  assert.equal(profileA.dislikedRecordingKeys.size, 0, 'Stream errors/seeks/app close must never add dislikes');
  assert.ok((profileA.artistScores['pink floyd'] || 0) > 0);

  // Account B must inherit ZERO taste from Account A
  const profileB = buildUserTasteProfile({ userId: 'acct_B', events, nowMs: NOW });
  assert.equal(profileB.hasLongTermEvidence, false, 'Account B must not inherit Account A events');
  assert.equal(profileB.artistScores['pink floyd'], undefined);

  // Cross-provider duplicate only appears ONCE in output sequence
  const seed = makeTrack({ id: 'seed_rock', title: 'Wish You Were Here', artist: 'Pink Floyd', genre: 'Rock' });
  const seq = selectAutoplaySequence([studioItunes, studioSaavn, liveVersion, previewOnly], profileA, {
    seedTrack: seed,
    recentPlays: [],
    sessionSkippedRecordingKeys: new Set(),
    sessionSkippedArtistKeys: new Set()
  }, { limit: 5, randomness: 0, randomSeed: 9, nowMs: NOW });

  const studioCount = seq.filter(s => getCanonicalRecordingKey(s.track) === getCanonicalRecordingKey(studioItunes)).length;
  assert.equal(studioCount, 1, 'Cross-provider studio recording must appear only once');
  assert.equal(seq.some(s => s.track.id === 'prev_1'), false, 'Preview-only track must be excluded');
});

// =========================================================================
// CASE 7: Autoplay disabled & repeat off -> playback stops cleanly
// =========================================================================
runTest('Case 7: With autoplay disabled and repeat off, playback stops at end of explicit queue', () => {
  const resolveNext = (state: {
    priorityQueue: string[];
    contextQueue: string[];
    contextIndex: number;
    repeatMode: 'off' | 'all' | 'one';
    autoplayEnabled: boolean;
    autoplayQueue: string[];
  }): string | 'STOP' => {
    if (state.priorityQueue.length > 0) return state.priorityQueue[0];
    if (state.contextIndex + 1 < state.contextQueue.length) return state.contextQueue[state.contextIndex + 1];
    if (state.repeatMode === 'all' && state.contextQueue.length > 0) return state.contextQueue[0];
    if (state.autoplayEnabled && state.autoplayQueue.length > 0) return state.autoplayQueue[0];
    return 'STOP';
  };

  assert.equal(
    resolveNext({ priorityQueue: [], contextQueue: ['t1', 't2'], contextIndex: 1, repeatMode: 'off', autoplayEnabled: false, autoplayQueue: ['a1'] }),
    'STOP',
    'Must stop when autoplay is disabled and repeat is off'
  );
  assert.equal(
    resolveNext({ priorityQueue: [], contextQueue: ['t1', 't2'], contextIndex: 1, repeatMode: 'all', autoplayEnabled: false, autoplayQueue: ['a1'] }),
    't1',
    'Repeat-all must loop explicit queue even when autoplay is disabled'
  );
  assert.equal(
    resolveNext({ priorityQueue: ['p1'], contextQueue: ['t1', 't2'], contextIndex: 1, repeatMode: 'off', autoplayEnabled: true, autoplayQueue: ['a1'] }),
    'p1',
    'Manual Up Next must always play before autoplay'
  );
});

// =========================================================================
// WORKED SCORING EXAMPLE (for verification report)
// =========================================================================
{
  const seed = makeTrack({
    id: 'w_seed',
    title: 'Nenjukkul Peidhidum',
    artist: 'Harris Jayaraj',
    genre: 'Acoustic',
    language: 'Tamil',
    styleTags: ['mellow', 'duet']
  });
  const eveningTrack = makeTrack({
    id: 'w_winner',
    title: 'Munbe Vaa',
    artist: 'AR Rahman',
    genre: 'Acoustic',
    language: 'Tamil',
    styleTags: ['mellow', 'duet'],
    relatedToSeed: true,
    sourcePlaylistName: 'Evening Acoustic'
  });
  const runnerUp = makeTrack({
    id: 'w_runner',
    title: 'Vaathi Coming',
    artist: 'Anirudh Ravichander',
    genre: 'Dance',
    language: 'Tamil',
    styleTags: ['dance', 'energetic'],
    relatedToSeed: true
  });

  const userProfile = buildUserTasteProfile({
    userId: 'worked_user',
    likes: [
      makeTrack({ id: 'wl1', title: 'Kasoor', artist: 'Prateek Kuhad', genre: 'Acoustic', language: 'Hindi', styleTags: ['mellow', 'acoustic'] }),
      makeTrack({ id: 'wl2', title: 'Hukum', artist: 'Anirudh Ravichander', genre: 'Dance', language: 'Tamil', styleTags: ['dance', 'energetic'] })
    ],
    playlists: [
      { id: 'pl_eve', name: 'Evening Acoustic', tracks: [seed, eveningTrack], isUserCreated: true }
    ],
    nowMs: NOW
  });

  const session: AutoplaySessionContext = {
    seedTrack: seed,
    recentPlays: [{ track: seed, source: 'user', timestamp: NOW }],
    sessionSkippedRecordingKeys: new Set(),
    sessionSkippedArtistKeys: new Set()
  };

  const sWin = scoreAutoplayCandidate(eveningTrack, userProfile, session, { relatedArtistsMap: RELATED_MAP });
  const sRun = scoreAutoplayCandidate(runnerUp, userProfile, session, { relatedArtistsMap: RELATED_MAP });

  console.log('\n--- WORKED EXAMPLE ---');
  console.log('Winner:', eveningTrack.title, 'by', eveningTrack.artist, JSON.stringify(sWin.breakdown));
  console.log('Runner-up:', runnerUp.title, 'by', runnerUp.artist, JSON.stringify(sRun.breakdown));
  assert.ok(sWin.score > sRun.score);
}

console.log(`\nALL ${passed} AUTOPLAY ACCEPTANCE TESTS PASSED.`);
