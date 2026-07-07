// The landing page: light, centered hero in the site's Josefin/DM Sans
// system, a seal-prompt pill that hands off to the app, and the real
// explorer screenshot (public/app-preview.png) inside a browser frame
// rising from the bottom of the viewport.
export function renderLanding(root: HTMLElement): () => void {
  const previousTitle = document.title;
  document.title = 'Peal Network. Programmable disclosure';
  root.innerHTML = `
    <div class="landing">
      <nav class="landing-nav" aria-label="Landing navigation">
        <a class="landing-logo" href="#/"><img src="/peal-logo.svg" alt="" width="22" height="22" />Peal</a>
        <div class="landing-links">
          <a href="#/philosophy">Philosophy</a>
          <a href="#/app">Explorer</a>
        </div>
        <a class="landing-nav-cta" href="#/app">Launch App</a>
      </nav>

      <section class="landing-hero">
        <h1 class="landing-title" style="animation-delay:0.15s">Seal now.<br />Reveal on cue.</h1>

        <form class="landing-prompt" style="animation-delay:0.3s" aria-label="Seal something">
          <input type="text" id="landing-seal-input" placeholder="What should stay sealed?" autocomplete="off" />
          <button type="submit" aria-label="Seal it in the app">&#8593;</button>
        </form>

        <p class="landing-sub" style="animation-delay:0.45s">Seal bids, votes, and launch
        dates that open on schedule, all at once, verified in public. No second
        transaction, no strategic non-reveals.</p>

        <div class="landing-ctas" style="animation-delay:0.6s">
          <a class="landing-btn landing-btn-dark" href="#/app">Launch App</a>
        </div>

        <div class="landing-frame" style="animation-delay:0.75s">
          <div class="landing-frame-bar" aria-hidden="true">
            <span class="landing-dot landing-dot-red"></span>
            <span class="landing-dot landing-dot-yellow"></span>
            <span class="landing-dot landing-dot-green"></span>
            <span class="landing-frame-url">peal.network</span>
          </div>
          <img class="landing-shot-desktop" src="/app-preview.png"
            alt="The Peal explorer: seal a payload, watch the committee reveal it on cue" />
          <img class="landing-shot-mobile" src="/app-preview-mobile.png" loading="lazy"
            alt="The Peal explorer: seal a payload, watch the committee reveal it on cue" />
        </div>
      </section>
    </div>
  `;

  // The prompt is a handoff: whatever the visitor types rides the hash into
  // the app, where the playground waits with the real seal flow.
  const form = root.querySelector<HTMLFormElement>('.landing-prompt')!;
  const onSubmit = (event: Event) => {
    event.preventDefault();
    location.hash = '#/app';
  };
  form.addEventListener('submit', onSubmit);

  return () => {
    form.removeEventListener('submit', onSubmit);
    document.title = previousTitle;
  };
}
