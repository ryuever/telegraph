import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/packages/ui/styles/globals.css';
import App from '@/apps/main/application/browser/App';
import { initializeTelegraphTheme } from '@/packages/ui/theme';

const el = document.getElementById('app');
if (!el) throw new Error('Root element #app not found');
initializeTelegraphTheme();
createRoot(el).render(<App />);
