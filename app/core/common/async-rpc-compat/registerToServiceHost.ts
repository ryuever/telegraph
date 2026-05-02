import type { AbstractChannelProtocol } from '@x-oasis/async-call-rpc'
import RPCServiceHost from './RPCServiceHost'

const REQUEST_TYPES = new Set(['pr', 'pa', 'sr', 'sa', 'sub', 'unsub', 'evt-stop'])

/**
 * Bridges a single channel to a multi-path RPCServiceHost shim.
 *
 * Two routing concerns the new library doesn't handle for us:
 *
 * 1. The lib's `service.getHandler(methodName)` ignores `requestPath`. Our
 *    proxy service therefore searches all services in the host by method name.
 *
 * 2. Multiple channels can share one transport (e.g. several
 *    ProcessChannelProtocol instances bound to one UtilityProcess). Every
 *    channel's listener receives every transport message and tries to handle
 *    it; whichever doesn't own the request emits a "Method not found" reply,
 *    which surfaces as an unhandled rejection on the remote side.
 *
 *    To prevent that, we splice a filter middleware between `deserialize` and
 *    `handleRequest`. If the incoming request's `requestPath` is not in this
 *    host's service map, we rewrite the header type to a benign Response
 *    (`SubscriptionStopped`) — `handleRequest` short-circuits on Response
 *    types, and `handleResponse` no-ops because the seqId is not in
 *    `ongoingRequests` for this channel.
 */
export function bindHostToChannel(
  channel: AbstractChannelProtocol,
  host: RPCServiceHost | undefined
): void {
  if (!host) return

  const proxyService: any = {
    serviceHost: host,
    handlersMap: new Map(),
    handleMessage(...args: any[]) {
      ;(channel as any).onMessage(...args)
    },
    getHandler(methodName: string) {
      for (const [, instance] of host.serviceMap) {
        const handler = (instance as any)[methodName]
        if (typeof handler === 'function') return handler.bind(instance)
      }
      return undefined
    },
    registerHandler() {},
    registerHandlers() {},
    setChannel() {},
    merge() {},
  }

  ;(channel as any).setService(proxyService)

  const channelAny = channel as any

  const middleware = channelAny._onMessageMiddleware
  if (Array.isArray(middleware) && !channelAny.__rpcCompatFilterInstalled) {
    const filter = (message: any) => {
      if (!message || !message.data) return message
      const data = message.data
      if (!Array.isArray(data) || !Array.isArray(data[0])) return message
      const header = data[0]
      const type = header[0]
      if (typeof type !== 'string' || !REQUEST_TYPES.has(type)) return message
      const requestPath = header[2]
      if (requestPath && host.serviceMap.has(requestPath)) return message
      // Not addressed to this host's services — convert to a benign Response
      // so handleRequest skips it and handleResponse no-ops.
      const rewritten = data.slice()
      rewritten[0] = ['ss', header[1]]
      return { ...message, data: rewritten }
    }
    // Splice between deserialize (idx 1) and handleRequest (idx 2).
    middleware.splice(2, 0, filter)
    channelAny.__rpcCompatFilterInstalled = true
  }

  installPortTransferShim(channelAny)
}

/**
 * The new async-call-rpc serializes responses with JSON.stringify and provides
 * no path for transferring MessagePortMain. Legacy code returns ports from
 * RPC handlers (e.g. AcquireProcessPortMain.acquirePort) and expects the
 * remote to receive them via the lib's PortSuccess response (`message.ports[0]`).
 *
 * We patch the channel's writeBuffer.encode and send to:
 *   1. Detect a ReturnSuccess whose body[0] looks like a MessagePortMain
 *   2. Rewrite the header to PortSuccess and stash the port keyed by seqId
 *   3. On send, if the outgoing data is a PortSuccess we own, use the
 *      underlying transport's postMessage with the port in the transfer list
 */
function installPortTransferShim(channelAny: any): void {
  if (channelAny.__rpcCompatPortShimInstalled) return
  channelAny.__rpcCompatPortShimInstalled = true

  const transferQueue = new Map<string, any>()
  const isMessagePortLike = (v: any) =>
    !!v &&
    typeof v === 'object' &&
    typeof v.postMessage === 'function' &&
    typeof v.start === 'function' &&
    typeof v.on === 'function'

  // Patch encode (writeBuffer is a lazy getter on AbstractChannelProtocol)
  const writeBuffer = channelAny.writeBuffer
  if (writeBuffer && typeof writeBuffer.encode === 'function') {
    const origEncode = writeBuffer.encode.bind(writeBuffer)
    writeBuffer.encode = function (value: any) {
      if (Array.isArray(value) && Array.isArray(value[0]) && value[0][0] === 'rs') {
        const seqId = value[0][1]
        const body = value[1]
        const res = Array.isArray(body) ? body[0] : undefined
        if (isMessagePortLike(res)) {
          transferQueue.set(String(seqId), res)
          return origEncode([['ps', seqId], []])
        }
      }
      return origEncode(value)
    }
  }

  // Patch send to attach the port as a transferable when we own this seqId
  const origSend = channelAny.send.bind(channelAny)
  channelAny.send = function (data: any, transfer?: any[]) {
    if (typeof data === 'string' && transferQueue.size > 0) {
      try {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed) && Array.isArray(parsed[0]) && parsed[0][0] === 'ps') {
          const seqId = String(parsed[0][1])
          const port = transferQueue.get(seqId)
          if (port) {
            transferQueue.delete(seqId)
            const target = channelAny._target ?? channelAny._port
            if (target && typeof target.postMessage === 'function') {
              try {
                target.postMessage(data, [port])
                return
              } catch (err) {
                // Some transports don't accept transfer; fall through.
                console.error('[rpc-compat] port transfer failed:', err)
              }
            }
          }
        }
      } catch {
        // Not JSON or unexpected shape — fall through.
      }
    }
    return origSend(data, transfer)
  }
}
