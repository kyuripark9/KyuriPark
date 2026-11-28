/* The real apps, frame by frame, for the stage tiles (make.py runs this; README.md here).
   node capture.mjs typelab|clack|light-life OUT_DIR   (CDP_PORT: a headless Chrome's port)

   typelab     typelab.ink, Didone, "Galaxy" at 112px: the cursor drags Weight from 24 to 100
               and back. 180 frames, 960 x 600 at 1.25x, and ptr.json, where the cursor was
               (a headless screen draws none; stage.html does).
   clack       Clack's own page (Cyanotype) on a virtual clock: one stroke of the cursor across
               the print, then the print sinking back. 204 frames (the last 24 are crossfaded
               into the first by make.py), 960 x 600 at 1.25x, its own ring cursor on.
   light-life  the prototype in its phone frame (assets/prototypes/light-life): Play a day at
               twice its speed, transitions off (reduced motion), on a virtual clock. 180 frames,
               the .device element (390 x 844) at 2x.
   Each seamless: the last frame runs on into the first. Frames are JPEGs (quality 95). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { openTab, sleep } from '/Users/kaylapark/Documents/Portfolio/Ai projects/TypeLab/tools/browser/cdp.mjs';

const [which, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '../..');
const CLACK = process.env.CLACK_HTML || resolve(homedir(), 'Documents/Portfolio/Ai projects/Keyboard/index.html');
const FPS = 30;
const VCLOCK = `(() => {
  let vnow = 1000, q = [];
  window.__vclock = { step(ms) { vnow += ms; const cbs = q; q = []; for (const cb of cbs) { try { cb(vnow); } catch (e) { console.error(e); } } } };
  performance.now = () => vnow;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
})();`;
const save = async (p, n, clip) => {
  const r = await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, ...(clip ? { clip } : {}) });
  writeFileSync(`${OUT}/${String(n).padStart(4, '0')}.jpg`, Buffer.from(r.result.data, 'base64'));
};
const tab = async (W, H, dpr) => {
  const p = await openTab({ width: W, height: H });
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: false });
  return p;
};

if (which === 'typelab') {
  const W = 960, H = 600, N = 180, A = 24, B = 100;
  const p = await tab(W, H, 1.25);
  await p.go('https://typelab.ink/?style=didone&text=Galaxy&cat=weight', 6000);
  const setNum = async (label, v) => {
    await p.ev(`(()=>{const i=document.querySelector('input[aria-label="${label}"]'); i.focus(); i.select(); return 1})()`);
    await sleep(100); await p.type(String(v)); await p.key('Enter', 'Enter', 13); await sleep(900);
  };
  await setNum('Size in px', 112);
  await setNum('Weight value', A);
  const b = await p.box('input[aria-label="Weight"]');
  const xAt = v => b.x + 11 + (b.w - 22) * v / 100, y = b.y + b.h / 2 + 1;
  const ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const plan = n => {  // rest, drag up, hold, drag down, rest
    const t = n / FPS;
    if (t < 0.6) return { v: A, down: false };
    if (t < 2.6) return { v: A + (B - A) * ease((t - 0.6) / 2), down: true };
    if (t < 3.2) return { v: B, down: true };
    if (t < 5.2) return { v: B - (B - A) * ease((t - 3.2) / 2), down: true };
    return { v: A, down: false };
  };
  const mouse = (type, x, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
  await mouse('mouseMoved', xAt(A), { button: 'none' }); await sleep(500);
  let pressed = false; const ptrs = [];
  for (let n = 0; n < N; n++) {
    const { v, down } = plan(n), x = xAt(v);
    if (down && !pressed) { await mouse('mousePressed', x, { clickCount: 1 }); pressed = true; }
    if (pressed) await mouse('mouseMoved', x, { buttons: 1 });
    if (!down && pressed) { await mouse('mouseReleased', x, { clickCount: 1 }); pressed = false; }
    await sleep(90);
    await save(p, n);
    ptrs.push({ x: Math.round(x * 10) / 10, y });
  }
  writeFileSync(`${OUT}/ptr.json`, JSON.stringify(ptrs));
  await p.close();
} else if (which === 'clack') {
  const W = 960, H = 600, N = 204, T0 = 0.85, T1 = 3.15;  // the stroke, in seconds
  const p = await tab(W, H, 1.25);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: VCLOCK });
  await p.go(pathToFileURL(CLACK).href, 3000);
  await p.ev(`(async()=>{ try{await document.fonts.ready}catch(e){}; const c=__clack; try{c.set({muted:true})}catch(e){}; if(c.S.sound==='cyano') c.set({sound:'slime'}); c.set({sound:'cyano'}); for(let i=0;i<45;i++){__vclock.step(33.333); await new Promise(r=>setTimeout(r,10));} return 1})()`);
  const path = u => [W * (0.02 + 0.96 * u), H * (0.34 + 0.34 * u + 0.15 * Math.sin(u * Math.PI * 2.2))];
  const ease = u => u * u * (3 - 2 * u);
  for (let n = 0; n < N; n++) {
    const t = n / FPS;
    if (t >= T0 && t <= T1 + 0.001) {
      const [x, y] = path(ease(Math.min(1, (t - T0) / (T1 - T0))));
      await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    }
    if (t > T1 && t - 1 / FPS <= T1) await p.ev(`document.getElementById('cursor').classList.remove('on')`);
    await p.ev(`__vclock.step(${1000 / FPS})`);
    await sleep(25);
    await save(p, n);
  }
  await p.close();
} else if (which === 'light-life') {
  const N = 180, PLAY_MS = 12000;
  const p = await tab(1280, 900, 2);
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: VCLOCK });
  await p.go(pathToFileURL(resolve(ROOT, 'assets/prototypes/light-life/index.html')).href, 5000);
  await p.ev(`(async()=>{ try{await document.fonts.ready}catch(e){}; for(let i=0;i<10;i++){__vclock.step(33.333); await new Promise(r=>setTimeout(r,20));} return 1})()`);
  const d = await p.ev(`(()=>{const r=document.querySelector('.device').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
  await p.ev(`document.getElementById('play').click()`);
  await sleep(200);
  await p.ev(`__vclock.step(0)`);  // the play's first tick: its clock starts here
  for (let n = 0; n < N; n++) {
    // half a step in first, so no frame is the day's very start (the ↺ button not yet shown)
    await p.ev(`__vclock.step(${n === 0 ? PLAY_MS / N / 2 : PLAY_MS / N})`);
    await sleep(n === 0 ? 600 : 30);  // the ↺ button's icon comes a moment after the button
    await save(p, n, d);
  }
  await p.close();
} else {
  console.error('node capture.mjs typelab|clack|light-life OUT_DIR'); process.exit(1);
}
process.exit(0);
