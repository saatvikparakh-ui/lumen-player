import React from 'react';
import { Home, Search, FolderHeart, Users, Settings } from 'lucide-react';

interface Props {
  currentView: 'home' | 'player' | 'playlist';
  onSelectView: (view: 'home' | 'player' | 'playlist') => void;
  onOpenSearch: () => void;
  onOpenFriendsHub: () => void;
  onOpenSettings: () => void;
  dominantColor: string;
}

export const MobileBottomNav: React.FC<Props> = ({
  currentView,
  onSelectView,
  onOpenSearch,
  onOpenFriendsHub,
  onOpenSettings,
  dominantColor
}) => {
  return (
    <nav 
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden bg-[#080A10]/95 backdrop-blur-3xl border-t border-white/10 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 px-2 select-none shadow-[0_-10px_30px_rgba(0,0,0,0.8)]"
    >
      <div className="flex items-center justify-around h-14">
        {/* HOME */}
        <button
          type="button"
          onClick={() => onSelectView('home')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 transition-all active:scale-95 ${
            currentView === 'home' ? 'text-white' : 'text-white/45 hover:text-white/80'
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
          <span className="text-[10px] font-medium mt-0.5">Home</span>
        </button>

        {/* SEARCH */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 text-white/45 hover:text-white/80 transition-all active:scale-95"
          title="Search"
        >
          <Search className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-0.5">Search</span>
        </button>

        {/* PLAYLISTS */}
        <button
          type="button"
          onClick={() => onSelectView('playlist')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 transition-all active:scale-95 ${
            currentView === 'playlist' ? 'text-white' : 'text-white/45 hover:text-white/80'
          }`}
          title="Playlists"
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
          <span className="text-[10px] font-medium mt-0.5">Playlists</span>
        </button>

        {/* FRIENDS */}
        <button
          type="button"
          onClick={onOpenFriendsHub}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 text-white/45 hover:text-white/80 transition-all active:scale-95"
          title="Friends"
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-0.5">Friends</span>
        </button>

        {/* SETTINGS / PROFILE */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 text-white/45 hover:text-white/80 transition-all active:scale-95"
          title="Settings & Profile"
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] font-medium mt-0.5">Settings</span>
        </button>
      </div>
    </nav>
  );
};
