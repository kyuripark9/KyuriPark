/* Light Life, phone prototype (2026 redesign), on the Light Life design system.

   The idea it shows: the lamp runs a whole day of light from two times (wake-up and lights
   out), changing slowly from one part of the day to the next. One screen: the part of the
   day showing and its time, the lamp itself (its two parts, each with its light), the scenes
   for that part (SceneChips), and the whole day (LightRuler: drag it, or Play a day).
   Scene names are the 2023 app's.

   The lamp has two parts, apart, each with its own light and its own job, and each scene
   sets both. The head, a rounded square holding a round white light like the sun's, shines
   on you (how strong, 0-100%). The base under it, a pill, holds a color that colors your
   space (which color, how strong). The screen draws them as they're built, and each has a
   Tape (a ruler under a fixed mark) to set how strong its light is for the part showing.
   You turn the color part by hand, on the lamp itself, to point the color anywhere; the app
   doesn't.

   It also plans around where you live (sky.js): the city's sunrise and sunset today and its
   forecast pick a recommended scene for each part, marked with a spark (its reason shows on
   hover). Picking another scene overrides it; picking the recommended one again follows the
   recommendation. The weather there now is an icon at the top. The clock is the city's.

   Times are minutes after midnight. The day is laid out from where Sunrise starts (wake-up
   minus the sunrise length), so a lights-out after midnight still works. */
(() => {
  "use strict";

  const DAY = 1440;
  const W = 390, H = 844;   // the phone's screen, in CSS px
  const mod = (n) => ((n % DAY) + DAY) % DAY;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const $ = (id) => document.getElementById(id);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // The lamp's colors (app.css), as numbers to blend, and their names.
  const css = getComputedStyle(document.documentElement);
  const hex = (h) => { h = h.trim().replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const NAMES = { rose: "Rose", amber: "Amber", orange: "Orange", red: "Red", sand: "Sand", yellow: "Yellow", mint: "Mint", sky: "Sky blue", blossom: "Blossom" };
  const COLOR = {};
  for (const name of Object.keys(NAMES)) COLOR[name] = hex(css.getPropertyValue(`--lamp-${name}`) || "#888888");
  const SUN = hex(css.getPropertyValue("--lamp-sun") || "#ffffff");
  const SURFACE = hex(css.getPropertyValue("--surface") || "#141416");
  const INK = hex(css.getPropertyValue("--ink") || "#f5f3ef");
  const INK_ON_LIGHT = hex(css.getPropertyValue("--ink-on-light") || "#141210");

  // The day's parts and their scenes ---------------------------------------------------------
  // sun: the white light (0-1); color: the color light's color and c its strength (0-1).
  // tune: the strengths you set with the tapes for the part, over its scene's ({ sun, c }).
  // Sunlight leads the morning and the day; color takes over toward evening.
  // fade: minutes a part takes to arrive (Sunrise: how long before wake-up it starts; Night:
  // how long before lights out it starts to dim).
  const scene = (name, sun, color, c) => ({ name, sun, color, c });
  const PARTS = [
    { id: "sunrise", name: "Sunrise", fade: 30, pick: null, rec: null, tune: null, scenes: [
      scene("Before sunrise", 0.25, "rose", 0.5),
      scene("Daybreak on the prairie", 0.35, "amber", 0.55),
      scene("Among misty mountains", 0.3, "sky", 0.4) ] },
    { id: "morning", name: "Morning", fade: 60, pick: null, rec: null, tune: null, scenes: [
      scene("Misty morning sands", 0.66, "sand", 0.4),
      scene("Morning walk in Sydney", 0.75, "sky", 0.4),
      scene("Cloudy but fresh", 0.7, "mint", 0.35) ] },
    { id: "day", name: "Daytime", fade: 120, pick: null, rec: null, tune: null, scenes: [
      scene("High blue sky", 0.92, "sky", 0.45),
      scene("Spring daylight in Seoul", 0.86, "blossom", 0.35),
      scene("Fresh cloud", 0.82, "mint", 0.35) ] },
    { id: "golden", name: "Golden hour", fade: 120, pick: null, rec: null, tune: null, scenes: [
      scene("Endless gold light", 0.45, "amber", 0.7),
      scene("It's your LA Golden hour", 0.4, "orange", 0.7),
      scene("Late time beach", 0.4, "yellow", 0.6) ] },
    { id: "wind", name: "Wind down", fade: 60, pick: null, rec: null, tune: null, scenes: [
      scene("Sunset", 0.06, "rose", 0.45),
      scene("Orange beach", 0.08, "orange", 0.5),
      scene("Red ocean", 0, "red", 0.3) ] },
    { id: "night", name: "Night", fade: 30, pick: null, rec: null, tune: null, scenes: [
      scene("Lights off", 0, "red", 0),
      scene("Night light", 0, "red", 0.1) ] },
  ];
  const part = (id) => PARTS.find((p) => p.id === id);
  // A part plays the scene you picked, or else the one recommended for where you live
  // (rec: { i, why }), or else its first; at the strengths you set, if you did.
  const sceneIndex = (p) => p.pick ?? p.rec?.i ?? 0;
  const sceneOf = (id) => { const p = part(id); return { ...p.scenes[sceneIndex(p)], ...p.tune }; };

  // Wake-up between 4:30 and 10:00 AM; lights out between 9:00 PM and 1:00 AM (1500 = 1:00 AM
  // the next day). That keeps at least 11 hours between them, so every part has room.
  const LIMITS = { wake: [270, 600], bed: [1260, 1500] };

  const state = {
    wake: 420,
    bed: 1380,
    city: Sky.CHICAGO,   // where you live
    sun: null,           // sunrise and sunset there today
    weather: null,       // the forecast there, once it arrives
    preview: null,   // a time picked on the ruler; null follows the clock
    playing: false,
    sheet: null,
  };

  // The day ---------------------------------------------------------------------------------

  function plan() {
    const sunriseLen = part("sunrise").fade;
    const origin = mod(state.wake - sunriseLen);
    const bed = mod(state.bed - origin) || DAY;
    return {
      origin,
      rel: { sunrise: 0, morning: sunriseLen, day: sunriseLen + 180, golden: bed - 360, wind: bed - 120, night: bed },
    };
  }

  function partAt(t, p = plan()) {
    const d = mod(t - p.origin);
    let id = PARTS[0].id;
    for (const x of PARTS) if (d >= p.rel[x.id]) id = x.id;
    return id;
  }

  // A scene as a light: how strong the sunlight is, and the color light's color and strength.
  const blend = (a, b, x) => a.map((v, i) => v + (b[i] - v) * x);
  const asLight = (s) => ({ sun: s.sun, c: s.c, color: s.color, rgb: s.color ? COLOR[s.color] : SURFACE });
  const OFF = 0.004;

  // Blend two lights in a straight line. A color that is off takes the other one's color, so
  // a color fades in and out rather than through gray; its name is whichever is stronger.
  function mix(a, b, x) {
    if (x <= 0) return a;
    if (x >= 1) return b;
    const aOn = a.c > OFF, bOn = b.c > OFF;
    return {
      sun: a.sun + (b.sun - a.sun) * x,
      c: a.c + (b.c - a.c) * x,
      rgb: !aOn ? b.rgb : !bOn ? a.rgb : blend(a.rgb, b.rgb, x),
      color: !aOn ? b.color : !bOn ? a.color : x < 0.5 ? a.color : b.color,
    };
  }

  // The light at time t. Each part fades in from the one before over its own fade length;
  // Sunrise rises over its whole length to be full at wake-up; Night dims the last minutes
  // before lights out, so the room is dark right at lights out.
  function lightAt(t) {
    const p = plan(), r = p.rel, d = mod(t - p.origin);
    const fade = (id) => part(id).fade;
    const L = (id) => asLight(sceneOf(id));
    const night = L("night");
    if (d < r.morning) return mix(night, L("sunrise"), ease(d / r.morning));
    if (d < r.day) return mix(L("sunrise"), L("morning"), ease((d - r.morning) / fade("morning")));
    if (d < r.golden) return mix(L("morning"), L("day"), ease((d - r.day) / fade("day")));
    if (d < r.wind) return mix(L("day"), L("golden"), ease((d - r.golden) / fade("golden")));
    if (d < r.night) {
      const wind = mix(L("golden"), L("wind"), ease((d - r.wind) / fade("wind")));
      return mix(wind, night, ease((d - (r.night - fade("night"))) / fade("night")));
    }
    return night;
  }

  // Words -----------------------------------------------------------------------------------

  function clock(t) {
    t = mod(Math.round(t));
    const h = Math.floor(t / 60), m = t % 60;
    return { hm: `${h % 12 || 12}:${String(m).padStart(2, "0")}`, ampm: h < 12 ? "AM" : "PM" };
  }
  const fmt = (t) => { const c = clock(t); return `${c.hm}\u00a0${c.ampm}`; };   // no break between time and AM
  const pct = (v) => Math.round(v * 100);
  const saySun = (l) => (l.sun > OFF ? `Sunlight ${pct(l.sun)}%` : "Sunlight off");
  const sayColor = (l) => (l.c > OFF ? `${NAMES[l.color]} ${pct(l.c)}%` : "Color off");
  const describe = (l) => (l.sun <= OFF && l.c <= OFF ? "Off" : `${saySun(l)}, ${sayColor(l)}`);
  const nowMinutes = () => Sky.clock(state.city.tz).minutes;
  const viewTime = () => (state.preview ?? nowMinutes());

  function luminance(rgb) {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const rgbCss = (c) => `rgb(${c.map(Math.round).join(",")})`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  // DotDigits ------------------------------------------------------------------------------

  const GLYPHS = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    ":": ["0", "0", "1", "0", "1", "0", "0"],
  };
  function dotDigits(el, text) {
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.className = "ll-digits";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", text);
    el.innerHTML = [...text].map((ch) => {
      const rows = GLYPHS[ch];
      if (!rows) return "";
      const cols = rows[0].length;
      let dots = "";
      for (const row of rows) for (const v of row) dots += v === "1" ? '<i class="on"></i>' : "<i></i>";
      return `<span class="ll-glyph" style="--cols:${cols}">${dots}</span>`;
    }).join("");
  }

  // Painting ----------------------------------------------------------------------------------

  const device = $("device");
  const ruler = $("ruler");
  let scale = 1;
  let touched = false;   // someone has pressed play or dragged: no first-view glide

  // The ruler: 96 ticks, one per 15 minutes, each built like the lamp: a white part for the
  // sunlight (its height), standing on a short part in the color (taller when stronger).
  function paintRuler() {
    let html = "";
    for (let i = 0; i < 96; i++) {
      const l = lightAt(i * 15 + 7.5);
      const hs = l.sun > OFF ? Math.round(4 + l.sun * 30) : 0;
      const hc = l.c > OFF ? Math.round(3 + l.c * 7) : 0;
      if (!hs && !hc) { html += '<i style="height:6px"></i>'; continue; }
      const white = `rgba(245,243,239,${(0.35 + 0.65 * l.sun).toFixed(2)})`;
      const color = `rgba(${l.rgb.map(Math.round).join(",")},${(0.5 + 0.5 * Math.min(1, l.c * 1.5)).toFixed(2)})`;
      const bg = !hc ? white : !hs ? color : `linear-gradient(to top,${color} ${hc}px,transparent ${hc}px ${hc + 2}px,${white} ${hc + 2}px)`;
      html += `<i style="height:${hs + hc + (hs && hc ? 2 : 0)}px;background:${bg}"></i>`;
    }
    $("ticks").innerHTML = html;
    $("wake-text").textContent = fmt(state.wake);
    $("bed-text").textContent = fmt(state.bed);
    $("edit-times").setAttribute("aria-label", `Wake up ${fmt(state.wake)}, lights out ${fmt(state.bed)}. Edit your times`);

    // Behind the ticks, a faint band while the sun is up where you live.
    const s = state.sun, band = $("sun-band");
    band.hidden = !s || s.polar === "night";
    if (band.hidden) return;
    const end = s.polar ? DAY : Math.min(DAY, s.set);
    const start = s.polar ? 0 : s.rise;
    band.style.left = `${(start / DAY) * 100}%`;
    band.style.width = `${((end - start) / DAY) * 100}%`;
  }

  // Where you live, at the top: the weather there now as an icon (the moon instead of the sun
  // once it's dark there), then the city's name. A pin until the forecast arrives.
  function weatherIcon(code, day) {
    if (code == null) return "i-pin";
    if (code <= 1) return day ? "i-sun" : "i-moon";
    if (code === 2) return day ? "w-partly-day" : "w-partly-night";
    if (code === 45 || code === 48) return "w-fog";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "w-rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "w-snow";
    if (code >= 95) return "w-storm";
    return "w-cloud";
  }
  function paintPlace() {
    const code = state.weather?.code;
    const day = state.sun ? Sky.sunUp(state.sun, nowMinutes()) : true;
    const icon = `#${weatherIcon(code, day)}`, use = $("weather-use");
    if (use.getAttribute("href") !== icon) use.setAttribute("href", icon);
    const words = Sky.sayWeather(code);
    $("place-text").textContent = state.city.name;
    $("place").setAttribute("aria-label", `${state.city.name}${words ? `, ${words}` : ""}. Change where you live`);
  }

  let chipsFor = "", chipsPart = "";
  function paintChips(id) {
    const x = part(id), on = sceneIndex(x), rec = x.rec ? x.rec.i : -1;
    const key = `${id}:${on}:${rec}`;
    if (key === chipsFor) return;
    chipsFor = key;
    $("chips").setAttribute("aria-label", `${x.name} scene`);
    $("chips").innerHTML = x.scenes.map((s, i) => {
      // Each chip runs from the scene's sunlight to its color, each as strong as it is.
      const dim = [58, 58, 62];
      const a = blend(dim, SUN, 0.3 + 0.7 * s.sun), b = s.color ? blend(dim, COLOR[s.color], 0.3 + 0.7 * Math.min(1, s.c * 1.6)) : dim;
      // Light or dark text, whichever reads better on the chip's weaker end.
      const worst = (ink) => Math.min(...[a, b].map((x) => { const l = luminance(x), k = luminance(ink); return (Math.max(l, k) + 0.05) / (Math.min(l, k) + 0.05); }));
      const dark = worst(INK) > worst(INK_ON_LIGHT);
      const mark = i === rec ? '<svg class="chip-mark" aria-hidden="true"><use href="#i-spark"/></svg>' : "";
      const note = i === rec ? `<span class="visually-hidden">, recommended: ${esc(x.rec.why)}</span>` : "";
      const why = i === rec ? ` title="${esc(x.rec.why)}"` : "";
      return `<button class="ll-chip${dark ? " is-dark" : ""}" type="button" role="radio" aria-checked="${i === on}" data-part="${id}" data-i="${i}" tabindex="${i === on ? 0 : -1}"${why} style="--a:${rgbCss(a)};--b:${rgbCss(b)}">${mark}${s.name}${note}</button>`;
    }).join("");

    // Keep the chosen chip in view (the recommended one may be further along the row),
    // scrolling the row only. A new part starts the row from its start.
    const row = $("chips"), chip = row.children[on], pad = 16;
    if (id !== chipsPart) row.scrollLeft = 0;
    chipsPart = id;
    const left = chip.offsetLeft - row.offsetLeft, right = left + chip.offsetWidth;
    if (right + pad > row.scrollLeft + row.clientWidth) row.scrollLeft = right + pad - row.clientWidth;
    else if (left - pad < row.scrollLeft) row.scrollLeft = left - pad;
  }

  // The lamp ---------------------------------------------------------------------------------
  // Each part of the lamp shows its own light for the part of the day showing, as set (not
  // midway through a fade: the day's ruler shows those), and eases to the next part's.

  const head = $("head"), base = $("base");
  // How strongly each light shows: a weak light still shows a little.
  const strength = (v) => (v > OFF ? 0.15 + 0.85 * Math.pow(v, 0.7) : 0);
  // Light (dark-on-light) ink once the fill behind passes 0.18 luminance, where dark and
  // light text tie in contrast. Each fill is one flat color over the whole part.
  const bright = (rgb, a) => luminance(blend(SURFACE, rgb, a)) > 0.18;

  function paintLamp(l) {
    const sunA = strength(l.sun), colA = strength(l.c);
    $("sun-fill").style.opacity = sunA.toFixed(3);
    head.classList.toggle("ink-light", bright(SUN, sunA));
    dotDigits($("sun-digits"), String(pct(l.sun)));
    paintTape(sunTape, l.sun, saySun(l));

    const rgb = rgbCss(l.rgb);
    $("color-fill").style.backgroundColor = rgb;
    $("color-fill").style.opacity = colA.toFixed(3);
    $("swatch-color").style.backgroundColor = l.c > OFF ? rgb : "transparent";
    $("color-name").textContent = l.c > OFF ? NAMES[l.color] : "Color";
    $("color-value").textContent = l.c > OFF ? `${pct(l.c)}%` : "Off";
    base.classList.toggle("ink-light", bright(l.rgb, colA));
    paintTape(colorTape, l.c, sayColor(l));
  }

  // Tapes: a ruler that slides under a fixed mark. Drag it, or anywhere on its part of the
  // lamp, sideways (the ruler moves with you, 4px a percent); tap the ruler to go to that
  // spot; or use the arrow keys. It sets that light's strength for the part of the day
  // showing, until you pick a scene for that part again.
  const PX = 4;
  function makeTape(el, key, surface) {
    let html = "";
    for (let v = 0; v <= 100; v += 2) html += `<i${v % 10 ? "" : ' class="is-major"'} style="left:${v * PX}px" data-v="${v}"></i>`;
    el.querySelector(".ll-tape-track").innerHTML = html;
    const tape = { el, key, ticks: [...el.querySelectorAll("i")], lit: -1 };

    const level = () => sceneOf(partAt(viewTime()))[key];
    const set = (v) => {
      const x = part(partAt(viewTime()));
      x.tune = { ...x.tune, [key]: clamp(v, 0, 100) / 100 };
      paintRuler();
      render();
    };
    let drag = null;
    surface.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      takeOver();
      drag = { x: e.clientX, v: level() * 100, moved: false, onTape: el.contains(e.target) };
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / scale;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!drag.moved) { drag.moved = true; device.classList.add("is-tuning"); }
      set(drag.v - dx / PX);
    });
    const end = (e) => {
      if (!drag) return;
      device.classList.remove("is-tuning");
      if (drag.moved) set(Math.round(level() * 100));
      else if (drag.onTape && e.type === "pointerup") {
        const r = el.getBoundingClientRect();
        set(Math.round(drag.v + (e.clientX - (r.left + r.width / 2)) / scale / PX));
      }
      drag = null;
    };
    surface.addEventListener("pointerup", end);
    surface.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
      const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      const now = Math.round(level() * 100);
      let next;
      if (e.key in steps) next = now + steps[e.key] * (e.shiftKey ? 10 : 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = 100;
      else return;
      e.preventDefault();
      takeOver();
      set(next);
    });
    return tape;
  }
  function paintTape(tape, v, text) {
    const n = v * 100;
    tape.el.style.setProperty("--v", n.toFixed(2));
    const lit = v > OFF ? Math.floor(n + 0.5) : -1;
    if (lit !== tape.lit) {
      tape.lit = lit;
      for (const t of tape.ticks) t.classList.toggle("on", +t.dataset.v <= lit);
    }
    tape.el.setAttribute("aria-valuenow", String(Math.round(n)));
    tape.el.setAttribute("aria-valuetext", text);
  }
  const sunTape = makeTape($("sun-tape"), "sun", head);
  const colorTape = makeTape($("color-tape"), "c", base);

  function render() {
    const t = viewTime(), id = partAt(t), l = asLight(sceneOf(id));
    const live = state.preview === null && !state.playing;

    $("part").textContent = part(id).name;
    $("time").textContent = fmt(t);
    $("now-tag").hidden = !live;
    $("back-now").hidden = live || state.playing;

    $("now-line").style.left = `${(mod(t) / DAY) * 100}%`;
    ruler.setAttribute("aria-valuenow", String(Math.floor(mod(t))));
    ruler.setAttribute("aria-valuetext", `${fmt(t)}, ${part(id).name}, ${describe(l)}`);

    paintChips(id);
    paintLamp(l);
    paintPlace();
    $("status-time").textContent = clock(nowMinutes()).hm;
  }

  // Moving through the day ----------------------------------------------------------------

  let dragging = false;
  function seek(e) {
    const r = ruler.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    state.preview = Math.min(DAY - 1, Math.round((x * DAY) / 5) * 5);
    render();
  }
  function takeOver() { stopGlide(); stopPlay(); touched = true; }
  ruler.addEventListener("pointerdown", (e) => {
    takeOver();
    dragging = true;
    ruler.setPointerCapture(e.pointerId);
    seek(e);
  });
  ruler.addEventListener("pointermove", (e) => { if (dragging) seek(e); });
  for (const type of ["pointerup", "pointercancel"]) ruler.addEventListener(type, () => { dragging = false; });
  ruler.addEventListener("keydown", (e) => {
    const steps = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 };
    let next;
    if (e.key in steps) next = mod(Math.round(viewTime() / 15) * 15 + steps[e.key]);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = DAY - 1;
    else return;
    e.preventDefault();
    takeOver();
    state.preview = next;
    render();
  });
  $("back-now").addEventListener("click", () => { state.preview = null; render(); ruler.focus({ preventScroll: true }); });

  // Play a day: the whole 24 hours in 12 seconds, from the time showing, then back to it.
  let raf = 0;
  const PLAY_MS = 12000;
  function setPlayButton() {
    $("play-label").textContent = state.playing ? "Pause" : "Play a day";
    $("play").querySelector("use").setAttribute("href", state.playing ? "#i-pause" : "#i-play");
  }
  function stopPlay() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(raf);
    setPlayButton();
    render();
  }
  function play() {
    stopGlide();
    if (state.playing) return stopPlay();
    touched = true;
    state.playing = true;
    setPlayButton();
    const from = viewTime();
    let t0 = null;
    const step = (now) => {
      if (t0 === null) t0 = now;
      const k = (now - t0) / PLAY_MS;
      if (k >= 1) { state.preview = from; stopPlay(); return; }
      state.preview = mod(from + k * DAY);
      render();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  $("play").addEventListener("click", play);

  // The first time the phone is on screen, the signal line slides once from midnight to now,
  // so the ruler reads as something that moves. Then it stays put.
  let glideRaf = 0;
  function stopGlide() { if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = 0; state.preview = null; } }
  function glide() {
    if (reduceMotion.matches || touched) return;
    const ms = 1600;
    let t0 = null;
    const step = (now) => {
      if (t0 === null) t0 = now;
      const k = (now - t0) / ms;
      if (k >= 1) { glideRaf = 0; state.preview = null; render(); return; }
      // Now is read each frame: the city (and its clock) may arrive mid-glide.
      state.preview = nowMinutes() * (1 - Math.pow(1 - k, 3));
      render();
      glideRaf = requestAnimationFrame(step);
    };
    glideRaf = requestAnimationFrame(step);
  }
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.6)) { io.disconnect(); setTimeout(glide, 400); }
    }, { threshold: [0, 0.6, 1] });
    io.observe(ruler);
  }

  // Scenes: choosing one changes the light right away; the time showing stays put.
  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest(".ll-chip");
    if (!b) return;
    takeOver();
    state.preview = viewTime();
    // The recommended scene again: follow the recommendation (and its updates) again.
    const x = part(b.dataset.part), i = +b.dataset.i;
    x.pick = x.rec && i === x.rec.i ? null : i;
    x.tune = null;   // a scene comes with its own strengths
    chipsFor = "";
    paintRuler();
    render();
    $("chips").querySelector(`[data-i="${b.dataset.i}"]`).focus({ preventScroll: true });
  });
  $("chips").addEventListener("keydown", (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    const items = [...$("chips").querySelectorAll(".ll-chip")];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + dir + items.length) % items.length].click();
  });

  // Sheets ----------------------------------------------------------------------------------

  let opener = null;
  function openSheet(id, from) {
    stopGlide();
    stopPlay();
    opener = from;
    state.sheet = id;
    $(id).classList.add("is-open");
    device.classList.add("has-sheet");
    const first = $(id).querySelector("input") || $(id).querySelector("h2");
    setTimeout(() => first.focus({ preventScroll: true }), 50);
  }
  function closeSheet() {
    if (!state.sheet) return;
    if (state.sheet === "city-sheet") stopSearch();
    $(state.sheet).classList.remove("is-open");
    device.classList.remove("has-sheet");
    state.sheet = null;
    if (opener) opener.focus({ preventScroll: true });
  }
  for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", closeSheet);
  $("scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  function renderTimes() {
    $("wake-value").textContent = fmt(state.wake);
    $("bed-value").textContent = fmt(state.bed);
    for (const b of document.querySelectorAll(".step")) {
      const [lo, hi] = LIMITS[b.dataset.field];
      const next = state[b.dataset.field] + +b.dataset.step;
      b.disabled = next < lo || next > hi;
    }
  }
  $("edit-times").addEventListener("click", (e) => {
    renderTimes();
    openSheet("times-sheet", e.currentTarget);
  });
  $("times-sheet").addEventListener("click", (e) => {
    const b = e.target.closest(".step");
    if (!b || b.disabled) return;
    const f = b.dataset.field;
    state[f] = clamp(state[f] + +b.dataset.step, ...LIMITS[f]);
    renderTimes();
    remember();
    replan();
  });

  // Where you live ----------------------------------------------------------------------------
  // The sun's times in your city today, its forecast, and your times give each part of the
  // day a recommended scene and a sentence why (sky.js). Planned again when any of those
  // change, and when the city's date turns over.

  let plannedFor = "";   // the city's date the plan was made for
  const cityDate = () => { const c = Sky.clock(state.city.tz); return `${c.year}-${c.month}-${c.day}`; };
  function replan() {
    plannedFor = cityDate();
    state.sun = Sky.sun(state.city);
    const p = plan(), win = {};
    PARTS.forEach((x, n) => {
      const next = PARTS[n + 1];
      win[x.id] = [p.origin + p.rel[x.id], p.origin + (next ? p.rel[next.id] : DAY)];
    });
    const recs = Sky.recommend({ city: state.city, wake: state.wake, win, sun: state.sun, weather: state.weather, fmt });
    for (const x of PARTS) {
      const r = recs[x.id];
      const i = r ? x.scenes.findIndex((s) => s.name === r.scene) : -1;
      x.rec = i < 0 ? null : { i, why: r.why };
    }
    chipsFor = "";
    paintPlace();
    paintRuler();
    render();
  }

  // The forecast: when the city changes, and every half hour. Without it (offline, or the
  // service is down) the plan goes on the sun alone.
  let weatherCtrl = null, weatherTried = 0;
  async function loadWeather() {
    weatherCtrl?.abort();
    const ctrl = (weatherCtrl = new AbortController());
    const city = state.city;
    weatherTried = Date.now();
    try {
      const w = await Sky.weather(city, ctrl.signal);
      if (city !== state.city) return;
      state.weather = w;
      replan();
    } catch {
      /* keep the last forecast, if any */
    }
  }

  let chosen = false;   // the visitor picked a city (or one was saved): don't replace it with a guess
  function setCity(city, save = true) {
    state.city = city;
    state.weather = null;
    for (const x of PARTS) { x.pick = null; x.tune = null; }   // a new place: back to its recommendations
    if (save) remember();
    replan();
    loadWeather();
  }

  // Remembered between visits, in this browser only.
  const KEY = "light-life";
  function remember() {
    try { localStorage.setItem(KEY, JSON.stringify({ city: chosen ? state.city : null, wake: state.wake, bed: state.bed })); } catch { /* private mode */ }
  }
  function recall() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* nothing saved */ }
    if (!saved || typeof saved !== "object") return;
    for (const f of ["wake", "bed"]) {
      const v = saved[f];
      if (Number.isInteger(v) && v % 15 === 0 && v >= LIMITS[f][0] && v <= LIMITS[f][1]) state[f] = v;
    }
    const c = saved.city;
    if (c && typeof c.name === "string" && Number.isFinite(c.lat) && Number.isFinite(c.lon) && typeof c.tz === "string" && Sky.validZone(c.tz)) {
      state.city = { name: c.name, region: String(c.region || ""), country: String(c.country || ""), lat: c.lat, lon: c.lon, tz: c.tz };
      chosen = true;
    }
  }

  // Sheet: where you live (search) ----------------------------------------------------------

  const input = $("city-input"), results = $("city-results"), status = $("city-status");
  let found = [], active = -1, searchCtrl = null, searchTimer = 0;
  const sameCity = (a, b) => a.name === b.name && a.tz === b.tz && Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05;

  function showCities(cities, note = "", first = 0) {
    found = cities;
    status.textContent = note;
    results.innerHTML = cities.map((c, i) => {
      const where = [c.region, c.country].filter(Boolean).join(", ");
      const current = sameCity(c, state.city);
      return `<li class="result" role="option" id="city-${i}" data-i="${i}" aria-selected="false">
        <span class="result-text"><span class="result-name">${esc(c.name)}</span>${where ? `<span class="result-where">${esc(where)}</span>` : ""}</span>
        ${current ? '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg><span class="visually-hidden">, where you live now</span>' : ""}
      </li>`;
    }).join("");
    input.setAttribute("aria-expanded", String(cities.length > 0));
    setActive(cities.length ? first : -1);
  }
  // The row Enter picks (and arrow keys move), highlighted. Kept in view by scrolling the
  // list only: scrollIntoView would scroll the portfolio page around the frame too.
  function setActive(i) {
    active = i;
    [...results.children].forEach((li, n) => {
      li.classList.toggle("is-active", n === i);
      li.setAttribute("aria-selected", String(n === i));
    });
    if (i < 0) { input.removeAttribute("aria-activedescendant"); return; }
    input.setAttribute("aria-activedescendant", `city-${i}`);
    const li = results.children[i];
    if (li.offsetTop < results.scrollTop) results.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > results.scrollTop + results.clientHeight) results.scrollTop = li.offsetTop + li.offsetHeight - results.clientHeight;
  }
  function stopSearch() {
    clearTimeout(searchTimer);
    searchCtrl?.abort();
  }
  function choose(city) {
    if (!city) return;
    chosen = true;
    if (!sameCity(city, state.city)) setCity(city);
    closeSheet();
  }

  $("place").addEventListener("click", (e) => {
    input.value = "";
    showCities([state.city], "", -1);
    openSheet("city-sheet", e.currentTarget);
  });
  input.addEventListener("input", () => {
    stopSearch();
    const q = input.value.trim();
    if (q.length < 2) { showCities([state.city], "", -1); return; }
    searchTimer = setTimeout(async () => {
      const ctrl = (searchCtrl = new AbortController());
      try {
        const cities = await Sky.search(q, ctrl.signal);
        if (!ctrl.signal.aborted) showCities(cities, cities.length ? "" : `No city called “${q}”. Try another spelling.`);
      } catch {
        if (!ctrl.signal.aborted) showCities([], "Can't search right now. Check your connection and try again.");
      }
    }, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!found.length) return;
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive(active < 0 ? (d > 0 ? 0 : found.length - 1) : (active + d + found.length) % found.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) choose(found[active]);
    }
  });
  results.addEventListener("click", (e) => {
    const li = e.target.closest(".result");
    if (li) choose(found[+li.dataset.i]);
  });

  // Fit the phone to its frame -----------------------------------------------------------------
  // In the portfolio's frame, the 390 x 844 screen scales to fill it. Opened on its own: on a
  // phone it fills the screen; on a computer it stands in the window at up to full size.

  const inFrame = window.self !== window.top;
  function fit() {
    const root = document.documentElement;
    const fill = !inFrame && window.innerWidth <= 520;
    root.classList.toggle("is-fill", fill);
    root.classList.toggle("is-alone", !inFrame);
    if (fill) {
      scale = 1;
      device.style.transform = "";
    } else {
      const room = inFrame ? 0 : 32;
      scale = Math.min((window.innerWidth - room) / W, (window.innerHeight - room) / H, inFrame ? Infinity : 1);
      device.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }
  }
  window.addEventListener("resize", fit);

  // Follow the clock while nothing is previewed; plan again when the city's day turns over;
  // fetch the forecast again every half hour.
  setInterval(() => {
    if (cityDate() !== plannedFor) replan();
    if (Date.now() - weatherTried > 30 * 60 * 1000) loadWeather();
    if (!state.playing && !glideRaf) render();
  }, 15000);

  recall();
  fit();
  replan();
  loadWeather();
  // No city yet: guess it from the computer's time zone, without asking for location.
  if (!chosen) Sky.guess().then((city) => { if (!chosen && !sameCity(city, state.city)) setCity(city, false); });
})();
