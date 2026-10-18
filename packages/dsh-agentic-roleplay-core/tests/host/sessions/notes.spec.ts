import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDatabase } from '@dsh-agentic-roleplay/state'
import { describe, expect, it } from 'vitest'
import { AWAY_ACTION_SCHEMA, parseCharacterAction } from '../../../src/host/orchestration/protocol.ts'
import { addToNote, clearNotes, notesOfSession, putNote, readNotes } from '../../../src/host/sessions/notes.ts'

function session() {
  const values = new Map<string, unknown>()
  return { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) } } }
}

describe('the notes of a turn', () => {
  it('collect lines of one kind in the turn, start again for another turn, and keep only the first few', () => {
    const s = session()
    addToNote(s, 'away', 2, ['a'])
    addToNote(s, 'away', 2, ['b'])
    expect(readNotes(s)).toEqual([{ kind: 'away', turn: 2, lines: ['a', 'b'] }])
    addToNote(s, 'away', 3, ['c'])
    expect(readNotes(s)).toEqual([{ kind: 'away', turn: 3, lines: ['c'] }])
    addToNote(s, 'away', 3, Array.from({ length: 20 }, (_, index) => `l${index}`))
    expect(readNotes(s)[0]?.lines).toHaveLength(8)
  })

  it('are independent per kind, and ignore an empty addition', () => {
    const s = session()
    putNote(s, { kind: 'suggestions', turn: 1, lines: ['x'] })
    addToNote(s, 'away', 1, [])
    addToNote(s, 'away', 1, ['y'])
    expect(readNotes(s).map(note => note.kind).sort()).toEqual(['away', 'suggestions'])
    clearNotes(s)
    expect(readNotes(s)).toEqual([])
  })
})

describe('the account of a character acting away', () => {
  it('is asked for only in the away schema, and kept short and trimmed when given', () => {
    expect(AWAY_ACTION_SCHEMA.required).toContain('account')
    expect(parseCharacterAction({ intent: 'i', commitment: 'low' })).toEqual({ intent: 'i', commitment: 'low' })
    expect(parseCharacterAction({ intent: 'i', commitment: 'low', account: `  ${'x'.repeat(400)}  ` }).account).toHaveLength(300)
    expect(parseCharacterAction({ intent: 'i', commitment: 'low', account: '  ' })).toEqual({ intent: 'i', commitment: 'low' })
  })
})

describe('the note of rounds not yet written', () => {
  const folder = mkdtempSync(join(tmpdir(), 'rp-notes-'))
  const id = '0f5c6a4e-2b1d-4c3a-8e7f-9a1b2c3d4e5f'
  mkdirSync(join(folder, id))
  writeFileSync(sessionDatabase(folder, id), '')
  const open = (waiting: number) => () => ({ ...session(), pendingCommits: { list: () => Array.from({ length: waiting }, () => ({})) } })

  it('is made from what waits for the record keeper, and is not stored', () => {
    expect(notesOfSession({ sessionsDir: () => folder, open: open(3) }, id)).toEqual([{ kind: 'unwritten', turn: 0, lines: [], count: 3 }])
    expect(notesOfSession({ sessionsDir: () => folder, open: open(0) }, id)).toEqual([])
  })
})
