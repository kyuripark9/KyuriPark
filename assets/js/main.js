// Enhancements on top of pages that already work without JavaScript:
// the header clock, the phone menu, the home carousel, Work previews,
// and project-page motion (image fade-up, count-up numbers, looping videos).
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)");

  // Header clock: "Chicago 14:32" in the site's time zone, updated on the minute.
  const clock = document.querySelector(".clock");
  if (clock) {
    const time = clock.querySelector("time");
    let format = null;
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone: clock.dataset.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      });
    } catch (e) {
      // Unknown time zone in site.json: the clock stays hidden.
    }
    let timer;
    const tick = () => {
      const now = Date.now();
      time.textContent = format.format(now);
      clock.classList.add("is-ready");
      clearTimeout(timer);
      timer = setTimeout(tick, 60000 - (now % 60000) + 50);
    };
    if (format) {
      tick();
      // Background tabs delay timers, so catch up when the tab comes back.
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) tick();
      });
    }
  }

  // Phone menu.
  const menuButton = document.querySelector(".menu-button");
  const menu = document.getElementById("site-menu");
  if (menuButton && menu) {
    const isOpen = () => menuButton.getAttribute("aria-expanded") === "true";
    const setOpen = (open) => {
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.textContent = open ? "Close" : "Menu";
      menu.classList.toggle("is-open", open);
    };
    menuButton.addEventListener("click", () => setOpen(!isOpen()));
    menu.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("click", (e) => {
      if (isOpen() && !e.target.closest(".site-nav")) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) {
        setOpen(false);
        menuButton.focus();
      }
    });
  }

  // Home carousel.
  const carousel = document.querySelector(".carousel");
  if (carousel) setUpCarousel(carousel);

  function setUpCarousel(root) {
    const viewport = root.querySelector(".carousel-viewport");
    const slides = [...root.querySelectorAll(".carousel-slide")];
    const cards = slides.map((slide) => slide.querySelector(".carousel-card"));
    const caption = root.querySelector(".carousel-caption");
    const [prev, next] = root.querySelectorAll(".carousel-arrow");
    const wide = window.matchMedia("(min-width: 768px)");
    const last = slides.length - 1;
    let index = 0;
    let on = false;       // off while reduced motion shows the plain list instead
    let size = null;      // card width, gap, and neighbor scale/opacity, read from the CSS
    let drag = null;
    let justDragged = false;

    const measure = () => {
      const style = getComputedStyle(root);
      const read = (name) => parseFloat(style.getPropertyValue(name));
      size = {
        w: slides[0].offsetWidth,
        gap: read("--slide-gap"),
        scale: read("--side-scale"),
        dim: read("--side-opacity"),
        focus: wide.matches,
      };
    };

    // Distance from the main slot to the slot n places away.
    const slotX = (n) => {
      const { w, gap, scale, focus } = size;
      if (!focus) return n * (w + gap);
      if (n === 0) return 0;
      const side = w * scale;
      return Math.sign(n) * (w / 2 + gap + side / 2 + (Math.abs(n) - 1) * (side + gap));
    };

    // Lay out the slides for a position that may sit between two cards (while dragging).
    const place = (position) => {
      slides.forEach((slide, i) => {
        const f = i - position;
        const lo = Math.floor(f);
        const x = slotX(lo) + (slotX(lo + 1) - slotX(lo)) * (f - lo);
        const near = Math.min(Math.abs(f), 1);
        slide.style.transform = `translateX(${x}px) scale(${1 - (1 - size.scale) * near})`;
        slide.style.opacity = 1 - (1 - size.dim) * near;
      });
    };

    const go = (i, { focusCard = false } = {}) => {
      const target = Math.max(0, Math.min(last, i));
      const changed = target !== index;
      index = target;
      root.classList.remove("is-dragging");
      place(index);
      cards.forEach((card, n) => {
        card.tabIndex = n === index ? 0 : -1;
      });
      prev.setAttribute("aria-disabled", String(index === 0));
      next.setAttribute("aria-disabled", String(index === last));
      if (changed) {
        // When focus moves to the card, the screen reader reads it there; don't repeat it.
        caption.setAttribute("aria-live", focusCard ? "off" : "polite");
        caption.innerHTML = slides[index].querySelector(".slide-caption").innerHTML;
        caption.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
      }
      if (focusCard) cards[index].focus({ preventScroll: true });
    };

    // Re-lay out without animating (after a resize).
    const snap = () => {
      root.classList.add("is-dragging");
      place(index);
      void root.offsetWidth;
      root.classList.remove("is-dragging");
    };

    const start = () => {
      on = true;
      measure();
      snap();
      go(index);
    };

    const stop = () => {
      on = false;
      slides.forEach((slide) => {
        slide.style.transform = "";
        slide.style.opacity = "";
      });
      cards.forEach((card) => card.removeAttribute("tabindex"));
    };

    prev.addEventListener("click", () => go(index - 1));
    next.addEventListener("click", () => go(index + 1));

    // Click a neighbor to bring it to the middle; click the middle card to open it.
    root.addEventListener("click", (e) => {
      const card = e.target.closest(".carousel-card");
      if (!on || !card) return;
      if (justDragged) {
        e.preventDefault();
        return;
      }
      const i = cards.indexOf(card);
      if (i !== index && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
        e.preventDefault();
        go(i);
      }
    });

    // Left/right arrows work while focus is in the carousel or nowhere in particular.
    document.addEventListener("keydown", (e) => {
      if (!on || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const focused = document.activeElement;
      const inside = root.contains(focused);
      if (!inside && focused && focused !== document.body) return;
      const target = { ArrowLeft: index - 1, ArrowRight: index + 1 }[e.key]
        ?? (inside ? { Home: 0, End: last }[e.key] : undefined);
      if (target === undefined) return;
      e.preventDefault();
      go(target, { focusCard: cards.includes(focused) });
    });

    // Drag with a mouse, or swipe on touch screens (vertical swipes still scroll the page).
    cards.forEach((card) => {
      card.draggable = false;
    });
    viewport.addEventListener("dragstart", (e) => e.preventDefault());

    viewport.addEventListener("pointerdown", (e) => {
      if (!on || !e.isPrimary || e.button !== 0) return;
      drag = { id: e.pointerId, startX: e.clientX, dx: 0, moving: false,
               lastX: e.clientX, lastT: e.timeStamp, v: 0 };
    });

    viewport.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dx = e.clientX - drag.startX;
      if (!drag.moving) {
        if (Math.abs(drag.dx) < 8) return;
        drag.moving = true;
        viewport.setPointerCapture(e.pointerId);
        root.classList.add("is-dragging");
      }
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (e.clientX - drag.lastX) / dt;
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
      let position = index - drag.dx / slotX(1);
      if (position < 0) position /= 3;                                  // resist past the ends
      else if (position > last) position = last + (position - last) / 3;
      place(position);
    });

    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { dx, moving, lastT } = drag;
      const v = e.timeStamp - lastT < 100 ? drag.v : 0;
      drag = null;
      if (!moving) return;
      justDragged = true;
      setTimeout(() => {
        justDragged = false;
      }, 0);
      let target = Math.round(index - dx / slotX(1));
      if (target === index && Math.abs(v) > 0.3) target = index - Math.sign(v);  // a quick flick
      go(target);
    };
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    // Sideways trackpad swipes (or Shift + wheel) over the carousel move one card.
    // Plain up/down scrolling is never taken over.
    let wheelTotal = 0;
    let wheelLocked = false;
    let wheelTimer;
    viewport.addEventListener("wheel", (e) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
      const dx = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0) * unit;
      if (!on || !dx) return;
      e.preventDefault();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelTotal = 0;
        wheelLocked = false;
      }, 200);
      if (wheelLocked) return;
      wheelTotal += dx;
      if (Math.abs(wheelTotal) > 40) {
        wheelLocked = true;
        go(index + Math.sign(wheelTotal));
      }
    }, { passive: false });

    let resizeFrame;
    window.addEventListener("resize", () => {
      if (!on) return;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        measure();
        snap();
      });
    });

    const sync = () => (reduceMotion.matches ? stop() : start());
    reduceMotion.addEventListener("change", sync);
    sync();
  }

  // Work index: hovering (or focusing) a row shows its cover, or its video if there is one.
  const preview = document.querySelector(".work-preview");
  if (preview) {
    const items = [...preview.querySelectorAll(".work-preview-item")];
    let shown = null;
    const hide = () => {
      if (!shown) return;
      shown.classList.remove("is-active");
      const video = shown.querySelector("video");
      if (video) video.pause();
      shown = null;
    };
    const show = (item) => {
      if (shown === item) return;
      hide();
      if (!fineHover.matches) return;
      shown = item;
      item.classList.add("is-active");
      if (!item.dataset.video || reduceMotion.matches) return;
      let video = item.querySelector("video");
      if (!video) {
        video = document.createElement("video");
        video.src = item.dataset.video;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute("muted", "");
        item.appendChild(video);
      }
      video.play().catch(() => {});
    };
    document.querySelectorAll(".work-row").forEach((row) => {
      const item = items[Number(row.dataset.index)];
      row.addEventListener("mouseenter", () => show(item));
      row.addEventListener("mouseleave", hide);
      row.addEventListener("focus", () => show(item));
      row.addEventListener("blur", hide);
    });
  }

  if (reduceMotion.matches || !("IntersectionObserver" in window)) return;

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
