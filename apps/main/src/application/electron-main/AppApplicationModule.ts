import { Registry } from '@x-oasis/di';

import {
  MainCpServer,
  MainCpServerId,
} from '@telegraph/main/application/electron-main/MainCpServer';
import {
  WindowManager,
  WindowManagerId,
} from '@telegraph/main/application/electron-main/WindowManager';
import {
  DaemonProcess,
  DaemonProcessId,
} from '@telegraph/daemon/application/electron-main/DaemonProcess';
import {
  DaemonApplication,
  DaemonApplicationId,
} from '@telegraph/daemon/application/node/DaemonApplication';
import {
  SharedProcess,
  SharedProcessId,
} from '@telegraph/shared/application/electron-main/SharedProcess';
import {
  SharedApplication,
  SharedApplicationId,
} from '@telegraph/shared/application/node/SharedApplication';
import {
  PageletProcess,
  PageletProcessId,
} from '@telegraph/pagelet-host/electron-main/PageletProcess';
import {
  AppOrchestrator,
  AppOrchestratorId,
} from '@telegraph/pagelet-host/electron-main/AppOrchestrator';
import {
  ConnectionApplication,
  ConnectionApplicationId,
} from '@telegraph/connection/application/node/ConnectionApplication';
import {
  MonitorApplication,
  MonitorApplicationId,
} from '@telegraph/monitor/application/electron-main/MonitorApplication';
import {
  SettingApplication,
  SettingApplicationId,
} from '@telegraph/setting/application/electron-main/SettingApplication';
import {
  DesignApplication,
  DesignApplicationId,
} from '@telegraph/design/application/electron-main/DesignApplication';
import {
  ChatApplication,
  ChatApplicationId,
} from '@telegraph/chat/application/electron-main/ChatApplication';
import {
  AppApplication,
  AppApplicationId,
} from '@telegraph/main/application/electron-main/AppApplication';
import {
  MainMetricsService,
  MainMetricsServiceId,
} from '@telegraph/main-metrics/electron-main/MainMetricsService';
import {
  PidNameRegistry,
  PidNameRegistryId,
} from '@telegraph/main-metrics/common';

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
