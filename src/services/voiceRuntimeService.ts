import type { PluginListenerHandle } from '@capacitor/core';
import type { Track } from '../types/music';
import { AudioEngine } from './audioEngine';
import { LikedService } from './likedService';
import { PlaylistService } from './playlistService';
import { StreamingService } from './streamingService';
import {
  VoiceBridge,
  type VoiceCapabilities,
  type VoicePermissionState,
  type VoskDownloadProgressEvent
} from './voiceBridge';
import {
  VoiceCommandEngine,
  VoiceStorage,
  type VoiceControllerSnapshot
} from './voiceCommandController';

class VoiceRuntimeManager {
  private readonly engine: VoiceCommandEngine;
  private initialized = false;
  private transcriptHandle: PluginListenerHandle | null = null;
  private stateHandle: PluginListenerHandle | null = null;
  private voskHandle: PluginListenerHandle | null = null;
  private voskListeners = new Set<(ev: VoskDownloadProgressEvent) => void>();

  constructor() {
    this.engine = new VoiceCommandEngine({
      pause: () => AudioEngine.pause(),
      resume: () => AudioEngine.resume(),
      skip: () => {
        AudioEngine.next();
      },
      previous: () => {
        AudioEngine.prev();
      },
      playTrack: (track: Track) => {
        AudioEngine.playTrack(track);
      },
      playNext: (track: Track) => {
        AudioEngine.playNext(track);
      },
      addToQueue: (track: Track) => {
        AudioEngine.addToQueue(track);
      },
      isPlaying: () => AudioEngine.isPlaying(),
      getLocalLibraryTracks: () => {
        const seen = new Set<string>();
        const tracks: Track[] = [];
        const add = (t: Track) => {
          if (!t || !t.title) return;
          const key = t.id || `${t.title.toLowerCase()}::${(t.artist || '').toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            tracks.push(t);
          }
        };
        try {
          LikedService.getLikedTracks().forEach(add);
        } catch {
          // ignore
        }
        try {
          PlaylistService.getPlaylists().forEach(pl => {
            (pl.tracks || []).forEach(add);
          });
        } catch {
          // ignore
        }
        return tracks;
      },
      searchCatalog: async (query: string) => {
        const results = await StreamingService.searchVerifiedTracks(query);
        return (results || []).slice(0, 8);
      },
      isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true),
      speak: async (text: string, expectFollowUp = false) => {
        await VoiceBridge.speak(text, expectFollowUp);
      },
      beginFollowUpCapture: async (timeoutMs = 10000) => {
        await VoiceBridge.beginFollowUpCapture(timeoutMs);
      }
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!VoiceBridge.isAndroidNative()) {
      return;
    }

    this.transcriptHandle = await VoiceBridge.addTranscriptListener((ev) => {
      if (!ev.isFinal) return;
      void this.engine.handleTranscript({
        text: ev.text,
        utteranceId: ev.utteranceId,
        timestampMs: ev.timestampMs,
        handledNatively: ev.handledNatively,
        nativeAction: ev.nativeAction
      });
    });

    this.stateHandle = await VoiceBridge.addStateListener((ev) => {
      if (ev.state === 'stopped') {
        VoiceStorage.setEnabled(false);
      }
      this.engine.setNativeState(ev.state, ev.message);
    });

    this.voskHandle = await VoiceBridge.addVoskProgressListener((ev) => {
      this.voskListeners.forEach(fn => {
        try {
          fn(ev);
        } catch {
          // ignore
        }
      });
    });

    // Resume hands-free automatically ONLY if user previously enabled it AND still holds permission
    if (VoiceStorage.isEnabled() && VoiceStorage.hasAcceptedDisclosure()) {
      const perm = await VoiceBridge.checkPermission();
      if (perm === 'granted') {
        const res = await VoiceBridge.startHandsFree();
        if (res.started) {
          this.engine.setNativeState('waiting_wake');
        } else {
          VoiceStorage.setEnabled(false);
          this.engine.setNativeState('error', res.error);
        }
      } else {
        VoiceStorage.setEnabled(false);
        this.engine.setNativeState('stopped');
      }
    }
  }

  subscribe(listener: (snap: VoiceControllerSnapshot) => void): () => void {
    return this.engine.subscribe(listener);
  }

  subscribeVoskProgress(listener: (ev: VoskDownloadProgressEvent) => void): () => void {
    this.voskListeners.add(listener);
    return () => this.voskListeners.delete(listener);
  }

  getSnapshot(): VoiceControllerSnapshot {
    return this.engine.getSnapshot();
  }

  async getCapabilities(): Promise<VoiceCapabilities> {
    return VoiceBridge.getCapabilities();
  }

  async checkPermission(): Promise<VoicePermissionState> {
    return VoiceBridge.checkPermission();
  }

  async enableHandsFree(): Promise<{ ok: boolean; permission: VoicePermissionState; error?: string }> {
    if (!VoiceBridge.isAndroidNative()) {
      return {
        ok: false,
        permission: 'unsupported',
        error: 'Hands-free "Hey Lumen" voice control is available on Android devices.'
      };
    }

    await this.init();
    VoiceStorage.setDisclosureAccepted(true);

    let perm = await VoiceBridge.checkPermission();
    if (perm !== 'granted') {
      perm = await VoiceBridge.requestPermission();
    }

    if (perm !== 'granted') {
      VoiceStorage.setEnabled(false);
      this.engine.setNativeState('stopped');
      return {
        ok: false,
        permission: perm,
        error: 'Microphone permission was denied. Allow microphone access in Android Settings to use "Hey Lumen".'
      };
    }

    const res = await VoiceBridge.startHandsFree();
    if (!res.started) {
      VoiceStorage.setEnabled(false);
      this.engine.setNativeState('error', res.error);
      return {
        ok: false,
        permission: 'granted',
        error: res.error || 'On-device speech engine is unavailable on this device.'
      };
    }

    VoiceStorage.setEnabled(true);
    this.engine.setNativeState('waiting_wake');
    return { ok: true, permission: 'granted' };
  }

  async disableHandsFree(): Promise<void> {
    VoiceStorage.setEnabled(false);
    this.engine.cancelActiveLookup();
    await VoiceBridge.stopHandsFree();
    this.engine.setNativeState('stopped');
  }

  async downloadVoskModel(): Promise<{ installed: boolean; error?: string }> {
    await this.init();
    return VoiceBridge.downloadVoskModel();
  }

  async openAppSettings(): Promise<boolean> {
    return VoiceBridge.openAppSettings();
  }
}

export const VoiceRuntimeService = new VoiceRuntimeManager();
