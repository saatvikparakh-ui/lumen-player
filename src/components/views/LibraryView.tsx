import React, { useState } from 'react';
import { Disc3, User, Music, Folder, Play, RefreshCw, Clock, Sparkles } from 'lucide-react';
import { Track, Album, Artist, Playlist } from '../../types/music';

interface Props {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onRescan: () => void;
  isScanning: boolean;
}

type TabType = 'albums' | 'artists' | 'tracks' | 'playlists';

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const LibraryView: React.FC<Props> = ({
  tracks,
  albums,
  artists,
  playlists,
  onPlayTrack,
  onRescan,
  isScanning
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('albums');
  const [sortBy, setSortBy] = useState<'title' | 'artist' | 'year' | 'tracks'>('title');

  const sortedAlbums = [...albums].sort((a, b) => {
    if (sortBy === 'title') return a.title.localeCompare(b.title);
    if (sortBy === 'artist') return a.artist.localeCompare(b.artist);
    if (sortBy === 'year') return (b.year || 0) - (a.year || 0);
    if (sortBy === 'tracks') return b.trackCount - a.trackCount;
    return 0;
  });

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6 select-none">
      {/* Top Header & Tab Controls */}
      <div className="flex items-center justify-between border-b border-lumen-borderSubtle pb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('albums')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'albums'
                ? 'bg-lumen-cyan text-lumen-bg shadow-led-cyan'
                : 'text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-surface'
            }`}
          >
            <Disc3 className="w-4 h-4" />
            <span>Albums ({albums.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('artists')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'artists'
                ? 'bg-lumen-cyan text-lumen-bg shadow-led-cyan'
                : 'text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-surface'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Artists ({artists.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('tracks')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'tracks'
                ? 'bg-lumen-cyan text-lumen-bg shadow-led-cyan'
                : 'text-lumen-textMuted hover:text-lumen-text hover:bg-lumen-surface'
            }`}
          >
            <Music className="w-4 h-4" />
            <span>Songs ({tracks.length})</span>
          </button>
        </div>

        {/* Rescan & Sort */}
        <div className="flex items-center gap-3">
          {activeTab === 'albums' && (
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-1.5 bg-lumen-panel border border-lumen-border rounded-lg text-xs font-mono text-lumen-textMuted focus:outline-none focus:border-lumen-cyan"
            >
              <option value="title">Sort: Album Title</option>
              <option value="artist">Sort: Artist Name</option>
              <option value="year">Sort: Release Year</option>
              <option value="tracks">Sort: Track Count</option>
            </select>
          )}

          <button
            onClick={onRescan}
            disabled={isScanning}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-lumen-surface hover:bg-lumen-panelHover border border-lumen-border text-xs text-lumen-cyan transition-colors disabled:opacity-50"
            title="Scan folders for newly added songs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Scanning...' : 'Rescan Folders'}</span>
          </button>
        </div>
      </div>

      {/* 1. Albums Tab View */}
      {activeTab === 'albums' && (
        <div className="grid grid-cols-5 gap-5">
          {sortedAlbums.map((album) => (
            <div
              key={album.id}
              onClick={() => {
                if (album.tracks.length > 0) {
                  onPlayTrack(album.tracks[0], album.tracks);
                }
              }}
              className="group p-3.5 rounded-xl bg-lumen-panel hover:bg-lumen-surface border border-lumen-borderSubtle hover:border-lumen-cyan/50 transition-all cursor-pointer shadow-sm hover:shadow-led-cyan"
            >
              <div className="relative aspect-square rounded-lg overflow-hidden bg-lumen-surface mb-3 border border-lumen-border">
                {album.artworkUrl ? (
                  <img src={album.artworkUrl} alt={album.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-lumen-textDim">
                    <Disc3 className="w-10 h-10 opacity-30 text-lumen-cyan" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <div className="w-11 h-11 rounded-full bg-lumen-cyan text-lumen-bg flex items-center justify-center shadow-led-cyan">
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </div>
                </div>
              </div>

              <h4 className="text-xs font-semibold text-lumen-text truncate group-hover:text-lumen-cyan transition-colors" title={album.title}>
                {album.title}
              </h4>
              <p className="text-[11px] text-lumen-textMuted truncate mt-0.5" title={album.artist}>
                {album.artist}
              </p>
              <div className="flex items-center justify-between text-[10px] font-mono text-lumen-textDim mt-1.5">
                <span>{album.trackCount} {album.trackCount === 1 ? 'song' : 'songs'}</span>
                {album.year && <span>{album.year}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2. Artists Tab View */}
      {activeTab === 'artists' && (
        <div className="grid grid-cols-4 gap-4">
          {artists.map((artist) => (
            <div
              key={artist.id}
              className="p-4 rounded-xl bg-lumen-panel border border-lumen-borderSubtle hover:border-lumen-border transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-lumen-surface border border-lumen-violet/40 flex items-center justify-center text-lumen-violet">
                  <User className="w-5 h-5" />
                </div>
                <div className="truncate">
                  <h4 className="text-sm font-semibold text-lumen-text truncate">{artist.name}</h4>
                  <p className="text-[11px] font-mono text-lumen-textMuted">{artist.trackCount} tracks</p>
                </div>
              </div>

              {/* Mini album cover previews */}
              <div className="flex gap-2 overflow-hidden">
                {artist.albums.slice(0, 3).map((alb) => (
                  <div
                    key={alb.id}
                    onClick={() => {
                      if (alb.tracks.length > 0) onPlayTrack(alb.tracks[0], alb.tracks);
                    }}
                    className="w-12 h-12 rounded bg-lumen-surface border border-lumen-border overflow-hidden cursor-pointer hover:border-lumen-cyan flex-shrink-0"
                    title={alb.title}
                  >
                    {alb.artworkUrl ? (
                      <img src={alb.artworkUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-lumen-textDim">♪</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. Tracks Table View */}
      {activeTab === 'tracks' && (
        <div className="bg-lumen-panel rounded-xl border border-lumen-border overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-lumen-borderSubtle text-[11px] font-mono uppercase text-lumen-textDim bg-lumen-surface/40">
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Artist</th>
                <th className="py-3 px-4">Album</th>
                <th className="py-3 px-4 w-24">Format</th>
                <th className="py-3 px-4 w-20 text-right"><Clock className="w-3.5 h-3.5 ml-auto" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumen-borderSubtle font-sans">
              {tracks.map((track, idx) => (
                <tr
                  key={track.id}
                  onClick={() => onPlayTrack(track, tracks)}
                  className="hover:bg-lumen-surface/70 cursor-pointer transition-colors group"
                >
                  <td className="py-2.5 px-4 text-center font-mono text-lumen-textDim group-hover:text-lumen-cyan">
                    {idx + 1}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-lumen-text group-hover:text-lumen-cyan transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded bg-lumen-surface overflow-hidden flex-shrink-0 border border-lumen-border">
                        {track.artworkUrl ? (
                          <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-lumen-textDim">♪</div>
                        )}
                      </div>
                      <span className="truncate">{track.title}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-lumen-textMuted truncate">{track.artist}</td>
                  <td className="py-2.5 px-4 text-lumen-textDim truncate">{track.album}</td>
                  <td className="py-2.5 px-4 font-mono text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-lumen-surface text-lumen-cyan border border-lumen-border">
                      {track.codec || 'AUDIO'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-lumen-textMuted">
                    {formatDuration(track.duration)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
