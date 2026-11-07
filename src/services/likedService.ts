import { Track } from '../types/music';
import { FirestoreService } from './firestoreService';

export class LikedService {
  private static likedTracks: Track[] = [];
  private static isLoaded = false;
  private static listeners: ((tracks: Track[]) => void)[] = [];
  private static currentUserId: string | null = null;
  private static unsubscribeCloud: (() => void) | null = null;

  private static getStorageKey(uid?: string | null): string {
    const target = uid !== undefined ? uid : this.currentUserId;
    return target ? `lumen:${target}:likes` : 'lumen:guest:likes';
  }

  private static load(): void {
    if (this.isLoaded) return;
    const key = this.getStorageKey();
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        this.likedTracks = JSON.parse(stored);
      } else {
        // Fallback check for previous storage keys during transition
        const legKey = this.currentUserId ? `lumen_liked_songs_${this.currentUserId}` : 'lumen_liked_songs_v1';
        const leg = localStorage.getItem(legKey);
        if (leg) {
          try {
            this.likedTracks = JSON.parse(leg);
            localStorage.setItem(key, leg);
          } catch (_) {}
        }
        if (!this.likedTracks) this.likedTracks = [];
      }
    } catch (_) {
      this.likedTracks = [];
    }
    this.isLoaded = true;
  }

  private static notify(): void {
    const list = [...this.likedTracks];
    this.listeners.forEach(fn => {
      try { fn(list); } catch (_) {}
    });
  }

  /**
   * Initializes LikedService for the active user session.
   * Reads instant local cache first, then establishes real-time item-level cloud sync.
   * On sign-out, clears in-memory state cleanly.
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

    // Load user's local cache immediately for instant UI
    this.load();
    this.notify();

    if (!cleanUid) return;

    // Attach real-time cloud listener with item-level conflict resolution
    try {
      this.unsubscribeCloud = FirestoreService.subscribeUserLikes(cleanUid, (cloudTracks, _fromCache) => {
        if (!Array.isArray(cloudTracks)) return;

        // Merge or replace with latest cloud tracks
        this.likedTracks = cloudTracks;
        this.isLoaded = true;

        try {
          localStorage.setItem(this.getStorageKey(cleanUid), JSON.stringify(this.likedTracks));
        } catch (_) {}

        this.notify();
      });
    } catch (err) {
      console.warn('[LikedService] Real-time likes subscription error:', err);
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
    return this.likedTracks.some(t => String(t.id) === String(trackId));
  }

  /**
   * Item-level toggle like.
   * Updates instant UI and persists item to Firestore with serverTimestamp().
   */
  static toggleLike(track: Track): boolean {
    this.load();
    const strId = String(track.id);
    const idx = this.likedTracks.findIndex(t => String(t.id) === strId || (t.title === track.title && t.artist === track.artist));

    if (idx !== -1) {
      this.likedTracks.splice(idx, 1);
      try {
        localStorage.setItem(this.getStorageKey(), JSON.stringify(this.likedTracks));
      } catch (_) {}
      this.notify();

      if (this.currentUserId) {
        FirestoreService.unlikeTrack(this.currentUserId, strId).catch(() => {});
      }
      return false;
    } else {
      const newTrack: Track = {
        ...track,
        id: strId,
        addedAt: Date.now()
      };
      this.likedTracks.unshift(newTrack);
      try {
        localStorage.setItem(this.getStorageKey(), JSON.stringify(this.likedTracks));
      } catch (_) {}
      this.notify();

      if (this.currentUserId) {
        FirestoreService.likeTrack(this.currentUserId, newTrack).catch(() => {});
      }
      return true;
    }
  }

  /**
   * Merges local guest likes into user account upon first sign in.
   */
  static async importLocalLikes(uid: string): Promise<void> {
    if (!uid) return;
    try {
      const guestKey = 'lumen:guest:likes';
      const raw = localStorage.getItem(guestKey);
      if (raw) {
        const guestTracks: Track[] = JSON.parse(raw);
        if (Array.isArray(guestTracks) && guestTracks.length > 0) {
          for (const t of guestTracks) {
            await FirestoreService.likeTrack(uid, t);
          }
        }
      }
    } catch (_) {}
  }
}
