import { StrictMode, lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import Landing from './Landing';
import './styles.css';

// The workstation (DuckDB, the canvas, CodeMirror) loads only when someone powers it on.
const App = lazy(() => import('./App'));

/* #/app opens the workstation; everything else is the landing page. */
function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => {
      setHash(location.hash);
      window.scrollTo({ top: 0 });
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.startsWith('#/app') ? (
    <Suspense fallback={<div className="boot-screen">FLOWFORGE OS · loading workstation…</div>}>
      <App />
    </Suspense>
  ) : (
    <Landing />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
