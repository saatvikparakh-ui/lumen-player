/**
 * Pure, honest Listening Statistics aggregation engine.
 * Fixes:
 *  - Recognizes 'play', 'start', 'complete', 'replay', and meaningful 'skipped' events
 *  - Uses actual listened duration (NO artificial play_count * 200 inflation!)
 *  - Returns completion_rate_percent = 0 when total_plays = 0 (instead of fake 100%)
 *  - Formats 0 seconds as '0m' and sub-minute non-zero listens as '<1m'
 */

export interface RawListeningEvent {
  id?: string;
  trackId: string;
  title?: string;
  artist?: string;
  eventType: string;
  listenDurationSec: number;
  totalDurationSec?: number;
  timestamp: number;
}

export interface LibraryTrackPlayLike {
  id: string;
  title?: string;
  artist?: string;
  playCount?: number;
  lastPlayed?: number;
  duration?: number;
}

export interface AggregatedSongStat {
  song_id: string;
  title: string;
  artist: string;
  play_count: number;
  total_duration_seconds: number;
  total_duration_formatted: string;
  rating_formatted?: string | null;
}

export interface AggregatedArtistStat {
  artist: string;
  play_count: number;
  total_duration_seconds: number;
  total_duration_formatted: string;
}

export interface AggregatedListeningSummary {
  total_plays: number;
  qualified_plays: number;
  total_listening_duration_seconds: number;
  total_listening_duration_formatted: string;
  completion_rate_percent: number;
}

export interface AggregatedListeningResult {
  summary: AggregatedListeningSummary;
  top_songs: AggregatedSongStat[];
  top_artists: AggregatedArtistStat[];
  top_duration_songs: AggregatedSongStat[];
}

export function formatListeningDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  if (safe === 0) return '0m';
  if (safe < 60) return '<1m';
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function aggregateListeningEvents(params: {
  events: RawListeningEvent[];
  libraryTracks?: LibraryTrackPlayLike[];
  ratingsLookup?: Record<string, string | null | undefined>;
  window: '30d' | '90d' | 'all';
  nowMs?: number;
}): AggregatedListeningResult {
  const now = params.nowMs ?? Date.now();
  let cutoff = 0;
  if (params.window === '30d') cutoff = now - 30 * 24 * 60 * 60 * 1000;
  else if (params.window === '90d') cutoff = now - 90 * 24 * 60 * 60 * 1000;

  const ratingsLookup = params.ratingsLookup || {};
  const windowEvents = (params.events || []).filter(e => (e?.timestamp || 0) >= cutoff);

  const songMap = new Map<string, {
    song_id: string;
    title: string;
    artist: string;
    play_count: number;
    total_duration_seconds: number;
    rating_formatted: string | null;
  }>();

  let totalPlays = 0;
  let qualifiedPlays = 0;
  let totalDurationSec = 0;

  for (const ev of windowEvents) {
    if (!ev) continue;
    const trackId = ev.trackId || `track_${ev.title || 'unknown'}_${ev.artist || 'unknown'}`;
    const totalDur = ev.totalDurationSec && ev.totalDurationSec > 0 ? ev.totalDurationSec : 180;
    const rawListen = Math.max(0, Number(ev.listenDurationSec || 0));
    const cappedListen = Math.min(rawListen, Math.max(totalDur * 1.25, 600));
    const type = String(ev.eventType || 'play').toLowerCase();

    // Ignore accidental instant 0-4s skips from inflating play counts
    const isCompleted = type === 'complete' || type === 'completed' || type === 'replay';
    const isMeaningfulPlay = isCompleted || cappedListen >= 10 || (totalDur > 0 && cappedListen / totalDur >= 0.25);

    if (!isMeaningfulPlay && cappedListen < 5) {
      continue;
    }

    let song = songMap.get(trackId);
    if (!song) {
      song = {
        song_id: trackId,
        title: ev.title || 'Unknown Track',
        artist: ev.artist || 'Unknown Artist',
        play_count: 0,
        total_duration_seconds: 0,
        rating_formatted: ratingsLookup[trackId] || null
      };
      songMap.set(trackId, song);
    } else {
      if ((!song.title || song.title === 'Unknown Track') && ev.title) song.title = ev.title;
      if ((!song.artist || song.artist === 'Unknown Artist') && ev.artist) song.artist = ev.artist;
    }

    const effectiveDur = cappedListen > 0 ? Math.round(cappedListen) : (isCompleted ? Math.round(totalDur) : 0);
    song.total_duration_seconds += effectiveDur;
    totalDurationSec += effectiveDur;

    if (isMeaningfulPlay) {
      song.play_count += 1;
      totalPlays += 1;
    }

    const isQualified = isCompleted || effectiveDur >= 30 || (totalDur > 0 && effectiveDur / totalDur >= 0.8);
    if (isMeaningfulPlay && isQualified) {
      qualifiedPlays += 1;
    }
  }

  // Merge any local library tracks that have real playCount tracked outside events log
  for (const t of params.libraryTracks || []) {
    if (!t || !t.id || !(t.playCount && t.playCount > 0)) continue;
    if (params.window !== 'all' && (t.lastPlayed || 0) < cutoff) continue;
    const existing = songMap.get(t.id);
    const estDur = Math.max(0, t.playCount * (t.duration && t.duration > 10 ? t.duration : 180));
    if (existing) {
      if (t.playCount > existing.play_count) {
        const extraPlays = t.playCount - existing.play_count;
        existing.play_count = t.playCount;
        totalPlays += extraPlays;
        qualifiedPlays += extraPlays;
      }
      if (estDur > existing.total_duration_seconds) {
        totalDurationSec += estDur - existing.total_duration_seconds;
        existing.total_duration_seconds = estDur;
      }
    } else {
      songMap.set(t.id, {
        song_id: t.id,
        title: t.title || 'Unknown Track',
        artist: t.artist || 'Unknown Artist',
        play_count: t.playCount,
        total_duration_seconds: estDur,
        rating_formatted: ratingsLookup[t.id] || null
      });
      totalPlays += t.playCount;
      qualifiedPlays += t.playCount;
      totalDurationSec += estDur;
    }
  }

  const allSongs: AggregatedSongStat[] = Array.from(songMap.values()).map(s => ({
    ...s,
    total_duration_formatted: formatListeningDuration(s.total_duration_seconds)
  }));

  const topSongs = [...allSongs]
    .filter(s => s.play_count > 0)
    .sort((a, b) => b.play_count - a.play_count || b.total_duration_seconds - a.total_duration_seconds)
    .slice(0, 20);

  const topDurationSongs = [...allSongs]
    .filter(s => s.total_duration_seconds > 0)
    .sort((a, b) => b.total_duration_seconds - a.total_duration_seconds)
    .slice(0, 20);

  const artistMap = new Map<string, { artist: string; play_count: number; total_duration_seconds: number }>();
  for (const s of allSongs) {
    const primaryArtist = (s.artist || '').split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0]?.trim() || '';
    const low = primaryArtist.toLowerCase();
    if (!primaryArtist || low === 'unknown artist' || low === 'rated track') continue;
    let entry = artistMap.get(low);
    if (!entry) {
      entry = { artist: primaryArtist, play_count: 0, total_duration_seconds: 0 };
      artistMap.set(low, entry);
    }
    entry.play_count += s.play_count;
    entry.total_duration_seconds += s.total_duration_seconds;
  }

  const topArtists: AggregatedArtistStat[] = Array.from(artistMap.values())
    .filter(a => a.play_count > 0 || a.total_duration_seconds > 0)
    .sort((a, b) => b.play_count - a.play_count || b.total_duration_seconds - a.total_duration_seconds)
    .slice(0, 20)
    .map(a => ({
      ...a,
      total_duration_formatted: formatListeningDuration(a.total_duration_seconds)
    }));

  const completionRate = totalPlays > 0 ? Math.min(100, Math.round((qualifiedPlays / totalPlays) * 100)) : 0;

  return {
    summary: {
      total_plays: totalPlays,
      qualified_plays: qualifiedPlays,
      total_listening_duration_seconds: Math.round(totalDurationSec),
      total_listening_duration_formatted: formatListeningDuration(totalDurationSec),
      completion_rate_percent: completionRate
    },
    top_songs: topSongs,
    top_artists: topArtists,
    top_duration_songs: topDurationSongs
  };
}
