export type PlaybackSourceType = 'full-stream' | 'local' | 'preview' | 'external';

export interface Track {
  id: string;
  path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number | null;
  trackNumber?: number;
  diskNumber?: number;
  duration: number; // in seconds (nominal catalog duration)
  bitrate?: number | null;
  codec?: string;
  hasArtwork: boolean;
  artworkId?: string | null;
  streamUrl: string; // active playable URL
  artworkUrl?: string | null;
  addedAt: number;
  playCount?: number;
  lastPlayed?: number;
  isFavorite?: boolean;
  isStream?: boolean;
  streamSource?: 'open-license' | 'apple-music' | 'spotify';
  source?: string;
  videoId?: string;
  isVerified?: boolean;
  licenseUrl?: string;

  // Explicit audio source separation
  playbackType?: PlaybackSourceType;
  fullStreamUrl?: string | null;     // Legitimate full-length stream URL (e.g. backend /api/stream/resolve)
  previewUrl?: string | null;        // 30s preview snippet URL (e.g. from iTunes/Apple)
  externalUrl?: string | null;       // External provider web link
  localFilePath?: string | null;     // Local audio file path
  actualMediaDuration?: number;      // Truthful duration of currently loaded media
  isExplicitPreview?: boolean;       // True only when playing a preview, false for full tracks
  playbackError?: string | null;     // Error message if resolution failed
}

export type AppMode = 'local' | 'streaming';

export type StreamingSource = 'open-license' | 'apple-music' | 'spotify';

export interface StreamingCategory {
  id: string;
  name: string;
  tag: string;
  description: string;
}

export interface ProviderConfig {
  activeSource: StreamingSource;
  appleMusicToken?: string;
  spotifyClientId?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year?: number | null;
  artworkUrl?: string | null;
  trackCount: number;
  tracks: Track[];
  dominantColor?: string;
}

export interface Artist {
  id: string;
  name: string;
  albums: Album[];
  trackCount: number;
}

export interface UserPreferences {
  favoriteGenres: string[];
  favoriteArtists: string[];
}

export interface CustomPlaylist {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string | null;
  coverColor?: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  coverUrl?: string;
}

export type ViewMode = 'home' | 'search' | 'library' | 'now-playing' | 'audio-lab' | 'wall';

export type VisualizerMode = 'spectrum' | 'waveform' | 'oscilloscope';

export type EQPresetName = 'Flat' | 'Bass Boost' | 'Rock' | 'Jazz' | 'Electronic' | 'Vocal';

export interface EQBandSetting {
  frequency: number; // e.g. 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
  gain: number; // in dB (-12 to +12)
}

export interface AudioSettings {
  volume: number; // 0 to 1
  muted: boolean;
  crossfade: number; // seconds (0 to 10)
  normalisation: boolean; // dynamic compressor
  eqPreset: EQPresetName;
  customEq: number[]; // 10 gain values
  visualizerMode: VisualizerMode;
  visualizerSensitivity: number; // 0.5 to 2.0
  powerSaving: boolean;
}

export interface LyricLine {
  time: number; // in seconds
  text: string;
}

// Rating, Listening Statistics, & Friends Network Types
export interface SongRating {
  userId: string;
  songId: string;
  ratingTenths: number;
  formatted: string | null;
  ratedAt: number;
}

export interface ListeningStats {
  window: '30d' | '90d' | 'all';
  summary?: {
    total_plays: number;
    qualified_plays: number;
    completion_rate_percent: number;
    total_listening_duration_seconds: number;
    total_listening_duration_formatted: string;
  };
  top_songs: Array<{
    song_id: string;
    title: string;
    artist: string;
    play_count: number;
    total_duration_seconds?: number;
    rating_formatted?: string | null;
  }>;
  top_duration_songs: Array<{
    song_id: string;
    title: string;
    artist: string;
    total_duration_seconds: number;
    total_duration_formatted?: string;
  }>;
  chronological_log: Array<{
    event_id: string;
    song_id: string;
    title: string;
    artist: string;
    started_at: number;
    listened_duration_seconds: number;
    completion_status: string;
    qualified: number | boolean;
  }>;
  rating_stats: {
    highest_rated: Array<{
      song_id: string;
      title: string;
      artist: string;
      rating_tenths: number;
      rating: number;
      formatted: string;
    }>;
    lowest_rated: Array<{
      song_id: string;
      title: string;
      artist: string;
      rating_tenths: number;
      rating: number;
      formatted: string;
    }>;
  };
}

export interface FriendUser {
  user_id: string;
  username: string;
  rating_visibility: 'public' | 'friends' | 'private';
  friendship_status?: string;
}

export interface SongShare {
  share_id: string;
  sender_id: string;
  recipient_id: string;
  song_id?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  duration?: number;
  stream_url?: string | null;
  external_link?: string | null;
  message?: string | null;
  is_read: boolean;
  is_dismissed: boolean;
  is_revoked: boolean;
  created_at: number;
  sender_username?: string;
  recipient_username?: string;
}

export interface SongAvailabilityResolution {
  available: boolean;
  matchType: 'local_exact' | 'local_fuzzy' | 'stream_url' | 'none';
  matchedTrack: Track | null;
  reason: string;
}

export interface CatalogComparison {
  shared_favorites: Array<{
    song_id: string;
    title: string;
    artist: string;
    user_a_rating: string;
    user_b_rating: string;
    difference: string;
  }>;
  divergence: Array<{
    song_id: string;
    title: string;
    artist: string;
    user_a_rating: string;
    user_b_rating: string;
    difference: string;
  }>;
  discovery: Array<{
    song_id: string;
    title: string;
    artist: string;
    friend_formatted: string;
    friend_tenths: number;
  }>;
  total_compared: number;
}

// Global Electron Lumen API type definitions
declare global {
  interface Window {
    lumenAPI?: {
      selectMusicFolder: () => Promise<string | null>;
      scanMusicFolder: (folderPath: string) => Promise<{ success: boolean; tracks: Track[]; error?: string }>;
      getLocalServerInfo: () => Promise<{ port: number; baseUrl: string; localIps: string[] }>;
      getAudioUrl: (filePath: string) => Promise<string>;
      getArtworkUrl: (filePath: string) => Promise<string>;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      getHomeSharingInfo: () => Promise<{ active: boolean; port: number; urls: string[] }>;
      onScanProgress: (callback: (progress: { count: number; currentFile: string }) => void) => () => void;
    };
  }
}
