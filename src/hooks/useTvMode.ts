import { useState, useEffect } from 'react';

const TV_STORAGE_KEY = 'lumen_tv_mode';

/**
 * Hook to detect and manage Android TV / 10-Foot Leanback mode.
 * Automatically activates on Android TV (via LumenTV user agent) or when enabled in settings.
 */
export function useTvMode() {
  const [isTvMode, setIsTvMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;

    // 1. Android TV signaled via custom user agent token from MainActivity
    if (navigator.userAgent && navigator.userAgent.includes('LumenTV')) {
      return true;
    }

    // 2. URL query override (e.g. ?tv=true for testing in browser)
    if (window.location.search.includes('tv=true')) {
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
  });

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
      return next;
    });
  };

  return { isTvMode, toggleTvMode };
}
