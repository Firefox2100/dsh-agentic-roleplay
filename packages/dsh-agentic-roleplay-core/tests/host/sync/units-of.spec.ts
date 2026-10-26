import { describe, expect, it } from 'vitest'
import { unitsOf } from '../../../src/host/sync/wire.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b'
const worlds = { find: async (id: string) => (id === ID ? { directory: '/root/worlds/harbor' } : undefined) } as unknown as WorldCatalog
const of = async (path: string): Promise<string[]> => await unitsOf(new URL(`http://localhost/roleplay-api${path}`), worlds)

describe('the unit a request touches', () => {
  it('reads the id as a session on a session route and as a world on a world route, though they look alike', async () => {
    expect(await of(`/sessions/world?id=${ID}`)).toEqual([`sessions/${ID}`])
    expect(await of(`/worlds/info?id=${ID}`)).toEqual(['worlds/harbor'])
  })

  it('names the shared folders by route and nothing for a world it does not know', async () => {
    expect(await of('/presets')).toEqual(['presets'])
    expect(await of('/lorebooks/item')).toEqual(['lorebooks'])
    expect(await of('/worlds/avatars?id=x')).toEqual(['avatars'])
    expect(await of('/worlds/info?id=missing')).toEqual([])
    expect(await of('/catalogue/sources')).toEqual([])
  })
})
