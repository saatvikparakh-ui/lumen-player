package com.lumen.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
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

    public class LocalBinder extends Binder {
        public LumenPlaybackService getService() {
            return LumenPlaybackService.this;
        }
    }

    public static LumenPlaybackService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        // 1. Create Dedicated Notification Channel for Spotify-Style Media Controls
        createNotificationChannel();

        // 2. Initialize ExoPlayer with AudioAttributes for Music
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build();

        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

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
                            togglePlay();
                            return true;
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
                LumenPlaybackState state = LumenPlaybackState.get();
                state.isPlaying = isPlaying;
                state.positionMs = player.getCurrentPosition();
                state.durationMs = Math.max(state.durationMs, player.getDuration() > 0 ? player.getDuration() : 0);
                state.save(getApplicationContext());

                CompactWidgetProvider.updateAllWidgets(getApplicationContext());
                NowPlayingWidgetProvider.updateAllWidgets(getApplicationContext());

                if (LumenAudioPlugin.getInstance() != null) {
                    LumenAudioPlugin.getInstance().notifyStateChange(isPlaying, state.positionMs, state.durationMs);
                }
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) {
                    if (LumenAudioPlugin.getInstance() != null) {
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
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows currently playing song and playback controls");
            channel.setShowBadge(false);
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

        CompactWidgetProvider.updateAllWidgets(getApplicationContext());
        NowPlayingWidgetProvider.updateAllWidgets(getApplicationContext());
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

    public void prev() {
        if (LumenAudioPlugin.getInstance() != null) {
            LumenAudioPlugin.getInstance().notifyPrevTrack();
        } else if (player != null) {
            player.seekTo(0);
        }
    }

    public void next() {
        if (LumenAudioPlugin.getInstance() != null) {
            LumenAudioPlugin.getInstance().notifyNextTrack();
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
