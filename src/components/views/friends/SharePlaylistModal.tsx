import React, { useState } from 'react';
import { X, Send, ListMusic, Check, Sparkles, Loader2, FolderHeart } from 'lucide-react';
import { CustomPlaylist } from '../../../types/music';
import { FriendProfileData } from './friendsTypes';
import { AppUser } from '../../../services/firebaseAuthService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { FirestoreService } from '../../../services/firestoreService';
import { CoverImage } from '../../common/CoverImage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  playlists: CustomPlaylist[];
  friends: FriendProfileData[];
  currentUser: AppUser | null;
  dominantColor: string;
  onShareSent: (message: string) => void;
}

export const SharePlaylistModal: React.FC<Props> = ({
  isOpen,
  onClose,
  playlists,
  friends,
  currentUser,
  dominantColor,
  onShareSent
}) => {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(playlists[0]?.id || '');
  const [selectedFriendUsername, setSelectedFriendUsername] = useState<string>('');
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const targetPlaylist = playlists.find(p => p.id === selectedPlaylistId) || playlists[0];
  const targetFriend = friends.find(f => f.username === selectedFriendUsername);

  const handleSend = async () => {
    if (!targetPlaylist) {
      setErrorMsg('Please select a playlist to share');
      return;
    }
    if (!targetFriend || !currentUser) {
      setErrorMsg('Please select a friend to send to');
      return;
    }

    setIsSending(true);
    setErrorMsg(null);

    try {
      const recipientId = targetFriend.userId || targetFriend.username;
      const res = await FirestoreService.sendPlaylistShare(
        currentUser,
        recipientId,
        targetPlaylist,
        note.trim() || undefined
      );

      if (!res.success) {
        setErrorMsg(res.error || 'Failed to share playlist');
        return;
      }

      WatchSoundService.playTick(1.2);
      onShareSent(`Playlist "${targetPlaylist.name}" shared with @${targetFriend.username}!`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send playlist');
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
            <div className="w-8 h-8 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
              <FolderHeart className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-white">Share Playlist</h3>
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

        {/* Select Playlist dropdown */}
        <div>
          <label className="text-[11px] font-semibold text-white/60 block mb-1.5">
            Select Playlist to Share
          </label>
          <select
            value={selectedPlaylistId}
            onChange={(e) => setSelectedPlaylistId(e.target.value)}
            className="w-full p-3 rounded-2xl bg-white/[0.05] border border-white/15 text-white text-xs focus:outline-none focus:border-lumen-cyan"
          >
            {playlists.map((pl) => (
              <option key={pl.id} value={pl.id} className="bg-[#0c1017]">
                {pl.name} ({pl.tracks?.length || 0} tracks)
              </option>
            ))}
          </select>
        </div>

        {/* Playlist Preview Card */}
        {targetPlaylist && (
          <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
              <CoverImage
                src={targetPlaylist.coverUrl || null}
                alt={targetPlaylist.name}
                title={targetPlaylist.name}
                size={120}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">{targetPlaylist.name}</div>
              <div className="text-xs text-white/50 truncate mt-0.5">
                {targetPlaylist.tracks?.length || 0} tracks • Curated by You
              </div>
            </div>
          </div>
        )}

        {/* Choose Recipient Friend */}
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

        {/* Message */}
        <div>
          <label className="text-[11px] font-semibold text-white/60 block mb-1.5">
            Personal Message (Optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. My late night road trip vibe playlist!"
            className="w-full px-3.5 py-2.5 rounded-2xl bg-white/[0.05] border border-white/15 text-white text-xs placeholder-white/40 focus:outline-none focus:border-lumen-cyan"
          />
        </div>

        {/* Send Action */}
        <button
          type="button"
          disabled={isSending || !targetPlaylist || !selectedFriendUsername}
          onClick={handleSend}
          className="w-full py-3 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 cursor-pointer"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          <span>Send Playlist</span>
        </button>
      </div>
    </div>
  );
};
