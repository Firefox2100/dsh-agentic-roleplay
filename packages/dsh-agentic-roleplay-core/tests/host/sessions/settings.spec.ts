import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readChatSettings, writeChatSettings } from '../../../src/host/sessions/chat-settings.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { InvalidSettingsError, SETTINGS_FILE, readSettings, writeSettings } from '../../../src/host/sessions/settings.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'settings-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('the settings file', () => {
  it('is the defaults until something is stored', () => {
    expect(readSettings(root)).toEqual(DEFAULT_SETTINGS)
  })

  it('is stored whole and read back, leaving no temporary file behind', async () => {
    expect(writeSettings(root, { maxRounds: 6 })).toEqual({ maxRounds: 6 })
    expect(readSettings(root)).toEqual({ maxRounds: 6 })
    expect(await readdir(root)).toEqual([SETTINGS_FILE])
    expect(JSON.parse(await readFile(join(root, SETTINGS_FILE), 'utf8'))).toEqual({ maxRounds: 6 })
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

describe('the settings of a session', () => {
  const sessionsDir = () => join(root, 'sessions')
  const state = new RoleplayState(new Context(), { journalMode: 'delete' })

  it('are read and written through the session, with the bounds the form needs', () => {
    const { id } = state.createSession(sessionsDir(), { name: 'Night one', world: { id: 'w', name: 'W' } }).metadata.get()
    expect(readChatSettings({ sessionsDir }, id)).toEqual({ settings: DEFAULT_SETTINGS, limits: { minRounds: 1, maxRounds: 10 } })
    expect(writeChatSettings({ sessionsDir }, id, { maxRounds: 4 }).settings).toEqual({ maxRounds: 4 })
    expect(readChatSettings({ sessionsDir }, id).settings).toEqual({ maxRounds: 4 })
  })

  it('belong to a session that exists', () => {
    expect(() => readChatSettings({ sessionsDir }, '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).toThrow(SessionNotFoundError)
    expect(() => writeChatSettings({ sessionsDir }, '../worlds', { maxRounds: 2 })).toThrow(SessionNotFoundError)
  })
})
