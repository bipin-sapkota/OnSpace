import { Screen } from '../Screen';
import { esc, itemChip, bar, fmtCredits, fmtTime } from '../dom';
import { getItem, RECHARGE_TABLE } from '../../gameplay/Items';
import { allRecipes } from '../../gameplay/Crafting';
import { allTech, type TechGroup } from '../../gameplay/Upgrades';
import type { Inventory } from '../../gameplay/Inventory';
import type { Game } from '../../core/Game';
import type { UI } from '../UI';

type Tab = 'inventory' | 'crafting' | 'tech' | 'ship' | 'status';

/** Renders technology upgrade cards (shared with the station). */
export function techPanel(game: Game, group: TechGroup | 'all'): string {
  const st = game.state;
  const list = allTech().filter((t) => group === 'all' || t.group === group);
  return `<div class="grid-2">${list.map((t) => {
    const lvl = st.level(t.id);
    const maxed = lvl >= t.maxLevel;
    const locked = t.requires && !st.hasBlueprint(t.requires);
    const cost = maxed ? null : t.cost(lvl + 1);
    const pips = Array.from({ length: t.maxLevel }, (_, i) => `<span style="display:inline-block;width:14px;height:5px;margin-right:3px;background:${i < lvl ? 'var(--accent)' : 'rgba(255,255,255,0.12)'}"></span>`).join('');
    const req = cost ? Object.entries(cost.items).map(([id, n]) => `<span class="${st.count(id) >= n ? 'ok' : 'no'}">${esc(getItem(id).name)} ${Math.min(st.count(id), n)}/${n}</span>`).join('') + `<span class="${st.data.credits >= cost.credits ? 'ok' : 'no'}">${fmtCredits(cost.credits)}</span>` : '';
    const can = cost && !locked && st.canAfford(cost.items, cost.credits);
    return `<div class="card"><div class="row"><h3 style="margin:0">${esc(t.name)}</h3><span class="spacer"></span><span class="pill lvl">${maxed ? 'MAX' : `MK ${lvl} → ${lvl + 1}`}</span></div>
      <div style="margin:4px 0">${pips}</div>
      <div class="meta">${esc(t.description)}</div>
      <div class="meta" style="color:var(--accent);margin-top:4px">${maxed ? esc(t.effect(lvl)) : esc(t.effect(lvl + 1))}</div>
      ${locked ? '<div class="warn" style="font-size:13px;margin-top:6px">Blueprint required — attune to a Signal Monolith</div>' : ''}
      ${cost ? `<div class="req">${req}</div><button class="small ${can ? 'primary' : ''}" data-action="install:${t.id}" ${can ? '' : 'disabled'}>Install</button>` : ''}
    </div>`;
  }).join('')}</div>`;
}

const USE_MAP: Record<string, string> = { life_pack: 'lifeSupport', shield_cell: 'suitShield', hazard_pack: 'hazard', launch_fuel: 'launch' };

export class ExosuitScreen extends Screen {
  tab: Tab;
  private sel: { inv: 'suit' | 'ship'; index: number } | null = null;
  private techGroup: TechGroup = 'suit';

  constructor(ui: UI, game: Game, tab: Tab = 'inventory') {
    super(ui, game);
    this.tab = tab;
    this.on('tab', (t) => {
      this.tab = t as Tab;
      this.render();
    });
    this.on('close', () => this.ui.closeAll(true));
    this.on('slot', (arg) => {
      const [inv, idx] = arg.split('-');
      this.sel = { inv: inv as 'suit' | 'ship', index: Number(idx) };
      this.render();
    });
    this.on('sort', (inv) => {
      (inv === 'suit' ? this.game.state.suit : this.game.state.cargo).sort();
      this.sel = null;
      this.render();
    });
    this.on('transfer', () => this.transfer());
    this.on('discard', () => this.discard());
    this.on('use', () => this.useSelected());
    this.on('recharge', (arg) => {
      const [gauge, item] = arg.split('|');
      this.game.recharge(gauge as keyof typeof RECHARGE_TABLE, item);
      this.render();
    });
    this.on('craft', (arg) => {
      const [id, n] = arg.split('|');
      const r = allRecipes().find((x) => x.id === id);
      if (r) this.game.craft(r, Number(n));
      this.render();
    });
    this.on('install', (id) => {
      this.game.installTech(id);
      this.render();
    });
    this.on('tgroup', (g) => {
      this.techGroup = g as TechGroup;
      this.render();
    });
    this.on('upload', () => {
      this.game.discovery.uploadAll(this.game);
      this.render();
    });
  }

  private inv(which: 'suit' | 'ship'): Inventory {
    return which === 'suit' ? this.game.state.suit : this.game.state.cargo;
  }

  render(): void {
    const tabs: [Tab, string][] = [['inventory', 'Inventory'], ['crafting', 'Crafting'], ['tech', 'Technology'], ['ship', 'Starship'], ['status', 'Status']];
    let body = '';
    switch (this.tab) {
      case 'inventory': body = this.renderInventory(); break;
      case 'crafting': body = this.renderCrafting(); break;
      case 'tech': body = this.renderTech(); break;
      case 'ship': body = this.renderShip(); break;
      case 'status': body = this.renderStatus(); break;
    }
    this.el.innerHTML = `<div class="window"><div class="titlebar"><h2>EXOSUIT</h2>
      <div class="tabs">${tabs.map(([t, l]) => `<button class="${this.tab === t ? 'active' : ''}" data-action="tab:${t}">${l}</button>`).join('')}</div>
      <span class="spacer"></span><span class="credits">${this.game.state.data.credits.toLocaleString()} ¢</span>
      <button class="small" data-action="close">Close</button></div><div class="body">${body}</div></div>`;
  }

  private grid(which: 'suit' | 'ship'): string {
    const inv = this.inv(which);
    return inv.slots.map((s, i) => {
      const selected = this.sel && this.sel.inv === which && this.sel.index === i;
      if (!s) return `<div class="slot ${selected ? 'sel' : ''}" data-action="slot:${which}-${i}"></div>`;
      const it = getItem(s.id);
      return `<div class="slot ${selected ? 'sel' : ''}" data-action="slot:${which}-${i}" title="${esc(it.name)}"><span class="nm">${esc(it.name)}</span><div class="sym" style="background:${it.color}">${it.symbol}</div><span class="cnt">${s.count}</span></div>`;
    }).join('');
  }

  private renderInventory(): string {
    const st = this.game.state;
    let detail = '<div class="dim">Select an item to see details.</div>';
    const slot = this.sel ? this.inv(this.sel.inv).slots[this.sel.index] : null;
    if (slot) {
      const it = getItem(slot.id);
      const usable = USE_MAP[slot.id] !== undefined;
      detail = `<div class="row">${itemChip(slot.id, 44)}<div><h3>${esc(it.name)}</h3><div class="dim" style="font-size:13px;text-transform:uppercase;letter-spacing:0.1em">${it.category} · ${['Common', 'Uncommon', 'Rare', 'Exotic'][it.rarity]}</div></div></div>
        <div class="desc">${esc(it.description)}</div>
        <div class="dim">Quantity <b style="color:var(--text)">${slot.count}</b> · Value ≈ <span class="credits">${fmtCredits(it.value)}</span> each</div>
        <div class="row" style="margin-top:10px">${usable ? '<button class="small primary" data-action="use">Use</button>' : ''}<button class="small" data-action="transfer">Move to ${this.sel!.inv === 'suit' ? 'ship' : 'suit'}</button><button class="small danger" data-action="discard">Discard</button></div>`;
    }
    const p = this.game.player;
    const rech = (label: string, gauge: string, value: number, color: string) => {
      const opts = Object.keys(RECHARGE_TABLE[gauge] ?? {});
      return `<div style="margin-bottom:10px"><div class="row" style="font-size:14px"><span>${label}</span><span class="spacer"></span><span class="dim">${Math.round(value * 100)}%</span></div>${bar(value, color)}
        <div class="row" style="margin-top:4px;flex-wrap:wrap;gap:4px">${opts.map((o) => `<button class="small" data-action="recharge:${gauge}|${o}" ${st.count(o) > 0 ? '' : 'disabled'}>${esc(getItem(o).name)} (${st.count(o)})</button>`).join('')}</div></div>`;
    };
    return `<div style="display:grid;grid-template-columns:1fr 340px;gap:22px;height:100%">
      <div class="col" style="gap:16px">
        <div><div class="row"><div class="section-title">Exosuit · ${st.suit.usedSlots}/${st.suit.capacity}</div><span class="spacer"></span><button class="small ghost" data-action="sort:suit">Sort</button></div><div class="inv-grid">${this.grid('suit')}</div></div>
        <div><div class="row"><div class="section-title">${esc(st.shipClass.name)} Cargo · ${st.cargo.usedSlots}/${st.cargo.capacity}</div><span class="spacer"></span><button class="small ghost" data-action="sort:ship">Sort</button></div><div class="inv-grid">${this.grid('ship')}</div></div>
      </div>
      <div class="col" style="gap:14px">
        <div class="card detail">${detail}</div>
        <div class="card"><div class="section-title">Suit Systems</div>
          ${rech('Life Support', 'lifeSupport', p.lifeSupport, '#ff9f6a')}
          ${rech('Hazard Protection', 'hazard', p.hazard, '#ffd24a')}
          ${st.maxSuitShield > 0 ? rech('Personal Shield', 'suitShield', p.shield / st.maxSuitShield, '#6fd3ff') : ''}
        </div>
      </div></div>`;
  }

  private transfer(): void {
    if (!this.sel) return;
    const from = this.inv(this.sel.inv);
    const to = this.inv(this.sel.inv === 'suit' ? 'ship' : 'suit');
    const s = from.slots[this.sel.index];
    if (!s) return;
    const moved = to.add(s.id, s.count);
    from.removeSlot(this.sel.index, moved);
    if (moved < s.count) this.game.ui.toast('Destination full', 'warn');
    this.game.audio.play('pickup', 0.5);
    this.sel = null;
    this.render();
  }

  private discard(): void {
    if (!this.sel) return;
    this.inv(this.sel.inv).removeSlot(this.sel.index);
    this.sel = null;
    this.render();
  }

  private useSelected(): void {
    if (!this.sel) return;
    const s = this.inv(this.sel.inv).slots[this.sel.index];
    if (!s) return;
    const gauge = USE_MAP[s.id];
    if (gauge) this.game.recharge(gauge as keyof typeof RECHARGE_TABLE, s.id, 1);
    this.render();
  }

  private renderCrafting(): string {
    const st = this.game.state;
    return `<div class="section-title">Fabrication</div><div class="list">${allRecipes().map((r) => {
      const it = getItem(r.output);
      const locked = r.blueprint && !st.hasBlueprint(r.blueprint);
      const can = !locked && st.canAfford(r.inputs);
      const req = Object.entries(r.inputs).map(([id, n]) => `<span class="${st.count(id) >= n ? 'ok' : 'no'}">${esc(getItem(id).name)} ${st.count(id)}/${n}</span>`).join('');
      return `<div class="item" style="cursor:default">${itemChip(r.output, 40)}<div class="grow"><div class="t">${esc(it.name)}${r.amount > 1 ? ` ×${r.amount}` : ''} <span class="faint" style="font-size:13px">· you have ${st.count(r.output)}</span></div>
        <div class="s">${esc(it.description)}</div>${locked ? '<div class="warn" style="font-size:13px">Blueprint unknown</div>' : `<div class="req">${req}</div>`}</div>
        <button class="small ${can ? 'primary' : ''}" data-action="craft:${r.id}|1" ${can ? '' : 'disabled'}>Craft</button><button class="small" data-action="craft:${r.id}|5" ${can ? '' : 'disabled'}>×5</button></div>`;
    }).join('')}</div>`;
  }

  private renderTech(): string {
    const groups: [TechGroup, string][] = [['suit', 'Exosuit'], ['tool', 'Multitool'], ['ship', 'Starship']];
    return `<div class="tabs" style="margin-bottom:14px">${groups.map(([g, l]) => `<button class="${this.techGroup === g ? 'active' : ''}" data-action="tgroup:${g}">${l}</button>`).join('')}
      <span class="spacer"></span><span class="dim" style="align-self:center">Tech Fragments: <b style="color:var(--accent)">${this.game.state.count('tech_fragment')}</b></span></div>${techPanel(this.game, this.techGroup)}`;
  }

  private renderShip(): string {
    const g = this.game;
    const st = g.state;
    const s = st.ship;
    const cls = st.shipClass;
    const rech = (label: string, gauge: string, value: number, color: string, text: string) => {
      const opts = Object.keys(RECHARGE_TABLE[gauge] ?? {});
      return `<div class="card"><div class="row"><b>${label}</b><span class="spacer"></span><span class="dim">${text}</span></div>${bar(value, color)}
        <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px">${opts.map((o) => `<button class="small" data-action="recharge:${gauge}|${o}" ${st.count(o) > 0 ? '' : 'disabled'}>${esc(getItem(o).name)} (${st.count(o)})</button>`).join('')}</div></div>`;
    };
    return `<div class="grid-2"><div class="col" style="gap:12px">
        <div class="card"><h3>${esc(s.name)}</h3><div class="meta">${esc(cls.name)} · ${esc(cls.role)}</div><div class="meta" style="margin-top:6px">${esc(cls.description)}</div>
          <div class="stat-grid" style="margin-top:12px"><div>Max hull</div><div>${Math.round(st.maxHull)}</div><div>Max shield</div><div>${Math.round(st.maxShipShield)}</div><div>Cruise speed</div><div>${Math.round(cls.speed * (1 + st.level('ship_thrusters') * 0.12))} m/s</div><div>Cargo slots</div><div>${st.cargoCapacity}</div><div>Hyperdrive range</div><div>${st.jumpRange > 0 ? `${st.jumpRange} ly` : 'Not installed'}</div><div>Warp cells</div><div>${st.count('warp_cell')}</div></div></div>
      </div><div class="col" style="gap:12px">
        ${rech('Launch Thrusters', 'launch', s.launchFuel, '#4fb2ff', `${Math.round(s.launchFuel * 100)}% · ${Math.floor(s.launchFuel / 0.25)} launches`)}
        ${rech('Pulse Drive', 'pulse', s.pulseFuel, '#c7b8ff', `${Math.round(s.pulseFuel * 100)}%`)}
        ${rech('Hull Integrity', 'hull', s.hull / st.maxHull, '#ff8a6a', `${Math.round(s.hull)} / ${Math.round(st.maxHull)}`)}
        ${rech('Deflector Shield', 'shipShield', s.shield / st.maxShipShield, '#6fd3ff', `${Math.round(s.shield)} / ${Math.round(st.maxShipShield)}`)}
      </div></div>`;
  }

  private renderStatus(): string {
    const g = this.game;
    const d = g.state.data;
    const s = d.stats;
    const disc = d.discoveries;
    const count = (k: string) => disc.filter((x) => x.kind === k).length;
    const pending = g.discovery.pendingReward(g);
    return `<div class="grid-2"><div class="card"><div class="section-title">Wayfarer</div><div class="stat-grid">
        <div>Play time</div><div>${fmtTime(g.time)}</div><div>Credits</div><div class="credits">${fmtCredits(d.credits)}</div>
        <div>Systems visited</div><div>${d.visited.length}</div><div>Signal monoliths attuned</div><div>${d.quest.flags.attuned ?? 0}</div>
        <div>Distance walked</div><div>${((s.distanceWalked ?? 0) / 1000).toFixed(1)} km</div><div>Resources harvested</div><div>${s.harvested ?? 0}</div>
        <div>Items crafted</div><div>${s.crafted ?? 0}</div><div>Missions completed</div><div>${s.missionsCompleted ?? 0}</div>
        <div>Pirates destroyed</div><div>${s.piratesDestroyed ?? 0}</div><div>Warden drones destroyed</div><div>${s.wardensDestroyed ?? 0}</div>
        <div>Hyperspace jumps</div><div>${s.jumps ?? 0}</div><div>Deaths</div><div>${s.deaths ?? 0}</div></div></div>
      <div class="card"><div class="section-title">Discoveries</div><div class="stat-grid">
        <div>Star systems</div><div>${count('system')}</div><div>Planets</div><div>${count('planet')}</div><div>Fauna species</div><div>${count('fauna')}</div>
        <div>Flora species</div><div>${count('flora')}</div><div>Minerals</div><div>${count('mineral')}</div><div>Locations</div><div>${count('poi')}</div></div>
        <div class="row" style="margin-top:14px"><span class="dim">Pending upload: <span class="credits">${fmtCredits(pending)}</span></span><span class="spacer"></span><button class="small primary" data-action="upload" ${pending > 0 ? '' : 'disabled'}>Upload</button></div></div></div>`;
  }
}
