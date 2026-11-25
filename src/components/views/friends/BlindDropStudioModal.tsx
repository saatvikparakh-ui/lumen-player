import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  HelpCircle,
  Sparkles,
  Play,
  Pause,
  Check,
  Send,
  Search,
  Users,
  Clock,
  Disc3,
  Trash2,
  Lightbulb,
  CheckCircle2,
  XCircle,
  Loader2,
  Music2,
  RotateCcw,
  Scissors
} from 'lucide-react';
import { Track } from '../../../types/music';
import { AppUser } from '../../../services/firebaseAuthService';
import { FriendProfileData } from './friendsTypes';
import { BlindDropRound, BlindDropSubmission } from '../../../types/blindDropTypes';
import { BlindDropService } from '../../../services/blindDropService';
import { StreamingService } from '../../../services/streamingService';
import { PlaybackResolver } from '../../../services/playbackAdapter';
import { resolveApiUrl } from '../../../services/apiConfig';
import { AudioEngine } from '../../../services/audioEngine';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';
import {
  clampClipWindow,
  formatClipTimestamp,
  MAX_GUESS_CLIP_SECONDS
} from '../../../services/guessSongLogic';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  friends: FriendProfileData[];
  onPlayTrack: (track: Track) => void;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  dominantColor: string;
}

export const BlindDropStudioModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentUser,
  friends,
  onPlayTrack,
  dominantColor
}) => {
  const [activeTab, setActiveTab] = useState<'inbox' | 'send' | 'circle'>('inbox');
  const [rounds, setRounds] = useState<BlindDropRound[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [activeSubIdx, setActiveSubIdx] = useState(0);

  // Isolated 30-second sample audio player (NEVER touches main AudioEngine / MediaSession / notification!)
  const clipAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingClipKey, setPlayingClipKey] = useState<string | null>(null);
  const [loadingClipKey, setLoadingClipKey] = useState<string | null>(null);
  const [clipElapsedSec, setClipElapsedSec] = useState(0);
  const [clipTotalSec, setClipTotalSec] = useState(MAX_GUESS_CLIP_SECONDS);
  const activeClipBoundsRef = useRef<{ start: number; end: number }>({ start: 0, end: MAX_GUESS_CLIP_SECONDS });

  // Compose (Send Challenge / Circle Submit) State
  const [selectedFriend, setSelectedFriend] = useState<FriendProfileData | null>(null);
  const [selectedCircleFriends, setSelectedCircleFriends] = useState<Set<string>>(new Set());
  const [circleTitle, setCircleTitle] = useState('');
  const [clueText, setClueText] = useState('');
  const [composeSearchQuery, setComposeSearchQuery] = useState('');
  const [composeSearchResults, setComposeSearchResults] = useState<Track[]>([]);
  const [isComposeSearching, setIsComposeSearching] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [clipStartSec, setClipStartSec] = useState(30);
  const [resolvedComposeUrl, setResolvedComposeUrl] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [circleTargetRoundId, setCircleTargetRoundId] = useState<string | null>(null);

  // Receiver Guess Search State (uses main Lumen search algorithm!)
  const [guessSearchQuery, setGuessSearchQuery] = useState('');
  const [guessSearchResults, setGuessSearchResults] = useState<Track[]>([]);
  const [isGuessSearching, setIsGuessSearching] = useState(false);
  const [selectedGuessTrack, setSelectedGuessTrack] = useState<Track | null>(null);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  const stopClipAudio = () => {
    if (clipAudioRef.current) {
      try {
        clipAudioRef.current.pause();
      } catch (_) {}
    }
    setPlayingClipKey(null);
    setLoadingClipKey(null);
    setClipElapsedSec(0);
  };

  // Cleanup clip audio on unmount or modal close
  useEffect(() => {
    if (!isOpen) {
      stopClipAudio();
    }
    return () => {
      stopClipAudio();
    };
  }, [isOpen]);

  // Subscribe to realtime Guess the Song rounds
  useEffect(() => {
    if (!isOpen || !currentUser) return;
    const unsub = BlindDropService.subscribeToUserDrops(currentUser.uid, (updated) => {
      setRounds(updated);
      setSelectedRoundId((prev) => {
        if (prev && updated.some((r) => r.id === prev)) return prev;
        return updated[0]?.id || null;
      });
    });
    return () => unsub();
  }, [isOpen, currentUser?.uid]);

  // Debounced Compose Song Search (same search algorithm as Lumen main search)
  useEffect(() => {
    const q = composeSearchQuery.trim();
    if (!q || q.length < 2) {
      setComposeSearchResults([]);
      setIsComposeSearching(false);
      return;
    }
    let cancelled = false;
    setIsComposeSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await StreamingService.searchVerifiedTracks(q);
        if (!cancelled) setComposeSearchResults((res || []).slice(0, 10));
      } catch {
        if (!cancelled) setComposeSearchResults([]);
      } finally {
        if (!cancelled) setIsComposeSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [composeSearchQuery]);

  // Debounced Receiver Guess Search (same search algorithm as Lumen main search)
  useEffect(() => {
    const q = guessSearchQuery.trim();
    if (!q || q.length < 2) {
      setGuessSearchResults([]);
      setIsGuessSearching(false);
      return;
    }
    let cancelled = false;
    setIsGuessSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await StreamingService.searchVerifiedTracks(q);
        if (!cancelled) setGuessSearchResults((res || []).slice(0, 8));
      } catch {
        if (!cancelled) setGuessSearchResults([]);
      } finally {
        if (!cancelled) setIsGuessSearching(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [guessSearchQuery]);

  // Reset per-round guess UI when switching rounds
  useEffect(() => {
    setActiveSubIdx(0);
    setGuessSearchQuery('');
    setGuessSearchResults([]);
    setSelectedGuessTrack(null);
    stopClipAudio();
  }, [selectedRoundId]);

  const activeRound = useMemo(() => {
    return rounds.find((r) => r.id === selectedRoundId) || rounds[0] || null;
  }, [rounds, selectedRoundId]);

  const activeSubmission: BlindDropSubmission | null = useMemo(() => {
    if (!activeRound || !activeRound.submissions.length) return null;
    return activeRound.submissions[Math.min(activeSubIdx, activeRound.submissions.length - 1)] || activeRound.submissions[0];
  }, [activeRound, activeSubIdx]);

  const ensureClipAudio = (): HTMLAudioElement => {
    if (!clipAudioRef.current) {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('timeupdate', () => {
        const { start, end } = activeClipBoundsRef.current;
        const rel = Math.max(0, el.currentTime - start);
        setClipElapsedSec(Math.min(end - start, rel));
        if (el.currentTime >= end - 0.15) {
          try {
            el.pause();
            el.currentTime = start;
          } catch (_) {}
          setPlayingClipKey(null);
          setClipElapsedSec(0);
        }
      });
      el.addEventListener('ended', () => {
        setPlayingClipKey(null);
        setClipElapsedSec(0);
      });
      clipAudioRef.current = el;
    }
    return clipAudioRef.current;
  };

  /**
   * Plays an isolated 30-second clip window without leaking track title/artist/cover to Mini-Player or MediaSession.
   */
  const handleTogglePlayClip = async (params: {
    key: string;
    track: Track;
    rawUrl?: string | null;
    startSec: number;
    durationSec: number;
  }) => {
    if (playingClipKey === params.key) {
      stopClipAudio();
      return;
    }

    stopClipAudio();
    setLoadingClipKey(params.key);
    try {
      // Pause main player so the 30s sample plays clearly
      if (AudioEngine.isPlaying()) {
        AudioEngine.pause();
      }

      let streamUrl = params.rawUrl || '';
      if (!streamUrl || streamUrl.startsWith('/api/search')) {
        const resolved = await PlaybackResolver.resolvePlayback(params.track);
        streamUrl = resolved?.streamUrl || params.track.streamUrl || '';
      }
      if (!streamUrl) {
        showToast('Could not load 30s audio sample. Try again.');
        setLoadingClipKey(null);
        return;
      }

      const fullUrl = resolveApiUrl(streamUrl);
      const trackDur = params.track.actualMediaDuration || params.track.duration || 180;
      const { clipStartSec: safeStart, clipDurationSec: safeDur, clipEndSec } = clampClipWindow(
        params.startSec,
        trackDur,
        params.durationSec
      );
      activeClipBoundsRef.current = { start: safeStart, end: clipEndSec };
      setClipTotalSec(safeDur);
      setClipElapsedSec(0);

      const audioEl = ensureClipAudio();
      if (audioEl.src !== fullUrl) {
        audioEl.src = fullUrl;
      }

      const startPlayback = async () => {
        try {
          audioEl.currentTime = safeStart;
        } catch (_) {}
        await audioEl.play();
        setLoadingClipKey(null);
        setPlayingClipKey(params.key);
      };

      if (audioEl.readyState >= 1) {
        await startPlayback();
      } else {
        await new Promise<void>((resolve, reject) => {
          const onMeta = () => {
            audioEl.removeEventListener('loadedmetadata', onMeta);
            audioEl.removeEventListener('error', onErr);
            resolve();
          };
          const onErr = () => {
            audioEl.removeEventListener('loadedmetadata', onMeta);
            audioEl.removeEventListener('error', onErr);
            reject(new Error('Audio failed to load'));
          };
          audioEl.addEventListener('loadedmetadata', onMeta, { once: true });
          audioEl.addEventListener('error', onErr, { once: true });
          audioEl.load();
        });
        await startPlayback();
      }
    } catch {
      setLoadingClipKey(null);
      setPlayingClipKey(null);
      showToast('Sample temporarily unavailable. Tap play to retry.');
    }
  };

  const handleSelectComposeTrack = async (track: Track) => {
    WatchSoundService.playTick(1.1);
    stopClipAudio();
    setSelectedTrack(track);
    setComposeSearchQuery('');
    setComposeSearchResults([]);
    const dur = track.actualMediaDuration || track.duration || 180;
    const defaultStart = dur > 60 ? Math.min(30, Math.floor(dur * 0.25)) : 0;
    setClipStartSec(defaultStart);
    setResolvedComposeUrl(null);
    // Pre-resolve stream URL in background so preview & sending are instant
    PlaybackResolver.resolvePlayback(track)
      .then((res) => {
        if (res?.streamUrl) setResolvedComposeUrl(res.streamUrl);
      })
      .catch(() => {});
  };

  const handleSendDirectChallenge = async () => {
    if (!currentUser || !selectedFriend || !selectedTrack) return;
    setIsSending(true);
    stopClipAudio();
    try {
      let clipUrl = resolvedComposeUrl;
      if (!clipUrl) {
        const res = await PlaybackResolver.resolvePlayback(selectedTrack).catch(() => null);
        clipUrl = res?.streamUrl || null;
      }
      const { clipStartSec: safeStart, clipDurationSec: safeDur } = clampClipWindow(
        clipStartSec,
        selectedTrack.actualMediaDuration || selectedTrack.duration || 180,
        MAX_GUESS_CLIP_SECONDS
      );

      const result = await BlindDropService.createDirectDrop(
        currentUser,
        selectedFriend,
        selectedTrack,
        clueText,
        { clipStartSec: safeStart, clipDurationSec: safeDur, resolvedClipUrl: clipUrl || undefined }
      );
      if (result.success && result.round) {
        WatchSoundService.playTick(1.3);
        setSelectedTrack(null);
        setSelectedFriend(null);
        setClueText('');
        setResolvedComposeUrl(null);
        setRounds(BlindDropService.getUserRounds(currentUser.uid));
        setSelectedRoundId(result.round.id);
        setActiveTab('inbox');
        showToast(`Sent 30s challenge to @${result.round.recipientUsername}!`);
      } else {
        showToast(result.error || 'Could not send challenge');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateCircleRound = async () => {
    if (!currentUser || selectedCircleFriends.size === 0) return;
    setIsSending(true);
    try {
      const invited = friends.filter((f) => selectedCircleFriends.has(f.userId));
      const res = await BlindDropService.createCircleDrop(
        currentUser,
        circleTitle.trim() || 'Circle Guess the Song',
        invited
      );
      if (res.success && res.round) {
        WatchSoundService.playTick(1.3);
        setCircleTitle('');
        setSelectedCircleFriends(new Set());
        setCircleTargetRoundId(res.round.id);
        setRounds(BlindDropService.getUserRounds(currentUser.uid));
        setSelectedRoundId(res.round.id);
        showToast('Circle round created! Now submit your 30s song clip.');
      } else {
        showToast(res.error || 'Could not create circle round');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmitCircleSong = async () => {
    if (!currentUser || !circleTargetRoundId || !selectedTrack) return;
    setIsSending(true);
    stopClipAudio();
    try {
      let clipUrl = resolvedComposeUrl;
      if (!clipUrl) {
        const res = await PlaybackResolver.resolvePlayback(selectedTrack).catch(() => null);
        clipUrl = res?.streamUrl || null;
      }
      const { clipStartSec: safeStart, clipDurationSec: safeDur } = clampClipWindow(
        clipStartSec,
        selectedTrack.actualMediaDuration || selectedTrack.duration || 180,
        MAX_GUESS_CLIP_SECONDS
      );
      const res = await BlindDropService.submitTrackToCircle(
        circleTargetRoundId,
        currentUser,
        selectedTrack,
        clueText,
        { clipStartSec: safeStart, clipDurationSec: safeDur, resolvedClipUrl: clipUrl || undefined }
      );
      if (res.success && res.round) {
        WatchSoundService.playTick(1.3);
        setSelectedTrack(null);
        setClueText('');
        setResolvedComposeUrl(null);
        setCircleTargetRoundId(null);
        setRounds(BlindDropService.getUserRounds(currentUser.uid));
        setSelectedRoundId(res.round.id);
        setActiveTab('inbox');
        showToast('Your 30s clip was submitted to the Circle!');
      } else {
        showToast(res.error || 'Could not submit song');
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmitSongGuess = async () => {
    if (!currentUser || !activeRound || !activeSubmission || !selectedGuessTrack) return;
    setIsSubmittingGuess(true);
    stopClipAudio();
    try {
      const res = await BlindDropService.submitSongGuess(
        activeRound.id,
        activeSubmission.id,
        currentUser,
        selectedGuessTrack
      );
      if (res.success && res.round) {
        WatchSoundService.playTick(res.isCorrect ? 1.4 : 0.9);
        setRounds(BlindDropService.getUserRounds(currentUser.uid));
        setSelectedGuessTrack(null);
        setGuessSearchQuery('');
        setGuessSearchResults([]);
        showToast(res.isCorrect ? 'Spot on! You guessed the song!' : 'Not quite — real track revealed!');
      } else {
        showToast(res.error || 'Could not submit guess');
      }
    } finally {
      setIsSubmittingGuess(false);
    }
  };

  const handleRemoveRound = (roundId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentUser) return;
    stopClipAudio();
    BlindDropService.removeRoundFromInbox(currentUser.uid, roundId);
    const remaining = BlindDropService.getUserRounds(currentUser.uid);
    setRounds(remaining);
    if (selectedRoundId === roundId) {
      setSelectedRoundId(remaining[0]?.id || null);
    }
    WatchSoundService.playTick(0.95);
    showToast('Removed from inbox');
  };

  if (!isOpen) return null;

  const selectedTrackDuration = selectedTrack ? (selectedTrack.actualMediaDuration || selectedTrack.duration || 180) : 180;
  const composeClipBounds = clampClipWindow(clipStartSec, selectedTrackDuration, MAX_GUESS_CLIP_SECONDS);
  const maxSliderStart = Math.max(0, Math.floor(selectedTrackDuration) - composeClipBounds.clipDurationSec);

  const isViewerSender = Boolean(
    currentUser &&
      activeSubmission &&
      (activeSubmission.senderUserId === currentUser.uid ||
        (activeRound?.mode === 'direct' && activeRound.hostUserId === currentUser.uid))
  );
  const viewerGuess = currentUser && activeSubmission?.guesses ? activeSubmission.guesses[currentUser.uid] : undefined;
  const allGuesses = activeSubmission?.guesses ? Object.values(activeSubmission.guesses) : [];
  const isSongRevealed = Boolean(activeSubmission && !activeSubmission.isSongHidden);
  const canRemoveActiveRound = Boolean(
    activeRound &&
      (isSongRevealed || activeRound.status === 'revealed' || activeRound.status === 'completed' || Boolean(viewerGuess))
  );

  return (
    <div
      className="fixed inset-0 z-[115] bg-black/75 backdrop-blur-2xl flex items-end sm:items-center justify-center sm:p-5 animate-fadeIn select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[92vh] sm:h-[84vh] rounded-t-[30px] sm:rounded-[30px] bg-[#0B0F1A]/95 border border-white/15 flex flex-col overflow-hidden relative"
        style={{
          boxShadow: `0 30px 90px rgba(0,0,0,0.92), 0 0 46px -12px ${dominantColor}45, inset 0 1px 1px rgba(255,255,255,0.22)`
        }}
      >
        {/* Subtle Liquid Glass Ambient Glow */}
        <div
          className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl opacity-20"
          style={{ background: dominantColor || '#63E8FF' }}
        />

        {/* Header */}
        <div className="relative z-10 px-4 sm:px-6 pt-4 sm:pt-5 pb-3.5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400/25 to-violet-500/20 border border-white/20 flex items-center justify-center text-lumen-cyan shadow-inner shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-black text-white tracking-tight truncate">
                Guess the Song
              </h3>
              <p className="text-[11px] text-white/55 truncate">
                Send a custom 30s mystery clip with clues — see if your friends nail it
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/75 hover:text-white transition-colors shrink-0 cursor-pointer"
            aria-label="Close Guess the Song"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Pill Bar */}
        <div className="relative z-10 px-4 sm:px-6 py-2.5 border-b border-white/[0.07] flex items-center gap-2 shrink-0">
          {(
            [
              { id: 'inbox', label: `Inbox (${rounds.length})`, icon: Music2 },
              { id: 'send', label: 'Send Challenge', icon: Send },
              { id: 'circle', label: 'Circle Round', icon: Users }
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(1.0);
                  stopClipAudio();
                  setActiveTab(tab.id);
                }}
                className={`px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  active
                    ? 'bg-white text-black shadow-lg'
                    : 'bg-white/[0.07] text-white/70 hover:text-white hover:bg-white/[0.12]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* BODY */}
        <div className="relative z-10 flex-1 min-h-0 overflow-hidden flex flex-col sm:flex-row">
          {/* TAB 1: INBOX (Responsive: compact horizontal strip on mobile, sidebar + detail on desktop) */}
          {activeTab === 'inbox' && (
            <>
              {rounds.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <div className="w-16 h-16 rounded-3xl bg-white/[0.06] flex items-center justify-center text-lumen-cyan">
                    <Music2 className="w-8 h-8" />
                  </div>
                  <h4 className="text-base font-black text-white">No Song Challenges Yet</h4>
                  <p className="text-xs text-white/55 max-w-xs">
                    Pick any 30-second part of a song, add a clue, and challenge a friend to guess what it is!
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('send')}
                    className="px-5 py-2.5 rounded-full text-xs font-extrabold text-black shadow-lg cursor-pointer"
                    style={{ backgroundColor: dominantColor || '#63E8FF' }}
                  >
                    Send Your First Challenge
                  </button>
                </div>
              ) : (
                <>
                  {/* Round List (Horizontal pills on mobile, vertical sidebar on desktop) */}
                  <div className="sm:w-72 shrink-0 border-b sm:border-b-0 sm:border-r border-white/10 p-3 flex sm:flex-col gap-2 overflow-x-auto sm:overflow-y-auto no-scrollbar">
                    {rounds.map((r) => {
                      const sub = r.submissions[0];
                      const isSel = activeRound?.id === r.id;
                      const isSender = currentUser && (r.hostUserId === currentUser.uid || sub?.senderUserId === currentUser.uid);
                      const myG = currentUser && sub?.guesses ? sub.guesses[currentUser.uid] : undefined;
                      const firstOtherGuess = sub?.guesses ? Object.values(sub.guesses)[0] : undefined;
                      const resolved = Boolean(myG || firstOtherGuess || r.status === 'revealed' || r.status === 'completed');

                      return (
                        <div
                          key={r.id}
                          onClick={() => setSelectedRoundId(r.id)}
                          className={`shrink-0 w-56 sm:w-full rounded-2xl p-3 transition-all cursor-pointer flex items-center justify-between gap-2 ${
                            isSel
                              ? 'bg-white/[0.14] shadow-lg'
                              : 'bg-white/[0.04] hover:bg-white/[0.08]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-extrabold text-white truncate">
                                {r.mode === 'circle'
                                  ? r.title
                                  : isSender
                                    ? `To @${r.recipientUsername || 'friend'}`
                                    : `From @${sub?.senderUsername || r.hostUsername}`}
                              </span>
                            </div>
                            <div className="text-[10px] mt-0.5 flex items-center gap-1.5">
                              {resolved ? (
                                (myG || firstOtherGuess)?.isCorrect ? (
                                  <span className="text-emerald-400 font-bold">Correct</span>
                                ) : (
                                  <span className="text-rose-400 font-bold">Wrong</span>
                                )
                              ) : isSender ? (
                                <span className="text-amber-300 font-semibold">Waiting for guess</span>
                              ) : (
                                <span className="text-lumen-cyan font-bold">Tap to guess 30s clip</span>
                              )}
                            </div>
                          </div>

                          {resolved && (
                            <button
                              type="button"
                              onClick={(e) => handleRemoveRound(r.id, e)}
                              title="Remove from inbox"
                              className="p-1.5 rounded-full text-white/45 hover:text-rose-400 hover:bg-rose-500/15 transition-colors shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Active Round Stage */}
                  <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 no-scrollbar">
                    {activeRound && activeRound.mode === 'circle' && activeRound.submissions.length > 1 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                        {activeRound.submissions.map((s, idx) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              stopClipAudio();
                              setActiveSubIdx(idx);
                            }}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0 cursor-pointer ${
                              activeSubIdx === idx ? 'bg-white text-black' : 'bg-white/10 text-white/70'
                            }`}
                          >
                            Clip #{idx + 1} ({s.senderUsername ? `@${s.senderUsername}` : 'Friend'})
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Circle round needs user submission */}
                    {activeRound &&
                      activeRound.mode === 'circle' &&
                      activeRound.status === 'open_for_submissions' &&
                      currentUser &&
                      !activeRound.submissions.some((s) => s.senderUserId === currentUser.uid) && (
                        <div className="rounded-2xl p-4 bg-lumen-cyan/10 flex items-center justify-between gap-3">
                          <div className="text-xs text-white/90">
                            <div className="font-bold">Add your 30s song clip to "{activeRound.title}"</div>
                            <div className="text-[11px] text-white/60">Everyone submits a 30s clip, then guesses each other&apos;s tracks!</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setCircleTargetRoundId(activeRound.id);
                              setActiveTab('circle');
                            }}
                            className="px-3.5 py-2 rounded-xl bg-lumen-cyan text-black text-xs font-extrabold shrink-0 cursor-pointer"
                          >
                            Submit Clip
                          </button>
                        </div>
                      )}

                    {activeRound && activeSubmission ? (
                      <div className="space-y-4">
                        {/* Mystery / Revealed Liquid Glass Stage Card */}
                        <div
                          className="rounded-[26px] p-5 bg-gradient-to-br from-white/[0.12] via-white/[0.05] to-white/[0.02] space-y-4 relative overflow-hidden"
                          style={{
                            boxShadow:
                              '0 20px 42px -12px rgba(0,0,0,0.65), inset 0 1px 1px rgba(255,255,255,0.24)'
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <InitialAvatar
                                name={activeSubmission.senderDisplayName || activeSubmission.senderUsername || 'Friend'}
                                imageUrl={activeSubmission.senderPhotoURL}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-extrabold text-white truncate">
                                  {isViewerSender
                                    ? `Sent to @${activeRound.recipientUsername || 'Circle'}`
                                    : `Challenge from @${activeSubmission.senderUsername || activeRound.hostUsername}`}
                                </div>
                                <div className="text-[10px] text-white/55 font-mono flex items-center gap-1">
                                  <Scissors className="w-3 h-3 text-lumen-cyan" />
                                  <span>
                                    {activeSubmission.clipDurationSec || MAX_GUESS_CLIP_SECONDS}s sample
                                    {isSongRevealed
                                      ? ` (${formatClipTimestamp(activeSubmission.clipStartSec || 0)} – ${formatClipTimestamp((activeSubmission.clipStartSec || 0) + (activeSubmission.clipDurationSec || MAX_GUESS_CLIP_SECONDS))})`
                                      : ''}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {canRemoveActiveRound && (
                              <button
                                type="button"
                                onClick={() => handleRemoveRound(activeRound.id)}
                                className="px-3 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Remove</span>
                              </button>
                            )}
                          </div>

                          {/* Optional Clues Box */}
                          {activeSubmission.clue && (
                            <div className="rounded-2xl px-3.5 py-2.5 bg-amber-400/10 flex items-start gap-2.5">
                              <Lightbulb className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                              <div className="text-xs text-amber-100/95">
                                <span className="font-bold text-amber-300 mr-1.5">Clue:</span>
                                {activeSubmission.clue}
                              </div>
                            </div>
                          )}

                          {/* HIDDEN MYSTERY PLAYER (Before Guessing) vs REVEALED SONG CARD */}
                          {!isSongRevealed ? (
                            <div className="rounded-2xl p-4 bg-black/35 flex flex-col sm:flex-row items-center gap-4">
                              {/* Mystery Disc — ZERO Cover/Title/Artist Leakage */}
                              <div
                                className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/15 to-white/[0.03] flex items-center justify-center shrink-0 relative overflow-hidden"
                                style={{ boxShadow: `0 12px 28px -6px rgba(0,0,0,0.7), 0 0 24px -8px ${dominantColor}65` }}
                              >
                                <Disc3
                                  className={`w-10 h-10 text-white/75 ${
                                    playingClipKey === `inbox_${activeSubmission.id}` ? 'animate-spin' : ''
                                  }`}
                                  style={{ animationDuration: '4s' }}
                                />
                                <span className="absolute text-sm font-black text-lumen-cyan">?</span>
                              </div>

                              <div className="flex-1 w-full space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-black text-white">Mystery 30-Second Clip</div>
                                    <div className="text-[11px] text-white/55">
                                      Listen closely — title &amp; album cover stay hidden until you guess
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const rawSub =
                                        BlindDropService.getRawSubmissionForPlayback(activeRound.id, activeSubmission.id) ||
                                        activeSubmission;
                                      handleTogglePlayClip({
                                        key: `inbox_${activeSubmission.id}`,
                                        track: rawSub.track,
                                        rawUrl: rawSub.resolvedClipUrl || activeSubmission.resolvedClipUrl,
                                        startSec: rawSub.clipStartSec ?? 0,
                                        durationSec: rawSub.clipDurationSec ?? MAX_GUESS_CLIP_SECONDS
                                      });
                                    }}
                                    className="w-12 h-12 rounded-full text-black flex items-center justify-center shadow-xl active:scale-90 transition-transform shrink-0 cursor-pointer"
                                    style={{ backgroundColor: dominantColor || '#63E8FF' }}
                                    aria-label="Play 30 second mystery clip"
                                  >
                                    {loadingClipKey === `inbox_${activeSubmission.id}` ? (
                                      <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : playingClipKey === `inbox_${activeSubmission.id}` ? (
                                      <Pause className="w-5 h-5 fill-current" />
                                    ) : (
                                      <Play className="w-5 h-5 fill-current ml-0.5" />
                                    )}
                                  </button>
                                </div>

                                {/* 30-Second Sample Progress Bar */}
                                <div className="space-y-1">
                                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all duration-150"
                                      style={{
                                        width: `${Math.min(100, (clipElapsedSec / Math.max(1, clipTotalSec)) * 100)}%`,
                                        backgroundColor: dominantColor || '#63E8FF'
                                      }}
                                    />
                                  </div>
                                  <div className="flex justify-between text-[10px] font-mono text-white/50">
                                    <span>{formatClipTimestamp(clipElapsedSec)}</span>
                                    <span>{formatClipTimestamp(activeSubmission.clipDurationSec || MAX_GUESS_CLIP_SECONDS)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* REVEALED TRACK CARD */
                            <div className="rounded-2xl p-4 bg-black/35 flex items-center gap-4">
                              <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-xl shrink-0">
                                <CoverImage
                                  src={activeSubmission.track.artworkUrl}
                                  title={activeSubmission.track.title}
                                  artist={activeSubmission.track.artist}
                                  album={activeSubmission.track.album}
                                  size={240}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-mono uppercase tracking-wider text-lumen-cyan font-bold">
                                  Actual Song
                                </div>
                                <div className="text-base font-black text-white truncate mt-0.5">
                                  {activeSubmission.track.title}
                                </div>
                                <div className="text-xs text-white/65 truncate">
                                  {activeSubmission.track.artist}
                                </div>
                                <div className="flex items-center gap-2 mt-2.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      stopClipAudio();
                                      onPlayTrack(activeSubmission.track);
                                    }}
                                    className="px-3.5 py-1.5 rounded-full text-xs font-extrabold text-black flex items-center gap-1.5 cursor-pointer"
                                    style={{ backgroundColor: dominantColor || '#63E8FF' }}
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    <span>Play Full Song</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const rawSub =
                                        BlindDropService.getRawSubmissionForPlayback(activeRound.id, activeSubmission.id) ||
                                        activeSubmission;
                                      handleTogglePlayClip({
                                        key: `replay_${activeSubmission.id}`,
                                        track: rawSub.track,
                                        rawUrl: rawSub.resolvedClipUrl || activeSubmission.resolvedClipUrl,
                                        startSec: rawSub.clipStartSec ?? 0,
                                        durationSec: rawSub.clipDurationSec ?? MAX_GUESS_CLIP_SECONDS
                                      });
                                    }}
                                    className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-bold text-white flex items-center gap-1 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>{playingClipKey === `replay_${activeSubmission.id}` ? 'Stop Clip' : 'Replay 30s'}</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* GUESS SEARCH & SUBMIT BOX (For Receiver Who Hasn't Guessed Yet) */}
                        {!isViewerSender && !viewerGuess && !isSongRevealed && (
                          <div className="rounded-[24px] p-4 bg-white/[0.05] space-y-3">
                            <div className="text-xs font-extrabold text-white">
                              Search &amp; Select Your Guess
                            </div>
                            <div className="relative">
                              <Search className="w-4 h-4 text-white/45 absolute left-3.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={guessSearchQuery}
                                onChange={(e) => setGuessSearchQuery(e.target.value)}
                                placeholder="Type song name or artist..."
                                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/45 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
                              />
                            </div>

                            {isGuessSearching && (
                              <div className="text-[11px] text-white/50 flex items-center gap-2 py-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-lumen-cyan" />
                                <span>Searching catalog...</span>
                              </div>
                            )}

                            {guessSearchResults.length > 0 && (
                              <div className="max-h-52 overflow-y-auto space-y-1.5 no-scrollbar">
                                {guessSearchResults.map((tr) => {
                                  const picked = selectedGuessTrack?.id === tr.id;
                                  return (
                                    <button
                                      key={tr.id}
                                      type="button"
                                      onClick={() => {
                                        WatchSoundService.playTick(1.1);
                                        setSelectedGuessTrack(tr);
                                      }}
                                      className={`w-full p-2 rounded-xl flex items-center gap-2.5 text-left transition-all cursor-pointer ${
                                        picked
                                          ? 'bg-lumen-cyan/20 ring-1 ring-lumen-cyan/60'
                                          : 'bg-white/[0.04] hover:bg-white/[0.09]'
                                      }`}
                                    >
                                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
                                        <CoverImage
                                          src={tr.artworkUrl}
                                          title={tr.title}
                                          artist={tr.artist}
                                          size={120}
                                          className="w-full h-full object-cover"
                                        />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-white truncate">{tr.title}</div>
                                        <div className="text-[11px] text-white/55 truncate">{tr.artist}</div>
                                      </div>
                                      {picked && <Check className="w-4 h-4 text-lumen-cyan shrink-0" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {selectedGuessTrack && (
                              <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[10px] text-white/50 uppercase font-mono">Selected Guess</div>
                                  <div className="text-xs font-extrabold text-white truncate">
                                    {selectedGuessTrack.title} — {selectedGuessTrack.artist}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={isSubmittingGuess}
                                  onClick={handleSubmitSongGuess}
                                  className="px-4 py-2 rounded-full text-xs font-extrabold text-black shadow-lg active:scale-95 transition-transform shrink-0 cursor-pointer disabled:opacity-50"
                                  style={{ backgroundColor: dominantColor || '#63E8FF' }}
                                >
                                  {isSubmittingGuess ? 'Checking...' : 'Submit Guess'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* GUESS RESULTS (Visible to Both Receiver & Sender!) */}
                        {allGuesses.length > 0 ? (
                          <div className="rounded-[24px] p-4 bg-white/[0.05] space-y-2.5">
                            <div className="text-xs font-extrabold text-white">Guess Results</div>
                            {allGuesses.map((g) => (
                              <div
                                key={`${g.guesserUserId}_${g.guessedAt}`}
                                className={`rounded-2xl p-3 flex items-center justify-between gap-3 ${
                                  g.isCorrect ? 'bg-emerald-500/12' : 'bg-rose-500/12'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {g.isCorrect ? (
                                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-white truncate">
                                      @{g.guesserUsername} guessed &ldquo;{g.guessedTrackTitle || g.guessedUsername}&rdquo;
                                    </div>
                                    {g.guessedTrackArtist && (
                                      <div className="text-[11px] text-white/55 truncate">{g.guessedTrackArtist}</div>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase shrink-0 ${
                                    g.isCorrect
                                      ? 'bg-emerald-400/20 text-emerald-300'
                                      : 'bg-rose-400/20 text-rose-300'
                                  }`}
                                >
                                  {g.isCorrect ? 'Correct' : 'Wrong'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : isViewerSender ? (
                          <div className="rounded-2xl p-3.5 bg-white/[0.04] text-xs text-white/60 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-300 shrink-0" />
                            <span>Waiting for your friend to listen to your 30s clip and submit their guess...</span>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="py-16 text-center text-xs text-white/50">
                        Select a challenge to listen and guess!
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* TAB 2 & 3: SEND DIRECT CHALLENGE / CIRCLE ROUND COMPOSER */}
          {(activeTab === 'send' || activeTab === 'circle') && (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5 no-scrollbar">
              {/* Step A: Pick Recipient (Direct) OR Create/Pick Circle Round */}
              {activeTab === 'send' ? (
                <div className="space-y-2.5">
                  <label className="text-xs font-extrabold text-white">1. Choose Friend to Challenge</label>
                  {friends.length === 0 ? (
                    <div className="text-xs text-white/50 p-3 rounded-2xl bg-white/[0.04]">
                      Add a friend in the Friends tab first to send a Guess the Song challenge.
                    </div>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                      {friends.map((f) => {
                        const active = selectedFriend?.userId === f.userId;
                        return (
                          <button
                            key={f.userId}
                            type="button"
                            onClick={() => {
                              WatchSoundService.playTick(1.0);
                              setSelectedFriend(f);
                            }}
                            className={`px-3 py-2 rounded-2xl flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
                              active
                                ? 'bg-white text-black font-extrabold shadow-lg'
                                : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12]'
                            }`}
                          >
                            <InitialAvatar name={f.displayName || f.username} imageUrl={f.photoURL} size="xs" />
                            <span className="text-xs">@{f.username}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl p-4 bg-white/[0.04] space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-extrabold text-white">
                      {circleTargetRoundId ? 'Submitting Clip to Circle Round' : '1. Start a Circle Guess Round'}
                    </label>
                    {circleTargetRoundId && (
                      <button
                        type="button"
                        onClick={() => setCircleTargetRoundId(null)}
                        className="text-[11px] text-lumen-cyan underline cursor-pointer"
                      >
                        Create New Instead
                      </button>
                    )}
                  </div>
                  {!circleTargetRoundId && (
                    <>
                      <input
                        type="text"
                        value={circleTitle}
                        onChange={(e) => setCircleTitle(e.target.value)}
                        placeholder="Round name (e.g. 90s Throwbacks)..."
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black/45 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
                      />
                      <div className="flex flex-wrap gap-2">
                        {friends.map((f) => {
                          const picked = selectedCircleFriends.has(f.userId);
                          return (
                            <button
                              key={f.userId}
                              type="button"
                              onClick={() => {
                                setSelectedCircleFriends((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(f.userId)) next.delete(f.userId);
                                  else next.add(f.userId);
                                  return next;
                                });
                              }}
                              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                                picked ? 'bg-lumen-cyan text-black' : 'bg-white/[0.08] text-white/75'
                              }`}
                            >
                              @{f.username}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        disabled={isSending || selectedCircleFriends.size === 0}
                        onClick={handleCreateCircleRound}
                        className="px-4 py-2 rounded-full text-xs font-extrabold text-black cursor-pointer disabled:opacity-45"
                        style={{ backgroundColor: dominantColor || '#63E8FF' }}
                      >
                        {isSending ? 'Creating...' : 'Create Circle Round'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Step B: Pick Song + 30-Second Clip Window + Clue */}
              {(activeTab === 'send' || circleTargetRoundId) && (
                <>
                  <div className="space-y-2.5">
                    <label className="text-xs font-extrabold text-white">2. Pick a Song</label>
                    <div className="relative">
                      <Search className="w-4 h-4 text-white/45 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={composeSearchQuery}
                        onChange={(e) => setComposeSearchQuery(e.target.value)}
                        placeholder="Search any song (e.g. Here Comes The Sun)..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/45 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
                      />
                    </div>

                    {isComposeSearching && (
                      <div className="text-[11px] text-white/50 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-lumen-cyan" />
                        <span>Searching songs...</span>
                      </div>
                    )}

                    {composeSearchResults.length > 0 && (
                      <div className="max-h-52 overflow-y-auto space-y-1.5 no-scrollbar">
                        {composeSearchResults.map((tr) => (
                          <button
                            key={tr.id}
                            type="button"
                            onClick={() => handleSelectComposeTrack(tr)}
                            className="w-full p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] flex items-center gap-2.5 text-left transition-colors cursor-pointer"
                          >
                            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
                              <CoverImage
                                src={tr.artworkUrl}
                                title={tr.title}
                                artist={tr.artist}
                                size={120}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-white truncate">{tr.title}</div>
                              <div className="text-[11px] text-white/55 truncate">{tr.artist}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Selected Song + Custom 30s Timestamp Picker */}
                  {selectedTrack && (
                    <div className="rounded-[24px] p-4 bg-gradient-to-br from-white/[0.1] via-white/[0.04] to-white/[0.02] space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-14 h-14 rounded-xl overflow-hidden shadow-lg shrink-0">
                            <CoverImage
                              src={selectedTrack.artworkUrl}
                              title={selectedTrack.title}
                              artist={selectedTrack.artist}
                              size={160}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-black text-white truncate">{selectedTrack.title}</div>
                            <div className="text-xs text-white/60 truncate">{selectedTrack.artist}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            stopClipAudio();
                            setSelectedTrack(null);
                          }}
                          className="p-2 rounded-full bg-white/10 text-white/65 hover:text-white cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* 30-Second Window Selector */}
                      <div className="rounded-2xl p-3.5 bg-black/35 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                            <Scissors className="w-3.5 h-3.5 text-lumen-cyan" />
                            <span>Choose 30-Second Clip</span>
                          </div>
                          <span className="text-xs font-mono font-extrabold text-lumen-cyan">
                            {formatClipTimestamp(composeClipBounds.clipStartSec)} &rarr; {formatClipTimestamp(composeClipBounds.clipEndSec)}
                          </span>
                        </div>

                        <input
                          type="range"
                          min={0}
                          max={maxSliderStart}
                          step={1}
                          value={composeClipBounds.clipStartSec}
                          onChange={(e) => {
                            stopClipAudio();
                            setClipStartSec(parseInt(e.target.value, 10) || 0);
                          }}
                          className="w-full accent-lumen-cyan cursor-pointer"
                        />

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                stopClipAudio();
                                setClipStartSec((prev) => Math.max(0, prev - 15));
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white/10 text-[11px] font-bold text-white/80 cursor-pointer"
                            >
                              -15s
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                stopClipAudio();
                                setClipStartSec((prev) => Math.min(maxSliderStart, prev + 15));
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white/10 text-[11px] font-bold text-white/80 cursor-pointer"
                            >
                              +15s
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              handleTogglePlayClip({
                                key: 'compose_preview',
                                track: selectedTrack,
                                rawUrl: resolvedComposeUrl,
                                startSec: composeClipBounds.clipStartSec,
                                durationSec: composeClipBounds.clipDurationSec
                              })
                            }
                            className="px-3.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer"
                          >
                            {loadingClipKey === 'compose_preview' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : playingClipKey === 'compose_preview' ? (
                              <Pause className="w-3.5 h-3.5 fill-current" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                            <span>{playingClipKey === 'compose_preview' ? 'Stop Preview' : 'Preview 30s'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Optional Clue Input */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-white/80 flex items-center gap-1.5">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-300" />
                          <span>Optional Clue</span>
                        </label>
                        <input
                          type="text"
                          maxLength={120}
                          value={clueText}
                          onChange={(e) => setClueText(e.target.value)}
                          placeholder="Give your friend a hint (optional)..."
                          className="w-full px-3.5 py-2.5 rounded-xl bg-black/45 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-300"
                        />
                      </div>

                      <button
                        type="button"
                        disabled={
                          isSending ||
                          (activeTab === 'send' && !selectedFriend) ||
                          (activeTab === 'circle' && !circleTargetRoundId)
                        }
                        onClick={activeTab === 'send' ? handleSendDirectChallenge : handleSubmitCircleSong}
                        className="w-full py-3 rounded-2xl text-xs font-extrabold text-black flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-transform cursor-pointer disabled:opacity-45"
                        style={{ backgroundColor: dominantColor || '#63E8FF' }}
                      >
                        <Send className="w-4 h-4" />
                        <span>
                          {isSending
                            ? 'Sending...'
                            : activeTab === 'send'
                              ? `Send 30s Mystery Clip${selectedFriend ? ` to @${selectedFriend.username}` : ''}`
                              : 'Submit 30s Clip to Circle'}
                        </span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Toast */}
        {toastMsg && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-black/90 border border-white/20 text-xs font-bold text-white shadow-2xl flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
            <span>{toastMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
};
