import { useEffect, useState } from 'react';

export const PURE_DARK_STORAGE_KEY = 'lumen_pure_dark_mode_v1';
const PURE_DARK_EVENT = 'lumen:pure_dark_changed';

export function getPureDarkMode(storage?: Pick<Storage, 'getItem'> | null): boolean {
  const store = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return false;
  try {
    return store.getItem(PURE_DARK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function applyPureDarkDocumentAttr(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  try {
    if (enabled) {
      document.documentElement.setAttribute('data-pure-dark', 'true');
    } else {
      document.documentElement.removeAttribute('data-pure-dark');
    }
  } catch {}
}

export function setPureDarkMode(
  enabled: boolean,
  storage?: Pick<Storage, 'setItem'> | null
): boolean {
  const next = Boolean(enabled);
  const store = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (store) {
    try {
      store.setItem(PURE_DARK_STORAGE_KEY, next ? 'true' : 'false');
    } catch {}
  }
  applyPureDarkDocumentAttr(next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PURE_DARK_EVENT, { detail: { enabled: next } }));
  }
  return next;
}

// Apply persisted preference immediately on module boot so there is zero flash
applyPureDarkDocumentAttr(getPureDarkMode());

export function usePureDarkMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => getPureDarkMode());

  useEffect(() => {
    applyPureDarkDocumentAttr(enabled);
  }, [enabled]);

  useEffect(() => {
    const sync = () => setEnabled(getPureDarkMode());
    window.addEventListener(PURE_DARK_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PURE_DARK_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return [
    enabled,
    (next: boolean) => {
      setPureDarkMode(next);
      setEnabled(Boolean(next));
    }
  ];
}
