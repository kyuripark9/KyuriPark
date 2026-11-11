// Home's opening, the first time Home opens in a browser tab (since 2026-11-10, after
// mastak.framer.website): a black screen over the work and the header, the name in its middle,
// each word rising in, then the name rising away as the role takes its place the same way, and
// then the black fading away, showing the page (mastak's opens from the middle in a growing
// shape; a circle doing that, then the black lifting away with a gradient edge, were tried the
// same day). A click or tap, a key, or the wheel cuts it short. Later arrivals at Home come with the 300 ms fade between pages, as every page
// does; with reduced motion, or with storage blocked, there's no opening.
// (From 2026-11-09: About's first sentence, made of dots, blurring away as a cover of the page's
// color faded. Since 2026-11-10 Home is Work's grid, HOME_TRACK in build.py; Home's project track
// before.)
// Loaded at the end of Home's page, so it decides at once (style.css keeps the work hidden until
// then). The cover is built by build.py (home_intro) and removed here when the opening doesn't
// play.
(() => {
  const DELAY = 200;      // ms of the plain black screen first, once the name's font is in
  const WORD_IN = 600;    // ms: a word rises into its place as it comes up from nothing
  const STAGGER = 100;    // ms between one word starting and the next
  const RISE = 0.8;       // em: how far under its place a word starts, and how far up the name goes
  const HOLD = 500;       // ms the name stays, whole, before the role takes its place
  const SWAP = 400;       // ms: the name rises away and fades
  const ROLE_AT = 120;    // ms into that the role's first word starts in
  const READ = 700;       // ms the role stays, whole, before the page opens
  const OPEN = 950;       // ms: the black fades away, showing the page (about 3.9 s in all,
                          // made faster twice from the 4.9 s it took first on 2026-11-10;
                          // mastak's takes about 4)
  const CUT = 300;        // ms it takes when the opening is cut short
  const FONT_WAIT = 2000; // ms at most to wait for the font
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";      // words: quick, then settling
  const EASE_OPEN = "ease-in-out";                    // the black's fade
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
  const lines = intro.querySelector(".intro-lines");
  const name = intro.querySelector(".intro-name");
  const words = (line) => [...line.children];

  let state = "on";  // then "revealing", then "done"
  let edge = null;   // the room kept for a scrollbar, black with the cover (style.css), fading with it
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rise = (line) => words(line).forEach((word, i) => word.animate(
    [{ opacity: 0, transform: `translateY(${RISE}em)` }, { opacity: 1, transform: "none" }],
    { duration: WORD_IN, delay: i * STAGGER, easing: EASE, fill: "both" }));
  const risen = (line) => WORD_IN + STAGGER * (words(line).length - 1);

  const end = () => {
    if (state === "done") return;
    state = "done";
    removeEventListener("keydown", onKey, true);
    removeEventListener("wheel", cut);
    intro.remove();
    edge?.cancel();
    html.classList.remove("intro-on");
    html.classList.add("intro-done");
    document.dispatchEvent(new Event("intro:done"));  // track.js waits for it on phones
  };
  // The black fades away, the name or role on it too, showing the page. From here, input
  // reaches the page.
  const reveal = (time) => {
    if (state !== "on") return;
    state = "revealing";
    intro.style.pointerEvents = "none";
    const timing = { duration: time, easing: EASE_OPEN, fill: "forwards" };
    edge = html.animate({ backgroundColor: [getComputedStyle(html).backgroundColor,
                                            getComputedStyle(document.body).backgroundColor] }, timing);
    intro.animate({ opacity: [1, 0] }, timing).finished.then(end, end);
  };
  const cut = () => reveal(CUT);
  // While the name and role are on, a key only cuts the opening short: the page doesn't move.
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
                          lines.textContent).catch(() => {})
    : Promise.resolve();

  (async () => {
    await Promise.race([font, wait(FONT_WAIT)]);
    await wait(DELAY);
    if (state !== "on") return;
    rise(name);
    await wait(risen(name) + HOLD);
    if (state !== "on") return;
    name.animate([{ opacity: 1, transform: "none" },
                  { opacity: 0, transform: `translateY(-${RISE}em)` }],
                 { duration: SWAP, easing: EASE, fill: "forwards" });
    await wait(ROLE_AT);
    if (state !== "on") return;
    const role = intro.querySelector(".intro-role");
    rise(role);
    await wait(risen(role) + READ);
    reveal(OPEN);
  })();
})();
