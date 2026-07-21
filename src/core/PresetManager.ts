import type { AppSettings, Preset } from '../types';
import { builtinPresets } from '../presets/builtin';
import { clone, defaultSettings } from '../config/defaults';

const STORAGE_KEY = 'particle-studio:presets:v1';
// Bumped when the starting-count logic changes so returning users pick up the
// new hardware-based default instead of a stale saved value. v3: fresh sessions
// now start at the device's recommended count (e.g. ~250K on Apple Silicon).
const SETTINGS_KEY = 'particle-studio:settings:v3';

// ============================================================================
// PresetManager — built-in presets plus user presets in LocalStorage, with
// save / rename / duplicate / delete / import / export.
// ============================================================================
export class PresetManager {
  private userPresets: Preset[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.userPresets = JSON.parse(raw) as Preset[];
    } catch {
      this.userPresets = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userPresets));
    } catch (err) {
      console.warn('Could not persist presets', err);
    }
  }

  all(): Preset[] {
    return [...builtinPresets(), ...this.userPresets];
  }

  get(name: string): Preset | undefined {
    return this.all().find((p) => p.name === name);
  }

  save(name: string, settings: AppSettings): Preset {
    const existing = this.userPresets.findIndex((p) => p.name === name);
    const preset: Preset = { name, version: 1, settings: clone(settings) };
    if (existing >= 0) this.userPresets[existing] = preset;
    else this.userPresets.push(preset);
    this.persist();
    return preset;
  }

  rename(oldName: string, newName: string): boolean {
    const p = this.userPresets.find((x) => x.name === oldName);
    if (!p) return false;
    p.name = newName;
    this.persist();
    return true;
  }

  duplicate(name: string): Preset | null {
    const src = this.get(name);
    if (!src) return null;
    let newName = `${name} copy`;
    let i = 2;
    while (this.get(newName)) newName = `${name} copy ${i++}`;
    return this.save(newName, clone(src.settings));
  }

  delete(name: string): void {
    this.userPresets = this.userPresets.filter((p) => p.name !== name);
    this.persist();
  }

  isBuiltIn(name: string): boolean {
    return builtinPresets().some((p) => p.name === name);
  }

  exportJson(name: string): string | null {
    const p = this.get(name);
    if (!p) return null;
    return JSON.stringify({ name: p.name, version: p.version, settings: p.settings }, null, 2);
  }

  importJson(json: string): Preset {
    const parsed = JSON.parse(json) as Partial<Preset>;
    if (!parsed.settings || typeof parsed.settings !== 'object') {
      throw new Error('Invalid preset file: missing settings');
    }
    // Merge onto defaults to tolerate older/partial preset files.
    const merged = { ...defaultSettings(), ...parsed.settings } as AppSettings;
    let name = parsed.name || 'Imported preset';
    let i = 2;
    while (this.get(name)) name = `${parsed.name || 'Imported'} ${i++}`;
    return this.save(name, merged);
  }

  saveCurrentSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota errors */
    }
  }

  loadCurrentSettings(): AppSettings | null {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return null;
      return { ...defaultSettings(), ...(JSON.parse(raw) as AppSettings) };
    } catch {
      return null;
    }
  }
}
