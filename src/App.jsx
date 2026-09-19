import { lazy, Suspense, useEffect } from 'react';
import { useKitchen, installControls } from './game.js';
import './style.css';

const Kitchen = lazy(() => import('./Kitchen.jsx'));

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
  return (
    <main className="app-shell" aria-label="SIDEKICK kitchen">
      <div id="ui-access" />
      <Suspense
        fallback={
          <div className="sr-only" role="status">
            キッチンを準備しています…
          </div>
        }
      >
        <Kitchen />
      </Suspense>
    </main>
  );
}
