import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type VoicePermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface VoiceCapabilities {
  platform: 'android' | 'web' | 'desktop';
  supported: boolean;
  androidSdkInt: number;
  onDeviceRecognizerSupported: boolean;
  voskModelInstalled: boolean;
  voskModelSizeMb: number;
  activeEngine: 'android_on_device' | 'vosk_offline' | 'unavailable';
  reason?: string;
}

export interface VoiceTranscriptEvent {
  text: string;
  isFinal: boolean;
  utteranceId: string;
  timestampMs: number;
  handledNatively?: boolean;
  nativeAction?: string;
}

export interface VoiceStateEvent {
  state: 'stopped' | 'waiting_wake' | 'listening' | 'processing' | 'speaking' | 'error';
  message?: string;
}

export interface VoskDownloadProgressEvent {
  percent: number;
  stage: 'downloading' | 'extracting' | 'ready' | 'error';
  message?: string;
}

interface LumenVoiceNativePlugin {
  checkPermission(): Promise<{ status: VoicePermissionState }>;
  requestPermission(): Promise<{ status: VoicePermissionState }>;
  openAppSettings(): Promise<{ opened: boolean }>;
  getCapabilities(): Promise<VoiceCapabilities>;
  downloadVoskModel(): Promise<{ installed: boolean; error?: string }>;
  startHandsFree(options?: { expectFollowUp?: boolean }): Promise<{ started: boolean; error?: string }>;
  stopHandsFree(): Promise<{ stopped: boolean }>;
  beginFollowUpCapture(options?: { timeoutMs?: number }): Promise<{ capturing: boolean }>;
  speak(options: { text: string; expectFollowUp?: boolean }): Promise<{ spoken: boolean }>;
  setDucking(options: { ducked: boolean }): Promise<{ ducked: boolean }>;
  addListener(
    eventName: 'onVoiceTranscript',
    listenerFunc: (event: VoiceTranscriptEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'onVoiceState',
    listenerFunc: (event: VoiceStateEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'onVoskDownloadProgress',
    listenerFunc: (event: VoskDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

const LumenVoiceNative = registerPlugin<LumenVoiceNativePlugin>('LumenVoice');

export class VoiceBridge {
  static isAndroidNative(): boolean {
    try {
      return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    } catch {
      return false;
    }
  }

  static async getCapabilities(): Promise<VoiceCapabilities> {
    if (!this.isAndroidNative()) {
      const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
      return {
        platform: isElectron ? 'desktop' : 'web',
        supported: false,
        androidSdkInt: 0,
        onDeviceRecognizerSupported: false,
        voskModelInstalled: false,
        voskModelSizeMb: 40,
        activeEngine: 'unavailable',
        reason: 'Hands-free "Hey Lumen" voice control is available on the Lumen Android app.'
      };
    }

    try {
      return await LumenVoiceNative.getCapabilities();
    } catch (err: any) {
      return {
        platform: 'android',
        supported: false,
        androidSdkInt: 0,
        onDeviceRecognizerSupported: false,
        voskModelInstalled: false,
        voskModelSizeMb: 40,
        activeEngine: 'unavailable',
        reason: err?.message || 'Voice plugin unavailable on this build.'
      };
    }
  }

  static async checkPermission(): Promise<VoicePermissionState> {
    if (!this.isAndroidNative()) return 'unsupported';
    try {
      const res = await LumenVoiceNative.checkPermission();
      return res.status;
    } catch {
      return 'denied';
    }
  }

  static async requestPermission(): Promise<VoicePermissionState> {
    if (!this.isAndroidNative()) return 'unsupported';
    try {
      const res = await LumenVoiceNative.requestPermission();
      return res.status;
    } catch {
      return 'denied';
    }
  }

  static async openAppSettings(): Promise<boolean> {
    if (!this.isAndroidNative()) return false;
    try {
      const res = await LumenVoiceNative.openAppSettings();
      return Boolean(res.opened);
    } catch {
      return false;
    }
  }

  static async downloadVoskModel(): Promise<{ installed: boolean; error?: string }> {
    if (!this.isAndroidNative()) {
      return { installed: false, error: 'Offline voice pack download is only supported on Android.' };
    }
    try {
      return await LumenVoiceNative.downloadVoskModel();
    } catch (err: any) {
      return { installed: false, error: err?.message || 'Download failed.' };
    }
  }

  static async startHandsFree(): Promise<{ started: boolean; error?: string }> {
    if (!this.isAndroidNative()) {
      return { started: false, error: 'Android device required for hands-free voice control.' };
    }
    try {
      return await LumenVoiceNative.startHandsFree();
    } catch (err: any) {
      return { started: false, error: err?.message || 'Could not start hands-free voice service.' };
    }
  }

  static async stopHandsFree(): Promise<void> {
    if (!this.isAndroidNative()) return;
    try {
      await LumenVoiceNative.stopHandsFree();
    } catch {
      // ignore
    }
  }

  static async beginFollowUpCapture(timeoutMs = 10000): Promise<void> {
    if (!this.isAndroidNative()) return;
    try {
      await LumenVoiceNative.beginFollowUpCapture({ timeoutMs });
    } catch {
      // ignore
    }
  }

  static async speak(text: string, expectFollowUp = false): Promise<void> {
    if (!text.trim()) return;
    if (!this.isAndroidNative()) return;
    try {
      await LumenVoiceNative.speak({ text, expectFollowUp });
    } catch {
      // ignore
    }
  }

  static async setDucking(ducked: boolean): Promise<void> {
    if (!this.isAndroidNative()) return;
    try {
      await LumenVoiceNative.setDucking({ ducked });
    } catch {
      // ignore
    }
  }

  static async addTranscriptListener(
    cb: (event: VoiceTranscriptEvent) => void
  ): Promise<PluginListenerHandle | null> {
    if (!this.isAndroidNative()) return null;
    try {
      return await LumenVoiceNative.addListener('onVoiceTranscript', cb);
    } catch {
      return null;
    }
  }

  static async addStateListener(
    cb: (event: VoiceStateEvent) => void
  ): Promise<PluginListenerHandle | null> {
    if (!this.isAndroidNative()) return null;
    try {
      return await LumenVoiceNative.addListener('onVoiceState', cb);
    } catch {
      return null;
    }
  }

  static async addVoskProgressListener(
    cb: (event: VoskDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle | null> {
    if (!this.isAndroidNative()) return null;
    try {
      return await LumenVoiceNative.addListener('onVoskDownloadProgress', cb);
    } catch {
      return null;
    }
  }
}
