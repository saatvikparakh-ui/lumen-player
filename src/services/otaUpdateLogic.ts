export interface OtaManifest {
  appVersion: string;
  webBundleVersion: string;
  minNativeVersionCode: number;
  webBundleUrl: string;
  webBundleFallbackUrl?: string;
  webBundleSha256?: string;
  androidNative?: {
    versionCode: number;
    versionName: string;
    apkUrl: string;
    apkFallbackUrl?: string;
    apkSha256?: string;
    releaseNotes?: string;
  };
  windows?: {
    version: string;
    installerUrl: string;
    installerFallbackUrl?: string;
    installerSha256?: string;
    releaseNotes?: string;
  };
  releaseNotes?: string;
  publishedAt?: string;
}

export interface AndroidInstalledState {
  nativeVersionCode: number;
  nativeVersionName: string;
  activeWebBundleVersion: string;
  builtinWebBundleVersion: string;
}

export type AndroidOtaDecision =
  | { kind: 'up_to_date' }
  | {
      kind: 'native_apk_update';
      versionCode: number;
      versionName: string;
      apkUrl: string;
      apkFallbackUrl?: string;
      apkSha256: string;
      releaseNotes: string;
    }
  | {
      kind: 'web_bundle_update';
      webBundleVersion: string;
      webBundleUrl: string;
      webBundleFallbackUrl?: string;
      webBundleSha256: string;
      releaseNotes: string;
    };

export type WindowsOtaDecision =
  | { kind: 'up_to_date' }
  | {
      kind: 'windows_installer_update';
      version: string;
      installerUrl: string;
      installerFallbackUrl?: string;
      releaseNotes: string;
    };

/**
 * Strips raw HTTP headers, Node/Electron stack traces, and verbose error dumps
 * into a single concise user-friendly sentence.
 */
export function sanitizeOtaError(raw: unknown, fallback = 'Could not check for updates right now.'): string {
  const str = typeof raw === 'string' ? raw : (raw as any)?.message ? String((raw as any).message) : '';
  const cleaned = str.trim();
  if (!cleaned) return fallback;
  const lower = cleaned.toLowerCase();
  if (lower.includes('latest.yml') || lower.includes('http 404') || lower.includes('httperror: 404') || lower.includes('status code 404')) {
    return 'Update package is syncing. Please try again in a moment.';
  }
  if (lower.includes('sha-256') || lower.includes('sha256') || lower.includes('integrity')) {
    return 'Update verification failed. Tap Check for Updates to retry.';
  }
  if (lower.includes('not a valid android apk') || lower.includes('not a valid')) {
    return 'Update package is still uploading. Please try again shortly.';
  }
  if (lower.includes('network') || lower.includes('enotfound') || lower.includes('econn') || lower.includes('timeout') || lower.includes('failed to fetch')) {
    return 'Could not reach update server. Check your internet connection.';
  }
  // Cut off stack traces / Headers dumps / multi-line noise
  const firstLine = cleaned.split(/\r?\n/)[0].split('Headers:')[0].split(' at ')[0].trim();
  if (!firstLine) return fallback;
  return firstLine.length > 110 ? `${firstLine.slice(0, 107).trim()}...` : firstLine;
}

/**
 * Compares two semver or dotted-numeric strings (e.g. "1.0.2" vs "1.0.1" or "1.0.1+2026.11.23.1530").
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const splitMainBuild = (v: string) => {
    const clean = (v || '').replace(/^v/i, '').trim();
    const [main, build = ''] = clean.split('+');
    return {
      mainParts: main.split('.').map((n) => parseInt(n, 10) || 0),
      buildParts: build ? build.split('.').map((n) => parseInt(n, 10) || 0) : []
    };
  };

  const va = splitMainBuild(a);
  const vb = splitMainBuild(b);

  const maxMain = Math.max(va.mainParts.length, vb.mainParts.length);
  for (let i = 0; i < maxMain; i++) {
    const da = va.mainParts[i] ?? 0;
    const db = vb.mainParts[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }

  const maxBuild = Math.max(va.buildParts.length, vb.buildParts.length);
  for (let i = 0; i < maxBuild; i++) {
    const da = va.buildParts[i] ?? 0;
    const db = vb.buildParts[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }

  return 0;
}

/**
 * Decides which Android update layer to trigger:
 * 1. If manifest.androidNative.versionCode > installed.nativeVersionCode -> One-Tap In-App APK Update
 *    (required whenever native Java, plugins, or Android permissions change).
 * 2. Else if manifest.minNativeVersionCode <= installed.nativeVersionCode AND
 *    manifest.webBundleVersion > effectiveInstalledWebVersion -> Silent Web/UI OTA Update.
 * 3. Else -> Up to date.
 */
export function decideAndroidOtaAction(
  manifest: OtaManifest,
  installed: AndroidInstalledState
): AndroidOtaDecision {
  const nativeMeta = manifest.androidNative;
  if (
    nativeMeta &&
    nativeMeta.apkUrl &&
    Number(nativeMeta.versionCode) > Number(installed.nativeVersionCode)
  ) {
    return {
      kind: 'native_apk_update',
      versionCode: Number(nativeMeta.versionCode),
      versionName: nativeMeta.versionName || manifest.appVersion,
      apkUrl: nativeMeta.apkUrl,
      apkFallbackUrl: nativeMeta.apkFallbackUrl || 'https://lumen-player.onrender.com/download/apk',
      apkSha256: nativeMeta.apkSha256 || '',
      releaseNotes: nativeMeta.releaseNotes || manifest.releaseNotes || 'Native Android update available.'
    };
  }

  // Only allow Web OTA if current installed APK satisfies minNativeVersionCode
  if (
    manifest.webBundleUrl &&
    manifest.webBundleVersion &&
    Number(installed.nativeVersionCode) >= Number(manifest.minNativeVersionCode || 1)
  ) {
    const effectiveCurrentWeb =
      installed.activeWebBundleVersion && installed.activeWebBundleVersion !== 'builtin'
        ? installed.activeWebBundleVersion
        : installed.builtinWebBundleVersion;

    if (compareVersions(manifest.webBundleVersion, effectiveCurrentWeb) > 0) {
      return {
        kind: 'web_bundle_update',
        webBundleVersion: manifest.webBundleVersion,
        webBundleUrl: manifest.webBundleUrl,
        webBundleFallbackUrl: manifest.webBundleFallbackUrl,
        webBundleSha256: manifest.webBundleSha256 || '',
        releaseNotes: manifest.releaseNotes || 'New Lumen UI & feature update ready.'
      };
    }
  }

  return { kind: 'up_to_date' };
}

export function decideWindowsOtaAction(
  manifest: OtaManifest,
  installedVersion: string
): WindowsOtaDecision {
  const targetVersion = manifest.windows?.version || manifest.appVersion;
  if (!targetVersion || compareVersions(targetVersion, installedVersion) <= 0) {
    return { kind: 'up_to_date' };
  }
  const installerUrl =
    manifest.windows?.installerUrl ||
    'https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/Lumen-Setup.exe';
  return {
    kind: 'windows_installer_update',
    version: targetVersion,
    installerUrl,
    installerFallbackUrl:
      manifest.windows?.installerFallbackUrl ||
      'https://lumen-player.onrender.com/download/windows',
    releaseNotes: manifest.windows?.releaseNotes || manifest.releaseNotes || `Lumen v${targetVersion} is ready to install.`
  };
}
