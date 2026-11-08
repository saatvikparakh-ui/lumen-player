import { useState, useEffect } from 'react';

export const TV_STORAGE_KEY = 'lumen_tv_mode';

/**
 * Checks whether the current runtime environment is an Android TV, Leanback, or Smart TV.
 */
export function isTvEnvironment(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Android TV signaled via custom user agent token from MainActivity or common smart TV UAs
  if (navigator.userAgent && /LumenTV|AndroidTV|GoogleTV|SmartTV|Large Screen|HbbTV|CrKey|AFT|BRAVIA|MiTV/i.test(navigator.userAgent)) {
    return true;
  }

  // 2. URL query override (e.g. ?tv=true or ?device=tv)
  if (window.location.search && /[?&](tv=true|device=tv)/i.test(window.location.search)) {
    return true;
  }

  // 3. User manual toggle saved in localStorage
  try {
    const saved = localStorage.getItem(TV_STORAGE_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch (_) {}

  return false;
}

/**
 * Hook to detect and manage Android TV / 10-Foot Leanback mode.
 * Automatically activates on Android TV (via LumenTV user agent) or when enabled in settings.
 */
export function useTvMode() {
  const [isTvMode, setIsTvMode] = useState<boolean>(() => isTvEnvironment());

  useEffect(() => {
    if (isTvMode) {
      document.body.classList.add('tv-mode');
    } else {
      document.body.classList.remove('tv-mode');
    }
  }, [isTvMode]);

  const toggleTvMode = () => {
    setIsTvMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TV_STORAGE_KEY, next ? 'true' : 'false');
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('lumen-tv-mode-changed', { detail: next }));
      return next;
    });
  };

  return { isTvMode, toggleTvMode };
}
