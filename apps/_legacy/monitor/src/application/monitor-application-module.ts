import { Registry } from '@x-oasis/di'
import MonitorApplication, { MonitorApplicationId } from './monitor-application'

export default new Registry((bind) => {
  bind(MonitorApplicationId).to(MonitorApplication).inSingletonScope()
})