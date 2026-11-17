import React, { useState, useEffect } from 'react';
import { Users, Sparkles } from 'lucide-react';

interface Props {
  dominantColor: string;
  onClick: () => void;
  isOpen: boolean;
  unreadCount?: number;
  className?: string;
}

export const TopFriendsButton: React.FC<Props> = ({
  dominantColor,
  onClick,
  isOpen,
  unreadCount = 0,
  className = "fixed top-5 left-5 z-[60] select-none"
}) => {
  return (
    <div 
      className={`relative ${className}`}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      {/* 3D Liquid Glass Friends Lens */}
      <button
        type="button"
        onClick={onClick}
        className={`w-10 h-10 rounded-full bg-gradient-to-br from-white/[0.18] via-white/[0.08] to-white/[0.02] border border-white/30 backdrop-blur-2xl transition-all duration-300 flex items-center justify-center group cursor-pointer overflow-hidden ${
          isOpen ? 'scale-105 ring-2 ring-lumen-cyan/70' : 'hover:scale-110 active:scale-95'
        }`}
        style={{
          isolation: 'isolate',
          boxShadow: `inset 0 1.5px 2px 0 rgba(255, 255, 255, 0.65), inset 0 -1.5px 2px 0 rgba(255, 255, 255, 0.12), inset 0 0 12px 0 rgba(255, 255, 255, 0.08), 0 8px 24px -4px rgba(0, 0, 0, 0.35), 0 0 18px -4px ${dominantColor}45`
        }}
        title="Friends & Social Listening"
      >
        <div 
          className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center border border-white/20 shadow-inner group-hover:border-white/40 transition-colors relative"
          style={{
            background: `radial-gradient(circle at 35% 35%, ${dominantColor}99, #0d121d)`
          }}
        >
          <Users className="w-3.5 h-3.5 text-white stroke-[2.2] group-hover:scale-110 transition-transform" />
        </div>
      </button>

      {/* Unread / Notification Indicator Badge */}
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pink-500 text-white font-mono text-[9px] font-bold flex items-center justify-center shadow-md border border-white/40 animate-pulse pointer-events-none">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </div>
  );
};
