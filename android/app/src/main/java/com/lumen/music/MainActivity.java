package com.lumen.music;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LumenAudioPlugin.class);
        super.onCreate(savedInstanceState);

        // Prompt for notification permission on Android 13+ (API 33+) so lockscreen / notification player is visible
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
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
                }
            }
        } catch (Exception ignored) {}
    }
}
