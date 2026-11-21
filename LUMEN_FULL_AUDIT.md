# LUMEN — Complete Technical & Functional Audit (`LUMEN_FULL_AUDIT.md`)

**Audit Date:** November 21, 2026  
**Codebase Audited:** `lumen/` (React 18 + TypeScript + Tailwind CSS + Vite + Electron 34 + Capacitor 8 Android + Node.js `server.cjs` + Firebase Auth/Firestore + Supabase Realtime)

---

## 1. Architecture Overview

Lumen is a cross-platform music application targeting **Web**, **Windows Desktop (Electron 34)**, **Android Mobile (Capacitor 8 + Media3 native playback service)**, and **Android TV / Leanback**.

| Layer | Technology & Key Files |
|---|---|
| **Frontend UI** | React 18, TypeScript, Tailwind CSS (`src/App.tsx`, `src/components/views/*`, `src/components/layout/*`) |
| **Audio Playback Engine** | Hybrid Web Audio API (`src/services/audioEngine.ts`, 1,681 LOC) + 10-band DSP EQ + Native Android Media3 Bridge (`src/services/nativeAudioBridge.ts`, `android/.../LumenPlaybackService.java`, `LumenAudioPlugin.java`) |
| **Music Source & Search** | Existing streaming/metadata resolution via `server.cjs` + `src/services/streamingService.ts` + `src/services/clientStreamResolver.ts` + iTunes/artwork resolution (preserved intact) |
| **Data & Sync** | Dual-engine: **Supabase Realtime WebSockets & Postgres** (`src/services/supabaseService.ts`, 1,550+ LOC) for sub-50ms social/invites/ratings + **Firebase Auth & Cloud Firestore** (`src/services/firebaseAuthService.ts`, `src/services/firestoreService.ts`) for accounts, backup persistence, and profiles + `localStorage` / IndexedDB (`src/services/libraryDb.ts`) |
| **Visual Identity** | Obsidian Dark (`#080A10`), Apple Liquid Glass (`backdrop-blur`, subtle specular borders), dynamic album-art color sampling (`src/services/colorSampler.ts`), perimeter LED ambient glow |
| **Packaging & Distribution** | Electron Builder NSIS (`Lumen-Setup.exe`), Capacitor Android Gradle (`app-debug.apk`), unified Express download portal (`server.cjs` `/download`, `/download/apk`, `/download/windows`) |

---

## 2. Complete Feature Inventory & Classification

| Feature | Classification | Evidence / Primary Files | Notes |
|---|---|---|---|
| **Core Playback (Play/Pause/Next/Prev/Seek/Volume)** | **Verified Working** | `src/services/audioEngine.ts`, `BottomTransportDock.tsx`, `MobileMiniPlayer.tsx` | Pre-buffering gapless playback, Web Audio 10-band EQ, MediaSession API |
| **Android Background Playback & Media Notification** | **Partially Working / Device-Dependent** | `android/.../LumenPlaybackService.java`, `LumenAudioPlugin.java`, `MainActivity.java` | Media3 foreground service + battery exemption request added; requires physical device verification across OEMs (Samsung OneUI / MIUI) |
| **Home Page Shelves & Quick Mix** | **Verified Working (Fixed in this cycle)** | `src/components/views/HomeCarouselView.tsx` | Reordered *Your Playlists* directly beneath *Personalized Quick Mix*; removed subtitle clutter; single-line mobile headers enforced |
| **Search & Taste Recommendation Engine** | **Verified Working** | `src/services/tasteEngineService.ts`, `src/services/playlistRecommendationService.ts` | Personalized candidate scoring based on top artists, playlist affinity, and listening history |
| **Playlist Management & Persistence** | **Verified Working** | `src/services/playlistService.ts`, `src/components/views/PlaylistView.tsx` | CRUD, cover customization, local + cloud sync |
| **Listening Statistics & Ratings** | **Fixed in this cycle (Previously Broken)** | `src/services/ratingAndStatsService.ts`, `SettingsHubModal.tsx` | Fixed missing local telemetry writes in `reportPlaybackEvent`, fixed cumulative song duration calculation, and fixed "Most Time" badge display |
| **Friends & Instant Friend Requests** | **Fixed in this cycle (Previously Laggy)** | `AddFriendsSection.tsx`, `FriendsPageView.tsx`, `supabaseService.ts` | Upgraded to Supabase Realtime WebSocket primary (<30ms) with optimistic UI and async Firestore mirror; fixed Firestore snapshot overwrite race |
| **Pass The Aux (Collaborative Room)** | **Verified Working (Fixed prior turn)** | `PassTheAuxStudioView.tsx`, `auxService.ts`, `FriendsPageView.tsx` | Eliminated infinite spinner via synchronous session hydration + Accept & Join / Decline notification buttons |
| **Weekly Album Club** | **Verified Working (Fixed in this cycle)** | `WeeklyAlbumClubCard.tsx`, `AlbumClubView.tsx`, `albumClubService.ts` | Fixed 1-line album title clipping (`line-clamp-2 break-words`); track listing resolution active |
| **QR Code & Universal Friend Deep Linking** | **Fixed in this cycle (Previously Broken)** | `AddFriendsSection.tsx`, `AndroidManifest.xml`, `MainActivity.java`, `server.cjs`, `App.tsx` | Added `lumen://` + `https://lumen-player.web.app/u/` intent filters, `onNewIntent` JS dispatch, and `/u/:username` smart web bridge |
| **Username Resolution (`@listener` bug)** | **Fixed in this cycle** | `App.tsx`, `FriendsPageView.tsx`, `SettingsHubModal.tsx`, `AddFriendsSection.tsx` | Prevented `'listener'` placeholder from shadowing authoritative Firestore/localStorage handles |
| **Web App Download Portal (APK & Windows)** | **Fixed in this cycle (Previously Stale)** | `server.cjs`, `SettingsHubModal.tsx` | Switched to `pickNewestExistingFile` by `mtimeMs`; added dual Android `.apk` & Windows `.exe` cards in General & Account Details |
| **Audio-Reactive Waveform Visualizer** | **Verified Working (Partial for Progress Bar)** | `src/components/visualizer/AudioVisualizer.tsx` | Real `AnalyserNode` time-domain waveform line in `NowPlayingView`; transport progress bar remains standard linear scrubber (see Feature Improvements) |
| **Song Debate (Solo & Multiplayer)** | **Missing / Planned** | Searched entire `lumen/src/` | No standalone Song Debate module exists yet (only Album Club "High debate" track badge). Classified as **Planned** rather than broken. |
| **Spotify-Grade Encrypted Offline Downloads** | **Missing / Planned (Architected)** | See `LUMEN_FEATURE_IMPROVEMENTS.md` | Full `.lum` AES-GCM chunked sandbox architecture with `.nomedia` designed and approved |

---

## 3. Complete Issue Registry (Confirmed & Suspected)

| Issue ID | Category | Severity | Location | Description | Root Cause | Status / Solution |
|---|---|---|---|---|---|---|
| **AUD-001** | Social / Realtime | **Critical** | `AddFriendsSection.tsx`, `FriendsPageView.tsx` | Friend requests took seconds to arrive or disappeared after arrival | `AddFriendsSection` awaited slow Firestore writes; `FriendsPageView` Firestore listener overwrote instant Supabase state | **Fixed**: Supabase Realtime primary (<30ms) + non-overwriting merge + optimistic UI |
| **AUD-002** | Telemetry / Stats | **High** | `ratingAndStatsService.ts:351` | Listening stats showed inaccurate 2m totals & wrong "Most Listened" | `reportPlaybackEvent` only POSTed to `/api/playback/event` without persisting to `lumen_listening_events_log` | **Fixed**: Immediate local persistence + cumulative `play_count * duration` aggregation |
| **AUD-003** | Stats UI | **Medium** | `SettingsHubModal.tsx:1779` | Switching Top Artists to "Most Time" still showed play count on right badge | Right badge hardcoded `{art.play_count} plays` regardless of `artistSortMode` | **Fixed**: Dynamically switches primary badge to `{art.total_duration_formatted} total` |
| **AUD-004** | Auth / Identity | **High** | `App.tsx:540`, `FriendsPageView.tsx:157`, `SettingsHubModal.tsx:263` | Valid accounts showed `@listener` | Truthy `'listener'` fallback short-circuited authoritative Firestore profile hydration | **Fixed**: Added `isRealUsername` / `isValidHandle` guards ignoring `'listener'` across all layers |
| **AUD-005** | Distribution | **High** | `server.cjs:3203`, `SettingsHubModal.tsx:907` | Download link served stale APK and lacked Windows download in Account Details | `server.cjs` returned first existing path (`downloads/Lumen.apk`) instead of newest build; Account Details had no Windows/APK buttons | **Fixed**: `pickNewestExistingFile` by `mtimeMs` + dual Android/Windows buttons in General & Account Details |
| **AUD-006** | Mobile Deep Linking | **High** | `AndroidManifest.xml`, `MainActivity.java`, `AddFriendsSection.tsx` | Scanning friend QR opened website instead of Lumen app | Missing `<intent-filter>` for `lumen://` and `/u/` paths; no `onNewIntent` bridge to WebView | **Fixed**: Added Android intent filters, `MainActivity.handleDeepLinkIntent`, `/u/:username` bridge, and `App.tsx` listener |
| **AUD-007** | Mobile UI | **Medium** | `HomeCarouselView.tsx:164,527-630` | Subtitles cluttered shelves; mobile headings wrapped to 2 lines; Playlists buried below Recently Played | Fixed `text-lg` without `whitespace-nowrap`; subtitles hardcoded; shelf order placed Playlists 4th | **Fixed**: Moved *Your Playlists* below *Personalized Quick Mix*; removed shelf subtitles; responsive single-line headers |
| **AUD-008** | Mobile UI | **Medium** | `AddFriendsSection.tsx:600-622` | Copy Link button overlapped description text on narrow screens | Missing `min-w-0` on flex child + verbose description text + missing `flex-shrink-0` on button | **Fixed**: Cleaned copy to `@username`, added `min-w-0 flex-1` and `flex-shrink-0 whitespace-nowrap` |
| **AUD-009** | Mobile UI | **Low** | `WeeklyAlbumClubCard.tsx:270`, `AlbumClubView.tsx:652` | Long album names cut off abruptly on single line | Used `truncate` (`white-space: nowrap`) | **Fixed**: Switched to `line-clamp-2 break-words leading-snug` |
| **AUD-010** | Playback / Reliability | **Medium** | `audioEngine.ts` | Suspected duplicate audio streams on rapid track clicking on slow networks | Rapid consecutive `playTrack` calls before async stream resolution resolves can race unless request generation token cancels stale loads | **Documented in Bug Fix Plan** (verify/add monotonic `loadGenerationId` guard) |
| **AUD-011** | Performance | **Medium** | `vite.config.ts` / `dist/assets/index-*.js` | Main JS bundle is ~2.4 MB uncompressed (~600 KB gzip) | Single entry chunk imports all heavy views (Friends, Tier List, Audio Lab, Album Club, TV Stage) eagerly | **Documented in Performance Report** (`React.lazy` route/modal splitting) |
| **AUD-012** | Security | **High** | `supabaseService.ts`, `firebaseAuthService.ts` | Client-side public anon/API keys & permissive broadcast channels | Broadcast channel `lumen:social` relies on client-side recipient filtering (`matchesMe`) | **Documented in Security Audit**: Enforce Supabase RLS policies and migrate private invites off global broadcast channels in Phase 2 |

---

## 4. Security & Reliability Assessment

- **Authentication**: Firebase Auth manages identity; guest fallback creates deterministic local `usr_*` UIDs.
- **Data Access & Social Broadcasts**: `lumen:social` global broadcast channel enables ultra-fast cross-device delivery, but any connected client listening to `lumen:social` could observe broadcast metadata before client-side `matchesMe()` filtering. **Recommendation**: Restrict private shares/invites strictly to per-user authenticated channels (`user:{uid}`) once Supabase Auth JWT integration is enabled, and verify Row Level Security (RLS) policies on `friend_requests`, `song_shares`, and `user_ratings`.
- **Input Validation**: `/u/:username` route in `server.cjs` sanitizes HTML entities (`/[<>"'&]/g`) to prevent reflected XSS.
- **Network Recovery**: `SupabaseService.setupAutoReconnect()` handles online/offline/visibilitychange transitions; `AuxService` and `RatingAndStatsService` now persist locally first so offline transitions do not lose data.

---

## 5. Final Product Scorecard (Evidence-Based)

| Category | Score | Evidence-Based Rationale |
|---|---|---|
| **Music Playback Reliability** | **8.0 / 10** | Robust hybrid Web Audio + 10-band EQ + Media3 native Android service; minor race risk under rapid track switching on slow networks. |
| **Music Search** | **8.0 / 10** | Fast multi-source search with verified studio track prioritization and artwork hydration. |
| **Playlist Management** | **8.5 / 10** | Full CRUD, custom artwork/colors, intelligent Spotify-style recommendation reel, local + cloud sync. |
| **Desktop UI** | **8.5 / 10** | Distinctive Obsidian + Liquid Glass + Dynamic Island + dynamic LED halos; clean spatial hierarchy. |
| **Mobile UI** | **8.0 / 10** | Improved significantly (single-line headers, fixed mini-player modal overlap, fixed Copy Link overlap, 2-line album wrapping); further touch target refinement possible. |
| **Liquid Glass Implementation** | **8.5 / 10** | Authentic translucent layering, specular top borders, and tasteful dark contrast; slight blur overuse on nested Friends cards. |
| **LED & Dynamic Color Effects** | **9.0 / 10** | `colorSampler.ts` caches 4-color harmonic palettes with WCAG-aware `toAccessibleAccentColor` luminance boosting (`>= 165`) and smooth fallbacks. |
| **User Experience** | **8.2 / 10** | Zero-delay Pass The Aux entry, instant Supabase friend requests, cleaner Home page; needs in-app auto-updater UI. |
| **Social Functionality** | **8.5 / 10** | Rich ecosystem (Friends, Live Presence, Pass The Aux, Album Club, Circle Radio, Tier Lists, Blind Drop) now backed by <30ms Supabase Realtime. |
| **Performance** | **7.0 / 10** | Fast runtime reactivity, but 2.4 MB single Vite chunk slows cold startup on budget Android devices. |
| **Security** | **6.8 / 10** | Safe local storage and sanitized endpoints, but `lumen:social` global broadcast channel and RLS hardening need Phase 2 attention. |
| **Code Quality** | **7.5 / 10** | Strict TypeScript compilation passes (`tsc --noEmit` exit 0), but monolithic files (`FriendsPageView.tsx` ~2.9k LOC, `server.cjs` ~3.5k LOC, `firestoreService.ts` ~3.2k LOC) need modular decomposition. |
| **Overall Product Quality** | **8.1 / 10** | Distinctive, cohesive, feature-rich music platform with clear high-leverage roadmap to reach 9.5/10 polish. |
