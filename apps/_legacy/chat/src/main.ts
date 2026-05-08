import type { Container } from '@x-oasis/di'
import type { RPCServiceHost } from '@x-oasis/async-call-rpc'
import registry from './application/chat-application-module'
import { ChatApplicationId } from './application/chat-application'
import type ChatApplication from './application/chat-application'

/**
 * PageletProcess 的 amdEntry 入口。
 *
 * pagelet-process-bootstrap 加载此模块后调用 initApplication，
 * 将 ChatApplication 注册到 PageletProcess 的 RPC serviceHost 中，
 * 使 renderer 可以通过 MessagePort 调用 '/services/chat' 上的方法。
 */
export default {
  initApplication(parentContainer: Container, serviceHost: RPCServiceHost) {
    // 加载 chat DI 模块（注册 ChatApplication 单例）
    parentContainer.load(registry)

    const application = parentContainer.get(ChatApplicationId) as ChatApplication
    application.start()

    // 将 ChatApplication 注册到 PageletProcess 的全局 serviceHost，
    // 这样 renderer 通过 pageletChannelProtocol 可以 RPC 调用
    serviceHost.registerServiceHandler('/services/chat', application)

    console.info('[ChatApplication] registered on PageletProcess serviceHost at /services/chat')
  },
}
