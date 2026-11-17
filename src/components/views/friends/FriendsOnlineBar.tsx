import React from 'react';
import { Users, ChevronRight, Sparkles } from 'lucide-react';
import { FriendProfileData } from './friendsTypes';
import { InitialAvatar } from '../../common/InitialAvatar';

interface Props {
  friends: FriendProfileData[];
  onSelectFriend: (friend: FriendProfileData) => void;
  onOpenAddFriends: () => void;
  dominantColor: string;
}

export const FriendsOnlineBar: React.FC<Props> = ({
  friends,
  onSelectFriend,
  onOpenAddFriends,
  dominantColor
}) => {
  // Sort online/active listeners first
  const sorted = [...friends].sort((a, b) => {
    if (a.isOnline === b.isOnline) return 0;
    return a.isOnline ? -1 : 1;
  });

  const onlineCount = friends.filter(f => f.isOnline).length;

  return (
    <div className="w-full">
      {/* Section Header */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
          <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
            Friends Online
          </h3>
          <span className="text-[11px] font-mono font-medium text-emerald-400/90 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            {onlineCount} active
          </span>
        </div>

        {friends.length > 0 && (
          <button
            type="button"
            onClick={onOpenAddFriends}
            className="flex items-center gap-1 text-[11px] font-medium text-white/50 hover:text-white transition-colors cursor-pointer"
          >
            <span>Find More</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Horizontal Carousel */}
      <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto pb-2 no-scrollbar scroll-smooth">
        {friends.length === 0 ? (
          <div 
            onClick={onOpenAddFriends}
            className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all cursor-pointer group w-full"
          >
            <div className="w-10 h-10 rounded-full bg-white/5 border border-white/15 flex items-center justify-center text-white/40 group-hover:text-lumen-cyan group-hover:scale-105 transition-all">
              <Users className="w-4 h-4" />
            </div>
            <div className="text-left">
              <div className="text-xs font-bold text-white group-hover:text-lumen-cyan transition-colors">Connect with Friends</div>
              <div className="text-[11px] text-white/40">Find other music listeners and share tracks</div>
            </div>
          </div>
        ) : (
          sorted.map((friend) => {
            const isListening = friend.isPlaying && friend.currentTrack;

            return (
              <button
                key={friend.userId}
                type="button"
                onClick={() => onSelectFriend(friend)}
                className="flex flex-col items-center gap-1.5 flex-shrink-0 group cursor-pointer focus:outline-none"
                title={`${friend.displayName} (@${friend.username})${isListening ? ` • Listening to ${friend.currentTrack?.title}` : ''}`}
              >
                {/* Glowing Initial Avatar */}
                <InitialAvatar
                  name={friend.displayName || friend.username}
                  imageUrl={friend.photoURL || null}
                  size="lg"
                  isOnline={friend.isOnline}
                  className="group-hover:scale-105 transition-transform duration-300"
                />

                {/* Name */}
                <span className="text-[11px] font-medium text-white/70 group-hover:text-white truncate max-w-[68px] sm:max-w-[76px] text-center transition-colors">
                  {friend.displayName || friend.username}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
