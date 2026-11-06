// Enhancements on top of pages that already work without JavaScript:
// Work's filter and card videos, the lightbox, About's first sentence breaking into dots under
// the pointer, and project-page motion (image fade-up, count-up numbers, looping videos). The
// home track is in track.js.
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

  // About's first screen: the sentence breaks into dots where the pointer passes, and they drift
  // back (as on soren-template.framer.website). Until then, a few dots on the letters' edges come
  // loose on their own, drift a little way off, and settle back, a hint that the letters are made
  // of dots and come apart. The sentence stays real text: a canvas over it draws only what has
  // moved, a patch of the background where each loose dot sat in a letter and the dot where it is
  // now.
  const hero = document.querySelector(".about-hero");
  const headline = hero?.querySelector(".about-headline");
  if (hero && headline) {
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
    const FRAY = 0.03;       // share of the edge dots off their letter at any moment
    const FRAY_NEAR = 2;     // px the nearest an edge dot drifts off its letter...
    const FRAY_FAR = 16;     // ...and the farthest (most stay near)
    const FRAY_TIME = 2400;  // ms to drift off and settle back (each 0.6 to 1.4 times this)
    const MAX_DOTS = 12000;  // past this the cells grow, so a long sentence stays smooth

    const canvas = document.createElement("canvas");
    canvas.className = "about-dust";
    canvas.setAttribute("aria-hidden", "true");
    hero.insertBefore(canvas, hero.querySelector(".about-scroll"));  // under the scroll link
    const ctx = canvas.getContext("2d");
    const intro = document.querySelector(".about-intro");
    let cell = CELL;
    let reach = 0;
    let ink = "#000";
    let paper = "#fff";
    let dots = [];   // the sentence's dots: their cell's middle (cx, cy), home (hx, hy), where
                     // they are, their speed, and the way out of the letter (nx, ny) if on an edge
    let edges = [];  // the dots on the letters' edges
    let afloat = 0;  // edge dots due to come loose (a running count, so they come one by one)
    let shown = false;  // some of the sentence is on screen (not yet under the photo block)
    const pointer = { clientX: 0, clientY: 0, x: 0, y: 0, sx: 0, sy: 0, px: 0, py: 0,
                      inside: false, fresh: true };
    let frame = 0;
    let last = 0;

    // Draw the letters where the page draws them, one by one, on a hidden canvas, and put a
    // dot on every cell with ink in it.
    const build = () => {
      const w = hero.clientWidth;
      const h = hero.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const style = getComputedStyle(headline);
      ink = style.color;
      paper = getComputedStyle(document.body).backgroundColor;
      const size = parseFloat(style.fontSize);
      reach = size * REACH;

      const mask = document.createElement("canvas");
      mask.width = Math.max(1, Math.ceil(w));
      mask.height = Math.max(1, Math.ceil(h));
      const m = mask.getContext("2d", { willReadFrequently: true });
      m.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
      m.fillStyle = m.strokeStyle = "#000";
      m.lineWidth = 2;  // a pixel past each edge, so the patches take the letters' soft edges too
      const metrics = m.measureText("H");
      const ascent = metrics.fontBoundingBoxAscent ?? size * 0.97;
      const descent = metrics.fontBoundingBoxDescent ?? size * 0.24;
      const box = hero.getBoundingClientRect();
      const upper = style.textTransform === "uppercase";
      const range = document.createRange();
      const walker = document.createTreeWalker(headline, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
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

      dots = [];
      edges = [];
      const lines = headline.getBoundingClientRect();
      const left = Math.max(0, Math.floor(lines.left - box.left) - 4);
      const top = Math.max(0, Math.floor(lines.top - box.top) - 4);
      const right = Math.min(mask.width, Math.ceil(lines.right - box.left) + 4);
      const bottom = Math.min(mask.height, Math.ceil(lines.bottom - box.top) + 4);
      if (right <= left || bottom <= top) return;
      const data = m.getImageData(left, top, right - left, bottom - top).data;
      const span = right - left;
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
      const key = (i, j) => j * 65536 + i;
      const taken = new Set(cells.map(([i, j]) => key(i, j)));
      // Each dot's home is a little off its cell's middle, so the loose dots don't sit on a grid.
      const jitter = () => (Math.random() - 0.5) * cell * 0.7;
      for (const [i, j] of cells) {
        const cx = (i + 0.5) * cell;
        const cy = (j + 0.5) * cell;
        const d = { cx, cy, hx: cx + jitter(), hy: cy + jitter(), vx: 0, vy: 0,
                    seed: Math.random(), grit: Math.random(), moving: false, fray: null,
                    nx: 0, ny: 0 };
        d.x = d.hx;
        d.y = d.hy;
        // On an edge if a cell around it is empty; the way out is toward the empty ones.
        let open = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if ((di || dj) && !taken.has(key(i + di, j + dj))) {
              d.nx += di;
              d.ny += dj;
              open++;
            }
          }
        }
        if (open) {
          const length = Math.hypot(d.nx, d.ny);
          const angle = length ? Math.atan2(d.ny, d.nx) : Math.random() * Math.PI * 2;
          d.nx = Math.cos(angle);
          d.ny = Math.sin(angle);
          edges.push(d);
        }
        dots.push(d);
      }
      afloat = 0;
      look();
      draw([]);
    };

    const draw = (loose) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!loose.length) return;
      const patch = cell * COVER;
      ctx.fillStyle = paper;
      ctx.beginPath();
      // Rounded a little, so a single one reads as a chip off the letter, not a square cut.
      const round = ctx.roundRect ? cell * 0.4 : 0;
      for (const d of loose) {
        if (round) ctx.roundRect(d.cx - patch / 2, d.cy - patch / 2, patch, patch, round);
        else ctx.rect(d.cx - patch / 2, d.cy - patch / 2, patch, patch);
      }
      ctx.fill();
      const r = (cell * DOT) / 2;
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (const d of loose) {
        ctx.moveTo(d.x + r, d.y);
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    };

    // An edge dot comes loose: out of its letter, give or take, and back, over FRAY_TIME.
    const fray = (now) => {
      for (let tries = 0; tries < 4; tries++) {
        const d = edges[Math.floor(Math.random() * edges.length)];
        if (d.moving || d.fray) continue;
        const angle = Math.atan2(d.ny, d.nx) + (Math.random() - 0.5) * 1.2;
        const far = FRAY_NEAR + (FRAY_FAR - FRAY_NEAR) * Math.random() ** 1.5;
        d.fray = { start: now, time: FRAY_TIME * (0.6 + 0.8 * Math.random()),
                   dx: Math.cos(angle), dy: Math.sin(angle), far,
                   phase: Math.random() * Math.PI * 2 };
        return;
      }
    };

    const tick = (now) => {
      frame = 0;
      const ms = last ? Math.min(now - last, 1000 / 24) : 1000 / 60;
      const dt = Math.max(ms / (1000 / 60), 0.25);
      last = now;
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
      const ax = pointer.px;
      const ay = pointer.py;
      const wx = pointer.sx - ax;
      const wy = pointer.sy - ay;
      const way = wx * wx + wy * wy;
      const step = Math.sqrt(way);
      const fast = reach ? Math.min(1, step / dt / reach) : 0;  // 1 at a reach a frame or faster
      const mx = step ? wx / step : 0;
      const my = step ? wy / step : 0;
      // About FRAY of the edge dots loose at a time, while the sentence is on screen.
      if (shown && edges.length) {
        afloat += (ms * edges.length * FRAY) / FRAY_TIME;
        for (; afloat >= 1; afloat--) fray(now);
      }
      const drag = DRAG ** dt;
      const push = reach * PUSH;
      const away = (cell * 0.55) ** 2;  // closer than this to home, the letter draws it
      const loose = [];
      let busy = 0;
      for (const d of dots) {
        let near = false;
        let r = 0;
        let dx = 0;
        let dy = 0;
        if (pointer.inside) {
          // From the nearest point on the way the pointer went this frame.
          const t = way ? Math.min(1, Math.max(0, ((d.x - ax) * wx + (d.y - ay) * wy) / way)) : 0;
          dx = d.x - (ax + wx * t);
          dy = d.y - (ay + wy * t);
          r = reach * (0.55 + 0.75 * d.seed);
          near = dx * dx + dy * dy < r * r;
        }
        if (d.fray) {
          const p = (now - d.fray.start) / d.fray.time;
          if (near || p >= 1) {
            d.fray = null;  // the pointer takes it from here, or it's home
            if (!near) {
              d.x = d.hx;
              d.y = d.hy;
            }
          } else {
            // Out and back, easing at both ends, with a little sway across the way out.
            const out = Math.sin(Math.PI * p) ** 2 * d.fray.far;
            const sway = Math.sin(p * Math.PI * 3 + d.fray.phase) * Math.min(out, 1.5);
            d.x = d.hx + d.fray.dx * out - d.fray.dy * sway;
            d.y = d.hy + d.fray.dy * out + d.fray.dx * sway;
            busy++;
          }
        }
        if (!d.fray && (near || d.moving)) {
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
        if ((d.x - d.hx) ** 2 + (d.y - d.hy) ** 2 >= away) loose.push(d);
      }

      draw(loose);
      // Keep going while the sentence is on screen or anything still moves.
      if (shown || busy) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (frame) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    // Is any of the sentence on screen? Not once the photo block has slid over it, or scrolled
    // off the top on a short window.
    const look = () => {
      const r = headline.getBoundingClientRect();
      const cover = intro ? intro.getBoundingClientRect().top : Infinity;
      shown = r.bottom > 0 && r.top < Math.min(window.innerHeight, cover);
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
      // Over the first screen only: not once the photo block slides over it, or on the header.
      if (!hero.contains(e.target)) {
        leave();
        return;
      }
      place();
      if (!pointer.inside) {
        pointer.inside = true;
        pointer.fresh = true;
      }
      wake();
    }, { passive: true });
    document.addEventListener("pointerout", (e) => {
      if (!e.relatedTarget) leave();  // off the window
    });
    ["pointerup", "pointercancel"].forEach((type) => document.addEventListener(type, (e) => {
      if (e.pointerType !== "mouse") leave();  // a finger or pen lifted
    }));
    // Scrolling moves the page under a still pointer: the photo block may now be under it.
    window.addEventListener("scroll", () => {
      look();
      if (!pointer.inside) return;
      if (!hero.contains(document.elementFromPoint(pointer.clientX, pointer.clientY))) leave();
      else place();
    }, { passive: true });

    let pending = 0;
    const rebuild = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(build);
    };
    new ResizeObserver(rebuild).observe(hero);
    new ResizeObserver(rebuild).observe(headline);
    document.fonts?.ready.then(rebuild);
  }

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
