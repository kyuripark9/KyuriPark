/* Puts frames on the black stage and screenshots each (make.py runs this; README.md here).
   node render.mjs screen FRAMES_DIR OUT_DIR SCALE GLOW DEVICE [only]   (stage.html)
   node render.mjs print  SETUP      OUT_DIR SCALE [only]               (print.html, 180 frames)
   SCALE 1 for the loop's frames (720 x 1000, a wide tile's 1440 x 1000), 2 for the still.
   [only]: a comma list of frame numbers. Frames out as JPEGs (quality 95); the still, a PNG. */
import { writeFileSync, readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openTab } from '/Users/kaylapark/Documents/Portfolio/Ai projects/TypeLab/tools/browser/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [mode, src, out, scale, ...rest] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const still = +scale > 1;
const shoot = async (p, n) => {
  const r = await p.send('Page.captureScreenshot', still ? { format: 'png' } : { format: 'jpeg', quality: 95 });
  writeFileSync(`${out}/${String(n).padStart(4, '0')}.${still ? 'png' : 'jpg'}`, Buffer.from(r.result.data, 'base64'));
};
const paint = (p) => p.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);

if (mode === 'screen') {
  const [glow, device, only] = rest;
  const ptrFile = resolve(src, 'ptr.json');
  const ptrs = existsSync(ptrFile) ? JSON.parse(readFileSync(ptrFile, 'utf8')) : null;
  let files = readdirSync(src).filter(f => /^\d{4}\.(png|jpg)$/.test(f)).sort();
  if (only) { const keep = new Set(only.split(',').map(Number)); files = files.filter(f => keep.has(+f.slice(0, 4))); }
  const p = await openTab({ width: 720, height: 1000 });
  await p.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 1000, deviceScaleFactor: +scale, mobile: false });
  await p.go(`${pathToFileURL(resolve(HERE, 'stage.html')).href}?glow=${encodeURIComponent(glow)}&device=${device}`, 800);
  for (const f of files) {
    const n = +f.slice(0, 4);
    await p.ev(`show(${JSON.stringify(pathToFileURL(resolve(src, f)).href)}, ${ptrs ? JSON.stringify(ptrs[n]) : 'null'})`);
    await paint(p);
    await shoot(p, n);
  }
  await p.close();
} else if (mode === 'print') {
  const [only] = rest;
  const W = src === 'editorial' ? 1440 : 720;
  const p = await openTab({ width: W, height: 1000 });
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: +scale, mobile: false });
  await p.go(`${pathToFileURL(resolve(HERE, 'print.html')).href}?setup=${src}`, 2500);
  for (const n of only ? only.split(',').map(Number) : [...Array(180).keys()]) {
    await p.ev(`at(${n / 30})`);
    await paint(p);
    await shoot(p, n);
  }
  await p.close();
} else {
  console.error('node render.mjs screen|print ...'); process.exit(1);
}
process.exit(0);
