import { Track, Album, Artist, Playlist } from '../types/music';

const TRACKS_STORAGE_KEY = 'lumen_library_tracks_v1';
const PLAYLISTS_STORAGE_KEY = 'lumen_library_playlists_v1';
const HISTORY_STORAGE_KEY = 'lumen_library_history_v1';
const FOLDERS_STORAGE_KEY = 'lumen_library_folders_v1';

export class LibraryDatabase {
  private static tracks: Track[] = [];
  private static playlists: Playlist[] = [];
  private static monitoredFolders: string[] = [];

  static load(): void {
    try {
      const storedTracks = localStorage.getItem(TRACKS_STORAGE_KEY);
      if (storedTracks) {
        this.tracks = JSON.parse(storedTracks);
      }

      const storedPlaylists = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
      if (storedPlaylists) {
        this.playlists = JSON.parse(storedPlaylists);
      } else {
        // Initialize default smart playlists
        this.playlists = [
          {
            id: 'playlist_favs',
            name: 'Starred & Favorites',
            description: 'Your favorite tracks in one place',
            trackIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ];
        this.savePlaylists();
      }

      const storedFolders = localStorage.getItem(FOLDERS_STORAGE_KEY);
      if (storedFolders) {
        this.monitoredFolders = JSON.parse(storedFolders);
      }
    } catch (e) {
      console.error('Failed to load library data from storage:', e);
    }
  }

  static getTracks(): Track[] {
    return this.tracks;
  }

  static saveTracks(newTracks: Track[]): void {
    // Merge or replace
    const trackMap = new Map<string, Track>();
    for (const t of this.tracks) {
      trackMap.set(t.id, t);
    }
    for (const t of newTracks) {
      const existing = trackMap.get(t.id);
      trackMap.set(t.id, {
        ...t,
        playCount: existing?.playCount || 0,
        lastPlayed: existing?.lastPlayed || 0,
        isFavorite: existing?.isFavorite || false
      });
    }

    this.tracks = Array.from(trackMap.values());
    try {
      localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(this.tracks));
    } catch (e) {
      console.warn('Storage limit reached, consider IndexedDB for huge libraries', e);
    }
  }

  static toggleFavorite(trackId: string): boolean {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return false;
    track.isFavorite = !track.isFavorite;

    // Update favorites playlist
    const favPlaylist = this.playlists.find(p => p.id === 'playlist_favs');
    if (favPlaylist) {
      if (track.isFavorite) {
        if (!favPlaylist.trackIds.includes(trackId)) favPlaylist.trackIds.push(trackId);
      } else {
        favPlaylist.trackIds = favPlaylist.trackIds.filter(id => id !== trackId);
      }
      this.savePlaylists();
    }

    this.saveTracks(this.tracks);
    return track.isFavorite;
  }

  static recordPlay(trackId: string): void {
    const track = this.tracks.find(t => t.id === trackId);
    if (track) {
      track.playCount = (track.playCount || 0) + 1;
      track.lastPlayed = Date.now();
      this.saveTracks(this.tracks);
    }
  }

  static getAlbums(): Album[] {
    const albumMap = new Map<string, Album>();

    for (const track of this.tracks) {
      const key = `${track.albumArtist || track.artist} - ${track.album}`.toLowerCase();
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          id: `album_${key.replace(/[^a-z0-9]/g, '_')}`,
          title: track.album,
          artist: track.albumArtist || track.artist,
          year: track.year,
          artworkUrl: track.artworkUrl,
          trackCount: 0,
          tracks: []
        });
      }

      const album = albumMap.get(key)!;
      album.trackCount++;
      album.tracks.push(track);
      if (!album.artworkUrl && track.artworkUrl) {
        album.artworkUrl = track.artworkUrl;
      }
    }

    // Sort tracks inside each album by trackNumber
    for (const album of albumMap.values()) {
      album.tracks.sort((a, b) => (a.trackNumber || 1) - (b.trackNumber || 1));
    }

    return Array.from(albumMap.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  static getArtists(): Artist[] {
    const artistMap = new Map<string, { albums: Map<string, Album>; trackCount: number }>();

    for (const track of this.tracks) {
      const artistName = track.artist || 'Unknown Artist';
      if (!artistMap.has(artistName)) {
        artistMap.set(artistName, { albums: new Map(), trackCount: 0 });
      }

      const entry = artistMap.get(artistName)!;
      entry.trackCount++;
      if (!entry.albums.has(track.album)) {
        entry.albums.set(track.album, {
          id: `alb_${track.album.replace(/[^a-z0-9]/g, '_')}`,
          title: track.album,
          artist: artistName,
          year: track.year,
          artworkUrl: track.artworkUrl,
          trackCount: 0,
          tracks: []
        });
      }
      entry.albums.get(track.album)!.tracks.push(track);
    }

    const artists: Artist[] = [];
    for (const [name, data] of artistMap.entries()) {
      artists.push({
        id: `artist_${name.replace(/[^a-z0-9]/g, '_')}`,
        name,
        albums: Array.from(data.albums.values()),
        trackCount: data.trackCount
      });
    }

    return artists.sort((a, b) => a.name.localeCompare(b.name));
  }

  static getPlaylists(): Playlist[] {
    return this.playlists;
  }

  static createPlaylist(name: string, description?: string): Playlist {
    const newPlaylist: Playlist = {
      id: `pl_${Date.now()}`,
      name,
      description,
      trackIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.playlists.push(newPlaylist);
    this.savePlaylists();
    return newPlaylist;
  }

  static addTrackToPlaylist(playlistId: string, trackId: string): void {
    const pl = this.playlists.find(p => p.id === playlistId);
    if (pl) {
      pl.trackIds.push(trackId);
      pl.updatedAt = Date.now();
      this.savePlaylists();
    }
  }

  static savePlaylists(): void {
    try {
      localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(this.playlists));
    } catch (e) {
      console.warn('Failed saving playlists', e);
    }
  }

  static getMonitoredFolders(): string[] {
    return this.monitoredFolders;
  }

  static addMonitoredFolder(folderPath: string): void {
    if (!this.monitoredFolders.includes(folderPath)) {
      this.monitoredFolders.push(folderPath);
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(this.monitoredFolders));
    }
  }
}
