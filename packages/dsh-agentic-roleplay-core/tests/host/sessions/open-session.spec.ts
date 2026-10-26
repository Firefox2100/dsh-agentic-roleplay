import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { sessionFolder } from '@dsh-agentic-roleplay/state'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { writeOpening } from '../../../src/host/agent/history.ts'
import { readTimeline, writeTimeline } from '../../../src/host/timeline/file.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { openSession } from '../../../src/host/sessions/open-session.ts'

let root: string
let state: RoleplayState
let ensured: [string, string][]
let received: { opening: unknown; events: readonly SessionEvent[] | undefined }[]
let chatExists = true

const deps = () => ({
  state,
  agent: {
    ensure: (id: string, title: string, opening?: unknown, events?: readonly SessionEvent[]) => { ensured.push([id, title]); received.push({ opening, events }); return Promise.resolve(`session-${id}`) },
    has: () => Promise.resolve(chatExists),
  },
  sessionsDir: () => join(root, 'sessions'),
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-session-'))
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
  ensured = []
  received = []
  chatExists = true
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('openSession', () => {
  it('makes sure the session has its chat and names it', async () => {
    const { id } = state.createSession(join(root, 'sessions'), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    expect(await openSession(deps(), id)).toEqual({ id, chatSessionId: `session-${id}` })
    expect(ensured).toEqual([[id, 'Night one']])
  })

  it('refuses an id that names no session, without creating a chat', async () => {
    await expect(openSession(deps(), '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).rejects.toThrow(SessionNotFoundError)
    await expect(openSession(deps(), '../worlds')).rejects.toThrow(SessionNotFoundError)
    expect(ensured).toEqual([])
  })

  it('makes the chat again from the opening and the turns the folder keeps when the chat is not on this installation', async () => {
    const { id } = state.createSession(join(root, 'sessions'), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    const folder = sessionFolder(join(root, 'sessions'), id)
    mkdirSync(folder, { recursive: true })
    writeOpening(folder, [{ type: 'narration', text: 'Rain.' }])
    writeTimeline(folder, { version: 1, head: 'n1', next: 2, nodes: [{ id: 'n1', parent: null, turn: 2, userSeq: 40, endSeq: 90, player: 'I knock.', output: { segments: [{ type: 'narration', text: 'The door opens.' }], repaired: false }, createdAt: 'then' }] })
    chatExists = false
    await openSession(deps(), id)
    expect(received[0]!.events!.length).toBeGreaterThan(10)
    const turn = readTimeline(folder).nodes[0]!
    expect(turn.userSeq).not.toBe(40)
    expect(turn.endSeq).toBe(received[0]!.events!.at(-1)!.seq)
  })

  it('leaves a chat that exists, and a session with no kept opening, as they are', async () => {
    const { id } = state.createSession(join(root, 'sessions'), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    chatExists = false
    await openSession(deps(), id)
    expect(received[0]!.events).toBeUndefined()
  })

  it('makes the chat again from the turns alone for a session made before openings were kept', async () => {
    const { id } = state.createSession(join(root, 'sessions'), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    const folder = sessionFolder(join(root, 'sessions'), id)
    mkdirSync(folder, { recursive: true })
    writeTimeline(folder, { version: 1, head: 'n1', next: 2, nodes: [{ id: 'n1', parent: null, turn: 2, userSeq: 40, endSeq: 90, player: 'I knock.', output: { segments: [{ type: 'narration', text: 'The door opens.' }], repaired: false }, createdAt: 'then' }] })
    chatExists = false
    await openSession(deps(), id)
    expect(received[0]!.events!.length).toBeGreaterThan(10)
  })

  it('puts a log made again in the place of a chat that exists only when asked to, and not at all without a way to', async () => {
    const { id } = state.createSession(join(root, 'sessions'), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    const folder = sessionFolder(join(root, 'sessions'), id)
    mkdirSync(folder, { recursive: true })
    writeOpening(folder, [{ type: 'narration', text: 'Rain.' }])
    const replaced: [string, string, number][] = []
    const withReplace = { ...deps(), replaceChat: (chat: string, title: string, events: readonly SessionEvent[]) => { replaced.push([chat, title, events.length]); return Promise.resolve() } }
    await openSession(withReplace, id)
    expect(replaced).toEqual([])
    await openSession(deps(), id, { rebuild: true })
    expect(replaced).toEqual([])
    await openSession(withReplace, id, { rebuild: true })
    expect(replaced).toEqual([[id, 'Night one', expect.any(Number)]])
    expect(ensured).toEqual([[id, 'Night one'], [id, 'Night one']])
  })
})
