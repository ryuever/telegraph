import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  handleRemoteControlGatewayRequest,
  type RemoteControlGatewayRequest,
  type RemoteControlGatewayResponse,
  type RemoteControlGatewayService,
} from './RemoteControlSocketGateway'

export interface RemoteControlHttpGatewayOptions {
  host: string
  port: number
  token?: string
  path?: string
}

export interface RemoteControlHttpGatewayAddress {
  host: string
  port: number
  path: string
}

export class RemoteControlHttpGateway {
  private server: Server | null = null

  constructor(
    private readonly service: RemoteControlGatewayService,
    private readonly options: RemoteControlHttpGatewayOptions,
  ) {}

  async start(): Promise<RemoteControlHttpGatewayAddress> {
    if (this.server) return this.address()
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.options.port, this.options.host, () => {
        this.server?.off('error', reject)
        resolve()
      })
    })
    return this.address()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private address(): RemoteControlHttpGatewayAddress {
    const address = this.server?.address()
    return {
      host: typeof address === 'object' && address ? address.address : this.options.host,
      port: typeof address === 'object' && address ? address.port : this.options.port,
      path: this.options.path ?? '/rpc',
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    writeCorsHeaders(response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const path = this.options.path ?? '/rpc'
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }
    if (request.method !== 'POST' || request.url !== path) {
      writeJson(response, 404, { ok: false, error: 'Not found' })
      return
    }
    if (!this.isAuthorized(request)) {
      writeJson(response, 401, { ok: false, error: 'Unauthorized' })
      return
    }

    try {
      const body = await readJsonBody(request)
      const gatewayResponse = await handleRemoteControlGatewayRequest(
        this.service,
        normalizeHttpGatewayRequest(body),
      )
      writeJson(response, gatewayResponse.ok ? 200 : 400, gatewayResponse)
    } catch (error) {
      const gatewayResponse: RemoteControlGatewayResponse = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      writeJson(response, 400, gatewayResponse)
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    if (!this.options.token) return true
    const authorization = request.headers.authorization
    if (authorization === `Bearer ${this.options.token}`) return true
    return request.headers['x-telegraph-remote-token'] === this.options.token
  }
}

export function createRemoteControlHttpGatewayFromEnv(
  service: RemoteControlGatewayService,
  env: NodeJS.ProcessEnv = process.env,
): RemoteControlHttpGateway | null {
  const port = parsePort(env.TELEGRAPH_REMOTE_CONTROL_HTTP_PORT)
  if (port === null) return null
  return new RemoteControlHttpGateway(service, {
    host: env.TELEGRAPH_REMOTE_CONTROL_HTTP_HOST || '127.0.0.1',
    port,
    token: env.TELEGRAPH_REMOTE_CONTROL_HTTP_TOKEN || undefined,
    path: env.TELEGRAPH_REMOTE_CONTROL_HTTP_PATH || '/rpc',
  })
}

function normalizeHttpGatewayRequest(body: unknown): RemoteControlGatewayRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected JSON object body')
  }
  const request = body as Partial<RemoteControlGatewayRequest>
  if (typeof request.method !== 'string') {
    throw new Error('Expected method')
  }
  return {
    id: request.id,
    method: request.method,
    params: request.params,
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      raw += String(chunk)
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'))
        request.destroy()
      }
    })
    request.on('error', reject)
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) as unknown : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
  })
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function writeCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type,authorization,x-telegraph-remote-token')
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid TELEGRAPH_REMOTE_CONTROL_HTTP_PORT: ${value}`)
  }
  return port
}
