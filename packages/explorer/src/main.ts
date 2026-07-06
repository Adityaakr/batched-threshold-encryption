import './style.css';
import { renderHome } from './pages/home';
import { renderCondition } from './pages/condition';
import { renderSealView } from './pages/seal-view';

type Cleanup = () => void;

let cleanup: Cleanup | null = null;

function route(): void {
  if (cleanup) cleanup();
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';
  const hash = location.hash || '#/';
  const seal = hash.match(/^#\/s\/([^/]+)\/([0-9a-f]{64})$/);
  const match = hash.match(/^#\/condition\/(.+)$/);
  if (seal) {
    cleanup = renderSealView(root, decodeURIComponent(seal[1]), seal[2]);
  } else if (match) {
    cleanup = renderCondition(root, decodeURIComponent(match[1]));
  } else {
    cleanup = renderHome(root);
  }
}

window.addEventListener('hashchange', route);
route();
