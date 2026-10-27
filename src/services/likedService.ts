import { Track } from '../types/music';

const STORAGE_KEY = 'lumen_liked_songs_v1';

export class LikedService {
  private static likedTracks: Track[] = [];
  private static isLoaded = false;
  private static listeners: ((tracks: Track[]) => void)[] = [];

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

  private static save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.likedTracks));
      this.notify();
    } catch (err) {
      console.warn('Failed to save liked tracks to localStorage:', err);
    }
  }

  private static notify(): void {
    const list = [...this.likedTracks];
    this.listeners.forEach(fn => fn(list));
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
      this.save();
      return false;
    } else {
      this.likedTracks.unshift({
        ...track,
        addedAt: Date.now()
      });
      this.save();
      return true;
    }
  }
}
