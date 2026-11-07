import React, { useState } from 'react';
import { User, LogOut, UserPlus, Check, X, Shield, Sparkles, ChevronRight, Trash2 } from 'lucide-react';
import { FirebaseAuthService, AppUser } from '../../services/firebaseAuthService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  dominantColor: string;
  onOpenSignIn: () => void;
  onAccountSwitched?: (user: AppUser) => void;
}

export const AccountSwitcherModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentUser,
  dominantColor,
  onOpenSignIn
}) => {
  const [clearLocalData, setClearLocalData] = useState(false);

  if (!isOpen) return null;

  const handleSignOutCurrent = async () => {
    await FirebaseAuthService.signOut({ clearLocalData });
    onClose();
    onOpenSignIn();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
      <div 
        className="w-full sm:max-w-md bg-[#0C0F19] border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl flex flex-col gap-5 max-h-[85vh] overflow-y-auto animate-slide-up"
        style={{ boxShadow: `0 -10px 40px ${dominantColor}20` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5" style={{ color: dominantColor }} />
            <h3 className="text-base font-bold text-white">Your Account</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/50 hover:text-white rounded-full bg-white/5 active:scale-95 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Active User Card */}
        {currentUser && (
          <div className="p-3.5 rounded-2xl bg-white/[0.06] border border-white/15 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white text-base overflow-hidden"
                style={{ backgroundColor: dominantColor }}
              >
                {currentUser.photoURL ? (
                  <img src={currentUser.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                  {currentUser.displayName || 'Active Listener'}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-normal">
                    {currentUser.isGuest ? 'Guest' : 'Active'}
                  </span>
                </span>
                <span className="text-xs text-white/50 font-mono">
                  {currentUser.email || (currentUser.username ? `@${currentUser.username}` : 'Guest Session')}
                </span>
              </div>
            </div>
            <Check className="w-5 h-5 text-emerald-400 mr-1" />
          </div>
        )}

        {/* Switch / Add Another Account */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              onClose();
              onOpenSignIn();
            }}
            className="flex items-center gap-3 p-3 rounded-2xl border border-dashed border-white/20 hover:border-white/40 bg-white/[0.02] hover:bg-white/[0.06] text-white/80 hover:text-white transition-all active:scale-[0.98] cursor-pointer"
          >
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white/70" />
            </div>
            <div className="text-left">
              <span className="text-sm font-medium block">Switch or Sign In to Another Account</span>
              <span className="text-xs text-white/40 block">Requires password authentication</span>
            </div>
          </button>
        </div>

        {/* Footer Actions */}
        {currentUser && (
          <div className="pt-3 border-t border-white/10 space-y-3">
            <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
              <input 
                type="checkbox" 
                checked={clearLocalData} 
                onChange={(e) => setClearLocalData(e.target.checked)} 
                className="rounded border-white/20 bg-white/5"
              />
              <span>Remove this account's local cache from this device on sign out</span>
            </label>

            <button
              onClick={handleSignOutCurrent}
              className="w-full flex items-center justify-center gap-2 text-xs font-medium text-rose-400 hover:text-rose-300 py-2.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out of {currentUser.displayName || 'Account'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
