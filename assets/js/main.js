// Enhancements on top of pages that already work without JavaScript:
// the phone menu, Work previews, the Archive lightbox, and project-page motion
// (image fade-up, count-up numbers, looping videos). The home track is in track.js.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)");

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

  // Archive lightbox: a thumbnail opens its item's images (copied from the item's <template>).
  // Esc, Close, or a click outside the images and caption closes it, and focus goes back to
  // the grid. Left/right arrow keys and buttons step through the items, looping at the ends.
  const lightbox = document.getElementById("lightbox");
  const thumbs = [...document.querySelectorAll(".archive-thumb")];
  if (lightbox && thumbs.length) {
    document.body.append(lightbox);  // out of <main>, so the rest of the page can go inert
    const stage = lightbox.querySelector(".lightbox-stage");
    const images = lightbox.querySelector(".lightbox-images");
    const name = lightbox.querySelector(".lightbox-name");
    const meta = lightbox.querySelector(".lightbox-meta");
    const closeButton = lightbox.querySelector(".lightbox-close");
    let current = -1;  // the item shown, or -1 when closed
    let hiding;

    // Several images can run taller than the screen; then the stage takes a Tab stop
    // so the keyboard can scroll it.
    const fit = () => {
      stage.tabIndex = stage.scrollHeight > stage.clientHeight ? 0 : -1;
    };
    const show = (index) => {
      current = (index + thumbs.length) % thumbs.length;
      const item = thumbs[current].closest(".archive-item");
      images.replaceChildren(item.querySelector("template").content.cloneNode(true));
      name.innerHTML = item.querySelector(".archive-name").innerHTML;
      meta.innerHTML = item.querySelector(".archive-meta").innerHTML;
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

    thumbs.forEach((thumb, i) => thumb.addEventListener("click", () => open(i)));
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
