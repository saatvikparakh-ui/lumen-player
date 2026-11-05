package com.lumen.music;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class CompactWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_PLAY_PAUSE = "com.lumen.music.ACTION_PLAY_PAUSE";
    public static final String ACTION_PREV = "com.lumen.music.ACTION_PREV";
    public static final String ACTION_NEXT = "com.lumen.music.ACTION_NEXT";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        LumenPlaybackState state = LumenPlaybackState.get();
        state.load(context);
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId, state);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId, LumenPlaybackState state) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_compact);

        views.setTextViewText(R.id.widget_compact_title, state.title != null && !state.title.isEmpty() ? state.title : "Currently Playing");
        views.setTextViewText(R.id.widget_compact_artist, state.artist != null && !state.artist.isEmpty() ? state.artist : "Lumen Hi-Fi");

        // Asynchronously load crisp 1:1 square artwork with zero UI lag
        LumenWidgetImageLoader.loadArtwork(
            context,
            appWidgetManager,
            appWidgetId,
            views,
            R.id.widget_compact_artwork,
            state.artworkUrl,
            52,
            12
        );

        // Play/Pause icon toggle
        if (state.isPlaying) {
            views.setImageViewResource(R.id.widget_compact_play_pause, R.drawable.ic_widget_pause);
        } else {
            views.setImageViewResource(R.id.widget_compact_play_pause, R.drawable.ic_widget_play);
        }

        // Progress bar
        if (state.durationMs > 0) {
            int progress = (int) ((state.positionMs * 1000) / state.durationMs);
            views.setProgressBar(R.id.widget_compact_progress, 1000, progress, false);
        } else {
            views.setProgressBar(R.id.widget_compact_progress, 1000, 0, false);
        }

        // PendingIntent to launch Lumen app
        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppPending = PendingIntent.getActivity(
            context, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_compact_root, openAppPending);
        views.setOnClickPendingIntent(R.id.widget_compact_artwork, openAppPending);

        // Control buttons
        views.setOnClickPendingIntent(R.id.widget_compact_play_pause, getBroadcastPendingIntent(context, ACTION_PLAY_PAUSE, 101));
        views.setOnClickPendingIntent(R.id.widget_compact_prev, getBroadcastPendingIntent(context, ACTION_PREV, 102));
        views.setOnClickPendingIntent(R.id.widget_compact_next, getBroadcastPendingIntent(context, ACTION_NEXT, 103));

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static PendingIntent getBroadcastPendingIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, CompactWidgetProvider.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
            context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_PLAY_PAUSE.equals(action) || ACTION_PREV.equals(action) || ACTION_NEXT.equals(action)) {
            Intent serviceIntent = new Intent(context, LumenPlaybackService.class);
            serviceIntent.setAction(action);
            try {
                context.startService(serviceIntent);
            } catch (Exception e) {
                // If background service start is restricted on Android 12+, use startForegroundService or bind
                try {
                    context.startForegroundService(serviceIntent);
                } catch (Exception ignored) {}
            }
        }
    }

    public static void updateAllWidgets(Context context) {
        AppWidgetManager man = AppWidgetManager.getInstance(context);
        int[] ids = man.getAppWidgetIds(new ComponentName(context, CompactWidgetProvider.class));
        if (ids != null && ids.length > 0) {
            LumenPlaybackState state = LumenPlaybackState.get();
            for (int id : ids) {
                updateAppWidget(context, man, id, state);
            }
        }
    }
}
