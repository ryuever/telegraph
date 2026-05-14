import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/packages/ui/styles/globals.css';
import App from '@/apps/main/application/browser/App';

createRoot(document.getElementById('app')!).render(<App />);
