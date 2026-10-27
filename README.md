# LUMEN — High-End Local-First Music System

LUMEN is a high-end, self-hosted, local-first music management and playback application built with **React 19, TypeScript, Tailwind CSS, Web Audio DSP, and Node.js**.

Designed around the aesthetics of high-end audio gear with electric cyan (`#63E8FF`) and violet (`#9A76FF`) LED accents on an almost-black canvas (`#080A10`).

---

## Key Features

1. **Layer 1: Pure Local Playback**:
   - Zero internet requirement for normal listening.
   - Non-destructive recursive folder scanner reads MP3, FLAC, M4A/AAC, WAV, OGG, and Opus files.
   - Extracts embedded album artwork, track numbers, artist, album, and format tags.

2. **The 3D Music Wall**:
   - Hardware-accelerated 3D tilt perspective gallery.
   - Dynamic dominant-color ambient glow sampled from each album cover.
   - Ambient Full-Screen mode for monitors or TVs.
   - Low-power static mode for maximum CPU efficiency.

3. **Audio Lab & DSP Rack**:
   - Studio-grade **10-band Graphic Equalizer** (`32Hz` to `16kHz`).
   - Genre presets: *Bass Boost, Rock, Jazz, Electronic, Vocal, Flat*.
   - Dynamic volume normalisation compressor (ReplayGain-style leveling).
   - 3 switchable 60fps canvas visualizer styles:
     - **LED Bar Spectrum** (Cyan/Violet gradient with peak hold meters)
     - **Neon Waveform** (Glowing oscilloscope line)
     - **Circular Oscilloscope** (Radial Lissajous visualizer)

4. **Now Playing & Synced Lyrics**:
   - Rotating vinyl/artwork with ambient reactive backglow.
   - Synchronized line-by-line lyrics with instant click-to-seek.
   - High-res format, codec, bitrate, and duration tech spec badges.

5. **Layer 2: Home Network Streaming**:
   - Built-in local HTTP stream engine with HTTP 206 Partial Content (Range request) support for instantaneous scrubbing.
   - Open `http://<YOUR-PC-IP>:3847` on your phone, tablet, or another computer on the same Wi-Fi to listen anywhere in your home.

---

## How to Launch

Double-click `launch-lumen.bat` in the project root, or run via terminal:

```bash
cd lumen
npm run serve
```
Then open `http://localhost:3847` in your browser or launch it in standalone window mode:
```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:3847"
```
