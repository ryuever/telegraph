// Phase 4 — DI Registry wiring.
// Adds SharedProcess and DaemonProcess on top of Phase 3 baseline.
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
import {
  DesignPageletProcess,
  DesignPageletProcessId,
} from '@telegraph/services/connection-orchestrator/electron-main/DesignPageletProcess';
import {
  SharedProcess,
  SharedProcessId,
} from '@telegraph/services/connection-orchestrator/electron-main/SharedProcess';
import {
  DaemonProcess,
  DaemonProcessId,
} from '@telegraph/services/connection-orchestrator/electron-main/DaemonProcess';

import { TelegraphApplication, TelegraphApplicationId } from './telegraph-application';

export default new Registry((bind) => {
  bind(LogServiceId).to(LogService);
  bind(WindowManagerId).to(WindowManager);
  bind(AppOrchestratorId).to(AppOrchestrator);
  bind(OrchestratorInspectorServiceId).to(OrchestratorInspectorService);
  bind(MainCpServerId).to(MainCpServer);
  bind(DesignPageletProcessId).to(DesignPageletProcess);
  bind(SharedProcessId).to(SharedProcess);
  bind(DaemonProcessId).to(DaemonProcess);
  bind(TelegraphApplicationId).to(TelegraphApplication);
});
