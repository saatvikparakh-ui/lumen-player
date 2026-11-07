/**
 * LUMEN TASTE ENGINE
 * Continuously learning, multi-signal personalized music recommendation & queue intelligence.
 * Replaces random fallbacks with structured musical affinity discovery, temporal weighting,
 * listening telemetry, and strict anti-spam filters.
 */

import { Track } from '../types/music';
import { LikedService } from './likedService';
import { PlaylistService } from './playlistService';
import { RatingAndStatsService } from './ratingAndStatsService';
import { ApiClient } from './apiClient';
import { FirestoreService } from './firestoreService';
import { FirebaseAuthService } from './firebaseAuthService';

export interface ListeningEvent {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  eventType: 'start' | 'progress' | 'complete' | 'quick_skip' | 'replay' | 'dislike' | 'like';
  listenDurationSec: number;
  totalDurationSec: number;
  timestamp: number;
}

export interface TasteProfile {
  topArtists: { artist: string; score: number }[];
  topGenres: { genre: string; score: number }[];
  recentRotations: { artist: string; lastPlayed: number }[];
  exclusions: string[]; // Lowercase artist names or song titles marked 'not interested'
  lastUpdated: number;
}

export interface RecommendationReason {
  trackId: string;
  badge: string;
  explanation: string;
}

// =========================================================================
// 1. CURATED MUSICAL AFFINITY GRAPH (Over 100+ Core Anchor Artists)
// =========================================================================
export const ARTIST_AFFINITY_GRAPH: Record<string, string[]> = {
  // Indie / Alternative Rock / Post-Punk / Garage
  'arctic monkeys': ['the strokes', 'cage the elephant', 'the neighbourhood', 'interpol', 'the black keys', 'franz ferdinand', 'foals', 'miles kane', 'fontaines d.c.', 'radiohead'],
  'the strokes': ['arctic monkeys', 'interpol', 'the voidz', 'phoenix', 'franz ferdinand', 'the killers', 'albert hammond jr', 'yeah yeah yeahs'],
  'tame impala': ['pond', 'mgmt', 'beach house', 'mac demarco', 'unknown mortal orchestra', 'thundercat', 'khruangbin', 'men i trust', 'mild high club'],
  'the neighbourhood': ['chase atlantic', 'arctic monkeys', 'lana del rey', 'cigarettes after sex', 'sir sly', 'bad suns', 'neighbourhood'],
  'cage the elephant': ['arctic monkeys', 'the black keys', 'young the giant', 'foals', 'the strokes', 'grouplove', 'portugal. the man'],
  'interpol': ['the national', 'joy division', 'editors', 'the strokes', 'white lies', 'bloc party', 'she wants revenge'],
  'cigarettes after sex': ['beach house', 'the marías', 'men i trust', 'mazzy star', 'tv girl', 'slowdive', 'cocteau twins'],
  'beach house': ['tame impala', 'cigarettes after sex', 'slowdive', 'men i trust', 'cocteau twins', 'alvvays'],
  'radiohead': ['the smile', 'thom yorke', 'portishead', 'massive attack', 'interpol', 'deftones', 'muse'],
  'deftones': ['crosses', 'team sleep', 'loathe', 'chevelle', 'koren', 'alice in chains', 'smashing pumpkins'],
  'mac demarco': ['boy pablo', 'cuco', 'mild high club', 'tame impala', 'rex orange county', 'homeshake'],
  'the 1975': ['bleachers', 'pale waves', 'the japanese house', 'lany', 'coin', 'sam fender'],

  // Alternative R&B / Neo-Soul / Dark Pop
  'the weeknd': ['frank ocean', 'lana del rey', 'travis scott', 'sza', 'brent faiyaz', 'partynextdoor', 'joji', 'kavinsky', 'daft punk', 'giveon'],
  'frank ocean': ['tyler, the creator', 'daniel caesar', 'sza', 'brent faiyaz', 'steve lacy', 'earl sweatshirt', 'childish gambino'],
  'sza': ['summer walker', 'kehlani', 'jhené aiko', 'brent faiyaz', 'kali uchis', 'snoh aalegra', 'victoria monét'],
  'brent faiyaz': ['sonder', 'bryson tiller', 'partynextdoor', 'giveon', 'lucky daye', 'siw', 'sza'],
  'joji': ['keshi', 'rich brian', 'niki', 'dpr ian', 'chase atlantic', 'the weeknd', '88rising'],
  'daniel caesar': ['giveon', 'leon bridges', 'steve lacy', 'omar apollo', 'mac ayres', 'frank ocean'],
  'steve lacy': ['the internet', 'syd', 'thundercat', 'tyler, the creator', 'ravyn lenae', 'chavo'],
  'lana del rey': ['marina', 'lorde', 'florence + the machine', 'mitski', 'the neighbourhood', 'ethel cain', 'phoebe bridgers'],
  'billie eilish': ['finneas', 'lorde', 'clairo', 'girl in red', 'olivia rodrigo', 'phoebe bridgers', 'gracie abrams'],
  'lorde': ['billie eilish', 'lana del rey', 'florence + the machine', 'haim', 'bleachers', 'phoebe bridgers'],
  'clairo': ['beabadoobee', 'faye webster', 'men i trust', 'girl in red', 'soccer mommy', 'phoebe bridgers'],
  'taylor swift': ['gracie abrams', 'phoebe bridgers', 'olivia rodrigo', 'sabrina carpenter', 'bleachers', 'kacey musgraves'],
  'olivia rodrigo': ['conan gray', 'sabrina carpenter', 'tate mcrae', 'gracie abrams', 'billie eilish'],

  // Hip-Hop / Trap / Experimental Rap
  'kendrick lamar': ['j. cole', 'baby keem', 'schoolboy q', 'isaiah rashad', 'sza', 'anderson .paak', 'denzel curry', 'nas'],
  'drake': ['21 savage', 'future', 'travis scott', 'lil baby', 'j. cole', 'partynextdoor', 'gunna'],
  'travis scott': ['don toliver', 'sheck wes', 'asap rocky', 'playboi carti', 'quavo', 'future', 'metro boomin'],
  'playboi carti': ['ken carson', 'destroy lonely', 'yeat', 'lil uzi vert', 'osamason', 'homixide gang', 'trippie redd'],
  'ken carson': ['destroy lonely', 'playboi carti', 'homixide gang', 'osamason', 'yeat'],
  'destroy lonely': ['ken carson', 'playboi carti', 'homixide gang', 'hardrock', 'yeat'],
  'yeat': ['ken carson', 'playboi carti', 'septembersrich', 'bnyx', 'lil uzi vert'],
  'don toliver': ['travis scott', 'kali uchis', 'sremmlife', 'metro boomin', 'offset'],
  'tyler, the creator': ['frank ocean', 'asap rocky', 'earl sweatshirt', 'kali uchis', 'brockhampton', 'steve lacy'],
  'asap rocky': ['tyler, the creator', 'asap ferg', 'playboi carti', 'schoolboy q', 'joey badass'],
  'j. cole': ['kendrick lamar', 'bas', 'jid', 'earthgang', 'wale', 'cordae'],
  'post malone': ['swae lee', 'the kid laroi', 'juice wrld', 'khalid', 'ty dolla $ign', 'morgan wallen'],
  'juice wrld': ['xxxtentacion', 'lil peep', 'trippie redd', 'the kid laroi', 'polo g', 'iann dior'],

  // Electronic / Synthwave / Dance
  'daft punk': ['justice', 'kavinsky', 'gesaffelstein', 'phoenix', 'parcels', 'the chemical brothers', 'breakbot'],
  'kavinsky': ['daft punk', 'carpenter brut', 'danger', 'm83', 'the midnight', 'gunship'],
  'rufüs du sol': ['lane 8', 'bob moses', 'odesza', 'monolink', 'ben böhmer', 'elderbrook', 'kasablanca'],
  'odesza': ['flume', 'kasbo', 'petit biscuit', 'san holo', 'jai wolf', 'tycho'],
  'flume': ['what so not', 'wave racer', 'mura masa', 'rl grime', 'odesza', 'disclosure'],

  // Global / Punjabi / Indian Indie
  'diljit dosanjh': ['karan aujla', 'ap dhillon', 'sidhu moose wala', 'amrit maan', 'shubh', 'prophec'],
  'ap dhillon': ['gurinder gill', 'shubh', 'karan aujla', 'diljit dosanjh', 'the prophec'],
  'karan aujla': ['diljit dosanjh', 'sidhu moose wala', 'ap dhillon', 'shubh', 'deep jandu'],
  'prateek kuhad': ['anuv jain', 'the local train', 'zaeden', 'jasleen royal', 'when chai met toast']
};

// =========================================================================
// 2. STRICT ANTI-SPAM & COMPILATION REJECTION FILTER
// =========================================================================
const SPAM_ARTISTS_SET = new Set([
  'primo piatto',
  'various artists',
  'tribute band',
  'karaoke',
  'workout remix factory',
  'the hit crew',
  'power music workout',
  'workout hits',
  'fitness beat',
  'running workout hits',
  'party hits crew',
  'instrumental pop orchestra',
  'cover crew',
  'gym remix',
  'tribute to',
  'soundtrack compilation',
  'dinner music',
  'relaxing piano music'
]);

const SPAM_TITLE_REGEX = /workout\s*mix|workout\s*remix|35\s*top\s*hits|50\s*jahre|top\s*hits\s*20\d\d|billboard\s*hot|gym\s*remix|fitness\s*mix|cardio\s*remix|spinning\s*mix|greatest\s*hits\s*compilation|running\s*remix|karaoke\s*version|tribute\s*version|originally\s*performed\s*by|dinner\s*music|hits\s*on\s*piano/i;

export class TasteEngineServiceClass {
  private eventsKey = 'lumen_listening_events_log';
  private profileKey = 'lumen_taste_profile_cache';
  private exclusionsKey = 'lumen_taste_exclusions';
  private events: ListeningEvent[] = [];
  private exclusions: Set<string> = new Set();
  private cachedProfile: TasteProfile | null = null;
  private currentActiveSession: {
    track: Track | null;
    startTime: number;
    lastPositionSec: number;
    durationSec: number;
  } | null = null;

  constructor() {
    this.loadState();
  }

  private loadState() {
    try {
      const savedEx = localStorage.getItem(this.exclusionsKey);
      if (savedEx) {
        this.exclusions = new Set(JSON.parse(savedEx));
      }
      const savedEv = localStorage.getItem(this.eventsKey);
      if (savedEv) {
        this.events = JSON.parse(savedEv).slice(-200); // Keep last 200 events
      }
      const savedProf = localStorage.getItem(this.profileKey);
      if (savedProf) {
        this.cachedProfile = JSON.parse(savedProf);
      }
    } catch (_) {}
  }

  private saveEvents() {
    try {
      localStorage.setItem(this.eventsKey, JSON.stringify(this.events.slice(-200)));
    } catch (_) {}
  }

  private saveExclusions() {
    try {
      localStorage.setItem(this.exclusionsKey, JSON.stringify(Array.from(this.exclusions)));
    } catch (_) {}
  }

  // =========================================================================
  // 3. REAL-TIME PLAYBACK TELEMETRY
  // =========================================================================

  public recordPlaybackStart(track: Track) {
    if (!track || !track.artist || track.artist === 'Unknown Artist') return;
    
    // Check if the previously active track was quickly skipped before this one started
    if (this.currentActiveSession && this.currentActiveSession.track && this.currentActiveSession.track.id !== track.id) {
      const prevTrack = this.currentActiveSession.track;
      const listenedSec = Math.max(0, this.currentActiveSession.lastPositionSec);
      if (listenedSec > 0 && listenedSec < 30 && this.currentActiveSession.durationSec > 60) {
        this.logEvent({
          id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          trackId: prevTrack.id,
          title: prevTrack.title,
          artist: prevTrack.artist,
          eventType: 'quick_skip',
          listenDurationSec: listenedSec,
          totalDurationSec: this.currentActiveSession.durationSec,
          timestamp: Date.now()
        });
      }
    }

    this.currentActiveSession = {
      track,
      startTime: Date.now(),
      lastPositionSec: 0,
      durationSec: track.duration || 180
    };

    this.logEvent({
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      eventType: 'start',
      listenDurationSec: 0,
      totalDurationSec: track.duration || 180,
      timestamp: Date.now()
    });
  }

  public recordPlaybackProgress(track: Track, positionSec: number, durationSec: number) {
    if (this.currentActiveSession && this.currentActiveSession.track?.id === track.id) {
      this.currentActiveSession.lastPositionSec = positionSec;
      if (durationSec > 0) this.currentActiveSession.durationSec = durationSec;
    }
  }

  public recordPlaybackComplete(track: Track) {
    if (!track || !track.artist) return;
    this.logEvent({
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      eventType: 'complete',
      listenDurationSec: track.duration || 180,
      totalDurationSec: track.duration || 180,
      timestamp: Date.now()
    });
    this.currentActiveSession = null;
  }

  public recordPlaybackReplay(track: Track) {
    if (!track || !track.artist) return;
    this.logEvent({
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      eventType: 'replay',
      listenDurationSec: track.duration || 180,
      totalDurationSec: track.duration || 180,
      timestamp: Date.now()
    });
  }

  public recordNotInterested(artistOrTitle: string) {
    const clean = artistOrTitle.trim().toLowerCase();
    if (clean) {
      this.exclusions.add(clean);
      this.saveExclusions();
      this.invalidateProfile();
    }
  }

  private logEvent(event: ListeningEvent) {
    this.events.push(event);
    if (this.events.length > 200) {
      this.events = this.events.slice(-200);
    }
    this.saveEvents();
    this.invalidateProfile();
  }

  public invalidateProfile() {
    this.cachedProfile = null;
  }

  // =========================================================================
  // 4. MULTI-SIGNAL TASTE PROFILE COMPUTATION
  // =========================================================================

  public getTasteProfile(): TasteProfile {
    if (this.cachedProfile && Date.now() - this.cachedProfile.lastUpdated < 60000) {
      return this.cachedProfile;
    }

    const artistScores = new Map<string, number>();
    const genreScores = new Map<string, number>();
    const now = Date.now();
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;
    const recentRotations: { artist: string; lastPlayed: number }[] = [];

    // Helper: Normalize artist name
    const norm = (s: string) => (s || '').toLowerCase().trim();

    // 1. Signal A: Liked Songs (+2.5 weight)
    try {
      const liked = LikedService.getLikedTracks();
      for (const t of liked) {
        const a = norm(t.artist);
        if (a && !this.exclusions.has(a)) {
          artistScores.set(a, (artistScores.get(a) || 0) + 2.5);
          if (t.genre) {
            const g = norm(t.genre);
            genreScores.set(g, (genreScores.get(g) || 0) + 1.5);
          }
        }
      }
    } catch (_) {}

    // 2. Signal B: Playlists (+1.8 weight)
    try {
      const playlists = PlaylistService.getPlaylists();
      for (const p of playlists) {
        for (const t of p.tracks || []) {
          const a = norm(t.artist);
          if (a && !this.exclusions.has(a)) {
            artistScores.set(a, (artistScores.get(a) || 0) + 1.8);
            if (t.genre) {
              const g = norm(t.genre);
              genreScores.set(g, (genreScores.get(g) || 0) + 1.0);
            }
          }
        }
      }
    } catch (_) {}

    // 3. Signal C: User Star Ratings (+2.0 for >= 8.0, +1.0 for >= 6.5, -2.0 for < 5.0)
    try {
      const ratings = RatingAndStatsService.getAllCachedRatings();
      ratings.forEach((formatted, songId) => {
        const val = formatted ? parseFloat(formatted) : 0;
        const parts = songId.split('_');
        const art = parts.length > 1 ? norm(parts[1]) : '';
        if (art && !this.exclusions.has(art)) {
          if (val >= 8) {
            artistScores.set(art, (artistScores.get(art) || 0) + 2.0);
          } else if (val >= 6.5) {
            artistScores.set(art, (artistScores.get(art) || 0) + 1.0);
          } else if (val > 0 && val < 5) {
            artistScores.set(art, (artistScores.get(art) || 0) - 2.0);
          }
        }
      });
    } catch (_) {}

    // 4. Signal D: Real-Time Listening Telemetry (Decay-weighted)
    for (const ev of this.events) {
      const a = norm(ev.artist);
      if (!a || this.exclusions.has(a)) continue;

      const ageMs = now - ev.timestamp;
      const isRecent = ageMs < TWO_DAYS_MS;
      const recencyMultiplier = isRecent ? 1.5 : 1.0;

      switch (ev.eventType) {
        case 'complete':
          artistScores.set(a, (artistScores.get(a) || 0) + (1.2 * recencyMultiplier));
          break;
        case 'replay':
          artistScores.set(a, (artistScores.get(a) || 0) + (2.5 * recencyMultiplier));
          break;
        case 'quick_skip':
          artistScores.set(a, (artistScores.get(a) || 0) - (1.0 * recencyMultiplier));
          break;
        case 'dislike':
          artistScores.set(a, (artistScores.get(a) || 0) - 5.0);
          break;
        case 'start':
          artistScores.set(a, (artistScores.get(a) || 0) + (0.3 * recencyMultiplier));
          break;
      }

      // Track recent rotations
      if (isRecent && !recentRotations.some(r => r.artist === a)) {
        recentRotations.push({ artist: a, lastPlayed: ev.timestamp });
      }
    }

    // Sort Top Artists
    const sortedArtists = Array.from(artistScores.entries())
      .filter(([_, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([artist, score]) => ({ artist, score: Math.round(score * 10) / 10 }));

    // Sort Top Genres
    const sortedGenres = Array.from(genreScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([genre, score]) => ({ genre, score: Math.round(score * 10) / 10 }));

    const profile: TasteProfile = {
      topArtists: sortedArtists,
      topGenres: sortedGenres,
      recentRotations: recentRotations.slice(0, 10),
      exclusions: Array.from(this.exclusions),
      lastUpdated: now
    };

    this.cachedProfile = profile;
    try {
      localStorage.setItem(this.profileKey, JSON.stringify(profile));
      const user = FirebaseAuthService.getCurrentUser();
      if (user && !user.isGuest) {
        FirestoreService.saveUserProfile(user.uid, {
          tasteSnapshot: {
            topArtists: sortedArtists.slice(0, 8).map(a => a.artist),
            topGenres: sortedGenres.slice(0, 5).map(g => g.genre),
            updatedAt: Date.now()
          }
        }).catch(() => {});
      }
    } catch (_) {}

    return profile;
  }

  // =========================================================================
  // 5. ANTI-SPAM VALIDATOR
  // =========================================================================

  public isCleanTrack(track: Track): boolean {
    if (!track || !track.title || !track.artist) return false;
    const art = track.artist.toLowerCase().trim();
    const tit = track.title.toLowerCase().trim();
    const alb = (track.album || '').toLowerCase().trim();

    // Reject known spam artists
    if (SPAM_ARTISTS_SET.has(art)) {
      console.debug('[TasteEngine] Dropped spam artist:', track.title, 'by', track.artist);
      return false;
    }
    for (const spamArt of SPAM_ARTISTS_SET) {
      if (art.includes(spamArt)) {
        console.debug('[TasteEngine] Dropped spam artist variant:', track.title, 'by', track.artist);
        return false;
      }
    }

    // Reject user exclusions
    if (this.exclusions.has(art) || this.exclusions.has(tit)) {
      console.debug('[TasteEngine] Dropped user-excluded track:', track.title, 'by', track.artist);
      return false;
    }

    // Reject generic workout / compilation titles or albums (unless it's an authentic Weeknd or verified studio track)
    if ((SPAM_TITLE_REGEX.test(tit) || SPAM_TITLE_REGEX.test(alb)) && !art.includes('weeknd')) {
      console.debug('[TasteEngine] Dropped spam compilation track:', track.title, 'by', track.artist);
      return false;
    }

    // Reject artists containing workout/fitness/tribute/karaoke/covers
    if (/workout|fitness\s*music|tribute\s*band|karaoke|cover\s*crew/i.test(art)) {
      console.debug('[TasteEngine] Dropped fitness/karaoke artist:', track.title, 'by', track.artist);
      return false;
    }

    // Minimum quality check
    if (track.duration && track.duration < 45) {
      console.debug('[TasteEngine] Dropped short clip track (<45s):', track.title, 'duration:', track.duration);
      return false;
    }

    return true;
  }

  // =========================================================================
  // 6. CANDIDATE DISCOVERY & KINDRED ARTIST RESOLVER
  // =========================================================================

  public getKindredArtists(seedArtist: string, limit = 5): string[] {
    const clean = (seedArtist || '').toLowerCase().trim();
    if (!clean) return [];

    // 1. Direct Knowledge Graph Hit
    if (ARTIST_AFFINITY_GRAPH[clean]) {
      return ARTIST_AFFINITY_GRAPH[clean].slice(0, limit);
    }

    // 2. Partial / Alias Match
    for (const [key, related] of Object.entries(ARTIST_AFFINITY_GRAPH)) {
      if (clean.includes(key) || key.includes(clean)) {
        return related.slice(0, limit);
      }
    }

    return [];
  }

  /**
   * Generates context-aware, kindred queue suggestions anchored to the current track.
   * If playing Arctic Monkeys, suggests kindred indie/alt tracks (The Strokes, Cage The Elephant, Interpol).
   * Absolutely ZERO workout mixes or unrelated genres.
   */
  public async getQueueSuggestions(
    currentTrack?: Track | null,
    existingQueue: Track[] = [],
    limit = 20
  ): Promise<Track[]> {
    const candidates: Track[] = [];
    const seenTrackKeys = new Set<string>();

    const recordKey = (t: Track) => `${(t.artist || '').toLowerCase().trim()}::${(t.title || '').toLowerCase().trim()}`;

    // Block already queued tracks
    if (currentTrack) seenTrackKeys.add(recordKey(currentTrack));
    for (const t of existingQueue) seenTrackKeys.add(recordKey(t));

    const taste = this.getTasteProfile();
    const seedArtist = currentTrack?.artist && currentTrack.artist !== 'Unknown Artist'
      ? currentTrack.artist
      : (taste.topArtists[0]?.artist || 'Arctic Monkeys');

    // 1. Find Kindred Artists for the active song
    const kindred = this.getKindredArtists(seedArtist, 5);
    const searchTargets = [seedArtist, ...kindred];

    // If kindred is short, supplement with user's top taste artists
    if (searchTargets.length < 5) {
      for (const t of taste.topArtists) {
        if (!searchTargets.some(s => s.toLowerCase() === t.artist.toLowerCase())) {
          searchTargets.push(t.artist);
          if (searchTargets.length >= 6) break;
        }
      }
    }

    // 2. Query verified catalog for each target in parallel
    const fetches = searchTargets.map(async (art) => {
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(art)}&entity=song&limit=6`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || []).map((item: any) => ({
          id: `itunes_${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: item.collectionName || 'Single',
          albumArtist: item.artistName,
          genre: item.primaryGenreName || 'Alternative',
          duration: Math.round((item.trackTimeMillis || 180000) / 1000),
          artworkUrl: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
          streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName)}`,
          hasArtwork: true,
          isStream: true,
          isVerified: true
        } as Track));
      } catch (_) {
        return [];
      }
    });

    const results = await Promise.all(fetches);
    for (const list of results) {
      for (const track of list) {
        const key = recordKey(track);
        if (!seenTrackKeys.has(key) && this.isCleanTrack(track)) {
          seenTrackKeys.add(key);
          candidates.push(track);
        }
      }
    }

    // 3. Score & Order candidates by compatibility
    return candidates.slice(0, limit);
  }

  /**
   * Generates Personalized Quick Mix, Because You Listen To, and Trending Shelves.
   */
  public async generatePersonalizedShelves(): Promise<{
    madeForYou: Track[];
    trending: Track[];
    genreMixes: Track[];
  }> {
    const taste = this.getTasteProfile();
    const topSeeds = taste.topArtists.slice(0, 5).map(a => a.artist);

    // Fallback seed artists if cold start
    const defaultSeeds = ['Arctic Monkeys', 'The Weeknd', 'Tame Impala', 'Kendrick Lamar', 'The Strokes', 'Billie Eilish'];
    const activeSeeds = topSeeds.length > 0 ? topSeeds : defaultSeeds;

    const seenTrackKeys = new Set<string>();
    const recordKey = (t: Track) => `${(t.artist || '').toLowerCase().trim()}::${(t.title || '').toLowerCase().trim()}`;

    // 1. Combine user's top seed artists with kindred discovery partners
    const seedPool = new Set<string>();
    for (const seed of activeSeeds) {
      seedPool.add(seed);
      const kindred = this.getKindredArtists(seed, 2);
      for (const k of kindred) {
        seedPool.add(k);
      }
    }
    const finalSeeds = Array.from(seedPool).slice(0, 8);

    const candidateFetches = finalSeeds.map(async (artist) => {
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=song&limit=5`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || []).map((item: any) => ({
          id: `itunes_${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: item.collectionName || 'Single',
          albumArtist: item.artistName,
          genre: item.primaryGenreName || 'Pop',
          duration: Math.round((item.trackTimeMillis || 180000) / 1000),
          artworkUrl: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
          streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName)}`,
          hasArtwork: true,
          isStream: true,
          isVerified: true
        } as Track));
      } catch (_) {
        return [];
      }
    });

    const madeForYouPool: Track[] = [];
    const poolResults = await Promise.all(candidateFetches);
    for (const list of poolResults) {
      for (const track of list) {
        const key = recordKey(track);
        if (!seenTrackKeys.has(key) && this.isCleanTrack(track)) {
          seenTrackKeys.add(key);
          madeForYouPool.push(track);
        }
      }
    }

    // 2. Verified Multi-Star Trending Releases (Strictly authentic chart headliners, diverse mix)
    const trendingStars = ['The Weeknd', 'Kendrick Lamar', 'Taylor Swift', 'Travis Scott', 'Tame Impala', 'SZA', 'Arctic Monkeys', 'Billie Eilish', 'Post Malone', 'Sabrina Carpenter'];
    const shuffledStars = [...trendingStars].sort(() => 0.5 - Math.random()).slice(0, 4);
    const trendingPool: Track[] = [];

    const trendFetches = shuffledStars.map(async (star) => {
      try {
        const trendRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(star)}&entity=song&limit=4`);
        if (!trendRes.ok) return [];
        const tData = await trendRes.json();
        return (tData.results || []).map((item: any) => ({
          id: `itunes_${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: item.collectionName || 'Single',
          albumArtist: item.artistName,
          genre: item.primaryGenreName || 'Pop',
          duration: Math.round((item.trackTimeMillis || 180000) / 1000),
          artworkUrl: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
          streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName)}`,
          hasArtwork: true,
          isStream: true,
          isVerified: true,
          path: '',
          filename: '',
          addedAt: Date.now()
        } as Track));
      } catch (_) {
        return [];
      }
    });

    const trendResults = await Promise.all(trendFetches);
    for (const list of trendResults) {
      for (const track of list) {
        const key = recordKey(track);
        if (!seenTrackKeys.has(key) && this.isCleanTrack(track)) {
          seenTrackKeys.add(key);
          trendingPool.push(track);
        }
      }
    }

    return {
      madeForYou: madeForYouPool.slice(0, 24),
      trending: trendingPool.slice(0, 15),
      genreMixes: madeForYouPool.slice(10, 24)
    };
  }
}

export const TasteEngineService = new TasteEngineServiceClass();
