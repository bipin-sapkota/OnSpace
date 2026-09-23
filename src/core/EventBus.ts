/**
 * Minimal strongly-typed event bus used to decouple gameplay systems from UI,
 * audio and each other. Systems publish facts ("item collected") and any
 * number of listeners react without direct references.
 */
export interface GameEvents {
  'notify': { text: string; kind?: 'info' | 'good' | 'warn' | 'bad' | 'discovery'; icon?: string };
  'item:added': { id: string; amount: number; to: 'suit' | 'ship' };
  'item:removed': { id: string; amount: number };
  'inventory:changed': { which: 'suit' | 'ship' };
  'discovery': { kind: 'system' | 'planet' | 'fauna' | 'flora' | 'mineral' | 'poi'; name: string; id: string; reward: number };
  'mission:updated': { id: string };
  'mission:completed': { id: string; title: string };
  'quest:advanced': { step: number };
  'player:damaged': { amount: number; source: string };
  'player:died': { cause: string };
  'ship:damaged': { amount: number };
  'ship:destroyed': Record<string, never>;
  'ship:launched': Record<string, never>;
  'ship:landed': { planet: string };
  'ship:docked': { station: string };
  'ship:undocked': Record<string, never>;
  'mode:changed': { mode: string };
  'planet:entered': { planetId: string };
  'planet:left': { planetId: string };
  'system:entered': { systemId: number };
  'upgrade:installed': { id: string; level: number };
  'credits:changed': { value: number; delta: number };
  'scan:pulse': { origin: [number, number, number] };
  'harvest': { item: string; amount: number };
  'enemy:killed': { kind: string; reward: number };
  'weather:changed': { planetId: string; kind: string; storm: boolean };
  'save:done': { slot: string };
  'ui:sound': { name: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<GameEvents[K]>)(payload);
      } catch (e) {
        console.error(`Event handler for ${type} failed`, e);
      }
    }
  }
}

export const events = new EventBus();
