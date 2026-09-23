// Scripted playtest: node tools/play.mjs <scenario.js>  (scenario exports async (page, shot) => {})
import { chromium } from 'playwright-core';
import path from 'node:path';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const scenario = (await import(path.resolve(process.argv[2]))).default;
let n = 0;
const shot = async (name) => { await page.screenshot({ path: `screenshots/${name}.png` }); console.log('shot', name); };
try {
  await scenario(page, shot);
} catch (e) { console.log('SCENARIO ERROR', e); }
console.log(logs.filter(l => !l.includes('404')).slice(0, 30).join('\n'));
await browser.close();
