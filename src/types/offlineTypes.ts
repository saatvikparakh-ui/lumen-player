/**
 * LUMEN OFFLINE DOWNLOAD & PERSISTENT BACKUP TYPES
 * Canonical data models shared across Web (IndexedDB), Electron (userData vault),
 * and Android Native (SQLite + Context.filesDir private storage).
 */

export type OfflineDownloadState =
  | 'NOT_DOWNLOADED'
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'WAITING_FOR_NETWORK'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REMOVING';

export type OfflineSourceType =
  | 'user_local_file'
  | 'open_license_audio'
  | 'licensed_provider'
  | 'unsupported_stream';

export type OfflineNetworkPolicy = 'wifi_only' | 'wifi_and_mobile';

export type OfflineQualityOption = 'source_original' | 'standard' | 'high';

export interface DownloadEligibility {
  eligible: boolean;
  sourceType: OfflineSourceType;
  reason: string;
  authorizedUrl?: string;
  availableQualities: OfflineQualityOption[];
  licenseReference?: string;
  licenseExpiration?: number | null;
}

export interface OfflineTrackRecord {
  canonicalTrackId: string;
  audioAssetId: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  albumArtworkReference: string | null;
  duration: number;
  codec: string;
  bitrate: number;
  mediaFormat: string;
  /** Internal storage key/token (never exposes raw private OS paths to UI) */
  storageReference: string;
  downloadState: OfflineDownloadState;
  /** 0 to 100 */
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadedAt: number | null;
  lastVerifiedAt: number | null;
  /** SHA-256 hex digest of verified audio payload */
  contentChecksum: string | null;
  licenseReference: string | null;
  licenseExpiration: number | null;
  sourceType: OfflineSourceType;
  /** Authorized download URL retained solely for pause/resume or user-initiated repair */
  authorizedDownloadUrl?: string | null;
  storageSize: number;
  downloadError: string | null;
  /** Collection IDs referencing this asset (e.g. 'standalone', 'playlist:<id>', 'album:<id>') for safe deduplication */
  collectionRefs: string[];
  needsRepair?: boolean;
  quality?: OfflineQualityOption;
}

export interface OfflineCollectionSummary {
  collectionId: string;
  type: 'playlist' | 'album';
  title: string;
  subtitle?: string;
  artworkUrl?: string | null;
  totalTracks: number;
  downloadedTracks: number;
  inProgressTracks: number;
  failedTracks: number;
  unsupportedTracks: number;
  status: 'none' | 'partial' | 'downloading' | 'complete';
  totalBytes: number;
}

export interface OfflineSettings {
  offlineModeEnabled: boolean;
  preferredQuality: OfflineQualityOption;
  networkPolicy: OfflineNetworkPolicy;
  allowMeteredConnections: boolean;
  /** User-configured storage budget in megabytes (stops new downloads when exceeded; never auto-deletes) */
  maxStorageMB: number;
}

export interface OfflineStorageUsage {
  usedBytes: number;
  completedCount: number;
  inProgressCount: number;
  failedCount: number;
  needsRepairCount: number;
  budgetBytes: number;
  deviceAvailableBytes: number | null;
}

export interface OfflineVerificationResult {
  checkedCount: number;
  validCount: number;
  missingCount: number;
  corruptedCount: number;
  affectedTrackIds: string[];
  verifiedAt: number;
}

export interface BatchDownloadResult {
  batchId: string;
  collectionId: string;
  queuedCount: number;
  alreadyDownloadedCount: number;
  unsupportedCount: number;
  unsupportedReasons: Array<{ trackId: string; title: string; reason: string }>;
  budgetExceeded: boolean;
  message: string;
}

export interface OfflineSelectionManifest {
  version: number;
  exportedAt: number;
  userId?: string;
  trackIds: Array<{
    canonicalTrackId: string;
    title: string;
    artist: string;
    album: string;
    sourceType: OfflineSourceType;
    collectionRefs: string[];
  }>;
}
