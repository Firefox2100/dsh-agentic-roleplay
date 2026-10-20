import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LorebookEntry } from '../../../src/shared/lorebooks.ts'
import { createLorebook, createLorebookWith, deleteLorebook, deleteLorebookEntry, listLorebooks, loadLorebook, lorebookDirectory, reserveLorebook, updateLorebookInfo, writeLorebookEntry } from '../../../src/host/lorebooks/lorebooks.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'lorebooks-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const entry = (id: string, extra: Partial<LorebookEntry> = {}): LorebookEntry => ({ id, title: id.toUpperCase(), kind: 'history', scope: 'everyone', knownBy: [], summary: 'S', body: `${id} body`, related: [], ...extra })

describe('the lorebook library', () => {
  it('lists books with their entries and how many are common knowledge, and reads an empty book as having a problem', async () => {
    await createLorebookWith(root, { name: 'harbor', title: 'Harbor', description: 'The harbor town.' }, [entry('founding'), entry('rite', { scope: 'listed', knownBy: ['Ann'] })])
    await reserveLorebook(root, 'incoming', 'Incoming')
    const [harbor, incoming] = await listLorebooks(root)
    expect(harbor?.summary).toEqual({ name: 'harbor', title: 'Harbor', description: 'The harbor town.', entries: 2, common: 1, problems: [] })
    expect(harbor?.entries.find(found => found.id === 'rite')).toMatchObject({ scope: 'listed', knownBy: ['Ann'] })
    expect(incoming?.summary.problems).toEqual(['the lorebook has no entries'])
  })

  it('writes an entry in the format of a world\'s lore, checks it first, and refuses a relation to nothing', async () => {
    await createLorebook(root, { name: 'b' })
    await writeLorebookEntry(root, 'b', entry('one'))
    await expect(writeLorebookEntry(root, 'b', entry('two', { related: ['ghost'] }))).rejects.toThrow('not (other) entries')
    await expect(writeLorebookEntry(root, 'b', entry('bad id!'))).rejects.toThrow('not a usable entry id')
    await expect(writeLorebookEntry(root, 'b', entry('three', { title: ' ' }))).rejects.toThrow('needs a title')
    await expect(writeLorebookEntry(root, 'b', entry('four', { kind: 'nonsense' as never }))).rejects.toThrow('kind must be')
    await writeLorebookEntry(root, 'b', entry('two', { related: ['one'] }))
    const text = JSON.parse(await readFile(join(lorebookDirectory(root, 'b'), 'lore', 'two', 'lore.json'), 'utf8')) as Record<string, unknown>
    expect(text).toMatchObject({ title: 'TWO', scope: 'everyone', related: ['one'] })
    expect((await loadLorebook(root, 'b')).summary.entries).toBe(2)
  })

  it('moves a removed entry into the trash, unless another entry relates to it', async () => {
    await createLorebook(root, { name: 'b' })
    await writeLorebookEntry(root, 'b', entry('one'))
    await writeLorebookEntry(root, 'b', entry('two', { related: ['one'] }))
    await expect(deleteLorebookEntry(root, 'b', 'one')).rejects.toThrow('relate')
    await deleteLorebookEntry(root, 'b', 'two')
    expect((await loadLorebook(root, 'b')).summary.entries).toBe(1)
    expect(existsSync(join(lorebookDirectory(root, 'b'), '.trash', 'lore'))).toBe(true)
  })

  it('changes the title and description, refuses a taken name and a bad one, and moves a deleted book to the trash', async () => {
    await createLorebook(root, { name: 'b', title: 'B' })
    expect((await updateLorebookInfo(root, 'b', { description: 'About.' })).summary).toMatchObject({ title: 'B', description: 'About.' })
    await expect(updateLorebookInfo(root, 'b', { title: 'x'.repeat(301) })).rejects.toThrow('at most 300')
    await expect(createLorebook(root, { name: 'b' })).rejects.toThrow('already a lorebook')
    await expect(loadLorebook(root, '../x')).rejects.toThrow('not a usable lorebook name')
    await deleteLorebook(root, 'b')
    expect(existsSync(lorebookDirectory(root, 'b'))).toBe(false)
    await expect(deleteLorebook(root, 'b')).rejects.toThrow('no lorebook')
  })

  it('makes a book of ready entries all or nothing', async () => {
    await expect(createLorebookWith(root, { name: 'b' }, [entry('one', { related: ['ghost'] })])).rejects.toThrow('problems')
    expect(existsSync(lorebookDirectory(root, 'b'))).toBe(false)
  })
})
