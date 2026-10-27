import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Search, 
  Radio, 
  ShieldCheck, 
  SlidersHorizontal, 
  Sparkles, 
  Clock, 
  RefreshCw, 
  Disc3, 
  Cloud 
} from 'lucide-react';
import { Track } from '../../types/music';
import { StreamingService, STREAM_CATEGORIES } from '../../services/streamingService';

interface Props {
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onOpenConnectModal: () => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const StreamingView: React.FC<Props> = ({ onPlayTrack, onOpenConnectModal }) => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('trending');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Load trending or category tracks
  useEffect(() => {
    loadStreamTracks(selectedCategory);
  }, [selectedCategory]);

  const loadStreamTracks = async (category: string) => {
    setIsLoading(true);
    try {
      if (category === 'trending') {
        const res = await StreamingService.getTrendingTracks();
        setTracks(res);
      } else {
        const res = await StreamingService.getTracksByCategory(category);
        setTracks(res);
      }
    } catch (e) {
      console.warn('Load streams error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    try {
      const results = await StreamingService.searchCloudTracks(searchQuery);
      setTracks(results);
    } finally {
      setIsLoading(false);
    }
  };

  const heroTrack = tracks[0];

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 select-none">
      {/* 1. Header Banner & Storage Safety Status */}
      <div className="flex items-center justify-between border-b border-lumen-borderSubtle pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-lumen-surface border border-lumen-cyan/50 flex items-center justify-center text-lumen-cyan shadow-led-cyan">
              <Cloud className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-lumen-text font-mono">
              CLOUD STREAMING HUB
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
              IN-MEMORY BUFFER
            </span>
          </div>
          <p className="text-xs text-lumen-textMuted mt-1">
            Authorized open-licence cloud streaming. Plays directly in temporary memory with zero audio files saved to your disk.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* In-Memory Badge */}
          <div className="px-3 py-1.5 rounded-lg bg-lumen-panel border border-lumen-borderSubtle flex items-center gap-2 text-[11px] font-mono text-lumen-cyan">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>0 MB Saved to Hard Drive</span>
          </div>

          {/* Connect Provider Settings */}
          <button
            onClick={onOpenConnectModal}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-lumen-surface hover:bg-lumen-panelHover text-xs font-medium text-lumen-text border border-lumen-border hover:border-lumen-violet/60 transition-colors shadow-sm"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-lumen-violet" />
            <span>Provider Settings</span>
          </button>
        </div>
      </div>

      {/* 2. Search & Category Chips */}
      <div className="space-y-4">
        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-lumen-cyan" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search streamable open-licence music, artists, genres..."
            className="w-full pl-11 pr-24 py-3 bg-lumen-panel border border-lumen-border rounded-xl text-xs text-lumen-text placeholder-lumen-textDim focus:outline-none focus:border-lumen-cyan focus:shadow-led-cyan transition-all"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-lumen-surface hover:bg-lumen-cyan hover:text-lumen-bg rounded-lg text-xs font-medium text-lumen-cyan transition-all"
          >
            Search
          </button>
        </form>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('trending');
            }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-medium transition-all whitespace-nowrap ${
              selectedCategory === 'trending' && !searchQuery
                ? 'bg-lumen-cyan text-lumen-bg font-bold shadow-led-cyan'
                : 'bg-lumen-surface text-lumen-textMuted hover:text-lumen-text border border-lumen-borderSubtle'
            }`}
          >
            🔥 All Trending
          </button>

          {STREAM_CATEGORIES.map((cat: any) => (
            <button
              key={cat.id}
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory(cat.tag);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-medium transition-all whitespace-nowrap ${
                selectedCategory === cat.tag && !searchQuery
                  ? 'bg-lumen-cyan text-lumen-bg font-bold shadow-led-cyan'
                  : 'bg-lumen-surface text-lumen-textMuted hover:text-lumen-text border border-lumen-borderSubtle'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Hero Featured Stream */}
      {heroTrack && !searchQuery && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-lumen-panel via-lumen-surface to-lumen-panel border border-lumen-border p-6 shadow-panel">
          <div className="flex items-center gap-6 relative z-10">
            <div className="relative w-36 h-36 rounded-xl overflow-hidden bg-lumen-surface border border-lumen-border flex-shrink-0 shadow-led-cyan">
              {heroTrack.artworkUrl ? (
                <img src={heroTrack.artworkUrl} alt={heroTrack.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lumen-cyan">♪</div>
              )}
            </div>

            <div className="truncate flex-1 max-w-xl">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-lumen-cyan text-lumen-bg font-bold uppercase tracking-wider">
                FEATURED STREAM
              </span>
              <h3 className="text-xl font-bold text-lumen-text truncate mt-2">{heroTrack.title}</h3>
              <p className="text-sm text-lumen-cyan font-medium mt-0.5">{heroTrack.artist}</p>
              <p className="text-xs text-lumen-textMuted mt-1">
                Album: {heroTrack.album} • {heroTrack.genre} • High-Res Stream
              </p>

              <div className="mt-4 flex items-center gap-4">
                <button
                  onClick={() => onPlayTrack(heroTrack, tracks)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-lumen-cyan text-lumen-bg font-semibold text-xs shadow-led-cyan hover:scale-105 active:scale-95 transition-all"
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                  <span>Stream Now</span>
                </button>
                <span className="text-xs font-mono text-lumen-textDim">
                  {formatDuration(heroTrack.duration)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Streaming Tracks Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-lumen-text font-mono flex items-center gap-2">
            <Radio className="w-4 h-4 text-lumen-cyan" />
            <span>Available Streams ({tracks.length})</span>
          </h3>

          {isLoading && (
            <span className="text-xs font-mono text-lumen-cyan flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Buffering stream catalogue...
            </span>
          )}
        </div>

        {tracks.length === 0 && !isLoading ? (
          <div className="p-8 text-center text-xs text-lumen-textDim bg-lumen-panel/40 rounded-xl border border-lumen-borderSubtle">
            No streamable tracks found for this search. Try searching another keyword or choose a category above.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {tracks.map((track) => (
              <div
                key={track.id}
                onClick={() => onPlayTrack(track, tracks)}
                className="group p-3 rounded-xl bg-lumen-panel hover:bg-lumen-surface border border-lumen-borderSubtle hover:border-lumen-cyan/60 transition-all cursor-pointer shadow-sm hover:shadow-led-cyan"
              >
                <div className="relative aspect-square rounded-lg overflow-hidden bg-lumen-surface mb-2.5 border border-lumen-border">
                  {track.artworkUrl ? (
                    <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lumen-textDim">♪</div>
                  )}

                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-lumen-cyan text-lumen-bg flex items-center justify-center shadow-led-cyan">
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>

                <h4 className="text-xs font-semibold text-lumen-text truncate group-hover:text-lumen-cyan transition-colors" title={track.title}>
                  {track.title}
                </h4>
                <p className="text-[11px] text-lumen-textMuted truncate mt-0.5" title={track.artist}>
                  {track.artist}
                </p>

                <div className="flex items-center justify-between text-[10px] font-mono text-lumen-textDim mt-2 pt-2 border-t border-lumen-borderSubtle">
                  <span className="text-lumen-cyan truncate max-w-[80px]">{track.genre}</span>
                  <span>{formatDuration(track.duration)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
