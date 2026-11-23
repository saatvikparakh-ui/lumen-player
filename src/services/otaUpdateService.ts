import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  decideAndroidOtaAction,
  type AndroidOtaDecision,
  type OtaManifest
} from './otaUpdateLogic';

export const BUILTIN_APP_VERSION = '1.0.1';
export const BUILTIN_WEB_BUNDLE_VERSION = '1.0.1';

const MANIFEST_URLS = [
  'https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/ota-manifest.json',
  'https://raw.githubusercontent.com/saatvikparakh-ui/lumen-player/main/ota-manifest.json',
  'https://lumen-player.onrender.com/api/ota/manifest'
];

interface LumenOtaNativePlugin {
  getAppInfo(): Promise<{
    platform: 'android';
    nativeVersionCode: number;
    nativeVersionName: string;
    activeWebBundleVersion: string;
    hasCustomWebBundle: boolean;
    lastRollbackReason?: string;
  }>;
  notifyAppReady(): Promise<{ confirmed: boolean }>;
  downloadAndStageWebBundle(options: {
    url: string;
    version: string;
    sha256?: string;
    applyImmediately?: boolean;
  }): Promise<{ staged: boolean; version: string; applied: boolean }>;
  applyPendingWebBundle(): Promise<{ applied: boolean }>;
  resetToBuiltinBundle(): Promise<{ reset: boolean }>;
  canRequestPackageInstalls(): Promise<{ canInstall: boolean }>;
  openInstallPermissionSettings(): Promise<{ opened: boolean }>;
  downloadAndInstallApk(options: {
    url: string;
    sha256?: string;
  }): Promise<{ needsInstallPermission: boolean; launchedInstaller: boolean }>;
  addListener(
    eventName: 'onOtaProgress',
    listenerFunc: (event: {
      kind: 'web' | 'apk';
      stage: string;
      percent: number;
      message?: string;
    }) => void
  ): Promise<PluginListenerHandle>;
}

const LumenOtaNative = registerPlugin<LumenOtaNativePlugin>('LumenOta');

export type OtaBannerState =
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'web_downloading'
  | 'web_ready_to_apply'
  | 'apk_available'
  | 'apk_needs_permission'
  | 'apk_downloading'
  | 'windows_downloading'
  | 'windows_ready_to_restart'
  | 'error';

export interface OtaSnapshot {
  platform: 'android' | 'windows' | 'web';
  state: OtaBannerState;
  currentVersion: string;
  nativeVersionCode?: number;
  activeWebBundleVersion?: string;
  availableVersion: string | null;
  percent: number;
  message: string | null;
  releaseNotes: string | null;
  dismissed: boolean;
  lastCheckedAt: number | null;
  pendingApk?: {
    url: string;
    sha256: string;
    versionName: string;
    versionCode: number;
  } | null;
}

class OtaUpdateManager {
  private initialized = false;
  private listeners = new Set<(snap: OtaSnapshot) => void>();
  private progressHandle: PluginListenerHandle | null = null;
  private electronUnsub: (() => void) | null = null;

  private state: OtaSnapshot = {
    platform: this.detectPlatform(),
    state: 'idle',
    currentVersion: BUILTIN_APP_VERSION,
    activeWebBundleVersion: BUILTIN_WEB_BUNDLE_VERSION,
    availableVersion: null,
    percent: 0,
    message: null,
    releaseNotes: null,
    dismissed: false,
    lastCheckedAt: null,
    pendingApk: null
  };

  private detectPlatform(): 'android' | 'windows' | 'web' {
    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        return 'android';
      }
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined' && Boolean((window as any).lumenAPI?.checkForUpdates)) {
      return 'windows';
    }
    return 'web';
  }

  getSnapshot(): OtaSnapshot {
    return { ...this.state };
  }

  subscribe(fn: (snap: OtaSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<OtaSnapshot>): void {
    this.state = { ...this.state, ...patch };
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        // ignore
      }
    });
  }

  dismissBanner(): void {
    this.emit({ dismissed: true });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const platform = this.detectPlatform();
    this.emit({ platform });

    if (platform === 'android') {
      try {
        // Confirm boot success immediately so rollback watchdog marks current bundle healthy
        await LumenOtaNative.notifyAppReady();
        const info = await LumenOtaNative.getAppInfo();
        this.emit({
          currentVersion: info.nativeVersionName || BUILTIN_APP_VERSION,
          nativeVersionCode: info.nativeVersionCode,
          activeWebBundleVersion: info.activeWebBundleVersion
        });

        this.progressHandle = await LumenOtaNative.addListener('onOtaProgress', (ev) => {
          if (ev.kind === 'web') {
            if (ev.stage === 'error') {
              this.emit({ state: 'error', message: ev.message || 'Web update failed.' });
            } else if (ev.stage === 'ready') {
              this.emit({
                state: 'web_ready_to_apply',
                percent: 100,
                message: 'New Lumen update downloaded. Tap to apply now.',
                dismissed: false
              });
            } else {
              this.emit({
                state: 'web_downloading',
                percent: ev.percent,
                message: ev.message || `Updating Lumen (${ev.percent}%)...`
              });
            }
          } else if (ev.kind === 'apk') {
            if (ev.stage === 'error') {
              this.emit({ state: 'error', message: ev.message || 'APK download failed.' });
            } else {
              this.emit({
                state: 'apk_downloading',
                percent: ev.percent,
                message: ev.message || `Downloading Android update (${ev.percent}%)...`
              });
            }
          }
        });

        // Silent background check 6s after startup so launch stays instant
        setTimeout(() => {
          void this.checkForUpdates({ silent: true });
        }, 6000);
      } catch {
        // Non-fatal
      }
      return;
    }

    if (platform === 'windows') {
      const api = (window as any).lumenAPI;
      try {
        const info = await api.getAppInfo?.();
        if (info?.version) {
          this.emit({ currentVersion: info.version });
        }
        if (info?.status) {
          this.applyElectronStatus(info.status);
        }
        if (api.onUpdateStatus) {
          this.electronUnsub = api.onUpdateStatus((status: any) => {
            this.applyElectronStatus(status);
          });
        }
      } catch {
        // ignore
      }
    }
  }

  private applyElectronStatus(status: any): void {
    if (!status) return;
    if (status.state === 'checking') {
      this.emit({
        state: 'checking',
        message: status.message || 'Checking for updates...'
      });
    } else if (status.state === 'downloading') {
      this.emit({
        state: 'windows_downloading',
        availableVersion: status.availableVersion || this.state.availableVersion,
        percent: status.percent || 0,
        releaseNotes: status.releaseNotes || this.state.releaseNotes,
        message: status.message || `Downloading update (${status.percent || 0}%)...`,
        dismissed: false
      });
    } else if (status.state === 'downloaded') {
      this.emit({
        state: 'windows_ready_to_restart',
        availableVersion: status.availableVersion || this.state.availableVersion,
        percent: 100,
        releaseNotes: status.releaseNotes || this.state.releaseNotes,
        message: status.message || 'Update ready. Restart Lumen to install.',
        dismissed: false
      });
    } else if (status.state === 'up_to_date') {
      this.emit({
        state: 'up_to_date',
        availableVersion: null,
        percent: 0,
        message: status.message || 'Lumen is up to date.',
        lastCheckedAt: Date.now()
      });
    } else if (status.state === 'error') {
      this.emit({
        state: 'error',
        message: status.message || 'Update check failed.'
      });
    }
  }

  private async fetchManifest(): Promise<OtaManifest | null> {
    for (const url of MANIFEST_URLS) {
      try {
        const cacheBust = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        const res = await fetch(cacheBust, { cache: 'no-store' });
        if (!res.ok) continue;
        const json = (await res.json()) as OtaManifest;
        if (json && (json.webBundleVersion || json.androidNative || json.windows)) {
          return json;
        }
      } catch {
        // Try next mirror (GitHub Releases -> GitHub Raw -> Render API)
      }
    }
    return null;
  }

  async checkForUpdates(opts: { silent?: boolean } = {}): Promise<void> {
    const platform = this.detectPlatform();
    if (!opts.silent) {
      this.emit({ state: 'checking', message: 'Checking for updates...', dismissed: false });
    }

    if (platform === 'windows') {
      const api = (window as any).lumenAPI;
      if (api?.checkForUpdates) {
        await api.checkForUpdates();
      }
      this.emit({ lastCheckedAt: Date.now() });
      return;
    }

    if (platform === 'android') {
      try {
        const [info, manifest] = await Promise.all([
          LumenOtaNative.getAppInfo(),
          this.fetchManifest()
        ]);

        if (!manifest) {
          if (!opts.silent) {
            this.emit({
              state: 'error',
              message: 'Could not reach update server. Check your internet connection.',
              lastCheckedAt: Date.now()
            });
          }
          return;
        }

        const decision: AndroidOtaDecision = decideAndroidOtaAction(manifest, {
          nativeVersionCode: info.nativeVersionCode,
          nativeVersionName: info.nativeVersionName,
          activeWebBundleVersion: info.activeWebBundleVersion,
          builtinWebBundleVersion: BUILTIN_WEB_BUNDLE_VERSION
        });

        if (decision.kind === 'native_apk_update') {
          this.emit({
            state: 'apk_available',
            availableVersion: decision.versionName,
            releaseNotes: decision.releaseNotes,
            message: `Lumen v${decision.versionName} is available (native Android update).`,
            dismissed: false,
            lastCheckedAt: Date.now(),
            pendingApk: {
              url: decision.apkUrl,
              sha256: decision.apkSha256,
              versionName: decision.versionName,
              versionCode: decision.versionCode
            }
          });
          return;
        }

        if (decision.kind === 'web_bundle_update') {
          this.emit({
            state: 'web_downloading',
            availableVersion: decision.webBundleVersion,
            releaseNotes: decision.releaseNotes,
            percent: 5,
            message: `Downloading Lumen update (${decision.webBundleVersion})...`,
            dismissed: false,
            lastCheckedAt: Date.now()
          });

          try {
            await LumenOtaNative.downloadAndStageWebBundle({
              url: decision.webBundleUrl,
              version: decision.webBundleVersion,
              sha256: decision.webBundleSha256,
              applyImmediately: false
            });
          } catch (primaryErr) {
            // Automatic fallback to Render bundle URL if GitHub download fails
            if (decision.webBundleFallbackUrl) {
              await LumenOtaNative.downloadAndStageWebBundle({
                url: decision.webBundleFallbackUrl,
                version: decision.webBundleVersion,
                sha256: decision.webBundleSha256,
                applyImmediately: false
              });
            } else {
              throw primaryErr;
            }
          }

          this.emit({
            state: 'web_ready_to_apply',
            availableVersion: decision.webBundleVersion,
            percent: 100,
            message: 'New Lumen update ready. Tap Apply Now or restart app.',
            dismissed: false
          });
          return;
        }

        this.emit({
          state: 'up_to_date',
          availableVersion: null,
          percent: 0,
          message: `Lumen v${info.nativeVersionName} is up to date.`,
          lastCheckedAt: Date.now()
        });
      } catch (err: any) {
        if (!opts.silent) {
          this.emit({
            state: 'error',
            message: err?.message || 'Update check failed.',
            lastCheckedAt: Date.now()
          });
        }
      }
      return;
    }

    // Web browser build updates automatically on page reload
    this.emit({
      state: 'up_to_date',
      message: 'Web app updates automatically on refresh.',
      lastCheckedAt: Date.now()
    });
  }

  async applyWebUpdateNow(): Promise<void> {
    if (this.detectPlatform() !== 'android') return;
    try {
      await LumenOtaNative.applyPendingWebBundle();
    } catch (err: any) {
      this.emit({ state: 'error', message: err?.message || 'Could not apply update.' });
    }
  }

  async startApkInstall(): Promise<void> {
    if (this.detectPlatform() !== 'android' || !this.state.pendingApk) return;
    try {
      const perm = await LumenOtaNative.canRequestPackageInstalls();
      if (!perm.canInstall) {
        this.emit({
          state: 'apk_needs_permission',
          message: 'Allow "Install unknown apps" for Lumen, then tap Download & Install again.'
        });
        await LumenOtaNative.openInstallPermissionSettings();
        return;
      }

      this.emit({
        state: 'apk_downloading',
        percent: 2,
        message: `Downloading Lumen v${this.state.pendingApk.versionName}...`
      });

      const res = await LumenOtaNative.downloadAndInstallApk({
        url: this.state.pendingApk.url,
        sha256: this.state.pendingApk.sha256
      });

      if (res.needsInstallPermission) {
        this.emit({
          state: 'apk_needs_permission',
          message: 'Allow "Install unknown apps" for Lumen to install updates directly.'
        });
        await LumenOtaNative.openInstallPermissionSettings();
      }
    } catch (err: any) {
      this.emit({
        state: 'error',
        message: err?.message || 'Could not download Android update.'
      });
    }
  }

  async installWindowsUpdateNow(): Promise<void> {
    if (this.detectPlatform() !== 'windows') return;
    const api = (window as any).lumenAPI;
    await api?.installUpdate?.();
  }
}

export const OtaUpdateService = new OtaUpdateManager();
