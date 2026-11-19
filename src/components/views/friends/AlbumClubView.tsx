import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Disc3, 
  Play, 
  Pause, 
  Check, 
  Lock, 
  Unlock, 
  Star, 
  Sparkles, 
  Clock, 
  Headphones, 
  Crown, 
  ChevronDown, 
  History, 
  Share2, 
  Send, 
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  ThumbsUp,
  MessageSquare,
  TrendingUp,
  Flame,
  Award,
  RefreshCw,
  Plus,
  Trash2
} from 'lucide-react';
import { 
  AlbumClub, 
  ClubMember, 
  WeeklyCycle, 
  AlbumNomination, 
  MemberReview, 
  ClubTrack,
  ClubCycleVerdict
} from '../../../types/albumClubTypes';
import { AlbumClubService } from '../../../services/albumClubService';
import { SupabaseService } from '../../../services/supabaseService';
import { FirestoreService } from '../../../services/firestoreService';
import { ArtistService } from '../../../services/artistService';
import { StreamingService } from '../../../services/streamingService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { AudioEngine } from '../../../services/audioEngine';
import { Track } from '../../../types/music';

interface AlbumClubViewProps {
  clubId: string;
  onBack: () => void;
  currentUser: {
    uid?: string;
    id?: string;
    username?: string | null;
    displayName?: string | null;
    photoURL?: string | null;
  };
  onPlayTrack?: (track: Track) => void;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onOpenNominateModal?: () => void;
  onCreateClub?: () => void;
  onDeleteClub?: (clubId: string) => void;
  dominantColor?: string;
}

export const AlbumClubView: React.FC<AlbumClubViewProps> = ({
  clubId,
  onBack,
  currentUser,
  onPlayTrack,
  currentTrack,
  isPlaying,
  onOpenNominateModal,
  onCreateClub,
  onDeleteClub,
  dominantColor
}) => {
  const [club, setClub] = useState<AlbumClub | null>(null);
  const [activeTab, setActiveTab] = useState<'current' | 'archive'>('current');
  const [selectedArchiveWeek, setSelectedArchiveWeek] = useState<number | null>(null);

  // User's in-progress review form state
  const [userAlbumScore, setUserAlbumScore] = useState<number>(8.5);
  const [userFavTrackId, setUserFavTrackId] = useState<string>('');
  const [userTrackScores, setUserTrackScores] = useState<Record<string, number>>({});
  const [userReviewNote, setUserReviewNote] = useState<string>('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [isEditingReview, setIsEditingReview] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Dedicated Track Rating Mode State
  const [ratingTrackId, setRatingTrackId] = useState<string | null>(null);
  const [activeTrackScore, setActiveTrackScore] = useState<number>(8.5);

  const myId = currentUser.uid || currentUser.id || 'current_user';
  const myUsername = (currentUser.username || 'me').replace(/^@/, '');
  const myDisplayName = currentUser.displayName || myUsername;

  // Load club state and check countdown expiration
  const refreshClub = () => {
    let loaded = AlbumClubService.getClubById(clubId, myId);
    if (!loaded) {
      const allClubs = AlbumClubService.getClubs(myId);
      if (allClubs.length > 0) {
        loaded = allClubs[0];
      }
    }
    if (loaded) {
      setClub(loaded);
      // Pre-fill existing review if user already submitted
      const myExistingReview = loaded.currentCycle?.secretReviews?.[myId];
      if (myExistingReview) {
        setUserAlbumScore(myExistingReview.albumRating || 8.5);
        setUserFavTrackId(myExistingReview.favoriteTrackId || '');
        // Preserve any in-progress ratings while merging stored review ratings
        setUserTrackScores(prev => ({ ...(myExistingReview.trackRatings || {}), ...prev }));
        setUserReviewNote(myExistingReview.reviewText || '');
      } else if (loaded.currentCycle?.nomination?.tracks?.length) {
        // Default favorite track to first track if not selected
        if (!userFavTrackId) {
          setUserFavTrackId(loaded.currentCycle.nomination.tracks[0].id);
        }
      }

      // If local club does not have active nomination, fetch remote state to ensure we didn't miss nomination
      if (!loaded.currentCycle?.nomination && clubId) {
        SupabaseService.fetchClubById(clubId).then((remote) => {
          if (remote?.currentCycle?.nomination) {
            AlbumClubService.saveClub(remote);
            setClub(remote);
          }
        }).catch(() => {});
      }
    } else {
      if (clubId) {
        SupabaseService.fetchClubById(clubId).then((remote) => {
          if (remote) {
            AlbumClubService.saveClub(remote);
            setClub(remote);
          } else {
            setClub(null);
          }
        }).catch(() => setClub(null));
      } else {
        setClub(null);
      }
    }
  };

  const clubRef = React.useRef<AlbumClub | null>(club);
  useEffect(() => {
    clubRef.current = club;
  }, [club]);

  useEffect(() => {
    refreshClub();
    const interval = setInterval(refreshClub, 15000); // 15s fallback sync interval
    const unsub = SupabaseService.subscribeToClub(clubId, (liveClub) => {
      if (liveClub && (liveClub.id === clubId || !clubId)) {
        // Crucial: immediately save live club to localStorage so refreshClub never reverts to un-nominated state
        AlbumClubService.saveClub(liveClub);
        setClub(liveClub);
      }
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [clubId, myId]);

  // Audio Engine Telemetry: automatically mark track as Heard strictly when >50% played
  useEffect(() => {
    const unsub = AudioEngine.onTimeUpdate((currentTime, dur) => {
      const curClub = clubRef.current;
      if (!curClub || !curClub.currentCycle?.nomination?.tracks || dur <= 0) return;
      const cur = AudioEngine.getCurrentTrack() || currentTrack;
      if (!cur) return;

      const nomTracks = curClub.currentCycle.nomination.tracks;
      const matched = nomTracks.find(t => 
        t.id === cur.id || 
        (t.title && cur.title && t.title.toLowerCase().trim() === cur.title.toLowerCase().trim())
      );

      if (matched && (currentTime / dur) >= 0.5) {
        const currentListened = new Set(curClub.currentCycle?.memberProgress?.[myId]?.listenedTrackIds || []);
        if (!currentListened.has(matched.id)) {
          const updated = AlbumClubService.toggleTrackListened(curClub.id, myId, matched.id, true);
          if (updated) {
            setClub(updated);
            WatchSoundService.playTick(1.2);
            showToast(`✓ "${matched.title}" marked as Heard (>50% completed)!`);
          }
        }
      }
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [clubId, myId, currentTrack?.id]);

  // Scroll to top on mount to prevent floating topbar overlap
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Self-Healing: Automatically fetch and lock in real tracklist if nominated album has invalid or incomplete tracks
  const [isHealingTracks, setIsHealingTracks] = useState(false);
  useEffect(() => {
    const nom = club?.currentCycle?.nomination;
    if (!club || !nom) return;

    const hasAuthenticTracks = Boolean(
      nom.tracks && 
      nom.tracks.length >= 2 && 
      nom.tracks.some(t => t.title && t.title.trim().length > 0 && !t.title.toLowerCase().startsWith('track ') && t.title !== 'Opening Overture')
    );

    if (!hasAuthenticTracks && !isHealingTracks) {
      let isMounted = true;
      setIsHealingTracks(true);
      (async () => {
        try {
          // Tier 1: ArtistService getAlbumTracks
          let resolved = await ArtistService.getAlbumTracks(nom.albumId, nom.title, nom.artist);

          // Tier 2: Direct public Apple Music search by album title & artist if Tier 1 yielded 0 tracks
          if (!resolved || resolved.length === 0) {
            try {
              const query = encodeURIComponent(`${nom.title} ${nom.artist || ''}`.trim());
              const itunesRes = await fetch(`https://itunes.apple.com/search?term=${query}&entity=album&limit=5`);
              if (itunesRes.ok) {
                const iData = await itunesRes.json();
                const matchedAlbum = (iData.results || []).find((a: any) =>
                  a.collectionName?.toLowerCase().includes(nom.title.toLowerCase()) ||
                  nom.title.toLowerCase().includes(a.collectionName?.toLowerCase() || '')
                ) || iData.results?.[0];

                if (matchedAlbum?.collectionId) {
                  const songRes = await fetch(`https://itunes.apple.com/lookup?id=${matchedAlbum.collectionId}&entity=song&limit=100`);
                  if (songRes.ok) {
                    const sData = await songRes.json();
                    resolved = (sData.results || [])
                      .filter((r: any) => r.wrapperType === 'track')
                      .map((t: any) => StreamingService.mapRawToTrack(t));
                  }
                }
              }
            } catch (_) {}
          }

          // Tier 3: Universal Verified Search fallback
          if (!resolved || resolved.length === 0) {
            try {
              resolved = await StreamingService.searchVerifiedTracks(`${nom.title} ${nom.artist || ''}`);
            } catch (_) {}
          }

          if (isMounted && resolved && resolved.length > 0) {
            const clubTracks: ClubTrack[] = resolved.map((t, idx) => ({
              id: t.id || `t_${idx + 1}`,
              title: t.title,
              artist: t.artist || nom.artist,
              duration: t.duration || 180,
              audioUrl: (t as any).audio_url || undefined,
              artworkUrl: (t as any).artworkUrl || (t as any).artwork_url || nom.artworkUrl || undefined,
              trackNumber: idx + 1
            }));
            const updatedNomination: AlbumNomination = { ...nom, tracks: clubTracks };
            const updatedClub: AlbumClub = {
              ...club,
              currentCycle: {
                ...club.currentCycle!,
                nomination: updatedNomination
              }
            };
            AlbumClubService.saveClub(updatedClub);
            setClub(updatedClub);
            if (!userFavTrackId && clubTracks.length > 0) {
              setUserFavTrackId(clubTracks[0].id);
            }
            SupabaseService.broadcastClubUpdate(updatedClub.id, updatedClub);
            FirestoreService.saveAlbumClub(updatedClub).catch(() => {});
          }
        } catch (e) {
          console.warn('[AlbumClubView] Failed to auto-heal tracks:', e);
        } finally {
          if (isMounted) setIsHealingTracks(false);
        }
      })();
      return () => { isMounted = false; };
    }
  }, [club?.id, club?.currentCycle?.nomination?.albumId, club?.currentCycle?.nomination?.tracks?.length]);

  if (!club) {
    return (
      <div className="w-full min-h-[65vh] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto animate-fadeIn">
        <button
          onClick={onBack}
          className="self-start mb-6 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs border border-white/10 backdrop-blur-md transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Social</span>
        </button>
        <div className="w-16 h-16 rounded-3xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-4 shadow-xl">
          <Disc3 className="w-8 h-8 animate-pulse" />
        </div>
        <h2 className="text-xl font-black text-white mb-2">No Album Club Yet</h2>
        <p className="text-xs text-white/60 leading-relaxed mb-6">
          Listen to one album together every week with friends, rate tracks, write reviews, and reveal ratings together!
        </p>
        <button
          onClick={onCreateClub}
          className="px-6 py-2.5 rounded-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs shadow-lg hover:shadow-purple-500/30 transition-all cursor-pointer"
        >
          + Create Album Club
        </button>
      </div>
    );
  }

  const cycle = club.currentCycle;
  const nomination = cycle?.nomination;
  const stage = cycle?.stage || 'nominate';
  const members = club.members || [];
  const myProgress = cycle?.memberProgress?.[myId] || { listenedTrackIds: [], hasSubmitted: false };
  const hasSubmitted = !!cycle?.secretReviews?.[myId];
  const isCurator = cycle?.curatorMemberId === myId || members.find(m => m.id === myId)?.isCurator;

  // Calculate Countdown
  const now = Date.now();
  const timeRemainingMs = Math.max(0, (cycle?.cycleEndTimestamp || now) - now);
  const daysLeft = Math.ceil(timeRemainingMs / (24 * 60 * 60 * 1000));
  const hoursLeft = Math.ceil(timeRemainingMs / (60 * 60 * 1000));

  // Listening counts
  const totalTracks = nomination?.tracks?.length || 0;
  const listenedTrackIds = new Set(myProgress.listenedTrackIds || []);

  const totalMembers = members.length;
  const finishedMembers = members.filter(m => {
    const p = cycle?.memberProgress?.[m.id];
    return p && p.listenedTrackIds && totalTracks > 0 && p.listenedTrackIds.length >= totalTracks;
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Toggle track listened checkmark (Strict >50% Rule)
  const handleToggleTrack = (trackId: string) => {
    const isListened = listenedTrackIds.has(trackId);
    if (isListened) {
      WatchSoundService.playTick(1.0);
      const updated = AlbumClubService.toggleTrackListened(club.id, myId, trackId, false);
      if (updated) {
        setClub(updated);
        SupabaseService.broadcastClubUpdate(updated.id, updated);
        FirestoreService.saveAlbumClub(updated).catch(() => {});
      }
    } else {
      // Strictly enforce >50% rule
      const cur = AudioEngine.getCurrentTrack() || currentTrack;
      const dur = AudioEngine.getDuration() || cur?.actualMediaDuration || cur?.duration || 0;
      const currentTime = AudioEngine.getCurrentTime();
      const isCurrent = cur && (
        cur.id === trackId || 
        (cur.title && nomination?.tracks.find(t => t.id === trackId)?.title.toLowerCase() === cur.title.toLowerCase())
      );

      if (isCurrent && dur > 0 && (currentTime / dur) >= 0.5) {
        WatchSoundService.playTick(1.2);
        const updated = AlbumClubService.toggleTrackListened(club.id, myId, trackId, true);
        if (updated) {
          setClub(updated);
          SupabaseService.broadcastClubUpdate(updated.id, updated);
          FirestoreService.saveAlbumClub(updated).catch(() => {});
          showToast(`✓ Marked as Heard (>50% completed)!`);
        }
      } else {
        const track = nomination?.tracks.find(t => t.id === trackId);
        if (track) {
          if (!isCurrent) {
            handlePlaySingleTrack(track);
          }
          const pct = isCurrent && dur > 0 ? Math.round((currentTime / dur) * 100) : 0;
          showToast(`Listen to at least 50% to mark as Heard (currently ${pct}%)`);
        }
      }
    }
  };

  // Play full album
  const handlePlayAlbum = () => {
    if (!nomination || !nomination.tracks || nomination.tracks.length === 0) return;
    WatchSoundService.playTick(1.2);
    const first = nomination.tracks[0];
    if (onPlayTrack) {
      onPlayTrack({
        id: first.id,
        title: first.title,
        artist: nomination.artist,
        artworkUrl: nomination.artworkUrl || undefined,
        audioUrl: first.audioUrl || undefined,
        duration: first.duration || 180
      } as unknown as Track);
    }
    showToast(`Playing ${nomination.title}`);
  };

  // Play single track
  const handlePlaySingleTrack = (t: ClubTrack) => {
    WatchSoundService.playTick(1.0);
    if (onPlayTrack && nomination) {
      onPlayTrack({
        id: t.id,
        title: t.title,
        artist: nomination.artist,
        artworkUrl: nomination.artworkUrl || undefined,
        audioUrl: t.audioUrl || undefined,
        duration: t.duration || 180
      } as unknown as Track);
    }
  };

  // Submit Secret Review
  const handleSubmitReview = () => {
    if (!nomination) return;
    setIsSubmittingReview(true);
    WatchSoundService.playTick(1.3);

    const favTitle = nomination.tracks.find(t => t.id === userFavTrackId)?.title || nomination.tracks[0]?.title || 'Favorite';

    const review: MemberReview = {
      memberId: myId,
      username: myUsername,
      displayName: myDisplayName,
      avatarUrl: currentUser.photoURL || null,
      albumRating: Math.round(userAlbumScore * 10) / 10,
      favoriteTrackId: userFavTrackId || nomination.tracks[0]?.id || 't1',
      favoriteTrackTitle: favTitle,
      trackRatings: userTrackScores,
      reviewText: userReviewNote.trim().slice(0, 280),
      submittedAt: Date.now()
    };

    const updated = AlbumClubService.submitReview(club.id, review);
    if (updated) {
      setClub(updated);
      SupabaseService.broadcastClubUpdate(updated.id, updated);
      FirestoreService.saveAlbumClub(updated).catch(() => {});
      setIsEditingReview(false);
      showToast('Your review has been securely sealed until reveal time!');
    }
    setIsSubmittingReview(false);
  };

  // Advance to next week
  const handleAdvanceWeek = () => {
    WatchSoundService.playTick(1.2);
    const updated = AlbumClubService.advanceToNextWeek(club.id);
    if (updated) {
      setClub(updated);
      SupabaseService.broadcastClubUpdate(updated.id, updated);
      FirestoreService.saveAlbumClub(updated).catch(() => {});
      showToast('Cycle archived! Curator rotated to the next friend.');
    }
  };

  // Early reveal trigger (for testing / demo or host override)
  const handleForceReveal = () => {
    WatchSoundService.playTick(1.2);
    const updated = AlbumClubService.triggerEarlyReveal(club.id);
    if (updated) {
      setClub(updated);
      SupabaseService.broadcastClubUpdate(updated.id, updated);
      FirestoreService.saveAlbumClub(updated).catch(() => {});
      showToast('Ratings unlocked for all members!');
    }
  };

  // Delete entire club
  const handleDeleteClub = () => {
    if (!club) return;
    if (window.confirm(`Delete album club "${club.name}"? All weekly history and ratings will be permanently removed.`)) {
      WatchSoundService.playTick(0.9);
      AlbumClubService.deleteClub(club.id);
      if (onDeleteClub) {
        onDeleteClub(club.id);
      }
      onBack();
    }
  };

  // Remove/change current album nomination
  const handleDeleteNomination = () => {
    if (!club) return;
    if (window.confirm(`Remove nominated album "${nomination?.title}"? The club will return to nomination stage so you can choose a new album.`)) {
      WatchSoundService.playTick(0.9);
      const updated = AlbumClubService.deleteNomination(club.id);
      if (updated) {
        setClub(updated);
        SupabaseService.broadcastClubUpdate(updated.id, updated);
        FirestoreService.saveAlbumClub(updated).catch(() => {});
        showToast('Album removed. You can now nominate a new album.');
      }
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto px-4 sm:px-8 pt-16 sm:pt-20 select-none relative pb-32 animate-fadeIn">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-black/90 border border-white/20 backdrop-blur-2xl text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-fadeIn pointer-events-auto">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-6">
        {/* ---------------- TOP NAVIGATION BAR (Responsive: Clean Single-Line / No Text Squishing) ---------------- */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(0.9);
                  onBack();
                }}
                className="p-2.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-white border border-white/12 backdrop-blur-xl transition-all cursor-pointer shadow-md active:scale-95 flex-shrink-0"
                title="Back to Social"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight truncate max-w-[200px] sm:max-w-md">
                    {club.name}
                  </h1>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] font-bold flex-shrink-0">
                    WEEK {String(cycle?.weekNumber || 1).padStart(2, '0')}
                  </span>
                </div>
                {club.description && (
                  <p className="text-[11px] sm:text-xs text-white/50 truncate max-w-[240px] sm:max-w-lg mt-0.5">
                    {club.description}
                  </p>
                )}
              </div>
            </div>

            {/* Mobile Delete Button */}
            <button
              type="button"
              onClick={handleDeleteClub}
              className="sm:hidden p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all text-xs cursor-pointer flex-shrink-0"
              title="Delete this club"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Switch tabs: Active Week vs Archive History + Desktop Delete */}
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
            <div className="inline-flex p-1 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-2xl w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setActiveTab('current')}
                className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer text-center ${
                  activeTab === 'current'
                    ? 'bg-white text-black shadow-lg'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Current Week
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('archive')}
                className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'archive'
                    ? 'bg-white text-black shadow-lg'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Archive ({club.archive?.length || 0})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDeleteClub}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all text-xs font-semibold cursor-pointer flex-shrink-0"
              title="Delete this album club"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Club</span>
            </button>
          </div>
        </div>

        {/* ---------------- MAIN ACTIVE WEEK CONTENT ---------------- */}
        {activeTab === 'current' ? (
          <div className="space-y-6">
            {/* HERO STAGE BANNER */}
            {nomination ? (
              <div className="relative overflow-hidden p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-cyan-500/[0.05] border border-white/15 backdrop-blur-3xl shadow-2xl space-y-6">
                {/* Ambient glow */}
                <div 
                  className="absolute -top-20 -left-20 w-72 h-72 rounded-full blur-3xl pointer-events-none opacity-30"
                  style={{ backgroundColor: dominantColor || '#06b6d4' }}
                />

                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 min-w-0">
                    {/* Artwork */}
                    <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-2xl overflow-hidden bg-black/60 border border-white/20 shadow-2xl flex-shrink-0 relative group">
                      {nomination.artworkUrl ? (
                        <img
                          src={nomination.artworkUrl}
                          alt={nomination.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-cyan-950/40 text-cyan-400">
                          <Disc3 className="w-12 h-12 animate-spin-slow" />
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 font-bold">
                          Album of the Week
                        </span>
                        {nomination.year && (
                          <span className="text-[11px] font-mono text-white/40">• {nomination.year}</span>
                        )}
                        {nomination.genre && (
                          <span className="text-[11px] font-mono text-white/40">• {nomination.genre}</span>
                        )}
                      </div>

                      <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight truncate">
                        {nomination.title}
                      </h2>
                      <div className="text-sm sm:text-base font-semibold text-white/70">
                        {nomination.artist}
                      </div>

                      {/* Curator attribution & Delete/Change Album Nomination Button */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <div className="px-2.5 py-1 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5">
                          <Crown className="w-3.5 h-3.5" />
                          <span>Curated by @{nomination.curatorDisplayName || nomination.curatorUsername}</span>
                        </div>

                        {/* Delete / Change current album nomination */}
                        <button
                          type="button"
                          onClick={handleDeleteNomination}
                          className="px-2.5 py-1 rounded-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                          title="Remove current album and nominate a different one"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Change Album</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Countdown on Right */}
                  <div className="flex flex-col sm:items-end gap-3 w-full sm:w-auto">
                    {stage === 'reveal' ? (
                      <div className="px-4 py-2 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-bold flex items-center gap-2 shadow-lg animate-pulse">
                        <Sparkles className="w-4 h-4" />
                        <span>Ratings Revealed!</span>
                      </div>
                    ) : (
                      <div className="px-3.5 py-1.5 rounded-2xl bg-white/[0.06] border border-white/10 text-white/80 text-xs font-mono flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        <span><strong>{daysLeft}</strong> days left to rate</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handlePlayAlbum}
                      className="px-6 py-3 rounded-full bg-white text-black font-bold text-xs sm:text-sm hover:bg-white/90 active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto"
                    >
                      <Play className="w-4 h-4 fill-black text-black" />
                      <span>Play Full Album</span>
                    </button>
                  </div>
                </div>

                {/* Curator Note Banner */}
                {nomination.curatorNote && (
                  <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl relative z-10 flex items-start gap-3">
                    <MessageSquare className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300/80 font-bold">
                        Host's Note
                      </div>
                      <p className="text-xs sm:text-sm text-white/80 italic mt-0.5">
                        "{nomination.curatorNote}"
                      </p>
                    </div>
                  </div>
                )}

                {/* Group Progress Bar */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2 relative z-10">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60 flex items-center gap-1.5">
                      <Headphones className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Group Listening Progress</span>
                    </span>
                    <span className="font-mono font-bold text-white">
                      {finishedMembers.length} of {totalMembers} finished
                    </span>
                  </div>

                  {/* Progress Line */}
                  <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 rounded-full transition-all duration-500 shadow-[0_0_10px_#22d3ee]"
                      style={{ width: `${Math.round((finishedMembers.length / (totalMembers || 1)) * 100)}%` }}
                    />
                  </div>

                  {/* Member avatars with finished checkmark */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {members.map(m => {
                      const p = cycle.memberProgress[m.id];
                      const isDone = p && p.listenedTrackIds && p.listenedTrackIds.length >= totalTracks;
                      const hasSub = !!cycle.secretReviews[m.id];
                      return (
                        <div
                          key={m.id}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                            isDone
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                              : 'bg-white/[0.04] border-white/10 text-white/60'
                          }`}
                        >
                          <span className="truncate max-w-[80px]">{m.displayName}</span>
                          {isDone ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <span className="text-[10px] text-white/30 font-mono">
                              {p?.listenedTrackIds?.length || 0}/{totalTracks}
                            </span>
                          )}
                          {hasSub && (
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" title="Submitted sealed rating" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Awaiting Nomination Stage */
              <div className="p-10 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl text-center space-y-4">
                <Crown className="w-12 h-12 mx-auto text-amber-400 animate-bounce" />
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-white">
                    {isCurator ? "It's your turn to nominate the album!" : `Waiting for @${cycle?.curatorUsername || 'Curator'} to pick`}
                  </h3>
                  <p className="text-xs sm:text-sm text-white/50 max-w-md mx-auto">
                    {isCurator
                      ? "Choose an album that you think the group needs to hear this week. You can add a personal note explaining why you picked it."
                      : "The host is browsing the catalog for this week's selection. Check back soon!"}
                  </p>
                </div>

                {isCurator && onOpenNominateModal && (
                  <button
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.2);
                      onOpenNominateModal();
                    }}
                    className="px-6 py-3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold text-xs sm:text-sm hover:opacity-90 active:scale-95 transition-all shadow-xl inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Select & Nominate Album</span>
                  </button>
                )}
              </div>
            )}

            {/* ---------------- 2-COLUMN SECTION: TRACKLIST & RATING SUBMISSION ---------------- */}
            {nomination && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* LEFT: INTERACTIVE TRACKLIST (7 Cols) */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                      <Disc3 className="w-4 h-4 text-cyan-400" />
                      <span>Tracklist & Listening Check-off</span>
                    </h3>
                    <span className="text-[11px] font-mono text-white/40">
                      {listenedTrackIds.size}/{totalTracks} listened
                    </span>
                  </div>

                  <div className="p-3 sm:p-4 rounded-3xl bg-white/[0.03] border border-white/10 backdrop-blur-2xl space-y-2">
                    {(!nomination.tracks || nomination.tracks.length === 0 || isHealingTracks) ? (
                      <div className="py-8 text-center text-xs text-white/50 flex flex-col items-center justify-center gap-2">
                        <Sparkles className="w-5 h-5 text-cyan-400 animate-spin" />
                        <span>Resolving official album tracklist...</span>
                      </div>
                    ) : (
                      nomination.tracks.map((track, idx) => {
                        const isListened = listenedTrackIds.has(track.id);
                        const isFav = userFavTrackId === track.id;
                        const score = userTrackScores[track.id];

                        return (
                          <div
                            key={track.id}
                            className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 group ${
                              isListened
                                ? 'bg-white/[0.04] border-white/15'
                                : 'bg-white/[0.01] border-white/5 hover:border-white/10'
                            }`}
                          >
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Track Number / Play Trigger */}
                            <button
                              type="button"
                              onClick={() => handlePlaySingleTrack(track)}
                              className="w-7 h-7 rounded-xl bg-white/5 hover:bg-white text-white/50 hover:text-black flex items-center justify-center transition-all cursor-pointer flex-shrink-0 text-xs font-mono"
                            >
                              <Play className="w-3 h-3 fill-current ml-0.5" />
                            </button>

                            <div className="min-w-0">
                              <div className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                                {idx + 1}. {track.title}
                              </div>
                              <div className="text-[10px] text-white/40 truncate">
                                {track.artist || nomination.artist}
                              </div>
                            </div>
                          </div>

                          {/* Track Actions: Favorite Star + Score Rating + Checkmark */}
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                            {/* Star as Favorite */}
                            <button
                              type="button"
                              onClick={() => {
                                WatchSoundService.playTick(1.1);
                                setUserFavTrackId(track.id);
                              }}
                              title={isFav ? 'Selected as your favorite track' : 'Set as favorite track'}
                              className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
                                isFav
                                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                                  : 'text-white/20 hover:text-white/60 border-transparent hover:bg-white/5'
                              }`}
                            >
                              <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400' : ''}`} />
                            </button>

                            {/* Dedicated Per-Track Rate Button that shifts the right panel into Track Rating mode */}
                            <button
                              type="button"
                              onClick={() => {
                                WatchSoundService.playTick(1.1);
                                setRatingTrackId(track.id);
                                setActiveTrackScore(score ?? 8.5);
                                setIsEditingReview(true);
                              }}
                              className={`flex items-center gap-1 rounded-xl px-2.5 py-1 transition-all border cursor-pointer active:scale-95 text-xs font-semibold ${
                                score !== undefined 
                                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.25)]' 
                                  : 'bg-white/[0.05] hover:bg-white/[0.12] border-white/10 text-white/60 hover:text-white'
                              }`}
                              title="Click to rate this track on the 1.0 - 10.0 scale"
                            >
                              <Star className={`w-3 h-3 ${score !== undefined ? 'fill-amber-400 text-amber-400' : 'text-white/40'}`} />
                              <span className="font-mono text-[11px] font-bold">
                                {score !== undefined ? score.toFixed(1) : 'Rate'}
                              </span>
                            </button>

                            {/* Manual or Auto Listen Checkmark */}
                            <button
                              type="button"
                              onClick={() => handleToggleTrack(track.id)}
                              title={isListened ? 'Marked as listened' : 'Click to check off'}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                isListened
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-white/5 text-white/40 hover:text-white border-white/10 hover:border-white/20'
                              }`}
                            >
                              <Check className={`w-3.5 h-3.5 ${isListened ? 'text-emerald-400 stroke-[3]' : 'opacity-40'}`} />
                              <span className="hidden sm:inline text-[11px] font-mono">
                                {isListened ? 'Heard' : 'Listen'}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    }))}
                  </div>
                </div>

                {/* RIGHT: SECRET REVIEW COMPOSER OR REVEAL BOARD (5 Cols) */}
                <div className="lg:col-span-5 space-y-4">
                  {stage === 'reveal' ? (
                    /* ---------------- STAGE 4: GROUP REVEAL BOARD ---------------- */
                    <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-emerald-500/10 via-white/[0.04] to-cyan-500/10 border border-white/20 backdrop-blur-3xl shadow-2xl space-y-5 animate-fadeIn">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-emerald-400" />
                          <h3 className="text-base font-bold text-white">Group Verdict</h3>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                          UNLOCKED
                        </span>
                      </div>

                      {/* Average Score Big Pill */}
                      <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/10 text-center space-y-1">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                          Club Average Score
                        </div>
                        <div className="text-4xl font-black text-white tracking-tight flex items-center justify-center gap-2">
                          <span>{cycle.verdict?.averageRating || 8.5}</span>
                          <span className="text-amber-400 text-2xl">★</span>
                        </div>
                        <div className="text-xs text-white/50">
                          Based on {cycle.verdict?.totalSubmissions || Object.keys(cycle.secretReviews || {}).length} member reviews
                        </div>
                      </div>

                      {/* Consensus Insights Grid */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1">
                          <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-amber-300">
                            <Award className="w-3 h-3" />
                            <span>Favorite Track</span>
                          </div>
                          <div className="text-xs font-bold text-white truncate">
                            {cycle.verdict?.favoriteTrack?.title || 'TBD'}
                          </div>
                          <div className="text-[10px] text-white/40">
                            {cycle.verdict?.favoriteTrack?.voteCount || 1} votes
                          </div>
                        </div>

                        <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1">
                          <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-rose-300">
                            <Flame className="w-3 h-3" />
                            <span>Most Polarizing</span>
                          </div>
                          <div className="text-xs font-bold text-white truncate">
                            {cycle.verdict?.mostDivisiveTrack?.title || 'TBD'}
                          </div>
                          <div className="text-[10px] text-white/40">
                            High debate
                          </div>
                        </div>
                      </div>

                      {/* AI Consensus Summary */}
                      {cycle.verdict?.aiSummary && (
                        <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-200/90 leading-relaxed">
                          <div className="text-[10px] font-mono uppercase text-cyan-300 font-bold mb-1 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            <span>AI Group Consensus</span>
                          </div>
                          {cycle.verdict.aiSummary}
                        </div>
                      )}

                      {/* Member Reviews Unlocked */}
                      <div className="space-y-2 pt-2 border-t border-white/10">
                        <div className="text-xs font-bold text-white">Member Reviews</div>
                        {Object.values(cycle.secretReviews || {}).map((rev) => (
                          <div key={rev.memberId} className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white">@{rev.username}</span>
                              <span className="text-xs font-mono font-bold text-amber-300">{rev.albumRating} ★</span>
                            </div>
                            {rev.reviewText && (
                              <p className="text-xs text-white/70 italic">"{rev.reviewText}"</p>
                            )}
                            <div className="text-[10px] text-white/40">Fav: {rev.favoriteTrackTitle}</div>
                          </div>
                        ))}
                      </div>

                      {/* Advance to next week button */}
                      <button
                        type="button"
                        onClick={handleAdvanceWeek}
                        className="w-full py-3 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Archive & Rotate Curator for Next Week</span>
                      </button>
                    </div>
                  ) : ratingTrackId && nomination.tracks.some(t => t.id === ratingTrackId) ? (
                    /* ---------------- TRACK RATING MODE ---------------- */
                    (() => {
                      const curTrack = nomination.tracks.find(t => t.id === ratingTrackId)!;
                      const curIdx = nomination.tracks.findIndex(t => t.id === ratingTrackId);
                      const isFav = userFavTrackId === curTrack.id;

                      const handleSaveTrackRating = () => {
                        WatchSoundService.playTick(1.3);
                        const clean = Math.max(1.0, Math.min(10.0, Math.round(activeTrackScore * 10) / 10));
                        const nextScores = { ...userTrackScores, [curTrack.id]: clean };
                        setUserTrackScores(nextScores);

                        // Broadcast & Persist directly via AlbumClubService so it is NEVER lost
                        if (club?.id) {
                          const updated = AlbumClubService.saveTrackRating(club.id, myId, myUsername, curTrack.id, clean);
                          if (updated) {
                            setClub(updated);
                            SupabaseService.broadcastClubUpdate(updated.id, updated);
                            FirestoreService.saveAlbumClub(updated).catch(() => {});
                          }
                        }

                        // Recalculate average to suggest for album
                        const vals = Object.values(nextScores);
                        if (vals.length > 0) {
                          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                          setUserAlbumScore(Math.round(avg * 10) / 10);
                        }
                        showToast(`Saved ${clean.toFixed(1)} ★ for "${curTrack.title}"!`);
                      };

                      const switchTrack = (nextId: string) => {
                        WatchSoundService.playTick(1.0);
                        // Auto-save current track score before switching to next song
                        const clean = Math.max(1.0, Math.min(10.0, Math.round(activeTrackScore * 10) / 10));
                        const nextScores = { ...userTrackScores, [curTrack.id]: clean };
                        setUserTrackScores(nextScores);
                        if (club?.id) {
                          const updated = AlbumClubService.saveTrackRating(club.id, myId, myUsername, curTrack.id, clean);
                          if (updated) {
                            setClub(updated);
                            SupabaseService.broadcastClubUpdate(updated.id, updated);
                            FirestoreService.saveAlbumClub(updated).catch(() => {});
                          }
                        }
                        setRatingTrackId(nextId);
                        setActiveTrackScore(nextScores[nextId] ?? 8.5);
                      };

                      return (
                        <div className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] border border-white/15 backdrop-blur-2xl shadow-xl space-y-4 animate-fadeIn">
                          {/* Top Back Header */}
                          <div className="flex items-center justify-between pb-2 border-b border-white/10">
                            <button
                              type="button"
                              onClick={() => {
                                WatchSoundService.playTick(1.0);
                                setRatingTrackId(null);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-semibold transition-all cursor-pointer"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                              <span>Back to Album Review</span>
                            </button>

                            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-[10px] font-bold">
                              Track {curIdx + 1} of {nomination.tracks.length}
                            </span>
                          </div>

                          {/* Track Details Card */}
                          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[10px] text-amber-300/80 font-mono uppercase tracking-wider font-bold">
                                Rating Individual Song
                              </div>
                              <h4 className="text-sm font-bold text-white truncate mt-0.5">
                                {curIdx + 1}. {curTrack.title}
                              </h4>
                              <p className="text-[11px] text-white/50 truncate">
                                {curTrack.artist || nomination.artist}
                              </p>
                            </div>

                            {/* Set as Favorite Star */}
                            <button
                              type="button"
                              onClick={() => {
                                WatchSoundService.playTick(1.1);
                                setUserFavTrackId(curTrack.id);
                              }}
                              className={`p-2 rounded-2xl border transition-all cursor-pointer flex items-center gap-1.5 flex-shrink-0 ${
                                isFav
                                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                  : 'bg-white/5 text-white/40 border-white/10 hover:text-white'
                              }`}
                              title={isFav ? 'Selected as your favorite track' : 'Set as favorite track'}
                            >
                              <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
                              <span className="text-[10px] font-bold">
                                {isFav ? 'Favorite' : 'Set Favorite'}
                              </span>
                            </button>
                          </div>

                          {/* Big Score Readout */}
                          <div className="text-center py-1">
                            <div className="flex items-baseline justify-center gap-1.5">
                              <span className="text-4xl font-black font-mono text-amber-300 tracking-tight drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]">
                                {activeTrackScore.toFixed(1)}
                              </span>
                              <span className="text-sm font-mono text-white/40">/ 10.0</span>
                            </div>
                            <div className="text-xs text-white/60 font-medium mt-1">
                              {activeTrackScore >= 9.5 ? 'Masterpiece ✨' :
                               activeTrackScore >= 8.5 ? 'Essential Highlight 🔥' :
                               activeTrackScore >= 7.0 ? 'Great track 👍' :
                               activeTrackScore >= 5.0 ? 'Average song' : 'Skipped / Disliked'}
                            </div>
                          </div>

                          {/* Precision Steppers & Range Slider */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  WatchSoundService.playTick(0.95);
                                  setActiveTrackScore(prev => Math.max(1.0, Math.min(10.0, Math.round((prev - 0.1) * 10) / 10)));
                                }}
                                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs font-bold transition-all active:scale-95"
                                title="-0.1"
                              >
                                -0.1
                              </button>

                              <input
                                type="range"
                                min="1.0"
                                max="10.0"
                                step="0.1"
                                value={activeTrackScore}
                                onChange={(e) => setActiveTrackScore(parseFloat(e.target.value))}
                                className="flex-1 h-2 rounded-lg bg-white/10 accent-amber-400 cursor-pointer"
                              />

                              <button
                                type="button"
                                onClick={() => {
                                  WatchSoundService.playTick(1.05);
                                  setActiveTrackScore(prev => Math.max(1.0, Math.min(10.0, Math.round((prev + 0.1) * 10) / 10)));
                                }}
                                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs font-bold transition-all active:scale-95"
                                title="+0.1"
                              >
                                +0.1
                              </button>
                            </div>

                            <div className="flex justify-between text-[10px] font-mono text-white/30 px-1">
                              <span>1.0</span>
                              <span>5.0</span>
                              <span>7.5</span>
                              <span>10.0</span>
                            </div>
                          </div>

                          {/* Quick Presets */}
                          <div className="flex items-center justify-between gap-1.5 pt-1">
                            {[5.0, 7.0, 8.0, 9.0, 10.0].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => {
                                  WatchSoundService.playTick(1.0);
                                  setActiveTrackScore(preset);
                                }}
                                className={`flex-1 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                                  Math.abs(activeTrackScore - preset) < 0.05
                                    ? 'bg-amber-400 text-black shadow-[0_0_10px_rgba(251,191,36,0.5)]'
                                    : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                {preset.toFixed(1)}
                              </button>
                            ))}
                          </div>

                          {/* Save Track Rating Button */}
                          <button
                            type="button"
                            onClick={handleSaveTrackRating}
                            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 text-black font-black text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                          >
                            <Check className="w-4 h-4 stroke-[2.5]" />
                            <span>Save Track Rating ({activeTrackScore.toFixed(1)} ★)</span>
                          </button>

                          {/* Prev / Next Track Switcher */}
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
                            <button
                              type="button"
                              disabled={curIdx <= 0}
                              onClick={() => {
                                const prevT = nomination.tracks[curIdx - 1];
                                if (prevT) switchTrack(prevT.id);
                              }}
                              className="flex-1 py-1.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-white/70 hover:text-white text-xs font-medium transition-all truncate"
                            >
                              ← Prev Track
                            </button>

                            <button
                              type="button"
                              disabled={curIdx >= nomination.tracks.length - 1}
                              onClick={() => {
                                const nextT = nomination.tracks[curIdx + 1];
                                if (nextT) switchTrack(nextT.id);
                              }}
                              className="flex-1 py-1.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-white/70 hover:text-white text-xs font-medium transition-all truncate"
                            >
                              Next Track →
                            </button>
                          </div>

                          {/* Track Selector Pill Grid */}
                          <div className="space-y-1.5 pt-1">
                            <div className="text-[10px] font-mono text-white/50 uppercase tracking-wider">
                              Track Ratings ({Object.keys(userTrackScores).length}/{nomination.tracks.length} rated)
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-32 overflow-y-auto pr-1">
                              {nomination.tracks.map((t, i) => {
                                const sc = userTrackScores[t.id];
                                const isSelected = t.id === ratingTrackId;
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => switchTrack(t.id)}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-mono truncate text-left border transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-amber-400 text-black font-bold border-amber-400 shadow-sm'
                                        : sc !== undefined
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                          : 'bg-white/5 text-white/50 border-white/5 hover:bg-white/10'
                                    }`}
                                  >
                                    {i + 1}. {sc !== undefined ? `${sc.toFixed(1)} ★` : 'Rate'}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Done & Return */}
                          <button
                            type="button"
                            onClick={() => {
                              WatchSoundService.playTick(1.0);
                              setRatingTrackId(null);
                            }}
                            className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all cursor-pointer"
                          >
                            Done & Return to Album Review
                          </button>
                        </div>
                      );
                    })()
                  ) : (
                    /* ---------------- STAGE 3: SECRET REVIEW COMPOSER ---------------- */
                    <div className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl shadow-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-cyan-400" />
                          <h3 className="text-sm font-bold text-white">
                            {hasSubmitted && !isEditingReview ? 'Your Sealed Review' : 'Your Secret Review'}
                          </h3>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-mono text-[10px]">
                          1.0 - 10.0 Scale
                        </span>
                      </div>

                      {hasSubmitted && !isEditingReview ? (
                        /* Submitted State Card */
                        <div className="space-y-4 py-2">
                          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-center space-y-2">
                            <div className="text-xs text-white/50">Your Score</div>
                            <div className="text-3xl font-black text-white flex items-center justify-center gap-1">
                              <span>{userAlbumScore}</span>
                              <span className="text-amber-400 text-xl">★</span>
                            </div>
                            {userReviewNote && (
                              <p className="text-xs text-white/70 italic pt-1">
                                "{userReviewNote}"
                              </p>
                            )}
                          </div>

                          {/* Individual Track Ratings Grid (Always Accessible) */}
                          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-white/70 font-semibold flex items-center gap-1.5">
                                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                                <span>Individual Track Ratings</span>
                              </span>
                              <span className="text-amber-300 font-mono text-[11px] font-bold">
                                {Object.keys(userTrackScores).length} of {nomination.tracks.length} rated
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                              {nomination.tracks.map((t, i) => {
                                const sc = userTrackScores[t.id];
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => {
                                      WatchSoundService.playTick(1.1);
                                      setRatingTrackId(t.id);
                                      setActiveTrackScore(sc ?? 8.5);
                                      setIsEditingReview(true);
                                    }}
                                    className={`px-2.5 py-1.5 rounded-xl text-[10px] font-mono truncate text-left border transition-all cursor-pointer flex items-center justify-between gap-1 active:scale-95 ${
                                      sc !== undefined
                                        ? 'bg-amber-500/15 text-amber-300 border-amber-400/40 shadow-sm hover:bg-amber-500/25'
                                        : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white'
                                    }`}
                                    title={`Click to rate ${t.title}`}
                                  >
                                    <span className="truncate">{i + 1}. {t.title}</span>
                                    <span className="font-bold flex-shrink-0 text-amber-300">{sc !== undefined ? `${sc.toFixed(1)} ★` : 'Rate'}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300 flex items-start gap-2">
                            <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>
                              Your review is safely sealed. Ratings will be revealed simultaneously when the 7-day countdown ends.
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setIsEditingReview(true)}
                              className="w-full py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all cursor-pointer"
                            >
                              Edit My Review
                            </button>

                            {/* Demo / Host Override: Early Reveal Button */}
                            <button
                              type="button"
                              onClick={handleForceReveal}
                              className="px-3 py-2.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/40 text-xs font-semibold whitespace-nowrap cursor-pointer"
                              title="Unlock reveal immediately (Host override)"
                            >
                              Reveal Now
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Editable Form */
                        <div className="space-y-4">
                          {/* 10-Point Precision Slider / Stepper */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-white/60">Album Rating</span>
                              <span className="font-mono font-bold text-amber-300 text-base">
                                {userAlbumScore.toFixed(1)} ★
                              </span>
                            </div>

                            <input
                              type="range"
                              min="1.0"
                              max="10.0"
                              step="0.1"
                              value={userAlbumScore}
                              onChange={(e) => setUserAlbumScore(parseFloat(e.target.value))}
                              className="w-full h-2 rounded-lg bg-white/10 accent-cyan-400 cursor-pointer"
                            />

                            <div className="flex justify-between text-[10px] font-mono text-white/30 px-1">
                              <span>1.0</span>
                              <span>5.0</span>
                              <span>7.5</span>
                              <span>10.0</span>
                            </div>
                          </div>

                          {/* Favorite Track Dropdown */}
                          <div className="space-y-1.5">
                            <label className="text-xs text-white/60">Favorite Track</label>
                            <div className="relative">
                              <select
                                value={userFavTrackId}
                                onChange={(e) => setUserFavTrackId(e.target.value)}
                                className="w-full px-3 py-2.5 rounded-2xl bg-white/[0.06] border border-white/10 text-white text-xs font-semibold appearance-none cursor-pointer focus:outline-none focus:border-cyan-400"
                              >
                                {nomination.tracks.map((t, i) => (
                                  <option key={t.id} value={t.id} className="bg-neutral-900 text-white">
                                    {i + 1}. {t.title}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="w-4 h-4 text-white/50 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                          </div>

                          {/* Individual Track Ratings Quick Launcher */}
                          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-white/60">Individual Track Ratings</span>
                              <span className="font-mono text-[11px] text-amber-300 font-bold">
                                {Object.keys(userTrackScores).length} of {nomination.tracks.length} rated
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                              {nomination.tracks.map((t, i) => {
                                const sc = userTrackScores[t.id];
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => {
                                      WatchSoundService.playTick(1.1);
                                      setRatingTrackId(t.id);
                                      setActiveTrackScore(sc ?? 8.5);
                                    }}
                                    className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold transition-all border cursor-pointer ${
                                      sc !== undefined
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-400/40 hover:bg-amber-500/30'
                                        : 'bg-white/5 text-white/40 border-white/10 hover:text-white'
                                    }`}
                                    title={`Click to rate ${t.title}`}
                                  >
                                    #{i + 1}: {sc !== undefined ? `${sc.toFixed(1)} ★` : 'Rate'}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Short Review (Max 280 chars) */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-white/60">
                              <span>What did you think? (Optional)</span>
                              <span className="font-mono text-[10px] text-white/40">
                                {280 - userReviewNote.length} left
                              </span>
                            </div>
                            <textarea
                              value={userReviewNote}
                              onChange={(e) => setUserReviewNote(e.target.value.slice(0, 280))}
                              placeholder="Share your thoughts on the standout moments or pacing..."
                              rows={3}
                              className="w-full p-3 rounded-2xl bg-white/[0.06] border border-white/10 text-white text-xs placeholder-white/30 resize-none focus:outline-none focus:border-cyan-400"
                            />
                          </div>

                          {/* Privacy Note */}
                          <div className="text-[11px] text-white/40 flex items-center gap-1.5 leading-tight">
                            <Lock className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                            <span>Your friends cannot see your rating or review until the weekly reveal.</span>
                          </div>

                          {/* Submit Action */}
                          <button
                            type="button"
                            disabled={isSubmittingReview}
                            onClick={handleSubmitReview}
                            className="w-full py-3 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>{isEditingReview ? 'Update Sealed Review' : 'Submit Secret Review'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ---------------- ARCHIVE HISTORY TAB ---------------- */
          <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-bold text-white tracking-wide">Past Club Weeks</h3>
              <span className="text-xs font-mono text-white/40">{club.archive?.length || 0} completed</span>
            </div>

            {club.archive && club.archive.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {club.archive.map((entry) => (
                  <div
                    key={entry.weekNumber}
                    className="p-5 rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-2xl space-y-4 hover:border-white/20 transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-20 h-20 rounded-2xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                        {entry.nomination.artworkUrl ? (
                          <img
                            src={entry.nomination.artworkUrl}
                            alt={entry.nomination.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/30">
                            <Disc3 className="w-8 h-8" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 space-y-1">
                        <div className="text-[10px] font-mono text-cyan-300 font-bold uppercase">
                          WEEK {String(entry.weekNumber).padStart(2, '0')}
                        </div>
                        <h4 className="text-base font-bold text-white truncate">
                          {entry.nomination.title}
                        </h4>
                        <div className="text-xs text-white/60 truncate">
                          {entry.nomination.artist}
                        </div>
                        <div className="text-xs font-bold text-amber-300 flex items-center gap-1 pt-0.5">
                          <span>{entry.verdict.averageRating} ★</span>
                          <span className="text-[10px] text-white/40 font-normal">
                            ({entry.reviews.length} reviews)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* AI Consensus */}
                    {entry.verdict.aiSummary && (
                      <p className="text-xs text-white/70 italic bg-white/[0.02] p-3 rounded-2xl border border-white/5">
                        "{entry.verdict.aiSummary}"
                      </p>
                    )}

                    {/* Highlights */}
                    <div className="flex items-center justify-between text-xs text-white/60 pt-2 border-t border-white/5">
                      <span>Curated by @{entry.nomination.curatorUsername}</span>
                      <span className="text-cyan-300">Fav: {entry.verdict.favoriteTrack.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 rounded-3xl bg-white/[0.02] border border-white/10 text-center space-y-2">
                <History className="w-8 h-8 mx-auto text-white/20" />
                <div className="text-sm font-bold text-white/70">No Archived Cycles Yet</div>
                <p className="text-xs text-white/40 max-w-sm mx-auto">
                  Once your current week finishes and ratings are revealed, it will be immortalized here in the club's permanent history.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
