// Home's intro, the first time Home opens in a browser tab: the page fades in, header and all,
// with nothing moving (as soren-template.framer.website does; the fade itself is in style.css,
// "Home intro"). Later arrivals at Home come with the 300 ms fade between pages instead, as every
// page does, so the two never stack. With reduced motion there's none.
// Loaded at the end of Home's page: it decides at once whether the fade plays (style.css keeps
// the page hidden until then).
(() => {
  const SEEN = "home-intro-seen";  // sessionStorage key
  const html = document.documentElement;
  let play = false;
  try {
    play = !sessionStorage.getItem(SEEN) && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    sessionStorage.setItem(SEEN, "1");
  } catch (e) {
    // Storage blocked: no fade, rather than one on every visit.
  }
  if (!play) {
    html.classList.add("intro-done");
    return;
  }
  html.classList.add("intro-on");
  const header = document.querySelector(".site-header");
  if (!header) {
    html.classList.add("intro-done");
    return;
  }
  header.addEventListener("animationend", () => {
    html.classList.add("intro-done");
    html.classList.remove("intro-on");
  }, { once: true });
})();
