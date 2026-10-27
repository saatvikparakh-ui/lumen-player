import React, { useState } from 'react';
import { X, Plus, Check, Music, FolderPlus, Disc3 } from 'lucide-react';
import { Track, CustomPlaylist } from '../../types/music';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  playlists: CustomPlaylist[];
  onAddTrackToPlaylist: (playlistId: string, track: Track) => boolean;
  onCreatePlaylist: (name?: string) => CustomPlaylist;
  dominantColor: string;
}

export const AddToPlaylistModal: React.FC<Props> = ({
  isOpen,
  onClose,
  track,
  playlists,
  onAddTrackToPlaylist,
  onCreatePlaylist,
  dominantColor
}) => {
  if (!isOpen || !track) return null;

  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [addedIds, setAddedIds] = useState<string[]>([]);

  const handleSelectPlaylist = (playlistId: string) => {
    const success = onAddTrackToPlaylist(playlistId, track);
    if (success) {
      setAddedIds(prev => [...prev, playlistId]);
      setTimeout(() => {
        onClose();
      }, 700);
    }
  };

  const handleCreateAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const newPl = onCreatePlaylist(newPlaylistName.trim());
    onAddTrackToPlaylist(newPl.id, track);
    setAddedIds(prev => [...prev, newPl.id]);
    setNewPlaylistName('');
    setIsCreatingNew(false);
    setTimeout(() => {
      onClose();
    }, 700);
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-fadeIn"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#0c0f17]/95 border-t border-l border-white/25 border-r border-b border-black/60 rounded-3xl p-6 shadow-2xl flex flex-col relative"
        style={{
          boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 35px -10px ${dominantColor}50`
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-4">
          <div className="flex items-center gap-2.5">
            <FolderPlus className="w-5 h-5 text-lumen-cyan" />
            <h3 className="text-sm font-bold text-white tracking-tight">Add to Playlist</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Song Preview */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 mb-4">
          <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/80 flex-shrink-0 shadow-md">
            {track.artworkUrl ? (
              <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover" />
            ) : (
              <Disc3 className="w-full h-full p-2 text-white/30" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-white truncate">{track.title}</h4>
            <p className="text-[11px] text-white/60 truncate">{track.artist}</p>
          </div>
        </div>

        {/* Playlists List */}
        <div className="space-y-1.5 max-h-60 overflow-y-auto no-scrollbar mb-4">
          {playlists.map((pl) => {
            const isAlreadyIn = pl.tracks.some(t => t.id === track.id) || addedIds.includes(pl.id);
            return (
              <button
                key={pl.id}
                onClick={() => handleSelectPlaylist(pl.id)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  isAlreadyIn
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/80 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div 
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: pl.coverColor || dominantColor }}
                  >
                    <Music className="w-3.5 h-3.5 text-black" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-bold truncate block">{pl.name}</span>
                    <span className="text-[10px] text-white/40 block font-mono">{pl.tracks.length} tracks</span>
                  </div>
                </div>

                {isAlreadyIn && (
                  <div className="flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Added</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Quick Create Playlist Inline */}
        {isCreatingNew ? (
          <form onSubmit={handleCreateAndAdd} className="flex gap-2 pt-2 border-t border-white/10">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name..."
              className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-xs text-white placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
              autoFocus
            />
            <button
              type="submit"
              className="px-4 py-2 bg-white text-black font-bold text-xs rounded-xl shadow-md hover:scale-105 transition-transform"
            >
              Create & Add
            </button>
          </form>
        ) : (
          <button
            onClick={() => setIsCreatingNew(true)}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white font-semibold transition-all"
          >
            <Plus className="w-4 h-4 text-lumen-cyan" />
            <span>Create New Playlist</span>
          </button>
        )}
      </div>
    </div>
  );
};
