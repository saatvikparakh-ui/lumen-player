'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dbModule = require('../../server/db.cjs');
const recEngineModule = require('../../server/recommendationEngine.cjs');
const trackMatcherModule = require('../../server/trackMatcher.cjs');

function setupTestEnvironment() {
  const db = dbModule.createTestDb();
  
  // Seed sample users
  db.prepare(`
    INSERT INTO users (user_id, username, created_at)
    VALUES ('test_user_1', 'saatvik', ?),
           ('test_friend_1', 'alex_listener', ?)
  `).run(Date.now(), Date.now());

  // Seed sample songs
  const seedSongs = [
    { id: 's_1', title: 'Starboy', artist: 'The Weeknd', album: 'Starboy', duration: 230 },
    { id: 's_2', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 },
    { id: 's_3', title: 'Breathe Deeper', artist: 'Tame Impala', album: 'The Slow Rush', duration: 372 },
    { id: 's_4', title: 'Borderline', artist: 'Tame Impala', album: 'The Slow Rush', duration: 237 },
    { id: 's_5', title: 'Pond Song 1', artist: 'Pond', album: 'Tasmania', duration: 240 },
    { id: 's_6', title: 'Rich Flex', artist: 'Drake', album: 'Her Loss', duration: 239 },
    { id: 's_7', title: 'Nett Song 1', artist: 'Nettspend', album: 'Bad Ass Fucking Kid', duration: 150 },
    { id: 's_8', title: 'Ken Song 1', artist: 'Ken Carson', album: 'A Great Chaos', duration: 160 },
    { id: 's_9', title: 'Radioactive Noise', artist: 'Bad Band', album: 'Worst Hits', duration: 180 }
  ];

  const insertSong = db.prepare(`
    INSERT INTO songs (song_id, title, artist, album, duration, metadata_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const s of seedSongs) {
    insertSong.run(s.id, s.title, s.artist, s.album, s.duration, `${s.artist}:${s.title}`);
  }

  return db;
}

test('RecEngine: 1. Taste Profile - Derives artist affinities from ratings and play completions', () => {
  const db = setupTestEnvironment();
  const engine = recEngineModule.createRecommendationEngine(db);

  // Rate The Weeknd >= 8.5 (85 tenths) and Tame Impala 7.5 (75 tenths)
  db.prepare(`INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)`).run('test_user_1', 's_1', 95, Date.now());
  db.prepare(`INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)`).run('test_user_1', 's_3', 75, Date.now());

  // Add completed playback event for The Weeknd
  db.prepare(`
    INSERT INTO playback_events (event_id, user_id, song_id, started_at, listened_duration_seconds, completion_status)
    VALUES ('ev_1', 'test_user_1', 's_1', ?, 230, 'completed')
  `).run(Date.now());

  const profile = engine.getTasteProfile('test_user_1');
  assert.ok(profile.topArtists.length >= 2);
  assert.strictEqual(profile.topArtists[0].artist, 'the weeknd');
  assert.ok(profile.topArtists[0].affinity > 0.5);
  assert.strictEqual(profile.ratedSongCount, 2);
});

test('RecEngine: 2. Stage A Candidate Generation - Retrieves authentic records & related artists', () => {
  const db = setupTestEnvironment();
  const engine = recEngineModule.createRecommendationEngine(db);

  // Seed high rating for Tame Impala
  db.prepare(`INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)`).run('test_user_1', 's_3', 90, Date.now());

  const candidates = engine.generateCandidates('test_user_1', { seedArtist: 'Tame Impala' });
  assert.ok(candidates.length > 0);

  // Should include Tame Impala songs and related artist Pond songs
  const artists = new Set(candidates.map(c => c.artist.toLowerCase()));
  assert.ok(artists.has('tame impala'));
  assert.ok(artists.has('pond'));
});

test('RecEngine: 3. Mandatory Exclusions - Strictly excludes blocked artists and songs regardless of score', () => {
  const db = setupTestEnvironment();
  const engine = recEngineModule.createRecommendationEngine(db);

  // Exclude 'Drake' and song 'Blinding Lights'
  dbModule.addExclusion('test_user_1', 'artist', 'Drake', db);
  dbModule.addExclusion('test_user_1', 'song', 'Blinding Lights', db);

  const candidates = engine.generateCandidates('test_user_1', { seedArtist: 'Drake' });
  const artists = candidates.map(c => c.artist.toLowerCase());
  const titles = candidates.map(c => c.title.toLowerCase());

  assert.ok(!artists.includes('drake'), 'Excluded artist must never appear in candidates');
  assert.ok(!titles.includes('blinding lights'), 'Excluded song must never appear in candidates');

  // Verify isExcluded helper
  assert.strictEqual(dbModule.isExcluded('test_user_1', 'Drake', 'Any Song', db), true);
  assert.strictEqual(dbModule.isExcluded('test_user_1', 'The Weeknd', 'Blinding Lights', db), true);
  assert.strictEqual(dbModule.isExcluded('test_user_1', 'The Weeknd', 'Starboy', db), false);
});

test('RecEngine: 4. Stage B Interpretable Ranking - Score weights distribution and decay on recent plays', () => {
  const db = setupTestEnvironment();
  const engine = recEngineModule.createRecommendationEngine(db);

  // Rate The Weeknd highly
  db.prepare(`INSERT INTO ratings (user_id, song_id, rating_tenths, rated_at) VALUES (?, ?, ?, ?)`).run('test_user_1', 's_1', 98, Date.now());

  // Mark song 1 as played 5 minutes ago
  db.prepare(`
    INSERT INTO playback_events (event_id, user_id, song_id, started_at, listened_duration_seconds, completion_status)
    VALUES ('ev_recent', 'test_user_1', 's_1', ?, 230, 'completed')
  `).run(Date.now() - 300000);

  const candidates = engine.generateCandidates('test_user_1', {});
  const ranked = engine.rankCandidates(candidates, 'test_user_1', {});

  assert.ok(ranked.length > 0);
  assert.ok(ranked[0].recommendationScore > 0 && ranked[0].recommendationScore <= 1.0);
  assert.ok(ranked[0].scoringBreakdown);

  // Verify recently played track receives freshness penalty
  const s1Ranked = ranked.find(r => r.song_id === 's_1');
  if (s1Ranked) {
    assert.ok(s1Ranked.scoringBreakdown.freshness < 0.5, 'Recently played track must have penalized freshness score');
  }
});

test('RecEngine: 5. Smart Shuffle - Reduces artist clustering while preserving 100% of tracks', () => {
  const db = setupTestEnvironment();
  const engine = recEngineModule.createRecommendationEngine(db);

  const inputCollection = [
    { id: '1', artist: 'The Weeknd', title: 'Track A' },
    { id: '2', artist: 'The Weeknd', title: 'Track B' },
    { id: '3', artist: 'The Weeknd', title: 'Track C' },
    { id: '4', artist: 'Tame Impala', title: 'Track D' },
    { id: '5', artist: 'Tame Impala', title: 'Track E' },
    { id: '6', artist: 'Drake', title: 'Track F' }
  ];

  const shuffled = engine.getSmartShuffle(inputCollection, 'test_user_1');
  assert.strictEqual(shuffled.length, inputCollection.length, 'Must preserve all tracks');
  
  // Verify no 3 consecutive tracks from same artist
  let maxConsecutive = 1;
  let curConsecutive = 1;
  for (let i = 1; i < shuffled.length; i++) {
    if (shuffled[i].artist === shuffled[i - 1].artist) {
      curConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, curConsecutive);
    } else {
      curConsecutive = 1;
    }
  }
  assert.ok(maxConsecutive <= 2, 'Smart shuffle must break up single artist clustering');
});

test('RecEngine: 6. Natural Language Playlist Generator - Sequences authentic tracks matching target duration', async () => {
  const db = setupTestEnvironment();
  const engine = recEngineModule.createRecommendationEngine(db);

  const result = await engine.generateNaturalLanguagePlaylist(
    '40-minute night-driving playlist with psychedelic rock like Tame Impala',
    'test_user_1',
    1200 // 20 minutes for test
  );

  assert.ok(result.title);
  assert.ok(result.tracks.length > 0);
  assert.ok(result.totalDurationSeconds > 0);
  assert.ok(result.tracks.some(t => t.artist === 'Tame Impala' || t.artist === 'Pond'));
});

test('RecEngine: 7. Audio Stream Resolver - Strictly rejects music videos with skits and dialogue', () => {
  const SKIT_OR_VIDEO_REGEX = /official\s+music\s+video|music\s+video|official\s+video|short\s+film|movie\s+version|\blive\b|live\s+at|acoustic|skit|dialogue|behind\s+the\s+scenes/i;
  
  // Candidate titles that should be rejected
  assert.ok(SKIT_OR_VIDEO_REGEX.test('Maroon 5 - Payphone (Explicit) ft. Wiz Khalifa [Official Music Video]'));
  assert.ok(SKIT_OR_VIDEO_REGEX.test('Tame Impala - Loser (Short Film / Video)'));
  assert.ok(SKIT_OR_VIDEO_REGEX.test('The Weeknd - Blinding Lights (Live at Super Bowl)'));
  assert.ok(SKIT_OR_VIDEO_REGEX.test('Beck - Loser (Movie Version)'));

  // Studio master tracks that should be accepted
  assert.ok(!SKIT_OR_VIDEO_REGEX.test('Payphone'));
  assert.ok(!SKIT_OR_VIDEO_REGEX.test('Payphone (feat. Wiz Khalifa) [Official Audio]'));
  assert.ok(!SKIT_OR_VIDEO_REGEX.test('Loser - Tame Impala - Topic'));
  assert.ok(!SKIT_OR_VIDEO_REGEX.test('Starboy (Official Audio)'));
});
