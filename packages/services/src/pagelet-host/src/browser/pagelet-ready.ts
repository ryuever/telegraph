export interface PageletReadyOptions {
  attempts?: number
  intervalMs?: number
  probeTimeoutMs?: number
  signal?: AbortSignal
  notReadyMessage?: string
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelled')
}

export async function waitForPageletReady(
  probe: () => Promise<unknown>,
  options: PageletReadyOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 40
  const intervalMs = options.intervalMs ?? 500
  const probeTimeoutMs = options.probeTimeoutMs ?? 3000

  for (let attempt = 0; attempt < attempts; attempt++) {
    throwIfAborted(options.signal)
    try {
      await withTimeout(probe(), probeTimeoutMs, options.signal)
      return
    } catch {
      await sleep(intervalMs, options.signal)
    }
  }

  throw new Error(options.notReadyMessage ?? 'Pagelet is not ready. Please try again in a moment.')
}

export function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Cancelled'))
      return
    }

    let settled = false
    const cleanup = () => {
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', handleAbort)
    }
    const handleAbort = () => {
      if (settled) return
      cleanup()
      reject(new Error('Cancelled'))
    }
    const timer = setTimeout(() => {
      if (settled) return
      cleanup()
      reject(new Error('probe timed out'))
    }, ms)

    signal?.addEventListener('abort', handleAbort, { once: true })
    promise
      .then(value => {
        if (settled) return
        cleanup()
        resolve(value)
      })
      .catch((error: unknown) => {
        if (settled) return
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
  })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', handleAbort)
    }
    const handleAbort = () => {
      if (settled) return
      cleanup()
      reject(new Error('Cancelled'))
    }
    const timer = setTimeout(() => {
      if (settled) return
      cleanup()
      resolve()
    }, ms)

    if (signal?.aborted) {
      handleAbort()
      return
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}
