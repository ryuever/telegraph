// Phase 1 — DI Registry wiring.
// Keeps the binding list small on purpose; Phase 2+ adds orchestrator services.
import { Registry } from '@x-oasis/di';

import { LogService, LogServiceId } from '@telegraph/core/log/LogService';
import {
  WindowManager,
  WindowManagerId,
} from '@telegraph/services/window-manager/electron-main/WindowManager';

import { TelegraphApplication, TelegraphApplicationId } from './telegraph-application';

export default new Registry((bind) => {
  bind(LogServiceId).to(LogService);
  bind(WindowManagerId).to(WindowManager);
  bind(TelegraphApplicationId).to(TelegraphApplication);
});
