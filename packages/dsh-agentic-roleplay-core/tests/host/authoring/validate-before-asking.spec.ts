import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthoredWorldReader } from '../../../src/host/authoring/read-tools.ts'
import { authoringApproval, validateMutation } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'validate-before-asking-'))
  await writeFile(join(directory, 'world.json'), `${JSON.stringify({ id: 'harbor', name: 'Harbor', description: 'A fogbound port.' }, null, 2)}\n`)
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const reader = () => new AuthoredWorldReader({
  find: (id: string) => Promise.resolve(id === 'harbor' ? { folder: 'harbor', directory, summary: { id: 'harbor', name: 'Harbor', description: '', tags: [] } } : undefined),
} as unknown as WorldCatalog)

const exec = (name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { id: authoringChatSessionId('harbor') } }, signal: new AbortController().signal }) as never
const gate = (name: string, args: Record<string, unknown>) => authoringApproval(exec(name, args), vi.fn(), () => Promise.resolve(false), { validate: e => validateMutation(reader(), e) })

describe('a write the tool would refuse', () => {
  it('is sent back with its reasons, not put to the person, and nothing is written', async () => {
    const decision = await gate('create_world_element', { kind: 'character', key: 'clara', document: 'not an object' })
    expect(decision).toMatchObject({ kind: 'deny', reason: expect.stringContaining('document must be a JSON object') })
    const trigger = await gate('write_world_trigger', { key: 'bell', document: { name: 'Bell', nonsense: true } })
    expect(trigger).toMatchObject({ kind: 'deny', reason: expect.stringContaining('"nonsense" is not a field of a trigger') })
    expect(await readdir(directory)).toEqual(['world.json'])
  })

  it('is asked about when it holds, and still writes nothing before the answer', async () => {
    const document = { name: 'Clara', role: 'npc', tier: 'principal', summary: 'Keeps the inn.', personality: 'Warm.', appearance: 'Tall.', speech: { style: 'Plain.', examples: [] } }
    expect(await gate('create_world_element', { kind: 'character', key: 'clara', document })).toMatchObject({ kind: 'ask' })
    expect(await readdir(directory)).toEqual(['world.json'])
  })

  it('is refused for a replacement of an entry that does not exist, before any question', async () => {
    await expect(gate('replace_world_element', { kind: 'character', key: 'nobody', document: {} })).resolves.toMatchObject({ kind: 'deny', reason: expect.stringContaining('there is no character "nobody"') })
  })
})
