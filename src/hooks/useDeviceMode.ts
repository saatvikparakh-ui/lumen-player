import { useState, useEffect, useCallback } from 'react';
import { isTvEnvironment } from './useTvMode';

export type DeviceMode = 'phone' | 'tablet' | 'desktop';
export type DeviceModeSetting = 'auto' | 'phone' | 'tablet' | 'desktop';

function detectScreenMode(): DeviceMode {
  if (typeof window === 'undefined') return 'desktop';
  // On TV, always enforce Desktop dual-pane & top island presentation
  if (isTvEnvironment()) return 'desktop';

  const width = window.innerWidth;
  if (width < 640) return 'phone';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

export function useDeviceMode() {
  const [setting, setSetting] = useState<DeviceModeSetting>(() => {
    try {
      const saved = localStorage.getItem('lumen_device_mode');
      if (saved === 'phone' || saved === 'tablet' || saved === 'desktop') {
        return saved;
      }
    } catch (_) {}
    return 'auto';
  });

  const [detectedMode, setDetectedMode] = useState<DeviceMode>(() => detectScreenMode());

  useEffect(() => {
    const handleResize = () => {
      setDetectedMode(detectScreenMode());
    };

    const handleTvChange = () => {
      setDetectedMode(detectScreenMode());
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('lumen-tv-mode-changed', handleTvChange);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('lumen-tv-mode-changed', handleTvChange);
    };
  }, []);

  // When TV mode is active, always lock activeMode to 'desktop'
  const isTv = isTvEnvironment();
  const activeMode: DeviceMode = isTv ? 'desktop' : (setting === 'auto' ? detectedMode : setting);

  const setDeviceModeSetting = useCallback((newSetting: DeviceModeSetting) => {
    setSetting(newSetting);
    try {
      if (newSetting === 'auto') {
        localStorage.removeItem('lumen_device_mode');
      } else {
        localStorage.setItem('lumen_device_mode', newSetting);
      }
    } catch (_) {}
  }, []);

  return {
    deviceMode: activeMode,
    isPhone: activeMode === 'phone',
    isTablet: activeMode === 'tablet',
    isDesktop: activeMode === 'desktop',
    deviceModeSetting: setting,
    setDeviceModeSetting
  };
}
