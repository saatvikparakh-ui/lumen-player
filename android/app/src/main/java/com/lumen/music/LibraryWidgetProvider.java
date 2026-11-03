package com.lumen.music;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class LibraryWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_library);

        // Intent to launch Lumen directly into Library tab
        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setAction("com.lumen.music.OPEN_LIBRARY");
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppPending = PendingIntent.getActivity(
            context, 300, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        views.setOnClickPendingIntent(R.id.widget_lib_root, openAppPending);
        views.setOnClickPendingIntent(R.id.widget_lib_open_all, openAppPending);
        views.setOnClickPendingIntent(R.id.widget_lib_card_1, openAppPending);
        views.setOnClickPendingIntent(R.id.widget_lib_card_2, openAppPending);
        views.setOnClickPendingIntent(R.id.widget_lib_card_3, openAppPending);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
