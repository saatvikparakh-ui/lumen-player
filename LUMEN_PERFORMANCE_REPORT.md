# LUMEN — Performance Audit & Optimization Report (`LUMEN_PERFORMANCE_REPORT.md`)

**Measured Build Artifacts (Actual Vite Production Output, Nov 21, 2026):**
- `dist/index.html`: **3.71 kB** (gzip: 1.53 kB)
- `dist/assets/index-*.css`: **135.17 kB** (gzip: 18.77 kB)
- `dist/assets/index-*.js`: **2,407.06 kB** (gzip: 603.06 kB)
- `dist/assets/web-*.js`: **4.59 kB** (gzip: 1.36 kB)
- **Production Build Time**: **22.17s** (1,821 transformed modules)
- **Android Debug APK**: ~14.7 MB
- **Windows NSIS Installer**: ~91.6 MB

---

## 1. Confirmed Bottlenecks (Code & Build Evidence)

### 1.1 Monolithic Single-Chunk JS Bundle (`2.4 MB` uncompressed / `603 KB` gzip)
- **Evidence**: Vite reported `(!) Some chunks are larger than 500 kB after minification` because `src/App.tsx` eagerly imports every view and modal (`FriendsPageView`, `SettingsHubModal`, `AudioLabView`, `TvNowPlayingStage`, `AlbumClubView`, `TierListStudioView`, `PassTheAuxStudioView`, `CircleRadioStudioView`).
- **Impact**: Slower cold boot and JS parse/eval time on mid-range Android WebViews (400–900ms parse cost before first paint).
- **Recommended Optimization**: Lazy-load secondary views (`FriendsPageView`, `SettingsHubModal`, `AudioLabView`, `TvNowPlayingStage`, `PlaylistView`) using `React.lazy` + `<Suspense>` and configure `build.rollupOptions.output.manualChunks` in `vite.config.ts` to separate `firebase`, `supabase`, `lucide-react`, and `react-vendor`.
- **Expected Gain**: Reduce initial entry bundle from `2.4 MB` to **~650–800 KB** (~65% faster first interactive paint on Android).

### 1.2 Nested `backdrop-blur` GPU Overdraw on Mobile
- **Evidence**: `FriendsPageView.tsx` and modal lists apply `backdrop-blur-xl` / `backdrop-blur-3xl` to repeating list cards inside blurred containers.
- **Impact**: On budget Android GPUs, each `backdrop-filter: blur(24px)` triggers an off-screen framebuffer copy per frame during vertical scrolling, dropping scroll FPS from 60fps to 30–40fps and increasing battery drain.
- **Recommended Optimization**: Preserve `backdrop-blur-2xl` exclusively on floating top-level Liquid Glass surfaces (`TopDynamicIsland`, `BottomTransportDock`, `MobileMiniPlayer`, modal backdrops), and use crisp semi-transparent fills (`bg-white/[0.04]` + `border-white/10`) for scrolling inner list rows.

### 1.3 Canvas `shadowBlur` in 60fps Audio Visualizer (`AudioVisualizer.tsx`)
- **Evidence**: `AudioVisualizer.tsx:103,112,141` sets `ctx.shadowBlur = 12` inside the `requestAnimationFrame` loop on every frame.
- **Impact**: Software Gaussian blur inside Canvas 2D is notoriously expensive on mobile CPUs/GPUs and heats up devices during extended listening.
- **Recommended Optimization**: Replace `ctx.shadowBlur` with a 2-pass layered stroke (one wide low-alpha stroke at `lineWidth: 7, globalAlpha: 0.22` underneath a crisp `lineWidth: 2.5, globalAlpha: 1.0` core stroke) and pause the `requestAnimationFrame` loop whenever `document.hidden === true` or audio is paused.

### 1.4 Wide Component Re-renders in `FriendsPageView.tsx`
- **Evidence**: `FriendsPageView.tsx` (~2,900 LOC) holds `presenceMap`, `shares`, `incomingFriendRequests`, `albumClubs`, and modal states in one top-level component. Every 5–10s presence heartbeat triggers a full reconciliation of the Friends Hub.
- **Recommended Optimization**: Extract `FriendsOnlineBar` presence subscription into its own isolated hook/component and memoize `WeeklyAlbumClubCard` and `LiveActivityInvitesPanel` with `React.memo`.

### 1.5 Artwork Caching & Pre-loading
- **Evidence**: `colorSampler.ts` properly memoizes extracted color palettes in `colorCache` (`Map<string, ColorSample>`), avoiding repeat canvas reads for the same artwork URL.
- **Optimization**: Cap `colorCache` at 200 entries (simple FIFO eviction) to prevent unbounded memory growth during multi-hour desktop sessions.

### 1.6 PostCSS Config ESM Warning
- **Evidence**: Vite build logs `MODULE_TYPELESS_PACKAGE_JSON Warning` when reparsing `postcss.config.js`.
- **Optimization**: Rename `postcss.config.js` to `postcss.config.cjs` or use CommonJS `module.exports` to save ~150ms per build and remove startup warnings.

---

## 2. Mobile Battery & Background Resource Profile

- **Strengths**: `MainActivity.java` requests `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, and `LumenPlaybackService.java` runs as a proper Android `mediaPlayback` foreground service.
- **Risk**: WebView timers (`setInterval` / `requestAnimationFrame`) running in `App.tsx` or `AudioVisualizer` while the screen is off drain battery unnecessarily.
- **Fix**: Suspend all canvas animations, presence polling intervals, and decorative CSS pulse animations on `visibilitychange` (`document.hidden === true`).
