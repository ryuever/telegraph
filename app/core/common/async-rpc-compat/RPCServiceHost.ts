type ServiceInstance = Record<string, (...args: any[]) => any>

export default class RPCServiceHost {
  readonly name: string
  readonly serviceMap = new Map<string, ServiceInstance>()

  constructor(name = '') {
    this.name = name
  }

  registerServiceHandler(servicePath: string, service: ServiceInstance): void {
    this.serviceMap.set(servicePath, service)
  }

  getService(servicePath: string): ServiceInstance | undefined {
    return this.serviceMap.get(servicePath)
  }

  getHandler(servicePath: string, handlerName: string): ((...args: any[]) => any) | null {
    const service = this.serviceMap.get(servicePath)
    if (!service) return null
    const handler = service[handlerName]
    return typeof handler === 'function' ? handler.bind(service) : null
  }
}
