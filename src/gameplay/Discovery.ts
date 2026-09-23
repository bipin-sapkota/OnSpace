import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { DiscoveryEntry } from './GameState';
import { events } from '../core/EventBus';
import type { Creature } from '../entities/creatures/CreatureManager';
import type { ScatterRecord } from '../world/ScatterManager';
import { getItem } from './Items';
import { generateSpeciesName } from '../procgen/names';
import { hashString } from '../core/Random';

/**
 * Discovery catalogue. Records first sightings of systems, planets, species,
 * minerals and sites. The analysis visor (hold F) scans creatures, flora and
 * deposits. Discoveries can be uploaded at any time for credits.
 */
export type AnalysisTarget =
  | { kind: 'fauna'; creature: Creature }
  | { kind: 'flora'; rec: ScatterRecord }
  | { kind: 'mineral'; rec: ScatterRecord };

export class Discovery {
  progress = 0;
  target: AnalysisTarget | null = null;
  targetLabel = '';
  analyzing = false;

  has(game: Game, id: string): boolean {
    return game.state.data.discoveries.some((d) => d.id === id);
  }

  discover(game: Game, kind: DiscoveryEntry['kind'], id: string, name: string, where: string, reward: number, meta?: Record<string, string | number>): boolean {
    if (this.has(game, id)) return false;
    const bonus = 1 + game.state.level('tool_scanner') * 0.25;
    const entry: DiscoveryEntry = { id, kind, name, where, reward: Math.round(reward * bonus), uploaded: false, time: Date.now(), meta };
    game.state.data.discoveries.push(entry);
    events.emit('discovery', { kind, name, id, reward: entry.reward });
    game.audio.play('discovery', 0.7);
    game.state.stat(`discovered_${kind}`);
    return true;
  }

  uploadAll(game: Game): number {
    let total = 0;
    for (const d of game.state.data.discoveries) {
      if (!d.uploaded) {
        d.uploaded = true;
        total += d.reward;
      }
    }
    if (total > 0) {
      game.state.addCredits(total);
      events.emit('notify', { text: `Discoveries uploaded · +${total.toLocaleString()} credits`, kind: 'good' });
      game.audio.play('ui_confirm');
    }
    return total;
  }

  pendingReward(game: Game): number {
    return game.state.data.discoveries.filter((d) => !d.uploaded).reduce((a, d) => a + d.reward, 0);
  }

  private floraName(game: Game, rec: ScatterRecord): { id: string; name: string } {
    const planet = game.player.planet!;
    const id = `${planet.key}:flora${rec.type}:${rec.variant}`;
    return { id, name: generateSpeciesName(hashString(id)) };
  }

  /** Per-frame: find analysis target under the crosshair and accumulate scan progress while F is held. */
  update(dt: number, game: Game): void {
    this.analyzing = false;
    this.target = null;
    this.targetLabel = '';
    if (game.mode !== 'foot' || game.uiBlocking) {
      this.progress = 0;
      return;
    }
    const p = game.player;
    const eye = p.eye;
    const fwd = p.forward;
    const c = game.creatures.raycast(eye, fwd, 70);
    if (c) {
      this.target = { kind: 'fauna', creature: c.c };
      const known = this.has(game, `${p.planet!.key}:${c.c.species.id}`);
      this.targetLabel = known ? c.c.species.name : 'Unknown lifeform';
    } else {
      const planet = p.planet!;
      const hit = planet.scatter.raycast(planet.toLocal(eye, new THREE.Vector3()), planet.universeDirToLocal(fwd, new THREE.Vector3()), 45);
      if (hit) {
        const r = hit.rec;
        if (r.type === 0 || r.type === 1 || r.type === 7) {
          this.target = { kind: 'flora', rec: r };
          const f = this.floraName(game, r);
          this.targetLabel = this.has(game, f.id) ? f.name : 'Unknown flora';
        } else if (r.type === 6 || r.type === 5) {
          this.target = { kind: 'mineral', rec: r };
          this.targetLabel = `${getItem(r.item!).name} deposit`;
        }
      }
    }
    if (!this.target || !game.input.isDown('analyze')) {
      this.progress = Math.max(0, this.progress - dt * 2);
      return;
    }
    this.analyzing = true;
    this.progress += dt / 1.2;
    if (Math.random() < dt * 8) game.audio.play('analyze', 0.4);
    if (this.progress >= 1) {
      this.progress = 0;
      this.complete(game, this.target);
    }
  }

  private complete(game: Game, t: AnalysisTarget): void {
    const planet = game.player.planet!;
    if (t.kind === 'fauna') {
      const sp = t.creature.species;
      const ok = this.discover(game, 'fauna', `${planet.key}:${sp.id}`, sp.name, planet.desc.name, Math.round(400 + sp.size * 250), {
        diet: sp.diet, temperament: sp.temperament, height: `${sp.size.toFixed(1)} m`, notes: sp.notes,
      });
      if (!ok) events.emit('notify', { text: `${sp.name} — already catalogued`, kind: 'info' });
      else game.quest.onScan('fauna', game);
      events.emit('mission:updated', { id: `scan:${planet.key}` });
    } else if (t.kind === 'flora') {
      const f = this.floraName(game, t.rec);
      const ok = this.discover(game, 'flora', f.id, f.name, planet.desc.name, 250);
      if (!ok) events.emit('notify', { text: `${f.name} — already catalogued`, kind: 'info' });
      else game.quest.onScan('flora', game);
    } else {
      const item = t.rec.item!;
      const ok = this.discover(game, 'mineral', `${planet.key}:min:${item}`, `${getItem(item).name} (${planet.desc.name})`, planet.desc.name, 150);
      if (!ok) events.emit('notify', { text: `${getItem(item).name} — already catalogued here`, kind: 'info' });
    }
  }
}
