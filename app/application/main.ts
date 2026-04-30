import { Container } from '@x-oasis/di'

import RedcityApplicationModule from './redcity-application-module'
import { RedcityApplicationId } from './redcity-application'

const container = new Container()
container.load(RedcityApplicationModule)
const redcityApplication = container.get(RedcityApplicationId)

redcityApplication.start()
