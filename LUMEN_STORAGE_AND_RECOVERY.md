# LUMEN — Private Storage, Deduplication & Recovery Specification (`LUMEN_STORAGE_AND_RECOVERY.md`)

## 1. Private Application Storage Locations

| Platform | Private Vault Directory | Public Media Exposure |
|---|---|---|
| **Android (Capacitor Native)** | `Context.getFilesDir()/lumen_offline_vault/<audioAssetId>.lum` + `.nomedia` marker + `lumen_offline_media.db` SQLite | **None.** Never touches `/Download`, `/Music`, or `MediaStore`. Invisible to Gallery, Files, and third-party music players. Requires zero external storage permissions. |
| **Windows Desktop (Electron)** | `%APPDATA%/Lumen/lumen_offline_vault/<audioAssetId>.lum` + `<audioAssetId>.json` | **None.** User-profile app-private directory served strictly via local loopback `/offline-vault` with HTTP 206 seeking. |
| **Web / PWA** | Browser Origin-Private IndexedDB (`lumen_offline_vault_db`, stores `offline_records`, `offline_audio_blobs`, `offline_artwork_blobs`) | **None.** Origin-sandboxed storage invisible to OS Downloads folder. |

> **Opaque Reference Security:** On Android, the frontend JavaScript layer receives only opaque tokens (`lumen-offline://<audioAssetId>`). Raw private filesystem paths (`/data/user/0/com.lumen.music/files/...`) are resolved internally inside `LumenPlaybackService.java` and `LumenAudioPlugin.java`.

---

## 2. Cross-Playlist Deduplication & Reference Counting

Every offline track record maintains a `collectionRefs: string[]` array (e.g., `["playlist:pl_gym", "album:alb_01"]`).

1. **Adding to a second downloaded playlist**: `OfflineDownloadManager.downloadTrack()` sees the valid `COMPLETED` record and simply calls `OfflineMediaRegistry.attachCollectionRef(canonicalTrackId, "playlist:pl_chill")` — storing **zero duplicate audio bytes**.
2. **Removing from one playlist**: `OfflineMediaRegistry.detachCollectionRef()` removes only that playlist's tag. If `remainingRefs.length > 0`, the shared physical `.lum` file is preserved intact. Only when the final reference is removed (or the user deletes the track directly from the Songs vault) is the physical audio file deleted from disk.

---

## 3. Atomic Commits, Integrity & Recovery

- **Atomic Writes**: Downloads stream in 32 KB buffers (never loading full tracks into RAM on Android) into `<audioAssetId>.part`. Only after transfer finishes, size `>= 1024 bytes` is verified, and the **SHA-256** digest is computed is `<audioAssetId>.part` atomically renamed to `<audioAssetId>.lum` and marked `COMPLETED`.
- **Restart Recovery**: On app restart, any job interrupted in `DOWNLOADING` or `VERIFYING` transitions cleanly to `PAUSED` with partial bytes preserved for HTTP Range resumption.
- **Corruption & Missing Files**: Running *Verify SHA-256 Integrity* (in Downloads Vault or Settings → Offline Downloads) checks file existence and SHA-256 checksums. Missing or corrupted files are marked `needsRepair: true` while preserving metadata and showing a **Repair** button (which re-downloads only if the original source still authorizes retrieval).
- **Storage Budget Protection**: When `usedBytes` reaches the user's configured `maxStorageMB` limit, Lumen halts new downloads with an explicit warning and **never auto-deletes existing user downloads**.

---

## 4. App Updates vs. Uninstallation (Honest Boundaries)

- **Compatible App Updates (APK upgrade / Windows Setup update)**: Preserves `Context.filesDir`, SQLite `lumen_offline_media.db` (versioned via `SQLiteOpenHelper.onUpgrade`), Electron `%APPDATA%/Lumen/lumen_offline_vault/`, and IndexedDB v1 schema seamlessly.
- **Uninstalling Lumen or Clearing App Data**: Android and Windows intentionally wipe app-private internal storage when an application is uninstalled. Lumen does **not** falsely claim physical audio files survive uninstallations. Instead, `OfflineBackupManager.saveSelectionManifestSnapshot()` records a lightweight manifest of the user's selected track IDs so users can review and explicitly re-authorize downloading eligible tracks after reinstalling.
