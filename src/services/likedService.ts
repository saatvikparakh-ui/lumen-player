import { Track } from '../types/music';
import { FirestoreService } from './firestoreService';

const STORAGE_KEY = 'lumen_liked_songs_v1';

export class LikedService {
  private static likedTracks: Track[] = [];
  private static isLoaded = false;
  private static listeners: ((tracks: Track[]) => void)[] = [];
  private static currentUserId: string | null = null;
  private static unsubscribeCloud: (() => void) | null = null;

  private static load(): void {
    if (this.isLoaded) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.likedTracks = JSON.parse(stored);
      } else {
        this.likedTracks = [];
      }
    } catch (_) {
      this.likedTracks = [];
    }
    this.isLoaded = true;
  }

  private static save(syncToCloud: boolean = true): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.likedTracks));
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
   * Initializes LikedService for a user, merges local likes with cloud favorites,
   * and attaches a real-time Firestore listener for live cross-device sync.
   */
  static async initForUser(userId: string | null, isGuest: boolean = false): Promise<void> {
    this.load();

    if (this.unsubscribeCloud) {
      this.unsubscribeCloud();
      this.unsubscribeCloud = null;
    }

    if (!userId || isGuest) {
      this.currentUserId = null;
      return;
    }

    this.currentUserId = userId;

    try {
      // 1. Fetch cloud favorites
      const cloudTracks = await FirestoreService.getUserLikedSongs(userId);
      if (cloudTracks && Array.isArray(cloudTracks)) {
        // Intelligent merge: combine local and cloud, avoiding duplicates
        const map = new Map<string, Track>();
        
        // Add cloud tracks first
        cloudTracks.forEach(t => {
          const key = t.id || `${t.title}_${t.artist}`.toLowerCase();
          map.set(key, t);
        });

        // Add any local tracks not present in cloud
        this.likedTracks.forEach(t => {
          const key = t.id || `${t.title}_${t.artist}`.toLowerCase();
          if (!map.has(key)) {
            map.set(key, t);
          }
        });

        const merged = Array.from(map.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        this.likedTracks = merged;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.likedTracks));
        this.notify();

        // Push unified merged list back to cloud
        await FirestoreService.saveUserLikedSongs(userId, merged);
      } else if (this.likedTracks.length > 0) {
        // Push local tracks to cloud for brand new account
        await FirestoreService.saveUserLikedSongs(userId, this.likedTracks);
      }

      // 2. Real-time live listener for multi-device sync
      this.unsubscribeCloud = FirestoreService.subscribeUserLikedSongs(userId, (cloudList) => {
        if (!Array.isArray(cloudList)) return;
        // Check if different from current
        const currentIds = this.likedTracks.map(t => t.id).join(',');
        const incomingIds = cloudList.map(t => t.id).join(',');
        if (currentIds !== incomingIds) {
          this.likedTracks = [...cloudList];
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.likedTracks));
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
