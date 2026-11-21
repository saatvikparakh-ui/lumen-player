# LUMEN — Offline Download & Persistent Backup Architecture (`LUMEN_OFFLINE_ARCHITECTURE.md`)

## 1. Integration with Existing Playback Engine

Lumen preserves its existing hybrid playback stack (**Web Audio API + 10-Band EQ** in `src/services/audioEngine.ts` + **AndroidX Media3 1.5.1 ExoPlayer** in `LumenPlaybackService.java` + `LumenAudioPlugin.java`) without introducing a second incompatible player.

```text
User presses Play (Online or Airplane Mode)
       │
       ▼
AudioEngine.playTrack()  [src/services/audioEngine.ts]
       │
       ▼
OfflinePlaybackAdapter.resolveOfflineFirst()  [src/services/offlinePlaybackAdapter.ts]
       │
       ├── Valid COMPLETED offline asset in OfflineMediaRegistry?
       │         ├── Android:  returns opaque token "lumen-offline://<audioAssetId>"
       │         │             resolved inside LumenPlaybackService.java to
       │         │             Uri.fromFile(Context.filesDir/lumen_offline_vault/<assetId>.lum)
       │         ├── Electron: returns loopback HTTP 206 Range stream
       │         │             http://127.0.0.1:<port>/offline-vault?id=<audioAssetId>
       │         └── Web PWA:  returns Blob ObjectURL from IndexedDB private vault
       │         (ZERO network requests; full EQ, seek, queue, MediaSession, Bluetooth & lockscreen)
       │
       ├── Offline-Only Mode enabled OR device offline (and track NOT downloaded)?
       │         └── Stops cleanly with explicit user-facing message (no online API calls)
       │
       └── Otherwise (Online Mode + not downloaded)
                 └── Existing PlaybackResolver waterfall [src/services/playbackAdapter.ts]
                     (100% preserved and untouched)
```

---

## 2. Explicit Source Authorization Boundary (`OfflineAuthorizationPolicy`)

Implemented in `src/services/offlineAuthorizationPolicy.ts`:

- **Permitted for Persistent Offline Downloads**:
  1. `user_local_file`: User-owned local audio files (`localFilePath`, `blob:`, `file://`, Electron local files).
  2. `open_license_audio`: Verified open-license / Creative Commons audio hosts and the built-in 3-track Lumen Open-License Vault Pack (SoundHelix CC examples).
  3. `licensed_provider`: Tracks explicitly carrying `offlineAuthorized: true` and an approved `offlineDownloadUrl` from a licensed provider.
- **Explicitly Blocked from Permanent Offline Storage**:
  - JioSaavn decrypted CDN URLs (`saavncdn.com`, `jiosaavn.com`, `aac.saavncdn.com`).
  - YouTube / `googlevideo.com` fallback streams and backend `/api/stream/resolve` proxy URLs.
  - iTunes 30-second preview snippets (`audio-ssl.itunes.apple.com`, `mzstatic.com`).
  - Blocking returns an honest, non-destructive reason without breaking online streaming playback.

---

## 3. Modular Responsibilities

| Module | File | Responsibility |
|---|---|---|
| **Offline Types** | `src/types/offlineTypes.ts` | Canonical state machine (`NOT_DOWNLOADED` → `QUEUED` → `DOWNLOADING` → `PAUSED` / `WAITING_FOR_NETWORK` → `VERIFYING` → `COMPLETED` / `FAILED` / `REMOVING`) & data schemas |
| **Authorization Policy** | `src/services/offlineAuthorizationPolicy.ts` | Source capability gating, canonical track IDs, safe opaque `audioAssetId` generation, open-license test pack |
| **OfflineMediaRegistry** | `src/services/offlineMediaRegistry.ts` | IndexedDB v1 persistent metadata + private binary blob vault + `collectionRefs[]` deduplication + throttled pub/sub |
| **OfflineDownloadManager** | `src/services/offlineDownloadManager.ts` | 100% user-initiated single track / album / playlist batch downloads, pause/resume/cancel/retry, network policy, storage budget enforcement, connectivity recovery |
| **OfflinePlaybackAdapter** | `src/services/offlinePlaybackAdapter.ts` | Offline-first playback resolution & Offline-Only Mode enforcement |
| **OfflineBackupManager** | `src/services/offlineBackupManager.ts` | Startup reconciliation, SHA-256 verification, missing/corrupt detection, repair workflow, optional selection manifest snapshot |
| **Android Native Engine** | `OfflineMediaDbHelper.java`, `LumenOfflineDownloadManager.java`, `LumenDownloadService.java` | Persistent Android SQLite registry, `Context.filesDir/lumen_offline_vault/` + `.nomedia`, HTTP Range pause/resume, Foreground `dataSync` service |
| **Electron Private Vault** | `electron/main.cjs`, `electron/preload.cjs` | Private `%APPDATA%/Lumen/lumen_offline_vault/` storage with HTTP 206 byte-range seeking and atomic `.part` → `.lum` writes |
