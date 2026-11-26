// Shows one figure (#fig1 ... #fig5), draws its construction lines and callouts, and notes its
// height on <body data-h> for make.py's screenshot.
//   [data-frame]  its top and bottom edges run on across the sheet as construction lines, its
//                 sides down its band (.band, else the sheet); a + in ink at each corner.
//   .bub          a callout on an image (data-on: the image's id, data-x / data-y: the point, in
//                 percent of it; data-side: top, bottom, left or right; data-gap: how far out),
//                 a leader from it to a dot on the point.
const NS = "http://www.w3.org/2000/svg";
const INK = "#161616", TRACE = "rgba(22,22,22,0.24)", HAIR = 1.1;

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

function draw(fig) {
  const box = fig.getBoundingClientRect();
  const W = box.width, H = box.height;
  const under = el("svg", { class: "under", viewBox: `0 0 ${W} ${H}` }, fig);
  const over = el("svg", { class: "over", viewBox: `0 0 ${W} ${H}` }, fig);
  const seen = new Set();
  const line = (x1, y1, x2, y2, svg, color) => {
    const key = [x1, y1, x2, y2].map((n) => Math.round(n)).join();
    if (seen.has(key)) return;
    seen.add(key);
    el("line", { x1, y1, x2, y2, stroke: color, "stroke-width": HAIR }, svg);
  };
  const plus = (x, y) => {
    line(x - 6, y, x + 6, y, over, INK);
    line(x, y - 6, x, y + 6, over, INK);
  };
  fig.querySelectorAll("[data-frame]").forEach((f) => {
    const r = f.getBoundingClientRect();
    const x1 = r.left - box.left, x2 = r.right - box.left;
    const y1 = r.top - box.top, y2 = r.bottom - box.top;
    const band = (f.closest(".band") || fig).getBoundingClientRect();
    const b1 = Math.max(0, band.top - box.top - 14), b2 = Math.min(H, band.bottom - box.top + 14);
    for (const y of [y1, y2]) line(0, y, W, y, under, TRACE);
    for (const x of [x1, x2]) line(x, b1, x, b2, under, TRACE);
    for (const x of [x1, x2]) for (const y of [y1, y2]) plus(x, y);
  });
  // [data-marks]: a + at each corner, no lines (the moodboard's prints)
  fig.querySelectorAll("[data-marks]").forEach((f) => {
    const r = f.getBoundingClientRect();
    for (const x of [r.left - box.left, r.right - box.left])
      for (const y of [r.top - box.top, r.bottom - box.top]) plus(x, y);
  });
  fig.querySelectorAll(".bub").forEach((b) => {
    const t = document.getElementById(b.dataset.on).getBoundingClientRect();
    const px = t.left - box.left + (t.width * b.dataset.x) / 100;
    const py = t.top - box.top + (t.height * b.dataset.y) / 100;
    const gap = Number(b.dataset.gap || 0);
    const side = b.dataset.side;
    let bx = px, by = py;
    if (side === "top") by = t.top - box.top - gap;
    if (side === "bottom") by = t.bottom - box.top + gap;
    if (side === "left") bx = t.left - box.left - gap;
    if (side === "right") bx = t.right - box.left + gap;
    if (side === "at") {  // where data-bx / data-by say, in percent of the image
      bx = t.left - box.left + (t.width * b.dataset.bx) / 100;
      by = t.top - box.top + (t.height * b.dataset.by) / 100;
    }
    b.style.left = `${bx}px`;
    b.style.top = `${by}px`;
    let ex = px, ey = py;
    if (b.dataset.box) {  // a dashed box round what it marks (w, h in percent of the image), the leader to its edge
      const [bw, bh] = b.dataset.box.split(",").map(Number);
      const w = (t.width * bw) / 100 + 10, h = (t.height * bh) / 100 + 10;
      el("rect", { x: px - w / 2, y: py - h / 2, width: w, height: h, fill: "none", stroke: INK, "stroke-width": HAIR, "stroke-dasharray": "4 3" }, over);
      if (side === "top") ey = py - h / 2;
      if (side === "bottom") ey = py + h / 2;
      if (side === "left") ex = px - w / 2;
      if (side === "right") ex = px + w / 2;
    }
    const d = Math.hypot(ex - bx, ey - by) || 1;
    const sx = bx + ((ex - bx) / d) * 15, sy = by + ((ey - by) / d) * 15;
    el("line", { x1: sx, y1: sy, x2: ex, y2: ey, stroke: INK, "stroke-width": HAIR }, over);
    if (!b.dataset.box) {
      el("circle", { cx: px, cy: py, r: 3.2, fill: INK }, over);
      el("circle", { cx: px, cy: py, r: 7, fill: "none", stroke: INK, "stroke-width": HAIR }, over);
    }
    if (b.dataset.note) {  // the callout's words beside it
      const n = document.createElement("span");
      n.className = "bnote";
      n.textContent = b.dataset.note;
      n.style.left = `${bx - 15}px`;  // under the callout, from its left edge
      n.style.top = `${by + 24}px`;
      fig.appendChild(n);
    }
  });
}

const id = location.hash.slice(1) || "fig1";
document.querySelectorAll(".fig").forEach((f) => f.classList.toggle("on", f.id === id));
const fig = document.getElementById(id);
const loaded = (i) => (i.complete ? Promise.resolve() : new Promise((go) => { i.onload = i.onerror = go; }));
Promise.all([document.fonts.ready, ...[...fig.querySelectorAll("img")].map(loaded)]).then(() => {
  draw(fig);
  document.body.dataset.h = Math.ceil(fig.getBoundingClientRect().height);
});
