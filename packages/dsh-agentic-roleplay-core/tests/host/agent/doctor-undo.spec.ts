import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { keepBeforeEdit, undoLastEdit, UNDO_SNAPSHOT, UndoRefusedError, type UndoDeps } from '../../../src/host/agent/doctor-undo.ts'

let root: string
let state: RoleplayState
let busy: boolean
let halted: string[]

const sessionsDir = () => join(root, 'sessions')
const deps = (): UndoDeps => ({ state, sessionsDir, busy: () => busy, halt: id => { halted.push(id); return Promise.resolve() } })
const world = { id: 'w', name: 'W' }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'doctor-undo-'))
  busy = false
  halted = []
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

function started() {
  const session = state.createSession(sessionsDir(), { name: 'Night', world })
  const { id } = session.metadata.get()
  const open = () => state.openSession(sessionsDir(), id)
  return { id, note: (value: string) => open().metadata.setValue('probe', value), read: () => open().metadata.getValue('probe') }
}

describe('putting the story back after a doctor edit', () => {
  it('restores what stood before the edit and can be done once', async () => {
    const story = started()
    story.note('before')
    keepBeforeEdit(deps(), story.id)
    expect(state.snapshots(sessionsDir(), story.id)).toContain(UNDO_SNAPSHOT)
    story.note('after')
    await undoLastEdit(deps(), story.id)
    expect(story.read()).toBe('before')
    expect(halted).toEqual([story.id])
    expect(state.snapshots(sessionsDir(), story.id)).not.toContain(UNDO_SNAPSHOT)
    await expect(undoLastEdit(deps(), story.id)).rejects.toBeInstanceOf(UndoRefusedError)
  })

  it('keeps only the last edit', async () => {
    const story = started()
    story.note('one')
    keepBeforeEdit(deps(), story.id)
    story.note('two')
    keepBeforeEdit(deps(), story.id)
    story.note('three')
    await undoLastEdit(deps(), story.id)
    expect(story.read()).toBe('two')
  })

  it('refuses without an edit to undo, while a turn is played, and after a turn was played since', async () => {
    const story = started()
    await expect(undoLastEdit(deps(), story.id)).rejects.toThrow('no edit of mine')
    keepBeforeEdit(deps(), story.id)
    busy = true
    await expect(undoLastEdit(deps(), story.id)).rejects.toThrow('a turn is being played')
    busy = false
    state.openSession(sessionsDir(), story.id).metadata.recordTurn()
    await expect(undoLastEdit(deps(), story.id)).rejects.toThrow('a turn was played')
    expect(halted).toEqual([])
  })
})
