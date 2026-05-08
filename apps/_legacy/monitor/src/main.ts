import type { Container } from '@x-oasis/di'
import type { RPCServiceHost } from '@x-oasis/async-call-rpc'
import registry from './application/monitor-application-module'
import { MonitorApplicationId } from './application/monitor-application'
import type MonitorApplication from './application/monitor-application'

export default {
  initApplication(parentContainer: Container, serviceHost: RPCServiceHost) {
    parentContainer.load(registry)

    const application = parentContainer.get(MonitorApplicationId) as MonitorApplication
    application.start()

    serviceHost.registerServiceHandler('/services/monitor', application)

    console.info('[MonitorApplication] registered on PageletProcess serviceHost at /services/monitor')
  },
}