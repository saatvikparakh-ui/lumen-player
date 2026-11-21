import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  HardDrive,
  Search,
  Disc3,
  ListMusic,
  Music2,
  X,
  ShieldCheck,
  Sparkles,
  Wrench,
  FolderDown
} from 'lucide-react';
import { Track, CustomPlaylist } from '../../types/music';
import { OfflineTrackRecord, OfflineVerificationResult } from '../../types/offlineTypes';
import { OfflineMediaRegistry } from '../../services/offlineMediaRegistry';
import { OfflineDownloadManager } from '../../services/offlineDownloadManager';
import { OfflineBackupManager } from '../../services/offlineBackupManager';
import { OfflineAuthorizationPolicy } from '../../services/offlineAuthorizationPolicy';
import { CoverImage } from '../common/CoverImage';
import { WatchSoundService } from '../../services/watchSoundService';

interface Props {
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  dominantColor: string;
  playlists: CustomPlaylist[];
  onOpenSettingsDownloads?: () => void;
  onBack?: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function recordToTrack(rec: OfflineTrackRecord): Track {
  return {
    id: rec.canonicalTrackId,
    title: rec.title,
    artist: rec.artist,
    album: rec.album || 'Offline Vault',
    duration: rec.duration || 0,
    artworkUrl: rec.albumArtworkReference,
    streamUrl: rec.storageReference,
    path: rec.storageReference,
    filename: `${rec.title}.${rec.codec || 'mp3'}`,
    hasArtwork: !!rec.albumArtworkReference,
    addedAt: rec.downloadedAt || Date.now(),
    playbackType: 'local'
  };
}

export const DownloadsView: React.FC<Props> = ({
  onPlayTrack,
  currentTrack,
  isPlaying,
  dominantColor,
  playlists,
  onOpenSettingsDownloads,
  onBack
}) => {
  const [records, setRecords] = useState<OfflineTrackRecord[]>(() => OfflineMediaRegistry.getAllRecords());
  const [settings, setSettings] = useState(() => OfflineMediaRegistry.getSettings());
  const [usage, setUsage] = useState(() => OfflineMediaRegistry.getStorageUsage());
  const [activeTab, setActiveTab] = useState<'songs' | 'albums' | 'playlists' | 'queue' | 'storage'>('songs');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastVerify, setLastVerify] = useState<OfflineVerificationResult | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const showBanner = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner(null), 4000);
  };

  useEffect(() => {
    OfflineDownloadManager.init().then(() => {
      setRecords(OfflineMediaRegistry.getAllRecords());
      setSettings(OfflineMediaRegistry.getSettings());
      setUsage(OfflineMediaRegistry.getStorageUsage());
    });
    const unsub = OfflineMediaRegistry.subscribe(() => {
      setRecords(OfflineMediaRegistry.getAllRecords());
      setSettings(OfflineMediaRegistry.getSettings());
      setUsage(OfflineMediaRegistry.getStorageUsage());
    });
    return () => unsub();
  }, []);

  const completedSongs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records
      .filter(r => r.downloadState === 'COMPLETED' && !r.needsRepair)
      .filter(r => !q || r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q) || (r.album || '').toLowerCase().includes(q));
  }, [records, searchQuery]);

  const queueRecords = useMemo(() => {
    return records.filter(r =>
      ['QUEUED', 'DOWNLOADING', 'PAUSED', 'WAITING_FOR_NETWORK', 'VERIFYING', 'FAILED'].includes(r.downloadState) ||
      r.needsRepair
    );
  }, [records]);

  const downloadedAlbums = useMemo(() => {
    const map = new Map<string, { album: string; artist: string; artworkUrl: string | null; tracks: OfflineTrackRecord[]; totalBytes: number }>();
    completedSongs.forEach(r => {
      const key = `${(r.album || 'Single').toLowerCase()}::${r.artist.toLowerCase()}`;
      const existing = map.get(key);
      if (existing) {
        existing.tracks.push(r);
        existing.totalBytes += r.storageSize || 0;
      } else {
        map.set(key, {
          album: r.album || 'Single',
          artist: r.artist,
          artworkUrl: r.albumArtworkReference,
          tracks: [r],
          totalBytes: r.storageSize || 0
        });
      }
    });
    return Array.from(map.values());
  }, [completedSongs]);

  const downloadedPlaylists = useMemo(() => {
    return playlists
      .map(pl => {
        const refTag = `playlist:${pl.id}`;
        const matching = records.filter(r => r.collectionRefs?.includes(refTag));
        const completed = matching.filter(r => r.downloadState === 'COMPLETED' && !r.needsRepair);
        if (matching.length === 0) return null;
        return {
          playlist: pl,
          totalTracks: pl.tracks.length,
          downloadedCount: completed.length,
          isComplete: pl.tracks.length > 0 && completed.length >= pl.tracks.length,
          tracks: completed
        };
      })
      .filter(Boolean) as Array<{
        playlist: CustomPlaylist;
        totalTracks: number;
        downloadedCount: number;
        isComplete: boolean;
        tracks: OfflineTrackRecord[];
      }>;
  }, [playlists, records]);

  const openLicenseDemoTracks = useMemo(() => OfflineAuthorizationPolicy.getOpenLicenseDemoCatalog(), []);

  const handleToggleOfflineMode = async () => {
    WatchSoundService.playTick(1.1);
    const next = !settings.offlineModeEnabled;
    await OfflineDownloadManager.setOfflineMode(next);
    showBanner(next ? 'Offline Mode enabled — playing downloaded tracks only.' : 'Offline Mode disabled — online streaming restored.');
  };

  const handleVerifyLibrary = async (fullChecksum: boolean) => {
    setIsVerifying(true);
    try {
      const res = await OfflineBackupManager.verifyOfflineLibrary(fullChecksum);
      setLastVerify(res);
      showBanner(
        res.missingCount === 0 && res.corruptedCount === 0
          ? `Verified ${res.validCount} offline track(s): all healthy.`
          : `Found ${res.missingCount} missing and ${res.corruptedCount} corrupted asset(s). Tap Repair to restore.`
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDownloadOpenLicensePack = async () => {
    WatchSoundService.playTick(1.2);
    const res = await OfflineDownloadManager.downloadCollection(
      'album',
      'lumen_open_license_pack',
      'Lumen Open-License Vault Pack',
      openLicenseDemoTracks
    );
    showBanner(res.message);
    setActiveTab('queue');
  };

  const budgetPercent = usage.budgetBytes > 0 ? Math.min(100, Math.round((usage.usedBytes / usage.budgetBytes) * 100)) : 0;

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 pb-32 pt-4 space-y-5 animate-fadeIn">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/12 backdrop-blur-2xl shadow-xl">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
              title="Back"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 border border-white/20 shadow-lg"
            style={{ background: `linear-gradient(135deg, ${dominantColor || '#22d3ee'}33, rgba(255,255,255,0.06))` }}
          >
            <FolderDown className="w-5 h-5 text-lumen-cyan" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-xl font-syne font-black text-white tracking-tight truncate">
              Offline Downloads Vault
            </h2>
            <p className="text-[11px] sm:text-xs text-white/55 truncate">
              {usage.completedCount} track{usage.completedCount === 1 ? '' : 's'} • {formatBytes(usage.usedBytes)} in private Lumen storage
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleToggleOfflineMode}
            className={`px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
              settings.offlineModeEnabled
                ? 'bg-amber-400/20 text-amber-200 border-amber-400/50 shadow-md'
                : 'bg-white/10 text-white/80 hover:text-white border-white/15 hover:bg-white/15'
            }`}
          >
            <WifiOff className="w-3.5 h-3.5" />
            <span>{settings.offlineModeEnabled ? 'Offline Mode ON' : 'Offline Mode'}</span>
          </button>

          {onOpenSettingsDownloads && (
            <button
              type="button"
              onClick={onOpenSettingsDownloads}
              className="px-3.5 py-2 rounded-full text-xs font-semibold bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-white/15 transition-all cursor-pointer"
            >
              Download Settings
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {statusBanner && (
        <div className="px-4 py-2.5 rounded-2xl bg-lumen-cyan/15 border border-lumen-cyan/35 text-xs text-cyan-100 font-medium flex items-center justify-between gap-2 animate-fadeIn">
          <span className="truncate">{statusBanner}</span>
          <button type="button" onClick={() => setStatusBanner(null)} className="text-white/60 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'songs', label: 'Songs', count: completedSongs.length, icon: Music2 },
          { id: 'albums', label: 'Albums', count: downloadedAlbums.length, icon: Disc3 },
          { id: 'playlists', label: 'Playlists', count: downloadedPlaylists.length, icon: ListMusic },
          { id: 'queue', label: 'Active & Queue', count: queueRecords.length, icon: Download },
          { id: 'storage', label: 'Storage & Recovery', count: null, icon: HardDrive }
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 flex-shrink-0 transition-all cursor-pointer border ${
                active
                  ? 'bg-white text-black border-white shadow-md'
                  : 'bg-white/[0.05] text-white/70 hover:text-white border-white/10 hover:bg-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.count !== null && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${active ? 'bg-black/15 text-black' : 'bg-white/10 text-white/60'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search within downloaded music */}
      {activeTab === 'songs' && completedSongs.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search downloaded tracks, artists, or albums offline..."
            className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 focus:border-lumen-cyan/60 text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* TAB 1: DOWNLOADED SONGS */}
      {activeTab === 'songs' && (
        <div className="space-y-3">
          {completedSongs.length === 0 ? (
            <div className="p-6 sm:p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-lumen-cyan">
                <Download className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-sm font-bold text-white">No Offline Downloads Yet</h3>
                <p className="text-xs text-white/55">
                  Lumen never downloads music automatically. Choose any user-owned local file or open-license track to save it privately inside Lumen's offline vault (hidden from your phone's public Downloads folder).
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadOpenLicensePack}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-black font-bold text-xs shadow-lg hover:bg-white/90 active:scale-95 transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Download Open-License Vault Pack (3 Tracks)</span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-white/50 font-mono">{completedSongs.length} offline tracks ready</span>
                <button
                  type="button"
                  onClick={() => {
                    const queue = completedSongs.map(recordToTrack);
                    if (queue.length > 0) onPlayTrack(queue[0], queue);
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-white text-black font-bold text-xs flex items-center gap-1.5 hover:bg-white/90 active:scale-95 transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                  <span>Play All Offline</span>
                </button>
              </div>
              <div className="space-y-2">
                {completedSongs.map(rec => {
                  const trackObj = recordToTrack(rec);
                  const active = currentTrack?.id === rec.canonicalTrackId && isPlaying;
                  return (
                    <div
                      key={rec.canonicalTrackId}
                      onClick={() => onPlayTrack(trackObj, completedSongs.map(recordToTrack))}
                      className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                          <CoverImage
                            src={rec.albumArtworkReference}
                            alt={rec.title}
                            title={rec.title}
                            artist={rec.artist}
                            album={rec.album}
                            size={120}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs sm:text-sm font-bold truncate ${active ? 'text-lumen-cyan' : 'text-white'}`}>
                              {rec.title}
                            </span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          </div>
                          <div className="text-[11px] text-white/55 truncate">
                            {rec.artist} • {formatBytes(rec.storageSize)} • {rec.codec.toUpperCase()}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async e => {
                          e.stopPropagation();
                          const res = await OfflineDownloadManager.removeDownload(rec.canonicalTrackId);
                          showBanner(res.message);
                        }}
                        className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/50 hover:text-rose-300 border border-white/10 transition-colors cursor-pointer flex-shrink-0"
                        title="Remove offline copy"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: DOWNLOADED ALBUMS */}
      {activeTab === 'albums' && (
        <div className="space-y-2.5">
          {downloadedAlbums.length === 0 ? (
            <div className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center text-xs text-white/45">
              No downloaded albums yet. Open an artist's discography or download the Open-License Vault Pack to store albums offline.
            </div>
          ) : (
            downloadedAlbums.map(alb => (
              <div
                key={`${alb.album}_${alb.artist}`}
                className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/[0.04] border border-white/10"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/60 border border-white/15 flex-shrink-0">
                    <CoverImage
                      src={alb.artworkUrl}
                      alt={alb.album}
                      title={alb.album}
                      artist={alb.artist}
                      album={alb.album}
                      size={160}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-white line-clamp-2 leading-snug">{alb.album}</h4>
                    <p className="text-[11px] text-white/55 truncate mt-0.5">
                      {alb.artist} • {alb.tracks.length} track{alb.tracks.length === 1 ? '' : 's'} • {formatBytes(alb.totalBytes)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const q = alb.tracks.map(recordToTrack);
                    if (q.length > 0) onPlayTrack(q[0], q);
                  }}
                  className="px-3.5 py-2 rounded-full bg-white text-black font-bold text-xs flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                  <span>Play</span>
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: DOWNLOADED PLAYLISTS */}
      {activeTab === 'playlists' && (
        <div className="space-y-2.5">
          {downloadedPlaylists.length === 0 ? (
            <div className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center text-xs text-white/45">
              No playlists have been downloaded yet. Open any playlist and tap "Download Offline" to save eligible tracks.
            </div>
          ) : (
            downloadedPlaylists.map(item => (
              <div
                key={item.playlist.id}
                className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/[0.04] border border-white/10"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-white truncate">{item.playlist.name}</h4>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      item.isComplete
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/35'
                    }`}>
                      {item.isComplete ? 'Complete' : `Partial (${item.downloadedCount}/${item.totalTracks})`}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/50 mt-0.5">
                    {item.downloadedCount} offline track{item.downloadedCount === 1 ? '' : 's'} ready without internet
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const q = item.tracks.map(recordToTrack);
                      if (q.length > 0) onPlayTrack(q[0], q);
                    }}
                    className="px-3 py-1.5 rounded-full bg-white text-black font-bold text-xs cursor-pointer"
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await OfflineDownloadManager.removeCollectionDownloads('playlist', item.playlist.id);
                      showBanner(`Removed offline reference for "${item.playlist.name}".`);
                    }}
                    className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/50 hover:text-rose-300 border border-white/10 cursor-pointer"
                    title="Remove playlist downloads"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 4: ACTIVE, PAUSED & FAILED DOWNLOAD QUEUE */}
      {activeTab === 'queue' && (
        <div className="space-y-3">
          {queueRecords.length === 0 ? (
            <div className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 text-center space-y-3">
              <p className="text-xs text-white/50">No active, paused, or failed downloads in the queue.</p>
              <button
                type="button"
                onClick={handleDownloadOpenLicensePack}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-white border border-white/15 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-lumen-cyan" />
                <span>Test Download Queue (Open-License Pack)</span>
              </button>
            </div>
          ) : (
            queueRecords.map(rec => {
              const isPausedOrFailed = rec.downloadState === 'PAUSED' || rec.downloadState === 'FAILED' || rec.downloadState === 'WAITING_FOR_NETWORK' || rec.needsRepair;
              return (
                <div key={rec.canonicalTrackId} className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-white truncate">{rec.title}</span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          rec.downloadState === 'FAILED' || rec.needsRepair
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/35'
                            : rec.downloadState === 'PAUSED' || rec.downloadState === 'WAITING_FOR_NETWORK'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/35'
                            : 'bg-cyan-500/20 text-cyan-200 border-cyan-500/35'
                        }`}>
                          {rec.needsRepair ? 'NEEDS REPAIR' : rec.downloadState.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/55 truncate mt-0.5">
                        {rec.artist} • {formatBytes(rec.downloadedBytes)}{rec.totalBytes > 0 ? ` / ${formatBytes(rec.totalBytes)}` : ''} ({rec.downloadProgress}%)
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {rec.needsRepair ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const r = await OfflineDownloadManager.repairDownload(rec.canonicalTrackId);
                            showBanner(r.message);
                          }}
                          className="px-3 py-1.5 rounded-full bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 border border-amber-400/40 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Wrench className="w-3 h-3" />
                          <span>Repair</span>
                        </button>
                      ) : isPausedOrFailed ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const r = await OfflineDownloadManager.resumeDownload(rec.canonicalTrackId);
                            showBanner(r.message);
                          }}
                          className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-black" />
                          <span>Resume</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => OfflineDownloadManager.pauseDownload(rec.canonicalTrackId)}
                          className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1 border border-white/15 cursor-pointer"
                        >
                          <Pause className="w-3 h-3" />
                          <span>Pause</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => OfflineDownloadManager.cancelDownload(rec.canonicalTrackId)}
                        className="p-1.5 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/50 hover:text-rose-300 border border-white/10 cursor-pointer"
                        title="Cancel download"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{
                        width: `${Math.max(2, rec.downloadProgress)}%`,
                        backgroundColor: rec.downloadState === 'FAILED' || rec.needsRepair ? '#fb7185' : (dominantColor || '#22d3ee')
                      }}
                    />
                  </div>

                  {rec.downloadError && (
                    <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>{rec.downloadError}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 5: STORAGE & RECOVERY */}
      {activeTab === 'storage' && (
        <div className="space-y-4">
          <div className="p-5 rounded-3xl bg-white/[0.04] border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <HardDrive className="w-5 h-5 text-lumen-cyan" />
                <div>
                  <h4 className="text-sm font-bold text-white">Private Vault Storage Usage</h4>
                  <p className="text-[11px] text-white/55">
                    Stored exclusively inside Lumen's private sandbox — never shown in Android Downloads or MediaStore.
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-lumen-cyan">
                {formatBytes(usage.usedBytes)} / {formatBytes(usage.budgetBytes)}
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${budgetPercent}%`,
                  background: budgetPercent > 90 ? '#fb7185' : `linear-gradient(90deg, ${dominantColor || '#22d3ee'}, #3b82f6)`
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/50">
              <span>{usage.completedCount} verified tracks • {usage.needsRepairCount} needing repair</span>
              {usage.deviceAvailableBytes !== null && (
                <span>Device free space: {formatBytes(usage.deviceAvailableBytes)}</span>
              )}
            </div>
          </div>

          {/* Integrity & Recovery Actions */}
          <div className="p-5 rounded-3xl bg-white/[0.04] border border-white/10 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h4 className="text-sm font-bold text-white">Offline Integrity & Backup Recovery</h4>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
              Lumen verifies private audio files against their SHA-256 checksums and preserves your index across restarts and app updates. Uninstalling Lumen deletes private app audio by Android/OS design, so your selection manifest can be backed up separately for manual re-download of authorized sources.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isVerifying}
                onClick={() => handleVerifyLibrary(true)}
                className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/15 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>{isVerifying ? 'Verifying Checksums...' : 'Verify SHA-256 Integrity'}</span>
              </button>

              {!confirmClearAll ? (
                <button
                  type="button"
                  disabled={records.length === 0}
                  onClick={() => setConfirmClearAll(true)}
                  className="px-4 py-2 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove All Downloads</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await OfflineDownloadManager.removeAllDownloads();
                      setConfirmClearAll(false);
                      showBanner('All offline downloads permanently removed.');
                    }}
                    className="px-4 py-2 rounded-full bg-rose-500 text-white text-xs font-black cursor-pointer"
                  >
                    Confirm Wipe All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-3 py-2 rounded-full bg-white/10 text-white/70 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {lastVerify && (
              <div className="text-[11px] font-mono text-white/60 pt-2 border-t border-white/10">
                Last check: {lastVerify.validCount}/{lastVerify.checkedCount} valid • {lastVerify.missingCount} missing • {lastVerify.corruptedCount} corrupted
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
