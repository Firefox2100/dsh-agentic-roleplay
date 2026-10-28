import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthoredWorldReader, authoredWorldReadTools } from '../../../src/host/authoring/read-tools.ts'
import { authoredWorldWriteTools, WORLD_INFO_FIELDS } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let directory: string
let refreshed: number

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'world-info-tools-'))
  refreshed = 0
  await writeFile(join(directory, 'world.json'), `${JSON.stringify({ id: 'harbor', name: 'Harbor', description: 'A fogbound port.', metadata: { tags: ['sea'] }, opening_message: 'Rain falls.', rules: ['No magic.'], preset: 'grim' }, null, 2)}\n`)
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

function reader() {
  const catalog = {
    find: (id: string) => Promise.resolve(id === 'harbor' ? { folder: 'harbor', directory, summary: { id: 'harbor', name: 'Harbor', description: 'A fogbound port.', tags: [] } } : undefined),
    list: vi.fn(() => { refreshed += 1; return Promise.resolve({ worlds: [], problems: [] }) }),
  } as unknown as WorldCatalog
  return new AuthoredWorldReader(catalog)
}

const exec = (chat = authoringChatSessionId('harbor')) => ({ agent: { session: { id: chat } }, signal: new AbortController().signal }) as never
const call = async (name: string, args: Record<string, unknown> = {}, chat?: string): Promise<any> => {
  const found = [...authoredWorldReadTools(reader()), ...authoredWorldWriteTools(reader())].find(tool => tool.name === name)
  if (found === undefined) throw new Error(`missing tool ${name}`)
  return await found.execute(args as never, exec(chat))
}
const world = async (): Promise<Record<string, any>> => JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')) as Record<string, any>

describe('get_world_info', () => {
  it('reads everything the world says about itself, the person\'s own choices included', async () => {
    expect(await call('get_world_info')).toMatchObject({ name: 'Harbor', description: 'A fogbound port.', tags: ['sea'], rules: ['No magic.'], opening: 'Rain falls.', preset: 'grim', alternateOpenings: [] })
  })

  it('works only in the authoring chat of a world', async () => {
    await expect(call('get_world_info', {}, 'session-abc')).rejects.toThrow(/only in a world authoring chat/)
  })
})

describe('edit_world_info', () => {
  it('changes the fields it is given and nothing else, and has the list of worlds read again', async () => {
    const done = await call('edit_world_info', { changes: { description: 'A port in the rain.', tags: ['sea', 'rain'], opening: 'Gulls cry.', alternateOpenings: [{ title: 'Later', text: 'Dusk falls.' }] } })
    expect(done).toMatchObject({ action: 'edited', changed: expect.arrayContaining(['description', 'tags', 'opening', 'alternateOpenings']) })
    expect(await world()).toMatchObject({ id: 'harbor', name: 'Harbor', description: 'A port in the rain.', metadata: { tags: ['sea', 'rain'] }, opening_message: 'Gulls cry.', rules: ['No magic.'], preset: 'grim', alternate_openings: [{ title: 'Later', text: 'Dusk falls.' }] })
    expect(refreshed).toBe(1)
  })

  it('refuses what is the person\'s to choose, with the fields it can change, and changes nothing', async () => {
    for (const changes of [{ name: 'Elsewhere' }, { preset: 'cosy' }, { lorebooks: ['a'] }, { tools: {} }, { sampling: {} }]) {
      await expect(call('edit_world_info', { changes })).rejects.toThrow(new RegExp(`cannot be changed here: ${WORLD_INFO_FIELDS.join(', ')}`))
    }
    expect(await world()).toMatchObject({ name: 'Harbor', preset: 'grim' })
    expect(refreshed).toBe(0)
  })

  it('refuses a field that does not exist and a value of the wrong kind, with the reason', async () => {
    await expect(call('edit_world_info', { changes: { colour: 'red' } })).rejects.toThrow(/no field "colour"/)
    await expect(call('edit_world_info', { changes: { tags: 'sea' } })).rejects.toThrow(/tags must be a list/)
    await expect(call('edit_world_info', { changes: 'description' })).rejects.toThrow(/must be an object/)
  })

  it('empties the description and removes a list that is set to nothing', async () => {
    await call('edit_world_info', { changes: { description: '', rules: [] } })
    const document = await world()
    expect(document['description']).toBe('')
    expect(document['rules']).toBeUndefined()
  })
})
