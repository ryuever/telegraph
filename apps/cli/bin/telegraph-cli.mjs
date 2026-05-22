#!/usr/bin/env node
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOCKET_ENV = 'TELEGRAPH_RUN_BROKER_SOCKET'

async function main(argv) {
  const [command, subcommand, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === 'runs') {
    const flags = parseFlags([subcommand, ...rest].filter(Boolean))
    printJson(await send('listRunProjections', pickDefined({
      pageletId: flags.pagelet,
      status: flags.status,
      sessionId: flags.session,
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'projection' && subcommand === 'get') {
    const [runId] = rest
    if (!runId) throw new Error('Missing runId')
    printJson(await send('getRunProjection', { runId }))
    return
  }

  if (command === 'attach') {
    const [runId, ...tail] = [subcommand, ...rest].filter(Boolean)
    if (!runId) throw new Error('Usage: telegraph attach <runId> [--json] [--follow]')
    const flags = parseFlags(tail)
    await attachRun(runId, {
      json: flags.json === 'true',
      follow: flags.follow === 'true',
    })
    return
  }

  if (command === 'intents') {
    const flags = parseFlags([subcommand, ...rest].filter(Boolean))
    printJson(await send('listRunIntents', pickDefined({
      targetPagelet: flags.pagelet,
      status: flags.status,
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'intent' && subcommand === 'create') {
    const flags = parseFlags(rest)
    printJson(await createRunIntentFromCli(flags))
    return
  }

  if (command === 'ask') {
    const flags = parseFlags([subcommand, ...rest].filter(Boolean))
    printJson(await createRunIntentFromCli(flags))
    return
  }

  if (command === 'intent' && subcommand === 'claim') {
    const [intentId, runId, ...tail] = rest
    if (!intentId || !runId) throw new Error('Usage: telegraph intent claim <intentId> <runId> [--by pagelet:design:1]')
    const flags = parseFlags(tail)
    printJson(await send('claimRunIntent', {
      intentId,
      input: {
        runId,
        claimedBy: flags.by ?? 'cli',
      },
    }))
    return
  }

  if (command === 'approvals') {
    const flags = parseFlags([subcommand, ...rest].filter(Boolean))
    printJson(await send('listApprovals', pickDefined({
      runId: flags.run,
      status: flags.status,
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'approve' || command === 'deny') {
    const [approvalId, ...tail] = [subcommand, ...rest].filter(Boolean)
    if (!approvalId) throw new Error(`Usage: telegraph ${command} <approvalId> [--reason text]`)
    const flags = parseFlags(tail)
    printJson(await send('decideApproval', {
      approvalId,
      input: {
        granted: command === 'approve',
        decidedBy: cliActor(),
        reason: flags.reason,
      },
    }))
    return
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(' ')}`)
}

function send(method, params) {
  const socketPath = process.env[SOCKET_ENV] || defaultSocketPath()
  const request = {
    id: Date.now(),
    method,
    params,
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', chunk => {
      buffer += chunk
      const index = buffer.indexOf('\n')
      if (index < 0) return
      const line = buffer.slice(0, index)
      socket.end()
      const response = JSON.parse(line)
      if (!response.ok) {
        reject(new Error(response.error || 'RunBroker request failed'))
        return
      }
      resolve(response.result)
    })
  })
}

function createRunIntentFromCli(flags) {
  const prompt = flags._.join(' ').trim()
  if (!prompt) throw new Error('Missing prompt')
  return send('createRunIntent', pickDefined({
    source: cliActor(),
    targetPagelet: flags.pagelet ?? 'design',
    prompt,
    sessionId: flags.session,
    metadata: { cli: true },
  }))
}

function attachRun(runId, options) {
  const socketPath = process.env[SOCKET_ENV] || defaultSocketPath()
  const request = {
    id: Date.now(),
    method: 'subscribeRunProjections',
    params: { runId },
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let acknowledged = false
    const finish = () => {
      socket.end()
      resolve()
    }
    const stop = () => {
      socket.end()
      resolve()
    }

    process.once('SIGINT', stop)
    socket.setEncoding('utf8')
    socket.once('error', error => {
      process.removeListener('SIGINT', stop)
      reject(error)
    })
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('close', () => {
      process.removeListener('SIGINT', stop)
    })
    socket.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line)
        if ('ok' in message) {
          if (!message.ok) {
            reject(new Error(message.error || 'RunBroker subscription failed'))
            return
          }
          acknowledged = true
          continue
        }
        if (!message.event) continue
        printProjectionEvent(message.event, options.json)
        if (!options.follow && isTerminalStatus(message.event.projection?.status)) {
          finish()
          return
        }
      }
      if (!acknowledged) return
    })
  })
}

function parseFlags(args) {
  const flags = { _: [] }
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]
    if (!item) continue
    if (!item.startsWith('--')) {
      flags._.push(item)
      continue
    }
    const key = item.slice(2)
    const next = args[index + 1]
    if (!next || next.startsWith('--')) {
      flags[key] = 'true'
      continue
    }
    flags[key] = next
    index += 1
  }
  return flags
}

function pickDefined(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

function cliActor() {
  return {
    actorId: `cli:${process.env.USER || 'local'}`,
    kind: 'cli',
    displayName: process.env.USER || 'Local CLI',
  }
}

function defaultSocketPath() {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
  if (process.platform === 'win32') return `\\\\.\\pipe\\telegraph-run-broker-${uid}`
  return join(tmpdir(), `telegraph-run-broker-${uid}.sock`)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printProjectionEvent(event, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
    return
  }
  const projection = event.projection
  const title = projection.title || projection.promptPreview || projection.runId
  const parts = [
    projection.runId,
    projection.status,
    `cursor=${String(event.cursor)}`,
    title,
  ]
  if (projection.error) parts.push(`error=${projection.error}`)
  process.stdout.write(`${parts.join('  ')}\n`)
}

function isTerminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'recovered'
}

function printHelp() {
  process.stdout.write(`Telegraph CLI

Usage:
  telegraph runs [--pagelet design] [--status running]
  telegraph projection get <runId>
  telegraph attach <runId> [--json] [--follow]
  telegraph ask [--pagelet design] [--session sessionId] <prompt>
  telegraph intents [--pagelet design] [--status queued]
  telegraph intent create [--pagelet design] [--session sessionId] <prompt>
  telegraph intent claim <intentId> <runId> [--by pagelet:design:1]
  telegraph approvals [--run runId] [--status pending]
  telegraph approve <approvalId> [--reason text]
  telegraph deny <approvalId> [--reason text]

Socket:
  ${SOCKET_ENV}=${process.env[SOCKET_ENV] || defaultSocketPath()}
`)
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
