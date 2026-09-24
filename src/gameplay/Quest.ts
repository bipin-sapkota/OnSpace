import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { POI } from '../entities/poi/POIs';
import { events } from '../core/EventBus';
import { MONOLITH_LORE } from './Lore';

/**
 * Main storyline — "The Silent Signal". A guided progression that teaches the
 * core loop (gather → craft → repair → launch → explore → upgrade → jump) and
 * then continues as an open-ended pilgrimage toward the galactic core.
 */
interface Step {
  title: string;
  text: (g: Game) => string;
  check?: (g: Game) => boolean;
  waypoint?: (g: Game) => { pos: THREE.Vector3; label: string } | null;
  onEnter?: (g: Game) => void;
}

export class Quest {
  private steps: Step[];
  private lastStep = -1;

  constructor() {
    this.steps = [
      {
        title: 'Find your ship',
        text: () => 'Your ship crash-landed nearby. Follow the marker and reach it.',
        check: (g) => g.player.pos.distanceTo(g.ship.pos) < 18 || g.mode === 'ship',
        waypoint: (g) => ({ pos: g.ship.pos.clone(), label: 'Your Ship' }),
      },
      {
        title: 'Gather materials',
        text: (g) => `The launch thrusters are dry. Mine <b>blue crystals</b> for Hydrex (${Math.min(40, g.state.count('hydrex'))}/40) and rocks for Ferrox (${Math.min(20, g.state.count('ferrox'))}/20). Hold <b>LMB</b> to mine.`,
        check: (g) => (g.state.count('hydrex') >= 40 && g.state.count('ferrox') >= 20) || g.state.count('launch_fuel') > 0 || g.state.ship.launchFuel >= 0.25,
      },
      {
        title: 'Refuel the launch thrusters',
        text: () => 'Open the <b>Exosuit</b> menu (TAB) → <b>Crafting</b> and make a <b>Launch Fuel Cell</b>, then use it on the Ship tab or while in the cockpit.',
        check: (g) => g.state.ship.launchFuel >= 0.25,
      },
      {
        title: 'Reach orbit',
        text: () => 'Board your ship (<b>E</b>), then launch with <b>SPACE</b>. Climb out of the atmosphere.',
        check: (g) => g.mode === 'ship' && g.world.env.inAtmosphere < 0.02 && g.ship.mode !== 'landed',
        waypoint: (g) => (g.mode === 'foot' ? { pos: g.ship.pos.clone(), label: 'Your Ship' } : null),
      },
      {
        title: 'Follow the Silent Signal',
        text: (g) => `The Signal is strongest near <b>${this.signalPlanetName(g)}</b>. Fly there — use the <b>Pulse Drive (R)</b> for long distances — then land and find the monolith.`,
        waypoint: (g) => this.signalWaypoint(g),
      },
      {
        title: 'Dock at the space station',
        text: (g) => `Visit <b>${g.world.system?.stations[0]?.desc.name ?? 'the station'}</b>. Approach the lit hangar and press <b>E</b> to dock. Trade, take contracts and upgrade your ship.`,
        waypoint: (g) => {
          const s = g.world.system?.stations[0];
          return s ? { pos: s.toUniverse(s.bayEntrance), label: s.desc.name } : null;
        },
      },
      {
        title: 'Install a hyperdrive',
        text: () => 'Install the <b>Hyperdrive</b> (Exosuit → <b>Technology</b> → Ship). You need Alloy Plates, a Circuit Lattice, Nullite, Tech Fragments and credits. Contracts and crashed ships are good sources.',
        check: (g) => g.state.level('ship_hyperdrive') >= 1,
      },
      {
        title: 'Craft a Warp Cell',
        text: () => 'Each jump consumes a <b>Warp Cell</b> (Nullite, Astrium, Alloy Plate). Astrium comes from asteroids — shoot them with your ship cannons.',
        check: (g) => g.state.count('warp_cell') >= 1 || g.state.data.visited.length > 1,
      },
      {
        title: 'Jump to a new star system',
        text: () => 'Open the <b>Galaxy Map (G)</b> while flying in space, select a star within range and engage the hyperdrive.',
        check: (g) => g.state.data.visited.length > 1,
      },
      {
        title: 'Toward the core',
        text: (g) => `Every system hides a Signal Monolith. Attuned: <b>${g.state.data.quest.flags.attuned ?? 0}</b>. Find the one in this system near <b>${this.signalPlanetName(g)}</b>, and keep travelling coreward.`,
        waypoint: (g) => this.signalWaypoint(g),
      },
    ];
  }

  current(game: Game): Step {
    return this.steps[Math.min(game.state.data.quest.step, this.steps.length - 1)];
  }

  title(game: Game): string {
    return this.current(game).title;
  }

  text(game: Game): string {
    return this.current(game).text(game);
  }

  waypoint(game: Game): { pos: THREE.Vector3; label: string } | null {
    return this.current(game).waypoint?.(game) ?? null;
  }

  advance(game: Game): void {
    const q = game.state.data.quest;
    if (q.step >= this.steps.length - 1) return;
    q.step++;
    events.emit('quest:advanced', { step: q.step });
    events.emit('notify', { text: `New objective: ${this.current(game).title}`, kind: 'discovery' });
    game.audio.play('ui_confirm', 0.6);
  }

  update(game: Game): void {
    const q = game.state.data.quest;
    if (q.step !== this.lastStep) {
      this.lastStep = q.step;
      this.current(game).onEnter?.(game);
    }
    const s = this.current(game);
    if (s.check && s.check(game)) this.advance(game);
    // skip ahead if already docked during signal step etc.
    if (q.step === 5 && game.mode === 'docked') this.advance(game);
  }

  private signalPlanetName(g: Game): string {
    const p = g.world.system?.planets.find((pl) => pl.desc.hasSignal);
    return p?.desc.name ?? 'an unknown world';
  }

  private signalWaypoint(g: Game): { pos: THREE.Vector3; label: string } | null {
    const planet = g.world.system?.planets.find((pl) => pl.desc.hasSignal);
    if (!planet) return null;
    const flagKey = `attuned_${g.state.data.systemId}`;
    if (g.state.data.quest.flags[flagKey]) return null;
    const pois = g.pois.generate(planet, g);
    const mono = pois.find((p) => p.isSignal);
    if (!mono) return { pos: planet.position.clone(), label: planet.desc.name };
    const near = g.world.env.planet === planet && g.world.env.altitude < planet.atmosphereRadius;
    if (!near) return { pos: planet.position.clone(), label: `${planet.desc.name} · Signal` };
    return { pos: planet.toUniverse(mono.local), label: 'Signal Monolith' };
  }

  // hooks ------------------------------------------------------------------
  onPOIVisited(p: POI, game: Game): void {
    game.missions.onPOIVisited(game, game.pois.current?.key ?? '', p.type);
  }

  onLoot(_kind: string, _game: Game): void {
    /* reserved for future story beats */
  }

  onScan(_kind: string, _game: Game): void {
    /* reserved */
  }

  onMonolith(p: POI, game: Game): void {
    const q = game.state.data.quest;
    const flags = q.flags;
    const count = flags.monoliths ?? 0;
    flags.monoliths = count + 1;
    const lore = MONOLITH_LORE[count % MONOLITH_LORE.length];
    let reward = '';
    if (p.isSignal) {
      const key = `attuned_${game.state.data.systemId}`;
      if (!flags[key]) {
        flags[key] = 1;
        flags.attuned = (flags.attuned ?? 0) + 1;
        const learned: string[] = [];
        if (game.state.learnBlueprint('hyperdrive')) learned.push('Hyperdrive');
        if (game.state.learnBlueprint('warp_cell')) learned.push('Warp Cell');
        if (game.state.learnBlueprint('circuit')) learned.push('Circuit Lattice');
        game.state.give('nullite', 30);
        game.state.give('tech_fragment', 3);
        reward = learned.length ? `Blueprints learned: ${learned.join(', ')}. Received 30 Nullite and 3 Tech Fragments.` : 'Received 30 Nullite and 3 Tech Fragments. The Signal points further coreward.';
        if (q.step === 4) this.advance(game);
        const attuned = flags.attuned;
        if (attuned >= 5 && !flags.finale) {
          flags.finale = 1;
          reward += ' The Signal resolves into a single word: HARBOUR. It is waiting at the core.';
          game.state.give('veil_relic', 2);
        }
      }
    } else {
      game.state.give('nullite', 6);
      game.state.give('veil_relic', 1);
      reward = 'Received a Veil Relic and 6 Nullite.';
    }
    game.ui.showLore(p.isSignal ? 'The Silent Signal' : 'Veil Monolith', lore, reward);
  }

  onSystemEntered(game: Game): void {
    const q = game.state.data.quest;
    if (q.step >= 8 && q.step < this.steps.length - 1 && game.state.data.visited.length > 1) {
      q.step = this.steps.length - 1;
      events.emit('quest:advanced', { step: q.step });
    }
  }
}
