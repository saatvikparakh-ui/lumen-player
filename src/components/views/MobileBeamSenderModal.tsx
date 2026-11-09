import React, { useState, useEffect } from 'react';
import { Radio, Upload, Link2, CheckCircle2, AlertCircle, Sparkles, X, FileText, Send } from 'lucide-react';
import { TvBeamService } from '../../services/tvBeamService';
import { StreamingService } from '../../services/streamingService';
import { Track } from '../../types/music';

interface MobileBeamSenderModalProps {
  pin: string;
  onClose: () => void;
  dominantColor?: string;
}

export function parseCsvTracks(content: string): { title: string; artist: string }[] {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results: { title: string; artist: string }[] = [];

  for (const line of lines) {
    // Check if CSV with header row
    if (line.toLowerCase().includes('track name') || line.toLowerCase().includes('artist name(s)')) {
      continue;
    }

    // Try CSV comma split or quotes
    const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    if (parts.length >= 2) {
      const cleanTitle = parts[0].replace(/^["']|["']$/g, '').trim();
      const cleanArtist = parts[1].replace(/^["']|["']$/g, '').trim();
      if (cleanTitle && cleanArtist) {
        results.push({ title: cleanTitle, artist: cleanArtist });
        continue;
      }
    }

    // Try "Title - Artist" format
    if (line.includes(' - ')) {
      const [title, ...rest] = line.split(' - ');
      results.push({ title: title.trim(), artist: rest.join(' - ').trim() });
      continue;
    }

    // Try "Title by Artist"
    if (line.toLowerCase().includes(' by ')) {
      const [title, ...rest] = line.split(/ by /i);
      results.push({ title: title.trim(), artist: rest.join(' by ').trim() });
      continue;
    }

    // Single title fallback
    if (line.length > 2) {
      results.push({ title: line, artist: 'Unknown Artist' });
    }
  }

  return results;
}

export const MobileBeamSenderModal: React.FC<MobileBeamSenderModalProps> = ({
  pin,
  onClose,
  dominantColor = '#63E8FF'
}) => {
  const [playlistName, setPlaylistName] = useState('My Beamed Playlist');
  const [rawText, setRawText] = useState('');
  const [spotifyLink, setSpotifyLink] = useState('');
  const [parsedTracks, setParsedTracks] = useState<{ title: string; artist: string }[]>([]);
  const [isBeaming, setIsBeaming] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'csv' | 'link'>('csv');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      setRawText(text);
      const parsed = parseCsvTracks(text);
      setParsedTracks(parsed);
      if (file.name) {
        setPlaylistName(file.name.replace(/\.[^/.]+$/, ''));
      }
    };
    reader.readAsText(file);
  };

  const handleTextChange = (text: string) => {
    setRawText(text);
    const parsed = parseCsvTracks(text);
    setParsedTracks(parsed);
  };

  const handleBeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) {
      setErrorMessage('No TV PIN specified.');
      setStatus('error');
      return;
    }

    setIsBeaming(true);
    setStatus('idle');
    setErrorMessage('');

    try {
      let finalTracks: Track[] = [];

      if (activeTab === 'link' && spotifyLink.trim()) {
        // Resolve Spotify or streaming link
        const cleanLink = spotifyLink.trim();
        const resolved = await StreamingService.searchVerifiedTracks(cleanLink);
        finalTracks = resolved;
      } else {
        // Convert parsed tracks to Track objects
        finalTracks = parsedTracks.map((pt, idx) => ({
          id: `beam_${Date.now()}_${idx}`,
          title: pt.title,
          artist: pt.artist,
          album: 'Beamed Track',
          path: '',
          filename: `${pt.title}.mp3`,
          hasArtwork: false,
          duration: 210,
          artworkUrl: null,
          streamUrl: '',
          addedAt: Date.now(),
          sourceType: 'full-stream' as const
        }));
      }

      if (finalTracks.length === 0) {
        setErrorMessage('No tracks found to beam. Please upload a CSV file or paste songs.');
        setStatus('error');
        setIsBeaming(false);
        return;
      }

      const res = await TvBeamService.beamPlaylistToTv(pin, {
        name: playlistName.trim() || 'Beamed Playlist',
        description: `Imported via LUMEN TV Beam on ${new Date().toLocaleDateString()}`,
        tracks: finalTracks
      });

      if (res.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(res.error || 'Failed to beam to TV.');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || 'Transmission failed.');
    } finally {
      setIsBeaming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-2xl animate-fadeIn select-none">
      <div 
        className="relative w-full max-w-lg rounded-3xl bg-[#090D18] border border-white/20 p-6 sm:p-7 shadow-2xl overflow-hidden"
        style={{
          boxShadow: `0 20px 60px rgba(0, 0, 0, 0.95), 0 0 35px -5px ${dominantColor}40`
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {status === 'success' ? (
          <div className="py-8 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.5)]">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-black font-syne text-white">
              Beamed to Your TV!
            </h3>
            <p className="text-xs text-white/60 font-outfit max-w-xs">
              "{playlistName}" ({parsedTracks.length} tracks) was sent to TV screen <span className="text-lumen-cyan font-mono font-bold">{pin}</span>.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-full bg-lumen-cyan text-black font-bold text-xs uppercase tracking-wider shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleBeamSubmit} className="space-y-4">
            {/* Header with TV Pairing Status */}
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-1">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>CONNECTED TO TV: <strong>{pin}</strong></span>
              </div>
              <h2 className="text-xl font-black font-syne text-white">
                Beam Playlist to TV
              </h2>
              <p className="text-xs text-white/50 font-outfit">
                Transfer your local CSV files or Spotify playlists straight to the big screen.
              </p>
            </div>

            {/* Playlist Title */}
            <div>
              <label className="block text-[11px] font-mono text-white/60 uppercase tracking-widest mb-1">
                Playlist Name
              </label>
              <input
                type="text"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                placeholder="e.g. Midnight Chill"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-xs placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                required
              />
            </div>

            {/* Input Format Switcher */}
            <div className="flex rounded-xl bg-white/5 p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setActiveTab('csv')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-syne font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'csv' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>CSV / Text File</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('link')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-syne font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'link' ? 'bg-white text-black shadow-md' : 'text-white/60 hover:text-white'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Streaming Link</span>
              </button>
            </div>

            {/* CSV File Upload or Raw Paste */}
            {activeTab === 'csv' && (
              <div className="space-y-3">
                <label className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors group">
                  <Upload className="w-7 h-7 text-lumen-cyan group-hover:scale-110 transition-transform mb-1.5" />
                  <span className="text-xs font-syne font-bold text-white">Tap to Choose CSV File</span>
                  <span className="text-[10px] text-white/40 font-mono mt-0.5">Supports Exportify, Spotify, Apple Music CSVs</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-white/50 mb-1">
                    <span>Or Paste Tracklist (One per line)</span>
                    {parsedTracks.length > 0 && (
                      <span className="text-lumen-cyan font-bold">{parsedTracks.length} tracks detected</span>
                    )}
                  </div>
                  <textarea
                    rows={4}
                    value={rawText}
                    onChange={(e) => handleTextChange(e.target.value)}
                    placeholder="Song Title - Artist Name&#10;Another Song - Another Artist"
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-white text-xs font-mono placeholder-white/25 focus:outline-none focus:border-lumen-cyan resize-none"
                  />
                </div>
              </div>
            )}

            {/* Streaming Link */}
            {activeTab === 'link' && (
              <div>
                <label className="block text-[11px] font-mono text-white/60 uppercase tracking-widest mb-1">
                  Spotify / Streaming Link
                </label>
                <input
                  type="text"
                  value={spotifyLink}
                  onChange={(e) => setSpotifyLink(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-xs placeholder-white/30 focus:outline-none focus:border-lumen-cyan"
                />
              </div>
            )}

            {/* Error Message */}
            {status === 'error' && errorMessage && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Beam Action Button */}
            <button
              type="submit"
              disabled={isBeaming || (activeTab === 'csv' && parsedTracks.length === 0 && !rawText.trim()) || (activeTab === 'link' && !spotifyLink.trim())}
              className="w-full py-3 rounded-2xl bg-lumen-cyan text-black font-syne font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(99,232,255,0.4)] hover:scale-[1.02] active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
            >
              <Send className="w-4 h-4 fill-black" />
              <span>{isBeaming ? 'Beaming to TV...' : 'Beam to TV Now'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
