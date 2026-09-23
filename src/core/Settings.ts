/**
 * Persistent user settings with quality presets.
 */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface GameSettings {
  quality: QualityPreset;
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  terrainDetail: number; // LOD split factor multiplier
  vegetationDensity: number;
  bloom: boolean;
  clouds: boolean;
  atmosphereSteps: number;
  antialias: boolean;
  fov: number;
  mouseSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  showFps: boolean;
  motionBlurShake: boolean;
}

export const PRESETS: Record<QualityPreset, Partial<GameSettings>> = {
  low: { renderScale: 0.7, shadows: false, shadowMapSize: 1024, terrainDetail: 0.7, vegetationDensity: 0.4, bloom: false, clouds: true, atmosphereSteps: 8, antialias: false },
  medium: { renderScale: 0.85, shadows: true, shadowMapSize: 1024, terrainDetail: 0.9, vegetationDensity: 0.7, bloom: true, clouds: true, atmosphereSteps: 12, antialias: true },
  high: { renderScale: 1, shadows: true, shadowMapSize: 2048, terrainDetail: 1.0, vegetationDensity: 1, bloom: true, clouds: true, atmosphereSteps: 16, antialias: true },
  ultra: { renderScale: 1, shadows: true, shadowMapSize: 4096, terrainDetail: 1.3, vegetationDensity: 1.25, bloom: true, clouds: true, atmosphereSteps: 24, antialias: true },
};

const DEFAULTS: GameSettings = {
  quality: 'high',
  renderScale: 1,
  shadows: true,
  shadowMapSize: 2048,
  terrainDetail: 1,
  vegetationDensity: 1,
  bloom: true,
  clouds: true,
  atmosphereSteps: 16,
  antialias: true,
  fov: 72,
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  ambienceVolume: 0.7,
  showFps: false,
  motionBlurShake: true,
};

const KEY = 'onspace.settings.v1';

export class Settings {
  data: GameSettings;
  private listeners = new Set<(s: GameSettings) => void>();

  constructor() {
    this.data = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }

  applyPreset(p: QualityPreset): void {
    Object.assign(this.data, PRESETS[p], { quality: p });
    this.changed();
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    this.data[key] = value;
    this.changed();
  }

  onChange(fn: (s: GameSettings) => void): void {
    this.listeners.add(fn);
  }

  changed(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(this.data);
  }

  reset(): void {
    this.data = { ...DEFAULTS };
    this.changed();
  }
}

export const settings = new Settings();
