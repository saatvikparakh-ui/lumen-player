package com.lumen.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.view.KeyEvent;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

@OptIn(markerClass = UnstableApi.class)
public class LumenPlaybackService extends MediaSessionService {
    public static final String NOTIFICATION_CHANNEL_ID = "lumen_playback_channel";
    private static LumenPlaybackService instance;
    private ExoPlayer player;
    private ForwardingPlayer forwardingPlayer;
    private MediaSession mediaSession;
    private final IBinder binder = new LocalBinder();
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private void acquireWakeLocks() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(180 * 60 * 1000L); // 3-hour safety timeout
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseWakeLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    private void updateWakeLockState() {
        if (player == null) {
            releaseWakeLocks();
            return;
        }
        boolean isBufferingOrReady = player.getPlaybackState() == Player.STATE_READY || player.getPlaybackState() == Player.STATE_BUFFERING;
        boolean wantsToPlay = player.getPlayWhenReady();
        if (wantsToPlay && isBufferingOrReady) {
            acquireWakeLocks();
        } else if (player.getPlaybackState() == Player.STATE_ENDED) {
            // Screen-off background playback guarantee: keep CPU awake for 45s on track completion
            // so WebView JS has ample time to resolve & play next song while in pocket/bag
            try {
                if (wakeLock != null && !wakeLock.isHeld()) {
                    wakeLock.acquire(45 * 1000L);
                }
            } catch (Exception ignored) {}
        } else if (!wantsToPlay || player.getPlaybackState() == Player.STATE_IDLE) {
            releaseWakeLocks();
        }
    }

    public class LocalBinder extends Binder {
        public LumenPlaybackService getService() {
            return LumenPlaybackService.this;
        }
    }

    public static LumenPlaybackService getInstance() {
        return instance;
    }

    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (player != null && player.isPlaying()) {
                long pos = player.getCurrentPosition();
                long dur = player.getDuration();
                if (LumenAudioPlugin.getInstance() != null) {
                    LumenAudioPlugin.getInstance().notifyStateChange(true, pos, dur > 0 ? dur : 0);
                }
                progressHandler.postDelayed(this, 300);
            }
        }
    };

    private long lastWidgetUpdateTime = 0;
    private void updateWidgetsThrottled() {
        long now = System.currentTimeMillis();
        if (now - lastWidgetUpdateTime < 500) {
            return;
        }
        lastWidgetUpdateTime = now;
        CompactWidgetProvider.updateAllWidgets(getApplicationContext());
        NowPlayingWidgetProvider.updateAllWidgets(getApplicationContext());
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        // 1. Initialize PowerManager WakeLock & WifiLock to keep audio streaming alive when screen is off
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Lumen:PlaybackWakeLock");
                wakeLock.setReferenceCounted(false);
            }
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Lumen:PlaybackWifiLock");
                wifiLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {}

        // 2. Create Dedicated Notification Channel for Spotify-Style Media Controls
        createNotificationChannel();

        // 3. Initialize ExoPlayer with AudioAttributes for Music & Network Wake Lock for Background Playback
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build();

        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();
        player.setPlayWhenReady(false);

        // 3. Wrap Player with ForwardingPlayer so Media3 Notification and Bluetooth Earbuds Always Have Next/Prev Available
        forwardingPlayer = new ForwardingPlayer(player) {
            @Override
            public Commands getAvailableCommands() {
                return super.getAvailableCommands()
                        .buildUpon()
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                if (command == Player.COMMAND_SEEK_TO_NEXT || command == Player.COMMAND_SEEK_TO_PREVIOUS
                        || command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM || command == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                    return true;
                }
                return super.isCommandAvailable(command);
            }

            @Override
            public void seekToNext() {
                next();
            }

            @Override
            public void seekToNextMediaItem() {
                next();
            }

            @Override
            public void seekToPrevious() {
                prev();
            }

            @Override
            public void seekToPreviousMediaItem() {
                prev();
            }
        };

        // 4. Session PendingIntent
        Intent sessionActivityIntent = new Intent(this, MainActivity.class);
        sessionActivityIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivityPendingIntent = PendingIntent.getActivity(
                this, 0, sessionActivityIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // 5. Custom MediaSession Callback for Headset / Bluetooth Earbud Double-Clicks & Media KeyEvents
        MediaSession.Callback mediaSessionCallback = new MediaSession.Callback() {
            private long lastClickTime = 0;
            private int clickCount = 0;
            private final android.os.Handler clickHandler = new android.os.Handler(android.os.Looper.getMainLooper());
            private final Runnable singleClickRunnable = new Runnable() {
                @Override
                public void run() {
                    clickCount = 0;
                    togglePlay();
                }
            };

            @Override
            public boolean onMediaButtonEvent(MediaSession session, MediaSession.ControllerInfo controllerInfo, Intent intent) {
                if (intent != null && Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) {
                    KeyEvent event = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                    if (event != null && event.getAction() == KeyEvent.ACTION_DOWN) {
                        int keyCode = event.getKeyCode();
                        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT) {
                            next();
                            return true;
                        } else if (keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS) {
                            prev();
                            return true;
                        } else if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_HEADSETHOOK) {
                            long now = System.currentTimeMillis();
                            if (now - lastClickTime < 380) {
                                clickCount++;
                                clickHandler.removeCallbacks(singleClickRunnable);
                                if (clickCount == 2) {
                                    clickHandler.postDelayed(() -> {
                                        if (clickCount == 2) {
                                            clickCount = 0;
                                            next();
                                        }
                                    }, 200);
                                    return true;
                                } else if (clickCount >= 3) {
                                    clickCount = 0;
                                    prev();
                                    return true;
                                }
                            } else {
                                clickCount = 1;
                                lastClickTime = now;
                                clickHandler.postDelayed(singleClickRunnable, 380);
                                return true;
                            }
                        } else if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY) {
                            resume();
                            return true;
                        } else if (keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                            pause();
                            return true;
                        }
                    }
                }
                return false;
            }
        };

        // 6. Build MediaSession
        mediaSession = new MediaSession.Builder(this, forwardingPlayer)
                .setSessionActivity(sessionActivityPendingIntent)
                .setCallback(mediaSessionCallback)
                .build();

        // 7. Configure Rich MediaStyle Notification Provider
        try {
            DefaultMediaNotificationProvider notificationProvider = new DefaultMediaNotificationProvider.Builder(this)
                    .setChannelId(NOTIFICATION_CHANNEL_ID)
                    .setChannelName(R.string.title_activity_main)
                    .build();
            setMediaNotificationProvider(notificationProvider);
        } catch (Exception e) {
            // Safe fallback to system defaults
        }

        // 8. Player Listeners for State, Widgets, and App Bridge
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updateWakeLockState();

                LumenPlaybackState state = LumenPlaybackState.get();
                state.isPlaying = isPlaying;
                state.positionMs = player.getCurrentPosition();
                state.durationMs = Math.max(state.durationMs, player.getDuration() > 0 ? player.getDuration() : 0);
                state.save(getApplicationContext());

                updateWidgetsThrottled();

                if (isPlaying) {
                    progressHandler.removeCallbacks(progressRunnable);
                    progressHandler.post(progressRunnable);
                } else {
                    progressHandler.removeCallbacks(progressRunnable);
                }

                if (LumenAudioPlugin.getInstance() != null) {
                    LumenAudioPlugin.getInstance().notifyStateChange(isPlaying, state.positionMs, state.durationMs);
                }
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                updateWakeLockState();
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                if (mediaItem != null) {
                    MediaMetadata meta = mediaItem.mediaMetadata;
                    String title = meta.title != null ? meta.title.toString() : "Unknown Title";
                    String artist = meta.artist != null ? meta.artist.toString() : "Unknown Artist";
                    String album = meta.albumTitle != null ? meta.albumTitle.toString() : "Lumen Hi-Fi";
                    String artworkUrl = meta.artworkUri != null ? meta.artworkUri.toString() : "";

                    LumenPlaybackState state = LumenPlaybackState.get();
                    state.trackId = mediaItem.mediaId;
                    state.title = title;
                    state.artist = artist;
                    state.album = album;
                    state.artworkUrl = artworkUrl;
                    state.isPlaying = player.isPlaying();
                    state.positionMs = player.getCurrentPosition();
                    state.durationMs = player.getDuration() > 0 ? player.getDuration() : state.durationMs;
                    state.save(getApplicationContext());

                    updateWidgetsThrottled();

                    if (LumenAudioPlugin.getInstance() != null) {
                        LumenAudioPlugin.getInstance().notifyStateChange(state.isPlaying, state.positionMs, state.durationMs);
                        LumenAudioPlugin.getInstance().notifyMediaItemTransition(state.trackId, state.title, state.artist, state.album, state.artworkUrl);
                    }
                }
            }

            private int retryAttempts = 0;
            private long lastErrorTime = 0;
            private long lastTrackEndedTime = 0;

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException error) {
                long now = System.currentTimeMillis();
                if (now - lastErrorTime > 5000) {
                    retryAttempts = 0;
                }
                lastErrorTime = now;

                if (retryAttempts < 2 && player != null) {
                    retryAttempts++;
                    long curPos = player.getCurrentPosition();
                    player.prepare();
                    if (curPos > 0) {
                        player.seekTo(curPos);
                    }
                    player.play();
                } else {
                    retryAttempts = 0;
                    if (player != null && player.hasNextMediaItem()) {
                        // Advance to the next item so a single network/stream error does not kill background playback!
                        player.seekToNextMediaItem();
                        player.prepare();
                        player.play();
                    } else if (LumenAudioPlugin.getInstance() != null) {
                        LumenAudioPlugin.getInstance().notifyStateChange(false, player != null ? player.getCurrentPosition() : 0, player != null ? player.getDuration() : 0);
                    }
                }
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                updateWakeLockState();
                if (playbackState == Player.STATE_ENDED) {
                    long now = System.currentTimeMillis();
                    // Prevent runaway loops: Debounce track ended triggers within 1500ms
                    if (now - lastTrackEndedTime < 1500) {
                        return;
                    }
                    lastTrackEndedTime = now;

                    // Guard against failed/empty streams: If track ended with < 2 seconds position,
                    // it is an unbuffered network/source error, NOT a legitimately completed track!
                    long curPos = player != null ? player.getCurrentPosition() : 0;
                    long dur = player != null ? player.getDuration() : 0;
                    if (curPos < 2000 && dur <= 0) {
                        android.util.Log.w("LumenPlayback", "Track reached STATE_ENDED in <2000ms. Halting runaway skip loop.");
                        if (player != null) {
                            player.pause();
                        }
                        if (LumenAudioPlugin.getInstance() != null) {
                            LumenAudioPlugin.getInstance().notifyStateChange(false, curPos, dur);
                        }
                        return;
                    }

                    if (player != null && player.hasNextMediaItem()) {
                        player.seekToNextMediaItem();
                        player.play();
                    } else if (player != null && (player.getRepeatMode() == Player.REPEAT_MODE_ALL || player.getMediaItemCount() > 1)) {
                        // Loop back to start of playlist so playback never stops in pocket or bag
                        player.seekToDefaultPosition(0);
                        player.play();
                    } else if (LumenAudioPlugin.getInstance() != null) {
                        LumenAudioPlugin.getInstance().notifyTrackEnded();
                    }
                }
            }
        });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "Lumen Music Playback",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Shows currently playing song and playback controls");
            channel.setShowBadge(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public IBinder onBind(Intent intent) {
        if (MediaSessionService.SERVICE_INTERFACE.equals(intent.getAction())) {
            return super.onBind(intent);
        }
        return binder;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if (CompactWidgetProvider.ACTION_PLAY_PAUSE.equals(action)) {
                togglePlay();
            } else if (CompactWidgetProvider.ACTION_PREV.equals(action)) {
                prev();
            } else if (CompactWidgetProvider.ACTION_NEXT.equals(action)) {
                next();
            }
        }
        return super.onStartCommand(intent, flags, startId);
    }

    public void playTrack(String trackId, String url, String title, String artist, String album, String artworkUrl, long durationMs, long startPositionMs) {
        if (player == null || url == null || url.isEmpty()) return;

        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                .setTitle(title != null ? title : "Unknown Title")
                .setArtist(artist != null ? artist : "Unknown Artist")
                .setAlbumTitle(album != null ? album : "Lumen Hi-Fi");

        if (artworkUrl != null && !artworkUrl.isEmpty()) {
            try {
                metaBuilder.setArtworkUri(Uri.parse(artworkUrl));
            } catch (Exception ignored) {}
        }

        MediaItem mediaItem = new MediaItem.Builder()
                .setUri(Uri.parse(url))
                .setMediaId(trackId != null ? trackId : url)
                .setMediaMetadata(metaBuilder.build())
                .build();

        player.setMediaItem(mediaItem, Math.max(0, startPositionMs));
        player.prepare();
        player.play();

        LumenPlaybackState state = LumenPlaybackState.get();
        state.trackId = trackId != null ? trackId : "";
        state.title = title != null ? title : "";
        state.artist = artist != null ? artist : "";
        state.album = album != null ? album : "";
        state.artworkUrl = artworkUrl != null ? artworkUrl : "";
        state.durationMs = durationMs;
        state.positionMs = startPositionMs;
        state.isPlaying = true;
        state.save(getApplicationContext());

        updateWidgetsThrottled();
    }

    public void togglePlay() {
        if (player == null) return;
        if (player.isPlaying()) {
            player.pause();
        } else {
            player.play();
        }
    }

    public void pause() {
        if (player != null) {
            player.pause();
        }
    }

    public void resume() {
        if (player != null) {
            player.play();
        }
    }

    public void seekTo(long positionMs) {
        if (player != null) {
            player.seekTo(positionMs);
        }
    }

    public void setVolume(float volume) {
        if (player != null) {
            player.setVolume(Math.max(0f, Math.min(1f, volume)));
        }
    }

    private long lastControlSkipTime = 0;

    public void prev() {
        long now = System.currentTimeMillis();
        if (now - lastControlSkipTime < 250) return;
        lastControlSkipTime = now;

        if (player != null && player.getCurrentPosition() > 3000) {
            player.seekTo(0);
            return;
        }
        if (player != null && player.hasPreviousMediaItem()) {
            player.seekToPreviousMediaItem();
            player.play();
        } else if (LumenAudioPlugin.getInstance() != null) {
            LumenAudioPlugin.getInstance().notifyPrevTrack();
        } else if (player != null) {
            player.seekTo(0);
        }
    }

    public void next() {
        long now = System.currentTimeMillis();
        if (now - lastControlSkipTime < 250) return;
        lastControlSkipTime = now;

        if (player != null && player.hasNextMediaItem()) {
            player.seekToNextMediaItem();
            player.play();
        } else if (LumenAudioPlugin.getInstance() != null) {
            LumenAudioPlugin.getInstance().notifyNextTrack();
        }
    }

    public void setRepeatMode(int mode) {
        if (player != null) {
            int exoMode = Player.REPEAT_MODE_OFF;
            if (mode == 1) exoMode = Player.REPEAT_MODE_ALL;
            else if (mode == 2) exoMode = Player.REPEAT_MODE_ONE;
            player.setRepeatMode(exoMode);
        }
    }

    public void setNativeQueue(java.util.List<MediaItem> items, int startIndex, long startPositionMs) {
        setNativeQueue(items, startIndex, startPositionMs, false);
    }

    public void setNativeQueue(java.util.List<MediaItem> items, int startIndex, long startPositionMs, boolean autoPlay) {
        if (player == null || items == null || items.isEmpty()) return;
        MediaItem current = player.getCurrentMediaItem();

        // When syncing queue in the background (!autoPlay), NEVER interrupt or reset current playback!
        if (!autoPlay && current != null && current.mediaId != null) {
            int foundIndex = -1;
            for (int i = 0; i < items.size(); i++) {
                MediaItem mi = items.get(i);
                if (mi != null && current.mediaId.equals(mi.mediaId)) {
                    foundIndex = i;
                    break;
                }
            }
            if (foundIndex != -1) {
                // Current track matches an entry in incoming queue;
                // Seamlessly update upcoming items without resetting playback or re-buffering!
                int curIndex = player.getCurrentMediaItemIndex();
                int total = player.getMediaItemCount();
                if (total > curIndex + 1) {
                    player.removeMediaItems(curIndex + 1, total);
                }
                if (foundIndex + 1 < items.size()) {
                    java.util.List<MediaItem> futureItems = items.subList(foundIndex + 1, items.size());
                    player.addMediaItems(futureItems);
                }
                return;
            } else {
                // Current track was not included; append incoming items as future tracks
                player.addMediaItems(items);
                return;
            }
        }

        int validIndex = Math.max(0, Math.min(startIndex, items.size() - 1));
        MediaItem target = items.get(validIndex);
        if (current != null && target != null && current.mediaId != null && current.mediaId.equals(target.mediaId)) {
            // Target track is already playing; update playlist seamlessly without interrupting playback
            int curIndex = player.getCurrentMediaItemIndex();
            int total = player.getMediaItemCount();
            if (total > curIndex + 1) {
                player.removeMediaItems(curIndex + 1, total);
            }
            if (validIndex + 1 < items.size()) {
                java.util.List<MediaItem> futureItems = items.subList(validIndex + 1, items.size());
                player.addMediaItems(futureItems);
            }
            if (autoPlay && !player.isPlaying()) {
                acquireWakeLocks();
                player.play();
            }
            return;
        }
        player.setMediaItems(items, validIndex, Math.max(0, startPositionMs));
        player.setPlayWhenReady(autoPlay);
        player.prepare();
        if (autoPlay) {
            acquireWakeLocks();
            player.play();
        }
    }

    public long getCurrentPosition() {
        return player != null ? player.getCurrentPosition() : 0;
    }

    public long getDuration() {
        return player != null ? player.getDuration() : 0;
    }

    public boolean isPlaying() {
        return player != null && player.isPlaying();
    }

    @Override
    public void onDestroy() {
        releaseWakeLocks();
        instance = null;
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
