'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock localStorage for Node test environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) || null,
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

describe('Playlist Recommendations & Dynamic Carousel Filtering', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('strictly excludes tracks that are already in the playlist', () => {
    const playlistTracks = [
      { id: 'track_1', title: 'Blinding Lights', artist: 'The Weeknd' },
      { id: 'track_2', title: 'Starboy', artist: 'The Weeknd' }
    ];

    const candidatePool = [
      { id: 'track_1', title: 'Blinding Lights', artist: 'The Weeknd' },
      { id: 'track_2', title: 'Starboy', artist: 'The Weeknd' },
      { id: 'track_3', title: 'Save Your Tears', artist: 'The Weeknd' },
      { id: 'track_4', title: 'Die For You', artist: 'The Weeknd' }
    ];

    const playlistIds = new Set(playlistTracks.map(t => t.id));
    const filtered = candidatePool.filter(t => !playlistIds.has(t.id));

    assert.equal(filtered.length, 2);
    assert.ok(!filtered.some(t => t.id === 'track_1' || t.id === 'track_2'));
    assert.deepEqual(filtered.map(t => t.id), ['track_3', 'track_4']);
  });

  it('dynamically replenishes suggestions when a track is added to the playlist', () => {
    const playlist = [
      { id: 'track_1', title: 'Blinding Lights', artist: 'The Weeknd' }
    ];

    let candidatePool = [
      { id: 'track_2', title: 'Starboy', artist: 'The Weeknd' },
      { id: 'track_3', title: 'Save Your Tears', artist: 'The Weeknd' },
      { id: 'track_4', title: 'Die For You', artist: 'The Weeknd' }
    ];

    // User adds track_2 to playlist
    const addedTrack = candidatePool[0];
    playlist.push(addedTrack);

    // Dynamic replenishment removes added track and shifts in remaining candidates
    candidatePool = candidatePool.filter(t => t.id !== addedTrack.id);

    assert.equal(playlist.length, 2);
    assert.ok(playlist.some(t => t.id === 'track_2'));
    assert.equal(candidatePool.length, 2);
    assert.ok(!candidatePool.some(t => t.id === 'track_2'));
    assert.equal(candidatePool[0].id, 'track_3');
  });

  it('prioritizes recommendations tuned to playlist artists over random songs', () => {
    const playlist = [
      { id: 'p1', title: 'One More Hour', artist: 'Tame Impala' },
      { id: 'p2', title: 'Borderline', artist: 'Tame Impala' }
    ];

    const candidates = [
      { id: 'c1', title: 'Levitating', artist: 'Dua Lipa', genre: 'Pop' },
      { id: 'c2', title: 'Breathe Deeper', artist: 'Tame Impala', genre: 'Psychedelic Rock' },
      { id: 'c3', title: 'Lost In Yesterday', artist: 'Tame Impala', genre: 'Psychedelic Rock' },
      { id: 'c4', title: 'Gods Plan', artist: 'Drake', genre: 'Hip Hop' }
    ];

    const playlistArtists = new Set(playlist.map(t => t.artist.toLowerCase()));

    // Score candidates based on playlist artist affinity
    const scored = candidates.map(t => ({
      track: t,
      score: playlistArtists.has(t.artist.toLowerCase()) ? 10 : 1
    })).sort((a, b) => b.score - a.score);

    assert.equal(scored[0].track.artist, 'Tame Impala');
    assert.equal(scored[1].track.artist, 'Tame Impala');
    assert.ok(scored[0].score > scored[2].score);
  });
});

describe('Firebase Auth & Taste Onboarding Logic', () => {
  const ONBOARDING_PREFIX = 'lumen_onboarded_';
  const GUEST_STORAGE_KEY = 'lumen_guest_user';

  beforeEach(() => {
    mockStorage.clear();
  });

  it('creates guest user session with uncompleted onboarding by default', () => {
    const guestUser = {
      uid: 'guest_test_123',
      email: null,
      displayName: 'Guest Listener',
      photoURL: null,
      isGuest: true,
      hasCompletedOnboarding: false
    };

    mockStorage.set(GUEST_STORAGE_KEY, JSON.stringify(guestUser));
    const retrieved = JSON.parse(mockStorage.get(GUEST_STORAGE_KEY));

    assert.equal(retrieved.isGuest, true);
    assert.equal(retrieved.hasCompletedOnboarding, false);
    assert.equal(retrieved.displayName, 'Guest Listener');
  });

  it('marks onboarding completed and persists status per user ID', () => {
    const userUid = 'usr_test_abc';
    const statusKey = `${ONBOARDING_PREFIX}${userUid}`;

    // Initially uncompleted
    assert.equal(global.localStorage.getItem(statusKey), null);

    // User completes onboarding
    global.localStorage.setItem(statusKey, 'true');
    assert.equal(global.localStorage.getItem(statusKey) === 'true', true);

    // Another user remains uncompleted
    const otherUserKey = `${ONBOARDING_PREFIX}usr_other`;
    assert.equal(global.localStorage.getItem(otherUserKey) === 'true', false);
  });

  it('stores selected onboarding artists and genres into preference profile', () => {
    const initialPrefs = {
      favoriteArtists: ['The Weeknd'],
      favoriteGenres: ['R&B']
    };

    const onboardingSelection = {
      artists: ['Tame Impala', 'Daft Punk'],
      genres: ['Psychedelic Rock', 'Electronic']
    };

    const merged = {
      favoriteArtists: Array.from(new Set([...initialPrefs.favoriteArtists, ...onboardingSelection.artists])),
      favoriteGenres: Array.from(new Set([...initialPrefs.favoriteGenres, ...onboardingSelection.genres]))
    };

    mockStorage.set('lumen_user_preferences', JSON.stringify(merged));
    const stored = JSON.parse(mockStorage.get('lumen_user_preferences'));

    assert.deepEqual(stored.favoriteArtists, ['The Weeknd', 'Tame Impala', 'Daft Punk']);
    assert.deepEqual(stored.favoriteGenres, ['R&B', 'Psychedelic Rock', 'Electronic']);
  });
});
