import { Track } from '../types/music';
import { FirestoreService } from './firestoreService';

const LEGACY_STORAGE_KEY = 'lumen_liked_songs_v1';

export class LikedService {
  private static likedTracks: Track[] = [];
  private static isLoaded = false;
  private static listeners: ((tracks: Track[]) => void)[] = [];
  private static currentUserId: string | null = null;
  private static unsubscribeCloud: (() => void) | null = null;

  private static getStorageKey(uid?: string | null): string {
    const target = uid !== undefined ? uid : this.currentUserId;
    return target ? `lumen_liked_songs_${target}` : 'lumen_liked_songs_guest';
  }

  private static load(): void {
    if (this.isLoaded) return;
    const key = this.getStorageKey();
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        this.likedTracks = JSON.parse(stored);
      } else {
        if (!this.currentUserId) {
          const leg = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (leg) {
            try { this.likedTracks = JSON.parse(leg); } catch (_) {}
          }
        }
        if (!this.likedTracks) this.likedTracks = [];
      }
    } catch (_) {
      this.likedTracks = [];
    }
    this.isLoaded = true;
  }

  private static save(syncToCloud: boolean = true): void {
    try {
      const key = this.getStorageKey();
      localStorage.setItem(key, JSON.stringify(this.likedTracks));
      this.notify();
      if (syncToCloud && this.currentUserId) {
        FirestoreService.saveUserLikedSongs(this.currentUserId, this.likedTracks).catch(() => {});
      }
    } catch (err) {
      console.warn('Failed to save liked tracks:', err);
    }
  }

  private static notify(): void {
    const list = [...this.likedTracks];
    this.listeners.forEach(fn => fn(list));
  }

  /**
   * Initializes LikedService strictly for the active user.
   * Isolates liked tracks per account — eliminates cross-account leakage.
   */
  static async initForUser(userId: string | null, isGuest: boolean = false): Promise<void> {
    if (this.unsubscribeCloud) {
      this.unsubscribeCloud();
      this.unsubscribeCloud = null;
    }

    const cleanUid = (!userId || isGuest) ? null : userId;
    this.currentUserId = cleanUid;
    this.isLoaded = false;
    this.likedTracks = [];

    if (!cleanUid) {
      this.load();
      this.notify();
      return;
    }

    // Try user-scoped cache first
    try {
      const cached = localStorage.getItem(this.getStorageKey(cleanUid));
      if (cached) {
        this.likedTracks = JSON.parse(cached);
        this.isLoaded = true;
        this.notify();
      }
    } catch (_) {}

    try {
      // 1. Fetch exact cloud favorites from Firestore
      const cloudTracks = await FirestoreService.getUserLikedSongs(cleanUid);
      if (cloudTracks && Array.isArray(cloudTracks)) {
        // Cloud likes strictly overwrite — no merging with prior sessions
        this.likedTracks = cloudTracks;
        this.isLoaded = true;
        try {
          localStorage.setItem(this.getStorageKey(cleanUid), JSON.stringify(this.likedTracks));
        } catch (_) {}
        this.notify();
      }

      // 2. Real-time live listener for multi-device sync
      this.unsubscribeCloud = FirestoreService.subscribeUserLikedSongs(cleanUid, (cloudList) => {
        if (!Array.isArray(cloudList)) return;
        const currentIds = this.likedTracks.map(t => t.id).join(',');
        const incomingIds = cloudList.map(t => t.id).join(',');
        if (currentIds !== incomingIds) {
          this.likedTracks = [...cloudList];
          try {
            localStorage.setItem(this.getStorageKey(cleanUid), JSON.stringify(this.likedTracks));
          } catch (_) {}
          this.notify();
        }
      });
    } catch (err) {
      console.warn('[LikedService] Cloud sync error:', err);
    }
  }

  static onLikedChange(listener: (tracks: Track[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== listener);
    };
  }

  static getLikedTracks(): Track[] {
    this.load();
    return [...this.likedTracks];
  }

  static isLiked(trackId: string): boolean {
    this.load();
    return this.likedTracks.some(t => t.id === trackId);
  }

  static toggleLike(track: Track): boolean {
    this.load();
    const idx = this.likedTracks.findIndex(t => t.id === track.id || (t.title === track.title && t.artist === track.artist));
    if (idx !== -1) {
      this.likedTracks.splice(idx, 1);
      this.save(true);
      return false;
    } else {
      this.likedTracks.unshift({
        ...track,
        addedAt: Date.now()
      });
      this.save(true);
      return true;
    }
  }
}
