# LUMEN — Screen-by-Screen UI/UX, Liquid Glass & LED Design Audit (`LUMEN_UI_UX_AUDIT.md`)

**Design Philosophy Preserved:** Apple Liquid Glass translucency, Obsidian Dark (`#080A10`) layering, dynamic album-art color extraction (`src/services/colorSampler.ts`), subtle perimeter LED edge lighting, crisp Syne/Outfit typography.

---

## 1. Liquid Glass & Dynamic Album-Art Color System Audit

### Verified Strengths
- **`colorSampler.ts` Palette Engine**: Extracts 4 harmonic colors (`dominant`, complementary, analogous shades) from album art via off-screen canvas with `colorCache` memoization.
- **Dark-Art Accessibility Protection**: `toAccessibleAccentColor()` computes WCAG relative luminance (`0.2126*R + 0.7152*G + 0.0722*B`) and automatically boosts luminance up to `>= 165` so dark navy or monochrome album covers never produce unreadable buttons or text.
- **Deterministic Fallback**: `hashToColorSample()` ensures tracks without artwork still yield vibrant, cohesive LED accents instead of flat gray.

### Visual & Glass Inconsistencies Found
1. **Nested Backdrop Blurs in Friends Hub (`FriendsPageView.tsx`)**: Multiple nested containers stack `backdrop-blur-xl` / `backdrop-blur-3xl` inside glass cards, creating murky contrast and high GPU composite cost on mobile. **Recommendation**: Keep backdrop blur strictly on top-level floating chrome (Dynamic Island, Bottom Dock, Mini-Player, Modals) and use clean translucent fills (`bg-white/[0.04]` + `border-white/10`) for inner list items.
2. **Inconsistent Corner Radii**: Mixes `rounded-xl`, `rounded-2xl`, and `rounded-3xl` within the same grid on Friends & Settings. **Recommendation**: Standardize to `rounded-3xl` for major modals/hero cards, `rounded-2xl` for section cards, `rounded-xl` for controls/thumbnails, and `rounded-full` for pills/buttons.
3. **Fixed Cyan Fallback in Waveform Visualizer (`AudioVisualizer.tsx:110`)**: Mode `'waveform'` hardcodes `ctx.strokeStyle = '#63E8FF'` while setting `shadowColor = glowColor`. **Recommendation**: Drive `strokeStyle` from `toAccessibleAccentColor(glowColor)` so the waveform line naturally adapts to every album cover.

---

## 2. Screen-by-Screen Assessment (Desktop & Mobile)

### A. Home Screen (`HomeCarouselView.tsx`)
- **Fixed in this Cycle**:
  - Moved **Your Playlists** directly below **Personalized Quick Mix** so user collections are immediately reachable without scrolling past global charts.
  - Removed redundant subtitles beneath *Personalized Quick Mix*, *Trending Global Hits*, *Recently Played*, *Your Playlists*, and *Genre Mixes* to eliminate vertical noise and let album art breathe.
  - Calibrated mobile shelf headings (`text-sm sm:text-base md:text-xl whitespace-nowrap truncate`) so all headings sit cleanly on **one single line** on phones.
- **Remaining Polish Opportunity**:
  - On desktop hover, track cards scale `1.20x` (`HomeCarouselView.tsx:216`). On touch/mobile devices, tapping can momentarily trigger hover scale before navigation. Guard hover scaling with `@media (hover: hover)` or `sm:hover:scale-[1.12]` for calmer, refined Liquid Glass motion.

### B. Navigation Chrome (Desktop Dynamic Island vs. Mobile Bottom Nav & Mini-Player)
- **Desktop (`TopDynamicIsland.tsx`, `BottomTransportDock.tsx`)**: Frameless Electron drag region with explicit `-webkit-app-region: no-drag` on interactive pills (fixed in prior cycle). Clean, iconic floating glass dock.
- **Mobile (`MobileBottomNav.tsx`, `MobileMiniPlayer.tsx`)**:
  - Mini-player properly hides when full-screen modals / Playlist Match Reel open so bottom actions (`Next`, `Done`) are never blocked.
  - **Polish Opportunity**: Ensure `padding-bottom: calc(env(safe-area-inset-bottom) + 84px)` is consistently applied to every scrollable mobile sub-view (including Friends sub-views and Album Club) so the bottom card is never hidden behind the mini-player.

### C. Now Playing & Audio-Reactive Progress (`NowPlayingView.tsx`, `AudioVisualizer.tsx`)
- **Current State**: Displays full-bleed ambient artwork backdrop, synced lyrics, and real `AnalyserNode` time-domain waveform line in `AudioVisualizer`.
- **Target Evolution**: Integrate the single continuous flowing waveform line directly into the interactive seekable progress bar (played portion glowing in dynamic album color, unplayed portion subtle translucent glass line) — see `LUMEN_FEATURE_IMPROVEMENTS.md`.

### D. Friends Hub, Add Friends & Weekly Album Club
- **Fixed in this Cycle**:
  - **Live Activity & Invites**: Added glowing amber **Accept & Join** and **Decline** pills for Pass The Aux invites directly beneath the Friends Online bar.
  - **Weekly Album Club (`WeeklyAlbumClubCard.tsx`, `AlbumClubView.tsx`)**: Long album titles now wrap cleanly across 2 lines (`line-clamp-2 break-words`) instead of clipping on mobile.
  - **Add Friends (`AddFriendsSection.tsx`)**: Fixed Copy Link button overlapping text on mobile by removing redundant copy, adding `min-w-0 flex-1`, and locking button to `flex-shrink-0 whitespace-nowrap`.
- **Remaining Polish Opportunity**:
  - Consolidate the 8-card Quick Actions grid + 3 Active Collaborative Rooms cards in `FriendsPageView.tsx` into a tighter 2-tier visual hierarchy on mobile so the Friends Hub feels serene rather than card-heavy.

### E. Settings Hub, Listening Stats & Download Portal (`SettingsHubModal.tsx`)
- **Fixed in this Cycle**:
  - **Top Played Artists**: Switching to *Most Time* now switches the primary right metric badge to total listened duration (`Xh Ym total`) in amber, moving play count to the subtitle.
  - **Most Listened By Duration**: Now displays cumulative listening time across all plays (`play_count * duration` + logged telemetry) with play counts shown clearly.
  - **Native App Downloads**: Added dedicated **Download Android (.apk)** and **Download Windows (.exe)** buttons in both **General** and **Account Details** tabs, backed by cache-busted, newest-file-first server endpoints.
