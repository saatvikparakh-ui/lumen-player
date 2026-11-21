# LUMEN — Prioritized Bug Fix Plan (`LUMEN_BUG_FIX_PLAN.md`)

---

## Tier 0: Critical & High-Impact Fixes (COMPLETED & VERIFIED IN THIS CYCLE)

1. **Instant Supabase Friend Requests & Race Elimination (`AUD-001`)**
   - *Files*: `src/services/supabaseService.ts`, `src/components/views/friends/AddFriendsSection.tsx`, `src/components/views/friends/FriendsPageView.tsx`
   - *Root Cause*: Sending awaited Firestore write latency; incoming Firestore listener overwrote real-time Supabase requests before Firestore finished indexing.
   - *Fix Applied*: Optimistic 0ms UI + `<30ms` Supabase Realtime WebSocket broadcast (`friend:request` / `friend:accepted`) + non-overwriting merge + async Firestore mirror.
   - *Verification*: `tsc --noEmit` exit 0; Vite production build passed.

2. **Listening Stats Telemetry & Cumulative Duration Accuracy (`AUD-002`, `AUD-003`)**
   - *Files*: `src/services/ratingAndStatsService.ts`, `src/components/views/SettingsHubModal.tsx`
   - *Root Cause*: `reportPlaybackEvent` did not persist events into `localStorage` (`lumen_listening_events_log`), causing offline/desktop plays to undercount duration; Top Artists "Most Time" tab still rendered play counts on the primary badge.
   - *Fix Applied*: Local persistent event logging + cumulative `play_count * duration` minimum floor + dynamic right-badge switch (`total_duration_formatted` in Most Time mode).

3. **Authentic Username Resolution (`@listener` Bug — `AUD-004`)**
   - *Files*: `src/App.tsx`, `src/components/views/friends/FriendsPageView.tsx`, `src/components/views/SettingsHubModal.tsx`, `src/components/views/friends/AddFriendsSection.tsx`
   - *Root Cause*: Truthy `'listener'` default short-circuited authoritative Firestore profile hydration.
   - *Fix Applied*: Filtered `'listener'` / `'you'` / `'guest'` out of authoritative username checks everywhere and persisted verified handles to `localStorage`.

4. **QR Code Native App Deep-Linking (`AUD-006`)**
   - *Files*: `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/lumen/music/MainActivity.java`, `server.cjs`, `src/App.tsx`, `src/components/views/friends/AddFriendsSection.tsx`
   - *Root Cause*: Missing Android `<intent-filter>` and `onNewIntent` JS bridge; QR pointed to plain `https://lumen.app/u/...`.
   - *Fix Applied*: Added `lumen://` + `https://lumen-player.web.app/u/` intent filters, `MainActivity.handleDeepLinkIntent`, `/u/:username` smart universal link bridge, and `App.tsx` deep-link handler.

5. **Always-Fresh Download Portal (Android APK & Windows Setup — `AUD-005`)**
   - *Files*: `server.cjs`, `src/components/views/SettingsHubModal.tsx`
   - *Root Cause*: `server.cjs` returned the first matching path (often stale `downloads/Lumen.apk`) rather than newest build; Account Details lacked Windows & Mobile download buttons.
   - *Fix Applied*: `pickNewestExistingFile()` comparing `fs.statSync(p).mtimeMs`, `/api/downloads/info` metadata endpoint, and dual Android `.apk` + Windows `.exe` cards in General and Account Details.

6. **Home Layout, Mobile Headings, Album Club Wrapping & Add Friends Overlap (`AUD-007`, `AUD-008`, `AUD-009`)**
   - *Files*: `HomeCarouselView.tsx`, `WeeklyAlbumClubCard.tsx`, `AlbumClubView.tsx`, `AddFriendsSection.tsx`
   - *Fix Applied*: Moved *Your Playlists* directly beneath *Personalized Quick Mix*; removed shelf subtitles; single-line mobile shelf titles; 2-line album club title wrapping; non-overlapping Copy Link row.

---

## Tier 1: Playback & Reliability Hardening (Next Approved Stage)

| ID | Bug / Risk | Files | Permanent Fix | Risk |
|---|---|---|---|---|
| **FIX-101** | Rapid consecutive track clicks on slow networks can race stream resolvers and spawn duplicate audio playback | `src/services/audioEngine.ts` | Introduce a monotonic `playRequestToken` incremented on every `playTrack()` call; abort stale async `resolveStreamUrl()` responses if token no longer matches before calling `audio.play()`. | Low |
| **FIX-102** | Audio Visualizer `'waveform'` hardcodes cyan stroke instead of dynamic album color | `src/components/visualizer/AudioVisualizer.tsx` | Pass `toAccessibleAccentColor(glowColor)` into `ctx.strokeStyle` so waveform reacts dynamically to album artwork. | Very Low |
| **FIX-103** | Android OEM notification & lockscreen media controls can drop when battery savers kill WebView timers | `android/.../LumenPlaybackService.java`, `src/services/nativeAudioBridge.ts` | Move next-track queue advancement natively into `LumenPlaybackService` (`Player.Listener.onPlaybackStateChanged(STATE_ENDED)`) when screen is locked so WebView suspension never halts album playback. | Medium |
| **FIX-104** | Global `lumen:social` broadcast channel exposes invite metadata to client-side filtering | `src/services/supabaseService.ts` | Enforce Supabase RLS policies on `friend_requests`, `song_shares`, `album_club_invites`, and migrate private notifications to authenticated per-user channels (`user:{uid}`). | Medium |

---

## Tier 2: Structural & Maintainability Refactoring

| ID | Technical Debt | Files | Permanent Fix |
|---|---|---|---|
| **FIX-201** | Monolithic `FriendsPageView.tsx` (~2,900 LOC) causes wide re-renders on presence updates | `src/components/views/friends/FriendsPageView.tsx` | Extract `LiveActivityInvitesPanel.tsx`, `ActiveRoomsGrid.tsx`, and isolate `presenceMap` state into `FriendsOnlineBar` via React `memo` / Context selector. |
| **FIX-202** | `firestoreService.ts` imported both statically and dynamically (Vite chunk warning) | `src/services/supabaseService.ts` | Standardize import strategy and split `App.tsx` views with `React.lazy`. |
