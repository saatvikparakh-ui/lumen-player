import React, { useState, useEffect } from 'react';
import { 
  X, 
  LogIn, 
  UserPlus, 
  Sparkles, 
  AlertCircle, 
  Loader2, 
  Music, 
  Check, 
  UserCheck,
  Trash2
} from 'lucide-react';
import { FirebaseAuthService, FirebaseConfig, SavedAccountItem } from '../../services/firebaseAuthService';

interface Props {
  isOpen: boolean;
  onClose?: () => void;
  dominantColor?: string;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<Props> = ({
  isOpen,
  onClose,
  dominantColor = '#63E8FF',
  onSuccess
}) => {
  // Exactly 3 clean options as requested: Log In (Password), Sign Up (Password), and Google
  const [tab, setTab] = useState<'google' | 'signup' | 'login'>('login');
  
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');
  
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccountItem[]>([]);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(false);
      setErrorMessage(null);
      setSavedAccounts(FirebaseAuthService.getSavedAccounts());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatAuthError = (err: any): string => {
    if (!err) return 'An unexpected error occurred. Please try again.';
    const raw = String(err.message || err);
    if (raw.includes('not valid JSON') || raw.includes('Unexpected token') || raw.includes('doctype') || raw.includes('<!doctype')) {
      return 'Authentication service is syncing. Please check your connection and try again.';
    }
    if (raw.includes('auth/email-already-in-use')) {
      return 'This email address is already registered. Please switch to the Log In tab.';
    }
    if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password') || raw.includes('auth/user-not-found')) {
      return 'Incorrect email or password. Please verify your credentials and try again.';
    }
    if (raw.includes('auth/invalid-email')) {
      return 'Please enter a valid email address.';
    }
    if (raw.includes('auth/weak-password')) {
      return 'Password must be at least 6 characters.';
    }
    if (raw.includes('auth/network-request-failed')) {
      return 'Network connection issue. Please check your internet connection.';
    }
    return raw;
  };

  // 1. Google 1-Tap Sign-In
  const handleGoogleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await FirebaseAuthService.loginWithGoogleAccount(googleEmail, googleName);
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(formatAuthError(err));
      setIsLoading(false);
    }
  };

  // 2. Normal Sign Up (Create Account with Password)
  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await FirebaseAuthService.registerWithPassword({
        username: signupName.trim(),
        email: signupEmail.trim() || undefined,
        password: signupPassword,
        displayName: signupName.trim()
      });
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(formatAuthError(err));
      setIsLoading(false);
    }
  };

  // 3. Log In (Existing Account with Password & Cloud Sync)
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await FirebaseAuthService.loginWithPassword(loginIdentifier.trim(), loginPassword);
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(formatAuthError(err));
      setIsLoading(false);
    }
  };

  // Saved account switch
  const handleSwitchToSaved = (account: SavedAccountItem) => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      FirebaseAuthService.switchAccount(account);
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to switch profile.');
      setIsLoading(false);
    }
  };

  // Saved account removal
  const handleRemoveSaved = (uid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    FirebaseAuthService.removeSavedAccount(uid);
    setSavedAccounts(FirebaseAuthService.getSavedAccounts());
  };

  const handleClearAllSaved = (e: React.MouseEvent) => {
    e.stopPropagation();
    FirebaseAuthService.clearAllSavedAccounts();
    setSavedAccounts([]);
  };

  // Guest bypass
  const handleGuestContinue = () => {
    FirebaseAuthService.continueAsGuest();
    if (onSuccess) onSuccess();
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-2xl flex items-end sm:items-center justify-center p-2 sm:p-4 pb-[max(2rem,env(safe-area-inset-bottom))] select-none animate-fadeIn overflow-y-auto">
      <div 
        className="w-full max-w-md max-h-[min(88dvh,680px)] overflow-y-auto no-scrollbar rounded-3xl bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-black/90 border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-3xl shadow-2xl p-5 sm:p-7 relative"
        style={{
          boxShadow: `0 30px 80px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.35), 0 0 40px -5px ${dominantColor}50`
        }}
      >
        {/* Ambient Glow */}
        <div 
          className="pointer-events-none absolute w-72 h-72 -top-20 -right-20 rounded-full blur-[100px] opacity-25"
          style={{ backgroundColor: dominantColor }}
        />

        {/* Header */}
        <div className="flex items-center justify-between mb-5 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-lumen-cyan/15 border border-lumen-cyan/30 flex items-center justify-center text-lumen-cyan shadow-lg">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight">LUMEN Music</h2>
              <p className="text-xs text-white/50 font-mono">Hi-Fi Audio & Social Taste System</p>
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="relative z-10 space-y-4">
          {/* Exactly 3 Clean Tabs */}
          <div className="flex p-1 bg-white/[0.06] rounded-2xl border border-white/10 gap-1">
            {/* 1. Google */}
            <button
              type="button"
              onClick={() => { setTab('google'); setErrorMessage(null); }}
              className={`flex-1 py-2 px-1 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'google' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Google</span>
            </button>

            {/* 2. Sign Up */}
            <button
              type="button"
              onClick={() => { setTab('signup'); setErrorMessage(null); }}
              className={`flex-1 py-2 px-1 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'signup' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Sign Up</span>
            </button>

            {/* 3. Log In */}
            <button
              type="button"
              onClick={() => { setTab('login'); setErrorMessage(null); }}
              className={`flex-1 py-2 px-1 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'login' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Log In</span>
            </button>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-200 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span className="leading-snug">{errorMessage}</span>
            </div>
          )}

          {/* Saved Accounts (1-Tap Resume if available) */}
          {savedAccounts.length > 0 && (
            <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-white/50">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="w-3 h-3 text-lumen-cyan" />
                  <span>Resume Saved Profile</span>
                </span>
                {savedAccounts.length > 1 && (
                  <button
                    type="button"
                    onClick={handleClearAllSaved}
                    className="text-[10px] font-mono text-rose-400/80 hover:text-rose-300 hover:underline cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {savedAccounts.map((acc) => (
                  <div
                    key={acc.uid}
                    onClick={() => handleSwitchToSaved(acc)}
                    className="w-full flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {acc.photoURL ? (
                        <img src={acc.photoURL} alt="" className="w-7 h-7 rounded-full object-cover border border-white/20" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-lumen-cyan/20 border border-lumen-cyan/40 flex items-center justify-center text-lumen-cyan text-xs font-bold font-mono">
                          {(acc.displayName || acc.email || 'U')[0].toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate group-hover:text-lumen-cyan transition-colors">
                          {acc.displayName || acc.email}
                        </p>
                        {acc.email && (
                          <p className="text-[10px] text-white/40 truncate font-mono">{acc.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] font-mono text-lumen-cyan px-2 py-0.5 rounded-md bg-lumen-cyan/10 border border-lumen-cyan/20 group-hover:bg-lumen-cyan group-hover:text-black transition-all">
                        Resume
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveSaved(acc.uid, e)}
                        className="p-1 rounded-md text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Remove profile from this device"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 1: GOOGLE SIGN-IN */}
          {tab === 'google' && (
            <form onSubmit={handleGoogleSubmit} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1.5">
                  Google Account Email
                </label>
                <input
                  type="email"
                  value={googleEmail}
                  onChange={(e) => {
                    setGoogleEmail(e.target.value);
                    if (!googleName && e.target.value.includes('@')) {
                      const pre = e.target.value.split('@')[0].split(/[._-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                      setGoogleName(pre);
                    }
                  }}
                  placeholder="your.email@gmail.com"
                  autoFocus
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1.5">
                  Display Name (Optional)
                </label>
                <input
                  type="text"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                  placeholder="e.g. Alex Rivera"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
                <p className="text-[11px] text-white/40 mt-1 font-mono">
                  Syncs playlists, likes, and ratings automatically across phone and laptop.
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoading || !googleEmail.trim()}
                className="w-full py-2.5 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                style={{
                  backgroundColor: '#FFFFFF',
                  boxShadow: '0 0 25px rgba(255, 255, 255, 0.4)'
                }}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Continue with Google</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* TAB 2: SIGN UP (NORMAL ACCOUNT CREATION) */}
          {tab === 'signup' && (
            <form onSubmit={handleSignUpSubmit} className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Choose Your @Username
                </label>
                <input
                  type="text"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  placeholder="e.g. alex_rivera"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="name@example.com (optional)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                style={{
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 20px ${dominantColor}60`
                }}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>Create Account & Sync</span>
                )}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className="text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Already have an account? <span className="text-lumen-cyan font-semibold">Log In</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: LOG IN */}
          {tab === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Username or Email
                </label>
                <input
                  type="text"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="@username or name@example.com"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                style={{
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 20px ${dominantColor}60`
                }}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>Log In & Sync</span>
                )}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setTab('signup')}
                  className="text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Don't have an account? <span className="text-lumen-cyan font-semibold">Sign Up</span>
                </button>
              </div>
            </form>
          )}

          {/* Subtle Guest Bypass at the Bottom */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={handleGuestContinue}
              className="text-xs text-white/40 hover:text-white/80 transition-colors font-mono py-1 px-3 rounded-lg hover:bg-white/5 cursor-pointer inline-flex items-center gap-1.5"
            >
              <span>Continue as Guest / Skip for now</span>
              <span className="text-lumen-cyan">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
