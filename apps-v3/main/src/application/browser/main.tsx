import React from 'react';
import { createRoot } from 'react-dom/client';
import '@telegraph/ui/styles/globals.css';
import App from '@telegraph/main/application/browser/App';

createRoot(document.getElementById('app')!).render(<App />);
