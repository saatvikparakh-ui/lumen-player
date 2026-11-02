import CryptoJS from 'crypto-js';

export interface DirectResolvedStream {
  streamUrl: string;
  duration: number;
  title: string;
  artist: string;
  album?: string;
  isDirectCdn: boolean;
}

const SAAVN_DES_KEY = '38346591';
const BANNED_PATTERNS = /slowed|reverb|nightcore|sped up|speed up|instrumental|cover|karaoke|tribute|remix|mashup/i;

function cleanStringForMatch(str: string = ''): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * High-speed autonomous on-device 320kbps CD-Quality multi-source audio stream resolver.
 * Executes directly on native Android mobile devices and desktop without relying on Render cloud cold starts.
 * Bypasses intermediate proxy servers to connect directly to global Akamai/Azure CDNs.
 */
export class ClientStreamResolver {
  private static cache = new Map<string, DirectResolvedStream>();

  public static async resolveDirectStream(
    title: string,
    artist: string = '',
    expectedDuration?: number
  ): Promise<DirectResolvedStream | null> {
    const cleanTitle = (title || '')
      .replace(/\s*\(feat\..+?\)/gi, '')
      .replace(/\s*\[.+?\]/gi, '')
      .trim();

    const cacheKey = `${artist.toLowerCase().trim()} - ${cleanTitle.toLowerCase().trim()}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const query = `${cleanTitle} ${artist}`.trim();
      if (!query) return null;

      const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=5&p=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(searchUrl, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;

      const data = await res.json();
      const results: any[] = data.results || [];
      if (results.length === 0) return null;

      const normTargetTitle = cleanStringForMatch(cleanTitle);
      const normTargetArtist = cleanStringForMatch(artist);
      const targetTitleTokens = normTargetTitle.split(' ').filter(t => t.length > 1);
      const targetArtistTokens = normTargetArtist.split(' ').filter(t => t.length > 2);
      const titleAllowsRemix = /remix|acoustic|live/i.test(title);

      let match: any = null;
      let bestScore = -999;

      for (const r of results) {
        if (!r.encrypted_media_url) continue;
        const rawSong = r.song || '';
        const rawArtists = `${r.primary_artists || ''} ${r.singers || ''}`;
        const normSong = cleanStringForMatch(rawSong);
        const normArtists = cleanStringForMatch(rawArtists);
        const duration = r.duration ? parseInt(r.duration, 10) : 0;

        if (!titleAllowsRemix && BANNED_PATTERNS.test(rawSong)) {
          continue;
        }

        if (targetArtistTokens.length > 0) {
          const hasArtistMatch = targetArtistTokens.some(tok => normArtists.includes(tok));
          if (!hasArtistMatch) continue;
        }

        if (targetTitleTokens.length > 0) {
          const matchingTokens = targetTitleTokens.filter(tok => normSong.includes(tok));
          const matchRatio = matchingTokens.length / targetTitleTokens.length;
          if (matchRatio < 0.65) continue;
        }

        let score = 100;
        if (expectedDuration && duration > 0) {
          const diff = Math.abs(duration - expectedDuration);
          if (diff > 45) continue;
          score -= diff * 2;
        }

        if (normSong === normTargetTitle) score += 50;

        if (score > bestScore) {
          bestScore = score;
          match = r;
        }
      }

      if (!match || !match.encrypted_media_url) {
        return null;
      }

      // Decrypt DES payload
      const key = CryptoJS.enc.Utf8.parse(SAAVN_DES_KEY);
      const decrypted = CryptoJS.DES.decrypt(
        { ciphertext: CryptoJS.enc.Base64.parse(match.encrypted_media_url) },
        key,
        { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
      );

      const rawUrl = decrypted.toString(CryptoJS.enc.Utf8);
      if (!rawUrl || !rawUrl.startsWith('http')) return null;

      // Upgrade to 320kbps CD-Quality stream
      const hqUrl = rawUrl
        .replace(/_96\.mp4|_160\.mp4/, '_320.mp4')
        .replace(/_96\.m4a|_160\.m4a/, '_320.m4a');

      const resolved: DirectResolvedStream = {
        streamUrl: hqUrl,
        duration: match.duration ? parseInt(match.duration, 10) : (expectedDuration || 180),
        title: match.song || title,
        artist: match.primary_artists || artist,
        album: match.album || '',
        isDirectCdn: true
      };

      this.cache.set(cacheKey, resolved);
      return resolved;
    } catch (err) {
      console.warn('[ClientStreamResolver] Direct on-device resolution error:', err);
      return null;
    }
  }
}
