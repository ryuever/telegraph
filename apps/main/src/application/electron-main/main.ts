import { app } from 'electron';
import { Container } from '@x-oasis/di';

import registry from '@/apps/main/application/electron-main/AppApplicationModule';
import {
  AppApplicationId,
  IAppApplication,
} from '@/apps/main/application/electron-main/AppApplication';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';

const container = new Container();
container.load(registry);

app
  .whenReady()
  .then(async () => {
    const application = container.get(AppApplicationId) as IAppApplication;
    await application.start();
  })
  .catch((err: unknown) => {
    const logger = container.get(LogServiceId) as ILogger;
    logger.error('startup error:', err);
    throw err;
  });

app.on('window-all-closed', () => {
  app.quit();
});
