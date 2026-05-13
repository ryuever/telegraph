import { createId, inject, injectable } from '@x-oasis/di';
import { app } from 'electron';
import { serviceHost } from '@x-oasis/async-call-rpc';

import type { IWindowManager } from '@telegraph/main/application/electron-main/WindowManager';
import { WindowManagerId } from '@telegraph/main/application/electron-main/WindowManager';
import type { IMainCpServer } from '@telegraph/main/application/electron-main/MainCpServer';
import { MainCpServerId } from '@telegraph/main/application/electron-main/MainCpServer';
import type { IDaemonApplication } from '@telegraph/daemon/application/node/DaemonApplication';
import { DaemonApplicationId } from '@telegraph/daemon/application/node/DaemonApplication';
import type { ISharedApplication } from '@telegraph/shared/application/node/SharedApplication';
import { SharedApplicationId } from '@telegraph/shared/application/node/SharedApplication';
import type { IConnectionApplication } from '@telegraph/connection/application/node/ConnectionApplication';
import { ConnectionApplicationId } from '@telegraph/connection/application/node/ConnectionApplication';
import type { IMonitorApplication } from '@telegraph/monitor/application/electron-main/MonitorApplication';
import { MonitorApplicationId } from '@telegraph/monitor/application/electron-main/MonitorApplication';
import type { ISettingApplication } from '@telegraph/setting/application/electron-main/SettingApplication';
import { SettingApplicationId } from '@telegraph/setting/application/electron-main/SettingApplication';
import type { IDesignApplication } from '@telegraph/design/application/electron-main/DesignApplication';
import { DesignApplicationId } from '@telegraph/design/application/electron-main/DesignApplication';
import type { IChatApplication } from '@telegraph/chat/application/electron-main/ChatApplication';
import { ChatApplicationId } from '@telegraph/chat/application/electron-main/ChatApplication';
import type { IAppOrchestrator } from '@telegraph/pagelet-host/electron-main/AppOrchestrator';
import { AppOrchestratorId } from '@telegraph/pagelet-host/electron-main/AppOrchestrator';
import { MAIN_RPC_SERVICE_PATH } from '@telegraph/pagelet-host/common';
import { MAIN_METRICS_SERVICE_PATH } from '@telegraph/main-metrics/common';
import { pidNameRegistry } from '@telegraph/main-metrics/electron-main/pidNameRegistry';

export interface IAppApplication {
  start(): Promise<void>;
}

export const AppApplicationId = createId('AppApplication');

function queryPsForPids(
  pids: number[]
): Map<number, { cpu: number; mem: number }> {
  const result = new Map<number, { cpu: number; mem: number }>();
  if (pids.length === 0) return result;
  try {
    const cp = require('child_process');
    const pidArgs = pids.map((p) => `-p ${p}`).join(' ');
    const out = cp.execSync(`ps ${pidArgs} -o pid=,pcpu=,pmem=`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    for (const line of out.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = Number(parts[0]);
        const cpu = parseFloat(parts[1]);
        const mem = parseFloat(parts[2]);
        if (!isNaN(pid)) {
          result.set(pid, { cpu, mem });
        }
      }
    }
  } catch {}
  return result;
}

@injectable()
export class AppApplication implements IAppApplication {
  constructor(
    @inject(WindowManagerId) private readonly windowManager: IWindowManager,
    @inject(MainCpServerId) private readonly mainCpServer: IMainCpServer,
    @inject(DaemonApplicationId) private readonly daemonApp: IDaemonApplication,
    @inject(SharedApplicationId) private readonly sharedApp: ISharedApplication,
    @inject(ConnectionApplicationId)
    private readonly connectionApp: IConnectionApplication,
    @inject(MonitorApplicationId)
    private readonly monitorApp: IMonitorApplication,
    @inject(SettingApplicationId)
    private readonly settingApp: ISettingApplication,
    @inject(DesignApplicationId)
    private readonly designApp: IDesignApplication,
    @inject(ChatApplicationId)
    private readonly chatApp: IChatApplication,
    @inject(AppOrchestratorId)
    private readonly appOrchestrator: IAppOrchestrator
  ) {}

  async start(): Promise<void> {
    console.log('[AppApplication] start()');

    this.windowManager.openMainWindow();

    this.mainCpServer.start();

    let mainCallCount = 0;
    serviceHost.registerServiceHandler(MAIN_RPC_SERVICE_PATH, {
      mainPing(msg: string): string {
        mainCallCount++;
        return `pong from main (#${mainCallCount}): ${msg}`;
      },
    });

    serviceHost.registerServiceHandler(MAIN_METRICS_SERVICE_PATH, {
      getAppMetrics: () => {
        const electronMetrics = app.getAppMetrics();
        const knownPids = new Set(electronMetrics.map((m) => m.pid));
        const utilityByName = new Map<number, string>();
        for (const entry of pidNameRegistry.getAll()) {
          utilityByName.set(entry.pid, entry.name);
        }

        const result = electronMetrics.map((m) => {
          const registeredName = utilityByName.get(m.pid);
          let name: string;
          if (registeredName) {
            name = registeredName;
          } else if (m.type === 'Browser') {
            name = 'Main Process';
          } else if (m.type === 'Tab') {
            name = 'Renderer';
          } else {
            name = m.type;
          }
          return {
            pid: m.pid,
            name,
            type: m.type,
            cpu: { percentCPUUsage: m.cpu.percentCPUUsage },
            memory: { workingSetSize: m.memory.workingSetSize },
          };
        });

        const utilityEntries = pidNameRegistry
          .getAll()
          .filter((e) => !knownPids.has(e.pid));

        if (utilityEntries.length > 0) {
          const utilityPids = utilityEntries.map((e) => e.pid);
          const psData = queryPsForPids(utilityPids);
          for (const entry of utilityEntries) {
            const ps = psData.get(entry.pid);
            result.push({
              pid: entry.pid,
              name: entry.name,
              type: 'Utility',
              cpu: { percentCPUUsage: ps?.cpu ?? 0 },
              memory: { workingSetSize: ps ? ps.mem * 1024 : 0 },
            });
          }
        }

        return result;
      },
      getMainPid: () => {
        return process.pid;
      },
    });

    await Promise.all([this.sharedApp.start(), this.daemonApp.start()]);

    await this.connectionApp.start();
    await this.monitorApp.start();
    await this.settingApp.start();
    await this.designApp.start();
    await this.chatApp.start();

    this.windowManager.onSettingWindowCreated((win) => {
      this.mainCpServer.registerSettingWindow(win);
      this.appOrchestrator.registerSettingOrchestratorService();
    });

    console.log('[AppApplication] start() done');
  }
}
