import React from 'react';
import { User, LogOut, UserPlus, Check, X, Shield, Sparkles, ChevronRight, Trash2 } from 'lucide-react';
import { FirebaseAuthService, AppUser, SavedAccountItem } from '../../services/firebaseAuthService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  dominantColor: string;
  onOpenSignIn: () => void;
  onAccountSwitched: (user: AppUser) => void;
}

export const AccountSwitcherModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentUser,
  dominantColor,
  onOpenSignIn,
  onAccountSwitched
}) => {
  if (!isOpen) return null;

  const savedAccounts = FirebaseAuthService.getSavedAccounts();

  const handleSelectAccount = (acc: SavedAccountItem) => {
    if (currentUser?.uid === acc.uid) {
      onClose();
      return;
    }
    const user = FirebaseAuthService.switchAccount(acc);
    onAccountSwitched(user);
    onClose();
  };

  const handleRemoveAccount = (e: React.MouseEvent, uid: string) => {
    e.stopPropagation();
    FirebaseAuthService.removeSavedAccount(uid);
  };

  const handleSignOutCurrent = async () => {
    await FirebaseAuthService.signOut();
    onClose();
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
            <h3 className="text-base font-bold text-white">Accounts on this Device</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/50 hover:text-white rounded-full bg-white/5 active:scale-95"
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
                    Active
                  </span>
                </span>
                <span className="text-xs text-white/50">{currentUser.email || 'Guest Mode'}</span>
              </div>
            </div>
            <Check className="w-5 h-5 text-emerald-400 mr-1" />
          </div>
        )}

        {/* Saved Accounts List */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-white/40 uppercase tracking-wider px-1">
            Switch Account
          </span>

          {savedAccounts.length === 0 && !currentUser && (
            <p className="text-sm text-white/40 py-3 text-center">No accounts saved on this device yet.</p>
          )}

          {savedAccounts.map((acc) => {
            const isCurrent = currentUser?.uid === acc.uid;
            if (isCurrent) return null;

            return (
              <div
                key={acc.uid}
                onClick={() => handleSelectAccount(acc)}
                className="group flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-[0.98] border border-white/5 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-semibold text-white overflow-hidden">
                    {acc.photoURL ? (
                      <img src={acc.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      (acc.displayName || acc.email || 'A')[0].toUpperCase()
                    )}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-sm font-medium text-white">{acc.displayName || 'Listener'}</span>
                    <span className="text-xs text-white/40">{acc.email || 'Guest Account'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleRemoveAccount(e, acc.uid)}
                    className="p-1.5 text-white/30 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                    title="Remove from device"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-white transition-colors" />
                </div>
              </div>
            );
          })}

          {/* Add Another Account */}
          <button
            onClick={() => {
              onClose();
              onOpenSignIn();
            }}
            className="flex items-center gap-3 p-3 rounded-2xl border border-dashed border-white/20 hover:border-white/40 bg-white/[0.02] hover:bg-white/[0.06] text-white/80 hover:text-white transition-all active:scale-[0.98] mt-1"
          >
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white/70" />
            </div>
            <span className="text-sm font-medium">Add another account</span>
          </button>
        </div>

        {/* Footer Actions */}
        {currentUser && (
          <div className="pt-2 border-t border-white/10 flex items-center justify-between">
            <button
              onClick={handleSignOutCurrent}
              className="flex items-center gap-2 text-xs font-medium text-rose-400 hover:text-rose-300 py-2 px-3 rounded-xl hover:bg-rose-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Log out of {currentUser.displayName || 'this account'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
