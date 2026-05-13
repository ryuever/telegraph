import React from 'react';
import { createRoot } from 'react-dom/client';
import '@telegraph/ui/styles/globals.css';
import SettingApp from './SettingApp';

createRoot(document.getElementById('app')!).render(<SettingApp />);
