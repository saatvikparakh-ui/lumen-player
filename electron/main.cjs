const { app, BrowserWindow, ipcMain, dialog, Menu, powerSaveBlocker, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// Critical Chromium flags for background audio playback and seamless track transition:
// 1. Allow un-gestured HTML5 Audio / Web Audio play in background windows without NotAllowedError
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 2. Prevent timer throttling in background or minimized windows so audio watchdog stays active
app.commandLine.appendSwitch('disable-background-timer-throttling');
// 3. Keep full renderer performance and network alive when window is not focused
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// 4. Prevent Chromium from suspending windows occluded by other applications
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// 5. Ensure audio device pipeline never sleeps
app.commandLine.appendSwitch('enable-audio-service-sandbox');

let mm = null;
try {
  mm = require('music-metadata');
} catch (err) {
  console.warn('[Lumen Electron] music-metadata library not available:', err?.message);
}

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('[Lumen Electron] electron-updater not available:', err?.message);
}

let latestOtaStatus = {
  state: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: 0,
  releaseNotes: null,
  message: null
};
let downloadedInstallerPath = null;
let isManifestUpdateBusy = false;
let lastNotifiedWindowsVersion = null;

const WINDOWS_MANIFEST_URLS = [
  'https://raw.githubusercontent.com/saatvikparakh-ui/lumen-player/main/ota-manifest.json',
  'https://lumen-player.onrender.com/api/ota/manifest',
  'https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/ota-manifest.json'
];

function sanitizeOtaError(err, fallback = 'Could not check for updates right now.') {
  const raw = typeof err === 'string' ? err : (err?.message ? String(err.message) : '');
  const cleaned = raw.trim();
  if (!cleaned) return fallback;
  const lower = cleaned.toLowerCase();
  if (lower.includes('latest.yml') || lower.includes('404')) {
    return 'Update package is syncing. Please try again in a moment.';
  }
  if (lower.includes('enotfound') || lower.includes('econn') || lower.includes('timeout') || lower.includes('network')) {
    return 'Could not reach update server. Check your internet connection.';
  }
  const firstLine = cleaned.split(/\r?\n/)[0].split('Headers:')[0].split(' at ')[0].trim();
  return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : (firstLine || fallback);
}

function compareSemver(a, b) {
  const parse = (v) => String(v || '').replace(/^v/i, '').split('+')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

function notifyWindowsUpdate(version, body) {
  const v = String(version || '').trim();
  if (!v || lastNotifiedWindowsVersion === v) return;
  lastNotifiedWindowsVersion = v;
  try {
    if (Notification && Notification.isSupported()) {
      const n = new Notification({
        title: `Lumen v${v} Available`,
        body: body || 'Click to install the latest version of Lumen.'
      });
      n.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      n.show();
    }
  } catch (_) {}
}

function fetchJsonSimple(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = urlStr.startsWith('https') ? https : http;
    const req = client.get(urlStr, { headers: { 'User-Agent': 'Lumen-Windows-OTA', 'Cache-Control': 'no-cache' }, timeout: 12000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        res.resume();
        return resolve(fetchJsonSimple(nextUrl, redirects + 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

function downloadFileSimple(urlStr, destPath, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    const client = urlStr.startsWith('https') ? https : http;
    const req = client.get(urlStr, { headers: { 'User-Agent': 'Lumen-Windows-OTA' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        res.resume();
        return resolve(downloadFileSimple(nextUrl, destPath, onProgress, redirects + 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      let downloaded = 0;
      let lastPct = -1;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0 && onProgress) {
          const pct = Math.max(1, Math.min(99, Math.round((downloaded / total) * 100)));
          if (pct >= lastPct + 2) {
            lastPct = pct;
            onProgress(pct);
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
      file.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(err);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Download timeout')); });
    req.on('error', reject);
  });
}

function isValidWindowsExe(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 5 * 1024 * 1024) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a; // 'MZ'
  } catch (_) {
    return false;
  }
}

async function checkManifestWindowsUpdate({ silent = false } = {}) {
  if (isManifestUpdateBusy) return { ok: true, status: latestOtaStatus };
  isManifestUpdateBusy = true;
  try {
    let manifest = null;
    for (const url of WINDOWS_MANIFEST_URLS) {
      try {
        const m = await fetchJsonSimple(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
        if (m && (m.windows || m.appVersion)) {
          manifest = m;
          break;
        }
      } catch (_) {}
    }

    if (!manifest) {
      if (!silent) {
        broadcastOtaStatus({ state: 'error', message: 'Could not reach update server. Check your internet connection.' });
      }
      return { ok: false, error: 'Manifest unreachable' };
    }

    const latestVer = manifest.windows?.version || manifest.appVersion;
    const currentVer = app.getVersion();
    if (!latestVer || compareSemver(latestVer, currentVer) <= 0) {
      downloadedInstallerPath = null;
      broadcastOtaStatus({
        state: 'up_to_date',
        availableVersion: null,
        percent: 0,
        message: 'You are on the latest version.'
      });
      return { ok: true, status: latestOtaStatus };
    }

    const notes = manifest.windows?.releaseNotes || manifest.releaseNotes || `Lumen v${latestVer} is ready.`;
    const destPath = path.join(app.getPath('temp'), `Lumen-Setup-${latestVer}.exe`);

    if (fs.existsSync(destPath) && isValidWindowsExe(destPath)) {
      downloadedInstallerPath = destPath;
      const readyMsg = `Lumen v${latestVer} is ready. Click Restart to Update.`;
      notifyWindowsUpdate(latestVer, readyMsg);
      broadcastOtaStatus({
        state: 'downloaded',
        availableVersion: latestVer,
        percent: 100,
        releaseNotes: notes,
        message: readyMsg
      });
      return { ok: true, status: latestOtaStatus };
    }

    notifyWindowsUpdate(latestVer, `Downloading Lumen v${latestVer} in the background...`);
    broadcastOtaStatus({
      state: 'downloading',
      availableVersion: latestVer,
      percent: 3,
      releaseNotes: notes,
      message: `Downloading Lumen v${latestVer}...`
    });

    const urls = [
      manifest.windows?.installerUrl,
      manifest.windows?.installerFallbackUrl,
      'https://lumen-player.onrender.com/download/windows',
      'https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/Lumen-Setup.exe'
    ].filter(Boolean);

    let lastErr = null;
    for (const u of urls) {
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        await downloadFileSimple(u, destPath, (pct) => {
          broadcastOtaStatus({
            state: 'downloading',
            availableVersion: latestVer,
            percent: pct,
            message: `Downloading Lumen v${latestVer} (${pct}%)...`
          });
        });
        if (!isValidWindowsExe(destPath)) {
          throw new Error('Downloaded installer is incomplete');
        }
        downloadedInstallerPath = destPath;
        const readyMsg = `Lumen v${latestVer} is ready. Click Restart to Update.`;
        notifyWindowsUpdate(latestVer, readyMsg);
        broadcastOtaStatus({
          state: 'downloaded',
          availableVersion: latestVer,
          percent: 100,
          releaseNotes: notes,
          message: readyMsg
        });
        return { ok: true, status: latestOtaStatus };
      } catch (err) {
        lastErr = err;
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) {}
      }
    }

    const cleanErr = sanitizeOtaError(lastErr, 'Update package is syncing. Please try again shortly.');
    broadcastOtaStatus({ state: 'error', message: cleanErr });
    return { ok: false, error: cleanErr };
  } finally {
    isManifestUpdateBusy = false;
  }
}

function broadcastOtaStatus(patch) {
  latestOtaStatus = { ...latestOtaStatus, ...patch, currentVersion: app.getVersion() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('ota:status', latestOtaStatus);
    } catch (_) {}
  }
}

function setupElectronAutoUpdater() {
  if (!autoUpdater) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => {
      broadcastOtaStatus({ state: 'checking', message: 'Checking for updates...' });
    });

    autoUpdater.on('update-available', (info) => {
      const ver = info?.version || null;
      const notes = typeof info?.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info?.releaseNotes)
          ? info.releaseNotes.map(n => n?.note || '').filter(Boolean).join('\n')
          : null;
      notifyWindowsUpdate(ver, `Downloading Lumen v${ver || 'latest'} in the background...`);
      broadcastOtaStatus({
        state: 'downloading',
        availableVersion: ver,
        percent: 2,
        releaseNotes: notes,
        message: `Downloading Lumen v${ver || 'latest'}...`
      });
    });

    autoUpdater.on('update-not-available', () => {
      // Cross-check manifest in case GitHub latest release hasn't updated latest.yml yet
      checkManifestWindowsUpdate({ silent: true }).catch(() => {
        broadcastOtaStatus({
          state: 'up_to_date',
          availableVersion: null,
          percent: 0,
          message: 'You are on the latest version.'
        });
      });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const pct = Math.max(0, Math.min(100, Math.round(progressObj?.percent || 0)));
      broadcastOtaStatus({
        state: 'downloading',
        percent: pct,
        message: `Downloading update (${pct}%)...`
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      downloadedInstallerPath = null; // electron-updater holds the update
      const ver = info?.version || latestOtaStatus.availableVersion;
      const msg = `Lumen v${ver || ''} is ready. Restart to update.`;
      notifyWindowsUpdate(ver, msg);
      broadcastOtaStatus({
        state: 'downloaded',
        availableVersion: ver,
        percent: 100,
        message: msg
      });
    });

    autoUpdater.on('error', () => {
      // Automatically fall back to direct ota-manifest.json updater instead of showing raw latest.yml 404 traces
      checkManifestWindowsUpdate({ silent: false }).catch((fallbackErr) => {
        broadcastOtaStatus({
          state: 'error',
          message: sanitizeOtaError(fallbackErr)
        });
      });
    });
  } catch (err) {
    console.warn('[Lumen Electron] Auto-updater setup warning:', err?.message);
  }
}

let mainWindow = null;
let serverPort = 3847;
let httpServer = null;
const allowedFolders = new Set();

// Prevent background suspension so next songs play seamlessly when window is unfocused or minimized
try {
  powerSaveBlocker.start('prevent-app-suspension');
} catch (e) {
  console.warn('[Lumen Electron] powerSaveBlocker notice:', e?.message);
}

// Ensure art cache directory exists in user data
const artCacheDir = path.join(app.getPath('userData'), 'lumen_art_cache');
if (!fs.existsSync(artCacheDir)) {
  fs.mkdirSync(artCacheDir, { recursive: true });
}

// Allowed audio extensions
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.wma']);

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.flac': return 'audio/flac';
    case '.m4a':
    case '.aac': return 'audio/mp4';
    case '.wav': return 'audio/wav';
    case '.ogg':
    case '.opus': return 'audio/ogg';
    default: return 'application/octet-stream';
  }
}

function isPathAllowed(filePath) {
  if (!filePath) return false;
  const normalized = path.resolve(filePath);
  if (normalized.includes('..')) return false;
  for (const folder of allowedFolders) {
    if (normalized.startsWith(folder)) {
      return true;
    }
  }
  // Allow if inside standard user Music or Downloads folder
  const userMusic = path.resolve(app.getPath('music'));
  if (normalized.startsWith(userMusic)) return true;
  return false;
}

// 1. Lightweight Local HTTP Streaming Server with HTTP Range Support & Folder Allow-list
function startLocalAudioServer() {
  httpServer = http.createServer((req, res) => {
    // Enable CORS for renderer
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, x-user-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const parsedUrl = new URL(req.url, `http://127.0.0.1:${serverPort}`);
      const pathname = parsedUrl.pathname;

      // Stream audio file with Range support (for seeking)
      if (pathname === '/stream') {
        const rawPath = parsedUrl.searchParams.get('path');
        if (!rawPath) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing file path');
          return;
        }

        const filePath = path.resolve(rawPath);
        const ext = path.extname(filePath).toLowerCase();

        // Security: check extension & folder allow-list
        if (!AUDIO_EXTENSIONS.has(ext) || !isPathAllowed(filePath)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Access forbidden: file is outside scanned music libraries');
          return;
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
          return;
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const contentType = getMimeType(filePath);

        if (range) {
          let start = 0;
          let end = fileSize - 1;
          const matches = /bytes=(\d*)-(\d*)/.exec(range);

          if (matches) {
            if (matches[1] === '' && matches[2] !== '') {
              // Suffix byte range: bytes=-500 (last 500 bytes)
              const suffix = parseInt(matches[2], 10);
              start = Math.max(0, fileSize - suffix);
              end = fileSize - 1;
            } else {
              start = matches[1] ? parseInt(matches[1], 10) : 0;
              end = matches[2] ? parseInt(matches[2], 10) : fileSize - 1;
            }
          }

          // D2: Clamp end to fileSize - 1
          if (end >= fileSize) {
            end = fileSize - 1;
          }

          if (start >= fileSize || start > end) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
              'Content-Type': contentType,
            });
            res.end();
            return;
          }

          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(filePath, { start, end });
          file.on('error', (streamErr) => {
            console.error('File stream error:', streamErr);
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
          });
          file.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          });
          const file = fs.createReadStream(filePath);
          file.on('error', (streamErr) => {
            console.error('File stream error:', streamErr);
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
          file.pipe(res);
        }
        return;
      }

      // Serve album art
      if (pathname === '/artwork') {
        const artHash = parsedUrl.searchParams.get('id');
        if (!artHash) {
          res.writeHead(400);
          res.end('Missing id');
          return;
        }

        const safeId = path.basename(artHash).replace(/[^a-zA-Z0-9_-]/g, '');
        const cachedFile = path.join(artCacheDir, `${safeId}.bin`);
        if (fs.existsSync(cachedFile)) {
          const metaFile = path.join(artCacheDir, `${safeId}.json`);
          let mime = 'image/jpeg';
          if (fs.existsSync(metaFile)) {
            try {
              mime = JSON.parse(fs.readFileSync(metaFile, 'utf8')).format || 'image/jpeg';
            } catch (_) {}
          }
          res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000' });
          fs.createReadStream(cachedFile).pipe(res);
          return;
        }

        res.writeHead(404);
        res.end('Art not cached');
        return;
      }

      // Health check endpoint
      if (pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', engine: 'lumen-electron', version: '1.0.0' }));
        return;
      }

      // Status & Info endpoint
      if (pathname === '/api/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          app: 'LUMEN',
          version: '1.0.0',
          homeSharingAvailable: true,
          addresses: getLocalIpAddresses().map(ip => `http://${ip}:${serverPort}`)
        }));
        return;
      }

      // Playlist Import fallback
      if (pathname === '/api/playlist/import') {
        let rawBody = '';
        req.on('data', chunk => {
          rawBody += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(rawBody || '{}');
            const lines = (payload.text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const tracks = lines.map((l, idx) => {
              const parts = l.split(' - ');
              const title = parts[0] || `Track ${idx + 1}`;
              const artist = parts[1] || 'Unknown Artist';
              return {
                id: `imp_${Date.now()}_${idx}`,
                title,
                artist,
                album: 'Imported Album',
                duration: 180,
                streamUrl: `/api/stream/resolve?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
              };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              playlist: {
                id: `pl_imp_${Date.now()}`,
                name: payload.name || 'Imported Playlist',
                tracks
              }
            }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }

      // Verified Search API with multi-tier iTunes & JioSaavn backup (zero CORS in Electron)
      if (pathname === '/api/search/verified') {
        const q = parsedUrl.searchParams.get('q') || '';
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '30', 10);
        if (!q.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Search query required' }));
          return;
        }

        (async () => {
          try {
            let tracks = [];
            // 1. Direct iTunes query
            try {
              const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=${limit}`, {
                signal: AbortSignal.timeout(5000)
              });
              if (itunesRes.ok) {
                const data = await itunesRes.json();
                tracks = (data.results || []).map(item => ({
                  id: `itunes_${item.trackId}`,
                  title: item.trackName,
                  artist: item.artistName,
                  album: item.collectionName || 'Single',
                  duration: Math.round((item.trackTimeMillis || 180000) / 1000),
                  artworkUrl: (item.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'),
                  streamUrl: `/api/stream/resolve?title=${encodeURIComponent(item.trackName)}&artist=${encodeURIComponent(item.artistName)}`,
                  hasArtwork: Boolean(item.artworkUrl100),
                  isStream: true,
                  isVerified: true
                }));
              }
            } catch (_) {}

            // 2. Fallback to JioSaavn if iTunes empty or rate-limited
            if (tracks.length === 0) {
              try {
                const saavnRes = await fetch(`https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=${limit}&p=1&q=${encodeURIComponent(q)}`, {
                  signal: AbortSignal.timeout(5000)
                });
                if (saavnRes.ok) {
                  const saavnData = await saavnRes.json();
                  const decodeHtml = (s) => (s || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                  if (saavnData && Array.isArray(saavnData.results)) {
                    tracks = saavnData.results.map(item => {
                      const cleanTitle = decodeHtml(item.song);
                      const cleanArtist = decodeHtml(item.primary_artists || item.singers || item.music);
                      const art = (item.image || '').replace(/150x150\.jpg/g, '500x500.jpg').replace(/50x50\.jpg/g, '500x500.jpg') || null;
                      return {
                        id: `saavn_${item.id}`,
                        title: cleanTitle,
                        artist: cleanArtist,
                        album: decodeHtml(item.album || 'Single'),
                        duration: parseInt(item.duration, 10) || 180,
                        artworkUrl: art,
                        streamUrl: `/api/stream/resolve?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}`,
                        hasArtwork: Boolean(art),
                        isStream: true,
                        isVerified: true
                      };
                    });
                  }
                }
              } catch (_) {}
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, count: tracks.length, tracks }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message, tracks: [] }));
          }
        })();
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });

  // D5: Dynamic port allocation if 3847 is busy
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      serverPort++;
      console.log(`Port busy, attempting dynamic binding to port ${serverPort}...`);
      setTimeout(() => {
        httpServer.listen(serverPort, '127.0.0.1');
      }, 100);
    } else {
      console.error('Audio server error:', err);
    }
  });

  httpServer.listen(serverPort, '127.0.0.1', () => {
    console.log(`LUMEN Local Audio Server bound securely at http://127.0.0.1:${serverPort}`);
  });
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function createWindow() {
  const iconPath = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, '../icon.ico'),
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '../icon.png'),
    path.join(__dirname, '../public/favicon.ico')
  ].find(p => fs.existsSync(p));

  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#080A10',
    title: 'Lumen',
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#ffffff',
      height: 36
    },
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // D3: Fixed with true security and CORS headers
      backgroundThrottling: false // Keep full timer resolution and audio loop alive when window is in background
    }
  });

  mainWindow.removeMenu();
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  const prodPath = path.join(__dirname, '../dist/index.html');
  const packagedPath = path.join(app.getAppPath(), 'dist/index.html');
  const cloudUrl = 'https://lumen-player.onrender.com';

  if (fs.existsSync(packagedPath)) {
    mainWindow.loadFile(packagedPath);
  } else if (fs.existsSync(prodPath)) {
    mainWindow.loadFile(prodPath);
  } else {
    mainWindow.loadURL(cloudUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 2. Recursive Audio File Scanner with Front Cover Priority & Folder Fallbacks (A5, D4)
async function scanDirectoryRecursive(dirPath, trackList = [], onProgress) {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    // Look for folder cover art in directory (A5)
    let folderCoverBuf = null;
    let folderCoverMime = 'image/jpeg';
    const folderArtNames = ['cover.jpg', 'folder.jpg', 'front.jpg', 'cover.png', 'folder.png'];
    for (const name of folderArtNames) {
      const artP = path.join(dirPath, name);
      if (fs.existsSync(artP)) {
        try {
          folderCoverBuf = await fs.promises.readFile(artP);
          folderCoverMime = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
          break;
        } catch (_) {}
      }
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await scanDirectoryRecursive(fullPath, trackList, onProgress);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          try {
            let common = {};
            let format = {};

            if (mm) {
              const metadata = await mm.parseFile(fullPath, { skipCovers: false });
              common = metadata.common || {};
              format = metadata.format || {};
            }

            let artworkId = null;
            // Prefer "front cover" picture if available (A5)
            const pictures = common.picture || [];
            const pic = pictures.find(p => p.type && p.type.toLowerCase().includes('front')) || pictures[0];

            if (pic && pic.data) {
              const hash = crypto.createHash('md5').update(pic.data).digest('hex').slice(0, 16);
              artworkId = `art_${hash}`;
              const cachedArtPath = path.join(artCacheDir, `${artworkId}.bin`);
              if (!fs.existsSync(cachedArtPath)) {
                await fs.promises.writeFile(cachedArtPath, pic.data);
                await fs.promises.writeFile(path.join(artCacheDir, `${artworkId}.json`), JSON.stringify({ format: pic.format }));
              }
            } else if (folderCoverBuf) {
              const hash = crypto.createHash('md5').update(folderCoverBuf).digest('hex').slice(0, 16);
              artworkId = `folder_${hash}`;
              const cachedArtPath = path.join(artCacheDir, `${artworkId}.bin`);
              if (!fs.existsSync(cachedArtPath)) {
                await fs.promises.writeFile(cachedArtPath, folderCoverBuf);
                await fs.promises.writeFile(path.join(artCacheDir, `${artworkId}.json`), JSON.stringify({ format: folderCoverMime }));
              }
            }

            const track = {
              id: `track_${Buffer.from(fullPath).toString('base64').replace(/[/+=]/g, '_')}`,
              path: fullPath,
              filename: entry.name,
              title: common.title || path.basename(entry.name, ext),
              artist: common.artist || common.albumartist || 'Unknown Artist',
              album: common.album || 'Unknown Album',
              albumArtist: common.albumartist || common.artist || 'Unknown Artist',
              genre: common.genre && common.genre.length ? common.genre[0] : 'Music',
              year: common.year || null,
              trackNumber: common.track && common.track.no ? common.track.no : 1,
              diskNumber: common.disk && common.disk.no ? common.disk.no : 1,
              duration: format.duration || 0,
              bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
              codec: format.codec || ext.replace('.', '').toUpperCase(),
              hasArtwork: !!artworkId,
              artworkId: artworkId,
              streamUrl: `http://127.0.0.1:${serverPort}/stream?path=${encodeURIComponent(fullPath)}`,
              artworkUrl: artworkId ? `http://127.0.0.1:${serverPort}/artwork?id=${artworkId}` : null,
              addedAt: Date.now()
            };

            trackList.push(track);
            if (onProgress && trackList.length % 5 === 0) {
              onProgress(trackList.length, entry.name);
            }
          } catch (err) {
            console.warn(`Could not read metadata for ${fullPath}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error(`Cannot read directory ${dirPath}:`, err.message);
  }
  return trackList;
}

// 3. IPC Handlers (A6: audio:getUrl & artwork:getUrl)
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Your Music Directory'
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  allowedFolders.add(path.resolve(result.filePaths[0]));
  return result.filePaths[0];
});

ipcMain.handle('scan:folder', async (_event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { success: false, error: 'Directory does not exist', tracks: [] };
  }

  allowedFolders.add(path.resolve(folderPath));
  const tracks = await scanDirectoryRecursive(folderPath, [], (count, currentFile) => {
    if (mainWindow) {
      mainWindow.webContents.send('scan:progress', { count, currentFile });
    }
  });

  return { success: true, tracks };
});

ipcMain.handle('server:getInfo', () => {
  return {
    port: serverPort,
    baseUrl: `http://127.0.0.1:${serverPort}`,
    localIps: getLocalIpAddresses()
  };
});

ipcMain.handle('server:getHomeSharingInfo', () => {
  const ips = getLocalIpAddresses();
  return {
    active: true,
    port: serverPort,
    urls: ips.map(ip => `http://${ip}:${serverPort}`)
  };
});

ipcMain.handle('audio:getUrl', (_event, filePath) => {
  if (!filePath) return null;
  allowedFolders.add(path.dirname(path.resolve(filePath)));
  return `http://127.0.0.1:${serverPort}/stream?path=${encodeURIComponent(filePath)}`;
});

ipcMain.handle('artwork:getUrl', (_event, artId) => {
  if (!artId) return null;
  return `http://127.0.0.1:${serverPort}/artwork?id=${encodeURIComponent(artId)}`;
});

ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// 4. Electron OTA Auto-Updater IPC Handlers
ipcMain.handle('ota:getAppInfo', () => {
  return {
    platform: 'windows',
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    status: latestOtaStatus
  };
});

ipcMain.handle('ota:checkForUpdates', async () => {
  if (!app.isPackaged) {
    broadcastOtaStatus({
      state: 'up_to_date',
      message: `Dev build v${app.getVersion()}`
    });
    return { ok: true, devMode: true, status: latestOtaStatus };
  }
  broadcastOtaStatus({ state: 'checking', message: 'Checking for updates...' });
  if (autoUpdater) {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, status: latestOtaStatus };
    } catch (_) {
      // Automatically fall back to direct manifest check & installer download
      return await checkManifestWindowsUpdate({ silent: false });
    }
  }
  return await checkManifestWindowsUpdate({ silent: false });
});

ipcMain.handle('ota:downloadUpdate', async () => {
  if (!app.isPackaged) {
    return { ok: false, error: 'Packaged Electron build required.' };
  }
  if (autoUpdater) {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (_) {
      return await checkManifestWindowsUpdate({ silent: false });
    }
  }
  return await checkManifestWindowsUpdate({ silent: false });
});

ipcMain.handle('ota:installUpdate', () => {
  if (!app.isPackaged) {
    return { ok: false };
  }
  if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
    const exePath = downloadedInstallerPath;
    setTimeout(() => {
      try {
        const child = spawn(exePath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.unref();
      } catch (err) {
        console.warn('[Lumen Electron] Fallback installer launch failed:', err?.message);
      }
      app.quit();
    }, 300);
    return { ok: true };
  }
  if (!autoUpdater) {
    return { ok: false };
  }
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      console.warn('[Lumen Electron] quitAndInstall failed:', err?.message);
    }
  });
  return { ok: true };
});

// App Lifecycle
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.on('browser-window-created', (_, win) => {
    win.removeMenu();
    win.setMenu(null);
    win.setMenuBarVisibility(false);
  });
  startLocalAudioServer();
  createWindow();
  setupElectronAutoUpdater();

  // Check for Windows updates silently in background 6s after launch
  if (app.isPackaged) {
    setTimeout(() => {
      if (autoUpdater) {
        autoUpdater.checkForUpdates().catch(() => {
          checkManifestWindowsUpdate({ silent: true }).catch(() => {});
        });
      } else {
        checkManifestWindowsUpdate({ silent: true }).catch(() => {});
      }
    }, 6000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (httpServer) {
    httpServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
