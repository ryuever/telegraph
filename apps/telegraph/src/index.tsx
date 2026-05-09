import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@telegraph/ui/styles/globals.css';
import { App } from './App';
import { MonitorPanel } from '@monitor/application/browser/MonitorPanel';

const hash = window.location.hash.replace('#', '');
const isMonitor = hash === '/monitor';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');

createRoot(rootEl).render(
  <StrictMode>
    {isMonitor ? <MonitorPanel /> : <App />}
  </StrictMode>,
);
