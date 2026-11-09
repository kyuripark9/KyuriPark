/* Light Life, where you live.

   The lamp plans its day from your two times and from the sky where you live: when the sun
   rises and sets there today (worked out here, no network), and today's clouds there
   (Open-Meteo's forecast, free and keyless). From those it recommends a scene for each part
   of the day, with one plain sentence saying why. City search is Open-Meteo's geocoding.

   Times are minutes after local midnight in the city, as in app.js. Loaded before app.js;
   app.js reads it as window.Sky. */
(() => {
  "use strict";

  const GEO = "https://geocoding-api.open-meteo.com/v1/search";
  const FORECAST = "https://api.open-meteo.com/v1/forecast";
  const rad = Math.PI / 180;

  // Where the lamp starts when we can't tell where the visitor is: Kyuri's city.
  const CHICAGO = { name: "Chicago", region: "Illinois", country: "United States", lat: 41.85003, lon: -87.65005, tz: "America/Chicago" };

  // The clock in a city ---------------------------------------------------------------------

  const formats = new Map();
  function clock(tz, date = new Date()) {
    let f = formats.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
      formats.set(tz, f);
    }
    const o = {};
    for (const p of f.formatToParts(date)) if (p.type !== "literal") o[p.type] = +p.value;
    o.minutes = (o.hour % 24) * 60 + o.minute + o.second / 60;   // some engines say 24 at midnight
    return o;
  }
  const validZone = (tz) => { try { clock(tz); return true; } catch { return false; } };

  // The sun ---------------------------------------------------------------------------------
  // The sunrise equation, good to a minute or two. Returns sunrise and sunset in the city's
  // minutes for its date today, or polar: "night" / "day" when the sun doesn't rise or set.

  function sun(city, date = new Date()) {
    const d = clock(city.tz, date);
    const n = Date.UTC(d.year, d.month - 1, d.day) / 864e5 + 2440588 - 2451545;   // days since J2000, at noon
    const j = n - city.lon / 360;
    const M = (357.5291 + 0.98560028 * j) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const L = (M + C + 180 + 102.9372) % 360;
    const transit = 2451545 + j + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
    const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
    const lat = city.lat * rad;
    const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
    if (cosH > 1) return { polar: "night" };
    if (cosH < -1) return { polar: "day" };
    const H = Math.acos(cosH) / rad / 360;
    const at = (jd) => clock(city.tz, new Date((jd - 2440587.5) * 864e5)).minutes;
    const rise = at(transit - H), set = at(transit + H);
    return { rise, set: set < rise ? set + 1440 : set };   // a sunset after midnight stays after sunrise
  }

  // Is the sun up at minute t?
  const sunUp = (s, t) => (s.polar ? s.polar === "day" : t >= s.rise && t < s.set);

  // Weather ---------------------------------------------------------------------------------

  // Today's weather, hour by hour from the city's midnight (two days, for lights out after 12).
  async function weather(city, signal) {
    const q = new URLSearchParams({
      latitude: city.lat, longitude: city.lon, timezone: city.tz, forecast_days: 2,
      current: "weather_code,cloud_cover", hourly: "weather_code,cloud_cover",
    });
    const r = await fetch(`${FORECAST}?${q}`, { signal });
    if (!r.ok) throw new Error(`Forecast ${r.status}`);
    const d = await r.json();
    return {
      code: d.current.weather_code,
      cloud: d.current.cloud_cover,
      hours: d.hourly.cloud_cover.map((cloud, i) => ({ cloud, code: d.hourly.weather_code[i] })),
    };
  }

  // WMO weather codes in plain words.
  function sayWeather(code) {
    if (code == null) return "";
    if (code <= 1) return "Clear";
    if (code === 2) return "Partly cloudy";
    if (code === 3) return "Cloudy";
    if (code === 45 || code === 48) return "Foggy";
    if (code >= 51 && code <= 57) return "Drizzle";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "Rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
    if (code >= 95) return "Storms";
    return "";
  }

  // The sky over a stretch of the day: "clear", "mixed" or "gray" (overcast, fog, rain, snow).
  function skyOver(w, from, to) {
    if (!w) return null;
    let sum = 0, n = 0, wet = 0;
    for (let h = Math.floor(from / 60); h < Math.ceil(to / 60); h++) {
      const x = w.hours[h];
      if (!x) continue;
      sum += x.cloud;
      n++;
      if (x.code >= 45) wet++;
    }
    if (!n) return null;
    const c = sum / n;
    return c >= 75 || wet >= n / 3 ? "gray" : c >= 35 ? "mixed" : "clear";
  }

  // Cities ----------------------------------------------------------------------------------

  async function search(text, signal) {
    const q = new URLSearchParams({ name: text, count: 6, language: "en", format: "json" });
    const r = await fetch(`${GEO}?${q}`, { signal });
    if (!r.ok) throw new Error(`Search ${r.status}`);
    const d = await r.json();
    return (d.results || [])
      .filter((x) => x.timezone && validZone(x.timezone))
      .map((x) => ({
        name: x.name,
        region: x.admin1 && x.admin1 !== x.name ? x.admin1 : "",
        country: x.country || "",
        lat: x.latitude,
        lon: x.longitude,
        tz: x.timezone,
      }));
  }

  // A first guess at where the visitor lives, without asking: the city their computer's time
  // zone is named for (America/New_York: New York). Chicago when that doesn't lead anywhere.
  async function guess(signal) {
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* keep "" */ }
    if (!tz.includes("/") || tz.startsWith("Etc/") || tz === CHICAGO.tz) return CHICAGO;
    try {
      const hit = (await search(tz.split("/").pop().replace(/_/g, " "), signal)).find((c) => c.tz === tz);
      return hit || CHICAGO;
    } catch {
      return CHICAGO;
    }
  }

  // The recommendation ---------------------------------------------------------------------
  // For each part of the day, the scene that fits the sky where you live, and why. A part
  // with nothing to say (no forecast, or nothing unusual) is left out: it keeps its usual
  // scene and sentence. win: each part's [start, end) in minutes after today's midnight.
  // Scene names are the 2023 app's.

  function recommend({ city, wake, win, sun: s, weather: w, fmt }) {
    const at = city.name;
    const night = s.polar === "night", allDay = s.polar === "day";
    const out = {};
    const say = (id, scene, why) => { out[id] = { scene, why }; };

    // Sunrise: is it still dark when you wake?
    if (night) say("sunrise", "Daybreak on the prairie", `The sun won't rise in ${at} today, so your lamp brings the dawn.`);
    else if (!allDay && s.rise > wake) say("sunrise", "Daybreak on the prairie", `Sunrise in ${at} isn't until ${fmt(s.rise)}, so your lamp brings the dawn.`);
    else if (allDay) say("sunrise", "Among misty mountains", `The sun is up all night in ${at}, so your lamp wakes you gently.`);
    else say("sunrise", "Among misty mountains", `The sun is up by ${fmt(s.rise)} in ${at}, so your lamp wakes you gently.`);

    // Morning: dark, gray, or sunny?
    const morning = skyOver(w, ...win.morning);
    if (night || (!allDay && s.rise > wake + 30)) say("morning", "Morning walk in Sydney", `${at} is still dark when you wake, so your lamp starts the day bright.`);
    else if (morning === "gray") say("morning", "Cloudy but fresh", `A gray morning in ${at}, so your lamp adds cool, bright light.`);
    else if (morning) say("morning", "Misty morning sands", `${morning === "clear" ? "Clear skies" : "Some sun"} in ${at} this morning, so your lamp stays gentle.`);

    // Daytime: does the sun set early, and how much does it come through?
    const day = skyOver(w, ...win.day);
    if (night) say("day", "High blue sky", `No sun in ${at} today, so your lamp is your daylight.`);
    else if (!allDay && s.set < win.day[1] - 30) say("day", "High blue sky", `The sun sets at ${fmt(s.set)} in ${at}, so your lamp keeps the day going.`);
    else if (day === "gray") say("day", "High blue sky", `A gray day in ${at}, so your lamp brings the blue sky in.`);
    else if (day === "mixed") say("day", "Fresh cloud", `Sun and clouds in ${at}, so your lamp fills in the gaps.`);
    else if (day === "clear") say("day", "Spring daylight in Seoul", `A clear day in ${at}, so your lamp works alongside the sun.`);

    // Golden hour: has the sun already set, is it setting, or is it still out?
    const [g0, g1] = win.golden;
    if (night) say("golden", "Endless gold light", `No sunset in ${at} today, so your lamp makes the golden hour.`);
    else if (!allDay && s.set <= g0) say("golden", "Endless gold light", `The sun sets at ${fmt(s.set)} in ${at}, so your lamp makes its own golden hour.`);
    else if (!allDay && s.set < g1) say("golden", "It's your LA Golden hour", `The sun sets at ${fmt(s.set)} in ${at}, so your lamp turns gold with it.`);
    else if (allDay) say("golden", "Late time beach", `The sun stays up tonight in ${at}, so your lamp stays soft.`);
    else say("golden", "Late time beach", `It's light out in ${at} until ${fmt(s.set)}, so your lamp stays soft.`);

    // Wind down: is it still light out?
    if (allDay) say("wind", "Red ocean", `The sun stays up tonight in ${at}, so your lamp goes extra dim.`);
    else if (!night && s.set > win.wind[0]) say("wind", "Red ocean", `It's light out in ${at} until ${fmt(s.set)}, so your lamp goes extra dim.`);

    return out;
  }

  window.Sky = { CHICAGO, clock, sun, sunUp, weather, sayWeather, skyOver, search, guess, recommend, validZone };
})();
