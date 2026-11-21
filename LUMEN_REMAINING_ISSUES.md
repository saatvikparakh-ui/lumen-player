# LUMEN — Remaining Limitations, Source Boundaries & Future Enhancements (`LUMEN_REMAINING_ISSUES.md`)

## 1. Unsupported Streaming Sources (Intentional Compliance Boundary)

Per Section 1.4 and Development Rule 6, Lumen **explicitly refuses** to permanently download audio from sources that do not grant offline download authorization:
- **JioSaavn Decrypted CDN (`saavncdn.com`)**: Online streaming remains fully functional, but offline download is blocked (`unsupported_stream`).
- **YouTube Fallback (`googlevideo.com` / `/api/stream/resolve`)**: Online streaming remains fully functional, but offline download is blocked.
- **iTunes 30-Second Previews (`audio-ssl.itunes.apple.com`)**: Blocked from permanent offline download.

**How to enable full commercial catalog offline downloads in the future:** Integrate an officially licensed music SDK or self-hosted user-owned media server (e.g., personal Navidrome / Subsonic / Jellyfin instance where the user owns the library) and return `offlineAuthorized: true` + `offlineDownloadUrl` from that provider adapter into `OfflineAuthorizationPolicy`.

---

## 2. Known Technical Limitations

1. **Physical Android Device Verification Pending**: The native Java classes (`OfflineMediaDbHelper`, `LumenOfflineDownloadManager`, `LumenDownloadService`, `LumenAudioPlugin`, `LumenPlaybackService`) compile cleanly into `Lumen-debug.apk`, and core invariants pass automated Node.js unit tests, but physical handset verification (Airplane Mode after reboot, OEM battery saver notifications, lockscreen controls during `.lum` playback) should be executed on your Android device after installing the APK.
2. **At-Rest File Encryption (Optional Phase 2 Hardening)**: Private `.lum` files are currently hidden from Downloads/MediaStore via `Context.filesDir` + `.nomedia` + opaque filenames and integrity-protected with SHA-256. Adding hardware-backed Android Keystore AES-256-GCM chunked encryption + a custom Media3 `BaseDataSource` (`LumDataSource.java`) is the natural next hardening step if rooted-device copy protection is desired.
3. **Web Browser Mid-Transfer Pause Granularity**: On Android Native, pause/resume uses true HTTP `Range: bytes=<offset>-` resumption against `.part` files. On Web/Desktop browsers, resuming a paused fetch currently restarts from byte 0 when the remote host omits CORS `Accept-Ranges` exposure.
4. **Offline Lyrics Persistence**: Audio and album artwork cache locally in the private vault; caching synced `.lrc` lyrics per downloaded track into `OfflineMediaRegistry` is a low-effort next enhancement so lyrics also appear 100% offline.
5. **Cloud Sync of Selection Manifest**: `OfflineBackupManager` currently stores the download selection manifest in `localStorage`; syncing that lightweight JSON manifest to the user's Firestore/Supabase account profile will allow cross-device manifest inspection after reinstalling.
