import { describe, expect, it } from 'vitest'
import {
  parseShadcnLlmsComponents,
  ShadcnUiLibraryProvider,
} from '../ShadcnUiLibraryProvider'

describe('ShadcnUiLibraryProvider', () => {
  it('parses the shadcn llms.txt component catalog', () => {
    const components = parseShadcnLlmsComponents(`
## Components

### Form & Input

- [Button](https://ui.shadcn.com/docs/components/button): Button component with multiple variants.

### Overlays & Dialogs

- [Dropdown Menu](https://ui.shadcn.com/docs/components/dropdown-menu): Dropdown menu component.

## Registry

- [Registry Overview](https://ui.shadcn.com/docs/registry): Creating and publishing your own component registry.
`)

    expect(components).toEqual([
      expect.objectContaining({
        name: 'button',
        title: 'Button',
        category: 'Form & Input',
        usageUrl: 'https://ui.shadcn.com/docs/components/button.md',
      }),
      expect.objectContaining({
        name: 'dropdown-menu',
        title: 'Dropdown Menu',
        category: 'Overlays & Dialogs',
        usageUrl: 'https://ui.shadcn.com/docs/components/dropdown-menu.md',
      }),
    ])
  })

  it('returns raw markdown usage content for catalog component names', async () => {
    const provider = new ShadcnUiLibraryProvider({
      fetchFn: async url => {
        const href = String(url)
        if (href.endsWith('/llms.txt')) {
          return new Response(`
## Components

### Overlays & Dialogs

- [Dropdown Menu](https://ui.shadcn.com/docs/components/dropdown-menu): Dropdown menu component.
`)
        }
        return new Response('---\ntitle: Dropdown Menu\n---\n\n## Usage\n\n```tsx\n<DropdownMenu />\n```', {
          headers: { 'content-type': 'text/markdown' },
        })
      },
    })

    const usages = await provider.getComponentUsages(['dropdown-menu'])

    expect(usages).toEqual([
      expect.objectContaining({
        name: 'dropdown-menu',
        available: true,
        contentType: 'text/markdown',
        markdownContent: expect.stringContaining('<DropdownMenu />'),
        truncated: false,
      }),
    ])
  })

  it('uses the bundled component llm catalog before fetching llms.txt', async () => {
    const calls: string[] = []
    const provider = new ShadcnUiLibraryProvider({
      fetchFn: async url => {
        calls.push(String(url))
        return new Response('', { status: 500 })
      },
    })

    const components = await provider.listComponents()

    expect(components.some(component => component.name === 'button')).toBe(true)
    expect(calls).toEqual([])
  })

  it('installs registry files recursively from shadcn registry json', async () => {
    const provider = new ShadcnUiLibraryProvider({
      registryBaseUrl: 'https://registry.example/styles/default',
      fetchFn: async url => {
        const href = String(url)
        if (href.endsWith('/calendar.json')) {
          return new Response(JSON.stringify({
            dependencies: ['react-day-picker@latest', 'date-fns'],
            registryDependencies: ['button'],
            files: [
              {
                path: 'ui/calendar.tsx',
                type: 'registry:ui',
                content: 'import { Button } from "@/registry/default/ui/button"\nexport function Calendar() { return <Button /> }',
              },
            ],
          }))
        }
        if (href.endsWith('/button.json')) {
          return new Response(JSON.stringify({
            dependencies: ['@radix-ui/react-slot'],
            files: [
              {
                path: 'ui/button.tsx',
                type: 'registry:ui',
                content: 'export function Button() { return <button /> }',
              },
            ],
          }))
        }
        return new Response('', { status: 404 })
      },
    })

    const plan = await provider.installComponent('calendar')

    expect(plan).toMatchObject({
      name: 'calendar',
      sourceUrl: 'https://registry.example/styles/default/calendar.json',
      dependencies: ['react-day-picker@latest', 'date-fns', '@radix-ui/react-slot'],
      registryDependencies: ['button'],
      installedComponentNames: ['calendar', 'button'],
    })
    expect(plan.files.map(file => file.path)).toEqual([
      'ui/button.tsx',
      'ui/calendar.tsx',
    ])
    expect(plan.files.at(-1)?.content).toContain('@/components/ui/button')
  })
})
