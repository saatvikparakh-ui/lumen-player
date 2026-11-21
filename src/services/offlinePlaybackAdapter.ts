/**
 * LUMEN OFFLINE-FIRST PLAYBACK ADAPTER
 *
 * Checked FIRST by AudioEngine before the online PlaybackResolver waterfall:
 *   - If valid completed offline copy exists -> resolves native private source (zero network requests!)
 *   - If Offline-Only Mode is active & track is NOT downloaded -> returns explicit offline-unavailable error
 *     without hitting any online streaming APIs
 *   - Otherwise -> returns null so existing PlaybackResolver runs unchanged
 */

import { Track } from '../types/music';
import { ResolvedPlayback } from './playbackAdapter';
import { OfflineAuthorizationPolicy } from './offlineAuthorizationPolicy';
import { OfflineMediaRegistry } from './offlineMediaRegistry';
import { isNativeAndroid, LumenAudio } from './nativeAudioBridge';

class OfflinePlaybackAdapterImpl {
  private activeObjectUrls = new Map<string, string>();

  /**
   * Attempts offline-first resolution for a track.
   * Returns:
   *  - `ResolvedPlayback` when a verified local offline copy is ready to play
   *  - `{ blockedByOfflineMode: true, error: string }` when Offline-Only Mode is ON and track isn't downloaded
   *  - `null` when online waterfall should handle it normally
   */
  public async resolveOfflineFirst(track: Track): Promise<
    | { hit: true; resolved: ResolvedPlayback; isNativePrivateUri: boolean }
    | { hit: false; blockedByOfflineMode: true; error: string }
    | null
  > {
    await OfflineMediaRegistry.init();

    const canonicalId = OfflineAuthorizationPolicy.getCanonicalTrackId(track);
    const rec = OfflineMediaRegistry.getRecord(canonicalId);
    const settings = OfflineMediaRegistry.getSettings();

    if (rec && rec.downloadState === 'COMPLETED' && !rec.needsRepair) {
      // 1. Android Native Private Storage (Context.filesDir/lumen_offline_vault/<assetId>.lum)
      if (isNativeAndroid()) {
        try {
          const plugin = LumenAudio as any;
          if (typeof plugin.getOfflinePlaybackUri === 'function') {
            const uriRes = await plugin.getOfflinePlaybackUri({ canonicalTrackId: canonicalId, audioAssetId: rec.audioAssetId });
            if (uriRes?.exists && uriRes?.playableToken) {
              return {
                hit: true,
                isNativePrivateUri: true,
                resolved: {
                  streamUrl: uriRes.playableToken, // e.g. "lumen-offline://<assetId>" resolved inside LumenPlaybackService!
                  duration: rec.duration || track.duration || 0,
                  playbackType: 'local',
                  isExplicitPreview: false,
                  providerName: 'Lumen Private Offline Vault'
                }
              };
            } else {
              // File disappeared on disk — mark needsRepair honestly
              await OfflineMediaRegistry.upsertRecord({
                ...rec,
                needsRepair: true,
                downloadError: 'Offline audio file missing on device. Tap Repair in Downloads.'
              }, true);
            }
          }
        } catch (err) {
          console.warn('[OfflinePlaybackAdapter] Native offline resolve warning:', err);
        }
      }

      // 2. Desktop Electron Private Vault (lumen-vault://<assetId>)
      if (rec.storageReference.startsWith('lumen-vault://') && typeof window !== 'undefined' && (window as any).lumenAPI?.verifyOfflineAsset) {
        try {
          const check = await (window as any).lumenAPI.verifyOfflineAsset({ audioAssetId: rec.audioAssetId });
          if (check?.exists && check?.playableUrl) {
            return {
              hit: true,
              isNativePrivateUri: false,
              resolved: {
                streamUrl: check.playableUrl,
                duration: rec.duration || track.duration || 0,
                playbackType: 'local',
                isExplicitPreview: false,
                providerName: 'Lumen Private Offline Vault'
              }
            };
          } else {
            await OfflineMediaRegistry.upsertRecord({
              ...rec,
              needsRepair: true,
              downloadError: 'Offline file missing from desktop vault. Tap Repair in Downloads.'
            }, true);
          }
        } catch (_) {}
      }

      // 3. Web / PWA Private IndexedDB Blob Vault
      const blobEntry = await OfflineMediaRegistry.getAudioBlob(rec.audioAssetId);
      if (blobEntry && blobEntry.blob && blobEntry.blob.size > 0) {
        let objUrl = this.activeObjectUrls.get(rec.audioAssetId);
        if (!objUrl) {
          objUrl = URL.createObjectURL(blobEntry.blob);
          this.activeObjectUrls.set(rec.audioAssetId, objUrl);
        }
        return {
          hit: true,
          isNativePrivateUri: false,
          resolved: {
            streamUrl: objUrl,
            duration: rec.duration || track.duration || 0,
            playbackType: 'local',
            isExplicitPreview: false,
            providerName: 'Lumen Private Offline Vault'
          }
        };
      } else {
        await OfflineMediaRegistry.upsertRecord({
          ...rec,
          needsRepair: true,
          downloadError: 'Offline blob missing from browser storage. Tap Repair in Downloads.'
        }, true);
      }
    }

    // Enforce Offline-Only Mode: never attempt unnecessary online playback requests
    const isActuallyOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (settings.offlineModeEnabled || isActuallyOffline) {
      // Allow direct user local files even in offline mode
      if (track.playbackType === 'local' || track.streamUrl?.startsWith('blob:') || track.streamUrl?.startsWith('file://')) {
        return null;
      }
      return {
        hit: false,
        blockedByOfflineMode: true,
        error: settings.offlineModeEnabled
          ? `"${track.title}" is not downloaded. Turn off Offline Mode or download an authorized copy.`
          : `You're offline and "${track.title}" has not been downloaded.`
      };
    }

    return null;
  }

  /**
   * Resolves privately cached offline artwork Blob URL when offline.
   */
  public async getOfflineArtworkUrl(canonicalTrackId: string): Promise<string | null> {
    const rec = OfflineMediaRegistry.getRecord(canonicalTrackId);
    if (!rec) return null;
    const blob = await OfflineMediaRegistry.getArtworkBlob(rec.audioAssetId);
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }

  public revokeCachedObjectUrls(): void {
    this.activeObjectUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    });
    this.activeObjectUrls.clear();
  }
}

export const OfflinePlaybackAdapter = new OfflinePlaybackAdapterImpl();
