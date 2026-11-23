import type { Track } from '../types/music';

export type VoiceVersionHint = 'studio' | 'live' | 'acoustic' | 'remix' | 'instrumental' | null;

export interface VoiceTrackQuery {
  title: string;
  artist: string | null;
  rawQuery: string;
  versionHint: VoiceVersionHint;
}

export type VoiceClarifyChoice = 'studio' | 'live' | 'acoustic' | 'remix' | 'first' | 'second';

export type VoiceAction =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'previous' }
  | { type: 'cancel' }
  | { type: 'play'; query: VoiceTrackQuery }
  | { type: 'play_next'; query: VoiceTrackQuery }
  | { type: 'add_to_queue'; query: VoiceTrackQuery }
  | { type: 'clarify_choice'; choice: VoiceClarifyChoice };

export interface ParsedVoiceUtterance {
  rawText: string;
  cleanedText: string;
  wakeDetected: boolean;
  actions: VoiceAction[];
  unrecognizedText: string | null;
}

export interface RankedTrackResult {
  best: Track | null;
  ambiguousPair: [Track, Track] | null;
  ambiguousLabels: [string, string] | null;
  confidence: number;
}

// Phonetic tolerances for local speech engines mishearing "Hey Lumen"
const WAKE_PHRASE_REGEX = /^(?:hey|ok|okay|hi)\s+(?:lumen|loomen|lumin|lumina|luman|human)(?:[,:.\s-]+|$)/i;
const BARE_WAKE_REGEX = /^lumen(?:[,:.\s-]+|$)/i;

// Action verbs allowed to start a new clause after "and" / "then"
const COMPOUND_SPLIT_REGEX = /\s+(?:and\s+then|and|then)\s+(?=(?:pause|stop|resume|unpause|continue|keep\s+playing|skip|next|previous|go\s+back|last\s+song|play|add|put|queue|cancel|never\s*mind|forget\s+it)\b)/gi;

export function normalizeVoiceText(text: string): string {
  return (text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[!?.,;:]+$/g, '')
    .replace(/[?!,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeForMatching(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectVersionTag(text: string): VoiceVersionHint {
  const lower = (text || '').toLowerCase();
  if (/\b(?:live(?:\s+at|\s+from|\s+version|\s+performance|\s+in)?|\(live\)|\[live\])\b/.test(lower)) {
    return 'live';
  }
  if (/\b(?:acoustic(?:\s+version)?|unplugged)\b/.test(lower)) {
    return 'acoustic';
  }
  if (/\b(?:remix|club\s+mix|vip\s+mix|radio\s+edit)\b/.test(lower)) {
    return 'remix';
  }
  if (/\b(?:instrumental|karaoke)\b/.test(lower)) {
    return 'instrumental';
  }
  if (/\b(?:studio(?:\s+version)?|original(?:\s+version)?|album\s+version)\b/.test(lower)) {
    return 'studio';
  }
  return null;
}

function stripVersionPhrases(text: string): { cleaned: string; hint: VoiceVersionHint } {
  const hint = detectVersionTag(text);
  const cleaned = text
    .replace(/\b(?:the\s+)?(?:studio|original|album|live|acoustic|unplugged|remix|instrumental)\s+version\b/gi, '')
    .replace(/\s*\((?:live|acoustic|remix|studio|original|instrumental)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { cleaned: cleaned || text.trim(), hint };
}

/**
 * Splits "<song> by <artist>" using the LAST " by " boundary so song titles
 * containing "by" (e.g., "Stand by Me by Ben E. King") parse accurately.
 */
export function extractSongAndArtist(rawClause: string): VoiceTrackQuery {
  const rawQuery = rawClause.trim();
  const { cleaned, hint } = stripVersionPhrases(rawQuery);

  const byMatches = [...cleaned.matchAll(/\s+by\s+/gi)];
  if (byMatches.length > 0) {
    const lastMatch = byMatches[byMatches.length - 1];
    const splitIdx = lastMatch.index ?? -1;
    if (splitIdx > 0) {
      const titlePart = cleaned.slice(0, splitIdx).trim();
      const artistPart = cleaned.slice(splitIdx + lastMatch[0].length).trim();
      if (titlePart && artistPart) {
        return {
          title: titlePart,
          artist: artistPart,
          rawQuery,
          versionHint: hint
        };
      }
    }
  }

  return {
    title: cleaned,
    artist: null,
    rawQuery,
    versionHint: hint
  };
}

function parseClarifyChoice(clause: string): VoiceClarifyChoice | null {
  const c = clause.toLowerCase().trim();
  if (/^(?:the\s+)?(?:studio|original|album)(?:\s+(?:version|one|track))?$/.test(c)) return 'studio';
  if (/^(?:the\s+)?live(?:\s+(?:version|one|track))?$/.test(c)) return 'live';
  if (/^(?:the\s+)?acoustic(?:\s+(?:version|one|track))?$/.test(c)) return 'acoustic';
  if (/^(?:the\s+)?remix(?:\s+(?:version|one|track))?$/.test(c)) return 'remix';
  if (/^(?:the\s+)?(?:first|1st|number\s+one|option\s+one|one)(?:\s+one)?$/.test(c)) return 'first';
  if (/^(?:the\s+)?(?:second|2nd|number\s+two|option\s+two|two)(?:\s+one)?$/.test(c)) return 'second';
  return null;
}

function parseSingleClause(clause: string, expectClarification: boolean): VoiceAction | null {
  const trimmed = clause.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // Cancel / stop listening
  if (/^(?:cancel|never\s*mind|forget\s+it|stop\s+listening|dismiss|abort)$/.test(lower)) {
    return { type: 'cancel' };
  }

  // Clarification responses (when actively waiting for user's follow-up choice)
  if (expectClarification) {
    const choice = parseClarifyChoice(trimmed);
    if (choice) return { type: 'clarify_choice', choice };
  }

  // Pause
  if (/^(?:pause|stop)(?:\s+(?:this|the|my|current))?(?:\s+(?:song|track|music|playback|audio))?$/.test(lower)) {
    return { type: 'pause' };
  }

  // Resume / keep playing
  if (/^(?:resume|unpause|continue|keep\s+playing|play)(?:\s+(?:this|the|my|current))?(?:\s+(?:song|track|music|playback|audio))?$/.test(lower)) {
    return { type: 'resume' };
  }

  // Skip / next
  if (/^(?:skip|next|play\s+next|skip\s+to\s+next)(?:\s+(?:this|the))?(?:\s+(?:song|track))?$/.test(lower)) {
    return { type: 'skip' };
  }

  // Previous
  if (/^(?:previous|prev|go\s+back|last)(?:\s+(?:song|track))?$/.test(lower)) {
    return { type: 'previous' };
  }

  // Add to queue: "add <song> [by <artist>] to [my|the] queue" or "queue <song>"
  const addQueueMatch = trimmed.match(/^(?:add|put)\s+(.+?)\s+(?:to|into|in|on)\s+(?:my\s+|the\s+)?queue$/i);
  if (addQueueMatch && addQueueMatch[1].trim()) {
    return { type: 'add_to_queue', query: extractSongAndArtist(addQueueMatch[1]) };
  }

  // Play next: "play <song> next" / "put <song> next" / "queue <song> next" / "add <song> to play next"
  const playNextMatch =
    trimmed.match(/^(?:play|put|queue|add)\s+(.+?)\s+(?:up\s+next|next|to\s+play\s+next)$/i) ||
    trimmed.match(/^play\s+next\s+(.+)$/i);
  if (playNextMatch && playNextMatch[1].trim()) {
    return { type: 'play_next', query: extractSongAndArtist(playNextMatch[1]) };
  }

  // Bare "queue <song>"
  const bareQueueMatch = trimmed.match(/^queue\s+(.+)$/i);
  if (bareQueueMatch && bareQueueMatch[1].trim()) {
    return { type: 'add_to_queue', query: extractSongAndArtist(bareQueueMatch[1]) };
  }

  // Play <song> [by <artist>]
  const playMatch = trimmed.match(/^play\s+(.+)$/i);
  if (playMatch && playMatch[1].trim()) {
    return { type: 'play', query: extractSongAndArtist(playMatch[1]) };
  }

  // Standalone clarification fallback even if caller didn't pass flag
  const fallbackChoice = parseClarifyChoice(trimmed);
  if (fallbackChoice) {
    return { type: 'clarify_choice', choice: fallbackChoice };
  }

  return null;
}

export function parseVoiceUtterance(
  rawText: string,
  options: { expectClarification?: boolean; requireWakePhrase?: boolean } = {}
): ParsedVoiceUtterance {
  const normalized = normalizeVoiceText(rawText);
  if (!normalized) {
    return {
      rawText,
      cleanedText: '',
      wakeDetected: false,
      actions: [],
      unrecognizedText: null
    };
  }

  let wakeDetected = false;
  let commandBody = normalized;

  const wakeMatch = commandBody.match(WAKE_PHRASE_REGEX);
  if (wakeMatch) {
    wakeDetected = true;
    commandBody = commandBody.slice(wakeMatch[0].length).trim();
  } else {
    const bareMatch = commandBody.match(BARE_WAKE_REGEX);
    if (bareMatch) {
      wakeDetected = true;
      commandBody = commandBody.slice(bareMatch[0].length).trim();
    }
  }

  if (options.requireWakePhrase && !wakeDetected) {
    return {
      rawText,
      cleanedText: normalized,
      wakeDetected: false,
      actions: [],
      unrecognizedText: null
    };
  }

  // Wake phrase alone (e.g., "Hey Lumen")
  if (!commandBody) {
    return {
      rawText,
      cleanedText: '',
      wakeDetected,
      actions: [],
      unrecognizedText: null
    };
  }

  // Strip polite prefixes like "please" or "can you"
  commandBody = commandBody
    .replace(/^(?:please|can\s+you|could\s+you|would\s+you)\s+/i, '')
    .replace(/\s+please$/i, '')
    .trim();

  // Split compound utterances ONLY at explicit action boundaries
  const rawClauses = commandBody
    .split(COMPOUND_SPLIT_REGEX)
    .map(c => c.replace(/^(?:please|can\s+you)\s+/i, '').trim())
    .filter(Boolean);

  const actions: VoiceAction[] = [];
  const unrecognized: string[] = [];

  for (const clause of rawClauses) {
    const parsed = parseSingleClause(clause, Boolean(options.expectClarification));
    if (parsed) {
      actions.push(parsed);
    } else {
      unrecognized.push(clause);
    }
  }

  return {
    rawText,
    cleanedText: commandBody,
    wakeDetected,
    actions,
    unrecognizedText: unrecognized.length > 0 ? unrecognized.join(' ') : null
  };
}

/**
 * Deduplicates repeated final-result callbacks from Android SpeechRecognizer
 * for the same utterance while allowing deliberate user repeats in new utterances.
 */
export class UtteranceDeduplicator {
  private lastUtteranceId: string | null = null;
  private lastNormalizedText: string = '';
  private lastAcceptedAtMs: number = 0;
  private readonly windowMs: number;

  constructor(windowMs = 2200) {
    this.windowMs = windowMs;
  }

  shouldIgnore(text: string, nowMs: number = Date.now(), utteranceId?: string | null): boolean {
    const norm = normalizeForMatching(text);
    if (!norm) return true;

    if (utteranceId && this.lastUtteranceId && utteranceId === this.lastUtteranceId) {
      return true;
    }

    if (norm === this.lastNormalizedText && nowMs - this.lastAcceptedAtMs < this.windowMs) {
      return true;
    }

    this.lastUtteranceId = utteranceId ?? null;
    this.lastNormalizedText = norm;
    this.lastAcceptedAtMs = nowMs;
    return false;
  }

  reset(): void {
    this.lastUtteranceId = null;
    this.lastNormalizedText = '';
    this.lastAcceptedAtMs = 0;
  }
}

function tokenOverlapScore(queryNorm: string, candidateNorm: string): number {
  if (!queryNorm || !candidateNorm) return 0;
  if (queryNorm === candidateNorm) return 1.0;
  if (candidateNorm.startsWith(queryNorm)) return 0.92;
  if (candidateNorm.includes(queryNorm)) return 0.84;

  const qTokens = queryNorm.split(' ').filter(Boolean);
  const cTokens = new Set(candidateNorm.split(' ').filter(Boolean));
  if (qTokens.length === 0) return 0;
  let hits = 0;
  for (const tok of qTokens) {
    if (cTokens.has(tok)) hits += 1;
  }
  return hits / qTokens.length;
}

function stripParentheticalVersion(title: string): string {
  return title
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s+-\s+(?:live|acoustic|remix|remaster|radio edit|single|album|studio).*$/i, '')
    .trim();
}

function classifyTrackVersion(track: Track): 'studio' | 'live' | 'acoustic' | 'remix' | 'instrumental' {
  const combined = `${track.title || ''} ${track.album || ''}`;
  const tag = detectVersionTag(combined);
  if (tag === 'live') return 'live';
  if (tag === 'acoustic') return 'acoustic';
  if (tag === 'remix') return 'remix';
  if (tag === 'instrumental') return 'instrumental';
  return 'studio';
}

/**
 * Ranks local/online candidates for a spoken song query.
 * Detects studio-vs-live/acoustic/remix ties when the user didn't specify a version,
 * returning an ambiguousPair so the controller can ask a brief spoken follow-up.
 */
export function rankVoiceTrackMatches(
  query: VoiceTrackQuery,
  candidates: Track[],
  localTrackIds: Set<string> = new Set()
): RankedTrackResult {
  if (!candidates || candidates.length === 0) {
    return { best: null, ambiguousPair: null, ambiguousLabels: null, confidence: 0 };
  }

  const qTitleNorm = normalizeForMatching(query.title);
  const qArtistNorm = query.artist ? normalizeForMatching(query.artist) : '';

  const scored = candidates.map((track) => {
    const rawTitleNorm = normalizeForMatching(track.title || '');
    const baseTitleNorm = normalizeForMatching(stripParentheticalVersion(track.title || ''));
    const artistNorm = normalizeForMatching(track.artist || '');
    const version = classifyTrackVersion(track);

    const titleScore = Math.max(
      tokenOverlapScore(qTitleNorm, rawTitleNorm),
      tokenOverlapScore(qTitleNorm, baseTitleNorm) * 0.98
    );

    let artistScore = 0.65; // neutral when user didn't speak an artist
    if (qArtistNorm) {
      artistScore = tokenOverlapScore(qArtistNorm, artistNorm);
    }

    let versionBonus = 0;
    if (query.versionHint) {
      versionBonus = version === query.versionHint ? 0.35 : -0.25;
    } else if (version === 'studio') {
      versionBonus = 0.04;
    }

    const localBonus = localTrackIds.has(track.id) ? 0.05 : 0;

    // Penalize unrelated artists heavily if user explicitly named an artist
    const artistPenalty = qArtistNorm && artistScore < 0.35 ? -0.45 : 0;

    const total = titleScore * 0.62 + artistScore * 0.33 + versionBonus + localBonus + artistPenalty;
    return { track, score: total, titleScore, artistScore, version, baseTitleNorm };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score < 0.48 || top.titleScore < 0.45) {
    return { best: null, ambiguousPair: null, ambiguousLabels: null, confidence: top ? top.score : 0 };
  }

  // Check for close studio vs live/acoustic/remix ambiguity when user did NOT specify a version
  if (!query.versionHint && scored.length >= 2) {
    const second = scored[1];
    const sameSong =
      top.baseTitleNorm === second.baseTitleNorm &&
      normalizeForMatching(top.track.artist || '') === normalizeForMatching(second.track.artist || '');
    const differentVersion = top.version !== second.version;
    const scoreClose = top.score - second.score <= 0.12 && second.titleScore >= 0.85;

    if (sameSong && differentVersion && scoreClose) {
      // Order studio first when present so prompt reads naturally: "the studio version or the live version?"
      const pair: [typeof top, typeof second] =
        second.version === 'studio' ? [second, top] : [top, second];
      const labelFor = (v: string) =>
        v === 'studio' ? 'studio' : v === 'live' ? 'live' : v === 'acoustic' ? 'acoustic' : v;
      return {
        best: pair[0].track,
        ambiguousPair: [pair[0].track, pair[1].track],
        ambiguousLabels: [labelFor(pair[0].version), labelFor(pair[1].version)],
        confidence: top.score
      };
    }
  }

  return {
    best: top.track,
    ambiguousPair: null,
    ambiguousLabels: null,
    confidence: top.score
  };
}

export type VoiceUiMode =
  | 'disabled'
  | 'waiting_wake'
  | 'listening'
  | 'processing'
  | 'clarifying'
  | 'feedback'
  | 'error';

export interface VoiceControllerSnapshot {
  enabled: boolean;
  mode: VoiceUiMode;
  statusLabel: string;
  feedbackText: string | null;
  clarificationPrompt: string | null;
  errorText: string | null;
}

export interface VoicePlaybackAdapter {
  pause(): void;
  resume(): void;
  skip(): void;
  previous(): void;
  playTrack(track: Track): void;
  playNext(track: Track): void;
  addToQueue(track: Track): void;
  isPlaying(): boolean;
  getLocalLibraryTracks(): Track[];
  searchCatalog(query: string): Promise<Track[]>;
  isOnline(): boolean;
  speak(text: string, expectFollowUp?: boolean): Promise<void>;
  beginFollowUpCapture?(timeoutMs?: number): Promise<void>;
}

interface PendingClarification {
  actionType: 'play' | 'play_next' | 'add_to_queue';
  options: [Track, Track];
  labels: [string, string];
  expiresAtMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const STALE_UTTERANCE_MS = 15000;
const CLARIFICATION_TIMEOUT_MS = 10000;
const FEEDBACK_DISPLAY_MS = 3500;
const VOICE_ENABLED_STORAGE_KEY = 'lumen_hands_free_voice_enabled_v1';
const VOICE_DISCLOSURE_ACCEPTED_KEY = 'lumen_voice_disclosure_accepted_v1';

export class VoiceCommandEngine {
  private readonly adapter: VoicePlaybackAdapter;
  private readonly deduper = new UtteranceDeduplicator(2200);
  private pendingClarification: PendingClarification | null = null;
  private lookupGeneration = 0;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(snap: VoiceControllerSnapshot) => void>();

  private state: VoiceControllerSnapshot = {
    enabled: false,
    mode: 'disabled',
    statusLabel: 'Off',
    feedbackText: null,
    clarificationPrompt: null,
    errorText: null
  };

  constructor(adapter: VoicePlaybackAdapter) {
    this.adapter = adapter;
  }

  getSnapshot(): VoiceControllerSnapshot {
    return { ...this.state };
  }

  subscribe(listener: (snap: VoiceControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(partial: Partial<VoiceControllerSnapshot>): void {
    this.state = { ...this.state, ...partial };
    const snap = this.getSnapshot();
    this.listeners.forEach(fn => {
      try {
        fn(snap);
      } catch {
        // ignore subscriber errors
      }
    });
  }

  setNativeState(
    nativeState: 'stopped' | 'waiting_wake' | 'listening' | 'processing' | 'speaking' | 'error',
    message?: string
  ): void {
    if (nativeState === 'stopped') {
      this.clearClarification();
      this.emit({
        enabled: false,
        mode: 'disabled',
        statusLabel: 'Off',
        feedbackText: null,
        clarificationPrompt: null,
        errorText: null
      });
      return;
    }

    if (nativeState === 'error') {
      this.emit({
        mode: 'error',
        statusLabel: 'Voice unavailable',
        errorText: message || 'Microphone engine error'
      });
      return;
    }

    if (nativeState === 'listening') {
      this.emit({
        enabled: true,
        mode: this.pendingClarification ? 'clarifying' : 'listening',
        statusLabel: this.pendingClarification ? 'Listening for choice...' : 'Listening...',
        errorText: null
      });
      return;
    }

    if (nativeState === 'processing') {
      this.emit({
        enabled: true,
        mode: 'processing',
        statusLabel: 'Processing...',
        errorText: null
      });
      return;
    }

    if (nativeState === 'waiting_wake') {
      this.emit({
        enabled: true,
        mode: this.pendingClarification ? 'clarifying' : 'waiting_wake',
        statusLabel: this.pendingClarification ? 'Waiting for choice...' : 'Waiting for "Hey Lumen"',
        errorText: null
      });
    }
  }

  private showFeedback(text: string): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.emit({
      mode: 'feedback',
      statusLabel: text,
      feedbackText: text,
      errorText: null
    });
    this.feedbackTimer = setTimeout(() => {
      if (this.state.enabled && !this.pendingClarification) {
        this.emit({
          mode: 'waiting_wake',
          statusLabel: 'Waiting for "Hey Lumen"',
          feedbackText: null
        });
      }
    }, FEEDBACK_DISPLAY_MS);
  }

  clearClarification(): void {
    if (this.pendingClarification?.timer) {
      clearTimeout(this.pendingClarification.timer);
    }
    this.pendingClarification = null;
    if (this.state.clarificationPrompt) {
      this.emit({ clarificationPrompt: null });
    }
  }

  cancelActiveLookup(): void {
    this.lookupGeneration += 1;
    this.clearClarification();
  }

  async handleTranscript(input: {
    text: string;
    utteranceId?: string;
    timestampMs?: number;
    handledNatively?: boolean;
    nativeAction?: string;
    nowMs?: number;
  }): Promise<{ executedActions: string[]; spokenFeedback: string | null }> {
    const nowMs = input.nowMs ?? Date.now();

    if (input.timestampMs && nowMs - input.timestampMs > STALE_UTTERANCE_MS) {
      return { executedActions: [], spokenFeedback: null };
    }

    if (this.deduper.shouldIgnore(input.text, nowMs, input.utteranceId)) {
      return { executedActions: [], spokenFeedback: null };
    }

    const hasActiveClarification = Boolean(
      this.pendingClarification && nowMs <= this.pendingClarification.expiresAtMs
    );
    if (this.pendingClarification && !hasActiveClarification) {
      this.clearClarification();
    }

    const parsed = parseVoiceUtterance(input.text, {
      expectClarification: hasActiveClarification
    });

    if (parsed.actions.length === 0) {
      if (parsed.wakeDetected && !parsed.cleanedText) {
        this.emit({
          enabled: true,
          mode: 'listening',
          statusLabel: 'Listening...'
        });
        return { executedActions: ['wake'], spokenFeedback: null };
      }

      if (hasActiveClarification) {
        this.clearClarification();
      }
      const msg = "Didn't catch that command.";
      this.showFeedback(msg);
      await this.adapter.speak(msg, false);
      return { executedActions: [], spokenFeedback: msg };
    }

    const executedActions: string[] = [];
    const feedbackParts: string[] = [];

    if (parsed.actions.some(a => a.type === 'cancel')) {
      this.cancelActiveLookup();
      const msg = 'Canceled.';
      this.showFeedback(msg);
      await this.adapter.speak(msg, false);
      return { executedActions: ['cancel'], spokenFeedback: msg };
    }

    const clarifyAction = parsed.actions.find(
      (a): a is Extract<VoiceAction, { type: 'clarify_choice' }> => a.type === 'clarify_choice'
    );
    if (clarifyAction && this.pendingClarification) {
      return this.resolveClarification(clarifyAction.choice);
    }

    if (this.pendingClarification) {
      this.clearClarification();
    }

    const transportActions = parsed.actions.filter(
      a => a.type === 'pause' || a.type === 'resume' || a.type === 'skip' || a.type === 'previous'
    );
    const catalogActions = parsed.actions.filter(
      (a): a is Extract<VoiceAction, { type: 'play' | 'play_next' | 'add_to_queue' }> =>
        a.type === 'play' || a.type === 'play_next' || a.type === 'add_to_queue'
    );

    for (const action of transportActions) {
      const alreadyHandledNatively =
        Boolean(input.handledNatively) && input.nativeAction === action.type;

      if (action.type === 'pause') {
        if (!alreadyHandledNatively) this.adapter.pause();
        executedActions.push('pause');
        feedbackParts.push('Paused.');
      } else if (action.type === 'resume') {
        if (!alreadyHandledNatively) this.adapter.resume();
        executedActions.push('resume');
        feedbackParts.push('Resuming.');
      } else if (action.type === 'skip') {
        if (!alreadyHandledNatively) this.adapter.skip();
        executedActions.push('skip');
        feedbackParts.push('Skipped.');
      } else if (action.type === 'previous') {
        if (!alreadyHandledNatively) this.adapter.previous();
        executedActions.push('previous');
        feedbackParts.push('Previous song.');
      }
    }

    if (catalogActions.length > 0) {
      const myGen = ++this.lookupGeneration;
      this.emit({
        enabled: true,
        mode: 'processing',
        statusLabel: 'Searching...'
      });

      for (const action of catalogActions) {
        const lookupResult = await this.resolveTrackForQuery(action.query);

        if (myGen !== this.lookupGeneration) {
          return { executedActions, spokenFeedback: null };
        }

        if (lookupResult.offlineMiss) {
          feedbackParts.push("You're offline and I couldn't find that song in your library.");
          continue;
        }

        if (lookupResult.ambiguousPair && lookupResult.ambiguousLabels) {
          const [labelA, labelB] = lookupResult.ambiguousLabels;
          const prompt = `Do you want the ${labelA} version or the ${labelB} version?`;
          const combinedSpeech =
            feedbackParts.length > 0 ? `${feedbackParts.join(' ')} ${prompt}` : prompt;

          const timer = setTimeout(() => {
            this.clearClarification();
            if (this.state.enabled) {
              this.emit({
                mode: 'waiting_wake',
                statusLabel: 'Waiting for "Hey Lumen"'
              });
            }
          }, CLARIFICATION_TIMEOUT_MS);

          this.pendingClarification = {
            actionType: action.type,
            options: lookupResult.ambiguousPair,
            labels: lookupResult.ambiguousLabels,
            expiresAtMs: Date.now() + CLARIFICATION_TIMEOUT_MS,
            timer
          };

          this.emit({
            enabled: true,
            mode: 'clarifying',
            statusLabel: prompt,
            clarificationPrompt: prompt
          });

          await this.adapter.speak(combinedSpeech, true);
          await this.adapter.beginFollowUpCapture?.(CLARIFICATION_TIMEOUT_MS);
          return { executedActions, spokenFeedback: combinedSpeech };
        }

        if (!lookupResult.best) {
          feedbackParts.push("I couldn't find that song.");
          continue;
        }

        const track = lookupResult.best;
        const msg = this.applyTrackAction(action.type, track);
        executedActions.push(`${action.type}:${track.id}`);
        feedbackParts.push(msg);
      }
    }

    const spokenFeedback = feedbackParts.length > 0 ? feedbackParts.join(' ') : null;
    if (spokenFeedback) {
      this.showFeedback(spokenFeedback);
      await this.adapter.speak(spokenFeedback, false);
    }

    return { executedActions, spokenFeedback };
  }

  private applyTrackAction(actionType: 'play' | 'play_next' | 'add_to_queue', track: Track): string {
    if (actionType === 'play') {
      this.adapter.playTrack(track);
      return `Playing ${track.title} by ${track.artist}.`;
    }
    if (actionType === 'play_next') {
      this.adapter.playNext(track);
      return `Playing ${track.title} next.`;
    }
    this.adapter.addToQueue(track);
    return `Added ${track.title} by ${track.artist} to your queue.`;
  }

  private async resolveClarification(
    choice: VoiceClarifyChoice
  ): Promise<{ executedActions: string[]; spokenFeedback: string | null }> {
    const pending = this.pendingClarification;
    if (!pending) {
      return { executedActions: [], spokenFeedback: null };
    }

    const [optA, optB] = pending.options;
    const [labelA, labelB] = pending.labels;
    let chosen: Track | null = null;

    if (choice === 'first' || choice === labelA) {
      chosen = optA;
    } else if (choice === 'second' || choice === labelB) {
      chosen = optB;
    } else {
      const matchA = `${optA.title} ${optA.album || ''}`.toLowerCase().includes(choice);
      const matchB = `${optB.title} ${optB.album || ''}`.toLowerCase().includes(choice);
      if (matchA && !matchB) chosen = optA;
      else if (matchB && !matchA) chosen = optB;
    }

    this.clearClarification();

    if (!chosen) {
      const msg = 'Canceled.';
      this.showFeedback(msg);
      await this.adapter.speak(msg, false);
      return { executedActions: ['cancel'], spokenFeedback: msg };
    }

    const msg = this.applyTrackAction(pending.actionType, chosen);
    this.showFeedback(msg);
    await this.adapter.speak(msg, false);
    return { executedActions: [`${pending.actionType}:${chosen.id}`], spokenFeedback: msg };
  }

  private async resolveTrackForQuery(query: VoiceTrackQuery): Promise<{
    best: Track | null;
    ambiguousPair: [Track, Track] | null;
    ambiguousLabels: [string, string] | null;
    offlineMiss: boolean;
  }> {
    const localTracks = this.adapter.getLocalLibraryTracks();
    const localIds = new Set(localTracks.map(t => t.id));
    const localRanked = rankVoiceTrackMatches(query, localTracks, localIds);

    if (localRanked.ambiguousPair) {
      return {
        best: localRanked.best,
        ambiguousPair: localRanked.ambiguousPair,
        ambiguousLabels: localRanked.ambiguousLabels,
        offlineMiss: false
      };
    }
    if (localRanked.best && localRanked.confidence >= 0.86) {
      return {
        best: localRanked.best,
        ambiguousPair: null,
        ambiguousLabels: null,
        offlineMiss: false
      };
    }

    if (!this.adapter.isOnline()) {
      return {
        best: localRanked.best,
        ambiguousPair: null,
        ambiguousLabels: null,
        offlineMiss: !localRanked.best
      };
    }

    const searchString = query.artist ? `${query.title} ${query.artist}` : query.title;
    let onlineTracks: Track[] = [];
    try {
      onlineTracks = await this.adapter.searchCatalog(searchString);
    } catch {
      onlineTracks = [];
    }

    const seen = new Set<string>();
    const combined: Track[] = [];
    for (const t of [...localTracks, ...onlineTracks]) {
      const key = t.id || `${t.title.toLowerCase()}::${t.artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(t);
      }
    }

    const ranked = rankVoiceTrackMatches(query, combined, localIds);
    return {
      best: ranked.best,
      ambiguousPair: ranked.ambiguousPair,
      ambiguousLabels: ranked.ambiguousLabels,
      offlineMiss: false
    };
  }
}

export class VoiceStorage {
  static isEnabled(): boolean {
    try {
      return localStorage.getItem(VOICE_ENABLED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  static setEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(VOICE_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // ignore
    }
  }

  static hasAcceptedDisclosure(): boolean {
    try {
      return localStorage.getItem(VOICE_DISCLOSURE_ACCEPTED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  static setDisclosureAccepted(accepted: boolean): void {
    try {
      localStorage.setItem(VOICE_DISCLOSURE_ACCEPTED_KEY, accepted ? 'true' : 'false');
    } catch {
      // ignore
    }
  }
}
