import React from 'react';
import { Home, Search, FolderHeart, Users, Mic, User } from 'lucide-react';

interface Props {
  currentView: 'home' | 'player' | 'playlist' | 'search';
  onSelectView: (view: 'home' | 'player' | 'playlist' | 'search') => void;
  onOpenSearch: () => void;
  onOpenFriendsHub: () => void;
  onOpenProfile: () => void;
  onOpenVoiceDJ: () => void;
  dominantColor: string;
  hasUnreadShares?: boolean;
}

export const MobileBottomNav: React.FC<Props> = ({
  currentView,
  onSelectView,
  onOpenSearch,
  onOpenFriendsHub,
  onOpenProfile,
  onOpenVoiceDJ,
  dominantColor,
  hasUnreadShares = false
}) => {
  return (
    <nav 
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-[#07090E]/95 backdrop-blur-3xl border-t border-white/10 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-1.5 px-3 select-none shadow-[0_-10px_35px_rgba(0,0,0,0.9)]"
    >
      <div className="flex items-center justify-between h-14 max-w-md mx-auto">
        {/* 1. HOME */}
        <button
          type="button"
          onClick={() => onSelectView('home')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 transition-all active:scale-95 ${
            currentView === 'home' ? 'text-white' : 'text-white/40 hover:text-white/80'
          }`}
          title="Home"
        >
          <div className="relative">
            <Home className="w-5 h-5" style={{ color: currentView === 'home' ? dominantColor : undefined }} />
            {currentView === 'home' && (
              <span 
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ backgroundColor: dominantColor, boxShadow: `0 0 6px ${dominantColor}` }}
              />
            )}
          </div>
          <span className="text-[10px] font-medium mt-1">Home</span>
        </button>

        {/* 2. SEARCH */}
        <button
          type="button"
          onClick={onOpenSearch}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 transition-all active:scale-95 ${
            currentView === 'search' ? 'text-white' : 'text-white/40 hover:text-white/80'
          }`}
          title="Search"
        >
          <div className="relative">
            <Search className="w-5 h-5" style={{ color: currentView === 'search' ? dominantColor : undefined }} />
            {currentView === 'search' && (
              <span 
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ backgroundColor: dominantColor, boxShadow: `0 0 6px ${dominantColor}` }}
              />
            )}
          </div>
          <span className="text-[10px] font-medium mt-1">Search</span>
        </button>

        {/* 3. HEY LUMEN VOICE ASSISTANT (CENTER GLOWING MIC BUTTON) */}
        <button
          type="button"
          onClick={onOpenVoiceDJ}
          className="flex flex-col items-center justify-center -mt-4 px-1 active:scale-90 transition-all cursor-pointer"
          title="Hey Lumen Voice Command"
        >
          <div 
            className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg border border-white/20 transition-all bg-gradient-to-tr from-cyan-500 to-indigo-500"
            style={{ 
              boxShadow: `0 0 20px ${dominantColor}80`
            }}
          >
            <Mic className="w-5 h-5 text-white" />
          </div>
          <span className="text-[9px] font-bold text-white/90 mt-1 uppercase tracking-wider">Hey Lumen</span>
        </button>

        {/* 4. FRIENDS */}
        <button
          type="button"
          onClick={onOpenFriendsHub}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 text-white/40 hover:text-white/80 transition-all active:scale-95"
          title="Friends & Social"
        >
          <div className="relative">
            <Users className="w-5 h-5" />
            {hasUnreadShares && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse border border-[#07090E]" />
            )}
          </div>
          <span className="text-[10px] font-medium mt-1">Friends</span>
        </button>

        {/* 5. LIBRARY / PLAYLISTS */}
        <button
          type="button"
          onClick={() => onSelectView('playlist')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 transition-all active:scale-95 ${
            currentView === 'playlist' ? 'text-white' : 'text-white/40 hover:text-white/80'
          }`}
          title="Playlists & Library"
        >
          <div className="relative">
            <FolderHeart className="w-5 h-5" style={{ color: currentView === 'playlist' ? dominantColor : undefined }} />
            {currentView === 'playlist' && (
              <span 
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ backgroundColor: dominantColor, boxShadow: `0 0 6px ${dominantColor}` }}
              />
            )}
          </div>
          <span className="text-[10px] font-medium mt-1">Library</span>
        </button>
      </div>
    </nav>
  );
};
