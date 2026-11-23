import assert from 'node:assert/strict';
import {
  compareVersions,
  decideAndroidOtaAction,
  type OtaManifest
} from '../src/services/otaUpdateLogic.ts';

// 1. Semver & build-tag comparison
assert.equal(compareVersions('1.0.2', '1.0.1'), 1);
assert.equal(compareVersions('1.0.1', '1.0.1'), 0);
assert.equal(compareVersions('1.0.1+2026.11.23.1600', '1.0.1+2026.11.23.1530'), 1);
assert.equal(compareVersions('1.0.1+2026.11.23.1530', '1.0.1'), 1);

const baseManifest: OtaManifest = {
  appVersion: '1.0.2',
  webBundleVersion: '1.0.2+2026.11.24.1200',
  minNativeVersionCode: 2,
  webBundleUrl: 'https://example.com/lumen-web-bundle.zip',
  webBundleSha256: 'abc123',
  androidNative: {
    versionCode: 2,
    versionName: '1.0.2',
    apkUrl: 'https://example.com/Lumen-debug.apk',
    apkSha256: 'def456'
  }
};

// 2. Native versionCode bump triggers One-Tap APK update over Web OTA
{
  const decision = decideAndroidOtaAction(baseManifest, {
    nativeVersionCode: 1,
    nativeVersionName: '1.0.0',
    activeWebBundleVersion: 'builtin',
    builtinWebBundleVersion: '1.0.0'
  });
  assert.equal(decision.kind, 'native_apk_update');
  if (decision.kind === 'native_apk_update') {
    assert.equal(decision.versionCode, 2);
    assert.equal(decision.apkUrl, 'https://example.com/Lumen-debug.apk');
  }
}

// 3. Same native versionCode + newer webBundleVersion triggers Instant Web OTA
{
  const decision = decideAndroidOtaAction(baseManifest, {
    nativeVersionCode: 2,
    nativeVersionName: '1.0.1',
    activeWebBundleVersion: 'builtin',
    builtinWebBundleVersion: '1.0.1'
  });
  assert.equal(decision.kind, 'web_bundle_update');
  if (decision.kind === 'web_bundle_update') {
    assert.equal(decision.webBundleVersion, '1.0.2+2026.11.24.1200');
  }
}

// 4. Already running the latest web bundle -> up_to_date
{
  const decision = decideAndroidOtaAction(baseManifest, {
    nativeVersionCode: 2,
    nativeVersionName: '1.0.2',
    activeWebBundleVersion: '1.0.2+2026.11.24.1200',
    builtinWebBundleVersion: '1.0.1'
  });
  assert.equal(decision.kind, 'up_to_date');
}

// 5. Web bundle requiring higher minNativeVersionCode is NOT applied to older APK
{
  const gatedManifest: OtaManifest = {
    ...baseManifest,
    minNativeVersionCode: 3,
    androidNative: undefined
  };
  const decision = decideAndroidOtaAction(gatedManifest, {
    nativeVersionCode: 2,
    nativeVersionName: '1.0.1',
    activeWebBundleVersion: 'builtin',
    builtinWebBundleVersion: '1.0.1'
  });
  assert.equal(decision.kind, 'up_to_date');
}

console.log('ALL 5 OTA UPDATE DECISION TESTS PASSED!');
