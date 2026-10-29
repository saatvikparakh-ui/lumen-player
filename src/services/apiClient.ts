/**
 * LUMEN PRODUCTION API CLIENT
 * Centralized, resilient HTTP client with dynamic endpoint resolution,
 * parallel candidate server probing, request timeouts, and Capacitor safety.
 */

export class ApiTimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'ApiTimeoutError';
  }
}

export class ApiOfflineError extends Error {
  constructor(message = 'Network unavailable or server unreachable') {
    super(message);
    this.name = 'ApiOfflineError';
  }
}

export class ApiHttpError extends Error {
  public status: number;
  public data: any;

  constructor(status: number, statusText: string, data?: any) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.data = data;
  }
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | undefined | null>;
}

export class ApiClient {
  private static activeBaseUrl: string | null = null;
  private static isServerOnlineCache: boolean | null = null;
  private static lastHealthCheckTime = 0;

  /**
   * Cloud production URL fallback
   */
  public static readonly PRODUCTION_CLOUD_URL = 'https://lumen-music-player.onrender.com';

  /**
   * Known candidate addresses for local engine discovery
   */
  public static readonly LOCAL_WIFI_SERVER = 'http://192.168.1.11:3847';
  public static readonly LOCAL_LOOPBACK_SERVER = 'http://127.0.0.1:3847';
  public static readonly ANDROID_EMULATOR_SERVER = 'http://10.0.2.2:3847';

  /**
   * Detects whether the app is executing inside a native Capacitor mobile container (Android/iOS).
   */
  public static isCapacitor(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const cap = (window as any).Capacitor;
      if (cap && typeof cap.isNativePlatform === 'function') {
        return cap.isNativePlatform();
      }
    } catch (_) {}
    return false;
  }

  /**
   * Assembles prioritized candidate backend URLs to probe based on environment
   */
  public static getCandidateUrls(): string[] {
    const list: string[] = [];

    // 1. User manual override in Settings
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('lumen_server_url');
        if (saved && saved.trim()) {
          list.push(saved.trim().replace(/\/+$/, ''));
        }
      } catch (_) {}
    }

    // 2. Active cached working server
    if (this.activeBaseUrl) {
      list.push(this.activeBaseUrl);
    }

    // 3. Deployment environment variable
    const envUrl = (import.meta as any)?.env?.VITE_BACKEND_URL;
    if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
      list.push(envUrl.trim().replace(/\/+$/, ''));
    }

    // 4. Capacitor Native Mobile: prioritize Wi-Fi laptop engine, emulator, then cloud
    if (this.isCapacitor()) {
      list.push(this.LOCAL_WIFI_SERVER);
      list.push(this.ANDROID_EMULATOR_SERVER);
      list.push(this.LOCAL_LOOPBACK_SERVER);
      list.push(this.PRODUCTION_CLOUD_URL);
      return Array.from(new Set(list));
    }

    // 5. Desktop / Laptop (Electron or local browser)
    if (typeof window !== 'undefined' && window.location) {
      const origin = window.location.origin;
      const host = window.location.hostname;

      if (origin.startsWith('http://') || origin.startsWith('https://')) {
        if (window.location.port === '5173') {
          list.push(`http://${host || 'localhost'}:3847`);
        } else if (!origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) {
          list.push(origin);
        }
      }

      list.push(this.LOCAL_LOOPBACK_SERVER);
      list.push('http://localhost:3847');
      list.push(this.LOCAL_WIFI_SERVER);
      list.push(this.PRODUCTION_CLOUD_URL);
      return Array.from(new Set(list));
    }

    list.push(this.LOCAL_LOOPBACK_SERVER);
    return Array.from(new Set(list));
  }

  /**
   * Resolves the active backend base URL
   */
  public static getBaseUrl(): string {
    if (this.activeBaseUrl) {
      return this.activeBaseUrl;
    }

    // Check user manual override
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('lumen_server_url');
        if (saved && saved.trim()) {
          return saved.trim().replace(/\/+$/, '');
        }
      } catch (_) {}
    }

    // If native Capacitor, default to local Wi-Fi server so phone connects directly
    if (this.isCapacitor()) {
      return this.LOCAL_WIFI_SERVER;
    }

    // If desktop browser on port 5173
    if (typeof window !== 'undefined' && window.location) {
      const host = window.location.hostname;
      if (window.location.port === '5173') {
        return `http://${host || 'localhost'}:3847`;
      }
      const origin = window.location.origin;
      if (origin && !origin.startsWith('file://') && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) {
        return origin;
      }
    }

    // Default desktop local server
    return this.LOCAL_LOOPBACK_SERVER;
  }

  /**
   * Sets a custom server URL
   */
  public static setBaseUrl(url: string | null): void {
    if (typeof localStorage !== 'undefined') {
      try {
        if (!url || !url.trim()) {
          localStorage.removeItem('lumen_server_url');
        } else {
          localStorage.setItem('lumen_server_url', url.trim().replace(/\/+$/, ''));
        }
      } catch (_) {}
    }
    this.activeBaseUrl = url ? url.trim().replace(/\/+$/, '') : null;
    this.isServerOnlineCache = null;
  }

  /**
   * Resolves a relative or root API path into a fully qualified URL
   */
  public static resolveUrl(path: string): string {
    if (!path) return path;
    if (
      path.startsWith('http://') ||
      path.startsWith('https://') ||
      path.startsWith('blob:') ||
      path.startsWith('data:')
    ) {
      return path;
    }

    const base = this.getBaseUrl();
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  /**
   * Parallel health probe across all candidate backends with instant lock-on to the fastest responsive server
   */
  public static async checkHealth(timeoutMs = 1500, force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && this.isServerOnlineCache === true && this.activeBaseUrl && now - this.lastHealthCheckTime < 15000) {
      return true;
    }

    const candidates = this.getCandidateUrls();

    // Probe all candidate servers in parallel
    const probePromises = candidates.map(async (baseUrl) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          return baseUrl;
        }
      } catch (_) {}
      return null;
    });

    try {
      const results = await Promise.all(probePromises);
      const working = results.find(u => u !== null);
      if (working) {
        this.activeBaseUrl = working;
        this.isServerOnlineCache = true;
        this.lastHealthCheckTime = Date.now();
        console.info(`[Lumen ApiClient] Connected to active audio backend: ${working}`);
        return true;
      }
    } catch (_) {}

    this.isServerOnlineCache = false;
    this.lastHealthCheckTime = Date.now();
    return false;
  }

  /**
   * Returns cached online status or null if unknown
   */
  public static isOnline(): boolean | null {
    return this.isServerOnlineCache;
  }

  /**
   * Central request executor
   */
  public static async request<T = any>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const { timeoutMs = 8000, params, ...fetchInit } = options;

    let fullUrl = this.resolveUrl(path);

    if (params) {
      const urlObj = new URL(fullUrl);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          urlObj.searchParams.set(k, String(v));
        }
      });
      fullUrl = urlObj.toString();
    }

    const controller = new AbortController();
    let isTimedOut = false;
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, timeoutMs);

    // Merge caller signal if provided
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...((fetchInit.headers as Record<string, string>) || {})
    };

    if (fetchInit.body && typeof fetchInit.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(fullUrl, {
        ...fetchInit,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        let errData = null;
        try {
          errData = await res.json();
        } catch (_) {}
        throw new ApiHttpError(res.status, res.statusText, errData);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await res.json()) as T;
      }
      return (await res.text()) as unknown as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err instanceof ApiHttpError) {
        throw err;
      }
      if (isTimedOut || err.name === 'AbortError') {
        if (isTimedOut) {
          throw new ApiTimeoutError(`Request to ${path} timed out after ${timeoutMs}ms`);
        }
        throw err;
      }
      throw new ApiOfflineError(`Network error while requesting ${path}: ${err.message || 'Server unreachable'}`);
    }
  }

  public static async get<T = any>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public static async post<T = any>(path: string, body?: any, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    });
  }

  public static async put<T = any>(path: string, body?: any, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined
    });
  }

  public static async del<T = any>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}
