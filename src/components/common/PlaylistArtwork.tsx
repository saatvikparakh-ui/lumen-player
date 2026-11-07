import React from 'react';
import { Music } from 'lucide-react';
import { Track } from '../../types/music';
import { CoverImage } from './CoverImage';

interface Props {
  coverUrl?: string | null;
  name: string;
  tracks?: Track[];
  className?: string;
  size?: number;
  dominantColor?: string;
}

// Extracts first unicode emoji from a string if present (e.g. "Pineapple 🍍" -> "🍍")
function extractEmoji(str: string): string | null {
  if (!str) return null;
  const match = str.match(/(\p{Extended_Pictographic})/u);
  return match ? match[1] : null;
}

export const PlaylistArtwork: React.FC<Props> = ({
  coverUrl,
  name,
  tracks = [],
  className = 'w-full h-full',
  size = 300,
  dominantColor = '#63E8FF'
}) => {
  const emoji = extractEmoji(name);

  // 1. Explicit user-uploaded or user-chosen custom cover
  if (coverUrl && coverUrl !== 'mosaic' && coverUrl !== 'emoji') {
    return (
      <CoverImage 
        src={coverUrl} 
        alt={name} 
        title={name} 
        size={size} 
        className={`w-full h-full object-cover ${className}`} 
      />
    );
  }

  // 2. Collect unique valid artwork URLs from tracks
  const uniqueArts: string[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    if (t.artworkUrl && !seen.has(t.artworkUrl)) {
      seen.add(t.artworkUrl);
      uniqueArts.push(t.artworkUrl);
      if (uniqueArts.length >= 4) break;
    }
  }

  // 3. 4-Track Mosaic Collage (Standard Spotify / Apple Music playlist aesthetic)
  if (uniqueArts.length >= 4) {
    return (
      <div className={`grid grid-cols-2 grid-rows-2 w-full h-full overflow-hidden bg-black/80 select-none ${className}`}>
        {uniqueArts.slice(0, 4).map((art, idx) => (
          <div key={idx} className="w-full h-full overflow-hidden relative border-[0.5px] border-black/30">
            <img 
              src={art} 
              alt="" 
              className="w-full h-full object-cover" 
              loading="lazy" 
            />
          </div>
        ))}
      </div>
    );
  }

  // 4. Emoji Feature Card if name has emoji (e.g. "Pineapple 🍍")
  if (emoji) {
    const bgArt = uniqueArts[0] || null;
    return (
      <div 
        className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden select-none ${className}`}
        style={{
          background: `radial-gradient(circle at center, ${dominantColor}30, #080A10 80%)`
        }}
      >
        {bgArt && (
          <img 
            src={bgArt} 
            alt="" 
            className="absolute inset-0 w-full h-full object-cover opacity-25 blur-lg scale-110" 
          />
        )}
        <div className="relative z-10 flex flex-col items-center justify-center p-2 text-center">
          <span className="text-3xl sm:text-4xl drop-shadow-lg filter transform hover:scale-110 transition-transform">
            {emoji}
          </span>
          <span className="text-[10px] font-mono text-white/70 uppercase tracking-widest mt-1 font-bold truncate max-w-full px-2">
            {name.replace(emoji, '').trim()}
          </span>
        </div>
      </div>
    );
  }

  // 5. 1-3 tracks with artwork: single art with subtle playlist badge overlay
  if (uniqueArts.length > 0) {
    return (
      <div className={`w-full h-full relative overflow-hidden bg-black/80 ${className}`}>
        <img 
          src={uniqueArts[0]} 
          alt={name} 
          className="w-full h-full object-cover" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-2">
          <span className="text-[9px] font-mono text-white/80 uppercase tracking-wider font-semibold truncate">
            {name}
          </span>
        </div>
      </div>
    );
  }

  // 6. Default styled gradient with initials
  return (
    <div 
      className={`w-full h-full flex flex-col items-center justify-center p-4 text-center select-none text-white/70 ${className}`}
      style={{
        background: `radial-gradient(circle at top left, ${dominantColor}25, #080A10 70%)`
      }}
    >
      <Music className="w-8 h-8 mb-1.5 stroke-[1.5] text-white/50" />
      <span className="text-[10px] font-mono uppercase tracking-wider font-bold truncate max-w-full px-1">
        {name || 'Playlist'}
      </span>
    </div>
  );
};
