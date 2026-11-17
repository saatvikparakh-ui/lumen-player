import React, { useState, useMemo } from 'react';
import { 
  X, 
  Radio, 
  Search, 
  Users, 
  Check, 
  Sparkles, 
  Sliders, 
  Vote, 
  Shuffle, 
  ListOrdered, 
  ShieldAlert, 
  UserPlus 
} from 'lucide-react';
import { AppUser } from '../../../services/firebaseAuthService';
import { FriendProfileData } from './friendsTypes';
import { AuxSession, AuxSessionMode, AuxSettings } from '../../../types/auxTypes';
import { AuxService } from '../../../services/auxService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  friends: FriendProfileData[];
  onSessionCreated: (session: AuxSession) => void;
  dominantColor: string;
}

export const PassTheAuxCreateModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentUser,
  friends,
  onSessionCreated,
  dominantColor
}) => {
  const defaultTitle = useMemo(() => {
    const name = currentUser?.displayName || currentUser?.username || 'Lumen';
    return `${name}'s Aux Jam`;
  }, [currentUser]);

  const [title, setTitle] = useState(defaultTitle);
  const [mode, setMode] = useState<AuxSessionMode>('open_queue');
  const [duplicatePolicy, setDuplicatePolicy] = useState<'warn_allow' | 'disallow'>('warn_allow');
  const [canReorder, setCanReorder] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter friends by search query
  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(f => 
      (f.displayName && f.displayName.toLowerCase().includes(q)) ||
      (f.username && f.username.toLowerCase().includes(q))
    );
  }, [friends, searchQuery]);

  if (!isOpen) return null;

  const toggleFriend = (userId: string) => {
    WatchSoundService.playTick(1.0);
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    WatchSoundService.playTick(1.1);
    setSelectedUserIds(new Set(filteredFriends.map(f => f.userId)));
  };

  const handleClearSelection = () => {
    WatchSoundService.playTick(0.9);
    setSelectedUserIds(new Set());
  };

  const handleCreate = async () => {
    if (!currentUser) {
      setErrorMsg('Please sign in to host a Pass The Aux room');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    WatchSoundService.playTick(1.3);

    try {
      const selectedFriendsData = friends
        .filter(f => selectedUserIds.has(f.userId))
        .map(f => ({
          uid: f.userId,
          username: f.username,
          displayName: f.displayName,
          photoURL: f.photoURL
        }));

      const settings: Partial<AuxSettings> = {
        duplicatePolicy,
        canReorder
      };

      const res = await AuxService.createSession(
        currentUser,
        title.trim() || defaultTitle,
        mode,
        undefined,
        selectedFriendsData,
        settings
      );

      if (res.success && res.session) {
        onSessionCreated(res.session);
        onClose();
      } else {
        setErrorMsg(res.error || 'Could not create aux room. Please retry.');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to start room');
    } finally {
      setIsSubmitting(false);
    }
  };

  const modeOptions: Array<{
    id: AuxSessionMode;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
  }> = [
    {
      id: 'open_queue',
      title: 'Open Queue',
      description: 'Collaborative queue. Any invited friend can add and order songs.',
      icon: ListOrdered,
      accent: 'text-amber-400 border-amber-500/40 bg-amber-500/10'
    },
    {
      id: 'vote_next',
      title: 'Vote Next',
      description: 'Participants vote on candidate tracks. Highest voted plays next.',
      icon: Vote,
      accent: 'text-lumen-cyan border-cyan-500/40 bg-cyan-500/10'
    },
    {
      id: 'round_robin',
      title: 'Round Robin',
      description: 'Turn-based queue rotation ensures each friend gets an equal spotlight.',
      icon: Shuffle,
      accent: 'text-purple-400 border-purple-500/40 bg-purple-500/10'
    },
    {
      id: 'free_queue',
      title: 'Free Aux',
      description: 'Fast-paced queue with instant additions and immediate queue access.',
      icon: Radio,
      accent: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-2xl animate-fadeIn">
      <div 
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl overflow-hidden backdrop-blur-3xl border border-white/20 shadow-2xl relative"
        style={{
          background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12) 0%, rgba(14, 28, 54, 0.40) 45%, rgba(4, 10, 24, 0.65) 100%)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(6, 182, 212, 0.35)'
        }}
      >
        {/* Glow Accent */}
        <div 
          className="pointer-events-none absolute -top-20 -right-20 w-60 h-60 rounded-full filter blur-3xl opacity-20"
          style={{ backgroundColor: dominantColor || '#06B6D4' }}
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl apple-glass-icon flex items-center justify-center text-cyan-300">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                <span>Start Pass The Aux</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Live Jam
                </span>
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 scrollbar-thin">
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-xs text-rose-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Room Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/80 tracking-wide uppercase font-mono">
              Room Name
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Late Night Aux Jam"
              maxLength={40}
              className="w-full px-4 py-2.5 rounded-2xl bg-white/5 border border-white/15 text-white text-sm placeholder-white/30 focus:outline-none focus:border-cyan-400/80 transition-colors"
            />
          </div>

          {/* Mode Selector Presets */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-white/80 tracking-wide uppercase font-mono">
              Preset Settings & Modes
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {modeOptions.map(opt => {
                const isSelected = mode === opt.id;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      WatchSoundService.playTick(1.0);
                      setMode(opt.id);
                    }}
                    className="p-3 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between"
                    style={{
                      background: isSelected 
                        ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.22) 0%, rgba(14, 28, 54, 0.45) 100%)' 
                        : 'linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: isSelected ? '1px solid rgba(6, 182, 212, 0.55)' : '1px solid rgba(255, 255, 255, 0.12)',
                      boxShadow: isSelected ? '0 10px 25px -5px rgba(6, 182, 212, 0.25), inset 0 1px 1px 0 rgba(255, 255, 255, 0.25)' : 'none'
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-cyan-300" />
                        <span className="text-xs font-bold text-white">{opt.title}</span>
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-cyan-300" />
                      )}
                    </div>
                    <p className="text-[11px] text-white/50 leading-relaxed">
                      {opt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* FRIEND SELECTOR SECTION */}
          <div className="space-y-2.5 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" />
                <label className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                  Select Friends to Invite ({selectedUserIds.size})
                </label>
              </div>

              <div className="flex items-center gap-2 text-xs">
                {filteredFriends.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-white/20">•</span>
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="text-[11px] text-white/40 hover:text-white cursor-pointer"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Friend Search Bar */}
            <div className="relative">
              <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search friends by name or @username..."
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-400/60"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Friend List */}
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
              {friends.length === 0 ? (
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-center text-xs text-white/40">
                  <UserPlus className="w-6 h-6 mx-auto mb-1 opacity-30 text-amber-400" />
                  <p>No connected friends found yet.</p>
                  <p className="text-[10px] text-white/30 mt-0.5">You can still start a solo room or share the room code later!</p>
                </div>
              ) : filteredFriends.length === 0 ? (
                <div className="p-4 rounded-2xl bg-white/[0.02] text-center text-xs text-white/40">
                  No friends matched "{searchQuery}"
                </div>
              ) : (
                filteredFriends.map(friend => {
                  const isChecked = selectedUserIds.has(friend.userId);
                  return (
                    <div
                      key={friend.userId}
                      onClick={() => toggleFriend(friend.userId)}
                      className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${
                        isChecked 
                          ? 'bg-amber-500/15 border-amber-500/40 shadow-sm' 
                          : 'bg-white/[0.02] hover:bg-white/[0.06] border-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <InitialAvatar 
                          name={friend.displayName || friend.username} 
                          size="sm" 
                          isOnline={friend.isOnline} 
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate group-hover:text-amber-300 transition-colors">
                            {friend.displayName || friend.username}
                          </div>
                          <div className="text-[10px] text-white/40 truncate">
                            @{friend.username}
                          </div>
                        </div>
                      </div>

                      {/* Checkbox indicator */}
                      <div 
                        className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all ${
                          isChecked 
                            ? 'bg-amber-500 text-black shadow-md shadow-amber-500/30' 
                            : 'border border-white/20 group-hover:border-white/40'
                        }`}
                      >
                        {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Settings: Reorder & Duplicates */}
          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-white/60">
            <label className="flex items-center gap-2 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={canReorder}
                onChange={(e) => setCanReorder(e.target.checked)}
                className="rounded accent-amber-500"
              />
              <span>Allow friends to reorder queue</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={duplicatePolicy === 'disallow'}
                onChange={(e) => setDuplicatePolicy(e.target.checked ? 'disallow' : 'warn_allow')}
                className="rounded accent-amber-500"
              />
              <span>Prevent duplicate tracks</span>
            </label>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-white/10 flex items-center justify-between bg-black/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-2xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-semibold transition-all cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleCreate}
            className="px-6 py-2.5 rounded-2xl apple-glass-btn text-white font-bold text-xs flex items-center gap-2 shadow-xl cursor-pointer disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.85) 0%, rgba(217, 119, 6, 0.95) 100%)',
              borderTop: '1px solid rgba(255, 255, 255, 0.5)',
              boxShadow: '0 12px 30px -4px rgba(245, 158, 11, 0.45)'
            }}
          >
            <Radio className="w-4 h-4" />
            <span>
              {isSubmitting 
                ? 'Creating Room...' 
                : selectedUserIds.size > 0 
                  ? `Launch Aux with ${selectedUserIds.size} Friend${selectedUserIds.size === 1 ? '' : 's'}`
                  : 'Launch Solo Aux Room'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
