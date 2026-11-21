# LUMEN — Phased Implementation Roadmap (`LUMEN_IMPLEMENTATION_ROADMAP.md`)

---

## Phase 0: Immediate Fixes & Audit Baseline (COMPLETED)
- [x] Full codebase audit & 6 master audit documents generated.
- [x] Home page reordered (*Your Playlists* immediately beneath *Personalized Quick Mix*), shelf subtitles removed, single-line mobile headings calibrated.
- [x] Listening Stats fixed (local persistent playback telemetry log, cumulative `play_count * duration` calculation, Top Artists "Most Time" primary duration badge).
- [x] Friend Request system upgraded to Supabase Realtime primary (`<30ms` WebSocket push + non-overwriting merge + optimistic UI + async Firestore mirror).
- [x] Authentic username resolution fixed (`@listener` shadowing bug eliminated across App, Friends, Settings, Add Friends).
- [x] QR Code deep-linking wired (`AndroidManifest.xml` intent filters, `MainActivity.java` `onNewIntent` JS bridge, `server.cjs` `/u/:username` smart universal link, `App.tsx` deep-link handler).
- [x] Friends mobile UI fixes (Add Friends Copy Link overlap resolved; Weekly Album Club 2-line title wrapping).
- [x] Always-fresh download portal (`server.cjs` `pickNewestExistingFile` by `mtimeMs` + dual Android `.apk` & Windows `.exe` cards in General & Account Details).
- [x] Verified clean `tsc --noEmit` (0 errors), `vite build`, fresh Windows Setup `.exe`, and fresh Android `.apk`.

---

## Phase 1: Playback Hardening, Performance & Visual Polish (Target: Next Approval)
**Milestones:**
1. **Playback Race Guard (`audioEngine.ts`)**: Add monotonic `playRequestToken` to guarantee zero duplicate streams under rapid clicking or poor networks.
2. **Dynamic Waveform Scrubber (`LiquidWaveformScrubber.tsx`)**: Replace linear scrubber in Now Playing & Desktop Dock with a single continuous flowing audio-reactive waveform line tinted with dynamic album-art color.
3. **Code-Splitting & GPU Optimization**:
   - Split `FriendsPageView`, `SettingsHubModal`, `AudioLabView`, `TvNowPlayingStage` via `React.lazy` + `manualChunks` in `vite.config.ts` (target: <800 KB initial bundle).
   - Remove `ctx.shadowBlur` from 60fps Canvas visualizer (replace with 2-pass glow stroke) and remove nested mobile `backdrop-blur`.
   - Pause background canvas & timers when `document.hidden === true`.
4. **Native Android Queue Continuity**: Advance next track natively inside `LumenPlaybackService.java` on `STATE_ENDED` so screen-off playback never stalls.

**Completion Criteria:**
- Initial JS chunk < 850 KB; 0 TypeScript errors; smooth 60fps scroll on Android mid-range device; zero duplicate audio playback on 10x rapid click stress test.

---

## Phase 2: Spotify-Grade Encrypted Offline Vault (`.lum`)
**Milestones:**
1. **Android Native Vault**: Implement `LumenVaultPlugin.java` (AES-256-GCM 256 KB chunked encryption, Android Keystore key wrapping, internal private `files/vault/` + `.nomedia`) and `LumDataSource.java` for Media3 seamless seeking.
2. **Windows Electron Vault**: Implement `lumen-vault://` protocol handler in `electron/main.cjs` using Electron `safeStorage` + byte-range streaming decryption.
3. **Web/PWA Vault**: Implement OPFS / IndexedDB encrypted chunk store in `src/services/offlineVaultService.ts`.
4. **Download UI & Manager**: Add playlist download toggles, per-track download progress rings, offline badge, and Settings > Storage vault manager.

**Completion Criteria:**
- Downloaded tracks play in Airplane Mode with full seeking, lyrics, and dynamic artwork colors.
- Zero audio files appear in Android Downloads, Gallery, File Manager, or third-party music apps.

---

## Phase 3: Song Debate Studio & Security Hardening
**Milestones:**
1. **Song Debate (Solo & Multiplayer)**: Implement `songDebateService.ts` + `SongDebateView.tsx` with 3-artist pool builder, synchronized Supabase Realtime voting rounds, tie handling, and non-conflicting 30s audio previews.
2. **Security Hardening**: Enforce Supabase Row Level Security (RLS) policies on social tables and migrate private invites off the global `lumen:social` channel onto authenticated per-user channels (`user:{uid}`).
3. **In-App Update Banner**: Poll `/api/downloads/info` on startup and notify users inside the app when a newer APK or Windows `.exe` is available.

**Completion Criteria:**
- 2+ devices complete a full Multiplayer Song Debate bracket with synchronized votes and previews; RLS verified against unauthorized cross-user reads.
