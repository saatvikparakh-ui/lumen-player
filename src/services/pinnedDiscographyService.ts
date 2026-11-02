export interface PinnedDiscography {
  artistName: string;
  avatarUrl: string | null;
  pinnedAt: number;
  albumCount?: number;
}

const STORAGE_KEY = 'lumen_pinned_discographies_v1';

export class PinnedDiscographyService {
  static getPinned(): PinnedDiscography[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (_) {
      return [];
    }
  }

  static isPinned(artistName: string): boolean {
    if (!artistName) return false;
    const list = this.getPinned();
    return list.some(item => item.artistName.toLowerCase() === artistName.toLowerCase().trim());
  }

  static togglePin(artistName: string, avatarUrl: string | null = null, albumCount?: number): boolean {
    if (!artistName) return false;
    const cleanName = artistName.trim();
    const list = this.getPinned();
    const index = list.findIndex(item => item.artistName.toLowerCase() === cleanName.toLowerCase());
    let isNowPinned = false;
    if (index >= 0) {
      list.splice(index, 1);
      isNowPinned = false;
    } else {
      list.unshift({
        artistName: cleanName,
        avatarUrl,
        pinnedAt: Date.now(),
        albumCount
      });
      isNowPinned = true;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('lumen_pinned_discographies_changed', { detail: { list } }));
    } catch (_) {}
    return isNowPinned;
  }
}
