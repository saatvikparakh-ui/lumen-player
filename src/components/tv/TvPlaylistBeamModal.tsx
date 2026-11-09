import React, { useState, useEffect } from 'react';
import { QrCode, Tv, Sparkles, CheckCircle2, X, UploadCloud, Radio, RefreshCw } from 'lucide-react';
import { TvBeamService, BeamedPlaylistPayload } from '../../services/tvBeamService';
import { PlaylistService } from '../../services/playlistService';
import { WatchSoundService } from '../../services/watchSoundService';

interface TvPlaylistBeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlaylistImported?: (playlistId: string) => void;
  dominantColor?: string;
}

export const TvPlaylistBeamModal: React.FC<TvPlaylistBeamModalProps> = ({
  isOpen,
  onClose,
  onPlaylistImported,
  dominantColor = '#63E8FF'
}) => {
  const [pin, setPin] = useState<string>('');
  const [status, setStatus] = useState<'listening' | 'received'>('listening');
  const [importedPlaylistName, setImportedPlaylistName] = useState<string>('');
  const [importedCount, setImportedCount] = useState<number>(0);

  // Generate session PIN on open
  useEffect(() => {
    if (!isOpen) return;
    setStatus('listening');
    const newPin = TvBeamService.generatePin();
    setPin(newPin);

    const unsub = TvBeamService.startTvSession(newPin, (payload: BeamedPlaylistPayload) => {
      // Create playlist on TV
      const pl = PlaylistService.createPlaylistWithTracks(
        payload.name || 'Beamed Playlist',
        payload.description || 'Imported via LUMEN TV Beam',
        payload.coverUrl || null,
        payload.tracks || []
      );

      WatchSoundService.playTick(1.2);
      setImportedPlaylistName(pl.name);
      setImportedCount(payload.tracks?.length || 0);
      setStatus('received');

      setTimeout(() => {
        if (onPlaylistImported) {
          onPlaylistImported(pl.id);
        }
        onClose();
      }, 2500);
    });

    return () => {
      unsub();
    };
  }, [isOpen, onPlaylistImported, onClose]);

  if (!isOpen) return null;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://lumen-music.web.app';
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  const portalUrl = `${currentOrigin}${currentPath}?beam=${pin}`;
  const qrCodeImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&bgcolor=080A10&color=63E8FF&margin=10&data=${encodeURIComponent(portalUrl)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fadeIn select-none">
      <div 
        className="relative w-full max-w-2xl rounded-3xl bg-[#090D18] border-2 border-white/20 p-8 shadow-[0_25px_80px_rgba(0,0,0,0.95)] overflow-hidden"
        style={{
          boxShadow: `0 25px 80px rgba(0, 0, 0, 0.95), 0 0 50px -10px ${dominantColor}50`
        }}
      >
        {/* Close Button */}
        <button
          tabIndex={0}
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all cursor-pointer focus:outline-none focus:ring-4 focus:ring-lumen-cyan"
          title="Close Modal"
        >
          <X className="w-5 h-5" />
        </button>

        {status === 'listening' ? (
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Left Column: Glowing QR Code */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div 
                className="w-56 h-56 rounded-2xl p-2.5 bg-[#080A10] border-2 border-lumen-cyan shadow-[0_0_35px_rgba(99,232,255,0.4)] flex items-center justify-center relative overflow-hidden"
              >
                <img 
                  src={qrCodeImageUrl} 
                  alt="Scan to Beam Playlist" 
                  className="w-full h-full object-contain rounded-xl"
                  loading="eager"
                />
              </div>

              {/* Broadcast Pulse */}
              <div className="flex items-center gap-2 mt-3 text-xs font-mono text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>TV Receiver Ready</span>
              </div>
            </div>

            {/* Right Column: Pairing Instructions & PIN */}
            <div className="flex-1 text-center md:text-left space-y-4">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lumen-cyan/15 text-lumen-cyan border border-lumen-cyan/30 text-xs font-mono font-bold uppercase tracking-wider mb-2">
                  <Radio className="w-3.5 h-3.5 animate-pulse" />
                  <span>Instant Wi-Fi / Cloud Beam</span>
                </div>
                <h3 className="text-2xl font-black font-syne text-white tracking-tight">
                  Beam Playlist to TV
                </h3>
                <p className="text-xs text-white/60 font-outfit mt-1">
                  Upload CSV files, paste Spotify links, or transfer tracklists from your phone to TV with zero typing!
                </p>
              </div>

              {/* 6-Digit PIN Display */}
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-center">
                <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-1">
                  Or enter PIN on your phone:
                </p>
                <div className="text-3xl font-black font-mono tracking-widest text-lumen-cyan drop-shadow-[0_0_15px_rgba(99,232,255,0.6)]">
                  {pin}
                </div>
              </div>

              {/* 3 Step Guidance */}
              <div className="space-y-1.5 text-xs text-white/70 font-outfit">
                <p className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-white/10 text-white font-mono text-[10px] flex items-center justify-center">1</span>
                  <span>Point your phone camera at the QR code</span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-white/10 text-white font-mono text-[10px] flex items-center justify-center">2</span>
                  <span>Upload a CSV file or paste any playlist link</span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-white/10 text-white font-mono text-[10px] flex items-center justify-center">3</span>
                  <span>Tap "Beam to TV" & it appears on this screen!</span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* SUCCESS STATE */
          <div className="py-8 text-center flex flex-col items-center justify-center space-y-4 animate-scaleUp">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.5)]">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-1">
              <h3 className="text-2xl font-black font-syne text-white tracking-tight">
                Playlist Received!
              </h3>
              <p className="text-sm font-syne font-bold text-lumen-cyan">
                "{importedPlaylistName}"
              </p>
              <p className="text-xs font-mono text-white/50">
                {importedCount} tracks successfully imported into your TV library.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
