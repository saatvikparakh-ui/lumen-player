import { ApiClient } from './apiClient';

export const DEFAULT_LOCAL_SERVER = 'http://127.0.0.1:3847';
export const CLOUD_BACKEND_URL = ApiClient.PRODUCTION_CLOUD_URL;

/**
 * Probes the backend server with a 1.5s timeout to determine if local/cloud backend is reachable.
 */
export async function checkServerConnectivity(): Promise<boolean> {
  return ApiClient.checkHealth(1500);
}

export function isServerOnline(): boolean {
  return ApiClient.isOnline() === true;
}

export function isStandaloneMode(): boolean {
  return ApiClient.isOnline() === false;
}

/**
 * Detects whether the app is executing inside a native Capacitor mobile container (Android/iOS).
 */
export function isCapacitorNative(): boolean {
  return ApiClient.isCapacitor();
}

/**
 * Returns the active backend base URL for API queries, audio streams, and artwork proxy.
 */
export function getServerBaseUrl(): string {
  return ApiClient.getBaseUrl();
}

/**
 * Saves a custom backend server URL (e.g. for local network or custom cloud deployment).
 */
export function setServerBaseUrl(url: string): void {
  ApiClient.setBaseUrl(url);
}

/**
 * Resolves a relative or root API endpoint into a fully qualified URL based on the active backend.
 */
export function resolveApiUrl(path: string): string {
  return ApiClient.resolveUrl(path);
}

/**
 * Intercepts all window.fetch calls globally to route /api/* requests to the active backend.
 */
export function initApiInterceptor(): void {
  if (typeof window === 'undefined') return;

  // Perform background connectivity check on startup
  checkServerConnectivity().catch(() => {});

  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof input === 'string' && (input.startsWith('/api/') || input.startsWith('api/'))) {
      input = resolveApiUrl(input);
    }
    return originalFetch.call(this, input, init);
  };
}
