import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/packages/ui/styles/globals.css';
import SettingApp from './SettingApp';

const rootEl = document.getElementById('app');
if (rootEl) {
  createRoot(rootEl).render(<SettingApp />);
}
