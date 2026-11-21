# LUMEN — High-Value Product Improvements & Offline Architecture (`LUMEN_FEATURE_IMPROVEMENTS.md`)

---

## 1. Spotify-Grade Encrypted Offline Download System (`.lum` Vault Architecture)

**Goal:** Allow users to download songs and playlists directly inside Lumen so they play seamlessly offline with zero internet, while keeping audio **completely hidden from the phone's Downloads folder, Music apps, File Managers, and MediaStore**, just like Spotify.

### 1.1 Approved Technical Architecture (Encrypted Chunked `.lum` + `.nomedia`)

```
[Existing Lumen Stream Resolver]
          │
          ▼ (Authorized Audio Stream)
┌──────────────────────────────────────────────────────────┐
│  Lumen Offline Download Manager (Background Worker)      │
│  1. Splits stream into fixed 256 KB binary chunks        │
│  2. Generates per-track 256-bit AES-GCM Key + random IV  │
│  3. Wraps track key with device-bound Master Key         │
│     (Android Keystore / Electron safeStorage)            │
│  4. Writes encrypted payload as <sha256(trackId)>.lum    │
│  5. Saves encrypted track manifest in SQLite / IndexedDB │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────┐
│  Private Sandboxed Storage (Hidden from OS & Gallery)    │
│  • Android: /data/user/0/com.lumen.music/files/vault/    │
│             + empty .nomedia marker file                 │
│             (Unreachable by Downloads, Files, Gallery,   │
│              or Android MediaScanner)                    │
│  • Windows: %APPDATA%/Lumen/vault/ (NTFS user-scoped)    │
│  • Web PWA: Origin Private File System (OPFS) / IDB      │
└──────────────────────────────────────────────────────────┘
          │
          ▼ (When Playing Offline or Downloaded Track)
┌──────────────────────────────────────────────────────────┐
│  LumenPlaybackService (Android Media3 Custom DataSource) │
│  & Electron Custom Protocol (lumen-vault://)             │
│  • Streams & decrypts 256 KB chunks on-the-fly in RAM    │
│  • Supports instant byte-range seeking (scrubbing)       │
│  • Never writes decrypted .mp3/.m4a to disk              │
└──────────────────────────────────────────────────────────┘
```

### 1.2 Why This Matches Spotify's Standard
1. **Zero Exposure in Phone Downloads/Gallery**: Because files live inside `context.getFilesDir()/vault/` (internal app-private storage, NOT `/storage/emulated/0/Download` or `Music`) and include a `.nomedia` sentinel, neither Android's `MediaStore` nor third-party players can see or index them.
2. **Playable Exclusively Inside Lumen**: Every `.lum` file uses AES-256-GCM authenticated encryption with a per-track key wrapped by the Android Keystore (Hardware-backed TEE/StrongBox on modern phones). Even if copied off a rooted device, the file cannot be opened in VLC or another player.
3. **Instant Seeking Without Decrypting Whole File**: Splitting into 256 KB independently-authenticated chunks (`[Header: magic 'LUM1', version, chunkSize, mime, totalBytes] + [Chunk_0 (IV + Ciphertext + AuthTag)] ... [Chunk_N]`) enables O(1) random-access seeking via `Media3 DataSource` on Android and `lumen-vault://` Range requests on Electron.
4. **Offline Artwork & Lyrics**: Album art thumbnails (compressed WebP) and synced `.lrc` lyrics are stored alongside the encrypted manifest so the full Liquid Glass dynamic LED UI works 100% offline.
5. **Storage Controls**: Smart Download settings inside Settings > Storage:
   - Toggle *"Download over Wi-Fi only"*
   - Quality selector (Standard / High)
   - Live footprint meter (`e.g. 42 tracks • 184 MB in Lumen Vault`) + 1-tap *Remove All Downloads*
   - Playlist-level download toggle switch (just like Spotify's green downward arrow).

### 1.3 Implementation Files & Complexity
- **Files Involved**:
  - `src/services/offlineVaultService.ts` (new TypeScript coordinator)
  - `android/app/src/main/java/com/lumen/music/LumenVaultPlugin.java` (Capacitor plugin using `Cipher("AES/GCM/NoPadding")` + Android Keystore)
  - `android/app/src/main/java/com/lumen/music/LumDataSource.java` (Media3 `BaseDataSource` for on-the-fly chunk decryption & seeking)
  - `electron/main.cjs` (`protocol.handle('lumen-vault', ...)` + `safeStorage` master key)
  - `src/services/audioEngine.ts` (check `OfflineVaultService.hasTrack(track.id)` before calling remote stream resolver — preserves existing music-source architecture completely!)
- **Complexity**: Medium-High (2–3 focused sessions).
- **Performance Impact**: <2% CPU overhead during AES-GCM hardware-accelerated decryption on ARMv8/x64; **zero** network buffering latency and massive mobile battery savings during playback.

---

## 2. Continuous Flowing Audio-Reactive Waveform Progress Bar

- **Problem Solved**: The bottom dock and Now Playing screen currently use a standard linear slider for progress, while the audio-reactive waveform lives separately in `AudioVisualizer.tsx`.
- **Proposed Solution**: Create `<LiquidWaveformScrubber />` rendering a **single continuous flowing Bezier waveform line** across the progress track:
  - Uses real `AudioEngine.getTimeDomainData()` when Web Audio analyser is active, with gentle organic harmonic modulation clearly tagged as fallback when native Android Media3 bypasses Web Audio PCM capture.
  - Left of playhead: vivid dynamic album-art accent color (`toAccessibleAccentColor(dominantColor)`) with subtle 2-pass LED glow.
  - Right of playhead: crisp translucent Liquid Glass line (`rgba(255,255,255,0.22)`).
  - Full pointer/touch drag seeking with haptic tick feedback.
- **Files Involved**: `src/components/common/LiquidWaveformScrubber.tsx`, `BottomTransportDock.tsx`, `NowPlayingView.tsx`.
- **Complexity**: Medium | **Performance**: High-efficiency 2-pass Canvas without `shadowBlur`, auto-paused when tab hidden.

---

## 3. Song Debate Mode (Solo & Multiplayer Bracket)

- **Problem Solved**: Currently missing from the codebase (classified as Planned in Audit).
- **Proposed Solution**: Build a Liquid Glass **Song Debate Studio** inside Friends Hub:
  - **Solo Mode**: Picks 8–16 eligible tracks from user's library/playlists, runs head-to-head comparisons with instant 30-second audio previews (using existing stream resolver without altering music-source architecture; auto-pauses main player & stops previous preview when switching), and outputs final crowned track + shareable card.
  - **Multiplayer Mode**: Supabase Realtime room (`debate:{roomId}`) where each participant picks 3 artists, builds a synchronized bracket pool, votes live with duplicate-vote locks, handles ties via sudden-death tiebreaker, displays live animated vote percentages, and gracefully handles disconnects/rejoins.
- **Files Involved**: `src/services/songDebateService.ts`, `src/components/views/friends/SongDebateView.tsx`, `FriendsPageView.tsx`.
- **Complexity**: High.

---

## 4. In-App Auto-Update Banner (Android APK & Windows Electron)

- **Problem Solved**: Installing a new APK or Windows `.exe` currently requires users to manually check Settings > Download.
- **Proposed Solution**: Query `/api/downloads/info` on startup (already implemented in `server.cjs` in this cycle!). Compare `updatedAt` / `appVersion` against the installed build timestamp; if a newer build is available, show a sleek non-intrusive Liquid Glass pill: *"Update Available • Tap to Install"*.
- **Complexity**: Low | **Files Involved**: `src/services/updateCheckService.ts`, `App.tsx`, `electron/main.cjs`.
