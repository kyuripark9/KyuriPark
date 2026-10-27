// Optional video behavior. The site works fully without JavaScript.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");

  // Home cards: if a card has a cover video, play it muted on hover or focus.
  document.querySelectorAll(".card[data-video]").forEach((card) => {
    const media = card.querySelector(".card-media");
    let video = null;
    let active = false;

    const start = () => {
      if (reduceMotion.matches || !canHover.matches) return;
      active = true;
      if (!video) {
        video = document.createElement("video");
        video.src = card.dataset.video;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "auto";
        video.setAttribute("aria-hidden", "true");
        media.appendChild(video);
      }
      video.play().then(() => {
        if (active) card.classList.add("is-playing");
      }).catch(() => {});
    };

    const stop = () => {
      active = false;
      card.classList.remove("is-playing");
      if (video) video.pause();
    };

    card.addEventListener("mouseenter", start);
    card.addEventListener("mouseleave", stop);
    card.addEventListener("focus", start);
    card.addEventListener("blur", stop);
  });

  // Project pages: videos marked "loop" play muted while on screen.
  // With reduced motion they keep their controls and wait for a click.
  const loops = document.querySelectorAll("video[data-loop]");
  if (!loops.length || reduceMotion.matches || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) target.play().catch(() => {});
      else target.pause();
    });
  }, { threshold: 0.25 });

  loops.forEach((video) => {
    video.controls = false;
    observer.observe(video);
  });
})();
