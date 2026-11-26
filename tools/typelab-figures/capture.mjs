/* Real TypeLab screens for the page's figures (2026-11-26, the user's asks: the real UI, with marks
   showing what each control changes; a better-looking font than the slides' Galaxy; the serifs'
   tips edited rather than an Inline fill, which looked poor; and Points with its construction grid
   and Only R in sight). Drives typelab.ink in a headless Chrome over TypeLab's own CDP helper:

   1. "idea": Didone, "Galaxy" set large, four controls stacked one after another (Weight, Slant,
      x-height, and how the strokes end, Ball to Droplet), each pointed at after it's changed so
      TypeLab draws the guides it has for it; saved at 3x so a detail can be magnified sharp. (The
      serifs' own Tips, on styles with a Serifs page, swap a drawn font's serifs for the engine's
      and left slivers and spurs on its letters, 2026-11-26, so they aren't shown.) Saves screens/step0.png to step4.png and, in
      screens/steps.json, where the letters and the control sit (CSS pixels).
   2. "redraw": the R in Points mode with Only R and the construction grid on, at 2x, 1000 x 750 as
      the grid's other screens; screens/redraw.png and, in screens/redraw.json, where the points,
      Only R and the construction grid's switch sit.

     cd ~/Documents/Portfolio/"Ai projects/TypeLab"
     CDP_PORT=9371 sh tools/browser/chrome.sh
     CDP_PORT=9371 .tools/node/bin/node "<portfolio>/tools/typelab-figures/capture.mjs"
     CDP_PORT=9371 sh tools/browser/chrome.sh stop
*/
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTab, sleep } from '/Users/kaylapark/Documents/Portfolio/Ai projects/TypeLab/tools/browser/cdp.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'screens');
mkdirSync(OUT, { recursive: true });
const STYLE = 'didone', TEXT = 'Galaxy';  // the idea's; Points' R is Headline Serif (below)

const box = (p, expr) => p.ev(`(()=>{const e=${expr}; if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const byText = (sel, text) => `[...document.querySelectorAll('${sel}')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;

/* ---------- 1. the idea ---------- */
{
  const W = 1200, H = 760, SCALE = 3, SIZE = 118;
  const p = await openTab({ width: W, height: H });
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  await p.go(`https://typelab.ink/?style=${STYLE}&text=${TEXT}&cat=weight`, 6000);
  const value = (label) => p.ev(`document.querySelector('input[aria-label="${label}"]').value`);
  async function setNum(label, v) {
    await p.ev(`(()=>{const i=document.querySelector('input[aria-label="${label}"]'); i.focus(); i.select(); return 1})()`);
    await sleep(100); await p.type(String(v)); await p.key('Enter', 'Enter', 13); await sleep(700);
  }
  async function hover(sel) {
    const b = await p.box(sel);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + b.w / 2, y: b.y + b.h / 2 });
    return b;
  }
  await setNum('Size in px', SIZE);
  const steps = [];
  async function shoot(n, s) {
    if (s.away) await hover(s.away);
    await sleep(250);
    const ctl = s.point ? await hover(s.point) : null;
    if (!s.point) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W - 5, y: H - 5 });
    await sleep(220);
    const r = await p.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/step${n}.png`, Buffer.from(r.result.data, 'base64'));
    steps.push({
      n, control: s.control, from: s.from, to: s.to, value: s.value,
      glyphs: await p.ev(`[...document.querySelectorAll('.preview use')].filter(u=>(u.getAttribute('href')||'').startsWith('#g')).map(u=>{const r=u.getBoundingClientRect(); return {c:String.fromCharCode(+u.getAttribute('href').slice(2)),x:r.x,y:r.y,w:r.width,h:r.height}})`),
      ctl,
      tiles: s.tiles ? await Promise.all(s.tiles.map(t => box(p, byText('.panel button', t)))) : null,
      pick: s.tiles ? s.tiles.indexOf(s.to) : null,
      panel: await box(p, `document.querySelector('.panel')`),
      title: await p.ev(`document.querySelector('.panel .ex-title')?.textContent || ''`),
    });
    console.log('step', n, s.control, s.from ?? '', '→', s.to ?? '');
  }
  await shoot(0, { control: 'Didone' });
  const w0 = await value('Weight value');
  await setNum('Weight value', 90);
  await shoot(1, { control: 'Weight', from: +w0, to: 90, value: 90, point: 'input[aria-label="Weight"]', away: 'input[aria-label="Stem weight"]' });
  await p.clickText('Size & slant', 'nav button, nav a'); await sleep(900);
  const s0 = await value('Slant value');
  await setNum('Slant value', 30);
  await shoot(2, { control: 'Slant', from: +s0, to: 30, value: 30, point: 'input[aria-label="Slant"]', away: 'input[aria-label="Width"]' });
  await p.clickText('Heights', 'nav button, nav a'); await sleep(900);
  const x0 = await value('x-height value');
  await setNum('x-height value', 100);
  await shoot(3, { control: 'x-height', from: +x0, to: 100, value: 100, point: 'input[aria-label="x-height"]', away: 'input[aria-label="Crossbar"]' });
  await p.clickText('Stroke ends', 'nav button, nav a'); await sleep(900);
  // the ends before the change, on this page, no guides showing, for the magnified detail
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W - 5, y: H - 5 }); await sleep(1300);
  writeFileSync(`${OUT}/step4-before.png`, Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await p.ev(`${byText('.panel button', 'Droplet')}.click()`); await sleep(900);
  await shoot(4, { control: 'Stroke ends', from: 'Ball', to: 'Droplet', tiles: ['Droplet', 'Ball'] });
  writeFileSync(`${OUT}/steps.json`, JSON.stringify({ W, H, scale: SCALE, style: STYLE, steps }, null, 1));
  await p.close();
}

/* ---------- 2. Points, Only R, the construction grid ---------- */
{
  const W = 1000, H = 750;
  const p = await openTab({ width: W, height: H });
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await p.go(`https://typelab.ink/?style=headline&text=${TEXT}&inspect=R&pen=1`, 6000);
  await p.clickText('Only R', 'button'); await sleep(700);
  // the grid's switch is remembered by the browser: switch it on only if it's off
  const on = await p.ev(`[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='Construction grid').querySelector('input').checked`);
  if (!on) { await p.clickText('Construction grid', 'label, button'); await sleep(900); }
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W - 5, y: H - 5 });
  await sleep(300);
  const r = await p.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/redraw.png`, Buffer.from(r.result.data, 'base64'));
  const pts = await p.ev(`[...document.querySelectorAll('.pen-pt')].map(e=>{const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})`);
  writeFileSync(`${OUT}/redraw.json`, JSON.stringify({
    W, H, scale: 2, points: pts,
    only: await box(p, byText('button', 'Only R')),
    grid: await box(p, `[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='Construction grid')`),
    gridName: await box(p, `[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='Grid B')`),
  }, null, 1));
  console.log('redraw: points', pts.length);
  await p.close();
}
process.exit(0);
