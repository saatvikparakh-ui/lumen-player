package com.lumen.music;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import java.util.Locale;

public class NowPlayingWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_PLAY_PAUSE = "com.lumen.music.ACTION_PLAY_PAUSE";
    public static final String ACTION_PREV = "com.lumen.music.ACTION_PREV";
    public static final String ACTION_NEXT = "com.lumen.music.ACTION_NEXT";
    public static final String ACTION_SHUFFLE = "com.lumen.music.ACTION_SHUFFLE";
    public static final String ACTION_REPEAT = "com.lumen.music.ACTION_REPEAT";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        LumenPlaybackState state = LumenPlaybackState.get();
        state.load(context);
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId, state);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId, LumenPlaybackState state) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_now_playing);

        views.setTextViewText(R.id.widget_np_title, state.title != null && !state.title.isEmpty() ? state.title : "Song title");
        views.setTextViewText(R.id.widget_np_artist, state.artist != null && !state.artist.isEmpty() ? state.artist : "Artist name");
        views.setTextViewText(R.id.widget_np_album, state.album != null && !state.album.isEmpty() ? state.album : "Album name");

        // Play/Pause icon toggle
        if (state.isPlaying) {
            views.setImageViewResource(R.id.widget_np_play_pause, R.drawable.ic_widget_pause);
        } else {
            views.setImageViewResource(R.id.widget_np_play_pause, R.drawable.ic_widget_play);
        }

        // Progress bar & times
        long posSec = state.positionMs / 1000;
        long durSec = state.durationMs / 1000;
        views.setTextViewText(R.id.widget_np_elapsed, formatTime(posSec));
        views.setTextViewText(R.id.widget_np_duration, durSec > 0 ? formatTime(durSec) : "--:--");

        if (state.durationMs > 0) {
            int progress = (int) ((state.positionMs * 1000) / state.durationMs);
            views.setProgressBar(R.id.widget_np_progress, 1000, progress, false);
        } else {
            views.setProgressBar(R.id.widget_np_progress, 1000, 0, false);
        }

        // PendingIntent to launch Lumen app
        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppPending = PendingIntent.getActivity(
            context, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_np_root, openAppPending);
        views.setOnClickPendingIntent(R.id.widget_np_artwork, openAppPending);

        // Control buttons
        views.setOnClickPendingIntent(R.id.widget_np_play_pause, getBroadcastPendingIntent(context, ACTION_PLAY_PAUSE, 201));
        views.setOnClickPendingIntent(R.id.widget_np_prev, getBroadcastPendingIntent(context, ACTION_PREV, 202));
        views.setOnClickPendingIntent(R.id.widget_np_next, getBroadcastPendingIntent(context, ACTION_NEXT, 203));
        views.setOnClickPendingIntent(R.id.widget_np_shuffle, getBroadcastPendingIntent(context, ACTION_SHUFFLE, 204));
        views.setOnClickPendingIntent(R.id.widget_np_repeat, getBroadcastPendingIntent(context, ACTION_REPEAT, 205));

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static String formatTime(long sec) {
        if (sec < 0) sec = 0;
        long m = sec / 60;
        long s = sec % 60;
        return String.format(Locale.US, "%d:%02d", m, s);
    }

    private static PendingIntent getBroadcastPendingIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, NowPlayingWidgetProvider.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
            context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_PLAY_PAUSE.equals(action) || ACTION_PREV.equals(action) || ACTION_NEXT.equals(action)
                || ACTION_SHUFFLE.equals(action) || ACTION_REPEAT.equals(action)) {
            Intent serviceIntent = new Intent(context, LumenPlaybackService.class);
            serviceIntent.setAction(action);
            try {
                context.startService(serviceIntent);
            } catch (Exception e) {
                try {
                    context.startForegroundService(serviceIntent);
                } catch (Exception ignored) {}
            }
        }
    }

    public static void updateAllWidgets(Context context) {
        AppWidgetManager man = AppWidgetManager.getInstance(context);
        int[] ids = man.getAppWidgetIds(new ComponentName(context, NowPlayingWidgetProvider.class));
        if (ids != null && ids.length > 0) {
            LumenPlaybackState state = LumenPlaybackState.get();
            for (int id : ids) {
                updateAppWidget(context, man, id, state);
            }
        }
    }
}
