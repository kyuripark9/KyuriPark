// Home's opening, the first time Home opens in a browser tab. Since 2026-11-24 (the user's asks,
// from their moodboard: a portrait seen through frosted paper with type printed on it, a card
// with a soft gray picture under it, their own blurred portrait): a sheet of tracing paper
// covers the whole window from the start, smooth and milky with a fine grain, the user's
// portrait under it as a print. The portrait comes up through the paper, only soft grays, its
// blur settling as if pressed closer to the sheet, and the sentence that says who this is is
// typed on the sheet, a letter at a time, the name and then the sentence under it, a caret at
// the next letter; then the portrait sinks back under the paper, the words fading, and the page
// is that paper: the work comes up on it. A click or tap, a key, or the wheel cuts it short.
// Later arrivals at Home come with the 300 ms fade between pages, as every page does; with
// reduced motion, or with storage blocked, there's no opening.
// (That morning: the portrait first, filling the window, then an A4 sheet sliding up over it
// and spreading to the edges, changed at the user's ask: the paper is there from the start;
// then the paper cloudy and the name on a center line drawn out to the window's edges, changed
// at the user's ask: the paper smooth, as in their pictures, the words shown plainly; then the
// words fading in together, changed at the user's ask: typed out.
// From 2026-11-23: a sheet of vellum over the work, the logo's two suns drawn on it as orbits,
// the name where they meet, then the sheet lifting; from 2026-11-10: a black screen, the name
// and then the sentence rising in, after mastak.framer.website; from 2026-11-09, About's first
// sentence, made of dots, blurring away as a cover of the page's color faded. Since 2026-11-10
// Home is Work's grid, HOME_TRACK in build.py; Home's project track before.)
// Loaded at the end of Home's page, so it decides at once (style.css keeps the work hidden until
// then). The cover is built by build.py (home_intro) and removed here when the opening doesn't
// play.
(() => {
  const DELAY = 200;      // ms of the sheet alone first, once the fonts and the portrait are in
  const PHOTO_IN = 1400;  // ms: the portrait comes up through the paper, its blur settling
  const TYPE_AT = 300;    // ms into that, the caret shows at the name's first letter
  const LEAD = 450;       // ms it waits there before the name is typed
  const NAME_KEY = 75;    // ms a letter of the name, on average (each 0.7 to 1.3 times that)
  const LINE_KEY = 30;    // ms a letter of the sentence, smaller type, so typed quicker
  const BREAK = 350;      // ms between the two, the caret at the sentence's first letter
  const READ = 1400;      // ms from the last letter, the caret blinking after it, to be read
  const SINK = 900;       // ms: the portrait sinks back under the paper, the words fading
  const OUT = 450;        // ms: then the page comes up on the paper, from 200 ms before the
                          // portrait is gone (about 5.7 s in all)
  const CUT = 300;        // ms it takes when the opening is cut short (it just fades)
  const FONT_WAIT = 2000; // ms at most to wait for the fonts and the portrait
  const FAR = 1.8;        // the portrait's blur, coming up and sinking back, as a multiple of its
                          // blur under the sheet (--intro-frost)
  const EASE_UP = "cubic-bezier(0.22, 1, 0.36, 1)";     // quick, then a long settle
  const EASE_SINK = "cubic-bezier(0.65, 0, 0.35, 1)";   // slow, quicker, slow
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
  const photo = intro.querySelector(".intro-photo");
  const img = photo.querySelector("img");
  const text = intro.querySelector(".intro-text");
  const lines = [...text.querySelectorAll(".intro-line")];

  let state = "on";  // then "leaving", then "done"
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Each line's letters, every one laid out from the start (style.css hides them until typed),
  // so a line doesn't move as it's typed.
  const fonts = lines.map((line) => {
    const style = getComputedStyle(line);
    return document.fonts
      ? document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
                            line.textContent).catch(() => {})
      : Promise.resolve();
  });
  const letters = lines.map((line) => {
    const chars = [...line.textContent].map((c) => {
      const span = document.createElement("span");
      span.className = "intro-char";
      span.textContent = c;
      return span;
    });
    line.replaceChildren(...chars);
    return chars;
  });

  // The caret, a little after the last letter typed (before the line's first, until there's
  // one), so it doesn't touch a letter that reaches past its own width: a thin upright, about
  // as thick as the letters' strokes, 1em tall, in the middle of the letter's height.
  const caret = document.createElement("span");
  caret.className = "intro-caret";
  text.append(caret);
  let at = null;  // [a line's letters, how many are typed]
  const place = () => {
    if (!at) return;
    const [chars, i] = at;
    const r = chars[Math.max(i - 1, 0)].getBoundingClientRect();
    const frame = text.getBoundingClientRect();
    const size = parseFloat(getComputedStyle(chars[0]).fontSize);
    const width = Math.max(1, Math.round(size * 0.07));  // about the mono's stroke
    const gap = size * 0.08;
    const x = (i > 0 ? r.right + gap : r.left - gap) - frame.left - width / 2;
    const y = r.top + (r.height - size) / 2 - frame.top;
    caret.style.width = `${width}px`;
    caret.style.height = `${size}px`;
    caret.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;  // crisp
  };
  const moveTo = (chars, i) => {
    at = [chars, i];
    place();
  };
  // Typing a line: steady, a letter at a time, the caret moving on; false if cut short.
  const type = async (chars, key) => {
    for (let i = 0; i < chars.length; i++) {
      await wait(key * (0.7 + 0.6 * Math.random()));
      if (state !== "on") return false;
      chars[i].classList.add("is-typed");
      moveTo(chars, i + 1);
    }
    return true;
  };
  // Waiting, the caret blinking; false if cut short.
  const pause = async (ms) => {
    caret.classList.add("is-idle");
    await wait(ms);
    caret.classList.remove("is-idle");
    return state === "on";
  };

  const end = () => {
    if (state === "done") return;
    state = "done";
    removeEventListener("keydown", onKey, true);
    removeEventListener("wheel", cut);
    removeEventListener("resize", place);
    intro.remove();
    html.classList.remove("intro-on");
    html.classList.add("intro-done");
    document.dispatchEvent(new Event("intro:done"));  // track.js waits for it on phones
  };
  // From here, input reaches the page.
  const leave = () => {
    if (state !== "on") return false;
    state = "leaving";
    intro.style.pointerEvents = "none";
    document.dispatchEvent(new Event("intro:reveal"));  // track.js starts Home's cards turning
    return true;
  };

  // The portrait's blur under the sheet, and farther under it (FAR), as filter values.
  const near = getComputedStyle(img).filter;
  const frost = parseFloat(/blur\(([\d.]+)px\)/.exec(near)?.[1]) || 40;
  const far = `blur(${(frost * FAR).toFixed(1)}px)`;

  // The portrait sinks back under the paper, the words fading; then the page comes up on it.
  const sink = () => {
    if (!leave()) return;
    const timing = { duration: SINK, easing: EASE_SINK, fill: "forwards" };
    text.animate({ opacity: [1, 0] }, { ...timing, duration: SINK * 0.6 });
    img.animate({ filter: [near, far] }, timing);
    photo.animate({ opacity: [getComputedStyle(photo).opacity, 0] }, timing);
    intro.animate({ opacity: [1, 0] }, { duration: OUT, delay: SINK - 200, easing: "ease",
      fill: "forwards" }).finished.then(end, end);
  };
  // Cut short: it all just fades.
  const cut = () => {
    if (!leave()) return;
    intro.animate({ opacity: [1, 0] }, { duration: CUT, easing: "ease", fill: "forwards" })
      .finished.then(end, end);
  };
  // While it's on, a key only cuts the opening short: the page doesn't move.
  const onKey = (e) => {
    if (state === "on") e.stopPropagation();
    cut();
  };
  addEventListener("keydown", onKey, true);
  addEventListener("wheel", cut, { passive: true });
  addEventListener("resize", place);
  intro.addEventListener("pointerdown", cut);

  const portrait = img?.decode ? img.decode().catch(() => {}) : Promise.resolve();

  (async () => {
    await Promise.race([Promise.all([...fonts, portrait]), wait(FONT_WAIT)]);
    await wait(DELAY);
    if (state !== "on") return;
    const timing = { duration: PHOTO_IN, easing: EASE_UP, fill: "forwards" };
    photo.animate({ opacity: [0, 1] }, timing);
    img.animate({ filter: [far, near] }, timing);
    await wait(TYPE_AT);
    if (state !== "on") return;
    const [name, sentence] = letters;
    moveTo(name, 0);
    caret.classList.add("is-on");
    if (!(await pause(LEAD)) || !(await type(name, NAME_KEY))) return;
    moveTo(sentence, 0);
    if (!(await pause(BREAK)) || !(await type(sentence, LINE_KEY))) return;
    if (!(await pause(READ))) return;
    caret.classList.add("is-idle");  // blinking still as it fades
    sink();
  })();
})();
