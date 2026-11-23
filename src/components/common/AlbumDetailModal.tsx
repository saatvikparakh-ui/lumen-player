import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Shuffle,
  ListPlus,
  FolderPlus,
  Disc3,
  Clock,
  Loader2,
  Check,
  Music2,
  User
} from 'lucide-react';
import { Track } from '../../types/music';
import { AlbumMetadata, ArtistService } from '../../services/artistService';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  album: AlbumMetadata | null;
  dominantColor: string;
  currentTrack: Track | null;
  onClose: () => void;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onAddToQueue: (tracks: Track | Track[]) => void;
  onSelectArtist?: (artistName: string) => void;
  onSaveAsPlaylist?: (name: string, tracks: Track[]) => void;
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const AlbumDetailModal: React.FC<Props> = ({
  album,
  dominantColor,
  currentTrack,
  onClose,
  onPlayTrack,
  onAddToQueue,
  onSelectArtist,
  onSaveAsPlaylist
}) => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!album) {
      setTracks([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setTracks([]);
    setQueuedIds(new Set());

    ArtistService.getAlbumTracks(album.id, album.title, album.artist)
      .then((list) => {
        if (!cancelled) {
          setTracks(list || []);
        }
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [album?.id, album?.title, album?.artist]);

  if (!album) return null;

  const flashToast = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 2400);
  };

  const handlePlayAll = (shuffle = false) => {
    if (tracks.length === 0) return;
    WatchSoundService.playTick(1.15);
    const list = [...tracks];
    if (shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    onPlayTrack(list[0], list);
    onClose();
  };

  const handleQueueAlbum = () => {
    if (tracks.length === 0) return;
    WatchSoundService.playTick(1.1);
    onAddToQueue(tracks);
    flashToast(`Added ${tracks.length} tracks to Up Next`);
  };

  const handleSavePlaylist = () => {
    if (tracks.length === 0 || !onSaveAsPlaylist) return;
    WatchSoundService.playTick(1.2);
    onSaveAsPlaylist(album.title, tracks);
    flashToast(`Saved "${album.title}" as a playlist!`);
  };

  const totalSec = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const totalMins = Math.round(totalSec / 60);

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-xl flex items-end sm:items-center justify-center sm:p-6 animate-fadeIn select-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-2xl h-[92dvh] sm:h-auto sm:max-h-[86vh] rounded-t-3xl sm:rounded-3xl border border-white/20 overflow-hidden flex flex-col shadow-[0_30px_90px_rgba(0,0,0,0.95)]"
        style={{
          background: `linear-gradient(160deg, ${dominantColor}28 0%, rgba(12, 16, 28, 0.94) 38%, rgba(6, 8, 14, 0.98) 100%)`
        }}
      >
        {/* Feedback Toast */}
        {savedToast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-black/90 border border-white/20 text-xs font-semibold text-white shadow-2xl flex items-center gap-1.5 animate-fadeIn">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>{savedToast}</span>
          </div>
        )}

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/50 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white/80 hover:text-white active:scale-90 transition-all cursor-pointer"
          title="Close album"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Album Hero Header */}
        <div className="p-5 sm:p-6 pb-4 flex flex-col sm:flex-row items-center sm:items-end gap-4 sm:gap-5 border-b border-white/10 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-2xl overflow-hidden bg-black/60 border border-white/20 shadow-2xl flex-shrink-0">
            {album.artworkUrl ? (
              <img
                src={album.artworkUrl}
                alt={album.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/30">
                <Disc3 className="w-12 h-12" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 text-center sm:text-left space-y-1.5 w-full">
            <span className="inline-block text-[10px] font-mono uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-white/10 border border-white/15 text-white/75">
              Album {album.year ? `• ${album.year}` : ''}
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-tight line-clamp-2">
              {album.title}
            </h2>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-white/65">
              <button
                type="button"
                onClick={() => {
                  if (onSelectArtist) {
                    onClose();
                    onSelectArtist(album.artist);
                  }
                }}
                className="inline-flex items-center gap-1 font-bold text-white hover:text-lumen-cyan transition-colors cursor-pointer"
              >
                <User className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>{album.artist}</span>
              </button>
              <span>•</span>
              <span>{tracks.length || album.trackCount || 0} songs</span>
              {totalMins > 0 && (
                <>
                  <span>•</span>
                  <span>{totalMins} min</span>
                </>
              )}
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-2">
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => handlePlayAll(false)}
                className="px-5 py-2 rounded-full bg-white text-black font-bold text-xs flex items-center gap-1.5 shadow-lg hover:bg-white/90 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>Play</span>
              </button>

              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => handlePlayAll(true)}
                className="px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs flex items-center gap-1.5 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Shuffle</span>
              </button>

              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={handleQueueAlbum}
                className="px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs flex items-center gap-1.5 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
                title="Add album to Up Next queue"
              >
                <ListPlus className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Queue</span>
              </button>

              {onSaveAsPlaylist && (
                <button
                  type="button"
                  disabled={tracks.length === 0}
                  onClick={handleSavePlaylist}
                  className="px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs flex items-center gap-1.5 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
                  title="Save album as a custom playlist"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-purple-300" />
                  <span>Save</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Tracklist */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-1">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-white/50">
              <Loader2 className="w-6 h-6 animate-spin text-lumen-cyan" />
              <span className="text-xs font-mono">Loading album tracks...</span>
            </div>
          ) : tracks.length === 0 ? (
            <div className="py-16 text-center text-white/45 text-xs space-y-2">
              <Music2 className="w-8 h-8 mx-auto opacity-40" />
              <p>Could not load tracklist for "{album.title}".</p>
            </div>
          ) : (
            tracks.map((track, idx) => {
              const isActive = currentTrack?.id === track.id;
              const isQueued = queuedIds.has(track.id);
              return (
                <div
                  key={`${track.id}_${idx}`}
                  onClick={() => {
                    WatchSoundService.playTick(1.0);
                    onPlayTrack(track, tracks);
                    onClose();
                  }}
                  className={`group flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl border transition-all cursor-pointer active:scale-[0.99] ${
                    isActive
                      ? 'bg-lumen-cyan/15 border-lumen-cyan/40'
                      : 'bg-white/[0.02] hover:bg-white/[0.08] border-transparent hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`w-6 text-center font-mono text-xs flex-shrink-0 ${isActive ? 'text-lumen-cyan font-bold' : 'text-white/40'}`}>
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs sm:text-sm font-semibold truncate ${isActive ? 'text-lumen-cyan' : 'text-white'}`}>
                        {track.title}
                      </div>
                      <div className="text-[11px] text-white/50 truncate">
                        {track.artist}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    {track.duration > 0 && (
                      <span className="text-[11px] font-mono text-white/40 flex items-center gap-1">
                        <Clock className="w-3 h-3 hidden sm:inline opacity-60" />
                        {formatDuration(track.duration)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        WatchSoundService.playTick(1.1);
                        onAddToQueue(track);
                        setQueuedIds(prev => new Set(prev).add(track.id));
                        flashToast(`Queued "${track.title}"`);
                      }}
                      className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all active:scale-90 cursor-pointer ${
                        isQueued
                          ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                          : 'bg-white/[0.06] hover:bg-white/15 border-white/10 text-white/70 hover:text-white'
                      }`}
                      title="Add to Queue"
                    >
                      {isQueued ? <Check className="w-3.5 h-3.5" /> : <ListPlus className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
