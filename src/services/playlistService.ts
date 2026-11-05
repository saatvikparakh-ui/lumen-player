import { CustomPlaylist, Track } from '../types/music';
import { FirestoreService } from './firestoreService';

const LEGACY_STORAGE_KEY = 'lumen_custom_playlists_v5';

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
  private static listeners: ((playlists: CustomPlaylist[]) => void)[] = [];
  private static currentUserId: string | null = null;
  private static unsubscribeCloud: (() => void) | null = null;

  private static getStorageKey(uid?: string | null): string {
    const target = uid !== undefined ? uid : this.currentUserId;
    return target ? `lumen_playlists_${target}` : 'lumen_playlists_guest';
  }

  private static load(): void {
    if (this.isLoaded) return;
    const key = this.getStorageKey();
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        this.playlists = JSON.parse(stored);
      } else {
        if (!this.currentUserId) {
          const leg = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (leg) {
            try { this.playlists = JSON.parse(leg); } catch (_) {}
          }
        }
        if (!this.playlists || this.playlists.length === 0) {
          this.playlists = [...DEFAULT_PLAYLISTS];
        }
        this.save(false);
      }
    } catch (_) {
      this.playlists = [...DEFAULT_PLAYLISTS];
    }
    this.isLoaded = true;
  }

  private static save(syncToCloud: boolean = true): void {
    try {
      const key = this.getStorageKey();
      localStorage.setItem(key, JSON.stringify(this.playlists));
      this.notify();
      if (syncToCloud && this.currentUserId) {
        FirestoreService.saveUserPlaylists(this.currentUserId, this.playlists).catch(() => {});
      }
    } catch (err) {
      console.warn('Failed to save playlists:', err);
    }
  }

  private static notify(): void {
    const list = [...this.playlists];
    this.listeners.forEach(fn => fn(list));
  }

  static onPlaylistsChange(listener: (playlists: CustomPlaylist[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== listener);
    };
  }

  /**
   * Initializes PlaylistService strictly for the active user.
   * Completely isolates playlists per account — eliminates cross-account leakage.
   * Cloud playlists strictly overwrite local state on login, and switching accounts immediately loads that account's playlists.
   */
  static async initForUser(userId: string | null, isGuest: boolean = false): Promise<void> {
    if (this.unsubscribeCloud) {
      this.unsubscribeCloud();
      this.unsubscribeCloud = null;
    }

    const cleanUid = (!userId || isGuest) ? null : userId;
    this.currentUserId = cleanUid;
    this.isLoaded = false;
    this.playlists = [];

    if (!cleanUid) {
      // Guest mode
      this.load();
      this.notify();
      return;
    }

    // Try user-scoped offline cache first
    try {
      const cached = localStorage.getItem(this.getStorageKey(cleanUid));
      if (cached) {
        this.playlists = JSON.parse(cached);
        this.isLoaded = true;
        this.notify();
      }
    } catch (_) {}

    try {
      // 1. Fetch exact cloud playlists from Firestore
      const res = await FirestoreService.getUserPlaylists(cleanUid);
      if (res !== null) {
        if (res.exists) {
          // Cloud playlists exist! Always use them as the source of truth across all devices.
          this.playlists = res.playlists;
          this.isLoaded = true;
          try {
            localStorage.setItem(this.getStorageKey(cleanUid), JSON.stringify(this.playlists));
          } catch (_) {}
          this.notify();
        } else if (this.playlists.length === 0) {
          // Truly a brand-new cloud user with no playlists created yet
          this.playlists = [...DEFAULT_PLAYLISTS];
          this.isLoaded = true;
          try {
            localStorage.setItem(this.getStorageKey(cleanUid), JSON.stringify(this.playlists));
          } catch (_) {}
          await FirestoreService.saveUserPlaylists(cleanUid, this.playlists);
          this.notify();
        } else {
          // User created playlists locally prior to registration, publish them to cloud
          await FirestoreService.saveUserPlaylists(cleanUid, this.playlists);
          this.notify();
        }
      } else {
        console.warn('[PlaylistService] Firestore unavailable during fetch. Preserving local cache without destructive overwrite.');
      }

      // 2. Real-time live listener for this account
      this.unsubscribeCloud = FirestoreService.subscribeUserPlaylists(cleanUid, (cloudList) => {
        if (!Array.isArray(cloudList)) return;
        const currentSnap = JSON.stringify(this.playlists.map(p => ({ id: p.id, count: p.tracks.length, updated: p.updatedAt })));
        const incomingSnap = JSON.stringify(cloudList.map(p => ({ id: p.id, count: p.tracks.length, updated: p.updatedAt })));
        
        if (currentSnap !== incomingSnap) {
          this.playlists = [...cloudList];
          try {
            localStorage.setItem(this.getStorageKey(cleanUid), JSON.stringify(this.playlists));
          } catch (_) {}
          this.notify();
        }
      });
    } catch (err) {
      console.warn('[PlaylistService] Cloud sync error:', err);
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
    this.save(true);
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
    this.save(true);
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
      this.save(true);
    }
  }

  static deletePlaylist(id: string): void {
    this.load();
    this.playlists = this.playlists.filter(p => p.id !== id);
    this.save(true);
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
    this.save(true);
    return true;
  }

  static addTracksToPlaylist(playlistId: string, tracks: Track[]): boolean {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist || !tracks || tracks.length === 0) return false;

    playlist.tracks.push(...tracks);
    playlist.updatedAt = Date.now();
    this.save(true);
    return true;
  }

  static removeTrackFromPlaylist(playlistId: string, trackId: string, trackIndex?: number): void {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    if (typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < playlist.tracks.length) {
      playlist.tracks.splice(trackIndex, 1);
    } else {
      const idx = playlist.tracks.findIndex(t => t.id === trackId);
      if (idx !== -1) {
        playlist.tracks.splice(idx, 1);
      }
    }
    playlist.updatedAt = Date.now();
    this.save(true);
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
            this.save(true);
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
