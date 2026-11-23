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
  updateLibraryWidget(options: {
    playlists: Array<{
      id: string;
      name: string;
      coverUrl: string;
      coverColor: string;
      trackCovers: string[];
    }>;
  }): Promise<void>;
  clearAppCache(): Promise<{ cleared: boolean; freedMb: number }>;
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
}

export const LumenAudio = registerPlugin<LumenAudioPluginInterface>('LumenAudio');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
