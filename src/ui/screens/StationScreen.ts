import { Screen } from '../Screen';
import { esc, fmtCredits, itemChip, bar } from '../dom';
import type { Game } from '../../core/Game';
import type { UI } from '../UI';
import { getItem } from '../../gameplay/Items';
import { ECON_LABEL } from '../../gameplay/Economy';
import { allShipClasses, getShipClass } from '../../entities/ship/ShipDefs';
import { hashCombine, RNG } from '../../core/Random';
import { techPanel } from './ExosuitScreen';
import { generateShipName } from '../../procgen/names';

type Tab = 'trade' | 'contracts' | 'shipyard' | 'services' | 'tech';

export class StationScreen extends Screen {
  private tab: Tab = 'trade';
  override closable = false;
  private techGroup: 'suit' | 'tool' | 'ship' = 'ship';

  constructor(ui: UI, game: Game) {
    super(ui, game);
    this.on('tab', (t) => {
      this.tab = t as Tab;
      this.render();
    });
    this.on('launch', () => this.game.undock());
    this.on('buy', (arg) => {
      const [id, n] = arg.split('|');
      this.game.economy.buy(this.game, id, Number(n));
      this.game.audio.play('pickup', 0.5);
      this.render();
    });
    this.on('sell', (arg) => {
      const [id, n] = arg.split('|');
      const count = n === 'all' ? this.game.state.count(id) : Number(n);
      this.game.economy.sell(this.game, id, count);
      this.game.audio.play('pickup', 0.5);
      this.render();
    });
    this.on('accept', (idx) => {
      const offer = this.game.missions.board(this.game)[Number(idx)];
      if (offer) this.game.missions.accept(this.game, offer);
      this.render();
    });
    this.on('turnin', (id) => {
      const m = this.game.state.data.missions.find((x) => x.id === id);
      if (m) this.game.missions.turnIn(this.game, m);
      this.render();
    });
    this.on('buyship', (arg) => {
      const [cls, seed] = arg.split('|');
      if (this.game.buyShip(cls, Number(seed))) this.render();
    });
    this.on('service', (kind) => {
      this.service(kind);
      this.render();
    });
    this.on('upload', () => {
      this.game.discovery.uploadAll(this.game);
      this.render();
    });
    this.on('install', (id) => {
      this.game.installTech(id);
      this.render();
    });
    this.on('tgroup', (g) => {
      this.techGroup = g as 'suit' | 'tool' | 'ship';
      this.render();
    });
    this.on('save', () => {
      if (this.game.save('slot1')) this.game.ui.toast('Game saved to Slot 1', 'good');
    });
    this.on('pause', () => this.ui.openPause());
  }

  private serviceCost(kind: string): number {
    const st = this.game.state;
    const s = st.ship;
    switch (kind) {
      case 'repair': return Math.ceil((st.maxHull - s.hull) * 6);
      case 'shield': return Math.ceil((st.maxShipShield - s.shield) * 2);
      case 'launch': return Math.ceil((1 - s.launchFuel) * 600);
      case 'pulse': return Math.ceil((1 - s.pulseFuel) * 900);
      case 'life': return Math.ceil((1 - this.game.player.lifeSupport) * 300 + (1 - this.game.player.hazard) * 300);
    }
    return 0;
  }

  private service(kind: string): void {
    const cost = this.serviceCost(kind);
    const st = this.game.state;
    if (cost <= 0) return;
    if (st.data.credits < cost) {
      this.game.ui.toast('Insufficient credits', 'bad');
      return;
    }
    st.addCredits(-cost);
    const s = st.ship;
    if (kind === 'repair') s.hull = st.maxHull;
    if (kind === 'shield') s.shield = st.maxShipShield;
    if (kind === 'launch') s.launchFuel = 1;
    if (kind === 'pulse') s.pulseFuel = 1;
    if (kind === 'life') {
      this.game.player.lifeSupport = 1;
      this.game.player.hazard = 1;
    }
    this.game.audio.play('craft', 0.6);
  }

  render(): void {
    const g = this.game;
    const sys = g.world.system!;
    const st = sys.stations[0];
    const tabs: [Tab, string][] = [['trade', 'Market'], ['contracts', 'Contracts'], ['shipyard', 'Shipyard'], ['services', 'Services'], ['tech', 'Technology']];
    let body = '';
    if (this.tab === 'trade') body = this.renderTrade();
    else if (this.tab === 'contracts') body = this.renderContracts();
    else if (this.tab === 'shipyard') body = this.renderShipyard();
    else if (this.tab === 'services') body = this.renderServices();
    else body = `<div class="tabs" style="margin-bottom:14px">${(['ship', 'suit', 'tool'] as const).map((t) => `<button class="${this.techGroup === t ? 'active' : ''}" data-action="tgroup:${t}">${t === 'ship' ? 'Starship' : t === 'suit' ? 'Exosuit' : 'Multitool'}</button>`).join('')}</div>${techPanel(g, this.techGroup)}`;
    this.el.innerHTML = `<div class="window"><div class="titlebar"><div><h2>${esc((st?.desc.name ?? 'STATION').toUpperCase())}</h2><div class="dim" style="font-size:13px;letter-spacing:0.1em">${esc(sys.desc.name)} · ${ECON_LABEL[sys.desc.economy]} economy</div></div>
      <div class="tabs">${tabs.map(([t, l]) => `<button class="${this.tab === t ? 'active' : ''}" data-action="tab:${t}">${l}</button>`).join('')}</div>
      <span class="spacer"></span><span class="credits">${g.state.data.credits.toLocaleString()} ¢</span>
      <button class="small" data-action="pause">Menu</button><button class="primary" data-action="launch">Launch ▲</button></div><div class="body">${body}</div></div>`;
  }

  private renderTrade(): string {
    const g = this.game;
    const eco = g.economy;
    const stock = new Set(eco.stock(g));
    // also allow selling anything the player owns
    for (const s of [...g.state.suit.slots, ...g.state.cargo.slots]) if (s) stock.add(s.id);
    const rows = [...stock].map((id) => {
      const it = getItem(id);
      const have = g.state.count(id);
      const canBuy = eco.stock(g).includes(id);
      const bp = eco.buyPrice(g, id);
      const sp = eco.sellPrice(g, id);
      const ratio = sp / it.value;
      const trend = ratio > 1.1 ? '<span class="good">▲</span>' : ratio < 0.85 ? '<span class="bad">▼</span>' : '<span class="faint">•</span>';
      return `<tr><td><div class="row">${itemChip(id, 24)}<div><div>${esc(it.name)}</div><div class="faint" style="font-size:12px">${it.category}</div></div></div></td>
        <td>${have}</td><td class="credits">${canBuy ? bp.toLocaleString() : '—'}</td><td class="credits">${sp.toLocaleString()} ${trend}</td>
        <td><div class="row" style="gap:4px">${canBuy ? `<button class="small" data-action="buy:${id}|1">Buy</button><button class="small" data-action="buy:${id}|10">×10</button>` : ''}
        <button class="small amber" data-action="sell:${id}|1" ${have ? '' : 'disabled'}>Sell</button><button class="small amber" data-action="sell:${id}|all" ${have ? '' : 'disabled'}>All</button></div></td></tr>`;
    });
    return `<table class="trade"><thead><tr><th>Commodity</th><th>Owned</th><th>Buy</th><th>Sell</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  private renderContracts(): string {
    const g = this.game;
    const board = g.missions.board(g);
    const active = g.missions.active(g);
    return `<div class="grid-2"><div><div class="section-title">Mission board</div><div class="list">${board.map((m, i) => `<div class="item" style="cursor:default"><div class="grow"><div class="t">${esc(m.title)}</div><div class="s">${esc(m.description)}</div>
        <div class="s">${esc(m.giver)} · <span class="credits">${fmtCredits(m.reward.credits)}</span>${m.reward.items ? ` + ${Object.entries(m.reward.items).map(([id, n]) => `${n} ${esc(getItem(id).name)}`).join(', ')}` : ''}</div></div>
        <button class="small primary" data-action="accept:${i}">Accept</button></div>`).join('') || '<div class="faint">No contracts available. Check back later.</div>'}</div></div>
      <div><div class="section-title">Your contracts</div><div class="list">${active.map((m) => {
        const gather = m.kind === 'gather';
        const have = gather ? g.state.count(String(m.target.item)) : m.progress;
        return `<div class="item" style="cursor:default"><div class="grow"><div class="t">${esc(m.title)}</div><div class="s">${esc(m.description)}</div></div><span class="pill">${Math.min(have, m.goal)}/${m.goal}</span>
          ${gather && m.systemId === g.state.data.systemId ? `<button class="small primary" data-action="turnin:${m.id}" ${have >= m.goal ? '' : 'disabled'}>Deliver</button>` : ''}</div>`;
      }).join('') || '<div class="faint">None active.</div>'}</div></div></div>`;
  }

  private offers(): { cls: string; seed: number; name: string }[] {
    const g = this.game;
    const sys = g.world.system!.desc;
    const rng = new RNG(hashCombine(sys.seed, Math.floor(g.time / 1200), 0x5419));
    const classes = allShipClasses().filter((c) => c.id !== 'exotic' || rng.chance(0.25));
    return rng.shuffle(classes.slice()).slice(0, 3).map((c) => {
      const seed = rng.int(0, 1e9);
      return { cls: c.id, seed, name: generateShipName(seed) };
    });
  }

  private renderShipyard(): string {
    const g = this.game;
    const cur = getShipClass(g.state.ship.classId);
    const tradeIn = Math.round(cur.price * 0.5);
    const statBar = (v: number, max: number) => bar(v / max, '#5fe3ff', 0);
    return `<div class="dim" style="margin-bottom:12px">Current ship: <b style="color:var(--text)">${esc(g.state.ship.name)}</b> (${esc(cur.name)}) · Trade-in value <span class="credits">${fmtCredits(tradeIn)}</span>. Cargo transfers automatically; installed technology carries over.</div>
      <div class="grid-3">${this.offers().map((o) => {
        const c = getShipClass(o.cls);
        const price = Math.max(0, c.price - tradeIn);
        const same = o.cls === g.state.ship.classId;
        return `<div class="card"><div class="section-title">${esc(c.role)}</div><h3>${esc(o.name)}</h3><div class="meta">${esc(c.name)}</div><div class="meta" style="margin:6px 0 10px">${esc(c.description)}</div>
          <div style="font-size:13px" class="col">
            <div>Hull ${statBar(c.hull, 450)}</div><div>Shields ${statBar(c.shield, 280)}</div><div>Speed ${statBar(c.speed, 320)}</div>
            <div>Agility ${statBar(c.agility, 1.5)}</div><div>Firepower ${statBar(c.damage, 1.7)}</div><div>Cargo ${c.cargo} slots · Hyper +${c.hyperBonus} ly</div></div>
          <div class="row" style="margin-top:12px"><span class="credits">${fmtCredits(price)}</span><span class="spacer"></span><button class="small primary" data-action="buyship:${o.cls}|${o.seed}" ${g.state.data.credits >= price && !same ? '' : 'disabled'}>${same ? 'Owned class' : 'Purchase'}</button></div></div>`;
      }).join('')}</div>`;
  }

  private renderServices(): string {
    const g = this.game;
    const st = g.state;
    const s = st.ship;
    const row = (kind: string, label: string, frac: number, color: string) => {
      const cost = this.serviceCost(kind);
      return `<div class="card"><div class="row"><b>${label}</b><span class="spacer"></span><span class="dim">${Math.round(frac * 100)}%</span></div>${bar(frac, color)}
        <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="small primary" data-action="service:${kind}" ${cost > 0 && st.data.credits >= cost ? '' : 'disabled'}>${cost > 0 ? `Service · ${fmtCredits(cost)}` : 'Full'}</button></div></div>`;
    };
    const pending = g.discovery.pendingReward(g);
    return `<div class="grid-2"><div class="col" style="gap:12px">
      ${row('repair', 'Hull repair', s.hull / st.maxHull, '#ff8a6a')}
      ${row('shield', 'Shield recharge', s.shield / st.maxShipShield, '#6fd3ff')}
      ${row('launch', 'Launch thruster refuel', s.launchFuel, '#4fb2ff')}
      ${row('pulse', 'Pulse drive refuel', s.pulseFuel, '#c7b8ff')}
      ${row('life', 'Exosuit life support & hazard refill', (g.player.lifeSupport + g.player.hazard) / 2, '#ff9f6a')}
    </div><div class="col" style="gap:12px">
      <div class="card"><div class="section-title">Cartography Guild</div><div class="dim">Upload your discoveries to the galactic registry for credits.</div>
        <div class="row" style="margin-top:10px"><span class="credits">${fmtCredits(pending)}</span><span class="spacer"></span><button class="small primary" data-action="upload" ${pending > 0 ? '' : 'disabled'}>Upload discoveries</button></div></div>
      <div class="card"><div class="section-title">Records</div><div class="dim">Save your progress to Slot 1.</div><div class="row" style="margin-top:10px"><span class="spacer"></span><button class="small" data-action="save">Save game</button></div></div>
    </div></div>`;
  }
}
