// Work's ring (WORK_RING in build.py, since 2026-11-12, after sarahsarazen.com/#projects): every
// item as an object on an oval ring seen from a little above, the near side low and large, the
// far side high and small. Left alone it turns slowly, as Home's wheel did (--track-drift), from
// the moment the page shows (as the opening's black starts to fade, when it plays). The mouse
// moving onto an object, the wheel, a drag, the arrow keys, or tabbing to an object stop it, and
// it turns again DRIFT_RESUME ms after the last of them; never with reduced motion. The wheel and
// a drag turn it freely, without settling on an object; the arrow keys turn it an object at a
// time, and tabbing to an object brings it to the front.
// In the ring's middle, the name and "Type · Year" of the object in front, or of the one under
// the mouse or focused. A click on an object opens its project's page, or the lightbox for an
// item with no page (main.js). With fewer items than RING_MIN_SLOTS (build.py) they go around
// more than once; a copy's click goes to the first one's.
// Shown only from 768px, and only while RING is picked (main.js); hidden, it does nothing.
(() => {
  const TURN = 50;               // seconds the ring takes to go around once on its own
  const WHEEL_SPEED = 1 / 250;   // places turned per pixel of wheel or trackpad scroll
  const WHEEL_MAX = 100;         // pixels: one wheel event never counts for more than this
                                 // (a mouse wheel's notch: about 0.4 of a place)
  const EASE = 0.1;              // share of the remaining turn covered each frame
  const DRIFT_RESUME = 2500;     // ms after the last input, or the mouse leaving the objects
  // The ring's shape, in the space from under the RING / GRID switch to the window's bottom:
  const WIDTH = 0.4;             // its half width, as a share of the window's width
  const TILT = 0.26;             // its half height, as a share of its half width (0: a line,
                                 // seen edge on; 1: a circle, seen from straight above)
  const SIZE_H = 0.32;           // an object in front, as a share of that space's height...
  const SIZE_W = 0.15;           // ...and of the window's width, whichever is smaller...
  const SIZE_MAX = 300;          // ...and never larger than this, in pixels
  const BACK = 0.42;             // an object at the far side, as a share of one in front
  const FADE = 0.3;              // how much lighter the far side is (0: not at all)
  const TOP_GAP = 24;            // px under the switch...
  const BOTTOM_GAP = 40;         // ...and over the window's bottom, that the ring keeps clear

  const root = document.querySelector(".ring");
  if (!root) return;
  const stage = root.querySelector(".ring-stage");
  const caption = root.querySelector(".ring-caption");
  const title = caption.querySelector(".ring-title");
  const meta = caption.querySelector(".ring-meta");
  const views = document.querySelector(".work-views");
  const items = [...root.querySelectorAll(".ring-item")];
  const objects = items.map((item) => item.querySelector(".ring-object"));
  const index = items.map((item) => Number(item.dataset.index));  // the item at each place
  const n = Math.max(...index) + 1;   // items
  const slots = items.length;         // places on the ring
  const firsts = objects.slice(0, n); // the first time around: the ones with names and focus
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const visible = () => stage.clientWidth > 0;  // not while the grid shows, nor on a phone
  const KEY_FOCUS = window.CSS && CSS.supports("selector(:focus-visible)") ? ":focus-visible" : ":focus";

  let position = 0;    // the place in front; 1.5 = halfway between the 2nd and 3rd
  let target = 0;
  let cx = 0, cy = 0, rx = 0, ry = 0, size = 0;
  let frame = 0;
  let last = 0;        // the last frame's time, for the drift
  let paused = true;   // the drift, until the page shows and after each input
  let hovered = -1;    // the item under the mouse, or -1
  let resumeTimer;
  let drag = null;
  let dragged = false;
  let shown = 0;       // the item named in the middle
  let driven = false;  // the ring is turning on its own (the drift), not by the visitor's hand
  let opening = document.documentElement.classList.contains("intro-on");

  const wrap = (d) => ((d % slots) + slots * 1.5) % slots - slots / 2;  // into -slots/2..slots/2

  const measure = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const top = Math.max((views ? views.getBoundingClientRect().bottom : 0) + TOP_GAP, 0);
    const room = Math.max(h - BOTTOM_GAP - top, 0);
    size = Math.min(room * SIZE_H, w * SIZE_W, SIZE_MAX);
    rx = w * WIDTH;
    ry = Math.max(Math.min(rx * TILT, (room - size * (1 + BACK) / 2) / 2), 0);
    cx = w / 2;
    // The ring's top (an object at the far side, smaller) to its bottom (one in front), in the
    // middle of the room.
    cy = top + room / 2 - size * (1 - BACK) / 4;
    root.style.setProperty("--ring-size", `${size}px`);
    root.style.setProperty("--ring-cy", `${cy}px`);
  };

  const name = (i) => {
    if (i === shown) return;
    shown = i;
    const source = firsts[i];
    title.innerHTML = source.querySelector("[data-lightbox-name]").innerHTML;
    meta.innerHTML = source.querySelector("[data-lightbox-meta]").innerHTML;
    if (!reduceMotion.matches) {
      caption.animate({ opacity: [0, 1] }, { duration: 250, easing: "ease-out" });
    }
  };

  const render = () => {
    items.forEach((item, s) => {
      const angle = (2 * Math.PI * wrap(s - position)) / slots;
      const depth = Math.cos(angle);         // 1 in front, -1 at the far side
      const near = (depth + 1) / 2;          // 0 to 1
      const scale = BACK + (1 - BACK) * near;
      const x = cx + rx * Math.sin(angle) - size / 2;
      const y = cy + ry * depth - size / 2;
      item.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      item.style.zIndex = String(Math.round(near * 1000));
      item.style.opacity = String(1 - FADE * (1 - near));
    });
    const focused = firsts.indexOf(document.activeElement);
    name(hovered >= 0 ? hovered : focused >= 0 ? focused
      : index[((Math.round(position) % slots) + slots) % slots]);
  };

  const drifting = () => !paused && hovered < 0 && !drag && !opening && !reduceMotion.matches
    && visible() && !root.querySelector(KEY_FOCUS);

  const tick = (now) => {
    frame = 0;
    const turning = drifting();
    if (turning) {
      target += (slots / TURN) * Math.min(now - (last || now), 50) / 1000;
      driven = true;
    }
    last = turning ? now : 0;
    position = reduceMotion.matches ? target : position + (target - position) * EASE;
    if (Math.abs(target - position) < 0.0005) position = target;
    render();
    if (position !== target || turning) frame = requestAnimationFrame(tick);
  };
  const run = () => {
    if (!frame && visible()) frame = requestAnimationFrame(tick);
  };

  const start = () => {
    paused = false;
    run();
  };
  // Stop the drift; it starts again DRIFT_RESUME ms later, if nothing has stopped it since.
  const pause = () => {
    paused = true;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(start, DRIFT_RESUME);
  };
  const move = (to) => {
    target = to;
    driven = false;
    run();
  };
  // Item i in front, by the short way around, whichever time around is nearest.
  const bring = (i) => {
    let best = Infinity;
    for (let s = i; s < slots; s += n) {
      const d = wrap(s - target);
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    move(target + best);
  };

  root.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;  // pinch to zoom
    e.preventDefault();
    pause();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientWidth : 1;
    const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    move(target + Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, delta)) * WHEEL_SPEED);
  }, { passive: false });

  // A drag turns the ring as far as the object in front moves with the pointer.
  stage.addEventListener("dragstart", (e) => e.preventDefault());
  stage.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    drag = { id: e.pointerId, at: e.clientX, from: target, moving: false };
    pause();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.abs(e.clientX - drag.at) < 8) return;
      drag.moving = true;
      stage.setPointerCapture(e.pointerId);
    }
    move(drag.from + ((drag.at - e.clientX) * slots) / (2 * Math.PI * rx));
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moving } = drag;
    drag = null;
    pause();
    if (!moving) return;
    dragged = true;  // the click that ends a drag opens nothing
    setTimeout(() => {
      dragged = false;
    }, 0);
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // Caught on the way down, so the click after a drag never reaches the lightbox's listener;
  // a copy of an item with no page passes its click to the first one, which opens the lightbox.
  root.addEventListener("click", (e) => {
    const object = e.target.closest(".ring-object");
    if (!object) return;
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const s = objects.indexOf(object);
    if (s >= n && object.matches("button")) {
      e.stopPropagation();
      firsts[index[s]].click();
    }
  }, true);

  // The mouse moving onto an object stops the ring there and names the object; moving off the
  // objects lets it go again. Only the mouse's own moving counts, not an object turning under a
  // mouse at rest. Turning on its own, the ring stops at once, so the object stays under the
  // mouse; turned by the visitor, it finishes the turn.
  const hover = (i) => {
    if (i === hovered) return;
    hovered = i;
    if (i >= 0 && driven) target = position;
    pause();
    render();
  };
  let mouseAt = "";
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const at = `${e.clientX},${e.clientY}`;
    if (at === mouseAt) return;
    mouseAt = at;
    const object = e.target.closest(".ring-object");
    hover(object ? index[objects.indexOf(object)] : -1);
  });
  root.addEventListener("pointerleave", () => hover(-1));

  // Tabbing to an object brings it to the front.
  root.addEventListener("focusin", (e) => {
    const i = firsts.indexOf(e.target);
    if (i < 0) return;
    pause();
    if (e.target.matches(":focus-visible")) bring(i);
    render();
  });
  root.addEventListener("focusout", pause);

  // Left/right arrows turn it an object at a time, while focus is on the ring, on the switch
  // (just clicked to show it), or nowhere in particular; on an object, focus moves with it.
  document.addEventListener("keydown", (e) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!by || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !visible()) return;
    if (document.documentElement.classList.contains("lightbox-open")) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && !root.contains(focused)
        && !focused.closest(".work-views")) return;
    e.preventDefault();
    pause();
    move(Math.round(target) + by);
    if (firsts.includes(focused)) {
      firsts[index[((Math.round(target) % slots) + slots) % slots]].focus({ preventScroll: true });
    }
  });

  if (opening) {
    document.addEventListener("intro:reveal", () => {
      opening = false;
      start();
    }, { once: true });
  }

  // Measured whenever the stage changes size: on resizing the window, and when the ring shows
  // (hidden, it has no size, so it waits).
  const fit = () => {
    if (!visible()) return;
    measure();
    render();
    root.classList.add("is-ready");
    if (!opening) paused = false;
    run();
  };
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", fit);
  reduceMotion.addEventListener?.("change", run);
  fit();
})();
