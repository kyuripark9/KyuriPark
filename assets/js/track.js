// The track: an endless row of cards, Home's (HOME_TRACK in build.py) or Work's slider
// (WORK_VIEWS, since 2026-11-10: every item on Work, one of its two views, hidden while the grid
// shows). Wheel, trackpad, drag, swipe, and the arrow keys
// all move a target position, and each frame the row eases toward it.
// A card with no page of its own (on Work's slider) opens the lightbox (main.js) once it's in
// the middle, as a project's card opens its page.
// The row runs across, or, where style.css sets --track-axis to y (Work's slider from 1200px,
// since 2026-11-10), down: the next card comes up from below, as the wheel turns, and the up and
// down arrows move it too. Down, the cards can run on a circle instead of a straight line
// (--track-arc): a wheel turning on a hub off to the side, so a card swings out as it leaves
// the middle and back as it comes to it; each card tilts with its spoke, or with --track-tilt
// at 0, stays upright (Home's, since 2026-11-10).
// Left alone, the row can turn on its own, slowly (--track-drift; Home's wheel, since
// 2026-11-10): a pointer over a card, the wheel, a drag, the keys, or focus on a card stop it,
// and it turns again DRIFT_RESUME ms after the last of them. Never with reduced motion.
// Each card is placed by its distance from the position, wrapped around the loop. Five show
// at most, the middle one and two each side: past two steps out a card fades away, and it is
// gone before it crosses from one end of the loop to the other (since 2026-11-09; until then
// copies of the cards filled wide windows, so the same project could show twice). Card size,
// spacing, and how the cards shrink, grey, fade, and blur away from the middle are set in
// style.css.
// Each time a new card reaches the middle, a soft tick can sound (off since 2026-11-09: a
// visitor may be in an office or on a call; TICK_VOLUME 0.3 turns it back on).
(() => {
  const WHEEL_SPEED = 1 / 600;   // cards moved per pixel of wheel or trackpad scroll
  const WHEEL_MAX = 30;          // pixels: one wheel event never counts for more than this
  const SETTLE_DELAY = 150;      // ms without input before the row settles on one card
  const EASE = 0.15;             // share of the remaining distance covered each frame
  const FADE_OUT = 0.5;          // cards (more than 0): past two steps out, a card fades away
                                 // over this much of a step
  const TICK_VOLUME = 0;         // 0 to 1; 0 turns the tick off (0.3 until 2026-11-09)
  const TICK_TONE = 1800;        // Hz: the pitch the tick centers on; higher sounds brighter
  // On a phone the cards beside the middle one are off screen, so once a visit, as the page
  // shows (after Home's opening, when it plays), the row leans toward the next card and back,
  // showing there are more; the dots under the caption say so too. Not if the row has been
  // moved first, or with reduced motion. (Since 2026-11-09.)
  const LEAN = 0.3;              // cards: how far the row leans
  const LEAN_HOLD = 450;         // ms before it comes back
  const LEAN_DELAY = 400;        // ms after the page shows
  const LEAN_SEEN = "home-lean-seen";  // sessionStorage key
  const DRIFT_RESUME = 2500;     // ms after the last input, or the pointer leaving the cards,
                                 // before the row turns on its own again (--track-drift)

  const root = document.querySelector(".track");
  if (!root) return;
  const stage = root.querySelector(".track-stage");
  const row = root.querySelector(".track-row");
  const caption = root.querySelector(".track-caption");
  const meta = root.querySelector(".track-meta");
  const dots = [...root.querySelectorAll(".track-dots > span")];  // one per project, phones only
  const visible = () => stage.clientWidth > 0;  // not while Work's grid shows instead
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const phone = window.matchMedia("(max-width: 767px)");
  let moved = false;   // the visitor has moved the row

  const items = [...row.querySelectorAll(".track-item")];
  const cards = items.map((item) => item.querySelector(".track-card"));
  cards.forEach((card) => { card.draggable = false; });
  const n = items.length;  // cards on the loop

  let position = 0;    // the card in the middle; 1.5 = halfway between the 2nd and 3rd
  let target = 0;
  let direction = 0;   // which way the last input moved: 1, -1, or 0
  let scales, look, stops, rest, gone;
  let radius = 0;      // the wheel's, from the hub to the cards' centers; 0: a straight row
  let hub = 1;         // which side the hub is on: 1, the left; -1, the right
  let tilt = 1;        // 1: cards tilt with their spokes; 0: they stay upright (--track-tilt)
  let drift = 0;       // cards a second the row turns on its own (--track-drift); 0: it doesn't
  let paused = true;   // the drift, until the page shows and then after each input
  let hovering = false;  // the pointer is over a card
  let resumeTimer;
  let last = 0;        // the last frame's time, for the drift
  let axis = "X";      // "X": the row runs across; "Y": down (--track-axis in style.css)
  let shown = items[0];  // the card whose caption is showing
  let frame = 0;
  let settleTimer;
  let drag = null;
  let dragged = false;

  // The tick: a 90 ms burst of noise that fades as it goes, narrowed to a band around
  // TICK_TONE and cut off after 50 ms. No sound file. Browsers allow sound only once the
  // visitor has clicked, tapped, or pressed a key on the page, so until then it's silent.
  let audio = null;    // { context, noise }, made at the visitor's first input
  let lastTick = 0;

  const wakeAudio = () => {
    if (!TICK_VOLUME) return;
    if (!audio) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      const context = new Context();
      const length = Math.floor(context.sampleRate * 0.09);
      const noise = context.createBuffer(1, length, context.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      audio = { context, noise };
    }
    if (audio.context.state === "suspended") audio.context.resume().catch(() => {});
  };

  const playTick = () => {
    if (!audio || audio.context.state !== "running") return;
    const { context, noise } = audio;
    const now = context.currentTime;
    if (now - lastTick < 0.03) return;  // at most one tick every 30 ms, however fast the row moves
    lastTick = now;
    const source = context.createBufferSource();
    source.buffer = noise;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = TICK_TONE;
    band.Q.value = 4.5;
    const gain = context.createGain();
    gain.gain.setValueAtTime(TICK_VOLUME, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    source.connect(band);
    band.connect(gain);
    gain.connect(context.destination);
    source.start(now);
    source.stop(now + 0.07);
  };

  const wrap = (i) => ((i % n) + n) % n;

  // Card i's distance from position p, the short way around the loop (between -n/2 and n/2).
  const offset = (i, p) => {
    const d = wrap(i - p);
    return d > n / 2 ? d - n : d;
  };

  // values[k] is for a card k whole steps from the middle; in between, a straight line.
  // Past the last one, cards keep its value.
  const at = (values, a) => {
    const k = Math.min(Math.floor(a), values.length - 1);
    return k === values.length - 1 ? values[k] : values[k] + (values[k + 1] - values[k]) * (a - k);
  };

  // stops[k]: from the middle card's center to the center of the card k steps out (on a
  // wheel, around its rim). The gap is measured between cards as drawn, after they shrink;
  // on a wheel, at the cards' ends toward the hub, where spokes are closest, so the gap opens
  // wider at their other ends. That end is the larger card's, so two cards halfway through a
  // step, both larger than at its end, keep the gap too. rest: between cards past the last
  // step, as they fade away. gone: how far out a card is no longer seen.
  const measure = () => {
    const style = getComputedStyle(stage);
    axis = style.getPropertyValue("--track-axis").trim() === "y" ? "Y" : "X";
    const box = getComputedStyle(items[0]);
    // The card's size along the row, unrounded and unscaled: its width, or down, its height.
    const width = parseFloat(axis === "Y" ? box.height : box.width);
    const across = parseFloat(axis === "Y" ? box.width : box.height);
    const css = (name) => parseFloat(style.getPropertyValue(name));
    // --track-arc: the wheel's radius in middle-card heights; less than 0 puts the hub on the
    // right. 0, or none: a straight row. Down only.
    const arc = axis === "Y" ? css("--track-arc") || 0 : 0;
    radius = Math.abs(arc) * width;
    hub = Math.sign(arc) || 1;
    const tilted = style.getPropertyValue("--track-tilt").trim();
    tilt = tilted === "" ? 1 : parseFloat(tilted) ? 1 : 0;
    drift = Math.max(css("--track-drift") || 0, 0);
    // A step's length, between two cards' centers, stretched on a wheel as above; scale is
    // the larger card's. Upright cards keep the straight row's spacing, down (place).
    const span = (straight, scale) =>
      (radius && tilt ? straight * radius / (radius - scale * across / 2) : straight);
    // --card-gap-drawn in style.css: when less than --peek-min of a neighbor would show beside
    // the middle card, the neighbor starts at the window's edge instead of as a thin strip.
    // (Across only: down, the middle card's top is on the grid's line, and its height leaves
    // room for the neighbors.)
    const side = (stage.clientWidth - width) / 2;  // the window's edge to the middle card's
    const base = css("--card-gap");
    const gap = axis === "X" && side - base < css("--peek-min") ? Math.max(base, side) : base;
    scales = [1, css("--scale-1"), css("--scale-2")];
    look = { opacity: css("--opacity-1"), grayscale: css("--grayscale-1"),
             brightness: css("--brightness-1"), fade: css("--fade-step"), blur: css("--blur-step") };
    stops = [0];
    for (let k = 1; k < scales.length; k++) {
      stops.push(stops[k - 1] + span((scales[k - 1] + scales[k]) / 2 * width + gap, scales[k - 1]));
    }
    const last = scales.length - 1;
    rest = span(scales[last] * width + gap, scales[last]);
    // FADE_OUT past the last step (two out), or sooner with fewer than five cards: the card
    // that crosses from one end of the loop to the other (n/2 steps out) is gone when it does.
    gone = Math.min(last + FADE_OUT, n / 2);
  };

  // Card centers, d cards from the middle. Size and position both move in straight lines
  // between whole steps, which keeps the gap the same the whole way.
  const x = (d) => {
    const a = Math.abs(d);
    const last = stops.length - 1;
    return Math.sign(d) * (a < last ? at(stops, a) : stops[last] + (a - last) * rest);
  };

  // Where a card x(d) along the row is drawn. On a wheel, x(d) runs around the rim: the card
  // turns that far around the hub, so it moves toward the hub's side as well as along, and
  // tilts with its spoke. Upright, a card is x(d) down from the middle, as on a straight row,
  // and as far toward the hub's side as the circle is there, so the gaps stay the same.
  const place = (d) => {
    const s = x(d);
    if (!radius) return `translate${axis}(${s}px)`;
    if (!tilt) {
      const down = Math.min(Math.abs(s), radius);
      return `translate(${-hub * (radius - Math.sqrt(radius * radius - down * down))}px, ${s}px)`;
    }
    const turn = s / radius;
    const toward = -hub * radius * (1 - Math.cos(turn));
    return `translate(${toward}px, ${radius * Math.sin(turn)}px) rotate(${hub * turn}rad)`;
  };

  const render = () => {
    items.forEach((item, i) => {
      const d = offset(i, position);
      const a = Math.abs(d);
      const near = Math.min(a, 1);        // 0 in the middle, 1 from one step out
      const beyond = Math.max(a - 1, 0);  // steps past the first
      const fading = Math.min(Math.max((gone - a) / FADE_OUT, 0), 1);  // 1, down to 0 at `gone`
      const opacity = (1 - near * (1 - look.opacity)) * look.fade ** beyond * fading;
      item.style.transform = `${place(d)} scale(${at(scales, a)})`;
      item.style.opacity = opacity;
      item.style.filter = a === 0 ? "none" : `grayscale(${near * look.grayscale}) ` +
        `brightness(${1 - near * (1 - look.brightness)}) blur(${beyond * look.blur}px)`;
      item.style.pointerEvents = opacity > 0 ? "" : "none";  // no clicks on a hidden card
    });
    const middle = items[wrap(Math.round(position))];
    if (middle !== shown) {
      shown = middle;
      playTick();
      // A focused card is read out by the screen reader already; don't repeat it. Nor every
      // card the drift brings past.
      caption.setAttribute("aria-live",
                           cards.includes(document.activeElement) || drifting() ? "off" : "polite");
      caption.innerHTML = middle.querySelector(".card-caption").innerHTML;
      dots.forEach((dot, i) => dot.classList.toggle("is-current", items[i] === middle));
      // Down (Work's slider from 1200px), the name slides beside its tick (style.css).
      meta.style.setProperty("--dial-at", items.indexOf(middle));
      if (!reduceMotion.matches) {
        caption.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
      }
    }
  };

  // The drift (--track-drift): only with nothing else going on, and never with reduced motion,
  // during Home's opening, or while the track is hidden (Work's grid showing).
  const drifting = () => drift > 0 && !paused && !hovering && !drag && !opening
    && !reduceMotion.matches && visible() && !root.contains(document.activeElement);

  const tick = (now) => {
    frame = 0;
    const turning = drifting();
    if (turning) target += drift * Math.min(now - (last || now), 50) / 1000;
    last = turning ? now : 0;
    position = reduceMotion.matches ? Math.round(target) : position + (target - position) * EASE;
    if (Math.abs(target - position) < 0.001) position = target;
    render();
    if ((position !== target || turning) && !reduceMotion.matches) frame = requestAnimationFrame(tick);
  };

  // Stop the drift; it starts again DRIFT_RESUME ms later, if nothing has stopped it since.
  const pause = () => {
    paused = true;
    clearTimeout(resumeTimer);
    if (!drift) return;
    resumeTimer = setTimeout(() => {
      paused = false;
      if (!frame) frame = requestAnimationFrame(tick);
    }, DRIFT_RESUME);
  };

  const move = (to) => {
    direction = Math.sign(to - target) || direction;
    target = to;
    if (!frame) frame = requestAnimationFrame(tick);
  };

  // Land exactly on a card: the next one in the direction of travel, once the row
  // has moved a few hundredths of a card that way (one notch of a mouse wheel does it).
  const settle = () => move(Math.round(target + 0.47 * direction));

  // Whole steps, from the card the row is on its way to.
  const go = (by) => move(Math.round(target) + by);

  // Card i, by the short way around.
  const center = (i) => move(Math.round(target + offset(i, target)));

  root.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;  // pinch to zoom
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientWidth : 1;
    const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    move(target + Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, delta)) * WHEEL_SPEED);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_DELAY);
  }, { passive: false });

  // Drag with a mouse, or swipe on a touch screen.
  stage.addEventListener("dragstart", (e) => e.preventDefault());

  const along = (e) => (axis === "Y" ? e.clientY : e.clientX);  // the pointer, along the row

  stage.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    drag = { id: e.pointerId, at: along(e), from: target, moving: false };
  });

  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.abs(along(e) - drag.at) < 8) return;
      drag.moving = true;
      stage.setPointerCapture(e.pointerId);
      clearTimeout(settleTimer);
    }
    move(drag.from + (drag.at - along(e)) / stops[1]);
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moving } = drag;
    drag = null;
    if (!moving) return;
    dragged = true;  // the click that follows a drag doesn't open or center anything
    setTimeout(() => {
      dragged = false;
    }, 0);
    settle();
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // The middle card opens its project's page, or the lightbox. A side card comes to the middle
  // first. Caught on the way down (capture), so a side card's click, or the one after a drag,
  // never reaches the lightbox's own listener on the card.
  root.addEventListener("click", (e) => {
    const card = e.target.closest(".track-card");
    if (!card) return;
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const i = cards.indexOf(card);
    const newTab = card.matches("a") && (e.metaKey || e.ctrlKey || e.shiftKey);
    if (Math.abs(offset(i, target)) < 0.5 || newTab) return;
    e.preventDefault();
    e.stopPropagation();
    center(i);
  }, true);

  // Tabbing to a card brings it to the middle.
  root.addEventListener("focusin", (e) => {
    const i = cards.indexOf(e.target);
    if (i >= 0 && e.target.matches(":focus-visible")) center(i);
  });

  // Left/right arrows (and up/down, when the row runs down) work while focus is on the track,
  // on Work's view switch (just clicked to show the slider), or nowhere in particular.
  // On a card, focus moves along with the row.
  const step = (e) => ({ ArrowLeft: -1, ArrowRight: 1,
                         ...(axis === "Y" && { ArrowUp: -1, ArrowDown: 1 }) })[e.key];
  document.addEventListener("keydown", (e) => {
    const by = step(e);
    if (!by || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !visible()) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && !root.contains(focused)
        && !focused.closest(".work-views")) return;
    e.preventDefault();
    go(by);
    if (cards.includes(focused)) {
      cards[wrap(Math.round(target))].focus({ preventScroll: true });
    }
  });

  // Any input that can move the row also readies the sound.
  root.addEventListener("wheel", wakeAudio, { passive: true });
  root.addEventListener("pointerdown", wakeAudio);
  root.addEventListener("pointerup", wakeAudio);
  document.addEventListener("keydown", wakeAudio);

  // The lean on phones (LEAN, at the top). Input on the row, or the arrow keys, first: no lean.
  const touch = () => {
    moved = true;
    pause();
  };
  root.addEventListener("wheel", touch, { passive: true });
  root.addEventListener("pointerdown", touch);
  root.addEventListener("focusin", touch);
  document.addEventListener("keydown", (e) => {
    if (step(e) && visible()) touch();
  });
  const lean = () => {
    if (moved || reduceMotion.matches || !phone.matches || !visible()) return;
    try {
      if (sessionStorage.getItem(LEAN_SEEN)) return;
      sessionStorage.setItem(LEAN_SEEN, "1");
    } catch (e) {
      return;  // storage blocked: no lean, rather than one on every visit
    }
    const home = Math.round(target);
    move(home + LEAN);
    setTimeout(() => {
      if (!moved) move(home);
    }, LEAN_HOLD);
  };
  const leanSoon = () => setTimeout(lean, LEAN_DELAY);
  let opening = document.documentElement.classList.contains("intro-on");
  if (opening) {
    document.addEventListener("intro:done", () => {
      opening = false;
      leanSoon();
      pause();
    }, { once: true });
  }

  // The pointer over a card stops the drift where it is, so the card stays under it; leaving
  // the cards lets it go again. (A mouse only: a touch is an input, above.)
  root.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    hovering = !!e.target.closest(".track-card");
    pause();
  });
  root.addEventListener("pointerleave", () => {
    hovering = false;
    pause();
  });
  root.addEventListener("focusout", pause);

  // Measured whenever the stage changes size: on resizing the window, and on Work when the
  // slider shows (hidden, it has no size, so it waits). The first time it shows, its images,
  // lazy until then so a hidden slider loads nothing, all load at once (the stage clips the
  // cards, so lazy ones would only load as they came on screen), and on a phone it leans.
  // Where the drift stops for good (a window narrowed out of the wheel), the row settles on a card.
  let seen = false;
  const fit = () => {
    if (!visible()) return;
    measure();
    render();
    if (!drift && target !== Math.round(target)) move(Math.round(target));
    if (seen) return;
    seen = true;
    row.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = "eager"; });
    if (!opening) {
      leanSoon();
      pause();
    }
  };
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", fit);
  fit();
})();
