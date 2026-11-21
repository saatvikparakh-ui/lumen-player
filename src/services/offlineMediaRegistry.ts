/**
 * LUMEN OFFLINE MEDIA REGISTRY
 *
 * Device-local persistent index & private binary blob vault (IndexedDB v1 with migrations).
 * Zero dependency on remote backend servers for offline playback resolution.
 *
 * Responsibilities:
 *  - Mapping canonicalTrackId -> OfflineTrackRecord
 *  - Deduplicated multi-collection ownership via collectionRefs[]
 *  - Private binary audio + artwork storage for Web / PWA fallback
 *  - Persistent user OfflineSettings (offlineMode, quality, network policy, maxStorageMB)
 *  - Reactive pub/sub for throttled UI synchronization
 */

import {
  OfflineTrackRecord,
  OfflineSettings,
  OfflineStorageUsage,
  OfflineDownloadState
} from '../types/offlineTypes';

const DB_NAME = 'lumen_offline_vault_db';
const DB_VERSION = 1;
const STORE_RECORDS = 'offline_records';
const STORE_AUDIO_BLOBS = 'offline_audio_blobs';
const STORE_ARTWORK_BLOBS = 'offline_artwork_blobs';

const SETTINGS_STORAGE_KEY = 'lumen_offline_settings_v1';
const MIRROR_INDEX_KEY = 'lumen_offline_records_mirror_v1';

export const DEFAULT_OFFLINE_SETTINGS: OfflineSettings = {
  offlineModeEnabled: false,
  preferredQuality: 'source_original',
  networkPolicy: 'wifi_only',
  allowMeteredConnections: false,
  maxStorageMB: 2048 // 2 GB user-adjustable default budget
};

type RegistryListener = () => void;

class OfflineMediaRegistryImpl {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private records = new Map<string, OfflineTrackRecord>();
  private settings: OfflineSettings = { ...DEFAULT_OFFLINE_SETTINGS };
  private listeners = new Set<RegistryListener>();
  private initialized = false;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceAvailableBytes: number | null = null;

  constructor() {
    this.loadSettingsSync();
    this.loadMirrorIndexSync();
  }

  private loadSettingsSync(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.settings = { ...DEFAULT_OFFLINE_SETTINGS, ...parsed };
      }
    } catch (_) {}
  }

  /**
   * Synchronous cold-boot hydration mirror so UI renders offline badges immediately on frame 0
   * while IndexedDB / native SQLite completes async authoritative reconciliation.
   */
  private loadMirrorIndexSync(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(MIRROR_INDEX_KEY);
      if (raw) {
        const list: OfflineTrackRecord[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(r => {
            if (r && r.canonicalTrackId) {
              this.records.set(r.canonicalTrackId, r);
            }
          });
        }
      }
    } catch (_) {}
  }

  private persistMirrorIndex(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(MIRROR_INDEX_KEY, JSON.stringify(Array.from(this.records.values())));
    } catch (_) {}
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable in this runtime'));
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion || 0;

        // Version 1 initial schema (future migrations check oldVersion < 2, etc.)
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(STORE_RECORDS)) {
            const store = db.createObjectStore(STORE_RECORDS, { keyPath: 'canonicalTrackId' });
            store.createIndex('audioAssetId', 'audioAssetId', { unique: false });
            store.createIndex('downloadState', 'downloadState', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_AUDIO_BLOBS)) {
            db.createObjectStore(STORE_AUDIO_BLOBS, { keyPath: 'audioAssetId' });
          }
          if (!db.objectStoreNames.contains(STORE_ARTWORK_BLOBS)) {
            db.createObjectStore(STORE_ARTWORK_BLOBS, { keyPath: 'audioAssetId' });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Failed to open Offline Vault DB'));
    });

    return this.dbPromise;
  }

  /**
   * Initializes registry from persistent IndexedDB store. Safe to call multiple times.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const db = await this.openDb();
      const loaded = await new Promise<OfflineTrackRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readonly');
        const req = tx.objectStore(STORE_RECORDS).getAll();
        req.onsuccess = () => resolve((req.result as OfflineTrackRecord[]) || []);
        req.onerror = () => reject(req.error);
      });

      this.records.clear();
      loaded.forEach(r => {
        if (r && r.canonicalTrackId) {
          // Ensure collectionRefs is always an array
          if (!Array.isArray(r.collectionRefs)) r.collectionRefs = ['standalone'];
          this.records.set(r.canonicalTrackId, r);
        }
      });
      this.persistMirrorIndex();
      this.initialized = true;
      this.refreshStorageQuotaEstimate().catch(() => {});
      this.notify(true);
    } catch (err) {
      console.warn('[OfflineMediaRegistry] IndexedDB init fallback:', err);
      this.initialized = true;
    }
  }

  public async refreshStorageQuotaEstimate(): Promise<number | null> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (typeof est.quota === 'number' && typeof est.usage === 'number') {
          this.deviceAvailableBytes = Math.max(0, est.quota - est.usage);
          return this.deviceAvailableBytes;
        }
      }
    } catch (_) {}
    return this.deviceAvailableBytes;
  }

  public setDeviceAvailableBytes(bytes: number | null): void {
    this.deviceAvailableBytes = bytes;
  }

  public subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Throttled notification (max ~10 updates/sec during active downloads) to avoid React re-render storms.
   */
  private notify(immediate = false): void {
    if (immediate) {
      if (this.notifyTimer) {
        clearTimeout(this.notifyTimer);
        this.notifyTimer = null;
      }
      this.listeners.forEach(fn => {
        try { fn(); } catch (_) {}
      });
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.listeners.forEach(fn => {
        try { fn(); } catch (_) {}
      });
    }, 120);
  }

  // --- Record CRUD & Query ---

  public getRecord(canonicalTrackId: string): OfflineTrackRecord | null {
    return this.records.get(canonicalTrackId) || null;
  }

  public getAllRecords(): OfflineTrackRecord[] {
    return Array.from(this.records.values()).sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));
  }

  public getCompletedRecords(): OfflineTrackRecord[] {
    return this.getAllRecords().filter(r => r.downloadState === 'COMPLETED' && !r.needsRepair);
  }

  public getActiveRecords(): OfflineTrackRecord[] {
    const activeStates: OfflineDownloadState[] = ['QUEUED', 'DOWNLOADING', 'PAUSED', 'WAITING_FOR_NETWORK', 'VERIFYING'];
    return this.getAllRecords().filter(r => activeStates.includes(r.downloadState));
  }

  public getFailedOrRepairRecords(): OfflineTrackRecord[] {
    return this.getAllRecords().filter(r => r.downloadState === 'FAILED' || r.needsRepair);
  }

  public isTrackAvailableOffline(canonicalTrackId: string): boolean {
    const rec = this.records.get(canonicalTrackId);
    return !!(rec && rec.downloadState === 'COMPLETED' && !rec.needsRepair);
  }

  public async upsertRecord(record: OfflineTrackRecord, immediateNotify = false): Promise<void> {
    const normalized: OfflineTrackRecord = {
      ...record,
      collectionRefs: Array.isArray(record.collectionRefs) && record.collectionRefs.length > 0
        ? Array.from(new Set(record.collectionRefs))
        : ['standalone']
    };
    this.records.set(normalized.canonicalTrackId, normalized);
    this.persistMirrorIndex();
    this.notify(immediateNotify);

    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readwrite');
        tx.objectStore(STORE_RECORDS).put(normalized);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[OfflineMediaRegistry] Persist record warning:', err);
    }
  }

  /**
   * Bulk-replaces records from authoritative Native Android SQLite state upon frontend launch/resume.
   */
  public async syncFromNativeRecords(nativeRecords: OfflineTrackRecord[]): Promise<void> {
    this.records.clear();
    for (const r of nativeRecords) {
      if (r && r.canonicalTrackId) {
        this.records.set(r.canonicalTrackId, {
          ...r,
          collectionRefs: Array.isArray(r.collectionRefs) && r.collectionRefs.length > 0 ? r.collectionRefs : ['standalone']
        });
      }
    }
    this.persistMirrorIndex();
    this.notify(true);

    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readwrite');
        const store = tx.objectStore(STORE_RECORDS);
        store.clear();
        for (const r of this.records.values()) {
          store.put(r);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  /**
   * Adds a collection reference (e.g. 'playlist:pl_123' or 'album:alb_456') to an existing asset
   * so identical tracks across multiple downloaded playlists share ONE physical file.
   */
  public async attachCollectionRef(canonicalTrackId: string, collectionRef: string): Promise<boolean> {
    const rec = this.records.get(canonicalTrackId);
    if (!rec) return false;
    const refs = new Set(rec.collectionRefs || []);
    refs.add(collectionRef);
    await this.upsertRecord({ ...rec, collectionRefs: Array.from(refs) }, true);
    return true;
  }

  /**
   * Removes a collection reference. Returns TRUE if zero references remain and the physical audio asset
   * should now be deleted; returns FALSE if another downloaded playlist/album still references this track.
   */
  public async detachCollectionRef(canonicalTrackId: string, collectionRef?: string): Promise<{ shouldDeleteAsset: boolean; remainingRefs: string[] }> {
    const rec = this.records.get(canonicalTrackId);
    if (!rec) return { shouldDeleteAsset: true, remainingRefs: [] };

    if (!collectionRef) {
      return { shouldDeleteAsset: true, remainingRefs: [] };
    }

    const remaining = (rec.collectionRefs || []).filter(r => r !== collectionRef);
    if (remaining.length > 0) {
      await this.upsertRecord({ ...rec, collectionRefs: remaining }, true);
      return { shouldDeleteAsset: false, remainingRefs: remaining };
    }
    return { shouldDeleteAsset: true, remainingRefs: [] };
  }

  public async deleteRecord(canonicalTrackId: string): Promise<void> {
    const rec = this.records.get(canonicalTrackId);
    this.records.delete(canonicalTrackId);
    this.persistMirrorIndex();
    this.notify(true);

    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_RECORDS, STORE_AUDIO_BLOBS, STORE_ARTWORK_BLOBS], 'readwrite');
        tx.objectStore(STORE_RECORDS).delete(canonicalTrackId);
        if (rec?.audioAssetId) {
          tx.objectStore(STORE_AUDIO_BLOBS).delete(rec.audioAssetId);
          tx.objectStore(STORE_ARTWORK_BLOBS).delete(rec.audioAssetId);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[OfflineMediaRegistry] Delete record warning:', err);
    }
  }

  public async clearAllRecords(): Promise<void> {
    this.records.clear();
    this.persistMirrorIndex();
    this.notify(true);

    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_RECORDS, STORE_AUDIO_BLOBS, STORE_ARTWORK_BLOBS], 'readwrite');
        tx.objectStore(STORE_RECORDS).clear();
        tx.objectStore(STORE_AUDIO_BLOBS).clear();
        tx.objectStore(STORE_ARTWORK_BLOBS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  // --- Binary Vault Blobs (Web / PWA Private IndexedDB Storage) ---

  public async saveAudioBlob(audioAssetId: string, blob: Blob, mimeType: string): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO_BLOBS, 'readwrite');
      tx.objectStore(STORE_AUDIO_BLOBS).put({
        audioAssetId,
        blob,
        mimeType: mimeType || blob.type || 'audio/mpeg',
        size: blob.size,
        savedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getAudioBlob(audioAssetId: string): Promise<{ blob: Blob; mimeType: string; size: number } | null> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_AUDIO_BLOBS, 'readonly');
        const req = tx.objectStore(STORE_AUDIO_BLOBS).get(audioAssetId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  public async hasAudioBlob(audioAssetId: string): Promise<boolean> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_AUDIO_BLOBS, 'readonly');
        const req = tx.objectStore(STORE_AUDIO_BLOBS).count(audioAssetId);
        req.onsuccess = () => resolve((req.result || 0) > 0);
        req.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  public async saveArtworkBlob(audioAssetId: string, blob: Blob): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_ARTWORK_BLOBS, 'readwrite');
        tx.objectStore(STORE_ARTWORK_BLOBS).put({ audioAssetId, blob, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  public async getArtworkBlob(audioAssetId: string): Promise<Blob | null> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_ARTWORK_BLOBS, 'readonly');
        const req = tx.objectStore(STORE_ARTWORK_BLOBS).get(audioAssetId);
        req.onsuccess = () => resolve(req.result?.blob || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  // --- Settings & Storage Accounting ---

  public getSettings(): OfflineSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<OfflineSettings>): OfflineSettings {
    this.settings = { ...this.settings, ...partial };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
      }
    } catch (_) {}
    this.notify(true);
    return { ...this.settings };
  }

  public getStorageUsage(): OfflineStorageUsage {
    const all = this.getAllRecords();
    let usedBytes = 0;
    let completedCount = 0;
    let inProgressCount = 0;
    let failedCount = 0;
    let needsRepairCount = 0;

    for (const r of all) {
      if (r.downloadState === 'COMPLETED') {
        if (r.needsRepair) {
          needsRepairCount++;
        } else {
          completedCount++;
          usedBytes += Math.max(0, r.storageSize || r.downloadedBytes || 0);
        }
      } else if (r.downloadState === 'FAILED') {
        failedCount++;
      } else if (['QUEUED', 'DOWNLOADING', 'PAUSED', 'WAITING_FOR_NETWORK', 'VERIFYING'].includes(r.downloadState)) {
        inProgressCount++;
        usedBytes += Math.max(0, r.downloadedBytes || 0);
      }
    }

    return {
      usedBytes,
      completedCount,
      inProgressCount,
      failedCount,
      needsRepairCount,
      budgetBytes: Math.max(100, this.settings.maxStorageMB) * 1024 * 1024,
      deviceAvailableBytes: this.deviceAvailableBytes
    };
  }
}

export const OfflineMediaRegistry = new OfflineMediaRegistryImpl();
