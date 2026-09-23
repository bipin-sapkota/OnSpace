/**
 * Input abstraction: raw keyboard/mouse state mapped to named actions so key
 * bindings live in one place. Handles pointer lock for mouse-look.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'sprint' | 'jump'
  | 'interact' | 'fire' | 'aim' | 'scan' | 'analyze' | 'toolMode' | 'inventory'
  | 'map' | 'missions' | 'galaxy' | 'discoveries' | 'pause' | 'rollLeft' | 'rollRight'
  | 'boost' | 'pulse' | 'camera' | 'land' | 'flashlight' | 'quickSave' | 'hud' | 'craft';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['ControlLeft', 'KeyX'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['KeyE'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  scan: ['KeyC'],
  analyze: ['KeyF'],
  toolMode: ['KeyQ'],
  inventory: ['Tab', 'KeyI'],
  map: ['KeyM'],
  missions: ['KeyJ'],
  galaxy: ['KeyG'],
  discoveries: ['KeyK'],
  pause: ['Escape'],
  rollLeft: ['KeyA'],
  rollRight: ['KeyD'],
  boost: ['ShiftLeft'],
  pulse: ['KeyR'],
  camera: ['KeyV'],
  land: ['KeyE'],
  flashlight: ['KeyL'],
  quickSave: ['F5'],
  hud: ['KeyH'],
  craft: ['KeyB'],
};

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  sensitivity = 1;
  invertY = false;
  /** When false, gameplay actions are suppressed (menus open). */
  enabled = true;
  private canvas: HTMLElement;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'F5' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressed.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.released.add(code);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.onPointerLockChange?.(this.locked);
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (!this.locked) {
      const r = this.canvas.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    }
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  isDown(a: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[a].some((c) => this.down.has(c));
  }

  wasPressed(a: Action): boolean {
    if (!this.enabled && a !== 'pause') return false;
    return this.bindings[a].some((c) => this.pressed.has(c));
  }

  wasReleased(a: Action): boolean {
    return this.bindings[a].some((c) => this.released.has(c));
  }

  /** Raw key query (for UI hotkeys independent of bindings). */
  keyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  axis(neg: Action, pos: Action): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  consumeMouse(): { dx: number; dy: number } {
    const s = this.sensitivity;
    const r = { dx: this.mouseDX * s, dy: this.mouseDY * s * (this.invertY ? -1 : 1) };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
  }

  clearAll(): void {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = this.mouseDY = 0;
  }

  keyNameFor(a: Action): string {
    const code = this.bindings[a][0] ?? '';
    return code.replace('Key', '').replace('Mouse0', 'LMB').replace('Mouse2', 'RMB').replace('ShiftLeft', 'Shift').replace('ControlLeft', 'Ctrl').replace('Digit', '');
  }
}
