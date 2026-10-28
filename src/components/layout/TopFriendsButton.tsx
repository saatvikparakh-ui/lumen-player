import React, { useState, useEffect } from 'react';
import { Users, Sparkles } from 'lucide-react';

interface Props {
  dominantColor: string;
  onClick: () => void;
  isOpen: boolean;
  unreadCount?: number;
}

export const TopFriendsButton: React.FC<Props> = ({
  dominantColor,
  onClick,
  isOpen,
  unreadCount = 0
}) => {
  return (
    <div className="fixed top-5 left-6 z-50 select-none">
      {/* Pure 3D Apple VisionOS Liquid Glass Friends Button */}
      <button
        onClick={onClick}
        className={`w-10 h-10 rounded-full bg-gradient-to-br from-white/[0.14] via-white/[0.05] to-white/[0.01] border-t border-l border-white/50 border-r border-b border-black/60 backdrop-blur-3xl shadow-xl transition-all duration-300 flex items-center justify-center group cursor-pointer ${
          isOpen ? 'scale-105 ring-2 ring-lumen-cyan/60' : 'hover:scale-110'
        }`}
        style={{
          boxShadow: `0 15px 35px -8px rgba(0, 0, 0, 0.9), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.45), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4), 0 0 20px -5px ${dominantColor}50`
        }}
        title="Friends & Social Listening"
      >
        <div 
          className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center border border-white/20 shadow-inner group-hover:border-white/40 transition-colors relative"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${dominantColor}90, #0d121d)`
          }}
        >
          <Users className="w-3.5 h-3.5 text-white stroke-[2.2] group-hover:scale-110 transition-transform" />
        </div>

        {/* Unread / Notification Indicator Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-pink-500 text-white font-mono text-[9px] font-bold flex items-center justify-center shadow-lg border border-black/60 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
};
