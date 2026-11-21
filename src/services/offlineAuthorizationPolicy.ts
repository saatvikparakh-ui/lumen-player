/**
 * LUMEN OFFLINE SOURCE AUTHORIZATION & CAPABILITY LAYER
 *
 * Strictly enforces Section 1.4:
 * Never assumes an online stream URL grants offline storage permission.
 * Explicitly blocks unauthorized JioSaavn decryption, CDN quality substitution,
 * and YouTube fallback streams from permanent offline downloads while keeping
 * online streaming 100% functional.
 */

import { Track } from '../types/music';
import { DownloadEligibility, OfflineQualityOption } from '../types/offlineTypes';

/** Trusted open-license / Creative Commons audio domains permitted for offline storage */
const OPEN_LICENSE_HOST_ALLOWLIST = [
  'upload.wikimedia.org',
  'archive.org',
  'dn720301.ca.archive.org',
  'ia80',
  'ia60',
  'ia90',
  'freemusicarchive.org',
  'files.freemusicarchive.org',
  'cdn.pixabay.com',
  'incompetech.com',
  'soundhelix.com',
  'www.soundhelix.com',
  'commondatastorage.googleapis.com'
];

/** Domains that are strictly online-stream-only and NOT authorized for persistent offline downloads */
const STREAM_ONLY_BLOCKLIST = [
  'saavncdn.com',
  'jiosaavn.com',
  'aac.saavncdn.com',
  'youtube.com',
  'youtu.be',
  'googlevideo.com',
  'ytimg.com',
  'audio-ssl.itunes.apple.com',
  'mzstatic.com'
];

export interface ExtendedTrackAuthorizationFields {
  offlineAuthorized?: boolean;
  offlineDownloadUrl?: string;
  licenseReference?: string;
  licenseExpiration?: number | null;
  availableOfflineQualities?: OfflineQualityOption[];
  isOpenLicense?: boolean;
}

export class OfflineAuthorizationPolicy {
  /**
   * Produces a stable canonical track identifier that avoids colliding different versions
   * or remasters sharing the same display title.
   */
  public static getCanonicalTrackId(track: Track): string {
    if (track.id && String(track.id).trim().length > 0) {
      return String(track.id).trim();
    }
    const base = `${track.artist || 'unknown'}::${track.album || 'single'}::${track.title || 'untitled'}::${Math.round(track.duration || 0)}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
      hash = ((hash << 5) - hash) + base.charCodeAt(i);
      hash |= 0;
    }
    return `canon_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Deterministic internal asset ID safe for private filenames (no path traversal characters).
   */
  public static getAudioAssetId(canonicalTrackId: string): string {
    const safe = canonicalTrackId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    let hash = 5381;
    for (let i = 0; i < canonicalTrackId.length; i++) {
      hash = ((hash << 5) + hash) + canonicalTrackId.charCodeAt(i);
      hash |= 0;
    }
    return `asset_${safe}_${Math.abs(hash).toString(16)}`;
  }

  private static getHostname(urlStr: string): string {
    try {
      return new URL(urlStr).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  private static isHostInList(hostname: string, list: string[]): boolean {
    if (!hostname) return false;
    return list.some(entry => hostname === entry || hostname.endsWith(`.${entry}`) || hostname.startsWith(entry));
  }

  /**
   * Evaluates whether a track is legally & technically authorized for persistent offline download.
   */
  public static evaluateTrack(track: Track & ExtendedTrackAuthorizationFields): DownloadEligibility {
    if (!track) {
      return {
        eligible: false,
        sourceType: 'unsupported_stream',
        reason: 'Track metadata is missing.',
        availableQualities: []
      };
    }

    // 1. User-owned local audio files (desktop filesystem, Electron local bridge, imported Blob/File)
    const localUrl = track.localFilePath || track.path || (track.streamUrl?.startsWith('blob:') || track.streamUrl?.startsWith('file://') ? track.streamUrl : '');
    if (
      track.playbackType === 'local' ||
      (track as any).sourceType === 'local' ||
      (localUrl && !localUrl.startsWith('http://') && !localUrl.startsWith('https://')) ||
      track.streamUrl?.startsWith('blob:') ||
      track.streamUrl?.startsWith('file://')
    ) {
      return {
        eligible: true,
        sourceType: 'user_local_file',
        reason: 'User-owned local audio file authorized for persistent offline vault backup.',
        authorizedUrl: track.streamUrl || localUrl,
        availableQualities: ['source_original'],
        licenseReference: 'USER_OWNED_LOCAL'
      };
    }

    // 2. Explicitly authorized licensed download URL (via approved SDK / licensed provider metadata)
    const candidateUrl = track.offlineDownloadUrl || track.streamUrl || '';
    const hostname = this.getHostname(candidateUrl);

    // Hard block unauthorized stream-only sources (JioSaavn CDN, YouTube, iTunes 30s previews, backend proxy)
    const isBackendProxy = candidateUrl.includes('/api/stream/resolve') || candidateUrl.includes('/api/youtube');
    if (isBackendProxy || this.isHostInList(hostname, STREAM_ONLY_BLOCKLIST)) {
      return {
        eligible: false,
        sourceType: 'unsupported_stream',
        reason: 'Offline download is not authorized by this streaming provider. Online playback remains available.',
        availableQualities: []
      };
    }

    if (track.offlineAuthorized && candidateUrl.startsWith('http')) {
      return {
        eligible: true,
        sourceType: track.isOpenLicense ? 'open_license_audio' : 'licensed_provider',
        reason: track.isOpenLicense
          ? 'Open-license audio authorized for offline playback.'
          : 'Licensed provider authorizes offline download.',
        authorizedUrl: candidateUrl,
        availableQualities: track.availableOfflineQualities && track.availableOfflineQualities.length > 0
          ? track.availableOfflineQualities
          : ['source_original'],
        licenseReference: track.licenseReference || (track.isOpenLicense ? 'OPEN_LICENSE_CC' : 'PROVIDER_LICENSED'),
        licenseExpiration: track.licenseExpiration ?? null
      };
    }

    // 3. Verified open-license audio host (Creative Commons / Public Domain / Internet Archive)
    if (candidateUrl.startsWith('https://') && this.isHostInList(hostname, OPEN_LICENSE_HOST_ALLOWLIST)) {
      return {
        eligible: true,
        sourceType: 'open_license_audio',
        reason: 'Open-license audio source authorized for persistent offline storage.',
        authorizedUrl: candidateUrl,
        availableQualities: ['source_original'],
        licenseReference: `OPEN_LICENSE:${hostname}`
      };
    }

    // 4. Default deny: never assume an arbitrary online stream permits permanent downloading
    return {
      eligible: false,
      sourceType: 'unsupported_stream',
      reason: 'Offline download is not supported for this catalog source without an offline license. Online streaming works normally.',
      availableQualities: []
    };
  }

  /**
   * Built-in verified open-license (CC / Public Domain) audio tracks so users can immediately
   * verify offline vault downloading, pause/resume, SHA-256 verification, and airplane-mode playback.
   */
  public static getOpenLicenseDemoCatalog(): Array<Track & ExtendedTrackAuthorizationFields> {
    const now = Date.now();
    return [
      {
        id: 'cc_lumen_soundhelix_01',
        title: 'Nocturne in Glass (Open License)',
        artist: 'T. Schürger (SoundHelix CC)',
        album: 'Lumen Open-License Vault Pack',
        duration: 372,
        artworkUrl: null,
        hasArtwork: false,
        path: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        filename: 'SoundHelix-Song-1.mp3',
        addedAt: now,
        streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        offlineAuthorized: true,
        isOpenLicense: true,
        licenseReference: 'OPEN_LICENSE:SoundHelix-Example',
        availableOfflineQualities: ['source_original'],
        genre: 'Electronic',
        year: 2024
      },
      {
        id: 'cc_lumen_soundhelix_02',
        title: 'Velvet Horizon (Open License)',
        artist: 'T. Schürger (SoundHelix CC)',
        album: 'Lumen Open-License Vault Pack',
        duration: 425,
        artworkUrl: null,
        hasArtwork: false,
        path: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        filename: 'SoundHelix-Song-2.mp3',
        addedAt: now,
        streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        offlineAuthorized: true,
        isOpenLicense: true,
        licenseReference: 'OPEN_LICENSE:SoundHelix-Example',
        availableOfflineQualities: ['source_original'],
        genre: 'Ambient',
        year: 2024
      },
      {
        id: 'cc_lumen_soundhelix_03',
        title: 'Chromatic Drift (Open License)',
        artist: 'T. Schürger (SoundHelix CC)',
        album: 'Lumen Open-License Vault Pack',
        duration: 344,
        artworkUrl: null,
        hasArtwork: false,
        path: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
        filename: 'SoundHelix-Song-3.mp3',
        addedAt: now,
        streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
        offlineAuthorized: true,
        isOpenLicense: true,
        licenseReference: 'OPEN_LICENSE:SoundHelix-Example',
        availableOfflineQualities: ['source_original'],
        genre: 'Synthwave',
        year: 2024
      }
    ];
  }
}
