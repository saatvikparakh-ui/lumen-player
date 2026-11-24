import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  HelpCircle, 
  Sparkles, 
  Play, 
  Pause, 
  Check, 
  Heart, 
  Flame, 
  Smile, 
  Zap, 
  Send, 
  Search, 
  Users, 
  Radio, 
  Lock, 
  Eye, 
  ArrowRight, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  Disc3, 
  ShieldAlert, 
  Share2, 
  Volume2, 
  BellRing,
  RotateCcw
} from 'lucide-react';
import { Track } from '../../../types/music';
import { AppUser } from '../../../services/firebaseAuthService';
import { FriendProfileData } from './friendsTypes';
import { 
  BlindDropRound, 
  BlindDropSubmission, 
  BlindDropMode 
} from '../../../types/blindDropTypes';
import { BlindDropService } from '../../../services/blindDropService';
import { StreamingService } from '../../../services/streamingService';
import { LikedService } from '../../../services/likedService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';

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
  currentTrack,
  isPlaying = false,
  dominantColor
}) => {
  const [activeTab, setActiveTab] = useState<'inbox' | 'compose' | 'circle'>('inbox');
  const [rounds, setRounds] = useState<BlindDropRound[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);

  // Compose State
  const [composeMode, setComposeMode] = useState<BlindDropMode>('direct');
  const [selectedFriend, setSelectedFriend] = useState<FriendProfileData | null>(null);
  const [selectedCircleFriends, setSelectedCircleFriends] = useState<Set<string>>(new Set());
  const [circleTitle, setCircleTitle] = useState('');
  const [clueText, setClueText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Guess State
  const [selectedGuessedUserId, setSelectedGuessedUserId] = useState<string | null>(null);
  const [isGuessing, setIsGuessing] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState<string | null>(null);

  // Fetch / Subscribe to Rounds
  const refreshRounds = () => {
    if (!currentUser) return;
    const userRounds = BlindDropService.getUserRounds(currentUser.uid);
    setRounds(userRounds);
    if (!selectedRoundId && userRounds.length > 0) {
      setSelectedRoundId(userRounds[0].id);
    }
  };

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    refreshRounds();

    const unsub = BlindDropService.subscribeToUserDrops(currentUser.uid, (updated) => {
      setRounds(updated);
    });

    return () => unsub();
  }, [isOpen, currentUser?.uid]);

  // Selected Active Round & Submission
  const activeRound = useMemo(() => {
    return rounds.find(r => r.id === selectedRoundId) || rounds[0] || null;
  }, [rounds, selectedRoundId]);

  const activeSubmission = useMemo(() => {
    return activeRound?.submissions[0] || null;
  }, [activeRound]);

  // Candidate guess friends: only real connected friends & actual round participants
  const eligibleGuessFriends = useMemo(() => {
    const baseList: FriendProfileData[] = friends && friends.length > 0 ? [...friends] : [];
    if (activeRound) {
      activeRound.participants.forEach(p => {
        if (!baseList.some(b => b.userId === p.userId)) {
          baseList.push({
            userId: p.userId,
            username: p.username,
            displayName: p.displayName || p.username,
            photoURL: p.photoURL || undefined,
            isOnline: true
          });
        }
      });
      if (activeSubmission?.senderUserId && !baseList.some(b => b.userId === activeSubmission.senderUserId)) {
        baseList.push({
          userId: activeSubmission.senderUserId,
          username: activeSubmission.senderUsername || 'friend',
          displayName: activeSubmission.senderDisplayName || activeSubmission.senderUsername || 'Friend',
          isOnline: true
        });
      }
    }
    return baseList;
  }, [activeRound, activeSubmission, friends]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  // Search tracks for composition
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await StreamingService.searchTracks(query);
      setSearchResults(results.slice(0, 8));
    } catch (_) {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Send Direct or Circle Drop
  const handleSendDrop = async () => {
    if (!currentUser) {
      showToast('Please sign in to send a Blind Drop');
      return;
    }
    if (!selectedTrack) {
      showToast('Select a song to send');
      return;
    }

    setIsSending(true);
    WatchSoundService.playTick(1.2);

    try {
      if (composeMode === 'direct') {
        if (!selectedFriend) {
          showToast('Choose a friend recipient');
          setIsSending(false);
          return;
        }

        const res = await BlindDropService.createDirectDrop(
          currentUser,
          selectedFriend,
          selectedTrack,
          clueText
        );

        if (res.success && res.round) {
          showToast(`Blind Drop delivered to @${selectedFriend.username}!`);
          refreshRounds();
          setSelectedRoundId(res.round.id);
          setActiveTab('inbox');
          // Reset form
          setSelectedTrack(null);
          setClueText('');
          setSelectedFriend(null);
          setSearchQuery('');
        } else {
          showToast(res.error || 'Failed to send Blind Drop');
        }
      } else {
        // Circle Drop
        const circleFriendsList = friends.filter(f => selectedCircleFriends.has(f.userId));
        if (circleFriendsList.length === 0) {
          showToast('Select at least 1 friend for Circle Drop');
          setIsSending(false);
          return;
        }

        const res = await BlindDropService.createCircleDrop(
          currentUser,
          circleTitle || 'Friends Music Mystery Circle',
          circleFriendsList
        );

        if (res.success && res.round) {
          // Submit host's track immediately
          await BlindDropService.submitTrackToCircle(
            res.round.id,
            currentUser,
            selectedTrack,
            clueText
          );
          showToast('Circle Drop created with anonymous submissions!');
          refreshRounds();
          setSelectedRoundId(res.round.id);
          setActiveTab('circle');
          setSelectedTrack(null);
          setClueText('');
        } else {
          showToast(res.error || 'Failed to create Circle Drop');
        }
      }
    } catch (e: any) {
      showToast(e.message || 'Error sending drop');
    } finally {
      setIsSending(false);
    }
  };

  // Submit Guess
  const handleGuess = async () => {
    if (!activeRound || !activeSubmission || !currentUser || !selectedGuessedUserId) return;
    const guessedFriend = eligibleGuessFriends.find(f => f.userId === selectedGuessedUserId);
    if (!guessedFriend) return;

    setIsGuessing(true);
    WatchSoundService.playTick(1.2);

    try {
      const res = await BlindDropService.submitGuess(
        activeRound.id,
        activeSubmission.id,
        currentUser,
        guessedFriend
      );

      if (res.success) {
        if (res.isCorrect) {
          setGuessFeedback('🎉 Spot on! You correctly identified who dropped this track!');
        } else {
          setGuessFeedback(`Guess recorded for @${guessedFriend.username}! Reveal whenever you are ready.`);
        }
        refreshRounds();
      } else {
        showToast(res.error || 'Could not record guess');
      }
    } catch (err: any) {
      showToast(err.message || 'Error submitting guess');
    } finally {
      setIsGuessing(false);
    }
  };

  // Reveal Sender
  const handleReveal = async () => {
    if (!activeRound || !currentUser) return;
    WatchSoundService.playTick(1.4);

    const res = await BlindDropService.revealRound(activeRound.id, currentUser);
    if (res.success) {
      showToast('✨ Mystery Revealed!');
      refreshRounds();
    } else {
      showToast(res.error || 'Could not reveal drop');
    }
  };

  // React to Drop
  const handleReact = async (reaction: string) => {
    if (!activeRound || !activeSubmission || !currentUser) return;
    WatchSoundService.playTick(1.1);
    await BlindDropService.reactToSubmission(activeRound.id, activeSubmission.id, currentUser, reaction);
    refreshRounds();
    showToast(`Reacted with ${reaction}!`);
  };

  // Save Track to Liked
  const handleSaveTrack = (track: Track) => {
    LikedService.addTrack(track);
    WatchSoundService.playTick(1.2);
    showToast(`Saved "${track.title}" to your Liked Songs!`);
  };

  if (!isOpen) return null;

  const isRevealed = activeRound?.status === 'revealed' || activeRound?.status === 'completed';
  const myGuess = currentUser && activeSubmission?.guesses ? activeSubmission.guesses[currentUser.uid] : null;
  const isSender = Boolean(currentUser && (activeRound?.hostUserId === currentUser.uid || activeSubmission?.senderUserId === currentUser.uid));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-6 bg-black/80 backdrop-blur-2xl animate-fadeIn">
      <div 
        className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl overflow-hidden backdrop-blur-3xl border border-white/20 shadow-2xl relative"
        style={{
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.04) 45%, rgba(0, 0, 0, 0.85) 100%)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(6, 182, 212, 0.25)'
        }}
      >
        {/* Glow Accent */}
        <div 
          className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full filter blur-3xl opacity-20"
          style={{ backgroundColor: dominantColor || '#63E8FF' }}
        />

        {/* HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-5 border-b border-white/10 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl apple-glass-icon flex items-center justify-center text-lumen-cyan flex-shrink-0">
                <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
                  Blind Drop
                </h3>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Mystery Music
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-all active:scale-95 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            {/* Tab switchers */}
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/5 border border-white/10 w-full sm:w-auto overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveTab('inbox')}
                className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'inbox' 
                    ? 'bg-white/20 text-white border border-white/30 backdrop-blur-2xl shadow-[0_4px_20px_rgba(6,182,212,0.3),inset_0_1px_1px_rgba(255,255,255,0.4)]' 
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>Received</span>
                {rounds.length > 0 && (
                  <span className={`text-[10px] font-mono px-1.5 rounded-full ${
                    activeTab === 'inbox' ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/30' : 'bg-white/10 text-white'
                  }`}>
                    {rounds.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('compose')}
                className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap ${
                  activeTab === 'compose' 
                    ? 'bg-white/20 text-white border border-white/30 backdrop-blur-2xl shadow-[0_4px_20px_rgba(6,182,212,0.3),inset_0_1px_1px_rgba(255,255,255,0.4)]' 
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <Send className="w-3 h-3" />
                <span>Drop a Song</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('circle')}
                className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap ${
                  activeTab === 'circle' 
                    ? 'bg-white/20 text-white border border-white/30 backdrop-blur-2xl shadow-[0_4px_20px_rgba(6,182,212,0.3),inset_0_1px_1px_rgba(255,255,255,0.4)]' 
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <Users className="w-3 h-3" />
                <span>Circle Lobby</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="hidden sm:flex p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-all active:scale-95 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* TOAST ALERT */}
        {toastMsg && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/90 border border-white/20 text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-fadeIn backdrop-blur-xl">
            <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* MODAL CONTENT */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-28 sm:pb-8 space-y-6 scrollbar-thin">
          {/* ============================================================== */}
          {/* TAB 1: INBOX & GUESSING CAROUSEL                              */}
          {/* ============================================================== */}
          {activeTab === 'inbox' && (
            <div className="space-y-6">
              {rounds.length === 0 ? (
                <div className="py-16 text-center text-white/40 max-w-sm mx-auto space-y-3">
                  <div className="w-16 h-16 rounded-3xl apple-glass-icon mx-auto flex items-center justify-center text-cyan-300">
                    <Disc3 className="w-8 h-8 opacity-40 animate-pulse" />
                  </div>
                  <h4 className="text-base font-bold text-white">No Blind Drops Yet</h4>
                  <p className="text-xs text-white/50 leading-relaxed">
                    Be the first! Drop an anonymous track recommendation to a friend with a clever clue.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('compose')}
                    className="px-5 py-2.5 rounded-2xl apple-glass-btn text-xs font-bold text-black bg-white inline-flex items-center gap-2 shadow-lg"
                  >
                    <Send className="w-3.5 h-3.5 text-black" />
                    <span>Send Your First Drop</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Round Selector Sidebar */}
                  <div className="lg:col-span-4 space-y-2">
                    <div className="text-[11px] font-mono font-bold text-white/40 uppercase tracking-wider px-1">
                      Your Drops ({rounds.length})
                    </div>
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
                      {rounds.map(r => {
                        const isCur = r.id === activeRound?.id;
                        const sub = r.submissions[0];
                        const rRevealed = r.status === 'revealed' || r.status === 'completed';
                        return (
                          <div
                            key={r.id}
                            onClick={() => {
                              WatchSoundService.playTick(1.0);
                              setSelectedRoundId(r.id);
                              setGuessFeedback(null);
                            }}
                            className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                              isCur 
                                ? 'bg-cyan-500/15 border-cyan-400/40 shadow-lg' 
                                : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10'
                            }`}
                          >
                            <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0 flex items-center justify-center">
                              {sub?.track ? (
                                <CoverImage
                                  src={sub.track.artworkUrl || null}
                                  alt={sub.track.title}
                                  size={40}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <HelpCircle className="w-5 h-5 text-cyan-300 opacity-60" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between">
                                <h5 className="text-xs font-bold text-white truncate">
                                  {sub?.track?.title || r.title}
                                </h5>
                                <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                                  rRevealed 
                                    ? 'bg-emerald-500/20 text-emerald-300' 
                                    : 'bg-amber-500/20 text-amber-300'
                                }`}>
                                  {rRevealed ? 'Revealed' : 'Mystery'}
                                </span>
                              </div>
                              <p className="text-[10px] text-white/50 truncate mt-0.5">
                                {r.mode === 'direct' ? '1-on-1 Direct' : 'Circle Round'} • {sub?.track?.artist || 'Unknown'}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Active Drop Hero & Guessing Board */}
                  <div className="lg:col-span-8 space-y-5">
                    {activeSubmission ? (
                      <div className="p-6 sm:p-7 rounded-3xl apple-glass-card-interactive border border-white/15 relative overflow-hidden space-y-6">
                        {/* Status Header Strip */}
                        <div className="flex items-center justify-between">
                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-semibold">
                            {isRevealed ? (
                              <>
                                <Eye className="w-3.5 h-3.5 text-cyan-300" />
                                <span>Revealed Drop</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3.5 h-3.5 text-cyan-300" />
                                <span>Anonymous Drop • Sender Hidden</span>
                              </>
                            )}
                          </div>

                          <span className="text-[11px] font-mono text-white/40">
                            {new Date(activeSubmission.submittedAt).toLocaleDateString()}
                          </span>
                        </div>

                        {/* Song Presentation Card */}
                        <div className="flex flex-col sm:flex-row items-center gap-5">
                          <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden bg-black/60 border border-white/20 shadow-2xl relative flex-shrink-0 group">
                            <CoverImage
                              src={activeSubmission.track.artworkUrl || null}
                              alt={activeSubmission.track.title}
                              title={activeSubmission.track.title}
                              artist={activeSubmission.track.artist}
                              size={200}
                              className="w-full h-full object-cover"
                            />
                            {/* Hover Play Overlay */}
                            <button
                              type="button"
                              onClick={() => onPlayTrack(activeSubmission.track)}
                              className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            >
                              <div className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-xl">
                                {isPlaying && currentTrack?.id === activeSubmission.track.id ? (
                                  <Pause className="w-6 h-6 fill-black" />
                                ) : (
                                  <Play className="w-6 h-6 fill-black ml-1" />
                                )}
                              </div>
                            </button>
                          </div>

                          <div className="min-w-0 flex-1 text-center sm:text-left space-y-2">
                            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight truncate">
                              {activeSubmission.track.title}
                            </h3>
                            <p className="text-sm text-white/60 font-semibold truncate">
                              {activeSubmission.track.artist}
                            </p>
                            {activeSubmission.track.album && (
                              <p className="text-xs text-white/40 truncate">
                                {activeSubmission.track.album}
                              </p>
                            )}

                            {/* Play Action Button */}
                            <div className="pt-2 flex items-center justify-center sm:justify-start gap-2">
                              <button
                                type="button"
                                onClick={() => onPlayTrack(activeSubmission.track)}
                                className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs flex items-center gap-2 hover:bg-white/90 active:scale-95 transition-all shadow-md cursor-pointer"
                              >
                                {isPlaying && currentTrack?.id === activeSubmission.track.id ? (
                                  <>
                                    <Pause className="w-3.5 h-3.5 fill-black" />
                                    <span>Pause Snippet</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="w-3.5 h-3.5 fill-black" />
                                    <span>Play Track</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSaveTrack(activeSubmission.track)}
                                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-rose-400 border border-white/10 transition-all cursor-pointer"
                                title="Save to Liked Songs"
                              >
                                <Heart className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Friend's Mystery Clue */}
                        {activeSubmission.clue && (
                          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                            <Sparkles className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono font-bold text-amber-300 uppercase tracking-wider">
                                Sender's Clue
                              </div>
                              <p className="text-xs text-amber-100 italic mt-0.5">
                                "{activeSubmission.clue}"
                              </p>
                            </div>
                          </div>
                        )}

                        {/* REVEALED STATE DISPLAY */}
                        {isRevealed ? (
                          <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-white/[0.04] to-transparent border border-emerald-500/30 space-y-4 animate-fadeIn">
                            <div className="flex items-center gap-3">
                              <InitialAvatar
                                name={activeSubmission.senderDisplayName || activeSubmission.senderUsername || 'Friend'}
                                size="lg"
                              />
                              <div>
                                <div className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider">
                                  Track Selected By
                                </div>
                                <h4 className="text-base font-bold text-white">
                                  {activeSubmission.senderDisplayName || activeSubmission.senderUsername}
                                </h4>
                                <span className="text-xs text-white/50">
                                  @{activeSubmission.senderUsername}
                                </span>
                              </div>
                            </div>

                            {/* Guess Comparison */}
                            {myGuess && (
                              <div className="p-3 rounded-xl bg-black/40 border border-white/10 text-xs">
                                {myGuess.isCorrect ? (
                                  <p className="text-emerald-300 font-semibold flex items-center gap-1.5">
                                    <Check className="w-4 h-4 text-emerald-400" />
                                    <span>You guessed correctly! It was @{myGuess.guessedUsername}.</span>
                                  </p>
                                ) : (
                                  <p className="text-amber-300 flex items-center gap-1.5">
                                    <HelpCircle className="w-4 h-4 text-amber-400" />
                                    <span>You guessed @{myGuess.guessedUsername || 'another friend'}. It was actually @{activeSubmission.senderUsername}!</span>
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Reaction Bar */}
                            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                              <span className="text-xs text-white/50 font-medium mr-1">React:</span>
                              {[
                                { id: '❤️', label: 'Love' },
                                { id: '🔥', label: 'Fire' },
                                { id: '🤯', label: 'Mindblown' },
                                { id: '😂', label: 'Fun' }
                              ].map(emoji => (
                                <button
                                  key={emoji.id}
                                  type="button"
                                  onClick={() => handleReact(emoji.id)}
                                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-sm hover:scale-110 active:scale-95 transition-all cursor-pointer flex items-center gap-1"
                                >
                                  <span>{emoji.id}</span>
                                  <span className="text-[10px] text-white/50 font-mono">
                                    {Object.values(activeSubmission.reactions || {}).filter(r => r === emoji.id).length || ''}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : isSender ? (
                          /* SENDER PERSPECTIVE: Sender cannot guess who sent it; shows drop status and reveal action */
                          <div className="space-y-4 pt-3 border-t border-white/10 animate-fadeIn">
                            <div className="p-4 rounded-2xl bg-white/[0.04] border border-cyan-400/30 backdrop-blur-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 flex items-center justify-center text-cyan-300 flex-shrink-0">
                                  <Send className="w-5 h-5" />
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-white">
                                    You dropped this song to @{activeRound?.participants?.find(p => p.userId !== currentUser?.uid)?.username || 'your friend'}
                                  </div>
                                  <div className="text-[11px] text-white/60">
                                    Waiting for your friend to listen and submit their guess.
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleReveal}
                                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 hover:scale-105 active:scale-95 transition-all shadow-lg cursor-pointer whitespace-nowrap"
                              >
                                Reveal Sender Now
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* RECIPIENT GUESSING STAGE */
                          <div className="space-y-4 pt-2 border-t border-white/10">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Users className="w-4 h-4 text-cyan-400" />
                                <span className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                                  Who Sent This Song?
                                </span>
                              </div>
                              <span className="text-[11px] font-mono text-cyan-300">
                                {selectedGuessedUserId ? 'Friend Selected' : (myGuess ? `Guessed: @${myGuess.guessedUsername}` : 'Pick a friend below')}
                              </span>
                            </div>

                            {guessFeedback && (
                              <div className="p-3 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-xs text-cyan-200">
                                {guessFeedback}
                              </div>
                            )}

                            {/* Eligible Friends Carousel Picker */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                              {eligibleGuessFriends.map(f => {
                                const isPicked = selectedGuessedUserId === f.userId;
                                return (
                                  <button
                                    key={f.userId}
                                    type="button"
                                    onClick={() => {
                                      WatchSoundService.playTick(1.0);
                                      setSelectedGuessedUserId(f.userId);
                                    }}
                                    className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                                      isPicked 
                                        ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-md -translate-y-0.5' 
                                        : 'bg-white/[0.03] hover:bg-white/[0.07] border-white/10 text-white/70 hover:text-white'
                                    }`}
                                  >
                                    <InitialAvatar
                                      name={f.displayName || f.username}
                                      size="sm"
                                      isOnline={f.isOnline}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-bold truncate">
                                        {f.displayName || f.username}
                                      </div>
                                      <div className="text-[10px] text-white/40 truncate">
                                        @{f.username}
                                      </div>
                                    </div>
                                    {isPicked && (
                                      <Check className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Guess Action Controls */}
                            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                              <button
                                type="button"
                                onClick={handleReveal}
                                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs font-semibold border border-white/10 cursor-pointer"
                              >
                                Reveal Sender Now
                              </button>

                              <button
                                type="button"
                                disabled={!selectedGuessedUserId || isGuessing}
                                onClick={handleGuess}
                                className="px-6 py-2.5 rounded-2xl apple-glass-btn text-black font-bold text-xs bg-white hover:bg-white/90 active:scale-95 transition-all shadow-xl cursor-pointer disabled:opacity-40 flex items-center gap-2"
                              >
                                <Check className="w-4 h-4 text-black" />
                                <span>{isGuessing ? 'Recording Guess...' : 'Submit Guess'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="py-12 text-center text-white/40">
                        Select a drop from the sidebar
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: COMPOSE NEW BLIND DROP                                 */}
          {/* ============================================================== */}
          {activeTab === 'compose' && (
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Mode Toggle: Direct vs Circle */}
              <div className="grid grid-cols-2 gap-3 p-1 rounded-2xl bg-white/5 border border-white/10">
                <button
                  type="button"
                  onClick={() => setComposeMode('direct')}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    composeMode === 'direct' 
                      ? 'bg-white/20 text-white border border-white/30 backdrop-blur-2xl shadow-[0_4px_20px_rgba(6,182,212,0.3),inset_0_1px_1px_rgba(255,255,255,0.4)]' 
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Direct Drop (1 Friend)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setComposeMode('circle')}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    composeMode === 'circle' 
                      ? 'bg-white/20 text-white border border-white/30 backdrop-blur-2xl shadow-[0_4px_20px_rgba(6,182,212,0.3),inset_0_1px_1px_rgba(255,255,255,0.4)]' 
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Circle Drop (Group Round)</span>
                </button>
              </div>

              {/* 1. Recipient Selection */}
              {composeMode === 'direct' ? (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                    Select Friend Recipient
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1 scrollbar-thin">
                    {friends.map(f => {
                      const isSel = selectedFriend?.userId === f.userId;
                      return (
                        <div
                          key={f.userId}
                          onClick={() => {
                            WatchSoundService.playTick(1.0);
                            setSelectedFriend(f);
                          }}
                          className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center gap-2.5 ${
                            isSel 
                              ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-md' 
                              : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-white/70 hover:text-white'
                          }`}
                        >
                          <InitialAvatar name={f.displayName || f.username} size="sm" isOnline={f.isOnline} />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold truncate">{f.displayName || f.username}</div>
                            <div className="text-[10px] text-white/40 truncate">@{f.username}</div>
                          </div>
                          {isSel && <Check className="w-3.5 h-3.5 text-cyan-300" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                    Circle Name & Friends
                  </label>
                  <input
                    type="text"
                    value={circleTitle}
                    onChange={(e) => setCircleTitle(e.target.value)}
                    placeholder="e.g. Midnight Discovery Circle"
                    className="w-full px-4 py-2.5 rounded-2xl bg-white/5 border border-white/15 text-white text-xs placeholder-white/30 focus:outline-none focus:border-cyan-400"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1 scrollbar-thin">
                    {friends.map(f => {
                      const isChecked = selectedCircleFriends.has(f.userId);
                      return (
                        <div
                          key={f.userId}
                          onClick={() => {
                            WatchSoundService.playTick(1.0);
                            setSelectedCircleFriends(prev => {
                              const next = new Set(prev);
                              if (next.has(f.userId)) next.delete(f.userId);
                              else next.add(f.userId);
                              return next;
                            });
                          }}
                          className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center gap-2.5 ${
                            isChecked 
                              ? 'bg-cyan-500/20 border-cyan-400 text-white' 
                              : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-white/70 hover:text-white'
                          }`}
                        >
                          <InitialAvatar name={f.displayName || f.username} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold truncate">{f.displayName || f.username}</div>
                          </div>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                            isChecked ? 'bg-cyan-500 border-cyan-400' : 'border-white/20'
                          }`}>
                            {isChecked && <Check className="w-3 h-3 text-black stroke-[3]" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Song Search & Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                  Pick Song to Drop
                </label>
                {selectedTrack ? (
                  <div className="p-3.5 rounded-2xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/60 border border-white/20 flex-shrink-0">
                        <CoverImage src={selectedTrack.artworkUrl || null} alt={selectedTrack.title} size={44} />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-bold text-white truncate">{selectedTrack.title}</h4>
                        <p className="text-[11px] text-white/60 truncate">{selectedTrack.artist}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedTrack(null)}
                      className="px-3 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Search song title or artist..."
                        className="w-full pl-9 pr-4 py-2.5 rounded-2xl bg-white/5 border border-white/15 text-white text-xs placeholder-white/30 focus:outline-none focus:border-cyan-400"
                      />
                    </div>

                    {searchResults.length > 0 && (
                      <div className="space-y-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                        {searchResults.map(track => (
                          <div
                            key={track.id}
                            onClick={() => {
                              WatchSoundService.playTick(1.0);
                              setSelectedTrack(track);
                            }}
                            className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 flex items-center justify-between cursor-pointer group"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-lg overflow-hidden bg-black/60 flex-shrink-0">
                                <CoverImage src={track.artworkUrl || null} alt={track.title} size={32} />
                              </div>
                              <div className="min-w-0">
                                <h5 className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors truncate">
                                  {track.title}
                                </h5>
                                <p className="text-[10px] text-white/50 truncate">{track.artist}</p>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                              Select
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 3. Short Clue Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                    Add a Clue (Optional)
                  </label>
                  <span className="text-[10px] font-mono text-white/40">
                    {clueText.length}/120
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={120}
                  value={clueText}
                  onChange={(e) => setClueText(e.target.value)}
                  placeholder="e.g. Remember that road trip in July? Or: This sounds like your 2am vibe."
                  className="w-full px-4 py-2.5 rounded-2xl bg-white/5 border border-white/15 text-white text-xs placeholder-white/30 focus:outline-none focus:border-cyan-400"
                />
              </div>

              {/* Submit Button */}
              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  disabled={isSending || !selectedTrack}
                  onClick={handleSendDrop}
                  className="px-8 py-3 rounded-2xl apple-glass-btn text-black font-bold text-xs bg-white hover:bg-white/90 active:scale-95 transition-all shadow-xl cursor-pointer disabled:opacity-40 flex items-center gap-2"
                >
                  <Send className="w-4 h-4 text-black" />
                  <span>
                    {isSending 
                      ? 'Delivering Mystery...' 
                      : composeMode === 'direct' 
                        ? 'Send Blind Drop' 
                        : 'Launch Circle Drop'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: CIRCLE ROUNDS LOBBY                                    */}
          {/* ============================================================== */}
          {activeTab === 'circle' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white">Circle Drop Rounds</h4>
                  <p className="text-xs text-white/50">
                    Group discovery rounds where every invited friend submits one track anonymously.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setComposeMode('circle');
                    setActiveTab('compose');
                  }}
                  className="px-4 py-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-bold hover:bg-cyan-500/30 transition-all cursor-pointer"
                >
                  + New Circle Round
                </button>
              </div>

              {rounds.filter(r => r.mode === 'circle').length === 0 ? (
                <div className="py-12 text-center text-white/40">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30 text-cyan-400" />
                  <p className="text-xs">No active circle rounds yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {rounds.filter(r => r.mode === 'circle').map(round => (
                    <div
                      key={round.id}
                      onClick={() => {
                        setSelectedRoundId(round.id);
                        setActiveTab('inbox');
                      }}
                      className="p-4 rounded-2xl apple-glass-card-interactive border border-white/10 cursor-pointer space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded-full">
                          {round.status}
                        </span>
                        <span className="text-[10px] font-mono text-white/40">
                          {round.submissions.length} / {round.participants.length} submitted
                        </span>
                      </div>
                      <h5 className="text-sm font-bold text-white truncate">{round.title}</h5>
                      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
                        {round.participants.map(p => (
                          <InitialAvatar key={p.userId} name={p.displayName || p.username} size="sm" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
