import { inject, injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { RPCServiceHost } from '@x-oasis/async-call-rpc'

export const ChatApplicationId = createId('chat-application')

export interface ChatService {
  ping(payload?: { ts: number }): { pong: true; processId: string; projectName: string; ts: number; receivedTs?: number }
  getMessage(id: string): { id: string; text: string; timestamp: number }
  sendMessage(text: string): { id: string; text: string; timestamp: number }
}

@injectable()
export default class ChatApplication extends Disposable implements ChatService {
  private serviceHost: RPCServiceHost

  constructor() {
    super()
    this.serviceHost = new RPCServiceHost()
  }

  start() {
    console.log('[ChatApplication] starting...')
    this.serviceHost.registerServiceHandler('/chat-service', this)
    console.log('[ChatApplication] started successfully')
  }

  getServiceHost() {
    return this.serviceHost
  }

  /**
   * 验证 renderer ↔ ChatProcess 的通信是否正常
   */
  ping(payload?: { ts: number }): { pong: true; processId: string; projectName: string; ts: number; receivedTs?: number } {
    console.log('[ChatApplication] ping received from renderer', payload)
    return {
      pong: true,
      processId: process.pid.toString(),
      projectName: 'chat',
      ts: Date.now(),
      receivedTs: payload?.ts,
    }
  }

  /**
   * 获取消息（示例服务方法）
   */
  getMessage(id: string): { id: string; text: string; timestamp: number } {
    console.log('[ChatApplication] getMessage called with id:', id)
    return {
      id,
      text: `This is message ${id} from chat service`,
      timestamp: Date.now(),
    }
  }

  /**
   * 发送消息（示例服务方法）
   */
  sendMessage(text: string): { id: string; text: string; timestamp: number } {
    const id = Math.random().toString(36).substr(2, 9)
    console.log('[ChatApplication] sendMessage called with text:', text)
    return {
      id,
      text,
      timestamp: Date.now(),
    }
  }

  dispose() {
    super.dispose()
  }
}
