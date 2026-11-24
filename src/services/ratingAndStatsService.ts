import { Track, SongRating, ListeningStats, FriendUser, CatalogComparison, SongShare, SongAvailabilityResolution } from '../types/music';
import { ApiClient } from './apiClient';
import { FirestoreService } from './firestoreService';
import { SupabaseService } from './supabaseService';
import { aggregateListeningEvents, RawListeningEvent } from './listeningStatsLogic';

type RatingChangeListener = (songId: string, rating: string | null) => void;

class RatingAndStatsServiceImpl {
  private ratingsCache: Map<string, string | null> = new Map();
  private listeners: Set<RatingChangeListener> = new Set();
  private isLoaded = false;
  private currentUserId = '';
  private currentUsername = 'You';
  private unsubscribeCloud: (() => void) | null = null;

  constructor() {
    this.currentUserId = localStorage.getItem('lumen_user_id') || '';
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

    if (this.unsubscribeCloud) {
      this.unsubscribeCloud();
      this.unsubscribeCloud = null;
    }

    if (id) {
      // Subscribe to real-time item-level cloud ratings
      this.unsubscribeCloud = FirestoreService.subscribeUserRatingsCollection(id, (cloudRatings) => {
        if (!cloudRatings) return;
        Object.entries(cloudRatings).forEach(([songId, rating]) => {
          this.ratingsCache.set(songId, rating);
          this.notify(songId, rating);
        });
      });
    }

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
      // 1. Check cloud ratings in Firestore first for seamless multi-device sync
      if (this.currentUserId) {
        const cloudRatings = await FirestoreService.getUserRatings(this.currentUserId);
        if (cloudRatings && Object.keys(cloudRatings).length > 0) {
          Object.entries(cloudRatings).forEach(([songId, rating]) => {
            if (rating) this.ratingsCache.set(songId, rating);
          });
          this.isLoaded = true;
        }
      }

      // 2. Also check backend API with quick timeout so offline/cold-start never stalls app
      try {
        const res = await fetch(ApiClient.resolveUrl(`/api/ratings?userId=${encodeURIComponent(this.currentUserId)}`), {
          signal: AbortSignal.timeout(1200)
        });
        if (res.ok) {
          const data = await ApiClient.safeJson(res);
          if (Array.isArray(data?.ratings)) {
            data.ratings.forEach((r: any) => {
              this.ratingsCache.set(r.song_id, r.formatted);
            });
          }
          this.isLoaded = true;
        }
      } catch (_) {}
    } catch (e) {
      console.warn('[RatingService] Failed to load ratings:', e);
    }
    // Background repair for placeholder IDs and corrupt junk
    this.healAndCleanRatings().catch(() => {});
    return this.ratingsCache;
  }

  getAllCachedRatings(): Map<string, string | null> {
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
      const res = await fetch(ApiClient.resolveUrl(`/api/ratings?userId=${encodeURIComponent(this.currentUserId)}&songId=${encodeURIComponent(songId)}`));
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

    // Save track metadata locally so title and artist are always preserved
    try {
      const stored = localStorage.getItem('lumen_rated_tracks_metadata');
      const metaMap = stored ? JSON.parse(stored) : {};
      metaMap[track.id] = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album || 'Single',
        artworkUrl: track.artworkUrl || null,
        duration: track.duration || 180,
        rating: formatted
      };
      localStorage.setItem('lumen_rated_tracks_metadata', JSON.stringify(metaMap));
      localStorage.setItem('lumen_ratings_cache', JSON.stringify(Object.fromEntries(this.ratingsCache)));
    } catch (_) {}

    // 1. Save directly to Supabase Realtime (<50ms instant sync)
    if (this.currentUserId) {
      SupabaseService.saveUserSongRating(this.currentUserId, track, cleanRating, formatted).catch(() => {});
    }

    // 2. Save to item-level Firestore path: users/{uid}/ratings/{trackId} and public profile
    if (this.currentUserId) {
      FirestoreService.setTrackRating(this.currentUserId, track, cleanRating, formatted).catch(() => {});
    }

    try {
      fetch(ApiClient.resolveUrl('/api/ratings'), {
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
      }).catch(() => {});
    } catch (_) {}

    return { tenths, formatted };
  }

  async deleteRating(songId: string): Promise<boolean> {
    // Optimistic removal: returns strictly to unrated (null)
    this.ratingsCache.set(songId, null);
    this.notify(songId, null);

    try {
      const stored = localStorage.getItem('lumen_rated_tracks_metadata');
      if (stored) {
        const metaMap = JSON.parse(stored);
        if (metaMap && metaMap[songId]) {
          delete metaMap[songId];
          localStorage.setItem('lumen_rated_tracks_metadata', JSON.stringify(metaMap));
        }
      }
      localStorage.setItem('lumen_ratings_cache', JSON.stringify(Object.fromEntries(this.ratingsCache)));
    } catch (_) {}

    if (this.currentUserId) {
      FirestoreService.deleteTrackRating(this.currentUserId, songId).catch(() => {});
    }

    try {
      fetch(ApiClient.resolveUrl(`/api/ratings?userId=${encodeURIComponent(this.currentUserId)}&songId=${encodeURIComponent(songId)}`), {
        method: 'DELETE'
      }).catch(() => {});
    } catch (_) {}

    return true;
  }

  /**
   * Returns all currently rated songs with normalized Track objects and numeric scores,
   * sorted highest-rated first by default.
   */
  getAllRatedTracks(): Array<{ track: Track; rating: number; formatted: string }> {
    const metaMap: Record<string, any> = (() => {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_rated_tracks_metadata') : null;
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    })();

    const results: Array<{ track: Track; rating: number; formatted: string }> = [];
    const seenIds = new Set<string>();

    const pushEntry = (songId: string, rawRating: string | number | null | undefined, meta?: any) => {
      if (!songId || seenIds.has(songId)) return;
      const num = typeof rawRating === 'number' ? rawRating : parseFloat(String(rawRating ?? ''));
      if (!Number.isFinite(num) || num <= 0) return;
      const cleanTitle = (meta?.title || '').trim();
      const cleanArtist = (meta?.artist || '').trim();
      if (!cleanTitle || cleanTitle.toLowerCase().startsWith('track itunes_')) return;
      seenIds.add(songId);
      const formatted = Math.max(0.1, Math.min(10.0, Math.round(num * 10) / 10)).toFixed(1);
      results.push({
        track: {
          id: songId,
          title: cleanTitle,
          artist: cleanArtist || 'Unknown Artist',
          album: meta?.album || 'Single',
          artworkUrl: meta?.artworkUrl || null,
          duration: Number(meta?.duration) > 0 ? Number(meta.duration) : 180,
          streamUrl: meta?.streamUrl || '',
          path: meta?.path || '',
          filename: meta?.filename || `${cleanTitle}.mp3`,
          hasArtwork: Boolean(meta?.artworkUrl),
          addedAt: Number(meta?.addedAt) || Date.now()
        },
        rating: parseFloat(formatted),
        formatted
      });
    };

    for (const [songId, ratingVal] of this.ratingsCache.entries()) {
      if (ratingVal) {
        pushEntry(songId, ratingVal, metaMap[songId]);
      }
    }

    for (const [songId, meta] of Object.entries(metaMap)) {
      if (this.ratingsCache.has(songId) && this.ratingsCache.get(songId) === null) continue;
      if (meta && meta.rating) {
        pushEntry(songId, meta.rating, meta);
      }
    }

    results.sort((a, b) => b.rating - a.rating || a.track.title.localeCompare(b.track.title));
    return results;
  }

  /**
   * Scans all cached ratings, heals placeholder IDs (e.g. itunes_1071...) by querying Apple/iTunes lookup,
   * restores authentic titles and artists, and purges completely unresolvable or corrupted junk.
   */
  public async healAndCleanRatings(): Promise<void> {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_rated_tracks_metadata') : null;
      const metaMap: Record<string, any> = stored ? JSON.parse(stored) : {};
      let changed = false;

      const entries = Array.from(this.ratingsCache.entries());
      for (const [songId, rating] of entries) {
        if (!rating) continue;
        const meta = metaMap[songId];
        const title = (meta?.title || '').trim().toLowerCase();
        const artist = (meta?.artist || '').trim().toLowerCase();

        // Detect corrupt or unresolvable placeholder entries
        const isPlaceholder = 
          !meta?.title || 
          title.includes('what is itunes') || 
          title.startsWith('itunes ') ||
          title.startsWith('track itunes_') ||
          songId.includes('itunes_1071');

        if (isPlaceholder) {
          // Attempt iTunes numeric lookup if possible
          const cleanId = songId.replace(/^itunes_/, '').trim();
          if (/^\d+$/.test(cleanId)) {
            try {
              const res = await fetch(`https://itunes.apple.com/lookup?id=${cleanId}&entity=song`);
              if (res.ok) {
                const data = await res.json();
                if (data.resultCount > 0 && data.results[0]) {
                  const it = data.results[0];
                  metaMap[songId] = {
                    id: songId,
                    title: it.trackName || it.collectionName,
                    artist: it.artistName || 'Various Artists',
                    album: it.collectionName || 'Single',
                    artworkUrl: it.artworkUrl100 ? it.artworkUrl100.replace('100x100bb', '600x600bb') : null,
                    duration: Math.round((it.trackTimeMillis || 180000) / 1000),
                    rating: rating
                  };
                  changed = true;
                  continue;
                }
              }
            } catch (_) {}
          }

          // If unresolvable or junk placeholder, purge it
          this.ratingsCache.delete(songId);
          delete metaMap[songId];
          this.notify(songId, null);
          if (this.currentUserId) {
            FirestoreService.deleteTrackRating(this.currentUserId, songId).catch(() => {});
          }
          changed = true;
        }
      }

      if (changed && typeof localStorage !== 'undefined') {
        localStorage.setItem('lumen_rated_tracks_metadata', JSON.stringify(metaMap));
        localStorage.setItem('lumen_ratings_cache', JSON.stringify(Object.fromEntries(this.ratingsCache)));
      }
    } catch (err) {
      console.warn('[RatingService] healAndCleanRatings warning:', err);
    }
  }

  /**
   * Returns ALL verified rated tracks for the currently logged-in user with their metadata.
   * Completely decoupled from likes, ensuring 100% of rated songs appear in Tier List Studio for any user.
   */
  public getRatedTracksWithMetadata(): Track[] {
    const list: Track[] = [];
    const metaMap: Record<string, any> = (() => {
      try {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_rated_tracks_metadata') : null;
        return stored ? JSON.parse(stored) : {};
      } catch (_) {
        return {};
      }
    })();

    const likedMap: Map<string, any> = new Map();
    try {
      const rawLiked = typeof localStorage !== 'undefined' ? (localStorage.getItem('lumen_liked_tracks_v1') || localStorage.getItem('lumen_liked_tracks')) : null;
      if (rawLiked) {
        const parsed = JSON.parse(rawLiked);
        const arr = Array.isArray(parsed) ? parsed : Object.values(parsed);
        arr.forEach((t: any) => { if (t?.id) likedMap.set(t.id, t); });
      }
    } catch (_) {}

    this.ratingsCache.forEach((rating, songId) => {
      if (!rating) return;
      const meta = metaMap[songId];
      const liked = likedMap.get(songId);

      // Clean title
      let rawTitle = meta?.title || liked?.title || '';
      let rawArtist = meta?.artist || liked?.artist || '';

      // Skip corrupted placeholder tracks
      if (rawTitle.toLowerCase().includes('what is itunes') || (rawTitle.toLowerCase().startsWith('itunes ') && !rawArtist)) {
        return;
      }

      if (!rawTitle) {
        if (songId.startsWith('itunes_')) {
          rawTitle = `Track ${songId.replace(/^itunes_/, '')}`;
        } else {
          rawTitle = songId.length > 12 ? songId.replace(/_/g, ' ') : `Track ${songId}`;
        }
      }
      if (!rawArtist) {
        rawArtist = 'Rated Track';
      }

      const scoreNum = parseFloat(rating.replace(/[^0-9.]/g, '')) || 0;

      list.push({
        id: songId,
        title: rawTitle,
        artist: rawArtist,
        album: meta?.album || liked?.album || 'Rated Single',
        artworkUrl: meta?.artworkUrl || liked?.artworkUrl || null,
        duration: meta?.duration || liked?.duration || 180,
        streamUrl: meta?.streamUrl || liked?.streamUrl || '',
        rating: rating,
        score: scoreNum
      } as any);
    });

    return list.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
  }

  // --- Playback Telemetry Tracking ---
  async reportPlaybackEvent(
    track: Track,
    listenedDurationSeconds: number,
    status: 'completed' | 'skipped' = 'completed'
  ): Promise<void> {
    if (!track || !track.id) return;
    try {
      // 1. Immediately log event into local persistent storage for reliable offline listening statistics
      const eventLogKey = 'lumen_listening_events_log';
      let events: any[] = [];
      try {
        const raw = localStorage.getItem(eventLogKey);
        if (raw) events = JSON.parse(raw);
      } catch (_) {}

      const trackDur = track.duration && track.duration > 10 ? track.duration : 210;
      const actualListenSec = Math.max(1, Math.round(listenedDurationSeconds || (status === 'completed' ? trackDur : 30)));

      events.push({
        id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        eventType: status === 'completed' ? 'complete' : 'play',
        listenDurationSec: actualListenSec,
        totalDurationSec: trackDur,
        timestamp: Date.now()
      });

      if (events.length > 2000) events = events.slice(events.length - 2000);
      try {
        localStorage.setItem(eventLogKey, JSON.stringify(events));
      } catch (_) {}

      // 2. Also dispatch to local server API if running
      await fetch(ApiClient.resolveUrl('/api/playback/event'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.currentUserId,
          songId: track.id,
          duration: trackDur,
          listenedDuration: actualListenSec,
          status,
          track: {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: trackDur
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
      // 1. Ensure user ratings are loaded for accurate rating breakdown
      if (!this.isLoaded) {
        await this.loadUserRatings();
      }

      // 2. Compute real metrics from local listening events and library telemetry
      const localStats = this.computeListeningStats(window);
      if (localStats && ((localStats.summary?.total_plays || 0) > 0 || (localStats.top_songs?.length || 0) > 0 || (localStats.rating_stats?.highest_rated?.length || 0) > 0)) {
        // Sync to private Firestore summary for cross-device persistence
        if (this.currentUserId && !this.currentUserId.startsWith('gst_')) {
          FirestoreService.saveUserListeningStats(this.currentUserId, localStats).catch(() => {});
        }
        return localStats;
      }

      // 3. Fallback: try reading cloud snapshot from Firestore
      if (this.currentUserId && !this.currentUserId.startsWith('gst_')) {
        try {
          const cloudStats = await FirestoreService.getUserListeningStats(this.currentUserId);
          if (cloudStats && cloudStats.summary) return cloudStats;
        } catch (_) {}
      }

      // 4. Return formatted empty stats structure
      return localStats || this.getEmptyStats(window);
    } catch (e) {
      console.warn('[RatingService] fetchListeningStats error:', e);
      return this.getEmptyStats(window);
    }
  }

  /**
   * Computes offline-first listening statistics from telemetry logs and user ratings
   */
  private computeListeningStats(window: '30d' | '90d' | 'all'): ListeningStats {
    const now = Date.now();
    let cutoff = 0;
    if (window === '30d') cutoff = now - 30 * 24 * 60 * 60 * 1000;
    else if (window === '90d') cutoff = now - 90 * 24 * 60 * 60 * 1000;

    let events: RawListeningEvent[] = [];
    try {
      const raw = localStorage.getItem('lumen_listening_events_log');
      if (raw) events = JSON.parse(raw);
    } catch (_) {}

    let libTracks: any[] = [];
    try {
      const storedTracks = localStorage.getItem('lumen_library_tracks_v1');
      if (storedTracks) libTracks = JSON.parse(storedTracks);
    } catch (_) {}

    const ratingsLookup: Record<string, string | null> = {};
    this.ratingsCache.forEach((val, key) => {
      ratingsLookup[key] = val;
    });

    const aggregated = aggregateListeningEvents({
      events,
      libraryTracks: libTracks,
      ratingsLookup,
      window,
      nowMs: now
    });

    const windowEvents = (events || []).filter(e => (e?.timestamp || 0) >= cutoff);
    const songMap = new Map(aggregated.top_songs.map(s => [s.song_id, s]));
    const { total_plays: totalPlays, qualified_plays: qualifiedPlays, total_listening_duration_seconds: totalDurationSec, total_listening_duration_formatted: totalDurationFormatted, completion_rate_percent: completionRate } = aggregated.summary;
    const topSongs = aggregated.top_songs;
    const topArtists = aggregated.top_artists;
    const topDurationSongs = aggregated.top_duration_songs;

    // Highest Rated Songs enriched with persistent track metadata
    const highestRated: Array<{
      song_id: string;
      title: string;
      artist: string;
      rating_value: number;
      rating_formatted: string;
    }> = [];

    // Pre-populate metadata map from stored ratings metadata, library, and playlists
    const enrichedMetaMap = new Map<string, { title: string; artist: string }>();
    try {
      const storedMeta = localStorage.getItem('lumen_rated_tracks_metadata');
      if (storedMeta) {
        const parsed = JSON.parse(storedMeta);
        Object.entries(parsed).forEach(([id, meta]: [string, any]) => {
          if (meta?.title) enrichedMetaMap.set(id, { title: meta.title, artist: meta.artist || 'Unknown Artist' });
        });
      }
      const recentTracks = localStorage.getItem('lumen_recent_tracks');
      if (recentTracks) {
        JSON.parse(recentTracks).forEach((t: any) => {
          if (t?.id && !enrichedMetaMap.has(t.id)) enrichedMetaMap.set(t.id, { title: t.title, artist: t.artist || 'Unknown Artist' });
        });
      }
      const customPlaylists = localStorage.getItem('lumen_custom_playlists_v1');
      if (customPlaylists) {
        JSON.parse(customPlaylists).forEach((pl: any) => {
          (pl.tracks || []).forEach((t: any) => {
            if (t?.id && !enrichedMetaMap.has(t.id)) enrichedMetaMap.set(t.id, { title: t.title, artist: t.artist || 'Unknown Artist' });
          });
        });
      }
      const likedTracks = localStorage.getItem('lumen_liked_tracks_v1') || localStorage.getItem('lumen_liked_tracks');
      if (likedTracks) {
        const parsed = JSON.parse(likedTracks);
        const arr = Array.isArray(parsed) ? parsed : Object.values(parsed);
        arr.forEach((t: any) => {
          if (t?.id && !enrichedMetaMap.has(t.id)) enrichedMetaMap.set(t.id, { title: t.title, artist: t.artist || 'Unknown Artist' });
        });
      }
    } catch (_) {}

    this.ratingsCache.forEach((rating, songId) => {
      if (rating) {
        const num = parseFloat(rating.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) {
          const match = songMap.get(songId);
          const meta = enrichedMetaMap.get(songId);
          const title = match?.title || meta?.title || (songId.length > 12 ? songId.replace(/_/g, ' ') : `Track ${songId}`);
          const artist = match?.artist || meta?.artist || 'Rated Track';

          highestRated.push({
            song_id: songId,
            title,
            artist,
            rating_value: num,
            rating_formatted: rating,
            formatted: rating,
            score: num
          } as any);
        }
      }
    });
    highestRated.sort((a, b) => b.rating_value - a.rating_value);

    // Chronological Log
    const chronologicalLog = windowEvents
      .slice(-50)
      .reverse()
      .map((ev, idx) => ({
        event_id: ev.id || `ev_${ev.timestamp || Date.now()}_${idx}`,
        song_id: ev.trackId,
        title: ev.title || 'Unknown Track',
        artist: ev.artist || 'Unknown Artist',
        started_at: ev.timestamp,
        listened_duration_seconds: ev.listenDurationSec,
        completion_status: ev.eventType,
        qualified: (ev.listenDurationSec >= 30 || ev.eventType === 'complete') ? 1 : 0
      }));

    return {
      window,
      summary: {
        total_plays: totalPlays,
        qualified_plays: qualifiedPlays,
        completion_rate_percent: completionRate,
        total_listening_duration_seconds: totalDurationSec,
        total_listening_duration_formatted: totalDurationFormatted
      },
      top_songs: topSongs,
      top_artists: topArtists,
      top_duration_songs: topDurationSongs,
      chronological_log: chronologicalLog,
      rating_stats: {
        highest_rated: highestRated.slice(0, 20),
        total_rated: highestRated.length,
        average_rating: highestRated.length > 0 
          ? Number((highestRated.reduce((sum, r) => sum + r.rating_value, 0) / highestRated.length).toFixed(1))
          : 0
      } as any
    };
  }

  private getEmptyStats(window: '30d' | '90d' | 'all'): ListeningStats {
    return {
      window,
      summary: {
        total_plays: 0,
        qualified_plays: 0,
        completion_rate_percent: 0,
        total_listening_duration_seconds: 0,
        total_listening_duration_formatted: '0m'
      },
      top_songs: [],
      top_artists: [],
      top_duration_songs: [],
      chronological_log: [],
      rating_stats: {
        highest_rated: [],
        total_rated: 0,
        average_rating: 0
      } as any
    };
  }

  // --- Friends Network ---
  async fetchFriends(): Promise<{ friends: FriendUser[]; pending: any[]; visibility: string }> {
    try {
      const res = await fetch(ApiClient.resolveUrl(`/api/friends?userId=${encodeURIComponent(this.currentUserId)}`));
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
      const res = await fetch(ApiClient.resolveUrl('/api/friends/search'), {
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
      const res = await fetch(ApiClient.resolveUrl('/api/friends/request'), {
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
      const res = await fetch(ApiClient.resolveUrl('/api/friends/respond'), {
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
      const res = await fetch(ApiClient.resolveUrl('/api/friends/remove'), {
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

  // --- Song Sharing Subsystem (Instant Serverless Sub-Second Sharing) ---
  async sendSongShare(params: {
    recipientId: string;
    song: Track;
    message?: string;
    externalLink?: string;
  }): Promise<{ success: boolean; share?: SongShare; message?: string }> {
    try {
      // 1. Direct Firestore setDoc (< 300ms real-time delivery worldwide for free)
      const res = await FirestoreService.sendSongShare(
        { uid: this.currentUserId, username: this.currentUsername } as any,
        params.recipientId,
        params.song,
        params.message
      );
      if (res.success) {
        return { success: true };
      }
      return { success: false, message: res.error || 'Failed to send share' };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  async fetchReceivedShares(unreadOnly = false, includeDismissed = false): Promise<SongShare[]> {
    try {
      const url = `/api/shares/received?userId=${encodeURIComponent(this.currentUserId)}&unreadOnly=${unreadOnly}&includeDismissed=${includeDismissed}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return data.shares || [];
      }
    } catch (e) {
      console.error('[RatingService] Failed to fetch received shares:', e);
    }
    return [];
  }

  async fetchSentShares(): Promise<SongShare[]> {
    try {
      const url = `/api/shares/sent?userId=${encodeURIComponent(this.currentUserId)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return data.shares || [];
      }
    } catch (e) {
      console.error('[RatingService] Failed to fetch sent shares:', e);
    }
    return [];
  }

  async markShareRead(shareId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/shares/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, shareId })
      });
      return res.ok;
    } catch (e) {
      console.error('[RatingService] Mark share read failed:', e);
      return false;
    }
  }

  async dismissShare(shareId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/shares/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, shareId })
      });
      return res.ok;
    } catch (e) {
      console.error('[RatingService] Dismiss share failed:', e);
      return false;
    }
  }

  async revokeShare(shareId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/shares/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, shareId })
      });
      return res.ok;
    } catch (e) {
      console.error('[RatingService] Revoke share failed:', e);
      return false;
    }
  }

  async resolveSongAvailability(share: SongShare, libraryTracks: Track[] = []): Promise<SongAvailabilityResolution> {
    try {
      const res = await fetch('/api/shares/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share, libraryTracks })
      });
      if (res.ok) {
        const data = await res.json();
        return data.resolution;
      }
    } catch (e) {
      console.error('[RatingService] Availability resolution failed:', e);
    }

    // Client-side fallback matching
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sTitle = norm(share.title);
    const sArtist = norm(share.artist);
    const match = libraryTracks.find(t => norm(t.title) === sTitle && norm(t.artist) === sArtist);
    if (match) {
      return {
        available: true,
        matchType: 'local_exact',
        matchedTrack: match,
        reason: 'Exact match found in your library.'
      };
    }
    if (share.stream_url) {
      return {
        available: true,
        matchType: 'stream_url',
        matchedTrack: {
          id: share.song_id || 'shared_' + share.share_id,
          title: share.title,
          artist: share.artist,
          album: share.album || 'Shared Song',
          duration: share.duration || 180,
          streamUrl: share.stream_url,
          path: share.stream_url,
          filename: `${share.artist} - ${share.title}.mp3`,
          hasArtwork: false,
          addedAt: Date.now()
        },
        reason: 'Available via stream link.'
      };
    }
    return {
      available: false,
      matchType: 'none',
      matchedTrack: null,
      reason: 'This song is not available in your current library.'
    };
  }
}

export const RatingAndStatsService = new RatingAndStatsServiceImpl();
