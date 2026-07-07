import './style.css';
import { renderHome } from './pages/home';
import { renderCondition } from './pages/condition';
import { renderLanding } from './pages/landing';
import { renderPhilosophy } from './pages/philosophy';
import { renderProtocol } from './pages/protocol';
import { renderSealView } from './pages/seal-view';

type Cleanup = () => void;

let cleanup: Cleanup | null = null;

function route(): void {
  if (cleanup) cleanup();
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';
  const hash = location.hash || '#/';
  // The landing owns the root and brings its own chrome; body.landing-page
  // hides the standard site header and unclamps <main> (see style.css).
  const isLanding = hash === '#/' || hash === '#';
  document.body.classList.toggle('landing-page', isLanding);
  const seal = hash.match(/^#\/s\/([^/]+)\/([0-9a-f]{64})(?:\/([A-Za-z0-9_-]{16,64}))?$/);
  const match = hash.match(/^#\/condition\/(.+)$/);
  if (seal) {
    cleanup = renderSealView(root, decodeURIComponent(seal[1]), seal[2], seal[3]);
  } else if (match) {
    cleanup = renderCondition(root, decodeURIComponent(match[1]));
  } else if (hash === '#/protocol') {
    cleanup = renderProtocol(root);
  } else if (hash === '#/philosophy') {
    cleanup = renderPhilosophy(root);
  } else if (isLanding) {
    cleanup = renderLanding(root);
  } else {
    cleanup = renderHome(root);
  }
}

window.addEventListener('hashchange', route);
route();
