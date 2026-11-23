/**
 * LUMEN PERSONALIZED AUTOPLAY ENGINE (Pure, Deterministic Core)
 *
 * Replaces naive title-similarity queue appending with a multi-signal
 * personalized recommendation & sequence-selection engine:
 *  - Separate long-term Taste Profile vs. current Listening Session Context
 *  - Distinct recording deduplication across playlists & cross-provider catalogs
 *  - Preservation of meaningful version differences (studio, live, acoustic, remix)
 *  - Configurable weights (40% session, 30% taste, 20% playlist affinity, 10% direct relation)
 *    with automatic weight redistribution when signals are unavailable
 *  - Zero boost from shared title words alone
 *  - One-at-a-time varied sequence selection with deterministic PRNG seed support
 */

import type { Track } from '../types/music';

export interface AutoplayWeights {
  sessionFit: number;
  longTermTaste: number;
  playlistAffinity: number;
  directRelation: number;
}

export const DEFAULT_AUTOPLAY_WEIGHTS: AutoplayWeights = {
  sessionFit: 0.40,
  longTermTaste: 0.30,
  playlistAffinity: 0.20,
  directRelation: 0.10
};

export type AutoplayEventType =
  | 'deliberate_play'
  | 'meaningful_listen'
  | 'complete'
  | 'repeat'
  | 'quick_skip'
  | 'dislike'
  | 'autoplay_complete'
  | 'deliberate_return_to_autoplay'
  // Non-negative diagnostic events explicitly ignored as negative feedback:
  | 'playback_error'
  | 'app_close'
  | 'seek'
  | 'network_interruption';

export interface AutoplayListeningEvent {
  userId: string;
  trackId: string;
  recordingKey?: string;
  artist: string;
  artistId?: string;
  title: string;
  genre?: string;
  language?: string;
  styleTags?: string[];
  eventType: AutoplayEventType;
  source: 'user' | 'autoplay';
  listenDurationSec?: number;
  totalDurationSec?: number;
  timestamp: number;
}

export interface AutoplayPlaylistInput {
  id: string;
  name: string;
  tracks: Track[];
  isUserCreated?: boolean;
}

export interface AutoplayTrackMeta extends Track {
  artistId?: string;
  language?: string;
  styleTags?: string[];
  provider?: string;
  providerTrackId?: string;
  isrc?: string;
  relatedToSeed?: boolean;
  directRelationScore?: number; // 0..1 when returned by a provider's related-track / radio endpoint
  sourcePlaylistName?: string;
  sourcePool?: 'same_artist' | 'related_artist' | 'provider_radio' | 'top_taste' | 'playlist_cooccurrence' | 'session_discovery' | 'familiar_favorite' | 'offline_local';
}

export interface UserTasteProfile {
  userId: string;
  artistScores: Record<string, number>;
  artistEvidenceCount: Record<string, number>;
  genreScores: Record<string, number>;
  languageScores: Record<string, number>;
  styleTagScores: Record<string, number>;
  playlistRecordingKeys: Set<string>;
  recordingPlaylistNames: Map<string, string[]>;
  playlistCooccurrenceByTrack: Map<string, Set<string>>; // trackRecKey -> co-occurring recKeys
  playlistCooccurrenceByArtist: Map<string, Map<string, { score: number; playlistName: string }>>; // seedArtistKey -> recKey -> info
  likedRecordingKeys: Set<string>;
  dislikedRecordingKeys: Set<string>;
  dislikedArtistKeys: Set<string>;
  recentlyPlayedAt: Map<string, number>;
  totalSignalWeight: number;
  hasLongTermEvidence: boolean;
  hasPlaylistEvidence: boolean;
}

export interface SessionPlayEntry {
  track: AutoplayTrackMeta;
  source: 'user' | 'autoplay';
  timestamp: number;
  completed?: boolean;
}

export interface AutoplaySessionContext {
  seedTrack: AutoplayTrackMeta;
  recentPlays: SessionPlayEntry[];
  activeContext?: {
    type: 'album' | 'playlist' | 'single' | 'artist';
    id?: string;
    name?: string;
    tracks?: AutoplayTrackMeta[];
  };
  sessionSkippedRecordingKeys: Set<string>;
  sessionSkippedArtistKeys: Set<string>;
}

export interface CandidateScoreBreakdown {
  sessionFit: number | null;
  longTermTaste: number | null;
  playlistAffinity: number | null;
  directRelation: number | null;
  effectiveWeights: AutoplayWeights;
  confidence: number;
  finalScore: number;
  reason: string;
}

export interface ScoredAutoplayCandidate {
  track: AutoplayTrackMeta;
  recordingKey: string;
  workKey: string;
  artistKey: string;
  score: number;
  breakdown: CandidateScoreBreakdown;
  isNewToUser: boolean;
}

export interface AutoplayQueueItem {
  track: AutoplayTrackMeta;
  recordingKey: string;
  reason: string;
  score: number;
  sourcePool?: AutoplayTrackMeta['sourcePool'];
  breakdown?: CandidateScoreBreakdown;
}

export interface SelectSequenceOptions {
  limit?: number;
  weights?: Partial<AutoplayWeights>;
  randomSeed?: number;
  randomness?: number; // 0 = strictly deterministic top-1, 0.25 = modest variety among top candidates
  relatedArtistsMap?: Record<string, string[]>;
  nowMs?: number;
  excludeRecordingKeys?: Set<string>;
}

// =========================================================================
// 1. CANONICAL RECORDING IDENTITY & VERSION PRESERVATION
// =========================================================================

const VERSION_PATTERNS: Array<{ tag: string; regex: RegExp }> = [
  { tag: 'live', regex: /\b(live|in concert|mtv unplugged|live at|live from|live version)\b/i },
  { tag: 'acoustic', regex: /\b(acoustic|unplugged|stripped|piano version)\b/i },
  { tag: 'remix', regex: /\b(remix|club mix|extended mix|vip mix|edit mix|dub mix)\b/i },
  { tag: 'instrumental', regex: /\b(instrumental|karaoke|backing track)\b/i },
  { tag: 'radio_edit', regex: /\b(radio edit|clean edit|single edit)\b/i },
  { tag: 'demo', regex: /\b(demo|early take|rough mix)\b/i },
  { tag: 'sped_up', regex: /\b(sped up|nightcore)\b/i },
  { tag: 'slowed', regex: /\b(slowed|reverb)\b/i }
];

export function normalizeArtistKey(artist?: string | null, artistId?: string | null): string {
  if (artistId && artistId.trim()) {
    return `id:${artistId.trim().toLowerCase()}`;
  }
  const primary = String(artist || '')
    .toLowerCase()
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b/i)[0]
    .replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff]+/g, ' ')
    .trim();
  return primary || 'unknown';
}

export function normalizeArtistName(artist?: string | null): string {
  return String(artist || '')
    .toLowerCase()
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0]
    .replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff]+/g, ' ')
    .trim();
}

export function extractVersionTag(title?: string | null): string {
  const raw = String(title || '');
  for (const { tag, regex } of VERSION_PATTERNS) {
    if (regex.test(raw)) return tag;
  }
  return 'studio';
}

export function normalizeBaseTitle(title?: string | null): string {
  return String(title || '')
    .toLowerCase()
    // Strip featured artist parentheticals and remaster year tags, but version tag is tracked separately
    .replace(/\((?:feat\.?|ft\.?|with|remaster(?:ed)?(?:\s*\d{4})?|deluxe(?:\s*edition)?|explicit|clean)[^)]*\)/gi, '')
    .replace(/\[(?:feat\.?|ft\.?|with|remaster(?:ed)?(?:\s*\d{4})?|deluxe(?:\s*edition)?|explicit|clean)[^\]]*\]/gi, '')
    .replace(/\((?:live|acoustic|unplugged|remix|instrumental|radio edit|demo|sped up|slowed)[^)]*\)/gi, '')
    .replace(/\[(?:live|acoustic|unplugged|remix|instrumental|radio edit|demo|sped up|slowed)[^\]]*\]/gi, '')
    .replace(/\s*-\s*(?:live|acoustic|unplugged|remix|instrumental|radio edit|demo|remaster(?:ed)?(?:\s*\d{4})?).*$/i, '')
    .replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff]+/g, ' ')
    .trim();
}

export function getSongWorkKey(track: Pick<AutoplayTrackMeta, 'artist' | 'title'>): string {
  return `${normalizeArtistName(track.artist)}::${normalizeBaseTitle(track.title)}`;
}

/**
 * Produces a cross-provider canonical recording identity that:
 *  - Deduplicates identical recordings discovered across iTunes / JioSaavn / local library
 *  - Preserves meaningful version distinctions (studio vs live vs acoustic vs remix)
 *  - Incorporates coarse duration bucketing when durations diverge significantly
 */
export function getCanonicalRecordingKey(track: AutoplayTrackMeta): string {
  if (track.isrc && track.isrc.trim()) {
    return `isrc:${track.isrc.trim().toUpperCase()}`;
  }
  const artist = normalizeArtistName(track.artist);
  const baseTitle = normalizeBaseTitle(track.title);
  const version = extractVersionTag(track.title);
  const dur = Math.round(track.actualMediaDuration || track.duration || 0);
  // Coarse 15s duration bucket prevents collapsing a 2m radio edit with a 6m extended live recording
  const durBucket = dur > 0 ? Math.round(dur / 15) * 15 : 0;
  return `rec:${artist}::${baseTitle}::${version}::${durBucket}`;
}

export function isPlayableFullTrack(track: AutoplayTrackMeta): boolean {
  if (!track || !track.title || !track.artist) return false;
  if (track.isExplicitPreview) return false;
  if (track.playbackType === 'preview') return false;
  // Preview-only iTunes 30s snippet without a fullStreamUrl or local file
  const hasFullStream = Boolean(
    track.localFilePath ||
    (track.path && !track.path.startsWith('http')) ||
    (track.fullStreamUrl && !track.fullStreamUrl.includes('audio-ssl.itunes.apple.com')) ||
    (track.streamUrl && !track.streamUrl.includes('audio-ssl.itunes.apple.com') && !track.streamUrl.includes('mzstatic.com'))
  );
  if (!hasFullStream && track.previewUrl && !track.streamUrl) return false;
  if (track.duration > 0 && track.duration <= 32 && !track.localFilePath && track.streamUrl?.includes('apple.com')) {
    return false;
  }
  return true;
}

// =========================================================================
// 2. SEEDED DETERMINISTIC PRNG (Mulberry32)
// =========================================================================

function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =========================================================================
// 3. TASTE PROFILE BUILDER (Scoped to Active User, Deduplicated Recordings)
// =========================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_LIFE_DAYS = 30;

function recencyDecay(timestamp: number, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - timestamp) / DAY_MS);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function normalizeTag(val?: string | null): string | null {
  const clean = String(val || '').toLowerCase().trim();
  if (!clean || clean === 'music' || clean === 'unknown' || clean === 'other') return null;
  return clean;
}

function addWeighted(map: Record<string, number>, key: string | null, delta: number): void {
  if (!key || delta === 0) return;
  map[key] = (map[key] || 0) + delta;
}

export function buildUserTasteProfile(params: {
  userId: string;
  likes?: AutoplayTrackMeta[];
  savedTracks?: AutoplayTrackMeta[];
  playlists?: AutoplayPlaylistInput[];
  events?: AutoplayListeningEvent[];
  nowMs?: number;
}): UserTasteProfile {
  const nowMs = params.nowMs ?? Date.now();
  const artistScores: Record<string, number> = {};
  const artistEvidenceCount: Record<string, number> = {};
  const genreScores: Record<string, number> = {};
  const languageScores: Record<string, number> = {};
  const styleTagScores: Record<string, number> = {};

  const playlistRecordingKeys = new Set<string>();
  const recordingPlaylistNames = new Map<string, string[]>();
  const playlistCooccurrenceByTrack = new Map<string, Set<string>>();
  const playlistCooccurrenceByArtist = new Map<string, Map<string, { score: number; playlistName: string }>>();
  const likedRecordingKeys = new Set<string>();
  const dislikedRecordingKeys = new Set<string>();
  const dislikedArtistKeys = new Set<string>();
  const recentlyPlayedAt = new Map<string, number>();

  let totalSignalWeight = 0;

  const recordTrackAttributes = (t: AutoplayTrackMeta, weight: number, countEvidence = true) => {
    const aKey = normalizeArtistName(t.artist);
    if (aKey) {
      addWeighted(artistScores, aKey, weight);
      if (countEvidence) {
        artistEvidenceCount[aKey] = (artistEvidenceCount[aKey] || 0) + 1;
      }
    }
    const genre = normalizeTag(t.genre);
    if (genre) addWeighted(genreScores, genre, weight);
    const lang = normalizeTag(t.language);
    if (lang) addWeighted(languageScores, lang, weight);
    for (const rawTag of (t.styleTags || [])) {
      const tag = normalizeTag(rawTag);
      if (tag) addWeighted(styleTagScores, tag, weight);
    }
    totalSignalWeight += Math.abs(weight);
  };

  // A. Likes & Saved Tracks (deduplicated by canonical recording key)
  const seenLikedOrSaved = new Set<string>();
  for (const t of [...(params.likes || []), ...(params.savedTracks || [])]) {
    const recKey = getCanonicalRecordingKey(t);
    likedRecordingKeys.add(recKey);
    if (!seenLikedOrSaved.has(recKey)) {
      seenLikedOrSaved.add(recKey);
      recordTrackAttributes(t, 2.5, true);
    }
  }

  // B. Playlists — deduplicate distinct recordings so 1 track in 6 playlists counts as ONE endorsement!
  // User-created playlists carry stronger weight (1.8) than imported/followed collections (1.0).
  const bestPlaylistWeightByRecording = new Map<string, { track: AutoplayTrackMeta; weight: number }>();

  for (const pl of (params.playlists || [])) {
    const plWeight = pl.isUserCreated === false ? 1.0 : 1.8;
    const plTracks = (pl.tracks || []) as AutoplayTrackMeta[];
    const uniquePlEntries: Array<{ recKey: string; artistKey: string; track: AutoplayTrackMeta }> = [];
    const seenInThisPl = new Set<string>();

    for (const t of plTracks) {
      const recKey = getCanonicalRecordingKey(t);
      if (seenInThisPl.has(recKey)) continue;
      seenInThisPl.add(recKey);
      playlistRecordingKeys.add(recKey);

      const names = recordingPlaylistNames.get(recKey) || [];
      if (!names.includes(pl.name)) {
        names.push(pl.name);
        recordingPlaylistNames.set(recKey, names);
      }

      const prevBest = bestPlaylistWeightByRecording.get(recKey);
      if (!prevBest || plWeight > prevBest.weight) {
        bestPlaylistWeightByRecording.set(recKey, { track: t, weight: plWeight });
      }

      uniquePlEntries.push({ recKey, artistKey: normalizeArtistName(t.artist), track: t });
    }

    // Build playlist co-occurrence index (track-to-track and artist-to-track)
    for (let i = 0; i < uniquePlEntries.length; i++) {
      const anchor = uniquePlEntries[i];
      if (!playlistCooccurrenceByTrack.has(anchor.recKey)) {
        playlistCooccurrenceByTrack.set(anchor.recKey, new Set());
      }
      if (!playlistCooccurrenceByArtist.has(anchor.artistKey)) {
        playlistCooccurrenceByArtist.set(anchor.artistKey, new Map());
      }
      const trackCo = playlistCooccurrenceByTrack.get(anchor.recKey)!;
      const artistCo = playlistCooccurrenceByArtist.get(anchor.artistKey)!;

      for (let j = 0; j < uniquePlEntries.length; j++) {
        if (i === j) continue;
        const neighbor = uniquePlEntries[j];
        trackCo.add(neighbor.recKey);
        const existing = artistCo.get(neighbor.recKey);
        const nextScore = Math.min(1.0, (existing?.score || 0) + (plWeight * 0.45));
        artistCo.set(neighbor.recKey, {
          score: nextScore,
          playlistName: existing?.playlistName || pl.name
        });
      }
    }
  }

  // Apply deduplicated recording endorsements ONCE per distinct recording
  for (const [recKey, entry] of bestPlaylistWeightByRecording.entries()) {
    // Avoid double-counting full taste weight if already counted in likes, add modest lift
    const effectiveWeight = seenLikedOrSaved.has(recKey) ? entry.weight * 0.35 : entry.weight;
    recordTrackAttributes(entry.track, effectiveWeight, !seenLikedOrSaved.has(recKey));
  }

  // C. Listening Events (Strictly scoped to active userId; errors/seeks/app_close NEVER penalized)
  const userEvents = (params.events || []).filter(e => e.userId === params.userId);
  for (const ev of userEvents) {
    // Explicitly ignore non-taste technical events
    if (
      ev.eventType === 'playback_error' ||
      ev.eventType === 'app_close' ||
      ev.eventType === 'seek' ||
      ev.eventType === 'network_interruption'
    ) {
      continue;
    }

    const recKey = ev.recordingKey || getCanonicalRecordingKey({
      id: ev.trackId,
      title: ev.title,
      artist: ev.artist,
      album: '',
      duration: ev.totalDurationSec || 180,
      path: '',
      filename: '',
      streamUrl: '',
      hasArtwork: false,
      addedAt: ev.timestamp
    });

    const prevPlayed = recentlyPlayedAt.get(recKey) || 0;
    if (ev.timestamp > prevPlayed && ev.eventType !== 'dislike') {
      recentlyPlayedAt.set(recKey, ev.timestamp);
    }

    const decay = recencyDecay(ev.timestamp, nowMs);
    let weight = 0;

    switch (ev.eventType) {
      case 'deliberate_play':
        weight = 1.4 * decay;
        break;
      case 'meaningful_listen':
        weight = (ev.source === 'user' ? 1.8 : 0.9) * decay;
        break;
      case 'complete':
        weight = (ev.source === 'user' ? 2.6 : 1.1) * decay;
        break;
      case 'autoplay_complete':
        weight = 1.1 * decay; // Some evidence of interest
        break;
      case 'deliberate_return_to_autoplay':
        weight = 2.8 * decay; // Stronger evidence when user returns deliberately
        break;
      case 'repeat':
        weight = 3.2 * decay;
        break;
      case 'quick_skip':
        // Single early skip is mainly session feedback — tiny long-term nudge so 1 skip doesn't ruin taste
        weight = -0.25 * decay;
        break;
      case 'dislike':
        dislikedRecordingKeys.add(recKey);
        weight = -3.0 * decay;
        break;
    }

    if (weight !== 0) {
      recordTrackAttributes(
        {
          id: ev.trackId,
          title: ev.title,
          artist: ev.artist,
          album: '',
          genre: ev.genre,
          language: ev.language,
          styleTags: ev.styleTags,
          duration: ev.totalDurationSec || 180,
          path: '',
          filename: '',
          streamUrl: '',
          hasArtwork: false,
          addedAt: ev.timestamp
        },
        weight,
        weight > 0
      );
    }
  }

  const hasPlaylistEvidence = playlistRecordingKeys.size > 0;
  const hasLongTermEvidence =
    seenLikedOrSaved.size > 0 ||
    userEvents.some(e =>
      e.eventType === 'deliberate_play' ||
      e.eventType === 'meaningful_listen' ||
      e.eventType === 'complete' ||
      e.eventType === 'repeat' ||
      e.eventType === 'autoplay_complete' ||
      e.eventType === 'deliberate_return_to_autoplay'
    ) ||
    hasPlaylistEvidence;

  return {
    userId: params.userId,
    artistScores,
    artistEvidenceCount,
    genreScores,
    languageScores,
    styleTagScores,
    playlistRecordingKeys,
    recordingPlaylistNames,
    playlistCooccurrenceByTrack,
    playlistCooccurrenceByArtist,
    likedRecordingKeys,
    dislikedRecordingKeys,
    dislikedArtistKeys,
    recentlyPlayedAt,
    totalSignalWeight,
    hasLongTermEvidence,
    hasPlaylistEvidence
  };
}

// =========================================================================
// 4. SIGNAL NORMALIZATION & SCORING ENGINE (40 / 30 / 20 / 10 + REDISTRIBUTION)
// =========================================================================

function getMaxAbs(map: Record<string, number>): number {
  let max = 0;
  for (const v of Object.values(map)) {
    if (v > max) max = v;
  }
  return max;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function computeSessionVector(session: AutoplaySessionContext) {
  const artistWeights: Record<string, number> = {};
  const genreWeights: Record<string, number> = {};
  const languageWeights: Record<string, number> = {};
  const styleWeights: Record<string, number> = {};

  const ingest = (t: AutoplayTrackMeta, w: number) => {
    addWeighted(artistWeights, normalizeArtistName(t.artist), w);
    addWeighted(genreWeights, normalizeTag(t.genre), w);
    addWeighted(languageWeights, normalizeTag(t.language), w);
    for (const st of (t.styleTags || [])) {
      addWeighted(styleWeights, normalizeTag(st), w);
    }
  };

  // Current seed recording has highest immediate session influence
  ingest(session.seedTrack, 3.0);

  // Active album or playlist context influences what follows its end
  if (session.activeContext && (session.activeContext.type === 'album' || session.activeContext.type === 'playlist')) {
    const ctxTracks = (session.activeContext.tracks || []).slice(0, 12);
    const perTrackWeight = ctxTracks.length > 0 ? 1.5 / ctxTracks.length : 0;
    for (const ct of ctxTracks) {
      ingest(ct, perTrackWeight);
    }
  }

  // Recent plays: deliberate user selections carry 3x more weight than autoplay picks!
  const recent = (session.recentPlays || []).slice(-6);
  recent.forEach((entry, idx) => {
    const recencyFactor = 0.5 + (idx + 1) / (recent.length * 2); // newer plays slightly stronger
    const sourceFactor = entry.source === 'user' ? 1.8 : 0.55;
    ingest(entry.track, sourceFactor * recencyFactor);
  });

  return {
    artistWeights,
    genreWeights,
    languageWeights,
    styleWeights,
    maxArtist: getMaxAbs(artistWeights),
    maxGenre: getMaxAbs(genreWeights),
    maxLang: getMaxAbs(languageWeights),
    maxStyle: getMaxAbs(styleWeights)
  };
}

function areRelatedArtists(a: string, b: string, relatedMap?: Record<string, string[]>): boolean {
  if (!a || !b || !relatedMap) return false;
  const relA = relatedMap[a] || [];
  if (relA.some(x => normalizeArtistName(x) === b)) return true;
  const relB = relatedMap[b] || [];
  if (relB.some(x => normalizeArtistName(x) === a)) return true;
  return false;
}

export function scoreAutoplayCandidate(
  candidate: AutoplayTrackMeta,
  profile: UserTasteProfile,
  session: AutoplaySessionContext,
  options?: {
    weights?: Partial<AutoplayWeights>;
    relatedArtistsMap?: Record<string, string[]>;
  }
): ScoredAutoplayCandidate {
  const baseWeights: AutoplayWeights = {
    ...DEFAULT_AUTOPLAY_WEIGHTS,
    ...(options?.weights || {})
  };

  const recKey = getCanonicalRecordingKey(candidate);
  const workKey = getSongWorkKey(candidate);
  const artistKey = normalizeArtistName(candidate.artist);
  const seedRecKey = getCanonicalRecordingKey(session.seedTrack);
  const seedArtistKey = normalizeArtistName(session.seedTrack.artist);
  const candGenre = normalizeTag(candidate.genre);
  const candLang = normalizeTag(candidate.language);
  const candStyles = (candidate.styleTags || []).map(normalizeTag).filter(Boolean) as string[];

  const sessionVec = computeSessionVector(session);

  // -----------------------------------------------------------------------
  // SIGNAL 1: CURRENT SESSION FIT (40% base)
  // Uses reliable session attributes (artist/related artist, genre, language, style tags).
  // Deliberately gives ZERO score for shared title words!
  // -----------------------------------------------------------------------
  let sessionFit: number | null = null;
  {
    let sum = 0;
    let weightSum = 0;

    // Artist & related-artist alignment in current session
    if (sessionVec.maxArtist > 0) {
      let artSim = 0;
      if (sessionVec.artistWeights[artistKey]) {
        artSim = clamp01(sessionVec.artistWeights[artistKey] / sessionVec.maxArtist);
      } else {
        for (const [sessArt, sessW] of Object.entries(sessionVec.artistWeights)) {
          if (areRelatedArtists(sessArt, artistKey, options?.relatedArtistsMap)) {
            artSim = Math.max(artSim, clamp01((sessW / sessionVec.maxArtist) * 0.78));
          }
        }
      }
      sum += artSim * 0.30;
      weightSum += 0.30;
    }

    // Reliable Genre match (only when BOTH session and candidate have known genre)
    if (candGenre && sessionVec.maxGenre > 0) {
      const gScore = clamp01((sessionVec.genreWeights[candGenre] || 0) / sessionVec.maxGenre);
      sum += gScore * 0.35;
      weightSum += 0.35;
    }

    // Reliable Language match (only when BOTH session and candidate have known language)
    if (candLang && sessionVec.maxLang > 0) {
      const lScore = clamp01((sessionVec.languageWeights[candLang] || 0) / sessionVec.maxLang);
      sum += lScore * 0.25;
      weightSum += 0.25;
    }

    // Reliable Style Tags match (e.g., acoustic, dance, duet, synthwave — only when present!)
    if (candStyles.length > 0 && sessionVec.maxStyle > 0) {
      let bestStyle = 0;
      for (const st of candStyles) {
        bestStyle = Math.max(bestStyle, clamp01((sessionVec.styleWeights[st] || 0) / sessionVec.maxStyle));
      }
      sum += bestStyle * 0.35;
      weightSum += 0.35;
    }

    if (weightSum > 0) {
      sessionFit = clamp01(sum / weightSum);
    }

    // Penalize candidates whose artist or recording was skipped in THIS session
    if (session.sessionSkippedRecordingKeys.has(recKey)) {
      sessionFit = 0;
    } else if (session.sessionSkippedArtistKeys.has(artistKey)) {
      sessionFit = (sessionFit ?? 0.3) * 0.25;
    }
  }

  // -----------------------------------------------------------------------
  // SIGNAL 2: LONG-TERM TASTE (30% base)
  // Confidence-scaled so repeated independent evidence beats a single weak observation.
  // -----------------------------------------------------------------------
  let longTermTaste: number | null = null;
  let tasteConfidence = 1.0;
  if (profile.hasLongTermEvidence) {
    const maxArt = getMaxAbs(profile.artistScores);
    const maxGen = getMaxAbs(profile.genreScores);
    const maxLang = getMaxAbs(profile.languageScores);
    const maxStyle = getMaxAbs(profile.styleTagScores);

    let sum = 0;
    let wSum = 0;

    if (maxArt > 0) {
      const rawA = Math.max(0, profile.artistScores[artistKey] || 0);
      const evidence = profile.artistEvidenceCount[artistKey] || 0;
      const conf = evidence > 0 ? (1 - Math.exp(-evidence / 1.8)) : 0;
      let aVal = clamp01(rawA / maxArt) * (0.45 + 0.55 * conf);
      // Related to user's favorite artists gives partial credit
      if (aVal === 0 && options?.relatedArtistsMap) {
        for (const [favArt, favScore] of Object.entries(profile.artistScores)) {
          if (favScore > 0 && areRelatedArtists(favArt, artistKey, options.relatedArtistsMap)) {
            aVal = Math.max(aVal, clamp01((favScore / maxArt) * 0.65));
          }
        }
      }
      sum += aVal * 0.40;
      wSum += 0.40;
    }

    if (candGenre && maxGen > 0) {
      sum += clamp01(Math.max(0, profile.genreScores[candGenre] || 0) / maxGen) * 0.25;
      wSum += 0.25;
    }

    if (candLang && maxLang > 0) {
      sum += clamp01(Math.max(0, profile.languageScores[candLang] || 0) / maxLang) * 0.20;
      wSum += 0.20;
    }

    if (candStyles.length > 0 && maxStyle > 0) {
      let bestSt = 0;
      for (const st of candStyles) {
        bestSt = Math.max(bestSt, clamp01(Math.max(0, profile.styleTagScores[st] || 0) / maxStyle));
      }
      sum += bestSt * 0.30;
      wSum += 0.30;
    }

    if (wSum > 0) {
      tasteConfidence = clamp01(1 - Math.exp(-profile.totalSignalWeight / 4.5));
      longTermTaste = clamp01((sum / wSum) * (0.5 + 0.5 * tasteConfidence));
    }
  }

  // -----------------------------------------------------------------------
  // SIGNAL 3: PLAYLIST AFFINITY (20% base)
  // Co-occurrence with the current track or current artist in user's own playlists
  // -----------------------------------------------------------------------
  let playlistAffinity: number | null = null;
  let matchedPlaylistName: string | undefined = candidate.sourcePlaylistName;
  if (profile.hasPlaylistEvidence) {
    const directTrackCo = profile.playlistCooccurrenceByTrack.get(seedRecKey)?.has(recKey) || false;
    const artistCoInfo = profile.playlistCooccurrenceByArtist.get(seedArtistKey)?.get(recKey);
    const inUserPlaylists = profile.playlistRecordingKeys.has(recKey);

    if (directTrackCo) {
      playlistAffinity = 1.0;
      matchedPlaylistName = profile.recordingPlaylistNames.get(recKey)?.[0] || matchedPlaylistName;
    } else if (artistCoInfo) {
      playlistAffinity = clamp01(0.75 + artistCoInfo.score * 0.25);
      matchedPlaylistName = artistCoInfo.playlistName || matchedPlaylistName;
    } else if (inUserPlaylists) {
      playlistAffinity = 0.52;
      matchedPlaylistName = profile.recordingPlaylistNames.get(recKey)?.[0] || matchedPlaylistName;
    } else {
      playlistAffinity = 0.0;
    }
  }

  // -----------------------------------------------------------------------
  // SIGNAL 4: DIRECT TRACK / ARTIST RELATIONSHIP (10% base)
  // Provider related-track / radio score, same artist, or verified kindred artist
  // -----------------------------------------------------------------------
  let directRelation: number | null = null;
  if (typeof candidate.directRelationScore === 'number') {
    directRelation = clamp01(candidate.directRelationScore);
  } else if (candidate.relatedToSeed) {
    directRelation = 0.9;
  } else if (artistKey === seedArtistKey) {
    directRelation = 0.85;
  } else if (areRelatedArtists(seedArtistKey, artistKey, options?.relatedArtistsMap)) {
    directRelation = 0.72;
  } else if (candidate.sourcePool === 'provider_radio') {
    directRelation = 0.88;
  } else {
    directRelation = 0.0;
  }

  // -----------------------------------------------------------------------
  // WEIGHT REDISTRIBUTION WHEN SIGNALS ARE UNAVAILABLE
  // -----------------------------------------------------------------------
  const rawActive: AutoplayWeights = {
    sessionFit: sessionFit !== null ? baseWeights.sessionFit : 0,
    longTermTaste: longTermTaste !== null ? baseWeights.longTermTaste : 0,
    playlistAffinity: playlistAffinity !== null ? baseWeights.playlistAffinity : 0,
    directRelation: directRelation !== null ? baseWeights.directRelation : 0
  };
  const totalActiveWeight =
    rawActive.sessionFit + rawActive.longTermTaste + rawActive.playlistAffinity + rawActive.directRelation;

  const effectiveWeights: AutoplayWeights =
    totalActiveWeight > 0
      ? {
          sessionFit: rawActive.sessionFit / totalActiveWeight,
          longTermTaste: rawActive.longTermTaste / totalActiveWeight,
          playlistAffinity: rawActive.playlistAffinity / totalActiveWeight,
          directRelation: rawActive.directRelation / totalActiveWeight
        }
      : { sessionFit: 0, longTermTaste: 0, playlistAffinity: 0, directRelation: 1 };

  const finalScore = clamp01(
    (sessionFit ?? 0) * effectiveWeights.sessionFit +
    (longTermTaste ?? 0) * effectiveWeights.longTermTaste +
    (playlistAffinity ?? 0) * effectiveWeights.playlistAffinity +
    (directRelation ?? 0) * effectiveWeights.directRelation
  );

  // Build truthful, human-readable reason based on strongest contributing signal
  let reason = 'Recommended for you';
  if (matchedPlaylistName && (playlistAffinity ?? 0) >= 0.7) {
    reason = `From your ${matchedPlaylistName} playlist`;
  } else if (artistKey === seedArtistKey && (directRelation ?? 0) >= 0.8) {
    reason = `More from ${session.seedTrack.artist}`;
  } else if (candidate.sourcePool === 'provider_radio' || candidate.relatedToSeed) {
    reason = `Similar to ${session.seedTrack.title}`;
  } else if ((longTermTaste ?? 0) >= 0.65 && (profile.artistScores[artistKey] || 0) > 0) {
    reason = `Because you listen to ${candidate.artist}`;
  } else if (session.activeContext?.type === 'album' && session.activeContext.name) {
    reason = `Matches ${session.activeContext.name}`;
  } else if ((sessionFit ?? 0) >= 0.6) {
    reason = `Matches your current session`;
  } else if (matchedPlaylistName) {
    reason = `From your ${matchedPlaylistName} playlist`;
  }

  const isNewToUser =
    !profile.likedRecordingKeys.has(recKey) &&
    !profile.playlistRecordingKeys.has(recKey) &&
    !profile.recentlyPlayedAt.has(recKey);

  return {
    track: candidate,
    recordingKey: recKey,
    workKey,
    artistKey,
    score: finalScore,
    isNewToUser,
    breakdown: {
      sessionFit,
      longTermTaste,
      playlistAffinity,
      directRelation,
      effectiveWeights,
      confidence: tasteConfidence,
      finalScore,
      reason
    }
  };
}

// =========================================================================
// 5. ONE-AT-A-TIME VARIED SEQUENCE SELECTOR
// =========================================================================

export function selectAutoplaySequence(
  rawCandidates: AutoplayTrackMeta[],
  profile: UserTasteProfile,
  session: AutoplaySessionContext,
  options: SelectSequenceOptions = {}
): AutoplayQueueItem[] {
  const limit = options.limit ?? 12;
  const nowMs = options.nowMs ?? Date.now();
  const randomness = clamp01(options.randomness ?? 0.22);
  const rng = createSeededRng(options.randomSeed ?? ((nowMs ^ 0x9e3779b9) >>> 0));

  const seedRecKey = getCanonicalRecordingKey(session.seedTrack);
  const seedWorkKey = getSongWorkKey(session.seedTrack);
  const seedArtistKey = normalizeArtistName(session.seedTrack.artist);

  // 1. Deduplicate across providers by canonical recordingKey & apply hard playability/dislike filters
  const deduped = new Map<string, AutoplayTrackMeta>();
  for (const cand of rawCandidates) {
    if (!isPlayableFullTrack(cand)) continue;
    const recKey = getCanonicalRecordingKey(cand);
    if (recKey === seedRecKey) continue;
    if (options.excludeRecordingKeys?.has(recKey)) continue;
    if (profile.dislikedRecordingKeys.has(recKey)) continue;
    if (session.sessionSkippedRecordingKeys.has(recKey)) continue;

    const existing = deduped.get(recKey);
    if (!existing) {
      deduped.set(recKey, cand);
    } else {
      // Keep the richer metadata copy when merging cross-provider duplicates
      const merged: AutoplayTrackMeta = {
        ...existing,
        artworkUrl: existing.artworkUrl || cand.artworkUrl,
        genre: existing.genre || cand.genre,
        language: existing.language || cand.language,
        styleTags: existing.styleTags?.length ? existing.styleTags : cand.styleTags,
        directRelationScore: Math.max(existing.directRelationScore || 0, cand.directRelationScore || 0) || undefined,
        relatedToSeed: existing.relatedToSeed || cand.relatedToSeed,
        sourcePlaylistName: existing.sourcePlaylistName || cand.sourcePlaylistName
      };
      deduped.set(recKey, merged);
    }
  }

  // 2. Score every eligible candidate
  const pool: ScoredAutoplayCandidate[] = Array.from(deduped.values()).map(cand =>
    scoreAutoplayCandidate(cand, profile, session, {
      weights: options.weights,
      relatedArtistsMap: options.relatedArtistsMap
    })
  );

  // 3. Select one track at a time with dynamic variety & recency penalties
  const selected: AutoplayQueueItem[] = [];
  const usedRecordingKeys = new Set<string>([seedRecKey]);
  const usedWorkKeys = new Set<string>([seedWorkKey]);
  const artistPlayCounts = new Map<string, number>();
  let lastArtistKey = seedArtistKey;
  let consecutiveArtistCount = 1;
  let discoveryCount = 0;

  const isSparseCatalog = pool.length <= Math.max(limit, 5);

  while (selected.length < limit) {
    const remaining = pool.filter(item => !usedRecordingKeys.has(item.recordingKey));
    if (remaining.length === 0) break;

    const dynamicallyRanked = remaining.map(item => {
      let adjusted = item.score;

      // A. Recently played recording penalty (strong within last 4 hours, fading over 24h)
      const lastPlayed = profile.recentlyPlayedAt.get(item.recordingKey);
      if (lastPlayed) {
        const hoursAgo = Math.max(0, (nowMs - lastPlayed) / (60 * 60 * 1000));
        if (hoursAgo < 4) adjusted *= 0.25;
        else if (hoursAgo < 24) adjusted *= 0.65;
      }

      // B. Consecutive same-artist penalty (relaxed slightly on sparse catalogs)
      const sameAsLast = item.artistKey === lastArtistKey;
      const priorArtistCount = artistPlayCounts.get(item.artistKey) || 0;
      if (sameAsLast) {
        adjusted *= isSparseCatalog ? 0.68 : (consecutiveArtistCount >= 2 ? 0.22 : 0.45);
      } else if (priorArtistCount >= 2) {
        adjusted *= isSparseCatalog ? 0.8 : 0.62;
      }

      // C. Multiple versions of the same song (same workKey) penalty
      if (usedWorkKeys.has(item.workKey)) {
        adjusted *= 0.15;
      }

      // D. Occasional discovery lift for new-to-user tracks that ALREADY fit the current session
      const wantsDiscoverySlot = selected.length >= 2 && selected.length % 3 === 2 && discoveryCount < Math.ceil(limit / 3);
      if (wantsDiscoverySlot && item.isNewToUser && (item.breakdown.sessionFit ?? 0) >= 0.48) {
        adjusted += 0.08;
      }

      return { item, adjusted };
    });

    dynamicallyRanked.sort((a, b) => b.adjusted - a.adjusted);

    // Choose with modest controlled randomness among the top 3 strongest candidates
    let chosenEntry = dynamicallyRanked[0];
    if (randomness > 0 && dynamicallyRanked.length > 1) {
      const topK = dynamicallyRanked.slice(0, Math.min(3, dynamicallyRanked.length));
      const topScore = topK[0].adjusted;
      // Only randomize among candidates genuinely close to the #1 pick (within 12% of top score)
      const viable = topK.filter(e => topScore > 0 && e.adjusted >= topScore * (1 - randomness * 0.55));
      if (viable.length > 1) {
        const temperature = Math.max(0.05, randomness * 0.4);
        const weights = viable.map(v => Math.exp((v.adjusted - topScore) / temperature));
        const sumW = weights.reduce((a, b) => a + b, 0);
        let r = rng() * sumW;
        for (let i = 0; i < viable.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            chosenEntry = viable[i];
            break;
          }
        }
      }
    }

    const chosen = chosenEntry.item;
    usedRecordingKeys.add(chosen.recordingKey);
    usedWorkKeys.add(chosen.workKey);
    if (chosen.artistKey === lastArtistKey) {
      consecutiveArtistCount++;
    } else {
      lastArtistKey = chosen.artistKey;
      consecutiveArtistCount = 1;
    }
    artistPlayCounts.set(chosen.artistKey, (artistPlayCounts.get(chosen.artistKey) || 0) + 1);
    if (chosen.isNewToUser) discoveryCount++;

    selected.push({
      track: chosen.track,
      recordingKey: chosen.recordingKey,
      reason: chosen.breakdown.reason,
      score: chosenEntry.adjusted,
      sourcePool: chosen.track.sourcePool,
      breakdown: chosen.breakdown
    });
  }

  return selected;
}
