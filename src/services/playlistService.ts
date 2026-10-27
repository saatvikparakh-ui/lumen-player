import { CustomPlaylist, Track } from '../types/music';

const STORAGE_KEY = 'lumen_custom_playlists_v5';

const DEFAULT_PLAYLISTS: CustomPlaylist[] = [
  {
    id: 'pl_midnight_starter',
    name: 'LUMEN Midnight Hi-Fi',
    description: 'Curated midnight aura, neon fidelity and deep soundscapes',
    coverUrl: null,
    coverColor: '#63E8FF',
    tracks: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

export class PlaylistService {
  private static playlists: CustomPlaylist[] = [];
  private static isLoaded = false;

  private static load(): void {
    if (this.isLoaded) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.playlists = JSON.parse(stored);
      } else {
        this.playlists = [...DEFAULT_PLAYLISTS];
        this.save();
      }
    } catch (_) {
      this.playlists = [...DEFAULT_PLAYLISTS];
    }
    this.isLoaded = true;
  }

  private static save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.playlists));
    } catch (err) {
      console.warn('Failed to save playlists to localStorage:', err);
    }
  }

  static getPlaylists(): CustomPlaylist[] {
    this.load();
    return [...this.playlists];
  }

  static getPlaylist(id: string): CustomPlaylist | null {
    this.load();
    return this.playlists.find(p => p.id === id) || null;
  }

  static createPlaylist(name: string, description = '', coverUrl: string | null = null, coverColor = '#63E8FF'): CustomPlaylist {
    this.load();
    const newPlaylist: CustomPlaylist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || 'Untitled Playlist',
      description,
      coverUrl,
      coverColor,
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.playlists.unshift(newPlaylist);
    this.save();
    return newPlaylist;
  }

  static createPlaylistWithTracks(
    name: string,
    description = '',
    coverUrl: string | null = null,
    tracks: Track[] = [],
    coverColor = '#63E8FF'
  ): CustomPlaylist {
    this.load();
    const newPlaylist: CustomPlaylist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || 'Imported Playlist',
      description,
      coverUrl: coverUrl || (tracks[0]?.artworkUrl) || null,
      coverColor,
      tracks: [...tracks],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.playlists.unshift(newPlaylist);
    this.save();
    return newPlaylist;
  }

  static updatePlaylist(id: string, updates: Partial<CustomPlaylist>): void {
    this.load();
    const idx = this.playlists.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.playlists[idx] = {
        ...this.playlists[idx],
        ...updates,
        updatedAt: Date.now()
      };
      this.save();
    }
  }

  static deletePlaylist(id: string): void {
    this.load();
    this.playlists = this.playlists.filter(p => p.id !== id);
    this.save();
  }

  static isTrackInPlaylist(playlistId: string, track: Track): boolean {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return false;
    const normTitle = (track.title || '').toLowerCase().trim();
    const normArtist = (track.artist || '').toLowerCase().trim();
    return playlist.tracks.some(t => {
      if (t.id === track.id) return true;
      return (t.title || '').toLowerCase().trim() === normTitle && (t.artist || '').toLowerCase().trim() === normArtist;
    });
  }

  static addTrackToPlaylist(playlistId: string, track: Track): boolean {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return false;

    // Duplicates are fully allowed: always add track to the playlist
    playlist.tracks.push(track);
    playlist.updatedAt = Date.now();
    this.save();
    return true;
  }

  static removeTrackFromPlaylist(playlistId: string, trackId: string, trackIndex?: number): void {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    if (typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < playlist.tracks.length) {
      // Remove only the specific copy at this exact position (preserving any other duplicate copies)
      playlist.tracks.splice(trackIndex, 1);
    } else {
      const idx = playlist.tracks.findIndex(t => t.id === trackId);
      if (idx !== -1) {
        playlist.tracks.splice(idx, 1);
      }
    }
    playlist.updatedAt = Date.now();
    this.save();
  }

  private static isHealing = false;

  /**
   * Background Auto-Healer:
   * Scans all custom playlists for tracks with "Unknown Artist" or missing/broken artwork,
   * queries /api/playlist/repair, and updates localStorage and live playlists automatically.
   */
  static async healPlaylists(onUpdated?: () => void): Promise<void> {
    this.load();
    if (this.isHealing) return;

    // Collect all tracks needing repair across all playlists
    const tracksToRepair: Track[] = [];
    for (const pl of this.playlists) {
      for (const t of pl.tracks) {
        const isUnknown = !t.artist || t.artist === 'Unknown Artist' || t.artist.trim() === '';
        const needsArt = !t.artworkUrl || t.artworkUrl.includes('image-cdn') || t.artworkUrl.includes('broken');
        if (isUnknown || needsArt) {
          tracksToRepair.push(t);
        }
      }
    }

    if (tracksToRepair.length === 0) return;

    this.isHealing = true;
    try {
      const res = await fetch('/api/playlist/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: tracksToRepair })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.repairedTracks) && data.repairedTracks.length > 0) {
          const repairMap = new Map<string, Track>();
          data.repairedTracks.forEach((rt: Track) => repairMap.set(rt.id, rt));

          let anyUpdated = false;
          for (const pl of this.playlists) {
            pl.tracks = pl.tracks.map(t => {
              if (repairMap.has(t.id)) {
                anyUpdated = true;
                return { ...t, ...repairMap.get(t.id) };
              }
              return t;
            });
            // Update playlist cover if first track got new artwork
            if ((!pl.coverUrl || pl.coverUrl.includes('image-cdn')) && pl.tracks[0]?.artworkUrl) {
              pl.coverUrl = pl.tracks[0].artworkUrl;
              anyUpdated = true;
            }
          }

          if (anyUpdated) {
            this.save();
            if (onUpdated) onUpdated();
          }
        }
      }
    } catch (err) {
      console.warn('[PlaylistService] healPlaylists error:', err);
    } finally {
      this.isHealing = false;
    }
  }
}
