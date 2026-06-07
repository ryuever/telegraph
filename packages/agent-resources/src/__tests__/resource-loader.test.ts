import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  DefaultAgentResourceLoader,
  discoverProjectContextFiles,
  projectResourceContributionsToExtensionPaths,
} from '@/packages/agent-resources'
import type { ResolvedResourceContribution } from '@/packages/agent-extension-host'

function fixtureDir(name: string): string {
  return join(tmpdir(), `telegraph-agent-resources-${name}-${String(Date.now())}-${Math.random().toString(16).slice(2)}`)
}

describe('DefaultAgentResourceLoader', () => {
  it('loads project context files and skills into a resource snapshot', async () => {
    const root = fixtureDir('basic')
    const nested = join(root, 'apps', 'chat')
    mkdirSync(join(root, 'skills', 'reviewer'), { recursive: true })
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), '# Root instructions\n')
    writeFileSync(join(root, 'skills', 'reviewer', 'SKILL.md'), [
      '---',
      'name: reviewer',
      'description: Reviews output.',
      '---',
      'Review carefully.',
      '',
    ].join('\n'))

    const loader = new DefaultAgentResourceLoader({ cwd: nested })
    const snapshot = await loader.reload()

    expect(snapshot.skills.map(skill => skill.name)).toEqual(['reviewer'])
    expect(snapshot.contextFiles.map(file => file.path)).toEqual([join(root, 'AGENTS.md')])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('extends resources with explicit skill and prompt paths', async () => {
    const root = fixtureDir('extend')
    const extensionRoot = join(root, 'extensions', 'demo')
    mkdirSync(join(extensionRoot, 'skills', 'writer'), { recursive: true })
    writeFileSync(join(extensionRoot, 'skills', 'writer', 'SKILL.md'), [
      '---',
      'name: writer',
      'description: Writes crisp copy.',
      '---',
      'Write crisply.',
      '',
    ].join('\n'))
    writeFileSync(join(extensionRoot, 'append.md'), 'Append this.\n')

    const loader = new DefaultAgentResourceLoader({ cwd: root, includeProjectContext: false })
    await loader.reload()
    const snapshot = await loader.extendResources({
      skillPaths: [{ path: join(extensionRoot, 'skills', 'writer'), metadata: { sourceKind: 'extension', extensionId: 'demo' } }],
      appendSystemPromptPaths: [{ path: join(extensionRoot, 'append.md'), metadata: { sourceKind: 'extension', extensionId: 'demo' } }],
    })

    expect(snapshot.skills.map(skill => skill.name)).toEqual(['writer'])
    expect(snapshot.appendSystemPrompts[0]).toMatchObject({
      path: join(extensionRoot, 'append.md'),
      content: 'Append this.\n',
      metadata: {
        sourceKind: 'extension',
        extensionId: 'demo',
      },
    })
  })
})

describe('discoverProjectContextFiles', () => {
  it('orders ancestor context before nested context', () => {
    const root = fixtureDir('context')
    const nested = join(root, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), 'root\n')
    writeFileSync(join(root, 'a', 'CLAUDE.md'), 'nested\n')

    expect(discoverProjectContextFiles(nested).map(file => file.content)).toEqual(['root\n', 'nested\n'])
  })
})

describe('projectResourceContributionsToExtensionPaths', () => {
  it('projects extension resource contributions into resource loader path groups', () => {
    const extensionRoot = '/repo/extensions/demo'
    const resources: ResolvedResourceContribution[] = [
      resource('writer-skill', 'skill', `${extensionRoot}/skills/writer/SKILL.md`, extensionRoot),
      resource('rules', 'context-file', `${extensionRoot}/AGENTS.md`, extensionRoot),
      resource('system', 'system-prompt', `${extensionRoot}/system.md`, extensionRoot),
      resource('append', 'append-system-prompt', `${extensionRoot}/append.md`, extensionRoot),
      resource('theme', 'theme', `${extensionRoot}/theme.json`, extensionRoot),
    ]

    const projected = projectResourceContributionsToExtensionPaths(resources)

    expect(projected.paths.skillPaths).toEqual([
      expect.objectContaining({
        path: `${extensionRoot}/skills/writer`,
        metadata: expect.objectContaining({
          sourceKind: 'extension',
          extensionId: '@telegraph/demo',
          contributionId: 'writer-skill',
        }),
      }),
    ])
    expect(projected.paths.contextFilePaths?.[0]?.path).toBe(`${extensionRoot}/AGENTS.md`)
    expect(projected.paths.systemPromptPaths?.[0]?.path).toBe(`${extensionRoot}/system.md`)
    expect(projected.paths.appendSystemPromptPaths?.[0]?.path).toBe(`${extensionRoot}/append.md`)
    expect(projected.ignored.map(item => item.id)).toEqual(['theme'])
  })
})

function resource(
  id: string,
  kind: ResolvedResourceContribution['kind'],
  sourcePath: string,
  rootPath: string,
): ResolvedResourceContribution {
  return {
    id,
    kind,
    path: sourcePath,
    sourcePath,
    fullId: `@telegraph/demo/${id}`,
    origin: {
      extensionId: '@telegraph/demo',
      contributionId: id,
      fullId: `@telegraph/demo/${id}`,
      sourceKind: 'builtin',
      sourcePath,
      rootPath,
    },
  }
}
