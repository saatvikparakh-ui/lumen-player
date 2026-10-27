import { UserPreferences } from '../types/music';

const STORAGE_KEY = 'lumen_user_preferences_v3';

export const POPULAR_GENRES = [
  'Pop',
  'Hip-Hop / Rap',
  'R&B / Soul',
  'Electronic & EDM',
  'Synthwave & Cyber',
  'Indie & Alternative',
  'Rock',
  'Lo-Fi Chill',
  'Bollywood / Desi',
  'Latin & Reggaeton',
  'Jazz & Blues',
  'Classical & Film Score'
];

export interface VerifiedArtistPreset {
  name: string;
  avatarUrl: string;
}

export const POPULAR_VERIFIED_ARTISTS: VerifiedArtistPreset[] = [
  { name: 'The Weeknd', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/2a/aa/b4/2aaab42a-a4cb-a600-4a25-d78961495960/18UMGIM17204.rgb.jpg/500x500bb.jpg' },
  { name: 'Drake', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/51/61/f3/5161f3c4-2292-f035-eb68-6f95bbc9edd6/00602537542338.rgb.jpg/500x500bb.jpg' },
  { name: 'Taylor Swift', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a0/dd/fd/a0ddfd72-ee9e-f046-6466-a5dbefc696fa/26UM1IM21436.rgb.jpg/500x500bb.jpg' },
  { name: 'Billie Eilish', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg' },
  { name: 'Kendrick Lamar', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/50/c2/cc/50c2cc95-3658-9417-0d4b-831abde44ba1/24UM1IM28978.rgb.jpg/500x500bb.jpg' },
  { name: 'Post Malone', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/7b/1b/1b/7b1b1b0b-7ce2-b223-f9e0-8e36abe51877/19UMGIM78325.rgb.jpg/500x500bb.jpg' },
  { name: 'Dua Lipa', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/6c/11/d6/6c11d681-aa3a-d59e-4c2e-f77e181026ab/190295092665.jpg/500x500bb.jpg' },
  { name: 'Travis Scott', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e9/b1/08/e9b10802-9591-20a5-01b8-1d7fe4c760b5/26UM1IM06146.rgb.jpg/500x500bb.jpg' },
  { name: 'Ariana Grande', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/56/f4/96/56f49612-02dd-83f4-44fe-d2118cc70707/26UMGIM51129.rgb.jpg/500x500bb.jpg' },
  { name: 'Bruno Mars', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ed/46/bf/ed46bf4e-7cb9-965a-54f3-03059977fe6c/075679589293.jpg/500x500bb.jpg' },
  { name: 'Daft Punk', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/fd/4a/77/fd4a77db-0ebc-d043-41a2-f32fa1bb0fb4/dj.qrikkdwj.jpg/500x500bb.jpg' },
  { name: 'SZA', avatarUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/0f/90/a8/0f90a856-0447-d846-fa7b-b9c937e72310/196871881180.jpg/500x500bb.jpg' }
];

const DEFAULT_PREFERENCES: UserPreferences = {
  favoriteGenres: ['Pop', 'Hip-Hop / Rap', 'R&B / Soul', 'Synthwave & Cyber'],
  favoriteArtists: ['The Weeknd', 'Drake', 'Taylor Swift', 'Kendrick Lamar']
};

export class PreferenceService {
  private static prefs: UserPreferences | null = null;

  static getPreferences(): UserPreferences {
    if (this.prefs) return this.prefs;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.prefs = JSON.parse(stored);
        return this.prefs!;
      }
    } catch (_) {}

    this.prefs = { ...DEFAULT_PREFERENCES };
    this.savePreferences(this.prefs);
    return this.prefs;
  }

  static savePreferences(prefs: UserPreferences): void {
    this.prefs = { ...prefs };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (err) {
      console.warn('Failed to save preferences to localStorage:', err);
    }
  }

  static toggleGenre(genre: string): UserPreferences {
    const current = this.getPreferences();
    const exists = current.favoriteGenres.includes(genre);
    const updated: UserPreferences = {
      ...current,
      favoriteGenres: exists
        ? current.favoriteGenres.filter(g => g !== genre)
        : [...current.favoriteGenres, genre]
    };
    this.savePreferences(updated);
    return updated;
  }

  static toggleArtist(artist: string): UserPreferences {
    const current = this.getPreferences();
    const exists = current.favoriteArtists.includes(artist);
    const updated: UserPreferences = {
      ...current,
      favoriteArtists: exists
        ? current.favoriteArtists.filter(a => a !== artist)
        : [...current.favoriteArtists, artist]
    };
    this.savePreferences(updated);
    return updated;
  }

  static addCustomArtist(artist: string): UserPreferences {
    const trimmed = artist.trim();
    if (!trimmed) return this.getPreferences();
    const current = this.getPreferences();
    if (current.favoriteArtists.some(a => a.toLowerCase() === trimmed.toLowerCase())) {
      return current;
    }
    const updated: UserPreferences = {
      ...current,
      favoriteArtists: [trimmed, ...current.favoriteArtists]
    };
    this.savePreferences(updated);
    return updated;
  }
}
