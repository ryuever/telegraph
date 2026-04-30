import { Container } from '@x-oasis/di'
import DaemonProcessModule from './DaemonProcessModule'
import { DaemonProcessNodeId } from './DaemonProcessNode'

const container = new Container()

container.load(DaemonProcessModule)

const daemonProcessNode = container.get(DaemonProcessNodeId)
daemonProcessNode.start()
