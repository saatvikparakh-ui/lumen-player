package com.lumen.music;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

public class LumenPlaybackService extends MediaSessionService {
    private static LumenPlaybackService instance;
    private ExoPlayer player;
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

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build();

        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

        Intent sessionActivityIntent = new Intent(this, MainActivity.class);
        PendingIntent sessionActivityPendingIntent = PendingIntent.getActivity(
                this, 0, sessionActivityIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        mediaSession = new MediaSession.Builder(this, player)
                .setSessionActivity(sessionActivityPendingIntent)
                .build();

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
