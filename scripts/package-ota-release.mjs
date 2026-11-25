import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const lumenDir = path.resolve(__dirname, '..');
const distDir = path.join(lumenDir, 'dist');
const outDir = path.join(lumenDir, 'dist-ota');

const GH_OWNER = 'saatvikparakh-ui';
const GH_REPO = 'lumen-player';
const GH_LATEST_DOWNLOAD = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest/download`;
const GH_RAW_OTA_LIVE = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/ota-live`;
const otaLiveDir = path.join(lumenDir, 'ota-live');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha512Base64File(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function readAndroidVersionInfo() {
  const gradlePath = path.join(lumenDir, 'android', 'app', 'build.gradle');
  const text = fs.readFileSync(gradlePath, 'utf8');
  const codeMatch = text.match(/versionCode\s+(\d+)/);
  const nameMatch = text.match(/versionName\s+"([^"]+)"/);
  return {
    versionCode: codeMatch ? Number(codeMatch[1]) : 1,
    versionName: nameMatch ? nameMatch[1] : '1.0.0'
  };
}

function main() {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('[OTA Packager] Missing dist/index.html. Run `npm run build` first.');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(lumenDir, 'package.json'), 'utf8'));
  const androidVer = readAndroidVersionInfo();

  const bundleZipPath = path.join(outDir, 'lumen-web-bundle.zip');
  if (fs.existsSync(bundleZipPath)) {
    fs.unlinkSync(bundleZipPath);
  }

  // Package dist/* cleanly into dist-ota/lumen-web-bundle.zip
  if (process.platform === 'win32') {
    const psCmd = `Compress-Archive -Path "${distDir}\\*" -DestinationPath "${bundleZipPath}" -Force`;
    execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
  } else {
    execSync(`cd "${distDir}" && zip -r "${bundleZipPath}" .`, { stdio: 'inherit' });
  }

  const webBundleSha256 = sha256File(bundleZipPath);
  const now = new Date();
  const buildStamp = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.${String(now.getUTCDate()).padStart(2, '0')}.${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const webBundleVersion = `${pkg.version}+${buildStamp}`;

  // Compute APK & Windows EXE hashes if built
  const apkCandidates = [
    path.join(lumenDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    path.join(lumenDir, 'downloads', 'Lumen-debug.apk'),
    path.join(lumenDir, 'downloads', 'Lumen.apk')
  ];
  const existingApk = apkCandidates.find((p) => fs.existsSync(p)) || null;
  const apkSha256 = existingApk ? sha256File(existingApk) : '';

  // Publish live Android OTA files into tracked ota-live/ so every git push serves HTTP 200 immediately
  fs.mkdirSync(otaLiveDir, { recursive: true });
  fs.copyFileSync(bundleZipPath, path.join(otaLiveDir, 'lumen-web-bundle.zip'));
  if (existingApk) {
    fs.copyFileSync(existingApk, path.join(otaLiveDir, 'Lumen.apk'));
  }

  const exeCandidates = [
    path.join(lumenDir, 'dist-electron', 'Lumen-Setup.exe'),
    path.join(lumenDir, 'downloads', 'Lumen-Setup.exe'),
    path.join(lumenDir, 'dist-electron-release', 'Lumen-Setup.exe')
  ];
  const existingExe = exeCandidates.find((p) => fs.existsSync(p)) || null;
  const exeSha256 = existingExe ? sha256File(existingExe) : '';

  const releaseNotes =
    process.env.LUMEN_RELEASE_NOTES ||
    `Lumen v${pkg.version} — Storage leak fix, automatic cache cap, Auto-OTA progress bar, Guess the Song, Studio Clarity audio, and widget/notification artwork fixes.`;

  const manifest = {
    appVersion: pkg.version,
    webBundleVersion,
    minNativeVersionCode: androidVer.versionCode,
    webBundleUrl: `${GH_RAW_OTA_LIVE}/lumen-web-bundle.zip`,
    webBundleFallbackUrl: 'https://lumen-player.onrender.com/api/ota/web-bundle.zip',
    webBundleSha256,
    androidNative: {
      versionCode: androidVer.versionCode,
      versionName: androidVer.versionName,
      apkUrl: `${GH_RAW_OTA_LIVE}/Lumen.apk`,
      apkFallbackUrl: 'https://lumen-player.onrender.com/download/apk',
      apkSha256,
      releaseNotes
    },
    windows: {
      version: pkg.version,
      installerUrl: `${GH_LATEST_DOWNLOAD}/Lumen-Setup.exe`,
      installerFallbackUrl: 'https://lumen-player.onrender.com/download/windows',
      installerSha256: exeSha256,
      releaseNotes
    },
    releaseNotes,
    publishedAt: now.toISOString()
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(lumenDir, 'ota-manifest.json'), manifestJson, 'utf8');
  fs.writeFileSync(path.join(outDir, 'ota-manifest.json'), manifestJson, 'utf8');

  // Generate electron-updater latest.yml when Lumen-Setup.exe exists
  if (existingExe) {
    const exeStat = fs.statSync(existingExe);
    const exeSha512 = sha512Base64File(existingExe);
    const latestYml = [
      `version: ${pkg.version}`,
      'files:',
      '  - url: Lumen-Setup.exe',
      `    sha512: ${exeSha512}`,
      `    size: ${exeStat.size}`,
      'path: Lumen-Setup.exe',
      `sha512: ${exeSha512}`,
      `releaseDate: '${now.toISOString()}'`,
      ''
    ].join('\n');
    fs.writeFileSync(path.join(outDir, 'latest.yml'), latestYml, 'utf8');
  }

  console.log('[OTA Packager] Ready for GitHub Release upload:');
  console.log(`  • Web Bundle: ${bundleZipPath} (sha256: ${webBundleSha256.slice(0, 16)}...)`);
  console.log(`  • Manifest:   ${path.join(lumenDir, 'ota-manifest.json')} (webBundleVersion: ${webBundleVersion})`);
  console.log(`  • Android:    versionCode=${androidVer.versionCode}, versionName=${androidVer.versionName}${apkSha256 ? `, apkSha256=${apkSha256.slice(0, 16)}...` : ''}`);
  if (existingExe) {
    console.log(`  • Windows:    v${pkg.version} + latest.yml generated (sha256: ${exeSha256.slice(0, 16)}...)`);
  }
}

main();
