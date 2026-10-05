import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as statePlugin from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidStartError, SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { renameSession } from '../../../src/host/sessions/rename-session.ts'

let base: string
let ctx: Context
let fiber: { dispose(): void }
let titles: string[]
const state = () => (ctx as unknown as { roleplayState: statePlugin.RoleplayState }).roleplayState
const sessionsDir = () => join(base, 'sessions')
const deps = () => ({ state: state(), agent: { rename: (id: string, title: string) => { titles.push(`${id} ${title}`); return Promise.resolve() } }, sessionsDir })
const world = { id: 'w', name: 'World' }

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rename-'))
  ctx = new Context()
  fiber = ctx.plugin(statePlugin as never, {} as never) as unknown as { dispose(): void }
  await new Promise(resolve => setTimeout(resolve, 20))
  titles = []
})
afterEach(async () => {
  fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 20))
  await rm(base, { recursive: true, force: true })
})

describe('naming a session', () => {
  it('gives the session and its chat the new name, trimmed', async () => {
    const { id } = state().createSession(sessionsDir(), { name: 'Night', world }).metadata.get()
    await renameSession(deps(), id, '  Night, again ')
    expect(state().openSession(sessionsDir(), id).metadata.get().name).toBe('Night, again')
    expect(titles).toEqual([`${id} Night, again`])
  })

  it('refuses a blank or too long name, and a session there is not, and changes nothing', async () => {
    const { id } = state().createSession(sessionsDir(), { name: 'Night', world }).metadata.get()
    await expect(renameSession(deps(), id, '  ')).rejects.toThrow(InvalidStartError)
    await expect(renameSession(deps(), id, 'x'.repeat(201))).rejects.toThrow(InvalidStartError)
    await expect(renameSession(deps(), '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d', 'x')).rejects.toThrow(SessionNotFoundError)
    await expect(renameSession(deps(), '../x', 'x')).rejects.toThrow(SessionNotFoundError)
    expect(state().openSession(sessionsDir(), id).metadata.get().name).toBe('Night')
    expect(titles).toEqual([])
  })
})
