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

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LumenWidgetImageLoader {
    private static final int MAX_MEMORY = (int) (Runtime.getRuntime().maxMemory() / 1024);
    private static final int CACHE_SIZE = Math.max(1024, MAX_MEMORY / 8);
    private static final LruCache<String, Bitmap> BITMAP_CACHE = new LruCache<String, Bitmap>(CACHE_SIZE) {
        @Override
        protected int sizeOf(String key, Bitmap bitmap) {
            return bitmap.getByteCount() / 1024;
        }
    };

    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(2);

    /**
     * Loads album artwork asynchronously into RemoteViews with disk & memory caching
     * and downsampling to completely eliminate widget UI lag.
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
        if (cached != null && !cached.isRecycled()) {
            views.setImageViewBitmap(imageViewId, cached);
            return;
        }

        // Set fallback first so widget never appears empty or broken
        views.setImageViewResource(imageViewId, R.drawable.ic_widget_disc);

        final float density = context.getResources().getDisplayMetrics().density;
        final int targetPx = Math.max(64, Math.round(targetSizeDp * density));
        final int cornerPx = Math.round(cornerRadiusDp * density);

        EXECUTOR.execute(() -> {
            try {
                Bitmap bitmap = loadFromDiskCache(context, cleanUrl, targetPx);
                if (bitmap == null) {
                    bitmap = downloadAndCache(context, cleanUrl, targetPx);
                }

                if (bitmap != null) {
                    Bitmap squared = getRoundedSquareBitmap(bitmap, targetPx, cornerPx);
                    if (squared != null) {
                        BITMAP_CACHE.put(cleanUrl, squared);

                        RemoteViews updateViews = new RemoteViews(context.getPackageName(), views.getLayoutId());
                        updateViews.setImageViewBitmap(imageViewId, squared);
                        appWidgetManager.partiallyUpdateAppWidget(appWidgetId, updateViews);
                    }
                }
            } catch (Exception ignored) {
                // Keep fallback icon on error
            }
        });
    }

    private static Bitmap loadFromDiskCache(Context context, String url, int targetPx) {
        try {
            File cacheDir = new File(context.getCacheDir(), "widget_artwork");
            if (!cacheDir.exists()) return null;

            String hash = hashUrl(url);
            File file = new File(cacheDir, hash + ".bin");
            if (!file.exists() || file.length() == 0) return null;

            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getAbsolutePath(), opts);

            opts.inSampleSize = calculateInSampleSize(opts, targetPx, targetPx);
            opts.inJustDecodeBounds = false;
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;

            return BitmapFactory.decodeFile(file.getAbsolutePath(), opts);
        } catch (Exception e) {
            return null;
        }
    }

    private static Bitmap downloadAndCache(Context context, String cleanUrl, int targetPx) {
        try {
            URL url = new URL(cleanUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setDoInput(true);
            conn.connect();

            if (conn.getResponseCode() != 200) {
                conn.disconnect();
                return null;
            }

            File cacheDir = new File(context.getCacheDir(), "widget_artwork");
            if (!cacheDir.exists()) cacheDir.mkdirs();

            String hash = hashUrl(cleanUrl);
            File tempFile = new File(cacheDir, hash + ".tmp");
            File finalFile = new File(cacheDir, hash + ".bin");

            InputStream input = conn.getInputStream();
            FileOutputStream output = new FileOutputStream(tempFile);
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
            output.close();
            input.close();
            conn.disconnect();

            if (tempFile.exists()) {
                tempFile.renameTo(finalFile);
            }

            return loadFromDiskCache(context, cleanUrl, targetPx);
        } catch (Exception e) {
            return null;
        }
    }

    private static int calculateInSampleSize(BitmapFactory.Options options, int reqWidth, int reqHeight) {
        final int height = options.outHeight;
        final int width = options.outWidth;
        int inSampleSize = 1;

        if (height > reqHeight || width > reqWidth) {
            final int halfHeight = height / 2;
            final int halfWidth = width / 2;
            while ((halfHeight / inSampleSize) >= reqHeight && (halfWidth / inSampleSize) >= reqWidth) {
                inSampleSize *= 2;
            }
        }
        return Math.max(1, inSampleSize);
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

    private static String hashUrl(String url) {
        try {
            MessageDigest digest = MessageDigest.getInstance("MD5");
            byte[] hash = digest.digest(url.getBytes("UTF-8"));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            return String.valueOf(url.hashCode());
        }
    }
}
