import React, { useState } from 'react';
import { 
  X, 
  Play, 
  Pause, 
  FolderPlus, 
  Disc3, 
  Sparkles, 
  Music, 
  Check, 
  Clock, 
  Share2,
  Trash2
} from 'lucide-react';
import { Track } from '../../../types/music';
import { MiniMixtape } from '../../../types/mixtapeTypes';
import { AppUser } from '../../../services/firebaseAuthService';
import { MixtapeService } from '../../../services/mixtapeService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mixtape: MiniMixtape | null;
  currentUser: AppUser | null;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onSavedToLibrary?: () => void;
  onDeleted?: () => void;
  dominantColor: string;
}

export const MiniMixtapeViewerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  mixtape,
  currentUser,
  onPlayTrack,
  currentTrack,
  isPlaying = false,
  onSavedToLibrary,
  onDeleted,
  dominantColor
}) => {
  const [isSaved, setIsSaved] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  if (!isOpen || !mixtape) return null;

  const handleDeleteMixtape = () => {
    if (!mixtape) return;
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }
    WatchSoundService.playTick(0.9);
    MixtapeService.deleteMixtape(mixtape.id);
    onDeleted?.();
    onClose();
  };

  const handlePlayAll = () => {
    if (mixtape.tracks.length > 0) {
      WatchSoundService.playTick(1.2);
      onPlayTrack(mixtape.tracks[0], mixtape.tracks);
      setToastMsg(`Now playing "${mixtape.title}"`);
      setTimeout(() => setToastMsg(null), 2500);
    }
  };

  const handleSaveToLibrary = () => {
    if (!currentUser) return;
    WatchSoundService.playTick(1.3);
    const res = MixtapeService.saveMixtapeToLibrary(mixtape, currentUser);
    if (res.success) {
      setIsSaved(true);
      setToastMsg(`Saved "${mixtape.title}" to your Playlists!`);
      if (onSavedToLibrary) onSavedToLibrary();
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-2xl animate-fadeIn">
      <div 
        className="w-full max-w-lg rounded-3xl overflow-hidden backdrop-blur-3xl border border-white/20 shadow-2xl flex flex-col max-h-[90vh] relative"
        style={{
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.04) 45%, rgba(0, 0, 0, 0.85) 100%)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(255, 255, 255, 0.15)'
        }}
      >
        {/* Toast */}
        {toastMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/90 border border-white/20 text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-fadeIn">
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Top Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-300">
              MINI MIXTAPE
            </span>
            <span className="text-xs text-white/40">from @{mixtape.creatorUsername}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-white/50 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 scrollbar-none">
          {/* Cover Display */}
          <div className="w-full aspect-video rounded-2xl overflow-hidden relative shadow-2xl flex items-center justify-center border border-white/15 bg-black/60">
            {mixtape.coverStyle === 'mosaic' && (
              <div className="grid grid-cols-2 w-full h-full">
                {mixtape.tracks.slice(0, 4).map((t, i) => (
                  <div key={i} className="w-full h-full overflow-hidden bg-black/80">
                    {t.artworkUrl ? (
                      <img src={t.artworkUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-white/5 text-white/30 text-xs">
                        <Music className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {mixtape.coverStyle === 'gradient' && (
              <div className="w-full h-full bg-gradient-to-br from-pink-500/40 via-purple-600/30 to-cyan-500/30 flex flex-col items-center justify-center p-4 text-center">
                <Disc3 className="w-12 h-12 text-pink-300 animate-spin-slow mb-2" />
                <div className="text-base font-black text-white">{mixtape.title}</div>
                <div className="text-xs font-mono text-white/70 mt-0.5">by @{mixtape.creatorUsername}</div>
              </div>
            )}

            {mixtape.coverStyle === 'typography' && (
              <div className="w-full h-full bg-black/95 p-6 flex flex-col justify-between border-t-4 border-pink-400">
                <div className="text-[10px] font-mono tracking-widest text-pink-400 uppercase">LUMEN MIXTAPE ARCHIVE</div>
                <div className="text-2xl font-black text-white leading-tight">{mixtape.title}</div>
                <div className="text-xs font-mono text-white/50">{mixtape.tracks.length} tracks • Curated with Lumen</div>
              </div>
            )}
          </div>

          {/* Title & Personal Note */}
          <div>
            <h3 className="text-lg font-black text-white tracking-tight">{mixtape.title}</h3>
            {mixtape.message && (
              <p className="text-xs text-white/70 italic mt-1 bg-white/[0.03] border border-white/10 p-2.5 rounded-xl">
                "{mixtape.message}"
              </p>
            )}
          </div>

          {/* Action Row: Play Tape + Save Copy + Delete */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePlayAll}
              className="flex-1 py-2.5 px-4 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-lg cursor-pointer"
            >
              <Play className="w-4 h-4 fill-black ml-0.5" />
              <span>Play Mini Mixtape</span>
            </button>

            <button
              type="button"
              onClick={handleSaveToLibrary}
              disabled={isSaved}
              className={`py-2.5 px-3.5 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                isSaved 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                  : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
              }`}
            >
              {isSaved ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4" />
                  <span>Save</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDeleteMixtape}
              className={`py-2.5 px-3 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                isConfirmingDelete
                  ? 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30'
                  : 'bg-white/5 hover:bg-red-500/15 border-white/15 text-white/60 hover:text-red-400'
              }`}
              title={isConfirmingDelete ? 'Click again to permanently delete' : 'Delete mixtape'}
            >
              <Trash2 className="w-4 h-4" />
              {isConfirmingDelete && <span>Confirm</span>}
            </button>
          </div>

          {/* Tracklist */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[11px] font-mono text-white/40 block mb-1">
              Tracks ({mixtape.tracks.length}):
            </span>
            {mixtape.tracks.map((t, idx) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 group transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="text-xs font-mono font-bold text-white/40 w-4">{idx + 1}</span>
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-black/60 flex-shrink-0">
                    <CoverImage
                      src={t.artworkUrl || null}
                      alt={t.title}
                      title={t.title}
                      artist={t.artist}
                      size={40}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white truncate">{t.title}</div>
                    <div className="text-[10px] text-white/50 truncate">{t.artist}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onPlayTrack(t, mixtape.tracks)}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white text-white hover:text-black transition-all cursor-pointer"
                  title="Play this track"
                >
                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
