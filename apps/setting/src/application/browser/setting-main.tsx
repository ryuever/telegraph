import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/packages/ui/styles/globals.css';
import SettingApp from './SettingApp';
import { initializeTelegraphTheme } from '@/packages/ui/theme';

const rootEl = document.getElementById('app');
if (rootEl) {
  initializeTelegraphTheme();
  createRoot(rootEl).render(<SettingApp />);
}
