import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { bootOnce } from './app/boot';

// Boot is async: a `#/r/<codec>.<payload>` link may need `DecompressionStream`. Start it
// before the first paint, and let the shell render its one-frame splash until it settles
// — a half-decoded config must never reach the screen.
void bootOnce();

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
