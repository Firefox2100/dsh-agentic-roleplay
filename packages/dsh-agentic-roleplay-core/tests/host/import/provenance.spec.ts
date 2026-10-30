import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readProvenance, recordProvenance } from '../../../src/host/import/provenance.ts'

describe('the import record of a world', () => {
  let world: string
  beforeEach(async () => { world = await mkdtemp(join(tmpdir(), 'prov-')); await mkdir(join(world, '.import')) })
  afterEach(() => rm(world, { recursive: true, force: true }))

  it('is nothing for a world imported before records were kept, and grows by one line per import or update', async () => {
    expect(await readProvenance(world)).toBeUndefined()
    await recordProvenance(world, { kind: 'import', card: { name: 'Card' }, language: 'en', notes: 2 }, '{"a":1}')
    await recordProvenance(world, { kind: 'update', card: { name: 'Card' }, language: '' }, '{"a":2}')
    const record = await readProvenance(world)
    expect(record?.history.map(line => line.kind)).toEqual(['import', 'update'])
    expect(record?.history[0]!.card.sha256).not.toBe(record?.history[1]!.card.sha256)
    expect(record?.history[0]).toMatchObject({ language: 'en', notes: 2 })
  })

  it('refuses a file of another version instead of rewriting it', async () => {
    await writeFile(join(world, '.import', 'provenance.json'), JSON.stringify({ schema: 'other/v9', history: [] }))
    await expect(readProvenance(world)).rejects.toThrow(/not an import record/)
    await expect(recordProvenance(world, { kind: 'import', card: { name: 'C' }, language: 'en' }, '{}')).rejects.toThrow()
  })
})
