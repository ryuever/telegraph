// Phase 2 — DI Registry wiring.
// Adds orchestrator services on top of the Phase 1 baseline.
import { Registry } from '@x-oasis/di';

import { LogService, LogServiceId } from '@telegraph/core/log/LogService';
import {
  WindowManager,
  WindowManagerId,
} from '@telegraph/services/window-manager/electron-main/WindowManager';
import {
  AppOrchestrator,
  AppOrchestratorId,
} from '@telegraph/services/connection-orchestrator/electron-main/AppOrchestrator';
import {
  OrchestratorInspectorService,
  OrchestratorInspectorServiceId,
} from '@telegraph/services/connection-orchestrator/electron-main/OrchestratorInspectorService';
import {
  MainCpServer,
  MainCpServerId,
} from '@telegraph/services/connection-orchestrator/electron-main/MainCpServer';

import { TelegraphApplication, TelegraphApplicationId } from './telegraph-application';

export default new Registry((bind) => {
  bind(LogServiceId).to(LogService);
  bind(WindowManagerId).to(WindowManager);
  bind(AppOrchestratorId).to(AppOrchestrator);
  bind(OrchestratorInspectorServiceId).to(OrchestratorInspectorService);
  bind(MainCpServerId).to(MainCpServer);
  bind(TelegraphApplicationId).to(TelegraphApplication);
});
