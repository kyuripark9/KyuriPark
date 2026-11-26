// About's drawing of the user as a designer, a globe that turns (ABOUT_GLOBE in build.py, since
// 2026-11-24, the user's ask, from an orbit diagram turning in 3D on their Pinterest; build.py's
// globe says what's on it): a sphere in a globe's lines, the scales they design at as orbits
// round what their work is about, each tilted its own way and turning round an axis of its
// own, as the diagram's orbits do (the rings rolling over and opening, the great circles
// folding to a cross and opening again), a turn about every 18 seconds, at one steady lean
// toward you, each orbit on the left the mirror of its partner on the right, so the drawing
// stays symmetric as it turns, the globe's lines standing still (since 2026-11-25 evening, the
// user's asks; until then every orbit turned round the upright axis, a turn every 30
// seconds, and before that the whole globe as one, a turn a minute, its lean rising and
// falling a little). build.py writes the still parts (the rim, the axes, the middle) and the
// words; this draws the rest as the globe stands each moment: the globe's lines on its near
// side, each orbit (its far half under the globe's lines), its dot, the dotted line out
// to it, and its name beside the dot, outward from the middle, faint while round the back;
// and the user's work going across the scales (since 2026-11-24 night, build.py's globe_ways),
// an arrow each from one scale's dot to another's, its word by it (since 2026-11-25, the
// user's words: EXPERIENCE, Light Life, Object to Digital; AI, the Clayco rebrand, Branding to
// Space; the dashed way ahead, Digital to Space, with none); the word by the middle, LIVING,
// stands still. Beside the globe (under it on narrow screens) its
// key says what it means (build.py's globe_key): each of its words in plain words, in groups
// (how I see the world, what I design, how I connect them, where I'm going). A group of the key, or a
// line of it, under the pointer or clicked or tapped
// (until another click or tap) lights its part of the drawing, the rest going faint, and a
// name on the globe lights its line in the key; while something is lit the globe slows to a
// stop. Dragging sideways turns it by hand; let go, it keeps going the way it was turned and
// settles back to its own pace. It turns only while on screen. With reduced motion it stands
// still at REST, and only a drag turns it.
(() => {
  const figure = document.querySelector(".orbits-figure.is-globe");
  if (!figure) return;
  const svg = figure.querySelector("svg");
  const box = svg.viewBox.baseVal;
  const [CX, CY, R] = figure.dataset.globe.split(" ").map(Number);
  const DEG = Math.PI / 180;

  // Each orbit, smallest first (when there are fewer scales, the last ones): its radius (the
  // globe's is 1); its tilt off the globe's equator, round the left-right axis, then its turn
  // round the upright one; and where its dot sits, round it (all in degrees). Since
  // 2026-11-25 (the user's asks, after the orbit diagram they started from: cleaner, bigger,
  // then regular) laid out as that diagram is, and in order: Object and Branding two flat rings
  // round the middle, a third and two thirds of the globe, so the middle, the rings and the
  // globe are evenly spaced; Digital and Space two great circles round the globe itself, the
  // same tilt and turned the same way either side, so at REST each is the other's mirror,
  // almost round, touching the rim, crossing on the axes, as the diagram's two; each dot where
  // its mirror's is: Object at its ring's left end, Branding at its right, a little toward
  // you, Digital and Space on the dotted diagonals, high on the left and high on the right.
  // (Until then the rings were 0.38 and 0.62, the great circles at 72 and 68, turned 32 and
  // -80, and the dots spread unevenly.)
  // And which way each goes round (half): since 2026-11-25 (the user's ask: "still the tilt,
  // the spacing, the shapes aren't symmetric", the whole globe turning as one, it was mirrored
  // only at REST) the left half, Object and Digital, turns one way round the upright axis and
  // the right half, Branding and Space, the other, each its mirror, so the drawing is the same
  // either side of the axis all the way round; the rings, being level, keep their shape, only
  // their dots going round them, and the globe's lines stand still.
  // Since later that day (the user's ask, with the diagram again: "the same shape as this
  // example, its tilt, its direction") measured off the diagram and drawn over it to check:
  // the rings 0.29 and 0.64 of the globe, as flat as its (PITCH); Digital and Space each a
  // great circle whose long axis runs along a diagonal, 50 degrees up from level, touching the
  // rim at its ends, three quarters as wide across (tilt 54.8 and turn 39.1 make that at
  // PITCH), crossing each other on the axes, 0.86 of the way up and 0.82 out, as the
  // diagram's two; Object at its ring's left end, Branding at its right, Digital and Space
  // where their circles touch the rim at the top, as the diagram's top dot does. (Until then
  // the rings a third and two thirds, the great circles tall, tilt -75 and turn 25, crossing
  // near the top and bottom.)
  // And how each turns (axis, x right, y up, z toward you, before the lean; pace, times
  // SPIN), written as the right half's: the left half's orbit turns the mirror way round the
  // mirror of it. Since 2026-11-25 evening (the user's ask, with the diagram's moving
  // original: "unlike the example its direction stands still, and it's slow", every orbit
  // turning round the upright axis, the rings level, only their dots going round) each turns
  // round an axis of its own, as the diagram's do, measured off its frames and drawn over
  // them to check: the rings round one pointing almost at you, so they roll over, Branding's
  // right end going down and Object's up, opening from flat to upright and round again; the
  // great circles round one almost upright, leaning 12 degrees toward you, Space's front
  // going left and Digital's right (the other way round from before), folding to a cross of
  // lines and opening again; the rings at 18 degrees a second, the great circles at 21, as
  // the diagram's, so it all comes back to REST every two minutes.
  const ORBITS = [
    { r: 0.29, tilt: 0, turn: 0, dot: 180, half: -1, axis: [0.295, -0.42, -0.858], pace: 0.9 },
    { r: 0.64, tilt: 0, turn: 0, dot: 0, half: 1, axis: [0.295, -0.42, -0.858], pace: 0.9 },
    { r: 1, tilt: 54.78, turn: 39.1, dot: 246.52, half: -1, axis: [0, -0.977, -0.212], pace: 1.05 },
    { r: 1, tilt: 54.78, turn: -39.1, dot: 293.48, half: 1, axis: [0, -0.977, -0.212], pace: 1.05 },
  ];
  const SPIN = (2 * Math.PI) / 18;  // its own pace: a turn every 18 seconds (30 until the
                                    // diagram's frames were measured, a minute before that)
  const PITCH = 12;                 // how far it leans toward you, in degrees, always (low, so
                                    // the rings round the middle lie flat, as the diagram's;
                                    // 14 until the diagram was measured, 2026-11-25)
  const REST = 0;                   // where it starts, and stands with reduced motion: facing
                                    // you, Digital and Space mirrored
  const BEHIND = 0.65;              // how strongly a name shows while its dot is round the back
                                    // (ink at this is about 5.5:1 on the paper, still easy to read)

  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const f = (v) => v.toFixed(1);
  const pt = (p) => `${f(p[0])} ${f(p[1])}`;
  const smooth = (t) => {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
  };
  // How near a point on an orbit of radius r is, 0 to 1 (z, from view): whole on the near
  // side and at the rim, where Digital's and Space's dots stand at REST, going as it comes
  // round the back (since 2026-11-25; until then already going at the rim).
  const depth = (z, r) => smooth((z / r + 0.25) / 0.25);

  let theta = REST;       // how far it has turned (at SPIN, a turn every 18 seconds)
  const phi = PITCH * DEG;  // its lean, always the same
  const cP = Math.cos(phi);
  const sP = Math.sin(phi);

  // How an orbit stands now (it.m, turned it.pace times theta round it.axis, the left
  // half's the other way round, its mirror)...
  function spin(it) {
    const a = it.half * it.pace * theta;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = 1 - c;
    const [x, y, z] = it.axis;
    it.m = [
      c + x * x * k, x * y * k - z * s, x * z * k + y * s,
      y * x * k + z * s, c + y * y * k, y * z * k - x * s,
      z * x * k - y * s, z * y * k + x * s, c + z * z * k,
    ];
  }
  // ...a point on it (x right, y up, z toward you, the globe's radius 1) turned so...
  const turn = (p, it) => {
    const m = it.m;
    return [0, 3, 6].map((i) => m[i] * p[0] + m[i + 1] * p[1] + m[i + 2] * p[2]);
  };
  // ...where a turned point is in the drawing, and how near (z, the near side above 0)...
  const look = ([x, y, z]) => [CX + R * x, CY - R * (y * cP - z * sP), y * sP + z * cP];
  // ...and the two at once.
  const view = (p, it) => look(turn(p, it));

  // A line through points on an orbit as two paths, its near part and its far part, split
  // where it goes round the edge.
  function trace(points, closed, it) {
    return split(points.map((p) => view(p, it)), closed);
  }

  // The same for points already placed in the drawing (from view).
  function split(p, closed) {
    let near = "";
    let far = "";
    let nearEnd = null;
    let farEnd = null;
    const put = (a, b, isNear) => {
      if (isNear) {
        near += `${nearEnd === a ? "" : `M${pt(a)}`}L${pt(b)}`;
        nearEnd = b;
      } else {
        far += `${farEnd === a ? "" : `M${pt(a)}`}L${pt(b)}`;
        farEnd = b;
      }
    };
    const count = closed ? p.length : p.length - 1;
    for (let i = 0; i < count; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      if (a[2] >= 0 === b[2] >= 0) {
        put(a, b, a[2] >= 0);
      } else {
        const t = a[2] / (a[2] - b[2]);
        const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
        put(a, m, a[2] >= 0);
        put(m, b, b[2] >= 0);
      }
    }
    return [near, far];
  }

  // The globe's lines, few and faint, as the diagram's: seen straight on and standing still,
  // every 22.5 degrees either side of the axes, the meridians meeting at the rim's top and
  // bottom and the parallels straight (since 2026-11-25, the user's ask: the diagram's shape;
  // until then a meridian every 45 degrees and parallels at 30 and 60, leaning as the orbits
  // do). Drawn once.
  const gridPath = svg.querySelector(".globe-lines");
  if (gridPath) {
    let d = "";
    for (const k of [1, 2, 3]) {
      const a = 22.5 * k * DEG;
      for (const side of [-1, 1]) {
        const line = [];
        for (let t = -90; t <= 90; t += 5) {
          line.push([CX + R * side * Math.sin(a) * Math.cos(t * DEG), CY - R * Math.sin(t * DEG)]);
        }
        const y = CY - side * R * Math.sin(a);
        const w = R * Math.cos(a);
        d += `M${line.map(pt).join("L")}M${f(CX - w)} ${f(y)}H${f(CX + w)}`;
      }
    }
    gridPath.setAttribute("d", d);
  }

  // The orbits, from build.py's parts.
  const fronts = [...svg.querySelectorAll(".globe-front > .orbit")];
  const backs = [...svg.querySelectorAll(".globe-back > .orbit")];
  const orbits = fronts.map((g, i) => {
    const o = ORBITS.slice(-fronts.length)[i];
    const ct = Math.cos(o.tilt * DEG);
    const st = Math.sin(o.tilt * DEG);
    const cn = Math.cos(o.turn * DEG);
    const sn = Math.sin(o.turn * DEG);
    const at = (deg) => {
      const x = o.r * Math.cos(deg * DEG);
      const z0 = o.r * Math.sin(deg * DEG);
      const z = z0 * ct;
      return [x * cn + z * sn, -z0 * st, -x * sn + z * cn];
    };
    // Every orbit one solid line, Space's too (since 2026-11-25, the user's ask, from the
    // diagram: its great circles black lines; Space's was dashed, a dash a degree of it, and
    // its open dot still says it's the one not reached).
    const ring = [];
    for (let d = 0; d < 360; d += 2.5) ring.push(at(d));
    const l = Math.hypot(...o.axis);
    return {
      n: i + 1,
      r: o.r,
      half: o.half,
      axis: [(o.half * o.axis[0]) / l, o.axis[1] / l, o.axis[2] / l],
      pace: o.pace,
      point: at(o.dot),
      line: g.querySelector(".orbit-line"),
      back: backs[i] && backs[i].querySelector(".orbit-line"),
      ray: g.querySelector(".orbit-ray"),
      dot: g.querySelector(".orbit-dot"),
      label: figure.querySelector(`.orbit-label[data-orbit="${i + 1}"]`),
      ring,
    };
  });

  // The ways (build.py's globe_ways, a group each: data-from and data-to, the orbits it goes
  // from and to, by number; data-stops, where each year between falls along it, 0 to 1): a
  // straight line from the first's dot to the second's, as the diagram's lines are (since
  // 2026-11-25; until then each turned round the middle as it widened or narrowed from one
  // orbit's size to the other's, and the curves crossing the orbits made the drawing busy),
  // between the dots as they've turned (the way ahead goes from one half to the other). It
  // starts a little clear of its first dot, its head stops a little short of its last; a dot
  // for each year between.
  // Since later that day (the user's ask, from the diagram: "the diagonals crossing it
  // dotted", in its shape) EXPERIENCE and AI are the diagram's dotted cross: each a straight
  // line through the middle, from the rim across from its scale's dot, through Living, out
  // to the dot (Digital, Space), its head there, dotted (style.css); so they cross at the
  // middle and mirror each other as the diagram's two do, where they ran from Object's and
  // Branding's dots, which, on rings of two sizes, couldn't mirror. Their "from" still says
  // what they light (globe_key). The way ahead (is-next) still runs dot to dot, dashed.
  const STEPS = Array.from({ length: 65 }, (_, i) => i / 64);
  const ways = [...svg.querySelectorAll(".globe-front > .globe-path")].map((group) => {
    const n = group.dataset.way;
    const a = orbits[Number(group.dataset.from) - 1];
    const b = orbits[Number(group.dataset.to) - 1];
    if (!a || !b) return null;
    const through = !group.classList.contains("is-next");
    const label = figure.querySelector(`.globe-path-label[data-way="${n}"]`);
    const stops = (group.dataset.stops || "").split(" ").filter(Boolean).map(Number);
    return {
      a,
      b,
      from: a.n,
      to: b.n,
      through,
      stops,
      rEnd: b.r,
      line: group.querySelector(".globe-path-line"),
      back: svg.querySelector(`.globe-back > .globe-path[data-way="${n}"] .globe-path-line`),
      head: group.querySelector(".globe-path-head"),
      dots: [...group.querySelectorAll(".globe-path-stop")],
      // Its name, kept beside its middle as a scale's name is beside its dot (through the
      // middle: beside the middle of its outer half, under it, as the diagram's are).
      item: label ? { n: `w${n}`, r: through ? b.r / 2 : (a.r + b.r) / 2, label, under: through } : null,
    };
  }).filter(Boolean);
  // A dot a way through the middle runs out to has no dotted line of its own from the middle:
  // the way is it.
  for (const way of ways) if (way.through) way.b.rayless = true;
  const CLEAR = 8;  // how far its ends stay from the dots, in the drawing's units...
  const HEAD = 8;   // ...how long its head is...
  const WING = 3.2; // ...and half as wide
  const fadeAt = (z, r) => (0.3 + 0.7 * depth(z, r)).toFixed(2);

  // Draws a way as the globe stands, and returns the steps its ends leave its two dots by
  // (avoid, by orbit number, so their names keep off it; none while it's too short to draw)
  // and where its name would sit (spot, for settle): beside its middle, off to the side of it,
  // the side away from the globe's middle.
  const unit = (u, v) => {
    const l = Math.hypot(v[0] - u[0], v[1] - u[1]);
    return l < 0.01 ? null : [(v[0] - u[0]) / l, (v[1] - u[1]) / l];
  };
  function drawWay(way) {
    const v = turn(way.b.point, way.b);
    const u = way.through ? v.map((c) => -c) : turn(way.a.point, way.a);
    const at = (t) => [0, 1, 2].map((k) => u[k] + (v[k] - u[k]) * t);
    const p = STEPS.map((t) => look(at(t)));
    const gap = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]);
    let i = 0;
    // Through the middle, it starts at the rim, where there's no dot to keep clear of.
    while (!way.through && i < p.length - 1 && gap(p[i], p[0]) < CLEAR) i++;
    let j = p.length - 1;
    while (j > i && gap(p[j], p[p.length - 1]) < CLEAR) j--;
    const avoid = {};
    let spot = null;
    // Seen end on, too short to draw: only the dots of the scales show.
    if (j - i < 3 || gap(p[i], p[j]) < CLEAR + HEAD) {
      way.line.setAttribute("d", "");
      if (way.back) way.back.setAttribute("d", "");
      way.head.setAttribute("d", "");
      if (way.item) way.item.label.style.visibility = "hidden";
    } else {
      // Each end's step out, taken a little way along, so a bend at the dot doesn't sway it.
      const out = (from, step) => {
        let k = from;
        while (k + step >= 0 && k + step < p.length && gap(p[k], p[from]) < 24) k += step;
        return unit(p[from], p[k]);
      };
      if (!way.through) avoid[way.from] = out(0, 1);
      avoid[way.to] = out(p.length - 1, -1);
      if (way.item) {
        const mid = way.through ? Math.round((p.length - 1) * 0.75) : Math.floor(p.length / 2);
        let t = unit(p[mid - 3], p[mid + 3]);
        const r = unit([CX, CY], p[mid]);
        if (t && r && t[0] * r[0] + t[1] * r[1] < 0) t = [-t[0], -t[1]];
        spot = place(way.item, p[mid], t);
      }
      const q = p.slice(i, j + 1);
      const tip = q[q.length - 1];
      const from = q[Math.max(0, q.length - 4)];
      const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
      const dx = (tip[0] - from[0]) / len;
      const dy = (tip[1] - from[1]) / len;
      const base = [tip[0] - dx * HEAD, tip[1] - dy * HEAD];
      q[q.length - 1] = [base[0] + dx, base[1] + dy, tip[2]];  // under the head, not past its point
      const [near, far] = split(q, false);
      way.line.setAttribute("d", near);
      if (way.back) way.back.setAttribute("d", far);
      way.head.setAttribute("d", `M${pt(tip)}L${f(base[0] - dy * WING)} ${f(base[1] + dx * WING)}` +
        `L${f(base[0] + dy * WING)} ${f(base[1] - dx * WING)}Z`);
      way.head.style.opacity = fadeAt(tip[2], way.rEnd);
    }
    way.stops.forEach((t, k) => {
      const d = way.dots[k];
      if (!d) return;
      const s = at(t);
      const w = look(s);
      d.setAttribute("cx", f(w[0]));
      d.setAttribute("cy", f(w[1]));
      d.style.opacity = fadeAt(w[2], Math.hypot(...s));
    });
    return { avoid, spot };
  }

  // A name beside its dot, outward from the middle: the way out (ux, uy) as a unit step, and
  // which side or corner of the name meets the dot (ax, ay, from -1 to 1), which style.css
  // turns into where it sits. Given a line leaving the dot (avoid, a unit step in the
  // drawing: Light Life's way), a name that would lie along it turns off to the side of it it
  // was nearer, and stays on that side until it's clearly nearer the other (it.side); a way's
  // name through the middle (it.under) takes the side under its line, so EXPERIENCE and AI
  // sit as each other's mirror. Returns where it would sit, for keeping names apart (settle).
  function place(it, p, avoid) {
    const el = it.label;
    let ux = p[0] - CX;
    let uy = p[1] - CY;
    const len = Math.hypot(ux, uy);
    if (len < 0.01) {
      ux = 1;
      uy = 0;
    } else {
      ux /= len;
      uy /= len;
    }
    if (avoid) {
      const along = ux * avoid[0] + uy * avoid[1];
      const across = ux * -avoid[1] + uy * avoid[0];
      if (it.under) {
        if (!it.side || avoid[0] * it.side < -0.25) it.side = avoid[0] < 0 ? -1 : 1;
      } else if (!it.side || across * it.side < -0.25) {
        it.side = across < 0 ? -1 : 1;
      }
      const w = smooth((along - 0.2) / 0.5);  // how far round to the side
      if (w > 0) {
        const sx = -avoid[1] * it.side;
        const sy = avoid[0] * it.side;
        ux = ux * (1 - w) + sx * w;
        uy = uy * (1 - w) + sy * w;
        const l = Math.hypot(ux, uy) || 1;
        ux /= l;
        uy /= l;
      }
    }
    const m = Math.max(Math.abs(ux), Math.abs(uy));
    const ax = ux / m;
    const ay = uy / m;
    const s = el.style;
    s.left = `${((100 * p[0]) / box.width).toFixed(2)}%`;
    s.top = `${((100 * p[1]) / box.height).toFixed(2)}%`;
    s.setProperty("--ux", ux.toFixed(3));
    s.setProperty("--uy", uy.toFixed(3));
    s.setProperty("--ax", ax.toFixed(3));
    s.setProperty("--ay", ay.toFixed(3));
    const near = depth(p[2], it.r);
    s.zIndex = String(Math.round(10 + 10 * near));
    const align = ax < -0.4 ? "end" : ax > 0.4 ? "start" : "center";
    if (el.dataset.align !== align) el.dataset.align = align;
    // Kept inside the drawing's frame: a name that would run past its side moves in.
    const k = figure.clientWidth / box.width;
    const want = p[0] * k + ((ax - 1) / 2) * el.wordW + ux * gapPx;
    const left = Math.min(Math.max(want, -bounds.pad), figure.clientWidth + bounds.pad - el.wordW);
    s.setProperty("--shift", `${(left - want).toFixed(1)}px`);
    const top = p[1] * k + ((ay - 1) / 2) * el.wordH + uy * gapPx;
    return { it, near, box: { left, top, right: left + el.wordW, bottom: top + el.wordH } };
  }

  // Two names that would land on one another: one stays, and the other fades out as they come
  // within ROOM of each other, gone before they touch, and back in once there's room for it
  // again; none goes over the words under the globe. Which stays: a lit one, else the one
  // showing (so two passing don't swap back and forth), else the nearer. (Since 2026-11-25
  // evening, the user's ask: "the names mustn't overlap"; until then the other faded out over
  // about a quarter second after they met, and with the faster turning the two passed over
  // each other meanwhile.) Sizes measured once, and again when the drawing resizes.
  // The word by the middle (Living, since 2026-11-25) stands still, so it's kept clear as the
  // words under the globe are.
  let gapPx = 10;
  const bounds = { pad: 0, fixed: [] };
  const fixedWords = [".orbit-center", ".orbit-label.is-middle"]
    .map((sel) => figure.querySelector(sel))
    .filter(Boolean);
  function measure() {
    const fig = figure.getBoundingClientRect();
    bounds.pad = parseFloat(getComputedStyle(figure.parentElement).paddingLeft) || 0;
    bounds.fixed = fixedWords.map((el) => {
      const u = el.getBoundingClientRect();
      return { left: u.left - fig.left, top: u.top - fig.top, right: u.right - fig.left, bottom: u.bottom - fig.top };
    });
    for (const it of [...orbits, ...ways.map((way) => way.item)]) {
      if (!it || !it.label) continue;
      it.label.wordW = it.label.offsetWidth;
      it.label.wordH = it.label.offsetHeight;
    }
    const first = orbits.find((it) => it.label);
    if (first) gapPx = parseFloat(getComputedStyle(first.label).getPropertyValue("--gap")) || 10;
  }
  const ROOM = 12;  // px
  // How far apart two boxes are, in px (below 0, how far into each other).
  const apart = (a, b) => {
    const dx = Math.max(a.left - b.right, b.left - a.right);
    const dy = Math.max(a.top - b.bottom, b.top - a.bottom);
    return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  };
  function settle(spots, snap) {
    const kept = [...bounds.fixed];
    spots.forEach((s, i) => (s.i = i));
    const showing = (it) => (it.clear === undefined ? 1 : it.clear);
    spots.sort((a, b) => isLit(b.it) - isLit(a.it) || showing(b.it) - showing(a.it) ||
      b.near - a.near || a.i - b.i);
    for (const { it, near, box: b } of spots) {
      let room = 1;
      for (const o of kept) room = Math.min(room, smooth(apart(b, o) / ROOM));
      // Out as fast as the room goes, so never over another; back in over a moment.
      const was = showing(it);
      it.clear = snap ? room : Math.min(room, was + (1 - was) * 0.12);
      if (it.clear > 0.01) kept.push(b);
      const shown = (isLit(it) ? 1 : BEHIND + (1 - BEHIND) * near) * it.clear;
      it.label.style.setProperty("--near", shown.toFixed(2));
      it.label.style.visibility = shown < 0.02 ? "hidden" : "";
    }
  }

  function draw(snap = still.matches) {
    for (const it of orbits) spin(it);
    const spots = [];
    const avoid = {};
    for (const way of ways) {
      const drawn = drawWay(way);
      Object.assign(avoid, drawn.avoid);
      if (drawn.spot) spots.push(drawn.spot);
    }
    for (const it of orbits) {
      const [near, far] = trace(it.ring, true, it);
      it.line.setAttribute("d", near);
      if (it.back) it.back.setAttribute("d", far);
      const p = view(it.point, it);
      const fade = fadeAt(p[2], it.r);
      it.dot.setAttribute("cx", f(p[0]));
      it.dot.setAttribute("cy", f(p[1]));
      it.dot.style.opacity = fade;
      it.ray.setAttribute("d", it.rayless ? "" : `M${CX} ${CY}L${pt(p)}`);
      it.ray.style.opacity = fade;
      if (it.label) spots.push(place(it, p, avoid[it.n]));
    }
    settle(spots, snap);
  }

  // What's lit: the parts of the drawing under the pointer (a name on the globe, or a part or
  // line of the key, its data-lit: "view", the middle, or orbits by number), else the ones
  // clicked or tapped. Lit by hand, the globe holds still and the rest goes faint (style.css,
  // data-focus); in the key, what lights none of it goes faint too.
  const sheet = figure.closest(".orbits") || figure.parentElement;
  const key = sheet.querySelector(".globe-key");
  const keyed = key ? [...key.querySelectorAll("[data-lit]")] : [];
  let hovered = null;  // a data-lit value, or null
  let pinned = null;
  let lit = null;      // what's lit, as a Set of its parts, or null
  const isLit = (it) => (lit && lit.has(String(it.n)) ? 1 : 0);
  function choose() {
    const byHand = hovered ?? pinned;
    hold = byHand !== null;
    if ((lit ? [...lit].join(" ") : null) === byHand) return;
    lit = byHand === null ? null : new Set(byHand.split(" "));
    if (lit) sheet.dataset.focus = byHand;
    else delete sheet.dataset.focus;
    // A part of the key stays while it draws any of what's lit, a line only while it draws
    // all of it.
    for (const el of keyed) {
      const own = el.dataset.lit.split(" ");
      const line = el.classList.contains("globe-key-line");  // a sentence, or a box's cell
      const on = !lit || (line ? own.every((t) => lit.has(t)) : own.some((t) => lit.has(t)));
      el.classList.toggle("is-dim", !on);
    }
  }

  // Turning: at its own pace, slowing to a stop under the pointer, or by hand.
  let speed = 0;
  let last = 0;
  let raf = 0;
  let onScreen = false;
  let hold = false;
  let drag = null;

  function frame(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!still.matches) {
      if (drag) {
        speed = 0;
      } else {
        speed += ((hold ? 0 : SPIN) - speed) * (1 - Math.exp(-dt / (hold ? 0.3 : 1.5)));
        theta += speed * dt;
      }
    }
    draw();
    raf = 0;
    if (onScreen && !document.hidden && (!still.matches || drag)) {
      raf = requestAnimationFrame(frame);
    }
  }

  function kick() {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  // Over a name: choose it while the pointer's there.
  figure.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || (drag && drag.moved)) return;
    const word = e.target.closest(".orbit-label");
    if (!word) return;
    hovered = word.dataset.lit || word.dataset.orbit;
    choose();
    kick();
  });
  figure.addEventListener("pointerout", (e) => {
    const word = e.target.closest(".orbit-label");
    if (!word || word.contains(e.relatedTarget)) return;
    hovered = null;
    choose();
    kick();
  });

  // A drag across it turns it on or back by hand: the front of Space's great circle, on the
  // right, goes the way the pointer does (its own way round is to the left), the rest as
  // they turn. A press that doesn't
  // move is a click or tap: on a name it lights that scale (again, lets it go), elsewhere it
  // lets what's lit go.
  figure.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const word = e.target.closest(".orbit-label");
    drag = { id: e.pointerId, x: e.clientX, from: e.clientX, t: e.timeStamp, v: 0, moved: false,
             on: word ? word.dataset.lit || word.dataset.orbit : null };
  });
  figure.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.from) < 5) return;
      drag.moved = true;
      figure.setPointerCapture(e.pointerId);
      figure.classList.add("is-dragging");
    }
    const d = -(e.clientX - drag.x) / ((R * figure.clientWidth) / box.width);
    const dt = Math.max((e.timeStamp - drag.t) / 1000, 1 / 120);
    theta += d;
    drag.v = drag.v * 0.5 + (d / dt) * 0.5;
    drag.x = e.clientX;
    drag.t = e.timeStamp;
    kick();
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      // Thrown, it keeps going that way; held still before letting go, it starts from rest.
      speed = e.timeStamp - drag.t < 80 ? Math.max(-4, Math.min(4, drag.v)) : 0;
    } else if (e.type === "pointerup") {
      pinned = drag.on !== null && drag.on !== pinned ? drag.on : null;
      choose();
    }
    drag = null;
    figure.classList.remove("is-dragging");
    kick();
  };
  figure.addEventListener("pointerup", release);
  figure.addEventListener("pointercancel", release);

  // The key: a part or line of it under the mouse lights its part of the drawing; a click or
  // tap keeps it lit (again, lets it go).
  if (key) {
    key.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse") return;
      const el = e.target.closest("[data-lit]");
      hovered = el ? el.dataset.lit : null;
      choose();
      kick();
    });
    key.addEventListener("pointerleave", () => {
      hovered = null;
      choose();
      kick();
    });
    key.addEventListener("click", (e) => {
      const el = e.target.closest("[data-lit]");
      if (!el) return;
      pinned = el.dataset.lit === pinned ? null : el.dataset.lit;
      choose();
      kick();
    });
  }

  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) kick();
  }).observe(figure);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && onScreen) kick();
  });
  still.addEventListener("change", () => kick());
  new ResizeObserver(() => {
    measure();
    draw(true);
  }).observe(figure);
  document.fonts.ready.then(() => {
    measure();
    draw(true);
  });

  measure();
  draw(true);
})();
