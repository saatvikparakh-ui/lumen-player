package com.lumen.music;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;

/**
 * LUMEN PERSISTENT OFFLINE MEDIA SQLITE REGISTRY
 * Device-local authoritative index that survives restarts, offline mode, and app upgrades.
 * Never depends on remote backend servers.
 */
public class OfflineMediaDbHelper extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "lumen_offline_media.db";
    private static final int DATABASE_VERSION = 1;
    public static final String TABLE_OFFLINE_TRACKS = "offline_tracks";

    private static OfflineMediaDbHelper instance;

    public static synchronized OfflineMediaDbHelper getInstance(Context context) {
        if (instance == null) {
            instance = new OfflineMediaDbHelper(context.getApplicationContext());
        }
        return instance;
    }

    private OfflineMediaDbHelper(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS " + TABLE_OFFLINE_TRACKS + " (" +
                "canonicalTrackId TEXT PRIMARY KEY," +
                "audioAssetId TEXT NOT NULL," +
                "title TEXT NOT NULL," +
                "artist TEXT NOT NULL," +
                "album TEXT," +
                "albumArtworkReference TEXT," +
                "duration INTEGER DEFAULT 0," +
                "codec TEXT DEFAULT 'mp3'," +
                "bitrate INTEGER DEFAULT 0," +
                "mediaFormat TEXT DEFAULT 'audio/mpeg'," +
                "storageReference TEXT," +
                "downloadState TEXT NOT NULL," +
                "downloadProgress INTEGER DEFAULT 0," +
                "downloadedBytes INTEGER DEFAULT 0," +
                "totalBytes INTEGER DEFAULT 0," +
                "downloadedAt INTEGER," +
                "lastVerifiedAt INTEGER," +
                "contentChecksum TEXT," +
                "licenseReference TEXT," +
                "licenseExpiration INTEGER," +
                "sourceType TEXT," +
                "authorizedDownloadUrl TEXT," +
                "storageSize INTEGER DEFAULT 0," +
                "downloadError TEXT," +
                "collectionRefsJson TEXT DEFAULT '[\"standalone\"]'," +
                "needsRepair INTEGER DEFAULT 0," +
                "quality TEXT DEFAULT 'source_original'" +
            ")"
        );
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_offline_state ON " + TABLE_OFFLINE_TRACKS + " (downloadState)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_offline_asset ON " + TABLE_OFFLINE_TRACKS + " (audioAssetId)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Non-destructive versioned migration path preserving existing user offline records.
        // Future schema versions will use ALTER TABLE ADD COLUMN guarded by oldVersion < N.
        if (oldVersion < 1) {
            onCreate(db);
        }
    }

    public static class Record {
        public String canonicalTrackId;
        public String audioAssetId;
        public String title;
        public String artist;
        public String album;
        public String albumArtworkReference;
        public long duration;
        public String codec;
        public int bitrate;
        public String mediaFormat;
        public String storageReference;
        public String downloadState;
        public int downloadProgress;
        public long downloadedBytes;
        public long totalBytes;
        public long downloadedAt;
        public long lastVerifiedAt;
        public String contentChecksum;
        public String licenseReference;
        public long licenseExpiration;
        public String sourceType;
        public String authorizedDownloadUrl;
        public long storageSize;
        public String downloadError;
        public String collectionRefsJson;
        public boolean needsRepair;
        public String quality;

        public JSObject toJSObject() {
            JSObject obj = new JSObject();
            obj.put("canonicalTrackId", canonicalTrackId);
            obj.put("audioAssetId", audioAssetId);
            obj.put("title", title != null ? title : "Unknown Track");
            obj.put("artist", artist != null ? artist : "Unknown Artist");
            obj.put("album", album != null ? album : "Single");
            obj.put("albumArtworkReference", albumArtworkReference);
            obj.put("duration", duration);
            obj.put("codec", codec != null ? codec : "mp3");
            obj.put("bitrate", bitrate);
            obj.put("mediaFormat", mediaFormat != null ? mediaFormat : "audio/mpeg");
            obj.put("storageReference", storageReference != null ? storageReference : ("lumen-offline://" + audioAssetId));
            obj.put("downloadState", downloadState != null ? downloadState : "NOT_DOWNLOADED");
            obj.put("downloadProgress", downloadProgress);
            obj.put("downloadedBytes", downloadedBytes);
            obj.put("totalBytes", totalBytes);
            if (downloadedAt > 0) obj.put("downloadedAt", downloadedAt);
            if (lastVerifiedAt > 0) obj.put("lastVerifiedAt", lastVerifiedAt);
            obj.put("contentChecksum", contentChecksum);
            obj.put("licenseReference", licenseReference);
            if (licenseExpiration > 0) obj.put("licenseExpiration", licenseExpiration);
            obj.put("sourceType", sourceType != null ? sourceType : "open_license_audio");
            obj.put("authorizedDownloadUrl", authorizedDownloadUrl);
            obj.put("storageSize", storageSize);
            obj.put("downloadError", downloadError);
            obj.put("needsRepair", needsRepair);
            obj.put("quality", quality != null ? quality : "source_original");

            JSArray refs = new JSArray();
            try {
                JSONArray parsed = new JSONArray(collectionRefsJson != null ? collectionRefsJson : "[\"standalone\"]");
                for (int i = 0; i < parsed.length(); i++) {
                    refs.put(parsed.getString(i));
                }
            } catch (Exception e) {
                refs.put("standalone");
            }
            obj.put("collectionRefs", refs);
            return obj;
        }
    }

    public synchronized void upsert(Record r) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("canonicalTrackId", r.canonicalTrackId);
        cv.put("audioAssetId", r.audioAssetId);
        cv.put("title", r.title != null ? r.title : "Unknown Track");
        cv.put("artist", r.artist != null ? r.artist : "Unknown Artist");
        cv.put("album", r.album != null ? r.album : "Single");
        cv.put("albumArtworkReference", r.albumArtworkReference);
        cv.put("duration", r.duration);
        cv.put("codec", r.codec != null ? r.codec : "mp3");
        cv.put("bitrate", r.bitrate);
        cv.put("mediaFormat", r.mediaFormat != null ? r.mediaFormat : "audio/mpeg");
        cv.put("storageReference", r.storageReference != null ? r.storageReference : ("lumen-offline://" + r.audioAssetId));
        cv.put("downloadState", r.downloadState);
        cv.put("downloadProgress", r.downloadProgress);
        cv.put("downloadedBytes", r.downloadedBytes);
        cv.put("totalBytes", r.totalBytes);
        cv.put("downloadedAt", r.downloadedAt);
        cv.put("lastVerifiedAt", r.lastVerifiedAt);
        cv.put("contentChecksum", r.contentChecksum);
        cv.put("licenseReference", r.licenseReference);
        cv.put("licenseExpiration", r.licenseExpiration);
        cv.put("sourceType", r.sourceType);
        cv.put("authorizedDownloadUrl", r.authorizedDownloadUrl);
        cv.put("storageSize", r.storageSize);
        cv.put("downloadError", r.downloadError);
        cv.put("collectionRefsJson", r.collectionRefsJson != null ? r.collectionRefsJson : "[\"standalone\"]");
        cv.put("needsRepair", r.needsRepair ? 1 : 0);
        cv.put("quality", r.quality != null ? r.quality : "source_original");
        db.insertWithOnConflict(TABLE_OFFLINE_TRACKS, null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public synchronized Record getByTrackId(String canonicalTrackId) {
        if (canonicalTrackId == null) return null;
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE_OFFLINE_TRACKS, null, "canonicalTrackId = ?", new String[]{canonicalTrackId}, null, null, null);
        try {
            if (c.moveToFirst()) {
                return fromCursor(c);
            }
            return null;
        } finally {
            c.close();
        }
    }

    public synchronized List<Record> getAll() {
        List<Record> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE_OFFLINE_TRACKS, null, null, null, null, null, "downloadedAt DESC");
        try {
            while (c.moveToNext()) {
                list.add(fromCursor(c));
            }
        } finally {
            c.close();
        }
        return list;
    }

    public synchronized void deleteByTrackId(String canonicalTrackId) {
        if (canonicalTrackId == null) return;
        SQLiteDatabase db = getWritableDatabase();
        db.delete(TABLE_OFFLINE_TRACKS, "canonicalTrackId = ?", new String[]{canonicalTrackId});
    }

    public synchronized void deleteAll() {
        SQLiteDatabase db = getWritableDatabase();
        db.delete(TABLE_OFFLINE_TRACKS, null, null);
    }

    private Record fromCursor(Cursor c) {
        Record r = new Record();
        r.canonicalTrackId = c.getString(c.getColumnIndexOrThrow("canonicalTrackId"));
        r.audioAssetId = c.getString(c.getColumnIndexOrThrow("audioAssetId"));
        r.title = c.getString(c.getColumnIndexOrThrow("title"));
        r.artist = c.getString(c.getColumnIndexOrThrow("artist"));
        r.album = c.getString(c.getColumnIndexOrThrow("album"));
        r.albumArtworkReference = c.getString(c.getColumnIndexOrThrow("albumArtworkReference"));
        r.duration = c.getLong(c.getColumnIndexOrThrow("duration"));
        r.codec = c.getString(c.getColumnIndexOrThrow("codec"));
        r.bitrate = c.getInt(c.getColumnIndexOrThrow("bitrate"));
        r.mediaFormat = c.getString(c.getColumnIndexOrThrow("mediaFormat"));
        r.storageReference = c.getString(c.getColumnIndexOrThrow("storageReference"));
        r.downloadState = c.getString(c.getColumnIndexOrThrow("downloadState"));
        r.downloadProgress = c.getInt(c.getColumnIndexOrThrow("downloadProgress"));
        r.downloadedBytes = c.getLong(c.getColumnIndexOrThrow("downloadedBytes"));
        r.totalBytes = c.getLong(c.getColumnIndexOrThrow("totalBytes"));
        r.downloadedAt = c.getLong(c.getColumnIndexOrThrow("downloadedAt"));
        r.lastVerifiedAt = c.getLong(c.getColumnIndexOrThrow("lastVerifiedAt"));
        r.contentChecksum = c.getString(c.getColumnIndexOrThrow("contentChecksum"));
        r.licenseReference = c.getString(c.getColumnIndexOrThrow("licenseReference"));
        r.licenseExpiration = c.getLong(c.getColumnIndexOrThrow("licenseExpiration"));
        r.sourceType = c.getString(c.getColumnIndexOrThrow("sourceType"));
        r.authorizedDownloadUrl = c.getString(c.getColumnIndexOrThrow("authorizedDownloadUrl"));
        r.storageSize = c.getLong(c.getColumnIndexOrThrow("storageSize"));
        r.downloadError = c.getString(c.getColumnIndexOrThrow("downloadError"));
        r.collectionRefsJson = c.getString(c.getColumnIndexOrThrow("collectionRefsJson"));
        r.needsRepair = c.getInt(c.getColumnIndexOrThrow("needsRepair")) == 1;
        r.quality = c.getString(c.getColumnIndexOrThrow("quality"));
        return r;
    }
}
