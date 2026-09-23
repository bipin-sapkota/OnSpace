import * as THREE from 'three';
import type { Game } from '../core/Game';
import { el, esc, fmtDist, itemChip } from './dom';
import { events } from '../core/EventBus';
import { POI_INFO } from '../entities/poi/POIs';
import { getItem } from '../gameplay/Items';
import { settings } from '../core/Settings';

interface MarkerData {
  key: string;
  pos: THREE.Vector3;
  glyph: string;
  name: string;
  color: string;
  cls?: string;
  showDist?: boolean;
  maxDist?: number;
  hp?: number;
  compass?: boolean;
}

const HAZ_ICON: Record<string, string> = { none: '✓', heat: '🔥', cold: '❄', toxic: '☣', radiation: '☢' };

/**
 * Heads-up display: compass, world markers, vitals, flight instruments,
 * objective tracker, prompts, notifications and discovery banners.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private compass: HTMLDivElement;
  private location: HTMLDivElement;
  private objective: HTMLDivElement;
  private vitals: HTMLDivElement;
  private toolhud: HTMLDivElement;
  private flight: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private stick: HTMLDivElement;
  private prompt: HTMLDivElement;
  private targetInfo: HTMLDivElement;
  private analysis: HTMLDivElement;
  private markers: HTMLDivElement;
  private notes: HTMLDivElement;
  private banner: HTMLDivElement;
  private fps: HTMLDivElement;
  private clickToPlay: HTMLDivElement;
  private markerPool = new Map<string, HTMLDivElement>();
  private slowTimer = 0;
  private game: Game;
  private bannerTimer = 0;

  constructor(parent: HTMLElement, game: Game) {
    this.game = game;
    this.root = el('div');
    this.root.id = 'hud';
    parent.appendChild(this.root);
    this.markers = this.add('div', 'markers');
    this.compass = this.add('div', 'compass');
    this.add('div', 'compass-center');
    this.location = this.add('div', 'location', 'hud-panel');
    this.objective = this.add('div', 'objective', 'hud-panel');
    this.vitals = this.add('div', 'vitals', 'hud-panel');
    this.toolhud = this.add('div', 'toolhud', 'hud-panel');
    this.flight = this.add('div', 'flight', 'hud-panel');
    this.crosshair = this.add('div', 'crosshair');
    this.stick = this.add('div', 'stick');
    this.prompt = this.add('div', 'prompt', 'hud-panel');
    this.targetInfo = this.add('div', 'target-info');
    this.analysis = this.add('div', 'analysis');
    this.analysis.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(95,227,255,0.2)" stroke-width="4"/><circle class="arc" cx="50" cy="50" r="44" fill="none" stroke="#5fe3ff" stroke-width="4" stroke-dasharray="276.5" stroke-dashoffset="276.5"/></svg><div class="lbl"></div>`;
    this.notes = this.add('div', 'notifications');
    this.banner = this.add('div', 'banner');
    this.fps = this.add('div', 'fps');
    this.clickToPlay = this.add('div', 'clickToPlay', 'hud-panel');
    this.clickToPlay.textContent = 'CLICK TO CONTROL';

    events.on('notify', (n) => this.toast(n.text, n.kind ?? 'info', n.icon));
  }

  private add(tag: 'div', id: string, cls?: string): HTMLDivElement {
    const e = el(tag, cls);
    e.id = id;
    this.root.appendChild(e);
    return e;
  }

  toast(text: string, kind: string, icon?: string): void {
    const t = el('div', `toast ${kind}`);
    t.innerHTML = `${icon ? itemChip(icon, 22) : ''}<span>${esc(text)}</span>`;
    this.notes.appendChild(t);
    while (this.notes.children.length > 6) this.notes.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4700);
  }

  showBanner(kind: string, name: string, reward: number): void {
    const labels: Record<string, string> = { system: 'SYSTEM DISCOVERED', planet: 'PLANET DISCOVERED', fauna: 'NEW SPECIES', flora: 'NEW FLORA', mineral: 'MINERAL CATALOGUED', poi: 'LOCATION DISCOVERED' };
    this.banner.innerHTML = `<div class="card"><div class="k">${labels[kind] ?? 'DISCOVERY'}</div><div class="n">${esc(name)}</div><div class="r">+${reward.toLocaleString()} ¢ on upload</div></div>`;
    this.bannerTimer = 4;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('off', !v);
  }

  update(dt: number): void {
    const g = this.game;
    const playing = g.isPlaying || g.mode === 'warp';
    this.root.style.display = playing ? '' : 'none';
    if (!playing) return;
    const foot = g.mode === 'foot';
    const ship = g.mode === 'ship' || g.mode === 'warp';
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0 && this.banner.innerHTML) this.banner.innerHTML = '';

    this.clickToPlay.classList.toggle('hidden', g.input.locked || g.uiBlocking || g.mode === 'docked');

    // crosshair and flight stick
    this.crosshair.className = ship ? 'ship' : g.mining.mode === 'mine' ? 'dot' : '';
    this.crosshair.style.display = g.mode === 'docked' ? 'none' : '';
    this.stick.style.display = ship && g.ship.mode !== 'landed' ? '' : 'none';
    if (ship) {
      const s = g.ship.stick;
      this.stick.style.transform = `translate(${s.x * 120}px, ${s.y * 120}px)`;
    }

    // prompt
    if (g.prompt && !g.uiBlocking) {
      this.prompt.style.display = '';
      this.prompt.innerHTML = `<kbd>${g.prompt.key}</kbd> ${esc(g.prompt.text)}`;
    } else this.prompt.style.display = 'none';

    // mining / analysis target
    const d = g.discovery;
    if (foot && (d.analyzing || d.progress > 0)) {
      this.analysis.style.display = '';
      (this.analysis.querySelector('.arc') as SVGCircleElement).setAttribute('stroke-dashoffset', String(276.5 * (1 - d.progress)));
      (this.analysis.querySelector('.lbl') as HTMLDivElement).textContent = 'ANALYSING';
    } else this.analysis.style.display = 'none';
    let tinfo = '';
    if (foot) {
      const t = g.mining.target;
      if (t && g.mining.mode === 'mine' && t.item) {
        const it = getItem(t.item);
        tinfo = `<div>${esc(it.name)} · ${t.amount}</div><div class="tbar">${this.barHtml(t.health / t.maxHealth, it.color)}</div>`;
      } else if (d.target) {
        tinfo = `<div>${esc(d.targetLabel)}</div><div class="faint" style="font-size:12px"><kbd>F</kbd>hold to analyse</div>`;
      }
    }
    this.targetInfo.innerHTML = tinfo;

    this.updateMarkers();

    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.12;
      this.updatePanels(foot, ship);
    }
  }

  private barHtml(frac: number, color: string): string {
    const f = Math.max(0, Math.min(1, frac));
    return `<div class="bar ${f < 0.2 ? 'low' : ''}"><i style="width:${(f * 100).toFixed(1)}%;background:${color};color:${color}"></i></div>`;
  }

  private barRow(icon: string, frac: number, color: string, val: string): string {
    return `<div class="bar-row"><span class="ic">${icon}</span>${this.barHtml(frac, color)}<span class="val">${val}</span></div>`;
  }

  private updatePanels(foot: boolean, ship: boolean): void {
    const g = this.game;
    const env = g.world.env;
    const sys = g.world.system!;
    const planet = env.planet;
    const inAtmo = planet && (env.inAtmosphere > 0 || env.altitude < planet.desc.terrain.heightScale * 3);

    // location
    let loc = `<div class="name">${esc(inAtmo && planet ? planet.desc.name : g.mode === 'docked' ? sys.stations[0]?.desc.name ?? '' : sys.desc.name)}</div>`;
    if (inAtmo && planet) {
      const pd = planet.desc;
      const tod = env.sunElevation > 0.1 ? 'Day' : env.sunElevation > -0.1 ? (env.sunElevation > 0 ? 'Dusk' : 'Twilight') : 'Night';
      const weather = g.weather.describe(planet);
      loc += `<div class="sub">${esc(pd.archetypeLabel)} ${pd.isMoon ? 'moon' : 'world'} · ${esc(sys.desc.name)}</div>`;
      loc += `<div class="sub"><span class="stat">🌡 ${pd.temperature}°C</span><span class="stat">${HAZ_ICON[pd.hazard]} ${pd.hazard === 'none' ? 'Safe' : pd.hazard}</span><span class="stat">☀ ${tod}</span></div>`;
      loc += `<div class="sub">${esc(weather)}</div>`;
    } else {
      loc += `<div class="sub">${esc(sys.desc.star.classLabel)}-class star · ${sys.planets.length} bodies</div>`;
    }
    if (g.wardens.alert >= 1 && foot) loc += `<div id="warden">WARDEN ALERT ${'◆'.repeat(g.wardens.stars)}${'◇'.repeat(3 - g.wardens.stars)}</div>`;
    else if (g.wardens.alert > 0.2 && foot) loc += `<div id="warden" style="opacity:0.6">WARDENS WATCHING ${'◇'.repeat(3)}</div>`;
    this.location.innerHTML = loc;

    // objective + tracked missions
    const q = g.quest;
    let obj = `<div class="title">Objective</div><div class="head">${esc(q.title(g))}</div><div class="body">${q.text(g)}</div>`;
    const ms = g.missions.active(g);
    if (ms.length) {
      obj += `<div class="missions">${ms.slice(0, 3).map((m) => `<div><span>${esc(m.title)}</span><span>${m.kind === 'gather' ? Math.min(m.goal, g.state.count(String(m.target.item))) : m.progress}/${m.goal}</span></div>`).join('')}</div>`;
    }
    this.objective.innerHTML = obj;

    // vitals
    const p = g.player;
    const st = g.state;
    let v = '';
    v += this.barRow('✚', p.health / 100, '#ff6a6a', `${Math.round(p.health)}`);
    if (st.maxSuitShield > 0) v += this.barRow('◈', p.shield / st.maxSuitShield, '#6fd3ff', `${Math.round(p.shield)}`);
    v += this.barRow('O₂', p.lifeSupport, '#ff9f6a', `${Math.round(p.lifeSupport * 100)}%`);
    const hz = planet?.desc.hazard ?? 'none';
    if (foot && hz !== 'none') v += this.barRow(HAZ_ICON[hz], p.hazard, '#ffd24a', `${Math.round(p.hazard * 100)}%`);
    if (foot) v += this.barRow('⇧', p.jetpack, '#9ef0ff', `${Math.round(p.jetpack * 100)}%`);
    v += `<div class="row" style="margin-top:6px;font-size:14px"><span class="credits">${g.state.data.credits.toLocaleString()} ¢</span><span class="spacer"></span><span class="dim">${g.state.count('tech_fragment')} ◆ fragments</span></div>`;
    this.vitals.innerHTML = v;

    // tool / flight
    this.toolhud.style.display = foot ? '' : 'none';
    this.flight.style.display = ship || g.mode === 'docked' ? '' : 'none';
    if (foot) {
      const mt = g.mining;
      const heatCol = mt.overheated ? '#ff5c5c' : mt.heat > 0.7 ? '#ffb54a' : '#5fe3ff';
      this.toolhud.innerHTML = `<div class="mode">${mt.mode === 'mine' ? '⛏ MINING BEAM' : '✦ BOLTCASTER'}</div>${this.barRow('♨', 1 - mt.heat, heatCol, mt.overheated ? 'HOT' : `${Math.round((1 - mt.heat) * 100)}%`)}
        <div class="keys"><kbd>LMB</kbd>use <kbd>Q</kbd>switch <kbd>C</kbd>scan${mt.scanCooldown > 0 ? ` (${mt.scanCooldown.toFixed(0)}s)` : ''} <kbd>F</kbd>analyse<br><kbd>TAB</kbd>exosuit <kbd>M</kbd>map <kbd>J</kbd>log <kbd>SPACE</kbd>jetpack</div>`;
    }
    if (ship || g.mode === 'docked') {
      const s = g.ship;
      const shp = st.ship;
      const speed = s.mode === 'pulse' ? `${(s.speed / 1000).toFixed(1)}<small>km/s</small>` : `${Math.round(s.speed)}<small>m/s</small>`;
      const status = { landed: 'LANDED', launching: 'LAUNCHING', flying: s.boosting ? 'BOOST' : 'FLIGHT', landing: 'LANDING', pulse: 'PULSE DRIVE', docking: 'DOCKING', docked: 'DOCKED', undocking: 'UNDOCKING', warp: 'HYPERSPACE' }[s.mode];
      const altTxt = s.altitude < 20000 && env.planet ? fmtDist(s.altitude) : '—';
      this.flight.innerHTML = `<div class="row"><div class="speed">${speed}</div><span class="spacer"></span><span class="pill lvl">${status}</span></div>
        <div class="throttle">${this.barHtml(Math.max(0, s.throttle), s.boosting ? '#ffb54a' : '#5fe3ff')}</div>
        ${this.barRow('▣', shp.hull / st.maxHull, '#ff8a6a', `${Math.round(shp.hull)}`)}
        ${this.barRow('◈', shp.shield / Math.max(1, st.maxShipShield), '#6fd3ff', `${Math.round(shp.shield)}`)}
        <div class="grid2"><div>Altitude <b>${altTxt}</b></div><div>Launch <b>${Math.round(shp.launchFuel * 100)}%</b></div><div>Pulse <b>${Math.round(shp.pulseFuel * 100)}%</b></div><div>Warp cells <b>${st.count('warp_cell')}</b></div></div>
        <div class="keys" style="margin-top:6px;font-size:12px;color:var(--text-faint)">${s.mode === 'landed' ? '<kbd>SPACE</kbd>launch <kbd>E</kbd>exit' : '<kbd>W/S</kbd>throttle <kbd>A/D</kbd>roll <kbd>SHIFT</kbd>boost <kbd>R</kbd>pulse <kbd>G</kbd>galaxy'}</div>`;
    }
    if (settings.data.showFps) {
      const r = g.renderer;
      const pl = env.planet;
      this.fps.innerHTML = `${g.fps.toFixed(0)} fps<br>${r.drawCalls} draws<br>${(r.triangles / 1000).toFixed(0)}k tris<br>${pl ? pl.terrain.visibleChunks : 0} chunks<br>${g.world.pool.pending} jobs<br>${g.effects.activeParticles} fx`;
      this.fps.style.display = '';
    } else this.fps.style.display = 'none';

    this.updateCompass();
  }

  // ------------------------------------------------------------- markers
  private collectMarkers(): MarkerData[] {
    const g = this.game;
    const list: MarkerData[] = [];
    const sys = g.world.system;
    if (!sys) return list;
    const foot = g.mode === 'foot';
    const inSpace = g.world.env.inAtmosphere < 0.3;
    const wp = g.quest.waypoint(g);
    if (wp) list.push({ key: 'quest', pos: wp.pos, glyph: '◆', name: wp.label, color: '#ffb54a', showDist: true, compass: true });
    const cw = g.ui.customWaypoint;
    if (cw) list.push({ key: 'custom', pos: cw.pos(), glyph: '⌖', name: cw.label, color: '#ff7ad9', showDist: true, compass: true });
    if (foot || (g.mode === 'ship' && g.ship.mode !== 'landed')) {
      if (g.ship.mode === 'landed' && foot && wp?.label !== 'Your Ship') list.push({ key: 'ship', pos: g.ship.pos.clone().addScaledVector(g.ship.upVec, 4), glyph: '▲', name: 'Ship', color: '#6fd3ff', showDist: true, compass: true });
    }
    if (g.mode === 'ship' || (g.mode === 'foot' && inSpace)) {
      if (inSpace || g.ship.altitude > 3000) {
        for (const p of sys.planets) list.push({ key: `pl${p.desc.id}`, pos: p.position, glyph: '◯', name: p.desc.name, color: '#9fd8ff', showDist: true });
      }
      for (const s of sys.stations) list.push({ key: `st${s.desc.id}`, pos: s.toUniverse(s.bayEntrance), glyph: '⬢', name: s.desc.name, color: '#6dffa8', showDist: true, compass: true });
    }
    // POIs
    const cur = g.pois.current;
    if (cur) {
      const focus = foot ? g.player.pos : g.ship.pos;
      for (const p of g.pois.pois) {
        if (!p.known) continue;
        const pos = cur.toUniverse(p.local.clone().addScaledVector(p.dir, 6));
        const d = pos.distanceTo(focus);
        if (d > 12000) continue;
        const info = POI_INFO[p.type];
        list.push({ key: p.id, pos, glyph: info.icon, name: p.name, color: info.color, showDist: true, compass: true });
      }
    }
    for (const s of g.worldEvents.sites) {
      if (!s.prompt) continue;
      list.push({ key: s.id, pos: s.pos(), glyph: '✹', name: s.label, color: s.color, showDist: true, compass: true });
    }
    // scanned resources
    if (foot && g.player.planet) {
      const planet = g.player.planet;
      for (const h of g.mining.highlights) {
        const it = h.rec.item ? getItem(h.rec.item) : null;
        if (!it) continue;
        list.push({ key: `res${h.rec.id}`, pos: planet.toUniverse(h.rec.pos.clone().addScaledVector(h.rec.up, 1.2 * h.rec.scale)), glyph: it.symbol, name: '', color: it.color, cls: 'res', maxDist: 300 });
      }
    }
    // locked target
    const t = g.lockedTarget;
    if (t && t.alive) {
      list.push({ key: 'target', pos: t.pos, glyph: '', name: t.label ?? '', color: '#ff5c5c', cls: 'target', showDist: true, hp: t.hpFrac ?? 1 });
    }
    return list;
  }

  private updateMarkers(): void {
    const g = this.game;
    const cam = g.renderer.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const used = new Set<string>();
    const focus = g.mode === 'foot' ? g.player.pos : g.ship.pos;
    const v = new THREE.Vector3();
    for (const m of this.collectMarkers()) {
      const dist = m.pos.distanceTo(focus);
      if (m.maxDist && dist > m.maxDist) continue;
      g.world.toRender(m.pos, v);
      v.project(cam);
      const behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * w;
      let y = (-v.y * 0.5 + 0.5) * h;
      let edge = false;
      if (behind || x < 30 || x > w - 30 || y < 60 || y > h - 30) {
        if (m.cls === 'res' || m.cls === 'target') continue;
        edge = true;
        let dx = x - w / 2;
        let dy = y - h / 2;
        if (behind) {
          dx = -dx;
          dy = -dy;
        }
        const s = Math.min((w / 2 - 40) / Math.abs(dx || 1), (h / 2 - 70) / Math.abs(dy || 1));
        x = w / 2 + dx * s;
        y = h / 2 + dy * s;
      }
      let e = this.markerPool.get(m.key);
      if (!e) {
        e = el('div', 'marker');
        this.markers.appendChild(e);
        this.markerPool.set(m.key, e);
      }
      used.add(m.key);
      e.className = `marker ${m.cls ?? ''} ${edge ? 'edge' : ''}`;
      e.style.setProperty('--c', m.color);
      e.style.left = `${x}px`;
      e.style.top = `${y}px`;
      let html: string;
      if (m.cls === 'target') {
        const hpFrac = Math.max(0, m.hp ?? 1);
        html = `<div class="brk"></div><div class="hp"><i style="width:${Math.min(100, hpFrac * 100)}%"></i></div><div class="nm">${esc(m.name)}</div><div class="ds">${fmtDist(dist)}</div>`;
      } else {
        html = `<div class="gl">${m.glyph}</div>${m.name ? `<div class="nm">${esc(m.name)}</div>` : ''}${m.showDist ? `<div class="ds">${fmtDist(dist)}</div>` : ''}`;
      }
      if (e.dataset.h !== html) {
        e.innerHTML = html;
        e.dataset.h = html;
      }
    }
    for (const [k, e] of this.markerPool) {
      if (!used.has(k)) {
        e.remove();
        this.markerPool.delete(k);
      }
    }
  }

  private updateCompass(): void {
    const g = this.game;
    const width = this.compass.clientWidth || 600;
    const cam = g.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const planet = g.world.env.planet;
    const camU = g.cameraRig.posU;
    let up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    let north = new THREE.Vector3(0, 0, -1);
    if (planet && g.world.env.inAtmosphere > 0.05) {
      up = camU.clone().sub(planet.position).normalize();
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(planet.root.quaternion);
      north = axis.addScaledVector(up, -axis.dot(up));
      if (north.lengthSq() < 1e-6) north.set(1, 0, 0);
      north.normalize();
    } else {
      north = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      north.addScaledVector(up, -north.dot(up)).normalize();
    }
    const east = new THREE.Vector3().crossVectors(north, up);
    const f = fwd.clone().addScaledVector(up, -fwd.dot(up));
    const heading = Math.atan2(f.dot(east), f.dot(north));
    const pxPerRad = width / (Math.PI * 0.9);
    let html = '';
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      let da = a - heading;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const x = width / 2 + da * pxPerRad;
      if (x < 0 || x > width) continue;
      const major = i % 9 === 0;
      html += `<div class="tick ${major ? 'major' : ''}" style="left:${x}px"></div>`;
      if (major) html += `<div class="label" style="left:${x}px;${i % 18 ? 'color:var(--text-dim);font-size:10px' : ''}">${labels[i / 9]}</div>`;
    }
    for (const m of this.collectMarkers()) {
      if (!m.compass) continue;
      const d = m.pos.clone().sub(camU);
      d.addScaledVector(up, -d.dot(up));
      if (d.lengthSq() < 1) continue;
      let da = Math.atan2(d.dot(east), d.dot(north)) - heading;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const x = width / 2 + da * pxPerRad;
      if (x < 0 || x > width) continue;
      html += `<div class="cmark" style="left:${x}px;color:${m.color}">${m.glyph}</div>`;
    }
    this.compass.innerHTML = html;
  }
}
