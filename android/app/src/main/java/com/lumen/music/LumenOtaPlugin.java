package com.lumen.music;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.annotation.Nullable;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Self-hosted 2-layer Android OTA updater for Lumen:
 * 1. Instant Web/UI OTA: downloads verified dist.zip, extracts safely, switches Capacitor
 *    Bridge serverBasePath, and automatically rolls back if the new bundle fails to confirm ready.
 * 2. One-Tap Native APK Updater: downloads verified .apk to app-private filesDir and launches
 *    Android's native package installer via FileProvider + REQUEST_INSTALL_PACKAGES.
 */
@CapacitorPlugin(name = "LumenOta")
public class LumenOtaPlugin extends Plugin {
    public static final String PREFS_NAME = "lumen_ota_prefs_v1";
    public static final String KEY_ACTIVE_VERSION = "active_bundle_version";
    public static final String KEY_ACTIVE_PATH = "active_bundle_path";
    public static final String KEY_ACTIVE_NATIVE_CODE = "active_bundle_native_code";
    public static final String KEY_PREV_VERSION = "prev_bundle_version";
    public static final String KEY_PREV_PATH = "prev_bundle_path";
    public static final String KEY_PENDING_VERSION = "pending_bundle_version";
    public static final String KEY_PENDING_PATH = "pending_bundle_path";
    public static final String KEY_PENDING_ATTEMPTS = "pending_boot_attempts";
    public static final String KEY_LAST_ROLLBACK = "last_rollback_reason";

    private static final int MAX_PENDING_BOOT_ATTEMPTS = 2;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean isBusy = false;

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    public static long getCurrentNativeVersionCode(Context ctx) {
        try {
            PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return pInfo.getLongVersionCode();
            }
            return pInfo.versionCode;
        } catch (Exception ignored) {
            return 1L;
        }
    }

    public static String getCurrentNativeVersionName(Context ctx) {
        try {
            PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return pInfo.versionName != null ? pInfo.versionName : "1.0.0";
        } catch (Exception ignored) {
            return "1.0.0";
        }
    }

    /**
     * Called from MainActivity.onCreate() after super.onCreate(savedInstanceState).
     * Resolves the safest OTA bundle directory (with automatic rollback on repeated boot failure
     * and automatic invalidation when a newer native APK versionCode is installed).
     */
    @Nullable
    public static String resolveStartupBundlePath(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long currentNativeCode = getCurrentNativeVersionCode(ctx);
        long savedNativeCode = prefs.getLong(KEY_ACTIVE_NATIVE_CODE, -1L);

        // If a newer native APK was installed, clear older OTA web bundles so built-in fresh assets load!
        if (savedNativeCode != -1L && savedNativeCode != currentNativeCode) {
            prefs.edit()
                .remove(KEY_ACTIVE_VERSION)
                .remove(KEY_ACTIVE_PATH)
                .remove(KEY_PREV_VERSION)
                .remove(KEY_PREV_PATH)
                .remove(KEY_PENDING_VERSION)
                .remove(KEY_PENDING_PATH)
                .putInt(KEY_PENDING_ATTEMPTS, 0)
                .putLong(KEY_ACTIVE_NATIVE_CODE, currentNativeCode)
                .apply();
            return null;
        }

        String pendingPath = prefs.getString(KEY_PENDING_PATH, null);
        String pendingVersion = prefs.getString(KEY_PENDING_VERSION, null);
        if (pendingPath != null && pendingVersion != null) {
            int attempts = prefs.getInt(KEY_PENDING_ATTEMPTS, 0);
            File pendingDir = new File(pendingPath);
            if (attempts >= MAX_PENDING_BOOT_ATTEMPTS || !isValidBundleDir(pendingDir)) {
                // Automatic rollback!
                String prevPath = prefs.getString(KEY_PREV_PATH, null);
                String prevVersion = prefs.getString(KEY_PREV_VERSION, null);
                SharedPreferences.Editor ed = prefs.edit()
                    .remove(KEY_PENDING_VERSION)
                    .remove(KEY_PENDING_PATH)
                    .putInt(KEY_PENDING_ATTEMPTS, 0)
                    .putString(KEY_LAST_ROLLBACK, "Rolled back web bundle " + pendingVersion + " after failed boot.");
                if (prevPath != null && isValidBundleDir(new File(prevPath))) {
                    ed.putString(KEY_ACTIVE_PATH, prevPath);
                    ed.putString(KEY_ACTIVE_VERSION, prevVersion);
                    ed.apply();
                    return prevPath;
                } else {
                    ed.remove(KEY_ACTIVE_PATH).remove(KEY_ACTIVE_VERSION).apply();
                    return null;
                }
            } else {
                prefs.edit().putInt(KEY_PENDING_ATTEMPTS, attempts + 1).apply();
                return pendingPath;
            }
        }

        String activePath = prefs.getString(KEY_ACTIVE_PATH, null);
        if (activePath != null && isValidBundleDir(new File(activePath))) {
            return activePath;
        }
        return null;
    }

    private static boolean isValidBundleDir(File dir) {
        return dir != null && dir.exists() && dir.isDirectory() && new File(dir, "index.html").exists();
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String activeVersion = prefs.getString(KEY_ACTIVE_VERSION, null);
        String pendingVersion = prefs.getString(KEY_PENDING_VERSION, null);
        String lastRollback = prefs.getString(KEY_LAST_ROLLBACK, null);

        JSObject ret = new JSObject();
        ret.put("platform", "android");
        ret.put("nativeVersionCode", getCurrentNativeVersionCode(getContext()));
        ret.put("nativeVersionName", getCurrentNativeVersionName(getContext()));
        ret.put("activeWebBundleVersion", pendingVersion != null ? pendingVersion : (activeVersion != null ? activeVersion : "builtin"));
        ret.put("hasCustomWebBundle", activeVersion != null || pendingVersion != null);
        if (lastRollback != null) {
            ret.put("lastRollbackReason", lastRollback);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void notifyAppReady(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String pendingVersion = prefs.getString(KEY_PENDING_VERSION, null);
        String pendingPath = prefs.getString(KEY_PENDING_PATH, null);

        if (pendingVersion != null && pendingPath != null && isValidBundleDir(new File(pendingPath))) {
            String prevActivePath = prefs.getString(KEY_ACTIVE_PATH, null);
            String prevActiveVer = prefs.getString(KEY_ACTIVE_VERSION, null);

            SharedPreferences.Editor ed = prefs.edit();
            if (prevActivePath != null && !prevActivePath.equals(pendingPath)) {
                ed.putString(KEY_PREV_PATH, prevActivePath);
                if (prevActiveVer != null) ed.putString(KEY_PREV_VERSION, prevActiveVer);
            }
            ed.putString(KEY_ACTIVE_VERSION, pendingVersion);
            ed.putString(KEY_ACTIVE_PATH, pendingPath);
            ed.putLong(KEY_ACTIVE_NATIVE_CODE, getCurrentNativeVersionCode(getContext()));
            ed.remove(KEY_PENDING_VERSION);
            ed.remove(KEY_PENDING_PATH);
            ed.putInt(KEY_PENDING_ATTEMPTS, 0);
            ed.remove(KEY_LAST_ROLLBACK);
            ed.apply();

            pruneOldBundles(pendingPath, prevActivePath);
        }

        JSObject ret = new JSObject();
        ret.put("confirmed", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadAndStageWebBundle(PluginCall call) {
        final String bundleUrl = call.getString("url");
        final String version = call.getString("version");
        final String expectedSha256 = call.getString("sha256", "");
        final boolean applyImmediately = Boolean.TRUE.equals(call.getBoolean("applyImmediately", false));

        if (bundleUrl == null || bundleUrl.trim().isEmpty() || version == null || version.trim().isEmpty()) {
            call.reject("Missing bundle url or version");
            return;
        }
        if (isBusy) {
            call.reject("An update download is already in progress");
            return;
        }

        isBusy = true;
        executor.execute(() -> {
            String safeVer = version.replaceAll("[^a-zA-Z0-9._-]", "_");
            File otaRoot = new File(getContext().getFilesDir(), "ota");
            File stagingDir = new File(otaRoot, "staging");
            File bundlesDir = new File(otaRoot, "bundles");
            stagingDir.mkdirs();
            bundlesDir.mkdirs();

            File zipFile = new File(stagingDir, safeVer + ".zip");
            File extractDir = new File(bundlesDir, safeVer);

            try {
                emitProgress("web", "downloading", 2, "Downloading Lumen web update...");
                downloadFileWithProgress(bundleUrl, zipFile, "web", 2, 78);

                if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                    emitProgress("web", "verifying", 82, "Verifying update integrity...");
                    String actualHash = computeSha256(zipFile);
                    if (!actualHash.equalsIgnoreCase(expectedSha256.trim())) {
                        throw new SecurityException("SHA-256 mismatch for web bundle");
                    }
                }

                emitProgress("web", "extracting", 88, "Installing update...");
                deleteRecursively(extractDir);
                extractDir.mkdirs();
                unzipSafely(zipFile, extractDir);
                if (zipFile.exists()) zipFile.delete();

                // Support both root index.html and nested dist/index.html inside zip
                File bundleBaseDir = extractDir;
                if (!new File(bundleBaseDir, "index.html").exists()) {
                    File nestedDist = new File(extractDir, "dist");
                    if (new File(nestedDist, "index.html").exists()) {
                        bundleBaseDir = nestedDist;
                    } else {
                        throw new IllegalStateException("Downloaded bundle does not contain index.html");
                    }
                }

                SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit()
                    .putString(KEY_PENDING_VERSION, version)
                    .putString(KEY_PENDING_PATH, bundleBaseDir.getAbsolutePath())
                    .putLong(KEY_ACTIVE_NATIVE_CODE, getCurrentNativeVersionCode(getContext()))
                    .putInt(KEY_PENDING_ATTEMPTS, 0)
                    .apply();

                emitProgress("web", "ready", 100, "Update ready to apply.");

                final String finalPath = bundleBaseDir.getAbsolutePath();
                if (applyImmediately) {
                    applyBundleNowInternal(finalPath);
                }

                JSObject ret = new JSObject();
                ret.put("staged", true);
                ret.put("version", version);
                ret.put("applied", applyImmediately);
                call.resolve(ret);
            } catch (Exception e) {
                if (zipFile.exists()) zipFile.delete();
                deleteRecursively(extractDir);
                emitProgress("web", "error", 0, e.getMessage());
                call.reject("Web OTA failed: " + e.getMessage());
            } finally {
                isBusy = false;
            }
        });
    }

    @PluginMethod
    public void applyPendingWebBundle(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String pendingPath = prefs.getString(KEY_PENDING_PATH, null);
        if (pendingPath == null || !isValidBundleDir(new File(pendingPath))) {
            call.reject("No valid pending web bundle staged");
            return;
        }
        applyBundleNowInternal(pendingPath);
        JSObject ret = new JSObject();
        ret.put("applied", true);
        call.resolve(ret);
    }

    private void applyBundleNowInternal(final String bundlePath) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            try {
                Bridge bridge = getBridge();
                if (bridge != null) {
                    bridge.setServerBasePath(bundlePath);
                }
            } catch (Exception ignored) {}
        });
    }

    @PluginMethod
    public void resetToBuiltinBundle(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .remove(KEY_ACTIVE_VERSION)
            .remove(KEY_ACTIVE_PATH)
            .remove(KEY_PREV_VERSION)
            .remove(KEY_PREV_PATH)
            .remove(KEY_PENDING_VERSION)
            .remove(KEY_PENDING_PATH)
            .putInt(KEY_PENDING_ATTEMPTS, 0)
            .apply();
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    Bridge bridge = getBridge();
                    if (bridge != null) {
                        bridge.setServerAssetPath("public");
                    }
                } catch (Exception ignored) {}
            });
        }
        JSObject ret = new JSObject();
        ret.put("reset", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("canInstall", canInstall);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("opened", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        final String apkUrl = call.getString("url");
        final String expectedSha256 = call.getString("sha256", "");
        if (apkUrl == null || apkUrl.trim().isEmpty()) {
            call.reject("Missing APK url");
            return;
        }
        if (isBusy) {
            call.reject("An update download is already in progress");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject ret = new JSObject();
            ret.put("needsInstallPermission", true);
            ret.put("launchedInstaller", false);
            call.resolve(ret);
            return;
        }

        isBusy = true;
        executor.execute(() -> {
            File apkDir = new File(getContext().getFilesDir(), "ota/apks");
            apkDir.mkdirs();
            File apkFile = new File(apkDir, "lumen-update.apk");
            try {
                if (apkFile.exists()) apkFile.delete();
                emitProgress("apk", "downloading", 2, "Downloading Lumen Android update...");
                downloadFileWithProgress(apkUrl, apkFile, "apk", 2, 92);

                if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                    emitProgress("apk", "verifying", 95, "Verifying APK integrity...");
                    String actualHash = computeSha256(apkFile);
                    if (!actualHash.equalsIgnoreCase(expectedSha256.trim())) {
                        throw new SecurityException("APK SHA-256 verification failed");
                    }
                }

                emitProgress("apk", "installing", 100, "Opening Android installer...");
                Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apkFile
                );

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getContext().startActivity(installIntent);

                JSObject ret = new JSObject();
                ret.put("needsInstallPermission", false);
                ret.put("launchedInstaller", true);
                call.resolve(ret);
            } catch (Exception e) {
                if (apkFile.exists()) apkFile.delete();
                emitProgress("apk", "error", 0, e.getMessage());
                call.reject("APK update failed: " + e.getMessage());
            } finally {
                isBusy = false;
            }
        });
    }

    private void downloadFileWithProgress(
        String urlStr,
        File destFile,
        String kind,
        int startPct,
        int endPct
    ) throws Exception {
        String currentUrl = urlStr;
        HttpURLConnection conn = null;
        int redirects = 0;
        while (redirects < 6) {
            URL url = new URL(currentUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "Lumen-Android-OTA");
            conn.connect();
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) break;
                currentUrl = loc;
                redirects++;
                continue;
            }
            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new IllegalStateException("Download HTTP " + code);
            }
            break;
        }

        if (conn == null) throw new IllegalStateException("Could not open connection");

        long total = conn.getContentLengthLong();
        long downloaded = 0L;
        int lastPct = startPct;

        try (InputStream in = new BufferedInputStream(conn.getInputStream());
             FileOutputStream out = new FileOutputStream(destFile)) {
            byte[] buf = new byte[16384];
            int read;
            while ((read = in.read(buf)) != -1) {
                out.write(buf, 0, read);
                downloaded += read;
                if (total > 0) {
                    int pct = startPct + (int) (((endPct - startPct) * downloaded) / total);
                    if (pct >= lastPct + 3) {
                        lastPct = pct;
                        emitProgress(kind, "downloading", Math.min(endPct, pct), "Downloading update...");
                    }
                }
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String computeSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buf = new byte[16384];
            int read;
            while ((read = in.read(buf)) != -1) {
                digest.update(buf, 0, read);
            }
        }
        byte[] bytes = digest.digest();
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }

    private static void unzipSafely(File zipFile, File targetDir) throws Exception {
        String canonicalRoot = targetDir.getCanonicalPath() + File.separator;
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buf = new byte[16384];
            while ((entry = zis.getNextEntry()) != null) {
                File outFile = new File(targetDir, entry.getName());
                if (!outFile.getCanonicalPath().startsWith(canonicalRoot)) {
                    throw new SecurityException("Blocked zip path traversal: " + entry.getName());
                }
                if (entry.isDirectory()) {
                    outFile.mkdirs();
                } else {
                    File parent = outFile.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        int len;
                        while ((len = zis.read(buf)) > 0) {
                            fos.write(buf, 0, len);
                        }
                    }
                }
                zis.closeEntry();
            }
        }
    }

    private void pruneOldBundles(@Nullable String keepA, @Nullable String keepB) {
        try {
            File bundlesDir = new File(getContext().getFilesDir(), "ota/bundles");
            File[] children = bundlesDir.listFiles();
            if (children == null) return;
            for (File child : children) {
                String p = child.getAbsolutePath();
                boolean keep = (keepA != null && (keepA.equals(p) || keepA.startsWith(p + File.separator)))
                    || (keepB != null && (keepB.equals(p) || keepB.startsWith(p + File.separator)));
                if (!keep) {
                    deleteRecursively(child);
                }
            }
        } catch (Exception ignored) {}
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursively(c);
            }
        }
        file.delete();
    }

    private void emitProgress(String kind, String stage, int percent, @Nullable String message) {
        JSObject payload = new JSObject();
        payload.put("kind", kind);
        payload.put("stage", stage);
        payload.put("percent", percent);
        if (message != null) payload.put("message", message);
        notifyListeners("onOtaProgress", payload);
    }
}
