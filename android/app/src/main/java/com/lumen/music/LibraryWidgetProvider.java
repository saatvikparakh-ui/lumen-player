package com.lumen.music;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.util.Base64;
import android.view.View;
import android.widget.RemoteViews;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class LibraryWidgetProvider extends AppWidgetProvider {
    public static final String PREFS_NAME = "lumen_library_widget_prefs";
    public static final String KEY_PLAYLISTS_JSON = "playlists_json";
    public static final String ACTION_OPEN_LIBRARY = "com.lumen.music.OPEN_LIBRARY";
    public static final String ACTION_OPEN_PLAYLIST = "com.lumen.music.OPEN_PLAYLIST";
    public static final String EXTRA_PLAYLIST_ID = "playlistId";

    private static final ExecutorService renderExecutor = Executors.newSingleThreadExecutor();

    private static final int[] CARD_IDS = {
        R.id.widget_lib_card_1,
        R.id.widget_lib_card_2,
        R.id.widget_lib_card_3,
        R.id.widget_lib_card_4
    };
    private static final int[] ART_IDS = {
        R.id.widget_lib_art_1,
        R.id.widget_lib_art_2,
        R.id.widget_lib_art_3,
        R.id.widget_lib_art_4
    };
    private static final int[] TITLE_IDS = {
        R.id.widget_lib_title_1,
        R.id.widget_lib_title_2,
        R.id.widget_lib_title_3,
        R.id.widget_lib_title_4
    };

    private static class PlaylistItem {
        String id;
        String name;
        String coverUrl;
        String coverColor;
        List<String> trackCovers = new ArrayList<>();
    }

    public static void saveAndRefresh(Context context, String playlistsJson) {
        if (context == null || playlistsJson == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_PLAYLISTS_JSON, playlistsJson).apply();

        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, LibraryWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids != null && ids.length > 0) {
            for (int id : ids) {
                updateAppWidget(context.getApplicationContext(), manager, id);
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context.getApplicationContext(), appWidgetManager, appWidgetId);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        List<PlaylistItem> items = loadPlaylists(context);
        // 1. Push instant text + tap intents right away
        RemoteViews initialViews = buildBaseViews(context, items, null);
        appWidgetManager.updateAppWidget(appWidgetId, initialViews);

        if (items.isEmpty()) return;

        // 2. Render 3D rounded playlist covers (custom cover or 2x2 collage) off the main thread
        renderExecutor.execute(() -> {
            try {
                int count = Math.min(4, items.size());
                Bitmap[] rendered = new Bitmap[count];
                for (int i = 0; i < count; i++) {
                    rendered[i] = render3DPlaylistCover(items.get(i), 184);
                }
                RemoteViews updatedViews = buildBaseViews(context, items, rendered);
                appWidgetManager.updateAppWidget(appWidgetId, updatedViews);
            } catch (Exception ignored) {}
        });
    }

    private static RemoteViews buildBaseViews(Context context, List<PlaylistItem> items, Bitmap[] bitmaps) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_library);

        Intent openLibIntent = new Intent(context, MainActivity.class);
        openLibIntent.setAction(ACTION_OPEN_LIBRARY);
        openLibIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openLibPending = PendingIntent.getActivity(
            context,
            300,
            openLibIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_lib_root, openLibPending);
        views.setOnClickPendingIntent(R.id.widget_lib_open_all, openLibPending);

        if (items.isEmpty()) {
            views.setViewVisibility(R.id.widget_lib_row, View.GONE);
            views.setViewVisibility(R.id.widget_lib_empty, View.VISIBLE);
            return views;
        }

        views.setViewVisibility(R.id.widget_lib_row, View.VISIBLE);
        views.setViewVisibility(R.id.widget_lib_empty, View.GONE);

        int count = Math.min(4, items.size());
        for (int i = 0; i < 4; i++) {
            if (i < count) {
                PlaylistItem item = items.get(i);
                views.setViewVisibility(CARD_IDS[i], View.VISIBLE);
                views.setTextViewText(TITLE_IDS[i], item.name != null && !item.name.isEmpty() ? item.name : "Playlist");

                if (bitmaps != null && i < bitmaps.length && bitmaps[i] != null) {
                    views.setImageViewBitmap(ART_IDS[i], bitmaps[i]);
                }

                Intent cardIntent = new Intent(context, MainActivity.class);
                cardIntent.setAction(ACTION_OPEN_PLAYLIST);
                cardIntent.putExtra(EXTRA_PLAYLIST_ID, item.id);
                cardIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent cardPending = PendingIntent.getActivity(
                    context,
                    310 + i,
                    cardIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(CARD_IDS[i], cardPending);
            } else {
                views.setViewVisibility(CARD_IDS[i], View.GONE);
            }
        }

        return views;
    }

    private static List<PlaylistItem> loadPlaylists(Context context) {
        List<PlaylistItem> out = new ArrayList<>();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_PLAYLISTS_JSON, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < Math.min(4, arr.length()); i++) {
                JSONObject obj = arr.optJSONObject(i);
                if (obj == null) continue;
                PlaylistItem item = new PlaylistItem();
                item.id = obj.optString("id", "");
                item.name = obj.optString("name", "Playlist");
                item.coverUrl = obj.optString("coverUrl", "");
                item.coverColor = obj.optString("coverColor", "#63E8FF");
                JSONArray covers = obj.optJSONArray("trackCovers");
                if (covers != null) {
                    for (int j = 0; j < Math.min(4, covers.length()); j++) {
                        String u = covers.optString(j, "");
                        if (u != null && !u.isEmpty()) item.trackCovers.add(u);
                    }
                }
                if (!item.id.isEmpty()) out.add(item);
            }
        } catch (Exception ignored) {}
        return out;
    }

    private static Bitmap render3DPlaylistCover(PlaylistItem item, int sizePx) {
        Bitmap output = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);

        float pad = sizePx * 0.06f;
        float radius = sizePx * 0.17f;
        RectF cardRect = new RectF(pad, pad * 0.6f, sizePx - pad, sizePx - pad * 1.4f);

        // 1. Soft 3D elevation drop shadow underneath cover
        Paint shadowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        shadowPaint.setColor(Color.argb(150, 0, 0, 0));
        RectF shadowRect = new RectF(
            cardRect.left + 2f,
            cardRect.top + pad * 0.9f,
            cardRect.right - 2f,
            cardRect.bottom + pad * 0.95f
        );
        canvas.drawRoundRect(shadowRect, radius, radius, shadowPaint);

        // 2. Clip to rounded cover rectangle and draw artwork (custom cover OR 2x2 collage OR color gradient)
        canvas.save();
        Path clipPath = new Path();
        clipPath.addRoundRect(cardRect, radius, radius, Path.Direction.CW);
        canvas.clipPath(clipPath);

        int accent = parseSafeColor(item.coverColor, Color.parseColor("#63E8FF"));
        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setShader(new LinearGradient(
            cardRect.left, cardRect.top, cardRect.right, cardRect.bottom,
            accent, Color.parseColor("#111422"), Shader.TileMode.CLAMP
        ));
        canvas.drawRect(cardRect, bgPaint);

        boolean drewArt = false;
        if (item.coverUrl != null && !item.coverUrl.isEmpty()) {
            Bitmap bmp = loadBitmapFromSource(item.coverUrl, sizePx);
            if (bmp != null) {
                drawCenterCrop(canvas, bmp, cardRect);
                bmp.recycle();
                drewArt = true;
            }
        }

        if (!drewArt && !item.trackCovers.isEmpty()) {
            List<Bitmap> tiles = new ArrayList<>();
            for (String url : item.trackCovers) {
                Bitmap b = loadBitmapFromSource(url, sizePx / 2);
                if (b != null) tiles.add(b);
                if (tiles.size() == 4) break;
            }
            if (tiles.size() == 4) {
                float midX = (cardRect.left + cardRect.right) / 2f;
                float midY = (cardRect.top + cardRect.bottom) / 2f;
                drawCenterCrop(canvas, tiles.get(0), new RectF(cardRect.left, cardRect.top, midX, midY));
                drawCenterCrop(canvas, tiles.get(1), new RectF(midX, cardRect.top, cardRect.right, midY));
                drawCenterCrop(canvas, tiles.get(2), new RectF(cardRect.left, midY, midX, cardRect.bottom));
                drawCenterCrop(canvas, tiles.get(3), new RectF(midX, midY, cardRect.right, cardRect.bottom));
                drewArt = true;
            } else if (!tiles.isEmpty()) {
                drawCenterCrop(canvas, tiles.get(0), cardRect);
                drewArt = true;
            }
            for (Bitmap b : tiles) b.recycle();
        }

        // 3. 3D top-left specular glass sheen & bottom depth shading
        Paint glossPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        glossPaint.setShader(new LinearGradient(
            cardRect.left, cardRect.top, cardRect.right, cardRect.bottom,
            new int[] {
                Color.argb(85, 255, 255, 255),
                Color.argb(14, 255, 255, 255),
                Color.argb(0, 0, 0, 0),
                Color.argb(95, 0, 0, 0)
            },
            new float[] { 0f, 0.36f, 0.65f, 1f },
            Shader.TileMode.CLAMP
        ));
        canvas.drawRect(cardRect, glossPaint);
        canvas.restore();

        // 4. Crisp 3D specular rim border
        Paint rimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        rimPaint.setStyle(Paint.Style.STROKE);
        rimPaint.setStrokeWidth(2.2f);
        rimPaint.setColor(Color.argb(95, 255, 255, 255));
        canvas.drawRoundRect(cardRect, radius, radius, rimPaint);

        return output;
    }

    private static void drawCenterCrop(Canvas canvas, Bitmap src, RectF dst) {
        if (src == null || src.getWidth() <= 0 || src.getHeight() <= 0) return;
        float srcW = src.getWidth();
        float srcH = src.getHeight();
        float dstW = dst.width();
        float dstH = dst.height();
        float scale = Math.max(dstW / srcW, dstH / srcH);
        float cropW = dstW / scale;
        float cropH = dstH / scale;
        int left = Math.max(0, (int) ((srcW - cropW) / 2f));
        int top = Math.max(0, (int) ((srcH - cropH) / 2f));
        Rect srcRect = new Rect(left, top, Math.min(src.getWidth(), (int) (left + cropW)), Math.min(src.getHeight(), (int) (top + cropH)));
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        canvas.drawBitmap(src, srcRect, dst, p);
    }

    private static Bitmap loadBitmapFromSource(String src, int reqSize) {
        if (src == null || src.isEmpty()) return null;
        try {
            if (src.startsWith("data:image")) {
                int comma = src.indexOf(',');
                if (comma > 0) {
                    byte[] bytes = Base64.decode(src.substring(comma + 1), Base64.DEFAULT);
                    return decodeSampled(bytes, reqSize);
                }
                return null;
            }
            if (!src.startsWith("http://") && !src.startsWith("https://")) return null;
            HttpURLConnection conn = (HttpURLConnection) new URL(src).openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                try (InputStream in = conn.getInputStream()) {
                    Bitmap raw = BitmapFactory.decodeStream(in);
                    if (raw != null && (raw.getWidth() > reqSize * 2 || raw.getHeight() > reqSize * 2)) {
                        Bitmap scaled = Bitmap.createScaledBitmap(raw, reqSize, reqSize, true);
                        raw.recycle();
                        return scaled;
                    }
                    return raw;
                }
            }
            conn.disconnect();
        } catch (Exception ignored) {}
        return null;
    }

    private static Bitmap decodeSampled(byte[] bytes, int reqSize) {
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        int sample = 1;
        while ((opts.outWidth / sample) > reqSize * 2 && (opts.outHeight / sample) > reqSize * 2) {
            sample *= 2;
        }
        opts.inJustDecodeBounds = false;
        opts.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    }

    private static int parseSafeColor(String hex, int fallback) {
        try {
            if (hex != null && hex.startsWith("#")) return Color.parseColor(hex);
        } catch (Exception ignored) {}
        return fallback;
    }
}
