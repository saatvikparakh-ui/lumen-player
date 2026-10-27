import React, { useState, useRef } from 'react';
import { 
  X, 
  Link as LinkIcon, 
  FileText, 
  Music, 
  Check, 
  AlertCircle, 
  Loader2, 
  Sparkles, 
  UploadCloud,
  ArrowRight
} from 'lucide-react';
import { CustomPlaylist, Track } from '../../types/music';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (playlist: CustomPlaylist) => void;
  dominantColor?: string;
}

export const ImportPlaylistModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onImportSuccess,
  dominantColor = '#63E8FF'
}) => {
  const [activeTab, setActiveTab] = useState<'link' | 'text'>('link');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistText, setPlaylistText] = useState('');
  const [customName, setCustomName] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleImport = async () => {
    setErrorMessage(null);
    setSuccessCount(null);

    const isLinkMode = activeTab === 'link';
    const trimmedUrl = playlistUrl.trim();
    const trimmedText = playlistText.trim();

    if (isLinkMode && !trimmedUrl) {
      setErrorMessage('Please enter a valid Spotify or streaming playlist URL.');
      return;
    }
    if (!isLinkMode && !trimmedText) {
      setErrorMessage('Please paste at least one song (e.g. "Song Name - Artist").');
      return;
    }

    setIsLoading(true);
    setLoadingStep(isLinkMode ? 'Connecting to streaming provider...' : 'Parsing track list...');

    try {
      const payload: { url?: string; text?: string; name?: string; spotifyClientId?: string; spotifyClientSecret?: string } = {};
      if (isLinkMode) {
        payload.url = trimmedUrl;
        const storedCId = localStorage.getItem('lumen_spotify_client_id') || '';
        const storedCSecret = localStorage.getItem('lumen_spotify_client_secret') || '';
        if (storedCId && storedCSecret) {
          payload.spotifyClientId = storedCId;
          payload.spotifyClientSecret = storedCSecret;
        }
      } else {
        payload.text = trimmedText;
      }
      if (customName.trim()) {
        payload.name = customName.trim();
      }

      setLoadingStep('Resolving verified 1000×1000 studio artwork and audio streams...');

      const response = await fetch('/api/playlist/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || `Import failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.playlist) {
        throw new Error(data.message || 'Could not parse playlist tracks.');
      }

      const imported = data.playlist;
      // Preserve all tracks from import without deduplicating
      const tracks: Track[] = (imported.tracks || []).map((t: any) => ({
        id: t.id,
        path: t.path || t.streamUrl || '',
        filename: t.filename || `${t.title}.opus`,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration || 180,
        artworkUrl: t.artworkUrl,
        streamUrl: t.streamUrl,
        hasArtwork: !!t.artworkUrl,
        isStream: true,
        isVerified: true,
        addedAt: Date.now()
      }));

      const newPlaylist: CustomPlaylist = {
        id: imported.id || `pl_${Date.now()}`,
        name: imported.name || customName || 'Imported Playlist',
        description: imported.description || `Imported ${tracks.length} tracks with verified studio audio and song album artwork`,
        coverUrl: tracks[0]?.artworkUrl || null, // strictly first song's album cover
        coverColor: dominantColor,
        tracks,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      setSuccessCount(tracks.length);
      setLoadingStep(`Successfully imported ${tracks.length} tracks!`);

      setTimeout(() => {
        setIsLoading(false);
        onImportSuccess(newPlaylist);
        onClose();
      }, 1000);

    } catch (err: any) {
      console.error('Import error:', err);
      setIsLoading(false);
      setErrorMessage(err.message || 'Failed to import playlist. Please check your link or formatting.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setPlaylistText(content);
        if (!customName) {
          const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
          setCustomName(fileNameWithoutExt);
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-xl rounded-3xl bg-neutral-900/90 border border-white/20 p-6 md:p-8 shadow-2xl backdrop-blur-2xl text-white overflow-hidden"
        style={{
          boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 40px -10px ${dominantColor}25`
        }}
      >
        {/* Subtle Ambient Glow Pill */}
        <div 
          className="absolute -top-24 -left-24 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ background: dominantColor }}
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: `linear-gradient(135deg, ${dominantColor}30, #18181b)` }}
            >
              <UploadCloud className="w-5 h-5 text-lumen-cyan" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Shift Playlist to LUMEN
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-lumen-cyan/20 text-lumen-cyan font-mono border border-lumen-cyan/30">
                  Universal
                </span>
              </h2>
              <p className="text-xs text-white/50">
                Transfer playlists from Spotify, Apple Music, CSV, or raw text tracklists
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            disabled={isLoading}
            className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 my-5 p-1 rounded-2xl bg-black/40 border border-white/10">
          <button
            onClick={() => { setActiveTab('link'); setErrorMessage(null); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'link'
                ? 'bg-white/15 text-white shadow-md border border-white/15 font-bold'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <LinkIcon className="w-3.5 h-3.5 text-lumen-cyan" />
            <span>Spotify / Streaming Link</span>
          </button>
          <button
            onClick={() => { setActiveTab('text'); setErrorMessage(null); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'text'
                ? 'bg-white/15 text-white shadow-md border border-white/15 font-bold'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>Text / CSV / File Upload</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'link' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">
                Spotify Playlist URL
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/..."
                  disabled={isLoading}
                  className="w-full px-4 py-3 rounded-2xl bg-black/50 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan transition-colors"
                />
              </div>
              <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed">
                Paste any public Spotify playlist URL. LUMEN extracts the tracklist and resolves 1000×1000 studio artwork and audio streams automatically.
              </p>
            </div>

            {/* Quick preset examples */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-white/40">Try sample:</span>
              <button
                type="button"
                onClick={() => setPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')}
                className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] text-lumen-cyan transition-all"
              >
                Today's Top Hits
              </button>
              <button
                type="button"
                onClick={() => setPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6')}
                className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] text-lumen-cyan transition-all"
              >
                Chill Hits
              </button>
            </div>

            <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 text-[11px] text-white/60 flex items-center justify-between">
              <span>Have a playlist with 100+ songs?</span>
              <button
                type="button"
                onClick={() => setActiveTab('text')}
                className="text-xs text-lumen-cyan font-bold hover:underline"
              >
                Use Text / CSV (No Client ID needed) →
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-2.5 text-[11px] text-emerald-200 leading-relaxed">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-white block">No Client ID required for 100+ songs:</span>
                Open your playlist in Spotify, press <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Ctrl + A</kbd> to select all, <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Ctrl + C</kbd> to copy, and paste here. Or upload a CSV from <a href="https://exportify.net" target="_blank" rel="noreferrer" className="text-lumen-cyan underline">Exportify</a>. LUMEN imports all 200, 500, or 1000+ tracks automatically!
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-1.5">
                Playlist Name (Optional)
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="My Transferred Playlist"
                disabled={isLoading}
                className="w-full px-4 py-2.5 rounded-2xl bg-black/50 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-white/70">
                  Track List (One per line or CSV)
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-lumen-cyan hover:underline flex items-center gap-1"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Upload .CSV / .TXT</span>
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept=".csv,.txt" 
                  className="hidden" 
                />
              </div>
              <textarea
                value={playlistText}
                onChange={(e) => setPlaylistText(e.target.value)}
                placeholder={`Blinding Lights - The Weeknd\nLevitating - Dua Lipa\nAs It Was - Harry Styles\nStarboy - The Weeknd`}
                rows={5}
                disabled={isLoading}
                className="w-full px-4 py-3 rounded-2xl bg-black/50 border border-white/15 text-xs font-mono text-white placeholder-white/30 focus:outline-none focus:border-lumen-cyan transition-colors resize-none"
              />
              <p className="text-[11px] text-white/40 mt-1">
                Accepts "Song Title - Artist" or CSV "Title, Artist" exported from any streaming service (Spotify, Apple Music, YouTube Music, Tidal, Amazon Music).
              </p>
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="mt-4 p-3 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center gap-2.5 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Loading / Progress Indicator */}
        {isLoading && (
          <div className="mt-4 p-3.5 rounded-2xl bg-lumen-cyan/10 border border-lumen-cyan/25 flex items-center gap-3 text-xs text-lumen-cyan">
            <Loader2 className="w-4 h-4 animate-spin shrink-0 text-lumen-cyan" />
            <span className="font-medium animate-pulse">{loadingStep}</span>
          </div>
        )}

        {/* Success Banner */}
        {successCount !== null && (
          <div className="mt-4 p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center gap-2.5 text-xs text-emerald-200 font-semibold">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Successfully imported {successCount} tracks into your library!</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-full text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={isLoading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-all shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Import Playlist</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
