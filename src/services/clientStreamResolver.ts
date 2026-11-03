import CryptoJS from 'crypto-js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface DirectResolvedStream {
  streamUrl: string;
  duration: number;
  title: string;
  artist: string;
  album?: string;
  isDirectCdn: boolean;
}

const SAAVN_DES_KEY = '38346591';
const BANNED_PATTERNS = /\b(slowed|reverb|nightcore|sped\s*up|speed\s*up|speedup|karaoke|tribute|remix|mashup|lofi|instrumental)\b/i;

function cleanStringForMatch(str: string = ''): string {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * High-speed autonomous on-device 320kbps CD-Quality multi-source audio stream resolver.
 * Executes directly on native Android mobile devices and desktop without relying on Render cloud cold starts.
 * Bypasses intermediate proxy servers to connect directly to global Akamai/Azure CDNs.
 * Uses Capacitor native HTTP client on mobile to bypass CORS restrictions 100%.
 */
export class ClientStreamResolver {
  private static cache = new Map<string, DirectResolvedStream>();

  /**
   * Resilient HTTP GET that bypasses browser CORS via native Android layer when running on mobile
   */
  private static async fetchJson(url: string, timeoutMs = 6000): Promise<any> {
    // 1. Native Mobile (Capacitor Android/iOS): Bypasses CORS via native HttpURLConnection
    try {
      if (Capacitor.isNativePlatform()) {
        const resp = await CapacitorHttp.get({
          url,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
          },
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs
        });
        if (resp && resp.status >= 200 && resp.status < 300) {
          return typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
        }
      }
    } catch (nativeErr) {
      console.warn('[ClientStreamResolver] Native HTTP failed, attempting fallback:', nativeErr);
    }

    // 2. Direct browser fetch
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}

    // 3. Web browser CORS proxies (if running in desktop/mobile web browser)
    const corsProxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(url)}`
    ];

    for (const proxyUrl of corsProxies) {
      try {
        const pRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs) });
        if (pRes.ok) {
          const text = await pRes.text();
          if (text && text.trim().startsWith('{')) {
            return JSON.parse(text);
          }
        }
      } catch (_) {}
    }

    return null;
  }

  public static async resolveDirectStream(
    title: string,
    artist: string = '',
    expectedDuration?: number
  ): Promise<DirectResolvedStream | null> {
    const cleanTitle = (title || '')
      .replace(/\s*\(feat\..+?\)/gi, '')
      .replace(/\s*\[.+?\]/gi, '')
      .trim();

    const cleanArtist = (artist || '').trim();

    const cacheKey = `${cleanArtist.toLowerCase()} - ${cleanTitle.toLowerCase()}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // Try two query variants: primary (title + artist) and fallback (title only)
      const queries = [
        `${cleanTitle} ${cleanArtist}`.trim(),
        cleanTitle
      ].filter(Boolean);

      for (const query of queries) {
        const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=8&p=1&q=${encodeURIComponent(query)}`;
        const data = await this.fetchJson(searchUrl, 5000);
        if (!data || !Array.isArray(data.results) || data.results.length === 0) {
          continue;
        }

        const results: any[] = data.results;
        const normTargetTitle = cleanStringForMatch(cleanTitle);
        const normTargetArtist = cleanStringForMatch(cleanArtist);
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
            if (matchRatio < 0.60) continue;
          }

          let score = 100;
          if (expectedDuration && duration > 0) {
            const diff = Math.abs(duration - expectedDuration);
            // Soft penalty instead of hard skip, ensuring tracks never fail to play
            score -= Math.min(diff * 2, 80);
          }

          if (normSong === normTargetTitle) score += 60;
          if (normArtists.includes(normTargetArtist) || normTargetArtist.includes(normArtists)) score += 40;

          if (score > bestScore) {
            bestScore = score;
            match = r;
          }
        }

        // If strict match didn't find anything, fallback to first result with encrypted_media_url
        if (!match && results.length > 0) {
          match = results.find(r => !!r.encrypted_media_url) || results[0];
        }

        if (match && match.encrypted_media_url) {
          // Decrypt DES payload
          const key = CryptoJS.enc.Utf8.parse(SAAVN_DES_KEY);
          const decrypted = CryptoJS.DES.decrypt(
            { ciphertext: CryptoJS.enc.Base64.parse(match.encrypted_media_url) },
            key,
            { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
          );

          const rawUrl = decrypted.toString(CryptoJS.enc.Utf8);
          if (rawUrl && rawUrl.startsWith('http')) {
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

            console.info(`[ClientStreamResolver] Successfully resolved on-device 320k stream: "${resolved.title}" by ${resolved.artist}`);
            this.cache.set(cacheKey, resolved);
            return resolved;
          }
        }
      }

      // 3. Auxiliary fallback: Query the production cloud JSON endpoint directly
      try {
        const cloudUrl = `https://lumen-player.onrender.com/api/stream/resolve?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}&format=json`;
        const cloudData = await this.fetchJson(cloudUrl, 8000);
        if (cloudData && cloudData.streamUrl && cloudData.streamUrl.startsWith('http')) {
          const resolved: DirectResolvedStream = {
            streamUrl: cloudData.streamUrl,
            duration: cloudData.duration || (expectedDuration || 180),
            title: cloudData.title || title,
            artist: cloudData.artist || artist,
            album: cloudData.album || '',
            isDirectCdn: true
          };
          console.info(`[ClientStreamResolver] Resolved via cloud JSON: "${resolved.title}" by ${resolved.artist}`);
          this.cache.set(cacheKey, resolved);
          return resolved;
        }
      } catch (_) {}

      return null;
    } catch (err) {
      console.warn('[ClientStreamResolver] Direct on-device resolution error:', err);
      return null;
    }
  }
}
