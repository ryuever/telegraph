#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUN_BROKER_SOCKET_ENV = 'TELEGRAPH_RUN_BROKER_SOCKET'
const REMOTE_CONTROL_SOCKET_ENV = 'TELEGRAPH_REMOTE_CONTROL_SOCKET'
const MCP_TOOL_SCHEMA_VERSION = 1

async function main(argv) {
  const [command, subcommand, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === 'mcp') {
    startMcpServer()
    return
  }

  if (command === 'mcp-schema') {
    printJson({
      schemaVersion: MCP_TOOL_SCHEMA_VERSION,
      tools: mcpTools(),
    })
    return
  }

  if (command === 'remote' && subcommand === 'submit') {
    const flags = parseFlags(rest)
    printJson(await sendRemote('submitExternalMessage', {
      message: externalMessageFromCli(flags),
      options: pickDefined({
        targetPagelet: flags.pagelet,
        sessionId: flags.session,
        requireDeviceBinding: flags.requireDeviceBinding === 'true' ? true : undefined,
      }),
    }))
    return
  }

  if (command === 'remote' && subcommand === 'replies') {
    const flags = parseFlags(rest)
    printJson(await sendRemote('listChannelReplies', pickDefined({
      channelId: flags.channelId,
      threadId: flags.thread,
      runId: flags.run,
      status: flags.status,
      deliveryStatus: flags.deliveryStatus,
      afterCursor: parseOptionalNumber(flags.after, '--after'),
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'remote' && subcommand === 'reply') {
    const [action, replyId, ...tail] = rest
    if (action !== 'ack' || !replyId) {
      throw new Error('Usage: telegraph remote reply ack <replyId> [--status sent|failed|skipped] [--error text]')
    }
    const flags = parseFlags(tail)
    printJson(await sendRemote('ackChannelReply', {
      replyId,
      status: flags.status ?? 'sent',
      deliveredBy: remoteActorFromFlags(flags),
      error: flags.error,
    }))
    return
  }

  if (command === 'remote' && subcommand === 'approvals') {
    const flags = parseFlags(rest)
    printJson(await sendRemote('listApprovals', pickDefined({
      runId: flags.run,
      status: flags.status,
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'remote' && subcommand === 'approval-changes') {
    const flags = parseFlags(rest)
    printJson(await sendRemote('listApprovalChanges', pickDefined({
      runId: flags.run,
      status: flags.status,
      afterCursor: parseOptionalNumber(flags.after, '--after'),
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'remote' && (subcommand === 'approve' || subcommand === 'deny')) {
    const [approvalId, ...tail] = rest
    if (!approvalId) throw new Error(`Usage: telegraph remote ${subcommand} <approvalId> [--reason text]`)
    const flags = parseFlags(tail)
    printJson(await sendRemote('decideApproval', {
      approvalId,
      input: {
        granted: subcommand === 'approve',
        decidedBy: remoteActorFromFlags(flags),
        reason: flags.reason,
      },
    }))
    return
  }

  if (command === 'remote' && isRunControlKind(subcommand)) {
    const [runId, ...tail] = rest
    if (!runId) throw new Error(`Usage: telegraph remote ${subcommand} <runId> [--reason text]`)
    const flags = parseFlags(tail)
    printJson(await sendRemote('requestRunControlCommand', {
      runId,
      kind: subcommand,
      requestedBy: remoteActorFromFlags(flags),
      reason: flags.reason,
    }))
    return
  }

  if (command === 'remote' && subcommand === 'control') {
    const [action, ...tail] = rest
    const flags = parseFlags(tail)
    if (action === 'commands') {
      printJson(await sendRemote('listRunControlCommands', runControlListOptions(flags)))
      return
    }
    if (action === 'changes') {
      printJson(await sendRemote('listRunControlChanges', runControlListOptions(flags)))
      return
    }
    throw new Error('Usage: telegraph remote control commands|changes [--run runId] [--kind pause|cancel|stop] [--status accepted|rejected|applied]')
  }

  if (command === 'remote' && subcommand === 'devices') {
    printJson(await sendRemote('listDeviceBindings'))
    return
  }

  if (command === 'remote' && subcommand === 'runs') {
    const flags = parseFlags(rest)
    printJson(await sendRemote('listRunProjections', pickDefined({
      pageletId: flags.pagelet,
      status: flags.status,
      sessionId: flags.session,
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'remote' && subcommand === 'projection-changes') {
    const flags = parseFlags(rest)
    printJson(await sendRemote('listRunProjectionChanges', pickDefined({
      runId: flags.run,
      pageletId: flags.pagelet,
      status: flags.status,
      afterCursor: parseOptionalNumber(flags.after, '--after'),
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'remote' && subcommand === 'projection') {
    const [action, runId] = rest
    if (action !== 'get' || !runId) throw new Error('Usage: telegraph remote projection get <runId>')
    printJson(await sendRemote('getRunProjection', { runId }))
    return
  }

  if (command === 'remote' && subcommand === 'device') {
    const [action, ...tail] = rest
    if (action === 'bind') {
      const flags = parseFlags(tail)
      if (!flags.device) throw new Error('Usage: telegraph remote device bind --device deviceId [--label text]')
      printJson(await sendRemote('createDeviceBinding', pickDefined({
        deviceId: flags.device,
        actor: remoteActorFromFlags(flags),
        label: flags.label,
        expiresAt: flags.expiresAt ? Number(flags.expiresAt) : undefined,
      })))
      return
    }
    if (action === 'revoke') {
      const [bindingId] = tail
      if (!bindingId) throw new Error('Usage: telegraph remote device revoke <bindingId>')
      printJson(await sendRemote('revokeDeviceBinding', { bindingId }))
      return
    }
    throw new Error('Usage: telegraph remote device bind|revoke ...')
  }

  if (command === 'remote' && subcommand === 'slack') {
    const [resource, action, ...tail] = rest
    if (resource === 'workspaces') {
      printJson(await sendRemote('listSlackWorkspaceBindings'))
      return
    }
    if (resource === 'workspace' && action === 'bind') {
      const flags = parseFlags(tail)
      if (!flags.workspace) {
        throw new Error('Usage: telegraph remote slack workspace bind --workspace T123 [--domain example] [--policy profile]')
      }
      printJson(await sendRemote('createSlackWorkspaceBinding', pickDefined({
        workspaceId: flags.workspace,
        teamDomain: flags.domain,
        policyProfileId: flags.policy,
      })))
      return
    }
    if (resource === 'workspace' && action === 'revoke') {
      const [workspaceId] = tail
      if (!workspaceId) throw new Error('Usage: telegraph remote slack workspace revoke <workspaceId>')
      printJson(await sendRemote('revokeSlackWorkspaceBinding', { workspaceId }))
      return
    }
    if (resource === 'app' && action === 'installs') {
      printJson(await sendRemote('listSlackAppInstallations'))
      return
    }
    if (resource === 'app' && action === 'install') {
      const flags = parseFlags(tail)
      if (!flags.workspace) {
        throw new Error('Usage: telegraph remote slack app install --workspace T123 [--domain example] [--app A123] [--bot-user U123] [--bot-token-ref secret://...] [--scope commands,chat:write] [--installer U123] [--policy profile]')
      }
      printJson(await sendRemote('createSlackAppInstallation', pickDefined({
        installationId: flags.installation,
        workspaceId: flags.workspace,
        teamDomain: flags.domain,
        appId: flags.app,
        enterpriseId: flags.enterprise,
        botUserId: flags.botUser ?? flags['bot-user'],
        botTokenRef: flags.botTokenRef ?? flags['bot-token-ref'],
        userTokenRef: flags.userTokenRef ?? flags['user-token-ref'],
        scopes: slackScopesFromFlags(flags),
        installedByUserId: flags.installer,
        installerRole: flags.installerRole ?? flags['installer-role'],
        policyProfileId: flags.policy,
      })))
      return
    }
    if (resource === 'app' && action === 'revoke') {
      const [installationId] = tail
      if (!installationId) throw new Error('Usage: telegraph remote slack app revoke <installationId>')
      printJson(await sendRemote('revokeSlackAppInstallation', { installationId }))
      return
    }
    if (resource === 'oauth' && action === 'callback') {
      const flags = parseFlags(tail)
      if (!flags.code) {
        throw new Error('Usage: telegraph remote slack oauth callback --code code [--state state] [--redirect-uri uri] [--policy profile]')
      }
      printJson(await sendRemote('handleSlackOAuthCallback', pickDefined({
        code: flags.code,
        state: flags.state,
        redirectUri: flags.redirectUri ?? flags['redirect-uri'],
        policyProfileId: flags.policy,
        installerRole: flags.installerRole ?? flags['installer-role'],
      })))
      return
    }
    if (resource === 'users') {
      printJson(await sendRemote('listSlackUserBindings'))
      return
    }
    if (resource === 'user' && action === 'bind') {
      const flags = parseFlags(tail)
      if (!flags.workspace || !flags.user) {
        throw new Error('Usage: telegraph remote slack user bind --workspace T123 --user U123 [--role member|operator|admin] [--policy profile]')
      }
      printJson(await sendRemote('createSlackUserBinding', pickDefined({
        workspaceId: flags.workspace,
        userId: flags.user,
        actorId: flags.actor,
        role: flags.role,
        policyProfileId: flags.policy,
      })))
      return
    }
    if (resource === 'user' && action === 'revoke') {
      const [workspaceId, userId] = tail
      if (!workspaceId || !userId) {
        throw new Error('Usage: telegraph remote slack user revoke <workspaceId> <userId>')
      }
      printJson(await sendRemote('revokeSlackUserBinding', { workspaceId, userId }))
      return
    }
    if (resource === 'devices') {
      printJson(await sendRemote('listSlackDeviceBindings'))
      return
    }
    if (resource === 'device' && action === 'bind') {
      const flags = parseFlags(tail)
      if (!flags.workspace || !flags.user || !flags.device) {
        throw new Error('Usage: telegraph remote slack device bind --workspace T123 --user U123 --device deviceId [--actor actorId] [--label text] [--expires-at ts]')
      }
      printJson(await sendRemote('createSlackDeviceBinding', pickDefined({
        bindingId: flags.binding,
        workspaceId: flags.workspace,
        userId: flags.user,
        deviceId: flags.device,
        actorId: flags.actor,
        label: flags.label,
        expiresAt: flags.expiresAt ? Number(flags.expiresAt) : undefined,
      })))
      return
    }
    if (resource === 'device' && action === 'revoke') {
      const [bindingId] = tail
      if (!bindingId) throw new Error('Usage: telegraph remote slack device revoke <bindingId>')
      printJson(await sendRemote('revokeSlackDeviceBinding', { bindingId }))
      return
    }
    if (resource === 'audit') {
      printJson(await sendRemote('listSlackTeamAuditEvents'))
      return
    }
    if (resource === 'lifecycle') {
      const kind = slackLifecycleKind(action)
      const flags = parseFlags(tail)
      if (!kind || !flags.workspace) {
        throw new Error('Usage: telegraph remote slack lifecycle tokens-revoked|user-left|app-uninstalled --workspace T123 [--user U123|--users U123,U456] [--actor actorId] [--reason text]')
      }
      const userIds = slackUserIdsFromFlags(flags)
      printJson(await sendRemote('handleSlackLifecycleEvent', {
        event: pickDefined({
          kind,
          workspaceId: flags.workspace,
          userIds: userIds.length > 0 ? userIds : undefined,
          actorId: flags.actor,
          reason: flags.reason,
        }),
      }))
      return
    }
    throw new Error('Usage: telegraph remote slack workspaces|users|devices|audit|workspace bind|workspace revoke|app installs|app install|app revoke|oauth callback|user bind|user revoke|device bind|device revoke|lifecycle ...')
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

  if (command === 'projection-changes') {
    const flags = parseFlags([subcommand, ...rest].filter(Boolean))
    printJson(await send('listRunProjectionChanges', pickDefined({
      runId: flags.run,
      pageletId: flags.pagelet,
      status: flags.status,
      afterCursor: parseOptionalNumber(flags.after, '--after'),
      limit: flags.limit ? Number(flags.limit) : undefined,
    })))
    return
  }

  if (command === 'open') {
    const [runId] = [subcommand, ...rest].filter(Boolean)
    if (!runId) throw new Error('Usage: telegraph open <runId>')
    printJson(await send('openRun', { runId }))
    return
  }

  if (command === 'attach') {
    const [runId, ...tail] = [subcommand, ...rest].filter(Boolean)
    if (!runId) throw new Error('Usage: telegraph attach <runId> [--json] [--follow]')
    const flags = parseFlags(tail)
    await attachRun(runId, {
      json: flags.json === 'true',
      follow: flags.follow === 'true',
      afterCursor: parseOptionalNumber(flags.after, '--after'),
    })
    return
  }

  if (command === 'events') {
    const [runId, ...tail] = [subcommand, ...rest].filter(Boolean)
    if (!runId) throw new Error('Usage: telegraph events <runId> [--pagelet design|chat] [--after seq] [--json]')
    const flags = parseFlags(tail)
    printRunEvents(readRunEvents(runId, {
      pagelet: flags.pagelet ?? 'design',
      after: parseOptionalNumber(flags.after, '--after'),
    }), flags.json === 'true')
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

  if (command === 'approval-changes') {
    const flags = parseFlags([subcommand, ...rest].filter(Boolean))
    printJson(await send('listApprovalChanges', pickDefined({
      runId: flags.run,
      status: flags.status,
      afterCursor: parseOptionalNumber(flags.after, '--after'),
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

  if (isRunControlKind(command)) {
    const [runId, ...tail] = [subcommand, ...rest].filter(Boolean)
    if (!runId) throw new Error(`Usage: telegraph ${command} <runId> [--reason text]`)
    const flags = parseFlags(tail)
    printJson(await send('requestRunControlCommand', {
      runId,
      kind: command,
      requestedBy: cliActor(),
      reason: flags.reason,
    }))
    return
  }

  if (command === 'control') {
    const [action, ...tail] = [subcommand, ...rest].filter(Boolean)
    const flags = parseFlags(tail)
    if (action === 'commands') {
      printJson(await send('listRunControlCommands', runControlListOptions(flags)))
      return
    }
    if (action === 'changes') {
      printJson(await send('listRunControlChanges', runControlListOptions(flags)))
      return
    }
    throw new Error('Usage: telegraph control commands|changes [--run runId] [--kind pause|cancel|stop] [--status accepted|rejected|applied]')
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(' ')}`)
}

function send(method, params) {
  return sendLineProtocol(process.env[RUN_BROKER_SOCKET_ENV] || defaultRunBrokerSocketPath(), method, params)
}

function sendRemote(method, params) {
  return sendLineProtocol(process.env[REMOTE_CONTROL_SOCKET_ENV] || defaultRemoteControlSocketPath(), method, params)
}

function sendLineProtocol(socketPath, method, params) {
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

function startMcpServer() {
  process.stdin.setEncoding('utf8')
  let buffer = ''
  process.stdin.on('data', chunk => {
    buffer += String(chunk)
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      void handleMcpLine(line)
    }
  })
}

async function handleMcpLine(line) {
  let request
  try {
    request = JSON.parse(line)
  } catch (error) {
    writeMcpError(undefined, -32700, error instanceof Error ? error.message : String(error))
    return
  }

  if (!isMcpRequest(request)) {
    writeMcpError(undefined, -32600, 'Invalid JSON-RPC request')
    return
  }

  if (request.id === undefined) {
    await handleMcpNotification(request)
    return
  }

  try {
    const result = await dispatchMcpRequest(request)
    writeMcpResponse(request.id, result)
  } catch (error) {
    writeMcpError(request.id, -32603, error instanceof Error ? error.message : String(error))
  }
}

async function handleMcpNotification(request) {
  if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') return
  process.stderr.write(`Ignoring MCP notification: ${request.method}\n`)
}

async function dispatchMcpRequest(request) {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: '2025-11-25',
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'telegraph',
          version: '0.0.0',
        },
      }
    case 'tools/list':
      return { tools: mcpTools() }
    case 'tools/call':
      return callMcpTool(request.params)
    default:
      throw new Error(`Method not found: ${request.method}`)
  }
}

async function callMcpTool(params) {
  const name = params?.name
  const args = params?.arguments ?? {}
  if (typeof name !== 'string' || !isPlainObject(args)) {
    return mcpToolError('tools/call requires params.name and params.arguments')
  }

  switch (name) {
    case 'telegraph_run_intent_create':
      return mcpToolResult(await send('createRunIntent', pickDefined({
        source: cliActor(),
        targetPagelet: stringArg(args, 'pagelet') ?? 'design',
        prompt: requiredStringArg(args, 'prompt'),
        sessionId: stringArg(args, 'sessionId'),
        metadata: isPlainObject(args.metadata) ? args.metadata : { mcp: true },
      })))
    case 'telegraph_remote_submit':
      return mcpToolResult(await sendRemote('submitExternalMessage', {
        message: externalMessageFromOptions({
          text: requiredStringArg(args, 'prompt'),
          channel: stringArg(args, 'channel') ?? 'mcp',
          actor: stringArg(args, 'actor') ?? 'mcp:local',
          name: stringArg(args, 'name') ?? 'MCP Client',
          channelId: stringArg(args, 'channelId') ?? 'mcp:local',
          thread: stringArg(args, 'threadId'),
          device: stringArg(args, 'deviceId'),
        }),
        options: pickDefined({
          targetPagelet: stringArg(args, 'pagelet'),
          sessionId: stringArg(args, 'sessionId'),
          requireDeviceBinding: booleanArg(args, 'requireDeviceBinding'),
        }),
      }))
    case 'telegraph_remote_replies_list':
      return mcpToolResult(await sendRemote('listChannelReplies', pickDefined({
        channelId: stringArg(args, 'channelId'),
        threadId: stringArg(args, 'threadId'),
        runId: stringArg(args, 'runId'),
        status: stringArg(args, 'status'),
        deliveryStatus: stringArg(args, 'deliveryStatus'),
        afterCursor: numberArg(args, 'afterCursor'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_remote_reply_ack':
      return mcpToolResult(await sendRemote('ackChannelReply', {
        replyId: requiredStringArg(args, 'replyId'),
        status: stringArg(args, 'status') ?? 'sent',
        deliveredBy: remoteActorFromOptions({
          channel: stringArg(args, 'channel') ?? 'mcp',
          actor: stringArg(args, 'actor') ?? 'mcp:local',
          name: stringArg(args, 'name') ?? 'MCP Client',
          channelId: stringArg(args, 'channelId'),
          device: stringArg(args, 'deviceId'),
        }),
        error: stringArg(args, 'error'),
      }))
    case 'telegraph_remote_approvals_list':
      return mcpToolResult(await sendRemote('listApprovals', pickDefined({
        runId: stringArg(args, 'runId'),
        status: stringArg(args, 'status'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_remote_approval_changes_list':
      return mcpToolResult(await sendRemote('listApprovalChanges', pickDefined({
        runId: stringArg(args, 'runId'),
        status: stringArg(args, 'status'),
        afterCursor: numberArg(args, 'afterCursor'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_remote_approval_decide':
      return mcpToolResult(await sendRemote('decideApproval', {
        approvalId: requiredStringArg(args, 'approvalId'),
        input: {
          granted: requiredBooleanArg(args, 'granted'),
          decidedBy: remoteActorFromOptions({
            channel: stringArg(args, 'channel') ?? 'mcp',
            actor: stringArg(args, 'actor') ?? 'mcp:local',
            name: stringArg(args, 'name') ?? 'MCP Client',
            channelId: stringArg(args, 'channelId'),
            device: stringArg(args, 'deviceId'),
          }),
          reason: stringArg(args, 'reason'),
        },
      }))
    case 'telegraph_remote_run_control_request':
      return mcpToolResult(await sendRemote('requestRunControlCommand', {
        runId: requiredStringArg(args, 'runId'),
        kind: requiredRunControlKindArg(args, 'kind'),
        requestedBy: remoteActorFromOptions({
          channel: stringArg(args, 'channel') ?? 'mcp',
          actor: stringArg(args, 'actor') ?? 'mcp:local',
          name: stringArg(args, 'name') ?? 'MCP Client',
          channelId: stringArg(args, 'channelId'),
          device: stringArg(args, 'deviceId'),
        }),
        reason: stringArg(args, 'reason'),
      }))
    case 'telegraph_remote_run_control_commands_list':
      return mcpToolResult(await sendRemote('listRunControlCommands', pickDefined({
        runId: stringArg(args, 'runId'),
        kind: runControlKindArg(args, 'kind'),
        status: stringArg(args, 'status'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_remote_run_control_changes_list':
      return mcpToolResult(await sendRemote('listRunControlChanges', pickDefined({
        runId: stringArg(args, 'runId'),
        kind: runControlKindArg(args, 'kind'),
        status: stringArg(args, 'status'),
        afterCursor: numberArg(args, 'afterCursor'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_remote_devices_list':
      return mcpToolResult(await sendRemote('listDeviceBindings'))
    case 'telegraph_remote_device_bind':
      return mcpToolResult(await sendRemote('createDeviceBinding', pickDefined({
        deviceId: requiredStringArg(args, 'deviceId'),
        actor: remoteActorFromOptions({
          channel: stringArg(args, 'channel') ?? 'mcp',
          actor: stringArg(args, 'actor') ?? 'mcp:local',
          name: stringArg(args, 'name') ?? 'MCP Client',
          channelId: stringArg(args, 'channelId'),
          device: stringArg(args, 'deviceId'),
        }),
        label: stringArg(args, 'label'),
        expiresAt: numberArg(args, 'expiresAt'),
      })))
    case 'telegraph_remote_device_revoke':
      return mcpToolResult(await sendRemote('revokeDeviceBinding', {
        bindingId: requiredStringArg(args, 'bindingId'),
      }))
    case 'telegraph_remote_runs_list':
      return mcpToolResult(await sendRemote('listRunProjections', pickDefined({
        pageletId: stringArg(args, 'pagelet'),
        status: stringArg(args, 'status'),
        sessionId: stringArg(args, 'sessionId'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_remote_projection_get':
      return mcpToolResult(await sendRemote('getRunProjection', {
        runId: requiredStringArg(args, 'runId'),
      }))
    case 'telegraph_remote_projection_changes_list':
      return mcpToolResult(await sendRemote('listRunProjectionChanges', pickDefined({
        runId: stringArg(args, 'runId'),
        pageletId: stringArg(args, 'pagelet'),
        status: stringArg(args, 'status'),
        afterCursor: numberArg(args, 'afterCursor'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_runs_list':
      return mcpToolResult(await send('listRunProjections', pickDefined({
        pageletId: stringArg(args, 'pagelet'),
        status: stringArg(args, 'status'),
        sessionId: stringArg(args, 'sessionId'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_projection_get':
      return mcpToolResult(await send('getRunProjection', {
        runId: requiredStringArg(args, 'runId'),
      }))
    case 'telegraph_projection_changes_list':
      return mcpToolResult(await send('listRunProjectionChanges', pickDefined({
        runId: stringArg(args, 'runId'),
        pageletId: stringArg(args, 'pagelet'),
        status: stringArg(args, 'status'),
        afterCursor: numberArg(args, 'afterCursor'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_run_open':
      return mcpToolResult(await send('openRun', {
        runId: requiredStringArg(args, 'runId'),
      }))
    case 'telegraph_approvals_list':
      return mcpToolResult(await send('listApprovals', pickDefined({
        runId: stringArg(args, 'runId'),
        status: stringArg(args, 'status'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_approval_changes_list':
      return mcpToolResult(await send('listApprovalChanges', pickDefined({
        runId: stringArg(args, 'runId'),
        status: stringArg(args, 'status'),
        afterCursor: numberArg(args, 'afterCursor'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_approval_decide':
      return mcpToolResult(await send('decideApproval', {
        approvalId: requiredStringArg(args, 'approvalId'),
        input: {
          granted: requiredBooleanArg(args, 'granted'),
          decidedBy: cliActor(),
          reason: stringArg(args, 'reason'),
        },
      }))
    case 'telegraph_run_control_request':
      return mcpToolResult(await send('requestRunControlCommand', {
        runId: requiredStringArg(args, 'runId'),
        kind: requiredRunControlKindArg(args, 'kind'),
        requestedBy: cliActor(),
        reason: stringArg(args, 'reason'),
      }))
    case 'telegraph_run_control_commands_list':
      return mcpToolResult(await send('listRunControlCommands', pickDefined({
        runId: stringArg(args, 'runId'),
        kind: runControlKindArg(args, 'kind'),
        status: stringArg(args, 'status'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_run_control_changes_list':
      return mcpToolResult(await send('listRunControlChanges', pickDefined({
        runId: stringArg(args, 'runId'),
        kind: runControlKindArg(args, 'kind'),
        status: stringArg(args, 'status'),
        afterCursor: numberArg(args, 'afterCursor'),
        limit: numberArg(args, 'limit'),
      })))
    case 'telegraph_events_list':
      return mcpToolResult(readRunEvents(requiredStringArg(args, 'runId'), {
        pagelet: stringArg(args, 'pagelet') ?? 'design',
        after: numberArg(args, 'after'),
      }))
    default:
      return mcpToolError(`Unknown tool: ${name}`)
  }
}

function mcpTools() {
  return [
    {
      name: 'telegraph_run_intent_create',
      title: 'Create Telegraph Run Intent',
      description: 'Create a RunIntent for a Telegraph pagelet through the local RunBroker gateway.',
      inputSchema: objectSchema({
        prompt: { type: 'string' },
        pagelet: { type: 'string', default: 'design' },
        sessionId: { type: 'string' },
        metadata: { type: 'object' },
      }, ['prompt']),
    },
    {
      name: 'telegraph_remote_submit',
      title: 'Submit Telegraph External Message',
      description: 'Submit an ExternalMessage through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        prompt: { type: 'string' },
        pagelet: { type: 'string', default: 'design' },
        sessionId: { type: 'string' },
        channel: { type: 'string', default: 'mcp' },
        actor: { type: 'string' },
        name: { type: 'string' },
        channelId: { type: 'string' },
        threadId: { type: 'string' },
        deviceId: { type: 'string' },
        requireDeviceBinding: { type: 'boolean' },
      }, ['prompt']),
    },
    {
      name: 'telegraph_remote_replies_list',
      title: 'List Telegraph Remote Replies',
      description: 'List queued ChannelReply records from the remote-control local relay gateway.',
      inputSchema: objectSchema({
        channelId: { type: 'string' },
        threadId: { type: 'string' },
        runId: { type: 'string' },
        status: { type: 'string' },
        deliveryStatus: { type: 'string' },
        afterCursor: { type: 'number' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_remote_reply_ack',
      title: 'Acknowledge Telegraph Remote Reply Delivery',
      description: 'Mark a ChannelReply as sent, failed, or skipped after adapter delivery.',
      inputSchema: objectSchema({
        replyId: { type: 'string' },
        status: { type: 'string', default: 'sent' },
        error: { type: 'string' },
        channel: { type: 'string', default: 'mcp' },
        actor: { type: 'string' },
        name: { type: 'string' },
        channelId: { type: 'string' },
        deviceId: { type: 'string' },
      }, ['replyId']),
    },
    {
      name: 'telegraph_remote_approvals_list',
      title: 'List Telegraph Remote Approvals',
      description: 'List approval requests through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_remote_approval_changes_list',
      title: 'List Telegraph Remote Approval Changes',
      description: 'List cursor-addressable approval changes through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        status: { type: 'string' },
        afterCursor: { type: 'number' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_remote_approval_decide',
      title: 'Decide Telegraph Remote Approval',
      description: 'Approve or deny an approval request through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        approvalId: { type: 'string' },
        granted: { type: 'boolean' },
        reason: { type: 'string' },
        channel: { type: 'string', default: 'mcp' },
        actor: { type: 'string' },
        name: { type: 'string' },
        channelId: { type: 'string' },
        deviceId: { type: 'string' },
      }, ['approvalId', 'granted']),
    },
    {
      name: 'telegraph_remote_run_control_request',
      title: 'Request Telegraph Remote Run Control',
      description: 'Request pause, cancel, or stop for a run through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        kind: { type: 'string' },
        reason: { type: 'string' },
        channel: { type: 'string', default: 'mcp' },
        actor: { type: 'string' },
        name: { type: 'string' },
        channelId: { type: 'string' },
        deviceId: { type: 'string' },
      }, ['runId', 'kind']),
    },
    {
      name: 'telegraph_remote_run_control_commands_list',
      title: 'List Telegraph Remote Run Control Commands',
      description: 'List run control commands through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        kind: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_remote_run_control_changes_list',
      title: 'List Telegraph Remote Run Control Changes',
      description: 'List cursor-addressable run control changes through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        kind: { type: 'string' },
        status: { type: 'string' },
        afterCursor: { type: 'number' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_remote_devices_list',
      title: 'List Telegraph Remote Devices',
      description: 'List remote-control device bindings.',
      inputSchema: objectSchema({}),
    },
    {
      name: 'telegraph_remote_device_bind',
      title: 'Bind Telegraph Remote Device',
      description: 'Create a remote-control device binding.',
      inputSchema: objectSchema({
        deviceId: { type: 'string' },
        label: { type: 'string' },
        expiresAt: { type: 'number' },
        channel: { type: 'string', default: 'mcp' },
        actor: { type: 'string' },
        name: { type: 'string' },
        channelId: { type: 'string' },
      }, ['deviceId']),
    },
    {
      name: 'telegraph_remote_device_revoke',
      title: 'Revoke Telegraph Remote Device',
      description: 'Revoke a remote-control device binding.',
      inputSchema: objectSchema({
        bindingId: { type: 'string' },
      }, ['bindingId']),
    },
    {
      name: 'telegraph_remote_runs_list',
      title: 'List Telegraph Remote Runs',
      description: 'List run projections through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        pagelet: { type: 'string' },
        status: { type: 'string' },
        sessionId: { type: 'string' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_remote_projection_get',
      title: 'Get Telegraph Remote Run Projection',
      description: 'Get a run projection through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
      }, ['runId']),
    },
    {
      name: 'telegraph_remote_projection_changes_list',
      title: 'List Telegraph Remote Projection Changes',
      description: 'List cursor-addressable run projection changes through the remote-control local relay gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        pagelet: { type: 'string' },
        status: { type: 'string' },
        afterCursor: { type: 'number' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_runs_list',
      title: 'List Telegraph Runs',
      description: 'List RunBroker projection records.',
      inputSchema: objectSchema({
        pagelet: { type: 'string' },
        status: { type: 'string' },
        sessionId: { type: 'string' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_projection_get',
      title: 'Get Telegraph Run Projection',
      description: 'Get a RunBroker projection record by runId.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
      }, ['runId']),
    },
    {
      name: 'telegraph_projection_changes_list',
      title: 'List Telegraph Projection Changes',
      description: 'List cursor-addressable run projection changes from the local RunBroker gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        pagelet: { type: 'string' },
        status: { type: 'string' },
        afterCursor: { type: 'number' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_run_open',
      title: 'Open Telegraph Run',
      description: 'Focus Telegraph Desktop on the Run Console for a runId through the cli-gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
      }, ['runId']),
    },
    {
      name: 'telegraph_events_list',
      title: 'List Telegraph Run Events',
      description: 'Read pagelet-local persisted RuntimeEvent records for a run.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        pagelet: { type: 'string', default: 'design' },
        after: { type: 'number' },
      }, ['runId']),
    },
    {
      name: 'telegraph_approval_changes_list',
      title: 'List Telegraph Approval Changes',
      description: 'List cursor-addressable approval changes from the local RunBroker gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        status: { type: 'string' },
        afterCursor: { type: 'number' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_approvals_list',
      title: 'List Telegraph Approvals',
      description: 'List RunBroker approval requests.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_approval_decide',
      title: 'Decide Telegraph Approval',
      description: 'Approve or deny a RunBroker approval request.',
      inputSchema: objectSchema({
        approvalId: { type: 'string' },
        granted: { type: 'boolean' },
        reason: { type: 'string' },
      }, ['approvalId', 'granted']),
    },
    {
      name: 'telegraph_run_control_request',
      title: 'Request Telegraph Run Control',
      description: 'Request pause, cancel, or stop for a run through the local RunBroker gateway.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        kind: { type: 'string' },
        reason: { type: 'string' },
      }, ['runId', 'kind']),
    },
    {
      name: 'telegraph_run_control_commands_list',
      title: 'List Telegraph Run Control Commands',
      description: 'List RunBroker run control command records.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        kind: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'number' },
      }),
    },
    {
      name: 'telegraph_run_control_changes_list',
      title: 'List Telegraph Run Control Changes',
      description: 'List cursor-addressable RunBroker run control command changes.',
      inputSchema: objectSchema({
        runId: { type: 'string' },
        kind: { type: 'string' },
        status: { type: 'string' },
        afterCursor: { type: 'number' },
        limit: { type: 'number' },
      }),
    },
  ].map(withMcpToolMetadata)
}

function withMcpToolMetadata(tool) {
  return {
    ...tool,
    _meta: {
      'telegraph/toolSchemaVersion': MCP_TOOL_SCHEMA_VERSION,
      'telegraph/transport': mcpToolTransport(tool.name),
    },
  }
}

function mcpToolTransport(name) {
  if (name.startsWith('telegraph_remote_')) return 'remote-control'
  if (name === 'telegraph_events_list') return 'pagelet-ledger'
  if (name === 'telegraph_run_open') return 'cli-gateway'
  return 'run-broker'
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

function mcpToolResult(value) {
  const text = JSON.stringify(value, null, 2)
  return {
    content: [{ type: 'text', text }],
    structuredContent: { value },
    isError: false,
  }
}

function mcpToolError(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function writeMcpResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function writeMcpError(id, code, message) {
  const response = {
    jsonrpc: '2.0',
    error: { code, message },
  }
  if (id !== undefined) response.id = id
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

function isMcpRequest(value) {
  return isPlainObject(value) &&
    value.jsonrpc === '2.0' &&
    typeof value.method === 'string'
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredStringArg(args, key) {
  const value = stringArg(args, key)
  if (!value) throw new Error(`Missing required string argument: ${key}`)
  return value
}

function stringArg(args, key) {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function numberArg(args, key) {
  const value = args[key]
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`)
  return parsed
}

function booleanArg(args, key) {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}

function requiredBooleanArg(args, key) {
  const value = booleanArg(args, key)
  if (value === undefined) throw new Error(`Missing required boolean argument: ${key}`)
  return value
}

function runControlKindArg(args, key) {
  const value = stringArg(args, key)
  if (value === undefined) return undefined
  if (!isRunControlKind(value)) throw new Error(`${key} must be pause, cancel, or stop`)
  return value
}

function requiredRunControlKindArg(args, key) {
  const value = runControlKindArg(args, key)
  if (!value) throw new Error(`Missing required run control kind argument: ${key}`)
  return value
}

function isRunControlKind(value) {
  return value === 'pause' || value === 'cancel' || value === 'stop'
}

function runControlListOptions(flags) {
  return pickDefined({
    runId: flags.run,
    kind: flags.kind,
    status: flags.status,
    afterCursor: parseOptionalNumber(flags.after, '--after'),
    limit: flags.limit ? Number(flags.limit) : undefined,
  })
}

function slackLifecycleKind(value) {
  if (value === 'tokens-revoked' || value === 'tokens_revoked') return 'tokens_revoked'
  if (value === 'user-left' || value === 'user_left_workspace') return 'user_left_workspace'
  if (value === 'app-uninstalled' || value === 'app_uninstalled') return 'app_uninstalled'
  return undefined
}

function slackUserIdsFromFlags(flags) {
  return [
    ...String(flags.users ?? '').split(','),
    flags.user ?? '',
  ].map(value => value.trim()).filter(Boolean)
}

function slackScopesFromFlags(flags) {
  if (!flags.scope && !flags.scopes) return undefined
  return String(flags.scope ?? flags.scopes).split(',').map(value => value.trim()).filter(Boolean)
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

function externalMessageFromCli(flags) {
  const text = flags._.join(' ').trim()
  if (!text) throw new Error('Missing remote message text')
  return externalMessageFromOptions({
    text,
    channel: flags.channel ?? 'telegram',
    actor: flags.actor,
    name: flags.name,
    device: flags.device,
    channelId: flags.channelId,
    workspace: flags.workspace,
    policy: flags.policy,
    thread: flags.thread,
    messageId: flags.messageId,
  })
}

function remoteActorFromFlags(flags) {
  return remoteActorFromOptions({
    channel: flags.channel ?? 'telegram',
    actor: flags.actor,
    name: flags.name,
    device: flags.device,
    channelId: flags.channelId,
    workspace: flags.workspace,
    policy: flags.policy,
  })
}

function externalMessageFromOptions(options) {
  const channelKind = options.channel ?? 'telegram'
  const actorId = options.actor ?? `${channelKind}:${process.env.USER || 'local'}`
  return {
    messageId: options.messageId ?? `msg-${Date.now().toString(36)}`,
    actor: pickDefined({
      actorId,
      kind: channelKind,
      displayName: options.name ?? process.env.USER ?? 'Local User',
      deviceId: options.device,
      channelId: options.channelId,
      workspaceId: options.workspace,
      policyProfileId: options.policy,
    }),
    channel: pickDefined({
      kind: channelKind,
      channelId: options.channelId ?? `${channelKind}:local`,
      threadId: options.thread,
    }),
    text: options.text,
    receivedAt: Date.now(),
    schemaVersion: 1,
  }
}

function remoteActorFromOptions(options) {
  const channelKind = options.channel ?? 'telegram'
  const actorId = options.actor ?? `${channelKind}:${process.env.USER || 'local'}`
  return pickDefined({
    actorId,
    kind: channelKind,
    displayName: options.name ?? process.env.USER ?? 'Local User',
    deviceId: options.device,
    channelId: options.channelId,
    workspaceId: options.workspace,
    policyProfileId: options.policy,
  })
}

function attachRun(runId, options) {
  const socketPath = process.env[RUN_BROKER_SOCKET_ENV] || defaultRunBrokerSocketPath()
  const request = {
    id: Date.now(),
    method: 'subscribeRunProjections',
    params: pickDefined({ runId, afterCursor: options.afterCursor }),
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

function parseOptionalNumber(value, label) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number`)
  return parsed
}

function cliActor() {
  return {
    actorId: `cli:${process.env.USER || 'local'}`,
    kind: 'cli',
    displayName: process.env.USER || 'Local CLI',
  }
}

function defaultRunBrokerSocketPath() {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
  if (process.platform === 'win32') return `\\\\.\\pipe\\telegraph-run-broker-${uid}`
  return join(tmpdir(), `telegraph-run-broker-${uid}.sock`)
}

function defaultRemoteControlSocketPath() {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
  if (process.platform === 'win32') return `\\\\.\\pipe\\telegraph-remote-control-${uid}`
  return join(tmpdir(), `telegraph-remote-control-${uid}.sock`)
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

function readRunEvents(runId, options) {
  const eventPath = runEventsPath(runId, options.pagelet)
  if (!existsSync(eventPath)) return []
  return readFileSync(eventPath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(record => options.after === undefined || Number(record.seq) > options.after)
}

function runEventsPath(runId, pagelet) {
  const baseDir = pagelet === 'chat'
    ? join(process.cwd(), '.telegraph', 'runs')
    : join(process.cwd(), '.telegraph', `${pagelet}-runs`)
  return join(baseDir, sanitizePathSegment(runId), 'events.jsonl')
}

function sanitizePathSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function printRunEvents(events, json) {
  if (json) {
    for (const event of events) {
      process.stdout.write(`${JSON.stringify(event)}\n`)
    }
    return
  }
  for (const record of events) {
    const event = record.event ?? {}
    const type = typeof event.type === 'string' ? event.type : 'unknown'
    const ts = typeof record.ts === 'number' ? String(record.ts) : '-'
    process.stdout.write(`${String(record.seq)}  ${type}  ts=${ts}\n`)
  }
}

function isTerminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'recovered'
}

function printHelp() {
  process.stdout.write(`Telegraph CLI

Usage:
  telegraph runs [--pagelet design] [--status running]
  telegraph projection get <runId>
  telegraph projection-changes [--run runId] [--pagelet design] [--after cursor]
  telegraph open <runId>
  telegraph attach <runId> [--json] [--follow] [--after cursor]
  telegraph events <runId> [--pagelet design|chat] [--after seq] [--json]
  telegraph mcp
  telegraph mcp-schema
  telegraph remote submit [--channel telegram] [--actor actorId] [--pagelet design] [--requireDeviceBinding true] <message>
  telegraph remote replies [--channelId id] [--thread id] [--run runId] [--after cursor] [--deliveryStatus sent]
  telegraph remote reply ack <replyId> [--status sent|failed|skipped] [--error text]
  telegraph remote approvals [--run runId] [--status pending]
  telegraph remote approval-changes [--run runId] [--status pending] [--after cursor]
  telegraph remote approve <approvalId> [--actor actorId] [--reason text]
  telegraph remote deny <approvalId> [--actor actorId] [--reason text]
  telegraph remote pause|cancel|stop <runId> [--actor actorId] [--reason text]
  telegraph remote control commands|changes [--run runId] [--kind pause|cancel|stop] [--status accepted|rejected|applied]
  telegraph remote devices
  telegraph remote runs [--pagelet design] [--status running]
  telegraph remote projection get <runId>
  telegraph remote projection-changes [--run runId] [--pagelet design] [--after cursor]
  telegraph remote device bind --device deviceId [--actor actorId] [--label text]
  telegraph remote device revoke <bindingId>
  telegraph remote slack workspaces
  telegraph remote slack workspace bind --workspace T123 [--domain example] [--policy profile]
  telegraph remote slack workspace revoke <workspaceId>
  telegraph remote slack app installs
  telegraph remote slack app install --workspace T123 [--domain example] [--app A123] [--bot-user U123] [--bot-token-ref secret://...] [--scope commands,chat:write] [--installer U123] [--policy profile]
  telegraph remote slack app revoke <installationId>
  telegraph remote slack oauth callback --code code [--state state] [--redirect-uri uri] [--policy profile]
  telegraph remote slack users
  telegraph remote slack user bind --workspace T123 --user U123 [--role member|operator|admin] [--policy profile]
  telegraph remote slack user revoke <workspaceId> <userId>
  telegraph remote slack devices
  telegraph remote slack device bind --workspace T123 --user U123 --device deviceId [--actor actorId] [--label text]
  telegraph remote slack device revoke <bindingId>
  telegraph remote slack lifecycle tokens-revoked|user-left|app-uninstalled --workspace T123 [--user U123|--users U123,U456]
  telegraph remote slack audit
  telegraph ask [--pagelet design] [--session sessionId] <prompt>
  telegraph intents [--pagelet design] [--status queued]
  telegraph intent create [--pagelet design] [--session sessionId] <prompt>
  telegraph intent claim <intentId> <runId> [--by pagelet:design:1]
  telegraph approvals [--run runId] [--status pending]
  telegraph approval-changes [--run runId] [--status pending] [--after cursor]
  telegraph approve <approvalId> [--reason text]
  telegraph deny <approvalId> [--reason text]
  telegraph pause|cancel|stop <runId> [--reason text]
  telegraph control commands|changes [--run runId] [--kind pause|cancel|stop] [--status accepted|rejected|applied]

Socket:
  ${RUN_BROKER_SOCKET_ENV}=${process.env[RUN_BROKER_SOCKET_ENV] || defaultRunBrokerSocketPath()}
  ${REMOTE_CONTROL_SOCKET_ENV}=${process.env[REMOTE_CONTROL_SOCKET_ENV] || defaultRemoteControlSocketPath()}
`)
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
