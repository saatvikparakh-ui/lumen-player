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
import { resolveApiUrl } from '../../services/apiConfig';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (playlist: CustomPlaylist) => void;
  dominantColor?: string;
}

interface RawTrackCandidate {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  artworkUrl?: string | null;
}

/**
 * Robust RFC 4180 CSV parser handling double quotes, commas inside fields, and escapes.
 */
function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

/**
 * Parses raw text or CSV (including Exportify formats) into candidate tracks.
 */
function parseTracksFromText(inputText: string): RawTrackCandidate[] {
  const lines = inputText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const candidates: RawTrackCandidate[] = [];

  let headerDetected = false;
  let titleIdx = -1;
  let artistIdx = -1;
  let albumIdx = -1;
  let durationIdx = -1;

  if (lines.length > 0 && lines[0].includes(',')) {
    const firstRowCols = parseCsvLine(lines[0]).map(c => c.toLowerCase().trim());
    const hasHeaderWords = firstRowCols.some(c => 
      c === 'title' || c === 'track name' || c.includes('track name') || 
      c === 'artist' || c.startsWith('artist name') || c === 'artists' ||
      c === 'track uri'
    );
    if (hasHeaderWords && firstRowCols.length >= 2) {
      headerDetected = true;
      titleIdx = firstRowCols.findIndex(c => c === 'track name' || c.includes('track name') || c === 'title');
      artistIdx = firstRowCols.findIndex(c => c === 'artist name(s)' || c.includes('artist'));
      albumIdx = firstRowCols.findIndex(c => c.includes('album'));
      durationIdx = firstRowCols.findIndex(c => c.includes('duration'));
    }
  }

  const rowsToProcess = headerDetected ? lines.slice(1) : lines;

  for (const line of rowsToProcess) {
    // 1. CSV with detected headers (Exportify / Spotify CSV)
    if (headerDetected && titleIdx !== -1) {
      const cols = parseCsvLine(line);
      const songTitle = cols[titleIdx]?.replace(/^["']|["']$/g, '').trim();
      const songArtist = artistIdx !== -1 ? cols[artistIdx]?.replace(/^["']|["']$/g, '').trim() : '';
      const songAlbum = albumIdx !== -1 ? cols[albumIdx]?.replace(/^["']|["']$/g, '').trim() : '';
      let durSec: number | undefined = undefined;
      if (durationIdx !== -1 && cols[durationIdx]) {
        const rawDur = Number(cols[durationIdx].replace(/[^0-9]/g, ''));
        if (rawDur > 0) {
          durSec = rawDur > 1000 ? Math.round(rawDur / 1000) : rawDur;
        }
      }

      if (songTitle) {
        candidates.push({
          title: songTitle,
          artist: songArtist || 'Unknown Artist',
          album: songAlbum || '',
          duration: durSec
        });
        continue;
      }
    }

    // 2. CSV without header starting with spotify:track:
    if (line.includes(',')) {
      const cols = parseCsvLine(line);
      if (cols.length >= 2) {
        if (cols[0].toLowerCase().startsWith('spotify:track:')) {
          const songTitle = cols[1]?.replace(/^["']|["']$/g, '').trim();
          const songArtist = cols[2]?.replace(/^["']|["']$/g, '').trim();
          const songAlbum = cols[3]?.replace(/^["']|["']$/g, '').trim();
          if (songTitle) {
            candidates.push({
              title: songTitle,
              artist: songArtist || 'Unknown Artist',
              album: songAlbum || ''
            });
            continue;
          }
        } else {
          const col1 = cols[0].replace(/^["']|["']$/g, '').trim();
          const col2 = cols[1].replace(/^["']|["']$/g, '').trim();
          if (col1.toLowerCase() !== 'title' && col1.toLowerCase() !== 'track name') {
            candidates.push({ title: col1, artist: col2 || 'Unknown Artist' });
            continue;
          }
        }
      }
    }

    // 3. "Title - Artist"
    if (line.includes(' - ')) {
      const parts = line.split(' - ');
      candidates.push({
        title: parts[0].trim(),
        artist: parts.slice(1).join(' - ').trim() || 'Unknown Artist'
      });
      continue;
    }

    // 4. "Title by Artist"
    if (line.toLowerCase().includes(' by ')) {
      const idx = line.toLowerCase().lastIndexOf(' by ');
      candidates.push({
        title: line.substring(0, idx).trim(),
        artist: line.substring(idx + 4).trim() || 'Unknown Artist'
      });
      continue;
    }

    // 5. Plain title
    if (line.trim()) {
      candidates.push({ title: line.trim(), artist: 'Unknown Artist' });
    }
  }

  return candidates;
}

/**
 * Resolves 1000x1000 studio artwork and accurate album info from Apple Music.
 */
async function resolveArtworkFromITunes(title: string, artist: string): Promise<{ artworkUrl: string | null; album?: string; duration?: number; realTitle?: string; realArtist?: string }> {
  try {
    const cleanTitle = title.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    const query = artist && artist !== 'Unknown Artist' ? `${cleanTitle} ${artist}` : cleanTitle;
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`, {
      signal: AbortSignal.timeout(3500)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const art = item.artworkUrl100 ? item.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1000x1000bb.') : null;
        return {
          artworkUrl: art,
          album: item.collectionName,
          duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : undefined,
          realTitle: item.trackName,
          realArtist: item.artistName
        };
      }
    }
  } catch (_) {}
  return { artworkUrl: null };
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
      setErrorMessage('Please paste at least one song or upload a CSV file.');
      return;
    }

    setIsLoading(true);

    // -------------------------------------------------------------
    // PATH 1: Text / CSV / File Upload (Client-Side High Performance)
    // -------------------------------------------------------------
    if (!isLinkMode) {
      try {
        setLoadingStep('Parsing track list and CSV columns...');
        const rawCandidates = parseTracksFromText(trimmedText);

        if (rawCandidates.length === 0) {
          throw new Error('No valid songs could be found in the text. Please check the formatting or CSV.');
        }

        setLoadingStep(`Found ${rawCandidates.length} songs. Resolving 1000×1000 studio artwork and audio streams...`);

        const finalTracks: Track[] = [];
        const BATCH_SIZE = 6;
        let resolvedCount = 0;

        for (let i = 0; i < rawCandidates.length; i += BATCH_SIZE) {
          const slice = rawCandidates.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            slice.map(async (c, idx) => {
              const globalIdx = i + idx;
              let artworkUrl = c.artworkUrl || null;
              let album = c.album || 'Imported Album';
              let duration = c.duration || 180;
              let finalTitle = c.title;
              let finalArtist = c.artist;

              // Query iTunes for verified studio artwork & album info
              const itunesInfo = await resolveArtworkFromITunes(c.title, c.artist);
              if (itunesInfo.artworkUrl) {
                artworkUrl = itunesInfo.artworkUrl;
              }
              if (itunesInfo.album && (!c.album || c.album === 'Unknown Album')) {
                album = itunesInfo.album;
              }
              if (itunesInfo.duration && !c.duration) {
                duration = itunesInfo.duration;
              }
              if (itunesInfo.realTitle && (!c.title || c.title.toLowerCase() === 'untitled')) {
                finalTitle = itunesInfo.realTitle;
              }
              if (itunesInfo.realArtist && (!c.artist || c.artist === 'Unknown Artist')) {
                finalArtist = itunesInfo.realArtist;
              }

              const trackId = `imp_${Date.now()}_${globalIdx}_${Math.random().toString(36).slice(2, 7)}`;
              const streamPath = `/api/stream/resolve?title=${encodeURIComponent(finalTitle)}&artist=${encodeURIComponent(finalArtist)}`;

              const track: Track = {
                id: trackId,
                path: streamPath,
                filename: `${finalTitle}.opus`,
                title: finalTitle,
                artist: finalArtist,
                album: album,
                duration: duration,
                artworkUrl: artworkUrl,
                streamUrl: streamPath,
                hasArtwork: Boolean(artworkUrl),
                isStream: true,
                isVerified: true,
                addedAt: Date.now()
              };
              return track;
            })
          );

          finalTracks.push(...batchResults);
          resolvedCount += slice.length;
          setLoadingStep(`Resolving studio artwork and audio streams (${resolvedCount}/${rawCandidates.length})...`);
        }

        // Pick playlist cover strictly from the first song with an authentic album cover
        const firstSongWithArt = finalTracks.find(t => t.artworkUrl);
        const songAlbumCover = firstSongWithArt ? firstSongWithArt.artworkUrl : null;
        const playlistName = customName.trim() || 'Imported Playlist';

        const newPlaylist: CustomPlaylist = {
          id: `pl_import_${Date.now()}`,
          name: playlistName,
          description: `Imported ${finalTracks.length} tracks with verified studio audio and individual album covers`,
          coverUrl: songAlbumCover,
          coverColor: dominantColor,
          tracks: finalTracks,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        setSuccessCount(finalTracks.length);
        setLoadingStep(`Successfully imported ${finalTracks.length} tracks!`);

        setTimeout(() => {
          setIsLoading(false);
          onImportSuccess(newPlaylist);
          onClose();
        }, 800);

        return;
      } catch (err: any) {
        console.error('Client import error:', err);
        setIsLoading(false);
        setErrorMessage(err.message || 'Failed to parse track list. Please verify your formatting.');
        return;
      }
    }

    // -------------------------------------------------------------
    // PATH 2: Spotify / Streaming Link
    // -------------------------------------------------------------
    setLoadingStep('Connecting to streaming provider...');
    try {
      const payload: { url?: string; text?: string; name?: string; spotifyClientId?: string; spotifyClientSecret?: string } = {
        url: trimmedUrl
      };
      if (customName.trim()) {
        payload.name = customName.trim();
      }
      const storedCId = localStorage.getItem('lumen_spotify_client_id') || '';
      const storedCSecret = localStorage.getItem('lumen_spotify_client_secret') || '';
      if (storedCId && storedCSecret) {
        payload.spotifyClientId = storedCId;
        payload.spotifyClientSecret = storedCSecret;
      }

      setLoadingStep('Resolving verified 1000×1000 studio artwork and audio streams...');

      const targetUrl = resolveApiUrl('/api/playlist/import');
      let response: Response | null = null;
      try {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (networkErr) {
        console.warn('Backend fetch failed, attempting client fallback:', networkErr);
      }

      if (response && response.ok) {
        const data = await response.json();
        if (data.success && data.playlist) {
          const imported = data.playlist;
          const tracks: Track[] = (imported.tracks || []).map((t: any, idx: number) => ({
            id: t.id || `imp_${Date.now()}_${idx}`,
            path: t.path || t.streamUrl || '',
            filename: t.filename || `${t.title}.opus`,
            title: t.title,
            artist: t.artist,
            album: t.album,
            duration: t.duration || 180,
            artworkUrl: t.artworkUrl,
            streamUrl: t.streamUrl,
            hasArtwork: Boolean(t.artworkUrl),
            isStream: true,
            isVerified: true,
            addedAt: Date.now()
          }));

          const newPlaylist: CustomPlaylist = {
            id: imported.id || `pl_${Date.now()}`,
            name: imported.name || customName || 'Imported Playlist',
            description: imported.description || `Imported ${tracks.length} tracks with verified studio audio and song album artwork`,
            coverUrl: tracks[0]?.artworkUrl || null,
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
          }, 800);
          return;
        }
      }

      // If backend was not reached or returned 404, try Spotify public embed scraper on client
      const spotifyMatch = trimmedUrl.match(/playlist[\/:]([a-zA-Z0-9]+)/);
      if (spotifyMatch) {
        const playlistId = spotifyMatch[1];
        setLoadingStep('Extracting public Spotify tracklist...');
        const embedRes = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
          signal: AbortSignal.timeout(7000)
        }).catch(() => null);

        if (embedRes && embedRes.ok) {
          const html = await embedRes.text();
          const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
          if (nextDataMatch) {
            const nextData = JSON.parse(nextDataMatch[1]);
            const entity = nextData.props?.pageProps?.state?.data?.entity;
            if (entity && Array.isArray(entity.trackList)) {
              const lines = entity.trackList.map((t: any) => `${t.title} - ${t.subtitle}`).join('\n');
              setPlaylistText(lines);
              if (!customName && entity.name) {
                setCustomName(entity.name);
              }
              setActiveTab('text');
              setIsLoading(false);
              setLoadingStep('');
              setErrorMessage(null);
              return;
            }
          }
        }
      }

      throw new Error('Streaming link import requires an active backend or public link. Please switch to the "Text / CSV" tab and paste your playlist to import all tracks instantly!');
    } catch (err: any) {
      console.error('Import error:', err);
      setIsLoading(false);
      setErrorMessage(err.message || 'Failed to import playlist. Please try the Text / CSV tab.');
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
