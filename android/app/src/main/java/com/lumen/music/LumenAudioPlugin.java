package com.lumen.music;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LumenAudio")
public class LumenAudioPlugin extends Plugin {
    private static LumenAudioPlugin instance;
    private LumenPlaybackService playbackService;
    private boolean isBound = false;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            LumenPlaybackService.LocalBinder binder = (LumenPlaybackService.LocalBinder) service;
            playbackService = binder.getService();
            isBound = true;
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
        Intent intent = new Intent(context, LumenPlaybackService.class);
        try {
            context.startService(intent);
        } catch (Exception ignored) {}
        context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
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
            if (playbackService != null) {
                playbackService.playTrack(trackId, url, title, artist, album, artworkUrl, durationMs, positionMs);
                call.resolve();
            } else {
                // Service may still be binding, fallback to static/singleton
                LumenPlaybackService service = LumenPlaybackService.getInstance();
                if (service != null) {
                    service.playTrack(trackId, url, title, artist, album, artworkUrl, durationMs, positionMs);
                    call.resolve();
                } else {
                    call.reject("Playback service is starting up");
                }
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.pause();
                call.resolve();
            } else {
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.resume();
                call.resolve();
            } else {
                call.resolve();
            }
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
                call.resolve();
            } else {
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double volume = call.getDouble("volume", 1.0);
        getActivity().runOnUiThread(() -> {
            LumenPlaybackService service = playbackService != null ? playbackService : LumenPlaybackService.getInstance();
            if (service != null) {
                service.setVolume(volume.floatValue());
                call.resolve();
            } else {
                call.resolve();
            }
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
