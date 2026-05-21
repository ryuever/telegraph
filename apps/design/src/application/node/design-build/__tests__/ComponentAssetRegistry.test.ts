import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { ComponentAssetRegistry, createDefaultComponentAssetRegistry } from '../ComponentAssetRegistry'

let tempRoot: string | undefined

describe('ComponentAssetRegistry', () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = undefined
    }
  })

  it('retrieves shared UI components for common design intents', () => {
    const registry = createDefaultComponentAssetRegistry()

    const login = registry.searchComponents('create a login page with email and submit')
    expect(login.map(component => component.id)).toEqual(expect.arrayContaining(['input', 'button', 'card']))

    const dashboard = registry.searchComponents('admin dashboard with metrics and table')
    expect(dashboard.map(component => component.id)).toEqual(expect.arrayContaining(['card', 'table']))
    expect(dashboard[0]?.reason).toContain('Matched')
  })

  it('scans packages/ui component files and infers missing assets', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'telegraph-design-assets-'))
    const uiDir = join(tempRoot, 'packages/ui/src/components/ui')
    await mkdir(uiDir, { recursive: true })
    await writeFile(join(uiDir, 'button.tsx'), 'export function Button() { return null }', 'utf8')
    await writeFile(join(uiDir, 'switch.tsx'), 'export function Switch() { return null }', 'utf8')

    const registry = new ComponentAssetRegistry([])
    const discovered = await registry.scanWorkspace(tempRoot)

    expect(discovered.map(component => component.id)).toEqual(['button', 'switch'])
    expect(registry.searchComponents('settings switch toggle').map(component => component.id))
      .toContain('switch')
  })
})
