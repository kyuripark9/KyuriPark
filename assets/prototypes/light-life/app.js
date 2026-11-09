/* Light Life, phone prototype (2026 redesign), on the Light Life design system.

   The idea it shows: the lamp runs a whole day of light from two times (wake-up and lights
   out), changing slowly from one part of the day to the next. One screen: the light now
   (GlowPanel, with the time in DotDigits), the whole day (LightRuler: drag it, or Play a
   day), and the scenes for the part showing (SceneChips). Scene names are the 2023 app's.

   Each scene is a color temperature and a brightness (what the lamp does; its words come
   from these) and two glows from the design system (how the screen shows it).

   It also plans around where you live (sky.js): the city's sunrise and sunset today and its
   forecast pick a recommended scene for each part, marked with a spark, with one sentence
   saying why. Picking another scene overrides it; picking the recommended one again follows
   the recommendation. The clock is the city's.

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

  // The design system's glows (Night theme), as numbers to blend.
  const css = getComputedStyle(document.documentElement);
  const hex = (h) => { h = h.trim().replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const GLOW = {};
  for (const name of ["sunrise", "morning", "day", "golden", "winddown", "night"]) GLOW[name] = hex(css.getPropertyValue(`--glow-${name}`) || "#888888");
  const SURFACE = hex(css.getPropertyValue("--surface") || "#141416");

  // The day's parts and their scenes ---------------------------------------------------------
  // k: color temperature (kelvin), b: brightness (0-1), glows: [main, second] glow names.
  // fade: minutes a part takes to arrive (Sunrise: how long before wake-up it starts; Night:
  // how long before lights out it starts to dim).
  const scene = (name, k, b, glows) => ({ name, k, b, glows });
  const PARTS = [
    { id: "sunrise", name: "Sunrise", about: "The light rises slowly before you wake, like the sun.", fade: 30, pick: null, rec: null, scenes: [
      scene("Before sunrise", 2200, 0.32, ["sunrise", "night"]),
      scene("Daybreak on the prairie", 2700, 0.4, ["sunrise", "golden"]),
      scene("Among misty mountains", 3200, 0.3, ["sunrise", "day"]) ] },
    { id: "morning", name: "Morning", about: "Bright, cool light to help you wake up.", fade: 60, pick: null, rec: null, scenes: [
      scene("Misty morning sands", 5000, 0.66, ["morning", "golden"]),
      scene("Morning walk in Sydney", 5400, 0.75, ["morning", "day"]),
      scene("Cloudy but fresh", 6000, 0.7, ["day", "morning"]) ] },
    { id: "day", name: "Daytime", about: "Clear daylight to keep you alert.", fade: 120, pick: null, rec: null, scenes: [
      scene("High blue sky", 6500, 0.92, ["day", "night"]),
      scene("Spring daylight in Seoul", 5800, 0.86, ["day", "sunrise"]),
      scene("Fresh cloud", 6200, 0.82, ["day", "morning"]) ] },
    { id: "golden", name: "Golden hour", about: "Warmer, softer light as evening comes.", fade: 120, pick: null, rec: null, scenes: [
      scene("Endless gold light", 3000, 0.6, ["golden", "sunrise"]),
      scene("It's your LA Golden hour", 2800, 0.55, ["golden", "winddown"]),
      scene("Late time beach", 3300, 0.5, ["golden", "day"]) ] },
    { id: "wind", name: "Wind down", about: "Dim, warm light to get ready for sleep.", fade: 60, pick: null, rec: null, scenes: [
      scene("Sunset", 2200, 0.24, ["winddown", "golden"]),
      scene("Orange beach", 2400, 0.3, ["winddown", "sunrise"]),
      scene("Red ocean", 1900, 0.14, ["winddown", "night"]) ] },
    { id: "night", name: "Night", about: "Dark, so you can sleep.", fade: 30, pick: null, rec: null, scenes: [
      scene("Lights off", 0, 0, ["night", "night"]),
      scene("Night light", 1800, 0.05, ["night", "winddown"]) ] },
  ];
  const part = (id) => PARTS.find((p) => p.id === id);
  // A part plays the scene you picked, or else the one recommended for where you live
  // (rec: { i, why }), or else its first.
  const sceneIndex = (p) => p.pick ?? p.rec?.i ?? 0;
  const sceneOf = (id) => { const p = part(id); return p.scenes[sceneIndex(p)]; };

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

  // A scene as a light: its kelvin, brightness, and the color the screen shows for it (its
  // main glow with a fifth of its second glow).
  const blend = (a, b, x) => a.map((v, i) => v + (b[i] - v) * x);
  const asLight = (s) => ({ k: s.k, b: s.b, rgb: blend(GLOW[s.glows[0]], GLOW[s.glows[1]], 0.2) });

  // Blend two lights: brightness and screen color in a straight line, kelvin in mireds
  // (1,000,000 / kelvin), the scale the eye reads as even steps. A light that is off takes
  // the other one's kelvin.
  function mix(a, b, x) {
    if (x <= 0) return a;
    if (x >= 1) return b;
    let k;
    if (!a.b) k = b.k;
    else if (!b.b) k = a.k;
    else { const ma = 1e6 / a.k, mb = 1e6 / b.k; k = 1e6 / (ma + (mb - ma) * x); }
    return { k, b: a.b + (b.b - a.b) * x, rgb: blend(a.rgb, b.rgb, x) };
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
  function describe(l) {
    if (l.b <= 0.004) return "Off";
    const warmth = l.k < 2500 ? "Very warm" : l.k < 3400 ? "Warm" : l.k < 4800 ? "Neutral" : "Cool";
    return `${warmth} · ${Math.round(l.b * 100)}% bright`;
  }
  const nowMinutes = () => Sky.clock(state.city.tz).minutes;
  const viewTime = () => (state.preview ?? nowMinutes());

  function luminance(rgb) {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const rgbCss = (c) => `rgb(${c.map(Math.round).join(",")})`;

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
  let shownDigits = "";
  function dotDigits(el, text) {
    if (text === shownDigits) return;
    shownDigits = text;
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
  const panel = $("panel");
  const ruler = $("ruler");
  let scale = 1;
  let touched = false;   // the hint goes once someone has pressed play or dragged

  // The ruler: 96 ticks, one per 15 minutes; height = brightness, color = the light's glow.
  function paintRuler() {
    let html = "";
    for (let i = 0; i < 96; i++) {
      const l = lightAt(i * 15 + 7.5);
      const h = Math.round(6 + l.b * 54);
      html += `<i style="height:${h}px${l.b > 0.004 ? `;background:${rgbCss(l.rgb)}` : ""}"></i>`;
    }
    $("ticks").innerHTML = html;
    $("wake-text").textContent = fmt(state.wake);
    $("bed-text").textContent = fmt(state.bed);

    // Behind the ticks, when the sun is up where you live; its times on the axis below.
    const s = state.sun, band = $("sun-band"), rise = $("sun-rise"), set = $("sun-set");
    const hours = [...document.querySelectorAll(".ll-axis span")];
    for (const el of [...hours, rise, set]) el.hidden = false;
    rise.hidden = set.hidden = true;
    band.hidden = !s || s.polar === "night";
    if (band.hidden) return;
    const end = s.polar ? DAY : Math.min(DAY, s.set);
    const start = s.polar ? 0 : s.rise;
    band.style.left = `${(start / DAY) * 100}%`;
    band.style.width = `${((end - start) / DAY) * 100}%`;
    if (s.polar) return;

    // Each time sits centered under its edge, kept inside the axis; if the two would touch
    // (a short winter day far north), one label under the middle says both.
    const width = ruler.offsetWidth;
    const put = (el, text, t) => {
      el.hidden = false;
      el.textContent = text;
      const w = el.offsetWidth, x = clamp((t / DAY) * width, w / 2, width - w / 2);
      el.style.left = `${x}px`;
      return [x - w / 2, x + w / 2];
    };
    let taken = [put(rise, fmt(start), start), put(set, fmt(end), end)];
    if (taken[0][1] + 8 > taken[1][0]) {
      set.hidden = true;
      taken = [put(rise, `${fmt(start)}–${fmt(end)}`, (start + end) / 2)];
    }
    // Hour labels the sun's times would touch step aside.
    hours.forEach((el, i) => {
      const x = (parseFloat(el.style.left) / 100) * width, w = el.offsetWidth;
      const [a, b] = i === 0 ? [x, x + w] : i === hours.length - 1 ? [x - w, x] : [x - w / 2, x + w / 2];
      el.hidden = taken.some(([l, r]) => a < r + 8 && b > l - 8);
    });
  }

  // Where you live, at the top: the city, and its weather now.
  function paintPlace() {
    const w = state.weather ? Sky.sayWeather(state.weather.code) : "";
    const text = $("place-text");
    text.textContent = state.city.name;
    if (w) {
      const s = document.createElement("span");
      s.className = "place-weather";
      s.textContent = ` · ${w}`;
      text.append(s);
    }
    $("place").setAttribute("aria-label", `${state.city.name}${w ? `, ${w.toLowerCase()}` : ""}. Change where you live`);
  }

  let chipsFor = "", chipsPart = "";
  function paintChips(id) {
    const x = part(id), on = sceneIndex(x), rec = x.rec ? x.rec.i : -1;
    const key = `${id}:${on}:${rec}`;
    if (key === chipsFor) return;
    chipsFor = key;
    $("chips").setAttribute("aria-label", `${x.name} scene`);
    $("chips").innerHTML = x.scenes.map((s, i) => {
      const dark = s.glows[0] === "night" && s.glows[1] === "night";
      const mark = i === rec ? '<svg class="chip-mark" aria-hidden="true"><use href="#i-spark"/></svg>' : "";
      const note = i === rec ? '<span class="visually-hidden">, recommended</span>' : "";
      return `<button class="ll-chip${dark ? " is-dark" : ""}" type="button" role="radio" aria-checked="${i === on}" data-part="${id}" data-i="${i}" tabindex="${i === on ? 0 : -1}" style="--a:var(--glow-${s.glows[0]});--b:var(--glow-${s.glows[1]})">${mark}${s.name}${note}</button>`;
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

  function render() {
    const t = viewTime(), id = partAt(t), l = lightAt(t);
    const live = state.preview === null && !state.playing;

    // The panel's glow: the light's color; its strength follows brightness, with a little
    // left at night so the dark still reads as night, not as an empty box.
    const strength = 0.3 + 0.7 * Math.pow(l.b, 0.7);
    panel.style.setProperty("--glow", rgbCss(l.rgb));
    panel.style.setProperty("--glow-strength", strength.toFixed(3));
    // The head and the time sit in the lit top of the panel: dark text there once it passes
    // 0.19 luminance (where dark and light text tie in contrast).
    panel.classList.toggle("is-bright", luminance(blend(SURFACE, l.rgb, strength * 0.95)) > 0.19);

    const c = clock(t);
    $("part").textContent = part(id).name;
    dotDigits($("digits"), c.hm);
    $("ampm").textContent = c.ampm;
    // Following the recommendation: say why. Your own pick: say what the part is for.
    const p = part(id);
    $("about").textContent = p.pick === null && p.rec ? p.rec.why : p.about;
    $("values").textContent = describe(l);
    $("now-tag").hidden = !live;
    $("back-now").hidden = live || state.playing;

    $("now-line").style.left = `${(mod(t) / DAY) * 100}%`;
    ruler.setAttribute("aria-valuenow", String(Math.floor(mod(t))));
    ruler.setAttribute("aria-valuetext", `${fmt(t)}, ${part(id).name}, ${describe(l)}`);
    $("hint").hidden = touched;

    paintChips(id);
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
    for (const x of PARTS) x.pick = null;   // a new place: back to its recommendations
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
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
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
