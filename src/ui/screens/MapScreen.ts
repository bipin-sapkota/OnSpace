import * as THREE from 'three';
import { Screen } from '../Screen';
import { esc, fmtDist } from '../dom';
import type { Game } from '../../core/Game';
import type { UI } from '../UI';
import type { Planet } from '../../world/Planet';
import { POI_INFO } from '../../entities/poi/POIs';
import { rgbToCss } from '../../procgen/color';
import { getItem } from '../../gameplay/Items';

type Tab = 'system' | 'planet';

const planetMapCache = new Map<string, HTMLCanvasElement>();

/** Equirectangular preview of a planet surface, rendered once from the height/biome functions. */
function planetImage(p: Planet): HTMLCanvasElement {
  const cached = planetMapCache.get(p.key);
  if (cached) return cached;
  const W = 360, H = 180;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const col: [number, number, number] = [0, 0, 0];
  const d = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
      d.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      const h = p.gen.height(d.x, d.y, d.z, 60);
      // approximate slope from a neighbour for shading
      const h2 = p.gen.height(d.x + 0.01, d.y, d.z, 60);
      p.gen.color(d.x, d.y, d.z, h, 0, col);
      const shade = Math.max(0.55, Math.min(1.3, 1 + (h2 - h) / (p.desc.terrain.heightScale * 0.25)));
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, col[0] * 255 * shade);
      img.data[i + 1] = Math.min(255, col[1] * 255 * shade);
      img.data[i + 2] = Math.min(255, col[2] * 255 * shade);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  planetMapCache.set(p.key, c);
  return c;
}

export class MapScreen extends Screen {
  private tab: Tab;
  private canvas: HTMLCanvasElement | null = null;
  private selected: string | null = null;
  private zoom = 1;
  private hits: { x: number; y: number; r: number; id: string }[] = [];

  constructor(ui: UI, game: Game) {
    super(ui, game);
    this.tab = game.world.env.inAtmosphere > 0.05 || game.mode === 'foot' ? 'planet' : 'system';
    this.on('tab', (t) => {
      this.tab = t as Tab;
      this.render();
    });
    this.on('close', () => this.ui.closeAll(true));
    this.on('waypoint', (id) => {
      const p = this.game.world.system!.planet(id);
      if (p) {
        this.game.ui.customWaypoint = { pos: () => p.position.clone(), label: p.desc.name };
        this.game.ui.toast(`Waypoint set: ${p.desc.name}`, 'info');
      }
    });
    this.on('clearwp', () => {
      this.game.ui.customWaypoint = null;
      this.render();
    });
  }

  render(): void {
    const sys = this.game.world.system!;
    const planet = this.game.world.env.planet;
    let side = '';
    if (this.tab === 'system') {
      const p = this.selected ? sys.planet(this.selected) : null;
      if (p) {
        const d = p.desc;
        const fauna = this.game.creatures.speciesFor(p).length;
        side = `<h3 style="margin:0">${esc(d.name)}</h3><div class="dim">${esc(d.archetypeLabel)} ${d.isMoon ? 'moon' : 'planet'}</div>
          <div class="desc" style="margin:8px 0;color:var(--text-dim)">${esc(d.description)}</div>
          <div class="stat-grid"><div>Radius</div><div>${(d.radius / 1000).toFixed(1)} km</div><div>Gravity</div><div>${d.gravity.toFixed(1)} m/s²</div>
          <div>Temperature</div><div>${d.temperature}°C</div><div>Hazard</div><div>${d.hazard === 'none' ? 'None' : d.hazard}</div>
          <div>Atmosphere</div><div>${d.atmosphere.enabled ? 'Yes' : 'None'}</div><div>Fauna species</div><div>${fauna || 'None'}</div>
          <div>Warden activity</div><div>${d.wardenLevel > 0.6 ? 'High' : d.wardenLevel > 0.3 ? 'Moderate' : 'Low'}</div>
          <div>Distance</div><div>${fmtDist(p.position.distanceTo(this.game.cameraRig.posU))}</div></div>
          <div class="section-title" style="margin-top:12px">Resources</div><div class="req">${d.terrain.resourceNodes.map((r) => `<span>${esc(getItem(r.item).name)}</span>`).join('')}</div>
          ${d.hasSignal ? '<div style="color:var(--violet);margin-top:8px">◆ The Silent Signal resonates here</div>' : ''}
          <div class="row" style="margin-top:12px"><button class="small primary" data-action="waypoint:${d.id}">Set waypoint</button></div>`;
      } else {
        side = `<h3 style="margin:0">${esc(sys.desc.name)}</h3><div class="dim">${sys.desc.star.classLabel}-class star · ${sys.planets.length} bodies</div>
          <div class="stat-grid" style="margin-top:10px"><div>Economy</div><div>${esc(sys.desc.economy)}</div><div>Conflict</div><div>${sys.desc.conflict > 0.6 ? 'High' : sys.desc.conflict > 0.3 ? 'Moderate' : 'Low'}</div><div>Station</div><div>${esc(sys.stations[0]?.desc.name ?? '—')}</div></div>
          <div class="faint" style="margin-top:12px">Click a planet for details.</div>`;
      }
    } else {
      side = planet ? `<h3 style="margin:0">${esc(planet.desc.name)}</h3><div class="dim">${esc(planet.desc.archetypeLabel)} · ${esc(this.game.weather.describe(planet))}</div>
        <div class="section-title" style="margin-top:12px">Known sites</div>
        <div class="list">${this.game.pois.generate(planet, this.game).filter((p) => p.known).map((p) => `<div class="item" style="cursor:default"><span style="color:${POI_INFO[p.type].color}">${POI_INFO[p.type].icon}</span><div class="grow"><div class="t" style="font-size:14px">${esc(p.name)}</div><div class="s">${p.visited ? 'Visited' : 'Unvisited'}</div></div></div>`).join('') || '<div class="faint">None yet. Use your scanner (C), beacons and terminals.</div>'}</div>` : '<div class="faint">No planet nearby.</div>';
    }
    this.el.innerHTML = `<div class="window"><div class="titlebar"><h2>NAVIGATION</h2>
      <div class="tabs"><button class="${this.tab === 'system' ? 'active' : ''}" data-action="tab:system">System</button><button class="${this.tab === 'planet' ? 'active' : ''}" data-action="tab:planet">Planet</button></div>
      <span class="spacer"></span>${this.game.ui.customWaypoint ? '<button class="small" data-action="clearwp">Clear waypoint</button>' : ''}<button class="small" data-action="close">Close</button></div>
      <div class="body" style="display:grid;grid-template-columns:1fr 320px;gap:18px;overflow:hidden"><canvas class="map-canvas"></canvas><div style="overflow:auto">${side}</div></div></div>`;
    this.canvas = this.el.querySelector('canvas');
    this.canvas!.addEventListener('click', (e) => this.onClick(e));
    this.canvas!.addEventListener('wheel', (e) => {
      this.zoom = Math.max(0.5, Math.min(6, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    }, { passive: true });
    this.draw();
  }

  private onClick(e: MouseEvent): void {
    const r = this.canvas!.getBoundingClientRect();
    const x = (e.clientX - r.left) * (this.canvas!.width / r.width);
    const y = (e.clientY - r.top) * (this.canvas!.height / r.height);
    for (const h of this.hits) {
      if (Math.hypot(h.x - x, h.y - y) < h.r + 8) {
        this.selected = h.id;
        this.render();
        return;
      }
    }
    this.selected = null;
    this.render();
  }

  override update(): void {
    this.draw();
  }

  private draw(): void {
    const c = this.canvas;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (this.tab === 'system') this.drawSystem(ctx, w, h);
    else this.drawPlanet(ctx, w, h);
  }

  private drawSystem(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = this.game;
    const sys = g.world.system!;
    let maxR = 0;
    for (const p of sys.planets) maxR = Math.max(maxR, Math.hypot(p.position.x, p.position.z));
    const scale = (Math.min(w, h) * 0.45 * this.zoom) / (maxR * 1.1);
    const cx = w / 2, cy = h / 2;
    const P = (v: THREE.Vector3) => [cx + v.x * scale, cy + v.z * scale] as const;
    this.hits = [];
    // belts
    for (const b of sys.desc.belts) {
      if (b.radius > 0) {
        ctx.strokeStyle = 'rgba(199,184,255,0.12)';
        ctx.lineWidth = Math.max(2, b.width * scale);
        ctx.beginPath();
        ctx.arc(cx, cy, b.radius * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // orbits
    ctx.lineWidth = 1;
    for (const p of sys.planets) {
      if (p.desc.isMoon) continue;
      ctx.strokeStyle = 'rgba(120,200,255,0.15)';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.hypot(p.position.x, p.position.z) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // star
    const sc = sys.desc.star.color;
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
    grd.addColorStop(0, rgbToCss(sc, 1));
    grd.addColorStop(1, rgbToCss(sc, 0));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '13px Rajdhani, sans-serif';
    for (const p of sys.planets) {
      const [x, y] = P(p.position);
      const r = p.desc.isMoon ? 4 : 7;
      ctx.fillStyle = rgbToCss(p.desc.terrain.palette.low);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (p.desc.atmosphere.enabled) {
        ctx.strokeStyle = 'rgba(140,200,255,0.6)';
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (this.selected === p.desc.id) {
        ctx.strokeStyle = '#ffb54a';
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = p.desc.hasSignal ? '#c58cff' : '#cfe6ff';
      ctx.fillText(p.desc.name, x + r + 5, y + 4);
      this.hits.push({ x, y, r, id: p.desc.id });
    }
    for (const s of sys.stations) {
      const [x, y] = P(s.position);
      ctx.fillStyle = '#6dffa8';
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.fillText(s.desc.name, x + 6, y - 6);
    }
    // player
    const focus = g.mode === 'foot' ? g.player.pos : g.ship.pos;
    const [px, py] = P(focus);
    const f = g.ship.forward;
    const ang = Math.atan2(f.z, f.x);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffb54a';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#64788d';
    ctx.fillText('Scroll to zoom · click a planet', 12, h - 12);
  }

  private drawPlanet(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = this.game;
    const planet = g.world.env.planet;
    if (!planet) return;
    const img = planetImage(planet);
    const mw = Math.min(w, h * 2) * 0.98;
    const mh = mw / 2;
    const ox = (w - mw) / 2, oy = (h - mh) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, ox, oy, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 1; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + (mw * i) / 12, oy);
      ctx.lineTo(ox + (mw * i) / 12, oy + mh);
      ctx.stroke();
    }
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + (mh * i) / 6);
      ctx.lineTo(ox + mw, oy + (mh * i) / 6);
      ctx.stroke();
    }
    const proj = (local: THREE.Vector3) => {
      const d = local.clone().normalize();
      const lat = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      const lon = Math.atan2(d.z, d.x);
      return [ox + ((lon + Math.PI) / (Math.PI * 2)) * mw, oy + (0.5 - lat / Math.PI) * mh] as const;
    };
    ctx.font = '12px Rajdhani, sans-serif';
    for (const p of g.pois.generate(planet, g)) {
      if (!p.known) continue;
      const [x, y] = proj(p.local);
      ctx.fillStyle = POI_INFO[p.type].color;
      ctx.fillText(POI_INFO[p.type].icon, x - 4, y + 4);
    }
    const mark = (u: THREE.Vector3, color: string, label: string) => {
      const [x, y] = proj(planet.toLocal(u));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(label, x + 8, y + 4);
    };
    if (g.ship.landedPlanet === planet) mark(g.ship.pos, '#6fd3ff', 'Ship');
    mark(g.mode === 'foot' ? g.player.pos : g.ship.pos, '#ffb54a', 'You');
  }
}
