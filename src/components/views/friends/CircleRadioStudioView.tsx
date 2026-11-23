import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Play, 
  Pause, 
  SkipForward, 
  Heart, 
  ThumbsDown, 
  Check, 
  FolderPlus, 
  Sparkles, 
  Radio, 
  Users, 
  Disc3, 
  Settings, 
  RefreshCw, 
  Sliders, 
  Volume2, 
  Loader2,
  Plus,
  X 
} from 'lucide-react';
import { Track } from '../../../types/music';
import { AppUser } from '../../../services/firebaseAuthService';
import { 
  CircleRadioSession, 
  CircleRadioCandidate, 
  CircleDiscoveryMode, 
  CircleFeedbackType,
  CircleTasteSeed
} from '../../../types/circleRadioTypes';
import { CircleRadioService } from '../../../services/circleRadioService';
import { LikedService } from '../../../services/likedService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';
import { FriendProfileData } from './friendsTypes';

interface Props {
  sessionId?: string;
  initialSession?: CircleRadioSession | null;
  onBack: () => void;
  currentUser: AppUser | null;
  friends: FriendProfileData[];
  onPlayTrack: (track: Track) => void;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  dominantColor: string;
}

export const CircleRadioStudioView: React.FC<Props> = ({
  sessionId,
  initialSession,
  onBack,
  currentUser,
  friends,
  onPlayTrack,
  currentTrack,
  isPlaying = false,
  onTogglePlay,
  dominantColor
}) => {
  const [session, setSession] = useState<CircleRadioSession | null>(initialSession || null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isReplenishing, setIsReplenishing] = useState(false);
  const [isSeedsPanelOpen, setIsSeedsPanelOpen] = useState(false);
  const [newSeedInput, setNewSeedInput] = useState('');
  const [isRegeneratingSeeds, setIsRegeneratingSeeds] = useState(false);

  // Harvest friends' real taste seeds if not yet populated
  useEffect(() => {
    if (session && (!session.seeds || session.seeds.length === 0)) {
      const generated = CircleRadioService.extractTasteSeeds(session.participants, friends);
      if (generated.length > 0) {
        CircleRadioService.updateSessionSeeds(session.id, generated).then(res => {
          if (res.session) setSession(res.session);
        });
      }
    }
  }, [session?.id, friends]);

  useEffect(() => {
    if (session) return;
    const activeId = sessionId || initialSession?.id;
    if (activeId) {
      let hasReceived = false;
      const timeoutId = setTimeout(() => {
        if (!hasReceived && !session) {
          const local = CircleRadioService.getLocalSessions();
          if (local.length > 0) {
            setSession(local[0]);
          } else {
            const effectiveHost: AppUser = currentUser || {
              uid: 'listener_' + Date.now(),
              email: null,
              displayName: 'Lumen Listener',
              username: 'listener',
              photoURL: null,
              isGuest: true,
              emailVerified: false,
              hasCompletedOnboarding: true
            } as AppUser;
            CircleRadioService.createSession(
              effectiveHost,
              `${effectiveHost.displayName || effectiveHost.username || 'My'}'s Circle Radio`,
              'common_ground',
              friends.map(f => ({ uid: f.userId, username: f.username, displayName: f.displayName || f.username, photoURL: f.photoURL })),
              friends.map(f => ({ userId: f.userId, username: f.username, sharedArtists: f.sharedArtists, currentTrack: f.currentTrack }))
            ).then(res => {
              if (res.session) setSession(res.session);
            });
          }
        }
      }, 3000);

      const unsub = CircleRadioService.subscribeToSession(activeId, (live) => {
        if (live) {
          hasReceived = true;
          clearTimeout(timeoutId);
          setSession(live);
        }
      });
      return () => {
        clearTimeout(timeoutId);
        unsub();
      };
    } else {
      // Check existing local sessions
      const existing = CircleRadioService.getLocalSessions();
      if (existing.length > 0) {
        setSession(existing[0]);
      } else {
        // Auto-create initial session with friend profiles or fallback host
        const effectiveHost: AppUser = currentUser || {
          uid: 'listener_' + Date.now(),
          email: null,
          displayName: 'Lumen Listener',
          username: 'listener',
          photoURL: null,
          isGuest: true,
          emailVerified: false,
          hasCompletedOnboarding: true
        } as AppUser;

        let isCompleted = false;
        // 3-second failsafe: if remote discovery is delayed, create instantaneous local session
        const failsafeTimer = setTimeout(() => {
          if (!isCompleted && !session) {
            const fallbackSession = CircleRadioService.getLocalSessions()[0];
            if (fallbackSession) setSession(fallbackSession);
          }
        }, 3000);

        CircleRadioService.createSession(
          effectiveHost,
          `${effectiveHost.displayName || effectiveHost.username || 'My'}'s Circle Radio`,
          'common_ground',
          friends.map(f => ({ uid: f.userId, username: f.username, displayName: f.displayName || f.username, photoURL: f.photoURL })),
          friends.map(f => ({ userId: f.userId, username: f.username, sharedArtists: f.sharedArtists, currentTrack: f.currentTrack }))
        ).then(res => {
          isCompleted = true;
          clearTimeout(failsafeTimer);
          if (res.session) setSession(res.session);
        }).catch(() => {
          isCompleted = true;
          clearTimeout(failsafeTimer);
        });
      }
    }
  }, [sessionId, initialSession?.id, currentUser, friends, session]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const currentCandidate = session?.candidates.find(c => c.id === session.currentCandidateId) || session?.candidates[0];

  const handleFeedback = async (type: CircleFeedbackType) => {
    if (!session || !currentCandidate || !currentUser) return;
    WatchSoundService.playTick(1.2);

    if (type === 'save') {
      LikedService.addTrack(currentCandidate.track);
      showToast(`Saved "${currentCandidate.track.title}" to Liked Songs!`);
    } else if (type === 'already_know') {
      showToast('Familiar track noted! Discovering next track...');
    }

    const res = await CircleRadioService.submitFeedback(session, currentCandidate.id, currentUser, type);
    if (res.success && res.session) {
      setSession(res.session);
    }

    if (type === 'skip' || type === 'not_for_me' || type === 'already_know') {
      await handleNextTrack();
    }
  };

  const handleNextTrack = async () => {
    if (!session) return;
    setIsReplenishing(true);
    WatchSoundService.playTick(1.1);
    const res = await CircleRadioService.nextCandidate(session);
    setIsReplenishing(false);
    if (res.success && res.session) {
      setSession(res.session);
      const nextCand = res.session.candidates.find(c => c.id === res.session?.currentCandidateId);
      if (nextCand) {
        onPlayTrack(nextCand.track);
      }
    }
  };

  const handleTogglePreference = async (userId: string) => {
    if (!session) return;
    WatchSoundService.playTick(1.0);
    const res = await CircleRadioService.toggleParticipantContribution(session, userId);
    if (res.success && res.session) {
      setSession(res.session);
      showToast('Taste contribution updated');
    }
  };

  const modeDescriptions: Record<CircleDiscoveryMode, { title: string; desc: string; color: string }> = {
    common_ground: {
      title: 'Common Ground',
      desc: 'Shared overlap across group preferences',
      color: 'text-lumen-cyan border-lumen-cyan/40 bg-cyan-500/10'
    },
    equal_rotation: {
      title: 'Equal Rotation',
      desc: 'Equal fair rotation between every participant',
      color: 'text-amber-400 border-amber-400/40 bg-amber-500/10'
    },
    discovery_blend: {
      title: 'Discovery Blend',
      desc: 'Exploratory gems matching group profile',
      color: 'text-purple-400 border-purple-400/40 bg-purple-500/10'
    }
  };

  const handleToggleSeed = async (seedId: string) => {
    if (!session || !session.seeds) return;
    WatchSoundService.playTick(1.0);
    const updatedSeeds = session.seeds.map(s => s.id === seedId ? { ...s, enabled: !s.enabled } : s);
    const res = await CircleRadioService.updateSessionSeeds(session.id, updatedSeeds);
    if (res.session) setSession(res.session);
  };

  const handleRemoveSeed = async (seedId: string) => {
    if (!session || !session.seeds) return;
    WatchSoundService.playTick(1.0);
    const updatedSeeds = session.seeds.filter(s => s.id !== seedId);
    const res = await CircleRadioService.updateSessionSeeds(session.id, updatedSeeds);
    if (res.session) setSession(res.session);
    showToast('Seed removed from Circle Feed');
  };

  const handleAddCustomSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !newSeedInput.trim()) return;
    WatchSoundService.playTick(1.1);
    const clean = newSeedInput.trim();
    const newSeed: CircleTasteSeed = {
      id: `seed_custom_${Date.now()}`,
      label: clean,
      type: 'custom',
      sourceUsername: currentUser?.username || 'You',
      sourceUserId: currentUser?.uid || 'me',
      sourceType: 'custom',
      enabled: true
    };
    const updatedSeeds = [...(session.seeds || []), newSeed];
    setNewSeedInput('');
    const res = await CircleRadioService.updateSessionSeeds(session.id, updatedSeeds);
    if (res.session) setSession(res.session);
    showToast(`Added "${clean}" to Circle Taste Feed!`);
  };

  const handleRegenerateFromSeeds = async () => {
    if (!session) return;
    WatchSoundService.playTick(1.2);
    setIsRegeneratingSeeds(true);
    const res = await CircleRadioService.regenerateFromSeeds(session);
    setIsRegeneratingSeeds(false);
    if (res.session) {
      setSession(res.session);
      showToast('Radio queue regenerated with active friend seeds!');
    }
  };

  if (!session) {
    return (
      <div className="w-full max-w-4xl mx-auto py-8 px-4 space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-white/15 backdrop-blur-xl flex items-center justify-center cursor-pointer shadow-lg"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-white/70">Back to Social</span>
        </div>
        <div className="text-center text-white/50 py-16 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400 mb-2" />
          <p className="text-sm font-medium">Tuning into Circle Radio...</p>
          <p className="text-xs text-white/35">Syncing collaborative taste feeds with your circle</p>
          <button
            type="button"
            onClick={() => {
              const effectiveHost: AppUser = currentUser || {
                uid: 'listener_' + Date.now(),
                email: null,
                displayName: 'Lumen Listener',
                username: 'listener',
                photoURL: null,
                isGuest: true,
                emailVerified: false,
                hasCompletedOnboarding: true
              } as AppUser;
              CircleRadioService.createSession(
                effectiveHost,
                `${effectiveHost.displayName || effectiveHost.username || 'My'}'s Circle Radio`,
                'common_ground',
                friends.map(f => ({ uid: f.userId, username: f.username, displayName: f.displayName || f.username, photoURL: f.photoURL })),
                friends.map(f => ({ userId: f.userId, username: f.username, sharedArtists: f.sharedArtists, currentTrack: f.currentTrack }))
              ).then(res => {
                if (res.session) setSession(res.session);
              });
            }}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-xs font-semibold transition-all cursor-pointer shadow-lg active:scale-95"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Launch Fresh Jam Now</span>
          </button>
        </div>
      </div>
    );
  }

  const modeInfo = modeDescriptions[session.discoveryMode] || modeDescriptions.common_ground;
  const userFeedback = currentUser && currentCandidate ? currentCandidate.feedback[currentUser.uid] : null;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-5 sm:space-y-6 animate-fadeIn pb-44 sm:pb-24 px-3 sm:px-6">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/90 border border-white/20 text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-fadeIn backdrop-blur-xl">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* TOP HEADER (Mobile-spacious stacked layout) */}
      <div className="flex flex-col gap-3.5 p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-purple-500/10 via-white/[0.04] to-transparent border border-white/15 backdrop-blur-2xl shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="p-2.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer flex-shrink-0"
              title="Return to Friends"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-xl font-black text-white tracking-tight truncate">{session.title}</h2>
                <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border flex-shrink-0 ${modeInfo.color}`}>
                  {modeInfo.title}
                </span>
              </div>
              <p className="text-xs text-white/50 mt-0.5 line-clamp-1">
                {modeInfo.desc} • {session.participants.length} in Circle
              </p>
            </div>
          </div>

          {/* Taste Feed & Seeds Panel Toggle */}
          <button
            type="button"
            onClick={() => setIsSeedsPanelOpen(prev => !prev)}
            className={`px-3 py-1.5 rounded-2xl border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-lg active:scale-95 flex-shrink-0 ${
              isSeedsPanelOpen
                ? 'bg-purple-500 text-white border-purple-400 shadow-purple-500/25'
                : 'bg-white/10 hover:bg-white/15 text-white/90 border-white/15'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">Seeds</span>
            {session.seeds && session.seeds.length > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-white/20 text-white">
                {session.seeds.filter(s => s.enabled).length}
              </span>
            )}
          </button>
        </div>

        {/* Discovery Mode Selector (Equal 3-column grid on mobile — zero cramping or overflow) */}
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-white/[0.05] border border-white/10 w-full">
          {(['common_ground', 'equal_rotation', 'discovery_blend'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={async () => {
                const updated: CircleRadioSession = {
                  ...session,
                  discoveryMode: m,
                  updatedAt: Date.now()
                };
                setSession(updated);
                await CircleRadioService.syncToCloud(updated);
                showToast(`Switched discovery mode to ${modeDescriptions[m].title}`);
              }}
              className={`px-2 py-2 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer text-center leading-tight ${
                session.discoveryMode === m 
                  ? 'bg-purple-500 text-white shadow-md' 
                  : 'text-white/55 hover:text-white'
              }`}
            >
              {modeDescriptions[m].title}
            </button>
          ))}
        </div>
      </div>

      {/* PARTICIPANTS & PRIVACY CONSENT STRIP */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 scrollbar-none">
        <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider mr-1">Tuning Circle:</span>
        {session.participants.map(p => (
          <div
            key={p.userId}
            className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs flex-shrink-0 transition-all ${
              p.preferenceContributionEnabled 
                ? 'bg-purple-500/15 border-purple-500/30 text-purple-200' 
                : 'bg-white/5 border-white/10 text-white/40 opacity-60'
            }`}
          >
            <InitialAvatar name={p.displayName || p.username} size="sm" />
            <span className="font-semibold">@{p.username}</span>
            {p.userId === currentUser?.uid && (
              <button
                type="button"
                onClick={() => handleTogglePreference(p.userId)}
                className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Pause or resume your taste signal contribution"
              >
                {p.preferenceContributionEnabled ? 'Active' : 'Paused'}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* TASTE FEED & EDITABLE SEEDS PANEL */}
      {isSeedsPanelOpen && (
        <div className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] border border-purple-500/30 backdrop-blur-3xl shadow-2xl space-y-4 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white tracking-wide">Circle Seeds</h3>
              </div>
            </div>
            <button
              type="button"
              disabled={isRegeneratingSeeds}
              onClick={handleRegenerateFromSeeds}
              className="px-4 py-2 rounded-2xl bg-purple-500 hover:bg-purple-400 text-white font-bold text-xs shadow-lg shadow-purple-500/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegeneratingSeeds ? 'animate-spin' : ''}`} />
              <span>{isRegeneratingSeeds ? 'Refreshing...' : 'Refresh Radio'}</span>
            </button>
          </div>

          {/* Seeds Chips Grid */}
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
            {(session.seeds || []).map(seed => (
              <div
                key={seed.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border text-xs transition-all ${
                  seed.enabled
                    ? 'bg-purple-500/15 border-purple-400/40 text-white shadow-md'
                    : 'bg-white/5 border-white/10 text-white/40 line-through opacity-60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggleSeed(seed.id)}
                  className="flex items-center gap-1.5 cursor-pointer text-left"
                  title="Toggle this seed"
                >
                  <span className={`w-2 h-2 rounded-full ${seed.enabled ? 'bg-purple-400 animate-pulse' : 'bg-white/30'}`} />
                  <span className="font-bold">{seed.label}</span>
                  {seed.sourceUsername && (
                    <span className="text-[10px] font-mono text-purple-300/80">
                      (@{seed.sourceUsername})
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveSeed(seed.id)}
                  className="text-white/40 hover:text-red-400 transition-colors cursor-pointer ml-1"
                  title="Remove seed"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {(!session.seeds || session.seeds.length === 0) && (
              <p className="text-xs text-white/40 py-2">No seeds available. Add custom artist or genre seeds below:</p>
            )}
          </div>

          {/* Add Custom Seed Form */}
          <form onSubmit={handleAddCustomSeed} className="flex items-center gap-2 pt-2 border-t border-white/10">
            <input
              type="text"
              value={newSeedInput}
              onChange={(e) => setNewSeedInput(e.target.value)}
              placeholder="Add custom artist, genre, or sound to Circle Feed..."
              className="flex-1 px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-purple-400 transition-all"
            />
            <button
              type="submit"
              disabled={!newSeedInput.trim()}
              className="px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/20 disabled:opacity-30 border border-white/15 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Seed</span>
            </button>
          </form>
        </div>
      )}

      {/* CURRENT RECOMMENDATION HERO CARD (Spacious Mobile & Desktop Player) */}
      {currentCandidate ? (
        <div className="p-5 sm:p-8 rounded-3xl bg-gradient-to-b from-purple-500/15 via-black/75 to-black/92 border border-purple-400/25 shadow-2xl relative overflow-hidden flex flex-col items-center text-center">
          {/* Why this was picked badge — wraps cleanly on narrow mobile screens */}
          <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3.5 py-1.5 rounded-2xl bg-purple-500/20 border border-purple-400/30 text-purple-100 text-[11px] sm:text-xs font-semibold mb-5 shadow-lg max-w-full">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-300 flex-shrink-0" />
              <span>{currentCandidate.explanation}</span>
            </span>
            <span className="text-[10px] font-mono font-bold text-purple-200/80 px-2 py-0.5 rounded-full bg-black/30 border border-white/10 flex-shrink-0">
              {currentCandidate.rankScore}% match
            </span>
          </div>

          {/* Spacious Album Artwork */}
          <div className="w-44 h-44 sm:w-56 sm:h-56 rounded-3xl overflow-hidden bg-black/60 border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.75)] relative flex items-center justify-center mb-5 group">
            <CoverImage
              src={currentCandidate.track.artworkUrl || null}
              alt={currentCandidate.track.title}
              title={currentCandidate.track.title}
              artist={currentCandidate.track.artist}
              size={300}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Song Details — full-width 2-line clamp so long titles are always legible */}
          <div className="w-full max-w-md px-1">
            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-snug line-clamp-2">
              {currentCandidate.track.title}
            </h3>
            <p className="text-sm text-white/65 truncate mt-1">
              {currentCandidate.track.artist}
            </p>
          </div>

          {/* Spacious Player Controls */}
          <div className="w-full max-w-sm flex flex-col items-center gap-5 mt-6">
            {/* Row 1: Primary Audio Playback & Skip Controls */}
            <div className="flex items-center justify-center gap-6 sm:gap-8 w-full">
              {/* Like (Quick reaction) */}
              <button
                type="button"
                onClick={() => handleFeedback('like')}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full border flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-lg ${
                  userFeedback === 'like' 
                    ? 'bg-rose-500 text-white border-rose-400 shadow-rose-500/30' 
                    : 'bg-white/[0.07] hover:bg-white/15 text-white/80 hover:text-rose-400 border-white/15'
                }`}
                title="Like recommendation"
              >
                <Heart className={`w-5 h-5 sm:w-6 sm:h-6 ${userFeedback === 'like' ? 'fill-white' : ''}`} />
              </button>

              {/* Central Big Play / Pause Button (properly toggles pause without restarting!) */}
              <button
                type="button"
                onClick={() => {
                  if (currentTrack?.id === currentCandidate.track.id && onTogglePlay) {
                    onTogglePlay();
                  } else {
                    onPlayTrack(currentCandidate.track);
                  }
                }}
                className="w-16 h-16 sm:w-[70px] sm:h-[70px] rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center shadow-[0_12px_36px_rgba(255,255,255,0.28)] cursor-pointer"
                title={isPlaying && currentTrack?.id === currentCandidate.track.id ? 'Pause track' : 'Play track'}
              >
                {isPlaying && currentTrack?.id === currentCandidate.track.id ? (
                  <Pause className="w-7 h-7 fill-black" />
                ) : (
                  <Play className="w-7 h-7 fill-black ml-1" />
                )}
              </button>

              {/* Skip Next Button */}
              <button
                type="button"
                onClick={handleNextTrack}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-purple-500/25 hover:bg-purple-500/35 text-purple-100 border border-purple-400/40 flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-lg"
                title="Skip next"
              >
                {isReplenishing ? (
                  <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
                ) : (
                  <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
                )}
              </button>
            </div>

            {/* Row 2: Equal 3-Column Taste Feedback Tiles (zero cramping on mobile!) */}
            <div className="grid grid-cols-3 gap-2 w-full">
              {/* Not for me */}
              <button
                type="button"
                onClick={() => handleFeedback('not_for_me')}
                className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2.5 px-2 rounded-2xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                  userFeedback === 'not_for_me' 
                    ? 'bg-amber-500 text-black border-amber-400 shadow-amber-500/30' 
                    : 'bg-white/[0.05] text-white/75 hover:text-amber-300 border-white/10 hover:bg-white/10'
                }`}
                title="Not for me (skips and demotes)"
              >
                <ThumbsDown className="w-4 h-4 flex-shrink-0" />
                <span className="text-[11px] whitespace-nowrap">Pass</span>
              </button>

              {/* Already Know It */}
              <button
                type="button"
                onClick={() => handleFeedback('already_know')}
                className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2.5 px-2 rounded-2xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                  userFeedback === 'already_know' 
                    ? 'bg-cyan-500 text-black border-cyan-400 shadow-cyan-500/30' 
                    : 'bg-white/[0.05] text-white/75 hover:text-cyan-300 border-white/10 hover:bg-white/10'
                }`}
                title="Already Know It (familiarity signal)"
              >
                <Check className="w-4 h-4 flex-shrink-0" />
                <span className="text-[11px] whitespace-nowrap">Know it</span>
              </button>

              {/* Save */}
              <button
                type="button"
                onClick={() => handleFeedback('save')}
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2.5 px-2 rounded-2xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer bg-white/[0.05] text-white/75 hover:text-emerald-300 border-white/10 hover:bg-white/10"
                title="Save to My Liked Songs"
              >
                <FolderPlus className="w-4 h-4 flex-shrink-0" />
                <span className="text-[11px] whitespace-nowrap">Save</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center text-white/40">
          <Disc3 className="w-8 h-8 mx-auto mb-2 opacity-30 text-purple-400" />
          <p className="text-sm">Circle Radio queue completed. Replenishing fresh recommendations...</p>
        </div>
      )}

      {/* UPCOMING CANDIDATE DISCOVERY QUEUE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white tracking-wide">
              Upcoming Circle Discoveries ({session.candidates.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!session) return;
              setIsReplenishing(true);
              const fresh = await CircleRadioService.generateCandidateBatch(
                session.id,
                session.discoveryMode,
                session.participants,
                session.batchCount + 1
              );
              const updated: CircleRadioSession = {
                ...session,
                candidates: [...session.candidates, ...fresh],
                batchCount: session.batchCount + 1,
                updatedAt: Date.now()
              };
              setSession(updated);
              await CircleRadioService.syncToCloud(updated);
              setIsReplenishing(false);
              showToast('Added 10 fresh recommendations!');
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-semibold text-white/70 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReplenishing ? 'animate-spin' : ''}`} />
            <span>Replenish Queue</span>
          </button>
        </div>

        <div className="space-y-2">
          {session.candidates.map((cand, idx) => {
            const isCur = cand.id === session.currentCandidateId;
            return (
              <div
                key={cand.id}
                className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                  isCur 
                    ? 'bg-purple-500/15 border-purple-500/40 shadow-lg' 
                    : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="font-mono text-xs font-bold text-white/40 w-5 text-center">
                    #{idx + 1}
                  </span>
                  <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                    <CoverImage
                      src={cand.track.artworkUrl || null}
                      alt={cand.track.title}
                      title={cand.track.title}
                      artist={cand.track.artist}
                      size={60}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs sm:text-sm font-bold text-white truncate">{cand.track.title}</h4>
                      {isCur && (
                        <span className="text-[9px] font-mono font-bold text-purple-300 bg-purple-500/20 px-1.5 py-0.2 rounded">
                          NOW PLAYING
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/60 truncate mt-0.5">{cand.track.artist}</p>
                    <p className="text-[10px] text-purple-300/80 truncate mt-0.5">{cand.explanation}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const updated: CircleRadioSession = {
                        ...session,
                        currentCandidateId: cand.id,
                        updatedAt: Date.now()
                      };
                      setSession(updated);
                      CircleRadioService.syncToCloud(updated);
                      onPlayTrack(cand.track);
                    }}
                    className="p-2 rounded-full bg-white/10 hover:bg-white text-white hover:text-black transition-all cursor-pointer"
                    title="Play track"
                  >
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
