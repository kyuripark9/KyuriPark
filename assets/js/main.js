// Enhancements on top of pages that already work without JavaScript:
// Work's filter and card videos, the lightbox, display type (About's first sentence, project
// titles, the 404's) breaking into dots under the pointer, and project-page motion (image
// fade-up, count-up numbers, looping videos). The home track is in track.js.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)");

  // Work: All or one category at a time, on one grid. The tiles fade out, the filter's tiles
  // come on, and they fade in. The address says which (#all, #digital, ...),
  // so a link opens that filter, Back and Forward step through the ones picked, and Back from
  // a project page returns to the same one.
  const workTabs = [...document.querySelectorAll(".work-tab")];
  if (workTabs.length) {
    const FADE_OUT = 150;  // ms
    const FADE_IN = 250;   // ms
    const panel = document.getElementById("work-panel");
    const tiles = [...panel.querySelectorAll(".work-grid > li")];
    const empty = panel.querySelector(".work-empty");
    const filters = workTabs.map((tab) => tab.dataset.filter);
    let shown;           // the filter on screen
    let wanted;          // the filter picked last (it's on screen once a fade-out ends)
    let fade = null;     // the fade under way
    let fadingOut = false;

    const show = (name) => {
      shown = name;
      let n = 0;
      tiles.forEach((tile) => {
        tile.hidden = name !== "all" && !tile.dataset.categories.split(" ").includes(name);
        if (!tile.hidden) n++;
      });
      empty.hidden = n > 0;
    };
    // The filter picked is in the text color (style.css, aria-pressed).
    const mark = (name) => {
      wanted = name;
      workTabs.forEach((tab) => {
        tab.setAttribute("aria-pressed", String(tab.dataset.filter === name));
      });
    };

    // Picking again while the tiles fade out changes what comes on; while they fade in,
    // they fade out from there.
    const pick = (name) => {
      mark(name);
      if (reduceMotion.matches) {
        fade?.cancel();
        fadingOut = false;
        show(name);
        return;
      }
      if (fadingOut || name === shown) return;
      const from = Number(getComputedStyle(panel).opacity);
      fade?.cancel();
      fadingOut = true;
      fade = panel.animate({ opacity: [from, 0] },
        { duration: FADE_OUT * from, easing: "ease-in", fill: "forwards" });
      fade.onfinish = () => {
        fadingOut = false;
        show(wanted);
        fade.cancel();
        fade = panel.animate({ opacity: [0, 1] }, { duration: FADE_IN, easing: "ease-out" });
      };
    };

    // Filters that were merged into another: an old link to one opens the one it's part of now,
    // and the address is set to say so.
    const MERGED = { visual: "brand" };
    // The filter the address names. No hash or an unknown one means All, and the address is
    // set to say so. A hash for a spot on the page (the skip link's #main) isn't a
    // filter at all: null, and the grid stays as it is.
    const addressFilter = () => {
      const hash = location.hash.slice(1);
      if (filters.includes(hash)) return hash;
      if (filters.includes(MERGED[hash])) {
        history.replaceState(history.state, "", `#${MERGED[hash]}`);
        return MERGED[hash];
      }
      if (document.getElementById(hash)) return null;
      history.replaceState(history.state, "", "#all");
      return "all";
    };
    // A filter only changes the address; that's what switches the grid, so each pick is a step
    // for Back and Forward.
    window.addEventListener("hashchange", () => {
      const name = addressFilter();
      if (name) pick(name);
    });
    workTabs.forEach((tab) => tab.addEventListener("click", () => {
      location.hash = tab.dataset.filter;
    }));

    const start = addressFilter() || "all";
    mark(start);
    show(start);
  }

  // Work tiles: hovering (or focusing) one plays its cover's video, if it has one.
  document.querySelectorAll(".work-media[data-video]").forEach((media) => {
    const card = media.closest(".work-card");
    let video;
    const play = () => {
      if (!fineHover.matches || reduceMotion.matches) return;
      if (!video) {
        video = document.createElement("video");
        video.src = media.dataset.video;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute("muted", "");
        media.appendChild(video);
      }
      media.classList.add("is-playing");
      video.play().catch(() => {});
    };
    const stop = () => {
      if (!video) return;
      media.classList.remove("is-playing");
      video.pause();
    };
    card.addEventListener("mouseenter", play);
    card.addEventListener("mouseleave", stop);
    card.addEventListener("focus", play);
    card.addEventListener("blur", stop);
  });

  // Lightbox: a Work tile with no page of its own, or an Archive image, opens its item's images
  // (copied from the item's <template>, or else the tile's own image at full size) with the
  // item's [data-lightbox-name] and [data-lightbox-meta] text under them. Esc, Close, or a click
  // outside the images and caption closes it, and focus goes back to that tile. Left/right arrow
  // keys and buttons step through the items on screen, looping at the ends.
  const lightbox = document.getElementById("lightbox");
  if (lightbox) {
    document.body.append(lightbox);  // out of <main>, so the rest of the page can go inert
    const stage = lightbox.querySelector(".lightbox-stage");
    const images = lightbox.querySelector(".lightbox-images");
    const name = lightbox.querySelector(".lightbox-name");
    const meta = lightbox.querySelector(".lightbox-meta");
    const closeButton = lightbox.querySelector(".lightbox-close");
    const allThumbs = [...document.querySelectorAll("[data-item]")];  // one per item, in order
    let thumbs = allThumbs;  // the ones on screen when the lightbox opened
    let current = -1;  // the item shown, or -1 when closed
    let hiding;

    // Several images can run taller than the screen; then the stage takes a Tab stop
    // so the keyboard can scroll it.
    const fit = () => {
      stage.tabIndex = stage.scrollHeight > stage.clientHeight ? 0 : -1;
    };
    const show = (index) => {
      current = (index + thumbs.length) % thumbs.length;
      const item = thumbs[current].closest("li");
      const template = item.querySelector("template");
      if (template) {
        images.replaceChildren(template.content.cloneNode(true));
      } else {
        const image = item.querySelector("img").cloneNode();
        ["srcset", "sizes", "loading"].forEach((attr) => image.removeAttribute(attr));
        images.replaceChildren(image);
      }
      const nameSource = item.querySelector("[data-lightbox-name]");
      name.innerHTML = nameSource.innerHTML;
      // A name only for screen readers stays that way, and takes no room in the caption.
      name.classList.toggle("visually-hidden", nameSource.classList.contains("visually-hidden"));
      meta.innerHTML = item.querySelector("[data-lightbox-meta]").innerHTML;
      stage.scrollTop = 0;
      fit();
    };
    const setPageInert = (inert) => {
      for (const el of document.body.children) if (el !== lightbox) el.inert = inert;
      document.documentElement.classList.toggle("lightbox-open", inert);
    };
    const open = (index) => {
      clearTimeout(hiding);
      setPageInert(true);
      lightbox.hidden = false;
      show(index);
      void lightbox.offsetWidth;  // apply the starting opacity first, so the fade runs
      lightbox.classList.add("is-open");
      closeButton.focus();
    };
    const close = () => {
      if (current < 0) return;
      lightbox.classList.remove("is-open");
      setPageInert(false);
      thumbs[current].focus();
      current = -1;
      hiding = setTimeout(() => {
        lightbox.hidden = true;
        images.replaceChildren();
      }, reduceMotion.matches ? 0 : 200);
    };

    allThumbs.forEach((thumb) => thumb.addEventListener("click", (e) => {
      // Archive's tiles are links to the image: with a modifier key they open it as usual.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      thumbs = allThumbs.filter((other) => !other.closest("li").hidden);
      open(thumbs.indexOf(thumb));
    }));
    lightbox.addEventListener("click", (e) => {
      const arrow = e.target.closest(".lightbox-arrow");
      if (arrow) show(current + Number(arrow.dataset.step));
      else if (e.target === closeButton || !e.target.closest("img, .lightbox-caption")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (current < 0) return;
      if (e.key === "Escape") {
        close();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight")
                 && !(e.altKey || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        show(current + (e.key === "ArrowLeft" ? -1 : 1));
      } else if (e.key === "Tab") {
        // Keep focus inside: past the last stop back to the first, and the other way.
        const stops = [...lightbox.querySelectorAll("button, [tabindex='0']")];
        const i = stops.indexOf(document.activeElement);
        if (e.shiftKey ? i <= 0 : i === stops.length - 1) {
          e.preventDefault();
          stops[e.shiftKey ? stops.length - 1 : 0].focus();
        }
      }
    });
    images.addEventListener("load", fit, true);  // sizes are final once each image is in
    window.addEventListener("resize", () => {
      if (current >= 0) fit();
    });
  }

  if (reduceMotion.matches || !("IntersectionObserver" in window)) return;

  // Type in the display style is made of dots, wherever it is: About's first sentence, a
  // project's title, and the 404's (About's only until 2026-11-07). It breaks into dots where
  // the pointer passes, and they drift back (as on soren-template.framer.website). On arriving,
  // a pointer of its own passes once, a stroke from below the left of the letters up to above
  // the right, so the sentence shows what it does before anyone tries, phones too; then it's
  // still. A real pointer coming in takes over from it. (Since 2026-11-07. Before, a few edge dots
  // came loose on their own all the while, hopping out and back each its own way, which read as
  // fleas; for a few hours, edge dots started out of the letters and came in together, which
  // left the letters full of holes.) The sentence stays real text:
  // a canvas over it draws only what has moved, a patch of the background where each loose dot
  // sat in a letter and the dot where it is now. While some of it is selected, everything rests,
  // so no patch cuts into the highlight. It all happens inside its hero (on About, the sentence,
  // the About text under it, and the space over it up to the header; on a project page, the
  // header with the title, statement, and facts; on the 404, the page's main part): the pointer
  // counts over it, and the dots fly as far as its edges. One per page.
  // A calm one (a project page's, since 2026-11-07: there the work is what's to be looked at,
  // not the title) is the same material, quieter: the pointer counts only over the title itself,
  // so reading the statement under it, or reaching for the Visit link, leaves it be.
  // A waiting one (Home's opening, 2026-11-09 to 2026-11-10; none since) passes only when told: intro.js sends
  // "dust:pass" to its box (or has set data-cue="pass" on it, should this run later). Once the
  // pass is over and every dot is home, it says "dust:still" to the box, so the opening can go on.
  const dust = (hero, headline, { calm = false, wait = false } = {}) => {
    const CELL = 4;          // px: one dot for each 4 x 4 square of the letters
    const DOT = 0.85;        // a dot's width, in cells
    const COVER = 1.35;      // the patch over a dot's place in a letter, in cells (over 1, so no
                             // sliver of the letter shows between two patches)
    const REACH = 1;         // how far the pointer reaches, in the sentence's font size; each dot
                             // feels it from 0.55 to 1.3 times that, so the hole's edge is ragged
    const PUSH = 0.036;      // how hard it pushes at its middle, per frame, in REACH
    const SPRING = 0.08;     // pull back to its place while the pointer is near, per frame
    const DRAG = 0.88;       // share of a dot's speed it keeps each frame
    const RETURN = 0.11;     // share of the way home a dot goes each frame once the pointer has
                             // moved on (each dot 0.8 to 1.2 times this)
    const SWEEP = 4;         // a fast pass pushes up to 1 + SWEEP times harder (each dot 0.5 to
                             // 1.5 times that), since it's over a dot for a frame or two, not many
    const WAKE = 0.8;        // and carries the dots this much along the way it went
    const PASS_SPEED = 1.2;  // px per ms the pass on arriving goes, on average: fast at first,
                             // slowing to a stop, as a hand does
    const PASS_TIME = 400;   // ms it takes at the least (a short title's pass isn't a flick)
    const PASS_RISE = 0.6;   // how far it starts under the letters and ends over them, in
                             // reaches: across one line it's a slash, the first letters' feet to
                             // the last ones' tops, so the title never goes all at once
    const PASS_BOW = 0.1;    // how far it bows up on its way, in the letters' height (top of the
                             // highest to foot of the lowest)
    const MAX_DOTS = 12000;  // past this the cells grow, so a long sentence stays smooth
    const AROUND = 3;        // the canvas runs this many reaches past the sentence: with the
                             // settings above a fast pass throws a dot 2.3 reaches at most
    const SETTLE = 150;      // ms a resize has to rest before the letters are scanned again

    const canvas = document.createElement("canvas");
    canvas.className = "dust";
    canvas.setAttribute("aria-hidden", "true");
    hero.append(canvas);
    const ctx = canvas.getContext("2d");
    let cell = CELL;
    let reach = 0;
    let dots = [];   // the sentence's dots: their cell's middle (cx, cy), home (hx, hy), where
                     // they are, their speed, and their colors (ink, and paper for the patch)
    let inked = null;  // the box the dots are in: left, top, right, bottom
    const astir = new Set();  // the dots on their way home: with the pointer away, the only
                              // ones a frame has to move
    let arrived = false;  // the pass has been (once a page: not again after a resize)
    let cued = !wait || hero.dataset.cue === "pass";  // the pass may go
    let told = false;     // "dust:still" has been sent
    let pass = null;      // the pass under way: where it starts and ends, and when it started
    const zone = calm ? headline : hero;  // where the pointer counts
    let ready = !document.fonts;  // the sentence's font is in (the letters are scanned only then)
    let shown = false;  // some of the sentence is on screen
    let selected = false;  // some of the sentence is selected
    let drawn = null;      // the part of the canvas the last frame drew on, to clear
    let density = null;    // the screen's pixel density, to draw afresh when it changes
    let built = false;
    let scanned = "";  // the hero's and the sentence's sizes when the letters were last scanned
    let pending = 0;
    const pointer = { clientX: 0, clientY: 0, x: 0, y: 0, sx: 0, sy: 0, px: 0, py: 0,
                      inside: false, fresh: true };
    let frame = 0;
    let last = 0;

    const measure = () => [hero, headline].map((el) => `${el.clientWidth}x${el.clientHeight}`).join();
    const clear = (color) => color === "transparent" || /^rgba\(.*,\s*0\)$|\/\s*0\)$/.test(color);
    // The color behind an element: its own background, or the nearest one under it.
    const backdrop = (el) => {
      for (; el; el = el.parentElement) {
        const color = getComputedStyle(el).backgroundColor;
        if (!clear(color)) return color;
      }
      return "#fff";
    };

    // Draw the letters where the page draws them, one by one, on a hidden canvas, and put a
    // dot on every cell with ink in it.
    const build = () => {
      built = true;
      scanned = measure();
      watchDensity();
      dots = [];
      inked = null;
      astir.clear();
      drawn = null;
      const style = getComputedStyle(headline);
      const size = parseFloat(style.fontSize);
      reach = size * REACH;
      const box = hero.getBoundingClientRect();
      const lines = headline.getBoundingClientRect();
      // The sentence's box (in the hero's px), and around it the canvas, as far as a
      // dot can go.
      const left = Math.max(0, Math.floor(lines.left - box.left) - 4);
      const top = Math.max(0, Math.floor(lines.top - box.top) - 4);
      const right = Math.min(hero.clientWidth, Math.ceil(lines.right - box.left) + 4);
      const bottom = Math.min(hero.clientHeight, Math.ceil(lines.bottom - box.top) + 4);
      const around = reach * AROUND;
      const x0 = Math.max(0, Math.floor(left - around));
      const y0 = Math.max(0, Math.floor(top - around));
      const x1 = Math.max(x0, Math.min(hero.clientWidth, Math.ceil(right + around)));
      const y1 = Math.max(y0, Math.min(hero.clientHeight, Math.ceil(bottom + around)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      Object.assign(canvas.style, { left: `${x0}px`, top: `${y0}px`,
                                    width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      canvas.width = Math.max(1, Math.round((x1 - x0) * dpr));
      canvas.height = Math.max(1, Math.round((y1 - y0) * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);  // drawn in the hero's px
      if (right <= left || bottom <= top) return;

      const span = right - left;
      const mask = document.createElement("canvas");
      mask.width = span;
      mask.height = bottom - top;
      const m = mask.getContext("2d", { willReadFrequently: true });
      m.translate(-left, -top);
      m.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
      m.fillStyle = m.strokeStyle = "#000";
      m.lineWidth = 2;  // a pixel past each edge, so the patches take the letters' soft edges too
      m.lineJoin = "round";  // a pixel at the sharp corners too (A, V, W...), not a mitred spike
      const metrics = m.measureText("H");
      const ascent = metrics.fontBoundingBoxAscent ?? size * 0.97;
      const descent = metrics.fontBoundingBoxDescent ?? size * 0.24;
      const upper = style.textTransform === "uppercase";
      const range = document.createRange();
      const walker = document.createTreeWalker(headline, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // Not text only screen readers get (a link's "opens in a new tab"), or hidden text.
        const parent = node.parentElement;
        if (!parent || parent.closest(".visually-hidden")
            || getComputedStyle(parent).visibility !== "visible") continue;
        const text = node.data;
        for (let i = 0; i < text.length; i++) {
          if (/\s/.test(text[i])) continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getClientRects()[0];
          if (!r) continue;
          const ch = upper ? text[i].toUpperCase() : text[i];
          const x = r.left - box.left;
          const y = r.top - box.top + (r.height - ascent - descent) / 2 + ascent;  // baseline
          m.fillText(ch, x, y);
          m.strokeText(ch, x, y);
        }
      }

      // The colors: the sentence's, and the page's behind it, but for a part of it with its
      // own (a link in another color, a [PLACEHOLDER]'s highlight), kept as the boxes it fills.
      const ink = style.color;
      const paper = backdrop(headline);
      const parts = [];
      for (const el of headline.querySelectorAll("*")) {
        if (el.closest(".visually-hidden")) continue;
        const own = getComputedStyle(el);
        const behind = clear(own.backgroundColor) ? null : own.backgroundColor;
        if (!behind && own.color === getComputedStyle(el.parentElement).color) continue;
        const rects = [...el.getClientRects()].map((r) => [r.left - box.left, r.top - box.top,
                                                            r.right - box.left, r.bottom - box.top]);
        parts.push({ rects, ink: own.color, paper: behind });
      }

      const data = m.getImageData(0, 0, span, bottom - top).data;
      // The cells with ink, as their column and row.
      const sample = (step) => {
        const found = [];
        for (let y0 = top - (top % step); y0 < bottom; y0 += step) {
          for (let x0 = left - (left % step); x0 < right; x0 += step) {
            scan: for (let y = Math.max(y0, top); y < Math.min(y0 + step, bottom); y++) {
              for (let x = Math.max(x0, left); x < Math.min(x0 + step, right); x++) {
                if (data[((y - top) * span + (x - left)) * 4 + 3] > 64) {
                  found.push([x0 / step, y0 / step]);
                  break scan;
                }
              }
            }
          }
        }
        return found;
      };
      cell = CELL;
      let cells = sample(cell);
      while (cells.length > MAX_DOTS && cell < 16) cells = sample(++cell);
      // Each dot's home is a little off its cell's middle, so the loose dots don't sit on a grid.
      const jitter = () => (Math.random() - 0.5) * cell * 0.7;
      for (const [i, j] of cells) {
        const cx = (i + 0.5) * cell;
        const cy = (j + 0.5) * cell;
        const d = { cx, cy, hx: cx + jitter(), hy: cy + jitter(), vx: 0, vy: 0,
                    seed: Math.random(), grit: Math.random(), moving: false, ink, paper };
        d.x = d.hx;
        d.y = d.hy;
        // The innermost part with its own color that the cell is in, if any.
        for (const part of parts) {
          if (!part.rects.some(([l, t, r, b]) => cx >= l && cx < r && cy >= t && cy < b)) continue;
          d.ink = part.ink;
          if (part.paper) d.paper = part.paper;
        }
        dots.push(d);
        if (!inked) inked = [cx, cy, cx, cy];
        inked = [Math.min(inked[0], cx), Math.min(inked[1], cy),
                 Math.max(inked[2], cx), Math.max(inked[3], cy)];
      }
      look();
    };

    const add = (groups, color, d) => {
      const group = groups.get(color);
      if (group) group.push(d);
      else groups.set(color, [d]);
    };
    const draw = (loose) => {
      if (drawn) ctx.clearRect(drawn[0], drawn[1], drawn[2] - drawn[0], drawn[3] - drawn[1]);
      drawn = null;
      if (!loose.length) return;
      const patch = cell * COVER;
      const r = (cell * DOT) / 2;
      // By color (all one, but for a part of the sentence with its own): the patches, then the
      // dots over them.
      const papers = new Map();
      const inks = new Map();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const d of loose) {
        add(papers, d.paper, d);
        add(inks, d.ink, d);
        x0 = Math.min(x0, d.cx - patch / 2, d.x - r);
        y0 = Math.min(y0, d.cy - patch / 2, d.y - r);
        x1 = Math.max(x1, d.cx + patch / 2, d.x + r);
        y1 = Math.max(y1, d.cy + patch / 2, d.y + r);
      }
      // Rounded a little, so a single one reads as a chip off the letter, not a square cut.
      const round = ctx.roundRect ? cell * 0.4 : 0;
      for (const [color, group] of papers) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const d of group) {
          if (round) ctx.roundRect(d.cx - patch / 2, d.cy - patch / 2, patch, patch, round);
          else ctx.rect(d.cx - patch / 2, d.cy - patch / 2, patch, patch);
        }
        ctx.fill();
      }
      for (const [color, group] of inks) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const d of group) {
          ctx.moveTo(d.x + r, d.y);
          ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      drawn = [x0 - 2, y0 - 2, x1 + 2, y1 + 2];  // and the soft pixels on the edges
    };

    // Every dot back in its letter at once, and nothing drawn.
    const settle = () => {
      for (const d of astir) {
        d.x = d.hx;
        d.y = d.hy;
        d.vx = d.vy = 0;
        d.moving = false;
      }
      astir.clear();
      pass = null;
      draw([]);
    };

    // The pass on arriving: from half a reach left of the letters and PASS_RISE under them, to
    // half a reach right of them and PASS_RISE over them, bowing up a little on the way. On a
    // sentence of a few lines it crosses them all, the last line's start to the first's end.
    const start = (now) => {
      const [left, top, right, bottom] = inked;
      const height = bottom - top + cell;
      const x0 = left - reach / 2;
      const y0 = bottom + reach * PASS_RISE;
      const x1 = right + reach / 2;
      const y1 = top - reach * PASS_RISE;
      pass = { start: now, x0, y0, x1, y1, bow: height * PASS_BOW,
               time: Math.max(PASS_TIME, Math.hypot(x1 - x0, y1 - y0) / PASS_SPEED) };
      pointer.fresh = true;
    };
    // Where the pass is now: fast at first, slowing to a stop. Done, it's gone.
    const follow = (now) => {
      const t = (now - pass.start) / pass.time;
      if (t >= 1) {
        pass = null;
        return;
      }
      const s = Math.sin((Math.max(0, t) * Math.PI) / 2);
      pointer.x = pass.x0 + (pass.x1 - pass.x0) * s;
      pointer.y = pass.y0 + (pass.y1 - pass.y0) * s - pass.bow * Math.sin(Math.PI * s);
    };

    const tick = (now) => {
      frame = 0;
      if (!hero.isConnected) return;  // Home's opening, gone
      if (reduceMotion.matches) {  // turned on with the page open
        settle();
        return;
      }
      const ms = last ? Math.min(now - last, 1000 / 24) : 1000 / 60;
      const dt = Math.max(ms / (1000 / 60), 0.25);
      last = now;
      // The pass goes the first time the sentence is on screen (on arriving, or once it's
      // scrolled to, or in a tab opened behind another once it's looked at: no frames run till
      // then), unless some of it is selected or a real pointer is already over it.
      if (!arrived && cued && shown && !selected && dots.length) {
        arrived = true;
        if (!pointer.inside) start(now);
      }
      if (pass) follow(now);
      // The dots feel a point that follows the pointer a little behind, along the whole way it
      // went since the last frame (from px, py to sx, sy): a fast pointer jumps tens of pixels
      // a frame, and would skip the letters in between.
      pointer.px = pointer.sx;
      pointer.py = pointer.sy;
      if (pointer.fresh) {
        pointer.px = pointer.sx = pointer.x;
        pointer.py = pointer.sy = pointer.y;
        pointer.fresh = false;
      } else {
        const k = Math.min(1, 0.75 * dt);
        pointer.sx += (pointer.x - pointer.sx) * k;
        pointer.sy += (pointer.y - pointer.sy) * k;
      }
      const inside = (pointer.inside || pass !== null) && !selected;
      const ax = pointer.px;
      const ay = pointer.py;
      const wx = pointer.sx - ax;
      const wy = pointer.sy - ay;
      const way = wx * wx + wy * wy;
      const step = Math.sqrt(way);
      const fast = reach ? Math.min(1, step / dt / reach) : 0;  // 1 at a reach a frame or faster
      const mx = step ? wx / step : 0;
      const my = step ? wy / step : 0;
      const drag = DRAG ** dt;
      const push = reach * PUSH;
      const away = (cell * 0.55) ** 2;  // closer than this to home, the letter draws it
      const loose = [];
      let busy = 0;
      // With the pointer away, only the dots astir move; with it where it counts, any may.
      for (const d of inside ? dots : astir) {
        let near = false;
        let r = 0;
        let dx = 0;
        let dy = 0;
        if (inside) {
          // From the nearest point on the way the pointer went this frame.
          const t = way ? Math.min(1, Math.max(0, ((d.x - ax) * wx + (d.y - ay) * wy) / way)) : 0;
          dx = d.x - (ax + wx * t);
          dy = d.y - (ay + wy * t);
          r = reach * (0.55 + 0.75 * d.seed);
          near = dx * dx + dy * dy < r * r;
        }
        if (near || d.moving) {
          if (near) {
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            const f = (1 - dist / r) ** 2 * push * (1 + SWEEP * fast * (0.5 + d.grit));
            const along = WAKE * fast;
            d.vx = (d.vx + ((d.hx - d.x) * SPRING + (dx / dist + mx * along) * f) * dt) * drag;
            d.vy = (d.vy + ((d.hy - d.y) * SPRING + (dy / dist + my * along) * f) * dt) * drag;
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.moving = true;
            if (d.vx * d.vx + d.vy * d.vy > 1e-4) busy++;
          } else {
            d.vx *= drag;
            d.vy *= drag;
            const k = Math.min(1, RETURN * (0.8 + 0.4 * d.seed) * dt);
            d.x += d.vx * dt + (d.hx - d.x) * k;
            d.y += d.vy * dt + (d.hy - d.y) * k;
            if (Math.abs(d.x - d.hx) < 0.2 && Math.abs(d.y - d.hy) < 0.2
                && d.vx * d.vx + d.vy * d.vy < 0.01) {
              d.x = d.hx;
              d.y = d.hy;
              d.vx = d.vy = 0;
              d.moving = false;
            } else {
              busy++;
            }
          }
        }
        if (d.moving) astir.add(d);
        else astir.delete(d);
        if ((d.x - d.hx) ** 2 + (d.y - d.hy) ** 2 >= away) loose.push(d);
      }

      draw(loose);
      // Keep going while anything moves, or may: the pointer (or the pass) is where it counts.
      if (busy || inside) {
        frame = requestAnimationFrame(tick);
      } else if (arrived && !told) {
        told = true;
        hero.dispatchEvent(new Event("dust:still"));
      }
    };
    const wake = () => {
      if (frame || reduceMotion.matches) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    // Is any of the sentence on screen? Not once it has scrolled off the top. (Until 2026-11-06
    // also not once the photo block had slid over it.)
    const look = () => {
      const r = headline.getBoundingClientRect();
      shown = r.bottom > 0 && r.top < window.innerHeight;
      if (shown) wake();
    };

    const place = () => {
      const box = hero.getBoundingClientRect();
      pointer.x = pointer.clientX - box.left;
      pointer.y = pointer.clientY - box.top;
    };
    const leave = () => {
      if (!pointer.inside) return;
      pointer.inside = false;
      wake();
    };
    document.addEventListener("pointermove", (e) => {
      pointer.clientX = e.clientX;
      pointer.clientY = e.clientY;
      // Over the hero only (a calm one's title only): not over the photo or the header.
      // Nor with a mouse button down: that's a drag, perhaps selecting the sentence.
      if (!zone.contains(e.target) || (e.pointerType === "mouse" && e.buttons)) {
        leave();
        return;
      }
      place();
      if (!pointer.inside) {
        pointer.inside = true;
        pointer.fresh = true;
        pass = null;  // the real one takes over from the pass, from where it is
      }
      wake();
    }, { passive: true });
    document.addEventListener("pointerout", (e) => {
      if (!e.relatedTarget) leave();  // off the window
    });
    ["pointerup", "pointercancel"].forEach((type) => document.addEventListener(type, (e) => {
      if (e.pointerType !== "mouse") leave();  // a finger or pen lifted
    }));
    // Scrolling moves the page under a still pointer: the hero may no longer be under it.
    window.addEventListener("scroll", () => {
      look();
      if (!pointer.inside) return;
      if (!zone.contains(document.elementFromPoint(pointer.clientX, pointer.clientY))) leave();
      else place();
    }, { passive: true });
    document.addEventListener("selectionchange", () => {
      const selection = document.getSelection();
      let now = false;
      for (let i = 0; selection && i < selection.rangeCount; i++) {
        const r = selection.getRangeAt(i);
        if (!r.collapsed && r.intersectsNode(headline)) now = true;
      }
      if (now === selected) return;
      selected = now;
      if (selected) settle();
      else wake();
    });
    reduceMotion.addEventListener?.("change", () => {
      if (!reduceMotion.matches) {
        look();
        return;
      }
      cancelAnimationFrame(frame);
      frame = 0;
      settle();
    });

    // A resize moves the letters: the dots go at once, and come back once it rests, from the
    // letters drawn and scanned again (the first time, right away, once the font is in).
    const rebuild = () => {
      clearTimeout(pending);
      if (!hero.isConnected) return;
      if (dots.length) {
        dots = [];
        inked = null;
        astir.clear();
        draw([]);
      }
      if (ready) pending = setTimeout(build, built ? SETTLE : 0);
    };
    // And so does moving to a screen of another pixel density, to stay as sharp as the text.
    const watchDensity = () => {
      density?.removeEventListener?.("change", rebuild);
      density = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      density.addEventListener?.("change", rebuild);
    };
    if ("ResizeObserver" in window) {
      // Not for a size it already has (its first look, say, once the letters are scanned).
      const sizes = new ResizeObserver(() => {
        if (!built || measure() !== scanned) rebuild();
      });
      sizes.observe(hero);
      sizes.observe(headline);
    } else {
      window.addEventListener("resize", rebuild);
      rebuild();
    }
    hero.addEventListener("dust:pass", () => {
      cued = true;
      look();
    });
    // The letters are first scanned once the sentence's font is in, not in the fallback's
    // shapes and again a moment later, which would clear the dots coming in on arriving.
    if (!ready) {
      const style = getComputedStyle(headline);
      document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
                          headline.textContent)
        .catch(() => {})
        .then(() => {
          ready = true;
          rebuild();
        });
    }
  };
  [[".about-hero", ".about-headline"],
   [".project-header", ".project-title", { calm: true }],
   [".page-not-found", ".not-found-title"]].forEach(([outer, inner, options]) => {
    const hero = document.querySelector(outer);
    const headline = hero?.querySelector(inner);
    if (headline) dust(hero, headline, options);
  });

  // Project pages: images below the fold fade up as they come on screen.
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      target.classList.add("is-visible");
      revealer.unobserve(target);
    });
  }, { rootMargin: "0px 0px -10% 0px" });
  document.querySelectorAll(".project-blocks .media").forEach((figure) => {
    if (figure.getBoundingClientRect().top < window.innerHeight) return;  // already on screen
    figure.classList.add("reveal");
    revealer.observe(figure);
  });

  // Impact numbers count up once, when they come on screen.
  const formatCount = (el, value) => {
    const digits = Number(el.dataset.decimals);
    return el.dataset.prefix
      + value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      + el.dataset.suffix;
  };
  const counter = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      counter.unobserve(target);
      const end = Number(target.dataset.value);
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min((now - t0) / 1200, 1);
        target.textContent = formatCount(target, end * (1 - (1 - t) ** 3));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll(".impact-count").forEach((el) => {
    el.textContent = formatCount(el, 0);
    counter.observe(el);
  });

  // Videos marked "loop" play muted while on screen.
  // With reduced motion they keep their controls and wait for a click.
  const looper = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) target.play().catch(() => {});
      else target.pause();
    });
  }, { threshold: 0.25 });
  document.querySelectorAll("video[data-loop]").forEach((video) => {
    video.controls = false;
    looper.observe(video);
  });
})();
