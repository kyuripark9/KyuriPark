// Enhancements on top of pages that already work without JavaScript:
// the phone menu, Work's Selected / Archive and card videos, the Archive lightbox, and
// project-page motion (image fade-up, count-up numbers, looping videos). The home track is in track.js.
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

  // Work: Selected or the Archive, one grid at a time, switched like Home's toggle (track.js):
  // the grid fades out, the other comes on and fades in, and the address says which
  // (#selected, #archive), so Back from a project page returns to the same one.
  const workTabs = [...document.querySelectorAll(".work-tab")];
  if (workTabs.length) {
    const FADE_OUT = 150;  // ms
    const FADE_IN = 250;   // ms
    const grids = document.querySelector(".work-panels");
    const panels = new Map(workTabs.map((tab) => {
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      // New ids, so the browser doesn't jump down to #archive on its own. (Without
      // JavaScript, "Archive 06 →" and "← Selected" are links to these.)
      panel.id = `panel-${tab.dataset.group}`;
      tab.setAttribute("aria-controls", panel.id);
      return [tab.dataset.group, panel];
    }));
    let shown;           // the grid on screen
    let wanted;          // the grid picked last (it's on screen once a fade-out ends)
    let fade = null;     // the fade under way
    let fadingOut = false;
    let toTop = false;   // scroll up to the tabs when the grids swap

    const show = (name) => {
      shown = name;
      panels.forEach((panel, key) => { panel.hidden = key !== name; });
      if (toTop) window.scrollTo(0, 0);
      toTop = false;
    };
    const mark = (name) => {
      wanted = name;
      workTabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.group === name)));
    };

    // Picking again while the grid fades out changes what comes on; while one fades in,
    // it fades out from there.
    const pick = (name) => {
      if (!panels.has(name)) return;
      mark(name);
      history.replaceState(history.state, "", `#${name}`);
      if (reduceMotion.matches) {
        fade?.cancel();
        fadingOut = false;
        show(name);
        return;
      }
      if (fadingOut) return;
      if (name === shown) {
        toTop = false;
        return;
      }
      const from = Number(getComputedStyle(grids).opacity);
      fade?.cancel();
      fadingOut = true;
      fade = grids.animate({ opacity: [from, 0] },
        { duration: FADE_OUT * from, easing: "ease-in", fill: "forwards" });
      fade.onfinish = () => {
        fadingOut = false;
        show(wanted);
        fade.cancel();
        fade = grids.animate({ opacity: [0, 1] }, { duration: FADE_IN, easing: "ease-out" });
      };
    };

    workTabs.forEach((tab) => tab.addEventListener("click", () => pick(tab.dataset.group)));
    // "Archive 06 →" after the projects and "← Selected" after the Archive: the grids swap,
    // the page goes back up to the top, and focus moves to the tab (the link is gone).
    document.querySelectorAll(".work-to-archive, .work-back").forEach((link) => {
      link.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const name = link.hash.slice(1);
        toTop = true;
        pick(name);
        workTabs.find((tab) => tab.dataset.group === name).focus({ preventScroll: true });
      });
    });
    // A link or a typed address naming a grid (none: Selected).
    window.addEventListener("hashchange", () => pick(location.hash.slice(1) || "selected"));

    const start = panels.has(location.hash.slice(1)) ? location.hash.slice(1) : "selected";
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

  // Archive lightbox: a thumbnail on Work, or the middle Archive card on Home, opens its item's
  // images (copied from the item's <template>). Esc, Close, or a click outside the images and
  // caption closes it, and focus goes back to that item's thumbnail or card. Left/right arrow
  // keys and buttons step through the items, looping at the ends.
  const lightbox = document.getElementById("lightbox");
  const thumbs = [...document.querySelectorAll("[data-item]")];  // one per item, in order
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
      const item = thumbs[current].closest("li");
      images.replaceChildren(item.querySelector("template").content.cloneNode(true));
      name.innerHTML = item.querySelector(".archive-name, .card-title").innerHTML;
      meta.innerHTML = item.querySelector(".archive-meta, .card-text").innerHTML;
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
      // On Home, track.js brings that card to the middle.
      thumbs[current].dispatchEvent(new Event("lightboxclose", { bubbles: true }));
      current = -1;
      hiding = setTimeout(() => {
        lightbox.hidden = true;
        images.replaceChildren();
      }, reduceMotion.matches ? 0 : 200);
    };

    // Caught here rather than on each thumbnail because track.js copies the Home cards.
    // track.js cancels the click on a side card (that card comes to the middle instead).
    document.addEventListener("click", (e) => {
      const thumb = e.target.closest("[data-item]");
      if (thumb && !e.defaultPrevented) open(Number(thumb.dataset.item));
    });
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
