import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidJournalError, JOURNAL_FILE, readJournal, writeJournal } from '../../../src/host/reference/journal.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { MAX_JOURNAL } from '../../../src/shared/journal.ts'

const id = '3f2b8c1e-5d4a-4b6f-9a7c-1e2d3c4b5a69'
let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'journal-'))
  await mkdir(join(dir, id))
  await writeFile(join(dir, id, 'session.sqlite'), '')
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('the journal', () => {
  it('is empty until written, then keeps what was written beside the database', async () => {
    expect(await readJournal(dir, id)).toEqual({ text: '' })
    const written = await writeJournal(dir, id, { text: 'The key is under the stage.' }, () => new Date('2026-11-01T10:00:00Z'))
    expect(written).toEqual({ text: 'The key is under the stage.', updatedAt: '2026-11-01T10:00:00.000Z' })
    expect(await readJournal(dir, id)).toEqual(written)
    expect(JSON.parse(await readFile(join(dir, id, JOURNAL_FILE), 'utf8'))).toEqual(written)
  })

  it('refuses what is not text or is too long, and a session that does not exist', async () => {
    await expect(writeJournal(dir, id, { text: 1 })).rejects.toThrow(InvalidJournalError)
    await expect(writeJournal(dir, id, { text: 'x'.repeat(MAX_JOURNAL + 1) })).rejects.toThrow(InvalidJournalError)
    await expect(readJournal(dir, '4f2b8c1e-5d4a-4b6f-9a7c-1e2d3c4b5a69')).rejects.toThrow(SessionNotFoundError)
    await expect(readJournal(dir, '../x')).rejects.toThrow(SessionNotFoundError)
  })
})
