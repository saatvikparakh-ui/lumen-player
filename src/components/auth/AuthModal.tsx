import React, { useState } from 'react';
import { 
  X, 
  LogIn, 
  UserPlus, 
  Sparkles, 
  Settings, 
  AlertCircle, 
  Loader2, 
  Music, 
  Check, 
  ShieldCheck,
  Disc3
} from 'lucide-react';
import { FirebaseAuthService, FirebaseConfig } from '../../services/firebaseAuthService';

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
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Firebase Config Setup Dialog
  const [showConfigSetup, setShowConfigSetup] = useState(false);
  const [configJson, setConfigJson] = useState(() => {
    const cur = FirebaseAuthService.getSavedConfig();
    return cur ? JSON.stringify(cur, null, 2) : '';
  });
  const [configSaved, setConfigSaved] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      if (tab === 'signin') {
        await FirebaseAuthService.signInWithEmail(email.trim(), password);
      } else {
        await FirebaseAuthService.signUpWithEmail(email.trim(), password, displayName.trim());
      }
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await FirebaseAuthService.signInWithGoogle();
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Google sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestContinue = () => {
    FirebaseAuthService.continueAsGuest(displayName.trim() || 'Guest Listener');
    if (onSuccess) onSuccess();
    if (onClose) onClose();
  };

  const handleSaveConfig = () => {
    try {
      let parsed: FirebaseConfig | null = null;

      // 1. Attempt standard JSON parse
      try {
        const direct = JSON.parse(configJson);
        if (direct && typeof direct === 'object' && direct.apiKey && direct.projectId) {
          parsed = direct as FirebaseConfig;
        }
      } catch (_) {}

      // 2. If not valid JSON, extract from raw JavaScript / HTML snippet
      if (!parsed) {
        const extractKey = (key: string): string => {
          const regex = new RegExp(`['"]?${key}['"]?\\s*:\\s*['"\`]([^'"\`]+)['"\`]`, 'i');
          const match = configJson.match(regex);
          return match ? match[1].trim() : '';
        };

        const apiKey = extractKey('apiKey');
        const authDomain = extractKey('authDomain');
        const projectId = extractKey('projectId');
        const storageBucket = extractKey('storageBucket');
        const messagingSenderId = extractKey('messagingSenderId');
        const appId = extractKey('appId');

        if (apiKey && projectId) {
          parsed = {
            apiKey,
            authDomain,
            projectId,
            storageBucket,
            messagingSenderId,
            appId
          };
        }
      }

      if (!parsed || !parsed.apiKey || !parsed.projectId) {
        throw new Error('Could not find apiKey and projectId. Please paste the Firebase config code.');
      }

      const ok = FirebaseAuthService.saveConfig(parsed);
      if (ok) {
        setConfigSaved(true);
        setErrorMessage(null);
        setTimeout(() => {
          setConfigSaved(false);
          setShowConfigSetup(false);
        }, 1200);
      }
    } catch (err: any) {
      setErrorMessage('Could not parse configuration: ' + err.message);
    }
  };

  const isConfigured = FirebaseAuthService.isConfigured();

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex items-center justify-center p-4 select-none animate-fadeIn">
      <div 
        className="w-full max-w-md rounded-3xl bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-black/90 border-t border-l border-white/40 border-r border-b border-black/60 backdrop-blur-3xl shadow-2xl p-6 sm:p-8 relative overflow-hidden"
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
        <div className="flex items-center justify-between mb-6 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-lumen-cyan/15 border border-lumen-cyan/30 flex items-center justify-center text-lumen-cyan shadow-lg">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight">LUMEN Music</h2>
              <p className="text-xs text-white/50 font-mono">Hi-Fi Audio & Social Taste System</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowConfigSetup(!showConfigSetup)}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title="Firebase Project Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* FIREBASE CONFIGURATION SETUP ACCORDION */}
        {showConfigSetup ? (
          <div className="space-y-4 animate-fadeIn relative z-10">
            <div className="p-3.5 rounded-2xl bg-white/[0.05] border border-white/10 text-xs">
              <span className="font-bold text-white block mb-1">Firebase Project Configuration</span>
              <p className="text-white/60 leading-relaxed text-[11px]">
                Paste your <code className="text-lumen-cyan">firebaseConfig</code> object from your Firebase Console.
              </p>
            </div>

            <textarea
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              placeholder='{ "apiKey": "...", "projectId": "...", ... }'
              rows={8}
              className="w-full p-3 bg-black/60 border border-white/20 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-lumen-cyan"
            />

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowConfigSetup(false)}
                className="px-4 py-2 rounded-xl bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition-all"
              >
                Back to Login
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                className="px-5 py-2 rounded-xl bg-lumen-cyan text-black text-xs font-bold hover:bg-lumen-cyan/90 transition-all flex items-center gap-1.5"
              >
                {configSaved ? <Check className="w-4 h-4" /> : null}
                <span>{configSaved ? 'Config Saved!' : 'Save Configuration'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="relative z-10 space-y-4">
            {/* Tabs */}
            <div className="flex p-1 bg-white/[0.06] rounded-2xl border border-white/10">
              <button
                type="button"
                onClick={() => setTab('signin')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  tab === 'signin' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('signup')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  tab === 'signup' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create Account</span>
              </button>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-200 animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Email / Password Form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              {tab === 'signup' && (
                <div>
                  <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                    Your Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex Rivera"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-white/50 uppercase tracking-widest block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl font-bold text-xs text-black transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-102 active:scale-95 disabled:opacity-50 cursor-pointer"
                style={{
                  backgroundColor: dominantColor,
                  boxShadow: `0 0 20px ${dominantColor}60`
                }}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : tab === 'signin' ? (
                  <span>Sign In</span>
                ) : (
                  <span>Create Account</span>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-[1px] bg-white/10" />
              <span className="text-[10px] font-mono uppercase text-white/40">or continue with</span>
              <div className="flex-1 h-[1px] bg-white/10" />
            </div>

            {/* Google Sign In Button */}
            {isConfigured && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Google Account</span>
              </button>
            )}

            {/* Guest / Demo Testing Bypass */}
            <button
              type="button"
              onClick={handleGuestContinue}
              className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white font-mono text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
              <span>Continue as Guest / Demo Listener</span>
            </button>

            {!isConfigured && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 flex items-center justify-between">
                <span>Firebase keys not yet configured.</span>
                <button
                  type="button"
                  onClick={() => setShowConfigSetup(true)}
                  className="font-bold underline text-amber-300 ml-2 cursor-pointer"
                >
                  Configure
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
