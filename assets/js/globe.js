// About's drawing of the user as a designer, a globe that turns (ABOUT_GLOBE in build.py, since
// 2026-11-24, the user's ask, from an orbit diagram turning in 3D on their Pinterest; build.py's
// globe says what's on it): a sphere in a globe's lines, the scales they design at as orbits
// round what their work is about, each tilted its own way, the globe turning slowly round its
// upright axis while its lean toward you rises and falls a little, so the orbits open and close
// as they go round. build.py writes the still parts (the rim, the axes, the middle) and the
// words; this draws the rest as the globe stands each moment: the globe's lines on its near
// side, each orbit (its far half faint, under the globe's lines), its dot, the dotted line out
// to it, and its name beside the dot, outward from the middle, faint while round the back;
// and the user's work going across the scales (since 2026-11-24 night, build.py's globe_ways),
// an arrow each from one scale's dot to another's, its name by it: Light Life, Object to
// Screen; the Clayco rebrand, Space to Page. Beside the globe (under it on narrow screens) its
// key says what it means (build.py's globe_key): the fields (the solid orbits), connecting
// them (the ways), AI in the process, and the goal (the dashed orbit). A part of the key, or a
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
  // round the upright one; and where its dot sits, round it (all in degrees). Object and Page
  // lie on the equator, one in the other; Screen and Space tilt across them, opposite ways;
  // Space, the widest, goes round the globe itself. The dots are spread so their names keep
  // apart as the globe turns.
  const ORBITS = [
    { r: 0.42, tilt: 0, turn: 0, dot: 200 },
    { r: 0.66, tilt: 0, turn: 0, dot: 20 },
    { r: 0.86, tilt: 58, turn: 25, dot: 125 },
    { r: 1, tilt: -46, turn: -30, dot: 290 },
  ];
  const SPIN = (2 * Math.PI) / 60;  // its own pace: a turn a minute
  const PITCH = 20;                 // how far it leans toward you, in degrees...
  const SWAY = 8;                   // ...rising and falling this much either way...
  const SWAY_TIME = 41;             // ...over this many seconds
  const REST = 30 * DEG;            // where it starts, and stands with reduced motion
  const BEHIND = 0.65;              // how strongly a name shows while its dot is round the back
                                    // (ink at this is about 5.5:1 on the paper, still easy to read)

  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const f = (v) => v.toFixed(1);
  const pt = (p) => `${f(p[0])} ${f(p[1])}`;
  const smooth = (t) => {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
  };

  let theta = REST;       // its turn
  let phi = PITCH * DEG;  // its lean
  let cT, sT, cP, sP;

  // A point on the globe (x right, y up, z toward you, the globe's radius 1) as it stands now:
  // where it is in the drawing, and how near (z, the near side above 0).
  const view = ([x, y, z]) => {
    const x1 = x * cT + z * sT;
    const z1 = -x * sT + z * cT;
    return [CX + R * x1, CY - R * (y * cP - z1 * sP), y * sP + z1 * cP];
  };

  // A line through points on the globe as two paths, its near part and its far part, split
  // where it goes round the edge.
  function trace(points, closed) {
    return split(points.map(view), closed);
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

  // The globe's lines: a meridian every 30 degrees and the parallels between them.
  const grid = [];
  for (let lon = 0; lon < 180; lon += 30) {
    const line = [];
    for (let d = 0; d <= 360; d += 5) {
      const c = Math.cos(d * DEG);
      line.push([c * Math.cos(lon * DEG), Math.sin(d * DEG), c * Math.sin(lon * DEG)]);
    }
    grid.push(line);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const c = Math.cos(lat * DEG);
    const line = [];
    for (let d = 0; d <= 360; d += 5) {
      line.push([Math.cos(d * DEG) * c, Math.sin(lat * DEG), Math.sin(d * DEG) * c]);
    }
    grid.push(line);
  }
  const gridPath = svg.querySelector(".globe-lines");

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
    const ring = [];
    for (let d = 0; d < 360; d += 2.5) ring.push(at(d));
    // Dashed (Space, the one not reached): each dash a short stretch of the orbit itself, so
    // the dashes go round with it, shortening toward the edge as the orbit does.
    const dashes = g.classList.contains("is-dashed")
      ? Array.from({ length: 120 }, (_, k) => [at(k * 3), at(k * 3 + 0.85), at(k * 3 + 1.7)])
      : null;
    return {
      n: i + 1,
      r: o.r,
      point: at(o.dot),
      line: g.querySelector(".orbit-line"),
      back: backs[i] && backs[i].querySelector(".orbit-line"),
      ray: g.querySelector(".orbit-ray"),
      dot: g.querySelector(".orbit-dot"),
      label: figure.querySelector(`.orbit-label[data-orbit="${i + 1}"]`),
      ring,
      dashes,
    };
  });

  // The ways (build.py's globe_ways, a group each: data-from and data-to, the orbits it goes
  // from and to, by number; data-stops, where each year between falls along it, 0 to 1): from
  // the first's dot to the second's, turning round the middle as it widens or narrows from one
  // orbit's size to the other's, so it reads as a move, not a cut across. It starts a little
  // clear of its first dot, its head stops a little short of its last; a dot for each year
  // between.
  const ways = [...svg.querySelectorAll(".globe-front > .globe-path")].map((group) => {
    const n = group.dataset.way;
    const a = orbits[Number(group.dataset.from) - 1];
    const b = orbits[Number(group.dataset.to) - 1];
    if (!a || !b) return null;
    const label = figure.querySelector(`.globe-path-label[data-way="${n}"]`);
    const ua = a.point.map((v) => v / a.r);
    const ub = b.point.map((v) => v / b.r);
    const cos = Math.min(Math.max(ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2], -1), 1);
    const omega = Math.acos(cos);
    const at = (t) => {
      const s = Math.sin(omega);
      const wa = s < 0.01 ? 1 - t : Math.sin((1 - t) * omega) / s;
      const wb = s < 0.01 ? t : Math.sin(t * omega) / s;
      const r = a.r + (b.r - a.r) * t;
      return [0, 1, 2].map((k) => (wa * ua[k] + wb * ub[k]) * r);
    };
    const samples = Array.from({ length: 65 }, (_, i) => at(i / 64));
    const stops = (group.dataset.stops || "").split(" ").filter(Boolean).map(Number);
    return {
      from: a.n,
      to: b.n,
      samples,
      stops: stops.map(at),
      rEnd: b.r,
      line: group.querySelector(".globe-path-line"),
      back: svg.querySelector(`.globe-back > .globe-path[data-way="${n}"] .globe-path-line`),
      head: group.querySelector(".globe-path-head"),
      dots: [...group.querySelectorAll(".globe-path-stop")],
      // Its name, kept beside its middle as a scale's name is beside its dot.
      item: label ? { n: `w${n}`, r: (a.r + b.r) / 2, label } : null,
    };
  }).filter(Boolean);
  const CLEAR = 8;  // how far its ends stay from the dots, in the drawing's units...
  const HEAD = 8;   // ...how long its head is...
  const WING = 3.2; // ...and half as wide
  const fadeAt = (z, r) => (0.3 + 0.7 * smooth((z / r + 0.2) / 0.4)).toFixed(2);

  // Draws a way as the globe stands, and returns the steps its ends leave its two dots by
  // (avoid, by orbit number, so their names keep off it; none while it's too short to draw)
  // and where its name would sit (spot, for settle): beside its middle, off to the side of it,
  // the side away from the globe's middle.
  const unit = (u, v) => {
    const l = Math.hypot(v[0] - u[0], v[1] - u[1]);
    return l < 0.01 ? null : [(v[0] - u[0]) / l, (v[1] - u[1]) / l];
  };
  function drawWay(way) {
    const p = way.samples.map(view);
    const gap = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]);
    let i = 0;
    while (i < p.length - 1 && gap(p[i], p[0]) < CLEAR) i++;
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
      avoid[way.from] = out(0, 1);
      avoid[way.to] = out(p.length - 1, -1);
      if (way.item) {
        const mid = Math.floor(p.length / 2);
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
    way.stops.forEach((s, k) => {
      const d = way.dots[k];
      if (!d) return;
      const v = view(s);
      d.setAttribute("cx", f(v[0]));
      d.setAttribute("cy", f(v[1]));
      d.style.opacity = fadeAt(v[2], Math.hypot(...s));
    });
    return { avoid, spot };
  }

  // A name beside its dot, outward from the middle: the way out (ux, uy) as a unit step, and
  // which side or corner of the name meets the dot (ax, ay, from -1 to 1), which style.css
  // turns into where it sits. Given a line leaving the dot (avoid, a unit step in the
  // drawing: Light Life's way), a name that would lie along it turns off to the side of it it
  // was nearer, and stays on that side until it's clearly nearer the other (it.side). Returns
  // where it would sit, for keeping names apart (settle).
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
      if (!it.side || across * it.side < -0.25) it.side = across < 0 ? -1 : 1;
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
    const near = smooth((p[2] / it.r + 0.2) / 0.4);
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

  // Two names that would land on one another: the nearer stays, and the other fades out until
  // there's room for it again; none goes over the words under the globe. Sizes measured once,
  // and again when the drawing resizes.
  let gapPx = 10;
  const bounds = { pad: 0, under: null };
  const under = figure.querySelector(".orbit-center");
  function measure() {
    const fig = figure.getBoundingClientRect();
    bounds.pad = parseFloat(getComputedStyle(figure.parentElement).paddingLeft) || 0;
    if (under) {
      const u = under.getBoundingClientRect();
      bounds.under = { left: u.left - fig.left, top: u.top - fig.top, right: u.right - fig.left, bottom: u.bottom - fig.top };
    }
    for (const it of [...orbits, ...ways.map((way) => way.item)]) {
      if (!it || !it.label) continue;
      it.label.wordW = it.label.offsetWidth;
      it.label.wordH = it.label.offsetHeight;
    }
    const first = orbits.find((it) => it.label);
    if (first) gapPx = parseFloat(getComputedStyle(first.label).getPropertyValue("--gap")) || 10;
  }
  function settle(spots, snap) {
    const kept = bounds.under ? [bounds.under] : [];
    spots.sort((a, b) => isLit(b.it) - isLit(a.it) || b.near - a.near);
    for (const { it, near, box: b } of spots) {
      const hit = kept.some((o) => b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top);
      if (!hit) kept.push(b);
      const clear = hit ? 0 : 1;
      it.clear = snap || it.clear === undefined ? clear : it.clear + (clear - it.clear) * 0.12;
      const shown = (isLit(it) ? 1 : BEHIND + (1 - BEHIND) * near) * it.clear;
      it.label.style.setProperty("--near", shown.toFixed(2));
      it.label.style.visibility = shown < 0.02 ? "hidden" : "";
    }
  }

  function draw(snap = still.matches) {
    cT = Math.cos(theta);
    sT = Math.sin(theta);
    cP = Math.cos(phi);
    sP = Math.sin(phi);
    if (gridPath) gridPath.setAttribute("d", grid.map((line) => trace(line, false)[0]).join(""));
    const spots = [];
    const avoid = {};
    for (const way of ways) {
      const drawn = drawWay(way);
      Object.assign(avoid, drawn.avoid);
      if (drawn.spot) spots.push(drawn.spot);
    }
    for (const it of orbits) {
      let near = "";
      let far = "";
      if (it.dashes) {
        for (const dash of it.dashes) {
          const [a, m, b] = dash.map(view);
          const d = `M${pt(a)}L${pt(m)}L${pt(b)}`;
          if (m[2] >= 0) near += d;
          else far += d;
        }
      } else {
        [near, far] = trace(it.ring, true);
      }
      it.line.setAttribute("d", near);
      if (it.back) it.back.setAttribute("d", far);
      const p = view(it.point);
      const fade = (0.3 + 0.7 * smooth((p[2] / it.r + 0.2) / 0.4)).toFixed(2);
      it.dot.setAttribute("cx", f(p[0]));
      it.dot.setAttribute("cy", f(p[1]));
      it.dot.style.opacity = fade;
      it.ray.setAttribute("d", `M${CX} ${CY}L${pt(p)}`);
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
      const on = !lit || (el.tagName === "LI" ? own.every((t) => lit.has(t)) : own.some((t) => lit.has(t)));
      el.classList.toggle("is-dim", !on);
    }
  }

  // Turning: at its own pace, slowing to a stop under the pointer, or by hand.
  let speed = 0;
  let clock = 0;
  let last = 0;
  let raf = 0;
  let onScreen = false;
  let hold = false;
  let drag = null;

  function frame(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!still.matches) {
      if (!hold) clock += dt;  // held, its lean stays too
      phi = (PITCH + SWAY * Math.sin((2 * Math.PI * clock) / SWAY_TIME)) * DEG;
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

  // A drag across it: a point in front of the globe follows the pointer. A press that doesn't
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
    const d = (e.clientX - drag.x) / ((R * figure.clientWidth) / box.width);
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
  still.addEventListener("change", () => {
    phi = PITCH * DEG;
    kick();
  });
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
