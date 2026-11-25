/**
 * Pure logic helpers for Lumen "Guess the Song" (30-second clip challenge).
 */

export const MAX_GUESS_CLIP_SECONDS = 30;

export function clampClipWindow(
  rawStartSec: number,
  trackDurationSec: number,
  requestedDurationSec: number = MAX_GUESS_CLIP_SECONDS
): { clipStartSec: number; clipDurationSec: number; clipEndSec: number } {
  const safeTrackDur = Number.isFinite(trackDurationSec) && trackDurationSec > 5 ? Math.floor(trackDurationSec) : 180;
  const clipDurationSec = Math.max(5, Math.min(MAX_GUESS_CLIP_SECONDS, Math.floor(requestedDurationSec || MAX_GUESS_CLIP_SECONDS), safeTrackDur));
  const maxStart = Math.max(0, safeTrackDur - clipDurationSec);
  const clipStartSec = Math.max(0, Math.min(maxStart, Math.floor(Number.isFinite(rawStartSec) ? rawStartSec : 0)));
  return {
    clipStartSec,
    clipDurationSec,
    clipEndSec: clipStartSec + clipDurationSec
  };
}

export function normalizeSongText(input?: string | null): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|with|remastered|deluxe|original|anniversary|live|explicit|mono|stereo|bonus|radio edit|version)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:remastered|deluxe|radio edit|single version|album version|original|live|mono|stereo).*$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forgiving song-guess matcher:
 * Ignores "(feat. ...)", "(Remastered)", punctuation, and capitalization.
 * Matches if track IDs match OR cleaned titles match with overlapping primary artist.
 */
export function isSongGuessCorrect(
  target: { id?: string; title?: string; artist?: string },
  guessed: { id?: string; title?: string; artist?: string }
): boolean {
  if (!target || !guessed) return false;
  if (target.id && guessed.id && String(target.id) === String(guessed.id)) {
    return true;
  }

  const targetTitle = normalizeSongText(target.title);
  const guessedTitle = normalizeSongText(guessed.title);
  if (!targetTitle || !guessedTitle) return false;

  const titleMatches =
    targetTitle === guessedTitle ||
    (targetTitle.length >= 6 && (targetTitle.includes(guessedTitle) || guessedTitle.includes(targetTitle)) &&
      Math.min(targetTitle.length, guessedTitle.length) / Math.max(targetTitle.length, guessedTitle.length) >= 0.78);

  if (!titleMatches) return false;

  const targetArtist = normalizeSongText(target.artist);
  const guessedArtist = normalizeSongText(guessed.artist);
  if (!targetArtist || !guessedArtist) return true;
  if (targetArtist === guessedArtist || targetArtist.includes(guessedArtist) || guessedArtist.includes(targetArtist)) {
    return true;
  }

  const tTokens = targetArtist.split(' ').filter((w) => w.length > 2 && w !== 'the' && w !== 'and');
  const gTokens = new Set(guessedArtist.split(' ').filter((w) => w.length > 2 && w !== 'the' && w !== 'and'));
  return tTokens.some((tok) => gTokens.has(tok));
}

export function formatClipTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}
