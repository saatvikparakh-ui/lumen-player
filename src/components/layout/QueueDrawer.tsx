import React from 'react';
import { X, Play, Trash2, Music } from 'lucide-react';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
}

export const QueueDrawer: React.FC<Props> = ({ isOpen, onClose, currentTrack }) => {
  if (!isOpen) return null;

  const queue = AudioEngine.getQueue();

  return (
    <div className="fixed top-0 right-0 w-80 h-[calc(100vh-6rem)] bg-lumen-panel border-l border-lumen-borderSubtle z-20 flex flex-col shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="p-4 border-b border-lumen-borderSubtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-lumen-cyan" />
          <h3 className="text-sm font-semibold text-lumen-text">Play Queue</h3>
          <span className="text-[11px] font-mono text-lumen-textMuted">({queue.length})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-surface transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Currently Playing Card */}
        {currentTrack && (
          <div className="mb-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-lumen-cyan font-bold block mb-1.5 px-1">
              Now Playing
            </span>
            <div className="p-2.5 rounded-lg bg-lumen-surface border border-lumen-cyan/40 shadow-led-cyan flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-lumen-panel border border-lumen-border overflow-hidden flex-shrink-0">
                {currentTrack.artworkUrl ? (
                  <img src={currentTrack.artworkUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-lumen-cyan text-xs font-bold">♪</div>
                )}
              </div>
              <div className="truncate flex-1">
                <p className="text-xs font-semibold text-lumen-text truncate">{currentTrack.title}</p>
                <p className="text-[11px] text-lumen-textMuted truncate">{currentTrack.artist}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-lumen-textDim font-bold">
            Up Next
          </span>
        </div>

        {queue.length === 0 ? (
          <div className="py-8 text-center text-xs text-lumen-textDim">
            Queue is empty. Select a song or album to begin playing.
          </div>
        ) : (
          queue.map((track, idx) => {
            const isCurrent = currentTrack?.id === track.id;
            return (
              <div
                key={`${track.id}_${idx}`}
                onClick={() => AudioEngine.playTrack(track)}
                className={`p-2 rounded-lg flex items-center gap-3 cursor-pointer group transition-all ${
                  isCurrent
                    ? 'bg-lumen-surface/80 border border-lumen-border'
                    : 'hover:bg-lumen-surface border border-transparent'
                }`}
              >
                <span className="w-4 text-center text-[10px] font-mono text-lumen-textDim group-hover:text-lumen-cyan">
                  {idx + 1}
                </span>
                <div className="w-8 h-8 rounded bg-lumen-panel border border-lumen-border overflow-hidden flex-shrink-0">
                  {track.artworkUrl ? (
                    <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-lumen-textDim">♪</div>
                  )}
                </div>
                <div className="truncate flex-1">
                  <p className={`text-xs truncate ${isCurrent ? 'text-lumen-cyan font-semibold' : 'text-lumen-text'}`}>
                    {track.title}
                  </p>
                  <p className="text-[10px] text-lumen-textMuted truncate">{track.artist}</p>
                </div>
                <Play className="w-3.5 h-3.5 text-lumen-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
