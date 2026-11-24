import React, { useEffect, useMemo, useState } from 'react';
import { X, Star, Play, ListPlus, Search, Trash2, Check, SlidersHorizontal } from 'lucide-react';
import type { Track } from '../../types/music';
import { RatingAndStatsService } from '../../services/ratingAndStatsService';
import { AudioEngine } from '../../services/audioEngine';
import { CoverImage } from '../common/CoverImage';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  dominantColor: string;
}

type RatedEntry = { track: Track; rating: number; formatted: string };

export const RatedSongsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onPlayTrack,
  currentTrack,
  isPlaying,
  dominantColor
}) => {
  const [entries, setEntries] = useState<RatedEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'highest' | 'lowest' | 'az'>('highest');
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [draftScore, setDraftScore] = useState<number>(8.5);
  const [toast, setToast] = useState<string | null>(null);

  const refreshRated = () => {
    setEntries(RatingAndStatsService.getAllRatedTracks());
  };

  useEffect(() => {
    if (!isOpen) return;
    refreshRated();
    const unsub = RatingAndStatsService.onRatingChange(() => {
      refreshRated();
    });
    return () => {
      unsub();
    };
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = entries;
    if (q) {
      list = list.filter(
        (item) =>
          item.track.title.toLowerCase().includes(q) ||
          item.track.artist.toLowerCase().includes(q) ||
          (item.track.album || '').toLowerCase().includes(q)
      );
    }
    const copy = [...list];
    if (sortBy === 'highest') {
      copy.sort((a, b) => b.rating - a.rating || a.track.title.localeCompare(b.track.title));
    } else if (sortBy === 'lowest') {
      copy.sort((a, b) => a.rating - b.rating || a.track.title.localeCompare(b.track.title));
    } else {
      copy.sort((a, b) => a.track.title.localeCompare(b.track.title));
    }
    return copy;
  }, [entries, searchQuery, sortBy]);

  if (!isOpen) return null;

  const avgRating =
    entries.length > 0
      ? (entries.reduce((sum, item) => sum + item.rating, 0) / entries.length).toFixed(1)
      : null;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleStartEdit = (item: RatedEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSongId(item.track.id);
    setDraftScore(item.rating);
  };

  const handleSaveEdit = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    await RatingAndStatsService.setRating(track, draftScore);
    WatchSoundService.playTick(1.2);
    setEditingSongId(null);
    showToast(`Updated "${track.title}" to ★ ${draftScore.toFixed(1)}`);
  };

  const handleDeleteRating = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    await RatingAndStatsService.deleteRating(track.id);
    WatchSoundService.playTick(0.9);
    setEditingSongId(null);
    showToast(`Removed rating for "${track.title}"`);
  };

  const handlePlayAll = () => {
    if (filtered.length === 0) return;
    const queue = filtered.map((e) => e.track);
    onPlayTrack(queue[0], queue);
    WatchSoundService.playTick(1.2);
  };

  return (
    <div
      className="fixed inset-0 z-[115] bg-black/75 backdrop-blur-2xl flex items-center justify-center p-3 sm:p-6 animate-fadeIn select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[86vh] rounded-[28px] bg-[#0B0E18]/95 border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden relative"
        style={{
          boxShadow: `0 28px 80px rgba(0,0,0,0.92), 0 0 42px -10px ${dominantColor}45`
        }}
      >
        {/* Subtle Liquid Glass Accent Glow */}
        <div
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-25"
          style={{ background: dominantColor }}
        />

        {/* Header */}
        <div className="relative z-10 px-5 pt-5 pb-3.5 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-400/15 border border-amber-300/35 flex items-center justify-center text-amber-300 shadow-inner shrink-0">
              <Star className="w-5 h-5 fill-amber-300/80" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-black text-white tracking-tight truncate">
                Rated Songs
              </h3>
              <p className="text-[11px] text-white/55 font-medium truncate">
                {entries.length} {entries.length === 1 ? 'song' : 'songs'} rated
                {avgRating ? ` • Avg ★ ${avgRating}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {filtered.length > 0 && (
              <button
                type="button"
                onClick={handlePlayAll}
                className="px-3.5 py-1.5 rounded-full text-xs font-extrabold text-black flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                style={{ backgroundColor: dominantColor || '#63E8FF' }}
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>Play All</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white/75 hover:text-white transition-colors cursor-pointer"
              aria-label="Close Rated Songs"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search & Sort Controls */}
        <div className="relative z-10 px-5 py-3 border-b border-white/[0.07] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search rated songs or artists..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/30"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10 shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5 text-white/40 ml-1.5 mr-0.5 hidden sm:block" />
            {(
              [
                { id: 'highest', label: 'Highest' },
                { id: 'lowest', label: 'Lowest' },
                { id: 'az', label: 'A–Z' }
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  sortBy === opt.id
                    ? 'bg-white text-black shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rated Songs List */}
        <div className="relative z-10 flex-1 overflow-y-auto px-3 sm:px-5 py-3 space-y-1.5 no-scrollbar">
          {filtered.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <Star className="w-9 h-9 text-amber-300/35 mx-auto" />
              <div className="text-sm font-bold text-white/80">
                {entries.length === 0 ? 'No rated songs yet' : 'No matching rated songs'}
              </div>
              <p className="text-xs text-white/45 max-w-xs mx-auto">
                {entries.length === 0
                  ? 'Tap Rate on any song you listen to and your personal score list will appear here.'
                  : 'Try searching by another title or artist.'}
              </p>
            </div>
          ) : (
            filtered.map((item) => {
              const isCurrent =
                currentTrack &&
                (currentTrack.id === item.track.id ||
                  (currentTrack.title === item.track.title && currentTrack.artist === item.track.artist));
              const isEditing = editingSongId === item.track.id;

              return (
                <div
                  key={item.track.id}
                  onClick={() => {
                    if (!isEditing) {
                      onPlayTrack(
                        item.track,
                        filtered.map((e) => e.track)
                      );
                    }
                  }}
                  className={`group rounded-2xl border transition-all px-3 py-2.5 cursor-pointer ${
                    isCurrent
                      ? 'bg-white/[0.11] border-white/25 shadow-lg'
                      : 'bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.07]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Small Curved Album Cover */}
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/60 border border-white/15 shadow-md shrink-0 relative">
                      <CoverImage
                        src={item.track.artworkUrl}
                        title={item.track.title}
                        artist={item.track.artist}
                        album={item.track.album}
                        size={200}
                        className="w-full h-full object-cover"
                      />
                      {isCurrent && isPlaying && (
                        <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-lumen-cyan animate-pulse" />
                        </div>
                      )}
                    </div>

                    {/* Title & Artist */}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs sm:text-[13px] font-bold truncate ${
                          isCurrent ? 'text-lumen-cyan' : 'text-white'
                        }`}
                      >
                        {item.track.title}
                      </div>
                      <div className="text-[11px] text-white/55 truncate mt-0.5">
                        {item.track.artist}
                      </div>
                    </div>

                    {/* Interactive Rating Badge */}
                    <button
                      type="button"
                      onClick={(e) => handleStartEdit(item, e)}
                      title="Edit rating"
                      className="px-2.5 py-1 rounded-full bg-amber-400/15 hover:bg-amber-400/25 border border-amber-300/35 text-amber-300 text-xs font-extrabold font-mono flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                    >
                      <Star className="w-3 h-3 fill-amber-300" />
                      <span>{item.formatted}</span>
                    </button>

                    {/* Add to Queue */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        AudioEngine.addToQueue(item.track);
                        WatchSoundService.playTick(1.1);
                        showToast(`Added "${item.track.title}" to queue`);
                      }}
                      title="Add to Queue"
                      className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/15 border border-white/10 flex items-center justify-center text-white/65 hover:text-white transition-colors shrink-0 cursor-pointer"
                    >
                      <ListPlus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Inline Rating Editor */}
                  {isEditing && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2.5 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5 animate-fadeIn"
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-[170px]">
                        <input
                          type="range"
                          min={0.5}
                          max={10}
                          step={0.1}
                          value={draftScore}
                          onChange={(e) => setDraftScore(parseFloat(e.target.value))}
                          className="flex-1 accent-amber-400 h-1.5 cursor-pointer"
                        />
                        <span className="text-xs font-mono font-black text-amber-300 w-10 text-right">
                          {draftScore.toFixed(1)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => handleSaveEdit(item.track, e)}
                          className="px-2.5 py-1 rounded-lg bg-amber-400 text-black text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3 h-3 stroke-[3]" />
                          <span>Save</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteRating(item.track, e)}
                          className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          title="Remove rating"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Clear</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSongId(null);
                          }}
                          className="px-2 py-1 rounded-lg bg-white/10 text-white/70 text-[11px] font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Floating Toast */}
        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-black/90 border border-white/20 text-[11px] font-semibold text-white shadow-2xl">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
};
