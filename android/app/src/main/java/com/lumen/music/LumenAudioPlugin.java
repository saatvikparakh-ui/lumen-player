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

    /**
     * Capacitor's PluginCall.getLong() returns null when JSONObject parses small JS numbers
     * (like 90000ms) as Integer instead of Long. Read any JSON Number safely as long/float.
     */
    private static long getNumberLong(PluginCall call, String key, long defaultValue) {
        try {
            Object raw = call.getData().opt(key);
            if (raw instanceof Number) {
                return ((Number) raw).longValue();
            }
            if (raw instanceof String) {
                return (long) Double.parseDouble(((String) raw).trim());
            }
        } catch (Exception ignored) {}
        return defaultValue;
    }

    private static float getNumberFloat(PluginCall call, String key, float defaultValue) {
        try {
            Object raw = call.getData().opt(key);
            if (raw instanceof Number) {
                return ((Number) raw).floatValue();
            }
            if (raw instanceof String) {
                return Float.parseFloat(((String) raw).trim());
            }
        } catch (Exception ignored) {}
        return defaultValue;
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
        long durationMs = getNumberLong(call, "duration", 0L);
        long positionMs = getNumberLong(call, "position", 0L);

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
        long startPositionMs = getNumberLong(call, "position", 0L);

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

                MediaItem item = new MediaItem.Builder()
                        .setUri(Uri.parse(url))
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
        final long positionMs = getNumberLong(call, "position", -1L);
        if (positionMs < 0L) {
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
        final float volume = getNumberFloat(call, "volume", 1.0f);
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.setVolume(volume);
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
    public void setStudioClarity(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", true);
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.setStudioClarity(enabled);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void updateArtwork(PluginCall call) {
        final String artworkUrl = call.getString("artworkUrl", "");
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.updateCurrentArtwork(artworkUrl);
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

    @PluginMethod
    public void updateLibraryWidget(PluginCall call) {
        try {
            JSArray playlists = call.getArray("playlists");
            String json = playlists != null ? playlists.toString() : "[]";
            LibraryWidgetProvider.saveAndRefresh(getContext(), json);
            call.resolve();
        } catch (Exception e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void clearAppCache(PluginCall call) {
        new Thread(() -> {
            long freedBytes = 0L;
            try {
                freedBytes += MainActivity.cleanupLegacyStorage(getContext());
                freedBytes += MainActivity.trimWebViewAndAppCaches(getContext(), true);
                java.io.File cacheDir = getContext().getCacheDir();
                if (cacheDir != null && cacheDir.exists()) {
                    java.io.File[] children = cacheDir.listFiles();
                    if (children != null) {
                        for (java.io.File c : children) {
                            freedBytes += MainActivity.deletePathAndMeasure(c);
                        }
                    }
                }
            } catch (Exception ignored) {}

            final double freedMb = Math.round((freedBytes / (1024.0 * 1024.0)) * 10.0) / 10.0;
            if (getActivity() != null) {
                getActivity().runOnUiThread(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().clearCache(true);
                        }
                    } catch (Exception ignored) {}
                    JSObject res = new JSObject();
                    res.put("cleared", true);
                    res.put("freedMb", freedMb);
                    call.resolve(res);
                });
            } else {
                JSObject res = new JSObject();
                res.put("cleared", true);
                res.put("freedMb", freedMb);
                call.resolve(res);
            }
        }).start();
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
