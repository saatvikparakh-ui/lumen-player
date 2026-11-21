import { registerPlugin, Capacitor } from '@capacitor/core';

export interface LumenAudioPluginInterface {
  play(options: {
    trackId: string;
    url: string;
    title: string;
    artist: string;
    album: string;
    artworkUrl: string;
    duration: number;
    position: number;
  }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(options: { position: number }): Promise<void>;
  setVolume(options: { volume: number }): Promise<void>;
  setQueue(options: {
    items: Array<{
      trackId: string;
      url: string;
      title: string;
      artist: string;
      album: string;
      artworkUrl: string;
    }>;
    startIndex: number;
    position?: number;
    autoPlay?: boolean;
  }): Promise<void>;
  getState(): Promise<{ isPlaying: boolean; positionMs: number; durationMs: number }>;
  setRepeatMode(options: { mode: 'off' | 'all' | 'one' }): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<{ isIgnoring: boolean }>;
  requestBackgroundPermission(): Promise<{ requested: boolean }>;
  enterPip(): Promise<{ success: boolean }>;
  addListener(
    eventName: 'onPlaybackStateChange',
    listenerFunc: (data: { isPlaying: boolean; positionMs: number; durationMs: number }) => void
  ): Promise<any>;
  addListener(eventName: 'onTrackEnded', listenerFunc: () => void): Promise<any>;
  addListener(eventName: 'onNextTrack', listenerFunc: () => void): Promise<any>;
  addListener(eventName: 'onPrevTrack', listenerFunc: () => void): Promise<any>;
  addListener(
    eventName: 'onTrackTransition',
    listenerFunc: (data: { trackId: string; title: string; artist: string; album: string; artworkUrl: string }) => void
  ): Promise<any>;

  // --- Offline Download & Private Vault Bridge (extends LumenAudio) ---
  downloadTrack?(options: {
    canonicalTrackId: string;
    audioAssetId: string;
    url: string;
    title: string;
    artist: string;
    album: string;
    artworkUrl: string;
    duration: number;
    sourceType: string;
    licenseReference: string;
    collectionRefs: string[];
    quality?: string;
  }): Promise<{ started: boolean; state: string }>;
  pauseDownload?(options: { canonicalTrackId: string }): Promise<void>;
  resumeDownload?(options: { canonicalTrackId: string }): Promise<void>;
  cancelDownload?(options: { canonicalTrackId: string }): Promise<void>;
  removeDownload?(options: { canonicalTrackId: string; audioAssetId?: string }): Promise<void>;
  removeAllDownloads?(): Promise<void>;
  getDownloads?(): Promise<{ records: any[] }>;
  getDownloadStatus?(options: { canonicalTrackId: string }): Promise<{ record: any | null }>;
  getOfflinePlaybackUri?(options: { canonicalTrackId: string; audioAssetId?: string }): Promise<{ exists: boolean; playableToken?: string }>;
  getStorageUsage?(): Promise<{ usedBytes: number; deviceAvailableBytes: number; completedCount: number }>;
  verifyOfflineLibrary?(options?: { fullChecksum?: boolean }): Promise<{
    checkedCount: number;
    validCount: number;
    missingCount: number;
    corruptedCount: number;
    affectedTrackIds: string[];
  }>;
  setOfflineMode?(options: { enabled: boolean }): Promise<void>;
  updateOfflineSettings?(options: {
    networkPolicy: string;
    allowMeteredConnections: boolean;
    maxStorageMB: number;
    offlineModeEnabled: boolean;
  }): Promise<void>;
  addListener(
    eventName: 'onDownloadStateChange',
    listenerFunc: (data: any) => void
  ): Promise<any>;
}

export const LumenAudio = registerPlugin<LumenAudioPluginInterface>('LumenAudio');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
