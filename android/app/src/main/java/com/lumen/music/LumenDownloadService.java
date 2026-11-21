package com.lumen.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * LUMEN FOREGROUND DOWNLOAD SERVICE
 * Keeps user-initiated offline downloads alive reliably when Android backgrounds the app,
 * displaying a clean native progress notification without draining battery when idle.
 */
public class LumenDownloadService extends Service {
    private static final String CHANNEL_ID = "lumen_offline_downloads";
    private static final int NOTIFICATION_ID = 4421;
    private static LumenDownloadService activeInstance;

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra("trackTitle") : "Lumen Offline Vault";
        Notification notification = buildNotification(title != null ? title : "Downloading music...", 0, true);
        startForeground(NOTIFICATION_ID, notification);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        activeInstance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Offline Music Downloads",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows progress while Lumen saves offline tracks privately");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String trackTitle, int progress, boolean indeterminate) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Downloading for Offline Playback")
            .setContentText(trackTitle)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setProgress(100, progress, indeterminate)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    public static void updateProgressNotification(Context ctx, String trackTitle, int progress) {
        try {
            if (activeInstance != null) {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIFICATION_ID, activeInstance.buildNotification(trackTitle, progress, false));
                }
            }
        } catch (Exception ignored) {}
    }

    public static void stopIfIdle(Context ctx) {
        try {
            if (activeInstance != null) {
                activeInstance.stopForeground(true);
                activeInstance.stopSelf();
            }
        } catch (Exception ignored) {}
    }
}
