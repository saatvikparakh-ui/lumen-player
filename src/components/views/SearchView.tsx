import React, { useState, useMemo } from 'react';
import { Search as SearchIcon, X, Play, Music, Disc3, User, Clock } from 'lucide-react';
import { Track, Album, Artist } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';

interface Props {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  onPlayTrack: (track: Track, queue?: Track[]) => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const SearchView: React.FC<Props> = ({ tracks, albums, artists, onPlayTrack }) => {
  const [query, setQuery] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<string>('ALL');

  const formats = ['ALL', 'FLAC', 'MP3', 'M4A', 'WAV', 'OGG'];

  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();

    let matchedTracks = tracks;
    if (selectedFormat !== 'ALL') {
      matchedTracks = matchedTracks.filter(t => (t.codec || '').toUpperCase().includes(selectedFormat));
    }

    if (!q) {
      return {
        tracks: matchedTracks.slice(0, 20),
        albums: albums.slice(0, 6),
        artists: artists.slice(0, 6)
      };
    }

    return {
      tracks: matchedTracks.filter(t => 
        t.title.toLowerCase().includes(q) || 
        t.artist.toLowerCase().includes(q) || 
        t.album.toLowerCase().includes(q)
      ),
      albums: albums.filter(a => 
        a.title.toLowerCase().includes(q) || 
        a.artist.toLowerCase().includes(q)
      ),
      artists: artists.filter(ar => 
        ar.name.toLowerCase().includes(q)
      )
    };
  }, [query, selectedFormat, tracks, albums, artists]);

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6 select-none">
      {/* Search Bar & Filters */}
      <div className="space-y-4 max-w-2xl">
        <div className="relative">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-lumen-cyan" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs, artists, albums, or genres..."
            className="w-full pl-12 pr-10 py-3.5 bg-lumen-panel border border-lumen-border rounded-xl text-sm text-lumen-text placeholder-lumen-textDim focus:outline-none focus:border-lumen-cyan focus:shadow-led-cyan transition-all"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-lumen-textMuted hover:text-lumen-text"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Format Filters */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase text-lumen-textDim mr-1">Format:</span>
          {formats.map((fmt) => (
            <button
              key={fmt}
              onClick={() => setSelectedFormat(fmt)}
              className={`px-3 py-1 rounded-full text-xs font-mono font-medium transition-all ${
                selectedFormat === fmt
                  ? 'bg-lumen-cyan text-lumen-bg font-bold shadow-led-cyan'
                  : 'bg-lumen-surface text-lumen-textMuted hover:text-lumen-text border border-lumen-borderSubtle'
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count Summary */}
      <div className="text-xs text-lumen-textDim font-mono">
        Showing {filteredResults.tracks.length} tracks • {filteredResults.albums.length} albums • {filteredResults.artists.length} artists
      </div>

      {/* Track Results */}
      <div>
        <h3 className="text-sm font-semibold text-lumen-text mb-3 flex items-center gap-2">
          <Music className="w-4 h-4 text-lumen-cyan" />
          <span>Songs</span>
        </h3>

        {filteredResults.tracks.length === 0 ? (
          <div className="p-6 text-center text-xs text-lumen-textDim bg-lumen-panel/40 rounded-xl border border-lumen-borderSubtle">
            No matching tracks found for "{query}".
          </div>
        ) : (
          <div className="bg-lumen-panel rounded-xl border border-lumen-border divide-y divide-lumen-borderSubtle overflow-hidden">
            {filteredResults.tracks.map((track, idx) => (
              <div
                key={track.id}
                onClick={() => onPlayTrack(track, filteredResults.tracks)}
                className="group flex items-center justify-between p-3 px-4 hover:bg-lumen-surface transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 truncate">
                  <div className="relative w-10 h-10 rounded bg-lumen-surface border border-lumen-border overflow-hidden flex-shrink-0">
                    {track.artworkUrl ? (
                      <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-lumen-textDim">♪</div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play className="w-4 h-4 text-lumen-cyan fill-current ml-0.5" />
                    </div>
                  </div>

                  <div className="truncate">
                    <p className="text-sm font-medium text-lumen-text group-hover:text-lumen-cyan transition-colors truncate">
                      {track.title}
                    </p>
                    <p className="text-xs text-lumen-textMuted truncate">
                      {track.artist} • <span className="text-lumen-textDim">{track.album}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono text-lumen-textMuted flex-shrink-0">
                  {track.codec && (
                    <span className="px-2 py-0.5 rounded bg-lumen-surface border border-lumen-border text-[10px] text-lumen-cyan">
                      {track.codec}
                    </span>
                  )}
                  <span className="w-12 text-right flex items-center justify-end gap-1">
                    <Clock className="w-3 h-3 text-lumen-textDim" />
                    {formatDuration(track.duration)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Albums Results */}
      {filteredResults.albums.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-lumen-text mb-3 flex items-center gap-2">
            <Disc3 className="w-4 h-4 text-lumen-violet" />
            <span>Matching Albums</span>
          </h3>

          <div className="grid grid-cols-6 gap-4">
            {filteredResults.albums.map((album) => (
              <div
                key={album.id}
                onClick={() => {
                  if (album.tracks.length > 0) {
                    onPlayTrack(album.tracks[0], album.tracks);
                  }
                }}
                className="p-3 rounded-xl bg-lumen-panel hover:bg-lumen-surface border border-lumen-borderSubtle transition-all cursor-pointer group"
              >
                <div className="aspect-square rounded-lg overflow-hidden bg-lumen-surface mb-2 border border-lumen-border">
                  {album.artworkUrl ? (
                    <img src={album.artworkUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lumen-textDim">♪</div>
                  )}
                </div>
                <p className="text-xs font-semibold text-lumen-text truncate">{album.title}</p>
                <p className="text-[11px] text-lumen-textMuted truncate">{album.artist}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
