import React, { useRef, useState } from 'react';
import { 
  Play, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Sparkles, 
  Disc3, 
  Check, 
  Music,
  FolderHeart,
  TrendingUp,
  History,
  X
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../types/music';
import { PlaylistService } from '../../services/playlistService';
import { WatchSoundService } from '../../services/watchSoundService';
import { FloatingHomePlayer } from './FloatingHomePlayer';

interface Props {
  suggestedTracks: Track[];
  trendingTracks?: Track[];
  recentTracks?: Track[];
  genreMixTracks: Track[];
  playlists: CustomPlaylist[];
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onOpenPlaylist: (id: string) => void;
  onOpenTasteModal: () => void;
  onSelectArtist: (artist: string) => void;
  dominantColor: string;
  onHoverColorChange?: (color: string) => void;
  searchedArtist?: {
    name: string;
    avatarUrl?: string | null;
    genre?: string;
  } | null;
  onClearSearchedArtist?: () => void;
  currentTrack?: Track | null;
  isPlaying?: boolean;
  bassScale?: number;
  spectrumBars?: number[];
  onOpenPlayerView?: () => void;
  onToggleLyrics?: () => void;
}

interface ShelfProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tracks: Track[];
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  playlists: CustomPlaylist[];
  dominantColor: string;
  onSelectArtist: (artist: string) => void;
}

const HorizontalShelf: React.FC<ShelfProps> = ({
  title,
  subtitle,
  icon,
  tracks,
  onPlayTrack,
  playlists,
  dominantColor,
  onSelectArtist
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastTickScrollRef = useRef<number>(0);
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);
  const [playlistMenuTrack, setPlaylistMenuTrack] = useState<Track | null>(null);
  const [addedConfirm, setAddedConfirm] = useState<string | null>(null);

  // Wheel horizontal scroll with mechanical watch crown clicking sound
  const handleWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) > 5) {
      containerRef.current.scrollLeft += delta;
      const cur = containerRef.current.scrollLeft;
      if (Math.abs(cur - lastTickScrollRef.current) > 160) {
        WatchSoundService.playTick(0.85);
        lastTickScrollRef.current = cur;
      }
    }
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const cur = containerRef.current.scrollLeft;
    if (Math.abs(cur - lastTickScrollRef.current) > 160) {
      WatchSoundService.playTick(0.85);
      lastTickScrollRef.current = cur;
    }
  };

  // Mouse edge-scroll listener
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const edgeThreshold = 130;

    if (x < edgeThreshold) {
      const speed = ((edgeThreshold - x) / edgeThreshold) * 16;
      containerRef.current.scrollLeft -= speed;
      const cur = containerRef.current.scrollLeft;
      if (Math.abs(cur - lastTickScrollRef.current) > 160) {
        WatchSoundService.playTick(0.85);
        lastTickScrollRef.current = cur;
      }
    } else if (x > rect.width - edgeThreshold) {
      const speed = ((x - (rect.width - edgeThreshold)) / edgeThreshold) * 16;
      containerRef.current.scrollLeft += speed;
      const cur = containerRef.current.scrollLeft;
      if (Math.abs(cur - lastTickScrollRef.current) > 160) {
        WatchSoundService.playTick(0.85);
        lastTickScrollRef.current = cur;
      }
    }
  };

  const scrollBy = (amount: number) => {
    if (containerRef.current) {
      WatchSoundService.playTick(1.0);
      containerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  const handleAddToPlaylist = (playlistId: string, track: Track) => {
    const success = PlaylistService.addTrackToPlaylist(playlistId, track);
    setPlaylistMenuTrack(null);
    if (success) {
      setAddedConfirm(track.id);
      setTimeout(() => setAddedConfirm(null), 2000);
    }
  };

  if (!tracks || tracks.length === 0) return null;

  return (
    <div className="relative py-4">
      {/* Shelf Header */}
      <div className="flex items-center justify-between mb-3 px-4">
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <h3 className="text-lg sm:text-xl font-syne font-black text-white tracking-tight">{title}</h3>
            {subtitle && <p className="text-xs font-outfit text-white/60">{subtitle}</p>}
          </div>
        </div>

        {/* Scroll Arrows */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => scrollBy(-450)}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scrollBy(450)}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Ribbon with Edge-Scroll & Dynamic Album LED Halo */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onScroll={handleScroll}
        onMouseMove={handleMouseMove}
        className="flex gap-6 overflow-x-auto py-8 px-6 no-scrollbar scroll-smooth items-center"
      >
        {tracks.map((track) => {
          const isHovered = hoveredTrackId === track.id;

          return (
            <div
              key={track.id}
              onMouseEnter={() => setHoveredTrackId(track.id)}
              onMouseLeave={() => {
                setHoveredTrackId(null);
                if (playlistMenuTrack?.id === track.id) setPlaylistMenuTrack(null);
              }}
              className="relative flex-shrink-0 w-44 sm:w-52 transition-all duration-300 cursor-pointer"
              style={{
                transform: isHovered ? 'scale(1.20)' : 'scale(1.0)',
                zIndex: isHovered ? 30 : 10
              }}
              onClick={() => onPlayTrack(track, tracks)}
            >
              {/* 100% Square Album Cover surrounded by vibrant dynamic LED light ring */}
              <div
                className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black/90 border transition-all duration-300 shadow-2xl"
                style={{
                  borderColor: isHovered ? dominantColor : 'rgba(255, 255, 255, 0.15)',
                  boxShadow: isHovered
                    ? `0 25px 60px -10px ${dominantColor}90, 0 0 35px ${dominantColor}80, inset 0 0 15px ${dominantColor}50`
                    : `0 15px 30px -10px rgba(0, 0, 0, 0.8), 0 0 15px -5px ${dominantColor}25`
                }}
              >
                {track.artworkUrl ? (
                  <img
                    src={track.artworkUrl}
                    alt={track.title}
                    className="w-full h-full object-cover transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/30">
                    <Disc3 className="w-12 h-12" />
                  </div>
                )}

                {/* Hover Play Button Overlay */}
                <div 
                  className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-300 ${
                    isHovered ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold shadow-2xl transition-transform hover:scale-110"
                    style={{ backgroundColor: dominantColor }}
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </div>
                </div>

                {/* Add to Playlist '+' Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlaylistMenuTrack(playlistMenuTrack?.id === track.id ? null : track);
                  }}
                  className={`absolute top-2.5 right-2.5 p-1.5 rounded-full bg-black/70 border border-white/20 text-white/80 hover:text-white hover:bg-black transition-all ${
                    isHovered ? 'opacity-100' : 'opacity-0'
                  }`}
                  title="Add to Playlist"
                >
                  {addedConfirm === track.id ? (
                    <Check className="w-3.5 h-3.5 text-lumen-cyan stroke-[3]" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Playlist Picker Popup */}
                {playlistMenuTrack?.id === track.id && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-11 right-2 w-44 bg-black/95 border border-white/20 rounded-2xl p-2 z-40 shadow-2xl animate-fadeIn"
                  >
                    <span className="text-[10px] font-mono uppercase text-white/40 block px-2 py-1">
                      Add to Playlist
                    </span>
                    <div className="space-y-1 max-h-36 overflow-y-auto no-scrollbar">
                      {playlists.map(pl => (
                        <button
                          key={pl.id}
                          onClick={() => handleAddToPlaylist(pl.id, track)}
                          className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs text-white truncate flex items-center gap-1.5 transition-colors"
                        >
                          <FolderHeart className="w-3 h-3 text-lumen-cyan" />
                          <span className="truncate">{pl.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Title & Clickable Verified Artist */}
              <div className="mt-2.5 px-1">
                <h4 className="text-xs font-syne font-bold text-white truncate group-hover:text-lumen-cyan transition-colors" title={track.title}>
                  {track.title}
                </h4>
                <p 
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectArtist(track.artist);
                  }}
                  className="text-[11px] font-outfit text-white/60 truncate mt-0.5 hover:text-white hover:underline transition-colors" 
                  title={track.artist}
                >
                  {track.artist}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const HomeCarouselView: React.FC<Props> = ({
  suggestedTracks,
  trendingTracks = [],
  recentTracks = [],
  genreMixTracks,
  playlists,
  onPlayTrack,
  onOpenPlaylist,
  onOpenTasteModal,
  onSelectArtist,
  dominantColor,
  searchedArtist,
  onClearSearchedArtist,
  currentTrack,
  isPlaying = false,
  bassScale = 1,
  spectrumBars = [],
  onOpenPlayerView = () => {},
  onToggleLyrics = () => {}
}) => {
  return (
    <div className="relative w-full h-full overflow-y-auto px-4 sm:px-10 py-6 no-scrollbar space-y-6">
      {/* Floating Draggable & Resizable Liquid Glass Player Widget */}
      {currentTrack && (
        <FloatingHomePlayer
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          dominantColor={dominantColor}
          bassScale={bassScale}
          spectrumBars={spectrumBars}
          onSelectArtist={onSelectArtist}
          onOpenPlayerView={onOpenPlayerView}
          onToggleLyrics={onToggleLyrics}
        />
      )}

      {/* Dynamic Ambient Background Illumination */}
      <div 
        className="pointer-events-none fixed w-[700px] h-[700px] -top-20 -right-20 rounded-full blur-[180px] opacity-25 transition-all duration-1000 -z-10"
        style={{ backgroundColor: dominantColor }}
      />
      <div 
        className="pointer-events-none fixed w-[500px] h-[500px] bottom-10 -left-10 rounded-full blur-[160px] opacity-20 transition-all duration-1000 -z-10"
        style={{ backgroundColor: dominantColor }}
      />

      {/* Prominent Verified Artist Profile Banner when searching an artist */}
      {searchedArtist && (
        <div className="relative rounded-3xl p-6 sm:p-7 bg-gradient-to-r from-white/[0.09] via-white/[0.04] to-transparent border border-white/20 shadow-2xl backdrop-blur-2xl flex flex-col sm:flex-row items-center justify-between gap-5 overflow-hidden animate-fadeIn">
          {/* Ambient Glow */}
          <div 
            className="pointer-events-none absolute w-80 h-80 -top-20 -left-20 rounded-full blur-[100px] opacity-40"
            style={{ backgroundColor: dominantColor }}
          />

          <div className="flex items-center gap-5 relative z-10 w-full sm:w-auto">
            {searchedArtist.avatarUrl ? (
              <div 
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl flex-shrink-0"
                style={{ boxShadow: `0 12px 28px -6px ${dominantColor}50` }}
              >
                <img 
                  src={searchedArtist.avatarUrl} 
                  alt={searchedArtist.name} 
                  className="w-full h-full object-cover" 
                />
              </div>
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-lumen-cyan flex-shrink-0">
                <Disc3 className="w-8 h-8" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-widest text-lumen-cyan font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-lumen-cyan/10 border border-lumen-cyan/20">
                  <Check className="w-3 h-3 text-lumen-cyan stroke-[3]" />
                  Verified Artist
                </span>
                {searchedArtist.genre && (
                  <span className="text-[10px] font-mono text-white/50 uppercase truncate">
                    • {searchedArtist.genre}
                  </span>
                )}
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight truncate">
                {searchedArtist.name}
              </h2>
              <p className="text-xs text-white/60 font-outfit mt-0.5">
                Full official studio discography & verified releases
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 relative z-10 w-full sm:w-auto justify-end">
            <button
              onClick={() => onSelectArtist(searchedArtist.name)}
              className="px-6 py-2.5 rounded-full font-bold text-xs text-black transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2 shadow-xl"
              style={{
                backgroundColor: dominantColor || '#00f2fe',
                boxShadow: `0 8px 24px -4px ${dominantColor || '#00f2fe'}66`
              }}
            >
              <span>View Full Discography</span>
              <ChevronRight className="w-4 h-4" />
            </button>
            {onClearSearchedArtist && (
              <button
                onClick={onClearSearchedArtist}
                className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 1. Suggested / Quick Mix Shelf */}
      <HorizontalShelf
        title={searchedArtist ? `Songs by ${searchedArtist.name}` : "Personalized Quick Mix"}
        subtitle={searchedArtist ? "Verified studio recordings" : "Curated from your favorite verified artists & listening history"}
        icon={<Sparkles className="w-5 h-5 text-lumen-cyan" />}
        tracks={suggestedTracks}
        onPlayTrack={onPlayTrack}
        playlists={playlists}
        dominantColor={dominantColor}
        onSelectArtist={onSelectArtist}
      />

      {/* 2. Trending Worldwide Hits Shelf */}
      {trendingTracks.length > 0 && (
        <HorizontalShelf
          title="Trending Global Hits"
          subtitle="Top viral and chart-topping verified releases worldwide"
          icon={<TrendingUp className="w-5 h-5 text-rose-400" />}
          tracks={trendingTracks}
          onPlayTrack={onPlayTrack}
          playlists={playlists}
          dominantColor={dominantColor}
          onSelectArtist={onSelectArtist}
        />
      )}

      {/* 3. Recently Played Shelf (if history available) */}
      {recentTracks.length > 0 && (
        <HorizontalShelf
          title="Recently Played"
          subtitle="Jump right back into your recent audio sessions"
          icon={<History className="w-5 h-5 text-amber-400" />}
          tracks={recentTracks}
          onPlayTrack={onPlayTrack}
          playlists={playlists}
          dominantColor={dominantColor}
          onSelectArtist={onSelectArtist}
        />
      )}

      {/* 4. Custom User Playlists Ribbon */}
      {playlists.length > 0 && (
        <div className="py-4 px-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <FolderHeart className="w-5 h-5 text-lumen-violet" />
              <div>
                <h3 className="text-lg sm:text-xl font-syne font-black text-white tracking-tight">Your Playlists</h3>
                <p className="text-xs font-outfit text-white/60">Custom collections with editable covers & titles</p>
              </div>
            </div>
          </div>

          <div 
            onWheel={(e) => {
              const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
              if (Math.abs(delta) > 5) {
                e.currentTarget.scrollLeft += delta;
                WatchSoundService.playTick(0.8);
              }
            }}
            className="flex gap-5 overflow-x-auto py-4 no-scrollbar scroll-smooth"
          >
            {playlists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => onOpenPlaylist(pl.id)}
                className="flex-shrink-0 w-44 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all cursor-pointer group hover:scale-105"
              >
                <div 
                  className="aspect-square w-full rounded-xl overflow-hidden mb-2.5 shadow-lg relative flex items-center justify-center"
                  style={{ backgroundColor: pl.coverColor || dominantColor }}
                >
                  {pl.coverUrl ? (
                    <img src={pl.coverUrl} alt={pl.name} className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-10 h-10 text-white/80" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Play className="w-6 h-6 fill-white text-white ml-0.5" />
                  </div>
                </div>
                <h4 className="text-xs font-syne font-bold text-white truncate">{pl.name}</h4>
                <p className="text-[10px] text-white/50 font-mono mt-0.5">{pl.tracks.length} tracks</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Genre Mixes Shelf */}
      <HorizontalShelf
        title="Genre Mixes"
        subtitle="Hits tuned to your selected genres"
        icon={<Music className="w-5 h-5 text-emerald-400" />}
        tracks={genreMixTracks}
        onPlayTrack={onPlayTrack}
        playlists={playlists}
        dominantColor={dominantColor}
        onSelectArtist={onSelectArtist}
      />
    </div>
  );
};
