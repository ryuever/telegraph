import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('submits remote ExternalMessage payloads through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        intent: {
          intentId: 'intent-remote',
          prompt: request.params.message.text,
          targetPagelet: request.params.options.targetPagelet,
        },
        reply: {
          status: 'queued',
        },
      },
    }))

    const result = await runCli([
      'remote',
      'submit',
      '--channel',
      'telegram',
      '--actor',
      'telegram:ada',
      '--pagelet',
      'design',
      'build',
      'from',
      'phone',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      intent: {
        intentId: 'intent-remote',
        prompt: 'build from phone',
        targetPagelet: 'design',
      },
      reply: {
        status: 'queued',
      },
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'submitExternalMessage',
        params: expect.objectContaining({
          message: expect.objectContaining({
            actor: expect.objectContaining({
              actorId: 'telegram:ada',
              kind: 'telegram',
            }),
            channel: expect.objectContaining({
              kind: 'telegram',
            }),
            text: 'build from phone',
            schemaVersion: 1,
          }),
          options: {
            targetPagelet: 'design',
          },
        }),
      }),
    ])

    await remote.close()
  })

  it('lists remote channel replies through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: [{
        replyId: 'reply-remote',
        channelId: request.params.channelId,
        runId: request.params.runId,
        cursor: 2,
        status: 'sent',
      }],
    }))

    const result = await runCli([
      'remote',
      'replies',
      '--channelId',
      'telegram:chat',
      '--run',
      'run-remote',
      '--after',
      '1',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([{
      replyId: 'reply-remote',
      channelId: 'telegram:chat',
      runId: 'run-remote',
      cursor: 2,
      status: 'sent',
    }])
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'listChannelReplies',
        params: {
          channelId: 'telegram:chat',
          runId: 'run-remote',
          afterCursor: 1,
        },
      }),
    ])

    await remote.close()
  })

  it('acks remote channel reply delivery through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        replyId: request.params.replyId,
        status: 'queued',
        deliveryStatus: request.params.status,
        deliveryAttempts: 1,
      },
    }))

    const result = await runCli([
      'remote',
      'reply',
      'ack',
      'reply-remote',
      '--status',
      'sent',
      '--channel',
      'telegram',
      '--actor',
      'telegram:ada',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      replyId: 'reply-remote',
      status: 'queued',
      deliveryStatus: 'sent',
      deliveryAttempts: 1,
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'ackChannelReply',
        params: expect.objectContaining({
          replyId: 'reply-remote',
          status: 'sent',
          deliveredBy: expect.objectContaining({
            actorId: 'telegram:ada',
            kind: 'telegram',
          }),
        }),
      }),
    ])

    await remote.close()
  })


  it('decides approvals through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        approvalId: request.params.approvalId,
        status: request.params.input.granted ? 'approved' : 'denied',
        decidedBy: request.params.input.decidedBy,
      },
    }))

    const result = await runCli([
      'remote',
      'approve',
      'approval-1',
      '--channel',
      'telegram',
      '--actor',
      'telegram:ada',
      '--reason',
      'looks good',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      approvalId: 'approval-1',
      status: 'approved',
      decidedBy: {
        actorId: 'telegram:ada',
        kind: 'telegram',
      },
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'decideApproval',
        params: {
          approvalId: 'approval-1',
          input: expect.objectContaining({
            granted: true,
            reason: 'looks good',
            decidedBy: expect.objectContaining({
              actorId: 'telegram:ada',
              kind: 'telegram',
            }),
          }),
        },
      }),
    ])

    await remote.close()
  })

  it('requests remote run control through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        commandId: 'runctl-remote',
        runId: request.params.runId,
        kind: request.params.kind,
        status: 'accepted',
        requestedBy: request.params.requestedBy,
        reason: request.params.reason,
      },
    }))

    const result = await runCli([
      'remote',
      'cancel',
      'run-remote',
      '--channel',
      'telegram',
      '--actor',
      'telegram:ada',
      '--reason',
      'wrong task',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      commandId: 'runctl-remote',
      runId: 'run-remote',
      kind: 'cancel',
      status: 'accepted',
      requestedBy: {
        actorId: 'telegram:ada',
        kind: 'telegram',
      },
      reason: 'wrong task',
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'requestRunControlCommand',
        params: expect.objectContaining({
          runId: 'run-remote',
          kind: 'cancel',
          reason: 'wrong task',
          requestedBy: expect.objectContaining({
            actorId: 'telegram:ada',
            kind: 'telegram',
          }),
        }),
      }),
    ])

    await remote.close()
  })

  it('lists remote approval changes through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: [{
        type: 'approval_request_changed',
        approvalId: 'approval-1',
        runId: request.params.runId,
        cursor: 3,
        approval: {
          approvalId: 'approval-1',
          status: request.params.status,
        },
      }],
    }))

    const result = await runCli([
      'remote',
      'approval-changes',
      '--run',
      'run-remote',
      '--status',
      'pending',
      '--after',
      '2',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([{
      type: 'approval_request_changed',
      approvalId: 'approval-1',
      runId: 'run-remote',
      cursor: 3,
      approval: {
        approvalId: 'approval-1',
        status: 'pending',
      },
    }])
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'listApprovalChanges',
        params: {
          runId: 'run-remote',
          status: 'pending',
          afterCursor: 2,
        },
      }),
    ])

    await remote.close()
  })

  it('lists remote projection changes through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: [{
        type: 'run_projection_changed',
        runId: request.params.runId,
        cursor: 4,
        projection: {
          runId: request.params.runId,
          pageletId: request.params.pageletId,
          status: request.params.status,
        },
      }],
    }))

    const result = await runCli([
      'remote',
      'projection-changes',
      '--run',
      'run-remote',
      '--pagelet',
      'design',
      '--status',
      'running',
      '--after',
      '3',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([{
      type: 'run_projection_changed',
      runId: 'run-remote',
      cursor: 4,
      projection: {
        runId: 'run-remote',
        pageletId: 'design',
        status: 'running',
      },
    }])
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'listRunProjectionChanges',
        params: {
          runId: 'run-remote',
          pageletId: 'design',
          status: 'running',
          afterCursor: 3,
        },
      }),
    ])

    await remote.close()
  })


  it('creates device bindings through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        bindingId: 'binding-1',
        deviceId: request.params.deviceId,
        actor: request.params.actor,
        label: request.params.label,
        status: 'active',
      },
    }))

    const result = await runCli([
      'remote',
      'device',
      'bind',
      '--device',
      'phone-1',
      '--channel',
      'telegram',
      '--actor',
      'telegram:ada',
      '--label',
      'Ada phone',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      bindingId: 'binding-1',
      deviceId: 'phone-1',
      actor: {
        actorId: 'telegram:ada',
        kind: 'telegram',
      },
      label: 'Ada phone',
      status: 'active',
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'createDeviceBinding',
        params: expect.objectContaining({
          deviceId: 'phone-1',
          actor: expect.objectContaining({
            actorId: 'telegram:ada',
            kind: 'telegram',
            deviceId: 'phone-1',
          }),
          label: 'Ada phone',
        }),
      }),
    ])

    await remote.close()
  })

  it('manages Slack workspace and user bindings through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: request.method === 'createSlackWorkspaceBinding'
        ? {
            workspaceId: request.params.workspaceId,
            teamDomain: request.params.teamDomain,
            status: 'active',
            policyProfileId: request.params.policyProfileId,
          }
        : {
            workspaceId: request.params.workspaceId,
            userId: request.params.userId,
            actorId: request.params.actorId ?? `slack:${request.params.userId}`,
            status: 'active',
            role: request.params.role,
            policyProfileId: request.params.policyProfileId,
          },
    }))

    const workspaceResult = await runCli([
      'remote',
      'slack',
      'workspace',
      'bind',
      '--workspace',
      'T123',
      '--domain',
      'example',
      '--policy',
      'remote-agent-os/team-readonly',
    ], undefined, process.cwd(), remote.socketPath)
    const userResult = await runCli([
      'remote',
      'slack',
      'user',
      'bind',
      '--workspace',
      'T123',
      '--user',
      'U123',
      '--role',
      'operator',
      '--policy',
      'remote-agent-os/team-operator',
    ], undefined, process.cwd(), remote.socketPath)

    expect(workspaceResult.code).toBe(0)
    expect(JSON.parse(workspaceResult.stdout)).toMatchObject({
      workspaceId: 'T123',
      teamDomain: 'example',
      status: 'active',
      policyProfileId: 'remote-agent-os/team-readonly',
    })
    expect(userResult.code).toBe(0)
    expect(JSON.parse(userResult.stdout)).toMatchObject({
      workspaceId: 'T123',
      userId: 'U123',
      actorId: 'slack:U123',
      status: 'active',
      role: 'operator',
      policyProfileId: 'remote-agent-os/team-operator',
    })
    expect(remote.requests.map(request => request.method)).toEqual([
      'createSlackWorkspaceBinding',
      'createSlackUserBinding',
    ])
    expect(remote.requests[1]).toMatchObject({
      params: {
        workspaceId: 'T123',
        userId: 'U123',
        role: 'operator',
      },
    })

    await remote.close()
  })

  it('manages Slack device bindings through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: request.method === 'createSlackDeviceBinding'
        ? {
            bindingId: `slack-device-${request.params.workspaceId}-${request.params.userId}-${request.params.deviceId}`,
            workspaceId: request.params.workspaceId,
            userId: request.params.userId,
            deviceId: request.params.deviceId,
            actorId: request.params.actorId ?? `slack:${request.params.userId}`,
            label: request.params.label,
            status: 'active',
          }
        : { bindingId: request.params.bindingId, status: 'revoked' },
    }))

    const bindResult = await runCli([
      'remote',
      'slack',
      'device',
      'bind',
      '--workspace',
      'T123',
      '--user',
      'U123',
      '--device',
      'iphone-1',
      '--label',
      'iPhone',
    ], undefined, process.cwd(), remote.socketPath)
    const revokeResult = await runCli([
      'remote',
      'slack',
      'device',
      'revoke',
      'slack-device-T123-U123-iphone-1',
    ], undefined, process.cwd(), remote.socketPath)

    expect(bindResult.code).toBe(0)
    expect(JSON.parse(bindResult.stdout)).toMatchObject({
      bindingId: 'slack-device-T123-U123-iphone-1',
      status: 'active',
      label: 'iPhone',
    })
    expect(revokeResult.code).toBe(0)
    expect(JSON.parse(revokeResult.stdout)).toMatchObject({
      bindingId: 'slack-device-T123-U123-iphone-1',
      status: 'revoked',
    })
    expect(remote.requests.map(request => request.method)).toEqual([
      'createSlackDeviceBinding',
      'revokeSlackDeviceBinding',
    ])

    await remote.close()
  })

  it('sends Slack lifecycle revoke events through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        kind: request.params.event.kind,
        workspaceId: request.params.event.workspaceId,
        revokedWorkspace: null,
        revokedUsers: request.params.event.userIds.map(userId => ({
          workspaceId: request.params.event.workspaceId,
          userId,
          status: 'revoked',
        })),
        auditEvent: {
          action: request.params.event.kind,
          status: 'accepted',
        },
      },
    }))

    const result = await runCli([
      'remote',
      'slack',
      'lifecycle',
      'tokens-revoked',
      '--workspace',
      'T123',
      '--users',
      'U123,U456',
      '--actor',
      'slack:admin',
      '--reason',
      'rotation',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: 'tokens_revoked',
      workspaceId: 'T123',
      revokedUsers: [
        { workspaceId: 'T123', userId: 'U123', status: 'revoked' },
        { workspaceId: 'T123', userId: 'U456', status: 'revoked' },
      ],
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'handleSlackLifecycleEvent',
        params: {
          event: {
            kind: 'tokens_revoked',
            workspaceId: 'T123',
            userIds: ['U123', 'U456'],
            actorId: 'slack:admin',
            reason: 'rotation',
          },
        },
      }),
    ])

    await remote.close()
  })

  it('records Slack app install metadata through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        installationId: request.params.installationId ?? `slack-install-${request.params.workspaceId}`,
        workspaceId: request.params.workspaceId,
        teamDomain: request.params.teamDomain,
        appId: request.params.appId,
        botUserId: request.params.botUserId,
        botTokenRef: request.params.botTokenRef,
        scopes: request.params.scopes,
        status: 'active',
        installedByUserId: request.params.installedByUserId,
        policyProfileId: request.params.policyProfileId,
      },
    }))

    const result = await runCli([
      'remote',
      'slack',
      'app',
      'install',
      '--workspace',
      'T123',
      '--domain',
      'example',
      '--app',
      'A123',
      '--bot-user',
      'Ubot',
      '--bot-token-ref',
      'secret://slack/T123/bot',
      '--scope',
      'commands,chat:write',
      '--installer',
      'Uadmin',
      '--policy',
      'remote-agent-os/team-operator',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      installationId: 'slack-install-T123',
      workspaceId: 'T123',
      teamDomain: 'example',
      appId: 'A123',
      botUserId: 'Ubot',
      botTokenRef: 'secret://slack/T123/bot',
      scopes: ['commands', 'chat:write'],
      status: 'active',
      installedByUserId: 'Uadmin',
      policyProfileId: 'remote-agent-os/team-operator',
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'createSlackAppInstallation',
        params: {
          workspaceId: 'T123',
          teamDomain: 'example',
          appId: 'A123',
          botUserId: 'Ubot',
          botTokenRef: 'secret://slack/T123/bot',
          scopes: ['commands', 'chat:write'],
          installedByUserId: 'Uadmin',
          policyProfileId: 'remote-agent-os/team-operator',
        },
      }),
    ])

    await remote.close()
  })

  it('submits Slack OAuth callback codes through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        installation: {
          installationId: 'slack-install-T123',
          workspaceId: 'T123',
          scopes: ['commands'],
          status: 'active',
          policyProfileId: request.params.policyProfileId,
        },
        tokenRefs: {
          botTokenRef: 'secret://slack/T123/bot',
        },
      },
    }))

    const result = await runCli([
      'remote',
      'slack',
      'oauth',
      'callback',
      '--code',
      'oauth-code',
      '--redirect-uri',
      'https://telegraph.local/slack/callback',
      '--policy',
      'remote-agent-os/team-operator',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      installation: {
        installationId: 'slack-install-T123',
        workspaceId: 'T123',
        status: 'active',
        policyProfileId: 'remote-agent-os/team-operator',
      },
      tokenRefs: {
        botTokenRef: 'secret://slack/T123/bot',
      },
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'handleSlackOAuthCallback',
        params: {
          code: 'oauth-code',
          redirectUri: 'https://telegraph.local/slack/callback',
          policyProfileId: 'remote-agent-os/team-operator',
        },
      }),
    ])

    await remote.close()
  })

  it('lists runs through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: [{
        runId: 'run-remote',
        pageletId: request.params.pageletId,
        status: request.params.status,
      }],
    }))

    const result = await runCli([
      'remote',
      'runs',
      '--pagelet',
      'design',
      '--status',
      'running',
    ], undefined, process.cwd(), remote.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([{
      runId: 'run-remote',
      pageletId: 'design',
      status: 'running',
    }])
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'listRunProjections',
        params: {
          pageletId: 'design',
          status: 'running',
        },
      }),
    ])

    await remote.close()
  })

  it('requests local run control through the RunBroker socket', async () => {
    const broker = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        commandId: 'runctl-cli',
        runId: request.params.runId,
        kind: request.params.kind,
        status: 'accepted',
        requestedBy: request.params.requestedBy,
        reason: request.params.reason,
      },
    }))

    const result = await runCli([
      'stop',
      'run-cli',
      '--reason',
      'user requested',
    ], broker.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      commandId: 'runctl-cli',
      runId: 'run-cli',
      kind: 'stop',
      status: 'accepted',
      reason: 'user requested',
      requestedBy: {
        kind: 'cli',
      },
    })
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'requestRunControlCommand',
        params: expect.objectContaining({
          runId: 'run-cli',
          kind: 'stop',
          reason: 'user requested',
          requestedBy: expect.objectContaining({
            kind: 'cli',
          }),
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

    const result = await runCli(['attach', 'run-cli', '--after', '0'], broker.socketPath)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('run-cli  completed  cursor=1  CLI run')
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'subscribeRunProjections',
        params: { runId: 'run-cli', afterCursor: 0 },
      }),
    ])

    await broker.close()
  })

  it('opens a run through the cli-gateway extension method', async () => {
    const broker = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        runId: request.params.runId,
        pageletId: 'design',
        pageId: 'run-console',
        focused: true,
      },
    }))

    const result = await runCli(['open', 'run-open'], broker.socketPath)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      runId: 'run-open',
      pageletId: 'design',
      pageId: 'run-console',
      focused: true,
    })
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'openRun',
        params: { runId: 'run-open' },
      }),
    ])

    await broker.close()
  })

  it('prints pagelet-local persisted run events after a seq cursor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-cli-ledger-test-'))
    cleanupDirs.push(dir)
    const runDir = join(dir, '.telegraph', 'design-runs', 'run-cli')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'events.jsonl'), [
      JSON.stringify({ runId: 'run-cli', seq: 1, ts: 100, event: { type: 'run_started' } }),
      JSON.stringify({ runId: 'run-cli', seq: 2, ts: 110, event: { type: 'assistant_delta' } }),
      JSON.stringify({ runId: 'run-cli', seq: 3, ts: 120, event: { type: 'run_completed' } }),
      '',
    ].join('\n'))

    const result = await runCli(['events', 'run-cli', '--after', '1'], undefined, dir)

    expect(result.code).toBe(0)
    expect(result.stdout).toBe([
      '2  assistant_delta  ts=110',
      '3  run_completed  ts=120',
      '',
    ].join('\n'))
  })

  it('serves MCP tools over newline-delimited JSON-RPC stdio', async () => {
    const broker = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        intentId: 'intent-mcp',
        prompt: request.params.prompt,
        targetPagelet: request.params.targetPagelet,
      },
    }))
    const server = startMcpCli(broker.socketPath)

    server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })
    server.write({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })
    server.write({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'telegraph_run_intent_create',
        arguments: {
          pagelet: 'design',
          prompt: 'build from mcp',
        },
      },
    })

    const initialize = await server.next()
    const tools = await server.next()
    const call = await server.next()

    expect(initialize.result.serverInfo.name).toBe('telegraph')
    expect(tools.result.tools.map(tool => tool.name)).toContain('telegraph_run_intent_create')
    expect(tools.result.tools.find(tool => tool.name === 'telegraph_run_intent_create')).toMatchObject({
      _meta: {
        'telegraph/toolSchemaVersion': 1,
        'telegraph/transport': 'run-broker',
      },
    })
    expect(call.result).toMatchObject({
      isError: false,
      structuredContent: {
        value: {
          intentId: 'intent-mcp',
          prompt: 'build from mcp',
          targetPagelet: 'design',
        },
      },
    })
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'createRunIntent',
        params: expect.objectContaining({
          targetPagelet: 'design',
          prompt: 'build from mcp',
        }),
      }),
    ])

    await server.close()
    await broker.close()
  })

  it('prints the versioned MCP tool schema manifest', async () => {
    const result = await runCli(['mcp-schema'])

    expect(result.code).toBe(0)
    const manifest = JSON.parse(result.stdout)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.tools.find(tool => tool.name === 'telegraph_run_intent_create')).toMatchObject({
      name: 'telegraph_run_intent_create',
      _meta: {
        'telegraph/toolSchemaVersion': 1,
        'telegraph/transport': 'run-broker',
      },
    })
  })

  it('serves run open as an MCP tool', async () => {
    const broker = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        runId: request.params.runId,
        pageId: 'run-console',
        focused: true,
      },
    }))
    const server = startMcpCli(broker.socketPath)

    server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'telegraph_run_open',
        arguments: {
          runId: 'run-open-mcp',
        },
      },
    })

    const call = await server.next()

    expect(call.result).toMatchObject({
      isError: false,
      structuredContent: {
        value: {
          runId: 'run-open-mcp',
          pageId: 'run-console',
          focused: true,
        },
      },
    })
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'openRun',
        params: { runId: 'run-open-mcp' },
      }),
    ])

    await server.close()
    await broker.close()
  })

  it('serves remote submit as an MCP tool through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        intent: {
          intentId: 'intent-remote-mcp',
          prompt: request.params.message.text,
          targetPagelet: request.params.options.targetPagelet,
        },
      },
    }))
    const server = startMcpCli(undefined, remote.socketPath)

    server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'telegraph_remote_submit',
        arguments: {
          prompt: 'build via remote mcp',
          pagelet: 'design',
          channel: 'mcp',
        },
      },
    })

    const call = await server.next()

    expect(call.result).toMatchObject({
      isError: false,
      structuredContent: {
        value: {
          intent: {
            intentId: 'intent-remote-mcp',
            prompt: 'build via remote mcp',
            targetPagelet: 'design',
          },
        },
      },
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'submitExternalMessage',
        params: expect.objectContaining({
          message: expect.objectContaining({
            actor: expect.objectContaining({ kind: 'mcp' }),
            text: 'build via remote mcp',
          }),
          options: { targetPagelet: 'design' },
        }),
      }),
    ])

    await server.close()
    await remote.close()
  })

  it('serves remote replies as an MCP tool through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: [{
        replyId: 'reply-mcp',
        channelId: request.params.channelId,
        status: 'sent',
      }],
    }))
    const server = startMcpCli(undefined, remote.socketPath)

    server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'telegraph_remote_replies_list',
        arguments: {
          channelId: 'mcp:local',
        },
      },
    })

    const call = await server.next()

    expect(call.result).toMatchObject({
      isError: false,
      structuredContent: {
        value: [{
          replyId: 'reply-mcp',
          channelId: 'mcp:local',
          status: 'sent',
        }],
      },
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'listChannelReplies',
        params: { channelId: 'mcp:local' },
      }),
    ])

    await server.close()
    await remote.close()
  })

  it('serves remote projection changes as an MCP tool through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: [{
        type: 'run_projection_changed',
        runId: request.params.runId,
        cursor: 6,
        projection: {
          runId: request.params.runId,
          pageletId: request.params.pageletId,
          status: 'completed',
        },
      }],
    }))
    const server = startMcpCli(undefined, remote.socketPath)

    server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'telegraph_remote_projection_changes_list',
        arguments: {
          runId: 'run-mcp',
          pagelet: 'design',
          afterCursor: 5,
        },
      },
    })

    const call = await server.next()

    expect(call.result).toMatchObject({
      isError: false,
      structuredContent: {
        value: [{
          type: 'run_projection_changed',
          runId: 'run-mcp',
          cursor: 6,
          projection: {
            runId: 'run-mcp',
            pageletId: 'design',
            status: 'completed',
          },
        }],
      },
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'listRunProjectionChanges',
        params: {
          runId: 'run-mcp',
          pageletId: 'design',
          afterCursor: 5,
        },
      }),
    ])

    await server.close()
    await remote.close()
  })

  it('serves remote reply ack as an MCP tool through remote-control socket', async () => {
    const remote = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        replyId: request.params.replyId,
        deliveryStatus: request.params.status,
      },
    }))
    const server = startMcpCli(undefined, remote.socketPath)

    server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'telegraph_remote_reply_ack',
        arguments: {
          replyId: 'reply-mcp',
          status: 'sent',
          channel: 'mcp',
        },
      },
    })

    const call = await server.next()

    expect(call.result).toMatchObject({
      isError: false,
      structuredContent: {
        value: {
          replyId: 'reply-mcp',
          deliveryStatus: 'sent',
        },
      },
    })
    expect(remote.requests).toEqual([
      expect.objectContaining({
        method: 'ackChannelReply',
        params: expect.objectContaining({
          replyId: 'reply-mcp',
          status: 'sent',
        }),
      }),
    ])

    await server.close()
    await remote.close()
  })

  it('serves run control request as an MCP tool', async () => {
    const broker = await startFakeBroker((request) => ({
      id: request.id,
      ok: true,
      result: {
        commandId: 'runctl-mcp',
        runId: request.params.runId,
        kind: request.params.kind,
        status: 'accepted',
      },
    }))
    const server = startMcpCli(broker.socketPath)

    server.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'telegraph_run_control_request',
        arguments: {
          runId: 'run-mcp',
          kind: 'pause',
          reason: 'hold',
        },
      },
    })

    const call = await server.next()

    expect(call.result).toMatchObject({
      isError: false,
      structuredContent: {
        value: {
          commandId: 'runctl-mcp',
          runId: 'run-mcp',
          kind: 'pause',
          status: 'accepted',
        },
      },
    })
    expect(broker.requests).toEqual([
      expect.objectContaining({
        method: 'requestRunControlCommand',
        params: expect.objectContaining({
          runId: 'run-mcp',
          kind: 'pause',
          reason: 'hold',
        }),
      }),
    ])

    await server.close()
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

function runCli(args, socketPath, cwd = process.cwd(), remoteSocketPath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        ...(socketPath ? { TELEGRAPH_RUN_BROKER_SOCKET: socketPath } : {}),
        ...(remoteSocketPath ? { TELEGRAPH_REMOTE_CONTROL_SOCKET: remoteSocketPath } : {}),
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

function startMcpCli(socketPath, remoteSocketPath) {
  const child = spawn(process.execPath, [cliPath, 'mcp'], {
    env: {
      ...process.env,
      ...(socketPath ? { TELEGRAPH_RUN_BROKER_SOCKET: socketPath } : {}),
      ...(remoteSocketPath ? { TELEGRAPH_REMOTE_CONTROL_SOCKET: remoteSocketPath } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pending = []
  const waiters = []
  let buffer = ''
  let stderr = ''

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += String(chunk)
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const value = JSON.parse(line)
      const waiter = waiters.shift()
      if (waiter) waiter(value)
      else pending.push(value)
    }
  })
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })

  return {
    write: message => {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    },
    next: () => new Promise((resolve, reject) => {
      const value = pending.shift()
      if (value) {
        resolve(value)
        return
      }
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for MCP response. stderr=${stderr}`))
      }, 2_000)
      waiters.push(value => {
        clearTimeout(timeout)
        resolve(value)
      })
    }),
    close: () => new Promise(resolve => {
      child.once('close', () => { resolve() })
      child.stdin.end()
    }),
  }
}
