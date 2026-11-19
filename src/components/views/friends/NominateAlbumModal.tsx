import React, { useState } from 'react';
import { 
  X, 
  Search, 
  Disc3, 
  Crown, 
  Sparkles, 
  Check, 
  MessageSquare,
  Music,
  ArrowRight
} from 'lucide-react';
import { ArtistService, AlbumMetadata } from '../../../services/artistService';
import { AlbumNomination, ClubTrack } from '../../../types/albumClubTypes';
import { WatchSoundService } from '../../../services/watchSoundService';

interface NominateAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNominate: (nomination: AlbumNomination) => void;
  curatorId: string;
  curatorUsername: string;
  curatorDisplayName: string;
}

export const NominateAlbumModal: React.FC<NominateAlbumModalProps> = ({
  isOpen,
  onClose,
  onNominate,
  curatorId,
  curatorUsername,
  curatorDisplayName
}) => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<AlbumMetadata[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumMetadata | null>(null);
  const [albumTracks, setAlbumTracks] = useState<ClubTrack[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [curatorNote, setCuratorNote] = useState('');

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    WatchSoundService.playTick(1.0);
    try {
      const albums = await ArtistService.searchAlbums(query.trim());
      setResults(albums);
      if (albums.length === 0) {
        // Fallback demo album option if network is throttled
        setResults([
          {
            id: 'fallback_1',
            title: query.trim(),
            artist: 'Featured Artist',
            year: 2024,
            trackCount: 8,
            artworkUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80',
            primaryGenreName: 'Alternative'
          }
        ]);
      }
    } catch (_) {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectAlbum = async (album: AlbumMetadata) => {
    WatchSoundService.playTick(1.1);
    setSelectedAlbum(album);
    setIsLoadingTracks(true);

    try {
      const tracks = await ArtistService.getAlbumTracks(album.id, album.title, album.artist);
      if (tracks && tracks.length > 0) {
        setAlbumTracks(
          tracks.map((t, idx) => ({
            id: t.id || `t_${idx + 1}`,
            title: t.title,
            artist: t.artist || album.artist,
            duration: t.duration || 180,
            audioUrl: (t as any).audio_url || undefined,
            artworkUrl: (t as any).artworkUrl || (t as any).artwork_url || album.artworkUrl || undefined,
            trackNumber: idx + 1
          }))
        );
      } else {
        // Generate placeholder tracks matching trackCount
        const count = Math.max(3, album.trackCount || 6);
        const generated: ClubTrack[] = [];
        for (let i = 1; i <= count; i++) {
          generated.push({
            id: `track_${album.id}_${i}`,
            title: i === 1 ? 'Opening Overture' : i === 4 ? 'Central Anthem' : `Track ${i}`,
            artist: album.artist,
            duration: 180 + i * 15,
            trackNumber: i
          });
        }
        setAlbumTracks(generated);
      }
    } catch (_) {
      setAlbumTracks([
        { id: 't1', title: 'Track 1', artist: album.artist, duration: 200, trackNumber: 1 },
        { id: 't2', title: 'Track 2', artist: album.artist, duration: 210, trackNumber: 2 },
        { id: 't3', title: 'Track 3', artist: album.artist, duration: 240, trackNumber: 3 }
      ]);
    } finally {
      setIsLoadingTracks(false);
    }
  };

  const handleConfirmNomination = async () => {
    if (!selectedAlbum) return;
    WatchSoundService.playTick(1.3);

    let tracks = albumTracks;
    if (isLoadingTracks || tracks.length === 0) {
      setIsLoadingTracks(true);
      try {
        const fetched = await ArtistService.getAlbumTracks(selectedAlbum.id, selectedAlbum.title, selectedAlbum.artist);
        if (fetched && fetched.length > 0) {
          tracks = fetched.map((t, idx) => ({
            id: t.id || `t_${idx + 1}`,
            title: t.title,
            artist: t.artist || selectedAlbum.artist,
            duration: t.duration || 180,
            audioUrl: (t as any).audio_url || undefined,
            artworkUrl: (t as any).artworkUrl || (t as any).artwork_url || selectedAlbum.artworkUrl || undefined,
            trackNumber: idx + 1
          }));
        }
      } catch (_) {}
      setIsLoadingTracks(false);
    }

    // Safety fallback: if tracks still empty, generate numbered tracks matching trackCount
    if (!tracks || tracks.length === 0) {
      const count = Math.max(3, selectedAlbum.trackCount || 8);
      tracks = Array.from({ length: count }, (_, i) => ({
        id: `track_${selectedAlbum.id}_${i + 1}`,
        title: `Track ${i + 1}`,
        artist: selectedAlbum.artist,
        duration: 180 + i * 15,
        trackNumber: i + 1
      }));
    }

    const nomination: AlbumNomination = {
      albumId: selectedAlbum.id,
      title: selectedAlbum.title,
      artist: selectedAlbum.artist,
      artworkUrl: selectedAlbum.artworkUrl,
      year: selectedAlbum.year,
      genre: selectedAlbum.primaryGenreName,
      curatorId,
      curatorUsername,
      curatorDisplayName,
      curatorNote: curatorNote.trim() || 'I chose this album because I think everyone needs to hear it together.',
      tracks,
      nominatedAt: Date.now()
    };

    onNominate(nomination);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fadeIn">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-neutral-900/90 border border-white/15 backdrop-blur-3xl p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 text-amber-300 flex items-center justify-center border border-amber-400/30">
              <Crown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Nominate Week's Album</h3>
              <p className="text-xs text-white/50">Curator: @{curatorUsername}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Search Album */}
        {!selectedAlbum ? (
          <div className="space-y-4">
            <form onSubmit={handleSearch} className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search album title or artist name..."
                className="w-full px-4 py-3 pl-10 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/30 text-xs focus:outline-none focus:border-cyan-400"
                autoFocus
              />
              <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-white/90 disabled:opacity-40 cursor-pointer"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </form>

            {/* Results Grid */}
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {results.map((alb) => (
                <div
                  key={alb.id}
                  onClick={() => handleSelectAlbum(alb)}
                  className="p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-cyan-400/40 transition-all flex items-center justify-between gap-3 cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/60 border border-white/10 flex-shrink-0">
                      {alb.artworkUrl ? (
                        <img src={alb.artworkUrl} alt={alb.title} className="w-full h-full object-cover" />
                      ) : (
                        <Disc3 className="w-6 h-6 m-3 text-white/30" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                        {alb.title}
                      </div>
                      <div className="text-[11px] text-white/50 truncate">
                        {alb.artist} {alb.year ? `• ${alb.year}` : ''}
                      </div>
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Step 2: Confirmation & Curator's Note */
          <div className="space-y-4 animate-fadeIn">
            {/* Selected Album Card */}
            <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/15 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-black/60 border border-white/10 flex-shrink-0">
                  {selectedAlbum.artworkUrl ? (
                    <img src={selectedAlbum.artworkUrl} alt={selectedAlbum.title} className="w-full h-full object-cover" />
                  ) : (
                    <Disc3 className="w-8 h-8 m-4 text-white/30" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white truncate">{selectedAlbum.title}</div>
                  <div className="text-xs text-white/60 truncate">{selectedAlbum.artist}</div>
                  <div className="text-[10px] font-mono text-cyan-300 pt-0.5">
                    {albumTracks.length} tracks resolved
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedAlbum(null)}
                className="px-2.5 py-1 rounded-xl bg-white/10 text-white/70 hover:text-white text-xs cursor-pointer"
              >
                Change
              </button>
            </div>

            {/* Curator Note Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-white/70">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                  <span>Curator's Note for the Group</span>
                </span>
                <span className="font-mono text-[10px] text-white/40">{200 - curatorNote.length} left</span>
              </div>
              <textarea
                value={curatorNote}
                onChange={(e) => setCuratorNote(e.target.value.slice(0, 200))}
                placeholder="e.g. I chose this album because I think everyone needs to hear track 4. Listen on good headphones!"
                rows={3}
                className="w-full p-3 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/30 text-xs resize-none focus:outline-none focus:border-cyan-400"
              />
            </div>

            {/* Resolved Tracklist preview */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-semibold text-white/50">
                <span>Tracklist Preview</span>
                {isLoadingTracks && (
                  <span className="text-[10px] text-cyan-400 flex items-center gap-1 font-mono animate-pulse">
                    <Sparkles className="w-3 h-3 animate-spin" />
                    Fetching tracks...
                  </span>
                )}
              </div>
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 max-h-36 overflow-y-auto space-y-1">
                {isLoadingTracks && albumTracks.length === 0 ? (
                  <div className="py-4 text-center text-xs text-white/40 flex items-center justify-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    <span>Resolving official tracklist...</span>
                  </div>
                ) : albumTracks.length > 0 ? (
                  albumTracks.map((t, i) => (
                    <div key={t.id} className="text-xs text-white/70 flex items-center gap-2">
                      <span className="font-mono text-white/30 w-4">{i + 1}.</span>
                      <span className="truncate">{t.title}</span>
                    </div>
                  ))
                ) : (
                  <div className="py-2 text-center text-xs text-white/40">
                    Tracks will be locked in upon confirmation.
                  </div>
                )}
              </div>
            </div>

            {/* Confirm button */}
            <button
              type="button"
              onClick={handleConfirmNomination}
              disabled={isLoadingTracks}
              className="w-full py-3 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-black font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isLoadingTracks ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin text-black" />
                  <span>Locking In Tracklist...</span>
                </>
              ) : (
                <>
                  <Crown className="w-4 h-4" />
                  <span>Confirm & Lock In Nomination ({albumTracks.length} tracks)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
