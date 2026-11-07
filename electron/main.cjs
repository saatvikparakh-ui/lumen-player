const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

let mm = null;
try {
  mm = require('music-metadata');
} catch (err) {
  console.warn('[Lumen Electron] music-metadata library not available:', err?.message);
}

let mainWindow = null;
let serverPort = 3847;
let httpServer = null;
const allowedFolders = new Set();

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

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
    frame: true,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true // D3: Fixed with true security and CORS headers
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
