import React from 'react';
import { Play, Sparkles, FolderPlus, Grid3X3, Disc3, ShieldCheck, Music2 } from 'lucide-react';
import { Track, Album, ViewMode } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { getDemoTrack } from '../../services/demoTrack';

interface Props {
  tracks: Track[];
  albums: Album[];
  onSelectView: (view: ViewMode) => void;
  onOpenAddFolder: () => void;
  onPlayTrack: (track: Track) => void;
}

export const HomeView: React.FC<Props> = ({
  tracks,
  albums,
  onSelectView,
  onOpenAddFolder,
  onPlayTrack
}) => {
  const handlePlayDemo = () => {
    const demo = getDemoTrack();
    onPlayTrack(demo);
  };

  const recentAlbums = albums.slice(0, 6);

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 select-none">
      {/* 1. Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-lumen-panel via-lumen-surface to-lumen-panel border border-lumen-border p-8 shadow-panel">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full bg-lumen-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 -mb-16 w-60 h-60 rounded-full bg-lumen-violet/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lumen-surface border border-lumen-cyan/40 shadow-led-cyan text-xs font-mono text-lumen-cyan mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Pure Sound • Zero Bloatware • 100% Local</span>
          </div>

          <h1 className="text-3xl font-extrabold text-lumen-text tracking-tight font-sans">
            Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-lumen-cyan to-lumen-violet">LUMEN</span>
          </h1>

          <p className="mt-3 text-sm text-lumen-textMuted leading-relaxed">
            Your high-end personal music system. Plays all audio locally from your computer with tactile 10-band DSP controls, real-time audio visualization, synchronized lyrics, and the 3D Music Wall.
          </p>

          <div className="mt-6 flex items-center gap-4">
            <button
              onClick={handlePlayDemo}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-lumen-cyan text-lumen-bg font-semibold text-sm hover:scale-105 active:scale-95 shadow-led-cyan transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Play Ambient Demo</span>
            </button>

            <button
              onClick={onOpenAddFolder}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-lumen-surface hover:bg-lumen-panelHover text-lumen-text font-medium text-sm border border-lumen-border hover:border-lumen-cyan/50 transition-colors"
            >
              <FolderPlus className="w-4 h-4 text-lumen-cyan" />
              <span>Select Music Folder</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Interactive Music Wall Teaser Card */}
      <div 
        onClick={() => onSelectView('wall')}
        className="group relative rounded-2xl bg-gradient-to-br from-lumen-surface/80 to-lumen-panel border border-lumen-border hover:border-lumen-cyan/60 p-6 cursor-pointer transition-all duration-300 shadow-panel hover:shadow-led-cyan"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-lumen-panel border border-lumen-cyan/40 flex items-center justify-center shadow-led-cyan group-hover:scale-110 transition-transform">
              <Grid3X3 className="w-6 h-6 text-lumen-cyan" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-lumen-text group-hover:text-lumen-cyan transition-colors">
                  The 3D Music Wall
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-lumen-cyan text-lumen-bg font-bold">
                  Ambient Mode
                </span>
              </div>
              <p className="text-xs text-lumen-textMuted mt-1">
                Experience your album covers as a reactive floating 3D neon gallery with depth perspective and color-sampled ambient lighting.
              </p>
            </div>
          </div>
          <button className="px-4 py-2 rounded-lg bg-lumen-surface border border-lumen-border group-hover:bg-lumen-cyan group-hover:text-lumen-bg group-hover:font-semibold text-xs text-lumen-cyan transition-all">
            Launch Wall →
          </button>
        </div>
      </div>

      {/* 3. System Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-lumen-panel border border-lumen-borderSubtle">
          <span className="text-[11px] font-mono uppercase text-lumen-textDim">Tracks Indexed</span>
          <p className="text-2xl font-bold font-mono text-lumen-cyan mt-1">{tracks.length}</p>
        </div>
        <div className="p-4 rounded-xl bg-lumen-panel border border-lumen-borderSubtle">
          <span className="text-[11px] font-mono uppercase text-lumen-textDim">Albums</span>
          <p className="text-2xl font-bold font-mono text-lumen-violet mt-1">{albums.length}</p>
        </div>
        <div className="p-4 rounded-xl bg-lumen-panel border border-lumen-borderSubtle">
          <span className="text-[11px] font-mono uppercase text-lumen-textDim">Audio Engine</span>
          <p className="text-sm font-semibold text-lumen-text mt-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-lumen-cyan" />
            10-Band DSP Active
          </p>
        </div>
        <div className="p-4 rounded-xl bg-lumen-panel border border-lumen-borderSubtle">
          <span className="text-[11px] font-mono uppercase text-lumen-textDim">Privacy</span>
          <p className="text-sm font-semibold text-lumen-text mt-2 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            100% Offline
          </p>
        </div>
      </div>

      {/* 4. Recently Added / Albums Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-lumen-text">Your Music Collection</h2>
          <button 
            onClick={() => onSelectView('library')}
            className="text-xs text-lumen-cyan hover:underline font-medium"
          >
            View All ({albums.length})
          </button>
        </div>

        {recentAlbums.length === 0 ? (
          <div className="rounded-xl border border-dashed border-lumen-border p-8 text-center bg-lumen-panel/40">
            <Disc3 className="w-10 h-10 text-lumen-textDim mx-auto mb-3" />
            <p className="text-sm text-lumen-text">No local music loaded yet</p>
            <p className="text-xs text-lumen-textMuted mt-1 mb-4">
              Click below to select a folder on your drive containing MP3, FLAC, WAV, or M4A files.
            </p>
            <button
              onClick={onOpenAddFolder}
              className="px-4 py-2 rounded-lg bg-lumen-surface border border-lumen-border hover:border-lumen-cyan text-xs font-semibold text-lumen-cyan transition-colors"
            >
              Add Music Folder
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-4">
            {recentAlbums.map((album) => (
              <div
                key={album.id}
                onClick={() => {
                  if (album.tracks.length > 0) {
                    AudioEngine.playTrack(album.tracks[0], album.tracks);
                  }
                }}
                className="group p-3 rounded-xl bg-lumen-panel hover:bg-lumen-surface border border-lumen-borderSubtle hover:border-lumen-border transition-all cursor-pointer shadow-sm hover:shadow-panel"
              >
                <div className="relative aspect-square rounded-lg overflow-hidden bg-lumen-surface mb-3 border border-lumen-borderSubtle">
                  {album.artworkUrl ? (
                    <img src={album.artworkUrl} alt={album.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lumen-textDim">
                      <Music2 className="w-8 h-8 opacity-40 text-lumen-cyan" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-lumen-cyan text-lumen-bg flex items-center justify-center shadow-led-cyan">
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>

                <h4 className="text-xs font-semibold text-lumen-text truncate" title={album.title}>
                  {album.title}
                </h4>
                <p className="text-[11px] text-lumen-textMuted truncate mt-0.5" title={album.artist}>
                  {album.artist}
                </p>
                <span className="text-[10px] font-mono text-lumen-textDim block mt-1">
                  {album.trackCount} {album.trackCount === 1 ? 'track' : 'tracks'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
