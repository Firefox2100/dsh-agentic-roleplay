import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readChatSettings, writeChatSettings } from '../../../src/host/sessions/chat-settings.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { InvalidSettingsError, SETTINGS_FILE, liveSettings, readSettings, useChildReasoning, writeSettings } from '../../../src/host/sessions/settings.ts'
import { DEFAULT_SETTINGS, SETTINGS_SPEC } from '../../../src/shared/settings.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'settings-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('the settings file', () => {
  it('is the defaults until something is stored', () => {
    expect(readSettings(root)).toEqual(DEFAULT_SETTINGS)
  })

  it('is stored whole and read back, leaving no temporary file behind', async () => {
    expect(writeSettings(root, { maxRounds: 6 }).maxRounds).toBe(6)
    expect(readSettings(root).maxRounds).toBe(6)
    expect(await readdir(root)).toEqual([SETTINGS_FILE])
    expect(JSON.parse(await readFile(join(root, SETTINGS_FILE), 'utf8')).maxRounds).toBe(6)
  })

  it('refuses a value that is not acceptable, and writes nothing', async () => {
    expect(() => writeSettings(root, { maxRounds: 99 })).toThrow(InvalidSettingsError)
    expect(await readdir(root)).toEqual([])
  })

  it('refuses a file that is broken or says something else, by name', async () => {
    await writeFile(join(root, SETTINGS_FILE), '{nope')
    expect(() => readSettings(root)).toThrow(/is not valid JSON/)
    await writeFile(join(root, SETTINGS_FILE), '{"maxRounds": 0}')
    expect(() => readSettings(root)).toThrow(/maxRounds/)
  })
})

describe('the settings in force', () => {
  it('give the helpers the profile\'s thinking level when the chat names none, and keep the chat\'s own', () => {
    const undo = useChildReasoning('off')
    expect(liveSettings(root).reasoning.children).toBe('off')
    writeSettings(root, { reasoning: { children: 'low' } })
    expect(liveSettings(root).reasoning.children).toBe('low')
    undo()
    writeSettings(root, { reasoning: { children: '' } })
    expect(liveSettings(root).reasoning.children).toBe('')
  })

  it('are the defaults until a file exists, and follow it as soon as it changes', async () => {
    expect(liveSettings(root)).toEqual(DEFAULT_SETTINGS)
    writeSettings(root, { maxRounds: 2 })
    expect(liveSettings(root).maxRounds).toBe(2)
    await writeFile(join(root, SETTINGS_FILE), '{"maxRounds": 7}')
    expect(liveSettings(root).maxRounds).toBe(7)
    writeSettings(root, { maxRounds: 4 })
    expect(liveSettings(root).maxRounds).toBe(4)
  })

  it('do not read the file again while it is unchanged', async () => {
    writeSettings(root, { maxRounds: 2 })
    expect(liveSettings(root).maxRounds).toBe(2)
    const file = join(root, SETTINGS_FILE)
    const { mtimeMs } = await import('node:fs').then(fs => fs.statSync(file))
    await writeFile(file, '{"maxRounds": 9}')
    await import('node:fs').then(fs => fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000))
    expect(liveSettings(root).maxRounds).toBe(2)
  })

  it('keep the last good settings when the file is edited into something invalid, and say so once', async () => {
    const problems: string[] = []
    writeSettings(root, { maxRounds: 6 })
    expect(liveSettings(root, message => problems.push(message)).maxRounds).toBe(6)
    await writeFile(join(root, SETTINGS_FILE), '{"maxRounds": 99}')
    expect(liveSettings(root, message => problems.push(message)).maxRounds).toBe(6)
    expect(liveSettings(root, message => problems.push(message)).maxRounds).toBe(6)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/maxRounds.*the last good settings stay in force/)
    await writeFile(join(root, SETTINGS_FILE), '{"maxRounds": 3}')
    expect(liveSettings(root).maxRounds).toBe(3)
  })

  it('fall back on the defaults when the first file there is invalid', async () => {
    await writeFile(join(root, SETTINGS_FILE), '{nope')
    expect(liveSettings(root, () => undefined)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('the settings of a session', () => {
  const sessionsDir = () => join(root, 'sessions')
  let clockMode: 'simulated' | 'real' | undefined
  const deps = { sessionsDir, pendingRecords: () => 2, pendingConsolidation: () => 3, clockMode: () => clockMode }
  beforeEach(() => { clockMode = undefined })
  const state = new RoleplayState(new Context(), { journalMode: 'delete' })

  it('are read and written through the session, with the bounds the form needs', () => {
    const { id } = state.createSession(sessionsDir(), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    expect(readChatSettings(deps, id)).toEqual({ settings: DEFAULT_SETTINGS, bounds: SETTINGS_SPEC, pendingRecords: 2, pendingConsolidation: 3 })
    expect(writeChatSettings(deps, id, { maxRounds: 4 }).settings.maxRounds).toBe(4)
    expect(readChatSettings(deps, id).settings.maxRounds).toBe(4)
  })

  it('tell the mode of the clock, which simulated time cannot leave for the real clock, though the real clock can be left', () => {
    const { id } = state.createSession(sessionsDir(), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    clockMode = 'simulated'
    expect(readChatSettings(deps, id).clockMode).toBe('simulated')
    expect(() => writeChatSettings(deps, id, { clock: { mode: 'real' } })).toThrow(/cannot be real: the story's time is simulated/)
    expect(readChatSettings(deps, id).settings.clock.mode).toBe('simulated')
    expect(writeChatSettings(deps, id, { clock: { mode: 'simulated', timeZone: 'Europe/London' } }).settings.clock).toMatchObject({ mode: 'simulated', timeZone: 'Europe/London' })
    clockMode = 'real'
    expect(writeChatSettings(deps, id, { clock: { mode: 'real' } }).settings.clock.mode).toBe('real')
    expect(writeChatSettings(deps, id, { clock: { mode: 'simulated' } }).settings.clock.mode).toBe('simulated')
  })

  it('belong to a session that exists', () => {
    expect(() => readChatSettings(deps, '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).toThrow(SessionNotFoundError)
    expect(() => writeChatSettings(deps, '../worlds', { maxRounds: 2 })).toThrow(SessionNotFoundError)
  })
})
