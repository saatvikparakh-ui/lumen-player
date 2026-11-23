import assert from 'node:assert/strict';
import type { Track } from '../src/types/music.ts';
import { selectUniqueCollageCovers } from '../src/services/playlistCollageLogic.ts';

function track(id: string, title: string, artist: string, album: string, artworkUrl: string): Track {
  return {
    id,
    title,
    artist,
    album,
    duration: 200,
    filePath: '',
    artworkUrl,
    hasArtwork: Boolean(artworkUrl)
  };
}

// 1. Deduplicates identical album covers (including 100x100 vs 1000x1000 variants and same-album tracks)
{
  const res = selectUniqueCollageCovers({
    id: 'pl_tame',
    name: 'too_many_playlists',
    coverUrl: null,
    tracks: [
      track('1', 'Nangs', 'Tame Impala', 'Currents', 'https://cdn.example.com/currents/100x100bb.jpg'),
      track('2', 'Eventually', 'Tame Impala', 'Currents', 'https://cdn.example.com/currents/1000x1000bb.jpg'),
      track('3', 'Alter Ego', 'Tame Impala', 'Innerspeaker', 'https://cdn.example.com/innerspeaker/600x600bb.jpg'),
      track('4', 'Apocalypse Dreams', 'Tame Impala', 'Lonerism', 'https://cdn.example.com/lonerism/600x600bb.jpg'),
      track('5', 'Borderline', 'Tame Impala', 'The Slow Rush', 'https://cdn.example.com/slowrush/600x600bb.jpg'),
      track('6', 'Starboy', 'The Weeknd', 'Starboy', 'https://cdn.example.com/starboy/600x600bb.jpg')
    ]
  });
  assert.equal(res.hasCustomHero, false);
  assert.equal(res.covers.length, 5);
  assert.equal(new Set(res.covers).size, 5, 'Every cover must be unique');
  const currentsMatches = res.covers.filter(u => u.includes('/currents/'));
  assert.equal(currentsMatches.length, 1, 'Same album cover must never appear twice');
}

// 2. Custom cover stays slot 0 (hero) + blends with 2-3 unique track covers (total 4), no duplicates
{
  const res = selectUniqueCollageCovers({
    id: 'pl_custom',
    name: 'Night Drive',
    coverUrl: 'https://cdn.example.com/custom-hero/600x600bb.jpg',
    tracks: [
      track('1', 'A', 'X', 'Alb1', 'https://cdn.example.com/custom-hero/1000x1000bb.jpg'),
      track('2', 'B', 'X', 'Alb2', 'https://cdn.example.com/alb2/600x600bb.jpg'),
      track('3', 'C', 'X', 'Alb3', 'https://cdn.example.com/alb3/600x600bb.jpg'),
      track('4', 'D', 'X', 'Alb4', 'https://cdn.example.com/alb4/600x600bb.jpg'),
      track('5', 'E', 'X', 'Alb5', 'https://cdn.example.com/alb5/600x600bb.jpg')
    ]
  });
  assert.equal(res.hasCustomHero, true);
  assert.equal(res.covers[0], 'https://cdn.example.com/custom-hero/600x600bb.jpg');
  assert.equal(res.covers.length, 4);
  assert.equal(new Set(res.covers).size, 4);
}

// 3. Playlist with only 2 unique covers returns ONLY those 2 covers (never duplicates to pad!)
{
  const res = selectUniqueCollageCovers({
    id: 'pl_small',
    name: 'Small Mix',
    coverUrl: null,
    tracks: [
      track('1', 'One', 'Art', 'A1', 'https://cdn.example.com/a1/600x600bb.jpg'),
      track('2', 'Two', 'Art', 'A1', 'https://cdn.example.com/a1/600x600bb.jpg'),
      track('3', 'Three', 'Art', 'A2', 'https://cdn.example.com/a2/600x600bb.jpg')
    ]
  });
  assert.equal(res.covers.length, 2);
  assert.equal(new Set(res.covers).size, 2);
}

// 4. Different playlists get distinct deterministic compositions
{
  const sharedTracks = [
    track('1', 'T1', 'A', 'Al1', 'https://cdn.example.com/1/600x600bb.jpg'),
    track('2', 'T2', 'B', 'Al2', 'https://cdn.example.com/2/600x600bb.jpg'),
    track('3', 'T3', 'C', 'Al3', 'https://cdn.example.com/3/600x600bb.jpg'),
    track('4', 'T4', 'D', 'Al4', 'https://cdn.example.com/4/600x600bb.jpg'),
    track('5', 'T5', 'E', 'Al5', 'https://cdn.example.com/5/600x600bb.jpg')
  ];
  const a = selectUniqueCollageCovers({ id: 'pl_alpha', name: 'Alpha', coverUrl: null, tracks: sharedTracks });
  const b = selectUniqueCollageCovers({ id: 'pl_beta', name: 'Beta', coverUrl: null, tracks: sharedTracks });
  assert.notEqual(
    `${a.layoutVariant}:${a.covers.join(',')}`,
    `${b.layoutVariant}:${b.covers.join(',')}`,
    'Different playlists should produce distinct art compositions'
  );
}

console.log('ALL 4 PLAYLIST ART COLLAGE TESTS PASSED!');
