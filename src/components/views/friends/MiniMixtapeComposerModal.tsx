import React, { useState } from 'react';
import { 
  X, 
  Disc3, 
  Sparkles, 
  Search, 
  Plus, 
  Trash2, 
  Send, 
  GripVertical, 
  Check, 
  Music, 
  Palette, 
  Loader2,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { Track } from '../../../types/music';
import { AppUser } from '../../../services/firebaseAuthService';
import { MixtapeCoverStyle } from '../../../types/mixtapeTypes';
import { MixtapeService } from '../../../services/mixtapeService';
import { StreamingService } from '../../../services/streamingService';
import { LikedService } from '../../../services/likedService';
import { WatchSoundService } from '../../../services/watchSoundService';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';
import { FriendProfileData } from './friendsTypes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  friends: FriendProfileData[];
  onSent?: () => void;
  dominantColor: string;
}

export const MiniMixtapeComposerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentUser,
  friends,
  onSent,
  dominantColor
}) => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [coverStyle, setCoverStyle] = useState<MixtapeCoverStyle>('mosaic');
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await StreamingService.searchTracks(q);
      setSearchResults(res.slice(0, 10));
    } catch (_) {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddTrack = (track: Track) => {
    if (selectedTracks.length >= 7) {
      setErrorMsg('Mini Mixtapes allow at most 7 tracks.');
      return;
    }
    if (selectedTracks.some(t => t.id === track.id)) {
      setErrorMsg('This track is already on your mixtape.');
      return;
    }
    setErrorMsg(null);
    WatchSoundService.playTick(1.1);
    setSelectedTracks([...selectedTracks, track]);
  };

  const handleRemoveTrack = (trackId: string) => {
    WatchSoundService.playTick(0.9);
    setSelectedTracks(selectedTracks.filter(t => t.id !== trackId));
  };

  const handleMoveTrack = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= selectedTracks.length) return;
    const updated = [...selectedTracks];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    setSelectedTracks(updated);
  };

  const toggleFriend = (uid: string) => {
    if (selectedFriends.includes(uid)) {
      setSelectedFriends(selectedFriends.filter(id => id !== uid));
    } else {
      setSelectedFriends([...selectedFriends, uid]);
    }
  };

  const handleSend = async () => {
    if (!currentUser) return;
    const validation = MixtapeService.validateMixtape(title, selectedTracks, message);
    if (!validation.valid) {
      setErrorMsg(validation.error || 'Please meet all mixtape requirements.');
      return;
    }

    if (selectedFriends.length === 0) {
      setErrorMsg('Please select at least one friend to receive this mixtape.');
      return;
    }

    setIsSending(true);
    setErrorMsg(null);

    const recipients = friends
      .filter(f => selectedFriends.includes(f.userId))
      .map(f => ({ uid: f.userId, username: f.username, displayName: f.displayName }));

    const res = await MixtapeService.createAndSendMixtape(
      currentUser,
      title,
      selectedTracks,
      recipients,
      coverStyle,
      ['#22d3ee', '#818cf8', '#f43f5e', '#fbbf24'],
      message
    );

    setIsSending(false);
    if (!res.success) {
      setErrorMsg(res.error || 'Failed to send Mini Mixtape.');
      return;
    }

    WatchSoundService.playTick(1.4);
    if (onSent) onSent();
    onClose();
  };

  // Status for 3-7 track requirement
  const trackCount = selectedTracks.length;
  const isMinMet = trackCount >= 3;
  const isMaxExceeded = trackCount > 7;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-2xl animate-fadeIn">
      <div 
        className="w-full max-w-4xl rounded-3xl overflow-hidden backdrop-blur-3xl border border-white/20 shadow-2xl flex flex-col max-h-[92vh] relative"
        style={{
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.04) 45%, rgba(0, 0, 0, 0.85) 100%)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 35px -5px rgba(255, 255, 255, 0.15)'
        }}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
              <Disc3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">Create Mini Mixtape</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2">
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Two-Column Composer Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 scrollbar-none">
          {/* LEFT COLUMN: Track Selector & Search */}
          <div className="lg:col-span-6 space-y-4">
            {/* Track Requirement Bar */}
            <div className={`p-3 rounded-2xl border flex items-center justify-between text-xs font-semibold transition-all ${
              isMinMet && !isMaxExceeded 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}>
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4" />
                <span>
                  {trackCount === 0 && 'Add at least 3 tracks to begin (3-7 required)'}
                  {trackCount > 0 && trackCount < 3 && `${trackCount}/7 tracks • Add ${3 - trackCount} more to complete`}
                  {isMinMet && !isMaxExceeded && `${trackCount}/7 tracks • Ready to Send!`}
                </span>
              </div>
              <span className="font-mono text-[11px] font-bold">
                {trackCount}/7
              </span>
            </div>

            {/* Title & Message inputs */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-white/80">Mixtape Title</label>
                  <span className="text-[10px] font-mono text-white/40">{60 - title.length} left</span>
                </div>
                <input
                  type="text"
                  maxLength={60}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Late Night Drives, Summer Energy..."
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-white/5 border border-white/15 text-white text-xs focus:outline-none focus:border-pink-400"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-white/80">Personal Note (Optional)</label>
                  <span className="text-[10px] font-mono text-white/40">{280 - message.length} left</span>
                </div>
                <textarea
                  rows={2}
                  maxLength={280}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a message for your friend..."
                  className="w-full px-3.5 py-2 rounded-2xl bg-white/5 border border-white/15 text-white text-xs focus:outline-none focus:border-pink-400 resize-none"
                />
              </div>
            </div>

            {/* Selected Tracks (Reorderable) */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2">Tracklist ({selectedTracks.length})</h4>
              {selectedTracks.length === 0 ? (
                <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 text-center text-xs text-white/40">
                  Search below or pick from your saved favorites to add 3–7 tracks.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-none">
                  {selectedTracks.map((t, idx) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-2 rounded-xl bg-white/[0.04] border border-white/10"
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

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveTrack(idx, 'up')}
                          className="p-1 text-white/30 hover:text-white disabled:opacity-20 cursor-pointer"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === selectedTracks.length - 1}
                          onClick={() => handleMoveTrack(idx, 'down')}
                          className="p-1 text-white/30 hover:text-white disabled:opacity-20 cursor-pointer"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveTrack(t.id)}
                          className="p-1 text-white/30 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Track Search Box */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2">Search Songs to Add</h4>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search song title or artist..."
                  className="w-full pl-9 pr-4 py-2 rounded-2xl bg-white/5 border border-white/15 text-white text-xs focus:outline-none focus:border-pink-400"
                />
                <Search className="w-4 h-4 text-white/40 absolute left-3 top-2.5" />
              </div>

              {/* Quick Liked suggestions when search query is empty */}
              {!searchQuery && (
                <div className="mt-2">
                  <span className="text-[10px] font-mono text-white/40 block mb-1.5">Quick add from Liked Songs:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {LikedService.getLikedTracks().slice(0, 5).map((lt) => (
                      <button
                        key={lt.id}
                        type="button"
                        onClick={() => handleAddTrack(lt)}
                        className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] text-white/80 hover:text-white flex items-center gap-1 cursor-pointer transition-all active:scale-95"
                      >
                        <Plus className="w-3 h-3" />
                        <span className="truncate max-w-[120px]">{lt.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-36 overflow-y-auto scrollbar-none">
                  {searchResults.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10"
                    >
                      <div className="min-w-0 flex-1 px-2">
                        <div className="text-xs font-semibold text-white truncate">{t.title}</div>
                        <div className="text-[10px] text-white/50 truncate">{t.artist}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddTrack(t)}
                        className="px-2 py-1 rounded-full bg-pink-500/20 text-pink-300 hover:bg-pink-500 text-xs font-bold transition-all"
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Cover Design, Recipient Picker & Live Preview */}
          <div className="lg:col-span-6 space-y-4">
            {/* Visual Cover Style Selector */}
            <div>
              <label className="text-xs font-bold text-white/80 block mb-1.5">Visual Cover Style</label>
              <div className="grid grid-cols-3 gap-2">
                {(['mosaic', 'gradient', 'typography'] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => setCoverStyle(style)}
                    className={`py-2 px-2 rounded-2xl border text-center text-xs font-bold capitalize transition-all cursor-pointer ${
                      coverStyle === style 
                        ? 'bg-pink-500/20 border-pink-400 text-pink-300 shadow-md' 
                        : 'bg-white/5 border-white/10 text-white/50 hover:text-white'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            {/* LIVE MIXTAPE CASSETTE / CARD PREVIEW */}
            <div className="p-4 rounded-3xl bg-gradient-to-b from-white/[0.08] to-black/80 border border-white/20 shadow-2xl relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono font-bold text-pink-400 uppercase tracking-widest">
                  Live Tape Preview
                </span>
                <span className="text-[10px] font-mono text-white/40">
                  {selectedTracks.length} tracks
                </span>
              </div>

              {/* Cover Representation */}
              <div className="w-full aspect-video rounded-2xl overflow-hidden relative shadow-xl flex items-center justify-center border border-white/15 bg-black/60">
                {coverStyle === 'mosaic' && (
                  <div className="grid grid-cols-2 w-full h-full">
                    {selectedTracks.slice(0, 4).map((t, i) => (
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
                    {selectedTracks.length < 4 && (
                      <div className="w-full h-full flex items-center justify-center bg-white/5 text-white/20 text-xs font-mono">
                        + Tape Art
                      </div>
                    )}
                  </div>
                )}

                {coverStyle === 'gradient' && (
                  <div className="w-full h-full bg-gradient-to-br from-pink-500/40 via-purple-600/30 to-cyan-500/30 flex flex-col items-center justify-center p-4 text-center">
                    <Disc3 className="w-10 h-10 text-pink-300 animate-spin-slow mb-2" />
                    <div className="text-sm font-black text-white truncate max-w-xs">{title || 'Mini Mixtape'}</div>
                    <div className="text-[10px] font-mono text-white/60 mt-0.5">by @{currentUser?.username || 'you'}</div>
                  </div>
                )}

                {coverStyle === 'typography' && (
                  <div className="w-full h-full bg-black/90 p-5 flex flex-col justify-between border-t-2 border-pink-400">
                    <div className="text-[10px] font-mono tracking-widest text-pink-400 uppercase">LUMEN MIXTAPE ARCHIVE</div>
                    <div className="text-lg font-black text-white leading-tight">{title || 'UNTITLED TAPE'}</div>
                    <div className="text-[10px] font-mono text-white/40">{selectedTracks.length} tracks • {new Date().getFullYear()}</div>
                  </div>
                )}
              </div>

              {/* Title & Note preview */}
              <div className="mt-3">
                <h4 className="text-sm font-bold text-white truncate">{title || 'Untitled Mini Mixtape'}</h4>
                {message && (
                  <p className="text-xs text-white/60 italic mt-0.5 line-clamp-2">"{message}"</p>
                )}
              </div>
            </div>

            {/* Recipient Friend Picker */}
            <div>
              <label className="text-xs font-bold text-white/80 block mb-1.5">
                Send to Friends ({selectedFriends.length} selected)
              </label>
              <div className="space-y-1.5 max-h-36 overflow-y-auto scrollbar-none">
                {friends.length === 0 ? (
                  <p className="text-xs text-white/40 text-center py-4">Add friends to send them mixtapes</p>
                ) : (
                  friends.map((f) => {
                    const isSelected = selectedFriends.includes(f.userId);
                    return (
                      <div
                        key={f.userId}
                        onClick={() => toggleFriend(f.userId)}
                        className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                          isSelected 
                            ? 'bg-pink-500/15 border-pink-400/50 text-white' 
                            : 'bg-white/[0.03] border-white/10 text-white/70 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <InitialAvatar name={f.displayName || f.username} size="sm" isOnline={f.isOnline} />
                          <div>
                            <div className="text-xs font-semibold">{f.displayName || f.username}</div>
                            <div className="text-[10px] text-white/40">@{f.username}</div>
                          </div>
                        </div>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          isSelected ? 'bg-pink-500 border-pink-400' : 'border-white/30'
                        }`}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Footer Actions */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-t border-white/10 bg-black/40">
          <div className="text-xs text-white/50 font-mono">
            {isMinMet ? (
              <span className="text-emerald-400 font-semibold">✓ Meets 3–7 track rule</span>
            ) : (
              <span className="text-amber-400 font-semibold">Need at least 3 tracks</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-semibold text-white/60 hover:text-white"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={!isMinMet || isMaxExceeded || !title.trim() || selectedFriends.length === 0 || isSending}
              onClick={handleSend}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 text-white text-xs font-bold shadow-lg shadow-pink-500/25 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending Tape...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Mini Mixtape</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
