package com.lumen.music;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Lightweight native Android WorkManager background sync worker.
 * Runs periodically (~15 min) even when Lumen is completely closed or after reboot:
 *  1. Checks ota-manifest.json for new app / web-bundle updates and posts a one-time notification.
 *  2. Checks Supabase for pending friend requests, Pass The Aux invites, mixtapes, blind drops,
 *     circle radio invites, album club invites, and shared songs/playlists.
 *
 * Strictly NEVER starts LumenPlaybackService so the media player notification only ever appears
 * when the user opens Lumen and plays audio.
 */
public class LumenBackgroundSyncWorker extends Worker {
    public static final String WORK_NAME = "lumen_closed_app_sync_v1";
    public static final String PREFS_BG = "lumen_bg_sync_prefs_v1";
    public static final String KEY_USER_ID = "user_id";
    public static final String KEY_USERNAME = "username";
    public static final String KEY_SUPABASE_URL = "supabase_url";
    public static final String KEY_SUPABASE_KEY = "supabase_anon_key";
    public static final String KEY_APP_VERSION = "app_version";
    private static final String KEY_NOTIFIED_IDS = "notified_ids_csv";
    private static final String KEY_LAST_NOTIFIED_UPDATE = "last_notified_update";

    private static final String CHANNEL_UPDATES = "lumen_updates_channel";
    private static final String CHANNEL_SOCIAL = "lumen_social_channel";

    private static final String[] MANIFEST_URLS = new String[] {
        "https://github.com/saatvikparakh-ui/lumen-player/releases/latest/download/ota-manifest.json",
        "https://raw.githubusercontent.com/saatvikparakh-ui/lumen-player/main/ota-manifest.json",
        "https://lumen-player.onrender.com/api/ota/manifest"
    };

    public LumenBackgroundSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context) {
        try {
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
            PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(
                LumenBackgroundSyncWorker.class,
                15,
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build();
            WorkManager.getInstance(context.getApplicationContext())
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
        } catch (Exception ignored) {}
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        if (!canPostNotifications(ctx)) {
            return Result.success();
        }
        ensureChannels(ctx);

        try {
            checkForAppUpdate(ctx);
        } catch (Exception ignored) {}

        try {
            checkForSocialActivity(ctx);
        } catch (Exception ignored) {}

        return Result.success();
    }

    private boolean canPostNotifications(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel updates = new NotificationChannel(
            CHANNEL_UPDATES,
            "App Updates",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        updates.setDescription("Notifies when a new version of Lumen is available");
        nm.createNotificationChannel(updates);

        NotificationChannel social = new NotificationChannel(
            CHANNEL_SOCIAL,
            "Friends & Invites",
            NotificationManager.IMPORTANCE_HIGH
        );
        social.setDescription("Friend requests, Pass The Aux invites, mixtapes, and shared tracks");
        nm.createNotificationChannel(social);
    }

    private void checkForAppUpdate(Context ctx) {
        String body = null;
        for (String url : MANIFEST_URLS) {
            body = httpGet(url, null, null);
            if (body != null && body.trim().startsWith("{")) break;
        }
        if (body == null) return;

        try {
            JSONObject manifest = new JSONObject(body);
            long currentNativeCode = LumenOtaPlugin.getCurrentNativeVersionCode(ctx);
            SharedPreferences otaPrefs = ctx.getSharedPreferences(LumenOtaPlugin.PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences bgPrefs = ctx.getSharedPreferences(PREFS_BG, Context.MODE_PRIVATE);

            String activeWebVersion = otaPrefs.getString(
                LumenOtaPlugin.KEY_ACTIVE_VERSION,
                bgPrefs.getString(KEY_APP_VERSION, LumenOtaPlugin.getCurrentNativeVersionName(ctx))
            );
            String latestWeb = manifest.optString("webBundleVersion", "");
            JSONObject androidObj = manifest.optJSONObject("android");
            long latestNativeCode = androidObj != null ? androidObj.optLong("versionCode", 0L) : 0L;
            String latestVersionName = androidObj != null
                ? androidObj.optString("versionName", latestWeb)
                : latestWeb;

            boolean hasNativeUpdate = latestNativeCode > currentNativeCode;
            boolean hasWebUpdate = !latestWeb.isEmpty() && !latestWeb.equals(activeWebVersion);

            if (hasNativeUpdate || hasWebUpdate) {
                String updateToken = hasNativeUpdate ? ("apk_" + latestNativeCode) : ("web_" + latestWeb);
                String lastNotified = bgPrefs.getString(KEY_LAST_NOTIFIED_UPDATE, "");
                if (!updateToken.equals(lastNotified)) {
                    bgPrefs.edit().putString(KEY_LAST_NOTIFIED_UPDATE, updateToken).apply();
                    String desc = hasNativeUpdate
                        ? ("Lumen v" + latestVersionName + " is ready — tap to update inside the app.")
                        : ("A new Lumen UI & feature update (" + latestWeb + ") is ready — tap to apply.");
                    postNotification(
                        ctx,
                        CHANNEL_UPDATES,
                        2001,
                        "LUMEN • Update Available",
                        desc
                    );
                }
            }
        } catch (Exception ignored) {}
    }

    private void checkForSocialActivity(Context ctx) {
        SharedPreferences bgPrefs = ctx.getSharedPreferences(PREFS_BG, Context.MODE_PRIVATE);
        String userId = bgPrefs.getString(KEY_USER_ID, "");
        String username = bgPrefs.getString(KEY_USERNAME, "").replace("@", "").trim().toLowerCase();
        String supaUrl = bgPrefs.getString(KEY_SUPABASE_URL, "");
        String supaKey = bgPrefs.getString(KEY_SUPABASE_KEY, "");

        if (supaUrl.isEmpty() || supaKey.isEmpty() || (userId.isEmpty() && username.isEmpty())) {
            return;
        }
        String base = supaUrl.endsWith("/") ? supaUrl.substring(0, supaUrl.length() - 1) : supaUrl;

        Set<String> notified = loadNotifiedIds(bgPrefs);
        boolean changed = false;

        // 1. Check Pending Friend Requests
        try {
            String raw = httpGet(
                base + "/rest/v1/friend_requests?select=id,from_username,from_display_name,to_uid,to_username,status&status=eq.pending&order=created_at.desc&limit=20",
                supaKey,
                "Bearer " + supaKey
            );
            if (raw != null && raw.trim().startsWith("[")) {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject row = arr.optJSONObject(i);
                    if (row == null) continue;
                    String toUid = row.optString("to_uid", "");
                    String toUser = row.optString("to_username", "").replace("@", "").trim().toLowerCase();
                    boolean forMe = (!userId.isEmpty() && userId.equals(toUid))
                        || (!username.isEmpty() && username.equals(toUser));
                    if (!forMe) continue;

                    String id = "fr_" + row.optString("id", "");
                    if (id.length() <= 3 || notified.contains(id)) continue;
                    notified.add(id);
                    changed = true;
                    String fromName = row.optString("from_display_name", "");
                    if (fromName.isEmpty()) fromName = "@" + row.optString("from_username", "Someone");
                    postNotification(
                        ctx,
                        CHANNEL_SOCIAL,
                        Math.abs(id.hashCode()) % 50000 + 3000,
                        "LUMEN • Friend Request",
                        fromName + " sent you a friend request!"
                    );
                }
            }
        } catch (Exception ignored) {}

        // 2. Check Incoming Aux Invites, Mixtapes, Blind Drops, Circle Radio, Tier Lists & Shared Music
        try {
            String raw = httpGet(
                base + "/rest/v1/song_shares?select=id,sender_username,sender_display_name,recipient_id,type,message,read&order=created_at.desc&limit=25",
                supaKey,
                "Bearer " + supaKey
            );
            if (raw != null && raw.trim().startsWith("[")) {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject row = arr.optJSONObject(i);
                    if (row == null || row.optBoolean("read", false)) continue;
                    String recip = row.optString("recipient_id", "").replace("@", "").trim().toLowerCase();
                    boolean forMe = (!userId.isEmpty() && userId.toLowerCase().equals(recip))
                        || (!username.isEmpty() && username.equals(recip));
                    if (!forMe) continue;

                    String id = "sh_" + row.optString("id", "");
                    if (id.length() <= 3 || notified.contains(id)) continue;
                    notified.add(id);
                    changed = true;

                    String type = row.optString("type", "song");
                    String sender = row.optString("sender_display_name", "");
                    if (sender.isEmpty()) sender = "@" + row.optString("sender_username", "Friend");
                    String msg = row.optString("message", "");

                    String title = "LUMEN • Music Shared";
                    String bodyText = !msg.isEmpty() ? (sender + ": " + msg) : (sender + " shared music with you!");
                    if ("aux_invite".equals(type)) {
                        title = "LUMEN • Pass The Aux";
                        bodyText = !msg.isEmpty() ? (sender + " — " + msg) : (sender + " invited you to Pass The Aux!");
                    } else if ("mini_mixtape".equals(type)) {
                        title = "LUMEN • Mini Mixtape";
                        bodyText = !msg.isEmpty() ? (sender + " — " + msg) : (sender + " sent you a Mini Mixtape!");
                    } else if ("blind_drop".equals(type)) {
                        title = "LUMEN • Mystery Blind Drop";
                        bodyText = "Someone in your circle dropped you a mystery track!";
                    } else if ("circle_radio_invite".equals(type)) {
                        title = "LUMEN • Circle Radio";
                        bodyText = !msg.isEmpty() ? (sender + " — " + msg) : (sender + " invited you to Circle Radio!");
                    } else if ("collaborative_tier_list".equals(type)) {
                        title = "LUMEN • Tier List Invite";
                        bodyText = !msg.isEmpty() ? (sender + " — " + msg) : (sender + " invited you to a Tier List!");
                    }

                    postNotification(
                        ctx,
                        CHANNEL_SOCIAL,
                        Math.abs(id.hashCode()) % 50000 + 3000,
                        title,
                        bodyText
                    );
                }
            }
        } catch (Exception ignored) {}

        // 3. Check Pending Album Club Invites
        try {
            String raw = httpGet(
                base + "/rest/v1/album_club_invites?select=id,club_name,inviter_name,invitee_id,invitee_name,status&status=eq.pending&order=created_at.desc&limit=15",
                supaKey,
                "Bearer " + supaKey
            );
            if (raw != null && raw.trim().startsWith("[")) {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject row = arr.optJSONObject(i);
                    if (row == null) continue;
                    String invId = row.optString("invitee_id", "");
                    String invName = row.optString("invitee_name", "").replace("@", "").trim().toLowerCase();
                    boolean forMe = (!userId.isEmpty() && userId.equals(invId))
                        || (!username.isEmpty() && username.equals(invName));
                    if (!forMe) continue;

                    String id = "ac_" + row.optString("id", "");
                    if (id.length() <= 3 || notified.contains(id)) continue;
                    notified.add(id);
                    changed = true;
                    String inviter = row.optString("inviter_name", "A friend");
                    String clubName = row.optString("club_name", "Weekly Album Club");
                    postNotification(
                        ctx,
                        CHANNEL_SOCIAL,
                        Math.abs(id.hashCode()) % 50000 + 3000,
                        "LUMEN • Album Club",
                        "@" + inviter + " invited you to join \"" + clubName + "\""
                    );
                }
            }
        } catch (Exception ignored) {}

        if (changed) {
            saveNotifiedIds(bgPrefs, notified);
        }
    }

    private void postNotification(Context ctx, String channelId, int notifId, String title, String message) {
        try {
            Intent openIntent = new Intent(ctx, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                ctx,
                notifId,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(CHANNEL_SOCIAL.equals(channelId) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pi);

            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(notifId, b.build());
            }
        } catch (Exception ignored) {}
    }

    private Set<String> loadNotifiedIds(SharedPreferences prefs) {
        String csv = prefs.getString(KEY_NOTIFIED_IDS, "");
        if (csv == null || csv.isEmpty()) return new HashSet<>();
        return new HashSet<>(Arrays.asList(csv.split(",")));
    }

    private void saveNotifiedIds(SharedPreferences prefs, Set<String> ids) {
        List<String> list = new ArrayList<>(ids);
        if (list.size() > 150) {
            list = list.subList(list.size() - 150, list.size());
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(list.get(i));
        }
        prefs.edit().putString(KEY_NOTIFIED_IDS, sb.toString()).apply();
    }

    private String httpGet(String urlStr, String apiKey, String authHeader) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/json");
            if (apiKey != null && !apiKey.isEmpty()) {
                conn.setRequestProperty("apikey", apiKey);
            }
            if (authHeader != null && !authHeader.isEmpty()) {
                conn.setRequestProperty("Authorization", authHeader);
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
            }
            return sb.toString();
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
