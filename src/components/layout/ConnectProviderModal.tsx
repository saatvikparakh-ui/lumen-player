import React, { useState } from 'react';
import { X, ShieldCheck, AlertCircle, Trash2, Key, CheckCircle, ExternalLink, Music } from 'lucide-react';
import { StreamingSource, ProviderConfig } from '../../types/music';
import { StreamingService } from '../../services/streamingService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCacheCleared: () => void;
}

export const ConnectProviderModal: React.FC<Props> = ({ isOpen, onClose, onCacheCleared }) => {
  if (!isOpen) return null;

  const currentConfig = StreamingService.getProviderConfig();
  const [activeSource, setActiveSource] = useState<StreamingSource>(currentConfig.activeSource);
  const [appleToken, setAppleToken] = useState(currentConfig.appleMusicToken || '');
  const [spotifyId, setSpotifyId] = useState(currentConfig.spotifyClientId || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = () => {
    StreamingService.saveProviderConfig({
      activeSource,
      appleMusicToken: appleToken.trim(),
      spotifyClientId: spotifyId.trim()
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1000);
  };

  const handleClearCache = () => {
    StreamingService.purgeArtworkCache();
    onCacheCleared();
    alert('Temporary streaming cache successfully cleared.');
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 select-none"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-lumen-panel border border-lumen-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-lumen-borderSubtle flex items-center justify-between bg-lumen-surface/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-lumen-surface border border-lumen-cyan/50 flex items-center justify-center text-lumen-cyan shadow-led-cyan">
              <Music className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-lumen-text font-mono">STREAMING PROVIDERS</h3>
              <p className="text-xs text-lumen-textMuted">Configure cloud catalogues & authorized accounts</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-surface"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* 1. Provider Source Selection */}
          <div className="space-y-3">
            <label className="text-xs font-mono uppercase tracking-wider text-lumen-textDim font-bold block">
              Active Streaming Source
            </label>

            {/* Option A: Open License (Default) */}
            <div 
              onClick={() => setActiveSource('open-license')}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeSource === 'open-license'
                  ? 'bg-lumen-surface border-lumen-cyan shadow-led-cyan'
                  : 'bg-lumen-panel border-lumen-borderSubtle hover:border-lumen-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    activeSource === 'open-license' ? 'border-lumen-cyan' : 'border-lumen-textDim'
                  }`}>
                    {activeSource === 'open-license' && <div className="w-2 h-2 rounded-full bg-lumen-cyan" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-lumen-text">Open-Licensed Streaming (Free)</h4>
                    <p className="text-xs text-lumen-textMuted mt-0.5">
                      Stream hundreds of thousands of independent tracks instantly with zero fees or accounts.
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono">
                  ACTIVE
                </span>
              </div>
              <div className="mt-3 pl-7 flex items-center gap-2 text-[11px] text-lumen-cyan font-mono">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Full 10-Band EQ & 3D Visualizer Support Enabled</span>
              </div>
            </div>

            {/* Option B: Apple MusicKit */}
            <div 
              onClick={() => setActiveSource('apple-music')}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeSource === 'apple-music'
                  ? 'bg-lumen-surface border-lumen-violet shadow-led-violet'
                  : 'bg-lumen-panel border-lumen-borderSubtle hover:border-lumen-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    activeSource === 'apple-music' ? 'border-lumen-violet' : 'border-lumen-textDim'
                  }`}>
                    {activeSource === 'apple-music' && <div className="w-2 h-2 rounded-full bg-lumen-violet" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-lumen-text">Apple MusicKit (Subscription)</h4>
                    <p className="text-xs text-lumen-textMuted mt-0.5">
                      Mainstream commercial catalogue. Requires your Apple Music subscription token.
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-lumen-surface border border-lumen-border text-[10px] font-mono text-lumen-textDim">
                  OFFICIAL API
                </span>
              </div>

              {activeSource === 'apple-music' && (
                <div className="mt-4 pl-7 space-y-2 animate-fadeIn">
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Apple Music uses FairPlay DRM encryption. Visualizers and raw EQ sliders are restricted by Apple's developer guidelines.
                    </span>
                  </div>
                  <input
                    type="text"
                    value={appleToken}
                    onChange={(e) => setAppleToken(e.target.value)}
                    placeholder="Enter Developer MusicKit User Token"
                    className="w-full px-3 py-2 bg-lumen-bg border border-lumen-border rounded-lg text-xs text-lumen-text font-mono focus:outline-none focus:border-lumen-violet"
                  />
                </div>
              )}
            </div>

            {/* Option C: Spotify Web Playback */}
            <div 
              onClick={() => setActiveSource('spotify')}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeSource === 'spotify'
                  ? 'bg-lumen-surface border-lumen-cyan shadow-led-cyan'
                  : 'bg-lumen-panel border-lumen-borderSubtle hover:border-lumen-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    activeSource === 'spotify' ? 'border-lumen-cyan' : 'border-lumen-textDim'
                  }`}>
                    {activeSource === 'spotify' && <div className="w-2 h-2 rounded-full bg-lumen-cyan" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-lumen-text">Spotify Web Playback SDK</h4>
                    <p className="text-xs text-lumen-textMuted mt-0.5">
                      Commercial catalogue for active Spotify Premium account holders.
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-lumen-surface border border-lumen-border text-[10px] font-mono text-lumen-textDim">
                  PREMIUM
                </span>
              </div>

              {activeSource === 'spotify' && (
                <div className="mt-4 pl-7 space-y-2 animate-fadeIn">
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Spotify restricts direct PCM audio extraction. Stream playback controls are delegated to official Spotify player devices.
                    </span>
                  </div>
                  <input
                    type="text"
                    value={spotifyId}
                    onChange={(e) => setSpotifyId(e.target.value)}
                    placeholder="Enter Spotify Client ID"
                    className="w-full px-3 py-2 bg-lumen-bg border border-lumen-border rounded-lg text-xs text-lumen-text font-mono focus:outline-none focus:border-lumen-cyan"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 2. Buffer & Storage Limits */}
          <div className="p-4 rounded-xl bg-lumen-surface/40 border border-lumen-border flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-lumen-text">In-Memory Audio Buffer</h4>
              <p className="text-[11px] text-lumen-textMuted mt-0.5">
                Streaming audio chunks are purged as they finish playing. Capped 50MB artwork thumbnail limit.
              </p>
            </div>
            <button
              onClick={handleClearCache}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lumen-surface hover:bg-lumen-panelHover text-xs text-lumen-textDim hover:text-red-400 border border-lumen-border transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge Cache</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-lumen-borderSubtle bg-lumen-surface/30 flex items-center justify-between">
          <div className="text-xs text-emerald-400 flex items-center gap-1.5">
            {savedSuccess && (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Configuration Saved!</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-lumen-textMuted hover:text-lumen-text"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-lumen-cyan text-lumen-bg font-semibold text-xs shadow-led-cyan hover:scale-105 active:scale-95 transition-all"
            >
              Apply Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
