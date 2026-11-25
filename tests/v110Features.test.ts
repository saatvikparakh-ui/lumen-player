import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_GUESS_CLIP_SECONDS,
  clampClipWindow,
  isSongGuessCorrect,
  formatClipTimestamp
} from '../src/services/guessSongLogic.ts';
import { pickTopPlayedTracksInPlaylist } from '../src/services/libraryRankingLogic.ts';
import {
  loadPersistedAudioSettings,
  savePersistedAudioSettings,
  DEFAULT_AUDIO_SETTINGS
} from '../src/services/audioSettingsStorage.ts';

test('Guess the Song: clampClipWindow enforces <= 30s and bounds within track duration', () => {
  const normal = clampClipWindow(90, 210, 30);
  assert.equal(normal.clipStartSec, 90);
  assert.equal(normal.clipDurationSec, 30);
  assert.equal(normal.clipEndSec, 120);

  const oversized = clampClipWindow(10, 200, 90);
  assert.equal(oversized.clipDurationSec, MAX_GUESS_CLIP_SECONDS);

  const nearEnd = clampClipWindow(195, 200, 30);
  assert.equal(nearEnd.clipStartSec, 170);
  assert.equal(nearEnd.clipEndSec, 200);
  assert.equal(nearEnd.clipDurationSec, 30);

  const shortTrack = clampClipWindow(12, 20, 30);
  assert.equal(shortTrack.clipStartSec, 0);
  assert.equal(shortTrack.clipDurationSec, 20);

  assert.equal(formatClipTimestamp(90), '1:30');
  assert.equal(formatClipTimestamp(5), '0:05');
});

test('Guess the Song: isSongGuessCorrect forgives remastered/feat tags and rejects wrong songs', () => {
  assert.equal(
    isSongGuessCorrect(
      { id: 't1', title: 'Here Comes The Sun (Remastered 2009)', artist: 'The Beatles' },
      { id: 't99', title: 'Here Comes the Sun', artist: 'Beatles' }
    ),
    true
  );

  assert.equal(
    isSongGuessCorrect(
      { id: 't2', title: 'Starboy (feat. Daft Punk)', artist: 'The Weeknd, Daft Punk' },
      { id: 't88', title: 'Starboy', artist: 'The Weeknd' }
    ),
    true
  );

  assert.equal(
    isSongGuessCorrect(
      { id: 't2', title: 'Starboy', artist: 'The Weeknd' },
      { id: 't3', title: 'Blinding Lights', artist: 'The Weeknd' }
    ),
    false
  );
});

test('Playlist carousel ranking: prioritizes played tracks and shuffles zero-play fallback randomly', () => {
  const tracks = Array.from({ length: 20 }, (_, i) => ({
    id: `tr_${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    artworkUrl: `https://example.com/art_${i}.jpg`
  }));

  // With play events on tracks 14 and 18, they MUST come first!
  const withEvents = pickTopPlayedTracksInPlaylist(
    tracks,
    [
      { trackId: 'tr_14', title: 'Song 14', artist: 'Artist 14', listenDurationSec: 120, eventType: 'complete' },
      { trackId: 'tr_14', title: 'Song 14', artist: 'Artist 14', listenDurationSec: 120, eventType: 'complete' },
      { trackId: 'tr_18', title: 'Song 18', artist: 'Artist 18', listenDurationSec: 90, eventType: 'complete' }
    ],
    5,
    42
  );
  assert.equal(withEvents.length, 5);
  assert.equal(withEvents[0].id, 'tr_14');
  assert.equal(withEvents[1].id, 'tr_18');

  // With zero play history, different seeds produce different random selections (not stuck on indices 0..4!)
  const seedA = pickTopPlayedTracksInPlaylist(tracks, [], 5, 101).map(t => t.id);
  const seedB = pickTopPlayedTracksInPlaylist(tracks, [], 5, 2029).map(t => t.id);
  assert.equal(seedA.length, 5);
  assert.equal(seedB.length, 5);
  assert.notDeepEqual(seedA, ['tr_0', 'tr_1', 'tr_2', 'tr_3', 'tr_4']);
  assert.notDeepEqual(seedA, seedB);
});

test('Audio settings storage persists isStudioClarity cleanly', () => {
  const mem = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    }
  };

  assert.equal(DEFAULT_AUDIO_SETTINGS.isStudioClarity, true);
  assert.equal(loadPersistedAudioSettings(mockStorage).isStudioClarity, true);

  savePersistedAudioSettings({ isStudioClarity: false }, mockStorage);
  assert.equal(loadPersistedAudioSettings(mockStorage).isStudioClarity, false);

  savePersistedAudioSettings({ isStudioClarity: true }, mockStorage);
  assert.equal(loadPersistedAudioSettings(mockStorage).isStudioClarity, true);
});
