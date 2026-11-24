import assert from 'node:assert/strict';
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  loadPersistedAudioSettings,
  savePersistedAudioSettings
} from '../src/services/audioSettingsStorage.ts';
import {
  decideAndroidOtaAction,
  decideWindowsOtaAction,
  sanitizeOtaError,
  type OtaManifest
} from '../src/services/otaUpdateLogic.ts';
import {
  LIKED_SONGS_PLAYLIST_ID,
  buildLikedSongsPlaylist,
  isLikedSongsPlaylistId,
  withPinnedLikedSongs
} from '../src/services/likedPlaylistHelper.ts';
import {
  findBestMatch,
  getVerifiedCanonicalCover,
  isSuspectArtworkUrl
} from '../src/utils/artwork.ts';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  PASS: ${name}`);
}

console.log('Running v1.0.7 Settings, OTA, Liked Songs, and Artwork Accuracy tests...');

test('Audio settings persist across restart and clamp bounds', () => {
  const store = new MemoryStorage();
  savePersistedAudioSettings(
    {
      isGapless: false,
      isAutomix: false,
      crossfadeSeconds: 8,
      isNormalized: false,
      audioQuality: 'lossless',
      eqPreset: 'Bass Boost',
      eqGains: [20, 4.5, 3, 2, 1, 0, 0, 0, -25, 0]
    },
    store
  );
  assert.ok(store.getItem(AUDIO_SETTINGS_STORAGE_KEY), 'settings saved to storage');
  const restored = loadPersistedAudioSettings(store);
  assert.equal(restored.isGapless, false);
  assert.equal(restored.isAutomix, false);
  assert.equal(restored.crossfadeSeconds, 8);
  assert.equal(restored.isNormalized, false);
  assert.equal(restored.audioQuality, 'lossless');
  assert.equal(restored.eqPreset, 'Bass Boost');
  assert.equal(restored.eqGains[0], 12);
  assert.equal(restored.eqGains[8], -12);
});

test('sanitizeOtaError strips raw latest.yml 404 stack traces cleanly', () => {
  const rawElectronError =
    'Cannot find latest.yml in the latest release artifacts (https://github.com/saatvikparakh-ui/lumen-player/releases/download/v1.0.0/latest.yml): HttpError: 404\nHeaders: { "server": "github.com" }\n    at createHttpError (app.asar/httpExecutor.js:53:12)';
  const clean = sanitizeOtaError(rawElectronError);
  assert.ok(!clean.includes('Headers:'), 'must not include HTTP headers');
  assert.ok(!clean.includes('app.asar'), 'must not include stack trace');
  assert.ok(clean.length <= 110, 'must stay concise');
});

test('OTA manifest decisions expose Render fallback URLs for Android and Windows', () => {
  const manifest: OtaManifest = {
    appVersion: '1.0.7',
    webBundleVersion: '1.0.7+2026.11.24.2000',
    minNativeVersionCode: 8,
    webBundleUrl: 'https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/lumen-web-bundle.zip',
    webBundleFallbackUrl: 'https://lumen-player.onrender.com/api/ota/web-bundle.zip',
    androidNative: {
      versionCode: 8,
      versionName: '1.0.7',
      apkUrl: 'https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/Lumen-debug.apk',
      apkFallbackUrl: 'https://lumen-player.onrender.com/download/apk',
      apkSha256: 'abc123'
    },
    windows: {
      version: '1.0.7',
      installerUrl: 'https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/Lumen-Setup.exe',
      installerFallbackUrl: 'https://lumen-player.onrender.com/download/windows'
    }
  };

  const androidDec = decideAndroidOtaAction(manifest, {
    nativeVersionCode: 7,
    nativeVersionName: '1.0.6',
    activeWebBundleVersion: '1.0.6',
    builtinWebBundleVersion: '1.0.6'
  });
  assert.equal(androidDec.kind, 'native_apk_update');
  if (androidDec.kind === 'native_apk_update') {
    assert.equal(androidDec.apkFallbackUrl, 'https://lumen-player.onrender.com/download/apk');
  }

  const winDec = decideWindowsOtaAction(manifest, '1.0.6');
  assert.equal(winDec.kind, 'windows_installer_update');
  if (winDec.kind === 'windows_installer_update') {
    assert.equal(winDec.installerFallbackUrl, 'https://lumen-player.onrender.com/download/windows');
  }

  const winSame = decideWindowsOtaAction(manifest, '1.0.7');
  assert.equal(winSame.kind, 'up_to_date');
});

test('Liked Songs playlist is pinned first and reflects live liked tracks', () => {
  const liked = [
    {
      id: 't1',
      title: 'New Gold',
      artist: 'Gorillaz',
      album: 'Cracker Island',
      duration: 215,
      artworkUrl: null,
      streamUrl: '',
      path: '',
      filename: 'new-gold.mp3',
      hasArtwork: false,
      addedAt: 1000
    }
  ];
  const userPlaylists = [
    { id: 'pl_1', name: 'Vaarasta', description: '', coverUrl: 'mosaic', coverColor: '#fff', tracks: [], createdAt: 1, updatedAt: 1 },
    { id: LIKED_SONGS_PLAYLIST_ID, name: 'Old Dup', description: '', coverUrl: null, coverColor: '#000', tracks: [], createdAt: 1, updatedAt: 1 }
  ];
  const combined = withPinnedLikedSongs(userPlaylists, liked);
  assert.equal(combined.length, 2);
  assert.ok(isLikedSongsPlaylistId(combined[0].id));
  assert.equal(combined[0].name, 'Liked Songs');
  assert.equal(combined[0].coverUrl, 'mosaic');
  assert.equal(combined[0].tracks.length, 1);

  const built = buildLikedSongsPlaylist(liked);
  assert.equal(built.id, LIKED_SONGS_PLAYLIST_ID);
});

test('Canonical studio covers heal New Gold, The Less I Know The Better, and The Neighbourhood', () => {
  const newGold1 = getVerifiedCanonicalCover('New Gold (feat. Tame Impala & Bootie Brown)', 'Gorillaz', '', 600);
  const newGold2 = getVerifiedCanonicalCover('New Gold', 'Tame Impala', '', 600);
  assert.ok(newGold1 && newGold1.includes('Cracker-Island'), 'New Gold maps to Cracker Island');
  assert.equal(newGold1, newGold2);

  const currents = getVerifiedCanonicalCover('The Less I Know The Better', 'Tame Impala', 'Coastal Vibes', 600);
  assert.ok(currents && currents.includes('15UMGIM23316'), 'The Less I Know The Better maps to Currents');

  const sweater = getVerifiedCanonicalCover('Sweater Weather', 'The Neighbourhood', '', 600);
  const daddy = getVerifiedCanonicalCover('Daddy Issues', 'The Neighbourhood', '', 600);
  const softcore = getVerifiedCanonicalCover('Softcore', 'The Neighbourhood', '', 600);
  assert.ok(sweater && sweater.includes('886443969834'));
  assert.ok(daddy && daddy.includes('886445447897'));
  assert.ok(softcore && softcore.includes('886447414545'));

  assert.equal(isSuspectArtworkUrl('https://c.saavncdn.com/854/Coastal-Vibes-English-2026-500x500.jpg'), true);
  assert.equal(isSuspectArtworkUrl('https://c.saavncdn.com/807/Currents-English-2015-500x500.jpg'), false);
});

test('findBestMatch rejects UMG mood compilations, karaoke, and remixes in favor of studio albums', () => {
  const candidates = [
    {
      trackName: 'The Less I Know The Better',
      artistName: 'Tame Impala',
      collectionName: 'Coastal Vibes',
      trackCount: 45,
      artworkUrl100: 'https://c.saavncdn.com/854/Coastal-Vibes-150x150.jpg'
    },
    {
      trackName: 'The Less I Know The Better (Club Edit)',
      artistName: 'Gee Beat',
      collectionName: 'Club Edit - Single',
      trackCount: 1,
      artworkUrl100: 'https://example.com/club.jpg'
    },
    {
      trackName: 'The Less I Know The Better',
      artistName: 'Tame Impala',
      collectionName: 'Currents',
      trackCount: 13,
      artworkUrl100: 'https://c.saavncdn.com/807/Currents-English-2015-150x150.jpg'
    }
  ];
  const best = findBestMatch(candidates, 'The Less I Know The Better', 'Tame Impala');
  assert.ok(best, 'found a best match');
  assert.equal(best.collectionName, 'Currents');

  const newGoldCandidates = [
    {
      trackName: 'New Gold (Originally Performed by Gorillaz, Tame Impala & Bootie Brown) [Instrumental Version]',
      artistName: 'Backing Business',
      collectionName: 'Pristine Karaoke, Vol. 40',
      artworkUrl100: 'https://example.com/karaoke.jpg'
    },
    {
      trackName: 'New Gold (feat. Tame Impala and Bootie Brown)',
      artistName: 'Gorillaz',
      collectionName: 'Cracker Island',
      trackCount: 10,
      artworkUrl100: 'https://c.saavncdn.com/582/Cracker-Island-English-2023-150x150.jpg'
    }
  ];
  const bestGold = findBestMatch(newGoldCandidates, 'New Gold', 'Tame Impala');
  assert.ok(bestGold, 'matched featured artist credit');
  assert.equal(bestGold.collectionName, 'Cracker Island');
});

console.log(`All ${passed} v1.0.7 verification tests passed!`);
