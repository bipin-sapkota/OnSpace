import { getItem } from './Items';

export interface Slot {
  id: string;
  count: number;
}

/**
 * Slot-based inventory with per-item stack limits.
 */
export class Inventory {
  slots: (Slot | null)[];

  constructor(capacity: number, slots?: (Slot | null)[]) {
    this.slots = new Array(capacity).fill(null);
    if (slots) slots.slice(0, capacity).forEach((s, i) => (this.slots[i] = s ? { ...s } : null));
  }

  get capacity(): number {
    return this.slots.length;
  }

  resize(capacity: number): void {
    if (capacity > this.slots.length) {
      while (this.slots.length < capacity) this.slots.push(null);
    }
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Amount of `id` that could still be added. */
  spaceFor(id: string): number {
    const stack = getItem(id).stack;
    let space = 0;
    for (const s of this.slots) {
      if (!s) space += stack;
      else if (s.id === id) space += stack - s.count;
    }
    return space;
  }

  /** Adds up to `amount`, returns how many were added. */
  add(id: string, amount: number): number {
    const stack = getItem(id).stack;
    let left = amount;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.count < stack) {
        const add = Math.min(left, stack - s.count);
        s.count += add;
        left -= add;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(left, stack);
        this.slots[i] = { id, count: add };
        left -= add;
      }
    }
    return amount - left;
  }

  /** Removes up to `amount`, returns how many were removed. */
  remove(id: string, amount: number): number {
    let left = amount;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(left, s.count);
        s.count -= take;
        left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return amount - left;
  }

  removeSlot(index: number, amount?: number): Slot | null {
    const s = this.slots[index];
    if (!s) return null;
    const take = Math.min(amount ?? s.count, s.count);
    s.count -= take;
    if (s.count <= 0) this.slots[index] = null;
    return { id: s.id, count: take };
  }

  get usedSlots(): number {
    return this.slots.filter((s) => s !== null).length;
  }

  /** Merge stacks and sort by category then name. */
  sort(): void {
    const totals = new Map<string, number>();
    for (const s of this.slots) if (s) totals.set(s.id, (totals.get(s.id) ?? 0) + s.count);
    this.slots.fill(null);
    const ids = [...totals.keys()].sort((a, b) => {
      const A = getItem(a), B = getItem(b);
      return A.category.localeCompare(B.category) || A.name.localeCompare(B.name);
    });
    for (const id of ids) this.add(id, totals.get(id)!);
  }

  toJSON(): (Slot | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }
}
