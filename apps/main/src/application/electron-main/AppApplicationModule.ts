import { Registry } from '@x-oasis/di';

import {
  MainCpServer,
  MainCpServerId,
} from '@/apps/main/application/electron-main/MainCpServer';
import {
  WindowManager,
  WindowManagerId,
} from '@/apps/main/application/electron-main/WindowManager';
import {
  DaemonProcess,
  DaemonProcessId,
} from '@/apps/daemon/application/electron-main/DaemonProcess';
import {
  DaemonApplication,
  DaemonApplicationId,
} from '@/apps/daemon/application/node/DaemonApplication';
import {
  SharedProcess,
  SharedProcessId,
} from '@/apps/shared/application/electron-main/SharedProcess';
import {
  SharedApplication,
  SharedApplicationId,
} from '@/apps/shared/application/node/SharedApplication';
import {
  PageletProcess,
  PageletProcessId,
} from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import {
  AppOrchestrator,
  AppOrchestratorId,
} from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import {
  ConnectionApplication,
  ConnectionApplicationId,
} from '@/apps/connection/application/node/ConnectionApplication';
import {
  MonitorApplication,
  MonitorApplicationId,
} from '@/apps/monitor/application/electron-main/MonitorApplication';
import {
  SettingApplication,
  SettingApplicationId,
} from '@/apps/setting/application/electron-main/SettingApplication';
import {
  DesignApplication,
  DesignApplicationId,
} from '@/apps/design/application/electron-main/DesignApplication';
import {
  ChatApplication,
  ChatApplicationId,
} from '@/apps/chat/application/electron-main/ChatApplication';
import {
  AppApplication,
  AppApplicationId,
} from '@/apps/main/application/electron-main/AppApplication';
import {
  MainMetricsService,
  MainMetricsServiceId,
} from '@/packages/services/main-metrics/electron-main/MainMetricsService';
import {
  PidNameRegistry,
  PidNameRegistryId,
} from '@/packages/services/main-metrics/common';

export default new Registry((bind) => {
  bind(WindowManagerId).to(WindowManager);
  bind(MainCpServerId).to(MainCpServer);

  bind(DaemonProcessId).to(DaemonProcess);
  bind(DaemonApplicationId).to(DaemonApplication);

  bind(SharedProcessId).to(SharedProcess);
  bind(SharedApplicationId).to(SharedApplication);

  bind(PageletProcessId).to(PageletProcess);
  bind(AppOrchestratorId).to(AppOrchestrator);
  bind(PidNameRegistryId).to(PidNameRegistry);
  bind(MainMetricsServiceId).to(MainMetricsService);
  bind(ConnectionApplicationId).to(ConnectionApplication);
  bind(MonitorApplicationId).to(MonitorApplication);
  bind(SettingApplicationId).to(SettingApplication);
  bind(DesignApplicationId).to(DesignApplication);
  bind(ChatApplicationId).to(ChatApplication);

  bind(AppApplicationId).to(AppApplication);
});
