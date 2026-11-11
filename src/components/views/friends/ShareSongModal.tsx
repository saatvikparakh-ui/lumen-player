import React, { useState } from 'react';
import { X, Send, Music2, Check, Sparkles, Loader2, Search, Disc3 } from 'lucide-react';
import { Track } from '../../../types/music';
import { FriendProfileData } from './friendsTypes';
import { FirestoreService } from '../../../services/firestoreService';
import { AppUser } from '../../../services/firebaseAuthService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultTrack: Track | null;
  friends: FriendProfileData[];
  preselectedFriendUsername?: string;
  recentTracks: Track[];
  currentUser: AppUser | null;
  dominantColor: string;
  onShareSent: (message: string) => void;
}

export const ShareSongModal: React.FC<Props> = ({
  isOpen,
  onClose,
  defaultTrack,
  friends,
  preselectedFriendUsername = '',
  recentTracks,
  currentUser,
  dominantColor,
  onShareSent
}) => {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(defaultTrack || recentTracks[0] || null);
  const [selectedFriendUsername, setSelectedFriendUsername] = useState<string>(preselectedFriendUsername);
  const [note, setNote] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const targetFriend = friends.find(f => f.username === selectedFriendUsername);

  const handleSend = async () => {
    if (!selectedTrack) {
      setErrorMsg('Please select a song to share');
      return;
    }
    if (!targetFriend || !currentUser) {
      setErrorMsg('Please select a friend to send to');
      return;
    }

    setIsSending(true);
    setErrorMsg(null);

    try {
      const res = await FirestoreService.sendSongShare(
        currentUser,
        targetFriend.userId,
        selectedTrack,
        note.trim() || undefined
      );

      if (res.success) {
        WatchSoundService.playTick(1.2);
        onShareSent(`"${selectedTrack.title}" shared with @${targetFriend.username}!`);
        onClose();
      } else {
        setErrorMsg(res.error || 'Could not deliver recommendation. Try again.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send share');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn"
      onClick={onClose}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl p-5 sm:p-6 bg-[#0a0e17] border border-white/20 shadow-2xl space-y-4 relative"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Send className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-white">Share Song with Friend</h3>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-white/50 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Selected Track Preview Card */}
        {selectedTrack ? (
          <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                <CoverImage
                  src={selectedTrack.artworkUrl || null}
                  alt={selectedTrack.title}
                  title={selectedTrack.title}
                  artist={selectedTrack.artist}
                  size={100}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{selectedTrack.title}</div>
                <div className="text-[11px] text-white/60 truncate mt-0.5">{selectedTrack.artist}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsPickerOpen(prev => !prev)}
              className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white/80 hover:text-white transition-colors flex-shrink-0"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            className="w-full p-4 rounded-2xl border border-dashed border-white/20 hover:border-white/40 text-center text-white/50 text-xs flex items-center justify-center gap-2"
          >
            <Music2 className="w-4 h-4" />
            <span>Select a song to share</span>
          </button>
        )}

        {/* Quick Song Picker Drawer (if changing song) */}
        {isPickerOpen && (
          <div className="p-3 rounded-2xl bg-black/80 border border-white/15 max-h-48 overflow-y-auto space-y-2 no-scrollbar">
            <div className="text-[10px] font-mono uppercase text-white/50">Recent & Library Tracks</div>
            {recentTracks.map((tr) => (
              <div
                key={tr.id}
                onClick={() => {
                  setSelectedTrack(tr);
                  setIsPickerOpen(false);
                }}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-white/10 cursor-pointer text-xs transition-colors"
              >
                <div className="truncate mr-2">
                  <span className="font-semibold text-white">{tr.title}</span>
                  <span className="text-white/40 ml-1.5">• {tr.artist}</span>
                </div>
                {selectedTrack?.id === tr.id && <Check className="w-3.5 h-3.5 text-lumen-cyan" />}
              </div>
            ))}
          </div>
        )}

        {/* Recipient Selection */}
        <div>
          <label className="text-[11px] font-semibold text-white/60 block mb-1.5">
            Choose Recipient Friend
          </label>
          <select
            value={selectedFriendUsername}
            onChange={(e) => setSelectedFriendUsername(e.target.value)}
            className="w-full p-3 rounded-2xl bg-white/[0.05] border border-white/15 text-white text-xs focus:outline-none focus:border-lumen-cyan"
          >
            <option value="" className="bg-[#0c1017]">Select a friend...</option>
            {friends.map((f) => (
              <option key={f.userId} value={f.username} className="bg-[#0c1017]">
                {f.displayName} (@{f.username})
              </option>
            ))}
          </select>
        </div>

        {/* Optional Note */}
        <div>
          <label className="text-[11px] font-semibold text-white/60 block mb-1.5">
            Personal Note (Optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Listen to the vocals at 2:10!"
            className="w-full px-3.5 py-2.5 rounded-2xl bg-white/[0.05] border border-white/15 text-white text-xs placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
          />
        </div>

        {/* Send Action */}
        <button
          type="button"
          disabled={isSending || !selectedTrack || !selectedFriendUsername}
          onClick={handleSend}
          className="w-full py-3 rounded-full bg-lumen-cyan text-black font-bold text-xs hover:bg-lumen-cyan/90 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 cursor-pointer"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          <span>Send Recommendation</span>
        </button>
      </div>
    </div>
  );
};
