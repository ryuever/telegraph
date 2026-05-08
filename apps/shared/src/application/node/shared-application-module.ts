// DI registry for the shared utility process.
import { Registry } from '@x-oasis/di';

import { SharedApplication, SharedApplicationId } from './SharedApplication';
import { SharedBootstrap, SharedBootstrapId } from './SharedBootstrap';

export default new Registry((bind) => {
  bind(SharedApplicationId).to(SharedApplication);
  bind(SharedBootstrapId).to(SharedBootstrap);
});