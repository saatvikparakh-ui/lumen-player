# LUMEN — Offline System Test & Verification Results (`LUMEN_OFFLINE_TEST_RESULTS.md`)

**Test Date:** November 21, 2026  
**Environment:** Windows 11 x64 (`node`, `tsc 5.7.3`, `vite 6.4.5`, Capacitor 8, Android Gradle JDK 17 / Media3 1.5.1, Electron Builder 26)

---

## 1. Automated Verification Executed

| Test Suite / Command | Result | Evidence |
|---|---|---|
| `node --test tests/offlineVault.test.mjs` | **PASS (5 / 5)** | 114.9ms: Source authorization blocks JioSaavn/YouTube/proxy/iTunes previews; permits local & open-license audio; multi-playlist deduplication ref-counting; atomic `.part`→`.lum` + `.nomedia` + SHA-256 tamper detection; required native & TS file invariants |
| `node node_modules/typescript/bin/tsc --noEmit` | **PASS (Exit 0)** | Zero TypeScript compilation errors across all existing + new offline files |
| `node node_modules/vite/bin/vite.js build` | **PASS** | Full production web bundle compiled cleanly |
| `capacitor sync android` + `gradlew.bat assembleDebug` | **PASS** | Compiles `OfflineMediaDbHelper.java`, `LumenOfflineDownloadManager.java`, `LumenDownloadService.java`, updated `LumenAudioPlugin.java`, and `LumenPlaybackService.java` into fresh `app-debug.apk` |
| `electron-builder --win` | **PASS** | Packages updated Electron `main.cjs` / `preload.cjs` offline vault + UI into fresh `Lumen-Setup.exe` |

---

## 2. Core Test Matrix Coverage (Section 15)

| # | Scenario | Verification Status | Notes |
|---|---|---|---|
| 1–2 | Download eligible song & play offline | **Verified in code + unit test; requires physical device smoke test** | Built-in Open-License Vault Pack (3 SoundHelix CC tracks) available right in Downloads Vault for 1-tap physical verification |
| 3–4 | Download eligible album & playlist (managed batch) | **Verified in code & TS build** | `OfflineDownloadManager.downloadCollection()` excludes already-downloaded tracks and reports unsupported tracks honestly |
| 5–6 | Pause & resume download | **Verified in code** | Android native uses HTTP `Range: bytes=<existing>-` on `.part` files; Web/Electron uses `AbortController` |
| 7–8 | Network drop & app restart during active download | **Verified in code** | `recoverInterruptedJobs()` & `OfflineBackupManager.verifyOfflineLibrary()` transition interrupted jobs cleanly to `PAUSED` without deleting progress |
| 9–14 | Phone reboot, Airplane Mode, seek, shuffle, repeat, lockscreen, background playback | **Not yet physically executed on handset** | Reuses `LumenPlaybackService` Media3 ExoPlayer + SQLite `Context.filesDir` so all native playback controls work identically; physical Android handset test recommended after installing `Lumen-debug.apk` |
| 15 | Low storage / storage budget exceeded | **Verified in code** | Checks `maxStorageMB` budget + `StatFs.getAvailableBytes()` before starting; stops new downloads without auto-deleting saved tracks |
| 16–18 | Duplicate downloads, delete track, shared playlist references | **PASS (Automated Unit Test)** | `collectionRefs[]` reference counting verified in `tests/offlineVault.test.mjs` |
| 21 | Missing / corrupted offline asset detection | **PASS (Automated Unit Test)** | SHA-256 tamper detection verified in `tests/offlineVault.test.mjs`; marks `needsRepair: true` |
| 22 | Unsupported sources (JioSaavn / YouTube / iTunes previews) blocked | **PASS (Automated Unit Test)** | Explicitly verified in `tests/offlineVault.test.mjs` |
| 23–24 | Online streaming preserved; Offline-Only Mode blocks online requests | **Verified in code (`audioEngine.ts` + `offlinePlaybackAdapter.ts`)** | `resolveOfflineFirst()` short-circuits before `PlaybackResolver` when Offline Mode is enabled |
| 25 | Frontend recreation resyncs with native persistent state | **Verified in code** | `OfflineDownloadManager.init()` calls `LumenAudio.getDownloads()` to re-hydrate from native SQLite on every launch |

---

## 3. Explicitly Unverified on Physical Hardware

Because no physical Android phone or running Android Emulator is attached via `adb` in this workstation session, the following real-device checks remain to be verified directly after installing the newly built `Lumen-debug.apk`:
- Live OEM background foreground notification appearance during download (Samsung OneUI / Xiaomi MIUI).
- Airplane Mode playback after cold phone reboot.
- Lock-screen / Bluetooth AVRCP next/previous controls while playing `.lum` files offline.
- Compatible APK-over-APK upgrade preservation test (`adb install -r`).
