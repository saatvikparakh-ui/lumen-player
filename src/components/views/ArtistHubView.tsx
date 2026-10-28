import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Disc3, 
  Check, 
  Plus, 
  Clock, 
  X, 
  Sparkles, 
  FolderHeart,
  FolderPlus,
  ListPlus,
  MoreVertical,
  ChevronRight,
  ChevronDown,
  Shuffle
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../types/music';
import { PlaylistService } from '../../services/playlistService';
import { AudioEngine } from '../../services/audioEngine';

interface ArtistAlbum {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  trackCount: number;
  artworkUrl: string | null;
  primaryGenreName?: string;
  tracks?: Track[];
}

interface Props {
  artistName: string;
  onClose: () => void;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  dominantColor: string;
  playlists: CustomPlaylist[];
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const ArtistHubView: React.FC<Props> = ({
  artistName,
  onClose,
  onPlayTrack,
  currentTrack,
  isPlaying,
  dominantColor,
  playlists
}) => {
  const [topTracks, setTopTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<ArtistAlbum[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  const [albumTracksLoading, setAlbumTracksLoading] = useState<string | null>(null);
  const [loadedAlbumTracks, setLoadedAlbumTracks] = useState<Record<string, Track[]>>({});
  const [addedConfirm, setAddedConfirm] = useState<string | null>(null);
  const [playlistMenuTrack, setPlaylistMenuTrack] = useState<Track | null>(null);
  const [activeMenuTrackId, setActiveMenuTrackId] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<{ id: string; text: string } | null>(null);

  const handleAddToQueue = (track: Track) => {
    AudioEngine.addToQueue(track);
    setActiveMenuTrackId(null);
    setFeedbackToast({ id: track.id, text: 'Added to Queue' });
    setTimeout(() => setFeedbackToast(null), 2000);
  };

  const handleOpenAddToPlaylist = (track: Track) => {
    setActiveMenuTrackId(null);
    setPlaylistMenuTrack(track);
  };

  const fetchArtistDiscography = (attempt = 1) => {
    setIsLoading(true);
    setLoadError(null);
    const cleanQuery = (artistName || '').trim();
    fetch(`/api/artist?name=${encodeURIComponent(cleanQuery)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d.success && (d.topTracks?.length > 0 || d.albums?.length > 0)) {
          setTopTracks(d.topTracks || []);
          setAlbums(d.albums || []);
          setIsLoading(false);
        } else if (attempt < 4) {
          // Auto-retry with progressive exponential backoff
          const delay = Math.min(800 * attempt, 3000);
          setTimeout(() => fetchArtistDiscography(attempt + 1), delay);
        } else {
          setTopTracks(d.topTracks || []);
          setAlbums(d.albums || []);
          if ((!d.topTracks || d.topTracks.length === 0) && (!d.albums || d.albums.length === 0)) {
            setLoadError('Unable to load artist discography.');
          }
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (attempt < 4) {
          const delay = Math.min(800 * attempt, 3000);
          setTimeout(() => fetchArtistDiscography(attempt + 1), delay);
        } else {
          setLoadError(err.message || 'Network error');
          setIsLoading(false);
        }
      });
  };

  useEffect(() => {
    fetchArtistDiscography(1);
  }, [artistName]);

  const toggleExpandAlbum = async (albumId: string) => {
    if (expandedAlbumId === albumId) {
      setExpandedAlbumId(null);
      return;
    }
    setExpandedAlbumId(albumId);

    if (!loadedAlbumTracks[albumId]) {
      setAlbumTracksLoading(albumId);
      try {
        const res = await fetch(`/api/album?id=${albumId}`);
        const data = await res.json();
        if (data.success && data.album?.tracks) {
          setLoadedAlbumTracks(prev => ({
            ...prev,
            [albumId]: data.album.tracks
          }));
        }
      } catch (err) {
        console.warn('Failed to load album tracks:', err);
      } finally {
        setAlbumTracksLoading(null);
      }
    }
  };

  const handlePlayAlbum = async (albumId: string, isShuffle: boolean = false) => {
    let tracks = loadedAlbumTracks[albumId];
    if (!tracks || tracks.length === 0) {
      setAlbumTracksLoading(albumId);
      try {
        const res = await fetch(`/api/album?id=${albumId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.album?.tracks && data.album.tracks.length > 0) {
            tracks = data.album.tracks;
            setLoadedAlbumTracks(prev => ({
              ...prev,
              [albumId]: tracks
            }));
          }
        }
      } catch (err) {
        console.warn('Failed to load album tracks for playback:', err);
      } finally {
        setAlbumTracksLoading(null);
      }
    }

    if (tracks && tracks.length > 0) {
      if (isShuffle) {
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        onPlayTrack(shuffled[0], shuffled);
      } else {
        onPlayTrack(tracks[0], tracks);
      }
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

  return (
    <div 
      className="fixed inset-0 z-40 bg-black/85 backdrop-blur-3xl flex flex-col p-6 sm:p-10 select-none animate-fadeIn overflow-hidden"
      onClick={() => {
        setPlaylistMenuTrack(null);
        setActiveMenuTrackId(null);
      }}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase tracking-widest px-3 py-1 rounded-full bg-white/10 text-lumen-cyan border border-white/15">
            VERIFIED ARTIST PROFILE
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white/50">
          <Disc3 className="w-10 h-10 animate-spin text-lumen-cyan mb-3" />
          <span className="text-xs font-mono">Organizing artist discography & studio albums...</span>
        </div>
      ) : loadError && topTracks.length === 0 && albums.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 mb-2">
            <Disc3 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white">Could not load discography for {artistName}</h3>
          <p className="text-xs text-white/50 max-w-sm">The connection timed out while querying the verified catalog. Tap below to reload.</p>
          <button
            onClick={() => fetchArtistDiscography(1)}
            className="px-6 py-2.5 rounded-full bg-lumen-cyan text-black font-bold text-xs hover:scale-105 active:scale-95 transition-all shadow-lg"
          >
            Retry Loading
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-8 pr-2">
          {/* Artist Hero Banner */}
          <div className="relative rounded-3xl overflow-hidden p-8 sm:p-10 bg-gradient-to-r from-black/80 via-black/40 to-transparent border border-white/15 shadow-2xl flex flex-col sm:flex-row items-center sm:items-end gap-6">
            {/* Ambient Radial Back Glow */}
            <div 
              className="pointer-events-none absolute w-96 h-96 -top-20 -left-20 rounded-full blur-[120px] opacity-35"
              style={{ backgroundColor: dominantColor }}
            />

            {/* Artist First Artwork as Avatar */}
            {topTracks[0]?.artworkUrl && (
              <div 
                className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl flex-shrink-0"
                style={{ boxShadow: `0 20px 40px -10px ${dominantColor}60` }}
              >
                <img 
                  src={topTracks[0].artworkUrl} 
                  alt={artistName} 
                  className="w-full h-full object-cover" 
                />
              </div>
            )}

            <div className="flex-1 text-center sm:text-left relative z-10">
              <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-lumen-cyan font-bold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-lumen-cyan stroke-[3]" />
                  Verified Artist
                </span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
                {artistName}
              </h1>
              <p className="text-xs text-white/60 font-mono mt-2">
                {albums.length} Official Studio Albums & EPs • {topTracks.length} Songs Available
              </p>

              {/* Play & Shuffle Artist Controls */}
              {topTracks.length > 0 && (
                <div className="mt-5 flex items-center gap-3 justify-center sm:justify-start">
                  {/* Play in Order Button */}
                  <button
                    onClick={() => onPlayTrack(topTracks[0], topTracks)}
                    className="flex items-center gap-2.5 px-6 py-2.5 rounded-full font-bold text-xs text-black shadow-xl transition-all duration-200 hover:scale-105 active:scale-95 group"
                    style={{
                      backgroundColor: dominantColor || '#00f2fe',
                      boxShadow: `0 8px 25px -4px ${dominantColor || '#00f2fe'}66`
                    }}
                    title={`Play all songs from ${artistName} in order`}
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5 transition-transform group-hover:scale-110" />
                    <span>Play All</span>
                  </button>

                  {/* Shuffle Artist Button */}
                  <button
                    onClick={() => {
                      const shuffled = [...topTracks].sort(() => Math.random() - 0.5);
                      onPlayTrack(shuffled[0], shuffled);
                    }}
                    className="flex items-center gap-2.5 px-5 py-2.5 rounded-full font-bold text-xs text-white bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-xl shadow-xl transition-all duration-200 hover:scale-105 active:scale-95 group"
                    title={`Shuffle all songs from ${artistName}`}
                  >
                    <Shuffle className="w-4 h-4 text-lumen-cyan transition-transform group-hover:rotate-12" />
                    <span>Shuffle</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Popular Top Tracks Section */}
          <div>
            <h3 className="text-sm font-mono uppercase tracking-wider text-white/60 font-bold mb-4">
              Popular Tracks
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {topTracks.slice(0, 10).map((track, idx) => {
                const isTrackPlaying = currentTrack?.id === track.id && isPlaying;
                return (
                  <div
                    key={track.id}
                    onClick={() => onPlayTrack(track, topTracks)}
                    className="flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <span className="w-5 text-center text-xs font-mono text-white/40 group-hover:text-lumen-cyan">
                        {idx + 1}
                      </span>
                      {track.artworkUrl && (
                        <img 
                          src={track.artworkUrl} 
                          alt={track.title} 
                          className="w-10 h-10 rounded-xl object-cover border border-white/15" 
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className={`text-xs font-bold truncate ${currentTrack?.id === track.id ? 'text-lumen-cyan' : 'text-white'}`}>
                          {track.title}
                        </h4>
                        <p className="text-[11px] text-white/50 truncate">{track.album}</p>
                      </div>
                    </div>

                    <div className="relative flex items-center gap-2.5 text-xs font-mono text-white/40">
                      <span>{formatDuration(track.duration)}</span>
                      
                      {/* Three Vertical Dots Action Menu */}
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuTrackId(activeMenuTrackId === track.id ? null : track.id);
                          }}
                          className="p-1.5 rounded-lg hover:bg-white/15 text-white/50 hover:text-white transition-colors"
                          title="More Options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {/* Apple VisionOS Liquid Glass Popover Menu */}
                        {activeMenuTrackId === track.id && (
                          <div 
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 top-8 w-44 rounded-2xl bg-white/[0.08] border-t border-l border-white/40 border-r border-b border-black/50 backdrop-blur-3xl shadow-2xl p-1.5 flex flex-col gap-1 z-50 animate-fadeIn"
                            style={{
                              boxShadow: '0 20px 45px rgba(0, 0, 0, 0.9), inset 0 1px 1px rgba(255, 255, 255, 0.4)'
                            }}
                          >
                            <button
                              onClick={() => handleAddToQueue(track)}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/15 text-xs text-white/90 hover:text-white font-medium transition-colors text-left"
                            >
                              <ListPlus className="w-3.5 h-3.5 text-lumen-cyan" />
                              <span>Add to Queue</span>
                            </button>
                            <button
                              onClick={() => handleOpenAddToPlaylist(track)}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/15 text-xs text-white/90 hover:text-white font-medium transition-colors text-left"
                            >
                              <FolderPlus className="w-3.5 h-3.5 text-lumen-violet" />
                              <span>Add to Playlist</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Toast Feedback */}
                      {feedbackToast?.id === track.id && (
                        <span className="absolute -top-6 right-0 px-2 py-0.5 rounded-md bg-white/20 backdrop-blur-md text-[10px] text-lumen-cyan font-mono font-bold animate-fadeIn">
                          {feedbackToast.text}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* STUDIO ALBUMS SEGREGATED SECTION (Just like Spotify) */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-mono uppercase tracking-wider text-white/60 font-bold">
                Discography & Studio Albums ({albums.length})
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {albums.map((album) => {
                const isExpanded = expandedAlbumId === album.id;
                const albumTracks = loadedAlbumTracks[album.id];

                return (
                  <div
                    key={album.id}
                    className="flex flex-col bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-3.5 transition-all group"
                  >
                    {/* 1000x1000 Square Album Cover */}
                    <div 
                      className="relative aspect-square w-full rounded-xl overflow-hidden bg-black/90 mb-3 shadow-xl cursor-pointer"
                      onClick={() => toggleExpandAlbum(album.id)}
                    >
                      {album.artworkUrl ? (
                        <img 
                          src={album.artworkUrl} 
                          alt={album.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/30">
                          <Disc3 className="w-12 h-12" />
                        </div>
                      )}

                      <div 
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAlbum(album.id, false);
                        }}
                      >
                        <div 
                          className="w-10 h-10 rounded-full flex items-center justify-center text-black font-bold shadow-lg"
                          style={{ backgroundColor: dominantColor || '#00f2fe' }}
                        >
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>

                    {/* Album Header: Title, Year, and Play / Shuffle Buttons */}
                    <div className="flex items-start justify-between gap-1.5 mt-0.5">
                      <div className="min-w-0 flex-1">
                        <h4 
                          onClick={() => toggleExpandAlbum(album.id)}
                          className="text-xs font-bold text-white truncate cursor-pointer group-hover:text-lumen-cyan transition-colors"
                          title={album.title}
                        >
                          {album.title}
                        </h4>
                        <p className="text-[10px] text-white/50 font-mono mt-0.5">
                          {album.year || 'Album'} • {album.trackCount} tracks
                        </p>
                      </div>

                      {/* Right-aligned Play (Normal) & Shuffle buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAlbum(album.id, false);
                          }}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/25 text-white/80 hover:text-white border border-white/10 hover:border-white/30 backdrop-blur-md transition-all hover:scale-110 active:scale-95"
                          title={`Play ${album.title} in order`}
                        >
                          <Play className="w-3 h-3 fill-current ml-0.5 text-lumen-cyan" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAlbum(album.id, true);
                          }}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/25 text-white/80 hover:text-white border border-white/10 hover:border-white/30 backdrop-blur-md transition-all hover:scale-110 active:scale-95"
                          title={`Shuffle ${album.title}`}
                        >
                          <Shuffle className="w-3 h-3 text-white/90" />
                        </button>
                      </div>
                    </div>

                    {/* View Album Tracks Trigger */}
                    <button
                      onClick={() => toggleExpandAlbum(album.id)}
                      className="mt-2.5 flex items-center justify-between text-[11px] font-mono text-lumen-cyan hover:underline pt-2 border-t border-white/10"
                    >
                      <span>{isExpanded ? 'Hide Tracks' : 'View Tracks'}</span>
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>

                    {/* Expanded Tracklist Table */}
                    {isExpanded && (
                      <div className="mt-3 pt-2 border-t border-white/10 space-y-1.5 animate-fadeIn">
                        {albumTracksLoading === album.id ? (
                          <div className="text-center py-3 text-[10px] font-mono text-white/40">
                            Loading album tracks...
                          </div>
                        ) : albumTracks && albumTracks.length > 0 ? (
                          albumTracks.map((t) => (
                            <div
                              key={t.id}
                              onClick={() => onPlayTrack(t, albumTracks)}
                              className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/10 cursor-pointer text-[11px] text-white/80 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="font-mono text-white/30 text-[10px] w-4">
                                  {(t as any).trackNumber || '•'}
                                </span>
                                <span className="truncate">{t.title}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-white/40 text-[10px]">
                                  {formatDuration(t.duration)}
                                </span>
                                <div className="relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuTrackId(activeMenuTrackId === t.id ? null : t.id);
                                    }}
                                    className="p-1 rounded hover:bg-white/15 text-white/40 hover:text-white transition-colors"
                                    title="Options"
                                  >
                                    <MoreVertical className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Popover Menu */}
                                  {activeMenuTrackId === t.id && (
                                    <div 
                                      onClick={(e) => e.stopPropagation()}
                                      className="absolute right-0 top-6 w-40 rounded-xl bg-white/[0.08] border-t border-l border-white/40 border-r border-b border-black/50 backdrop-blur-3xl shadow-2xl p-1 flex flex-col gap-0.5 z-50 animate-fadeIn"
                                      style={{
                                        boxShadow: '0 15px 35px rgba(0, 0, 0, 0.9), inset 0 1px 1px rgba(255, 255, 255, 0.35)'
                                      }}
                                    >
                                      <button
                                        onClick={() => handleAddToQueue(t)}
                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/15 text-[11px] text-white/90 hover:text-white transition-colors text-left"
                                      >
                                        <ListPlus className="w-3 h-3 text-lumen-cyan" />
                                        <span>Add to Queue</span>
                                      </button>
                                      <button
                                        onClick={() => handleOpenAddToPlaylist(t)}
                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/15 text-[11px] text-white/90 hover:text-white transition-colors text-left"
                                      >
                                        <FolderPlus className="w-3 h-3 text-lumen-violet" />
                                        <span>Add to Playlist</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-2 text-[10px] text-white/40">
                            No tracks found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Playlist Selector Popup */}
      {playlistMenuTrack && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="fixed bottom-24 right-10 w-52 bg-black/95 border border-white/20 rounded-2xl p-2.5 z-50 shadow-2xl animate-fadeIn"
        >
          <span className="text-[10px] font-mono uppercase text-white/40 block px-2 py-1">
            Add to Playlist
          </span>
          <div className="space-y-1 max-h-40 overflow-y-auto no-scrollbar">
            {playlists.map(pl => (
              <button
                key={pl.id}
                onClick={() => handleAddToPlaylist(pl.id, playlistMenuTrack)}
                className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs text-white truncate flex items-center gap-2 transition-colors"
              >
                <FolderHeart className="w-3.5 h-3.5 text-lumen-cyan" />
                <span className="truncate">{pl.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
