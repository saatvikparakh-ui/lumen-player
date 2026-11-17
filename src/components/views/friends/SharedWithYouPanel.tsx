import React from 'react';
import { Play, FolderPlus, Clock, MessageSquare, Star, Sparkles, Disc3, ListMusic, Trash2, Radio } from 'lucide-react';
import { Track, CustomPlaylist } from '../../../types/music';
import { SharedMediaItem, FriendProfileData } from './friendsTypes';
import { CoverImage } from '../../common/CoverImage';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  shares: SharedMediaItem[];
  onPlaySong: (track: Track) => void;
  onPlayPlaylist: (playlist: CustomPlaylist) => void;
  onSaveToLibrary: (item: SharedMediaItem) => void;
  onSelectSender: (senderUid: string, senderUsername: string) => void;
  onDeleteShare: (shareId: string) => void;
  onClearAllShares?: () => void;
  onJoinAuxSession?: (sessionId: string) => void;
  onOpenTierList?: (listId: string) => void;
  onJoinAlbumClub?: (club: any) => void;
  dominantColor: string;
}

const formatRelativeTime = (timestamp: number): string => {
  if (!timestamp) return 'Recently';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const SharedWithYouPanel: React.FC<Props> = ({
  shares,
  onPlaySong,
  onPlayPlaylist,
  onSaveToLibrary,
  onSelectSender,
  onDeleteShare,
  onClearAllShares,
  onJoinAuxSession,
  onOpenTierList,
  onJoinAlbumClub,
  dominantColor
}) => {
  if (shares.length === 0) {
    return (
      <div className="w-full p-6 sm:p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center flex flex-col items-center justify-center text-white/40">
        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30 mb-3">
          <MessageSquare className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-bold text-white/70">No Shared Music Yet</h4>
        <p className="text-xs text-white/40 mt-1 max-w-xs">
          When friends share songs or playlists with you, they will appear right here.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      {/* Clear All Shared Notifications Bar */}
      {shares.length > 0 && onClearAllShares && (
        <div className="flex items-center justify-between px-1.5 pb-1">
          <span className="text-[11px] font-mono text-white/40">
            {shares.length} {shares.length === 1 ? 'shared item' : 'shared items'}
          </span>
          <button
            type="button"
            onClick={onClearAllShares}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/60 hover:text-rose-300 border border-white/10 hover:border-rose-500/40 text-[11px] font-semibold transition-all active:scale-95 cursor-pointer shadow-sm"
            title="Clear all shared song notifications"
          >
            <Trash2 className="w-3 h-3 text-rose-400" />
            <span>Clear All</span>
          </button>
        </div>
      )}
      {shares.map((item) => {
        const isSong = item.type === 'song' && item.song;
        const isPlaylist = item.type === 'playlist' && item.playlist;
        const isAuxInvite = item.type === 'aux_invite';
        const isTierList = item.type === 'collaborative_tier_list';
        const isClubInvite = item.type === 'album_club_invite';
        const title = isSong 
          ? item.song!.title 
          : isPlaylist 
          ? item.playlist!.name 
          : isAuxInvite 
          ? ((item as any).sessionTitle || 'Pass The Aux Room')
          : isTierList
          ? ((item as any).tierList?.title || (item as any).tierListTitle || 'Collaborative Tier List')
          : isClubInvite
          ? ((item as any).clubName || (item as any).club?.name || 'Weekly Album Club')
          : 'Shared Audio';
        const subtitle = isSong 
          ? item.song!.artist 
          : isPlaylist 
          ? `${item.playlist!.tracks?.length || 0} tracks • Curated Playlist` 
          : isAuxInvite
          ? 'Live collaborative queue room'
          : isTierList
          ? 'Collaborative music ranking tier list'
          : isClubInvite
          ? 'Weekly album listening & review club'
          : 'Music recommendation';
        const artwork = isSong ? item.song!.artworkUrl : isPlaylist ? item.playlist!.coverUrl : null;
        const initial = (item.senderDisplayName || item.senderUsername || 'U').charAt(0).toUpperCase();

        return (
          <div
            key={item.id}
            className={`relative rounded-2xl sm:rounded-3xl p-4 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-white/[0.01] border transition-all duration-300 group overflow-hidden ${
              !item.read ? 'border-lumen-cyan/40 shadow-[0_0_20px_rgba(6,182,212,0.15)]' : 'border-white/10 hover:border-white/20'
            }`}
          >
            {/* Unread Accent Light */}
            {!item.read && (
              <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-lumen-cyan shadow-[0_0_8px_#06b6d4]" />
            )}

            {/* Sender Header */}
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <button
                type="button"
                onClick={() => onSelectSender(item.senderUid, item.senderUsername)}
                className="flex items-center gap-2 text-left group/sender cursor-pointer focus:outline-none"
              >
                <InitialAvatar 
                  name={item.senderDisplayName || item.senderUsername} 
                  size="xs" 
                />
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-semibold text-white group-hover/sender:text-lumen-cyan transition-colors truncate max-w-[140px] sm:max-w-[200px]">
                    {item.senderDisplayName || item.senderUsername}
                  </span>
                  <span className="text-white/40 text-[11px]">• shared {isPlaylist ? 'a playlist' : 'a song'}</span>
                </div>
              </button>

              <span className="text-[10px] font-mono text-white/40 flex items-center gap-1">
                <Clock className="w-3 h-3 text-white/30" />
                <span>{formatRelativeTime(item.createdAt)}</span>
              </span>
            </div>

            {/* Optional Personal Note or Sender Rating */}
            {(item.message || item.senderRating) && (
              <div className="mb-3 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-2 text-xs">
                {item.message ? (
                  <p className="text-white/80 italic text-[11px] truncate flex-1">
                    "{item.message}"
                  </p>
                ) : <span />}
                {item.senderRating && (
                  <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-300 flex-shrink-0">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>Rated {item.senderRating}/10</span>
                  </div>
                )}
              </div>
            )}

            {/* Content Row: Cover + Info + Actions */}
            <div className="flex items-center gap-3">
              {/* Media Artwork */}
              <div 
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0 relative group/art cursor-pointer shadow-md"
                onClick={() => {
                  if (isSong) onPlaySong(item.song!);
                  if (isPlaylist) onPlayPlaylist(item.playlist!);
                }}
              >
                <CoverImage
                  src={artwork || null}
                  alt={title}
                  title={title}
                  artist={subtitle}
                  size={150}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover/art:scale-105"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/art:opacity-100 flex items-center justify-center transition-opacity">
                  <Play className="w-5 h-5 fill-white text-white drop-shadow-md" />
                </div>
              </div>

              {/* Title & Subtitle */}
              <div className="min-w-0 flex-1">
                <h5 className="text-xs sm:text-sm font-bold text-white truncate" title={title}>
                  {title}
                </h5>
                <p className="text-[11px] sm:text-xs text-white/60 truncate mt-0.5" title={subtitle}>
                  {subtitle}
                </p>
              </div>

              {/* Action Buttons: Save + Delete + Play */}
              <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                {isAuxInvite ? (
                  <button
                    type="button"
                    onClick={() => onJoinAuxSession && onJoinAuxSession((item as any).sessionId)}
                    className="px-3.5 py-1.5 rounded-full bg-amber-500/25 hover:bg-amber-500/40 text-amber-300 hover:text-white border border-amber-400/50 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                    title="Join Live Aux Jam"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Join Room</span>
                  </button>
                ) : isTierList ? (
                  <button
                    type="button"
                    onClick={() => onOpenTierList && onOpenTierList((item as any).tierList?.id || item.id)}
                    className="px-3.5 py-1.5 rounded-full bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 hover:text-white border border-amber-400/40 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold"
                    title="Open Collaborative Tier List"
                  >
                    <Star className="w-3.5 h-3.5 text-amber-400" />
                    <span>Open Studio</span>
                  </button>
                ) : isClubInvite ? (
                  <button
                    type="button"
                    onClick={() => onJoinAlbumClub && onJoinAlbumClub((item as any).club)}
                    className="px-3.5 py-1.5 rounded-full bg-purple-500/25 hover:bg-purple-500/40 text-purple-200 hover:text-white border border-purple-400/40 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                    title="Join Album Club"
                  >
                    <Disc3 className="w-3.5 h-3.5 text-purple-300" />
                    <span>Join Club</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSaveToLibrary(item)}
                    className="p-2 sm:px-2.5 sm:py-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/10 active:scale-95 transition-all cursor-pointer flex items-center gap-1 text-xs"
                    title="Save to Library"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-[11px]">Save</span>
                  </button>
                )}

                {/* Delete / Dismiss Shared Notification Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteShare(item.id);
                  }}
                  className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/40 hover:text-rose-300 border border-white/10 hover:border-rose-500/40 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                  title="Delete notification"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (isSong) onPlaySong(item.song!);
                    if (isPlaylist) onPlayPlaylist(item.playlist!);
                  }}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all flex items-center justify-center shadow-lg cursor-pointer"
                  title="Play"
                >
                  <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
