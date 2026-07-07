// Shared scroll-reveal: blocks marked `.scroll-reveal` start soft (blurred,
// slightly low, transparent — styles in style.css) and settle into focus.
// Blocks already in the viewport stagger in on mount; everything below the
// fold reveals as it scrolls into view, once. Under prefers-reduced-motion
// every block is shown immediately. Returns a cleanup function.
export function mountScrollReveal(root: HTMLElement): () => void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.scroll-reveal'));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let observer: IntersectionObserver | null = null;
  let raf = 0;

  if (reduceMotion.matches) {
    for (const block of blocks) block.classList.add('is-visible');
  } else {
    const fold = window.innerHeight;
    const onLoad = blocks.filter((block) => block.getBoundingClientRect().top < fold);
    const onScroll = blocks.filter((block) => !onLoad.includes(block));

    onLoad.forEach((block, index) => {
      block.style.transitionDelay = `${index * 110}ms`;
    });
    // Double rAF so the hidden starting styles are committed before the class
    // flips; otherwise the first paint would skip the transition entirely.
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        for (const block of onLoad) block.classList.add('is-visible');
      });
    });

    if (onScroll.length > 0) {
      // threshold 0 (not a ratio): sections taller than the viewport can
      // never reach a meaningful intersection ratio, so reveal on first touch.
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).classList.add('is-visible');
            observer?.unobserve(entry.target);
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0 },
      );
      for (const block of onScroll) observer.observe(block);
    }
  }

  return () => {
    cancelAnimationFrame(raf);
    observer?.disconnect();
  };
}
