package com.lumen.music;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.util.LruCache;
import android.widget.RemoteViews;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LumenWidgetImageLoader {
    private static final int MAX_MEMORY = (int) (Runtime.getRuntime().maxMemory() / 1024);
    private static final int CACHE_SIZE = MAX_MEMORY / 8; // 1/8th of available memory for widget art
    private static final LruCache<String, Bitmap> BITMAP_CACHE = new LruCache<String, Bitmap>(CACHE_SIZE) {
        @Override
        protected int sizeOf(String key, Bitmap bitmap) {
            return bitmap.getByteCount() / 1024;
        }
    };

    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(2);

    /**
     * Loads album artwork asynchronously into RemoteViews without blocking the main UI thread.
     */
    public static void loadArtwork(
            Context context,
            AppWidgetManager appWidgetManager,
            int appWidgetId,
            RemoteViews views,
            int imageViewId,
            String artworkUrl,
            int targetSizeDp,
            int cornerRadiusDp
    ) {
        if (artworkUrl == null || artworkUrl.trim().isEmpty()) {
            views.setImageViewResource(imageViewId, R.drawable.ic_widget_disc);
            return;
        }

        final String cleanUrl = artworkUrl.trim();
        Bitmap cached = BITMAP_CACHE.get(cleanUrl);
        if (cached != null) {
            views.setImageViewBitmap(imageViewId, cached);
            return;
        }

        // Set fallback first so it never appears broken
        views.setImageViewResource(imageViewId, R.drawable.ic_widget_disc);

        // Fetch & decode on worker thread
        final float density = context.getResources().getDisplayMetrics().density;
        final int targetPx = Math.round(targetSizeDp * density);
        final int cornerPx = Math.round(cornerRadiusDp * density);

        EXECUTOR.execute(() -> {
            try {
                URL url = new URL(cleanUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setDoInput(true);
                conn.connect();

                InputStream input = conn.getInputStream();
                Bitmap raw = BitmapFactory.decodeStream(input);
                input.close();
                conn.disconnect();

                if (raw != null) {
                    Bitmap squared = getRoundedSquareBitmap(raw, targetPx, cornerPx);
                    if (squared != null) {
                        BITMAP_CACHE.put(cleanUrl, squared);

                        // Partially update only the artwork view in the active widget
                        RemoteViews updateViews = new RemoteViews(context.getPackageName(), views.getLayoutId());
                        updateViews.setImageViewBitmap(imageViewId, squared);
                        appWidgetManager.partiallyUpdateAppWidget(appWidgetId, updateViews);
                    }
                }
            } catch (Exception ignored) {
                // If fetch fails (e.g. offline), fallback icon remains displayed
            }
        });
    }

    private static Bitmap getRoundedSquareBitmap(Bitmap src, int targetSize, int cornerRadius) {
        if (src == null) return null;
        try {
            int width = src.getWidth();
            int height = src.getHeight();
            int size = Math.min(width, height);
            int x = (width - size) / 2;
            int y = (height - size) / 2;

            Bitmap cropped = Bitmap.createBitmap(src, x, y, size, size);
            Bitmap scaled = Bitmap.createScaledBitmap(cropped, targetSize, targetSize, true);
            if (cropped != src && !cropped.isRecycled()) cropped.recycle();

            Bitmap output = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(output);

            final Paint paint = new Paint();
            paint.setAntiAlias(true);
            paint.setColor(0xFF000000);

            final Rect rect = new Rect(0, 0, targetSize, targetSize);
            final RectF rectF = new RectF(rect);

            canvas.drawRoundRect(rectF, cornerRadius, cornerRadius, paint);
            paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
            canvas.drawBitmap(scaled, rect, rect, paint);

            if (scaled != src && !scaled.isRecycled()) scaled.recycle();
            return output;
        } catch (Throwable t) {
            return src;
        }
    }
}
