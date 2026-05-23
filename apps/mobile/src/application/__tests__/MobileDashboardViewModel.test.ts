import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION } from '@/packages/remote-protocol'
import { createMobileDashboardModel } from '../MobileDashboardViewModel'

describe('MobileDashboardViewModel', () => {
  it('builds the mobile control surface sections from remote-control state', () => {
    const model = createMobileDashboardModel({
      connection: 'live',
      devices: [{
        bindingId: 'binding-phone',
        deviceId: 'iphone-1',
        actor: { actorId: 'mobile:user', kind: 'mobile', displayName: 'Phone' },
        label: 'iPhone',
        status: 'active',
        createdAt: 10,
        updatedAt: 20,
      }],
      runs: [{
        runId: 'run-1',
        pageletId: 'design',
        status: 'running',
        title: 'Build mobile console',
        cursor: 4,
        eventCount: 12,
        artifactRefs: [{
          artifactId: 'shot-1',
          uri: 'https://example.test/shot.png',
          mediaType: 'image/png',
          title: 'Screenshot',
        }],
        createdAt: 10,
        updatedAt: 40,
      }, {
        runId: 'run-2',
        pageletId: 'chat',
        status: 'completed',
        cursor: 3,
        eventCount: 9,
        createdAt: 8,
        updatedAt: 30,
      }],
      approvals: [{
        approvalId: 'approval-1',
        runId: 'run-1',
        source: { actorId: 'desktop', kind: 'desktop' },
        kind: 'computer_action',
        title: 'Click deploy',
        body: 'Allow remote click',
        status: 'pending',
        createdAt: 11,
        updatedAt: 12,
      }],
      replies: [{
        replyId: 'reply-1',
        channelId: 'mobile',
        runId: 'run-1',
        text: 'Working',
        status: 'queued',
        artifactRefs: [{
          artifactId: 'artifact-log',
          uri: 'telegraph://artifact/log.txt',
          mediaType: 'text/plain',
          title: 'Log',
        }],
        createdAt: 20,
        updatedAt: 20,
        schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
      }],
      selectedRunId: 'run-1',
    })

    expect(model.summary).toEqual({
      activeDevices: 1,
      runningRuns: 1,
      pendingApprovals: 1,
      artifactPreviews: 2,
    })
    expect(model.runs.map(run => run.runId)).toEqual(['run-1', 'run-2'])
    expect(model.selectedRun).toMatchObject({ runId: 'run-1', statusTone: 'active' })
    expect(model.approvals[0]).toMatchObject({ approvalId: 'approval-1', pending: true })
    expect(model.devices[0]).toMatchObject({ id: 'binding-phone', active: true })
    expect(model.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: 'shot-1', previewKind: 'image' }),
      expect.objectContaining({ artifactId: 'artifact-log', previewKind: 'link' }),
    ]))
  })
})
