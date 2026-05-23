import { afterEach, describe, expect, it } from 'vitest'
import type { RemoteControlGatewayService } from '../RemoteControlSocketGateway'
import { RemoteControlHttpGateway, createRemoteControlHttpGatewayFromEnv } from '../RemoteControlHttpGateway'

const gateways: RemoteControlHttpGateway[] = []

afterEach(async () => {
  for (const gateway of gateways.splice(0)) {
    await gateway.stop()
  }
})

describe('RemoteControlHttpGateway', () => {
  it('serves JSON RPC requests for mobile clients', async () => {
    const gateway = new RemoteControlHttpGateway(createHttpService(), {
      host: '127.0.0.1',
      port: 0,
      token: 'secret',
    })
    gateways.push(gateway)
    const address = await gateway.start()

    const response = await fetch(`http://127.0.0.1:${String(address.port)}${address.path}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 'devices-1', method: 'listDeviceBindings' }),
    })

    await expect(response.json()).resolves.toEqual({
      id: 'devices-1',
      ok: true,
      result: [{
        bindingId: 'mobile-1',
        deviceId: 'iphone-1',
        actor: { actorId: 'mobile:ada', kind: 'mobile' },
        status: 'active',
        createdAt: 10,
        updatedAt: 10,
      }],
    })
  })

  it('requires the configured bearer token', async () => {
    const gateway = new RemoteControlHttpGateway(createHttpService(), {
      host: '127.0.0.1',
      port: 0,
      token: 'secret',
    })
    gateways.push(gateway)
    const address = await gateway.start()

    const response = await fetch(`http://127.0.0.1:${String(address.port)}${address.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'listDeviceBindings' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
    })
  })

  it('builds an opt-in gateway from environment variables', () => {
    expect(createRemoteControlHttpGatewayFromEnv(createHttpService(), {})).toBeNull()
    expect(createRemoteControlHttpGatewayFromEnv(createHttpService(), {
      TELEGRAPH_REMOTE_CONTROL_HTTP_PORT: '8799',
      TELEGRAPH_REMOTE_CONTROL_HTTP_HOST: '0.0.0.0',
      TELEGRAPH_REMOTE_CONTROL_HTTP_TOKEN: 'secret',
    })).toBeInstanceOf(RemoteControlHttpGateway)
  })
})

function createHttpService(): RemoteControlGatewayService {
  return {
    listDeviceBindings: () => [{
      bindingId: 'mobile-1',
      deviceId: 'iphone-1',
      actor: { actorId: 'mobile:ada', kind: 'mobile' as const },
      status: 'active' as const,
      createdAt: 10,
      updatedAt: 10,
    }],
  } as unknown as RemoteControlGatewayService
}
