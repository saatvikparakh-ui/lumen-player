import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Sparkles, X, ShieldAlert } from 'lucide-react';
import { OtaUpdateService, type OtaSnapshot } from '../../services/otaUpdateService';

export const OtaUpdateBanner: React.FC = () => {
  const [snap, setSnap] = useState<OtaSnapshot>(() => OtaUpdateService.getSnapshot());

  useEffect(() => {
    return OtaUpdateService.subscribe(setSnap);
  }, []);

  const shouldShow =
    !snap.dismissed &&
    (snap.state === 'web_ready_to_apply' ||
      snap.state === 'apk_available' ||
      snap.state === 'apk_needs_permission' ||
      snap.state === 'apk_downloading' ||
      snap.state === 'windows_downloading' ||
      snap.state === 'windows_ready_to_restart');

  if (!shouldShow) return null;

  const isDownloading = snap.state === 'apk_downloading' || snap.state === 'windows_downloading';

  return (
    <div className="fixed top-[calc(max(env(safe-area-inset-top,12px),12px)+6px)] left-1/2 -translate-x-1/2 z-[95] w-[calc(100vw-24px)] max-w-md pointer-events-auto animate-fadeIn">
      <div className="rounded-2xl bg-[#0E1320]/95 border border-lumen-cyan/40 backdrop-blur-3xl shadow-[0_18px_50px_rgba(0,0,0,0.85),0_0_24px_rgba(99,232,255,0.25)] px-3.5 py-2.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-lumen-cyan/15 border border-lumen-cyan/35 flex items-center justify-center text-lumen-cyan shrink-0">
          {snap.state === 'apk_needs_permission' ? (
            <ShieldAlert className="w-4 h-4 text-amber-300" />
          ) : isDownloading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-xs font-extrabold text-white truncate">
            {snap.state === 'web_ready_to_apply' && 'Lumen Update Ready'}
            {snap.state === 'apk_available' && `Lumen v${snap.availableVersion || 'New'} Available`}
            {snap.state === 'apk_needs_permission' && 'Allow In-App Install'}
            {snap.state === 'apk_downloading' && `Downloading Update (${snap.percent}%)`}
            {snap.state === 'windows_downloading' && `Downloading v${snap.availableVersion || ''} (${snap.percent}%)`}
            {snap.state === 'windows_ready_to_restart' && `Lumen v${snap.availableVersion || ''} Ready`}
          </div>
          <div className="text-[10px] text-white/65 truncate">
            {snap.message || snap.releaseNotes || 'Tap to update automatically.'}
          </div>
          {isDownloading && (
            <div className="mt-1.5 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-lumen-cyan transition-all duration-300"
                style={{ width: `${Math.max(4, Math.min(100, snap.percent))}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {snap.state === 'web_ready_to_apply' && (
            <button
              type="button"
              onClick={() => OtaUpdateService.applyWebUpdateNow()}
              className="px-3 py-1.5 rounded-xl bg-lumen-cyan text-black text-[11px] font-extrabold shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              Apply Now
            </button>
          )}

          {(snap.state === 'apk_available' || snap.state === 'apk_needs_permission') && (
            <button
              type="button"
              onClick={() => OtaUpdateService.startApkInstall()}
              className="px-3 py-1.5 rounded-xl bg-lumen-cyan text-black text-[11px] font-extrabold shadow-md flex items-center gap-1 active:scale-95 transition-transform cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>{snap.state === 'apk_needs_permission' ? 'Install Now' : 'Update'}</span>
            </button>
          )}

          {snap.state === 'windows_ready_to_restart' && (
            <button
              type="button"
              onClick={() => OtaUpdateService.installWindowsUpdateNow()}
              className="px-3 py-1.5 rounded-xl bg-lumen-cyan text-black text-[11px] font-extrabold shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              Restart to Update
            </button>
          )}

          {!isDownloading && (
            <button
              type="button"
              onClick={() => OtaUpdateService.dismissBanner()}
              className="p-1.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Dismiss update banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
