// Enhancements on top of pages that already work without JavaScript:
// Work's views, filter, and card videos, the lightbox, and project-page motion (image fade-up,
// count-up numbers, looping videos). (Display type broke into dots under the pointer from
// 2026-11-07 to 2026-11-11; see the README.) The track (Home's, or Work's slider) is in track.js.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)");

  // Work: two views of the same items, GRID and SLIDER (WORK_VIEWS in build.py, since
  // 2026-11-10), or RING and GRID (WORK_RING, since 2026-11-12), one at a time: the one showing
  // fades out, and the other fades in. The pick is remembered in this browser, so Back from a
  // project page, or a later visit, opens the same view (work.html's script applies it before
  // the page shows). The slider is the track, which track.js sizes once it shows; the ring,
  // ring.js's.
  const viewButtons = [...document.querySelectorAll(".work-views [data-view]")];
  if (viewButtons.length) {
    const FADE_OUT = 150;  // ms, as the filters'
    const FADE_IN = 250;   // ms
    const KEY = "work-view";  // localStorage
    const html = document.documentElement;
    const panes = { grid: document.getElementById("work-panel"),
                    slider: document.querySelector(".page-work .track"),
                    ring: document.querySelector(".page-work .ring") };
    const others = ["slider", "ring"];  // a class on <html> for each: view-slider, view-ring
    let shown = others.find((name) => html.classList.contains(`view-${name}`)) || "grid";
    let wanted = shown;
    let fade = null;

    const mark = (name) => viewButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.view === name));
    });
    const show = (name) => {
      shown = name;
      others.forEach((other) => html.classList.toggle(`view-${other}`, name === other));
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    // Picking again while one fades out changes what comes on; picking the one showing then
    // keeps it.
    const pick = (name) => {
      if (name === wanted) return;
      wanted = name;
      mark(name);
      try {
        localStorage.setItem(KEY, name);
      } catch (e) {
        // Storage blocked: the pick holds until the page is left.
      }
      fade?.cancel();
      fade = null;
      if (reduceMotion.matches || name === shown) {
        show(name);
        return;
      }
      fade = panes[shown].animate({ opacity: [1, 0] },
        { duration: FADE_OUT, easing: "ease-in", fill: "forwards" });
      fade.onfinish = () => {
        fade.cancel();
        show(wanted);
        fade = panes[wanted].animate({ opacity: [0, 1] }, { duration: FADE_IN, easing: "ease-out" });
      };
    };
    viewButtons.forEach((button) => button.addEventListener("click", () => pick(button.dataset.view)));
    mark(shown);
  }

  // Work: All or one category at a time, on one grid. The tiles fade out, the filter's tiles
  // come on, and they fade in. The address says which (#all, #digital, ...),
  // so a link opens that filter, Back and Forward step through the ones picked, and Back from
  // a project page returns to the same one.
  const workTabs = [...document.querySelectorAll(".work-tab[data-filter]")];
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
      // On screen: not under a filter that's off, nor in the view that's not showing (Work's
      // grid and slider each have a button per item with no page).
      thumbs = allThumbs.filter((other) => other.getClientRects().length > 0);
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
