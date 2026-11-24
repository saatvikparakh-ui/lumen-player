/**
 * LUMEN ARTIST RANKING & DISAMBIGUATION ENGINE (v2)
 *
 * Strictly separates catalog discovery from popularity ranking:
 *  - Preserves provider source positions internally vs displayed rank numbers
 *  - Deduplicates identical recordings across single/album/deluxe editions (ISRC-first, then conservative match)
 *  - Keeps genuine remixes, live performances, and acoustic versions distinct
 *  - Routes featured-only credits to "Appears on" and documents the filter in Source Details
 *  - Disambiguates same-name artists via provider artist ID & track/release context
 *  - Never invents stream counts or substitutes covers when a recording is unavailable
 */

export type ArtistRankingProvider = 'youtube_music' | 'jiosaavn' | 'itunes_catalog' | 'none';

export interface ArtistIdentityContext {
  name: string;
  artistId?: string | null;
  provider?: string | null;
  trackTitle?: string | null;
  album?: string | null;
  releaseYear?: number | null;
}

export interface RawProviderTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  artworkUrl?: string | null;
  streamUrl?: string;
  videoId?: string;
  isrc?: string | null;
  playCount?: number | null;
  playCountDisplay?: string | null;
  sourcePosition: number;
  rawProvider: ArtistRankingProvider;
  isPlayable?: boolean;
  unavailableReason?: string | null;
}

export interface RankedTrackEntry extends RawProviderTrack {
  displayRank: number | null; // null when catalog-only (unranked)
  creditRole: 'primary' | 'co_primary' | 'featured_only';
  recordingKey: string;
  versionTag: string;
  isPlayable: boolean;
}

export interface ArtistRankingMeta {
  schemaVersion: 2;
  provider: ArtistRankingProvider;
  providerName: string;
  heading: string; // e.g. "Most streamed on YouTube Music", "Popular on JioSaavn", "Songs by X"
  metric: string;
  scope: string; // e.g. "Worldwide · All time"
  period: string; // e.g. "All time" | "Current popularity" | "Catalog"
  market: string; // e.g. "GLOBAL" | "IN"
  isRanked: boolean;
  updatedAt: number;
  isStaleCache?: boolean;
  filterExplanation: string | null;
  filteredFeaturedCount: number;
  deduplicatedCount: number;
  verifiedBySource: boolean;
  artistId: string | null;
  portraitUrl: string | null;
  subscriberCountText?: string | null;
  monthlyAudienceText?: string | null;
}

export interface StructuredArtistRankingResult {
  meta: ArtistRankingMeta;
  rankedTracks: RankedTrackEntry[];
  appearsOnTracks: RankedTrackEntry[];
}

export interface ArtistCandidate {
  id: string;
  name: string;
  provider?: string;
  portraitUrl?: string | null;
  verified?: boolean;
  subscriberCount?: number;
  subscriberCountText?: string | null;
  sampleTracks?: string[];
  sampleAlbums?: string[];
}

export const ARTIST_CACHE_SCHEMA_VERSION = 2;
export const ARTIST_CACHE_STORAGE_PREFIX = 'lumen_artist_ranking_v2:';

/**
 * Parses compact human-formatted play counts like "4.1B plays", "684M plays", "92.5K", "1,250".
 * Returns null if no trustworthy numeric count is present.
 */
export function parseCompactPlayCount(raw?: string | number | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }
  const text = String(raw).trim();
  if (!text) return null;
  const match = text.match(/([\d.,]+)\s*([KMBT])?\b/i);
  if (!match) return null;
  const numStr = match[1].replace(/,/g, '');
  const base = parseFloat(numStr);
  if (!Number.isFinite(base) || base <= 0) return null;
  const suffix = (match[2] || '').toUpperCase();
  const mult =
    suffix === 'T' ? 1_000_000_000_000 :
    suffix === 'B' ? 1_000_000_000 :
    suffix === 'M' ? 1_000_000 :
    suffix === 'K' ? 1_000 : 1;
  return Math.round(base * mult);
}

/**
 * Formats a verified numeric play count compactly (e.g. 4100000000 -> "4.1B plays").
 */
export function formatCompactPlayCount(count?: number | null): string | null {
  if (!count || !Number.isFinite(count) || count <= 0) return null;
  if (count >= 1_000_000_000) {
    const val = (count / 1_000_000_000).toFixed(count >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, '');
    return `${val}B plays`;
  }
  if (count >= 1_000_000) {
    const val = (count / 1_000_000).toFixed(count >= 100_000_000 ? 0 : 1).replace(/\.0$/, '');
    return `${val}M plays`;
  }
  if (count >= 1_000) {
    const val = (count / 1_000).toFixed(count >= 100_000 ? 0 : 1).replace(/\.0$/, '');
    return `${val}K plays`;
  }
  return `${count} plays`;
}

export function normalizeCompareText(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts a genuine recording-version discriminator.
 * Remixes, live recordings, acoustic/unplugged, instrumental, demo, slowed/sped-up
 * remain distinct recordings. Deluxe/Remastered/Clean/Explicit/Single-Version do NOT
 * split the same studio recording.
 */
export function extractRecordingVersionTag(title?: string | null): string {
  const raw = String(title || '').toLowerCase();
  const tags: string[] = [];

  // Capture specific remix/edit/live qualifiers inside parentheses, brackets, or after hyphen
  if (/\bremix\b/i.test(raw)) {
    const remixQual = raw.match(/[\(\[\-]\s*([^\)\]]*remix[^\)\]]*)/i);
    const cleanQual = remixQual ? normalizeCompareText(remixQual[1]) : 'remix';
    tags.push(cleanQual || 'remix');
  }
  if (/\b(live|at\s+the\s+|mtv\s+unplugged|concert|session)\b/i.test(raw)) {
    tags.push('live');
  }
  if (/\b(acoustic|unplugged|stripped)\b/i.test(raw)) {
    tags.push('acoustic');
  }
  if (/\b(instrumental|karaoke|a\s*cappella|acapella)\b/i.test(raw)) {
    tags.push('instrumental');
  }
  if (/\b(sped\s*up|slowed|reverb|nightcore|8d\s+audio)\b/i.test(raw)) {
    tags.push('alt_speed');
  }
  if (/\b(demo|alternate\s+version|original\s+version|extended\s+mix|club\s+mix|dub\s+mix|vip\s+mix)\b/i.test(raw)) {
    const m = raw.match(/\b(demo|alternate\s+version|extended\s+mix|club\s+mix|dub\s+mix|vip\s+mix)\b/i);
    if (m) tags.push(normalizeCompareText(m[1]));
  }

  return tags.length > 0 ? tags.sort().join('|') : 'studio';
}

/**
 * Strips featured clauses & non-recording edition suffixes (Deluxe, Remastered, Explicit,
 * Single Version, From the Motion Picture, etc.) to yield the canonical base song title.
 */
export function extractCanonicalBaseTitle(title?: string | null): string {
  let t = String(title || '');
  // Remove parenthetical/bracketed edition or feat clauses (but preserve remix/live identity via extractRecordingVersionTag)
  t = t.replace(/[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\b[^\)\]]*[\)\]]/gi, ' ');
  t = t.replace(/[\(\[]\s*(?:remaster(?:ed)?[^\)\]]*|deluxe[^\)\]]*|super\s+deluxe[^\)\]]*|explicit|clean|single\s+version|album\s+version|radio\s+edit|audio|official\s+(?:audio|video|lyric\s+video)|from\s+[^\)\]]+|bonus\s+track|digital\s+single|version|remix[^\)\]]*|live[^\)\]]*|acoustic[^\)\]]*|instrumental[^\)\]]*|extended[^\)\]]*)[\)\]]/gi, ' ');
  // Remove trailing "- Remastered 2020", "- Single Version", "- Remix", "- Live"
  t = t.replace(/\s*[-–—]\s*(?:remaster(?:ed)?(?:\s+\d{4})?|single\s+version|album\s+version|radio\s+edit|deluxe|explicit|clean|bonus\s+track|remix.*|live.*|acoustic.*|instrumental.*|from\s+.*)$/i, ' ');
  // Remove trailing "feat. X" outside brackets
  t = t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, ' ');
  return normalizeCompareText(t);
}

/**
 * Classifies whether `targetArtistName` is a primary, co-primary, or featured-only artist on a track.
 *  - Primary: sole credited artist or first listed artist before feat.
 *  - Co-primary: listed alongside another lead artist using "&", ",", "x", "and" outside a feat. clause
 *  - Featured-only: ONLY appears inside a "(feat. ...)" / "ft. ..." / "featuring ..." clause (either in artist string or title)
 */
export function classifyArtistCredit(
  targetArtistName: string,
  trackArtist: string,
  trackTitle: string = ''
): 'primary' | 'co_primary' | 'featured_only' {
  const targetNorm = normalizeCompareText(targetArtistName);
  if (!targetNorm) return 'primary';

  const artistStr = String(trackArtist || '');
  const titleStr = String(trackTitle || '');

  // Split artist string into primary part vs featured clause
  const featSplit = artistStr.split(/\b(?:feat\.?|ft\.?|featuring)\b/i);
  const primarySection = featSplit[0] || '';
  const featuredSection = featSplit.slice(1).join(' ');

  // Extract featured clause from title too (e.g. "Creepin' (feat. The Weeknd)")
  const titleFeatMatch = titleStr.match(/[\(\[\s]\s*(?:feat\.?|ft\.?|featuring)\s+([^\)\]]+)/i);
  const titleFeatNorm = normalizeCompareText(titleFeatMatch ? titleFeatMatch[1] : '');

  // Tokenize primary artists by comma, &, x, "and", "with"
  const primaryArtists = primarySection
    .split(/\s*(?:,|&|\band\b|\bwith\b|\bx\b|\/)\s*/i)
    .map(a => normalizeCompareText(a))
    .filter(Boolean);

  const exactMatch = (candidate: string) =>
    candidate === targetNorm ||
    (targetNorm.length >= 4 && (candidate === `the ${targetNorm}` || `the ${candidate}` === targetNorm));

  if (primaryArtists.length > 0 && exactMatch(primaryArtists[0])) {
    return 'primary';
  }
  if (primaryArtists.slice(1).some(exactMatch)) {
    return 'co_primary';
  }

  // Check if target appears ONLY in featured clause of artist or title
  const featNorm = normalizeCompareText(featuredSection);
  if (
    (featNorm && featNorm.includes(targetNorm)) ||
    (titleFeatNorm && titleFeatNorm.includes(targetNorm))
  ) {
    return 'featured_only';
  }

  // If the primary section contains the target name as a whole substring (e.g. "The Weeknd"), treat as co_primary
  const primaryNorm = normalizeCompareText(primarySection);
  if (primaryNorm && primaryNorm.includes(targetNorm)) {
    return primaryNorm.startsWith(targetNorm) ? 'primary' : 'co_primary';
  }

  // Fallback: target wasn't in primary credits at all -> featured_only ("Appears on")
  return 'featured_only';
}

/**
 * Checks whether two track entries represent the SAME underlying studio recording
 * (e.g. Single vs Album vs Deluxe edition of "Blinding Lights") while preserving
 * genuine remixes, live tracks, and alternate recordings as distinct.
 */
export function isSameRecording(a: RawProviderTrack, b: RawProviderTrack): boolean {
  // 1. Prefer authoritative ISRC match when both exist
  if (a.isrc && b.isrc) {
    return a.isrc.trim().toUpperCase() === b.isrc.trim().toUpperCase();
  }

  // 2. Compare canonical base title + recording version tag
  const baseA = extractCanonicalBaseTitle(a.title);
  const baseB = extractCanonicalBaseTitle(b.title);
  if (!baseA || !baseB || baseA !== baseB) return false;

  const verA = extractRecordingVersionTag(a.title);
  const verB = extractRecordingVersionTag(b.title);
  if (verA !== verB) return false;

  // 3. Conservative primary artist credit comparison
  const primaryA = normalizeCompareText(String(a.artist || '').split(/,|&|\bfeat\.?|\bft\.?/i)[0]);
  const primaryB = normalizeCompareText(String(b.artist || '').split(/,|&|\bfeat\.?|\bft\.?/i)[0]);
  if (primaryA && primaryB && primaryA !== primaryB && !primaryA.includes(primaryB) && !primaryB.includes(primaryA)) {
    return false;
  }

  // 4. Conservative duration check: if both durations are known and differ by > 12s, treat as distinct recording
  const durA = Number(a.duration || 0);
  const durB = Number(b.duration || 0);
  if (durA > 20 && durB > 20 && Math.abs(durA - durB) > 12) {
    return false;
  }

  return true;
}

/**
 * Disambiguates same-name artist candidates using carried provider artist ID first,
 * then release/track context hints, then exact name + audience size.
 * Never blindly accepts a mismatched first text-search result.
 */
export function disambiguateArtistCandidate(
  candidates: ArtistCandidate[],
  context: ArtistIdentityContext
): ArtistCandidate | null {
  if (!candidates || candidates.length === 0) return null;

  const cleanWantedId = (context.artistId || '')
    .replace(/^(artist_saavn_|artist_ytm_|artist_itunes_|artist_|local_artist_)/i, '')
    .trim();
  const targetName = normalizeCompareText(context.name);
  const trackHint = normalizeCompareText(context.trackTitle);
  const albumHint = normalizeCompareText(context.album);

  // 1. Direct provider artist ID match wins unconditionally
  if (cleanWantedId) {
    const idMatch = candidates.find(c => {
      const cid = String(c.id || '').replace(/^(artist_saavn_|artist_ytm_|artist_itunes_|artist_|local_artist_)/i, '').trim();
      return cid && cid === cleanWantedId;
    });
    if (idMatch) return idMatch;
  }

  // 2. Score candidates by release/track evidence, exact name match, verification, and audience
  let best: ArtistCandidate | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cName = normalizeCompareText(c.name);
    let score = 0;

    if (cName === targetName) score += 100;
    else if (cName.startsWith(targetName) || targetName.startsWith(cName)) score += 45;
    else if (cName.includes(targetName)) score += 20;
    else score -= 40;

    // Track or album disambiguation hint (decisive for same-name artists!)
    if (trackHint && Array.isArray(c.sampleTracks)) {
      if (c.sampleTracks.some(t => normalizeCompareText(t).includes(trackHint) || trackHint.includes(normalizeCompareText(t)))) {
        score += 180;
      }
    }
    if (albumHint && Array.isArray(c.sampleAlbums)) {
      if (c.sampleAlbums.some(a => normalizeCompareText(a).includes(albumHint) || albumHint.includes(normalizeCompareText(a)))) {
        score += 160;
      }
    }

    if (c.verified) score += 18;
    if (c.portraitUrl) score += 8;
    if (c.subscriberCount && c.subscriberCount > 0) {
      score += Math.min(40, Math.log10(c.subscriberCount + 1) * 5);
    }
    // Gentle tiebreaker for earlier provider search rank
    score -= i * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

/**
 * Builds the complete, honestly-labeled ranking structure from raw provider tracks:
 *  - Separates primary/co-primary recordings from featured-only ("Appears on")
 *  - Deduplicates identical studio recordings across single/album/deluxe releases
 *  - Orders by global all-time play count when backed by YouTube Music play counts,
 *    or preserves provider order without inventing counts, or omits ranks for catalog-only
 */
export function buildArtistRanking(params: {
  artistName: string;
  provider: ArtistRankingProvider;
  rawTracks: RawProviderTrack[];
  artistId?: string | null;
  portraitUrl?: string | null;
  verifiedBySource?: boolean;
  subscriberCountText?: string | null;
  monthlyAudienceText?: string | null;
  market?: string;
  updatedAt?: number;
  isStaleCache?: boolean;
}): StructuredArtistRankingResult {
  const {
    artistName,
    provider,
    rawTracks,
    artistId = null,
    portraitUrl = null,
    verifiedBySource = false,
    subscriberCountText = null,
    monthlyAudienceText = null,
    market = provider === 'jiosaavn' ? 'IN' : 'GLOBAL',
    updatedAt = Date.now(),
    isStaleCache = false
  } = params;

  const list = Array.isArray(rawTracks) ? rawTracks : [];

  // 1. Classify primary/co-primary vs featured-only AND normalize play counts
  const classified = list.map((t, idx) => {
    const parsedCount =
      typeof t.playCount === 'number' && t.playCount > 0
        ? t.playCount
        : parseCompactPlayCount(t.playCountDisplay);
    const role = classifyArtistCredit(artistName, t.artist, t.title);
    const versionTag = extractRecordingVersionTag(t.title);
    const baseTitle = extractCanonicalBaseTitle(t.title);
    const recordingKey = t.isrc
      ? `isrc:${t.isrc.trim().toUpperCase()}`
      : `${baseTitle}::${versionTag}`;
    return {
      ...t,
      sourcePosition: t.sourcePosition || idx + 1,
      playCount: parsedCount,
      playCountDisplay: t.playCountDisplay || formatCompactPlayCount(parsedCount),
      creditRole: role,
      versionTag,
      recordingKey,
      isPlayable: t.isPlayable !== false
    };
  });

  // 2. Determine ranking mode strictly from real provider capabilities
  const primaryPoolRaw = classified.filter(t => t.creditRole !== 'featured_only');
  const featuredPoolRaw = classified.filter(t => t.creditRole === 'featured_only');

  const countWithNumericPlays = primaryPoolRaw.filter(t => typeof t.playCount === 'number' && t.playCount > 0).length;
  const hasGlobalPlayCounts =
    provider === 'youtube_music' &&
    primaryPoolRaw.length > 0 &&
    countWithNumericPlays >= Math.max(1, Math.ceil(primaryPoolRaw.length * 0.5));

  // Sort primary pool BEFORE dedup so the canonical/highest-play recording wins deduplication
  const orderedPrimary = [...primaryPoolRaw].sort((a, b) => {
    if (hasGlobalPlayCounts) {
      const ca = a.playCount || 0;
      const cb = b.playCount || 0;
      if (cb !== ca) return cb - ca;
    }
    return a.sourcePosition - b.sourcePosition;
  });

  const orderedFeatured = [...featuredPoolRaw].sort((a, b) => {
    if (hasGlobalPlayCounts) {
      const ca = a.playCount || 0;
      const cb = b.playCount || 0;
      if (cb !== ca) return cb - ca;
    }
    return a.sourcePosition - b.sourcePosition;
  });

  // 3. Deduplicate identical recordings within each pool (preserving remixes, live, acoustic!)
  let deduplicatedCount = 0;
  const dedupPool = (pool: typeof orderedPrimary): RankedTrackEntry[] => {
    const kept: RankedTrackEntry[] = [];
    for (const candidate of pool) {
      const existingIdx = kept.findIndex(existing => isSameRecording(existing, candidate));
      if (existingIdx !== -1) {
        deduplicatedCount++;
        // Enrich existing copy with artwork/duration/isrc if missing
        const ex = kept[existingIdx];
        if (!ex.artworkUrl && candidate.artworkUrl) ex.artworkUrl = candidate.artworkUrl;
        if ((!ex.duration || ex.duration <= 0) && candidate.duration) ex.duration = candidate.duration;
        if (!ex.isrc && candidate.isrc) ex.isrc = candidate.isrc;
        continue;
      }
      kept.push({
        ...candidate,
        displayRank: null
      });
    }
    return kept;
  };

  const dedupPrimary = dedupPool(orderedPrimary);
  const dedupFeatured = dedupPool(orderedFeatured);

  // 4. Honest labeling & display ranks
  let providerName = 'Catalog';
  let heading = `Songs by ${artistName}`;
  let metric = 'Catalog search results (unranked)';
  let scope = 'Catalog discovery';
  let period = 'Unranked';
  let isRanked = false;

  if (hasGlobalPlayCounts) {
    providerName = 'YouTube Music';
    heading = 'Most streamed on YouTube Music';
    metric = 'Global all-time YouTube Music stream totals';
    scope = 'Worldwide · All time';
    period = 'All time';
    isRanked = true;
  } else if (provider === 'youtube_music' && dedupPrimary.length > 0) {
    providerName = 'YouTube Music';
    heading = 'Popular on YouTube Music';
    metric = 'YouTube Music artist popularity ranking';
    scope = 'Worldwide · Provider popularity order';
    period = 'Current popularity';
    isRanked = true;
  } else if (provider === 'jiosaavn' && dedupPrimary.length > 0) {
    providerName = 'JioSaavn';
    heading = 'Popular on JioSaavn';
    metric = 'JioSaavn artist popularity ranking (regional catalog)';
    scope = 'India / Regional · Provider popularity order';
    period = 'Current popularity';
    isRanked = true;
  } else {
    providerName = 'Apple Music / iTunes Catalog';
    heading = `Songs by ${artistName}`;
    metric = 'Catalog lookup (popularity ranking unavailable)';
    scope = 'Catalog only · Rank numbers omitted';
    period = 'Unranked';
    isRanked = false;
  }

  const rankedTracks: RankedTrackEntry[] = dedupPrimary.map((entry, idx) => ({
    ...entry,
    displayRank: isRanked ? idx + 1 : null
  }));

  const appearsOnTracks: RankedTrackEntry[] = dedupFeatured.map((entry) => ({
    ...entry,
    displayRank: null
  }));

  const filterNotes: string[] = [];
  if (appearsOnTracks.length > 0) {
    filterNotes.push(
      `Moved ${appearsOnTracks.length} featured-only ${appearsOnTracks.length === 1 ? 'appearance' : 'appearances'} to "Appears on" so primary & co-primary releases lead.`
    );
  }
  if (deduplicatedCount > 0) {
    filterNotes.push(
      `Merged ${deduplicatedCount} duplicate single/album/deluxe ${deduplicatedCount === 1 ? 'edition' : 'editions'} of identical recordings while keeping remixes & live versions distinct.`
    );
  }

  return {
    meta: {
      schemaVersion: ARTIST_CACHE_SCHEMA_VERSION,
      provider,
      providerName,
      heading,
      metric,
      scope,
      period,
      market,
      isRanked,
      updatedAt,
      isStaleCache,
      filterExplanation: filterNotes.length > 0 ? filterNotes.join(' ') : null,
      filteredFeaturedCount: appearsOnTracks.length,
      deduplicatedCount,
      verifiedBySource,
      artistId,
      portraitUrl,
      subscriberCountText,
      monthlyAudienceText
    },
    rankedTracks,
    appearsOnTracks
  };
}

/**
 * Resolves ranked entries to playable tracks concurrently while STRICTLY preserving
 * chart order and NEVER substituting a cover or different recording.
 */
export async function resolveRankedTracksPreservingOrder<T extends RankedTrackEntry>(
  entries: T[],
  resolver: (entry: T) => Promise<{ playable: boolean; streamUrl?: string; duration?: number; artworkUrl?: string | null; unavailableReason?: string } | null>,
  signal?: AbortSignal
): Promise<T[]> {
  const results = new Array<T>(entries.length);
  await Promise.all(
    entries.map(async (entry, idx) => {
      if (signal?.aborted) {
        results[idx] = entry;
        return;
      }
      try {
        const res = await resolver(entry);
        if (signal?.aborted) {
          results[idx] = entry;
          return;
        }
        if (!res || !res.playable) {
          results[idx] = {
            ...entry,
            isPlayable: false,
            unavailableReason: res?.unavailableReason || 'Recording unavailable on streaming providers'
          };
        } else {
          results[idx] = {
            ...entry,
            isPlayable: true,
            streamUrl: res.streamUrl || entry.streamUrl,
            duration: res.duration || entry.duration,
            artworkUrl: res.artworkUrl || entry.artworkUrl,
            unavailableReason: null
          };
        }
      } catch {
        results[idx] = {
          ...entry,
          isPlayable: false,
          unavailableReason: 'Playback verification failed'
        };
      }
    })
  );
  return results;
}

/**
 * Builds the exact playback queue for Play (displayed order) or Shuffle (same eligible playable set).
 */
export function buildPlayQueueFromRanking<T extends { isPlayable?: boolean }>(
  displayedEntries: T[],
  options: { shuffle?: boolean; randomFn?: () => number } = {}
): T[] {
  const eligible = displayedEntries.filter(e => e.isPlayable !== false);
  if (!options.shuffle) {
    return [...eligible];
  }
  const rng = options.randomFn || Math.random;
  const arr = [...eligible];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Builds a structured cache key segmented by provider, artist ID, market, and period.
 */
export function buildArtistRankingCacheKey(params: {
  provider: string;
  artistId?: string | null;
  artistName: string;
  market?: string;
  period?: string;
}): string {
  const p = (params.provider || 'auto').toLowerCase();
  const idPart = (params.artistId || normalizeCompareText(params.artistName)).toLowerCase();
  const m = (params.market || 'GLOBAL').toUpperCase();
  const per = (params.period || 'all_time').toLowerCase();
  return `${ARTIST_CACHE_STORAGE_PREFIX}${p}:${idPart}:${m}:${per}`;
}

/**
 * Purges any pre-v2 artist cache keys from storage so upgrading the app
 * can never relabel old unranked search results as a new chart.
 */
export function purgeLegacyArtistCaches(storage?: Pick<Storage, 'length' | 'key' | 'removeItem'> | null): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k) continue;
      const isOldArtistCache =
        k.startsWith('lumen_artist_discog_') ||
        k.startsWith('lumen_artist_ranking_v1:') ||
        k.startsWith('lumen_artist_cache_');
      if (isOldArtistCache && !k.startsWith(ARTIST_CACHE_STORAGE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      storage.removeItem(k);
      removed++;
    }
  } catch (_) {}
  return removed;
}
