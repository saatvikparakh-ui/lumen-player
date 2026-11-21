# LUMEN — Offline Download System Implementation Log (`LUMEN_DOWNLOAD_IMPLEMENTATION.md`)

## 1. Newly Created Files

### TypeScript Core & UI
- `src/types/offlineTypes.ts` — All download lifecycle states, `OfflineTrackRecord`, `OfflineSettings`, `OfflineStorageUsage`, `BatchDownloadResult`, and `OfflineSelectionManifest`.
- `src/services/offlineAuthorizationPolicy.ts` — Explicit source authorization layer + canonical track/asset IDs + Open-License Vault Pack.
- `src/services/offlineMediaRegistry.ts` — IndexedDB v1 persistent store + `localStorage` cold-boot mirror + collection reference deduplication + throttled (120ms) React pub/sub.
- `src/services/offlineDownloadManager.ts` — Cross-platform download coordinator (delegates to Android native `LumenAudio`, Electron private vault, or Web IndexedDB).
- `src/services/offlinePlaybackAdapter.ts` — Offline-first resolver + Offline-Only Mode gate.
- `src/services/offlineBackupManager.ts` — Startup interruption recovery, SHA-256 checksum integrity checks, repair detection, and selection manifest backup.
- `src/components/views/DownloadsView.tsx` — Dedicated Liquid Glass Downloads Vault (Songs, Albums, Playlists, Active/Paused/Failed Queue, Storage & Recovery, Offline-Only toggle, offline search).
- `tests/offlineVault.test.mjs` — Automated Node.js unit test suite covering authorization, deduplication, atomic writes, SHA-256 verification, and native file invariants.

### Native Android (Java / AndroidX Media3 1.5.1)
- `android/app/src/main/java/com/lumen/music/OfflineMediaDbHelper.java` — Versioned Android SQLite database (`lumen_offline_media.db`) storing track metadata, bytes, checksums, and collection references.
- `android/app/src/main/java/com/lumen/music/LumenOfflineDownloadManager.java` — Private `Context.filesDir/lumen_offline_vault/` manager with `.nomedia`, HTTP Range pause/resume, `ConnectivityManager` Wi-Fi/metered enforcement, `StatFs` storage checks, SHA-256 verification, and atomic `.part` → `.lum` rename.
- `android/app/src/main/java/com/lumen/music/LumenDownloadService.java` — Foreground service (`foregroundServiceType="dataSync"`) displaying a silent low-priority progress notification while background downloads run.

---

## 2. Modified Existing Files

| File | Summary of Changes |
|---|---|
| `src/services/nativeAudioBridge.ts` | Extended existing `LumenAudio` Capacitor plugin interface (no duplicate plugin) with `downloadTrack`, `pauseDownload`, `resumeDownload`, `cancelDownload`, `removeDownload`, `removeAllDownloads`, `getDownloads`, `getDownloadStatus`, `getOfflinePlaybackUri`, `getStorageUsage`, `verifyOfflineLibrary`, `setOfflineMode`, `updateOfflineSettings`, and `onDownloadStateChange`. |
| `src/services/audioEngine.ts` | Integrated `OfflinePlaybackAdapter.resolveOfflineFirst()` as Step 0 in `playTrack()` and `prebufferNextTrack()`, preserving online `PlaybackResolver` untouched. |
| `android/.../LumenAudioPlugin.java` | Implemented all 13 native offline plugin methods + opaque `lumen-offline://` queue URI resolution in `setQueue()`. |
| `android/.../LumenPlaybackService.java` | Resolved `lumen-offline://<assetId>` internally to `Uri.fromFile(vaultFile)` inside `playTrack()` without exposing raw private filesystem paths to JS. |
| `android/app/src/main/AndroidManifest.xml` | Registered `LumenDownloadService` (`foregroundServiceType="dataSync"`) and `FOREGROUND_SERVICE_DATA_SYNC` permission (zero broad external storage permissions). |
| `electron/main.cjs` & `electron/preload.cjs` | Added `/offline-vault` HTTP 206 byte-range endpoint and IPC handlers (`offline:saveAsset`, `offline:verifyAsset`, `offline:removeAsset`, `offline:clearVault`) backed by `%APPDATA%/Lumen/lumen_offline_vault/`. |
| `src/components/views/SettingsHubModal.tsx` | Added dedicated **Offline Downloads** tab (Offline-Only Mode, authorized quality, Wi-Fi/Mobile/Metered policy, storage budget slider without auto-delete, SHA-256 verification, Clear All with confirmation). |
| `src/components/views/PlaylistView.tsx` | Added **Downloads** vault quick-access pill in Library top bar + **Download** batch button on Playlist header showing complete vs. partial offline status. |
| `src/components/views/ArtistHubView.tsx` | **Mobile-Only Discography Redesign (`sm:hidden`)** into spacious full-width Liquid Glass release rows (`72px` art, 2-line title, Play, **Download Album**, Save, full-width expandable tracklist with per-track download), plus **Download Album** & **Download Offline** actions on desktop. |
| `src/App.tsx` | Added startup `OfflineDownloadManager.init()` and wired full-screen `<DownloadsView />` accessible from Library and Settings. |
