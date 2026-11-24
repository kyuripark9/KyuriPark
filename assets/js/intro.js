// Home's opening, the first time Home opens in a browser tab. On tracing paper since 2026-11-23
// (the user's moodboard): a sheet of vellum over the work and the header, the work soft under
// it; the logo's two suns drawn on it as orbits from the place where they meet, a dot riding
// each pen, a center line running out from the middle, the name rising in on it, the sentence
// under the drawing word by word; then the sheet lifts (its blur and tint going together, the
// drawing fading) and the work comes sharp. A click or tap, a key, or the wheel cuts it short.
// Later arrivals at Home come with the 300 ms fade between pages, as every page does; with
// reduced motion, or with storage blocked, there's no opening.
// (From 2026-11-10: a black screen, the name and then the sentence rising in, after
// mastak.framer.website; from 2026-11-09, About's first sentence, made of dots, blurring away as
// a cover of the page's color faded. Since 2026-11-10 Home is Work's grid, HOME_TRACK in
// build.py; Home's project track before.)
// Loaded at the end of Home's page, so it decides at once (style.css keeps the work hidden until
// then). The cover is built by build.py (home_intro) and removed here when the opening doesn't
// play.
(() => {
  const DELAY = 200;      // ms of the plain sheet first, once the name's font is in
  const DRAW = 1500;      // ms: each orbit drawn round from where they meet, back to it
  const NAME_AT = 450;    // ms into the drawing: the name's words start rising in
  const WORD_IN = 600;    // ms: a word rises into its place as it comes up from nothing
  const STAGGER = 100;    // ms between one word starting and the next
  const RISE = 0.8;       // em: how far under its place a word starts
  const LINE_AT = 1300;   // ms into the drawing: the sentence's words start rising in
  const READ = 900;       // ms the whole drawing and sentence stay, still, before the sheet lifts
  const LIFT = 1100;      // ms: the sheet lifts, the work comes sharp (about 4.6 s in all)
  const CUT = 300;        // ms it takes when the opening is cut short
  const FONT_WAIT = 2000; // ms at most to wait for the font
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";      // words: quick, then settling
  const EASE_LIFT = "cubic-bezier(0.65, 0, 0.35, 1)"; // the sheet: slow, quicker, slow
  const SEEN = "home-intro-seen";  // sessionStorage key

  const html = document.documentElement;
  const intro = document.querySelector(".intro");
  let play = false;
  try {
    play = Boolean(intro) && !sessionStorage.getItem(SEEN)
      && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    sessionStorage.setItem(SEEN, "1");
  } catch (e) {
    // Storage blocked: no opening, rather than one on every visit.
  }
  if (!play) {
    intro?.remove();
    html.classList.add("intro-done");
    return;
  }
  html.classList.add("intro-on");
  const stage = intro.querySelector(".intro-stage");
  const name = intro.querySelector(".intro-name");
  const role = intro.querySelector(".intro-role");
  const orbits = [...intro.querySelectorAll(".intro-orbit")];
  const pens = [...intro.querySelectorAll(".intro-pen")];
  const dots = [...intro.querySelectorAll(".intro-dot")];
  const after = [intro.querySelector(".intro-marks"), ...intro.querySelectorAll(".intro-key")];
  const words = (line) => [...line.children];

  let state = "on";  // then "lifting", then "done"
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fadeIn = (el, delay = 0) => el.animate({ opacity: [0, 1] },
    { duration: 500, delay, easing: "ease", fill: "both" });
  const rise = (line) => words(line).forEach((word, i) => word.animate(
    [{ opacity: 0, transform: `translateY(${RISE}em)` }, { opacity: 1, transform: "none" }],
    { duration: WORD_IN, delay: i * STAGGER, easing: EASE, fill: "both" }));

  // The two pens, together: slow out of the crossing, quicker round the far side, slow back
  // into it; each dot at its pen's tip, gone once its orbit is closed.
  const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const draw = () => new Promise((resolve) => {
    const lengths = orbits.map((path) => path.getTotalLength());
    dots.forEach((dot) => { dot.style.opacity = 1; });
    const start = performance.now();
    const step = (now) => {
      if (state === "done") return resolve();
      const t = Math.min(1, (now - start) / DRAW);
      const p = inOut(t);
      pens.forEach((pen) => { pen.style.strokeDashoffset = 1 - p; });
      orbits.forEach((path, i) => {
        const at = path.getPointAtLength(p * lengths[i]);
        dots[i].setAttribute("cx", at.x);
        dots[i].setAttribute("cy", at.y);
      });
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        dots.forEach((dot) => dot.animate({ opacity: [1, 0] },
          { duration: 300, easing: "ease", fill: "forwards" }));
        resolve();
      }
    };
    requestAnimationFrame(step);
  });

  const end = () => {
    if (state === "done") return;
    state = "done";
    removeEventListener("keydown", onKey, true);
    removeEventListener("wheel", cut);
    intro.remove();
    html.classList.remove("intro-on");
    html.classList.add("intro-done");
    document.dispatchEvent(new Event("intro:done"));  // track.js waits for it on phones
  };
  // The sheet lifts: its blur and its tint go together, the drawing on it fading, and the work
  // comes sharp. From here, input reaches the page.
  const lift = (time) => {
    if (state !== "on") return;
    state = "lifting";
    intro.style.pointerEvents = "none";
    document.dispatchEvent(new Event("intro:reveal"));  // track.js starts Home's cards turning
    const timing = { duration: time, easing: EASE_LIFT, fill: "forwards" };
    const style = getComputedStyle(intro);
    const blur = style.getPropertyValue("--intro-blur").trim() || "24px";
    stage.animate({ opacity: [1, 0] }, { ...timing, duration: time * 0.6 });
    intro.animate({
      backgroundColor: [style.backgroundColor, "rgb(238 237 232 / 0)"],
      backdropFilter: [`blur(${blur})`, "blur(0px)"],
      webkitBackdropFilter: [`blur(${blur})`, "blur(0px)"],
    }, timing).finished.then(end, end);
  };
  const cut = () => lift(CUT);
  // While the drawing is on, a key only cuts the opening short: the page doesn't move.
  const onKey = (e) => {
    if (state === "on") e.stopPropagation();
    cut();
  };
  addEventListener("keydown", onKey, true);
  addEventListener("wheel", cut, { passive: true });
  intro.addEventListener("pointerdown", cut);

  const style = getComputedStyle(name);
  const font = document.fonts
    ? document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
                          name.textContent).catch(() => {})
    : Promise.resolve();

  (async () => {
    await Promise.race([font, wait(FONT_WAIT)]);
    await wait(DELAY);
    if (state !== "on") return;
    intro.classList.add("is-drawing");  // the center line runs out (style.css)
    const drawn = draw();
    wait(NAME_AT).then(() => state === "on" && rise(name));
    wait(LINE_AT).then(() => state === "on" && rise(role));
    await drawn;
    if (state !== "on") return;
    after.forEach((el) => fadeIn(el));
    const lineDone = LINE_AT + WORD_IN + STAGGER * (words(role).length - 1);
    await wait(Math.max(0, lineDone - DRAW) + READ);
    lift(LIFT);
  })();
})();
