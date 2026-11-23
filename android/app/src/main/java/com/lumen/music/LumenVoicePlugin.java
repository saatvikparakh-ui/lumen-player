package com.lumen.music;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(
    name = "LumenVoice",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class LumenVoicePlugin extends Plugin {
    private static volatile LumenVoicePlugin instance;
    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private volatile boolean isDownloadingVosk = false;

    // Official Apache-2.0 small English Vosk offline speech pack (~40 MB, zero API keys)
    private static final String VOSK_MODEL_URL =
        "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";

    public static LumenVoicePlugin getInstance() {
        return instance;
    }

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        instance = null;
        downloadExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private String resolveMicPermissionStatus() {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED) {
            return "granted";
        }
        PermissionState state = getPermissionState("microphone");
        if (state == PermissionState.DENIED) {
            return "denied";
        }
        return "prompt";
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", resolveMicPermissionStatus());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if ("granted".equals(resolveMicPermissionStatus())) {
            JSObject ret = new JSObject();
            ret.put("status", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", resolveMicPermissionStatus());
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("opened", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        boolean onDevice = LumenVoiceService.isOnDeviceRecognitionAvailable(getContext());
        boolean voskInstalled = LumenVoiceService.isVoskModelInstalled(getContext());
        String activeEngine = onDevice
            ? "android_on_device"
            : (voskInstalled ? "vosk_offline" : "unavailable");

        JSObject ret = new JSObject();
        ret.put("platform", "android");
        ret.put("supported", onDevice || voskInstalled);
        ret.put("androidSdkInt", Build.VERSION.SDK_INT);
        ret.put("onDeviceRecognizerSupported", onDevice);
        ret.put("voskModelInstalled", voskInstalled);
        ret.put("voskModelSizeMb", 40);
        ret.put("activeEngine", activeEngine);
        if (!onDevice && !voskInstalled) {
            ret.put(
                "reason",
                Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                    ? "Requires Android 12+ on-device speech recognition or the optional 40 MB offline voice pack."
                    : "Enable on-device English speech recognition in Android Settings or download the 40 MB offline voice pack."
            );
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadVoskModel(PluginCall call) {
        if (LumenVoiceService.isVoskModelInstalled(getContext())) {
            JSObject ret = new JSObject();
            ret.put("installed", true);
            call.resolve(ret);
            return;
        }
        if (isDownloadingVosk) {
            JSObject ret = new JSObject();
            ret.put("installed", false);
            ret.put("error", "Offline voice pack download already in progress.");
            call.resolve(ret);
            return;
        }

        isDownloadingVosk = true;
        downloadExecutor.execute(() -> {
            File zipFile = new File(getContext().getCacheDir(), "vosk-model-small-en-us-0.15.zip");
            File targetRoot = getContext().getFilesDir();
            try {
                emitVoskProgress(2, "downloading", "Connecting to offline voice pack...");
                URL url = new URL(VOSK_MODEL_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.connect();

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("HTTP " + code);
                }

                long total = conn.getContentLengthLong();
                long downloaded = 0L;
                int lastPct = 2;

                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(zipFile)) {
                    byte[] buf = new byte[16384];
                    int read;
                    while ((read = in.read(buf)) != -1) {
                        out.write(buf, 0, read);
                        downloaded += read;
                        if (total > 0) {
                            int pct = (int) Math.min(82, (downloaded * 82) / total);
                            if (pct >= lastPct + 3) {
                                lastPct = pct;
                                emitVoskProgress(pct, "downloading", "Downloading offline English pack...");
                            }
                        }
                    }
                }

                emitVoskProgress(85, "extracting", "Extracting offline voice pack...");
                String canonicalRoot = targetRoot.getCanonicalPath() + File.separator;
                try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(zipFile)))) {
                    ZipEntry entry;
                    byte[] buf = new byte[16384];
                    while ((entry = zis.getNextEntry()) != null) {
                        File outFile = new File(targetRoot, entry.getName());
                        // Zip-slip path traversal guard
                        if (!outFile.getCanonicalPath().startsWith(canonicalRoot)) {
                            throw new SecurityException("Blocked invalid zip path");
                        }
                        if (entry.isDirectory()) {
                            outFile.mkdirs();
                        } else {
                            File parent = outFile.getParentFile();
                            if (parent != null && !parent.exists()) parent.mkdirs();
                            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                                int len;
                                while ((len = zis.read(buf)) > 0) {
                                    fos.write(buf, 0, len);
                                }
                            }
                        }
                        zis.closeEntry();
                    }
                }

                if (zipFile.exists()) zipFile.delete();
                emitVoskProgress(100, "ready", "Offline voice pack ready.");
                JSObject ret = new JSObject();
                ret.put("installed", true);
                call.resolve(ret);
            } catch (Exception e) {
                if (zipFile.exists()) zipFile.delete();
                emitVoskProgress(0, "error", e.getMessage());
                JSObject ret = new JSObject();
                ret.put("installed", false);
                ret.put("error", e.getMessage() != null ? e.getMessage() : "Download failed.");
                call.resolve(ret);
            } finally {
                isDownloadingVosk = false;
            }
        });
    }

    @PluginMethod
    public void startHandsFree(PluginCall call) {
        if (!"granted".equals(resolveMicPermissionStatus())) {
            JSObject ret = new JSObject();
            ret.put("started", false);
            ret.put("error", "Microphone permission not granted.");
            call.resolve(ret);
            return;
        }

        if (!LumenVoiceService.isOnDeviceRecognitionAvailable(getContext())) {
            JSObject ret = new JSObject();
            ret.put("started", false);
            ret.put("error", "Android on-device speech recognition is unavailable on this device.");
            call.resolve(ret);
            return;
        }

        try {
            Intent intent = new Intent(getContext(), LumenVoiceService.class);
            intent.setAction(LumenVoiceService.ACTION_START_VOICE);
            ContextCompat.startForegroundService(getContext(), intent);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("started", false);
            ret.put("error", e.getMessage() != null ? e.getMessage() : "Could not start voice service.");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void stopHandsFree(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), LumenVoiceService.class);
            intent.setAction(LumenVoiceService.ACTION_STOP_VOICE);
            getContext().startService(intent);
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void beginFollowUpCapture(PluginCall call) {
        long timeoutMs = call.getInt("timeoutMs", 10000);
        try {
            Intent intent = new Intent(getContext(), LumenVoiceService.class);
            intent.setAction(LumenVoiceService.ACTION_FOLLOW_UP);
            intent.putExtra(LumenVoiceService.EXTRA_TIMEOUT_MS, timeoutMs);
            getContext().startService(intent);
            JSObject ret = new JSObject();
            ret.put("capturing", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("capturing", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        boolean expectFollowUp = Boolean.TRUE.equals(call.getBoolean("expectFollowUp", false));
        LumenVoiceService svc = LumenVoiceService.getInstance();
        if (svc != null) {
            svc.speakLocal(text, expectFollowUp);
        } else {
            try {
                Intent intent = new Intent(getContext(), LumenVoiceService.class);
                intent.setAction(LumenVoiceService.ACTION_SPEAK);
                intent.putExtra(LumenVoiceService.EXTRA_SPEAK_TEXT, text);
                intent.putExtra(LumenVoiceService.EXTRA_EXPECT_FOLLOW_UP, expectFollowUp);
                getContext().startService(intent);
            } catch (Exception ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("spoken", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setDucking(PluginCall call) {
        boolean ducked = Boolean.TRUE.equals(call.getBoolean("ducked", false));
        LumenPlaybackService playback = LumenPlaybackService.getInstance();
        if (playback != null) {
            playback.setVoiceDucking(ducked);
        }
        JSObject ret = new JSObject();
        ret.put("ducked", ducked);
        call.resolve(ret);
    }

    public void emitTranscript(
        String text,
        boolean isFinal,
        String utteranceId,
        long timestampMs,
        boolean handledNatively,
        @Nullable String nativeAction
    ) {
        JSObject payload = new JSObject();
        payload.put("text", text);
        payload.put("isFinal", isFinal);
        payload.put("utteranceId", utteranceId);
        payload.put("timestampMs", timestampMs);
        payload.put("handledNatively", handledNatively);
        if (nativeAction != null) {
            payload.put("nativeAction", nativeAction);
        }
        notifyListeners("onVoiceTranscript", payload);
    }

    public void emitState(String state, @Nullable String message) {
        JSObject payload = new JSObject();
        payload.put("state", state);
        if (message != null) {
            payload.put("message", message);
        }
        notifyListeners("onVoiceState", payload);
    }

    private void emitVoskProgress(int percent, String stage, @Nullable String message) {
        JSObject payload = new JSObject();
        payload.put("percent", percent);
        payload.put("stage", stage);
        if (message != null) {
            payload.put("message", message);
        }
        notifyListeners("onVoskDownloadProgress", payload);
    }
}
