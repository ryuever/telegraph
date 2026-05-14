import { app } from 'electron';
import { Container } from '@x-oasis/di';

import registry from '@/apps/main/application/electron-main/AppApplicationModule';
import {
  AppApplicationId,
  IAppApplication,
} from '@/apps/main/application/electron-main/AppApplication';

const container = new Container();
container.load(registry);

app
  .whenReady()
  .then(async () => {
    const application = container.get(AppApplicationId) as IAppApplication;
    await application.start();
  })
  .catch((err: unknown) => {
    console.error('startup error:', err);
    throw err;
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
