/**
 * LUMEN PERSONALIZED AUTOPLAY SERVICE (Async Orchestrator & Event Store)
 *
 * Connects the deterministic AutoplayEngine to Lumen's real data layers:
 *  - Per-user listening event storage (deliberate plays, completions, repeats, skips, dislikes)
 *  - Multi-pool candidate gathering across iTunes, JioSaavn (including reco.getreco radio),
 *    user playlists (co-occurrence), liked songs (familiar favorites), and offline local files
 *  - Single in-flight refill lock keyed by (userId, queueGenerationId) so stale responses
 *    after track switch, queue clear, autoplay disable, or account switch are always discarded
 */

import { Track } from '../types/music';
import { LikedService } from './likedService';
import { PlaylistService } from './playlistService';
import { FirebaseAuthService } from './firebaseAuthService';
import { ARTIST_AFFINITY_GRAPH, TasteEngineService } from './tasteEngineService';
import { StreamingService } from './streamingService';
import {
  AutoplayEventType,
  AutoplayListeningEvent,
  AutoplayQueueItem,
  AutoplaySessionContext,
  AutoplayTrackMeta,
  AutoplayWeights,
  DEFAULT_AUTOPLAY_WEIGHTS,
  SessionPlayEntry,
  buildUserTasteProfile,
  getCanonicalRecordingKey,
  normalizeArtistName,
  selectAutoplaySequence
} from './autoplayEngine';

const AUTOPLAY_ENABLED_KEY = 'lumen_autoplay_enabled_v1';
const AUTOPLAY_EVENTS_PREFIX = 'lumen_autoplay_events_v1_';
const MAX_STORED_EVENTS = 400;

class AutoplayServiceClass {
  private activeUserId: string = 'guest';
  private events: AutoplayListeningEvent[] = [];
  private sessionRecentPlays: SessionPlayEntry[] = [];
  private sessionSkippedRecordingKeys = new Set<string>();
  private sessionSkippedArtistKeys = new Set<string>();
  private activeContext: AutoplaySessionContext['activeContext'] | undefined = undefined;
  private autoplayEnabled: boolean = true;
  private weights: AutoplayWeights = { ...DEFAULT_AUTOPLAY_WEIGHTS };
  private inFlightKey: string | null = null;
  private inFlightAbort: AbortController | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    this.autoplayEnabled = this.loadAutoplayEnabled();
    this.syncActiveUser();
  }

  private loadAutoplayEnabled(): boolean {
    try {
      const raw = localStorage.getItem(AUTOPLAY_ENABLED_KEY);
      if (raw === 'false') return false;
      return true;
    } catch (_) {
      return true;
    }
  }

  public isEnabled(): boolean {
    return this.autoplayEnabled;
  }

  public setEnabled(enabled: boolean): void {
    this.autoplayEnabled = Boolean(enabled);
    try {
      localStorage.setItem(AUTOPLAY_ENABLED_KEY, String(this.autoplayEnabled));
    } catch (_) {}
    if (!this.autoplayEnabled) {
      this.cancelInFlight();
    }
    this.notify();
  }

  public getWeights(): AutoplayWeights {
    return { ...this.weights };
  }

  public setWeights(partial: Partial<AutoplayWeights>): void {
    this.weights = { ...this.weights, ...partial };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(cb => {
      try { cb(); } catch (_) {}
    });
  }

  public getActiveUserId(): string {
    const authUid = FirebaseAuthService.getCurrentUser()?.uid;
    return authUid || this.activeUserId || 'guest';
  }

  /**
   * Switches active user scope: isolates events, resets session context, and cancels pending refills.
   */
  public setActiveUser(userId?: string | null): void {
    const nextUid = (userId || FirebaseAuthService.getCurrentUser()?.uid || 'guest').trim();
    if (nextUid === this.activeUserId && this.events.length > 0) return;

    this.cancelInFlight();
    this.activeUserId = nextUid;
    this.sessionRecentPlays = [];
    this.sessionSkippedRecordingKeys.clear();
    this.sessionSkippedArtistKeys.clear();
    this.activeContext = undefined;
    this.loadUserEvents(nextUid);
    this.notify();
  }

  public syncActiveUser(): void {
    const uid = FirebaseAuthService.getCurrentUser()?.uid || 'guest';
    if (uid !== this.activeUserId) {
      this.setActiveUser(uid);
    } else if (this.events.length === 0) {
      this.loadUserEvents(uid);
    }
  }

  private loadUserEvents(userId: string): void {
    this.events = [];
    try {
      const raw = localStorage.getItem(`${AUTOPLAY_EVENTS_PREFIX}${userId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.events = parsed.filter((e: any) => e && e.userId === userId).slice(-MAX_STORED_EVENTS);
        }
      }
    } catch (_) {}
  }

  private persistUserEvents(): void {
    try {
      localStorage.setItem(
        `${AUTOPLAY_EVENTS_PREFIX}${this.activeUserId}`,
        JSON.stringify(this.events.slice(-MAX_STORED_EVENTS))
      );
    } catch (_) {}
  }

  public cancelInFlight(): void {
    if (this.inFlightAbort) {
      this.inFlightAbort.abort();
      this.inFlightAbort = null;
    }
    this.inFlightKey = null;
  }

  /**
   * Records a user-scoped listening event and updates session state cleanly.
   * Technical errors (playback_error, app_close, seek, network_interruption) are NEVER treated as dislikes.
   */
  public recordEvent(params: {
    track: AutoplayTrackMeta;
    eventType: AutoplayEventType;
    source: 'user' | 'autoplay';
    listenDurationSec?: number;
    totalDurationSec?: number;
  }): void {
    this.syncActiveUser();
    const { track, eventType, source } = params;
    if (!track || !track.title) return;

    // Never store technical errors as negative taste feedback
    if (
      eventType === 'playback_error' ||
      eventType === 'app_close' ||
      eventType === 'seek' ||
      eventType === 'network_interruption'
    ) {
      return;
    }

    const recKey = getCanonicalRecordingKey(track);
    const artistKey = normalizeArtistName(track.artist);
    const now = Date.now();

    // Detect if user deliberately returned to a song previously introduced via autoplay
    let effectiveType: AutoplayEventType = eventType;
    if (eventType === 'deliberate_play' && source === 'user') {
      const wasAutoplayBefore = this.events.some(
        e => e.recordingKey === recKey && e.eventType === 'autoplay_complete'
      );
      if (wasAutoplayBefore) {
        effectiveType = 'deliberate_return_to_autoplay';
      }
    }

    const ev: AutoplayListeningEvent = {
      userId: this.activeUserId,
      trackId: track.id,
      recordingKey: recKey,
      artist: track.artist || 'Unknown Artist',
      artistId: track.artistId,
      title: track.title,
      genre: track.genre,
      language: track.language,
      styleTags: track.styleTags,
      eventType: effectiveType,
      source,
      listenDurationSec: params.listenDurationSec,
      totalDurationSec: params.totalDurationSec || track.duration,
      timestamp: now
    };

    this.events.push(ev);
    if (this.events.length > MAX_STORED_EVENTS) {
      this.events = this.events.slice(-MAX_STORED_EVENTS);
    }
    this.persistUserEvents();

    // Update current listening session
    if (eventType === 'deliberate_play' || eventType === 'meaningful_listen' || eventType === 'complete' || eventType === 'autoplay_complete') {
      this.sessionRecentPlays = [
        ...this.sessionRecentPlays.filter(p => getCanonicalRecordingKey(p.track) !== recKey),
        { track, source, timestamp: now, completed: eventType === 'complete' || eventType === 'autoplay_complete' }
      ].slice(-10);
    } else if (eventType === 'quick_skip') {
      this.sessionSkippedRecordingKeys.add(recKey);
      if (artistKey) this.sessionSkippedArtistKeys.add(artistKey);
    } else if (eventType === 'dislike') {
      this.sessionSkippedRecordingKeys.add(recKey);
      if (track.title) TasteEngineService.recordNotInterested(track.title);
    }
  }

  public setPlaybackContext(context?: AutoplaySessionContext['activeContext']): void {
    this.activeContext = context;
  }

  public getSessionRecentPlays(): SessionPlayEntry[] {
    return [...this.sessionRecentPlays];
  }

  /**
   * Builds the current user's Taste Profile from likes, playlists (deduped), and listening events.
   */
  public getCurrentTasteProfile() {
    this.syncActiveUser();
    const likes = LikedService.getLikedTracks() as AutoplayTrackMeta[];
    const playlists = PlaylistService.getPlaylists().map(pl => ({
      id: pl.id,
      name: pl.name,
      tracks: (pl.tracks || []) as AutoplayTrackMeta[],
      isUserCreated: true
    }));

    return buildUserTasteProfile({
      userId: this.activeUserId,
      likes,
      playlists,
      events: this.events
    });
  }

  /**
   * Generates a personalized autoplay batch for the given seed track and queue generation.
   * Enforces single in-flight request per active queue and guards against stale account/queue changes.
   */
  public async generateAutoplayBatch(params: {
    seedTrack: AutoplayTrackMeta;
    excludeTracks?: Track[];
    queueGeneration: number;
    limit?: number;
    offlineTracks?: AutoplayTrackMeta[];
  }): Promise<{
    items: AutoplayQueueItem[];
    userId: string;
    queueGeneration: number;
    stale: boolean;
  }> {
    this.syncActiveUser();
    const requestUserId = this.activeUserId;
    const requestGen = params.queueGeneration;
    const lockKey = `${requestUserId}:${requestGen}`;

    if (!this.autoplayEnabled) {
      return { items: [], userId: requestUserId, queueGeneration: requestGen, stale: true };
    }

    // Single in-flight refill per active queue generation
    if (this.inFlightKey === lockKey) {
      return { items: [], userId: requestUserId, queueGeneration: requestGen, stale: true };
    }

    this.cancelInFlight();
    const controller = new AbortController();
    this.inFlightAbort = controller;
    this.inFlightKey = lockKey;

    try {
      const profile = this.getCurrentTasteProfile();
      const session: AutoplaySessionContext = {
        seedTrack: params.seedTrack,
        recentPlays: this.sessionRecentPlays,
        activeContext: this.activeContext,
        sessionSkippedRecordingKeys: new Set(this.sessionSkippedRecordingKeys),
        sessionSkippedArtistKeys: new Set(this.sessionSkippedArtistKeys)
      };

      const excludeRecordingKeys = new Set<string>();
      excludeRecordingKeys.add(getCanonicalRecordingKey(params.seedTrack));
      for (const t of (params.excludeTracks || [])) {
        excludeRecordingKeys.add(getCanonicalRecordingKey(t as AutoplayTrackMeta));
      }

      // Gather multi-pool candidates (offline local pool if offline, else multi-provider online pools)
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const candidates = isOffline
        ? this.gatherOfflineCandidates(params.offlineTracks || [])
        : await this.gatherMultiPoolCandidates(params.seedTrack, profile, controller.signal);

      if (controller.signal.aborted || this.activeUserId !== requestUserId || !this.autoplayEnabled) {
        return { items: [], userId: requestUserId, queueGeneration: requestGen, stale: true };
      }

      const selected = selectAutoplaySequence(candidates, profile, session, {
        limit: params.limit ?? 10,
        weights: this.weights,
        relatedArtistsMap: ARTIST_AFFINITY_GRAPH,
        excludeRecordingKeys
      });

      return {
        items: selected,
        userId: requestUserId,
        queueGeneration: requestGen,
        stale: false
      };
    } catch (_) {
      return { items: [], userId: requestUserId, queueGeneration: requestGen, stale: true };
    } finally {
      if (this.inFlightKey === lockKey) {
        this.inFlightKey = null;
        this.inFlightAbort = null;
      }
    }
  }

  private gatherOfflineCandidates(offlineTracks: AutoplayTrackMeta[]): AutoplayTrackMeta[] {
    const out: AutoplayTrackMeta[] = [];
    for (const t of offlineTracks) {
      if (t.localFilePath || t.path || t.streamUrl?.startsWith('file://') || t.streamUrl?.startsWith('blob:')) {
        out.push({ ...t, sourcePool: 'offline_local' });
      }
    }
    return out;
  }

  /**
   * Gathers candidates across 6 distinct pools without ever searching by seed title alone:
   *  1. Current artist & related artists
   *  2. Provider documented related-track / radio endpoint (JioSaavn reco.getreco)
   *  3. User's top taste artists (from likes/playlists/completions)
   *  4. Playlist co-occurrence tracks (tracks appearing alongside seed song/artist in user's playlists)
   *  5. Reliable session-attribute discovery (language / genre when known on seed — never invented)
   *  6. Familiar favorites not heard recently
   */
  private async gatherMultiPoolCandidates(
    seedTrack: AutoplayTrackMeta,
    profile: ReturnType<typeof buildUserTasteProfile>,
    signal: AbortSignal
  ): Promise<AutoplayTrackMeta[]> {
    const candidates: AutoplayTrackMeta[] = [];
    const seedArtist = (seedTrack.artist || '').split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0].trim();
    const seedArtistNorm = normalizeArtistName(seedArtist);
    const seedRecKey = getCanonicalRecordingKey(seedTrack);

    // Pool 4 & 6 (0ms synchronous): Playlist co-occurrence + Familiar Favorites not played recently
    const allPlaylists = PlaylistService.getPlaylists();
    for (const pl of allPlaylists) {
      const plTracks = (pl.tracks || []) as AutoplayTrackMeta[];
      const hasSeedTrack = plTracks.some(t => getCanonicalRecordingKey(t) === seedRecKey);
      const hasSeedArtist = plTracks.some(t => normalizeArtistName(t.artist) === seedArtistNorm);
      if (hasSeedTrack || hasSeedArtist) {
        for (const t of plTracks) {
          candidates.push({
            ...t,
            sourcePlaylistName: pl.name,
            sourcePool: 'playlist_cooccurrence'
          });
        }
      }
    }

    // Familiar favorites not heard in the last 6 hours
    const now = Date.now();
    const likedTracks = LikedService.getLikedTracks() as AutoplayTrackMeta[];
    for (const lt of likedTracks) {
      const lastPlayed = profile.recentlyPlayedAt.get(getCanonicalRecordingKey(lt)) || 0;
      if (now - lastPlayed > 6 * 60 * 60 * 1000) {
        candidates.push({ ...lt, sourcePool: 'familiar_favorite' });
      }
    }

    // Build parallel network fetches across pools 1, 2, 3, and 5
    const country = (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_itunes_country') : null) || 'IN';
    const fetches: Promise<AutoplayTrackMeta[]>[] = [];

    const fetchArtistSongs = async (
      artistQuery: string,
      pool: AutoplayTrackMeta['sourcePool'],
      relatedToSeed = false
    ): Promise<AutoplayTrackMeta[]> => {
      if (!artistQuery || artistQuery.toLowerCase() === 'unknown artist') return [];
      try {
        const res = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(artistQuery)}&entity=song&attribute=artistTerm&limit=6&country=${country}`,
          { signal }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || [])
          .map((item: any) => StreamingService.mapRawToTrack(item))
          .filter((t: Track) => TasteEngineService.isCleanTrack(t))
          .map((t: Track) => ({
            ...t,
            sourcePool: pool,
            relatedToSeed
          }));
      } catch (_) {
        return [];
      }
    };

    // Pool 1a: Current artist other recordings
    if (seedArtist) {
      fetches.push(fetchArtistSongs(seedArtist, 'same_artist', true));
    }

    // Pool 1b: Related / kindred artists
    const kindred = TasteEngineService.getKindredArtists(seedArtist, 4);
    for (const relArt of kindred) {
      fetches.push(fetchArtistSongs(relArt, 'related_artist', true));
    }

    // Pool 2: Provider documented related-track / radio feature (JioSaavn reco.getreco for saavn_ IDs)
    if (seedTrack.id?.startsWith('saavn_')) {
      const pid = seedTrack.id.replace(/^saavn_/, '');
      fetches.push(
        fetch(
          `https://www.jiosaavn.com/api.php?__call=reco.getreco&api_version=4&_format=json&_marker=0&ctx=web6dot0&pid=${encodeURIComponent(pid)}`,
          { signal }
        )
          .then(r => (r.ok ? r.json() : null))
          .then(data => {
            const list = Array.isArray(data) ? data : (data?.results || []);
            return list
              .map((item: any) => StreamingService.mapSaavnToTrack(item))
              .filter((t: Track) => TasteEngineService.isCleanTrack(t))
              .map((t: Track): AutoplayTrackMeta => ({
                ...t,
                language: (t.genre || undefined),
                sourcePool: 'provider_radio',
                relatedToSeed: true,
                directRelationScore: 0.92
              }));
          })
          .catch(() => [] as AutoplayTrackMeta[])
      );
    }

    // Pool 3: User's top taste artists (excluding seedArtist already fetched)
    const topTasteArtists = Object.entries(profile.artistScores)
      .filter(([art, score]) => score > 0 && art !== seedArtistNorm && !kindred.some(k => normalizeArtistName(k) === art))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([art]) => art);

    for (const tasteArt of topTasteArtists) {
      fetches.push(fetchArtistSongs(tasteArt, 'top_taste', false));
    }

    // Pool 5: Discovery by reliable known catalog attribute (genre/language ONLY when present — never invented!)
    const reliableAttr = seedTrack.language || (seedTrack.genre && seedTrack.genre.toLowerCase() !== 'music' ? seedTrack.genre : null);
    if (reliableAttr) {
      fetches.push(
        fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(reliableAttr)}&entity=song&limit=8&country=${country}`,
          { signal }
        )
          .then(r => (r.ok ? r.json() : null))
          .then(data =>
            (data?.results || [])
              .map((item: any) => StreamingService.mapRawToTrack(item))
              .filter((t: Track) => TasteEngineService.isCleanTrack(t))
              .map((t: Track): AutoplayTrackMeta => ({
                ...t,
                sourcePool: 'session_discovery'
              }))
          )
          .catch(() => [] as AutoplayTrackMeta[])
      );
    }

    const networkLists = await Promise.all(fetches);
    for (const list of networkLists) {
      candidates.push(...list);
    }

    return candidates;
  }
}

export const AutoplayService = new AutoplayServiceClass();
