import { useState, useEffect } from 'react';

export const TV_STORAGE_KEY = 'lumen_tv_mode';
export const TV_GRAPHICS_KEY = 'lumen_tv_graphics_mode';
export const TV_CURSOR_KEY = 'lumen_tv_cursor_mode';

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
 * Hook to detect and manage Android TV / 10-Foot Leanback mode,
 * including graphics performance profile (Smooth 60 FPS vs Full Effects) and virtual cursor.
 */
export function useTvMode() {
  const [isTvMode, setIsTvMode] = useState<boolean>(() => isTvEnvironment());

  const [isUltraSmooth, setIsUltraSmooth] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(TV_GRAPHICS_KEY);
      if (saved !== null) return saved === 'smooth';
    } catch (_) {}
    return true; // Default to ultra-smooth 60 FPS on TV
  });

  const [isVirtualCursorEnabled, setIsVirtualCursorEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(TV_CURSOR_KEY);
      if (saved !== null) return saved === 'true';
    } catch (_) {}
    return true; // Default to virtual mouse cursor on TV
  });

  useEffect(() => {
    if (isTvMode) {
      document.body.classList.add('tv-mode');
      if (isUltraSmooth) {
        document.body.classList.remove('tv-full-effects');
      } else {
        document.body.classList.add('tv-full-effects');
      }
    } else {
      document.body.classList.remove('tv-mode');
      document.body.classList.remove('tv-full-effects');
    }
  }, [isTvMode, isUltraSmooth]);

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

  const toggleGraphicsMode = () => {
    setIsUltraSmooth((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TV_GRAPHICS_KEY, next ? 'smooth' : 'full');
      } catch (_) {}
      return next;
    });
  };

  const toggleVirtualCursor = () => {
    setIsVirtualCursorEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TV_CURSOR_KEY, next ? 'true' : 'false');
      } catch (_) {}
      return next;
    });
  };

  return { 
    isTvMode, 
    toggleTvMode,
    isUltraSmooth,
    toggleGraphicsMode,
    isVirtualCursorEnabled,
    toggleVirtualCursor
  };
}
