import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Home, Search, FolderHeart, Users } from 'lucide-react';

interface Props {
  currentView: 'home' | 'player' | 'playlist' | 'search' | 'friends';
  onSelectView: (view: 'home' | 'player' | 'playlist' | 'search' | 'friends') => void;
  onOpenSearch: () => void;
  onOpenFriendsHub?: () => void;
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
  isVisible = true
}) => {
  return (
    <nav 
      aria-label="Mobile Navigation"
      className={`fixed left-3.5 right-3.5 max-w-sm mx-auto z-40 rounded-full bg-gradient-to-b from-white/[0.18] via-white/[0.07] to-black/85 backdrop-blur-3xl border-t border-l border-white/35 border-r border-b border-white/15 px-3 py-1 shadow-2xl select-none transition-all duration-300 ease-out overflow-hidden ${
        isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-28 opacity-0 pointer-events-none'
      }`}
      style={{
        bottom: 'calc(16px + env(safe-area-inset-bottom, 8px))',
        boxShadow: `0 18px 45px -6px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.45), inset 0 -1px 1px 0 rgba(0, 0, 0, 0.4), 0 0 24px -4px ${dominantColor}30`
      }}
    >
      {/* Specular Liquid Glass Top Refraction Sheen */}
      <div className="absolute top-0 left-6 right-6 h-3 bg-gradient-to-b from-white/20 via-white/[0.04] to-transparent rounded-full pointer-events-none" />

      <div className="flex items-center justify-between h-12 max-w-sm mx-auto relative z-10">
        {/* 1. HOME */}
        <button
          type="button"
          onClick={() => onSelectView('home')}
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
          onClick={onOpenSearch}
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
          onClick={() => onSelectView('friends')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[46px] py-1 transition-all active:scale-95 ${
            currentView === 'friends' ? 'text-white' : 'text-white/45 hover:text-white/80'
          }`}
          title="Friends and More"
        >
          <div className="relative">
            <Users className="w-5 h-5" style={{ color: currentView === 'friends' ? dominantColor : undefined }} />
            {currentView === 'friends' && (
              <span 
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: dominantColor, boxShadow: `0 0 6px ${dominantColor}` }}
              />
            )}
            {hasUnreadShares && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse border border-[#07090E]" />
            )}
          </div>
          <span className="text-[10px] font-semibold mt-1">Friends</span>
        </button>

        {/* 4. LIBRARY / PLAYLISTS */}
        <button
          type="button"
          onClick={() => onSelectView('playlist')}
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
