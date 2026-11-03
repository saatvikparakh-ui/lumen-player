package com.lumen.music;

import android.content.Context;
import android.content.SharedPreferences;

public class LumenPlaybackState {
    private static final String PREF_NAME = "lumen_playback_prefs";
    private static final String KEY_TRACK_ID = "track_id";
    private static final String KEY_TITLE = "title";
    private static final String KEY_ARTIST = "artist";
    private static final String KEY_ALBUM = "album";
    private static final String KEY_ARTWORK_URL = "artwork_url";
    private static final String KEY_DURATION = "duration";
    private static final String KEY_POSITION = "position";
    private static final String KEY_IS_PLAYING = "is_playing";

    public String trackId = "";
    public String title = "Select a track";
    public String artist = "Ready to play";
    public String album = "Lumen Hi-Fi";
    public String artworkUrl = "";
    public long durationMs = 0;
    public long positionMs = 0;
    public boolean isPlaying = false;

    private static LumenPlaybackState instance;

    public static synchronized LumenPlaybackState get() {
        if (instance == null) {
            instance = new LumenPlaybackState();
        }
        return instance;
    }

    public void save(Context context) {
        if (context == null) return;
        SharedPreferences sp = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        sp.edit()
            .putString(KEY_TRACK_ID, trackId)
            .putString(KEY_TITLE, title)
            .putString(KEY_ARTIST, artist)
            .putString(KEY_ALBUM, album)
            .putString(KEY_ARTWORK_URL, artworkUrl)
            .putLong(KEY_DURATION, durationMs)
            .putLong(KEY_POSITION, positionMs)
            .putBoolean(KEY_IS_PLAYING, isPlaying)
            .apply();
    }

    public void load(Context context) {
        if (context == null) return;
        SharedPreferences sp = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        this.trackId = sp.getString(KEY_TRACK_ID, "");
        this.title = sp.getString(KEY_TITLE, "Select a track");
        this.artist = sp.getString(KEY_ARTIST, "Ready to play");
        this.album = sp.getString(KEY_ALBUM, "Lumen Hi-Fi");
        this.artworkUrl = sp.getString(KEY_ARTWORK_URL, "");
        this.durationMs = sp.getLong(KEY_DURATION, 0);
        this.positionMs = sp.getLong(KEY_POSITION, 0);
        this.isPlaying = sp.getBoolean(KEY_IS_PLAYING, false);
    }
}
