import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Maximize2, 
  Minimize2, 
  BatteryCharging, 
  Disc3, 
  Sparkles, 
  X, 
  ListPlus, 
  Plus, 
  Clock 
} from 'lucide-react';
import { Album, Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { AudioVisualizer } from '../visualizer/AudioVisualizer';
import { extractDominantColor } from '../../services/colorSampler';

interface Props {
  albums: Album[];
  currentTrack: Track | null;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const MusicWallView: React.FC<Props> = ({ albums, currentTrack, onPlayTrack }) => {
  const [ambientMode, setAmbientMode] = useState(false);
  const [powerSaving, setPowerSaving] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [hoveredAlbumId, setHoveredAlbumId] = useState<string | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Dynamic 3D tilt perspective responding to cursor
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (powerSaving || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const rotateY = (x / (rect.width / 2)) * 3.5;
    const rotateX = -(y / (rect.height / 2)) * 3.5;
    setTilt({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`flex-1 overflow-y-auto select-none relative transition-all duration-500 ${
        ambientMode ? 'fixed inset-0 z-50 bg-[#06070B] p-8' : 'p-8'
      }`}
    >
      {/* Wall Header & Mode Toggles */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-lumen-borderSubtle relative z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-lumen-surface border border-lumen-cyan/50 flex items-center justify-center shadow-led-cyan">
            <Sparkles className="w-4 h-4 text-lumen-cyan" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-lumen-text font-mono">THE MUSIC WALL</h2>
            <p className="text-[11px] text-lumen-cyan font-mono">
              {albums.length} Floating Panels • 3D Reactive Canvas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Power Saving Toggle */}
          <button
            onClick={() => setPowerSaving(!powerSaving)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
              powerSaving
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                : 'bg-lumen-surface text-lumen-textMuted border-lumen-border hover:text-lumen-text'
            }`}
            title="Disable 3D tilt and animation for maximum power efficiency"
          >
            <BatteryCharging className="w-3.5 h-3.5" />
            <span>Power Saver: {powerSaving ? 'ON' : 'OFF'}</span>
          </button>

          {/* Ambient Full-screen Toggle */}
          <button
            onClick={() => setAmbientMode(!ambientMode)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-lumen-surface hover:bg-lumen-panelHover text-xs font-medium text-lumen-cyan border border-lumen-border hover:border-lumen-cyan shadow-sm transition-all"
          >
            {ambientMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{ambientMode ? 'Exit Ambient' : 'Ambient Full-Screen'}</span>
          </button>
        </div>
      </div>

      {/* 3D Perspective Gallery Wall */}
      <div 
        className="wall-perspective min-h-[500px]"
        style={{
          transform: powerSaving 
            ? 'none' 
            : `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: 'transform 0.15s ease-out'
        }}
      >
        {albums.length === 0 ? (
          <div className="h-96 flex flex-col items-center justify-center text-center p-8 text-lumen-textDim">
            <Disc3 className="w-16 h-16 opacity-30 text-lumen-cyan mb-3" />
            <p className="text-base font-semibold text-lumen-text">Your Music Wall is Empty</p>
            <p className="text-xs text-lumen-textMuted mt-1">Add local music folders to populate your floating 3D gallery.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {albums.map((album) => {
              const isPlayingAlbum = currentTrack?.album === album.title;
              const isHovered = hoveredAlbumId === album.id;

              return (
                <div
                  key={album.id}
                  onMouseEnter={() => setHoveredAlbumId(album.id)}
                  onMouseLeave={() => setHoveredAlbumId(null)}
                  onClick={() => setSelectedAlbum(album)}
                  className={`wall-card relative rounded-2xl bg-lumen-panel border cursor-pointer overflow-hidden group transition-all duration-300 ${
                    isPlayingAlbum
                      ? 'border-lumen-cyan shadow-led-cyan ring-1 ring-lumen-cyan/50'
                      : isHovered
                      ? 'border-lumen-cyan/60 shadow-led-cyan scale-105'
                      : 'border-lumen-border hover:border-lumen-borderSubtle'
                  }`}
                  style={{
                    transform: isHovered && !powerSaving ? 'translateZ(30px) scale(1.05)' : 'none'
                  }}
                >
                  {/* Album Cover Art */}
                  <div className="relative aspect-square w-full overflow-hidden bg-lumen-surface">
                    {album.artworkUrl ? (
                      <img 
                        src={album.artworkUrl} 
                        alt={album.title} 
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-lumen-textDim p-4">
                        <Disc3 className="w-12 h-12 text-lumen-cyan opacity-40 mb-1" />
                        <span className="text-[10px] font-mono uppercase tracking-wider">No Cover</span>
                      </div>
                    )}

                    {/* Hover Overlay with Quick Play Button */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 flex flex-col justify-end p-4 transition-opacity duration-200">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-lumen-cyan">
                          {album.trackCount} {album.trackCount === 1 ? 'Track' : 'Tracks'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (album.tracks.length > 0) {
                              onPlayTrack(album.tracks[0], album.tracks);
                            }
                          }}
                          className="w-10 h-10 rounded-full bg-lumen-cyan text-lumen-bg flex items-center justify-center shadow-led-cyan hover:scale-110 active:scale-95 transition-transform"
                          title="Play Album Now"
                        >
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Album Text Metadata */}
                  <div className="p-3 bg-lumen-panel border-t border-lumen-borderSubtle">
                    <h4 className="text-xs font-bold text-lumen-text truncate group-hover:text-lumen-cyan transition-colors" title={album.title}>
                      {album.title}
                    </h4>
                    <p className="text-[11px] text-lumen-textMuted truncate mt-0.5" title={album.artist}>
                      {album.artist}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Ambient Spectrum Visualizer Bar at the bottom of the Wall */}
      <div className="sticky bottom-0 left-0 right-0 h-12 mt-12 rounded-xl bg-lumen-panel/80 border border-lumen-border backdrop-blur-md px-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-lumen-cyan animate-pulse" />
          <span className="text-xs font-mono text-lumen-text">
            {currentTrack ? `${currentTrack.artist} — ${currentTrack.title}` : 'Ambient Wall Audio'}
          </span>
        </div>
        <div className="w-64 h-8">
          <AudioVisualizer mode="spectrum" sensitivity={1.1} powerSaving={powerSaving} />
        </div>
      </div>

      {/* Album Detail Modal / Inspector Drawer */}
      {selectedAlbum && (
        <div 
          onClick={() => setSelectedAlbum(null)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-6 animate-fadeIn"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[85vh] bg-lumen-panel border border-lumen-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-lumen-borderSubtle flex items-start gap-5 bg-lumen-surface/30">
              <div className="w-24 h-24 rounded-xl overflow-hidden bg-lumen-surface border border-lumen-border flex-shrink-0 shadow-led-cyan">
                {selectedAlbum.artworkUrl ? (
                  <img src={selectedAlbum.artworkUrl} alt={selectedAlbum.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-lumen-cyan">♪</div>
                )}
              </div>
              <div className="flex-1 truncate">
                <span className="text-[10px] font-mono uppercase tracking-wider text-lumen-cyan font-bold">Album</span>
                <h3 className="text-lg font-bold text-lumen-text truncate mt-0.5">{selectedAlbum.title}</h3>
                <p className="text-xs text-lumen-textMuted mt-1">{selectedAlbum.artist}</p>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={() => {
                      if (selectedAlbum.tracks.length > 0) {
                        onPlayTrack(selectedAlbum.tracks[0], selectedAlbum.tracks);
                        setSelectedAlbum(null);
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-lumen-cyan text-lumen-bg font-semibold text-xs shadow-led-cyan hover:scale-105 transition-all"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play All</span>
                  </button>
                  <span className="text-xs font-mono text-lumen-textDim">
                    {selectedAlbum.tracks.length} tracks
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedAlbum(null)}
                className="p-1.5 rounded-lg text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-surface"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Track List */}
            <div className="flex-1 overflow-y-auto p-4 divide-y divide-lumen-borderSubtle">
              {selectedAlbum.tracks.map((track, idx) => (
                <div
                  key={track.id}
                  onDoubleClick={() => {
                    onPlayTrack(track, selectedAlbum.tracks);
                    setSelectedAlbum(null);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-lumen-surface transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 truncate">
                    <span className="w-5 text-center text-xs font-mono text-lumen-textDim group-hover:text-lumen-cyan">
                      {track.trackNumber || idx + 1}
                    </span>
                    <span className="text-xs font-medium text-lumen-text group-hover:text-lumen-cyan transition-colors truncate">
                      {track.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono text-lumen-textMuted">
                    <span>{formatDuration(track.duration)}</span>
                    <button
                      onClick={() => {
                        onPlayTrack(track, selectedAlbum.tracks);
                        setSelectedAlbum(null);
                      }}
                      className="p-1 rounded text-lumen-cyan opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Play Track"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
