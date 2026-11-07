import React, { useState, useEffect } from 'react';
import { 
  X, 
  LogIn, 
  UserPlus, 
  AlertCircle, 
  Loader2, 
  Music, 
  Check, 
  Eye, 
  EyeOff, 
  KeyRound,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { FirebaseAuthService } from '../../services/firebaseAuthService';

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
  const [tab, setTab] = useState<'login' | 'signup' | 'forgot'>('login');
  
  // Sign In state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Sign Up state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupDisplayName, setSignupDisplayName] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Forgot Password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  // Shared state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recentEmails, setRecentEmails] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(false);
      setErrorMessage(null);
      setResetSuccessMessage(null);
      setRecentEmails(FirebaseAuthService.getRecentEmails());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Simple clean password strength indicator
  const getPasswordStrength = (pass: string): { label: string; color: string; percent: number } => {
    if (!pass) return { label: 'Empty', color: '#64748b', percent: 0 };
    if (pass.length < 8) return { label: 'Too short (min 8 chars)', color: '#ef4444', percent: 25 };
    
    let score = 1;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^a-zA-Z0-9]/.test(pass)) score++;

    if (score >= 4 && pass.length >= 10) {
      return { label: 'Strong', color: '#10b981', percent: 100 };
    }
    if (score >= 2) {
      return { label: 'Good', color: '#06b6d4', percent: 65 };
    }
    return { label: 'Fair (add letters or numbers)', color: '#f59e0b', percent: 45 };
  };

  const strength = getPasswordStrength(signupPassword);

  // Environment check: Electron popups are blocked by Google OAuth
  const isElectron = typeof window !== 'undefined' && (
    Boolean((window as any).isElectron) ||
    Boolean((window as any).electron) ||
    Boolean((window as any).lumenAPI) ||
    Boolean((window as any).process?.type === 'renderer') ||
    navigator.userAgent.includes('Electron') ||
    window.location.protocol === 'file:'
  );

  // 1. Sign In
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = loginEmail.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!loginPassword) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsLoading(true);

    try {
      await FirebaseAuthService.signIn(cleanEmail, loginPassword);
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Incorrect email or password.');
      setIsLoading(false);
    }
  };

  // 2. Create Account
  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = signupEmail.trim();
    const cleanUser = signupUsername.replace(/^@/, '').trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (cleanUser.length < 3 || cleanUser.length > 20) {
      setErrorMessage('Username must be between 3 and 20 characters.');
      return;
    }
    if (signupPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters.');
      return;
    }
    if (signupPassword !== signupConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      await FirebaseAuthService.signUp({
        email: cleanEmail,
        password: signupPassword,
        username: cleanUser,
        displayName: signupDisplayName.trim() || `@${cleanUser}`
      });
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create account.');
      setIsLoading(false);
    }
  };

  // 3. Google Sign-In
  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await FirebaseAuthService.signInWithGoogle();
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Google sign-in was canceled.');
      setIsLoading(false);
    }
  };

  // 4. Password Reset
  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResetSuccessMessage(null);
    setIsLoading(true);

    try {
      const msg = await FirebaseAuthService.sendPasswordReset(resetEmail.trim());
      setResetSuccessMessage(msg);
      setIsLoading(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to send password reset email.');
      setIsLoading(false);
    }
  };

  // 5. Guest Continue
  const handleGuestContinue = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await FirebaseAuthService.continueAsGuest();
      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to continue as guest.');
      setIsLoading(false);
    }
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
              <p className="text-xs text-white/50 font-mono">Universal Cloud Library & Sync</p>
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
          {/* Tabs: Sign In / Create Account */}
          <div className="flex p-1 bg-white/[0.06] rounded-2xl border border-white/10 gap-1">
            <button
              type="button"
              onClick={() => { setTab('login'); setErrorMessage(null); setResetSuccessMessage(null); }}
              className={`flex-1 py-2 px-1 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'login' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>

            <button
              type="button"
              onClick={() => { setTab('signup'); setErrorMessage(null); setResetSuccessMessage(null); }}
              className={`flex-1 py-2 px-1 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                tab === 'signup' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>

          {/* Inline Error Banner */}
          {errorMessage && (
            <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-200 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span className="leading-snug">{errorMessage}</span>
            </div>
          )}

          {/* Desktop App Guidance */}
          {tab !== 'forgot' && isElectron && (
            <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-xs text-white/60">
              <span>Sign in with Email & Password or Guest</span>
              <span className="px-2 py-0.5 rounded-md bg-lumen-cyan/15 text-lumen-cyan font-mono text-[10px] font-bold">DESKTOP</span>
            </div>
          )}

          {/* Quick Google Sign In (Web / Mobile only, hidden on Desktop) */}
          {tab !== 'forgot' && !isElectron && (
            <>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full py-2.5 px-3 rounded-xl font-semibold text-xs text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Continue with Google</span>
              </button>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-white/10 w-full" />
                <span className="bg-[#121524] px-2 text-[10px] text-white/40 font-mono uppercase">or with email</span>
                <div className="border-t border-white/10 w-full" />
              </div>
            </>
          )}

          {/* TAB 1: SIGN IN */}
          {tab === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
                {recentEmails.length > 0 && !loginEmail && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {recentEmails.slice(0, 3).map(em => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setLoginEmail(em)}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setTab('forgot'); setResetEmail(loginEmail); setErrorMessage(null); }}
                    className="text-[10px] text-lumen-cyan/80 hover:text-lumen-cyan font-mono hover:underline cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 p-1"
                  >
                    {showLoginPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
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
                  <span>Sign In & Sync</span>
                )}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setTab('signup'); setErrorMessage(null); }}
                  className="text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Don't have an account? <span className="text-lumen-cyan font-semibold">Create one</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: CREATE ACCOUNT */}
          {tab === 'signup' && (
            <form onSubmit={handleSignUpSubmit} className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={signupDisplayName}
                    onChange={(e) => setSignupDisplayName(e.target.value)}
                    placeholder="Alex Rivera"
                    className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                    @Username (Handle)
                  </label>
                  <input
                    type="text"
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase().slice(0, 20))}
                    placeholder="alex_rivera"
                    required
                    className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white font-mono placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Password (min 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showSignupPassword ? 'text' : 'password'}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 p-1"
                  >
                    {showSignupPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {/* Strength Meter */}
                {signupPassword.length > 0 && (
                  <div className="mt-1 space-y-1">
                    <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                      <div 
                        className="h-full transition-all duration-300"
                        style={{ width: `${strength.percent}%`, backgroundColor: strength.color }}
                      />
                    </div>
                    <p className="text-[10px] font-mono" style={{ color: strength.color }}>
                      Strength: {strength.label}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Confirm Password
                </label>
                <input
                  type={showSignupPassword ? 'text' : 'password'}
                  value={signupConfirmPassword}
                  onChange={(e) => setSignupConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  required
                  className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
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
                  onClick={() => { setTab('login'); setErrorMessage(null); }}
                  className="text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Already have an account? <span className="text-lumen-cyan font-semibold">Sign In</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: FORGOT PASSWORD */}
          {tab === 'forgot' && (
            <form onSubmit={handlePasswordResetSubmit} className="space-y-3.5">
              <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white/70 space-y-1">
                <p className="font-semibold text-white flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-lumen-cyan" />
                  <span>Reset Your Password</span>
                </p>
                <p className="text-[11px] text-white/50">
                  Enter your registered email address. We will send you a secure link to reset your password.
                </p>
              </div>

              {resetSuccessMessage && (
                <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-start gap-2.5 text-xs text-emerald-200">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>{resetSuccessMessage}</span>
                </div>
              )}

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !resetEmail.trim()}
                className="w-full py-2.5 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                style={{
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 20px ${dominantColor}60`
                }}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>Send Reset Email</span>
                )}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setTab('login'); setErrorMessage(null); setResetSuccessMessage(null); }}
                  className="text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Remembered your password? <span className="text-lumen-cyan font-semibold">Back to Sign In</span>
                </button>
              </div>
            </form>
          )}

          {/* Guest Bypass */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={handleGuestContinue}
              disabled={isLoading}
              className="text-xs text-white/40 hover:text-white/80 transition-colors font-mono py-1 px-3 rounded-lg hover:bg-white/5 cursor-pointer inline-flex items-center gap-1.5"
            >
              <span>Continue as Guest (Anonymous)</span>
              <ArrowRight className="w-3 h-3 text-lumen-cyan" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
