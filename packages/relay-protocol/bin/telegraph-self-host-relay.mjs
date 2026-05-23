#!/usr/bin/env node
import process from 'node:process'

const RELAY_PROTOCOL_SCHEMA_VERSION = 1
const RELAY_PACKAGE_SCHEMA_VERSION = 1

function main(argv) {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (command === 'manifest') {
    printJson(createManifest())
    return
  }
  if (command === 'serve') {
    if (rest.includes('--stdio')) {
      serveStdio()
      return
    }
    throw new Error('Usage: telegraph-self-host-relay serve --stdio')
  }
  throw new Error(`Unknown command: ${command}`)
}

function serveStdio() {
  const relay = createRelay()
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    buffer += String(chunk)
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      process.stdout.write(`${JSON.stringify(handleRequest(relay, JSON.parse(line)))}\n`)
    }
  })
}

function handleRequest(relay, request) {
  try {
    const result = dispatch(relay, request)
    return { id: request.id, ok: true, result }
  } catch (error) {
    return {
      id: request?.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function dispatch(relay, request) {
  if (!request || typeof request !== 'object') throw new Error('Expected request object')
  const params = request.params ?? {}
  switch (request.method) {
    case 'manifest':
      return createManifest()
    case 'policy':
      return relay.boundaryPolicy
    case 'registerParticipant':
      return registerParticipant(relay, params)
    case 'publish':
      return publish(relay, params)
    case 'list':
      return list(relay, params)
    default:
      throw new Error(`Unknown relay method: ${String(request.method)}`)
  }
}

function createRelay() {
  return {
    boundaryPolicy: {
      deploymentMode: 'self-host',
      localOnlySecrets: true,
      storesDesktopExecutionCapability: false,
      allowedPayloadKinds: ['external_message', 'channel_reply', 'projection_change', 'approval_change'],
    },
    participants: new Map(),
    envelopes: [],
    cursor: 0,
  }
}

function registerParticipant(relay, params) {
  const participantId = stringParam(params, 'participantId')
  const role = stringParam(params, 'role')
  const now = numberParam(params, 'now') ?? Date.now()
  const current = relay.participants.get(participantId)
  const record = pruneUndefined({
    participantId,
    role,
    actor: optionalObjectParam(params, 'actor'),
    deviceId: optionalStringParam(params, 'deviceId'),
    connectedAt: current?.connectedAt ?? now,
    lastSeenAt: now,
  })
  relay.participants.set(participantId, record)
  return globalThis.structuredClone(record)
}

function publish(relay, params) {
  const from = stringParam(params, 'from')
  const to = stringParam(params, 'to')
  const payload = objectParam(params, 'payload')
  assertParticipant(relay, from)
  assertParticipant(relay, to)
  if (!relay.boundaryPolicy.allowedPayloadKinds.includes(payload.kind)) {
    throw new Error(`Relay payload kind "${String(payload.kind)}" is not allowed.`)
  }
  const envelope = {
    envelopeId: `relay-${String(relay.cursor + 1)}`,
    from,
    to,
    cursor: relay.cursor + 1,
    payload: globalThis.structuredClone(payload),
    createdAt: numberParam(params, 'now') ?? Date.now(),
    schemaVersion: RELAY_PROTOCOL_SCHEMA_VERSION,
  }
  relay.cursor = envelope.cursor
  relay.envelopes.push(envelope)
  return globalThis.structuredClone(envelope)
}

function list(relay, params) {
  const participantId = stringParam(params, 'participantId')
  assertParticipant(relay, participantId)
  const afterCursor = numberParam(params, 'afterCursor')
  const limit = numberParam(params, 'limit') ?? 100
  return relay.envelopes
    .filter(envelope => envelope.to === participantId)
    .filter(envelope => afterCursor === undefined || envelope.cursor > afterCursor)
    .sort((a, b) => a.cursor - b.cursor)
    .slice(0, limit)
    .map(envelope => globalThis.structuredClone(envelope))
}

function assertParticipant(relay, participantId) {
  if (!relay.participants.has(participantId)) {
    throw new Error(`Relay participant is not registered: ${participantId}`)
  }
}

function createManifest() {
  return {
    schemaVersion: RELAY_PACKAGE_SCHEMA_VERSION,
    packageId: '@telegraph/self-host-relay',
    title: 'Telegraph Enterprise Self-Host Relay',
    protocolSchemaVersion: RELAY_PROTOCOL_SCHEMA_VERSION,
    boundaryPolicy: {
      deploymentMode: 'self-host',
      localOnlySecrets: true,
      storesDesktopExecutionCapability: false,
      allowedPayloadKinds: ['external_message', 'channel_reply', 'projection_change', 'approval_change'],
    },
    entrypoints: [{
      kind: 'stdio-jsonl',
      command: 'telegraph-self-host-relay',
      args: ['serve', '--stdio'],
    }],
    requiredEnvironment: [{
      name: 'TELEGRAPH_RELAY_OPERATOR_TOKEN',
      description: 'Local-only operator token used to administer participant registration.',
      secret: true,
    }],
    retention: {
      maxEnvelopeAgeMs: 7 * 24 * 60 * 60_000,
      maxEnvelopesPerParticipant: 10_000,
      persistPayloads: true,
    },
  }
}

function stringParam(params, key) {
  const value = params[key]
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${key}`)
  return value
}

function optionalStringParam(params, key) {
  const value = params[key]
  return typeof value === 'string' ? value : undefined
}

function numberParam(params, key) {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function objectParam(params, key) {
  const value = params[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Missing ${key}`)
  return value
}

function optionalObjectParam(params, key) {
  const value = params[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function pruneUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printHelp() {
  process.stdout.write(`Telegraph self-host relay

Usage:
  telegraph-self-host-relay manifest
  telegraph-self-host-relay serve --stdio

Stdio JSONL methods:
  manifest
  policy
  registerParticipant { participantId, role, actor?, deviceId? }
  publish { from, to, payload }
  list { participantId, afterCursor?, limit? }
`)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
