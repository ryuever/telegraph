import { Registry } from '@x-oasis/di'
import DesignApplication, { DesignApplicationId } from './design-application'

export default new Registry((bind) => {
  bind(DesignApplicationId).to(DesignApplication).inSingletonScope()
})
