import React, { useState } from 'react';
import { 
  X, 
  Disc3, 
  Users, 
  Plus, 
  Sparkles, 
  Check, 
  Crown 
} from 'lucide-react';
import { WatchSoundService } from '../../../services/watchSoundService';

interface CreateAlbumClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, selectedFriends: any[]) => void;
  friends: Array<{
    userId?: string;
    id?: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  }>;
}

export const CreateAlbumClubModal: React.FC<CreateAlbumClubModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  friends
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);

  if (!isOpen) return null;

  const toggleFriend = (id: string) => {
    WatchSoundService.playTick(1.0);
    setSelectedFriendIds(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    WatchSoundService.playTick(1.3);

    const chosenFriends = friends.filter(f => {
      const fId = f.userId || f.id || '';
      return selectedFriendIds.includes(fId);
    });

    onCreate(name.trim(), description.trim(), chosenFriends);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn">
      <div 
        className="relative w-full max-w-lg rounded-3xl bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-black/90 border border-white/20 backdrop-blur-3xl p-6 shadow-[0_30px_90px_rgba(0,0,0,0.9)] space-y-5"
        style={{
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.9), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center border border-cyan-500/30">
              <Disc3 className="w-4 h-4 animate-spin-slow" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Create Album Club</h3>
              <p className="text-xs text-white/50">Invite friends for weekly album deep-dives</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="space-y-4">
          {/* Club Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/70">Club Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sunday Spinners, Heavy Rotation..."
              className="w-full px-4 py-2.5 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/30 text-xs focus:outline-none focus:border-cyan-400"
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/70">Club Vibe / Theme (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dream pop, ambient synthesizers & 70s rock"
              className="w-full px-4 py-2.5 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/30 text-xs focus:outline-none focus:border-cyan-400"
            />
          </div>

          {/* Select Friends */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white/70 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                <span>Invite Friends ({selectedFriendIds.length} selected)</span>
              </span>
              <span className="text-[10px] font-mono text-white/40">From your connected friends</span>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {friends.length > 0 ? (
                friends.map((f) => {
                  const fId = f.userId || f.id || '';
                  const isChecked = selectedFriendIds.includes(fId);
                  return (
                    <div
                      key={fId}
                      onClick={() => toggleFriend(fId)}
                      className={`p-2.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                        isChecked
                          ? 'bg-cyan-500/15 border-cyan-500/40 text-white'
                          : 'bg-white/[0.03] border-white/5 hover:border-white/15 text-white/70'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-neutral-800 text-white flex items-center justify-center text-xs font-bold border border-white/10">
                          {(f.displayName || f.username || 'F').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">{f.displayName || f.username}</div>
                          <div className="text-[10px] text-white/40 truncate">@{f.username}</div>
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-lg border flex items-center justify-center ${
                        isChecked ? 'bg-cyan-400 border-cyan-400 text-black' : 'border-white/20'
                      }`}>
                        {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-center text-xs text-white/40">
                  No connected friends found yet. You can create the club now and invite friends anytime!
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-3 rounded-full bg-lumen-cyan text-black font-bold text-xs hover:bg-lumen-cyan/90 active:scale-95 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Create Album Club</span>
          </button>
        </form>
      </div>
    </div>
  );
};
