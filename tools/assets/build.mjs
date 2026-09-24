#!/usr/bin/env node
/**
 * OnSpace asset build.
 *
 *   node tools/assets/build.mjs            # fetch (cached) + bake everything
 *   node tools/assets/build.mjs --offline  # bake from .asset-cache only
 *
 * Downloads CC0 / public-domain source packs (see sources.mjs) into
 * `.asset-cache/`, then bakes compact runtime bundles into `public/assets/`:
 *   - shared bundles (nature, spacebase, scifi) — one GLB per pack with
 *     deduplicated WebP textures; each model is a named root node
 *   - individual animated creature GLBs and NASA hero models
 *   - terrain detail materials (albedo RGB + height in alpha, WebP 512²)
 *   - manifest.json with per-model bounds for runtime placement
 * Geometry is welded, optionally simplified and meshopt-compressed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, meshopt, mergeDocuments, unpartition, getBounds } from '@gltf-transform/functions';
import { SOURCES, MATERIALS, MATERIAL_SOURCE, NATURE_MODELS, SCIFI_PROPS, CREATURES, NASA_MODELS } from './sources.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, '.asset-cache');
const OUT = path.join(ROOT, 'public/assets');
const offline = process.argv.includes('--offline');

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', ...opts }).toString();

function fetchZip(name, url) {
  const dir = path.join(CACHE, name);
  if (fs.existsSync(dir)) return dir;
  if (offline) throw new Error(`missing cached ${name}`);
  const zip = path.join(CACHE, `${name}.zip`);
  console.log(`  downloading ${name}…`);
  sh('curl', ['-sSLf', '--retry', '3', '-o', zip, url]);
  fs.mkdirSync(dir, { recursive: true });
  sh('unzip', ['-qo', zip, '-d', dir]);
  fs.rmSync(zip);
  return dir;
}

function fetchGit(name, repo, paths) {
  const dir = path.join(CACHE, name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    if (offline) throw new Error(`missing cached ${name}`);
    console.log(`  cloning ${repo} (sparse)…`);
    sh('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', '--depth', '1', repo, dir]);
  }
  sh('git', ['-C', dir, 'checkout', 'HEAD', '--', ...paths]);
  return dir;
}

function findFile(dir, file) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, file);
      if (r) return r;
    } else if (e.name === file) return p;
  }
  return null;
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder, 'draco3d.decoder': await draco3d.createDecoderModule() });

const manifest = { models: {}, materials: {}, generated: new Date().toISOString() };

/** Wrap a document's scene contents under one named root node. */
function wrapScene(doc, name) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const wrapper = doc.createNode(name);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
  return wrapper;
}

async function optimise(doc, { texSize = 512, simplifyRatio = 0, simplifyError = 0.002, meshoptLevel = true } = {}) {
  // sources may be Draco-compressed; output uses meshopt instead
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  const steps = [dedup(), prune(), weld()];
  if (simplifyRatio > 0) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: simplifyError }));
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }));
  steps.push(prune());
  if (meshoptLevel) steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await doc.transform(...steps);
}

function recordBounds(prefix, doc, names) {
  const scene = doc.getRoot().listScenes()[0];
  for (const node of scene.listChildren()) {
    if (names && !names.includes(node.getName())) continue;
    const b = getBounds(node);
    manifest.models[`${prefix}/${node.getName()}`] = { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) };
  }
}

/** Merge many source files into one bundle GLB with named root nodes. */
async function bundle(outName, entries, opts) {
  const target = new Document();
  for (const { name, file } of entries) {
    const src = await io.read(file);
    wrapScene(src, name);
    mergeDocuments(target, src);
  }
  // collapse all merged scenes into the first
  const scenes = target.getRoot().listScenes();
  const main = scenes[0];
  for (const s of scenes.slice(1)) {
    for (const c of s.listChildren()) main.addChild(c);
    s.dispose();
  }
  await target.transform(unpartition());
  await optimise(target, opts);
  recordBounds(outName, target);
  const out = path.join(OUT, `${outName}.glb`);
  await io.write(out, target);
  console.log(`  ${outName}.glb  ${(fs.statSync(out).size / 1024).toFixed(0)} KB  (${entries.length} models)`);
}

async function single(outDir, id, file, opts) {
  const doc = await io.read(file);
  wrapScene(doc, id);
  await optimise(doc, opts);
  recordBounds(outDir, doc);
  fs.mkdirSync(path.join(OUT, outDir), { recursive: true });
  const out = path.join(OUT, outDir, `${id}.glb`);
  await io.write(out, doc);
  console.log(`  ${outDir}/${id}.glb  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

console.log('Fetching sources');
const natureDir = fetchZip('nature', SOURCES.nature.url);
const scifiDir = fetchZip('scifi', SOURCES.scifi.url);
const spaceDir = fetchGit('spacebase', SOURCES.spacebase.repo, SOURCES.spacebase.paths);
const creatureDir = fetchGit('creatures', SOURCES.creatures.repo, SOURCES.creatures.paths);
const nasaDir = fetchGit('nasa', SOURCES.nasa.repo, SOURCES.nasa.paths);

console.log('Baking bundles');
// start from a clean output so removed models never linger
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const natureGltf = path.join(natureDir, 'glTF');
await bundle('nature', NATURE_MODELS.map((n) => ({ name: n, file: path.join(natureGltf, `${n}.gltf`) })), { texSize: 512 });

const spaceGltf = path.join(spaceDir, 'addons/kaykit_space_base_bits/Assets/gltf');
const spaceModels = fs.readdirSync(spaceGltf).filter((f) => f.endsWith('.gltf')).map((f) => f.replace('.gltf', ''));
await bundle('spacebase', spaceModels.map((n) => ({ name: n, file: path.join(spaceGltf, `${n}.gltf`) })), { texSize: 256 });

const scifiGltf = findFile(scifiDir, 'Prop_Chest.gltf');
// the pack's glTFs reference textures by bare filename; place them beside every glTF folder
{
  const texDir = path.dirname(findFile(scifiDir, 'T_Decals.png'));
  const gltfRoot = path.dirname(path.dirname(scifiGltf));
  for (const sub of fs.readdirSync(gltfRoot)) {
    const d = path.join(gltfRoot, sub);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const t of fs.readdirSync(texDir)) if (!fs.existsSync(path.join(d, t))) fs.copyFileSync(path.join(texDir, t), path.join(d, t));
  }
}
await bundle('scifi', SCIFI_PROPS.map((n) => ({ name: n, file: findFile(path.dirname(path.dirname(scifiGltf)), `${n}.gltf`) })), { texSize: 512 });

console.log('Baking creatures');
const cDir = path.join(creatureDir, SOURCES.creatures.paths[0]);
for (const c of CREATURES) await single('creatures', c, path.join(cDir, `${c}.glb`), { texSize: 256 });

console.log('Baking NASA models');
for (const [id, file] of Object.entries(NASA_MODELS)) {
  const big = id === 'sev_rover' || id === 'perseverance' || id === 'eva_suit';
  await single('nasa', id, findFile(path.join(nasaDir, '3D Models'), file), { texSize: big ? 512 : 1024, simplifyRatio: big ? 0.25 : 0 });
}

console.log('Baking terrain materials');
fs.mkdirSync(path.join(OUT, 'materials'), { recursive: true });
for (const id of MATERIALS) {
  const dir = fetchZip(`mat-${id}`, MATERIAL_SOURCE(id));
  const color = fs.readdirSync(dir).find((f) => f.endsWith('_Color.jpg'));
  const disp = fs.readdirSync(dir).find((f) => /_Displacement\.(jpg|png)$/.test(f));
  const stats = await sharp(path.join(dir, color)).stats();
  const mean = stats.channels.slice(0, 3).map((c) => +(c.mean / 255).toFixed(4));
  // colour + height (packed into alpha at load time; drives the shader's bump)
  await sharp(path.join(dir, color)).resize(512, 512).removeAlpha().webp({ quality: 85 }).toFile(path.join(OUT, 'materials', `${id}_color.webp`));
  await sharp(path.join(dir, disp)).resize(512, 512).greyscale().webp({ quality: 80 }).toFile(path.join(OUT, 'materials', `${id}_height.webp`));
  manifest.materials[id] = { mean };
  console.log(`  ${id}`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// credits
const lines = ['# Third-party assets', '', 'All third-party content used by OnSpace is CC0 or public domain. Everything else (terrain, planets, player ships, station hulls, audio, music, UI) is generated procedurally by the game.', ''];
for (const s of Object.values(SOURCES)) {
  const src = s.url ?? s.repo;
  lines.push(`- **${s.title}** — ${s.author} — ${s.license} — ${s.home ?? src}${s.home ? ` (fetched from ${src})` : ''}`);
}
lines.push(`- **PBR materials** (${MATERIALS.join(', ')}) — ambientCG (https://ambientcg.com) — CC0 1.0`);
lines.push('', 'NASA models are provided under NASA\'s media usage guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/); use does not imply NASA endorsement.');
lines.push('', 'Rebuild with `npm run assets` (downloads into `.asset-cache/`, bakes into `public/assets/`).');
fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), lines.join('\n') + '\n');

const total = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? total(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`Done — public/assets is ${(total(OUT) / 1048576).toFixed(1)} MB`);
