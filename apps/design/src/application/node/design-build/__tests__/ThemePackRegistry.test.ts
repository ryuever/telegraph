import { describe, expect, it } from 'vitest'
import { ThemePackRegistry } from '../ThemePackRegistry'

describe('ThemePackRegistry', () => {
  it('lists the built-in theme packs required by the roadmap', () => {
    const ids = new ThemePackRegistry().list().map(pack => pack.id)

    expect(ids).toEqual(expect.arrayContaining([
      'shadcn-new-york-neutral',
      'dense-operator-console',
      'editorial-commerce',
      'studio-dark',
    ]))
  })

  it('returns a default pack when an unknown pack is requested', () => {
    expect(new ThemePackRegistry().get('missing-pack')).toMatchObject({
      id: 'shadcn-new-york-neutral',
    })
  })
})
