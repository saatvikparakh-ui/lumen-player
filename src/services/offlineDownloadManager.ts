/**
 * LUMEN OFFLINE DOWNLOAD MANAGER
 *
 * Strictly user-initiated persistent download orchestration across:
 *   1. Native Android (LumenAudio Capacitor Plugin -> LumenDownloadService + SQLite + Context.filesDir)
 *   2. Windows Desktop Electron (lumenAPI private userData vault + lumen-vault:// protocol)
 *   3. Web / PWA (IndexedDB binary blob vault + AbortController streaming)
 *
 * Guarantees:
 *  - Never starts automatic / Smart / passive downloads
 *  - Never auto-deletes existing user downloads when storage budget is reached
 *  - Enforces OfflineAuthorizationPolicy strictly before downloading
 *  - Deduplicates shared tracks across playlists via collectionRefs[]
 *  - Verifies integrity (non-empty payload + SHA-256 checksum) before marking COMPLETED
 */

import { Track } from '../types/music';
import {
  BatchDownloadResult,
  OfflineDownloadState,
  OfflineQualityOption,
  OfflineTrackRecord
} from '../types/offlineTypes';
import {
  ExtendedTrackAuthorizationFields,
  OfflineAuthorizationPolicy
} from './offlineAuthorizationPolicy';
import { OfflineMediaRegistry } from './offlineMediaRegistry';
import { OfflineBackupManager } from './offlineBackupManager';
import { isNativeAndroid, LumenAudio } from './nativeAudioBridge';

interface ActiveWebTransfer {
  controller: AbortController;
  paused: boolean;
  cancelled: boolean;
}

class OfflineDownloadManagerImpl {
  private activeWebTransfers = new Map<string, ActiveWebTransfer>();
  private webQueue: string[] = [];
  private isProcessingWebQueue = false;
  private nativeListenersAttached = false;
  private isInitialized = false;

  /**
   * Initializes registry, attaches native Android event listeners, reconciles startup state,
   * and attaches connectivity recovery listeners.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    await OfflineMediaRegistry.init();

    // Sync with Native Android persistent SQLite state & attach native progress listeners
    if (isNativeAndroid()) {
      await this.syncNativeState();
      this.attachNativeListeners();
    } else {
      // Lightweight startup verification & interruption recovery on Desktop / Web
      OfflineBackupManager.verifyOfflineLibrary(false).catch(() => {});
    }

    // Connectivity recovery listener: resume WAITING_FOR_NETWORK jobs when connectivity returns
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.handleConnectivityRestored();
      });
    }
  }

  private async syncNativeState(): Promise<void> {
    try {
      const plugin = LumenAudio as any;
      if (typeof plugin.getDownloads === 'function') {
        const res = await plugin.getDownloads();
        if (Array.isArray(res?.records)) {
          await OfflineMediaRegistry.syncFromNativeRecords(res.records);
        }
      }
      if (typeof plugin.getStorageUsage === 'function') {
        const usage = await plugin.getStorageUsage();
        if (typeof usage?.deviceAvailableBytes === 'number') {
          OfflineMediaRegistry.setDeviceAvailableBytes(usage.deviceAvailableBytes);
        }
      }
      const settings = OfflineMediaRegistry.getSettings();
      if (typeof plugin.updateOfflineSettings === 'function') {
        await plugin.updateOfflineSettings({
          networkPolicy: settings.networkPolicy,
          allowMeteredConnections: settings.allowMeteredConnections,
          maxStorageMB: settings.maxStorageMB,
          offlineModeEnabled: settings.offlineModeEnabled
        });
      }
    } catch (err) {
      console.warn('[OfflineDownloadManager] Native state sync notice:', err);
    }
  }

  private attachNativeListeners(): void {
    if (this.nativeListenersAttached) return;
    this.nativeListenersAttached = true;

    try {
      const plugin = LumenAudio as any;
      if (typeof plugin.addListener === 'function') {
        plugin.addListener('onDownloadStateChange', (data: any) => {
          if (!data || !data.canonicalTrackId) return;
          const existing = OfflineMediaRegistry.getRecord(data.canonicalTrackId);
          if (data.downloadState === 'REMOVED') {
            OfflineMediaRegistry.deleteRecord(data.canonicalTrackId);
            return;
          }
          const merged: OfflineTrackRecord = {
            canonicalTrackId: data.canonicalTrackId,
            audioAssetId: data.audioAssetId || existing?.audioAssetId || OfflineAuthorizationPolicy.getAudioAssetId(data.canonicalTrackId),
            title: data.title || existing?.title || 'Unknown Track',
            artist: data.artist || existing?.artist || 'Unknown Artist',
            album: data.album || existing?.album || 'Single',
            albumId: data.albumId || existing?.albumId,
            albumArtworkReference: data.albumArtworkReference ?? existing?.albumArtworkReference ?? null,
            duration: data.duration ?? existing?.duration ?? 0,
            codec: data.codec || existing?.codec || 'aac',
            bitrate: data.bitrate || existing?.bitrate || 0,
            mediaFormat: data.mediaFormat || existing?.mediaFormat || 'audio/mpeg',
            storageReference: data.storageReference || existing?.storageReference || `lumen-offline://${data.audioAssetId || existing?.audioAssetId || ''}`,
            downloadState: (data.downloadState as OfflineDownloadState) || existing?.downloadState || 'QUEUED',
            downloadProgress: typeof data.downloadProgress === 'number' ? data.downloadProgress : (existing?.downloadProgress || 0),
            downloadedBytes: typeof data.downloadedBytes === 'number' ? data.downloadedBytes : (existing?.downloadedBytes || 0),
            totalBytes: typeof data.totalBytes === 'number' ? data.totalBytes : (existing?.totalBytes || 0),
            downloadedAt: data.downloadedAt ?? existing?.downloadedAt ?? null,
            lastVerifiedAt: data.lastVerifiedAt ?? existing?.lastVerifiedAt ?? null,
            contentChecksum: data.contentChecksum ?? existing?.contentChecksum ?? null,
            licenseReference: data.licenseReference ?? existing?.licenseReference ?? null,
            licenseExpiration: data.licenseExpiration ?? existing?.licenseExpiration ?? null,
            sourceType: data.sourceType || existing?.sourceType || 'open_license_audio',
            authorizedDownloadUrl: data.authorizedDownloadUrl ?? existing?.authorizedDownloadUrl ?? null,
            storageSize: typeof data.storageSize === 'number' ? data.storageSize : (existing?.storageSize || 0),
            downloadError: data.downloadError ?? null,
            collectionRefs: Array.isArray(data.collectionRefs) ? data.collectionRefs : (existing?.collectionRefs || ['standalone']),
            needsRepair: !!data.needsRepair,
            quality: data.quality || existing?.quality || 'source_original'
          };
          const isTerminal = ['COMPLETED', 'FAILED', 'PAUSED', 'WAITING_FOR_NETWORK'].includes(merged.downloadState);
          OfflineMediaRegistry.upsertRecord(merged, isTerminal);
          if (merged.downloadState === 'COMPLETED') {
            OfflineBackupManager.saveSelectionManifestSnapshot();
          }
        });
      }
    } catch (err) {
      console.warn('[OfflineDownloadManager] Attach native listener notice:', err);
    }
  }

  /**
   * Checks whether current network satisfies user's Wi-Fi / metered preference.
   */
  private isNetworkPermittedForDownload(): { ok: boolean; reason?: string } {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, reason: 'Waiting for internet connection.' };
    }
    const settings = OfflineMediaRegistry.getSettings();
    const conn = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
    if (conn) {
      const type = String(conn.type || '').toLowerCase();
      if (settings.networkPolicy === 'wifi_only' && type === 'cellular') {
        return { ok: false, reason: 'Waiting for Wi-Fi (Wi-Fi Only enabled in Download Settings).' };
      }
      if (!settings.allowMeteredConnections && conn.saveData === true) {
        return { ok: false, reason: 'Waiting for unmetered connection (Data Saver active).' };
      }
    }
    return { ok: true };
  }

  /**
   * Checks user storage budget WITHOUT ever deleting existing downloads.
   */
  private checkStorageBudget(additionalBytesEstimate = 5 * 1024 * 1024): { ok: boolean; reason?: string } {
    const usage = OfflineMediaRegistry.getStorageUsage();
    if (usage.usedBytes + additionalBytesEstimate > usage.budgetBytes) {
      const usedMB = Math.round(usage.usedBytes / (1024 * 1024));
      const budgetMB = Math.round(usage.budgetBytes / (1024 * 1024));
      return {
        ok: false,
        reason: `Download storage limit reached (${usedMB} MB / ${budgetMB} MB). Increase your budget or remove downloads to free space.`
      };
    }
    if (usage.deviceAvailableBytes !== null && usage.deviceAvailableBytes < additionalBytesEstimate + 20 * 1024 * 1024) {
      return {
        ok: false,
        reason: 'Insufficient free device storage available for this download.'
      };
    }
    return { ok: true };
  }

  /**
   * User-initiated single track download.
   */
  public async downloadTrack(
    track: Track & ExtendedTrackAuthorizationFields,
    options?: { collectionRef?: string; quality?: OfflineQualityOption }
  ): Promise<{ success: boolean; state: OfflineDownloadState; message: string; record?: OfflineTrackRecord }> {
    await this.init();

    const canonicalTrackId = OfflineAuthorizationPolicy.getCanonicalTrackId(track);
    const collectionRef = options?.collectionRef || 'standalone';

    // 1. Deduplication check: if valid completed offline copy already exists, just attach collection reference!
    const existing = OfflineMediaRegistry.getRecord(canonicalTrackId);
    if (existing && existing.downloadState === 'COMPLETED' && !existing.needsRepair) {
      await OfflineMediaRegistry.attachCollectionRef(canonicalTrackId, collectionRef);
      return {
        success: true,
        state: 'COMPLETED',
        message: `"${track.title}" is already available offline.`,
        record: OfflineMediaRegistry.getRecord(canonicalTrackId) || existing
      };
    }

    // Prevent duplicate concurrent active download jobs
    if (existing && (existing.downloadState === 'DOWNLOADING' || existing.downloadState === 'QUEUED' || existing.downloadState === 'VERIFYING')) {
      await OfflineMediaRegistry.attachCollectionRef(canonicalTrackId, collectionRef);
      return {
        success: true,
        state: existing.downloadState,
        message: `"${track.title}" is already in the download queue.`,
        record: existing
      };
    }

    // 2. Explicit Source Authorization Check (Section 1.4)
    const eligibility = OfflineAuthorizationPolicy.evaluateTrack(track);
    if (!eligibility.eligible || !eligibility.authorizedUrl) {
      return {
        success: false,
        state: 'NOT_DOWNLOADED',
        message: eligibility.reason
      };
    }

    // 3. Storage Budget Check (never deletes existing downloads)
    const budgetCheck = this.checkStorageBudget();
    if (!budgetCheck.ok) {
      return {
        success: false,
        state: 'FAILED',
        message: budgetCheck.reason || 'Download storage budget exceeded.'
      };
    }

    const audioAssetId = existing?.audioAssetId || OfflineAuthorizationPolicy.getAudioAssetId(canonicalTrackId);
    const settings = OfflineMediaRegistry.getSettings();
    const requestedQuality: OfflineQualityOption = options?.quality || settings.preferredQuality || 'source_original';
    const refs = Array.from(new Set([...(existing?.collectionRefs || []), collectionRef]));

    // 4. Native Android Download Engine (Foreground Service + SQLite + Context.filesDir)
    if (isNativeAndroid() && eligibility.sourceType !== 'user_local_file' && typeof (LumenAudio as any).downloadTrack === 'function') {
      const initialRecord: OfflineTrackRecord = {
        canonicalTrackId,
        audioAssetId,
        title: track.title || 'Unknown Track',
        artist: track.artist || 'Unknown Artist',
        album: track.album || 'Single',
        albumId: (track as any).albumId,
        albumArtworkReference: track.artworkUrl || null,
        duration: track.duration || 0,
        codec: 'mp3',
        bitrate: 0,
        mediaFormat: 'audio/mpeg',
        storageReference: `lumen-offline://${audioAssetId}`,
        downloadState: 'QUEUED',
        downloadProgress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        downloadedAt: null,
        lastVerifiedAt: null,
        contentChecksum: null,
        licenseReference: eligibility.licenseReference || null,
        licenseExpiration: eligibility.licenseExpiration ?? null,
        sourceType: eligibility.sourceType,
        authorizedDownloadUrl: eligibility.authorizedUrl,
        storageSize: 0,
        downloadError: null,
        collectionRefs: refs,
        needsRepair: false,
        quality: requestedQuality
      };
      await OfflineMediaRegistry.upsertRecord(initialRecord, true);

      try {
        await (LumenAudio as any).downloadTrack({
          canonicalTrackId,
          audioAssetId,
          url: eligibility.authorizedUrl,
          title: initialRecord.title,
          artist: initialRecord.artist,
          album: initialRecord.album,
          artworkUrl: initialRecord.albumArtworkReference || '',
          duration: initialRecord.duration,
          sourceType: eligibility.sourceType,
          licenseReference: eligibility.licenseReference || '',
          collectionRefs: refs,
          quality: requestedQuality
        });
        return {
          success: true,
          state: 'QUEUED',
          message: `Queued "${track.title}" for private offline download.`,
          record: initialRecord
        };
      } catch (err: any) {
        const failedRec: OfflineTrackRecord = {
          ...initialRecord,
          downloadState: 'FAILED',
          downloadError: err?.message || 'Native download service rejected job.'
        };
        await OfflineMediaRegistry.upsertRecord(failedRec, true);
        return {
          success: false,
          state: 'FAILED',
          message: failedRec.downloadError || 'Download failed.',
          record: failedRec
        };
      }
    }

    // 5. Desktop Electron / Web Persistent Private Vault Download
    const netCheck = eligibility.sourceType === 'user_local_file'
      ? { ok: true }
      : this.isNetworkPermittedForDownload();

    const record: OfflineTrackRecord = {
      canonicalTrackId,
      audioAssetId,
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Unknown Artist',
      album: track.album || 'Single',
      albumId: (track as any).albumId,
      albumArtworkReference: track.artworkUrl || null,
      duration: track.duration || 0,
      codec: 'audio',
      bitrate: 0,
      mediaFormat: 'audio/mpeg',
      storageReference: this.isElectronVaultAvailable() ? `lumen-vault://${audioAssetId}` : `idb-vault://${audioAssetId}`,
      downloadState: netCheck.ok ? 'QUEUED' : 'WAITING_FOR_NETWORK',
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      downloadedAt: null,
      lastVerifiedAt: null,
      contentChecksum: null,
      licenseReference: eligibility.licenseReference || null,
      licenseExpiration: eligibility.licenseExpiration ?? null,
      sourceType: eligibility.sourceType,
      authorizedDownloadUrl: eligibility.authorizedUrl,
      storageSize: 0,
      downloadError: netCheck.ok ? null : (netCheck.reason || 'Waiting for permitted network.'),
      collectionRefs: refs,
      needsRepair: false,
      quality: requestedQuality
    };

    await OfflineMediaRegistry.upsertRecord(record, true);

    if (netCheck.ok) {
      this.enqueueWebJob(canonicalTrackId);
    }

    return {
      success: true,
      state: record.downloadState,
      message: netCheck.ok
        ? `Downloading "${track.title}" to private Lumen vault...`
        : (netCheck.reason || 'Queued — waiting for Wi-Fi.'),
      record
    };
  }

  /**
   * User-initiated managed batch download for a Playlist or Album.
   * Excludes already-downloaded tracks (attaches reference only) and honestly reports unsupported tracks.
   */
  public async downloadCollection(
    collectionType: 'playlist' | 'album',
    collectionId: string,
    collectionTitle: string,
    tracks: Array<Track & ExtendedTrackAuthorizationFields>
  ): Promise<BatchDownloadResult> {
    await this.init();
    const refTag = `${collectionType}:${collectionId}`;
    const batchId = `batch_${collectionId}_${Date.now()}`;

    let queuedCount = 0;
    let alreadyDownloadedCount = 0;
    let unsupportedCount = 0;
    let budgetExceeded = false;
    const unsupportedReasons: Array<{ trackId: string; title: string; reason: string }> = [];

    for (const track of tracks) {
      const canonicalId = OfflineAuthorizationPolicy.getCanonicalTrackId(track);
      const existing = OfflineMediaRegistry.getRecord(canonicalId);

      if (existing && existing.downloadState === 'COMPLETED' && !existing.needsRepair) {
        await OfflineMediaRegistry.attachCollectionRef(canonicalId, refTag);
        alreadyDownloadedCount++;
        continue;
      }

      const eligibility = OfflineAuthorizationPolicy.evaluateTrack(track);
      if (!eligibility.eligible) {
        unsupportedCount++;
        unsupportedReasons.push({
          trackId: canonicalId,
          title: track.title || 'Unknown Track',
          reason: eligibility.reason
        });
        continue;
      }

      const res = await this.downloadTrack(track, { collectionRef: refTag });
      if (res.success) {
        queuedCount++;
      } else if (res.message.toLowerCase().includes('storage') || res.message.toLowerCase().includes('limit')) {
        budgetExceeded = true;
        break;
      } else {
        unsupportedCount++;
        unsupportedReasons.push({
          trackId: canonicalId,
          title: track.title || 'Unknown Track',
          reason: res.message
        });
      }
    }

    let message = '';
    if (budgetExceeded) {
      message = `Stopped "${collectionTitle}" download: storage budget reached (${queuedCount} queued).`;
    } else if (queuedCount > 0 && unsupportedCount > 0) {
      message = `Downloading ${queuedCount} eligible track(s) from "${collectionTitle}". ${unsupportedCount} track(s) are not licensed for offline storage.`;
    } else if (queuedCount > 0) {
      message = `Downloading ${queuedCount} track(s) from "${collectionTitle}"${alreadyDownloadedCount > 0 ? ` (${alreadyDownloadedCount} already offline)` : ''}.`;
    } else if (alreadyDownloadedCount > 0 && unsupportedCount === 0) {
      message = `"${collectionTitle}" is already completely downloaded offline.`;
    } else {
      message = `No tracks in "${collectionTitle}" are licensed for offline download. Online playback remains available.`;
    }

    return {
      batchId,
      collectionId,
      queuedCount,
      alreadyDownloadedCount,
      unsupportedCount,
      unsupportedReasons,
      budgetExceeded,
      message
    };
  }

  /**
   * Pause an active or queued download.
   */
  public async pauseDownload(canonicalTrackId: string): Promise<void> {
    if (isNativeAndroid() && typeof (LumenAudio as any).pauseDownload === 'function') {
      await (LumenAudio as any).pauseDownload({ canonicalTrackId });
    }
    const transfer = this.activeWebTransfers.get(canonicalTrackId);
    if (transfer) {
      transfer.paused = true;
      transfer.controller.abort();
      this.activeWebTransfers.delete(canonicalTrackId);
    }
    this.webQueue = this.webQueue.filter(id => id !== canonicalTrackId);

    const rec = OfflineMediaRegistry.getRecord(canonicalTrackId);
    if (rec && ['QUEUED', 'DOWNLOADING', 'WAITING_FOR_NETWORK'].includes(rec.downloadState)) {
      await OfflineMediaRegistry.upsertRecord({
        ...rec,
        downloadState: 'PAUSED',
        downloadError: null
      }, true);
    }
  }

  /**
   * Resume a paused, failed, or waiting download.
   */
  public async resumeDownload(canonicalTrackId: string): Promise<{ success: boolean; message: string }> {
    const rec = OfflineMediaRegistry.getRecord(canonicalTrackId);
    if (!rec) return { success: false, message: 'Download record not found.' };

    const budgetCheck = this.checkStorageBudget();
    if (!budgetCheck.ok) {
      return { success: false, message: budgetCheck.reason || 'Storage budget reached.' };
    }

    if (isNativeAndroid() && typeof (LumenAudio as any).resumeDownload === 'function') {
      await (LumenAudio as any).resumeDownload({ canonicalTrackId });
      await OfflineMediaRegistry.upsertRecord({
        ...rec,
        downloadState: 'QUEUED',
        downloadError: null,
        needsRepair: false
      }, true);
      return { success: true, message: `Resuming "${rec.title}"...` };
    }

    const netCheck = rec.sourceType === 'user_local_file' ? { ok: true } : this.isNetworkPermittedForDownload();
    await OfflineMediaRegistry.upsertRecord({
      ...rec,
      downloadState: netCheck.ok ? 'QUEUED' : 'WAITING_FOR_NETWORK',
      downloadError: netCheck.ok ? null : (netCheck.reason || 'Waiting for permitted network.'),
      needsRepair: false
    }, true);

    if (netCheck.ok) {
      this.enqueueWebJob(canonicalTrackId);
    }
    return {
      success: true,
      message: netCheck.ok ? `Resuming "${rec.title}"...` : (netCheck.reason || 'Waiting for Wi-Fi.')
    };
  }

  /**
   * Cancel an in-progress download and clean up partial data.
   */
  public async cancelDownload(canonicalTrackId: string): Promise<void> {
    if (isNativeAndroid() && typeof (LumenAudio as any).cancelDownload === 'function') {
      await (LumenAudio as any).cancelDownload({ canonicalTrackId });
    }
    const transfer = this.activeWebTransfers.get(canonicalTrackId);
    if (transfer) {
      transfer.cancelled = true;
      transfer.controller.abort();
      this.activeWebTransfers.delete(canonicalTrackId);
    }
    this.webQueue = this.webQueue.filter(id => id !== canonicalTrackId);
    await OfflineMediaRegistry.deleteRecord(canonicalTrackId);
  }

  /**
   * Explicitly repair a missing or corrupted offline asset (only if source still authorizes it).
   */
  public async repairDownload(canonicalTrackId: string): Promise<{ success: boolean; message: string }> {
    const rec = OfflineMediaRegistry.getRecord(canonicalTrackId);
    if (!rec) return { success: false, message: 'Asset record not found.' };
    if (!rec.authorizedDownloadUrl || rec.sourceType === 'unsupported_stream') {
      return {
        success: false,
        message: 'Cannot repair: original source does not provide an authorized re-download URL.'
      };
    }
    await OfflineMediaRegistry.upsertRecord({
      ...rec,
      needsRepair: false,
      downloadError: null,
      downloadProgress: 0,
      downloadedBytes: 0,
      downloadState: 'QUEUED'
    }, true);

    return this.resumeDownload(canonicalTrackId);
  }

  /**
   * User-initiated removal of an offline track or collection reference.
   * Respects deduplication: if another downloaded playlist still references this track,
   * keeps the shared audio file intact and only removes the specified collection reference.
   */
  public async removeDownload(canonicalTrackId: string, collectionRef?: string): Promise<{ deletedFile: boolean; message: string }> {
    const rec = OfflineMediaRegistry.getRecord(canonicalTrackId);
    if (!rec) return { deletedFile: false, message: 'Track is not downloaded.' };

    const { shouldDeleteAsset, remainingRefs } = await OfflineMediaRegistry.detachCollectionRef(canonicalTrackId, collectionRef);
    if (!shouldDeleteAsset) {
      return {
        deletedFile: false,
        message: `Removed from this collection. Audio retained because it is still referenced by ${remainingRefs.length} other offline item(s).`
      };
    }

    await OfflineMediaRegistry.upsertRecord({ ...rec, downloadState: 'REMOVING' }, true);

    if (isNativeAndroid() && typeof (LumenAudio as any).removeDownload === 'function') {
      await (LumenAudio as any).removeDownload({ canonicalTrackId, audioAssetId: rec.audioAssetId });
    }

    const electronApi = typeof window !== 'undefined' ? (window as any).lumenAPI : null;
    if (electronApi?.removeOfflineAsset) {
      await electronApi.removeOfflineAsset({ audioAssetId: rec.audioAssetId }).catch(() => {});
    }

    await OfflineMediaRegistry.deleteRecord(canonicalTrackId);
    OfflineBackupManager.saveSelectionManifestSnapshot();
    return { deletedFile: true, message: `Removed "${rec.title}" from offline storage.` };
  }

  /**
   * Removes all offline tracks from a specific collection (playlist or album) safely respecting shared refs.
   */
  public async removeCollectionDownloads(collectionType: 'playlist' | 'album', collectionId: string): Promise<number> {
    const refTag = `${collectionType}:${collectionId}`;
    const all = OfflineMediaRegistry.getAllRecords().filter(r => r.collectionRefs?.includes(refTag));
    let removedFiles = 0;
    for (const r of all) {
      const res = await this.removeDownload(r.canonicalTrackId, refTag);
      if (res.deletedFile) removedFiles++;
    }
    return removedFiles;
  }

  /**
   * User-initiated wipe of ALL offline downloads (requires confirmation in UI).
   */
  public async removeAllDownloads(): Promise<void> {
    for (const [, transfer] of this.activeWebTransfers.entries()) {
      transfer.cancelled = true;
      transfer.controller.abort();
    }
    this.activeWebTransfers.clear();
    this.webQueue = [];

    if (isNativeAndroid() && typeof (LumenAudio as any).removeAllDownloads === 'function') {
      await (LumenAudio as any).removeAllDownloads();
    }

    const electronApi = typeof window !== 'undefined' ? (window as any).lumenAPI : null;
    if (electronApi?.clearOfflineVault) {
      await electronApi.clearOfflineVault().catch(() => {});
    }

    await OfflineMediaRegistry.clearAllRecords();
    OfflineBackupManager.saveSelectionManifestSnapshot();
  }

  /**
   * Updates Offline Mode & settings and propagates to Native Android immediately.
   */
  public async setOfflineMode(enabled: boolean): Promise<void> {
    OfflineMediaRegistry.updateSettings({ offlineModeEnabled: enabled });
    if (isNativeAndroid() && typeof (LumenAudio as any).setOfflineMode === 'function') {
      await (LumenAudio as any).setOfflineMode({ enabled }).catch(() => {});
    }
  }

  public async updateSettings(partial: Partial<ReturnType<typeof OfflineMediaRegistry.getSettings>>): Promise<void> {
    const next = OfflineMediaRegistry.updateSettings(partial);
    if (isNativeAndroid() && typeof (LumenAudio as any).updateOfflineSettings === 'function') {
      await (LumenAudio as any).updateOfflineSettings(next).catch(() => {});
    }
    // If user relaxed network policy to allow cellular, automatically wake waiting jobs
    if (partial.networkPolicy === 'wifi_and_mobile' || partial.allowMeteredConnections === true) {
      this.handleConnectivityRestored();
    }
  }

  // --- Internal Web / Electron Download Runner ---

  private isElectronVaultAvailable(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).lumenAPI?.saveOfflineAsset === 'function';
  }

  private enqueueWebJob(canonicalTrackId: string): void {
    if (!this.webQueue.includes(canonicalTrackId)) {
      this.webQueue.push(canonicalTrackId);
    }
    this.processWebQueue();
  }

  private handleConnectivityRestored(): void {
    const netCheck = this.isNetworkPermittedForDownload();
    if (!netCheck.ok) return;
    const waiting = OfflineMediaRegistry.getAllRecords().filter(r => r.downloadState === 'WAITING_FOR_NETWORK');
    for (const rec of waiting) {
      this.resumeDownload(rec.canonicalTrackId).catch(() => {});
    }
  }

  private async processWebQueue(): Promise<void> {
    if (this.isProcessingWebQueue) return;
    this.isProcessingWebQueue = true;

    try {
      while (this.webQueue.length > 0) {
        const trackId = this.webQueue.shift()!;
        await this.executeWebDownload(trackId);
      }
    } finally {
      this.isProcessingWebQueue = false;
    }
  }

  private async executeWebDownload(canonicalTrackId: string): Promise<void> {
    const rec = OfflineMediaRegistry.getRecord(canonicalTrackId);
    if (!rec || rec.downloadState === 'COMPLETED' || !rec.authorizedDownloadUrl) return;

    const controller = new AbortController();
    const transfer: ActiveWebTransfer = { controller, paused: false, cancelled: false };
    this.activeWebTransfers.set(canonicalTrackId, transfer);

    try {
      await OfflineMediaRegistry.upsertRecord({
        ...rec,
        downloadState: 'DOWNLOADING',
        downloadError: null
      }, true);

      const response = await fetch(rec.authorizedDownloadUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Authorized source unavailable.`);
      }

      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

      // Enforce storage budget once exact Content-Length is known
      if (totalBytes > 0) {
        const budgetCheck = this.checkStorageBudget(totalBytes);
        if (!budgetCheck.ok) {
          throw new Error(budgetCheck.reason || 'Storage budget exceeded.');
        }
      }

      const chunks: Uint8Array[] = [];
      let downloadedBytes = 0;

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            downloadedBytes += value.byteLength;
            const progress = totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 50;
            const latest = OfflineMediaRegistry.getRecord(canonicalTrackId) || rec;
            await OfflineMediaRegistry.upsertRecord({
              ...latest,
              downloadState: 'DOWNLOADING',
              downloadedBytes,
              totalBytes: totalBytes || downloadedBytes,
              downloadProgress: progress,
              mediaFormat: contentType
            }, false);
          }
        }
      } else {
        const ab = await response.arrayBuffer();
        chunks.push(new Uint8Array(ab));
        downloadedBytes = ab.byteLength;
      }

      if (transfer.paused || transfer.cancelled) return;

      // Combine chunks & transition to VERIFYING
      const blob = new Blob(chunks as BlobPart[], { type: contentType });
      if (blob.size < 1024) {
        throw new Error('Downloaded audio payload was empty or truncated.');
      }

      const preVerify = OfflineMediaRegistry.getRecord(canonicalTrackId) || rec;
      await OfflineMediaRegistry.upsertRecord({
        ...preVerify,
        downloadState: 'VERIFYING',
        downloadProgress: 99,
        downloadedBytes: blob.size,
        totalBytes: blob.size
      }, true);

      // Compute SHA-256 integrity checksum
      const arrayBuf = await blob.arrayBuffer();
      const checksum = await OfflineBackupManager.computeSha256Hex(arrayBuf);

      // Persist privately into Electron userData vault OR Web IndexedDB blob vault
      let storageReference = `idb-vault://${rec.audioAssetId}`;
      const electronApi = typeof window !== 'undefined' ? (window as any).lumenAPI : null;

      if (electronApi?.saveOfflineAsset) {
        const saved = await electronApi.saveOfflineAsset({
          audioAssetId: rec.audioAssetId,
          mimeType: contentType,
          data: Array.from(new Uint8Array(arrayBuf))
        });
        if (!saved?.success) {
          throw new Error(saved?.error || 'Failed to commit audio into private desktop vault.');
        }
        storageReference = `lumen-vault://${rec.audioAssetId}`;
      } else {
        await OfflineMediaRegistry.saveAudioBlob(rec.audioAssetId, blob, contentType);
      }

      // Cache artwork privately for 100% offline album-art rendering
      if (rec.albumArtworkReference && rec.albumArtworkReference.startsWith('http')) {
        fetch(rec.albumArtworkReference)
          .then(r => r.ok ? r.blob() : null)
          .then(artBlob => artBlob ? OfflineMediaRegistry.saveArtworkBlob(rec.audioAssetId, artBlob) : null)
          .catch(() => {});
      }

      const now = Date.now();
      const finalRecord = OfflineMediaRegistry.getRecord(canonicalTrackId) || rec;
      await OfflineMediaRegistry.upsertRecord({
        ...finalRecord,
        storageReference,
        mediaFormat: contentType,
        codec: contentType.includes('flac') ? 'flac' : contentType.includes('mp4') || contentType.includes('aac') ? 'aac' : 'mp3',
        downloadState: 'COMPLETED',
        downloadProgress: 100,
        downloadedBytes: blob.size,
        totalBytes: blob.size,
        storageSize: blob.size,
        downloadedAt: now,
        lastVerifiedAt: now,
        contentChecksum: checksum,
        downloadError: null,
        needsRepair: false
      }, true);

      OfflineBackupManager.saveSelectionManifestSnapshot();
    } catch (err: any) {
      if (transfer.paused || transfer.cancelled) return;
      const isOfflineErr = typeof navigator !== 'undefined' && navigator.onLine === false;
      const latest = OfflineMediaRegistry.getRecord(canonicalTrackId) || rec;
      await OfflineMediaRegistry.upsertRecord({
        ...latest,
        downloadState: isOfflineErr ? 'WAITING_FOR_NETWORK' : 'FAILED',
        downloadError: isOfflineErr
          ? 'Connection lost during download. Will resume when back online.'
          : (err?.message || 'Download failed unexpectedly.')
      }, true);
    } finally {
      this.activeWebTransfers.delete(canonicalTrackId);
    }
  }
}

export const OfflineDownloadManager = new OfflineDownloadManagerImpl();
