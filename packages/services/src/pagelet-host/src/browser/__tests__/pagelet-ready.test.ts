import { describe, expect, it } from 'vitest'
import { waitForPageletReady, withTimeout } from '../pagelet-ready'

describe('pagelet ready helpers', () => {
  it('retries the probe until it succeeds', async () => {
    let attempts = 0

    await waitForPageletReady(() => {
      attempts++
      if (attempts < 2) return Promise.reject(new Error('not yet'))
      return Promise.resolve()
    }, {
      attempts: 3,
      intervalMs: 1,
      probeTimeoutMs: 20,
    })

    expect(attempts).toBe(2)
  })

  it('fails with the configured message after exhausting attempts', async () => {
    await expect(waitForPageletReady(() => {
      return Promise.reject(new Error('not yet'))
    }, {
      attempts: 1,
      intervalMs: 1,
      probeTimeoutMs: 20,
      notReadyMessage: 'Nope',
    })).rejects.toThrow('Nope')
  })

  it('aborts pending waits', async () => {
    const controller = new AbortController()
    const pending = waitForPageletReady(() => {
      return Promise.reject(new Error('not yet'))
    }, {
      attempts: 3,
      intervalMs: 20,
      probeTimeoutMs: 20,
      signal: controller.signal,
    })

    controller.abort()

    await expect(pending).rejects.toThrow('Cancelled')
  })

  it('times out hung probes', async () => {
    await expect(withTimeout(new Promise(() => {}), 1)).rejects.toThrow('probe timed out')
  })

  it('rejects immediately when the timeout signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(withTimeout(Promise.resolve(), 20, controller.signal)).rejects.toThrow('Cancelled')
  })
})
