import React from 'react';
import { 
  Home, 
  Search, 
  Library, 
  Disc3, 
  Sliders, 
  Grid3X3, 
  Plus, 
  Heart, 
  FolderPlus, 
  Wifi,
  Sparkles
} from 'lucide-react';
import { ViewMode, Playlist } from '../../types/music';

interface Props {
  currentView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  playlists: Playlist[];
  onOpenAddFolder: () => void;
  onOpenCreatePlaylist: () => void;
  homeSharingActive?: boolean;
  folderCount: number;
}

export const Sidebar: React.FC<Props> = ({
  currentView,
  onSelectView,
  playlists,
  onOpenAddFolder,
  onOpenCreatePlaylist,
  homeSharingActive = true,
  folderCount
}) => {
  const navItems: { id: ViewMode; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'home', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { id: 'search', label: 'Search', icon: <Search className="w-5 h-5" /> },
    { id: 'library', label: 'Your Library', icon: <Library className="w-5 h-5" /> },
    { id: 'now-playing', label: 'Now Playing', icon: <Disc3 className="w-5 h-5" /> },
    { id: 'audio-lab', label: 'Audio Lab', icon: <Sliders className="w-5 h-5" />, badge: 'EQ' },
    { id: 'wall', label: 'Music Wall', icon: <Grid3X3 className="w-5 h-5 text-lumen-cyan" />, badge: '3D' }
  ];

  return (
    <aside className="w-64 h-full bg-lumen-panel flex flex-col border-r border-lumen-borderSubtle select-none">
      {/* Brand Header */}
      <div className="p-6 pb-4 flex items-center justify-between border-b border-lumen-borderSubtle">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-lumen-surface border border-lumen-border shadow-led-cyan">
            <Sparkles className="w-4 h-4 text-lumen-cyan" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-lumen-cyan shadow-led-cyan" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-lumen-text font-mono">LUMEN</h1>
            <p className="text-[10px] uppercase tracking-widest text-lumen-cyan">Hi-Fi Audio Gear</p>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectView(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-lumen-surface text-lumen-cyan shadow-led-cyan border border-lumen-border'
                  : 'text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-panelHover'
              }`}
            >
              <div className="flex items-center gap-3">
                {item.icon}
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  isActive
                    ? 'bg-lumen-cyan text-lumen-bg font-bold'
                    : 'bg-lumen-surface text-lumen-cyan border border-lumen-border'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Folders & Library Source */}
      <div className="px-4 py-3 border-t border-b border-lumen-borderSubtle bg-lumen-bg/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-lumen-textDim">Music Sources</span>
          <span className="text-xs font-mono text-lumen-cyan">{folderCount} Folders</span>
        </div>
        <button
          onClick={onOpenAddFolder}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-lumen-surface hover:bg-lumen-panelHover text-xs font-medium text-lumen-text border border-lumen-border hover:border-lumen-cyan/50 transition-colors shadow-sm"
        >
          <FolderPlus className="w-3.5 h-3.5 text-lumen-cyan" />
          <span>Add Music Folder</span>
        </button>
      </div>

      {/* Playlists */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-lumen-textDim">Playlists</span>
          <button
            onClick={onOpenCreatePlaylist}
            className="p-1 rounded text-lumen-textMuted hover:text-lumen-cyan hover:bg-lumen-surface transition-colors"
            title="Create Playlist"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => onSelectView('library')}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs text-left text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-panelHover transition-colors group"
          >
            <div className="w-6 h-6 rounded flex items-center justify-center bg-lumen-surface border border-lumen-border group-hover:border-lumen-violet/50">
              <Heart className="w-3 h-3 text-lumen-violet" />
            </div>
            <span className="truncate flex-1 font-medium">{pl.name}</span>
            <span className="text-[10px] font-mono text-lumen-textDim">{pl.trackIds.length}</span>
          </button>
        ))}
      </div>

      {/* Layer 2 Home Sharing Status Footer */}
      <div className="p-3 border-t border-lumen-borderSubtle bg-lumen-panel">
        <div className="p-2.5 rounded-lg bg-lumen-surface/60 border border-lumen-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-lumen-cyan animate-pulse" />
            <div>
              <p className="text-[11px] font-medium text-lumen-text">Layer 2 Ready</p>
              <p className="text-[9px] text-lumen-textMuted">Local Home Stream</p>
            </div>
          </div>
          <Wifi className="w-3.5 h-3.5 text-lumen-cyan" />
        </div>
      </div>
    </aside>
  );
};
