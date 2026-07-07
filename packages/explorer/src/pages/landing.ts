// The landing page: a full-screen dark hero over a Spline 3D scene, content
// anchored bottom-left, staggered blur-fade entrance. Sora for everything
// here (the landing is its own visual world; the app keeps Josefin/DM Sans).
// The Spline runtime is lazy-imported so app pages never pay for it, and the
// scene is decorative: if it fails to load, the dark hero stands alone.
export function renderLanding(root: HTMLElement): () => void {
  const previousTitle = document.title;
  document.title = 'Peal Network. Programmable disclosure';
  root.innerHTML = `
    <div class="landing">
      <nav class="landing-nav" aria-label="Landing navigation">
        <a class="landing-logo" href="#/">PEAL</a>
        <div class="landing-links">
          <a href="#/philosophy">Philosophy</a>
          <a href="#/protocol">Protocol</a>
          <a href="#/app">Explorer</a>
          <a href="https://github.com/Adityaakr/peal-network" target="_blank" rel="noopener">Code</a>
        </div>
        <a class="landing-nav-cta" href="#/app">Launch App</a>
      </nav>

      <section class="landing-hero">
        <div class="landing-scene" aria-hidden="true"><canvas id="landing-canvas"></canvas></div>
        <div class="landing-overlay" aria-hidden="true"></div>
        <div class="landing-content">
          <h1 class="landing-title" style="animation-delay:0.2s">Peal <span>Network</span></h1>
          <p class="landing-sub" style="animation-delay:0.4s">Encryption that opens on schedule, guaranteed.</p>
          <p class="landing-desc" style="animation-delay:0.55s">Seal bids, votes, moves, and
          intents to a threshold committee that no single operator controls. When the
          deadline fires, the entire batch opens at once, every share verified in public.
          No second transaction, no strategic non-reveals, usable in ten lines of
          TypeScript.</p>
          <div class="landing-ctas" style="animation-delay:0.7s">
            <a class="landing-btn landing-btn-primary" href="#/app">Launch App</a>
            <a class="landing-btn landing-btn-light" href="#/protocol">Read the Protocol</a>
          </div>
          <p class="landing-trust" style="animation-delay:0.85s">Batched threshold
          encryption. 5-operator committee, any 3 reveal. Public devnet live.</p>
        </div>
      </section>
    </div>
  `;

  let app: { dispose(): void } | null = null;
  let cancelled = false;
  const canvas = root.querySelector<HTMLCanvasElement>('#landing-canvas')!;
  void import('@splinetool/runtime')
    .then(({ Application }) => {
      if (cancelled) return;
      const instance = new Application(canvas);
      app = instance;
      void instance.load('https://prod.spline.design/Slk6b8kz3LRlKiyk/scene.splinecode').catch(() => {});
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    app?.dispose();
    document.title = previousTitle;
  };
}
