// DI registry for the daemon utility process.
import { Registry } from '@x-oasis/di';

import { DaemonApplication, DaemonApplicationId } from './DaemonApplication';
import { DaemonBootstrap, DaemonBootstrapId } from './DaemonBootstrap';

export default new Registry((bind) => {
  bind(DaemonApplicationId).to(DaemonApplication);
  bind(DaemonBootstrapId).to(DaemonBootstrap);
});