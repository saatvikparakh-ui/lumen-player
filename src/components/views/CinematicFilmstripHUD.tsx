import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  X, 
  Play, 
  Disc3, 
  FolderPlus, 
  RefreshCw, 
  Music, 
  Radio, 
  ChevronLeft, 
  ChevronRight,
  Flame,
  Sparkles,
  Link2
} from 'lucide-react';
import { Track, Album, AppMode } from '../../types/music';
import { StreamingService, STREAM_CATEGORIES } from '../../services/streamingService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  appMode: AppMode;
  tracks: Track[];
  albums: Album[];
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onOpenAddFolder: () => void;
  onRescan: () => void;
  isScanning: boolean;
  dominantColor: string;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const CinematicFilmstripHUD: React.FC<Props> = ({
  isOpen,
  onClose,
  appMode,
  tracks,
  albums,
  onPlayTrack,
  onOpenAddFolder,
  onRescan,
  isScanning,
  dominantColor
}) => {
  if (!isOpen) return null;

  const [query, setQuery] = useState('');
  const [cloudCategory, setCloudCategory] = useState('trending');
  const [cloudTracks, setCloudTracks] = useState<Track[]>([]);
  const [isSearchingCloud, setIsSearchingCloud] = useState(false);
  const [pasteLink, setPasteLink] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const filmstripRef = useRef<HTMLDivElement | null>(null);

  // Load trending global tracks on open if in streaming mode
  useEffect(() => {
    if (appMode === 'streaming' && cloudTracks.length === 0) {
      setIsSearchingCloud(true);
      StreamingService.getTrendingTracks()
        .then((res) => {
          setCloudTracks(res);
        })
        .finally(() => setIsSearchingCloud(false));
    }
  }, [appMode, cloudTracks.length]);

  // Filter local albums/tracks
  const filteredAlbums = albums.filter(a => 
    !query.trim() || 
    a.title.toLowerCase().includes(query.toLowerCase()) || 
    a.artist.toLowerCase().includes(query.toLowerCase())
  );

  const scrollFilmstrip = (direction: 'left' | 'right') => {
    if (!filmstripRef.current) return;
    const offset = direction === 'left' ? -480 : 480;
    filmstripRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const handleCloudSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearchingCloud(true);
    try {
      const res = await StreamingService.searchGlobalMusic(query);
      setCloudTracks(res);
    } finally {
      setIsSearchingCloud(false);
    }
  };

  const handleCategorySelect = async (tag: string) => {
    setCloudCategory(tag);
    setIsSearchingCloud(true);
    try {
      const res = await StreamingService.getTracksByCategory(tag);
      setCloudTracks(res);
    } finally {
      setIsSearchingCloud(false);
    }
  };

  const handleImportLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteLink.trim()) return;

    setIsImporting(true);
    try {
      const res = await StreamingService.searchGlobalMusic(pasteLink.trim());
      if (res.length > 0) {
        onPlayTrack(res[0], res);
        setPasteLink('');
        onClose();
      }
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/85 backdrop-blur-2xl flex flex-col justify-center p-6 sm:p-12 select-none animate-fadeIn"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl mx-auto flex flex-col max-h-[85vh] bg-black/75 border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden"
        style={{
          boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 35px -10px ${dominantColor}50`
        }}
      >
        {/* HUD Top Bar: Search, Category Pills & Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-white/10">
          {/* Universal Search Input */}
          <form onSubmit={handleCloudSearch} className="relative w-full sm:w-96">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={appMode === 'local' ? "Filter local collection..." : "Search 100M+ songs worldwide..."}
              className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/15 rounded-full text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40 transition-all"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </form>

          {/* Local Controls vs Cloud Category Pills */}
          <div className="flex items-center gap-3">
            {appMode === 'local' ? (
              <>
                <button
                  onClick={onOpenAddFolder}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs text-white transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-lumen-cyan" />
                  <span>Add Folder</span>
                </button>
                <button
                  onClick={onRescan}
                  disabled={isScanning}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs text-white transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                  <span>{isScanning ? 'Scanning...' : 'Rescan'}</span>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-md">
                {STREAM_CATEGORIES.map((cat: any) => (
                  <button
                    key={cat.id}
                    onClick={() => handleCategorySelect(cat.tag)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all whitespace-nowrap flex items-center gap-1.5 ${
                      cloudCategory === cat.tag
                        ? 'bg-white/25 text-white font-bold border border-white/30'
                        : 'bg-white/5 text-white/50 hover:text-white border border-white/10'
                    }`}
                  >
                    {cat.id === 'trending' && <Flame className="w-3 h-3 text-amber-400" />}
                    <span>{cat.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors ml-2"
              title="Close HUD (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 
          CINEMATIC HORIZONTAL FILMSTRIP RIBBON
        */}
        <div className="flex-1 overflow-hidden flex flex-col pt-6">
          <div className="flex items-center justify-between mb-4 px-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tracking-widest uppercase text-white/70 font-bold">
                {appMode === 'local' 
                  ? `Your Albums (${filteredAlbums.length})` 
                  : `${cloudCategory.toUpperCase()} • 100M+ GLOBAL RELEASES`}
              </span>
              {appMode === 'streaming' && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-lumen-cyan/15 text-lumen-cyan border border-lumen-cyan/25">
                  OPUS 48kHz • Hi-Fi
                </span>
              )}
            </div>

            {/* Scroll navigation arrows */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => scrollFilmstrip('left')}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                title="Scroll Left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => scrollFilmstrip('right')}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                title="Scroll Right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* The Horizontal Scrolling Ribbon */}
          <div
            ref={filmstripRef}
            className="flex-1 overflow-x-auto flex gap-6 pb-6 px-2 scroll-smooth no-scrollbar items-center"
          >
            {isSearchingCloud ? (
              <div className="w-full text-center py-16 flex flex-col items-center justify-center text-white/50">
                <RefreshCw className="w-8 h-8 animate-spin text-lumen-cyan mb-2" />
                <span className="text-xs font-mono">Fetching high-fidelity audio streams...</span>
              </div>
            ) : appMode === 'local' ? (
              filteredAlbums.length === 0 ? (
                <div className="w-full text-center py-12 text-white/40 text-xs">
                  No local albums found. Click "Add Folder" to index music from your drive.
                </div>
              ) : (
                filteredAlbums.map((album) => (
                  <div
                    key={album.id}
                    onClick={() => {
                      if (album.tracks.length > 0) {
                        onPlayTrack(album.tracks[0], album.tracks);
                        onClose();
                      }
                    }}
                    className="flex-shrink-0 w-48 sm:w-56 group cursor-pointer transition-all duration-300 hover:scale-105"
                  >
                    {/* Album Art with Glowing Halo */}
                    <div 
                      className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black/60 border border-white/15 mb-3 transition-shadow duration-500"
                      style={{
                        boxShadow: `0 15px 35px -10px rgba(0, 0, 0, 0.9), 0 0 20px -5px ${dominantColor}50`
                      }}
                    >
                      {album.artworkUrl ? (
                        <img 
                          src={album.artworkUrl} 
                          alt={album.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-white/30">
                          <Disc3 className="w-12 h-12 mb-1" />
                          <span className="text-[10px] font-mono">NO ART</span>
                        </div>
                      )}

                      {/* Play Hover Overlay */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <div 
                          className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold shadow-lg"
                          style={{ backgroundColor: dominantColor }}
                        >
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>

                    <h4 className="text-xs font-bold text-white truncate group-hover:text-lumen-cyan transition-colors" title={album.title}>
                      {album.title}
                    </h4>
                    <p className="text-[11px] text-white/60 truncate mt-0.5" title={album.artist}>
                      {album.artist}
                    </p>
                    <span className="text-[10px] font-mono text-white/40 block mt-1">
                      {album.trackCount} {album.trackCount === 1 ? 'track' : 'tracks'}
                    </span>
                  </div>
                ))
              )
            ) : (
              (cloudTracks.length > 0 ? cloudTracks : tracks.filter(t => t.isStream)).map((track) => (
                <div
                  key={track.id}
                  onClick={() => {
                    onPlayTrack(track, cloudTracks);
                    onClose();
                  }}
                  className="flex-shrink-0 w-48 sm:w-56 group cursor-pointer transition-all duration-300 hover:scale-105"
                >
                  <div 
                    className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black/60 border border-white/15 mb-3 transition-shadow duration-500"
                    style={{
                      boxShadow: `0 15px 35px -10px rgba(0, 0, 0, 0.9), 0 0 20px -5px ${dominantColor}50`
                    }}
                  >
                    {track.artworkUrl ? (
                      <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/30">♪</div>
                    )}

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <div 
                        className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold shadow-lg"
                        style={{ backgroundColor: dominantColor }}
                      >
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <h4 className="text-xs font-bold text-white truncate" title={track.title}>{track.title}</h4>
                  <p className="text-[11px] text-white/60 truncate mt-0.5" title={track.artist}>{track.artist}</p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-white/40 mt-1">
                    <span className="text-lumen-cyan">OPUS 48kHz</span>
                    <span>{formatDuration(track.duration)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
