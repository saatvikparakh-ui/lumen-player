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
