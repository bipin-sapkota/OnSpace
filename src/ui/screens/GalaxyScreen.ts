import * as THREE from 'three';
import { Screen } from '../Screen';
import { esc } from '../dom';
import type { Game } from '../../core/Game';
import type { UI } from '../UI';
import { getParticleTexture, makeGlowTexture } from '../../render/Textures';
import { ECON_LABEL } from '../../gameplay/Economy';

/**
 * Interactive 3D galaxy map rendered as an overlay scene. Drag to orbit,
 * scroll to zoom, click a star to inspect it and plot a hyperspace jump.
 */
export class GalaxyScreen extends Screen {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20000);
  private yaw = 0.6;
  private pitch = 0.7;
  private dist = 260;
  private target = new THREE.Vector3();
  private targetGoal = new THREE.Vector3();
  private selected: number | null = null;
  private dragging = false;
  private moved = 0;
  private selRing: THREE.Sprite;
  private curRing: THREE.Sprite;
  private rangeSphere: THREE.Mesh;
  private lines: THREE.LineSegments;

  constructor(ui: UI, game: Game) {
    super(ui, game);
    this.el.style.background = 'transparent';
    this.scene.background = new THREE.Color(0x020409);
    const gal = game.galaxy;
    const pos: number[] = [];
    const col: number[] = [];
    const visited = new Set(game.state.data.visited);
    for (const s of gal.systems) {
      pos.push(...s.pos);
      const b = visited.has(s.id) ? 1.4 : 0.9;
      col.push(s.starColor[0] * b, s.starColor[1] * b, s.starColor[2] * b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, sizeAttenuation: true, vertexColors: true, map: getParticleTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(pts);
    // galactic dust
    const dust: number[] = [];
    const dcol: number[] = [];
    for (let i = 0; i < 9000; i++) {
      const r = Math.pow(Math.random(), 0.6) * gal.radius * 1.05;
      const arm = Math.floor(Math.random() * 3);
      const a = (arm / 3) * Math.PI * 2 + r * 0.0065 + (Math.random() - 0.5) * 0.9;
      dust.push(Math.cos(a) * r, (Math.random() - 0.5) * 30 * (1 - r / gal.radius + 0.3), Math.sin(a) * r);
      const c = 0.15 + Math.random() * 0.2;
      dcol.push(c * 0.8, c * 0.7, c * 1.1);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
    dg.setAttribute('color', new THREE.Float32BufferAttribute(dcol, 3));
    this.scene.add(new THREE.Points(dg, new THREE.PointsMaterial({ size: 14, sizeAttenuation: true, vertexColors: true, map: getParticleTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 })));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(128, 2), color: new THREE.Color(1.0, 0.85, 0.6), blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.setScalar(260);
    this.scene.add(core);

    const ringTex = makeRingTexture();
    this.curRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: 0x6dffa8, depthTest: false, transparent: true }));
    this.selRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: 0xffb54a, depthTest: false, transparent: true }));
    this.scene.add(this.curRing, this.selRing);
    const cur = gal.systems[game.state.data.systemId];
    this.curRing.position.set(...cur.pos);
    this.target.set(...cur.pos);
    this.targetGoal.copy(this.target);
    const range = Math.max(1, game.state.jumpRange);
    this.rangeSphere = new THREE.Mesh(new THREE.SphereGeometry(range, 32, 16), new THREE.MeshBasicMaterial({ color: 0x5fe3ff, wireframe: true, transparent: true, opacity: game.state.jumpRange > 0 ? 0.08 : 0 }));
    this.rangeSphere.position.copy(this.target);
    this.scene.add(this.rangeSphere);
    const lp: number[] = [];
    if (game.state.jumpRange > 0) {
      for (const n of gal.neighbours(cur.id, game.state.jumpRange)) lp.push(...cur.pos, ...n.pos);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.25 }));
    this.scene.add(this.lines);

    this.on('close', () => this.ui.closeAll(true));
    this.on('jump', () => {
      if (this.selected !== null && this.game.jump(this.selected)) this.ui.closeAll(false);
    });
    this.on('home', () => {
      this.targetGoal.set(...this.game.galaxy.systems[this.game.state.data.systemId].pos);
    });
    this.on('core', () => {
      this.targetGoal.set(0, 0, 0);
      this.dist = Math.max(this.dist, 900);
    });
  }

  override onOpen(): void {
    this.game.renderer.overlayScene = this.scene;
    this.game.renderer.overlayCamera = this.camera;
    this.el.addEventListener('mousedown', this.down);
    window.addEventListener('mousemove', this.move);
    window.addEventListener('mouseup', this.up);
    this.el.addEventListener('wheel', this.wheel, { passive: true });
  }

  override onClose(): void {
    this.game.renderer.overlayScene = null;
    this.game.renderer.overlayCamera = null;
    window.removeEventListener('mousemove', this.move);
    window.removeEventListener('mouseup', this.up);
  }

  private down = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.window')) return;
    this.dragging = true;
    this.moved = 0;
  };
  private move = (e: MouseEvent) => {
    if (!this.dragging) return;
    this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    this.yaw -= e.movementX * 0.005;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + e.movementY * 0.005));
  };
  private up = (e: MouseEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved < 5) this.pick(e.clientX, e.clientY);
  };
  private wheel = (e: WheelEvent) => {
    this.dist = Math.max(20, Math.min(2600, this.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
  };

  private pick(x: number, y: number): void {
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    let best = -1;
    let bd = 14;
    for (const s of this.game.galaxy.systems) {
      v.set(...s.pos).project(this.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) {
        bd = d;
        best = s.id;
      }
    }
    if (best >= 0) {
      this.selected = best;
      this.targetGoal.set(...this.game.galaxy.systems[best].pos);
      this.game.audio.play('ui_click');
      this.render();
    }
  }

  render(): void {
    const g = this.game;
    const gal = g.galaxy;
    const curId = g.state.data.systemId;
    const cur = gal.systems[curId];
    let info = `<div class="faint">Drag to rotate · scroll to zoom · click a star to select it.</div>`;
    if (this.selected !== null) {
      const s = gal.systems[this.selected];
      const d = gal.distance(curId, s.id);
      const range = g.state.jumpRange;
      const visited = g.state.data.visited.includes(s.id);
      const inRange = range > 0 && d <= range;
      const canJump = inRange && s.id !== curId && g.mode === 'ship' && g.ship.mode === 'flying';
      const cells = g.state.count('warp_cell');
      let why = '';
      if (s.id === curId) why = 'You are here.';
      else if (range <= 0) why = 'Install a hyperdrive to travel between stars.';
      else if (!inRange) why = `Out of range (${range} ly).`;
      else if (g.mode !== 'ship' || g.ship.mode !== 'flying') why = 'You must be flying in open space to jump.';
      else if (cells <= 0) why = 'Craft a Warp Cell to power the jump.';
      info = `<h3 style="margin:0">${esc(s.name)}</h3><div class="dim">${s.starClass}-class star ${visited ? '· <span class="good">Visited</span>' : ''}</div>
        <div class="stat-grid" style="margin-top:10px"><div>Distance</div><div>${d.toFixed(1)} ly</div><div>Economy</div><div>${ECON_LABEL[s.economy]}</div>
        <div>Conflict</div><div>${s.conflict > 0.6 ? '<span class="bad">High</span>' : s.conflict > 0.3 ? 'Moderate' : 'Low'}</div><div>To galactic core</div><div>${gal.distanceToCore(s.id).toFixed(0)} ly</div></div>
        ${why ? `<div class="warn" style="margin-top:10px;font-size:14px">${why}</div>` : ''}
        <div class="row" style="margin-top:12px"><button class="primary" data-action="jump" ${canJump && cells > 0 ? '' : 'disabled'}>Engage hyperdrive (1 Warp Cell)</button></div>`;
    }
    this.el.innerHTML = `<div class="window" style="position:absolute;right:24px;top:24px;width:360px;height:auto;max-height:90vh"><div class="titlebar"><h2>GALAXY</h2><span class="spacer"></span><button class="small" data-action="close">Close</button></div>
      <div class="body"><div class="dim" style="margin-bottom:10px">Current: <b style="color:var(--text)">${esc(cur.name)}</b> · Range <b style="color:var(--accent)">${g.state.jumpRange} ly</b> · Warp cells ${g.state.count('warp_cell')}<br>Distance to core: ${gal.distanceToCore(curId).toFixed(0)} ly</div>
      ${info}<div class="row" style="margin-top:14px"><button class="small" data-action="home">Center current</button><button class="small" data-action="core">View core</button></div></div></div>`;
  }

  override update(dt: number): void {
    this.target.lerp(this.targetGoal, 1 - Math.exp(-dt * 4));
    const c = this.camera;
    c.aspect = window.innerWidth / window.innerHeight;
    c.updateProjectionMatrix();
    c.position.set(Math.cos(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.sin(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist).add(this.target);
    c.lookAt(this.target);
    const s = this.dist * 0.05;
    this.curRing.scale.setScalar(s);
    this.selRing.visible = this.selected !== null;
    if (this.selected !== null) {
      this.selRing.position.set(...this.game.galaxy.systems[this.selected].pos);
      this.selRing.scale.setScalar(s * (1.1 + Math.sin(performance.now() * 0.005) * 0.1));
    }
  }
}

function makeRingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}
