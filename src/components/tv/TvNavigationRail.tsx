import React, { useEffect, useState } from 'react';
import { Home, Search, ListMusic, Music2, Mic2, Settings, Tv } from 'lucide-react';
import { AudioEngine } from '../../services/audioEngine';

interface TvNavigationRailProps {
  currentView: 'home' | 'player' | 'playlist' | 'search';
  onNavigate: (view: 'home' | 'player' | 'playlist' | 'search') => void;
  onOpenSettings: () => void;
  onExitTvMode?: () => void;
  dominantColor?: string;
}

export const TvNavigationRail: React.FC<TvNavigationRailProps> = ({
  currentView,
  onNavigate,
  onOpenSettings,
  onExitTvMode,
  dominantColor = '#63E8FF'
}) => {
  const [isKaraokeActive, setIsKaraokeActive] = useState<boolean>(() => AudioEngine.isKaraokeEnabled());

  useEffect(() => {
    const unsub = AudioEngine.onKaraokeChange((enabled) => {
      setIsKaraokeActive(enabled);
    });
    return unsub;
  }, []);

  const handleToggleKaraoke = () => {
    const next = AudioEngine.toggleKaraoke();
    setIsKaraokeActive(next);
  };

  const navItems = [
    { id: 'home' as const, label: 'Home', icon: Home },
    { id: 'search' as const, label: 'Search', icon: Search },
    { id: 'playlist' as const, label: 'Playlists', icon: ListMusic },
    { id: 'player' as const, label: 'Now Playing', icon: Music2 },
  ];

  return (
    <aside 
      className="fixed left-0 top-0 bottom-0 w-24 md:w-28 z-40 bg-black/85 backdrop-blur-3xl border-r border-white/10 flex flex-col items-center py-8 select-none transition-all duration-300 shadow-2xl"
      role="navigation"
      aria-label="TV Navigation Rail"
    >
      {/* Brand TV Disc Emblem */}
      <div 
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-8 border border-white/20 shadow-lg cursor-pointer transition-transform hover:scale-105 active:scale-95"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${dominantColor}60, #0A0D14)`,
          boxShadow: `0 0 25px ${dominantColor}40`
        }}
        onClick={() => onNavigate('home')}
        title="Lumen TV"
      >
        <Tv className="w-7 h-7 text-white" />
      </div>

      {/* Main Navigation Items */}
      <div className="flex-1 flex flex-col items-center gap-5 w-full px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              tabIndex={0}
              onClick={() => onNavigate(item.id)}
              className={`group w-full py-3.5 px-2 rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-110 focus:shadow-[0_0_30px_#63E8FF] ${
                isActive
                  ? 'bg-white/15 text-white font-bold shadow-xl border border-white/20'
                  : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
              style={
                isActive
                  ? {
                      borderColor: `${dominantColor}80`,
                      boxShadow: `0 0 20px ${dominantColor}35`
                    }
                  : undefined
              }
              title={item.label}
            >
              <Icon 
                className={`w-7 h-7 transition-colors ${
                  isActive ? 'text-white' : 'group-hover:text-white'
                }`}
                style={isActive ? { color: dominantColor } : undefined}
              />
              <span className="text-[11px] font-syne tracking-wide text-center">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bottom Actions: Karaoke Toggle & Settings */}
      <div className="flex flex-col items-center gap-4 w-full px-3 pt-4 border-t border-white/10">
        {/* Karaoke Mic Button */}
        <button
          tabIndex={0}
          onClick={handleToggleKaraoke}
          className={`group w-full py-3 px-2 rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-110 focus:shadow-[0_0_30px_#63E8FF] ${
            isKaraokeActive
              ? 'bg-gradient-to-r from-emerald-500/30 to-teal-500/30 text-emerald-300 border border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.4)] animate-pulse'
              : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
          title={isKaraokeActive ? 'Karaoke ON (Vocals Reduced)' : 'Turn On Karaoke'}
        >
          <Mic2 className={`w-6 h-6 ${isKaraokeActive ? 'text-emerald-300' : ''}`} />
          <span className="text-[10px] font-syne font-bold uppercase tracking-wider">
            {isKaraokeActive ? 'Karaoke ON' : 'Karaoke'}
          </span>
        </button>

        {/* Settings Hub */}
        <button
          tabIndex={0}
          onClick={onOpenSettings}
          className="w-full py-3 px-2 rounded-2xl flex flex-col items-center justify-center gap-1 text-white/50 hover:text-white hover:bg-white/5 border border-transparent transition-all cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan focus:scale-110 focus:shadow-[0_0_30px_#63E8FF]"
          title="Settings"
        >
          <Settings className="w-6 h-6" />
          <span className="text-[10px] font-syne">Settings</span>
        </button>

        {/* Exit TV Mode / Switch to Desktop/Mobile */}
        {onExitTvMode && (
          <button
            tabIndex={0}
            onClick={onExitTvMode}
            className="w-full py-2 px-1 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/5 text-[10px] font-mono transition-all text-center focus:outline-none focus:ring-2 focus:ring-white/40"
            title="Exit TV Mode"
          >
            Exit TV
          </button>
        )}
      </div>
    </aside>
  );
};
