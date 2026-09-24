import { Screen } from '../Screen';
import { esc, fmtTime, fmtCredits } from '../dom';
import { settings, PRESETS, type QualityPreset } from '../../core/Settings';
import { SLOTS } from '../../save/SaveSystem';
import { events } from '../../core/EventBus';

/** Pause menu. */
export class PauseScreen extends Screen {
  override pauses = true;

  render(): void {
    this.el.innerHTML = `<div class="window narrow"><div class="titlebar"><h2>PAUSED</h2></div>
      <div class="body col" style="gap:10px">
        <button class="primary" data-action="resume">Resume</button>
        <button data-action="save">Save Game</button>
        <button data-action="load">Load Game</button>
        <button data-action="settings">Settings</button>
        <button data-action="controls">Controls</button>
        <button class="danger" data-action="quit">Save &amp; Quit to Main Menu</button>
        <div class="faint" style="font-size:13px;margin-top:6px">Play time ${fmtTime(this.game.time)} · ${fmtCredits(this.game.state.data.credits)}</div>
      </div></div>`;
    this.on('resume', () => this.ui.closeAll(true));
    this.on('save', () => this.ui.push(new SaveLoadScreen(this.ui, this.game, 'save')));
    this.on('load', () => this.ui.push(new SaveLoadScreen(this.ui, this.game, 'load')));
    this.on('settings', () => this.ui.push(new SettingsScreen(this.ui, this.game)));
    this.on('controls', () => this.ui.push(new ControlsScreen(this.ui, this.game)));
    this.on('quit', () => this.game.quitToMenu());
  }
}

export class ControlsScreen extends Screen {
  override pauses = true;
  render(): void {
    const rows: [string, string][] = [
      ['W A S D', 'Move / Throttle & roll (ship)'], ['Mouse', 'Look / Steer'], ['Space', 'Jump · Jetpack (hold) · Launch'], ['Shift', 'Sprint · Boost'],
      ['LMB', 'Mine / Fire'], ['Q', 'Switch mining beam / boltcaster'], ['C', 'Scanner pulse'], ['F (hold)', 'Analysis visor'],
      ['E', 'Interact · Board / exit ship · Land · Dock'], ['R', 'Pulse drive (space)'], ['G', 'Galaxy map'], ['Tab / I', 'Exosuit: inventory, crafting, technology'],
      ['B', 'Crafting'], ['M', 'Map'], ['J', 'Mission log'], ['K', 'Discoveries'], ['V', 'Toggle third person (on foot)'], ['L', 'Flashlight'], ['H', 'Toggle HUD'], ['F5', 'Quick save'], ['Esc', 'Pause / close menus'],
    ];
    this.el.innerHTML = `<div class="window narrow"><div class="titlebar"><h2>CONTROLS</h2><button class="close-x small" data-action="back">Back</button></div>
      <div class="body"><div class="keys-table">${rows.map(([k, v]) => `<div><kbd>${esc(k)}</kbd></div><div class="dim">${esc(v)}</div>`).join('')}</div></div></div>`;
    this.on('back', () => this.ui.pop());
  }
}

export class SettingsScreen extends Screen {
  override pauses = true;
  render(): void {
    const s = settings.data;
    const slider = (key: string, label: string, min: number, max: number, step: number, val: number, fmt = (v: number) => v.toFixed(2)) =>
      `<div>${label}</div><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-key="${key}"><div class="dim" data-out="${key}">${fmt(val)}</div>`;
    const check = (key: string, label: string, val: boolean) => `<div>${label}</div><div><input type="checkbox" data-key="${key}" ${val ? 'checked' : ''}></div><div></div>`;
    this.el.innerHTML = `<div class="window" style="height:auto;max-height:90vh;width:min(760px,94vw)"><div class="titlebar"><h2>SETTINGS</h2><button class="close-x small" data-action="back">Back</button></div>
      <div class="body">
        <div class="section-title">Graphics</div>
        <div class="settings-grid">
          <div>Quality preset</div><select data-key="quality">${(Object.keys(PRESETS) as QualityPreset[]).map((q) => `<option value="${q}" ${q === s.quality ? 'selected' : ''}>${q.toUpperCase()}</option>`).join('')}</select><div></div>
          ${slider('renderScale', 'Render scale', 0.5, 1, 0.05, s.renderScale)}
          ${slider('terrainDetail', 'Terrain detail', 0.5, 1.6, 0.05, s.terrainDetail)}
          ${slider('vegetationDensity', 'Vegetation density', 0.2, 1.3, 0.05, s.vegetationDensity)}
          ${slider('atmosphereSteps', 'Atmosphere quality', 6, 32, 1, s.atmosphereSteps, (v) => String(v))}
          ${check('shadows', 'Shadows', s.shadows)}
          ${check('bloom', 'Bloom', s.bloom)}
          ${check('clouds', 'Clouds', s.clouds)}
          ${check('antialias', 'Anti-aliasing (FXAA)', s.antialias)}
          ${check('showFps', 'Performance overlay', s.showFps)}
        </div>
        <div class="section-title" style="margin-top:20px">Controls & Camera</div>
        <div class="settings-grid">
          ${slider('fov', 'Field of view', 55, 100, 1, s.fov, (v) => `${v}°`)}
          ${slider('mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, s.mouseSensitivity)}
          ${check('invertY', 'Invert Y', s.invertY)}
          ${check('motionBlurShake', 'Camera shake', s.motionBlurShake)}
        </div>
        <div class="section-title" style="margin-top:20px">Audio</div>
        <div class="settings-grid">
          ${slider('masterVolume', 'Master', 0, 1, 0.05, s.masterVolume)}
          ${slider('musicVolume', 'Music', 0, 1, 0.05, s.musicVolume)}
          ${slider('sfxVolume', 'Effects', 0, 1, 0.05, s.sfxVolume)}
          ${slider('ambienceVolume', 'Ambience', 0, 1, 0.05, s.ambienceVolume)}
        </div>
        <div class="row" style="margin-top:20px"><button class="small danger" data-action="reset">Reset to defaults</button></div>
      </div></div>`;
    this.on('back', () => this.ui.pop());
    this.on('reset', () => {
      settings.reset();
      this.render();
    });
    this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key as keyof typeof s;
        if (key === 'quality') {
          settings.applyPreset(input.value as QualityPreset);
          this.render();
          return;
        }
        if (input instanceof HTMLInputElement && input.type === 'checkbox') settings.set(key, input.checked as never);
        else settings.set(key, Number(input.value) as never);
        const out = this.el.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = key === 'fov' ? `${input.value}°` : key === 'atmosphereSteps' ? input.value : Number(input.value).toFixed(2);
      });
    });
  }
}

export class SaveLoadScreen extends Screen {
  override pauses = true;
  constructor(ui: import('../UI').UI, game: import('../../core/Game').Game, private modeKind: 'save' | 'load', private fromMenu = false) {
    super(ui, game);
  }

  render(): void {
    const saves = this.game.saves;
    const slots = this.modeKind === 'save' ? SLOTS.filter((s) => s !== 'auto') : SLOTS;
    this.el.innerHTML = `<div class="window narrow" style="width:min(640px,94vw)"><div class="titlebar"><h2>${this.modeKind === 'save' ? 'SAVE GAME' : 'LOAD GAME'}</h2><button class="close-x small" data-action="back">Back</button></div>
      <div class="body list">
        ${slots.map((slot) => {
          const m = saves.meta(slot);
          const title = slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(4)}`;
          return `<div class="item" style="cursor:default"><div class="grow"><div class="t">${title}</div><div class="s">${m ? `${esc(m.systemName)} · ${esc(m.location)} · ${fmtTime(m.playTime)} · ${fmtCredits(m.credits)}<br>${new Date(m.time).toLocaleString()}` : 'Empty'}</div></div>
            ${this.modeKind === 'save' ? `<button class="small primary" data-action="save:${slot}">Save</button>` : `<button class="small primary" data-action="load:${slot}" ${m ? '' : 'disabled'}>Load</button>`}
            ${m ? `<button class="small" data-action="export:${slot}">Export</button><button class="small danger" data-action="del:${slot}">✕</button>` : ''}
          </div>`;
        }).join('')}
        <div class="row" style="margin-top:8px"><label class="dim" style="font-size:14px">Import save file into slot 3: <input type="file" accept=".json,application/json" data-import></label></div>
      </div></div>`;
    this.on('back', () => this.ui.pop());
    this.on('save', (slot) => {
      if (this.game.save(slot)) {
        events.emit('notify', { text: 'Game saved', kind: 'good' });
        this.render();
      }
    });
    this.on('load', (slot) => {
      const d = saves.load(slot);
      if (!d) return;
      this.ui.closeAll();
      this.ui.hideMainMenu();
      void this.game.loadGame(d);
    });
    this.on('export', (slot) => saves.exportSlot(slot));
    this.on('del', (slot) => {
      saves.delete(slot);
      this.render();
    });
    const file = this.el.querySelector<HTMLInputElement>('[data-import]');
    file?.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f && (await saves.importFile(f, 'slot3'))) this.render();
    });
    void this.fromMenu;
  }
}

/** Lore / message dialog. */
export class LoreScreen extends Screen {
  constructor(ui: import('../UI').UI, game: import('../../core/Game').Game, private title: string, private text: string, private reward: string) {
    super(ui, game);
  }
  render(): void {
    this.el.innerHTML = `<div class="window narrow"><div class="titlebar"><h2>${esc(this.title.toUpperCase())}</h2></div>
      <div class="body"><div class="lore-text">${esc(this.text)}</div>${this.reward ? `<div class="good" style="margin-top:16px;font-size:16px">${esc(this.reward)}</div>` : ''}
      <div class="row" style="margin-top:20px;justify-content:flex-end"><button class="primary" data-action="ok">Continue</button></div></div></div>`;
    this.on('ok', () => this.ui.pop());
  }
}

/** Opening narration. */
export class IntroScreen extends Screen {
  private lines: string[];
  private idx = 0;
  private t = 0;
  override pauses = true;
  constructor(ui: import('../UI').UI, game: import('../../core/Game').Game, lines: string[]) {
    super(ui, game);
    this.lines = lines;
    this.el.style.background = 'rgba(0,0,0,0.9)';
  }
  render(): void {
    this.el.innerHTML = `<div style="max-width:760px;text-align:center" class="col">
      ${this.lines.slice(0, this.idx + 1).map((l, i) => `<div style="font-size:${i === this.idx ? 24 : 18}px;color:${i === this.idx ? '#fff' : 'var(--text-faint)'};margin:6px 0;animation:fadeIn 0.8s">${esc(l)}</div>`).join('')}
      <div style="margin-top:30px"><button class="primary" data-action="next">${this.idx >= this.lines.length - 1 ? 'Begin' : 'Continue'}</button></div></div>`;
    this.on('next', () => this.next());
  }
  private next(): void {
    if (this.idx >= this.lines.length - 1) {
      this.ui.closeAll(true);
      return;
    }
    this.idx++;
    this.t = 0;
    this.render();
  }
  override update(dt: number): void {
    this.t += dt;
    if (this.t > 5 && this.idx < this.lines.length - 1) this.next();
  }
}
