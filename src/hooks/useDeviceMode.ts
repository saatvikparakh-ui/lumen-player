import { useState, useEffect, useCallback } from 'react';

export type DeviceMode = 'phone' | 'tablet' | 'desktop';
export type DeviceModeSetting = 'auto' | 'phone' | 'tablet' | 'desktop';

function detectScreenMode(): DeviceMode {
  if (typeof window === 'undefined') return 'desktop';
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

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeMode: DeviceMode = setting === 'auto' ? detectedMode : setting;

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
