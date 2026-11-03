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
  getState(): Promise<{ isPlaying: boolean; positionMs: number; durationMs: number }>;
  addListener(
    eventName: 'onPlaybackStateChange',
    listenerFunc: (data: { isPlaying: boolean; positionMs: number; durationMs: number }) => void
  ): Promise<any>;
  addListener(eventName: 'onTrackEnded', listenerFunc: () => void): Promise<any>;
  addListener(eventName: 'onNextTrack', listenerFunc: () => void): Promise<any>;
  addListener(eventName: 'onPrevTrack', listenerFunc: () => void): Promise<any>;
}

export const LumenAudio = registerPlugin<LumenAudioPluginInterface>('LumenAudio');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
