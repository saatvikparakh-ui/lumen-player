import type { CustomPlaylist, Track } from '../types/music';

export const LIKED_SONGS_PLAYLIST_ID = 'pl_liked_songs';

export function isLikedSongsPlaylistId(id?: string | null): boolean {
  return id === LIKED_SONGS_PLAYLIST_ID;
}

export function buildLikedSongsPlaylist(likedTracks: Track[]): CustomPlaylist {
  const safeTracks = Array.isArray(likedTracks) ? likedTracks : [];
  const latestAddedAt = safeTracks.reduce((max, t) => Math.max(max, Number(t.addedAt) || 0), 0);
  return {
    id: LIKED_SONGS_PLAYLIST_ID,
    name: 'Liked Songs',
    description: 'Songs you love across Lumen, synced automatically.',
    coverUrl: 'mosaic',
    coverColor: '#F43F5E',
    tracks: safeTracks,
    createdAt: 0,
    updatedAt: latestAddedAt || Date.now(),
    isPublic: false
  };
}

/**
 * Injects the reactive system "Liked Songs" playlist pinned at the very front
 * of the user's playlists list so it is always accessible on mobile & desktop.
 */
export function withPinnedLikedSongs(
  userPlaylists: CustomPlaylist[],
  likedTracks: Track[]
): CustomPlaylist[] {
  const likedPlaylist = buildLikedSongsPlaylist(likedTracks);
  const filtered = (Array.isArray(userPlaylists) ? userPlaylists : []).filter(
    (p) => p && !isLikedSongsPlaylistId(p.id)
  );
  return [likedPlaylist, ...filtered];
}
