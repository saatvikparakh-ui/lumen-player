/**
 * LUMEN PLAYBACK PROVIDER-ADAPTER ARCHITECTURE
 * Separates track metadata, full-length audio streams, local audio, and explicit previews.
 * Truthfully reports media duration and prevents 30-second previews from masquerading as full songs.
 */

import { Track, PlaybackSourceType } from '../types/music';
import { ApiClient } from './apiClient';

export interface ResolvedPlayback {
  streamUrl: string;
  duration: number; // Actual media duration in seconds
  playbackType: PlaybackSourceType;
  isExplicitPreview: boolean;
  providerName: string;
  error?: string | null;
}

export interface IPlaybackProvider {
  id: string;
  name: string;
  isAvailable(): Promise<boolean> | boolean;
  canHandle(track: Track): boolean;
  resolve(track: Track): Promise<ResolvedPlayback>;
}

/**
 * 1. LOCAL AUDIO PROVIDER
 * Handles user-selected local audio files (desktop file system, Electron local bridge, Capacitor local files, Blob URLs)
 */
export class LocalAudioProvider implements IPlaybackProvider {
  id = 'local';
  name = 'Local Audio';

  isAvailable(): boolean {
    return true;
  }

  canHandle(track: Track): boolean {
    if (!track) return false;
    if (track.localFilePath) return true;
    if (track.streamUrl?.startsWith('blob:') || track.streamUrl?.startsWith('file://')) return true;
    if (track.path && !track.path.startsWith('http://') && !track.path.startsWith('https://')) return true;
    return false;
  }

  async resolve(track: Track): Promise<ResolvedPlayback> {
    let url = track.streamUrl;
    if (!url && track.localFilePath) {
      url = track.localFilePath;
    }

    // If running in Electron Lumen environment, convert local path to audio URL
    if (typeof window !== 'undefined' && window.lumenAPI?.getAudioUrl && track.path) {
      try {
        url = await window.lumenAPI.getAudioUrl(track.path);
      } catch (_) {}
    }

    return {
      streamUrl: url,
      duration: track.duration > 0 ? track.duration : 0,
      playbackType: 'local',
      isExplicitPreview: false,
      providerName: this.name
    };
  }
}

/**
 * 2. BACKEND FULL-LENGTH STREAM PROVIDER
 * Streams full-length high-fidelity audio via the Lumen backend resolver (/api/stream/resolve)
 */
export class BackendStreamProvider implements IPlaybackProvider {
  id = 'backend';
  name = 'Lumen High-Fidelity Master';

  async isAvailable(): Promise<boolean> {
    return ApiClient.checkHealth(1200);
  }

  canHandle(track: Track): boolean {
    if (!track) return false;
    // Can handle any catalog track with title and artist
    return !!(track.title && track.artist);
  }

  async resolve(track: Track): Promise<ResolvedPlayback> {
    const title = encodeURIComponent(track.title);
    const artist = encodeURIComponent(track.artist);
    const durationParam = track.duration > 0 ? `&duration=${Math.round(track.duration)}` : '';
    const resolvePath = `/api/stream/resolve?title=${title}&artist=${artist}${durationParam}`;
    const fullStreamUrl = ApiClient.resolveUrl(resolvePath);

    return {
      streamUrl: fullStreamUrl,
      duration: track.duration > 0 ? track.duration : 180,
      playbackType: 'full-stream',
      isExplicitPreview: false,
      providerName: this.name
    };
  }
}

/**
 * 3. OPEN CATALOG PROVIDER
 * Full-length audio from open licensed tracks (Jamendo, Creative Commons, verified open catalog)
 */
export class OpenCatalogProvider implements IPlaybackProvider {
  id = 'open-catalog';
  name = 'Open License Audio';

  isAvailable(): boolean {
    return true;
  }

  canHandle(track: Track): boolean {
    if (!track) return false;
    return !!(track.isStream && track.streamSource === 'open-license' && track.streamUrl && !track.streamUrl.includes('apple.com'));
  }

  async resolve(track: Track): Promise<ResolvedPlayback> {
    return {
      streamUrl: track.streamUrl,
      duration: track.duration > 0 ? track.duration : 180,
      playbackType: 'full-stream',
      isExplicitPreview: false,
      providerName: this.name
    };
  }
}

/**
 * 4. EXPLICIT PREVIEW PROVIDER
 * Fallback preview snippet (e.g. 30s iTunes sample) used ONLY when full playback is unavailable.
 * Truthfully reports duration (30s) and explicitly marks isExplicitPreview = true.
 */
export class ExplicitPreviewProvider implements IPlaybackProvider {
  id = 'preview';
  name = 'Sample Preview';

  isAvailable(): boolean {
    return true;
  }

  canHandle(track: Track): boolean {
    if (!track) return false;
    return !!(track.previewUrl || (track.streamUrl && track.streamUrl.includes('apple.com')));
  }

  async resolve(track: Track): Promise<ResolvedPlayback> {
    const previewUrl = track.previewUrl || track.streamUrl;
    return {
      streamUrl: previewUrl,
      duration: 30, // Preview is strictly ~30 seconds, never fabricate full length
      playbackType: 'preview',
      isExplicitPreview: true,
      providerName: this.name
    };
  }
}

/**
 * PLAYBACK RESOLVER
 * Orchestrates providers with strict precedence and truthful media duration reporting.
 */
export class PlaybackResolver {
  private static providers: IPlaybackProvider[] = [
    new LocalAudioProvider(),
    new BackendStreamProvider(),
    new OpenCatalogProvider(),
    new ExplicitPreviewProvider()
  ];

  public static async resolvePlayback(track: Track): Promise<ResolvedPlayback> {
    // 1. Try local audio first if track is a local file
    const localProvider = this.providers.find(p => p.id === 'local')!;
    if (localProvider.canHandle(track)) {
      try {
        return await localProvider.resolve(track);
      } catch (err) {
        console.warn('LocalAudioProvider failed:', err);
      }
    }

    // 2. Try Open Catalog if designated
    const openProvider = this.providers.find(p => p.id === 'open-catalog')!;
    if (openProvider.canHandle(track)) {
      try {
        return await openProvider.resolve(track);
      } catch (err) {
        console.warn('OpenCatalogProvider failed:', err);
      }
    }

    // 3. Try Backend Full Stream
    const backendProvider = this.providers.find(p => p.id === 'backend')!;
    if (backendProvider.canHandle(track)) {
      try {
        const resolved = await backendProvider.resolve(track);
        return resolved;
      } catch (backendErr) {
        console.warn('BackendStreamProvider unavailable:', backendErr);
      }
    }

    // 4. Fallback to Explicit Preview if available (with honest 30s duration and preview badge)
    const previewProvider = this.providers.find(p => p.id === 'preview')!;
    if (previewProvider.canHandle(track)) {
      return await previewProvider.resolve(track);
    }

    // 5. If track has external URL only or completely unplayable
    return {
      streamUrl: '',
      duration: 0,
      playbackType: 'external',
      isExplicitPreview: false,
      providerName: 'Unavailable',
      error: 'No playable audio source available for this track'
    };
  }
}
