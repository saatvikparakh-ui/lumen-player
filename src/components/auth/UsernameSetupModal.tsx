import React, { useState, useEffect, useRef } from 'react';
import { AtSign, Check, AlertCircle, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  isOpen: boolean;
  userId: string;
  currentUsername?: string;
  onComplete: (username: string) => void;
  dominantColor?: string;
  canDismiss?: boolean;
  onDismiss?: () => void;
}

export const UsernameSetupModal: React.FC<Props> = ({
  isOpen,
  userId,
  currentUsername = '',
  onComplete,
  dominantColor = '#06b6d4',
  canDismiss = false,
  onDismiss
}) => {
  const [usernameInput, setUsernameInput] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (currentUsername && !currentUsername.startsWith('user_') && currentUsername !== 'You') {
      setUsernameInput(currentUsername.replace(/^@/, ''));
    }
  }, [currentUsername]);

  // Debounced real-time availability check
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/^@/, '').toLowerCase().trim();
    // Allow only lowercase alphanumeric and underscores
    const clean = raw.replace(/[^a-z0-9_]/g, '').slice(0, 20);
    setUsernameInput(clean);
    setIsAvailable(null);
    setErrorMsg(null);

    if (clean.length < 3) {
      if (clean.length > 0) {
        setErrorMsg('Username must be at least 3 characters.');
      }
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/check-username?username=${encodeURIComponent(clean)}&userId=${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          setIsAvailable(data.available);
          if (!data.available) {
            setErrorMsg(`@${clean} is already claimed by another listener.`);
          } else {
            setErrorMsg(null);
          }
        } else {
          setIsAvailable(false);
          setErrorMsg('Could not verify username.');
        }
      } catch (_) {
        setIsAvailable(false);
        setErrorMsg('Network error checking availability.');
      } finally {
        setIsChecking(false);
      }
    }, 280);
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput || isChecking || isAvailable === false) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/users/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          username: usernameInput
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        WatchSoundService.playTick(1.3);
        onComplete(data.username);
      } else {
        setErrorMsg(data.error || 'Failed to claim username');
        setIsAvailable(false);
      }
    } catch (_) {
      setErrorMsg('Network error while saving username');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isValidFormat = /^[a-z0-9_]{3,20}$/.test(usernameInput);
  const canSubmit = isValidFormat && isAvailable === true && !isChecking && !isSubmitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-3xl select-none animate-fadeIn">
      {/* VisionOS Specular LED Bloom */}
      <div 
        className="pointer-events-none absolute w-[500px] h-[500px] rounded-full blur-[160px] opacity-25"
        style={{ backgroundColor: dominantColor }}
      />

      <div 
        className="relative w-full max-w-md rounded-3xl bg-gradient-to-br from-white/[0.16] via-white/[0.05] to-black/95 border-t border-l border-white/50 border-r border-b border-black/80 backdrop-blur-3xl shadow-2xl p-6 sm:p-8 overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          boxShadow: `0 30px 90px rgba(0, 0, 0, 0.95), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.4), 0 0 50px -5px ${dominantColor}50`
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3.5 mb-6">
          <div 
            className="w-12 h-12 rounded-2xl flex items-center justify-center border border-white/30 shadow-xl"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${dominantColor}dd, #0b111e)`
            }}
          >
            <AtSign className="w-6 h-6 text-white stroke-[2.2]" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
              <span>Choose Your Unique Tag</span>
              <span className="px-2 py-0.5 rounded-full bg-lumen-cyan/20 border border-lumen-cyan/30 text-lumen-cyan font-mono text-[9px] font-bold uppercase">
                Unique
              </span>
            </h3>
            <p className="text-xs text-white/50 font-mono mt-0.5">
              Friends can use this to find you and send songs
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleClaim} className="space-y-5">
          <div>
            <label className="text-[11px] font-mono text-white/60 uppercase tracking-wider block mb-2 font-bold">
              Your Public Username
            </label>

            <div className="relative flex items-center">
              <span className="absolute left-4 text-base font-bold text-white/50 select-none pointer-events-none">
                @
              </span>
              <input
                type="text"
                value={usernameInput}
                onChange={handleInputChange}
                placeholder="saatvik"
                autoFocus
                maxLength={20}
                className="w-full pl-9 pr-11 py-3.5 bg-white/5 border border-white/20 rounded-2xl text-sm font-bold text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan transition-colors tracking-wide"
              />

              {/* Status Indicator Icon */}
              <div className="absolute right-3.5 flex items-center">
                {isChecking ? (
                  <Loader2 className="w-5 h-5 text-white/50 animate-spin" />
                ) : isAvailable === true ? (
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                ) : isAvailable === false || errorMsg ? (
                  <div className="w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center">
                    <AlertCircle className="w-3.5 h-3.5 stroke-[2.5]" />
                  </div>
                ) : null}
              </div>
            </div>

            {/* Live Feedback Message */}
            <div className="mt-2 min-h-[20px] px-1">
              {isChecking ? (
                <p className="text-xs font-mono text-white/50 flex items-center gap-1.5 animate-pulse">
                  <span>Checking availability...</span>
                </p>
              ) : isAvailable === true ? (
                <p className="text-xs font-mono text-emerald-400 flex items-center gap-1.5 font-bold">
                  <Check className="w-3.5 h-3.5" />
                  <span>@{usernameInput} is available!</span>
                </p>
              ) : errorMsg ? (
                <p className="text-xs font-mono text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{errorMsg}</span>
                </p>
              ) : (
                <p className="text-[11px] font-mono text-white/40">
                  3 to 20 characters • Letters, numbers, and underscores only
                </p>
              )}
            </div>
          </div>

          {/* Tag Preview Card */}
          {usernameInput.length >= 3 && (
            <div className="p-3.5 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-between animate-fadeIn">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-pink-500 to-cyan-400 p-[1px] shadow-sm">
                  <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold text-white uppercase">
                    {usernameInput.charAt(0)}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-bold text-white block">@{usernameInput}</span>
                  <span className="text-[10px] text-white/50 font-mono">Listener Preview</span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-mono text-white/70">
                Lumen ID
              </span>
            </div>
          )}

          {/* Action Button */}
          <div className="pt-2 flex items-center gap-2.5">
            {canDismiss && onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="py-3 px-5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Later
              </button>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 py-3.5 rounded-2xl bg-lumen-cyan text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl hover:brightness-110 active:scale-95 disabled:opacity-40 cursor-pointer transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Claiming Tag...</span>
                </>
              ) : (
                <>
                  <span>Claim Unique Tag</span>
                  <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
