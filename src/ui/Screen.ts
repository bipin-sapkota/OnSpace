import type { Game } from '../core/Game';
import type { UI } from './UI';
import { el } from './dom';

/**
 * Base class for full-screen menus. Screens render into their own element
 * and handle clicks through `data-action` delegation, which keeps screen code
 * declarative and avoids leaking listeners across re-renders.
 */
export abstract class Screen {
  readonly el: HTMLDivElement;
  protected game: Game;
  protected ui: UI;
  /** Screens that pause the simulation while open. */
  pauses = false;
  closable = true;
  private actions = new Map<string, (arg: string, target: HTMLElement) => void>();

  constructor(ui: UI, game: Game) {
    this.ui = ui;
    this.game = game;
    this.el = el('div', 'screen');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!t || !this.el.contains(t)) return;
      if ((t as HTMLButtonElement).disabled) return;
      const [name, arg = ''] = (t.dataset.action ?? '').split(':');
      const fn = this.actions.get(name);
      if (fn) {
        this.game.audio.play('ui_click', 0.6);
        fn(arg, t);
      }
    });
    this.el.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t && !t.disabled && this.el.contains(t)) this.game.audio.play('ui_hover', 0.3);
    });
  }

  protected on(name: string, fn: (arg: string, target: HTMLElement) => void): void {
    this.actions.set(name, fn);
  }

  abstract render(): void;
  onOpen(): void {}
  onClose(): void {}
  update(_dt: number): void {}
}
