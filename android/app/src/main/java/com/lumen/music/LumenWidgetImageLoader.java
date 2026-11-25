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
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.RemoteViews;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LumenWidgetImageLoader {
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    private static final int MAX_MEMORY = (int) (Runtime.getRuntime().maxMemory() / 1024);
    private static final int CACHE_SIZE = Math.max(2048, MAX_MEMORY / 8);

    private static final LruCache<String, Bitmap> BITMAP_CACHE = new LruCache<String, Bitmap>(CACHE_SIZE) {
        @Override
        protected int sizeOf(String key, Bitmap bitmap) {
            return bitmap.getByteCount() / 1024;
        }
    };

    private static final LruCache<String, Bitmap> RAW_BITMAP_CACHE = new LruCache<String, Bitmap>(CACHE_SIZE) {
        @Override
        protected int sizeOf(String key, Bitmap bitmap) {
            return bitmap.getByteCount() / 1024;
        }
    };

    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(2);
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());

    /**
     * Downloads a bitmap from HTTP/HTTPS with browser User-Agent and up to 5 redirect hops.
     * Shared by both the media notification and home-screen widgets.
     */
    public static Bitmap downloadBitmapWithRedirects(String rawUrl, int timeoutMs) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return null;
        String currentUrl = rawUrl.trim();
        for (int hop = 0; hop < 5; hop++) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(currentUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(timeoutMs);
                conn.setReadTimeout(timeoutMs);
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
                conn.setDoInput(true);
                conn.connect();

                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == HttpURLConnection.HTTP_SEE_OTHER
                        || code == 307
                        || code == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (location == null || location.trim().isEmpty()) return null;
                    currentUrl = new URL(url, location.trim()).toString();
                    continue;
                }

                if (code < 200 || code >= 300) {
                    conn.disconnect();
                    return null;
                }

                try (InputStream is = conn.getInputStream();
                     ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = is.read(buffer)) != -1) {
                        baos.write(buffer, 0, read);
                    }
                    byte[] bytes = baos.toByteArray();
                    if (bytes.length == 0) return null;
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                    opts.inSampleSize = calculateInSampleSize(opts, 512, 512);
                    opts.inJustDecodeBounds = false;
                    opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                    return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                }
            } catch (Exception ignored) {
                return null;
            } finally {
                if (conn != null) {
                    try {
                        conn.disconnect();
                    } catch (Exception ignored) {}
                }
            }
        }
        return null;
    }

    /**
     * Shares an already-downloaded notification bitmap directly into the widget cache so widgets
     * show the new album cover immediately without waiting for a second network request.
     */
    public static void putCachedArtwork(Context context, String artworkUrl, Bitmap rawBitmap) {
        if (artworkUrl == null || artworkUrl.trim().isEmpty() || rawBitmap == null || rawBitmap.isRecycled()) {
            return;
        }
        String cleanUrl = artworkUrl.trim();
        RAW_BITMAP_CACHE.put(cleanUrl, rawBitmap);
        try {
            File cacheDir = new File(context.getCacheDir(), "widget_artwork");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            File finalFile = new File(cacheDir, hashUrl(cleanUrl) + ".bin");
            if (!finalFile.exists() || finalFile.length() == 0) {
                File tempFile = new File(cacheDir, hashUrl(cleanUrl) + ".tmp");
                try (FileOutputStream fos = new FileOutputStream(tempFile)) {
                    rawBitmap.compress(Bitmap.CompressFormat.JPEG, 82, fos);
                    fos.flush();
                }
                if (tempFile.exists()) {
                    tempFile.renameTo(finalFile);
                }
            } else {
                finalFile.setLastModified(System.currentTimeMillis());
            }
            pruneWidgetDiskCache(cacheDir, 15, 3L * 1024L * 1024L);
        } catch (Exception ignored) {}
    }

    /**
     * Strictly caps widget_artwork disk cache to at most maxFiles / maxBytes (evicting oldest first)
     * so switching hundreds of songs never accumulates stale cover JPEGs on disk.
     */
    public static long pruneWidgetDiskCache(File cacheDir, int maxFiles, long maxBytes) {
        long freed = 0L;
        if (cacheDir == null || !cacheDir.exists() || !cacheDir.isDirectory()) return 0L;
        try {
            File[] files = cacheDir.listFiles();
            if (files == null || files.length == 0) return 0L;
            java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            long keptBytes = 0L;
            for (int i = 0; i < files.length; i++) {
                File f = files[i];
                long len = f.length();
                if (i >= maxFiles || keptBytes + len > maxBytes || f.getName().endsWith(".tmp")) {
                    if (f.delete()) freed += len;
                } else {
                    keptBytes += len;
                }
            }
        } catch (Exception ignored) {}
        return freed;
    }

    /**
     * Loads album artwork into RemoteViews with instant memory/disk cache hit and reliable
     * full-widget refresh on download completion (compatible with Samsung One UI & Android 12–15).
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
        final float density = context.getResources().getDisplayMetrics().density;
        final int targetPx = Math.max(64, Math.round(targetSizeDp * density));
        final int cornerPx = Math.round(cornerRadiusDp * density);
        final String sizedKey = cleanUrl + "@" + targetPx + "_" + cornerPx;

        Bitmap cached = BITMAP_CACHE.get(sizedKey);
        if (cached != null && !cached.isRecycled()) {
            views.setImageViewBitmap(imageViewId, cached);
            return;
        }

        // Fast synchronous hit from shared notification/raw bitmap cache!
        Bitmap rawCached = RAW_BITMAP_CACHE.get(cleanUrl);
        if (rawCached != null && !rawCached.isRecycled()) {
            Bitmap squared = getRoundedSquareBitmap(rawCached, targetPx, cornerPx);
            if (squared != null) {
                BITMAP_CACHE.put(sizedKey, squared);
                views.setImageViewBitmap(imageViewId, squared);
                return;
            }
        }

        // Fast synchronous hit from disk cache if already saved
        Bitmap diskCached = loadFromDiskCache(context, cleanUrl, targetPx);
        if (diskCached != null && !diskCached.isRecycled()) {
            RAW_BITMAP_CACHE.put(cleanUrl, diskCached);
            Bitmap squared = getRoundedSquareBitmap(diskCached, targetPx, cornerPx);
            if (squared != null) {
                BITMAP_CACHE.put(sizedKey, squared);
                views.setImageViewBitmap(imageViewId, squared);
                return;
            }
        }

        // Set fallback first while downloading asynchronously
        views.setImageViewResource(imageViewId, R.drawable.ic_widget_disc);

        final Context appCtx = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                Bitmap bitmap = downloadAndCache(appCtx, cleanUrl, targetPx);
                if (bitmap != null && !bitmap.isRecycled()) {
                    RAW_BITMAP_CACHE.put(cleanUrl, bitmap);
                    Bitmap squared = getRoundedSquareBitmap(bitmap, targetPx, cornerPx);
                    if (squared != null) {
                        BITMAP_CACHE.put(sizedKey, squared);
                    }
                    // Verify track did not change while downloading, then push full widget refresh
                    LumenPlaybackState latest = LumenPlaybackState.get();
                    if (latest.artworkUrl != null && cleanUrl.equals(latest.artworkUrl.trim())) {
                        MAIN_HANDLER.post(() -> {
                            CompactWidgetProvider.updateAllWidgets(appCtx);
                            NowPlayingWidgetProvider.updateAllWidgets(appCtx);
                        });
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
        Bitmap bmp = downloadBitmapWithRedirects(cleanUrl, 8000);
        if (bmp == null) return null;
        putCachedArtwork(context, cleanUrl, bmp);
        Bitmap disk = loadFromDiskCache(context, cleanUrl, targetPx);
        return disk != null ? disk : bmp;
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
        if (src == null || src.isRecycled()) return null;
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
