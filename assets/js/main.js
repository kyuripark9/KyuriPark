// Enhancements on top of pages that already work without JavaScript:
// the header menu, Work's filter and card videos, the lightbox, and
// project-page motion (image fade-up, count-up numbers, looping videos). The home track is in track.js.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)");

  // Header menu: on phones, and at every width with the header-b class on <body>, where it
  // covers the page, so the page under it stops scrolling and leaves the Tab order.
  const menuButton = document.querySelector(".menu-button");
  const menu = document.getElementById("site-menu");
  if (menuButton && menu) {
    const isOpen = () => menuButton.getAttribute("aria-expanded") === "true";
    const setOpen = (open) => {
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.textContent = open ? "Close" : "Menu";
      menu.classList.toggle("is-open", open);
      const covering = open && document.body.classList.contains("header-b");
      document.documentElement.classList.toggle("menu-open", covering);
      document.querySelectorAll("main, .site-footer").forEach((el) => { el.inert = covering; });
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

  // Work: All or one category at a time, on one grid. The tiles fade out, the filter's tiles
  // come on numbered from 001, and they fade in. The address says which (#all, #digital, ...),
  // so a link opens that filter, Back and Forward step through the ones picked, and Back from
  // a project page returns to the same one.
  const workTabs = [...document.querySelectorAll(".work-tab")];
  if (workTabs.length) {
    const FADE_OUT = 150;  // ms
    const FADE_IN = 250;   // ms
    const tablist = workTabs[0].parentElement;
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
        if (!tile.hidden) tile.querySelector(".index").textContent = String(++n).padStart(3, "0");
      });
      empty.hidden = n > 0;
    };
    // The white pill sits under the tab picked, as wide as that tab. Where the tabs scroll
    // sideways, that tab comes into view.
    const placeThumb = () => {
      const tab = workTabs[filters.indexOf(wanted)];
      tablist.style.setProperty("--thumb-x", `${tab.offsetLeft}px`);
      tablist.style.setProperty("--thumb-w", `${tab.offsetWidth}px`);
      tablist.scrollLeft = tab.offsetLeft + (tab.offsetWidth - tablist.clientWidth) / 2;
    };
    const mark = (name) => {
      wanted = name;
      workTabs.forEach((tab) => {
        const on = tab.dataset.filter === name;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute("aria-labelledby", `tab-${name}`);
      placeThumb();
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

    // The filter the address names. No hash or an unknown one means All, and the address is
    // set to say so. A hash for a spot on the page (#contact, the skip link's #main) isn't a
    // filter at all: null, and the grid stays as it is.
    const addressFilter = () => {
      const hash = location.hash.slice(1);
      if (filters.includes(hash)) return hash;
      if (document.getElementById(hash)) return null;
      history.replaceState(history.state, "", "#all");
      return "all";
    };
    // A tab only changes the address; that's what switches the grid, so each pick is a step
    // for Back and Forward.
    window.addEventListener("hashchange", () => {
      const name = addressFilter();
      if (name) pick(name);
    });
    workTabs.forEach((tab) => tab.addEventListener("click", () => {
      location.hash = tab.dataset.filter;
    }));

    // Left and right arrows go along the tabs, looping at the ends; Home and End go to the
    // first and last. The tab they land on is picked. Only the picked tab is a Tab stop.
    tablist.addEventListener("keydown", (e) => {
      const last = workTabs.length - 1;
      const i = workTabs.indexOf(e.target);
      const to = { ArrowLeft: i ? i - 1 : last, ArrowRight: i === last ? 0 : i + 1, Home: 0, End: last }[e.key];
      if (to === undefined || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      workTabs[to].focus();
      workTabs[to].click();
    });

    const start = addressFilter() || "all";
    mark(start);
    show(start);
    // The pill keeps up if the tabs change size (the font loading, or a narrower window).
    const resized = new ResizeObserver(placeThumb);
    workTabs.forEach((tab) => resized.observe(tab));
    void tablist.offsetWidth;  // apply its first place before it can slide, so it doesn't slide in
    tablist.classList.add("is-ready");
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

  // Lightbox: a Work tile with no page of its own opens its item's images (copied from the
  // item's <template>). Esc, Close, or a click outside the images and caption closes it, and
  // focus goes back to that tile. Left/right arrow keys and buttons step through the items the
  // filter is showing, looping at the ends.
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
      images.replaceChildren(item.querySelector("template").content.cloneNode(true));
      name.innerHTML = item.querySelector(".work-name").innerHTML;
      meta.innerHTML = item.querySelector(".work-type").innerHTML;
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

    allThumbs.forEach((thumb) => thumb.addEventListener("click", () => {
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
