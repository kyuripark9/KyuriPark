// Home's opening, the first time Home opens in a browser tab (since 2026-11-09): over the work
// and the header (they come in together as the cover fades), a cover of the page's own color
// with About's first sentence where About has it ("Kyuri is a product designer working where
// digital meets everyday life"). The sentence comes into focus with About's pass going through
// its dots once, and once they're still it starts to blur away, slowly at first, and halfway the
// cover starts to fade, showing the work: the preloader on titarvl.framer.website (into focus
// from a 10px blur, held, blurred away, then the cover goes), in the page's color and with the
// dust. A click or tap on it, a key, or the wheel cuts it short. Later arrivals at Home come with
// the 300 ms fade between pages, as every page does; with reduced motion, or with storage blocked,
// there's no opening.
// Loaded at the end of Home's page, so it decides at once (style.css keeps the work hidden until
// then). The dust is main.js's dust(), waiting: this cues its pass ("dust:pass" on the sentence's
// box) and hears when the dots are still ("dust:still"). The cover is built by build.py
// (home_intro) and removed here when the opening doesn't play.
// The pass goes as the sentence comes in, not once it's in focus (until 2026-11-09): then it
// broke the sentence just as it was being read, and it went soon after the dots were back.
// Nor does the sentence then sit still for long (it did for 1.8 s, on the evening of 2026-11-09,
// which didn't read as an opening): it's read as it starts to go, and the work comes in under it.
(() => {
  const DELAY = 200;      // ms of the plain cover first, once the sentence's font is in
  const IN = 500;         // ms: the sentence comes into focus
  const WAIT = 3000;      // ms at most, from the start, for the pass to end and the dots to be
                          // still (a pointer playing with them keeps them going)
  const READ = 300;       // ms the sentence stays, whole and still, before it starts to go
  const OUT = 2000;       // ms: it blurs and fades away, slowly at first, so it's still read
  const REVEAL_AT = 1000; // ms into that the cover starts to fade, the work coming in under it
  const REVEAL = 1200;    // ms: the cover fades and the work shows (about 4.5 s in all on a
                          // laptop; titarvl's takes 3.7 s)
  const CUT = 250;        // ms the cover takes to go when the opening is cut short
  const BLUR = 10;        // px: how blurred the sentence is at both ends
  const FONT_WAIT = 2000; // ms at most to wait for the font
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
  const hero = intro.querySelector(".intro-hero");
  const line = intro.querySelector(".about-headline");

  let state = "on";  // then "revealing", then "done"
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const blurred = { opacity: 0, filter: `blur(${BLUR}px)` };
  const sharp = { opacity: 1, filter: "blur(0px)" };

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
  // The cover fades and the work shows. From here, input reaches the page.
  const reveal = (time) => {
    if (state !== "on") return;
    state = "revealing";
    intro.style.pointerEvents = "none";
    intro.animate({ opacity: [1, 0] }, { duration: time, easing: "ease-in-out", fill: "forwards" })
      .finished.then(end, end);
  };
  const cut = () => reveal(CUT);
  // While the sentence is on, a key only cuts the opening short: the row doesn't move.
  const onKey = (e) => {
    if (state === "on") e.stopPropagation();
    cut();
  };
  addEventListener("keydown", onKey, true);
  addEventListener("wheel", cut, { passive: true });
  intro.addEventListener("pointerdown", cut);

  const style = getComputedStyle(line);
  const font = document.fonts
    ? document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
                          line.textContent).catch(() => {})
    : Promise.resolve();

  (async () => {
    await Promise.race([font, wait(FONT_WAIT)]);
    await wait(DELAY);
    if (state !== "on") return;
    // Into focus, and the pass with it. data-cue tells main.js to pass on its own, should it run
    // only after this.
    const still = new Promise((resolve) => hero.addEventListener("dust:still", resolve, { once: true }));
    hero.animate([blurred, sharp], { duration: IN, easing: "ease-out", fill: "forwards" });
    hero.dataset.cue = "pass";
    hero.dispatchEvent(new Event("dust:pass"));
    await Promise.race([Promise.all([still, wait(IN)]), wait(WAIT)]);
    await wait(READ);
    if (state !== "on") return;
    hero.animate([sharp, blurred], { duration: OUT, easing: "ease-in", fill: "forwards" });
    await wait(REVEAL_AT);
    reveal(REVEAL);
  })();
})();
