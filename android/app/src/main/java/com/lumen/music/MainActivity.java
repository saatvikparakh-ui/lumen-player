package com.lumen.music;

import android.app.UiModeManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean isTvDevice = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LumenAudioPlugin.class);
        registerPlugin(LumenOtaPlugin.class);
        super.onCreate(savedInstanceState);

        // Apply staged/verified OTA web bundle if present (auto-rolls back on repeated boot failure)
        try {
            String otaBundlePath = LumenOtaPlugin.resolveStartupBundlePath(this);
            if (otaBundlePath != null && getBridge() != null) {
                getBridge().setServerBasePath(otaBundlePath);
            }
        } catch (Exception ignored) {}

        // Smart step-by-step in-app back navigation (never unexpectedly exits app when navigating inside Lumen)
        try {
            getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().evaluateJavascript(
                            "(function(){ try { return window.__lumenHandleAndroidBack ? window.__lumenHandleAndroidBack() : 'exit'; } catch(e) { return 'exit'; } })()",
                            value -> {
                                if (value != null && value.contains("exit")) {
                                    // Minimize cleanly to background while keeping ExoPlayer audio alive
                                    moveTaskToBack(true);
                                }
                            }
                        );
                    } else {
                        moveTaskToBack(true);
                    }
                }
            });
        } catch (Exception ignored) {}

        // Background cleanup of legacy files + automatic WebView/app cache budget enforcement
        new Thread(() -> {
            cleanupLegacyStorage(getApplicationContext());
            boolean clearedWebCache = trimWebViewAndAppCaches(getApplicationContext(), false) > 0;
            if (clearedWebCache) {
                runOnUiThread(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().clearCache(true);
                        }
                    } catch (Exception ignored) {}
                });
            }
        }).start();

        // Schedule lightweight periodic background checks for app updates, friend requests & Aux/social invites when closed
        LumenBackgroundSyncWorker.schedule(getApplicationContext());

        // Check if executing on an Android TV / Google TV / Leanback device
        try {
            UiModeManager uiModeManager = (UiModeManager) getSystemService(UI_MODE_SERVICE);
            if (uiModeManager != null && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                isTvDevice = true;
            }
            if (getPackageManager().hasSystemFeature("android.software.leanback") ||
                getPackageManager().hasSystemFeature("android.hardware.type.television") ||
                !getPackageManager().hasSystemFeature("android.hardware.touchscreen")) {
                isTvDevice = true;
            }
        } catch (Exception ignored) {}

        // Prompt for notification permission on Android 13+ (API 33+) so lockscreen / notification player is visible
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        // Request Battery Optimization Exemption so screen-off audio streaming and next-song transitions never stall
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(android.content.Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    android.content.Intent bIntent = new android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    bIntent.setData(android.net.Uri.parse("package:" + getPackageName()));
                    startActivity(bIntent);
                }
            } catch (Exception ignored) {}
        }
        
        try {
            // Apply Obsidian Dark #080A10 to the native decor view and system bars
            if (getWindow() != null) {
                getWindow().getDecorView().setBackgroundColor(Color.parseColor("#080A10"));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    getWindow().setStatusBarColor(Color.parseColor("#080A10"));
                    getWindow().setNavigationBarColor(Color.parseColor("#080A10"));
                }
            }
            
            // Apply dark background to the underlying WebView so it never flashes white
            if (getBridge() != null) {
                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.setBackgroundColor(Color.parseColor("#080A10"));
                    WebSettings settings = webView.getSettings();
                    settings.setDomStorageEnabled(true);
                    settings.setDatabaseEnabled(true);
                    settings.setJavaScriptEnabled(true);
                    settings.setSupportZoom(false);

                    // Signal TV mode to web layer via User Agent token
                    if (isTvDevice) {
                        String currentUa = settings.getUserAgentString();
                        settings.setUserAgentString(currentUa + " LumenTV");
                    }

                    // Forward initial deep-link intent (QR code / universal link) after WebView loads
                    handleDeepLinkIntent(getIntent());
                }
            }
        } catch (Exception ignored) {}
    }

    private static final long MAX_DISPOSABLE_CACHE_BYTES = 18L * 1024L * 1024L; // 18 MB strict ceiling

    @Override
    public void onStop() {
        super.onStop();
        // Keep Android storage flat across song switches: trim disposable caches whenever app goes to background
        final android.content.Context appCtx = getApplicationContext();
        new Thread(() -> {
            long freed = trimWebViewAndAppCaches(appCtx, false);
            if (freed > 0) {
                runOnUiThread(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().clearCache(true);
                        }
                    } catch (Exception ignored) {}
                });
            }
        }).start();
    }

    public static long cleanupLegacyStorage(android.content.Context ctx) {
        long freed = 0L;
        try {
            java.io.File filesDir = ctx.getFilesDir();
            java.io.File cacheDir = ctx.getCacheDir();
            freed += deletePathAndMeasure(new java.io.File(filesDir, "lumen_offline_vault"));
            freed += deletePathAndMeasure(new java.io.File(filesDir, "vosk-model-small-en-us-0.15"));
            freed += deletePathAndMeasure(new java.io.File(filesDir, "ota/apks"));
            freed += deletePathAndMeasure(new java.io.File(filesDir, "ota/staging"));
            freed += deletePathAndMeasure(new java.io.File(cacheDir, "vosk-model-small-en-us-0.15.zip"));
            String[] legacyDbs = new String[] {
                "lumen_offline_media.db",
                "lumen_offline_media.db-wal",
                "lumen_offline_media.db-shm",
                "lumen_offline_media.db-journal"
            };
            for (String dbName : legacyDbs) {
                freed += deletePathAndMeasure(ctx.getDatabasePath(dbName));
            }
            // Prune orphaned OTA web bundles (keep ONLY currently active or pending bundle)
            try {
                android.content.SharedPreferences otaPrefs =
                    ctx.getSharedPreferences(LumenOtaPlugin.PREFS_NAME, android.content.Context.MODE_PRIVATE);
                String activePath = otaPrefs.getString(LumenOtaPlugin.KEY_ACTIVE_PATH, null);
                String pendingPath = otaPrefs.getString(LumenOtaPlugin.KEY_PENDING_PATH, null);
                java.io.File bundlesDir = new java.io.File(filesDir, "ota/bundles");
                java.io.File[] children = bundlesDir.listFiles();
                if (children != null) {
                    for (java.io.File c : children) {
                        String p = c.getAbsolutePath();
                        boolean keep = (activePath != null && (activePath.equals(p) || activePath.startsWith(p + java.io.File.separator)))
                            || (pendingPath != null && (pendingPath.equals(p) || pendingPath.startsWith(p + java.io.File.separator)));
                        if (!keep) {
                            freed += deletePathAndMeasure(c);
                        }
                    }
                }
            } catch (Exception ignored) {}
        } catch (Exception ignored) {}
        return freed;
    }

    /**
     * Enforces a strict 18 MB cap on disposable WebView HTTP/GPU/Code caches and widget cover cache
     * (Android counts app_webview/ under "Data" and WebView/HTTP Cache under "Cache").
     * Strictly NEVER touches Local Storage, Cookies, Session Storage, or Firebase Auth login DB!
     */
    public static long trimWebViewAndAppCaches(android.content.Context ctx, boolean forceClearAll) {
        long freed = 0L;
        if (ctx == null) return 0L;
        try {
            java.io.File cacheDir = ctx.getCacheDir();
            java.io.File dataDir = new java.io.File(ctx.getApplicationInfo().dataDir);

            // 1. Always cap widget_artwork cache (max 15 files / 3 MB; or 0 if forceClearAll)
            java.io.File widgetCache = new java.io.File(cacheDir, "widget_artwork");
            if (forceClearAll) {
                freed += deletePathAndMeasure(widgetCache);
            } else {
                freed += LumenWidgetImageLoader.pruneWidgetDiskCache(widgetCache, 15, 3L * 1024L * 1024L);
            }

            // 2. Measure disposable Chromium WebView cache folders (HTTP Cache, Code Cache, GPUCache, Service Worker CacheStorage)
            java.io.File appWebView = new java.io.File(dataDir, "app_webview");
            java.io.File[] disposableDirs = new java.io.File[] {
                new java.io.File(cacheDir, "WebView/Default/HTTP Cache"),
                new java.io.File(cacheDir, "WebView/Default/Code Cache"),
                new java.io.File(cacheDir, "WebView/Default/GPUCache"),
                new java.io.File(cacheDir, "org.chromium.android_webview"),
                new java.io.File(appWebView, "Default/Cache"),
                new java.io.File(appWebView, "Default/Code Cache"),
                new java.io.File(appWebView, "Default/GPUCache"),
                new java.io.File(appWebView, "Default/Service Worker/CacheStorage"),
                new java.io.File(appWebView, "Cache"),
                new java.io.File(appWebView, "GPUCache")
            };

            long totalCacheBytes = 0L;
            if (!forceClearAll) {
                for (java.io.File d : disposableDirs) {
                    totalCacheBytes += measurePathBytes(d);
                }
            }

            if (forceClearAll || totalCacheBytes > MAX_DISPOSABLE_CACHE_BYTES) {
                for (java.io.File d : disposableDirs) {
                    freed += deleteChildrenAndMeasure(d);
                }
            }
        } catch (Exception ignored) {}
        return freed;
    }

    public static long measurePathBytes(java.io.File target) {
        if (target == null || !target.exists()) return 0L;
        if (!target.isDirectory()) return target.length();
        long total = 0L;
        java.io.File[] children = target.listFiles();
        if (children != null) {
            for (java.io.File c : children) {
                total += measurePathBytes(c);
            }
        }
        return total;
    }

    public static long deleteChildrenAndMeasure(java.io.File dir) {
        if (dir == null || !dir.exists() || !dir.isDirectory()) return 0L;
        long bytes = 0L;
        java.io.File[] children = dir.listFiles();
        if (children != null) {
            for (java.io.File c : children) {
                bytes += deletePathAndMeasure(c);
            }
        }
        return bytes;
    }

    public static long deletePathAndMeasure(java.io.File target) {
        if (target == null || !target.exists()) return 0L;
        long bytes = 0L;
        if (target.isDirectory()) {
            java.io.File[] children = target.listFiles();
            if (children != null) {
                for (java.io.File c : children) {
                    bytes += deletePathAndMeasure(c);
                }
            }
        } else {
            bytes += target.length();
        }
        target.delete();
        return bytes;
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent);
    }

    private void handleDeepLinkIntent(android.content.Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (LibraryWidgetProvider.ACTION_OPEN_PLAYLIST.equals(action) || LibraryWidgetProvider.ACTION_OPEN_LIBRARY.equals(action)) {
            final String playlistId = intent.getStringExtra(LibraryWidgetProvider.EXTRA_PLAYLIST_ID);
            if (getBridge() != null && getBridge().getWebView() != null) {
                final WebView webView = getBridge().getWebView();
                final String safeId = playlistId != null ? playlistId.replace("\\", "\\\\").replace("'", "\\'") : "";
                final String js = safeId.isEmpty()
                    ? "window.dispatchEvent(new CustomEvent('lumen:navigate', { detail: { view: 'playlist' } }));"
                    : "window.dispatchEvent(new CustomEvent('lumen:navigate', { detail: { view: 'playlist', playlistId: '" + safeId + "' } }));";
                webView.postDelayed(() -> webView.evaluateJavascript(js, null), 500);
            }
            return;
        }
        android.net.Uri data = intent.getData();
        if (data == null) return;
        final String url = data.toString();
        if (url == null || url.isEmpty()) return;
        if (getBridge() != null && getBridge().getWebView() != null) {
            final WebView webView = getBridge().getWebView();
            final String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'");
            webView.postDelayed(() -> {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('lumen-deep-link', { detail: { url: '" + safeUrl + "' } }));",
                    null
                );
            }, 600);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Forward TV remote media keys to web/bridge if applicable
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE ||
            keyCode == KeyEvent.KEYCODE_MEDIA_NEXT ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS) {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().dispatchKeyEvent(event);
            }
        }
        return super.onKeyDown(keyCode, event);
    }
}
