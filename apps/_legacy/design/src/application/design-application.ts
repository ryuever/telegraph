import { inject, injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { RPCServiceHost } from '@x-oasis/async-call-rpc'

export const DesignApplicationId = createId('design-application')

export interface DesignService {
  ping(payload?: { ts: number }): { pong: true; processId: string; projectName: string; ts: number; receivedTs?: number }
  getDesign(id: string): { id: string; name: string; content: string; timestamp: number }
  saveDesign(name: string, content: string): { id: string; name: string; content: string; timestamp: number }
}

@injectable()
export default class DesignApplication extends Disposable implements DesignService {
  private serviceHost: RPCServiceHost

  constructor() {
    super()
    this.serviceHost = new RPCServiceHost()
  }

  start() {
    console.log('[DesignApplication] starting...')
    this.serviceHost.registerServiceHandler('/design-service', this)
    console.log('[DesignApplication] started successfully')
  }

  getServiceHost() {
    return this.serviceHost
  }

  /**
   * 验证 renderer ↔ DesignProcess 的通信是否正常
   */
  ping(payload?: { ts: number }): { pong: true; processId: string; projectName: string; ts: number; receivedTs?: number } {
    console.log('[DesignApplication] ping received from renderer', payload)
    return {
      pong: true,
      processId: process.pid.toString(),
      projectName: 'design',
      ts: Date.now(),
      receivedTs: payload?.ts,
    }
  }

  /**
   * 获取设计（示例服务方法）
   */
  getDesign(id: string): { id: string; name: string; content: string; timestamp: number } {
    console.log('[DesignApplication] getDesign called with id:', id)
    return {
      id,
      name: `Design ${id}`,
      content: `Design content for ${id}`,
      timestamp: Date.now(),
    }
  }

  /**
   * 保存设计（示例服务方法）
   */
  saveDesign(name: string, content: string): { id: string; name: string; content: string; timestamp: number } {
    const id = Math.random().toString(36).substr(2, 9)
    console.log('[DesignApplication] saveDesign called with name:', name)
    return {
      id,
      name,
      content,
      timestamp: Date.now(),
    }
  }

  dispose() {
    super.dispose()
  }
}
