const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const mm = require('music-metadata');

let mainWindow = null;
let serverPort = 3847;
let httpServer = null;

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

// 1. Lightweight Local HTTP Streaming Server with HTTP Range Support
function startLocalAudioServer() {
  httpServer = http.createServer(async (req, res) => {
    // Enable CORS for renderer and local devices
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const parsedUrl = new URL(req.url, `http://localhost:${serverPort}`);
      const pathname = parsedUrl.pathname;

      // Stream audio file with Range support (for seeking)
      if (pathname === '/stream') {
        const filePath = parsedUrl.searchParams.get('path');
        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
          return;
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const contentType = getMimeType(filePath);

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

          if (start >= fileSize || end >= fileSize) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
              'Content-Type': contentType,
            });
            res.end();
            return;
          }

          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(filePath, { start, end });
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
          fs.createReadStream(filePath).pipe(res);
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

        const cachedFile = path.join(artCacheDir, `${artHash}.bin`);
        if (fs.existsSync(cachedFile)) {
          const metaFile = path.join(artCacheDir, `${artHash}.json`);
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

      // Status & Home Sharing Info endpoint
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

      res.writeHead(404);
      res.end('Not Found');
    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });

  httpServer.listen(serverPort, '0.0.0.0', () => {
    console.log(`LUMEN Local Audio Server listening at http://localhost:${serverPort}`);
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#080A10',
    title: 'LUMEN',
    frame: false, // Custom frameless bar for sleek neon aesthetic
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // allow streaming from local server
    }
  });

  const devUrl = 'http://localhost:5173';
  const prodPath = path.join(__dirname, '../dist/index.html');

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      // If dev server not yet ready, load built files if available
      if (fs.existsSync(prodPath)) {
        mainWindow.loadFile(prodPath);
      }
    });
  } else {
    mainWindow.loadFile(prodPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 2. Recursive Audio File Scanner
async function scanDirectoryRecursive(dirPath, trackList = [], onProgress) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await scanDirectoryRecursive(fullPath, trackList, onProgress);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          try {
            const metadata = await mm.parseFile(fullPath, { skipCovers: false });
            const common = metadata.common || {};
            const format = metadata.format || {};

            let artworkId = null;
            if (common.picture && common.picture.length > 0) {
              const pic = common.picture[0];
              // Hash based on artist + album to share artwork cache across album tracks
              const cleanAlbum = (common.album || 'Unknown Album').toLowerCase().replace(/[^a-z0-9]/g, '');
              const cleanArtist = (common.artist || 'Unknown Artist').toLowerCase().replace(/[^a-z0-9]/g, '');
              artworkId = `art_${cleanArtist}_${cleanAlbum}`;

              const cachedArtPath = path.join(artCacheDir, `${artworkId}.bin`);
              if (!fs.existsSync(cachedArtPath)) {
                fs.writeFileSync(cachedArtPath, pic.data);
                fs.writeFileSync(path.join(artCacheDir, `${artworkId}.json`), JSON.stringify({ format: pic.format }));
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
              streamUrl: `http://localhost:${serverPort}/stream?path=${encodeURIComponent(fullPath)}`,
              artworkUrl: artworkId ? `http://localhost:${serverPort}/artwork?id=${artworkId}` : null,
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

// 3. IPC Handlers
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Your Music Directory'
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('scan:folder', async (_event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { success: false, error: 'Directory does not exist', tracks: [] };
  }

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
    baseUrl: `http://localhost:${serverPort}`,
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

// App Lifecycle
app.whenReady().then(() => {
  startLocalAudioServer();
  createWindow();

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
