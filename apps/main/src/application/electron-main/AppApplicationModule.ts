import { Registry } from '@x-oasis/di';

import { MainCpServer } from '@/apps/main/application/electron-main/MainCpServer';
import { MainCpServerId } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import {
  WindowManager,
} from '@/apps/main/application/electron-main/WindowManager';
import { WindowManagerId } from '@/apps/main/application/common';
import {
  DaemonProcess,
} from '@/apps/daemon/application/electron-main/DaemonProcess';
import { DaemonProcessId } from '@/apps/daemon/application/common';
import {
  DaemonApplication,
} from '@/apps/daemon/application/node/DaemonApplication';
import { DaemonApplicationId } from '@/apps/daemon/application/common';
import {
  SharedProcess,
} from '@/apps/shared/application/electron-main/SharedProcess';
import { SharedProcessId } from '@/apps/shared/application/common';
import {
  SharedApplication,
} from '@/apps/shared/application/node/SharedApplication';
import { SharedApplicationId } from '@/apps/shared/application/common';
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
} from '@/apps/connection/application/node/ConnectionApplication';
import { ConnectionApplicationId } from '@/apps/connection/application/common';
import {
  MonitorApplication,
} from '@/apps/monitor/application/electron-main/MonitorApplication';
import { MonitorApplicationId } from '@/apps/monitor/application/common';
import {
  SettingApplication,
} from '@/apps/setting/application/electron-main/SettingApplication';
import { SettingApplicationId } from '@/apps/setting/application/common';
import {
  DesignApplication,
} from '@/apps/design/application/electron-main/DesignApplication';
import { DesignApplicationId } from '@/apps/design/application/common';
import {
  ChatApplication,
} from '@/apps/chat/application/electron-main/ChatApplication';
import { ChatApplicationId } from '@/apps/chat/application/common';
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
