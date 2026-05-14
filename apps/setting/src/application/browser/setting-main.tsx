import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/packages/ui/styles/globals.css';
import SettingApp from './SettingApp';

createRoot(document.getElementById('app')!).render(<SettingApp />);
