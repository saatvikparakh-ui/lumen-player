import { Track, SongRating, ListeningStats, FriendUser, CatalogComparison } from '../types/music';

type RatingChangeListener = (songId: string, rating: string | null) => void;

class RatingAndStatsServiceImpl {
  private ratingsCache: Map<string, string | null> = new Map();
  private listeners: Set<RatingChangeListener> = new Set();
  private isLoaded = false;
  private currentUserId = 'local_user';
  private currentUsername = 'You';

  constructor() {
    this.currentUserId = localStorage.getItem('lumen_user_id') || 'local_user';
    this.currentUsername = localStorage.getItem('lumen_username') || 'You';
  }

  getUserId(): string {
    return this.currentUserId;
  }

  getUsername(): string {
    return this.currentUsername;
  }

  setUserId(id: string, name?: string) {
    this.currentUserId = id;
    if (name) this.currentUsername = name;
    localStorage.setItem('lumen_user_id', id);
    if (name) localStorage.setItem('lumen_username', name);
    this.ratingsCache.clear();
    this.isLoaded = false;
    this.loadUserRatings();
  }

  onRatingChange(cb: RatingChangeListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(songId: string, rating: string | null) {
    this.listeners.forEach(cb => {
      try {
        cb(songId, rating);
      } catch (e) {
        console.error('Rating listener error:', e);
      }
    });
  }

  async loadUserRatings(): Promise<Map<string, string | null>> {
    if (this.isLoaded) return this.ratingsCache;
    try {
      const res = await fetch(`/api/ratings?userId=${encodeURIComponent(this.currentUserId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.ratings)) {
          data.ratings.forEach((r: any) => {
            this.ratingsCache.set(r.song_id, r.formatted);
          });
        }
        this.isLoaded = true;
      }
    } catch (e) {
      console.warn('[RatingService] Failed to load ratings:', e);
    }
    return this.ratingsCache;
  }

  getCachedRating(songId: string): string | null {
    return this.ratingsCache.get(songId) ?? null;
  }

  async getRating(songId: string): Promise<string | null> {
    if (this.ratingsCache.has(songId)) {
      return this.ratingsCache.get(songId) ?? null;
    }
    try {
      const res = await fetch(`/api/ratings?userId=${encodeURIComponent(this.currentUserId)}&songId=${encodeURIComponent(songId)}`);
      if (res.ok) {
        const data = await res.json();
        const formatted = data.rating?.formatted ?? null;
        this.ratingsCache.set(songId, formatted);
        return formatted;
      }
    } catch (e) {
      console.warn('[RatingService] Error fetching song rating:', e);
    }
    return null;
  }

  async setRating(track: Track, rating: number): Promise<{ tenths: number; formatted: string }> {
    // Normalise rating: e.g. 8.7 -> 87 tenths, formatted '8.7'
    const cleanRating = Math.max(0.1, Math.min(10.0, Math.round(rating * 10) / 10));
    const tenths = Math.round(cleanRating * 10);
    const formatted = cleanRating.toFixed(1);

    // Optimistically update cache and notify UI immediately
    this.ratingsCache.set(track.id, formatted);
    this.notify(track.id, formatted);

    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.currentUserId,
          songId: track.id,
          rating: cleanRating,
          track: {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const serverFormatted = data.rating?.formatted || formatted;
        this.ratingsCache.set(track.id, serverFormatted);
        this.notify(track.id, serverFormatted);
        return { tenths, formatted: serverFormatted };
      }
    } catch (e) {
      console.error('[RatingService] Failed to persist rating:', e);
    }
    return { tenths, formatted };
  }

  async deleteRating(songId: string): Promise<boolean> {
    // Optimistic removal: returns strictly to unrated (null)
    this.ratingsCache.set(songId, null);
    this.notify(songId, null);

    try {
      const res = await fetch(`/api/ratings?userId=${encodeURIComponent(this.currentUserId)}&songId=${encodeURIComponent(songId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        return true;
      }
      // Fallback endpoint
      await fetch('/api/ratings/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, songId })
      });
      return true;
    } catch (e) {
      console.error('[RatingService] Failed to delete rating:', e);
      return false;
    }
  }

  // --- Playback Telemetry Tracking ---
  async reportPlaybackEvent(
    track: Track,
    listenedDurationSeconds: number,
    status: 'completed' | 'skipped' = 'completed'
  ): Promise<void> {
    if (!track || !track.id) return;
    try {
      await fetch('/api/playback/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.currentUserId,
          songId: track.id,
          duration: track.duration || 180,
          listenedDuration: listenedDurationSeconds,
          status,
          track: {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration
          }
        })
      });
    } catch (e) {
      console.warn('[RatingService] Telemetry error:', e);
    }
  }

  // --- Listening Statistics ---
  async fetchListeningStats(window: '30d' | '90d' | 'all' = '30d'): Promise<ListeningStats | null> {
    try {
      const res = await fetch(`/api/stats?userId=${encodeURIComponent(this.currentUserId)}&window=${window}`);
      if (res.ok) {
        const data = await res.json();
        return data.stats || null;
      }
    } catch (e) {
      console.error('[RatingService] Failed to fetch stats:', e);
    }
    return null;
  }

  // --- Friends Network ---
  async fetchFriends(): Promise<{ friends: FriendUser[]; pending: any[]; visibility: string }> {
    try {
      const res = await fetch(`/api/friends?userId=${encodeURIComponent(this.currentUserId)}`);
      if (res.ok) {
        const data = await res.json();
        return {
          friends: data.friends || [],
          pending: data.pending || [],
          visibility: data.visibility || 'friends'
        };
      }
    } catch (e) {
      console.error('[RatingService] Failed to fetch friends:', e);
    }
    return { friends: [], pending: [], visibility: 'friends' };
  }

  async searchUser(username: string): Promise<FriendUser | null> {
    try {
      const res = await fetch('/api/friends/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (res.ok) {
        const data = await res.json();
        return data.user || null;
      }
    } catch (e) {
      console.error('[RatingService] User search failed:', e);
    }
    return null;
  }

  async sendFriendRequest(username: string): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterId: this.currentUserId, username })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true };
      }
      return { success: false, message: data.error || 'Failed to send request' };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  async respondFriendRequest(requesterId: string, action: 'accepted' | 'declined'): Promise<boolean> {
    try {
      const res = await fetch('/api/friends/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, requesterId, action })
      });
      return res.ok;
    } catch (e) {
      console.error('[RatingService] Friend response failed:', e);
      return false;
    }
  }

  async removeFriend(friendId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, friendId })
      });
      return res.ok;
    } catch (e) {
      console.error('[RatingService] Remove friend failed:', e);
      return false;
    }
  }

  async setRatingVisibility(visibility: 'public' | 'friends' | 'private'): Promise<boolean> {
    try {
      const res = await fetch('/api/user/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, visibility })
      });
      return res.ok;
    } catch (e) {
      console.error('[RatingService] Visibility update failed:', e);
      return false;
    }
  }

  // --- Taste Comparison Matrix ---
  async compareWithFriend(friendId: string, songId?: string): Promise<any> {
    try {
      let url = `/api/friends/compare?userId=${encodeURIComponent(this.currentUserId)}&friendId=${encodeURIComponent(friendId)}`;
      if (songId) {
        url += `&songId=${encodeURIComponent(songId)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return data.comparison || null;
      }
    } catch (e) {
      console.error('[RatingService] Comparison error:', e);
    }
    return null;
  }
}

export const RatingAndStatsService = new RatingAndStatsServiceImpl();
