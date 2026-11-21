package com.lumen.music;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.IBinder;
import android.app.PictureInPictureParams;
import android.net.Uri;
import android.util.Rational;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "LumenAudio")
public class LumenAudioPlugin extends Plugin {
    private static LumenAudioPlugin instance;
    private LumenPlaybackService playbackService;
    private boolean isBound = false;
    private Runnable pendingPlayRunnable = null;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            LumenPlaybackService.LocalBinder binder = (LumenPlaybackService.LocalBinder) service;
            playbackService = binder.getService();
            isBound = true;
            if (pendingPlayRunnable != null) {
                pendingPlayRunnable.run();
                pendingPlayRunnable = null;
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            playbackService = null;
            isBound = false;
        }
    };

    public static LumenAudioPlugin getInstance() {
        return instance;
    }

    @Override
    public void load() {
        super.load();
        instance = this;
        Context context = getContext();
        try {
            Intent intent = new Intent(context, LumenPlaybackService.class);
            context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void play(PluginCall call) {
        String trackId = call.getString("trackId", "");
        String url = call.getString("url");
        String title = call.getString("title", "Unknown Title");
        String artist = call.getString("artist", "Unknown Artist");
        String album = call.getString("album", "Lumen Hi-Fi");
        String artworkUrl = call.getString("artworkUrl", "");
        long durationMs = call.getLong("duration", 0L);
        long positionMs = call.getLong("position", 0L);

        if (url == null || url.isEmpty()) {
            call.reject("Audio URL is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            Context ctx = getContext();
            try {
                Intent intent = new Intent(ctx, LumenPlaybackService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent);
                } else {
                    ctx.startService(intent);
                }
            } catch (Exception ignored) {}

            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.playTrack(trackId, url, title, artist, album, artworkUrl, durationMs, positionMs);
                call.resolve();
            } else {
                // Service may still be binding, queue execution safely
                pendingPlayRunnable = () -> {
                    LumenPlaybackService s = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
                    if (s != null) {
                        s.playTrack(trackId, url, title, artist, album, artworkUrl, durationMs, positionMs);
                    }
                };
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray itemsArray = call.getArray("items");
        int startIndex = call.getInt("startIndex", 0);
        long startPositionMs = call.getLong("position", 0L);

        if (itemsArray == null || itemsArray.length() == 0) {
            call.resolve();
            return;
        }

        List<MediaItem> mediaItems = new ArrayList<>();
        try {
            for (int i = 0; i < itemsArray.length(); i++) {
                JSONObject obj = itemsArray.getJSONObject(i);
                String trackId = obj.optString("trackId", "");
                String url = obj.optString("url", "");
                String title = obj.optString("title", "Unknown Title");
                String artist = obj.optString("artist", "Unknown Artist");
                String album = obj.optString("album", "Lumen Hi-Fi");
                String artworkUrl = obj.optString("artworkUrl", "");

                if (url.isEmpty()) continue;

                MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                        .setTitle(title)
                        .setArtist(artist)
                        .setAlbumTitle(album);

                if (!artworkUrl.isEmpty()) {
                    try {
                        metaBuilder.setArtworkUri(Uri.parse(artworkUrl));
                    } catch (Exception ignored) {}
                }

                Uri itemUri;
                if (url.startsWith("lumen-offline://")) {
                    java.io.File vf = LumenOfflineDownloadManager.getInstance(getContext()).getVaultFileForAsset(url);
                    if (vf == null || !vf.exists()) continue;
                    itemUri = Uri.fromFile(vf);
                } else {
                    itemUri = Uri.parse(url);
                }

                MediaItem item = new MediaItem.Builder()
                        .setUri(itemUri)
                        .setMediaId(trackId.isEmpty() ? url : trackId)
                        .setMediaMetadata(metaBuilder.build())
                        .build();

                mediaItems.add(item);
            }
        } catch (Exception e) {
            call.reject("Failed to parse queue items: " + e.getMessage());
            return;
        }

        boolean autoPlay = call.getBoolean("autoPlay", false);
        getActivity().runOnUiThread(() -> {
            if (autoPlay) {
                Context ctx = getContext();
                try {
                    Intent intent = new Intent(ctx, LumenPlaybackService.class);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        ctx.startForegroundService(intent);
                    } else {
                        ctx.startService(intent);
                    }
                } catch (Exception ignored) {}
            }
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null && !mediaItems.isEmpty()) {
                service.setNativeQueue(mediaItems, startIndex, startPositionMs, autoPlay);
                call.resolve();
            } else {
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.pause();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.resume();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Long positionMs = call.getLong("position");
        if (positionMs == null) {
            call.reject("Position in ms is required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.seekTo(positionMs);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double volume = call.getDouble("volume", 1.0);
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.setVolume(volume.floatValue());
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
        JSObject ret = new JSObject();
        if (service != null) {
            ret.put("isPlaying", service.isPlaying());
            ret.put("positionMs", service.getCurrentPosition());
            ret.put("durationMs", service.getDuration());
        } else {
            LumenPlaybackState s = LumenPlaybackState.get();
            ret.put("isPlaying", s.isPlaying);
            ret.put("positionMs", s.positionMs);
            ret.put("durationMs", s.durationMs);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        String modeStr = call.getString("mode", "off");
        int mode = 0;
        if ("all".equalsIgnoreCase(modeStr)) mode = 1;
        else if ("one".equalsIgnoreCase(modeStr)) mode = 2;
        int finalMode = mode;
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.setRepeatMode(finalMode);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        try {
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                android.os.PowerManager pm = (android.os.PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                boolean isIgnoring = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
                JSObject ret = new JSObject();
                ret.put("isIgnoring", isIgnoring);
                call.resolve(ret);
                return;
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("isIgnoring", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        try {
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                android.os.PowerManager pm = (android.os.PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) {
                    Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("requested", true);
                    call.resolve(ret);
                    return;
                }
            }
        } catch (Exception e) {
            try {
                Context ctx = getContext();
                Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("requested", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void enterPip(PluginCall call) {
        // Disabled by user design
        JSObject res = new JSObject();
        res.put("success", false);
        call.resolve(res);
    }

    // =========================================================================
    // OFFLINE DOWNLOAD & PERSISTENT PRIVATE VAULT BRIDGE METHODS
    // =========================================================================

    @PluginMethod
    public void downloadTrack(PluginCall call) {
        String canonicalTrackId = call.getString("canonicalTrackId");
        String audioAssetId = call.getString("audioAssetId");
        String url = call.getString("url");
        if (canonicalTrackId == null || audioAssetId == null || url == null || url.isEmpty()) {
            call.reject("canonicalTrackId, audioAssetId, and authorized url are required");
            return;
        }

        OfflineMediaDbHelper.Record rec = new OfflineMediaDbHelper.Record();
        rec.canonicalTrackId = canonicalTrackId;
        rec.audioAssetId = audioAssetId;
        rec.authorizedDownloadUrl = url;
        rec.title = call.getString("title", "Unknown Track");
        rec.artist = call.getString("artist", "Unknown Artist");
        rec.album = call.getString("album", "Single");
        rec.albumArtworkReference = call.getString("artworkUrl", null);
        rec.duration = call.getLong("duration", 0L);
        rec.sourceType = call.getString("sourceType", "open_license_audio");
        rec.licenseReference = call.getString("licenseReference", null);
        rec.quality = call.getString("quality", "source_original");
        rec.storageReference = "lumen-offline://" + audioAssetId;
        JSArray refsArr = call.getArray("collectionRefs");
        rec.collectionRefsJson = refsArr != null ? refsArr.toString() : "[\"standalone\"]";

        LumenOfflineDownloadManager mgr = LumenOfflineDownloadManager.getInstance(getContext());
        mgr.enqueueDownload(rec);

        JSObject res = new JSObject();
        res.put("started", true);
        res.put("state", rec.downloadState);
        call.resolve(res);
    }

    @PluginMethod
    public void pauseDownload(PluginCall call) {
        String canonicalTrackId = call.getString("canonicalTrackId");
        if (canonicalTrackId != null) {
            LumenOfflineDownloadManager.getInstance(getContext()).pauseDownload(canonicalTrackId);
        }
        call.resolve();
    }

    @PluginMethod
    public void resumeDownload(PluginCall call) {
        String canonicalTrackId = call.getString("canonicalTrackId");
        if (canonicalTrackId != null) {
            LumenOfflineDownloadManager.getInstance(getContext()).resumeDownload(canonicalTrackId);
        }
        call.resolve();
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String canonicalTrackId = call.getString("canonicalTrackId");
        if (canonicalTrackId != null) {
            LumenOfflineDownloadManager.getInstance(getContext()).cancelDownload(canonicalTrackId);
        }
        call.resolve();
    }

    @PluginMethod
    public void removeDownload(PluginCall call) {
        String canonicalTrackId = call.getString("canonicalTrackId");
        String audioAssetId = call.getString("audioAssetId");
        if (canonicalTrackId != null) {
            LumenOfflineDownloadManager.getInstance(getContext()).removeDownload(canonicalTrackId, audioAssetId);
        }
        call.resolve();
    }

    @PluginMethod
    public void removeAllDownloads(PluginCall call) {
        LumenOfflineDownloadManager.getInstance(getContext()).removeAllDownloads();
        call.resolve();
    }

    @PluginMethod
    public void getDownloads(PluginCall call) {
        List<OfflineMediaDbHelper.Record> list = LumenOfflineDownloadManager.getInstance(getContext()).getAllRecords();
        JSArray arr = new JSArray();
        for (OfflineMediaDbHelper.Record r : list) {
            arr.put(r.toJSObject());
        }
        JSObject res = new JSObject();
        res.put("records", arr);
        call.resolve(res);
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        String canonicalTrackId = call.getString("canonicalTrackId");
        OfflineMediaDbHelper.Record r = canonicalTrackId != null
            ? LumenOfflineDownloadManager.getInstance(getContext()).getRecord(canonicalTrackId)
            : null;
        JSObject res = new JSObject();
        res.put("record", r != null ? r.toJSObject() : null);
        call.resolve(res);
    }

    @PluginMethod
    public void getOfflinePlaybackUri(PluginCall call) {
        String canonicalTrackId = call.getString("canonicalTrackId");
        String audioAssetId = call.getString("audioAssetId");
        LumenOfflineDownloadManager mgr = LumenOfflineDownloadManager.getInstance(getContext());
        if ((audioAssetId == null || audioAssetId.isEmpty()) && canonicalTrackId != null) {
            OfflineMediaDbHelper.Record rec = mgr.getRecord(canonicalTrackId);
            if (rec != null) audioAssetId = rec.audioAssetId;
        }
        java.io.File f = mgr.getVaultFileForAsset(audioAssetId);
        boolean exists = f != null && f.exists() && f.length() > 1024;
        JSObject res = new JSObject();
        res.put("exists", exists);
        if (exists) {
            // Return opaque token only — never expose raw private Android filesystem path to frontend JS
            res.put("playableToken", "lumen-offline://" + audioAssetId);
        }
        call.resolve(res);
    }

    @PluginMethod
    public void getStorageUsage(PluginCall call) {
        LumenOfflineDownloadManager mgr = LumenOfflineDownloadManager.getInstance(getContext());
        List<OfflineMediaDbHelper.Record> all = mgr.getAllRecords();
        int completed = 0;
        for (OfflineMediaDbHelper.Record r : all) {
            if ("COMPLETED".equals(r.downloadState) && !r.needsRepair) completed++;
        }
        JSObject res = new JSObject();
        res.put("usedBytes", mgr.getUsedVaultBytes());
        res.put("deviceAvailableBytes", mgr.getDeviceAvailableBytes());
        res.put("completedCount", completed);
        call.resolve(res);
    }

    @PluginMethod
    public void verifyOfflineLibrary(PluginCall call) {
        boolean fullChecksum = Boolean.TRUE.equals(call.getBoolean("fullChecksum", false));
        JSObject res = LumenOfflineDownloadManager.getInstance(getContext()).verifyOfflineLibrary(fullChecksum);
        call.resolve(res);
    }

    @PluginMethod
    public void setOfflineMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        LumenOfflineDownloadManager.getInstance(getContext()).setOfflineMode(enabled);
        call.resolve();
    }

    @PluginMethod
    public void updateOfflineSettings(PluginCall call) {
        String policy = call.getString("networkPolicy", "wifi_only");
        boolean allowMetered = Boolean.TRUE.equals(call.getBoolean("allowMeteredConnections", false));
        int maxStorageMB = call.getInt("maxStorageMB", 2048);
        boolean offlineMode = Boolean.TRUE.equals(call.getBoolean("offlineModeEnabled", false));
        LumenOfflineDownloadManager.getInstance(getContext()).updateSettings(policy, allowMetered, maxStorageMB, offlineMode);
        call.resolve();
    }

    public void emitDownloadStateChange(JSObject payload) {
        notifyListeners("onDownloadStateChange", payload);
    }

    public void notifyStateChange(boolean isPlaying, long positionMs, long durationMs) {
        JSObject data = new JSObject();
        data.put("isPlaying", isPlaying);
        data.put("positionMs", positionMs);
        data.put("durationMs", durationMs);
        notifyListeners("onPlaybackStateChange", data);
    }

    public void notifyTrackEnded() {
        notifyListeners("onTrackEnded", new JSObject());
    }

    public void notifyMediaItemTransition(String trackId, String title, String artist, String album, String artworkUrl) {
        JSObject data = new JSObject();
        data.put("trackId", trackId);
        data.put("title", title);
        data.put("artist", artist);
        data.put("album", album);
        data.put("artworkUrl", artworkUrl);
        notifyListeners("onTrackTransition", data);
    }

    public void notifyNextTrack() {
        notifyListeners("onNextTrack", new JSObject());
    }

    public void notifyPrevTrack() {
        notifyListeners("onPrevTrack", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        if (isBound) {
            getContext().unbindService(serviceConnection);
            isBound = false;
        }
        instance = null;
        super.handleOnDestroy();
    }
}
