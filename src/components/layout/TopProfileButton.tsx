import React, { useState, useRef, useEffect } from 'react';
import { User, Settings, ShieldCheck, ChevronDown, Sparkles, LogIn, LogOut, Users } from 'lucide-react';
import { AppUser } from '../../services/firebaseAuthService';

interface Props {
  onOpenSettings: (initialTab?: 'playback' | 'taste' | 'eq' | 'stats' | 'friends' | 'account') => void;
  dominantColor: string;
  currentUser?: AppUser | null;
  onOpenAuthModal?: () => void;
  onSignOut?: () => void;
  onOpenFriendsHub?: () => void;
}

export const TopProfileButton: React.FC<Props> = ({
  onOpenSettings,
  dominantColor,
  currentUser,
  onOpenAuthModal,
  onSignOut,
  onOpenFriendsHub
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const displayName = currentUser?.displayName || currentUser?.email?.split('@')[0] || (currentUser?.isGuest ? 'Guest Listener' : 'Saatvik');

  return (
    <div ref={menuRef} className="fixed top-5 right-6 z-50 select-none">
      {/* Pure 3D Liquid Glass Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-full bg-gradient-to-br from-white/[0.14] via-white/[0.05] to-white/[0.01] border-t border-l border-white/50 border-r border-b border-black/60 backdrop-blur-3xl shadow-xl hover:scale-110 transition-all duration-300 flex items-center justify-center group"
        style={{
          boxShadow: `0 15px 35px -8px rgba(0, 0, 0, 0.9), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.45), inset 0 -1.5px 1.5px 0 rgba(0, 0, 0, 0.4), 0 0 20px -5px ${dominantColor}50`
        }}
        title="Account & Settings"
      >
        <div 
          className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center border border-white/20 shadow-inner group-hover:border-white/40 transition-colors"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${dominantColor}90, #111521)`
          }}
        >
          {currentUser?.photoURL ? (
            <img src={currentUser.photoURL} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            <User className="w-3.5 h-3.5 text-white stroke-[2.2]" />
          )}
        </div>
      </button>

      {/* Profile Dropdown Menu */}
      {isOpen && (
        <div 
          className="absolute right-0 mt-2.5 w-56 rounded-2xl bg-black/85 border-t border-l border-white/20 border-r border-b border-black/50 backdrop-blur-2xl shadow-2xl p-1.5 flex flex-col gap-0.5 animate-fadeIn z-50 text-xs"
          style={{
            boxShadow: `0 20px 45px rgba(0, 0, 0, 0.95), 0 0 25px -5px ${dominantColor}40`
          }}
        >
          <div className="px-3 py-2 border-b border-white/10 mb-1">
            <div className="flex items-center gap-1.5 text-white font-bold truncate">
              <span className="truncate">{displayName}</span>
              <ShieldCheck className="w-3.5 h-3.5 text-lumen-cyan flex-shrink-0" />
            </div>
            <span className="text-[10px] text-white/50 font-mono">
              {currentUser?.isGuest ? 'Guest Session' : 'LUMEN Hi-Fi Premium'}
            </span>
          </div>

          <button
            onClick={() => {
              setIsOpen(false);
              onOpenSettings('playback');
            }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors text-left"
          >
            <Settings className="w-4 h-4 text-lumen-cyan" />
            <span>Settings & Tuning</span>
          </button>

          <button
            onClick={() => {
              setIsOpen(false);
              if (onOpenFriendsHub) {
                onOpenFriendsHub();
              } else {
                onOpenSettings('friends');
              }
            }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors text-left"
          >
            <Users className="w-4 h-4 text-emerald-400" />
            <span>Friends & Listening</span>
          </button>

          <button
            onClick={() => {
              setIsOpen(false);
              onOpenSettings('taste');
            }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors text-left"
          >
            <Sparkles className="w-4 h-4 text-lumen-violet" />
            <span>Taste Profile</span>
          </button>

          <button
            onClick={() => {
              setIsOpen(false);
              onOpenSettings('account');
            }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors text-left"
          >
            <User className="w-4 h-4 text-white/70" />
            <span>Account Details</span>
          </button>

          <div className="my-1 border-t border-white/10" />

          {currentUser && !currentUser.isGuest ? (
            <button
              onClick={() => {
                setIsOpen(false);
                if (onSignOut) onSignOut();
              }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left font-medium"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsOpen(false);
                if (onOpenAuthModal) onOpenAuthModal();
              }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-lumen-cyan hover:bg-cyan-500/10 transition-colors text-left font-medium"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In / Switch</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
