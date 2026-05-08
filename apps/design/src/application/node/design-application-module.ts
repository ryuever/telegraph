// Phase 3 — DI registry for the design utility process.
import { Registry } from '@x-oasis/di';

import { DesignApplication, DesignApplicationId } from './DesignApplication';
import { DesignBootstrap, DesignBootstrapId } from './DesignBootstrap';

export default new Registry((bind) => {
  bind(DesignApplicationId).to(DesignApplication);
  bind(DesignBootstrapId).to(DesignBootstrap);
});
