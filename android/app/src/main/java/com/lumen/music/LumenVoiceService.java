package com.lumen.music;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Foreground microphone service for hands-free on-device "Hey Lumen" voice control.
 * - Strictly local on-device speech recognition (Android 12+ On-Device SpeechRecognizer).
 * - Never sends audio to cloud speech APIs or writes audio to disk.
 * - Never forces Bluetooth SCO call audio mode.
 * - Owns only temporary ducking delta on LumenPlaybackService during active command capture.
 */
public class LumenVoiceService extends Service {
    public static final String ACTION_START_VOICE = "com.lumen.music.action.START_VOICE";
    public static final String ACTION_STOP_VOICE = "com.lumen.music.action.STOP_VOICE";
    public static final String ACTION_SPEAK = "com.lumen.music.action.SPEAK";
    public static final String ACTION_FOLLOW_UP = "com.lumen.music.action.FOLLOW_UP";

    public static final String EXTRA_SPEAK_TEXT = "speak_text";
    public static final String EXTRA_EXPECT_FOLLOW_UP = "expect_follow_up";
    public static final String EXTRA_TIMEOUT_MS = "timeout_ms";

    public static final String VOICE_CHANNEL_ID = "lumen_voice_channel";
    public static final int VOICE_NOTIFICATION_ID = 2002;
    public static final String VOSK_MODEL_DIR_NAME = "vosk-model-small-en-us-0.15";

    private static volatile LumenVoiceService instance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer speechRecognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private volatile boolean isRunning = false;
    private volatile boolean isListeningActive = false;
    private volatile boolean isSpeaking = false;
    private volatile boolean pendingFollowUpAfterSpeech = false;
    private volatile boolean inCommandCapture = false;
    private long commandCaptureDeadlineMs = 0L;
    private int consecutiveErrors = 0;

    private static final Pattern WAKE_PREFIX = Pattern.compile(
        "^(?:hey|ok|okay|hi)\\s+(?:lumen|loomen|lumin|lumina|luman|human)(?:[,:.\\s-]+|$)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern BARE_WAKE_PREFIX = Pattern.compile(
        "^lumen(?:[,:.\\s-]+|$)",
        Pattern.CASE_INSENSITIVE
    );

    public static LumenVoiceService getInstance() {
        return instance;
    }

    public static boolean isOnDeviceRecognitionAvailable(Context ctx) {
        if (ctx == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                return SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx);
            } catch (Exception ignored) {
                return false;
            }
        }
        return false;
    }

    public static File getVoskModelDir(Context ctx) {
        return new File(ctx.getFilesDir(), VOSK_MODEL_DIR_NAME);
    }

    public static boolean isVoskModelInstalled(Context ctx) {
        if (ctx == null) return false;
        File dir = getVoskModelDir(ctx);
        return dir.exists() && dir.isDirectory() && new File(dir, "am").exists();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        initTts();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START_VOICE;

        if (ACTION_STOP_VOICE.equals(action)) {
            stopHandsFreeInternal();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_SPEAK.equals(action) && intent != null) {
            String text = intent.getStringExtra(EXTRA_SPEAK_TEXT);
            boolean followUp = intent.getBooleanExtra(EXTRA_EXPECT_FOLLOW_UP, false);
            speakLocal(text, followUp);
            return START_STICKY;
        }

        if (ACTION_FOLLOW_UP.equals(action) && intent != null) {
            long timeoutMs = intent.getLongExtra(EXTRA_TIMEOUT_MS, 10000L);
            if (isRunning) {
                enterCommandCapture(timeoutMs);
            }
            return START_STICKY;
        }

        // Verify RECORD_AUDIO permission before starting microphone foreground service
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            emitState("error", "Microphone permission is required for Hey Lumen.");
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!isOnDeviceRecognitionAvailable(this)) {
            emitState("error", "On-device Android speech pack not available on this device.");
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundWithNotification("Waiting for \"Hey Lumen\"");
        isRunning = true;
        inCommandCapture = false;
        consecutiveErrors = 0;

        mainHandler.post(() -> {
            ensureRecognizer();
            emitState("waiting_wake", null);
            scheduleRestartListening(120);
        });

        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                VOICE_CHANNEL_ID,
                "Hey Lumen Voice Control",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Ongoing indicator while Lumen listens locally for \"Hey Lumen\".");
            channel.setShowBadge(false);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String statusText) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPending = PendingIntent.getActivity(
            this,
            201,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, LumenVoiceService.class);
        stopIntent.setAction(ACTION_STOP_VOICE);
        PendingIntent stopPending = PendingIntent.getService(
            this,
            202,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, VOICE_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Lumen Hands-Free Voice")
            .setContentText(statusText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(contentPending)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPending)
            .build();
    }

    private void startForegroundWithNotification(String statusText) {
        Notification notification = buildNotification(statusText);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(VOICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(VOICE_NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(String statusText) {
        if (!isRunning) return;
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(VOICE_NOTIFICATION_ID, buildNotification(statusText));
            }
        } catch (Exception ignored) {}
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    tts.setLanguage(Locale.US);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        AudioAttributes attrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build();
                        tts.setAudioAttributes(attrs);
                    }
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {
                            isSpeaking = true;
                        }

                        @Override
                        public void onDone(String utteranceId) {
                            onTtsFinished();
                        }

                        @Override
                        public void onError(String utteranceId) {
                            onTtsFinished();
                        }
                    });
                    ttsReady = true;
                }
            });
        } catch (Exception ignored) {
            ttsReady = false;
        }
    }

    private void onTtsFinished() {
        mainHandler.post(() -> {
            isSpeaking = false;
            if (!isRunning) {
                setPlaybackDucked(false);
                return;
            }
            if (pendingFollowUpAfterSpeech) {
                pendingFollowUpAfterSpeech = false;
                enterCommandCapture(10000L);
            } else {
                setPlaybackDucked(false);
                inCommandCapture = false;
                emitState("waiting_wake", null);
                updateNotification("Waiting for \"Hey Lumen\"");
                scheduleRestartListening(280);
            }
        });
    }

    public void speakLocal(String text, boolean expectFollowUp) {
        if (text == null || text.trim().isEmpty()) {
            if (expectFollowUp && isRunning) {
                enterCommandCapture(10000L);
            }
            return;
        }

        mainHandler.post(() -> {
            pendingFollowUpAfterSpeech = expectFollowUp;
            if (!ttsReady || tts == null) {
                if (expectFollowUp && isRunning) {
                    enterCommandCapture(10000L);
                } else {
                    setPlaybackDucked(false);
                }
                return;
            }

            // Pause recognizer while Lumen speaks so Lumen never self-triggers on its own TTS voice
            isSpeaking = true;
            cancelRecognizerQuietly();
            setPlaybackDucked(true);
            emitState("speaking", text);

            Bundle params = new Bundle();
            params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "lumen_tts_" + System.currentTimeMillis());
        });
    }

    private void playSubtleWakeChime() {
        try {
            // Brief soft beep on STREAM_MUSIC (never STREAM_VOICE_CALL / SCO)
            ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_MUSIC, 38);
            tg.startTone(ToneGenerator.TONE_PROP_BEEP, 90);
            mainHandler.postDelayed(tg::release, 220);
        } catch (Exception ignored) {}
    }

    private void setPlaybackDucked(boolean ducked) {
        LumenPlaybackService playback = LumenPlaybackService.getInstance();
        if (playback != null) {
            mainHandler.post(() -> playback.setVoiceDucking(ducked));
        }
    }

    private void enterCommandCapture(long timeoutMs) {
        mainHandler.post(() -> {
            if (!isRunning || isSpeaking) return;
            inCommandCapture = true;
            commandCaptureDeadlineMs = System.currentTimeMillis() + Math.max(4000L, timeoutMs);
            setPlaybackDucked(true);
            emitState("listening", null);
            updateNotification("Listening for command...");
            cancelRecognizerQuietly();
            scheduleRestartListening(120);

            mainHandler.removeCallbacks(commandTimeoutRunnable);
            mainHandler.postDelayed(commandTimeoutRunnable, Math.max(4000L, timeoutMs));
        });
    }

    private final Runnable commandTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (inCommandCapture && System.currentTimeMillis() >= commandCaptureDeadlineMs) {
                inCommandCapture = false;
                setPlaybackDucked(false);
                if (isRunning) {
                    emitState("waiting_wake", null);
                    updateNotification("Waiting for \"Hey Lumen\"");
                    cancelRecognizerQuietly();
                    scheduleRestartListening(200);
                }
            }
        }
    };

    private void ensureRecognizer() {
        if (speechRecognizer != null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            speechRecognizer.setRecognitionListener(recognitionListener);
        }
    }

    private void cancelRecognizerQuietly() {
        isListeningActive = false;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
            } catch (Exception ignored) {}
        }
    }

    private final Runnable restartListeningRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isRunning || isSpeaking) return;
            startRecognitionCycle();
        }
    };

    private void scheduleRestartListening(long delayMs) {
        mainHandler.removeCallbacks(restartListeningRunnable);
        if (!isRunning || isSpeaking) return;
        mainHandler.postDelayed(restartListeningRunnable, delayMs);
    }

    private void startRecognitionCycle() {
        if (!isRunning || isSpeaking || isListeningActive) return;
        ensureRecognizer();
        if (speechRecognizer == null) {
            emitState("error", "On-device speech recognizer unavailable.");
            return;
        }

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, inCommandCapture ? 1400L : 900L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, inCommandCapture ? 1100L : 750L);

        try {
            isListeningActive = true;
            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            isListeningActive = false;
            scheduleRestartListening(600);
        }
    }

    private final RecognitionListener recognitionListener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            consecutiveErrors = 0;
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {
            // Audio stays strictly in memory and is never persisted.
        }

        @Override
        public void onEndOfSpeech() {
            isListeningActive = false;
        }

        @Override
        public void onError(int error) {
            isListeningActive = false;
            if (!isRunning || isSpeaking) return;

            if (inCommandCapture && System.currentTimeMillis() >= commandCaptureDeadlineMs) {
                inCommandCapture = false;
                setPlaybackDucked(false);
                emitState("waiting_wake", null);
                updateNotification("Waiting for \"Hey Lumen\"");
            }

            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                emitState("error", "Microphone permission revoked.");
                stopHandsFreeInternal();
                stopSelf();
                return;
            }

            consecutiveErrors++;
            long backoffMs = (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
                ? 180L
                : Math.min(2500L, 350L * consecutiveErrors);

            if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && speechRecognizer != null) {
                try {
                    speechRecognizer.cancel();
                } catch (Exception ignored) {}
            }

            scheduleRestartListening(backoffMs);
        }

        @Override
        public void onResults(Bundle results) {
            isListeningActive = false;
            if (!isRunning || isSpeaking) return;

            ArrayList<String> matches = results != null
                ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                : null;
            String transcript = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";

            handleRecognizedUtterance(transcript != null ? transcript.trim() : "");
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            if (!isRunning || isSpeaking || inCommandCapture) return;
            ArrayList<String> partial = partialResults != null
                ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                : null;
            if (partial != null && !partial.isEmpty()) {
                String text = partial.get(0);
                if (text != null && startsWithWakePhrase(text)) {
                    // Duck immediately once wake phrase is heard so command capture is clean
                    setPlaybackDucked(true);
                    emitState("listening", null);
                    updateNotification("Listening...");
                }
            }
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    };

    private boolean startsWithWakePhrase(String text) {
        String trimmed = text.trim();
        return WAKE_PREFIX.matcher(trimmed).find() || BARE_WAKE_PREFIX.matcher(trimmed).find();
    }

    private String stripWakePhrase(String text) {
        String trimmed = text.trim();
        Matcher m1 = WAKE_PREFIX.matcher(trimmed);
        if (m1.find()) {
            return trimmed.substring(m1.end()).trim();
        }
        Matcher m2 = BARE_WAKE_PREFIX.matcher(trimmed);
        if (m2.find()) {
            return trimmed.substring(m2.end()).trim();
        }
        return null;
    }

    private void handleRecognizedUtterance(String transcript) {
        if (transcript.isEmpty()) {
            if (!inCommandCapture) setPlaybackDucked(false);
            scheduleRestartListening(200);
            return;
        }

        String commandTail = stripWakePhrase(transcript);
        boolean wakeHeard = (commandTail != null);

        if (!inCommandCapture && !wakeHeard) {
            // Ignore ambient speech without wake phrase
            setPlaybackDucked(false);
            scheduleRestartListening(160);
            return;
        }

        // Wake phrase alone ("Hey Lumen") -> chime + enter dedicated command capture window
        if (!inCommandCapture && wakeHeard && commandTail.isEmpty()) {
            playSubtleWakeChime();
            enterCommandCapture(8500L);
            return;
        }

        // We have an actionable utterance (either single-utterance with wake phrase or follow-up command)
        inCommandCapture = false;
        mainHandler.removeCallbacks(commandTimeoutRunnable);
        setPlaybackDucked(false);

        String effectiveText = wakeHeard ? commandTail : transcript;
        String nativeAction = tryImmediateNativeTransport(effectiveText);
        boolean handledNatively = nativeAction != null;

        emitState("processing", null);

        LumenVoicePlugin plugin = LumenVoicePlugin.getInstance();
        if (plugin != null) {
            plugin.emitTranscript(
                transcript,
                true,
                UUID.randomUUID().toString(),
                System.currentTimeMillis(),
                handledNatively,
                nativeAction
            );
        }

        // Return to wake listening shortly (unless TTS or follow-up takes over)
        mainHandler.postDelayed(() -> {
            if (isRunning && !isSpeaking && !inCommandCapture) {
                emitState("waiting_wake", null);
                updateNotification("Waiting for \"Hey Lumen\"");
                scheduleRestartListening(250);
            }
        }, 450);
    }

    /**
     * Executes immediate transport control directly on LumenPlaybackService so lock-screen
     * and compound commands ("Pause this song and add...") act at 0ms even when WebView is idle.
     */
    @Nullable
    private String tryImmediateNativeTransport(String commandText) {
        LumenPlaybackService playback = LumenPlaybackService.getInstance();
        if (playback == null || commandText == null) return null;
        String lower = commandText.toLowerCase(Locale.US).replaceAll("[!?.,]+", " ").trim();

        // Pause (standalone OR leading clause of compound command)
        if (lower.matches("^(?:pause|stop)(?:\\s+(?:this|the|my|current))?(?:\\s+(?:song|track|music|playback|audio))?(?:\\s+(?:and|then)\\b.*)?$")) {
            playback.pause();
            return "pause";
        }
        // Standalone resume
        if (lower.matches("^(?:resume|unpause|continue|keep\\s+playing)(?:\\s+(?:this|the|my|current))?(?:\\s+(?:song|track|music|playback|audio))?$")) {
            playback.resume();
            return "resume";
        }
        // Standalone skip
        if (lower.matches("^(?:skip|next|play\\s+next)(?:\\s+(?:this|the))?(?:\\s+(?:song|track))?$")) {
            playback.next();
            return "skip";
        }
        // Standalone previous
        if (lower.matches("^(?:previous|prev|go\\s+back|last)(?:\\s+(?:song|track))?$")) {
            playback.prev();
            return "previous";
        }
        return null;
    }

    private void emitState(String state, @Nullable String message) {
        LumenVoicePlugin plugin = LumenVoicePlugin.getInstance();
        if (plugin != null) {
            plugin.emitState(state, message);
        }
    }

    private void stopHandsFreeInternal() {
        isRunning = false;
        inCommandCapture = false;
        pendingFollowUpAfterSpeech = false;
        isSpeaking = false;
        mainHandler.removeCallbacksAndMessages(null);
        setPlaybackDucked(false);

        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {}
            speechRecognizer = null;
        }
        if (tts != null) {
            try {
                tts.stop();
            } catch (Exception ignored) {}
        }

        try {
            stopForeground(true);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(VOICE_NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}

        emitState("stopped", null);
    }

    @Override
    public void onDestroy() {
        stopHandsFreeInternal();
        if (tts != null) {
            try {
                tts.shutdown();
            } catch (Exception ignored) {}
            tts = null;
        }
        instance = null;
        super.onDestroy();
    }
}
