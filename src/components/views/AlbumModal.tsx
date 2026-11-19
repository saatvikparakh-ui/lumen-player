import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Play, 
  Pause, 
  Shuffle, 
  ListPlus, 
  Heart, 
  Disc3, 
  Clock, 
  Share2, 
  Loader2,
  ListStart,
  Music
} from 'lucide-react';
import { Track } from '../../types/music';
import { ArtistService } from '../../services/artistService';
import { AudioEngine } from '../../services/audioEngine';
import { LikedService } from '../../services/likedService';
import { WatchSoundService } from '../../services/watchSoundService';
import { CoverImage } from '../common/CoverImage';

interface AlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  albumTitle: string;
  artistName: string;
  coverUrl?: string | null;
  dominantColor?: string;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onSelectArtist?: (artist: string) => void;
}

export const AlbumModal: React.FC<AlbumModalProps> = ({
  isOpen,
  onClose,
  albumTitle,
  artistName,
  coverUrl,
  dominantColor = '#06b6d4',
  onPlayTrack,
  onSelectArtist
}) => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [albumArt, setAlbumArt] = useState<string | null>(coverUrl || null);
  const [releaseYear, setReleaseYear] = useState<string | null>(null);

  const currentTrack = AudioEngine.getCurrentTrack();
  const isPlaying = AudioEngine.isPlaying();

  useEffect(() => {
    if (!isOpen || !albumTitle) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);
    setAlbumArt(coverUrl || null);

    const loadTracks = async () => {
      try {
        const albumKey = `alb_${encodeURIComponent(albumTitle.toLowerCase().trim())}_${encodeURIComponent(artistName.toLowerCase().trim())}`;
        const fetched = await ArtistService.getAlbumTracks(albumKey, albumTitle, artistName);
        
        if (!isMounted) return;

        if (fetched && fetched.length > 0) {
          setTracks(fetched);
          const firstWithArt = fetched.find(t => t.artworkUrl);
          if (firstWithArt?.artworkUrl && !coverUrl) {
            setAlbumArt(firstWithArt.artworkUrl);
          }
          if (fetched[0]?.year) {
            setReleaseYear(String(fetched[0].year));
          }
        } else {
          setError('No songs found for this album.');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setError(err?.message || 'Unable to load album tracks.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadTracks();

    return () => {
      isMounted = false;
    };
  }, [isOpen, albumTitle, artistName, coverUrl]);

  // Keyboard Escape listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const totalDurationSec = useMemo(() => {
    return tracks.reduce((acc, t) => acc + (Number(t.duration) || 0), 0);
  }, [tracks]);

  const formatTotalTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hrs} hr ${remMins} min`;
    }
    return `${mins} min`;
  };

  const formatTrackDuration = (dur?: number) => {
    if (!dur || isNaN(dur)) return '0:00';
    const m = Math.floor(dur / 60);
    const s = Math.floor(dur % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handlePlayAll = () => {
    if (tracks.length === 0) return;
    WatchSoundService.playTick(1.2);
    onPlayTrack(tracks[0], tracks);
  };

  const handleShuffleAll = () => {
    if (tracks.length === 0) return;
    WatchSoundService.playTick(1.2);
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    AudioEngine.setShuffle(true);
    onPlayTrack(shuffled[0], shuffled);
  };

  const handleAddAllToQueue = () => {
    if (tracks.length === 0) return;
    AudioEngine.addTracksToQueue(tracks, false);
    WatchSoundService.playTick(1.1);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] animate-fadeIn select-none"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-neutral-950/95 border border-white/15 rounded-3xl p-5 sm:p-7 shadow-2xl overflow-hidden relative flex flex-col max-h-[85vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow: `0 25px 60px -15px ${dominantColor}40, 0 0 30px rgba(0,0,0,0.8)`
        }}
      >
        {/* Ambient Top Glow */}
        <div 
          className="absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ backgroundColor: dominantColor }}
        />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all cursor-pointer z-10"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Album Header Banner */}
        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 pb-5 border-b border-white/10 flex-shrink-0 relative z-10">
          {/* Cover Art */}
          <div 
            className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden shadow-2xl border border-white/20 flex-shrink-0 relative group"
            style={{
              boxShadow: `0 15px 35px -10px ${dominantColor}60`
            }}
          >
            <CoverImage 
              src={albumArt} 
              alt={albumTitle} 
              title={albumTitle} 
              artist={artistName} 
              album={albumTitle}
              size={600} 
              className="w-full h-full object-cover" 
              onResolved={(url) => {
                if (url && !albumArt) setAlbumArt(url);
              }}
            />
          </div>

          {/* Details */}
          <div className="flex-1 text-center sm:text-left min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-widest text-lumen-cyan font-bold block mb-1">
              ALBUM DISCOGRAPHY
            </span>

            <h2 className="text-xl sm:text-2xl font-black text-white leading-tight truncate" title={albumTitle}>
              {albumTitle}
            </h2>

            <div className="mt-1 flex items-center justify-center sm:justify-start gap-2 text-xs">
              <button
                onClick={() => {
                  if (onSelectArtist) {
                    onSelectArtist(artistName);
                    onClose();
                  }
                }}
                className="font-semibold text-white/80 hover:text-white hover:underline transition-colors cursor-pointer"
                title={`Explore ${artistName} discography`}
              >
                {artistName}
              </button>
              {releaseYear && (
                <>
                  <span className="text-white/30">•</span>
                  <span className="text-white/50 font-mono">{releaseYear}</span>
                </>
              )}
            </div>

            <div className="mt-2 text-[11px] font-mono text-white/40 flex items-center justify-center sm:justify-start gap-3">
              <span>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'}</span>
              {totalDurationSec > 0 && (
                <>
                  <span>•</span>
                  <span>{formatTotalTime(totalDurationSec)}</span>
                </>
              )}
            </div>

            {/* Actions Bar */}
            <div className="mt-4 flex items-center justify-center sm:justify-start gap-2.5 flex-wrap">
              <button
                onClick={handlePlayAll}
                disabled={tracks.length === 0}
                className="px-5 py-2 rounded-full bg-white text-black font-bold text-xs flex items-center gap-1.5 shadow-lg hover:scale-105 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                <span>Play All</span>
              </button>

              <button
                onClick={handleShuffleAll}
                disabled={tracks.length === 0}
                className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-xs flex items-center gap-1.5 border border-white/15 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Shuffle</span>
              </button>

              <button
                onClick={handleAddAllToQueue}
                disabled={tracks.length === 0}
                className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-xs flex items-center gap-1.5 border border-white/15 active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
              >
                <ListPlus className="w-3.5 h-3.5 text-white/70" />
                <span>Add to Queue</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tracks List */}
        <div className="flex-1 overflow-y-auto no-scrollbar pt-3 pr-1 min-h-[160px]">
          {isLoading ? (
            <div className="h-44 flex flex-col items-center justify-center gap-2.5 text-white/50 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-lumen-cyan" />
              <span>Fetching verified studio tracks for {albumTitle}...</span>
            </div>
          ) : error ? (
            <div className="h-44 flex flex-col items-center justify-center text-center p-4">
              <Disc3 className="w-10 h-10 text-white/30 mb-2 stroke-[1.5]" />
              <p className="text-xs text-white/70 font-semibold">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  const albumKey = `alb_${encodeURIComponent(albumTitle.toLowerCase().trim())}_${encodeURIComponent(artistName.toLowerCase().trim())}`;
                  ArtistService.getAlbumTracks(albumKey, albumTitle, artistName)
                    .then(res => {
                      setTracks(res || []);
                      setIsLoading(false);
                    })
                    .catch(() => setIsLoading(false));
                }}
                className="mt-3 px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs text-white font-semibold border border-white/15"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {tracks.map((track, idx) => {
                const isTrackPlaying = currentTrack?.id === track.id && isPlaying;
                const isLiked = LikedService.isLiked(track.id);

                return (
                  <div
                    key={`${track.id}-${idx}`}
                    className={`group flex items-center justify-between p-2.5 rounded-xl transition-all duration-150 border ${
                      isTrackPlaying
                        ? 'bg-white/15 border-white/20 text-lumen-cyan'
                        : 'hover:bg-white/5 border-transparent text-white'
                    }`}
                  >
                    {/* Left: Track Number / Play Trigger */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        onClick={() => onPlayTrack(track, tracks)}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white group-hover:bg-white/10 transition-colors flex-shrink-0"
                      >
                        {isTrackPlaying ? (
                          <Pause className="w-3.5 h-3.5 fill-current text-lumen-cyan" />
                        ) : (
                          <span className="text-xs font-mono text-white/40 group-hover:hidden">
                            {idx + 1 < 10 ? `0${idx + 1}` : idx + 1}
                          </span>
                        )}
                        {!isTrackPlaying && (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5 hidden group-hover:block text-white" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1 pr-2">
                        <div className={`text-xs font-semibold truncate ${isTrackPlaying ? 'text-lumen-cyan font-bold' : 'text-white'}`}>
                          {track.title}
                        </div>
                        <div className="text-[10px] text-white/50 truncate">
                          {track.artist}
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Play Next */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          AudioEngine.addTracksToQueue([track], false);
                          WatchSoundService.playTick(1.1);
                        }}
                        className="p-1.5 text-white/40 hover:text-lumen-cyan opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="Add to Queue"
                      >
                        <ListPlus className="w-3.5 h-3.5" />
                      </button>

                      {/* Like Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          LikedService.toggleLike(track);
                        }}
                        className="p-1.5 text-white/40 hover:text-rose-400 transition-colors cursor-pointer"
                        title={isLiked ? "Unlike" : "Like"}
                      >
                        <Heart className={`w-3.5 h-3.5 ${isLiked ? 'text-rose-500 fill-rose-500' : ''}`} />
                      </button>

                      {/* Duration */}
                      <span className="text-[11px] font-mono text-white/40 w-10 text-right">
                        {formatTrackDuration(track.duration)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
