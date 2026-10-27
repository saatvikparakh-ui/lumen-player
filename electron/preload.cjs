const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumenAPI', {
  // Folder & File Operations
  selectMusicFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  scanMusicFolder: (folderPath) => ipcRenderer.invoke('scan:folder', folderPath),
  
  // Local Server & Audio Bridge
  getLocalServerInfo: () => ipcRenderer.invoke('server:getInfo'),
  getAudioUrl: (filePath) => ipcRenderer.invoke('audio:getUrl', filePath),
  getArtworkUrl: (filePath) => ipcRenderer.invoke('artwork:getUrl', filePath),
  
  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Home Sharing Info (Layer 2)
  getHomeSharingInfo: () => ipcRenderer.invoke('server:getHomeSharingInfo'),

  // Scan Progress Listener
  onScanProgress: (callback) => {
    const subscription = (_event, progress) => callback(progress);
    ipcRenderer.on('scan:progress', subscription);
    return () => ipcRenderer.removeListener('scan:progress', subscription);
  }
});
