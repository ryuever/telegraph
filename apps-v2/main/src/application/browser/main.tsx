import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@telegraph/main/application/browser/App';

createRoot(document.getElementById('app')!).render(<App />);
