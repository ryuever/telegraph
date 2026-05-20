import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSubagentTools } from '../tools'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'telegraph-subagent-tools-'))
  await writeFile(join(workspaceRoot, 'README.md'), 'hello workspace\nneedle line\n', 'utf8')
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('createSubagentTools', () => {
  it('exposes only readonly tools by default even when bash/edit are in the agent allowlist', () => {
    const tools = createSubagentTools({
      runId: 'run-tools-default',
      settings: {
        provider: 'faux',
        modelId: 'faux',
        apiKey: '',
      },
      workspaceRoot,
      allowedTools: ['read', 'grep', 'glob', 'bash', 'edit'],
    })

    expect(tools.map(tool => tool.name)).toEqual(['read', 'grep', 'glob'])
  })

  it('executes read, grep, and glob within the workspace', async () => {
    const tools = createSubagentTools({
      runId: 'run-tools-readonly',
      settings: {
        provider: 'faux',
        modelId: 'faux',
        apiKey: '',
        taskCapabilityProfile: { kind: 'readonly-workspace', scopes: ['repo:read'] },
      },
      workspaceRoot,
      allowedTools: ['read', 'grep', 'glob'],
    })

    await expect(tools.find(tool => tool.name === 'read')?.execute({ path: 'README.md' }, baseToolContext('read')))
      .resolves.toMatchObject({
        path: 'README.md',
        content: expect.stringContaining('hello workspace'),
      })
    await expect(tools.find(tool => tool.name === 'grep')?.execute({ pattern: 'needle' }, baseToolContext('grep')))
      .resolves.toMatchObject({
        matches: [
          expect.objectContaining({
            path: 'README.md',
            line: 2,
          }),
        ],
      })
    await expect(tools.find(tool => tool.name === 'glob')?.execute({ pattern: '*.md' }, baseToolContext('glob')))
      .resolves.toMatchObject({
        paths: ['README.md'],
      })
  })

  it('exposes and executes bash only for allowed low-risk shell commands', async () => {
    const tools = createSubagentTools({
      runId: 'run-tools-bash',
      settings: {
        provider: 'faux',
        modelId: 'faux',
        apiKey: '',
        taskCapabilityProfile: {
          kind: 'shell-automation',
          commands: ['node'],
          cwdPolicy: 'workspace',
        },
      },
      workspaceRoot,
      allowedTools: ['bash'],
    })

    const bash = tools.find(tool => tool.name === 'bash')
    expect(bash).toBeDefined()
    await expect(bash?.execute({
      command: 'node',
      args: ['-e', 'process.stdout.write("ok")'],
    }, baseToolContext('bash'))).resolves.toMatchObject({
      stdout: 'ok',
      code: 0,
    })
    await expect(bash?.execute({
      command: 'pnpm',
      args: ['--version'],
    }, baseToolContext('bash'))).rejects.toThrow('not allowed')
  })

  it('previews edit in preview profiles and applies only when explicitly requested', async () => {
    const previewTools = createSubagentTools({
      runId: 'run-tools-edit-preview',
      settings: {
        provider: 'faux',
        modelId: 'faux',
        apiKey: '',
        taskCapabilityProfile: {
          kind: 'coding-edit',
          scopes: ['repo:read', 'repo:write'],
          patchPolicy: 'preview',
        },
      },
      workspaceRoot,
      allowedTools: ['edit'],
    })
    const previewEdit = previewTools.find(tool => tool.name === 'edit')
    expect(previewEdit).toBeDefined()
    await expect(previewEdit?.execute({
      path: 'README.md',
      oldString: 'needle line',
      newString: 'replacement line',
    }, baseToolContext('edit'))).resolves.toMatchObject({
      path: 'README.md',
      applied: false,
      replacements: 1,
    })
    await expect(readFile(join(workspaceRoot, 'README.md'), 'utf8'))
      .resolves.toContain('needle line')
    await expect(previewEdit?.execute({
      path: 'README.md',
      oldString: 'needle line',
      newString: 'replacement line',
      apply: true,
    }, baseToolContext('edit'))).rejects.toThrow('apply-enabled')

    const applyTools = createSubagentTools({
      runId: 'run-tools-edit-apply',
      settings: {
        provider: 'faux',
        modelId: 'faux',
        apiKey: '',
        taskCapabilityProfile: {
          kind: 'coding-edit',
          scopes: ['repo:read', 'repo:write'],
          patchPolicy: 'apply-after-confirm',
        },
      },
      workspaceRoot,
      allowedTools: ['edit'],
    })

    const edit = applyTools.find(tool => tool.name === 'edit')
    expect(edit).toBeDefined()
    await expect(edit?.execute({
      path: 'README.md',
      oldString: 'needle line',
      newString: 'replacement line',
      apply: true,
    }, baseToolContext('edit'))).resolves.toMatchObject({
      path: 'README.md',
      applied: true,
      replacements: 1,
    })
    await expect(readFile(join(workspaceRoot, 'README.md'), 'utf8'))
      .resolves.toContain('replacement line')
  })
})

function baseToolContext(toolName: string) {
  return {
    runId: 'run-tools-test',
    callId: `call-${toolName}`,
    toolName,
  }
}
