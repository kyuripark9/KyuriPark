// Home: an endless row of project cards. Wheel, trackpad, drag, swipe, arrow keys, and the
// arrow buttons all move a target position, and each frame the row eases toward it.
// Each card is placed by its distance from the position, wrapped around the loop; when the
// projects alone can't fill the screen, copies of them extend it. Card size, spacing, and
// side-card scale/opacity are set in style.css.
(() => {
  const WHEEL_SPEED = 1 / 600;   // cards moved per pixel of wheel or trackpad scroll
  const WHEEL_MAX = 30;          // pixels: one wheel event never counts for more than this
  const SETTLE_DELAY = 150;      // ms without input before the row settles on one card
  const EASE = 0.15;             // share of the remaining distance covered each frame

  const root = document.querySelector(".track");
  if (!root) return;
  const stage = root.querySelector(".track-stage");
  const row = root.querySelector(".track-row");
  const originals = [...root.querySelectorAll(".track-item")];
  const items = [...originals];   // the loop: the originals, then any copies
  const cards = items.map((item) => item.querySelector(".track-card"));
  const caption = root.querySelector(".track-caption");
  const [prev, next] = root.querySelectorAll(".track-arrow");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const count = originals.length;
  let n = count;       // cards on the loop, copies included

  let position = 0;    // the card in the middle; 1.5 = halfway between the 2nd and 3rd
  let target = 0;
  let direction = 0;   // which way the last input moved: 1, -1, or 0
  let near, far, sideScale, sideOpacity;
  let shown = 0;       // the project whose caption is showing
  let frame = 0;
  let settleTimer;
  let drag = null;
  let dragged = false;

  const wrap = (i) => ((i % n) + n) % n;

  // Card i's distance from position p, the short way around the loop (between -n/2 and n/2).
  const offset = (i, p) => {
    const d = wrap(i - p);
    return d > n / 2 ? d - n : d;
  };

  // One more copy of every project, at the end of the loop. Copies are for the eye and
  // the mouse only: hidden from screen readers and skipped by Tab.
  const addCopies = () => {
    originals.forEach((item) => {
      const copy = item.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      const card = copy.querySelector(".track-card");
      card.tabIndex = -1;
      row.append(copy);
      items.push(copy);
      cards.push(card);
    });
    n = items.length;
  };

  // A copy looks just like its original, so turning the whole loop by a multiple of
  // `count` changes nothing on screen. This puts original i where its twin nearest
  // the target was, so the keyboard never has to land on a copy.
  const swapIn = (i) => {
    let s = 0;
    for (let t = i + count; t < n; t += count) {
      if (Math.abs(offset(t, target)) < Math.abs(offset(i + s, target))) s = t - i;
    }
    position -= s;
    target -= s;
    if (drag) drag.from -= s;
    render();
  };

  // The gap is measured between cards as drawn, after the side cards shrink.
  // near: from the middle card's center to the next card's. far: between side cards.
  const measure = () => {
    const style = getComputedStyle(stage);
    const width = items[0].offsetWidth;
    const gap = parseFloat(style.getPropertyValue("--card-gap"));
    sideScale = parseFloat(style.getPropertyValue("--side-scale"));
    sideOpacity = parseFloat(style.getPropertyValue("--side-opacity"));
    near = (1 + sideScale) / 2 * width + gap;
    // The card that crosses from one end of the loop to the other has to be off screen
    // when it does. Copies make the loop long enough; past four rounds of them, the
    // side cards spread out instead.
    const least = () => (stage.clientWidth + sideScale * width - 2 * near) / (n - 2);
    while (least() > sideScale * width + gap && n < 4 * count) addCopies();
    far = Math.max(sideScale * width + gap, least());
  };

  // Card centers, d cards from the middle. Moving one step while shrinking
  // keeps the gap the same the whole way.
  const x = (d) => {
    const a = Math.abs(d);
    return Math.sign(d) * (Math.min(a, 1) * near + Math.max(a - 1, 0) * far);
  };

  const render = () => {
    items.forEach((item, i) => {
      const d = offset(i, position);
      const side = Math.min(Math.abs(d), 1);
      item.style.transform = `translateX(${x(d)}px) scale(${1 - (1 - sideScale) * side})`;
      item.style.opacity = 1 - (1 - sideOpacity) * side;
    });
    const middle = wrap(Math.round(position)) % count;
    if (middle !== shown) {
      shown = middle;
      // A focused card is read out by the screen reader already; don't repeat it.
      caption.setAttribute("aria-live", cards.includes(document.activeElement) ? "off" : "polite");
      caption.innerHTML = originals[middle].querySelector(".card-caption").innerHTML;
      if (!reduceMotion.matches) {
        caption.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
      }
    }
  };

  const tick = () => {
    frame = 0;
    position = reduceMotion.matches ? Math.round(target) : position + (target - position) * EASE;
    if (Math.abs(target - position) < 0.001) position = target;
    render();
    if (position !== target && !reduceMotion.matches) frame = requestAnimationFrame(tick);
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
  cards.forEach((card) => {
    card.draggable = false;
  });
  stage.addEventListener("dragstart", (e) => e.preventDefault());

  stage.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, from: target, moving: false };
  });

  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.abs(e.clientX - drag.x) < 8) return;
      drag.moving = true;
      stage.setPointerCapture(e.pointerId);
      clearTimeout(settleTimer);
    }
    move(drag.from + (drag.x - e.clientX) / near);
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

  // The middle card opens its project; a side card comes to the middle first.
  root.addEventListener("click", (e) => {
    const card = e.target.closest(".track-card");
    if (!card) return;
    if (dragged) {
      e.preventDefault();
      return;
    }
    const i = cards.indexOf(card);
    if (Math.abs(offset(i, target)) < 0.5 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    center(i);
  });

  // Tabbing to a card brings it to the middle.
  root.addEventListener("focusin", (e) => {
    const i = cards.indexOf(e.target);
    if (i >= 0 && e.target.matches(":focus-visible")) {
      swapIn(i);
      center(i);
    }
  });

  // Left/right arrows work while focus is on the track or nowhere in particular.
  // On a card, focus moves along with the row.
  document.addEventListener("keydown", (e) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!by || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && !root.contains(focused)) return;
    e.preventDefault();
    go(by);
    if (cards.includes(focused)) {
      const i = wrap(Math.round(target)) % count;
      swapIn(i);
      cards[i].focus({ preventScroll: true });
    }
  });

  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));

  window.addEventListener("resize", () => {
    measure();
    render();
  });
  measure();
  render();
})();
