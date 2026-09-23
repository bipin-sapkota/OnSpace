import { SAVE_VERSION, type SaveData } from '../gameplay/GameState';

/**
 * Persistence: multiple save slots in localStorage plus JSON export/import.
 * Save data is versioned so future releases can migrate old saves.
 */
export interface SaveMeta {
  slot: string;
  time: number;
  playTime: number;
  systemName: string;
  location: string;
  credits: number;
}

const PREFIX = 'onspace.save.';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];

export class SaveSystem {
  save(slot: string, data: SaveData, meta: Omit<SaveMeta, 'slot' | 'time'>): boolean {
    try {
      const payload = JSON.stringify({ meta: { ...meta, slot, time: Date.now() }, data });
      localStorage.setItem(PREFIX + slot, payload);
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  }

  load(slot: string): SaveData | null {
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { data: SaveData };
      return this.migrate(parsed.data);
    } catch (e) {
      console.error('Load failed', e);
      return null;
    }
  }

  meta(slot: string): SaveMeta | null {
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      return (JSON.parse(raw) as { meta: SaveMeta }).meta;
    } catch {
      return null;
    }
  }

  list(): SaveMeta[] {
    return SLOTS.map((s) => this.meta(s)).filter((m): m is SaveMeta => !!m);
  }

  latest(): SaveMeta | null {
    const l = this.list().sort((a, b) => b.time - a.time);
    return l[0] ?? null;
  }

  delete(slot: string): void {
    localStorage.removeItem(PREFIX + slot);
  }

  exportSlot(slot: string): void {
    const raw = localStorage.getItem(PREFIX + slot);
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `onspace-${slot}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importFile(file: File, slot: string): Promise<boolean> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { meta: SaveMeta; data: SaveData };
      if (!parsed.data || typeof parsed.data.seed !== 'number') return false;
      parsed.meta.slot = slot;
      localStorage.setItem(PREFIX + slot, JSON.stringify(parsed));
      return true;
    } catch {
      return false;
    }
  }

  private migrate(d: SaveData): SaveData {
    // v1 is current; future migrations go here
    if (!d.version) d.version = SAVE_VERSION;
    d.looted ??= [];
    d.trade ??= {};
    d.stats ??= {};
    d.blueprints ??= [];
    d.asteroidsDepleted ??= [];
    return d;
  }
}
