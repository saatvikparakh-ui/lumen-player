/**
 * LUMEN OFFLINE BACKUP & RECOVERY ENGINE
 *
 * Responsibilities:
 *  - Startup reconciliation between index metadata and physical private storage
 *  - Integrity verification (lightweight file presence at startup; SHA-256 on demand)
 *  - Marking missing/corrupted files as needsRepair without silently deleting metadata
 *  - Optional user-controlled selection manifest backup/restore across reinstalls
 *    (explicitly never auto-downloads without user action)
 */

import { OfflineMediaRegistry } from './offlineMediaRegistry';
import { isNativeAndroid, LumenAudio } from './nativeAudioBridge';
import {
  OfflineSelectionManifest,
  OfflineVerificationResult
} from '../types/offlineTypes';

const MANIFEST_LOCAL_KEY = 'lumen_offline_selection_manifest_v1';

export class OfflineBackupManager {
  /**
   * Computes SHA-256 hex digest of an ArrayBuffer / Blob (used on Web & Electron verification).
   */
  public static async computeSha256Hex(buffer: ArrayBuffer): Promise<string | null> {
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch (_) {}
    return null;
  }

  /**
   * Reconciles persistent database metadata against physical files on startup or user request.
   * Lightweight by default; passes fullChecksum=true for thorough SHA-256 verification.
   */
  public static async verifyOfflineLibrary(fullChecksum = false): Promise<OfflineVerificationResult> {
    await OfflineMediaRegistry.init();

    // 1. Native Android verification via SQLite + Context.filesDir/lumen_offline_vault/
    if (isNativeAndroid() && typeof (LumenAudio as any).verifyOfflineLibrary === 'function') {
      try {
        const nativeRes = await (LumenAudio as any).verifyOfflineLibrary({ fullChecksum });
        if (nativeRes && typeof nativeRes.checkedCount === 'number') {
          // Resync updated records from native SQLite
          if (typeof (LumenAudio as any).getDownloads === 'function') {
            const lib = await (LumenAudio as any).getDownloads();
            if (Array.isArray(lib?.records)) {
              await OfflineMediaRegistry.syncFromNativeRecords(lib.records);
            }
          }
          return {
            checkedCount: nativeRes.checkedCount,
            validCount: nativeRes.validCount,
            missingCount: nativeRes.missingCount,
            corruptedCount: nativeRes.corruptedCount,
            affectedTrackIds: nativeRes.affectedTrackIds || [],
            verifiedAt: Date.now()
          };
        }
      } catch (err) {
        console.warn('[OfflineBackupManager] Native verify fallback:', err);
      }
    }

    // 2. Desktop Electron or Web IndexedDB verification
    const records = OfflineMediaRegistry.getAllRecords();
    let checkedCount = 0;
    let validCount = 0;
    let missingCount = 0;
    let corruptedCount = 0;
    const affectedTrackIds: string[] = [];
    const now = Date.now();

    const electronApi = typeof window !== 'undefined' ? (window as any).lumenAPI : null;

    for (const rec of records) {
      // Interruption recovery: any record stuck in DOWNLOADING or VERIFYING across process death
      // transitions cleanly to PAUSED so the user can resume without losing progress.
      if (rec.downloadState === 'DOWNLOADING' || rec.downloadState === 'VERIFYING') {
        await OfflineMediaRegistry.upsertRecord({
          ...rec,
          downloadState: 'PAUSED',
          downloadError: 'Download interrupted when Lumen closed. Tap Resume to continue.'
        }, false);
        continue;
      }

      if (rec.downloadState !== 'COMPLETED') continue;
      checkedCount++;

      let exists = false;
      let checksumValid = true;

      if (electronApi?.verifyOfflineAsset && rec.storageReference.startsWith('lumen-vault://')) {
        try {
          const check = await electronApi.verifyOfflineAsset({
            audioAssetId: rec.audioAssetId,
            expectedChecksum: fullChecksum ? rec.contentChecksum : null
          });
          exists = !!check?.exists;
          checksumValid = check?.checksumValid !== false;
        } catch {
          exists = false;
        }
      } else {
        const entry = await OfflineMediaRegistry.getAudioBlob(rec.audioAssetId);
        if (entry && entry.blob && entry.blob.size > 0) {
          exists = true;
          if (fullChecksum && rec.contentChecksum) {
            const buf = await entry.blob.arrayBuffer();
            const digest = await this.computeSha256Hex(buf);
            if (digest && digest !== rec.contentChecksum) {
              checksumValid = false;
            }
          }
        }
      }

      if (!exists) {
        missingCount++;
        affectedTrackIds.push(rec.canonicalTrackId);
        await OfflineMediaRegistry.upsertRecord({
          ...rec,
          needsRepair: true,
          downloadError: 'Offline audio file is missing from private storage. Tap Repair to restore from an authorized source.'
        }, false);
      } else if (!checksumValid) {
        corruptedCount++;
        affectedTrackIds.push(rec.canonicalTrackId);
        await OfflineMediaRegistry.upsertRecord({
          ...rec,
          needsRepair: true,
          downloadError: 'Offline audio integrity check failed (checksum mismatch). Tap Repair to re-download.'
        }, false);
      } else {
        validCount++;
        if (rec.needsRepair || !rec.lastVerifiedAt) {
          await OfflineMediaRegistry.upsertRecord({
            ...rec,
            needsRepair: false,
            downloadError: null,
            lastVerifiedAt: now
          }, false);
        }
      }
    }

    this.saveSelectionManifestSnapshot();

    return {
      checkedCount,
      validCount,
      missingCount,
      corruptedCount,
      affectedTrackIds,
      verifiedAt: now
    };
  }

  /**
   * Builds and persists an authoritative manifest of user-selected offline tracks.
   * Note: Uninstalling the app normally deletes private audio files; this manifest
   * lets users inspect or explicitly re-authorize downloading eligible tracks after reinstall.
   */
  public static saveSelectionManifestSnapshot(userId?: string): OfflineSelectionManifest {
    const completed = OfflineMediaRegistry.getCompletedRecords();
    const manifest: OfflineSelectionManifest = {
      version: 1,
      exportedAt: Date.now(),
      userId,
      trackIds: completed.map(r => ({
        canonicalTrackId: r.canonicalTrackId,
        title: r.title,
        artist: r.artist,
        album: r.album,
        sourceType: r.sourceType,
        collectionRefs: r.collectionRefs || ['standalone']
      }))
    };

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MANIFEST_LOCAL_KEY, JSON.stringify(manifest));
      }
    } catch (_) {}

    return manifest;
  }

  public static loadSelectionManifestSnapshot(): OfflineSelectionManifest | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(MANIFEST_LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
