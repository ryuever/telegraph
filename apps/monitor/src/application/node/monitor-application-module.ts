import { Registry } from '@x-oasis/di';

import { MonitorApplication, MonitorApplicationId } from './MonitorApplication';
import { MonitorBootstrap, MonitorBootstrapId } from './MonitorBootstrap';

export default new Registry((bind) => {
  bind(MonitorApplicationId).to(MonitorApplication);
  bind(MonitorBootstrapId).to(MonitorBootstrap);
});
