import type { EQPresetName } from '../types/music';

export type AudioQualityProfile = 'opus' | 'lossless' | 'balanced';

export interface PersistedAudioSettings {
  crossfadeSeconds: number;
  isGapless: boolean;
  isAutomix: boolean;
  isNormalized: boolean;
  isHiFiMode: boolean;
  audioQuality: AudioQualityProfile;
  eqPreset: EQPresetName;
  eqGains: number[];
}

export const AUDIO_SETTINGS_STORAGE_KEY = 'lumen_audio_settings_v1';

export const DEFAULT_AUDIO_SETTINGS: PersistedAudioSettings = {
  crossfadeSeconds: 3,
  isGapless: true,
  isAutomix: true,
  isNormalized: true,
  isHiFiMode: true,
  audioQuality: 'opus',
  eqPreset: 'Flat',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};

const VALID_QUALITIES = new Set<AudioQualityProfile>(['opus', 'lossless', 'balanced']);
const VALID_PRESETS = new Set<EQPresetName>(['Flat', 'Bass Boost', 'Rock', 'Jazz', 'Electronic', 'Vocal']);

export function sanitizeAudioSettings(raw: Partial<PersistedAudioSettings> | null | undefined): PersistedAudioSettings {
  const input = raw && typeof raw === 'object' ? raw : {};
  const cf = Number(input.crossfadeSeconds);
  const crossfadeSeconds = Number.isFinite(cf) ? Math.max(0, Math.min(12, Math.round(cf))) : DEFAULT_AUDIO_SETTINGS.crossfadeSeconds;

  const eqGains = Array.isArray(input.eqGains) && input.eqGains.length === 10
    ? input.eqGains.map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(-12, Math.min(12, n)) : 0;
      })
    : [...DEFAULT_AUDIO_SETTINGS.eqGains];

  const audioQuality: AudioQualityProfile =
    typeof input.audioQuality === 'string' && VALID_QUALITIES.has(input.audioQuality as AudioQualityProfile)
      ? (input.audioQuality as AudioQualityProfile)
      : DEFAULT_AUDIO_SETTINGS.audioQuality;

  const eqPreset: EQPresetName =
    typeof input.eqPreset === 'string' && VALID_PRESETS.has(input.eqPreset as EQPresetName)
      ? (input.eqPreset as EQPresetName)
      : DEFAULT_AUDIO_SETTINGS.eqPreset;

  return {
    crossfadeSeconds,
    isGapless: typeof input.isGapless === 'boolean' ? input.isGapless : DEFAULT_AUDIO_SETTINGS.isGapless,
    isAutomix: typeof input.isAutomix === 'boolean' ? input.isAutomix : DEFAULT_AUDIO_SETTINGS.isAutomix,
    isNormalized: typeof input.isNormalized === 'boolean' ? input.isNormalized : DEFAULT_AUDIO_SETTINGS.isNormalized,
    isHiFiMode: typeof input.isHiFiMode === 'boolean' ? input.isHiFiMode : DEFAULT_AUDIO_SETTINGS.isHiFiMode,
    audioQuality,
    eqPreset,
    eqGains
  };
}

export function loadPersistedAudioSettings(storage?: Pick<Storage, 'getItem'> | null): PersistedAudioSettings {
  const store = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return { ...DEFAULT_AUDIO_SETTINGS, eqGains: [...DEFAULT_AUDIO_SETTINGS.eqGains] };
  try {
    const raw = store.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS, eqGains: [...DEFAULT_AUDIO_SETTINGS.eqGains] };
    return sanitizeAudioSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS, eqGains: [...DEFAULT_AUDIO_SETTINGS.eqGains] };
  }
}

export function savePersistedAudioSettings(
  settings: Partial<PersistedAudioSettings>,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
): PersistedAudioSettings {
  const store = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  const current = loadPersistedAudioSettings(store);
  const merged = sanitizeAudioSettings({ ...current, ...settings });
  if (store) {
    try {
      store.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore storage quota errors
    }
  }
  return merged;
}
