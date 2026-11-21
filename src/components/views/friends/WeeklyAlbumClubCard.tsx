import React, { useState } from 'react';
import { 
  Disc3, 
  Clock, 
  Headphones, 
  ChevronRight, 
  Plus, 
  Sparkles, 
  Crown,
  ChevronDown,
  Layers,
  Lock,
  CheckCircle2,
  Trash2,
  X
} from 'lucide-react';
import { AlbumClub, ClubMember } from '../../../types/albumClubTypes';
import { WatchSoundService } from '../../../services/watchSoundService';

interface WeeklyAlbumClubCardProps {
  clubs: AlbumClub[];
  activeClub: AlbumClub | null;
  onSelectClub: (clubId: string) => void;
  onOpenClubView: () => void;
  onCreateClub: () => void;
  onNominateClick?: () => void;
  onDeleteClub?: (clubId: string) => void;
  currentUserId?: string;
  dominantColor?: string;
}

export const WeeklyAlbumClubCard: React.FC<WeeklyAlbumClubCardProps> = ({
  clubs,
  activeClub,
  onSelectClub,
  onOpenClubView,
  onCreateClub,
  onNominateClick,
  onDeleteClub,
  currentUserId,
  dominantColor
}) => {
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  if (!activeClub) {
    return (
      <div className="relative overflow-hidden p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-cyan-500/[0.04] border border-white/15 backdrop-blur-3xl text-center space-y-4 shadow-xl">
        <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 flex items-center justify-center mx-auto shadow-inner">
          <Disc3 className="w-6 h-6 animate-spin-slow" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h3 className="text-lg font-bold text-white tracking-tight">Weekly Album Club</h3>
          <p className="text-xs text-white/60 leading-relaxed">
            Pick one album every week with your friends, listen throughout the week, and submit secret ratings. Reveal favourite tracks and group reviews together!
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            WatchSoundService.playTick(1.2);
            onCreateClub();
          }}
          className="px-6 py-2.5 rounded-full bg-lumen-cyan text-black font-bold text-xs hover:bg-lumen-cyan/90 active:scale-95 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] cursor-pointer inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Create Album Club</span>
        </button>
      </div>
    );
  }

  const cycle = activeClub.currentCycle;
  const nomination = cycle?.nomination;
  const stage = cycle?.stage || 'nominate';
  const members = activeClub.members || [];

  // Calculate days remaining in 7-day cycle
  const now = Date.now();
  const timeRemainingMs = Math.max(0, (cycle?.cycleEndTimestamp || now) - now);
  const daysLeft = Math.ceil(timeRemainingMs / (24 * 60 * 60 * 1000));
  const hoursLeft = Math.ceil(timeRemainingMs / (60 * 60 * 1000));

  // Count listened members
  const totalMembers = members.length;
  const listenedMembersCount = Object.values(cycle?.memberProgress || {}).filter(
    p => p.listenedTrackIds && nomination?.tracks && p.listenedTrackIds.length >= (nomination.tracks.length || 1)
  ).length;

  // Check if current user is this week's curator
  const myId = currentUserId || 'me';
  const isCurator = cycle?.curatorMemberId === myId || activeClub.members.find(m => m.id === myId)?.isCurator;

  return (
    <div className="relative overflow-hidden p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-purple-500/[0.04] border border-white/15 backdrop-blur-3xl shadow-[0_12px_40px_rgba(0,0,0,0.4)] transition-all hover:border-white/25 group">
      {/* Dynamic Ambient Glow Behind Cover */}
      <div 
        className="absolute -top-16 -left-16 w-56 h-56 rounded-full blur-3xl pointer-events-none opacity-40 transition-colors"
        style={{ backgroundColor: dominantColor || '#06b6d4' }}
      />
      <div className="absolute top-1/2 -right-16 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* ---------------- CARD HEADER: Title + Club Switcher Pill + Week Badge ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 relative z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-white/[0.08] border border-white/15 backdrop-blur-md flex items-center justify-center text-cyan-400 shadow-inner flex-shrink-0">
            <Disc3 className="w-4 h-4 animate-spin-slow" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono tracking-wider uppercase text-cyan-300 font-bold flex-shrink-0">
                Weekly Album Club
              </span>
              <span className="text-[10px] text-white/30 hidden sm:inline">•</span>
              
              {/* Dedicated Club Switcher Modal Trigger (no awkward overlapping dropdown) */}
              <button
                type="button"
                onClick={() => setIsSwitcherOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-xs font-semibold text-white transition-all cursor-pointer truncate max-w-[150px] sm:max-w-[200px]"
                title="Switch or manage album clubs"
              >
                <span className="truncate">{activeClub.name}</span>
                <ChevronDown className="w-3 h-3 text-white/50 flex-shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {/* Week Pill & Stage Badge */}
        <div className="flex items-center gap-2">
          {stage === 'reveal' ? (
            <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-mono text-xs font-bold flex items-center gap-1 shadow-[0_0_12px_rgba(16,185,129,0.3)] animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
              <span>REVEAL READY</span>
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full bg-white/[0.08] border border-white/15 text-white/90 font-mono text-xs font-bold tracking-wider">
              WEEK {String(cycle?.weekNumber || 1).padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      {/* DEDICATED CLEAN POPUP MODAL FOR CLUB SWITCHING & MANAGEMENT */}
      {isSwitcherOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn"
          onClick={() => setIsSwitcherOpen(false)}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-neutral-900/95 border border-white/20 backdrop-blur-3xl p-5 shadow-2xl space-y-4 text-left"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h4 className="text-sm font-bold text-white">Your Album Clubs</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsSwitcherOpen(false)}
                className="p-1 rounded-full text-white/50 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {clubs.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                    c.id === activeClub.id
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-white shadow-lg'
                      : 'bg-white/[0.04] border-white/10 hover:border-white/20 text-white/80'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.0);
                      onSelectClub(c.id);
                      setIsSwitcherOpen(false);
                    }}
                    className="flex-1 text-left min-w-0 pr-2 cursor-pointer"
                  >
                    <div className="font-bold text-xs truncate">{c.name}</div>
                    <div className="text-[10px] text-white/50 flex items-center gap-2 mt-0.5">
                      <span>{c.members?.length || 1} members</span>
                      <span>•</span>
                      <span>Week {c.currentCycle?.weekNumber || 1}</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {c.id === activeClub.id && (
                      <span className="w-2 h-2 rounded-full bg-cyan-400 mr-1" />
                    )}
                    {onDeleteClub && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete "${c.name}"? This cannot be undone.`)) {
                            WatchSoundService.playTick(0.9);
                            onDeleteClub(c.id);
                            if (clubs.length <= 1) {
                              setIsSwitcherOpen(false);
                            }
                          }
                        }}
                        className="p-1.5 rounded-lg text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Delete club"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  setIsSwitcherOpen(false);
                  onCreateClub();
                }}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/15 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-cyan-400" />
                <span>Create New Club</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- CARD MAIN CONTENT ---------------- */}
      {nomination ? (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 relative z-10">
          {/* Left: Album Cover + Title + Curator + Stats */}
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            {/* Album Artwork with Specular Glass Lift */}
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-black/60 border border-white/20 shadow-2xl flex-shrink-0 group-hover:scale-[1.02] transition-transform">
              {nomination.artworkUrl ? (
                <img
                  src={nomination.artworkUrl}
                  alt={nomination.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-cyan-900/40 to-black text-white/30">
                  <Disc3 className="w-10 h-10 animate-spin-slow" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[9px] font-mono text-white/80 border border-white/10">
                {nomination.tracks.length} tracks
              </div>
            </div>

            {/* Info Block */}
            <div className="min-w-0 space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                This week's album
              </div>
              <h2 className="text-base sm:text-xl font-black text-white tracking-tight leading-snug line-clamp-2 break-words">
                {nomination.title}
              </h2>
              <div className="text-xs sm:text-sm font-semibold text-white/70 truncate">
                {nomination.artist}
              </div>

              {/* Curator Badge */}
              <div className="flex items-center gap-1.5 text-xs text-white/60 pt-0.5">
                <Crown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span>Nominated by <strong className="text-white font-bold">{nomination.curatorDisplayName || nomination.curatorUsername}</strong></span>
              </div>

              {/* Progress & Countdown Pills */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white/80">
                  <Headphones className="w-3 h-3 text-cyan-400" />
                  <span><strong>{listenedMembersCount}</strong> of <strong>{totalMembers}</strong> listened</span>
                </div>

                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-white/80">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span>
                    {daysLeft > 0 ? (
                      <><strong>{daysLeft}</strong> {daysLeft === 1 ? 'day' : 'days'} left</>
                    ) : (
                      <><strong>{hoursLeft}h</strong> left</>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Member Avatars Strip & Open Club Action */}
          <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/10">
            {/* Friends Avatars Strip */}
            <div className="flex items-center -space-x-2 overflow-hidden py-1">
              {members.slice(0, 5).map((member, i) => (
                <div
                  key={member.id}
                  title={`${member.displayName} (@${member.username})`}
                  className="relative w-8 h-8 rounded-full border-2 border-black/80 bg-neutral-800 text-white flex items-center justify-center text-xs font-bold shadow-md overflow-hidden flex-shrink-0"
                >
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt={member.displayName} className="w-full h-full object-cover" />
                  ) : (
                    <span>{member.displayName.slice(0, 1).toUpperCase()}</span>
                  )}
                  {member.hasListened && (
                    <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-400 border border-black ring-1 ring-emerald-300" />
                  )}
                </div>
              ))}
              {members.length > 5 && (
                <div className="w-8 h-8 rounded-full border-2 border-black/80 bg-white/15 backdrop-blur-md text-white flex items-center justify-center text-[10px] font-bold shadow-md flex-shrink-0">
                  +{members.length - 5}
                </div>
              )}
            </div>

            {/* Main Action Button */}
            <button
              type="button"
              onClick={() => {
                WatchSoundService.playTick(1.2);
                onOpenClubView();
              }}
              className="px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs sm:text-sm hover:bg-white/90 active:scale-95 transition-all shadow-xl flex items-center gap-1.5 cursor-pointer flex-shrink-0 group/btn"
            >
              <span>{stage === 'reveal' ? 'View Group Reveal' : 'Open Club'}</span>
              <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      ) : (
        /* If cycle is currently in 'nominate' stage */
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-2 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <h3 className="text-base font-bold text-white">
                {isCurator ? "You're this week's curator!" : `Curator @${cycle?.curatorUsername || 'curator'} is nominating`}
              </h3>
            </div>
            <p className="text-xs text-white/50 max-w-md">
              {isCurator 
                ? "Select an album for the group to listen to and experience together over the next 7 days."
                : "Awaiting this week's album selection. Check back once the host confirms their pick!"
              }
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isCurator && onNominateClick && (
              <button
                type="button"
                onClick={() => {
                  WatchSoundService.playTick(1.2);
                  onNominateClick();
                }}
                className="px-5 py-2.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Nominate Album</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenClubView}
              className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 backdrop-blur-md active:scale-95 transition-all cursor-pointer"
            >
              View Club Roster
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
