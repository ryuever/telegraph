import { Container } from '@x-oasis/di'
import SharedProcessModule from './SharedProcessModule'
import { SharedProcessNodeId } from './SharedProcessNode'

const container = new Container()

container.load(SharedProcessModule)

const sharedProcessNode = container.get(SharedProcessNodeId)
sharedProcessNode.start()
