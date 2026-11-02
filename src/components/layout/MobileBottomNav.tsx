import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Home, Search, FolderHeart, Users } from 'lucide-react';

interface Props {
  currentView: 'home' | 'player' | 'playlist' | 'search';
  onSelectView: (view: 'home' | 'player' | 'playlist' | 'search') => void;
  onOpenSearch: () => void;
  onOpenFriendsHub: () => void;
  dominantColor: string;
  hasUnreadShares?: boolean;
  isVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export const MobileBottomNav: React.FC<Props> = ({
  currentView,
  onSelectView,
  onOpenSearch,
  onOpenFriendsHub,
  dominantColor,
  hasUnreadShares = false,
  isVisible: externalIsVisible,
  onVisibilityChange
}) => {
  const [internalVisible, setInternalVisible] = useState(true);
  const isVisible = externalIsVisible !== undefined ? externalIsVisible : internalVisible;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const resetInactivityTimer = useCallback(() => {
    setInternalVisible(true);
    if (onVisibilityChange) onVisibilityChange(true);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      setInternalVisible(false);
      if (onVisibilityChange) onVisibilityChange(false);
    }, 3000);
  }, [onVisibilityChange]);

  useEffect(() => {
    // Initial 3-second timer
    timerRef.current = setTimeout(() => {
      setInternalVisible(false);
      if (onVisibilityChange) onVisibilityChange(false);
    }, 3000);

    const activityEvents = ['touchstart', 'touchmove', 'touchend', 'click', 'scroll', 'pointerdown'];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, resetInactivityTimer, { passive: true });
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, resetInactivityTimer);
      });
    };
  }, [resetInactivityTimer, onVisibilityChange]);

  return (
    <nav 
      aria-label="Mobile Navigation"
      className={`fixed bottom-3 left-4 right-4 z-50 sm:hidden rounded-3xl bg-black/80 backdrop-blur-3xl border border-white/20 px-3 py-1.5 shadow-[0_12px_45px_rgba(0,0,0,0.9)] max-w-md mx-auto select-none transition-all duration-500 ease-out transform ${
        isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-28 opacity-0 pointer-events-none'
      }`}
      style={{
        boxShadow: `0 14px 45px rgba(0, 0, 0, 0.95), 0 0 25px -5px ${dominantColor}40`
      }}
    >
      <div className="flex items-center justify-between h-13 max-w-sm mx-auto">
        {/* 1. HOME */}
        <button
          type="button"
          onClick={() => {
            resetInactivityTimer();
            onSelectView('home');
          }}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[46px] py-1 transition-all active:scale-95 ${
            currentView === 'home' ? 'text-white' : 'text-white/45 hover:text-white/80'
          }`}
          title="Home"
        >
          <div className="relative">
            <Home className="w-5 h-5" style={{ color: currentView === 'home' ? dominantColor : undefined }} />
            {currentView === 'home' && (
              <span 
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: dominantColor, boxShadow: `0 0 6px ${dominantColor}` }}
              />
            )}
          </div>
          <span className="text-[10px] font-semibold mt-1">Home</span>
        </button>

        {/* 2. SEARCH */}
        <button
          type="button"
          onClick={() => {
            resetInactivityTimer();
            onOpenSearch();
          }}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[46px] py-1 transition-all active:scale-95 ${
            currentView === 'search' ? 'text-white' : 'text-white/45 hover:text-white/80'
          }`}
          title="Search"
        >
          <div className="relative">
            <Search className="w-5 h-5" style={{ color: currentView === 'search' ? dominantColor : undefined }} />
            {currentView === 'search' && (
              <span 
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: dominantColor, boxShadow: `0 0 6px ${dominantColor}` }}
              />
            )}
          </div>
          <span className="text-[10px] font-semibold mt-1">Search</span>
        </button>

        {/* 3. FRIENDS */}
        <button
          type="button"
          onClick={() => {
            resetInactivityTimer();
            onOpenFriendsHub();
          }}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[46px] py-1 text-white/45 hover:text-white/80 transition-all active:scale-95"
          title="Friends & Social"
        >
          <div className="relative">
            <Users className="w-5 h-5" />
            {hasUnreadShares && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse border border-[#07090E]" />
            )}
          </div>
          <span className="text-[10px] font-semibold mt-1">Friends</span>
        </button>

        {/* 4. LIBRARY / PLAYLISTS */}
        <button
          type="button"
          onClick={() => {
            resetInactivityTimer();
            onSelectView('playlist');
          }}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[46px] py-1 transition-all active:scale-95 ${
            currentView === 'playlist' ? 'text-white' : 'text-white/45 hover:text-white/80'
          }`}
          title="Playlists & Library"
        >
          <div className="relative">
            <FolderHeart className="w-5 h-5" style={{ color: currentView === 'playlist' ? dominantColor : undefined }} />
            {currentView === 'playlist' && (
              <span 
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: dominantColor, boxShadow: `0 0 6px ${dominantColor}` }}
              />
            )}
          </div>
          <span className="text-[10px] font-semibold mt-1">Library</span>
        </button>
      </div>
    </nav>
  );
};
