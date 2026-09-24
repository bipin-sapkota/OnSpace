/**
 * Third-party asset sources used by OnSpace. Every entry is CC0 or public domain.
 * `tools/assets/build.mjs` downloads these into `.asset-cache/` and bakes the
 * optimised runtime bundles into `public/assets/`.
 */
export const MIRROR = 'https://github.com/Noisemaker111/jgengine/releases/download/packs';

export const SOURCES = {
  // Quaternius — CC0 (https://quaternius.com)
  nature: { kind: 'zip', url: `${MIRROR}/quaternius-quaternius-stylized-nature.zip`, license: 'CC0 1.0', author: 'Quaternius', title: 'Stylized Nature MegaKit', home: 'https://quaternius.com' },
  scifi: { kind: 'zip', url: `${MIRROR}/quaternius-quaternius-modular-scifi.zip`, license: 'CC0 1.0', author: 'Quaternius', title: 'Modular SciFi MegaKit', home: 'https://quaternius.com' },
  // Quaternius animated animals & monsters (CC0) as redistributed in the jgengine repo (see its CREDITS.md)
  creatures: { kind: 'git', repo: 'https://github.com/Noisemaker111/jgengine', paths: ['apps/dev/public/models/claudecraft/creatures'], license: 'CC0 1.0', author: 'Quaternius', title: 'Ultimate Animated Animals / Ultimate Monsters', home: 'https://quaternius.com' },
  // KayKit — CC0 (https://kaylousberg.com)
  spacebase: { kind: 'git', repo: 'https://github.com/KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0', paths: ['addons/kaykit_space_base_bits/Assets/gltf', 'addons/kaykit_space_base_bits/Assets/textures', 'LICENSE.txt'], license: 'CC0 1.0', author: 'Kay Lousberg', title: 'KayKit Space Base Bits' },
  // NASA 3D Resources — public domain (https://science.nasa.gov/3d-resources/, https://github.com/nasa/NASA-3D-Resources)
  nasa: {
    kind: 'git', repo: 'https://github.com/nasa/NASA-3D-Resources', license: 'Public domain (NASA media usage guidelines)', author: 'NASA', title: 'NASA 3D Resources',
    paths: [
      '3D Models/Apollo Lunar Module/Apollo Lunar Module.glb',
      '3D Models/Astronaut/Astronaut.glb',
      '3D Models/Extravehicular Mobility Unit/Extravehicular Mobility Unit.glb',
      '3D Models/Habitat Demonstration Unit/Habitat Demonstration Unit (part 1).glb',
      '3D Models/Space Exploration Vehicle/Space Exploration Vehicle.glb',
      '3D Models/Mars 2020 Perseverance Rover/Mars 2020 Perseverance Rover.glb',
      '3D Models/Ingenuity Mars Helicopter/Ingenuity Mars Helicopter.glb',
      '3D Models/Dawn/Dawn.glb',
      '3D Models/1999 RQ36 asteroid/1999 RQ36 asteroid.glb',
    ],
  },
};

// ambientCG PBR materials — CC0 (https://ambientcg.com)
export const MATERIALS = ['Grass004', 'Ground003', 'Ground022', 'Ground010', 'Rock023', 'Rock005', 'Snow004', 'Ice002', 'Gravel015'];
export const MATERIAL_SOURCE = (id) => `${MIRROR}/ambientcg-ambientcg-${id.toLowerCase()}.zip`;

/** Models baked into shared bundles (one GLB each, textures deduplicated). */
export const NATURE_MODELS = [
  'CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5',
  'Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5',
  'TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_4', 'TwistedTree_5',
  'DeadTree_1', 'DeadTree_2', 'DeadTree_3', 'DeadTree_4', 'DeadTree_5',
  'Bush_Common', 'Bush_Common_Flowers', 'Fern_1', 'Plant_1', 'Plant_1_Big', 'Plant_7', 'Plant_7_Big',
  'Flower_3_Group', 'Flower_4_Group', 'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall', 'Clover_1',
  'Mushroom_Common', 'Mushroom_Laetiporus',
  'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
  'Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Square_2', 'Pebble_Square_4',
];

export const SCIFI_PROPS = ['Prop_Barrel_Large', 'Prop_Chest', 'Prop_Computer', 'Prop_Crate3', 'Prop_Crate4', 'Prop_AccessPoint', 'Prop_Light_Floor', 'Prop_Vent_Big', 'Column_Astra', 'Platform_Metal', 'Door_Frame_A'];

export const CREATURES = ['alpaca', 'bull', 'stag', 'fox', 'chicken_cow', 'crabenemy', 'spider', 'velociraptor', 'frog', 'yeti', 'greyjaw', 'wolf_basic', 'glubevolved', 'dragonevolved', 'ghost', 'golelingevolved', 'demon', 'orcenemy'];

export const NASA_MODELS = {
  lunar_module: 'Apollo Lunar Module.glb',
  astronaut: 'Astronaut.glb',
  eva_suit: 'Extravehicular Mobility Unit.glb',
  habitat: 'Habitat Demonstration Unit (part 1).glb',
  sev_rover: 'Space Exploration Vehicle.glb',
  perseverance: 'Mars 2020 Perseverance Rover.glb',
  ingenuity: 'Ingenuity Mars Helicopter.glb',
  dawn: 'Dawn.glb',
  bennu: '1999 RQ36 asteroid.glb',
};
