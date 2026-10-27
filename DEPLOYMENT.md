# 🚀 LUMEN — 24/7 Cloud Deployment Guide

## Why Netlify Failed (and why this architecture is different)

When you tried deploying on **Netlify**, music streaming, searching, and playback failed because:
1. **Netlify is a static Jamstack host**: Netlify serves static HTML/CSS files from a CDN edge. It cannot run a continuous background Node.js server (`server.cjs`).
2. **No Persistent Audio Streaming**: Netlify's serverless functions terminate after 10–26 seconds. Audio streaming pipes (`@distube/ytdl-core`, ffmpeg, audio chunk streaming) require continuous, persistent HTTP connections.
3. **No Persistent SQLite Database**: Netlify is read-only; it destroys local disk writes on every request, so your songs, playlists, ratings, and friend system cannot persist.

---

## The Solution: Deploy 24/7 to Render.com (100% Free)

**Render.com** supports Docker containers and Node.js Web Services with persistent disks. It keeps your server running 24/7 in the cloud so you and your friends can access it from phones, tablets, and computers even when your laptop is turned off.

### Step 1: Push your project to GitHub
1. Open PowerShell in `c:\Users\kenis\OneDrive\Desktop\saatvik\project 1\lumen`.
2. Initialize git and commit:
   ```bash
   git init
   git add .
   git commit -m "Deploy LUMEN Music Engine"
   ```
3. Push to your GitHub repository (e.g. `https://github.com/your-username/lumen`).

---

### Step 2: One-Click Deploy on Render.com
1. Go to [https://render.com](https://render.com) and sign in with GitHub (Free).
2. Click **New +** -> **Web Service**.
3. Select your `lumen` GitHub repository.
4. Render will automatically detect the `Dockerfile` and `render.yaml`:
   - **Environment**: `Docker`
   - **Plan**: `Free`
   - **Health Check Path**: `/api/health`
5. Click **Deploy Web Service**!

Render will build the Vite app, start `node server.cjs`, and give you a public URL like:
👉 **`https://lumen-music-player.onrender.com`**

---

### Step 3: Open on Any Device
- **Phones & Tablets**: Open Safari, Chrome, or Firefox and navigate to your Render URL.
- **PWA Installation**: Tap **Share -> Add to Home Screen** on iOS/Android to run LUMEN as a native full-screen app!
- **Auto Responsive Layout**: LUMEN automatically adapts into Phone Mode, Tablet Mode (with the 3/4 + 1/4 playlist player layout), or Desktop Mode. You can also manually toggle modes in **Settings -> Playback -> Device Layout Mode**.

---

## Alternative Cloud Hosts
- **Railway.app**: Select "Deploy from GitHub repo" -> Set port `3847` -> Deploys in 2 minutes.
- **Fly.io**: Run `fly launch` -> picks up `Dockerfile` automatically.
