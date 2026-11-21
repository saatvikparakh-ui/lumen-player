package com.lumen.music;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.StatFs;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LUMEN NATIVE PRIVATE VAULT & RESUMABLE DOWNLOAD ENGINE (ANDROID)
 *
 * - Private storage: Context.getFilesDir()/lumen_offline_vault/ with .nomedia sentinel
 *   (Never writes to public Downloads, never registers with MediaStore, requires zero storage permissions)
 * - Resumable HTTP Range downloads (.part -> atomic rename to .lum after SHA-256 verification)
 * - Enforces Wi-Fi-only / metered network constraints & user storage budget without ever auto-deleting
 * - Emits throttled progress updates to Capacitor LumenAudio plugin
 */
public class LumenOfflineDownloadManager {
    private static final String VAULT_DIR_NAME = "lumen_offline_vault";
    private static final String PREFS_NAME = "lumen_offline_prefs";
    private static LumenOfflineDownloadManager instance;

    private final Context appContext;
    private final OfflineMediaDbHelper db;
    private final File vaultDir;
    private final ExecutorService downloadExecutor = Executors.newFixedThreadPool(2);
    private final Map<String, AtomicBoolean> pauseFlags = new ConcurrentHashMap<>();
    private final Map<String, AtomicBoolean> cancelFlags = new ConcurrentHashMap<>();
    private final Map<String, Boolean> activeJobs = new ConcurrentHashMap<>();

    public static synchronized LumenOfflineDownloadManager getInstance(Context context) {
        if (instance == null) {
            instance = new LumenOfflineDownloadManager(context.getApplicationContext());
        }
        return instance;
    }

    private LumenOfflineDownloadManager(Context context) {
        this.appContext = context.getApplicationContext();
        this.db = OfflineMediaDbHelper.getInstance(appContext);
        this.vaultDir = new File(appContext.getFilesDir(), VAULT_DIR_NAME);
        ensurePrivateVaultDirectory();
        recoverInterruptedJobs();
    }

    private void ensurePrivateVaultDirectory() {
        try {
            if (!vaultDir.exists()) {
                vaultDir.mkdirs();
            }
            // Prevent Android MediaScanner from ever indexing private vault files
            File noMedia = new File(vaultDir, ".nomedia");
            if (!noMedia.exists()) {
                noMedia.createNewFile();
            }
        } catch (Exception ignored) {}
    }

    /**
     * Resolves an internal opaque asset token ("lumen-offline://<assetId>" or raw assetId)
     * to a verified private File inside Context.filesDir/lumen_offline_vault/.
     */
    public File getVaultFileForAsset(String audioAssetId) {
        if (audioAssetId == null || audioAssetId.isEmpty()) return null;
        String clean = audioAssetId.replace("lumen-offline://", "").replaceAll("[^a-zA-Z0-9_\\-]", "");
        if (clean.isEmpty()) return null;
        return new File(vaultDir, clean + ".lum");
    }

    private File getPartialFileForAsset(String audioAssetId) {
        String clean = audioAssetId.replace("lumen-offline://", "").replaceAll("[^a-zA-Z0-9_\\-]", "");
        return new File(vaultDir, clean + ".part");
    }

    private void recoverInterruptedJobs() {
        try {
            List<OfflineMediaDbHelper.Record> all = db.getAll();
            for (OfflineMediaDbHelper.Record r : all) {
                if ("DOWNLOADING".equals(r.downloadState) || "VERIFYING".equals(r.downloadState)) {
                    r.downloadState = "PAUSED";
                    r.downloadError = "Download interrupted by app restart. Tap Resume to continue.";
                    db.upsert(r);
                }
            }
        } catch (Exception ignored) {}
    }

    public void updateSettings(String networkPolicy, boolean allowMetered, int maxStorageMB, boolean offlineModeEnabled) {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString("networkPolicy", networkPolicy != null ? networkPolicy : "wifi_only")
            .putBoolean("allowMetered", allowMetered)
            .putInt("maxStorageMB", Math.max(100, maxStorageMB))
            .putBoolean("offlineModeEnabled", offlineModeEnabled)
            .apply();
    }

    public void setOfflineMode(boolean enabled) {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean("offlineModeEnabled", enabled).apply();
    }

    private boolean isNetworkAllowed() {
        ConnectivityManager cm = (ConnectivityManager) appContext.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String policy = prefs.getString("networkPolicy", "wifi_only");
        boolean allowMetered = prefs.getBoolean("allowMetered", false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network active = cm.getActiveNetwork();
            if (active == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false;

            boolean isWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
            if ("wifi_only".equals(policy) && !isWifi) {
                return false;
            }
            if (!allowMetered && cm.isActiveNetworkMetered() && !isWifi) {
                return false;
            }
            return true;
        }
        return true;
    }

    public long getUsedVaultBytes() {
        long total = 0;
        File[] files = vaultDir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isFile() && (f.getName().endsWith(".lum") || f.getName().endsWith(".part"))) {
                    total += f.length();
                }
            }
        }
        return total;
    }

    public long getDeviceAvailableBytes() {
        try {
            StatFs stat = new StatFs(vaultDir.getAbsolutePath());
            return stat.getAvailableBytes();
        } catch (Exception e) {
            return -1;
        }
    }

    public boolean hasActiveDownloads() {
        return !activeJobs.isEmpty();
    }

    public void enqueueDownload(OfflineMediaDbHelper.Record record) {
        ensurePrivateVaultDirectory();
        if (Boolean.TRUE.equals(activeJobs.get(record.canonicalTrackId))) {
            return;
        }

        // Check user storage budget without ever deleting existing user downloads
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long budgetBytes = prefs.getInt("maxStorageMB", 2048) * 1024L * 1024L;
        if (getUsedVaultBytes() >= budgetBytes) {
            record.downloadState = "FAILED";
            record.downloadError = "Download storage budget reached. Increase limit or delete downloads.";
            db.upsert(record);
            emitState(record);
            return;
        }

        record.downloadState = isNetworkAllowed() ? "QUEUED" : "WAITING_FOR_NETWORK";
        record.downloadError = "WAITING_FOR_NETWORK".equals(record.downloadState)
            ? "Waiting for permitted network (check Wi-Fi Only setting)."
            : null;
        db.upsert(record);
        emitState(record);

        if ("WAITING_FOR_NETWORK".equals(record.downloadState)) {
            return;
        }

        startForegroundDownloadService(record.title);
        startWorker(record.canonicalTrackId);
    }

    private void startForegroundDownloadService(String trackTitle) {
        try {
            Intent intent = new Intent(appContext, LumenDownloadService.class);
            intent.putExtra("trackTitle", trackTitle);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(intent);
            } else {
                appContext.startService(intent);
            }
        } catch (Exception ignored) {}
    }

    private void startWorker(final String canonicalTrackId) {
        activeJobs.put(canonicalTrackId, true);
        pauseFlags.put(canonicalTrackId, new AtomicBoolean(false));
        cancelFlags.put(canonicalTrackId, new AtomicBoolean(false));

        downloadExecutor.execute(() -> {
            OfflineMediaDbHelper.Record rec = db.getByTrackId(canonicalTrackId);
            if (rec == null || rec.authorizedDownloadUrl == null || rec.authorizedDownloadUrl.isEmpty()) {
                activeJobs.remove(canonicalTrackId);
                return;
            }

            File partFile = getPartialFileForAsset(rec.audioAssetId);
            File finalFile = getVaultFileForAsset(rec.audioAssetId);
            HttpURLConnection conn = null;

            try {
                if (!isNetworkAllowed()) {
                    rec.downloadState = "WAITING_FOR_NETWORK";
                    rec.downloadError = "Waiting for permitted network.";
                    db.upsert(rec);
                    emitState(rec);
                    return;
                }

                rec.downloadState = "DOWNLOADING";
                rec.downloadError = null;
                db.upsert(rec);
                emitState(rec);

                long existingBytes = partFile.exists() ? partFile.length() : 0L;
                URL url = new URL(rec.authorizedDownloadUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("User-Agent", "LumenAudio/1.0 (Android)");
                if (existingBytes > 0) {
                    conn.setRequestProperty("Range", "bytes=" + existingBytes + "-");
                }

                int code = conn.getResponseCode();
                boolean resumed = (code == HttpURLConnection.HTTP_PARTIAL);
                if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
                    throw new Exception("HTTP " + code + " from authorized source");
                }

                long contentLength = conn.getContentLengthLong();
                long totalBytes = resumed && contentLength > 0 ? (existingBytes + contentLength) : Math.max(contentLength, 0L);
                if (!resumed) {
                    existingBytes = 0L;
                }

                // Check device storage & user budget before writing
                long available = getDeviceAvailableBytes();
                if (available > 0 && totalBytes > 0 && available < totalBytes + (20L * 1024L * 1024L)) {
                    throw new Exception("Insufficient free device storage.");
                }

                String contentType = conn.getContentType();
                if (contentType != null && !contentType.isEmpty()) {
                    rec.mediaFormat = contentType;
                }
                rec.totalBytes = totalBytes;

                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(partFile, resumed)) {
                    byte[] buffer = new byte[32768]; // 32 KB streaming buffer (never loads whole file in RAM)
                    long downloaded = existingBytes;
                    long lastEmitMs = 0L;
                    int read;

                    while ((read = in.read(buffer)) != -1) {
                        if (isCancelled(canonicalTrackId)) {
                            out.flush();
                            partFile.delete();
                            db.deleteByTrackId(canonicalTrackId);
                            JSObject removed = new JSObject();
                            removed.put("canonicalTrackId", canonicalTrackId);
                            removed.put("downloadState", "REMOVED");
                            emitRaw(removed);
                            return;
                        }
                        if (isPaused(canonicalTrackId)) {
                            out.flush();
                            rec.downloadState = "PAUSED";
                            rec.downloadedBytes = downloaded;
                            rec.downloadProgress = totalBytes > 0 ? (int) Math.min(99, (downloaded * 100L) / totalBytes) : rec.downloadProgress;
                            db.upsert(rec);
                            emitState(rec);
                            return;
                        }

                        out.write(buffer, 0, read);
                        downloaded += read;

                        long now = System.currentTimeMillis();
                        if (now - lastEmitMs >= 250) {
                            lastEmitMs = now;
                            rec.downloadedBytes = downloaded;
                            rec.totalBytes = totalBytes > 0 ? totalBytes : downloaded;
                            rec.downloadProgress = totalBytes > 0 ? (int) Math.min(99, (downloaded * 100L) / totalBytes) : 50;
                            db.upsert(rec);
                            emitState(rec);
                            LumenDownloadService.updateProgressNotification(appContext, rec.title, rec.downloadProgress);
                        }
                    }
                    out.flush();
                    rec.downloadedBytes = downloaded;
                }

                // Transition to VERIFYING: validate size & compute SHA-256 before atomic commit
                rec.downloadState = "VERIFYING";
                rec.downloadProgress = 99;
                db.upsert(rec);
                emitState(rec);

                if (!partFile.exists() || partFile.length() < 1024) {
                    throw new Exception("Downloaded audio payload is incomplete or empty.");
                }

                String sha256 = computeFileSha256(partFile);
                if (finalFile.exists()) {
                    finalFile.delete();
                }
                if (!partFile.renameTo(finalFile)) {
                    throw new Exception("Failed to atomically commit private vault file.");
                }

                long now = System.currentTimeMillis();
                rec.storageSize = finalFile.length();
                rec.downloadedBytes = finalFile.length();
                rec.totalBytes = finalFile.length();
                rec.storageReference = "lumen-offline://" + rec.audioAssetId;
                rec.contentChecksum = sha256;
                rec.downloadedAt = now;
                rec.lastVerifiedAt = now;
                rec.downloadProgress = 100;
                rec.downloadState = "COMPLETED";
                rec.downloadError = null;
                rec.needsRepair = false;
                db.upsert(rec);
                emitState(rec);

            } catch (Exception e) {
                if (!isPaused(canonicalTrackId) && !isCancelled(canonicalTrackId)) {
                    boolean offline = !isNetworkAllowed();
                    rec.downloadState = offline ? "WAITING_FOR_NETWORK" : "FAILED";
                    rec.downloadError = offline
                        ? "Network interrupted. Will resume when permitted network returns."
                        : (e.getMessage() != null ? e.getMessage() : "Download failed");
                    db.upsert(rec);
                    emitState(rec);
                }
            } finally {
                if (conn != null) conn.disconnect();
                activeJobs.remove(canonicalTrackId);
                pauseFlags.remove(canonicalTrackId);
                cancelFlags.remove(canonicalTrackId);
                if (!hasActiveDownloads()) {
                    LumenDownloadService.stopIfIdle(appContext);
                }
            }
        });
    }

    private boolean isPaused(String id) {
        AtomicBoolean f = pauseFlags.get(id);
        return f != null && f.get();
    }

    private boolean isCancelled(String id) {
        AtomicBoolean f = cancelFlags.get(id);
        return f != null && f.get();
    }

    public void pauseDownload(String canonicalTrackId) {
        AtomicBoolean f = pauseFlags.get(canonicalTrackId);
        if (f != null) f.set(true);
        OfflineMediaDbHelper.Record rec = db.getByTrackId(canonicalTrackId);
        if (rec != null && ("QUEUED".equals(rec.downloadState) || "DOWNLOADING".equals(rec.downloadState) || "WAITING_FOR_NETWORK".equals(rec.downloadState))) {
            rec.downloadState = "PAUSED";
            rec.downloadError = null;
            db.upsert(rec);
            emitState(rec);
        }
    }

    public void resumeDownload(String canonicalTrackId) {
        OfflineMediaDbHelper.Record rec = db.getByTrackId(canonicalTrackId);
        if (rec != null) {
            rec.needsRepair = false;
            enqueueDownload(rec);
        }
    }

    public void cancelDownload(String canonicalTrackId) {
        AtomicBoolean f = cancelFlags.get(canonicalTrackId);
        if (f != null) f.set(true);
        OfflineMediaDbHelper.Record rec = db.getByTrackId(canonicalTrackId);
        if (rec != null) {
            File part = getPartialFileForAsset(rec.audioAssetId);
            if (part.exists()) part.delete();
        }
        db.deleteByTrackId(canonicalTrackId);
    }

    public void removeDownload(String canonicalTrackId, String audioAssetId) {
        OfflineMediaDbHelper.Record rec = db.getByTrackId(canonicalTrackId);
        String asset = audioAssetId != null && !audioAssetId.isEmpty()
            ? audioAssetId
            : (rec != null ? rec.audioAssetId : null);
        if (asset != null) {
            File f = getVaultFileForAsset(asset);
            if (f != null && f.exists()) f.delete();
            File part = getPartialFileForAsset(asset);
            if (part.exists()) part.delete();
        }
        db.deleteByTrackId(canonicalTrackId);
    }

    public void removeAllDownloads() {
        for (AtomicBoolean flag : cancelFlags.values()) {
            flag.set(true);
        }
        File[] files = vaultDir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isFile() && !".nomedia".equals(f.getName())) {
                    f.delete();
                }
            }
        }
        db.deleteAll();
    }

    public JSObject verifyOfflineLibrary(boolean fullChecksum) {
        List<OfflineMediaDbHelper.Record> all = db.getAll();
        int checked = 0;
        int valid = 0;
        int missing = 0;
        int corrupted = 0;
        JSArray affected = new JSArray();
        long now = System.currentTimeMillis();

        for (OfflineMediaDbHelper.Record rec : all) {
            if (!"COMPLETED".equals(rec.downloadState)) continue;
            checked++;
            File f = getVaultFileForAsset(rec.audioAssetId);
            if (f == null || !f.exists() || f.length() < 1024) {
                missing++;
                rec.needsRepair = true;
                rec.downloadError = "Offline file missing from private storage. Tap Repair to restore.";
                db.upsert(rec);
                affected.put(rec.canonicalTrackId);
                continue;
            }
            if (fullChecksum && rec.contentChecksum != null && !rec.contentChecksum.isEmpty()) {
                try {
                    String actual = computeFileSha256(f);
                    if (!rec.contentChecksum.equals(actual)) {
                        corrupted++;
                        rec.needsRepair = true;
                        rec.downloadError = "Integrity checksum mismatch. Tap Repair to re-download.";
                        db.upsert(rec);
                        affected.put(rec.canonicalTrackId);
                        continue;
                    }
                } catch (Exception ignored) {}
            }
            valid++;
            rec.needsRepair = false;
            rec.downloadError = null;
            rec.lastVerifiedAt = now;
            db.upsert(rec);
        }

        JSObject res = new JSObject();
        res.put("checkedCount", checked);
        res.put("validCount", valid);
        res.put("missingCount", missing);
        res.put("corruptedCount", corrupted);
        res.put("affectedTrackIds", affected);
        return res;
    }

    public List<OfflineMediaDbHelper.Record> getAllRecords() {
        return db.getAll();
    }

    public OfflineMediaDbHelper.Record getRecord(String canonicalTrackId) {
        return db.getByTrackId(canonicalTrackId);
    }

    private String computeFileSha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buf = new byte[32768];
            int n;
            while ((n = fis.read(buf)) > 0) {
                md.update(buf, 0, n);
            }
        }
        byte[] digest = md.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private void emitState(OfflineMediaDbHelper.Record rec) {
        emitRaw(rec.toJSObject());
    }

    private void emitRaw(JSObject payload) {
        LumenAudioPlugin plugin = LumenAudioPlugin.getInstance();
        if (plugin != null) {
            plugin.emitDownloadStateChange(payload);
        }
    }
}
