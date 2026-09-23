import * as THREE from 'three';
import './styles.css';
import type { Game } from '../core/Game';
import { el, esc, fmtTime } from './dom';
import { Hud } from './Hud';
import type { Screen } from './Screen';
import { PauseScreen, SettingsScreen, SaveLoadScreen, LoreScreen, IntroScreen } from './screens/SystemScreens';
import { ExosuitScreen } from './screens/ExosuitScreen';
import { MapScreen } from './screens/MapScreen';
import { LogScreen } from './screens/LogScreen';
import { StationScreen } from './screens/StationScreen';
import { GalaxyScreen } from './screens/GalaxyScreen';
import { INTRO_TEXT } from '../gameplay/Lore';
import { events } from '../core/EventBus';

const TIPS = [
  'Blue crystals contain Hydrex — the key ingredient of launch fuel.',
  'Hold F to analyse creatures, plants and minerals. Upload discoveries for credits.',
  'Wardens watch over many worlds. Mine greedily and they will come for you.',
  'The Pulse Drive (R) crosses a star system in seconds — but only outside an atmosphere.',
  'Crashed ships and outposts hide Tech Fragments, the currency of upgrades.',
  'Storms multiply environmental hazards. Seek shelter inside outposts or your ship.',
  'Asteroids are rich in Astrium. Shoot them with your ship cannons to mine them.',
  'Each star system hides a Signal Monolith. Follow the Signal toward the galactic core.',
];

/**
 * UI manager: owns the HUD, the modal screen stack, main menu, loading and
 * death overlays. Screens pause gameplay only when they declare `pauses`.
 */
export class UI {
  readonly root: HTMLDivElement;
  readonly hud: Hud;
  private game: Game;
  private stack: Screen[] = [];
  private menu: HTMLDivElement | null = null;
  private loading: HTMLDivElement | null = null;
  private death: HTMLDivElement | null = null;
  suppressPauseOnUnlock = false;
  private hudOn = true;
  customWaypoint: { pos: () => THREE.Vector3; label: string } | null = null;

  constructor(game: Game) {
    this.game = game;
    this.root = el('div');
    this.root.id = 'ui';
    document.getElementById('app')!.appendChild(this.root);
    this.hud = new Hud(this.root, game);
    // click the canvas to capture the mouse while playing
    game.renderer.renderer.domElement.addEventListener('click', () => {
      if (game.isPlaying && !this.anyScreenOpen) game.input.requestLock();
    });
    events.on('inventory:changed', () => this.refresh());
    events.on('credits:changed', () => this.refresh());
  }

  get anyScreenOpen(): boolean {
    return this.stack.length > 0;
  }

  get paused(): boolean {
    return this.stack.some((s) => s.pauses);
  }

  private refreshQueued = false;
  refresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      const top = this.stack[this.stack.length - 1];
      // don't re-render screens with live canvases/inputs on every change
      if (top && !(top instanceof SettingsScreen) && !(top instanceof GalaxyScreen) && !(top instanceof MapScreen)) {
        const scroll = top.el.querySelector('.body')?.scrollTop ?? 0;
        top.render();
        const body = top.el.querySelector('.body');
        if (body) body.scrollTop = scroll;
      }
    });
  }

  push(s: Screen): void {
    if (this.stack.length === 0) {
      this.suppressPauseOnUnlock = true;
      this.game.input.releaseLock();
      this.game.audio.play('ui_open', 0.6);
    }
    this.stack.push(s);
    this.root.appendChild(s.el);
    s.render();
    s.onOpen();
  }

  pop(): void {
    const s = this.stack.pop();
    if (!s) return;
    s.onClose();
    s.el.remove();
    if (this.stack.length === 0) this.afterAllClosed(true);
  }

  closeAll(relock = false): void {
    while (this.stack.length) {
      const s = this.stack.pop()!;
      s.onClose();
      s.el.remove();
    }
    this.afterAllClosed(relock);
  }

  private afterAllClosed(relock: boolean): void {
    this.game.audio.play('ui_close', 0.5);
    if (this.game.mode === 'docked') {
      // the station screen is the docked "home" view
      setTimeout(() => {
        if (this.game.mode === 'docked' && this.stack.length === 0) this.openStation();
      }, 0);
      return;
    }
    if (relock && this.game.isPlaying) this.game.input.requestLock();
  }

  /** Esc handling: close the top screen if it can be closed. Returns true if consumed. */
  consumeEscape(): boolean {
    const top = this.stack[this.stack.length - 1];
    if (!top) return false;
    if (top instanceof StationScreen) {
      this.openPause();
      return true;
    }
    if (top instanceof PauseScreen) {
      this.closeAll(true);
      return true;
    }
    if (!top.closable) return true;
    if (top instanceof IntroScreen) return true;
    this.pop();
    return true;
  }

  togglePause(): void {
    if (this.stack.some((s) => s instanceof PauseScreen)) this.closeAll(true);
    else this.openPause();
  }

  openPause(): void {
    if (!this.game.isPlaying || this.stack.some((s) => s instanceof PauseScreen)) return;
    this.push(new PauseScreen(this, this.game));
  }

  openExosuit(tab?: 'inventory' | 'crafting' | 'tech' | 'ship' | 'status'): void {
    this.push(new ExosuitScreen(this, this.game, tab));
  }

  openMap(): void {
    this.push(new MapScreen(this, this.game));
  }

  openLog(tab: 'quest' | 'missions' | 'discoveries'): void {
    this.push(new LogScreen(this, this.game, tab));
  }

  openGalaxy(): void {
    this.push(new GalaxyScreen(this, this.game));
  }

  openStation(): void {
    if (this.stack.some((s) => s instanceof StationScreen)) return;
    this.push(new StationScreen(this, this.game));
  }

  showLore(title: string, text: string, reward: string): void {
    this.push(new LoreScreen(this, this.game, title, text, reward));
  }

  showIntro(): void {
    this.push(new IntroScreen(this, this.game, INTRO_TEXT));
  }

  toast(text: string, kind: string): void {
    this.hud.toast(text, kind);
  }

  discoveryBanner(kind: string, name: string, reward: number): void {
    this.hud.showBanner(kind, name, reward);
  }

  toggleHud(): void {
    this.hudOn = !this.hudOn;
    this.hud.setVisible(this.hudOn);
  }

  update(dt: number): void {
    this.hud.update(dt);
    for (const s of this.stack) s.update(dt);
  }

  // ------------------------------------------------------------ overlays
  showLoading(text: string, progress: number): void {
    if (!this.loading) {
      this.loading = el('div');
      this.loading.id = 'loading';
      this.loading.innerHTML = `<div class="spinner"></div><div class="t"></div><div class="bar"><i style="background:var(--accent);color:var(--accent)"></i></div><div class="tip"></div>`;
      (this.loading.querySelector('.tip') as HTMLDivElement).textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
      this.root.appendChild(this.loading);
    }
    (this.loading.querySelector('.t') as HTMLDivElement).textContent = text.toUpperCase();
    (this.loading.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  hideLoading(): void {
    this.loading?.remove();
    this.loading = null;
  }

  showDeath(cause: string): void {
    this.death?.remove();
    this.death = el('div');
    this.death.id = 'death';
    this.death.innerHTML = `<h1>SIGNAL LOST</h1><p>${esc(cause === 'Ship destroyed' ? 'Your ship was destroyed.' : `You succumbed to ${cause}.`)}</p><p class="faint">Some carried resources were lost.</p><button class="primary" data-r>Respawn</button>`;
    this.death.querySelector('[data-r]')!.addEventListener('click', () => this.game.respawn());
    this.root.appendChild(this.death);
    this.game.input.releaseLock();
  }

  hideDeath(): void {
    this.death?.remove();
    this.death = null;
    this.game.input.requestLock();
  }

  // ------------------------------------------------------------ main menu
  showMainMenu(): void {
    this.hideMainMenu();
    const g = this.game;
    if (!g.world.system) g.prepareMenuBackdrop(Math.floor(Math.random() * 1e9));
    const latest = g.saves.latest();
    this.menu = el('div');
    this.menu.id = 'mainmenu';
    this.menu.innerHTML = `<div class="logo">ONSPACE</div><div class="tag">Follow the Silent Signal</div>
      <div class="menu">
        ${latest ? `<button data-m="continue">Continue <span class="faint" style="font-size:13px;text-transform:none;letter-spacing:0">· ${esc(latest.systemName)} · ${fmtTime(latest.playTime)}</span></button>` : ''}
        <button data-m="new">New Journey</button>
        <button data-m="load">Load Game</button>
        <button data-m="settings">Settings</button>
        <button data-m="about">About</button>
      </div>
      <div class="panel"></div>
      <div class="foot">v0.1 · Procedural universe · All assets generated at runtime</div>`;
    this.root.appendChild(this.menu);
    const panel = this.menu.querySelector('.panel') as HTMLDivElement;
    const start = () => g.audio.init();
    this.menu.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => {
      b.addEventListener('mouseenter', () => g.audio.play('ui_hover', 0.3));
      b.addEventListener('click', () => {
        start();
        g.audio.play('ui_click');
        const m = b.dataset.m;
        if (m === 'continue' && latest) {
          const d = g.saves.load(latest.slot);
          if (d) {
            this.hideMainMenu();
            void g.loadGame(d);
          }
        } else if (m === 'new') {
          const seed = Math.floor(Math.random() * 1e9);
          panel.innerHTML = `<div class="card"><div class="section-title">New Journey</div><div class="dim" style="margin-bottom:10px">Every galaxy is generated from a seed. Share seeds to explore the same universe.</div>
            <div class="row"><input type="text" value="${seed}" data-seed style="flex:1"><button class="small" data-rand>🎲</button></div>
            <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="primary" data-go>Begin</button></div></div>`;
          const input = panel.querySelector('[data-seed]') as HTMLInputElement;
          panel.querySelector('[data-rand]')!.addEventListener('click', () => (input.value = String(Math.floor(Math.random() * 1e9))));
          panel.querySelector('[data-go]')!.addEventListener('click', () => {
            const txt = input.value.trim();
            let s = Number(txt);
            if (!Number.isFinite(s)) s = [...txt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
            this.hideMainMenu();
            void g.newGame(Math.abs(Math.floor(s)) % 2147483647);
          });
        } else if (m === 'load') {
          panel.innerHTML = '';
          this.push(new SaveLoadScreen(this, g, 'load', true));
        } else if (m === 'settings') {
          this.push(new SettingsScreen(this, g));
        } else if (m === 'about') {
          panel.innerHTML = `<div class="card"><div class="section-title">About OnSpace</div><div class="dim" style="line-height:1.5">
            A procedural open-world space exploration game. Every star, planet, creature, ship, sound and melody is generated at runtime from a seed — there are no pre-made art or audio assets.<br><br>
            Built with Three.js (MIT). Fonts: Orbitron, Rajdhani, Exo 2 (SIL Open Font License).<br><br>
            <b>Controls:</b> WASD move · Mouse look · LMB mine/fire · E interact · TAB exosuit · M map · G galaxy · Esc menu</div></div>`;
        }
      });
    });
  }

  hideMainMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
