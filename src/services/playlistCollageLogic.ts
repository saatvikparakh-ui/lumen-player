import type { CustomPlaylist } from '../types/music';

export interface CollageSelection {
  covers: string[];
  hasCustomHero: boolean;
  layoutVariant: number;
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Normalizes an artwork URL so different thumbnail sizes of the same album art
 * (e.g. 100x100bb.jpg vs 1000x1000bb.jpg) are recognized as the SAME cover.
 */
export function normalizeArtworkKey(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image')) {
    return trimmed.slice(0, 128);
  }
  return trimmed
    .split('?')[0]
    .replace(/\/\d+x\d+(?:bb|cc|sr)?\.(?:jpg|jpeg|png|webp)$/i, '')
    .replace(/_(?:50x50|150x150|500x500|1000x1000)\.(?:jpg|jpeg|png|webp)$/i, '')
    .toLowerCase();
}

function normalizeAlbumKey(album?: string | null, artist?: string | null): string {
  const a = (album || '').trim().toLowerCase();
  if (!a || a === 'unknown album' || a === 'single' || a === 'lumen hi-fi') return '';
  const art = (artist || '').trim().toLowerCase().split(/[,&]/)[0].trim();
  return `${a}::${art}`;
}

/**
 * Selects unique album covers for a playlist's generative organic art header:
 * - Never repeats the same album cover twice (dedupes by normalized URL AND album name).
 * - Uses a deterministic per-playlist seed so every playlist gets its own unique layout & cover mix.
 * - If the playlist has a custom uploaded cover: keeps the custom cover as slot 0 (hero)
 *   and blends it with 2-3 unique track album covers from the playlist.
 * - Otherwise picks 4-5 unique album covers from the playlist.
 * - If only 1-3 unique covers exist, returns ONLY those unique covers (never duplicating!).
 */
export function selectUniqueCollageCovers(
  playlist: Pick<CustomPlaylist, 'id' | 'name' | 'coverUrl' | 'tracks'>
): CollageSelection {
  const seed = hashString(`${playlist.id || ''}::${playlist.name || ''}`);
  const layoutVariant = seed % 6;

  const seenUrlKeys = new Set<string>();
  const seenAlbumKeys = new Set<string>();
  const covers: string[] = [];

  const hasCustomHero = Boolean(playlist.coverUrl && playlist.coverUrl.trim());
  if (hasCustomHero && playlist.coverUrl) {
    covers.push(playlist.coverUrl.trim());
    seenUrlKeys.add(normalizeArtworkKey(playlist.coverUrl));
  }

  // Collect all unique track artwork candidates
  const uniqueTrackCovers: string[] = [];
  for (const track of playlist.tracks || []) {
    const rawUrl = (track.artworkUrl || '').trim();
    if (!rawUrl) continue;
    const urlKey = normalizeArtworkKey(rawUrl);
    if (!urlKey || seenUrlKeys.has(urlKey)) continue;

    const albumKey = normalizeAlbumKey(track.album, track.artist);
    if (albumKey && seenAlbumKeys.has(albumKey)) continue;

    seenUrlKeys.add(urlKey);
    if (albumKey) seenAlbumKeys.add(albumKey);
    uniqueTrackCovers.push(rawUrl);
  }

  // Deterministic per-playlist rotation so two playlists sharing early tracks still look distinct
  const rotated: string[] = [];
  if (uniqueTrackCovers.length > 0) {
    const offset = seed % uniqueTrackCovers.length;
    for (let i = 0; i < uniqueTrackCovers.length; i++) {
      rotated.push(uniqueTrackCovers[(offset + i) % uniqueTrackCovers.length]);
    }
  }

  // Target count: custom hero + 2-3 unique covers (total 4), or 4-5 unique covers when no custom hero
  const targetTotal = hasCustomHero ? 4 : uniqueTrackCovers.length >= 5 ? 5 : 4;
  for (const url of rotated) {
    if (covers.length >= targetTotal) break;
    covers.push(url);
  }

  return {
    covers,
    hasCustomHero,
    layoutVariant
  };
}
