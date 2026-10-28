// Enhancements on top of pages that already work without JavaScript:
// the header clock, the phone menu, Work previews, and project-page motion
// (image fade-up, count-up numbers, looping videos). The home track is in track.js.
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
