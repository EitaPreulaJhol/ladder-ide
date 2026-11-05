import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n.ts';
import './styles.css';
import { App } from './App.tsx';
import { applyTheme, getThemePref } from './theme.ts';
import { registerServiceWorker } from './pwa.ts';

// Apply the saved theme before the first render (no flash of the wrong theme).
applyTheme(getThemePref());
registerServiceWorker(() => window.dispatchEvent(new Event('ladder:update')));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
