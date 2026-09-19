import { lazy, Suspense, useEffect } from 'react';
import { useKitchen, installControls } from './game.js';
import './style.css';

const Kitchen = lazy(() => import('./Kitchen.jsx'));
const Bench = lazy(() => import('./Bench.jsx'));

export default function App() {
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => useKitchen.setState({ reducedMotion: media.matches });
    motion();
    media.addEventListener('change', motion);
    const cleanup = installControls();
    return () => {
      cleanup();
      media.removeEventListener('change', motion);
    };
  }, []);
  if (location.pathname === '/bench')
    return (
      <Suspense fallback={<p>jev-benchを準備しています…</p>}>
        <Bench />
      </Suspense>
    );
  return (
    <main className="app-shell" aria-label="SIDEKICK kitchen">
      <div id="ui-access" />
      <a className="bench-link" href="/bench">
        jev-bench
      </a>
      <Suspense
        fallback={
          <div className="graphics-error" role="status">
            キッチンを準備しています…
          </div>
        }
      >
        <Kitchen />
      </Suspense>
    </main>
  );
}
