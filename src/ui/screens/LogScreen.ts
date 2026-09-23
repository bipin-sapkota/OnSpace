import { Screen } from '../Screen';
import { esc, fmtCredits, itemChip } from '../dom';
import type { Game } from '../../core/Game';
import type { UI } from '../UI';
import type { DiscoveryEntry } from '../../gameplay/GameState';

type Tab = 'quest' | 'missions' | 'discoveries';

export class LogScreen extends Screen {
  private tab: Tab;
  private filter: DiscoveryEntry['kind'] | 'all' = 'all';

  constructor(ui: UI, game: Game, tab: Tab = 'missions') {
    super(ui, game);
    this.tab = tab;
    this.on('tab', (t) => {
      this.tab = t as Tab;
      this.render();
    });
    this.on('close', () => this.ui.closeAll(true));
    this.on('abandon', (id) => {
      this.game.missions.abandon(this.game, id);
      this.render();
    });
    this.on('filter', (f) => {
      this.filter = f as DiscoveryEntry['kind'] | 'all';
      this.render();
    });
    this.on('upload', () => {
      this.game.discovery.uploadAll(this.game);
      this.render();
    });
  }

  render(): void {
    const tabs: [Tab, string][] = [['quest', 'Journey'], ['missions', 'Missions'], ['discoveries', 'Discoveries']];
    let body = '';
    const g = this.game;
    if (this.tab === 'quest') {
      const q = g.quest;
      body = `<div class="card" style="max-width:720px"><div class="section-title">The Silent Signal</div><h3>${esc(q.title(g))}</h3><div class="dim" style="font-size:16px;line-height:1.5;margin-top:6px">${q.text(g)}</div></div>
        <div class="card" style="max-width:720px;margin-top:14px"><div class="section-title">Chronicle</div><div class="dim" style="line-height:1.6">
        You woke beside a grounded ship with no memory — only the Silent Signal, pulsing on every channel.<br>
        ${g.state.data.quest.step > 3 ? 'You reached orbit and felt the Signal grow stronger.<br>' : ''}
        ${(g.state.data.quest.flags.monoliths ?? 0) > 0 ? `You have communed with ${g.state.data.quest.flags.monoliths} Veil monolith(s).<br>` : ''}
        ${g.state.data.visited.length > 1 ? `You have crossed hyperspace to ${g.state.data.visited.length - 1} other system(s).<br>` : ''}
        ${(g.state.data.quest.flags.attuned ?? 0) >= 5 ? 'The Signal named its source: HARBOUR, at the heart of the galaxy.' : ''}
        </div></div>`;
    } else if (this.tab === 'missions') {
      const active = g.missions.active(g);
      const done = g.state.data.missions.filter((m) => m.status === 'complete').slice(-8).reverse();
      body = `<div class="section-title">Active contracts (${active.length}/6)</div><div class="list">${active.map((m) => `<div class="item" style="cursor:default"><div class="grow"><div class="t">${esc(m.title)}</div><div class="s">${esc(m.description)}</div>
        <div class="s">Issued by ${esc(m.giver)} · Reward <span class="credits">${fmtCredits(m.reward.credits)}</span>${m.reward.items ? ' + items' : ''}</div></div>
        <span class="pill">${m.kind === 'gather' ? `${Math.min(m.goal, g.state.count(String(m.target.item)))}/${m.goal}` : `${m.progress}/${m.goal}`}</span><button class="small danger" data-action="abandon:${m.id}">Abandon</button></div>`).join('') || '<div class="faint">No active contracts. Visit a space station mission board.</div>'}</div>
        ${done.length ? `<div class="section-title" style="margin-top:18px">Completed</div><div class="list">${done.map((m) => `<div class="item" style="cursor:default;opacity:0.7"><div class="grow"><div class="t">${esc(m.title)}</div></div><span class="good">✓</span></div>`).join('')}</div>` : ''}`;
    } else {
      const all = g.state.data.discoveries;
      const list = (this.filter === 'all' ? all : all.filter((d) => d.kind === this.filter)).slice().reverse();
      const pending = g.discovery.pendingReward(g);
      const kinds: (DiscoveryEntry['kind'] | 'all')[] = ['all', 'system', 'planet', 'fauna', 'flora', 'mineral', 'poi'];
      const icon: Record<string, string> = { system: '✺', planet: '◯', fauna: '🐾', flora: '❦', mineral: '◆', poi: '⌖' };
      body = `<div class="row" style="margin-bottom:12px"><div class="tabs">${kinds.map((k) => `<button class="${this.filter === k ? 'active' : ''}" data-action="filter:${k}">${k === 'poi' ? 'Sites' : k}</button>`).join('')}</div><span class="spacer"></span>
        <span class="dim">Pending: <span class="credits">${fmtCredits(pending)}</span></span><button class="small primary" data-action="upload" ${pending > 0 ? '' : 'disabled'}>Upload all</button></div>
        <div class="list">${list.map((d) => `<div class="item" style="cursor:default"><span style="font-size:20px;width:26px;text-align:center">${icon[d.kind]}</span><div class="grow"><div class="t">${esc(d.name)}</div>
          <div class="s">${esc(d.kind.toUpperCase())} · ${esc(d.where)}${d.meta ? ' · ' + Object.entries(d.meta).map(([k, v]) => `${esc(k)}: ${esc(String(v))}`).join(' · ') : ''}</div></div>
          <span class="${d.uploaded ? 'faint' : 'credits'}">${d.uploaded ? 'Uploaded' : `+${d.reward.toLocaleString()} ¢`}</span></div>`).join('') || '<div class="faint">Nothing catalogued yet. Hold F to analyse creatures, plants and minerals.</div>'}</div>`;
      void itemChip;
    }
    this.el.innerHTML = `<div class="window"><div class="titlebar"><h2>LOG</h2><div class="tabs">${tabs.map(([t, l]) => `<button class="${this.tab === t ? 'active' : ''}" data-action="tab:${t}">${l}</button>`).join('')}</div>
      <span class="spacer"></span><button class="small" data-action="close">Close</button></div><div class="body">${body}</div></div>`;
  }
}
