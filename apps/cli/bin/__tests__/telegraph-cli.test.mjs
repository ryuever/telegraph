import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliPath = resolve(__dirname, '../telegraph-cli.mjs')
const cleanupDirs = []

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('telegraph CLI', () => {
  it('creates run intents through the socket protocol', async () => {
    const broker = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        intentId: 'intent-cli',
        prompt: request.params.prompt,
        targetPagelet: request.params.targetPagelet,
      },
    }))

    const result = await runCli([
      'ask',
      '--pagelet',
      'design',
      'make',
      'a',
      'mobile',
      'shell',
    ], broker.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      intentId: 'intent-cli',
      prompt: 'make a mobile shell',
      targetPagelet: 'design',
    })
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'createRunIntent',
        params: expect.objectContaining({
          targetPagelet: 'design',
          prompt: 'make a mobile shell',
          metadata: { cli: true },
        }),
      }),
    ])

    await broker.close()
  })

  it('attaches to projection updates and exits on terminal status', async () => {
    const broker = await startFakeBroker((request, socket) => {
      queueMicrotask(() => {
        socket.write(`${JSON.stringify({
          event: {
            type: 'run_projection_changed',
            runId: 'run-cli',
            cursor: 1,
            projection: {
              runId: 'run-cli',
              pageletId: 'design',
              status: 'completed',
              cursor: 1,
              eventCount: 3,
              title: 'CLI run',
            },
          },
        })}\n`)
      })
      return {
        id: request.id,
        ok: true,
        result: { subscribed: true },
      }
    })

    const result = await runCli(['attach', 'run-cli'], broker.socketPath)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('run-cli  completed  cursor=1  CLI run')
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'subscribeRunProjections',
        params: { runId: 'run-cli' },
      }),
    ])

    await broker.close()
  })
})

async function startFakeBroker(handleRequest) {
  const dir = mkdtempSync(join(tmpdir(), 'telegraph-cli-test-'))
  cleanupDirs.push(dir)
  const socketPath = join(dir, 'broker.sock')
  const requests = []
  const server = createServer(socket => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', chunk => {
      buffer += String(chunk)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const request = JSON.parse(line)
        requests.push(request)
        socket.write(`${JSON.stringify(handleRequest(request, socket))}\n`)
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    socketPath,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error)
        else resolve()
      })
    }),
  }
}

function runCli(args, socketPath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        TELEGRAPH_RUN_BROKER_SOCKET: socketPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => {
      resolve({ code, stdout, stderr })
    })
  })
}
