import { CustomPlaylist, Track } from '../types/music';
import { FirestoreService } from './firestoreService';
import { FirebaseAuthService } from './firebaseAuthService';
import { fetchItunesCover } from '../utils/artwork';
import { mergePlaylistTracksWithPending } from './libraryRankingLogic';

const DEFAULT_PLAYLISTS: CustomPlaylist[] = [
  {
    id: 'pl_midnight_starter',
    name: 'LUMEN Midnight Hi-Fi',
    description: 'Curated midnight aura, neon fidelity and deep soundscapes',
    coverUrl: null,
    coverColor: '#63E8FF',
    tracks: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  }
];

export class PlaylistService {
  private static playlists: CustomPlaylist[] = [];
  private static isLoaded = false;
  private static listeners: ((playlists: CustomPlaylist[]) => void)[] = [];
  private static currentUserId: string | null = null;
  private static unsubscribeCloud: (() => void) | null = null;
  private static hasSeededDefaults = false;
  // Protects recent local playlist edits (renames, cover changes, visibility toggles,
  // AND freshly added/removed tracks) from being overwritten by stale in-flight Firestore snapshots!
  private static pendingMetaEdits = new Map<string, { patch: Partial<CustomPlaylist>; expiresAt: number }>();
  private static pendingTrackAdds = new Map<string, { tracks: Track[]; expiresAt: number }>();
  private static pendingTrackRemovals = new Map<string, { trackIds: Set<string>; expiresAt: number }>();

  private static getStorageKey(uid?: string | null): string {
    const target = uid !== undefined ? uid : this.currentUserId;
    return target ? `lumen:${target}:playlists` : 'lumen:guest:playlists';
  }

  private static load(): void {
    if (this.isLoaded) return;
    const key = this.getStorageKey();
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        this.playlists = JSON.parse(stored);
      } else {
        // Fallback for previous storage keys during transition
        const legKey = this.currentUserId ? `lumen_playlists_${this.currentUserId}` : 'lumen_custom_playlists_v5';
        const leg = localStorage.getItem(legKey);
        if (leg) {
          try {
            this.playlists = JSON.parse(leg);
            localStorage.setItem(key, leg);
          } catch (_) {}
        }
      }
      if (!this.playlists || !Array.isArray(this.playlists) || this.playlists.length === 0) {
        this.playlists = [...DEFAULT_PLAYLISTS];
      }
    } catch (_) {
      this.playlists = [...DEFAULT_PLAYLISTS];
    }
    this.isLoaded = true;
  }

  private static cloudSaveTimer: any = null;

  private static saveLocal(): void {
    try {
      const key = this.getStorageKey();
      localStorage.setItem(key, JSON.stringify(this.playlists));
    } catch (err) {
      console.warn('Failed to save playlists to local storage:', err);
    }
    const targetUid = this.currentUserId || localStorage.getItem('lumen_persistent_uid');
    if (targetUid) {
      // Debounce full-library Firestore sync so rapid edits coalesce into a single lean write
      if (this.cloudSaveTimer) clearTimeout(this.cloudSaveTimer);
      const snapshot = [...this.playlists];
      this.cloudSaveTimer = setTimeout(() => {
        this.cloudSaveTimer = null;
        FirestoreService.saveUserPlaylists(targetUid, snapshot).catch(() => {});
      }, 2200);
    }
    this.notify();
  }

  private static notify(): void {
    const list = [...this.playlists];
    this.listeners.forEach(fn => {
      try { fn(list); } catch (_) {}
    });
  }

  static onPlaylistsChange(listener: (playlists: CustomPlaylist[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== listener);
    };
  }

  /**
   * Initializes PlaylistService for active user.
   * Reads local cache for instant UI, then subscribes to item-level Firestore playlists.
   * Cleans up completely on sign out.
   */
  static async initForUser(userId: string | null, isGuest: boolean = false): Promise<void> {
    if (this.unsubscribeCloud) {
      this.unsubscribeCloud();
      this.unsubscribeCloud = null;
    }

    const cleanUid = userId || localStorage.getItem('lumen_persistent_uid') || localStorage.getItem('lumen_guest_uid') || null;
    this.currentUserId = cleanUid;
    this.isLoaded = false;
    this.playlists = [];
    this.hasSeededDefaults = false;

    // Load local cache immediately for instant UI
    this.load();
    this.notify();

    if (!cleanUid) return;

    // Immediately sync local playlists to public profile so connected friends see public playlists right away
    if (this.playlists.length > 0) {
      FirestoreService.saveUserPlaylists(cleanUid, this.playlists).catch(() => {});
    }

    // Attach item-level cloud listener
    try {
      this.unsubscribeCloud = FirestoreService.subscribePlaylists(cleanUid, (cloudPlaylists, fromCache) => {
        if (!Array.isArray(cloudPlaylists)) return;

        if (cloudPlaylists.length > 0) {
          const now = Date.now();
          this.playlists = cloudPlaylists.map(cp => {
            let nextPl = cp;
            const pending = this.pendingMetaEdits.get(cp.id);
            if (pending) {
              if (now > pending.expiresAt) {
                this.pendingMetaEdits.delete(cp.id);
              } else {
                const allMatched = Object.entries(pending.patch).every(([k, v]) => (cp as any)[k] === v);
                if (allMatched) {
                  this.pendingMetaEdits.delete(cp.id);
                } else {
                  nextPl = { ...nextPl, ...pending.patch };
                }
              }
            }

            // Merge pending local track additions/removals so stale Firestore snapshots NEVER wipe freshly added songs!
            const pAdd = this.pendingTrackAdds.get(cp.id);
            const pRem = this.pendingTrackRemovals.get(cp.id);
            const activeAdds = pAdd && now <= pAdd.expiresAt ? pAdd.tracks : [];
            const activeRems = pRem && now <= pRem.expiresAt ? pRem.trackIds : new Set<string>();
            if (pAdd && now > pAdd.expiresAt) this.pendingTrackAdds.delete(cp.id);
            if (pRem && now > pRem.expiresAt) this.pendingTrackRemovals.delete(cp.id);

            if (activeAdds.length > 0 || activeRems.size > 0) {
              const merged = mergePlaylistTracksWithPending(nextPl.tracks || [], activeAdds, activeRems);
              if (merged.remainingAdds.length === 0) {
                this.pendingTrackAdds.delete(cp.id);
              } else {
                this.pendingTrackAdds.set(cp.id, { tracks: merged.remainingAdds, expiresAt: pAdd!.expiresAt });
              }
              if (merged.remainingRemovalIds.size === 0) {
                this.pendingTrackRemovals.delete(cp.id);
              } else {
                this.pendingTrackRemovals.set(cp.id, { trackIds: merged.remainingRemovalIds, expiresAt: pRem!.expiresAt });
              }
              nextPl = { ...nextPl, tracks: merged.mergedTracks };
            }

            return nextPl;
          });
          this.isLoaded = true;
          // Persist locally & notify UI WITHOUT triggering a recursive cloud write loop
          try {
            localStorage.setItem(this.getStorageKey(), JSON.stringify(this.playlists));
          } catch (_) {}
          this.notify();
        } else if (!fromCache && !this.hasSeededDefaults && this.playlists.length === 0) {
          // Only seed default starter playlist if server explicitly confirms user has none
          this.hasSeededDefaults = true;
          const starter = DEFAULT_PLAYLISTS[0];
          this.playlists = [starter];
          this.isLoaded = true;
          this.saveLocal();
          FirestoreService.savePlaylistMeta(cleanUid, starter).catch(() => {});
        }
      });
    } catch (err) {
      console.warn('[PlaylistService] Real-time playlists subscription error:', err);
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
      updatedAt: Date.now(),
      isPublic: true
    };
    this.playlists.unshift(newPlaylist);
    this.saveLocal();

    if (this.currentUserId) {
      FirestoreService.savePlaylistMeta(this.currentUserId, newPlaylist).catch(() => {});
    }
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
      coverUrl: coverUrl || null,
      coverColor,
      tracks: [...tracks],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: true
    };
    this.playlists.unshift(newPlaylist);
    this.saveLocal();

    if (this.currentUserId) {
      FirestoreService.savePlaylistMeta(this.currentUserId, newPlaylist).catch(() => {});
      tracks.forEach((t, i) => {
        FirestoreService.addPlaylistTrack(this.currentUserId!, newPlaylist.id, t, (i + 1) * 100).catch(() => {});
      });
    }
    return newPlaylist;
  }

  static updatePlaylist(id: string, updates: Partial<CustomPlaylist>): void {
    this.load();
    const idx = this.playlists.findIndex(p => p.id === id);
    if (idx !== -1) {
      const metaPatch: Partial<CustomPlaylist> = {};
      if (updates.name !== undefined) metaPatch.name = updates.name;
      if (updates.description !== undefined) metaPatch.description = updates.description;
      if (updates.coverUrl !== undefined) metaPatch.coverUrl = updates.coverUrl;
      if (updates.coverColor !== undefined) metaPatch.coverColor = updates.coverColor;
      if (updates.isPublic !== undefined) metaPatch.isPublic = updates.isPublic;
      if (Object.keys(metaPatch).length > 0) {
        const existing = this.pendingMetaEdits.get(id)?.patch || {};
        this.pendingMetaEdits.set(id, {
          patch: { ...existing, ...metaPatch },
          expiresAt: Date.now() + 15000
        });
      }

      this.playlists[idx] = {
        ...this.playlists[idx],
        ...updates,
        updatedAt: Date.now()
      };
      this.saveLocal();

      const targetUid = this.currentUserId || localStorage.getItem('lumen_persistent_uid') || localStorage.getItem('lumen_guest_uid');
      if (targetUid) {
        FirestoreService.savePlaylistMeta(targetUid, this.playlists[idx]).catch(() => {});
      }
    }
  }

  static deletePlaylist(id: string): void {
    this.load();
    this.playlists = this.playlists.filter(p => p.id !== id);
    this.saveLocal();

    if (this.currentUserId) {
      FirestoreService.deletePlaylistDoc(this.currentUserId, id).catch(() => {});
    }
  }

  static isTrackInPlaylist(playlistId: string, track: Track): boolean {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return false;
    const strId = String(track.id);
    const normTitle = (track.title || '').toLowerCase().trim();
    const normArtist = (track.artist || '').toLowerCase().trim();
    return playlist.tracks.some(t => {
      if (String(t.id) === strId) return true;
      return (t.title || '').toLowerCase().trim() === normTitle && (t.artist || '').toLowerCase().trim() === normArtist;
    });
  }

  /**
   * Appends track to playlist with fractional position (lastPos + 100).
   * Writes ONLY the single track document to Firestore!
   */
  static addTrackToPlaylist(playlistId: string, track: Track): boolean {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist) return false;

    const count = playlist.tracks.length;
    const position = (count + 1) * 100;
    const curUser = FirebaseAuthService.getCurrentUser();
    const enrichedTrack: Track = {
      ...track,
      addedByUid: track.addedByUid || curUser?.uid,
      addedByUsername: track.addedByUsername || curUser?.username || curUser?.displayName || 'listener'
    };

    // Guard against in-flight stale Firestore snapshots reverting this newly added song!
    const existingPending = this.pendingTrackAdds.get(playlistId)?.tracks || [];
    this.pendingTrackAdds.set(playlistId, {
      tracks: [...existingPending.filter(t => String(t.id) !== String(enrichedTrack.id)), enrichedTrack],
      expiresAt: Date.now() + 20000
    });
    const pendingRem = this.pendingTrackRemovals.get(playlistId);
    if (pendingRem) {
      pendingRem.trackIds.delete(String(enrichedTrack.id));
    }

    playlist.tracks = [...playlist.tracks, enrichedTrack];
    playlist.updatedAt = Date.now();
    this.saveLocal();

    const targetUid = this.currentUserId || localStorage.getItem('lumen_persistent_uid') || localStorage.getItem('lumen_guest_uid');
    if (targetUid) {
      FirestoreService.addPlaylistTrack(targetUid, playlistId, enrichedTrack, position).catch(() => {});
    }
    return true;
  }

  static addTracksToPlaylist(playlistId: string, tracks: Track[]): boolean {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist || !tracks || tracks.length === 0) return false;

    const startPos = playlist.tracks.length * 100;
    const existingPending = this.pendingTrackAdds.get(playlistId)?.tracks || [];
    const incomingIds = new Set(tracks.map(t => String(t.id)));
    this.pendingTrackAdds.set(playlistId, {
      tracks: [...existingPending.filter(t => !incomingIds.has(String(t.id))), ...tracks],
      expiresAt: Date.now() + 20000
    });

    playlist.tracks = [...playlist.tracks, ...tracks];
    playlist.updatedAt = Date.now();
    this.saveLocal();

    const targetUid = this.currentUserId || localStorage.getItem('lumen_persistent_uid') || localStorage.getItem('lumen_guest_uid');
    if (targetUid) {
      tracks.forEach((t, i) => {
        FirestoreService.addPlaylistTrack(targetUid, playlistId, t, startPos + (i + 1) * 100).catch(() => {});
      });
    }
    return true;
  }

  /**
   * Removes track safely by verifying exact trackId and metadata.
   * Prevents deleting the wrong/first song when called from sorted or filtered views!
   */
  static removeTrackFromPlaylist(
    playlistId: string, 
    trackId: string, 
    trackIndex?: number,
    trackTitle?: string,
    trackArtist?: string
  ): void {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.tracks.length === 0) return;

    let targetIndex = -1;

    // 1. If explicit trackIndex is supplied and matches trackId or track title, use that exact instance
    if (typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < playlist.tracks.length) {
      const candidate = playlist.tracks[trackIndex];
      if (candidate) {
        const matchesId = trackId && String(candidate.id) === String(trackId);
        const matchesName = trackTitle && candidate.title.trim().toLowerCase() === trackTitle.trim().toLowerCase() && 
          (!trackArtist || candidate.artist.trim().toLowerCase() === trackArtist.trim().toLowerCase());
        if (matchesId || matchesName) {
          targetIndex = trackIndex;
        }
      }
    }

    // 2. Exact track ID match in playlist.tracks
    if (targetIndex === -1 && trackId) {
      targetIndex = playlist.tracks.findIndex(t => String(t.id) === String(trackId));
    }

    // 3. Match by exact title and artist
    if (targetIndex === -1 && trackTitle) {
      targetIndex = playlist.tracks.findIndex(t => 
        t.title.trim().toLowerCase() === trackTitle.trim().toLowerCase() &&
        (!trackArtist || t.artist.trim().toLowerCase() === trackArtist.trim().toLowerCase())
      );
    }

    // 4. Fallback: partial ID match
    if (targetIndex === -1 && trackId) {
      targetIndex = playlist.tracks.findIndex(t => 
        String(t.id).includes(trackId) || trackId.includes(String(t.id))
      );
    }

    if (targetIndex === -1) {
      console.warn('[PlaylistService] Could not find track to remove with ID:', trackId, 'index:', trackIndex, 'title:', trackTitle);
      return;
    }

    const removedTrack = playlist.tracks[targetIndex];
    const removedTrackId = removedTrack?.id || trackId;
    if (removedTrackId) {
      const remSet = this.pendingTrackRemovals.get(playlistId)?.trackIds || new Set<string>();
      remSet.add(String(removedTrackId));
      this.pendingTrackRemovals.set(playlistId, { trackIds: remSet, expiresAt: Date.now() + 20000 });
      const pendingAdd = this.pendingTrackAdds.get(playlistId);
      if (pendingAdd) {
        pendingAdd.tracks = pendingAdd.tracks.filter(t => String(t.id) !== String(removedTrackId));
      }
    }
    playlist.tracks = playlist.tracks.filter((_, i) => i !== targetIndex);
    playlist.updatedAt = Date.now();
    this.saveLocal();

    const targetUid = this.currentUserId || localStorage.getItem('lumen_persistent_uid') || localStorage.getItem('lumen_guest_uid');
    if (targetUid && removedTrackId) {
      FirestoreService.removePlaylistTrack(targetUid, playlistId, String(removedTrackId)).catch(() => {});
    }
  }

  /**
   * Fractional-position track reordering.
   * Rewrites ONLY the single moved track document with its midpoint position!
   */
  static reorderTracks(playlistId: string, sourceIndex: number, destIndex: number): void {
    this.load();
    const playlist = this.playlists.find(p => p.id === playlistId);
    if (!playlist || sourceIndex === destIndex) return;
    if (sourceIndex < 0 || sourceIndex >= playlist.tracks.length) return;
    if (destIndex < 0 || destIndex >= playlist.tracks.length) return;

    const [movedTrack] = playlist.tracks.splice(sourceIndex, 1);
    playlist.tracks.splice(destIndex, 0, movedTrack);
    playlist.updatedAt = Date.now();
    this.saveLocal();

    if (this.currentUserId) {
      const beforePos = destIndex > 0 ? ((playlist.tracks[destIndex - 1] as any).position || (destIndex * 100)) : 0;
      const afterPos = destIndex < playlist.tracks.length - 1 ? ((playlist.tracks[destIndex + 1] as any).position || ((destIndex + 2) * 100)) : beforePos + 200;
      const newPos = (beforePos + afterPos) / 2;

      FirestoreService.addPlaylistTrack(this.currentUserId, playlistId, movedTrack, newPos).catch(() => {});
    }
  }

  private static isHealing = false;

  static async healPlaylists(onUpdated?: () => void): Promise<void> {
    this.load();
    if (this.isHealing) return;

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
        if (data?.success && Array.isArray(data.repairedTracks) && data.repairedTracks.length > 0) {
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
          }

          if (anyUpdated) {
            this.saveLocal();
            if (onUpdated) onUpdated();
          }
          return;
        }
      }
      throw new Error(`Server repair returned status ${res.status}`);
    } catch (err) {
      // Resilient client-side healing directly from iTunes/IndexedDB cache
      try {
        const batchSize = 6;
        for (let i = 0; i < tracksToRepair.length; i += batchSize) {
          const batch = tracksToRepair.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (t) => {
              if (!t.title || t.title === 'Unknown Title') return null;
              const url = await fetchItunesCover(t.title, t.artist);
              return url ? { id: t.id, url } : null;
            })
          );

          let updatedAny = false;
          for (const item of results) {
            if (!item) continue;
            for (const pl of this.playlists) {
              for (const t of pl.tracks) {
                if (t.id === item.id && (!t.artworkUrl || t.artworkUrl !== item.url)) {
                  t.artworkUrl = item.url;
                  t.hasArtwork = true;
                  updatedAny = true;
                }
              }
            }
          }

          if (updatedAny) {
            this.saveLocal();
            if (onUpdated) onUpdated();
          }

          // Polite pause between batches
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (clientErr) {
        console.warn('[PlaylistService] Client heal error:', clientErr);
      }
    } finally {
      this.isHealing = false;
    }
  }
}
