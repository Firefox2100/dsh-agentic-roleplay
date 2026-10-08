import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthoredWorldReader, authoredWorldReadTools } from '../../../src/host/authoring/read-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let directory: string
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'authoring-read-'))
  await write(join(directory, 'world.json'), { id: 'harbor', name: 'Harbor', description: 'A fogbound port.', rules: ['No magic.'], opening_message: 'Rain falls.' })
  await write(join(directory, 'locations', 'inn', 'location.json'), { name: 'The Inn', exits: [{ to: 'dock', description: 'a wet lane' }] })
  await write(join(directory, 'locations', 'dock', 'location.json'), { name: 'The Dock' })
  await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'npc', summary: 'Innkeeper.', start: { location: 'inn' }, knowledge: { locations: ['dock'] } })
  await write(join(directory, 'items', 'key', 'item.json'), { name: 'Brass Key', location: 'inn' })
  await write(join(directory, 'factions', 'watch', 'faction.json'), { name: 'Watch', members: [{ character: 'clara', role: 'captain' }] })
  await write(join(directory, 'lore', 'founding', 'lore.json'), { title: 'Founding', kind: 'history', summary: 'The first winter.', body: 'Settlers arrived in a storm.' })
})

afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

function tools() {
  const catalog = {
    find: (id: string) => Promise.resolve(id === 'harbor' ? { folder: 'harbor', directory, summary: { id: 'harbor', name: 'Harbor', description: 'A fogbound port.', tags: [] } } : undefined),
  } as unknown as WorldCatalog
  return authoredWorldReadTools(new AuthoredWorldReader(catalog))
}

const exec = (chat = authoringChatSessionId('harbor')) => ({ agent: { session: { id: chat } }, signal: new AbortController().signal }) as never

async function call(name: string, args: Record<string, unknown> = {}, chat?: string): Promise<unknown> {
  const tool = tools().find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`missing tool ${name}`)
  return await tool.execute(args as never, exec(chat))
}

describe('authored world read tools', () => {
  it('provides the complete read-only catalogue', () => {
    expect(tools().map(tool => tool.name)).toEqual([
      'get_world_overview', 'list_characters', 'get_character', 'list_locations', 'get_location', 'list_items', 'get_item',
      'list_factions', 'get_faction', 'list_lore', 'get_lore', 'get_world_element_source', 'list_plots', 'get_plot', 'list_relationships',
    ])
  })

  it('reads overview, concise lists and complete entities from the files', async () => {
    expect(await call('get_world_overview')).toMatchObject({ name: 'Harbor', rules: ['No magic.'], opening_message: 'Rain falls.', counts: { characters: 1, locations: 2, items: 1, factions: 1, lore: 1, relationships: 3 } })
    expect(await call('list_characters')).toEqual([expect.objectContaining({ key: 'clara', name: 'Clara', place: { key: 'inn', name: 'The Inn' } })])
    expect(await call('get_character', { key: 'clara' })).toMatchObject({ summary: 'Innkeeper.', state: { publicState: '' } })
    expect(await call('get_lore', { key: 'founding' })).toMatchObject({ body: 'Settlers arrived in a storm.' })
    expect(await call('get_world_element_source', { kind: 'character', key: 'clara' })).toMatchObject({ name: 'Clara', knowledge: { locations: ['dock'] } })
  })

  it('filters relationships and rejects missing entities or unrelated chats', async () => {
    expect(await call('list_relationships', { kind: 'knowledge', from: 'clara' })).toEqual([expect.objectContaining({ kind: 'knowledge', to: expect.objectContaining({ key: 'dock' }) })])
    await expect(call('get_item', { key: 'missing' })).rejects.toThrow('there is no item')
    await expect(call('list_characters', {}, 'session-not-authoring')).rejects.toThrow('only in a world authoring chat')
  })
})
